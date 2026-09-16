#!/usr/bin/env node
/**
 * LOGIN-BRIDGE PROBE - the Smarter.Poker -> Club Commander handshake, checked
 * from the outside, on a schedule.
 *
 * Why this exists: on 2026-09-03 every Commander login had been failing for
 * days (`completeLogin is not defined`), the hub-origin proxy served pages
 * whose assets 404'd, and nothing paged. Unit tests guard the source; this
 * guards the RUNNING system across three deployables (hub rewrite, commander
 * app, Supabase), which no single repo's CI can see.
 *
 * Two legs:
 *
 *   STRUCTURAL (always runs, no credentials):
 *     - commander.smarter.poker/commander/login serves HTML whose JS chunks
 *       all load (200, JS content-type) - and the login chunk does not
 *       contain a bare `completeLogin(` call without a definition.
 *     - smarter.poker/commander/login (the hub rewrite) serves the SAME app
 *       and every referenced script resolves to the commander origin and
 *       loads - the 2026-09-03 infinite-spinner bug.
 *     - /auth/sso, /api/auth/sso-exchange (bad token -> 401 JSON),
 *       /api/commander/check-subscription (no auth -> 401 JSON) and the hub's
 *       /api/auth/commander-sso (no auth -> 401) are alive and answer with
 *       the contract the client expects.
 *     - /api/health reports the signing secret present.
 *
 *   SIGNED-IN (runs only when PROBE_EMAIL + PROBE_PASSWORD are set):
 *     - password grant against Supabase -> access token
 *     - hub /api/auth/commander-sso -> one-time SSO URL (token + uid)
 *     - commander /api/auth/sso-exchange -> magic-link OTP payload
 *     - commander /api/commander/check-subscription -> signed staff_session
 *     - a guarded API (/api/commander/settings) accepts that session (200),
 *       and rejects a tampered one (401) - the HMAC is really enforced
 *
 * Exit 0 = every leg passed. Exit 1 = at least one check failed; the report is
 * printed as GitHub-flavoured markdown so the workflow can paste it into an
 * issue verbatim. No secret value is ever printed.
 *
 *   node scripts/probe-login-bridge.mjs
 *   PROBE_EMAIL=... PROBE_PASSWORD=... node scripts/probe-login-bridge.mjs
 */

import { runLoginBridgeProbe } from '../src/lib/probe/loginBridgeProbe.mjs';

const report = await runLoginBridgeProbe({
  hub: process.env.PROBE_HUB_ORIGIN,
  commander: process.env.PROBE_COMMANDER_ORIGIN,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  timeoutMs: process.env.PROBE_TIMEOUT_MS,
  email: process.env.PROBE_EMAIL,
  password: process.env.PROBE_PASSWORD,
  // PROBE_LOCAL=1: the target is a `next start` of this commit in CI (see the
  // core's `local` option) - production-only rows are skipped or warnings.
  local: process.env.PROBE_LOCAL === '1',
});

if (process.env.GITHUB_OUTPUT) {
  const fs = await import('node:fs');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `report<<PROBE_EOF\n${report.markdown}\nPROBE_EOF\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `failed=${report.failures.length}\n`);
}
console.log('\n' + report.markdown);
process.exit(report.ok ? 0 : 1);
