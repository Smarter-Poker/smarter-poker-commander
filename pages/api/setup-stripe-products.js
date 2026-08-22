// pages/api/commander/setup-stripe-products.js
// Run this once to create Stripe products and prices
// Access: /api/commander/setup-stripe-products?secret=YOUR_ADMIN_SECRET

import Stripe from 'stripe';
import { guardManager } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/sentryWrap';

// 2026-07-25 audit fix: guarded construction - `new Stripe(undefined)` throws
// at import and 500s the route before auth even runs.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const PRODUCTS = [
  {
    tier: 'home_game',
    name: 'Club Commander Home Game',
    description: 'Up to 5 tables, 3 staff accounts, 100 SMS/month',
    price: 9900, // $99.00 in cents
  },
  {
    tier: 'charity',
    name: 'Club Commander Charity',
    description: 'Up to 15 tables, 10 staff accounts, 500 SMS/month, full operations suite',
    price: 19900, // $199.00
  },
  {
    tier: 'club',
    name: 'Club Commander Club',
    description: 'Unlimited tables, staff, SMS. Paid memberships, time billing, priority support',
    price: 39900, // $399.00
  },
];

export default async function handler(req, res) {
  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    if (!applyRateLimit(req, res, LIMITS.write)) return;
  }

  // Auth guard: require manager auth
  const _staff = await guardManager(req, res);
  if (!_staff) return;

  // 2026-07-25 audit fix: removed the hardcoded fallback secret that was
  // committed to source ('commander-setup-2026') - the env secret is now
  // required, and the route fails closed when it is unset.
  const { secret } = req.query;
  if (!process.env.ADMIN_SETUP_SECRET || secret !== process.env.ADMIN_SETUP_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!stripe) {
    return res.status(503).json({ success: false, error: 'Stripe is not configured on this server.' });
  }

  try {
    const results = [];

    for (const productData of PRODUCTS) {
      // Check if product already exists
      const existingProducts = await stripe.products.search({
        query: `metadata['tier']:'${productData.tier}'`,
      });

      let product;
      if (existingProducts.data.length > 0) {
        product = existingProducts.data[0];
      } else {
        // Create product
        product = await stripe.products.create({
          name: productData.name,
          description: productData.description,
          metadata: {
            tier: productData.tier,
          },
        });
      }

      // Check for existing price
      const existingPrices = await stripe.prices.list({
        product: product.id,
        active: true,
      });

      let price;
      const matchingPrice = existingPrices.data.find(
        (p) => p.unit_amount === productData.price && p.recurring?.interval === 'month'
      );

      if (matchingPrice) {
        price = matchingPrice;
      } else {
        // Create price
        price = await stripe.prices.create({
          product: product.id,
          unit_amount: productData.price,
          currency: 'usd',
          recurring: {
            interval: 'month',
          },
          metadata: {
            tier: productData.tier,
          },
        });
      }

      results.push({
        tier: productData.tier,
        productId: product.id,
        priceId: price.id,
        amount: productData.price / 100,
      });
    }

    // Return the price IDs to add to env
    const envVars = results.map((r) => `STRIPE_${r.tier.toUpperCase()}_PRICE_ID=${r.priceId}`);

    res.status(200).json({
      success: true,
      products: results,
      envVars: envVars,
      message: 'Add these to your .env file',
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Stripe setup error:', error);
    res.status(500).json({
      success: false, error: error.message,
      type: error.type,
    });
  }
}
