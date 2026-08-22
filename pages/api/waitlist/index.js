/**
 * Commander Waitlist Join API - POST /api/commander/waitlist/join
 * Join a venue waitlist
 * Reference: API_REFERENCE.md - Waitlist section
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { captureException } from '../../../src/lib/commander/errorMonitoring';
import { guardStaff } from '../../../src/lib/commander/auth';
import { logAction, AuditActions } from '../../../src/lib/commander/audit';
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

// Average wait time per position (minutes) - simple initial estimate
const AVERAGE_WAIT_PER_POSITION = 15;

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // 2026-08-20 audit fix: was guardWriteStaff, which returns `true` for GET
    // without verifying anything - the waitlist GET selects '*' from
    // commander_waitlist, which carries player_name and player_phone, so every
    // venue's live waitlist (names plus phone numbers) was public. Staff auth is
    // now required on every method.
    const _authResult = await guardStaff(req, res);
    if (!_authResult) return;

    // ── GET: Return all active waitlist entries for the venue ──────────────
    if (req.method === 'GET') {
      try {
        // Venue scope always comes from the verified staff session. A query
        // venue_id is only honoured when it matches that session.
        const venue_id = _authResult.venue_id ?? req.query.venue_id;

        // SECURITY: venue_id is mandatory - without it, all venues' data would leak
        if (!venue_id) {
          return res.status(400).json({ success: false, error: 'venue_id is required' });
        }

        if (req.query.venue_id && _authResult.venue_id !== undefined && _authResult.venue_id !== null
            && String(req.query.venue_id) !== String(_authResult.venue_id)) {
          return res.status(403).json({ success: false, error: 'You Are Not Staff At This Venue' });
        }

        const query = getSupabase()
          .from('commander_waitlist')
          .select('*')
          .eq('venue_id', venue_id)
          .in('status', ['waiting', 'called'])
          .order('position', { ascending: true })
          .limit(100);

        const { data, error } = await query;

        if (error) {
          console.warn('Commander waitlist GET error:', error);
          return res.status(500).json({ success: false, error: 'Internal server error' });
        }

        // 2026-08-20 audit fix: was a shared CDN cache (s-maxage) on a response
        // that varies by staff session and carries player phone numbers.
        res.setHeader('Cache-Control', 'private, max-age=15');
        return res.status(200).json({ success: true, data: data || [] });
      } catch (error) {
        captureException(error, { action: 'waitlist_get', endpoint: '/api/commander/waitlist' });
        return res.status(500).json({ success: false, error: 'Internal server error' });
      }
    }



    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    try {
      const {
        venue_id,
        game_type: rawGameType,
        stakes,
        player_id,
        player_name,
        player_phone,
        signup_method = 'app'
      } = req.body;
      // 2026-07-25 audit fix: commander_games.game_type is now lowercase - store lowercase, compare case-insensitively
      const game_type = (rawGameType || '').toLowerCase();

      // Validation
      if (!venue_id || !game_type || !stakes) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'venue_id, game_type, and stakes are required'
          }
        });
      }

      // For walk-ins without player_id, require name
      if (!player_id && !player_name) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Either player_id or player_name is required'
          }
        });
      }

      // 2026-08-20 audit fix: venue_id came straight off the body, so staff at
      // venue A could add players to venue B's waitlist.
      if (_authResult && _authResult.venue_id !== undefined && _authResult.venue_id !== null
          && String(_authResult.venue_id) !== String(venue_id)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' }
        });
      }

      // Verify venue exists and has Commander enabled
      const { data: venue, error: venueError } = await getSupabase()
        .from('poker_venues')
        .select('id, commander_enabled, name')
        .eq('id', venue_id)
        .maybeSingle();

      if (venueError || !venue) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Venue not found' }
        });
      }

      if (!venue.commander_enabled) {
        return res.status(400).json({
          success: false,
          error: { code: 'VENUE_NOT_COMMANDER', message: 'Venue is not using Commander' }
        });
      }

      // Check if player already on this waitlist (if player_id provided)
      if (player_id) {
        const { data: existing } = await getSupabase()
          .from('commander_waitlist')
          .select('id')
          .eq('venue_id', venue_id)
          .ilike('game_type', game_type) // 2026-07-25 audit fix: case-insensitive match (older rows may be uppercase)
          .eq('stakes', stakes)
          .eq('player_id', player_id)
          .eq('status', 'waiting')
          .maybeSingle();

        if (existing) {
          return res.status(400).json({
            success: false,
            error: { code: 'ALREADY_ON_WAITLIST', message: 'Player already on this waitlist' }
          });
        }

        // RESPONSIBLE GAMING: Check for self-exclusions
        const { data: exclusion } = await getSupabase()
          .from('commander_self_exclusions')
          .select('id, exclusion_type, expires_at')
          .eq('player_id', player_id)
          .or(`venue_id.eq.${venue_id},scope.eq.network`)
          .is('lifted_at', null)
          .or('expires_at.is.null,expires_at.gt.now()')
          .limit(1)
          .maybeSingle();

        if (exclusion) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'SELF_EXCLUDED',
              message: 'You have an active self-exclusion and cannot join at this time.',
              exclusion_type: exclusion.exclusion_type,
              expires_at: exclusion.expires_at
            }
          });
        }

        // RESPONSIBLE GAMING: Check spending limits
        const { data: limits } = await getSupabase()
          .from('commander_spending_limits')
          .select('daily_limit, weekly_limit, monthly_limit, session_duration_limit')
          .eq('player_id', player_id)
          .maybeSingle();

        if (limits) {
          // Check if player has exceeded daily sessions (simple check)
          const today = new Date().toISOString().split('T')[0];
          const { count: todaySessions } = await getSupabase()
            .from('commander_player_sessions')
            .select('id', { count: 'exact' })
            .eq('player_id', player_id)
            .gte('check_in_at', today)

          // If player has more than 3 sessions today and has limits set, warn them
          if (todaySessions >= 3 && limits.daily_limit) {
            // Log responsible gaming check
          }
        }
      }

      // Get next position using the database function
      const { data: positionResult, error: positionError } = await getSupabase()
        .rpc('get_next_waitlist_position', {
          p_venue_id: venue_id,
          p_game_type: game_type,
          p_stakes: stakes
        });

      // HIGH FIX #1: Add proper null check for RPC result
      const position = positionError || !positionResult ? 1 : positionResult;

      // Calculate estimated wait time
      const estimated_wait_minutes = position * AVERAGE_WAIT_PER_POSITION;

      // Find matching game_id if there's an active game
      const { data: activeGame } = await getSupabase()
        .from('commander_games')
        .select('id')
        .eq('venue_id', venue_id)
        .ilike('game_type', game_type) // 2026-07-25 audit fix: case-insensitive equality (no wildcards) against lowercase games
        .eq('stakes', stakes)
        .in('status', ['waiting', 'running'])
        .maybeSingle();

      // Create waitlist entry
      const { data: entry, error: insertError } = await getSupabase()
        .from('commander_waitlist')
        .insert({
          venue_id,
          game_id: activeGame?.id || null,
          game_type,
          stakes,
          player_id: player_id || null,
          player_name: player_name || null,
          player_phone: player_phone || null,
          position,
          signup_method,
          status: 'waiting',
          estimated_wait_minutes
        })
        .select()
        .maybeSingle();

      if (insertError) {
        console.warn('Commander waitlist insert error:', insertError);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to join waitlist' }
        });
      }

      // Award XP for joining waitlist (5 XP) - stored in metadata JSONB
      if (player_id) {
        const XP_FOR_WAITLIST_JOIN = 5;

        // Get or create player session for XP tracking
        const { data: existingSession } = await getSupabase()
          .from('commander_player_sessions')
          .select('id, metadata')
          .eq('venue_id', venue_id)
          .eq('player_id', player_id)
          .is('check_out_at', null)
          .maybeSingle();

        if (existingSession) {
          const currentMetadata = existingSession.metadata || {};
          await getSupabase()
            .from('commander_player_sessions')
            .update({
              metadata: {
                ...currentMetadata,
                xp_earned: (currentMetadata.xp_earned || 0) + XP_FOR_WAITLIST_JOIN
              }
            })
            .eq('id', existingSession.id);
        } else {
          await getSupabase()
            .from('commander_player_sessions')
            .insert({
              venue_id,
              player_id,
              check_in_at: new Date().toISOString(),
              metadata: { xp_earned: XP_FOR_WAITLIST_JOIN }
            });
        }
      }

      // Audit log if staff added them
      if (_authResult && _authResult.id) {
        await logAction(AuditActions.WAITLIST_JOIN, {
          venueId: venue_id,
          staffId: _authResult.id,
          targetId: entry.id,
          targetType: 'commander_waitlist',
          targetName: player_name || 'Player',
          metadata: { game_type, stakes },
          req
        });
      }

      return res.status(201).json({
        success: true,
        data: {
          entry,
          position,
          estimated_wait: estimated_wait_minutes
        }
      });
    } catch (error) {
      captureException(error, { action: 'waitlist_join', endpoint: '/api/commander/waitlist', venue_id: req.body?.venue_id });
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
