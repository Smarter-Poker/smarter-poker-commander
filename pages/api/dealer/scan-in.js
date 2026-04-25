/**
 * Dealer Scan-In API
 * POST /api/commander/dealer/scan-in
 * 
 * When a dealer scans their member card QR at a table tablet,
 * this endpoint assigns them to that table.
 * 
 * - Looks up the member by qr_code
 * - Verifies member_type = 'employee'
 * - Ends any current dealer rotation for this table
 * - Creates a new commander_dealer_rotations row
 * 
 * Body: { qr_code, table_number, venue_id }
 * 
 * No auth guard — tablet is unauthenticated (same as player view).
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
/** Escape SQL LIKE wildcards */
function escapeIlike(s) { return (s || '').replace(/[%_\\]/g, c => '\\' + c); }

export default async function handler(req, res) {
  try {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          if (!applyRateLimit(req, res, LIMITS.write)) return;
      }

      if (req.method !== 'POST') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      const { qr_code, table_number, venue_id } = req.body;

      if (!qr_code || !table_number) {
          return res.status(400).json({
              success: false,
              error: 'qr_code and table_number are required'
          });
      }

      try {
          // Extract QR code if it's a URL
          let lookupCode = qr_code;
          if (qr_code.includes('/check-in/')) {
              const parts = qr_code.split('/');
              lookupCode = parts[parts.length - 1];
          }

          // Look up member by QR code first, then by member number
          let member = null;

          const { data: byQr, error: qrError } = await getSupabase()
              .from('commander_members')
              .select('*')
              .eq('qr_code', lookupCode)
              .limit(1);

          if (qrError) throw qrError;
          member = byQr?.[0];

          // If not found by QR code, try member number
          if (!member) {
              let mnQuery = getSupabase()
                  .from('commander_members')
                  .select('*')
                  .eq('member_number', lookupCode)
              if (venue_id) mnQuery = mnQuery.eq('venue_id', venue_id);
              const { data: byMn, error: mnError } = await mnQuery.limit(1);
              if (mnError) throw mnError;
              member = byMn?.[0];
          }

          if (!member) {
              return res.status(404).json({
                  success: false,
                  error: 'Employee not found. QR code not recognized.'
              });
          }

          // Verify this is an employee (dealer/staff), not a player
          if (member.member_type !== 'employee' && member.member_type !== 'admin') {
              return res.status(403).json({
                  success: false,
                  error: 'This card belongs to a player, not an employee. Only employees can scan in as dealer.'
              });
          }

          // Check membership is active
          if (member.membership_status === 'suspended' || member.membership_status === 'banned') {
              return res.status(403).json({
                  success: false,
                  error: 'Employee account is suspended or banned.'
              });
          }

          const dealerName = `${member.first_name} ${member.last_name}`.trim();
          const tableNum = parseInt(table_number);
          if (isNaN(tableNum)) {
              return res.status(400).json({ success: false, error: 'table_number must be a number' });
          }
          const venueId = venue_id || member.venue_id;

          // Resolve the dealer record in commander_dealers (FK target)
          // Try to find by name match or staff linkage
          let dealerId = null;
          const { data: existingDealer } = await getSupabase()
              .from('commander_dealers')
              .select('id')
              .eq('venue_id', venueId)
              .ilike('name', `%${member.first_name}%${member.last_name}%`)
              .limit(1);

          if (existingDealer?.[0]) {
              dealerId = existingDealer[0].id;
          } else {
              // Also try matching by first + last name parts
              const { data: nameMatch } = await getSupabase()
                  .from('commander_dealers')
                  .select('id, name')
                  .eq('venue_id', venueId)

              const matched = (nameMatch || []).find(d => {
                  const dName = (d.name || '').toLowerCase();
                  return dName.includes(member.first_name.toLowerCase()) &&
                      dName.includes(member.last_name.toLowerCase());
              });

              if (matched) {
                  dealerId = matched.id;
              } else {
                  // Create a new commander_dealers record
                  const { data: newDealer, error: createErr } = await getSupabase()
                      .from('commander_dealers')
                      .insert({
                          venue_id: venueId,
                          name: dealerName,
                          employee_id: member.member_number || `DLR-${Date.now()}`,
                          is_active: true,
                      })
                      .select('id')
                      .maybeSingle();

                  if (createErr) {
                      console.warn('Failed to create dealer record:', createErr.message);
                      // Try without employee_id
                      const { data: nd2 } = await getSupabase()
                          .from('commander_dealers')
                          .insert({
                              venue_id: venueId,
                              name: dealerName,
                              is_active: true,
                          })
                          .select('id')
                          .maybeSingle();
                      dealerId = nd2?.id;
                  } else {
                      dealerId = newDealer.id;
                  }
              }
          }

          if (!dealerId) {
              return res.status(500).json({ success: false, error: 'Could not resolve dealer record' });
          }

          // End any current dealer rotation for this table
          await getSupabase()
              .from('commander_dealer_rotations')
              .update({ ended_at: new Date().toISOString() })
              .eq('venue_id', venueId)
              .eq('table_number', tableNum)
              .is('ended_at', null);

          // Also end any current rotation for this dealer (if they were at another table)
          await getSupabase()
              .from('commander_dealer_rotations')
              .update({ ended_at: new Date().toISOString() })
              .eq('dealer_id', dealerId)
              .is('ended_at', null);

          // Create new rotation assignment
          const { data: rotation, error: rotationError } = await getSupabase()
              .from('commander_dealer_rotations')
              .insert({
                  venue_id: venueId,
                  dealer_id: dealerId,
                  dealer_name: dealerName,
                  table_number: tableNum,
                  rotation_date: new Date().toISOString().split('T')[0],
                  started_at: new Date().toISOString()
              })
              .select()
              .maybeSingle();

          if (rotationError) throw rotationError;

          // Update member's last visit
          await getSupabase()
              .from('commander_members')
              .update({
                  last_visit: new Date().toISOString(),
                  updated_at: new Date().toISOString()
              })
              .eq('id', member.id);

          return res.status(200).json({
              success: true,
              data: {
                  dealer: {
                      id: member.id,
                      first_name: member.first_name,
                      last_name: member.last_name,
                      name: dealerName,
                      member_number: member.member_number,
                      photo_url: member.photo_url,
                      member_type: member.member_type,
                      started_at: rotation.started_at
                  },
                  rotation_id: rotation.id,
                  table_number: tableNum,
                  started_at: rotation.started_at,
                  message: `${dealerName} is now dealing at Table ${tableNum}`
              }
          });
      } catch (err) {
          console.warn('Dealer scan-in error:', err);
          return res.status(500).json({ success: false, error: 'Internal server error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
