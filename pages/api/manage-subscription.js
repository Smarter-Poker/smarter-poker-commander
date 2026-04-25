import { createClient } from '../../src/lib/supabaseServerClient';
import Stripe from 'stripe';
import { verifyStaffSession } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/sentryWrap';

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

    // Must be Owner or Admin
    const authReq = await verifyStaffSession(req, res, ['all', 'admin', 'manage_billing']);
    if (!authReq.allow) return;

    const { venue_id, user_id, user } = authReq;
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
    
    // Ensure only the original owner can manage billing (or those with equivalent perm)
    if (sub.owner_id !== user_id && user?.user_metadata?.role !== 'admin') {
        const { data: staff } = await getSupabase()
          .from('commander_staff')
          .select('permissions')
          .eq('venue_id', venue_id)
          .eq('user_id', user_id)
          .maybeSingle();
        if (!staff?.permissions?.includes('all') && !staff?.permissions?.includes('manage_billing')) {
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
            customer_email: user?.email,
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: returnUrl,
            metadata: {
                venue_id: venue_id.toString(),
                tier: sub.tier,
                user_id: user_id.toString()
            }
            // Note: Since they already had their 30 free days locally tracked,
            // we do NOT add `trial_period_days` here. They pay immediately.
        });

        return res.status(200).json({ url: checkoutSession.url });
    } catch (err) {
        console.warn('Failed to create checkout session:', err);
        return res.status(500).json({ error: 'Failed to create payment session.' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[Billing API API Error]', err);
    if (!res.headersSent) return res.status(500).json({ error: 'Internal server error' });
  }
}
