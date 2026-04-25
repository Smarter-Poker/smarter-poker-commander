/**
 * Commander Member Card API
 * GET: Returns member data needed for card generation (client-side rendering)
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
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    try {
    // Auth guard: require staff auth for write operations
    const _authResult = await guardWriteStaff(req, res);
    if (!_authResult) return;

      if (req.method !== 'GET') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      const { memberId } = req.query;

      if (!memberId) {
          return res.status(400).json({ success: false, error: 'memberId is required' });
      }

      const { data: member, error } = await getSupabase()
          .from('commander_members')
          .select('*, venue:poker_venues(id, name, city, state)')
          .eq('id', memberId)
          .maybeSingle();

      if (error || !member) {
          return res.status(404).json({ success: false, error: 'Member not found' });
      }

      // Generate QR code URL
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(member.qr_code)}&bgcolor=ffffff&color=000000`;

      return res.status(200).json({
          success: true,
          data: {
              member,
              qrCodeUrl,
          },
      });
    } catch (err) {
      console.warn('[pages/api/commander/members/card.js]', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
