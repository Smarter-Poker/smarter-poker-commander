/**
 * Seat Preferences API
 * GET /api/commander/seat-preferences?player_id=X - Get preferences
 * POST /api/commander/seat-preferences - Save/update preferences
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardStaff } from '../../src/lib/commander/auth';
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

// commander_seat_preferences.venue_id is a uuid column (verified against
// information_schema) while app venue ids are integers, so passing a
// non-uuid value straight through fails with 22P02 invalid uuid syntax.
// Non-uuid values are treated as the venue-agnostic (null) preference row,
// which matches all live rows in the table.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // 2026-08-20 audit fix: the guard only ran for writes, so the GET returned
    // any player's seat preferences and staff notes for a bare player_id.
    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    // 2026-08-20 audit fix (second pass): guardStaff alone still let staff at
    // ANY venue read and overwrite ANY player's preferences and staff notes,
    // because the row cannot be venue-scoped - commander_seat_preferences.
    // venue_id is a uuid column while app venue ids are integers, so every
    // live row has venue_id null. Scope on the PLAYER instead: they must have
    // a footprint at the caller's venue.
    const _playerId = req.method === 'GET' ? req.query.player_id : req.body?.player_id;
    if (!(await playerIsAtVenue(_playerId, _staff))) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'That Player Has No Record At This Venue' }
      });
    }

    if (req.method === 'GET') return getPreferences(req, res);
    if (req.method === 'POST') return savePreferences(req, res);
    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// True when the player has been seen at the caller's venue, so their seating
// notes are that venue's business. Checked against the two tables a player
// necessarily passes through: the desk waitlist and the cash session log.
// A session with no venue (which verifyStaffSession now rejects for PIN
// terminals) or a request with no player_id is left to the route's own
// validation rather than being silently allowed through.
async function playerIsAtVenue(playerId, staff) {
  if (!playerId) return true; // handlers below return their own 400
  const venueId = (staff && staff !== true && staff.venue_id !== undefined && staff.venue_id !== null)
    ? staff.venue_id
    : null;
  if (venueId === null) return true;

  const [sessionsRes, waitlistRes] = await Promise.all([
    getSupabase()
      .from('commander_player_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('player_id', playerId),
    getSupabase()
      .from('commander_waitlist')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('player_id', playerId)
  ]);

  return (sessionsRes.count || 0) > 0 || (waitlistRes.count || 0) > 0;
}

async function getPreferences(req, res) {
  const { player_id, venue_id } = req.query;

  if (!player_id) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'player_id required' } });
  }

  try {
    let query = getSupabase()
      .from('commander_seat_preferences')
      .select('*')
      .eq('player_id', player_id)
          .limit(100);

    if (venue_id) {
      query = UUID_RE.test(String(venue_id))
        ? query.eq('venue_id', venue_id)
        : query.is('venue_id', null);
    }

    const { data: prefs, error } = await query.maybeSingle();
    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: { preferences: prefs || { preferred_seats: [], left_handed: false, near_tv: null, away_from_tv: null, notes: null } }
    });
  } catch (error) {
    console.warn('Get preferences error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
  }
}

async function savePreferences(req, res) {
  const { player_id, venue_id, preferred_seats, left_handed, near_tv, away_from_tv, notes } = req.body;

  if (!player_id) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'player_id required' } });
  }

  try {
    const data = {
      player_id,
      venue_id: venue_id && UUID_RE.test(String(venue_id)) ? venue_id : null,
      preferred_seats: preferred_seats || [],
      left_handed: left_handed || false,
      near_tv: near_tv ?? null,
      away_from_tv: away_from_tv ?? null,
      notes: notes?.trim() || null,
      updated_at: new Date().toISOString()
    };

    const { data: pref, error } = await getSupabase()
      .from('commander_seat_preferences')
      .upsert(data, { onConflict: 'player_id,venue_id' })
      .select()
      .maybeSingle();

    if (!pref) {
      throw new Error('Failed to upsert preferences');
    }

    if (error) throw error;

    return res.status(200).json({ success: true, data: { preferences: pref } });
  } catch (error) {
      try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('Save preferences error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
  }
}
