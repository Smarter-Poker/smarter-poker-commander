/**
 * QR Code Scan Tracking API
 * Records when a player scans a venue QR code for check-in
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { guardWriteStaff } from '../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE — requires manager or owner role
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
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[pages/api/commander/qr-scan.js]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
