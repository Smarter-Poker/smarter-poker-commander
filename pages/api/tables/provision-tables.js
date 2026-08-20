/**
 * Provision Tables API
 * POST /api/commander/tables/provision-tables
 *
 * Creates missing commander_tables rows for a venue.
 * Used to retroactively add tables for venues that registered
 * before auto-provisioning was implemented.
 *
 * Body: { venue_id, count, max_seats? }
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
import { logAction } from '../../../src/lib/commander/audit';
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

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          if (!applyRateLimit(req, res, LIMITS.write)) return;
      }

      if (req.method !== 'POST') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      // Auth guard
      const _auth = await guardWriteStaff(req, res);
      if (!_auth) return;

      const { venue_id, count, max_seats = 9 } = req.body;

      if (!venue_id) {
          return res.status(400).json({ success: false, error: 'venue_id is required' });
      }
      if (!count || count < 1 || count > 200) {
          return res.status(400).json({ success: false, error: 'count must be between 1 and 200' });
      }

      try {
          // 1. Verify venue exists
          const { data: venue, error: venueErr } = await getSupabase()
              .from('poker_venues')
              .select('id, name')
              .eq('id', venue_id)
              .maybeSingle();

          if (venueErr || !venue) {
              return res.status(404).json({ success: false, error: 'Venue not found' });
          }

          // 2. Get existing tables
          const { data: existingTables } = await getSupabase()
              .from('commander_tables')
              .select('table_number')
              .eq('venue_id', venue_id)

          const existingNumbers = new Set((existingTables || []).map(t => t.table_number));

          // 3. Create missing tables
          const tablesToInsert = [];
          for (let i = 1; i <= count; i++) {
              if (!existingNumbers.has(i)) {
                  tablesToInsert.push({
                      venue_id,
                      table_number: i,
                      table_name: `Table ${i}`,
                      max_seats: parseInt(max_seats) || 9,
                      status: 'available',
                  });
              }
          }

          if (tablesToInsert.length === 0) {
              return res.status(200).json({
                  success: true,
                  message: `All ${count} tables already exist for ${venue.name}`,
                  created: 0,
                  existing: existingNumbers.size,
              });
          }

          const { error: insertErr } = await getSupabase()
              .from('commander_tables')
              .insert(tablesToInsert);

          if (insertErr) {
              console.warn('Table provision insert error:', insertErr);
              return res.status(500).json({ success: false, error: 'Failed to create tables: ' + insertErr.message });
          }

          // 4. Update poker_venues.poker_tables count
          await getSupabase()
              .from('poker_venues')
              .update({ poker_tables: count })
              .eq('id', venue_id);

          // Audit log
          if (_auth && _auth.id) {
              await logAction({ action: 'provision_tables', category: 'table' }, {
                  venueId: venue_id,
                  staffId: _auth.id,
                  targetId: venue_id,
                  targetType: 'poker_venues',
                  targetName: venue.name,
                  metadata: { count_requested: count, tables_created: tablesToInsert.length },
                  req
              });
          }

          return res.status(200).json({
              success: true,
              message: `Provisioned ${tablesToInsert.length} tables for ${venue.name}`,
              created: tablesToInsert.length,
              existing: existingNumbers.size,
              total: existingNumbers.size + tablesToInsert.length,
          });

      } catch (err) {
          console.warn('Provision tables error:', err);
          return res.status(500).json({ success: false, error: 'Internal server error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
