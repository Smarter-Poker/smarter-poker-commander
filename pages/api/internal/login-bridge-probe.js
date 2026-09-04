/**
 * GET /api/internal/login-bridge-probe
 *
 * The login-bridge probe as an HTTP job, so Open Claw on Hetzner can run it on
 * a real cron (hub CLAUDE.md 10.9: nothing critical on the Claude scheduler;
 * 11: every scheduled application trigger goes through Open Claw). Reached via
 * the hub rewrite as https://smarter.poker/api/commander/internal/login-bridge-probe
 * with `Authorization: Bearer <CRON_SECRET>` - the same bearer every Open Claw
 * job carries. The GitHub Actions workflow (login-bridge-probe.yml) keeps
 * running as the secondary schedule and is the one that files issues.
 *
 * Auth: CRON_SECRET must be set on THIS Vercel project with the same value as
 * hub-vanguard (Dan-only: it is a `sensitive` env there). Until it is, this
 * route answers 503 and the dispatcher journal shows it - a loud, honest
 * "not configured", never a silent pass.
 *
 * Credentials for the signed-in leg come from PROBE_LOGIN_EMAIL /
 * PROBE_LOGIN_PASSWORD (already set on the project). No secret value ever
 * appears in the response.
 *
 * Response: 200 when every check passed (config warnings allowed), 500 with
 * the failing rows when any check failed. Failures are also reported to
 * Sentry as `commander.probe.login_bridge_failed` (tag probe=login-bridge) so
 * the existing auth alert rules have a signal even when nobody reads the
 * dispatcher journal.
 */
import crypto from 'crypto';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '../../../src/lib/supabaseServerClient';
import { runLoginBridgeProbe } from '../../../src/lib/probe/loginBridgeProbe.mjs';

/**
 * The hub's cron routes record every run in `cron_execution_log` (job_name =
 * path without the /api prefix). The hub's liveness and staleness watchdogs
 * read that table, so this route writes the same row for itself: the hub path
 * is /api/commander/internal/login-bridge-probe, hence the job name below. A
 * probe nobody can see failing is the failure mode this whole thing exists to
 * end. Fail-open: telemetry never changes the probe's answer.
 */
export const CRON_JOB_NAME = '/commander/internal/login-bridge-probe';

async function recordRun({ startedAt, ok, summary, error }) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: dbErr } = await client
      .from('cron_execution_log')
      .insert({
        job_name: CRON_JOB_NAME,
        status: ok ? 'success' : 'error',
        started_at: new Date(startedAt).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        result: summary,
        error: error || null,
      })
      .abortSignal(AbortSignal.timeout(4000));
    if (dbErr) console.warn('[login-bridge-probe] telemetry write failed:', dbErr.message);
  } catch (err) {
    console.warn('[login-bridge-probe] telemetry write failed:', err?.message || err);
  }
}

// The full probe (two legs, ~25 HTTP calls) takes 10-30 s against production.
export const config = { maxDuration: 60 };

function bearerMatches(req, secret) {
  const header = String(req.headers.authorization || '');
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented || !secret) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({
      ok: false,
      error: 'CRON_SECRET is not configured on the commander project; set it to the hub-vanguard value',
    });
  }
  if (!bearerMatches(req, secret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startedAt = Date.now();
  const lines = [];
  const report = await runLoginBridgeProbe({
    email: process.env.PROBE_LOGIN_EMAIL,
    password: process.env.PROBE_LOGIN_PASSWORD,
    timeoutMs: 15000,
    log: (line) => lines.push(line),
  });
  const elapsedMs = Date.now() - startedAt;
  const signedIn = report.results.some((r) => r.leg === 'signed-in');

  const summary = {
    ok: report.ok,
    passed: report.results.filter((r) => r.ok).length,
    failed: report.failures.length,
    warnings: report.warnings.map((r) => ({ name: r.name, detail: r.detail })),
    signed_in_leg: signedIn,
    elapsed_ms: elapsedMs,
    at: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 8) ?? 'local',
  };

  if (!report.ok) {
    try {
      Sentry.withScope((scope) => {
        scope.setTag('app', 'commander');
        scope.setTag('probe', 'login-bridge');
        scope.setTag('flow', 'probe');
        scope.setLevel('error');
        scope.setExtra('failures', report.failures.map((r) => `${r.leg} :: ${r.name} - ${r.detail}`));
        scope.setExtra('markdown', report.markdown);
        scope.setFingerprint(['commander.probe.login_bridge_failed']);
        Sentry.captureMessage('commander.probe.login_bridge_failed', 'error');
      });
      await Sentry.flush(2000);
    } catch { /* observability must never break the probe */ }
    console.error('[login-bridge-probe] FAILED\n' + report.markdown);
    await recordRun({
      startedAt, ok: false, summary,
      error: report.failures.map((r) => `${r.leg} :: ${r.name} - ${r.detail}`).join('; ').slice(0, 500),
    });
    return res.status(500).json({
      ...summary,
      failures: report.failures.map((r) => ({ leg: r.leg, name: r.name, detail: r.detail })),
      markdown: report.markdown,
    });
  }

  console.log(`[login-bridge-probe] ok passed=${summary.passed} warnings=${summary.warnings.length} signedIn=${signedIn} ${elapsedMs}ms`);
  await recordRun({ startedAt, ok: true, summary });
  return res.status(200).json(summary);
}
