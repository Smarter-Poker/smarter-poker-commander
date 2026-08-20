// pages/api/commander/create-subscription.js
import { createClient } from '../../src/lib/supabaseServerClient';
import Stripe from 'stripe';
import { checkMemoryRateLimit } from '../../src/lib/commander/rateLimit';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { COMMANDER_FREE_MODE } from '../../src/lib/commander/tierConfig';
import { reportApiError } from '../../src/lib/sentryWrap';
// Note: No auth guard - this route is called during REGISTRATION before any session exists.
// It creates the user account itself, so no pre-existing auth is possible.

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// 2026-07-25 audit fix: lazy, guarded Stripe construction. `new Stripe(undefined)`
// throws at import, 500ing the whole registration route even in free mode
// where Stripe is never used.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// 2026-07-25 audit fix: single trial-length constant - UI copy promises a
// 14-day trial but this file previously hardcoded 30 days in three places.
const TRIAL_DAYS = 14;

const TIER_PRICES = {
  home_game: {
    price: 99,
    priceId: process.env.STRIPE_HOME_GAME_PRICE_ID || 'price_home_game',
  },
  charity: {
    price: 199,
    priceId: process.env.STRIPE_CHARITY_PRICE_ID || 'price_charity',
  },
  club: {
    price: 399,
    priceId: process.env.STRIPE_CLUB_PRICE_ID || 'price_club',
  },
};

