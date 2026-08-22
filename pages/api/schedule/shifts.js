/**
 * Staff Schedule Shifts API - GET/POST/DELETE /api/commander/schedule/shifts
 * Manages weekly shift assignments for all staff roles
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { verifyStaffSession, verifyManagerSession } from '../../../src/lib/commander/auth';
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
    // CDN cache: fresh for 60s, serve stale up to 300s
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    }

    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

      if (req.method === 'GET') return handleGet(req, res);
      if (req.method === 'POST') return handlePost(req, res);
      if (req.method === 'DELETE') return handleDelete(req, res);
      return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/** GET - fetch shifts for a week (7 days from week_start) */
async function handleGet(req, res) {
    const { venue_id, week_start } = req.query;
    if (!venue_id || !week_start) {
        return res.status(400).json({ success: false, error: { message: 'venue_id and week_start required' } });
    }

    // Auth: any staff can read shifts
    const authResult = await verifyStaffSession(req);
    if (authResult.error) {
        return res.status(authResult.error.status).json({
            success: false,
            error: { code: authResult.error.code, message: authResult.error.message }
        });
    }

    try {
        const start = new Date(week_start + 'T00:00:00');
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        const endStr = end.toISOString().split('T')[0];

        const { data, error } = await getSupabase()
            .from('commander_staff_shifts')
            .select('*')
            .eq('venue_id', venue_id)
            .gte('shift_date', week_start)
            .lt('shift_date', endStr)
            .order('shift_date')
            .order('start_time')
                .limit(100);

        if (error) throw error;

        return res.status(200).json({ success: true, data: data || [] });
    } catch (err) {
        console.warn('[Schedule Shifts] GET error:', err);
        return res.status(500).json({ success: false, error: { message: 'Failed to fetch shifts' } });
    }
}

/** POST - create a new shift */
async function handlePost(req, res) {
    const { venue_id, staff_id, staff_name, staff_role, shift_date, start_time, end_time, notes } = req.body;

    if (!venue_id || !staff_id || !shift_date || !start_time || !end_time) {
        return res.status(400).json({
            success: false,
            error: { message: 'venue_id, staff_id, shift_date, start_time, and end_time required' }
        });
    }

    // Auth: manager/owner only
    const authResult = await verifyManagerSession(req, venue_id);
    if (authResult.error) {
        return res.status(authResult.error.status).json({
            success: false,
            error: { code: authResult.error.code, message: authResult.error.message }
        });
    }

    try {
        const { data, error } = await getSupabase()
            .from('commander_staff_shifts')
            .insert({
                venue_id,
                staff_id,
                staff_name: staff_name || '',
                staff_role: staff_role || 'staff',
                shift_date,
                start_time,
                end_time,
                notes: notes || null,
                created_by: authResult.staff?.display_name || 'Manager'
            })
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!data) throw new Error('Failed to create shift');

        return res.status(201).json({ success: true, data });
    } catch (err) {
        console.warn('[Schedule Shifts] POST error:', err);
        return res.status(500).json({ success: false, error: { message: 'Failed to create shift' } });
    }
}

/** DELETE - remove a shift */
async function handleDelete(req, res) {
    const { id, venue_id } = req.query;
    if (!id || !venue_id) {
        return res.status(400).json({ success: false, error: { message: 'id and venue_id required' } });
    }

    // Auth: manager/owner only
    const authResult = await verifyManagerSession(req, venue_id);
    if (authResult.error) {
        return res.status(authResult.error.status).json({
            success: false,
            error: { code: authResult.error.code, message: authResult.error.message }
        });
    }

    try {
        const { error } = await getSupabase()
            .from('commander_staff_shifts')
            .delete()
            .eq('id', id)
            .eq('venue_id', venue_id);

        if (error) throw error;

        return res.status(200).json({ success: true });
    } catch (err) {
        try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
        console.warn('[Schedule Shifts] DELETE error:', err);
        return res.status(500).json({ success: false, error: { message: 'Failed to delete shift' } });
    }
}
