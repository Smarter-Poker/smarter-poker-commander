/**
 * POST /api/staff-session/renew   (also /api/commander/staff-session/renew)
 *
 * The cheap half of the staff-session self-heal (2026-09-04).
 *
 * Body:    { session: <the stored commander_staff object> }
 * Headers: Authorization: Bearer <Supabase access token>
 * 200:     { staff_session }  - the same claims, freshly signed
 * 4xx:     { error }          - caller falls back to check-subscription
 *
 * No database access. The JWT is verified locally against the project JWKS
 * (vendor serverAuth, ES256), the session's own HMAC proves it was issued by
 * us, and renewOwnerSession() enforces the 48h renew window. Anything this
 * refuses is handled by check-subscription, which does the full DB check.
 */
import { verifySupabaseJwt } from '../../../src/lib/serverAuth';
import { renewOwnerSession } from '../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    const auth = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m) return res.status(401).json({ error: 'Authentication required' });

    const payload = await verifySupabaseJwt(m[1].trim());
    if (!payload?.sub) return res.status(401).json({ error: 'Invalid token' });

    const session = req.body?.session;
    const renewed = renewOwnerSession(session, payload.sub);
    if (renewed.error) {
      return res.status(renewed.error.status || 401).json({ error: renewed.error.message, code: renewed.error.code });
    }
    return res.status(200).json({ staff_session: renewed });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { /* ignore */ }
    console.warn('[staff-session/renew]', err?.message || err);
    if (!res.headersSent) return res.status(500).json({ error: 'Internal server error' });
  }
}
