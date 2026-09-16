/**
 * LOGIN-BRIDGE PROBE - the core, importable from anywhere that can `fetch`.
 *
 * Two callers share this file:
 *   - scripts/probe-login-bridge.mjs (CLI: GitHub Actions, a laptop)
 *   - pages/api/internal/login-bridge-probe.js (Open Claw on Hetzner calls it
 *     hourly through the hub rewrite; the Claude scheduler is forbidden - hub
 *     CLAUDE.md 10.9 - and a GitHub cron is best-effort)
 *
 * It never reads process.env for credentials itself: the caller passes them,
 * so the API route can use PROBE_LOGIN_EMAIL/PASSWORD while the CLI keeps
 * PROBE_EMAIL/PASSWORD. No secret value is ever written into a result row.
 *
 * What the legs check is documented in scripts/probe-login-bridge.mjs.
 */

export const DEFAULTS = {
  hub: 'https://smarter.poker',
  commander: 'https://commander.smarter.poker',
  supabaseUrl: 'https://kuklfnapbkmacvwxktbh.supabase.co',
  // Publishable key - safe in a client bundle, safe here.
  supabaseAnon: 'sb_publishable__41LpJpzrfrb3hSUpEaYCA_tF53bBJx',
  timeoutMs: 20000,
};

/**
 * @param {object} [opts]
 * @param {string} [opts.hub]
 * @param {string} [opts.commander]
 * @param {string} [opts.supabaseUrl]
 * @param {string} [opts.supabaseAnon]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.email]      signed-in leg runs only when both are set
 * @param {string} [opts.password]
 * @param {(line: string) => void} [opts.log]  defaults to console.log
 * @param {boolean} [opts.local]  the target is a `next start` of THIS commit on
 *   a CI runner with no production secrets (2026-09-04, pull-request gate).
 *   Skips what only production can answer - the hub-origin rows
 *   and the secrets-present health rows become warnings - and
 *   keeps every row that would have caught the 2026-09-03 outage: the login
 *   chunk's free `completeLogin(` call, the bridge, the SSO page, the API 401
 *   contracts. A preview URL cannot be used instead: Vercel SSO-protects
 *   preview deployments on this project.
 * @returns {Promise<{ ok: boolean, results: Array<{leg:string,name:string,ok:boolean,detail:string,warnOnly:boolean}>, failures: Array, warnings: Array, markdown: string, hub: string, commander: string }>}
 */
