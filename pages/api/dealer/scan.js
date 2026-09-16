/**
 * Dealer Scan API
 * POST /api/commander/dealer/scan
 * 
 * Scans a member QR code and returns:
 * - Member profile
 * - membership_active status
 * - time_balance_minutes remaining on their card
 * 
 * Used by dealer tablet when scanning player into a seat
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF - requires valid staff session
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard: require staff auth
    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { qr_code, table_number } = req.body;

    if (!qr_code) {
      return res.status(400).json({ success: false, error: 'qr_code is required' });
    }

    try {
      // Look up member by QR code
      // QR format: CMD-XXXX-XXXXXXXX or a check-in URL containing the code
      let lookupCode = qr_code;

      // If it's a URL, extract the code portion
      if (qr_code.includes('/check-in/')) {
        const parts = qr_code.split('/');
        lookupCode = parts[parts.length - 1];
      }

      const { data: members, error: memberError } = await getSupabase()
        .from('commander_members')
        .select('*')
        .eq('venue_id', _staff.venue_id)
        .or(`qr_code.eq.${lookupCode},member_number.eq.${lookupCode}`)
        .limit(1);

      if (memberError) throw memberError;

      const member = members?.[0];
      if (!member) {
        return res.status(404).json({ success: false, error: 'Member not found. QR code not recognized.' });
      }

      // Check membership status
      const membershipActive =
        member.membership_status !== 'suspended' &&
        member.membership_status !== 'banned' &&
        member.membership_status !== 'expired' &&
        member.membership_status !== 'inactive';

      // Check if membership has expired by date
      const isExpiredByDate = member.membership_expires &&
        new Date(member.membership_expires) < new Date();

      // Check if already seated at another table
      const { data: existingSessions } = await getSupabase()
        .from('commander_table_sessions')
        .select('table_number, seat_number')
        .eq('member_id', member.id)
        .eq('status', 'active')
        .limit(1);

      const alreadySeated = existingSessions?.[0] || null;

      // Time balance (minutes pre-paid on their card)
      const timeBalance = member.time_balance_minutes || 0;

      return res.status(200).json({
        success: true,
        data: {
          member: {
            id: member.id,
            first_name: member.first_name,
            last_name: member.last_name,
            member_number: member.member_number,
            membership_tier: member.membership_tier || 'standard',
            membership_status: member.membership_status,
            photo_url: member.photo_url,
            total_visits: member.total_visits || 0,
            qr_code: member.qr_code
          },
          membership_active: membershipActive && !isExpiredByDate,
          membership_expires: member.membership_expires,
          time_balance_minutes: timeBalance,
          already_seated: alreadySeated
        }
      });
    } catch (err) {
      console.warn('Dealer scan error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
