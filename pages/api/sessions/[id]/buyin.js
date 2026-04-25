/**
 * Commander Session Buy-in API - POST /api/commander/sessions/:id/buyin
 * Add a buy-in to a player session
 * Reference: Phase 2 - Session Tracking
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF — requires valid staff session
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard: require staff auth
    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Session ID required' }
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    try {
      const { amount } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Valid amount required' }
        });
      }

      // Get current session
      const { data: session, error: fetchError } = await getSupabase()
        .from('commander_player_sessions')
        .select('id, status, total_buyin, venue_id, player_id')
        .eq('id', id)
        .maybeSingle();

      if (fetchError || !session) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' }
        });
      }

      if (session.status !== 'active') {
        return res.status(400).json({
          success: false,
          error: { code: 'SESSION_ENDED', message: 'Cannot add buy-in to ended session' }
        });
      }

      const newTotal = (session.total_buyin || 0) + amount;

      // Update session total
      const { data: updated, error: updateError } = await getSupabase()
        .from('commander_player_sessions')
        .update({ total_buyin: newTotal })
        .eq('id', id)
        .select()
        .maybeSingle();

      if (updateError) {
        console.warn('Session buy-in error:', updateError);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to add buy-in' }
        });
      }

      // Log the buy-in transaction (if table exists)
      try {
        await getSupabase()
          .from('commander_buyin_transactions')
          .insert({
            session_id: id,
            venue_id: session.venue_id,
            player_id: session.player_id,
            amount: amount,
            transaction_type: 'buyin',
            created_at: new Date().toISOString()
          });
      } catch (logError) { console.warn('[App] Handled exception:', logError?.message || logError); }

      return res.status(200).json({
        success: true,
        data: {
          session: updated,
          added_amount: amount,
          new_total: newTotal
        }
      });
    } catch (error) {
      console.warn('Session buy-in error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
