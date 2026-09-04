/**
 * PROBE TICKET - how the hub proves to Commander that a probe request is the
 * hub's, without Commander holding a copy of CRON_SECRET.
 *
 * Why (2026-09-04): the Open Claw probe route on Commander first verified the
 * dispatcher's CRON_SECRET bearer, which meant a COPY of the hub's secret on
 * the Commander Vercel project. The very first live run answered 401: the copy
 * was not the production value. A copied secret drifts; on 2026-08-31 the same
 * class of drift 401'd 85 hub jobs for a day. So the dispatcher now calls a
 * HUB route (the one host it already authenticates to), and the hub calls
 * Commander with a short-lived ticket signed by a secret BOTH already hold by
 * construction: SUPABASE_JWT_SECRET, the one Supabase project's JWT secret.
 * Nothing new to provision, nothing to drift.
 *
 * Format: `v1.<unix ms>.<hex hmac-sha256(secret, "login-bridge-probe|<ms>")>`.
 * Valid for +-5 minutes. Pure functions; the SAME file lives in the World Hub
 * at src/lib/probeTicket.js and both repos pin the same test vector, so the
 * two copies cannot drift without a red test on one side.
 */
import crypto from 'crypto';

export const PROBE_TICKET_PURPOSE = 'login-bridge-probe';
export const PROBE_TICKET_MAX_SKEW_MS = 5 * 60 * 1000;

function sign(secret, ts) {
  return crypto.createHmac('sha256', String(secret)).update(`${PROBE_TICKET_PURPOSE}|${ts}`).digest('hex');
}

/** Mint a ticket for now (or a fixed `now` in tests). */
export function mintProbeTicket(secret, now = Date.now()) {
  if (!secret) throw new Error('mintProbeTicket: secret required');
  const ts = Math.floor(Number(now));
  return `v1.${ts}.${sign(secret, ts)}`;
}

/**
 * Verify a ticket. Returns { ok: true, ts } or { ok: false, reason }.
 * Constant-time on the signature; never throws on garbage input.
 */
export function verifyProbeTicket(ticket, secret, now = Date.now(), maxSkewMs = PROBE_TICKET_MAX_SKEW_MS) {
  if (!secret) return { ok: false, reason: 'no_secret' };
  const m = /^v1\.(\d{1,16})\.([0-9a-f]{64})$/.exec(String(ticket || ''));
  if (!m) return { ok: false, reason: 'malformed' };
  const ts = Number(m[1]);
  if (Math.abs(Number(now) - ts) > maxSkewMs) return { ok: false, reason: 'expired' };
  const expected = Buffer.from(sign(secret, ts), 'hex');
  const presented = Buffer.from(m[2], 'hex');
  if (expected.length !== presented.length || !crypto.timingSafeEqual(expected, presented)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true, ts };
}
