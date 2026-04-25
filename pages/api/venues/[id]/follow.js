/**
 * Venue Follow API
 * POST /api/commander/venues/[id]/follow - Follow a venue
 * DELETE /api/commander/venues/[id]/follow - Unfollow a venue
 * GET /api/commander/venues/[id]/follow - Check follow status
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';

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

    if (req.method !== 'GET') { const _u = await guardUser(req, res); if (!_u) return; }

    try {
      const { id } = req.query;
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

      if (req.method === 'GET') {
        const { data, error } = await getSupabase()
          .from('commander_venue_followers')
          .select('*')
          .eq('venue_id', id)
          .eq('user_id', user.id)
          .maybeSingle();

        return res.status(200).json({
          success: true,
          data: {
            is_following: !!data,
            follow: data || null
          }
        });
      }

      if (req.method === 'POST') {
        const { notify_posts = true, notify_events = true, notify_promotions = true, notify_tournaments = true } = req.body || {};

        // Check if already following
        const { data: existing } = await getSupabase()
          .from('commander_venue_followers')
          .select('id')
          .eq('venue_id', id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (existing) {
          return res.status(200).json({
            success: true,
            data: { message: 'Already following' }
          });
        }

        const { data, error } = await getSupabase()
          .from('commander_venue_followers')
          .insert({
            venue_id: id,
            user_id: user.id,
            notify_posts,
            notify_events,
            notify_promotions,
            notify_tournaments
          })
          .select()
          .maybeSingle();

        if (error) throw error;

        return res.status(201).json({
          success: true,
          data: { follow: data }
        });
      }

      if (req.method === 'DELETE') {
        const { error } = await getSupabase()
          .from('commander_venue_followers')
          .delete()
          .eq('venue_id', id)
          .eq('user_id', user.id);

        if (error) throw error;

        return res.status(200).json({
          success: true,
          data: { unfollowed: true }
        });
      }

      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    } catch (error) {
      console.warn('Venue follow API error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to process request' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