// Robust user lookup - tries multiple methods
async function findUserByEmail(email) {
  const normalizedEmail = email.toLowerCase().trim();

  // Method 0 (Most reliable): Look up via profiles table → get auth user ID
  try {
    const { data: profile } = await getSupabase()
      .from('profiles')
      .select('id, email')
      .ilike('email', normalizedEmail)
      .maybeSingle();
    if (profile?.id) {
      return { id: profile.id, email: profile.email || normalizedEmail };
    }
  } catch (e) {
    console.warn('Method 0 (profiles) failed:', e.message);
  }

  // Method 1: Supabase admin getUserByEmail (if available in this SDK version)
  try {
    const { data, error } = await getSupabase().auth.admin.getUserById
      ? await (async () => {
        // Try listing with a small page and filtering
        const { data: listData } = await getSupabase().auth.admin.listUsers({ perPage: 50, page: 1 });
        const found = listData?.users?.find(u => u.email?.toLowerCase() === normalizedEmail);
        return { data: found ? { user: found } : null, error: null };
      })()
      : { data: null, error: null };
    if (data?.user) {
      return data.user;
    }
  } catch (e) {
    console.warn('Method 1 failed:', e.message);
  }

  // Method 2: GoTrue REST API - paginated search (up to 5000 users)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    let page = 1;
    while (page <= 50) {
      const url = `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=100`;
      const resp = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'apikey': serviceKey,
          'Content-Type': 'application/json',
        },
      });
      if (!resp.ok) break;
      const data = await resp.json();
      const users = data.users || data;
      if (!Array.isArray(users) || users.length === 0) break;
      const found = users.find(u => u.email?.toLowerCase() === normalizedEmail);
      if (found) {
        return found;
      }
      if (users.length < 100) break;
      page++;
    }
  } catch (e) {
    console.warn('Method 2 failed:', e.message);
  }

  return null;
}

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }


    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Rate limit: 3 subscription attempts per minute per IP
    const fwd = req.headers['x-forwarded-for'];
    const ip = fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress || '0';
    const rl = checkMemoryRateLimit(`sub:${ip}`, 3, 60000);
    if (!rl.allowed) { return res.status(429).json({ error: 'Too many requests. Please try again shortly.' }); }

    const { paymentMethodId, selectedTier, clubInfo, ownerInfo, existingAccount } = req.body;
    // Defense-in-depth: while COMMANDER_FREE_MODE is on, billing is waived
    // regardless of what the client sent. Never reach Stripe for these users
    // even if a malicious caller sets skipPayment=false in the body.
    let { skipPayment } = req.body;
    if (COMMANDER_FREE_MODE) {
      skipPayment = true;
    }
    const tier = selectedTier || req.body.tier;

    if (!tier || !TIER_PRICES[tier]) {
      return res.status(400).json({ error: 'Invalid subscription tier' });
    }

    let userId = null;
    let venueId = null;
    let createdUser = false;
    let createdVenue = false;

    const doRollback = async () => {
      try {
        if (createdVenue && venueId) {
          console.warn('[Rollback] Deleting orphaned venue:', venueId);
          await getSupabase().from('poker_venues').delete().eq('id', venueId);
        }
        if (createdUser && userId) {
          console.warn('[Rollback] Deleting orphaned user:', userId);
          await getSupabase().auth.admin.deleteUser(userId);
        }
      } catch (rollbackErr) {
        console.error('[Rollback Failed]', rollbackErr);
      }
    };

    try {
      const email = ownerInfo.email?.toLowerCase().trim();
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      // ─── Duplicate prevention: check if this email already has an active Commander subscription ──
      // MULTI-CLUB (2026-08-19): this gate previously blocked ALL second
      // venues, contradicting the additional-venue logic further down (free
      // trial check + "additional venue" payment requirement). It now only
      // applies to the NEW-ACCOUNT path. The existing-account path is
      // authenticated below (valid Supabase session whose email must match),
      // so a signed-in owner may legitimately add another club; pricing for
      // the additional venue is enforced by the free-trial/payment logic.
      if (!existingAccount) {
        const { data: existingEmailSub } = await getSupabase()
          .from('commander_subscriptions')
          .select('id, status, venue:poker_venues(name)')
          .eq('billing_email', email)
          .in('status', ['active', 'trialing'])
          .limit(1);

        if (existingEmailSub && existingEmailSub.length > 0) {
          const venueName = existingEmailSub[0].venue?.name || 'a venue';
          return res.status(400).json({
            error: `An active Club Commander account already exists for ${email} (${venueName}). Please check "I already have a Smarter.Poker account" and sign in to add another venue.`
          });
        }
      }

      // ─── Duplicate prevention: check if a Commander venue already exists at this address ──
      const hasAddress = clubInfo.address && clubInfo.address.trim();
      if (hasAddress) {
        const { data: existingAddrVenue } = await getSupabase()
          .from('poker_venues')
          .select('id, name')
          .eq('address', clubInfo.address.trim())
          .eq('commander_enabled', true)
          .limit(1);

        if (existingAddrVenue && existingAddrVenue.length > 0) {
          return res.status(400).json({
            error: `A Club Commander venue already exists at this address (${existingAddrVenue[0].name}). If this is your venue, please sign in instead.`
          });
        }
      }



      if (existingAccount) {
        // ─── Path A: Existing account ──────────────────────────────────
        // 2026-07-25 audit fix (P1): this path previously linked a venue,
        // subscription, and owner-staff role to ANY account by email - and
        // overwrote that account's user_metadata - with zero authentication.
        // It now requires a valid Supabase session for that same account.
        const authHeader = req.headers.authorization || '';
        const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
        if (!bearer) {
          return res.status(401).json({
            error: 'Please sign in to your Smarter.Poker account first, then complete Commander registration.',
            code: 'AUTH_REQUIRED'
          });
        }
        const { data: authData, error: authErr } = await getSupabase().auth.getUser(bearer);
        const authedUser = authData?.user;
        if (authErr || !authedUser) {
          return res.status(401).json({ error: 'Your session has expired. Please sign in again.', code: 'AUTH_REQUIRED' });
        }
        if ((authedUser.email || '').toLowerCase().trim() !== email) {
          return res.status(403).json({
            error: 'The signed-in account does not match the email entered. Sign in with that account or use its email.',
            code: 'EMAIL_MISMATCH'
          });
        }
        userId = authedUser.id;
        // Update their metadata to include venue_owner role
        try {
          await getSupabase().auth.admin.updateUserById(userId, {
            user_metadata: {
              full_name: ownerInfo.name,
              phone: ownerInfo.phone,
              role: 'venue_owner',
            }
          });
        } catch (e) { console.warn('[create-subscription] Metadata update non-critical error:', e.message); }
      } else {
        // ─── Path B: New account - create user ─────────────────────────
        const password = ownerInfo.password || ('Tmp' + require('crypto').randomBytes(12).toString('base64url') + 'X1!');

        const { data: authData, error: authError } = await getSupabase().auth.admin.createUser({
          email,
          password,
          email_confirm: false, // Wait for user to verify email
          phone_confirm: true,  // Phone verified via Twilio in Step 1!
          user_metadata: {
            full_name: ownerInfo.name,
            phone: ownerInfo.phone,
            role: 'venue_owner'
          }
        });

        if (!authError && authData?.user) {
          userId = authData.user.id;
          createdUser = true;

          // Defer email verification trigger until after Stripe payment succeeds (moved to end of file)
        } else if (authError?.message?.toLowerCase().includes('already') ||
          authError?.message?.toLowerCase().includes('exists') ||
          authError?.message?.toLowerCase().includes('registered')) {
          // 2026-07-25 audit fix (P1): do NOT silently link the existing
          // account here - that let anyone claim a venue under a victim's
          // email by "registering" with it. Route them through the
          // authenticated existing-account path instead.
          return res.status(400).json({
            error: 'An account with this email already exists. Please check "I already have a Smarter.Poker account", sign in, and try again.',
            code: 'ACCOUNT_EXISTS'
          });
        } else {
          // Unexpected error
          console.warn('createUser error:', authError?.message);
          return res.status(400).json({
            error: `Registration issue: ${authError?.message || 'Unknown error'}. Please contact support at admin@smarter.poker.`
          });
        }
      }

      // ─── 2. Create or find the venue (handle optional address) ─────
      const venueAddress = clubInfo.address?.trim() || null;
      const venueCity = clubInfo.city?.trim() || null;
      const venueState = clubInfo.state?.trim() || null;
      const venueZip = clubInfo.zip?.trim() || null;

      // Try to find existing venue by name + address (only if address provided)
      let existingVenue = null;
      if (venueAddress) {
        const { data: foundVenue } = await getSupabase()
          .from('poker_venues')
          .select('id')
          .eq('name', clubInfo.name)
          .eq('address', venueAddress)
          .maybeSingle();
        existingVenue = foundVenue;
      }

      if (existingVenue) {
        venueId = existingVenue.id;

        await getSupabase()
          .from('poker_venues')
          .update({
            claimed_by: userId,
            claimed_at: new Date().toISOString(),
            is_claimed: true,
            commander_enabled: true,
            commander_tier: tier,
            commander_activated_at: new Date().toISOString(),
            phone: clubInfo.phone,
            email: clubInfo.email || email,
            website: clubInfo.website || null,
            poker_tables: parseInt(clubInfo.tables) || null,
            games_offered: clubInfo.gamesOffered,
            registration_completed_at: new Date().toISOString(),
            onboarding_step: 5,
            ...(venueZip ? { zip: venueZip } : {}),
          })
          .eq('id', venueId);
      } else {
        const venueInsert = {
          name: clubInfo.name,
          phone: clubInfo.phone || ownerInfo.phone,
          email: clubInfo.email || email,
          website: clubInfo.website || null,
          poker_tables: parseInt(clubInfo.tables) || null,
          games_offered: clubInfo.gamesOffered,
          venue_type: 'poker_room',
          is_active: true,
          is_claimed: true,
          claimed_by: userId,
          claimed_at: new Date().toISOString(),
          commander_enabled: true,
          commander_tier: tier,
          commander_activated_at: new Date().toISOString(),
          registration_completed_at: new Date().toISOString(),
          onboarding_step: 5,
          source: 'self_registration'
        };
        // Address fields: city/state have NOT NULL constraints, always provide defaults
        if (venueAddress) venueInsert.address = venueAddress;
        if (venueZip) venueInsert.zip = venueZip;
        venueInsert.city = venueCity || '';
        venueInsert.state = venueState || '';
        venueInsert.country = 'US';

        const { data: newVenue, error: venueError } = await getSupabase()
          .from('poker_venues')
          .insert(venueInsert)
          .select()
          .maybeSingle();

        if (venueError) {
          console.warn('Venue creation error:', venueError);
          await doRollback();
          return res.status(400).json({ error: 'Failed to create venue: ' + venueError.message });
        }

        if (!newVenue) {
          await doRollback();
          return res.status(500).json({ error: 'Venue creation returned no data' });
        }

        venueId = newVenue.id;
        createdVenue = true;
      }

      // ─── Free Trial Eligibility Check (Anti-Fraud) ───────────────────
      const { data: pastSubs } = await getSupabase()
        .from('commander_subscriptions')
        .select('id')
        .eq('owner_id', userId)
        .limit(1);

      const hasUsedFreeTrial = pastSubs && pastSubs.length > 0;

      // ─── 3. Stripe (if paying) ───────────────────────────────────────
      let stripeCustomerId = null;
      let stripeSubscriptionId = null;

      // SECURITY: Payment is required ONLY IF they have already used their free trial.
      // Or if they explicitly passed skipPayment=false (though No-CC is the default now)
      const hasRealStripeConfig = process.env.STRIPE_SECRET_KEY &&
        TIER_PRICES[tier].priceId &&
        !['price_home_game', 'price_charity', 'price_club'].includes(TIER_PRICES[tier].priceId);

      const requiresPaymentNow = hasUsedFreeTrial;

      if (requiresPaymentNow && hasRealStripeConfig) {
        if (!paymentMethodId) {
           await doRollback();
           return res.status(400).json({ error: 'Free trial already used. A valid payment method is required to activate an additional venue.' });
        }
        
        const customer = await stripe.customers.create({
          email,
          name: ownerInfo.name,
          phone: ownerInfo.phone,
          payment_method: paymentMethodId,
          invoice_settings: { default_payment_method: paymentMethodId },
          metadata: { venue_id: venueId.toString(), user_id: userId },
        });

        stripeCustomerId = customer.id;

        const subscription = await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: TIER_PRICES[tier].priceId }],
          payment_settings: {
            payment_method_types: ['card'],
            save_default_payment_method: 'on_subscription',
          },
          metadata: { venue_id: venueId.toString(), tier },
        });

        stripeSubscriptionId = subscription.id;
      } else if (hasRealStripeConfig && paymentMethodId) {
          // They opted to provide a card upfront anyway
          const customer = await stripe.customers.create({
            email,
            name: ownerInfo.name,
            phone: ownerInfo.phone,
            payment_method: paymentMethodId,
            invoice_settings: { default_payment_method: paymentMethodId },
            metadata: { venue_id: venueId.toString(), user_id: userId },
          });
  
          stripeCustomerId = customer.id;
  
          const subscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: TIER_PRICES[tier].priceId }],
            trial_period_days: 30, // 30 day trial if they provide card upfront
            payment_settings: {
              payment_method_types: ['card'],
              save_default_payment_method: 'on_subscription',
            },
            metadata: { venue_id: venueId.toString(), tier },
          });
  
          stripeSubscriptionId = subscription.id;
      }

      // ─── 4. Commander subscription record ────────────────────────────
      const { data: existingSub } = await getSupabase()
        .from('commander_subscriptions')
        .select('id')
        .eq('venue_id', venueId)
        .maybeSingle();

      let subscriptionData;

      if (existingSub) {
        const { data: updatedSub } = await getSupabase()
          .from('commander_subscriptions')
          .update({
            owner_id: userId,
            tier,
            status: 'trialing',
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: stripeSubscriptionId,
            monthly_price: TIER_PRICES[tier].price,
            billing_email: email,
            billing_name: ownerInfo.name,
            trial_ends_at: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
          })
          .eq('id', existingSub.id)
          .select()
          .maybeSingle();
        subscriptionData = updatedSub || existingSub;
      } else {
        const { data: newSub, error: subError } = await getSupabase()
          .from('commander_subscriptions')
          .insert({
            venue_id: venueId,
            owner_id: userId,
            tier,
            status: stripeSubscriptionId ? 'trialing' : (requiresPaymentNow ? 'active' : 'trialing'),
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: stripeSubscriptionId,
            monthly_price: TIER_PRICES[tier].price,
            billing_email: email,
            billing_name: ownerInfo.name,
            billing_address: { city: venueCity || '', state: venueState || '', country: 'US' },
            trial_ends_at: (stripeSubscriptionId || !requiresPaymentNow) ? new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString() : null,
          })
          .select()
          .maybeSingle();

        if (subError) {
          console.warn('Subscription creation error:', subError);
          await doRollback();
          return res.status(500).json({ error: 'Failed to create subscription' });
        }
        if (!newSub) {
          await doRollback();
          return res.status(500).json({ error: 'Subscription creation returned no data' });
        }
        subscriptionData = newSub;
      }

      // ─── 5. Staff record (owner role) ────────────────────────────────
      // 2026-07-25 audit fix: the previous insert used columns that don't
      // exist on commander_staff (name/status, and permissions as an array),
      // so it silently failed and owners never got a staff row. Write the
      // real columns and populate BOTH user link columns (user_id and
      // linked_user_id) so every auth helper finds the row.
      const { data: existingStaff } = await getSupabase()
        .from('commander_staff')
        .select('id, linked_user_id')
        .eq('venue_id', venueId)
        .or(`user_id.eq.${userId},linked_user_id.eq.${userId}`)
        .limit(1)
        .maybeSingle();

      if (!existingStaff) {
        const { error: staffInsertError } = await getSupabase().from('commander_staff').insert({
          venue_id: venueId,
          user_id: userId,
          linked_user_id: userId,
          display_name: ownerInfo.name,
          email,
          phone: ownerInfo.phone,
          role: 'owner',
          permissions: {},
          is_active: true,
        });
        if (staffInsertError) {
          console.warn('[create-subscription] owner staff insert failed:', staffInsertError.message);
        }
      } else if (!existingStaff.linked_user_id) {
        await getSupabase().from('commander_staff')
          .update({ linked_user_id: userId })
          .eq('id', existingStaff.id);
      }

      // ─── 5.5 Auto-provision tables ─────────────────────────────────
      const tableCount = parseInt(clubInfo.tables) || 0;
      if (tableCount > 0) {
        try {
          // Check how many tables already exist for this venue
          const { data: existingTables } = await getSupabase()
            .from('commander_tables')
            .select('table_number')
            .eq('venue_id', venueId)
                .limit(100)
          const existingNumbers = new Set((existingTables || []).map(t => t.table_number));

          // Create missing tables (default 9-max, available status)
          const tablesToInsert = [];
          for (let i = 1; i <= tableCount; i++) {
            if (!existingNumbers.has(i)) {
              tablesToInsert.push({
                venue_id: venueId,
                table_number: i,
                table_name: `Table ${i}`,
                max_seats: 9,
                status: 'available',
              });
            }
          }
          if (tablesToInsert.length > 0) {
            await getSupabase().from('commander_tables').insert(tablesToInsert);
          }
        } catch (e) {
          console.warn('Table auto-provision error (non-critical):', e.message);
        }
      }

      // ─── 6. Social Hub page (best-effort) ────────────────────────────
      try {
        await fetch(`${process.env.SOCIAL_HUB_API_URL}/api/create-club-page`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SOCIAL_HUB_API_KEY}`
          },
          body: JSON.stringify({
            venue_id: venueId, name: clubInfo.name,
            description: `${clubInfo.name}${venueCity && venueState ? ` - Poker Room in ${venueCity}, ${venueState}` : ''}`,
            address: venueAddress || null, city: venueCity || null, state: venueState || null,
            website: clubInfo.website || null, owner_id: userId
          })
        });
      } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

      // ─── 7. Welcome email (best-effort) ──────────────────────────────
      try {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/email/send-welcome`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': process.env.ADMIN_ROUTE_SECRET || '',
          },
          body: JSON.stringify({
            to: email, name: ownerInfo.name, clubName: clubInfo.name,
            tier, loginUrl: `${process.env.NEXT_PUBLIC_APP_URL}/commander/login`
          })
        });
      } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

      // ─── 8. Trigger Supabase Email Verification (New Users Only) ─────
      if (createdUser && email) {
        try {
          await getSupabase().auth.resend({ type: 'signup', email });
          console.log(`[create-subscription] Sent verification email to ${email}`);
        } catch (e) {
          console.warn('[create-subscription] Failed to send verification email:', e.message);
        }
      }

      // ─── Done ────────────────────────────────────────────────────────
      return res.status(200).json({
        success: true,
        venueId,
        userId,
        subscriptionId: subscriptionData?.id,
        stripeCustomerId,
        stripeSubscriptionId,
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
      });

    } catch (error) {
      console.warn('Registration error:', error);
      
      // ─── ROLLBACK ORPHANED RECORDS ───
      if (typeof doRollback === 'function') {
        await doRollback();
      }
      
      return res.status(500).json({ error: error.message || 'Registration failed' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
