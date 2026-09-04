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
 *     - /api/health reports the signing secret and Sentry DSN present.
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

const HUB = process.env.PROBE_HUB_ORIGIN || 'https://smarter.poker';
const CMD = process.env.PROBE_COMMANDER_ORIGIN || 'https://commander.smarter.poker';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
// Publishable key - safe in a client bundle, safe here.
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable__41LpJpzrfrb3hSUpEaYCA_tF53bBJx';
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 20000);

let discoveredDsn = null;
const results = [];
function record(leg, name, ok, detail = '', { warnOnly = false } = {}) {
  // warnOnly: reported in the table, never counted as a failure. Reserved for
  // configuration the platform CAN run without (it just runs blind) - a probe
  // that is permanently red for a config item stops being read.
  results.push({ leg, name, ok, detail, warnOnly });
  const mark = ok ? 'PASS' : warnOnly ? 'WARN' : 'FAIL';
  console.log(`[${mark}] ${leg} :: ${name}${detail ? ` - ${detail}` : ''}`);
  return ok;
}
const failures = () => results.filter((r) => !r.ok && !r.warnOnly);

async function http(url, init = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'manual', ...init, signal: ctl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, headers: res.headers, text, json, url: res.url };
  } finally {
    clearTimeout(t);
  }
}

