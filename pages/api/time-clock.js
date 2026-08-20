/**
 * Time Clock API - Staff Clock In/Out
 * POST: Clock in or out via QR code scan
 * GET: List today's time clock entries for a venue
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { guardStaff } from '../../src/lib/commander/auth';
import { reportApiError } from '../../src/lib/sentryWrap';

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


    // 2026-08-20 audit fix: the guard only ran for writes, leaving the GET
    // public - it returns every staff clock-in/out entry plus staff names and
    // roles for any venue_id (an employee timesheet). Staff auth now applies to
    // both methods and the venue comes from the verified session.
    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    const _scopeVenueId = req.method === 'GET' ? req.query.venue_id : req.body?.venue_id;
    if (_scopeVenueId && _staff.venue_id !== undefined && _staff.venue_id !== null
        && String(_staff.venue_id) !== String(_scopeVenueId)) {
      return res.status(403).json({ success: false, error: 'You Are Not Staff At This Venue' });
    }

      if (req.method === 'GET') return handleGet(req, res);
      if (req.method === 'POST') return handlePost(req, res);
      return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handleGet(req, res) {
    try {
        const { venue_id, date } = req.query;
        if (!venue_id) return res.status(400).json({ success: false, error: 'venue_id required' });

        // Default to today
        const targetDate = date ? new Date(date) : new Date();
        const start = new Date(targetDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(targetDate);
        end.setHours(23, 59, 59, 999);

        const { data, error } = await getSupabase()
            .from('commander_time_clock')
            .select('*')
            .eq('venue_id', venue_id)
            .gte('clock_in', start.toISOString())
            .lte('clock_in', end.toISOString())
            .order('clock_in', { ascending: false })
                .limit(100);

        if (error) throw error;

        // Enrich with staff names
        const staffIds = [...new Set((data || []).map(e => e.staff_id))];
        let staffMap = {};
        if (staffIds.length > 0) {
            const { data: staffList } = await getSupabase()
                .from('commander_staff')
                .select('id, display_name, role, qr_code')
                .in('id', staffIds)
                    .limit(100)
            if (staffList) {
                staffMap = Object.fromEntries(staffList.map(s => [s.id, s]));
            }
        }

        const entries = (data || []).map(e => ({
            ...e,
            staff_name: staffMap[e.staff_id]?.display_name || 'Unknown',
            staff_role: staffMap[e.staff_id]?.role || 'unknown',
        }));

        // Summary
        const onShift = entries.filter(e => !e.clock_out);
        const totalHours = entries
            .filter(e => e.hours_worked)
            .reduce((sum, e) => sum + parseFloat(e.hours_worked || 0), 0);

        return res.status(200).json({
            success: true,
            data: {
                entries,
                summary: {
                    total_entries: entries.length,
                    on_shift: onShift.length,
                    total_hours: Math.round(totalHours * 100) / 100,
                }
            }
        });
    } catch (err) {
        console.warn('Time clock GET error:', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

async function handlePost(req, res) {
    try {
        const { venue_id, qr_code, action } = req.body;
        if (!venue_id || !qr_code) {
            return res.status(400).json({ success: false, error: 'venue_id and qr_code required' });
        }

        // Look up staff member by QR code
        const { data: staffList } = await getSupabase()
            .from('commander_staff')
            .select('id, display_name, role, venue_id, is_active')
            .eq('qr_code', qr_code)
            .eq('venue_id', venue_id)
            .eq('is_active', true)
            .limit(1);

        let staff = staffList?.[0] || null;
        if (!staff) {
            // Also try looking up via commander_members QR code
            const { data: memberList } = await getSupabase()
                .from('commander_members')
                .select('id, qr_code')
                .eq('qr_code', qr_code)
                .eq('venue_id', venue_id)
                .limit(1);

            if (memberList?.[0]) {
                // Find staff linked to this member
                const { data: linkedStaff } = await getSupabase()
                    .from('commander_staff')
                    .select('id, display_name, role, venue_id, is_active')
                    .eq('member_id', memberList[0].id)
                    .eq('is_active', true)
                    .limit(1);

                if (!linkedStaff?.[0]) {
                    return res.status(404).json({ success: false, error: 'No active staff member found for this QR code' });
                }
                staff = linkedStaff[0];
            } else {
                return res.status(404).json({ success: false, error: 'Invalid QR code or staff not found' });
            }
        }

        const staffId = staff.id;
        const staffName = staff.display_name || 'Unknown';

        // Check for open shift (clocked in but not out)
        const { data: openShift } = await getSupabase()
            .from('commander_time_clock')
            .select('id, clock_in')
            .eq('staff_id', staffId)
            .eq('venue_id', venue_id)
            .is('clock_out', null)
            .order('clock_in', { ascending: false })
            .limit(1);

        if (openShift?.[0]) {
            // Clock OUT - close the open shift
            const clockIn = new Date(openShift[0].clock_in);
            const clockOut = new Date();
            const hoursWorked = Math.round(((clockOut - clockIn) / 3600000) * 100) / 100;

            const { data: updated, error } = await getSupabase()
                .from('commander_time_clock')
                .update({ clock_out: clockOut.toISOString(), hours_worked: hoursWorked })
                .eq('id', openShift[0].id)
                .select()
                .maybeSingle();

            if (error) throw error;

            return res.status(200).json({
                success: true,
                data: {
                    action: 'clock_out',
                    staff_name: staffName,
                    staff_role: staff?.role,
                    clock_in: openShift[0].clock_in,
                    clock_out: clockOut.toISOString(),
                    hours_worked: hoursWorked,
                    entry: updated,
                }
            });
        } else {
            // Clock IN - create new entry
            const { data: entry, error } = await getSupabase()
                .from('commander_time_clock')
                .insert({
                    venue_id,
                    staff_id: staffId,
                    clock_in: new Date().toISOString(),
                })
                .select()
                .maybeSingle();

            if (error) throw error;

            return res.status(201).json({
                success: true,
                data: {
                    action: 'clock_in',
                    staff_name: staffName,
                    staff_role: staff?.role,
                    clock_in: entry.clock_in,
                    entry,
                }
            });
        }
    } catch (err) {
        try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
        console.warn('Time clock POST error:', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}
