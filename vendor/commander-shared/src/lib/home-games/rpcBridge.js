/**
 * ══════════════════════════════════════════════════════════════════════════
 *  HOME-GAMES RPC BRIDGE  (phase 41)
 *  Shared thin layer for the seat-reservation API routes.
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  Every /api/home-games/* route does the same five things:
 *    1. Verify method
 *    2. Rate-limit
 *    3. Verify JWT (HMAC via serverAuth)
 *    4. Call a SECURITY DEFINER RPC with the caller's auth context
 *    5. Map RPC errors to HTTP status codes
 *
 *  Centralising that here means each route file is ~20 lines of params.
 *
 *  KEY DESIGN CHOICE:
 *    The RPCs (rpc_hg_*) call auth.uid() internally for authz. For that to
 *    resolve, we MUST pass the user's JWT through to the supabase client —
 *    not the service-role key. So we create a per-request supabase client
 *    with `Authorization: Bearer <token>` in the headers, and invoke the
 *    RPC via that client. Inside the RPC, auth.uid() then equals the
 *    verified user id and all the NOT_A_MEMBER / NOT_GROUP_STAFF checks
 *    work as designed.
 */

const { createClient } = require('@supabase/supabase-js');
const { applyRateLimit, LIMITS } = require('../apiRateLimit');
const { getServerUserWithFallback } = require('../serverAuth');

// Lazy-initialised service-role client used ONLY for the initial JWT
// verification handshake when serverAuth falls back to supabase.auth.getUser.
let _serviceClient = null;
function getServiceClient() {
  if (!_serviceClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    _serviceClient = createClient(url, key, { auth: { persistSession: false } });
  }
  return _serviceClient;
}

/**
 * Build a supabase client authenticated as the caller so auth.uid() resolves
 * inside SECURITY DEFINER RPCs.
 */
function getUserScopedClient(token) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

/**
 * Map a RAISE EXCEPTION code from our RPCs (or native Postgres SQLSTATE) to
 * an HTTP status + client-facing error string.
 */
function mapRpcError(err) {
  // Postgres RAISE EXCEPTION surfaces as {code: 'P0001', message: 'ERRNAME'}
  // Native unique/check violations have their own SQLSTATE codes.
  const code = err?.code || '';
  const raw  = (err?.message || err?.details || 'Internal error').toString();
  // Our RPCs all RAISE with SNAKE_CASE codes as the message.
  const errName = raw.trim().split(/\s+/)[0] || raw;

  if (code === '23505') {
    return { status: 409, error: 'SEAT_ALREADY_TAKEN',
             message: 'That seat was just claimed by someone else.' };
  }
  if (code === '23514') {
    return { status: 400, error: 'VALIDATION_FAILED', message: raw };
  }

  switch (errName) {
    case 'AUTH_REQUIRED':
      return { status: 401, error: errName, message: 'Sign in to continue.' };

    case 'NOT_A_MEMBER':
    case 'NOT_GROUP_STAFF':
    case 'NOT_YOUR_RESERVATION':
    case 'MEMBER_WRONG_GROUP':
      return { status: 403, error: errName, message: raw };

    case 'GAME_NOT_FOUND':
    case 'TABLE_NOT_FOUND':
    case 'MEMBER_NOT_FOUND':
    case 'RESERVATION_NOT_FOUND':
      return { status: 404, error: errName, message: raw };

    case 'GAME_CANCELLED':
    case 'TABLE_CANCELLED':
    case 'TABLE_ENDED':
    case 'TABLE_RUNNING':
    case 'TABLE_NOT_OPEN':
    case 'TABLE_NOT_OPEN_FOR_RSVP':
    case 'TABLE_NOT_IN_OPEN_STATE':
    case 'TABLE_NOT_CLAIMABLE':
    case 'RSVPS_CLOSED':
    case 'RSVP_DEADLINE_PASSED':
    case 'GAME_START_TIME_PASSED':
    case 'RESERVATION_INACTIVE':
    case 'RESERVATION_ALREADY_INACTIVE':
    case 'CANNOT_DELETE_DEFAULT_TABLE_WITH_SIBLINGS':
      return { status: 409, error: errName, message: raw };

    case 'SEAT_OUT_OF_BOUNDS':
    case 'MAX_SEATS_OUT_OF_BOUNDS':
    case 'DISPLAY_NAME_INVALID':
      return { status: 400, error: errName, message: raw };

    default:
      // Unknown error — log and 500. Don't leak internals.
      if (typeof console !== 'undefined') {
        console.warn('[home-games rpcBridge] unmapped error', code, raw);
      }
      return { status: 500, error: 'INTERNAL_ERROR', message: 'Something went wrong.' };
  }
}

/**
 * One-call entry point for API handlers.
 *
 *   const { ok, status, body, user, supabase } = await bridgeRequest(req, res, {
 *     method: 'POST',
 *     limit:  LIMITS.write,
 *   });
 *   if (!ok) return res.status(status).json(body);
 *
 *   const { data, error } = await supabase.rpc('rpc_hg_claim_seat', {...});
 *   if (error) {
 *     const m = mapRpcError(error);
 *     return res.status(m.status).json({ success: false, ...m });
 *   }
 *   res.status(200).json({ success: true, data });
 */
async function bridgeRequest(req, res, { method = 'POST', limit } = {}) {
  const allowed = Array.isArray(method) ? method : [method];
  if (!allowed.includes(req.method)) {
    res.setHeader('Allow', allowed);
    return { ok: false, status: 405,
             body: { success: false, error: 'METHOD_NOT_ALLOWED' } };
  }

  if (limit && !applyRateLimit(req, res, limit)) {
    return { ok: false, status: 429, body: null, _alreadyResponded: true };
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401,
             body: { success: false, error: 'AUTH_REQUIRED' } };
  }
  const token = authHeader.slice(7);

  const serviceClient = getServiceClient();
  const { user } = await getServerUserWithFallback(req, serviceClient);
  if (!user || !user.id) {
    return { ok: false, status: 401,
             body: { success: false, error: 'INVALID_TOKEN' } };
  }

  const supabase = getUserScopedClient(token);
  return { ok: true, user, supabase, token };
}

module.exports = { bridgeRequest, mapRpcError, LIMITS, getUserScopedClient };
