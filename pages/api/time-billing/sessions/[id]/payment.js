/**
 * Record Payment for Time Billing Session
 * POST /api/commander/time-billing/sessions/[id]/payment
 */
import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../src/lib/apiErrorHandler';

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

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ success: false, error: 'Authorization required' });
      const token = authHeader.replace('Bearer ', '');
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (!user) return res.status(401).json({ success: false, error: 'Invalid token' });

      const { id } = req.query;
      const { amount } = req.body;
      if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Valid amount required' });

      // 2026-08-20 audit fix: the session id was passed straight to the RPC
      // with no venue ownership check, so staff at venue A could record
      // payments against venue B's table sessions.
      if (_g && _g !== true && _g.venue_id !== undefined && _g.venue_id !== null) {
        const { data: owner } = await getSupabase()
          .from('commander_table_sessions')
          .select('id, venue_id')
          .eq('id', id)
          .maybeSingle();
        if (!owner) return res.status(404).json({ success: false, error: 'Session not found' });
        if (String(owner.venue_id) !== String(_g.venue_id)) {
          return res.status(403).json({ success: false, error: 'You Are Not Staff At This Venue' });
        }
      }

      // 2026-07-28 audit fix: this selected amount_paid, added the payment in JS
      // and wrote the sum back. Two concurrent payments both read the old total
      // and the second write erased the first, so the room recorded one payment
      // for two collected. commander_adjust_table_session_payment does the read
      // and the write in one statement (amount_paid = amount_paid + delta) and
      // raises rather than writing a negative total.
      const { data: updated, error } = await getSupabase()
        .rpc('commander_adjust_table_session_payment', {
          p_session_id: id,
          p_delta: parseFloat(amount)
        });

      if (error) {
        if (error.code === 'P0002') return res.status(404).json({ success: false, error: 'Session not found' });
        console.warn('Payment error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
      }
      if (!updated) return res.status(404).json({ success: false, error: 'Session not found' });
      // Response shape unchanged: the full updated commander_table_sessions row.
      return res.status(200).json({ success: true, data: updated });
    } catch (err) {
      console.warn('Payment error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
