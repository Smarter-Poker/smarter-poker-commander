/**
 * Commander Member QR Scan API
 * POST: Look up a member by their QR code
 * Used when scanning a player's club card at tables, tournaments, etc.
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    if (!applyRateLimit(req, res, LIMITS.write)) return;
  }

  // Auth guard: require staff auth for write operations
  const _authResult = await guardWriteStaff(req, res);
  if (!_authResult) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { qr_code, venue_id } = req.body;

    if (!qr_code) {
        return res.status(400).json({ success: false, error: 'qr_code is required' });
    }

    let query = getSupabase()
        .from('commander_members')
        .select('*')
        .eq('qr_code', qr_code)
            .limit(100)

    if (venue_id) {
        query = query.eq('venue_id', venue_id);
    }

    const { data: members, error } = await query.limit(1);

    if (error) {
        console.warn('QR scan error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }

    const member = members?.[0];

    if (!member) {
        return res.status(404).json({ success: false, error: 'Member not found' });
    }

    // Update last visit and increment visit count
    await getSupabase()
        .from('commander_members')
        .update({
            last_visit: new Date().toISOString(),
            total_visits: (member.total_visits || 0) + 1,
            updated_at: new Date().toISOString(),
        })
        .eq('id', member.id);

    return res.status(200).json({
        success: true,
        data: {
            member: {
                ...member,
                last_visit: new Date().toISOString(),
                total_visits: (member.total_visits || 0) + 1,
            },
        },
    });
  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[pages/api/commander/members/scan.js]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
