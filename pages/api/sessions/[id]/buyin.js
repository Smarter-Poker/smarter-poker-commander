/**
 * Commander Session Buy-in API - POST /api/commander/sessions/:id/buyin
 * Add a buy-in to a player session
 * Reference: Phase 2 - Session Tracking
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';

// Upper bound on a single buy-in. Guards against fat-fingered and hostile
// amounts, and against overflowing the integer total_buyin column.
const MAX_BUYIN = 1000000;

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

      // 2026-07-28 audit fix: `!amount || amount <= 0` passed strings straight
      // through - "50" is truthy and "50" <= 0 is false - and the total below was
      // then computed with `+`, which concatenates. Posting {"amount":"50"} to a
      // session with total_buyin 100 produced "10050", which Postgres accepted
      // for the integer column: a $100 buy-in recorded as $10,050. Coerce
      // explicitly and reject anything that is not a finite positive number in
      // range, rather than letting garbage coerce to 0.
      const parsedAmount = (typeof amount === 'number' || typeof amount === 'string')
        ? Number(amount)
        : NaN;
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > MAX_BUYIN) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Valid amount required (a positive number up to ${MAX_BUYIN})` }
        });
      }

      // 2026-07-28 audit fix: this used to select total_buyin, add the amount in
      // JS and write the sum back. Two concurrent buy-ins both read the old
      // total and the second write erased the first, so a double-tapped button
      // took the cash twice and recorded it once. commander_txn_session_buyin
      // does the read and the write in one statement (total_buyin = total_buyin
      // + delta) and writes the ledger row in the same transaction.
      //
      // idempotency_key is optional. When supplied, a resubmission of the same
      // buy-in returns the ORIGINAL transaction with success instead of adding
      // the amount a second time, so a retry is indistinguishable from the
      // first call.
      const idempotencyKey = typeof req.body?.idempotency_key === 'string' && req.body.idempotency_key.trim()
        ? req.body.idempotency_key.trim().slice(0, 200)
        : null;

      const { data: result, error: rpcError } = await getSupabase()
        .rpc('commander_txn_session_buyin', {
          p_session_id: id,
          p_amount: parsedAmount,
          p_idempotency_key: idempotencyKey
        });

      if (rpcError) {
        // P0002 = row not found, P0001 = precondition failed (session not active).
        if (rpcError.code === 'P0002') {
          return res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Session not found' }
          });
        }
        if (rpcError.code === 'P0001') {
          return res.status(400).json({
            success: false,
            error: { code: 'SESSION_ENDED', message: 'Cannot add buy-in to ended session' }
          });
        }
        console.warn('Session buy-in error:', rpcError);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to add buy-in' }
        });
      }

      // Response shape is unchanged: { session, added_amount, new_total }.
      return res.status(200).json({
        success: true,
        data: {
          session: result?.session || null,
          added_amount: parsedAmount,
          new_total: result?.new_total ?? null,
          replayed: result?.replayed === true
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
