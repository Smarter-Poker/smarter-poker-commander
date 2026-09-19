/**
 * GET /api/health
 * Health check endpoint for smarter-poker-commander.
 * Returns service name, status, and uptime metadata.
 *
 * WHY THIS ROUTE READS THE DATABASE (2026-09-18)
 * ----------------------------------------------
 * Commander's Supabase key stopped being registered for the project. Every
 * poker_venues read came back `Unregistered API key`, /api/venues answered 500
 * for hours, and the venue directory on smarter.poker served Googlebot an
 * empty page. This endpoint reported `status: 'ok'` the entire time, because
 * `supabase_service_role` only ever meant "the environment variable is a
 * non-empty string". It was, all along. It simply did not work.
 *
 * That is CLAUDE.md law 3.2 exactly: the absence of reported issues is not
 * proof of health. A monitor that stays green through a total data outage is
 * not a monitor.
 *
 * So the key is now EXERCISED rather than counted: one bounded read of one id.
 * The login-bridge probe asserts the result, and that probe is a CRITICAL_JOB
 * in Open Claw's dispatcher (threshold 2), so a dead credential reaches an
 * operator in about two hours instead of never.
 *
 * The STATUS CODE stays 200 on a bad key, deliberately. Deploy verification
 * reads `version` from here (CLAUDE.md section 2) and several watchdogs assert
 * 200; turning this route red would remove the ability to confirm a deploy
 * during exactly the incident when that matters most. The fault is carried in
 * the body as `status: 'degraded'`, and the probe is what escalates it.
 */
import { createClient } from '../../src/lib/supabaseServerClient';

// One bounded read, cached briefly. /api/health is polled by several watchdogs
// and by the dispatcher; without this window a noisy monitor would multiply
// into real query load on poker_venues.
const CREDENTIAL_TTL_MS = 30_000;
const CREDENTIAL_TIMEOUT_MS = 3_000;
let _cached = { at: 0, valid: null, detail: null };

/**
 * true  - the service-role key was accepted and a read completed
 * false - a key is configured and the read failed (refused, or timed out)
 * null  - no key configured, so there is nothing to verify (local builds)
 */
async function serviceRoleWorks() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { valid: null, detail: 'not configured' };

  const now = Date.now();
  if (_cached.valid !== null && now - _cached.at < CREDENTIAL_TTL_MS) {
    return { valid: _cached.valid, detail: _cached.detail };
  }

  let valid = false;
  let detail = null;
  try {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    // The cheapest possible proof that this key can read this project: one id.
    const { error } = await client
      .from('poker_venues')
      .select('id')
      .limit(1)
      .abortSignal(AbortSignal.timeout(CREDENTIAL_TIMEOUT_MS));
    if (error) {
      // The message names the fault ("Unregistered API key") and never carries
      // the key itself.
      detail = String(error.message || 'read failed').slice(0, 120);
    } else {
      valid = true;
    }
  } catch (err) {
    detail = String(err?.message || err).slice(0, 120);
  }

  _cached = { at: now, valid, detail };
  return { valid, detail };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const credential = await serviceRoleWorks();

  return res.status(200).json({
    // 'degraded' when a key is configured and does NOT work. The header
    // comment says why this is not a 503.
    status: credential.valid === false ? 'degraded' : 'ok',
    service: 'smarter-poker-commander',
    version: process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 8) ?? 'local',
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    timestamp: new Date().toISOString(),
    // Presence only: never expose authentication secret values.
    auth: {
      staff_session_secret: Boolean(
        process.env.COMMANDER_STAFF_SESSION_SECRET || process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY,
      ),
      dedicated_staff_session_secret: Boolean(process.env.COMMANDER_STAFF_SESSION_SECRET),
      // PRESENT: the environment variable is a non-empty string. This stayed
      // true for the whole 2026-09-18 outage.
      supabase_service_role: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      // ACCEPTED: Supabase let this key read this project, just now.
      supabase_service_role_valid: credential.valid,
      supabase_service_role_detail: credential.valid === false ? credential.detail : null,
    },
  });
}
