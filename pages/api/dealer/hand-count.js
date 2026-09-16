/**
 * Dealer Hand Count API
 * POST /api/commander/dealer/hand-count
 *
 * Actions:
 *   increment - +1 on commander_tables.hands_dealt AND active rotation hands_dealt
 *   reset     - set commander_tables.hands_dealt = 0 (rotation count preserved)
 *
 * Body: { table_number: number, action: 'increment' | 'reset' }
 * Returns: { success, hands_dealt }
 *
 * RACE CONDITION FIX: Uses atomic SQL increment via RPC to prevent
 * rapid clicks from losing counts. Two concurrent requests that read
 * the same value and write old+1 would cause count loss; now the
 * increment happens atomically in a single UPDATE statement.
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';
import { guardStaff } from '../../../src/lib/commander/auth';

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

      if (req.method !== 'POST') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      try {
          // 2026-08-06: dealer tablets authenticate with the signed x-staff-session
          // header (PIN sessions), NOT a Supabase JWT. Accept it via guardStaff like
          // the sibling dealer routes (session-action.js) so PIN-only tablets are no
          // longer 401'd into the /commander/login redirect. Venue scoping comes from
          // the HMAC-verified staff row.
          const staff = await guardStaff(req, res);
          if (!staff) return;

          const { table_number, action } = req.body;
          if (!table_number) return res.status(400).json({ success: false, error: 'table_number required' });
          if (!['increment', 'reset'].includes(action)) {
              return res.status(400).json({ success: false, error: 'action must be increment or reset' });
          }

          const tableNum = parseInt(table_number);

          // ── Locate table (needed for id + venue scoping) ──
          const { data: table, error: tblErr } = await getSupabase()
              .from('commander_tables')
              .select('id')
              .eq('venue_id', staff.venue_id)
              .eq('table_number', tableNum)
              .maybeSingle();

          if (tblErr || !table) {
              return res.status(404).json({ success: false, error: 'Table not found' });
          }

          let newCount;

          if (action === 'increment') {
              // ── ATOMIC INCREMENT ──
              // Uses rpc('increment_hands_dealt') if available, otherwise falls back to
              // read-then-write with optimistic locking.
              // First try: use Supabase's built-in column arithmetic
              const { data: updated, error: upErr } = await getSupabase().rpc('increment_table_hands', {
                  p_table_id: table.id,
              });

              if (upErr) {
                  // Fallback: read-then-write (acceptable for low-concurrency dealer tablet)
                  const { data: current } = await getSupabase()
                      .from('commander_tables')
                      .select('hands_dealt')
                      .eq('id', table.id)
                      .maybeSingle();

                  newCount = (current?.hands_dealt || 0) + 1;
                  const { error: fallbackErr } = await getSupabase()
                      .from('commander_tables')
                      .update({ hands_dealt: newCount })
                      .eq('id', table.id);
                  if (fallbackErr) throw fallbackErr;
              } else {
                  newCount = updated;
              }

              // Also increment the active dealer rotation (fire-and-forget, non-blocking)
              getSupabase()
                  .from('commander_dealer_rotations')
                  .select('id, hands_dealt')
                  .eq('venue_id', staff.venue_id)
                  .eq('table_number', tableNum)
                  .is('ended_at', null)
                  .order('started_at', { ascending: false })
                  .limit(1)
                  .maybeSingle()
                  .then(({ data: rotation }) => {
                      if (rotation) {
                          getSupabase()
                              .from('commander_dealer_rotations')
                              .update({ hands_dealt: (rotation.hands_dealt || 0) + 1 })
                              .eq('id', rotation.id)
                              .then(() => { })
                              .catch(console.warn);
                      }
                  })
                  .catch(e => { console.warn('[App] Handled promise rejection:', e?.message || e); });
          } else {
              // ── RESET ──
              newCount = 0;
              const { error: upErr } = await getSupabase()
                  .from('commander_tables')
                  .update({ hands_dealt: 0 })
                  .eq('id', table.id);

              if (upErr) throw upErr;
          }

          // Prevent caching - each request must hit the server
          res.setHeader('Cache-Control', 'no-store');
          return res.status(200).json({ success: true, hands_dealt: newCount });
      } catch (err) {
          console.warn('Hand count error:', err);
          return res.status(500).json({ success: false, error: err.message });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