function scriptSrcs(html) {
  const out = [];
  const re = /<script[^>]+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

function absolutize(src, pageOrigin) {
  if (/^https?:\/\//.test(src)) return src;
  return pageOrigin + (src.startsWith('/') ? src : `/${src}`);
}

async function checkPageAndAssets(leg, pageUrl, pageOrigin, { mustPointAt } = {}) {
  const page = await http(pageUrl);
  if (!record(leg, `${pageUrl} responds 200 HTML`, page.status === 200 && /<html/i.test(page.text), `status=${page.status}`)) return null;

  const srcs = scriptSrcs(page.text);
  const chunks = srcs.filter((x) => x.includes('/_next/'));
  record(leg, `${pageUrl} references Next.js chunks`, chunks.length > 0, `${chunks.length} chunks`);

  if (mustPointAt) {
    const wrong = chunks.filter((s) => !s.startsWith(mustPointAt));
    record(leg, `every _next asset on ${pageUrl} points at ${mustPointAt}`, wrong.length === 0,
      wrong.length ? `first offender: ${wrong[0]}` : 'assetPrefix in effect');
  }

  // Load every chunk. A 404 or a text/plain body is exactly the failure that
  // rendered a spinner forever on the hub origin.
  const bad = [];
  for (const s of chunks) {
    const r = await http(absolutize(s, pageOrigin));
    const ct = r.headers.get('content-type') || '';
    if (r.status !== 200 || !/javascript/.test(ct)) bad.push(`${s} -> ${r.status} ${ct}`);
  }
  record(leg, `all ${chunks.length} chunks on ${pageUrl} load as JavaScript`, bad.length === 0, bad[0] || '');
  return { page, srcs };
}

async function structuralLeg() {
  const leg = 'structural';

  // 1. Commander origin login page + chunks
  const cmdLogin = await checkPageAndAssets(leg, `${CMD}/commander/login`, CMD, { mustPointAt: `${CMD}/_next/` });
  if (cmdLogin) {
    const loginChunk = cmdLogin.srcs.find((s) => /pages\/commander\/login-[a-z0-9]+\.js/.test(s));
    if (record(leg, 'login page chunk is present', !!loginChunk, loginChunk || '')) {
      const js = (await http(absolutize(loginChunk, CMD))).text;
      // The 2026-09-03 outage, in one regex: a call to a bare global named
      // completeLogin. The fixed code binds it locally (minified to a short
      // name), so the literal identifier must not survive as a free call.
      const bareCalls = (js.match(/[^\w.$]completeLogin\(/g) || []).length;
      record(leg, 'login chunk has no free `completeLogin(` call (the ReferenceError outage)', bareCalls === 0, `${bareCalls} found`);
      record(leg, 'login chunk carries the cross-origin bridge', js.includes('bridge=1'));
      // The completion module (staffSession) is code-split into a shared
      // chunk, so look across every chunk the page loads.
      let all = js;
      for (const s of cmdLogin.srcs.filter((x) => x.includes('/_next/static/chunks/') && x !== loginChunk)) {
        all += (await http(absolutize(s, CMD))).text;
      }
      record(leg, 'login bundle talks to check-subscription (staff session issuer)', all.includes('check-subscription'));
      // The public DSN is in the bundle by design; remember it for the ingest check.
      const dsnMatch = all.match(/https:\/\/([a-f0-9]+)@(o\d+\.ingest\.[a-z.]*sentry\.io)\/(\d+)/);
      if (dsnMatch) discoveredDsn = { key: dsnMatch[1], host: dsnMatch[2], project: dsnMatch[3] };
      record(leg, 'client bundle carries a Sentry DSN', !!dsnMatch, dsnMatch ? `project ${dsnMatch[3]}` : 'Sentry not initialised in the browser', { warnOnly: true });
    }
  }

  // 2. Hub-origin proxy of the same page
  await checkPageAndAssets(leg, `${HUB}/commander/login`, HUB, { mustPointAt: `${CMD}/_next/` });

  // 3. SSO landing page renders
  const sso = await http(`${CMD}/auth/sso`);
  record(leg, '/auth/sso responds 200', sso.status === 200, `status=${sso.status}`);

  // 4. API contracts
  const ex = await http(`${CMD}/api/auth/sso-exchange`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: '0'.repeat(64), uid: '00000000-0000-0000-0000-000000000000' }),
  });
  record(leg, 'sso-exchange rejects an unknown token with 401 JSON', ex.status === 401 && !!ex.json?.error, `status=${ex.status} body=${ex.text.slice(0, 80)}`);

  const cs = await http(`${CMD}/api/commander/check-subscription`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  record(leg, 'check-subscription requires auth (401 JSON)', cs.status === 401 && !!cs.json?.error, `status=${cs.status}`);

  const hubSso = await http(`${HUB}/api/auth/commander-sso`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  record(leg, 'hub commander-sso requires auth (401)', hubSso.status === 401, `status=${hubSso.status}`);

  const guarded = await http(`${CMD}/api/commander/settings`, { headers: { 'x-staff-session': JSON.stringify({ user_id: 'x', venue_id: 1, role: 'owner', session_ts: Date.now() }) } });
  record(leg, 'guarded API rejects an UNSIGNED staff session (401)', guarded.status === 401, `status=${guarded.status}`);

  // 5. Health: secrets + observability present (booleans only)
  const health = await http(`${CMD}/api/health`);
  record(leg, '/api/health responds 200', health.status === 200, `status=${health.status}`);
  if (health.json?.auth) {
    record(leg, 'signing secret configured', health.json.auth.staff_session_secret === true);
    record(leg, 'service-role key configured', health.json.auth.supabase_service_role === true);
    record(leg, 'client Sentry DSN configured', health.json.observability?.sentry_client_dsn === true, 'set NEXT_PUBLIC_SENTRY_DSN in Vercel (production) - browser errors are invisible without it', { warnOnly: true });
    record(leg, 'dedicated staff-session secret configured', health.json.auth.dedicated_staff_session_secret === true, 'set COMMANDER_STAFF_SESSION_SECRET (see docs/runbooks/staff-session-secret-rotation.md, step "first-time setup")', { warnOnly: true });
  } else {
    record(leg, 'health exposes auth/observability booleans', false, 'deploy predates this probe - redeploy');
  }

  // 6. Sentry actually ACCEPTS events. Found 2026-09-04: the org's error quota
  // had been exhausted since 08-24 - every envelope answered 429 - so every
  // alert rule on the estate was blind for eleven days while the dashboards
  // said "0 issues". One tiny event per probe run (48/day) is the cost of
  // knowing. WARN, not FAIL: a quota is a billing decision, not an outage in
  // the handshake itself.
  if (discoveredDsn) {
    const eventId = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const now = new Date().toISOString();
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: now, dsn: `https://${discoveredDsn.key}@${discoveredDsn.host}/${discoveredDsn.project}` }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify({ event_id: eventId, timestamp: now, platform: 'javascript', level: 'info', logger: 'login-bridge-probe',
        message: 'commander.sentry_ingest_check', tags: { app: 'commander', source: 'login-bridge-probe' } }),
    ].join('\n');
    const ing = await http(`https://${discoveredDsn.host}/api/${discoveredDsn.project}/envelope/?sentry_key=${discoveredDsn.key}&sentry_version=7`, {
      method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope' }, body: envelope,
    });
    record(leg, 'Sentry accepts events (alert rules can fire)', ing.status === 200,
      ing.status === 429 ? 'HTTP 429 - error quota exhausted, EVERY Sentry alert is blind until it renews or is raised' : `HTTP ${ing.status}`,
      { warnOnly: true });
  }
}

