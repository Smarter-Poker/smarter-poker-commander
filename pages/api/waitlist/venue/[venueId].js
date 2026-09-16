/**
 * Commander Venue Waitlist API - GET /api/commander/waitlist/venue/:venueId [Public]
 * Get all waitlists at a venue
 * Reference: API_REFERENCE.md - Waitlist section
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Privacy-safe public alias - "First L." from a stored full name, else "Player".
// Never expose the raw player_name (last name) or player_id on the public list.
function publicAlias(name) {
  const n = (name || '').trim();
  if (!n) return 'Player';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const lastInitial = parts[parts.length - 1][0];
  return `${parts[0]} ${lastInitial.toUpperCase()}.`;
}

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' }
      });
    }

    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Venue ID required' }
      });
    }

    try {
      // ═══ Auto-cleanup: delete expired web entries (>1 hour, not checked in) ═══
      try {
        const expiryTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        await getSupabase()
          .from('commander_waitlist')
          .delete()
          .eq('venue_id', venueId)
          .eq('signup_method', 'web')
          .eq('status', 'waiting')
          .is('checked_in_at', null)
          .lt('created_at', expiryTime);
      } catch (cleanupErr) { console.warn('[App] Handled exception:', cleanupErr?.message || cleanupErr); }

      // Get all waiting entries at venue. Sanitized column list - no player_id
      // or player_phone. Ordered by created_at so positions are stable 1..N.
      const { data: entries, error } = await getSupabase()
        .from('commander_waitlist')
        .select('id, game_type, stakes, status, signup_method, call_count, created_at, player_name')
        .eq('venue_id', venueId)
        .in('status', ['waiting', 'called'])
        .order('created_at', { ascending: true })
            .limit(200)

      if (error) {
        console.warn('Commander venue waitlist query error:', error);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to fetch waitlist' }
        });
      }

      // Group by game type and stakes, assigning a 1-based position within each
      // group (entries already sorted by created_at ascending).
      const waitlistMap = {};
      (entries || []).forEach(entry => {
        const key = `${entry.game_type}-${entry.stakes}`;
        if (!waitlistMap[key]) {
          waitlistMap[key] = {
            game_type: entry.game_type,
            stakes: entry.stakes,
            players: [],
            count: 0,
            estimated_wait: 0
          };
        }
        const group = waitlistMap[key];
        group.players.push({
          id: entry.id,
          position: group.players.length + 1,
          alias: publicAlias(entry.player_name),
          status: entry.status,
          signup_method: entry.signup_method,
          call_count: entry.call_count,
          created_at: entry.created_at
        });
        group.count++;
      });

      // Calculate estimated wait for each waitlist
      const waitlists = Object.values(waitlistMap || {}).map(wl => {
        // Estimate: number waiting in the group * 15 minutes
        return {
          ...wl,
          estimated_wait: wl.count * 15
        };
      });

      return res.status(200).json({
        success: true,
        data: { waitlists }
      });
    } catch (error) {
      console.warn('Commander venue waitlist API error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
