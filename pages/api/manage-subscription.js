import { createClient } from '../../src/lib/supabaseServerClient';
import Stripe from 'stripe';
import { verifyStaffSession } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/apiErrorHandler';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// The same Stripe TIER_PRICES mapping
const TIER_PRICES = {
  home_game: { priceId: process.env.STRIPE_HOME_GAME_PRICE_ID || 'price_home_game' },
  charity: { priceId: process.env.STRIPE_CHARITY_PRICE_ID || 'price_charity' },
  club: { priceId: process.env.STRIPE_CLUB_PRICE_ID || 'price_club' },
};

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }


    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured on this server.' });
    }

    // Must be Owner or Manager.
    // 2026-07-25 audit fix (P0): this previously called verifyStaffSession
    // with a signature it never had ({allow, venue_id, user_id, user}) - the
    // real return shape is {staff}/{error}, so `authReq.allow` was always
    // undefined and the handler exited WITHOUT responding: the billing portal
    // hung on every request.
    const authReq = await verifyStaffSession(req);
    if (authReq.error) {
      return res.status(authReq.error.status || 401).json({ error: authReq.error.message });
    }
    if (!['owner', 'manager'].includes(authReq.staff.role)) {
      return res.status(403).json({ error: 'Owner or Manager role required to manage billing.' });
    }
    const venue_id = authReq.staff.venue_id;
    const user_id = authReq.staff.linked_user_id || authReq.staff.user_id || authReq.staff.id;
    const user = null;
    const returnUrl = req.body.returnUrl || `${process.env.NEXT_PUBLIC_APP_URL}/commander/admin/billing`;

    // 1. Fetch Commander Subscription for this venue
    const { data: sub } = await getSupabase()
      .from('commander_subscriptions')
      .select('stripe_customer_id, tier, status, owner_id')
      .eq('venue_id', venue_id)
      .maybeSingle();

    if (!sub) {
      return res.status(404).json({ error: 'Commander subscription not found for this venue.' });
    }
    
    // Ensure only the billing owner (or a manager with billing permission)
    // can manage the subscription. permissions is a jsonb object, not array.
    if (String(sub.owner_id) !== String(user_id)) {
        const { data: staff } = await getSupabase()
          .from('commander_staff')
          .select('permissions, role')
          .eq('venue_id', venue_id)
          .or(`user_id.eq.${user_id},linked_user_id.eq.${user_id}`)
          .limit(1)
          .maybeSingle();
        const perms = staff?.permissions || {};
        if (staff?.role !== 'owner' && perms.manage_billing !== true && perms.all !== true) {
            return res.status(403).json({ error: 'Only the billing owner or staff with billing permissions can manage the subscription.' });
        }
    }

    // 2. Scenario A: Customer already exists in Stripe -> Create Customer Portal Session
    if (sub.stripe_customer_id) {
        try {
            const portalSession = await stripe.billingPortal.sessions.create({
              customer: sub.stripe_customer_id,
              return_url: returnUrl,
            });
            return res.status(200).json({ url: portalSession.url });
        } catch (err) {
            console.warn('Failed to create billing portal:', err);
            return res.status(500).json({ error: 'Failed to access billing portal.' });
        }
    } 

    // 3. Scenario B: Customer does NOT exist in Stripe yet (e.g., 30-day Free Trial)
    // Create a Checkout Session for them to enter a card and subscribe to their tier.
    const priceId = TIER_PRICES[sub.tier]?.priceId;
    if (!priceId || ['price_home_game', 'price_charity', 'price_club'].includes(priceId)) {
        return res.status(500).json({ error: 'Invalid or missing Stripe price ID configuration.' });
    }

    try {
        const checkoutSession = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: returnUrl,
            metadata: {
                venue_id: venue_id.toString(),
                tier: sub.tier,
                user_id: String(user_id)
            },
            // 2026-07-25 audit fix: metadata on the SESSION alone never
            // reaches customer.subscription.* webhook events - the webhook
            // could never link the paid subscription back to the venue.
            // subscription_data.metadata lands on the Subscription object.
            subscription_data: {
                metadata: {
                    venue_id: venue_id.toString(),
                    tier: sub.tier,
                }
            }
            // Note: trial already consumed locally - they pay immediately.
        });

        return res.status(200).json({ url: checkoutSession.url });
    } catch (err) {
        console.warn('Failed to create checkout session:', err);
        return res.status(500).json({ error: 'Failed to create payment session.' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[Billing API API Error]', err);
    if (!res.headersSent) return res.status(500).json({ error: 'Internal server error' });
  }
}
