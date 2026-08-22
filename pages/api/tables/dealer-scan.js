/**
 * Dealer Scan-In API
 * POST: Scan QR code to assign dealer to a table/game
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }


    // Auth guard
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      const _staff = await guardWriteStaff(req, res);
      if (!_staff) return;
    }

      if (req.method !== 'POST') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      try {
          const { venue_id, qr_code, table_number, game_id } = req.body;
          if (!venue_id || !qr_code) {
              return res.status(400).json({ success: false, error: 'venue_id and qr_code required' });
          }

          // Look up dealer by QR code
          const { data: staffList } = await getSupabase()
              .from('commander_staff')
              .select('id, display_name, role, venue_id')
              .eq('qr_code', qr_code)
              .eq('venue_id', venue_id)
              .eq('is_active', true)
              .limit(1);

          let staff = staffList?.[0];

          // Fallback: check commander_members QR code
          if (!staff) {
              const { data: memberList } = await getSupabase()
                  .from('commander_members')
                  .select('id')
                  .eq('qr_code', qr_code)
                  .eq('venue_id', venue_id)
                  .limit(1);

              if (memberList?.[0]) {
                  const { data: linkedStaff } = await getSupabase()
                      .from('commander_staff')
                      .select('id, display_name, role, venue_id')
                      .eq('member_id', memberList[0].id)
                      .eq('is_active', true)
                      .limit(1);
                  staff = linkedStaff?.[0];
              }
          }

          if (!staff) {
              return res.status(404).json({ success: false, error: 'Staff member not found for this QR code' });
          }

          if (!['dealer', 'floor', 'manager', 'owner'].includes(staff.role)) {
              return res.status(400).json({ success: false, error: `${staff.display_name} is a ${staff.role}, not a dealer` });
          }

          // Find the game to assign dealer to
          let gameQuery = getSupabase()
              .from('commander_games')
              .select('id, table_id, game_type, stakes, status')
              .eq('venue_id', venue_id)
              .in('status', ['waiting', 'running', 'active'])
                  .limit(100)

          if (game_id) {
              gameQuery = gameQuery.eq('id', game_id);
          } else if (table_number) {
              // commander_games has no table_number - resolve it to a table_id
              const { data: tableRow } = await getSupabase()
                  .from('commander_tables')
                  .select('id')
                  .eq('venue_id', venue_id)
                  .eq('table_number', parseInt(table_number))
                  .maybeSingle();
              if (!tableRow) {
                  return res.status(404).json({ success: false, error: 'Table not found at this venue' });
              }
              gameQuery = gameQuery.eq('table_id', tableRow.id);
          } else {
              return res.status(400).json({ success: false, error: 'table_number or game_id required' });
          }

          const { data: games } = await gameQuery.limit(1);
          const game = games?.[0];

          if (!game) {
              return res.status(404).json({ success: false, error: 'No active game found at this table' });
          }

          // Assign dealer to game
          const { error: updateError } = await getSupabase()
              .from('commander_games')
              .update({ dealer_staff_id: staff.id })
              .eq('id', game.id);

          if (updateError) throw updateError;

          // Resolve table number for the response from the game's table_id
          let resolvedTableNumber = table_number ? parseInt(table_number) : null;
          if (resolvedTableNumber == null && game.table_id) {
              const { data: gameTable } = await getSupabase()
                  .from('commander_tables')
                  .select('table_number')
                  .eq('id', game.table_id)
                  .maybeSingle();
              resolvedTableNumber = gameTable?.table_number ?? null;
          }

          return res.status(200).json({
              success: true,
              data: {
                  dealer_name: staff.display_name,
                  dealer_role: staff.role,
                  table_number: resolvedTableNumber,
                  game_type: game.game_type,
                  stakes: game.stakes,
              }
          });
      } catch (err) {
          console.warn('Dealer scan error:', err);
          return res.status(500).json({ success: false, error: 'Internal server error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
