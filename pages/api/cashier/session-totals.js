/**
 * Session Cash Totals API
 * GET /api/commander/cashier/session-totals?session_id=X
 * Returns buy-in and cash-out totals for a specific time session
 * Also supports: ?table_number=N&venue_id=X (all active sessions at table)
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
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
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ success: false, error: 'Auth required' });
      const token = authHeader.replace('Bearer ', '');
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (!user) return res.status(401).json({ success: false, error: 'Invalid token' });

      const { session_id, table_number, venue_id } = req.query;

      if (session_id) {
        // Single session totals
        const { data: txns } = await getSupabase()
          .from('commander_cash_transactions')
          .select('type, amount, created_at, payment_method')
          .eq('session_id', session_id)
          .order('created_at', { ascending: true })
              .limit(100);

        const transactions = txns || [];
        const buyIns = transactions.filter(t => t.type === 'buy_in' || t.type === 'add_on');
        const cashOuts = transactions.filter(t => t.type === 'cash_out');

        return res.status(200).json({
          success: true,
          data: {
            session_id,
            total_bought: buyIns.reduce((s, t) => s + parseFloat(t.amount), 0),
            total_cashed: cashOuts.reduce((s, t) => s + parseFloat(t.amount), 0),
            buy_in_count: buyIns.length,
            transactions,
          }
        });
      }

      if (table_number && venue_id) {
        // All active sessions at table with their cash totals
        const { data: sessions } = await getSupabase()
          .from('commander_table_sessions')
          .select('id, player_name, seat_number, started_at')
          .eq('venue_id', venue_id)
          .eq('table_number', parseInt(table_number))
          .eq('status', 'active')
              .limit(100);

        if (!sessions || sessions.length === 0) {
          return res.status(200).json({ success: true, data: [] });
        }

        const sessionIds = sessions.map(s => s.id);
        const { data: allTxns } = await getSupabase()
          .from('commander_cash_transactions')
          .select('session_id, type, amount')
          .in('session_id', sessionIds)
              .limit(100);

        const txnMap = {};
        (allTxns || []).forEach(t => {
          if (!txnMap[t.session_id]) txnMap[t.session_id] = [];
          txnMap[t.session_id].push(t);
        });

        const result = sessions.map(s => {
          const txns = txnMap[s.id] || [];
          const bought = txns.filter(t => t.type === 'buy_in' || t.type === 'add_on').reduce((sum, t) => sum + parseFloat(t.amount), 0);
          const cashed = txns.filter(t => t.type === 'cash_out').reduce((sum, t) => sum + parseFloat(t.amount), 0);
          return {
            session_id: s.id,
            player_name: s.player_name,
            seat_number: s.seat_number,
            total_bought: bought,
            total_cashed: cashed,
            net: cashed - bought,
            transaction_count: txns.length,
          };
        });

        return res.status(200).json({ success: true, data: result });
      }

      return res.status(400).json({ success: false, error: 'session_id or (table_number + venue_id) required' });
    } catch (err) {
      console.warn('Session totals error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
