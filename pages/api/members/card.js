/**
 * Commander Member Card API
 * GET: Returns member data needed for card generation (client-side rendering)
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

// Auth: STAFF on EVERY method, reads included.
// 2026-08-20 audit fix: this route is GET-only and used guardWriteStaff, which
// returns `true` for GET without verifying anything - so the whole member row
// (name, date of birth, government ID number, address, phone, email, QR code)
// was public to anyone with a member id.
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    try {
    const _authResult = await guardStaff(req, res);
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

      // Venue ownership: staff may only print cards for their own venue.
      if (_authResult.venue_id !== undefined && _authResult.venue_id !== null
          && String(member.venue_id) !== String(_authResult.venue_id)) {
          return res.status(403).json({ success: false, error: 'You Are Not Staff At This Venue' });
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
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
