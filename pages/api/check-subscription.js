/**
 * Server-side subscription check for Commander login
 * Uses service role key to bypass RLS
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { checkMemoryRateLimit } from '../../src/lib/commander/rateLimit';
import { reportApiError } from '../../src/lib/sentryWrap';
// Note: No auth guard — this route is called during login BEFORE staff session exists.
// It has its own inline JWT validation below.

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

    // IP rate limit: 5 sub checks per minute (abuse prevention)
    const fwd = req.headers['x-forwarded-for'];
    const ip = fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress || '0';
    const rl = checkMemoryRateLimit(`chksub:${ip}`, 5, 60000);
    if (!rl.allowed) { return res.status(429).json({ error: 'Too many requests' }); }

      if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
      }

      // BUG #260 FIX: Require JWT auth — previously accepted arbitrary userId from body,
      // allowing anyone to look up any user's subscription details and venue info.
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
          return res.status(401).json({ error: 'Authentication required' });
      }

      const { data: authData, error: authErr } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (authErr || !user) {
          return res.status(401).json({ error: 'Invalid token' });
      }

      // Always use the authenticated user's ID, ignore body.userId
      const userId = user.id;

      try {
          const { data: subs, error } = await getSupabase()
              .from('commander_subscriptions')
              .select('*, venue:poker_venues(*)')
              .eq('owner_id', userId)
              .in('status', ['active', 'trialing'])
              .order('created_at', { ascending: false })
              .limit(1);

          if (error) {
              console.warn('Subscription check error:', error.message);
              return res.status(500).json({ error: 'Failed to check subscription' });
          }

          const subscription = subs?.[0] || null;

          if (!subscription) {
              return res.status(404).json({ error: 'No active subscription found' });
          }

          return res.status(200).json({ subscription });
      } catch (err) {
          console.warn('check-subscription error:', err);
          return res.status(500).json({ error: 'Internal server error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
