/**
 * Stripe Events Webhook
 * POST /api/commander/webhooks/stripe/events - Handle Stripe webhook events
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';

// Helper to read raw body from request stream
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      // Get raw body for signature verification
      const rawBody = await getRawBody(req);

      // SECURITY: Signature verification is REQUIRED.
      // If webhook secret is not configured, reject all events.
      if (!endpointSecret) {
        console.warn('STRIPE_WEBHOOK_SECRET not configured — rejecting webhook');
        return res.status(500).json({ error: 'Webhook secret not configured' });
      }
      if (!sig) {
        return res.status(400).json({ error: 'Missing stripe-signature header' });
      }

      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    } catch (err) {
      console.warn('Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    // Handle the event
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await handlePaymentSuccess(event.data.object);
          break;

        case 'payment_intent.payment_failed':
          await handlePaymentFailed(event.data.object);
          break;

        case 'charge.refunded':
          await handleRefund(event.data.object);
          break;

        case 'checkout.session.completed':
          // 2026-07-25 audit fix: without this handler, a paid Checkout
          // never wrote stripe_customer_id / stripe_subscription_id back to
          // commander_subscriptions — customers paid while the platform still
          // saw them as trialing/unlinked.
          await handleCheckoutCompleted(event.data.object);
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await handleSubscriptionUpdate(event.data.object);
          break;

        case 'customer.subscription.deleted':
          await handleSubscriptionCancelled(event.data.object);
          break;

        default:
      }

      return res.status(200).json({ received: true });
    } catch (error) {
      console.warn('Webhook handler error:', error);
      return res.status(500).json({ error: 'Webhook handler failed' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handlePaymentSuccess(paymentIntent) {
  const { id, amount, metadata } = paymentIntent;

  // Update escrow if this is an escrow payment
  if (metadata?.escrow_id) {
    const { error } = await getSupabase()
      .from('commander_escrow_transactions')
      .update({
        status: 'held',
        held_at: new Date().toISOString(),
        payment_reference: id
      })
      .eq('id', metadata.escrow_id);

    if (error) {
      console.warn('Update escrow error:', error);
    }
  }

  // Log the payment
}

async function handlePaymentFailed(paymentIntent) {
  const { id, metadata, last_payment_error } = paymentIntent;

  if (metadata?.escrow_id) {
    const { error } = await getSupabase()
      .from('commander_escrow_transactions')
      .update({
        status: 'failed',
        notes: last_payment_error?.message || 'Payment failed'
      })
      .eq('id', metadata.escrow_id);

    if (error) {
      console.warn('Update escrow error:', error);
    }
  }

}

async function handleRefund(charge) {
  const { id, payment_intent, amount_refunded, metadata } = charge;

  if (metadata?.escrow_id) {
    const { error } = await getSupabase()
      .from('commander_escrow_transactions')
      .update({
        status: 'refunded',
        refunded_at: new Date().toISOString()
      })
      .eq('id', metadata.escrow_id);

    if (error) {
      console.warn('Update escrow error:', error);
    }
  }

}

async function handleCheckoutCompleted(session) {
  const { customer, subscription, metadata, mode } = session;
  if (mode !== 'subscription' || !metadata?.venue_id) return;

  const { error } = await getSupabase()
    .from('commander_subscriptions')
    .update({
      stripe_customer_id: customer || null,
      stripe_subscription_id: subscription || null,
      status: 'active',
      last_payment_date: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('venue_id', metadata.venue_id);

  if (error) {
    console.warn('checkout.session.completed update error:', error);
  }
}

async function handleSubscriptionUpdate(subscription) {
  const { id, customer, status, metadata } = subscription;

  // Update venue subscription tier if this is a Commander subscription
  if (metadata?.venue_id) {
    const tierMap = {
      active: metadata.tier || 'home_game',
      trialing: metadata.tier || 'home_game',
      past_due: metadata.tier || 'home_game',
      canceled: 'free',
      unpaid: 'free'
    };

    const resolvedTier = tierMap[status] || 'free';

    // Update poker_venues table
    const { error } = await getSupabase()
      .from('poker_venues')
      .update({
        commander_tier: resolvedTier,
        commander_enabled: status === 'active' || status === 'trialing'
      })
      .eq('id', metadata.venue_id);

    if (error) {
      console.warn('Update venue subscription error:', error);
    }

    // Also update commander_subscriptions table (login flow reads from here)
    const { error: subError } = await getSupabase()
      .from('commander_subscriptions')
      .update({
        tier: resolvedTier === 'free' ? metadata.tier || 'home_game' : resolvedTier,
        status: status,
      })
      .eq('venue_id', metadata.venue_id)
      .in('status', ['active', 'trialing', 'past_due']);

    if (subError) {
      console.warn('Update commander_subscriptions error:', subError);
    }
  }

}

async function handleSubscriptionCancelled(subscription) {
  const { id, metadata } = subscription;

  if (metadata?.venue_id) {
    // Update poker_venues
    const { error } = await getSupabase()
      .from('poker_venues')
      .update({
        commander_tier: 'free',
        commander_enabled: false
      })
      .eq('id', metadata.venue_id);

    if (error) {
      console.warn('Update venue subscription error:', error);
    }

    // Update commander_subscriptions status
    const { error: subError } = await getSupabase()
      .from('commander_subscriptions')
      .update({
        status: 'canceled',
      })
      .eq('venue_id', metadata.venue_id)
      .in('status', ['active', 'trialing', 'past_due']);

    if (subError) {
      console.warn('Update commander_subscriptions cancel error:', subError);
    }
  }

}

// Disable default body parser - we need raw body for signature verification
export const config = {
  api: {
    bodyParser: false
  }
};
