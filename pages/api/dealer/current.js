/**
 * Current Table Dealer API
 * GET /api/commander/dealer/current?table=X&venue_id=Y
 * 
 * Returns the current dealer assigned to a specific table.
 * Used by the table tablet display to show the active dealer.
 * 
 * No auth required - tablet is unauthenticated.
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

export default async function handler(req, res) {
  try {
      if (!applyRateLimit(req, res, LIMITS.read)) return;

      if (req.method !== 'GET') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      const { table, venue_id } = req.query;

      if (!table) {
          return res.status(400).json({ success: false, error: 'table is required' });
      }

      try {
          let query = getSupabase()
              .from('commander_dealer_rotations')
              .select('id, dealer_id, dealer_name, table_number, started_at')
              .eq('table_number', parseInt(table))
              .is('ended_at', null)
              .order('started_at', { ascending: false })
              .limit(1);

          if (venue_id) {
              query = query.eq('venue_id', venue_id);
          }

          const { data, error } = await query;

          if (error) throw error;

          const rotation = data?.[0] || null;

          if (!rotation) {
              return res.status(200).json({
                  success: true,
                  data: { dealer: null, message: 'No dealer assigned' }
              });
          }

          // Get dealer member details if available
          let dealerDetails = null;
          if (rotation.dealer_id) {
              const { data: dealerRow } = await getSupabase()
                  .from('commander_dealers')
                  .select('id, name, employee_id, skill_level')
                  .eq('id', rotation.dealer_id)
                  .maybeSingle();
              dealerDetails = dealerRow;
          }

          return res.status(200).json({
              success: true,
              data: {
                  dealer: {
                      id: rotation.dealer_id,
                      name: rotation.dealer_name || dealerDetails?.name || null,
                      employee_id: dealerDetails?.employee_id || null,
                      skill_level: dealerDetails?.skill_level || null,
                      started_at: rotation.started_at,
                      rotation_id: rotation.id
                  }
              }
          });
      } catch (err) {
          console.warn('Get current dealer error:', err);
          return res.status(500).json({ success: false, error: 'Internal server error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
