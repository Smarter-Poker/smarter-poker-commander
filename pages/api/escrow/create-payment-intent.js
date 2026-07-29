/**
 * Escrow Payment Intent API
 * POST /api/commander/escrow/create-payment-intent
 * Creates a Stripe payment intent for escrow deposit
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' }
      });
    }

    // Check if Stripe is configured
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'PAYMENTS_NOT_CONFIGURED',
          message: 'Payment processing is not yet configured. Please contact support.',
          fallback: 'cash'
        }
      });
    }

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Authorization required' }
        });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;

      if (authError || !user) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid token' }
        });
      }

      const { escrow_id, amount } = req.body;

      if (!escrow_id || !amount) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'escrow_id and amount required' }
        });
      }

      // Verify escrow transaction exists and belongs to user
      // 2026-07-29 fix: commander_home_games has no `name` column (the title column
      // is `title`); the old embed `(id, name, host_id)` errored the whole query so
      // every escrow deposit returned 404 and no Stripe PaymentIntent was created.
      const { data: escrow, error: escrowError } = await getSupabase()
        .from('commander_escrow_transactions')
        .select('*, commander_home_games!inner(id, title, host_id)')
        .eq('id', escrow_id)
        .eq('player_id', user.id)
        .eq('status', 'pending')
        .maybeSingle();

      if (escrowError || !escrow) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Escrow transaction not found or not pending' }
        });
      }

      // Initialize Stripe
      const stripe = require('stripe')(stripeSecretKey);

      // Get or create Stripe customer
      let customerId;
      const { data: profile } = await getSupabase()
        .from('profiles')
        .select('stripe_customer_id, email, username')
        .eq('id', user.id)
        .maybeSingle();

      if (profile?.stripe_customer_id) {
        customerId = profile.stripe_customer_id;
      } else {
        const customer = await stripe.customers.create({
          email: profile?.email || user.email,
          metadata: {
            smarter_poker_id: user.id,
            username: profile?.username
          }
        });
        customerId = customer.id;

        // Save customer ID to profile
        await getSupabase()
          .from('profiles')
          .update({ stripe_customer_id: customerId })
          .eq('id', user.id);
      }

      // Create payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        customer: customerId,
        metadata: {
          escrow_id: escrow.id,
          home_game_id: escrow.home_game_id,
          player_id: user.id,
          type: 'commander_escrow'
        },
        description: `Escrow deposit for home game: ${escrow.commander_home_games?.title || 'Poker Game'}`,
        automatic_payment_methods: {
          enabled: true
        }
      });

      // Update escrow with payment intent ID
      await getSupabase()
        .from('commander_escrow_transactions')
        .update({
          payment_reference: paymentIntent.id,
          payment_method: 'stripe'
        })
        .eq('id', escrow_id);

      return res.status(200).json({
        success: true,
        data: {
          client_secret: paymentIntent.client_secret,
          payment_intent_id: paymentIntent.id
        }
      });
    } catch (error) {
      console.warn('Payment intent error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'PAYMENT_ERROR', message: error.message || 'Failed to create payment' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
