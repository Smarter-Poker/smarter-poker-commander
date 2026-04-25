/**
 * Record Payment for Time Billing Session
 * POST /api/commander/time-billing/sessions/[id]/payment
 */
import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../src/lib/sentryWrap';

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

      const { data: session } = await getSupabase()
        .from('commander_table_sessions')
        .select('amount_paid')
        .eq('id', id)
        .maybeSingle();

      if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

      const newTotal = (session.amount_paid || 0) + parseFloat(amount);

      const { data: updated, error } = await getSupabase()
        .from('commander_table_sessions')
        .update({ amount_paid: Math.round(newTotal * 100) / 100 })
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
      if (!updated) return res.status(404).json({ success: false, error: 'Session not found' });
      return res.status(200).json({ success: true, data: updated });
    } catch (err) {
      console.warn('Payment error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
