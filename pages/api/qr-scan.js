/**
 * QR Code Scan Tracking API
 * Records when a player scans a venue QR code for check-in
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { guardStaff } from '../../src/lib/commander/auth';
import { reportApiError } from '../../src/lib/apiErrorHandler';

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


    // 2026-08-20 audit fix: the guard only ran for writes, so the GET below
    // returned qr_code_scans rows - including scanner IP addresses and user
    // agents - to anyone with a venue_id. Staff auth is now required on every
    // method and the venue is checked against the caller's session.
    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    const _scopeVenueId = req.method === 'GET' ? req.query.venue_id : req.body?.venue_id;
    if (_scopeVenueId && _staff.venue_id !== undefined && _staff.venue_id !== null
        && String(_staff.venue_id) !== String(_scopeVenueId)) {
      return res.status(403).json({ success: false, error: 'You Are Not Staff At This Venue' });
    }

    if (req.method === 'POST') {
        const { venue_id, user_id, scan_type } = req.body;

        if (!venue_id) {
            return res.status(400).json({ success: false, error: 'venue_id is required' });
        }

        const { data, error } = await getSupabase()
            .from('qr_code_scans')
            .insert({
                venue_id: venue_id,
                scanned_by: user_id || null,
                scan_type: scan_type || 'check-in',
                ip_address: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
                user_agent: req.headers['user-agent'] || null,
            })
            .select()
            .maybeSingle();

        if (error) {
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }

        return res.status(200).json({ success: true, scan: data });
    }

    if (req.method === 'GET') {
        const { venue_id, days } = req.query;

        if (!venue_id) {
            return res.status(400).json({ success: false, error: 'venue_id is required' });
        }

        const since = new Date();
        since.setDate(since.getDate() - (parseInt(days) || 30));

        const { data, error, count } = await getSupabase()
            .from('qr_code_scans')
            .select('*', { count: 'exact' })
            .eq('venue_id', venue_id)
            .gte('scanned_at', since.toISOString())
            .order('scanned_at', { ascending: false })
            .limit(100);

        if (error) {
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }

        return res.status(200).json({ success: true, scans: data, total: count });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[pages/api/commander/qr-scan.js]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
