#!/usr/bin/env node
/**
 * VENDOR <-> UPSTREAM RATCHET
 * ═══════════════════════════════════════════════════════════════════════════
 * vendor/commander-shared/ is a COPY of Smarter-Poker/commander-shared. The
 * two trees drifted for weeks: on 2026-09-03 upstream still fabricated HTTP
 * 200s for 401s (a bug the vendor copy lost on 08-20), and every login fix
 * made here that day would have been overwritten by the next sync. Measured
 * 2026-09-04: 47 files / ~2,000 lines apart. Byte-equality cannot be enforced
 * from that starting point, so this is a RATCHET:
 *
 *   - scripts/ci/vendor-upstream-divergence.json lists every vendor file that
 *     is ALLOWED to differ from upstream main (the historical debt), each
 *     with the reason and the direction the fix should go.
 *   - A vendor file that differs from upstream and is NOT in that list fails
 *     CI. The fix is to land the change upstream first (commander-shared PR),
 *     then sync it here (scripts/sync-vendor-from-upstream.sh <path>). Adding
 *     a file to the baseline is possible but is a visible, reviewed choice.
 *   - A baseline entry whose file no longer differs is reported as
 *     RECONCILED so the list only ever shrinks.
 *
 * Upstream is read from:
 *   1. UPSTREAM_DIR (a checkout), else
 *   2. ~/Documents/commander-shared if it exists (agent machines), else
 *   3. a shallow clone of github.com/Smarter-Poker/commander-shared using
 *      GH_PAT / GITHUB_TOKEN (CI).
 *
 * Exit 0 = no new divergence. Exit 1 = new divergence (listed). Exit 2 = could
 * not obtain upstream (CI treats that as failure too: an unverifiable gate is
 * not a gate).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync } from 'fs';
import { join, relative, sep } from 'path';
import { execSync } from 'child_process';
import { tmpdir, homedir } from 'os';
import { createHash } from 'crypto';

const ROOT = process.cwd();
const VENDOR_SRC = process.env.VENDOR_DIR ? join(process.env.VENDOR_DIR, 'src') : join(ROOT, 'vendor/commander-shared/src');
const BASELINE = process.env.BASELINE_FILE || join(ROOT, 'scripts/ci/vendor-upstream-divergence.json');
const UPSTREAM_REPO = 'Smarter-Poker/commander-shared';

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== 'node_modules') out.push(...walk(p)); }
    else if (ent.isFile()) out.push(p);
  }
  return out;
}
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);

function resolveUpstream() {
  if (process.env.UPSTREAM_DIR && existsSync(join(process.env.UPSTREAM_DIR, 'src'))) return join(process.env.UPSTREAM_DIR, 'src');
  const local = join(homedir(), 'Documents/commander-shared');
  if (!process.env.CI && existsSync(join(local, 'src'))) {
    try { execSync('git fetch -q origin main', { cwd: local, stdio: 'ignore' }); } catch { /* offline: use what is there */ }
    const tmp = mkdtempSync(join(tmpdir(), 'cs-upstream-'));
    execSync(`git --work-tree="${tmp}" checkout origin/main -- src package.json`, { cwd: local, stdio: 'ignore' });
    return join(tmp, 'src');
  }
  const token = process.env.GH_PAT || process.env.GITHUB_TOKEN;
  if (!token) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'cs-upstream-'));
  execSync(`git clone -q --depth 1 https://x-access-token:${token}@github.com/${UPSTREAM_REPO}.git "${tmp}"`, { stdio: 'ignore' });
  return join(tmp, 'src');
}

const upstreamSrc = resolveUpstream();
if (!upstreamSrc) {
  console.error('[vendor-upstream] cannot obtain upstream: set UPSTREAM_DIR, or GH_PAT/GITHUB_TOKEN with read access to ' + UPSTREAM_REPO);
  process.exit(2);
}

let baseline = { allowed: {} };
if (existsSync(BASELINE)) baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const allowed = new Map(Object.entries(baseline.allowed || {}));

const vendorFiles = new Map(walk(VENDOR_SRC).map((p) => [relative(VENDOR_SRC, p).split(sep).join('/'), p]));
const upstreamFiles = new Map(walk(upstreamSrc).map((p) => [relative(upstreamSrc, p).split(sep).join('/'), p]));

const divergent = []; // { path, kind }
for (const [rel, vp] of vendorFiles) {
  const up = upstreamFiles.get(rel);
  if (!up) divergent.push({ path: rel, kind: 'vendor-only' });
  else if (sha(vp) !== sha(up)) divergent.push({ path: rel, kind: 'differs' });
}
for (const [rel] of upstreamFiles) {
  if (!vendorFiles.has(rel)) divergent.push({ path: rel, kind: 'upstream-only' });
}

const newDivergence = divergent.filter((d) => !allowed.has(d.path));
const reconciled = [...allowed.keys()].filter((p) => !divergent.some((d) => d.path === p));

console.log(`[vendor-upstream] ${divergent.length} file(s) differ from upstream main; ${allowed.size} allowed by baseline.`);
if (reconciled.length) {
  console.log(`[vendor-upstream] RECONCILED (remove from baseline): ${reconciled.join(', ')}`);
}
if (newDivergence.length) {
  console.error('');
  console.error('[vendor-upstream] NEW DIVERGENCE - a vendor file changed without upstream changing to match:');
  for (const d of newDivergence) console.error(`    ${d.kind.padEnd(13)} vendor/commander-shared/src/${d.path}`);
  console.error('');
  console.error('  Land the change in Smarter-Poker/commander-shared FIRST (PR), then run');
  console.error('    bash scripts/sync-vendor-from-upstream.sh <path>');
  console.error('  If this is a deliberate vendor-only override, add it to');
  console.error('    scripts/ci/vendor-upstream-divergence.json  with a reason and an owner.');
  console.error('  See CLAUDE.md law 3.5.');
  process.exit(1);
}
if (reconciled.length) {
  // Not a failure: upstream merges land on their own schedule and must not
  // turn this repo's main red. Trim the baseline in your next PR.
  console.log('[vendor-upstream] NOTE: trim the reconciled entries above from the baseline (the ratchet only tightens).');
}
console.log('[vendor-upstream] PASSED - no new divergence.');