export async function runLoginBridgeProbe(opts = {}) {
  const HUB = opts.hub || DEFAULTS.hub;
  const CMD = opts.commander || DEFAULTS.commander;
  const SUPABASE_URL = opts.supabaseUrl || DEFAULTS.supabaseUrl;
  const SUPABASE_ANON = opts.supabaseAnon || DEFAULTS.supabaseAnon;
  const TIMEOUT_MS = Number(opts.timeoutMs || DEFAULTS.timeoutMs);
  const LOCAL = opts.local === true;
  const log = typeof opts.log === 'function' ? opts.log : (line) => console.log(line);

  const results = [];
  function record(leg, name, ok, detail = '', { warnOnly = false } = {}) {
    // warnOnly: reported in the table, never counted as a failure. Reserved for
    // configuration the platform CAN run without (it just runs blind) - a probe
    // that is permanently red for a config item stops being read.
    results.push({ leg, name, ok, detail: String(detail ?? ''), warnOnly });
    const mark = ok ? 'PASS' : warnOnly ? 'WARN' : 'FAIL';
    log(`[${mark}] ${leg} :: ${name}${detail ? ` - ${detail}` : ''}`);
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
    // Production pins assetPrefix to the commander origin (absolute URLs); a
    // local `next start` has no prefix, so its chunks are root-relative.
    const cmdLogin = await checkPageAndAssets(leg, `${CMD}/commander/login`, CMD, { mustPointAt: LOCAL ? '/_next/' : `${CMD}/_next/` });
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
      }
    }

    // 2. Hub-origin proxy of the same page (production only: a local build is
    //    not behind the hub rewrite)
    if (!LOCAL) await checkPageAndAssets(leg, `${HUB}/commander/login`, HUB, { mustPointAt: `${CMD}/_next/` });

    // 3. SSO landing page renders
    const sso = await http(`${CMD}/auth/sso`);
    record(leg, '/auth/sso responds 200', sso.status === 200, `status=${sso.status}`);

    // 4. API contracts
    if (LOCAL) {
      // No service-role key on a CI build, so the token lookup cannot run;
      // the format check before it can, and proves the route exists and
      // enforces its contract.
      const ex = await http(`${CMD}/api/auth/sso-exchange`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-token', uid: 'not-a-uuid' }),
      });
      record(leg, 'sso-exchange rejects a malformed token with 400 JSON', ex.status === 400 && !!ex.json?.error, `status=${ex.status} body=${ex.text.slice(0, 80)}`);
    } else {
      const ex = await http(`${CMD}/api/auth/sso-exchange`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: '0'.repeat(64), uid: '00000000-0000-0000-0000-000000000000' }),
      });
      record(leg, 'sso-exchange rejects an unknown token with 401 JSON', ex.status === 401 && !!ex.json?.error, `status=${ex.status} body=${ex.text.slice(0, 80)}`);
    }

    const cs = await http(`${CMD}/api/commander/check-subscription`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    record(leg, 'check-subscription requires auth (401 JSON)', cs.status === 401 && !!cs.json?.error, `status=${cs.status}`);

    if (!LOCAL) {
      const hubSso = await http(`${HUB}/api/auth/commander-sso`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      record(leg, 'hub commander-sso requires auth (401)', hubSso.status === 401, `status=${hubSso.status}`);
    }

    const guarded = await http(`${CMD}/api/commander/settings`, { headers: { 'x-staff-session': JSON.stringify({ user_id: 'x', venue_id: 1, role: 'owner', session_ts: Date.now() }) } });
    record(leg, 'guarded API rejects an UNSIGNED staff session (401)', guarded.status === 401, `status=${guarded.status}`);

    const renewNoAuth = await http(`${CMD}/api/commander/staff-session/renew`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    record(leg, 'staff-session/renew requires a Bearer token (401)', renewNoAuth.status === 401, `status=${renewNoAuth.status}`);

    // 5. Health: secrets present (booleans only)
    const health = await http(`${CMD}/api/health`);
    record(leg, '/api/health responds 200', health.status === 200, `status=${health.status}`);
    if (health.json?.auth) {
      // A CI `next start` has no production secrets: these are warnings there.
      record(leg, 'signing secret configured', health.json.auth.staff_session_secret === true, LOCAL ? 'not expected on a local build' : '', { warnOnly: LOCAL });
      record(leg, 'service-role key configured', health.json.auth.supabase_service_role === true, LOCAL ? 'not expected on a local build' : '', { warnOnly: LOCAL });
      record(leg, 'dedicated staff-session secret configured', health.json.auth.dedicated_staff_session_secret === true, 'set COMMANDER_STAFF_SESSION_SECRET (see docs/runbooks/staff-session-secret-rotation.md, step "first-time setup")', { warnOnly: true });
    } else {
      record(leg, 'health exposes auth booleans', false, 'deploy predates this probe - redeploy');
    }

  }

  async function signedInLeg() {
    const leg = 'signed-in';
    const email = opts.email;
    const password = opts.password;
    if (!email || !password) {
      log('[SKIP] signed-in :: no probe credentials supplied - structural leg only');
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

    // The cheap renew path: same claims, fresh signature, no DB.
    const renew = await http(`${CMD}/api/commander/staff-session/renew`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ session: staff }),
    });
    const renewed = renew.json?.staff_session;
    record(leg, 'staff-session/renew re-signs an authentic session (200)', renew.status === 200 && !!renewed?.sig && renewed.sig !== staff.sig && renewed.user_id === staff.user_id, `status=${renew.status}`);
    const renewBad = await http(`${CMD}/api/commander/staff-session/renew`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ session: tampered }),
    });
    record(leg, 'staff-session/renew refuses a hand-edited session (401)', renewBad.status === 401, `status=${renewBad.status}`);
    if (renewed?.sig) {
      const okRenewed = await http(`${CMD}/api/commander/settings`, { headers: { 'x-staff-session': JSON.stringify(renewed), authorization: `Bearer ${accessToken}` } });
      record(leg, 'guarded API accepts the RENEWED session (200)', okRenewed.status === 200, `status=${okRenewed.status}`);
    }
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

  try {
    await structuralLeg();
    await signedInLeg();
  } catch (err) {
    record('probe', 'probe itself completed without throwing', false, err?.message || String(err));
  }
  const failed = failures();
  return {
    ok: failed.length === 0,
    results,
    failures: failed,
    warnings: results.filter((r) => !r.ok && r.warnOnly),
    markdown: markdownReport(),
    hub: HUB,
    commander: CMD,
  };
}