async function signedInLeg() {
  const leg = 'signed-in';
  const email = process.env.PROBE_EMAIL;
  const password = process.env.PROBE_PASSWORD;
  if (!email || !password) {
    console.log('[SKIP] signed-in :: PROBE_EMAIL / PROBE_PASSWORD not set - structural leg only');
    return;
  }

  // Password grant
  const grant = await http(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON },
    body: JSON.stringify({ email, password }),
  });
  const accessToken = grant.json?.access_token;
  const userId = grant.json?.user?.id;
  if (!record(leg, 'Supabase password grant succeeds', grant.status === 200 && !!accessToken, `status=${grant.status}`)) return;

  // Hub mints a one-time SSO token
  const sso = await http(`${HUB}/api/auth/commander-sso`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body: '{}',
  });
  const ssoUrl = sso.json?.url;
  if (!record(leg, 'hub commander-sso issues a bridge URL', sso.status === 200 && typeof ssoUrl === 'string' && ssoUrl.startsWith(`${CMD}/auth/sso?`), `status=${sso.status}`)) return;
  const u = new URL(ssoUrl);
  const token = u.searchParams.get('token');
  const uid = u.searchParams.get('uid');
  record(leg, 'bridge URL carries token + uid for this user', /^[0-9a-f]{64}$/.test(token || '') && uid === userId);

  // Commander exchanges it (consumes the one-time token)
  const ex = await http(`${CMD}/api/auth/sso-exchange`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, uid }),
  });
  record(leg, 'sso-exchange returns a magic-link OTP payload', ex.status === 200 && !!ex.json?.token && !!ex.json?.email, `status=${ex.status}`);

  const replay = await http(`${CMD}/api/auth/sso-exchange`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, uid }),
  });
  record(leg, 'sso-exchange refuses a replayed token', replay.status === 401, `status=${replay.status}`);

  // Signed staff session from the live token
  const cs = await http(`${CMD}/api/commander/check-subscription`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body: '{}',
  });
  const staff = cs.json?.staff_session;
  const okSub = cs.status === 200 && !!cs.json?.subscription && !!staff?.sig && !!staff?.session_ts;
  if (!record(leg, 'check-subscription issues a SIGNED owner staff session', okSub, `status=${cs.status}${cs.status === 404 ? ' (probe account has no Commander subscription)' : ''}`)) return;

  // Guarded API accepts it...
  const ok = await http(`${CMD}/api/commander/settings`, { headers: { 'x-staff-session': JSON.stringify(staff), authorization: `Bearer ${accessToken}` } });
  record(leg, 'guarded API accepts the signed session (200)', ok.status === 200 && ok.json?.success === true, `status=${ok.status}`);

  // ...and rejects the same session with venue_id edited (the club-switcher bug)
  const tampered = { ...staff, venue_id: Number(staff.venue_id) + 1 };
  const bad = await http(`${CMD}/api/commander/settings`, { headers: { 'x-staff-session': JSON.stringify(tampered), authorization: `Bearer ${accessToken}` } });
  record(leg, 'guarded API rejects a hand-edited session (401)', bad.status === 401, `status=${bad.status}`);
}

function markdownReport() {
  const failed = failures();
  const warned = results.filter((r) => !r.ok && r.warnOnly);
  const lines = [
    `## Login-bridge probe - ${failed.length ? `${failed.length} FAILED` : 'all passed'}${warned.length ? ` (${warned.length} config warning${warned.length > 1 ? 's' : ''})` : ''}`,
    '',
    `Hub: ${HUB}  Commander: ${CMD}  At: ${new Date().toISOString()}`,
    '',
    '| Leg | Check | Result | Detail |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.leg} | ${r.name} | ${r.ok ? 'PASS' : r.warnOnly ? 'WARN' : '**FAIL**'} | ${String(r.detail).replace(/\|/g, '\\|')} |`),
  ];
  return lines.join('\n');
}

(async () => {
  try {
    await structuralLeg();
    await signedInLeg();
  } catch (err) {
    record('probe', 'probe itself completed without throwing', false, err?.message || String(err));
  }
  const md = markdownReport();
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('node:fs');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `report<<PROBE_EOF\n${md}\nPROBE_EOF\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `failed=${failures().length}\n`);
  }
  console.log('\n' + md);
  process.exit(failures().length ? 1 : 0);
})();
