/**
 * Server-side subscription check for Commander login
 * Uses service role key to bypass RLS
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { signStaffSession } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { checkMemoryRateLimit } from '../../src/lib/commander/rateLimit';
import { reportApiError } from '../../src/lib/apiErrorHandler';
// Note: No auth guard - this route is called during login BEFORE staff session exists.
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

    // IP rate limit (abuse prevention).
    // 2026-09-03: raised from 5/min. This route is now also the silent
    // self-heal for stale staff sessions (commanderFetch 401 retry, dashboard
    // guard, club switcher), and a whole poker room's phones share one carrier
    // NAT address - at 5/min the second manager to open the app on their
    // phone was getting 429 => "No active subscription". Still a hard cap;
    // the per-token identity limit below is what actually protects the data.
    const fwd = req.headers['x-forwarded-for'];
    const ip = fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress || '0';
    const rl = checkMemoryRateLimit(`chksub:${ip}`, 40, 60000);
    if (!rl.allowed) { return res.status(429).json({ error: 'Too many requests' }); }

      if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
      }

      // BUG #260 FIX: Require JWT auth - previously accepted arbitrary userId from body,
      // allowing anyone to look up any user's subscription details and venue info.
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
          return res.status(401).json({ error: 'Authentication required' });
      }

      // Per-identity limit: one user cannot burn the whole IP budget, and a
      // stolen token cannot be used to enumerate quickly.
      const tokenRl = checkMemoryRateLimit(`chksub:tok:${token.slice(-32)}`, 12, 60000);
      if (!tokenRl.allowed) { return res.status(429).json({ error: 'Too many requests' }); }

      const { data: authData, error: authErr } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (authErr || !user) {
          return res.status(401).json({ error: 'Invalid token' });
      }

      // Always use the authenticated user's ID, ignore body.userId
      const userId = user.id;

      try {
          // Multi-club support (2026-08-19): a user may own several active
          // subscriptions. If the client passes preferred_venue_id (the venue
          // they last switched to via the hamburger switcher), log them into
          // THAT venue - still filtered by owner_id, so it can never resolve
          // to a venue they don't own. Otherwise fall back to the newest sub.
          const preferredVenueId = req.body?.preferred_venue_id;

          let query = getSupabase()
              .from('commander_subscriptions')
              .select('*, venue:poker_venues(*)')
              .eq('owner_id', userId)
              .in('status', ['active', 'trialing']);
          if (preferredVenueId !== undefined && preferredVenueId !== null && preferredVenueId !== '') {
              query = query.eq('venue_id', preferredVenueId);
          }
          let { data: subs, error } = await query
              .order('created_at', { ascending: false })
              .limit(1);

          if (error) {
              console.warn('Subscription check error:', error.message);
              return res.status(500).json({ error: 'Failed to check subscription' });
          }

          // Preferred venue no longer valid (sub canceled, etc.) - fall back
          if (!subs?.length && preferredVenueId) {
              const fallback = await getSupabase()
                  .from('commander_subscriptions')
                  .select('*, venue:poker_venues(*)')
                  .eq('owner_id', userId)
                  .in('status', ['active', 'trialing'])
                  .order('created_at', { ascending: false })
                  .limit(1);
              if (fallback.error) {
                  console.warn('Subscription check error:', fallback.error.message);
                  return res.status(500).json({ error: 'Failed to check subscription' });
              }
              subs = fallback.data;
          }

          const subscription = subs?.[0] || null;

          if (!subscription) {
              return res.status(404).json({ error: 'No active subscription found' });
          }

          // 2026-07-25 audit fix: issue the HMAC-signed owner staff session
          // here (the only server round-trip during owner login). login.js
          // stores this as `commander_staff`; unsigned sessions are rejected
          // by verifyStaffSession.
          const staff_session = signStaffSession({
              user_id: userId,
              venue_id: subscription.venue_id,
              role: 'owner',
          });

          return res.status(200).json({ subscription, staff_session });
      } catch (err) {
          console.warn('check-subscription error:', err);
          return res.status(500).json({ error: 'Internal server error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
