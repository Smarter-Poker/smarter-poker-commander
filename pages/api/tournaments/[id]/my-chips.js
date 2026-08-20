/**
 * Player Self-Update Chip Count API
 * POST /api/commander/tournaments/[id]/my-chips
 * 
 * Allows authenticated players to update their own chip count during a tournament.
 * Inspired by WSOP+ player self-report feature.
 * 
 * Security: Only the player themselves can update their own chips.
 * Validation: Tournament must be running, player must be active in the tournament.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { requireAuth } from '../../../../src/lib/commander/auth';
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

// Auth: USER - requires authenticated user
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }


    // Auth guard
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      const _staff = await requireAuth(req, res);
      if (!_staff) return;
    }

      if (req.method !== 'POST') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      const { id: tournamentId } = req.query;

      // Authenticate player
      const authHeader = req.headers.authorization;
      if (!authHeader) {
          return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;

      if (authError || !user) {
          return res.status(401).json({ success: false, error: 'Invalid or expired token' });
      }

      try {
          const { chips } = req.body;

          if (chips === undefined || chips === null || isNaN(Number(chips)) || Number(chips) < 0) {
              return res.status(400).json({ success: false, error: 'Valid chip count required' });
          }

          // Verify tournament exists and is running
          const { data: tournament, error: tErr } = await getSupabase()
              .from('commander_tournaments')
              .select('id, status, name')
              .eq('id', tournamentId)
              .maybeSingle();

          if (tErr || !tournament) {
              return res.status(404).json({ success: false, error: 'Tournament not found' });
          }

          if (!['running', 'break', 'final_table'].includes(tournament.status)) {
              return res.status(400).json({ success: false, error: 'Tournament is not currently running' });
          }

          // Find the player's active entry
          const { data: entry, error: eErr } = await getSupabase()
              .from('commander_tournament_entries')
              .select('id, player_id, current_chips, status, metadata')
              .eq('tournament_id', tournamentId)
              .eq('player_id', user.id)
              .in('status', ['active', 'seated', 'registered'])
              .maybeSingle();

          if (eErr || !entry) {
              return res.status(404).json({ success: false, error: 'You are not registered in this tournament' });
          }

          // Update chip count
          const previousChips = entry.current_chips || 0;
          const newChips = Math.floor(Number(chips));

          const { error: updateErr } = await getSupabase()
              .from('commander_tournament_entries')
              .update({
                  current_chips: newChips,
                  metadata: {
                      ...(entry.metadata || {}),
                      last_self_reported: new Date().toISOString(),
                      previous_chips: previousChips,
                      reported_by: 'player'
                  }
              })
              .eq('id', entry.id);

          if (updateErr) {
              console.warn('Update chips error:', updateErr);
              return res.status(500).json({ success: false, error: 'Failed to update chips' });
          }

          return res.status(200).json({
              success: true,
              data: {
                  previous_chips: previousChips,
                  current_chips: newChips,
                  tournament_name: tournament.name
              }
          });
      } catch (err) {
          console.warn('My chips error:', err);
          return res.status(500).json({ success: false, error: 'Internal server error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
