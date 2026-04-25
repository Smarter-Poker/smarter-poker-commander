/**
 * Player Arrival API — POST /api/commander/waitlist/arrive
 * Allows authenticated players to signal arrival at the venue.
 * Updates checked_in_at on ALL their active waitlist entries for the venue.
 *
 * Auth: Bearer token (player JWT) — only updates entries belonging to the caller.
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
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

// Anon client for JWT verification
const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    if (!applyRateLimit(req, res, LIMITS.write)) return;

    // === Auth: Extract and verify JWT ===
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Please sign in to signal arrival' }
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    let accessToken = token;
    try {
      const parsed = JSON.parse(token);
      if (parsed.access_token) accessToken = parsed.access_token;
    } catch { /* raw JWT */ }

    const { data: authData, error: authError } = await supabaseAnon.auth.getUser(accessToken);
    const user = authData?.user;
    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_INVALID', message: 'Invalid or expired session' }
      });
    }

    const { venue_id } = req.body;
    if (!venue_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_VENUE', message: 'venue_id is required' }
      });
    }

    // Update ALL active entries for this player at this venue
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await getSupabase()
      .from('commander_waitlist')
      .update({ checked_in_at: now })
      .eq('player_id', user.id)
      .eq('venue_id', venue_id)
      .in('status', ['waiting', 'called'])
      .is('checked_in_at', null)
      .select('id, game_type, stakes, status');

    if (updateError) {
      console.warn('[arrive] Update error:', updateError);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to update arrival status' }
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        arrived: true,
        entries_updated: updated?.length || 0,
        checked_in_at: now
      }
    });

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[arrive] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
}
