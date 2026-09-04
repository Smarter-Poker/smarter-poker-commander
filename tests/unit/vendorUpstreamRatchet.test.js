/**
 * The vendor <-> upstream ratchet (scripts/check-vendor-upstream-sync.mjs)
 * must fail on NEW divergence, pass on baselined divergence, and never fail
 * merely because a baselined file was reconciled. Exercised against throwaway
 * fixture trees so it needs no network and no upstream checkout.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

function fixture({ vendor, upstream, baseline }) {
  const root = mkdtempSync(join(tmpdir(), 'ratchet-'));
  const write = (base, files) => {
    for (const [rel, content] of Object.entries(files)) {
      const p = join(base, 'src', rel);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, content);
    }
  };
  write(join(root, 'vendor'), vendor);
  write(join(root, 'upstream'), upstream);
  const baselineFile = join(root, 'baseline.json');
  writeFileSync(baselineFile, JSON.stringify({ allowed: baseline || {} }));
  return { root, baselineFile };
}

function run(fx) {
  return spawnSync('node', ['scripts/check-vendor-upstream-sync.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, VENDOR_DIR: join(fx.root, 'vendor'), UPSTREAM_DIR: join(fx.root, 'upstream'), BASELINE_FILE: fx.baselineFile, CI: '1' },
  });
}

describe('vendor <-> upstream ratchet', () => {
  it('passes when the trees are identical', () => {
    const fx = fixture({ vendor: { 'a.js': 'x' }, upstream: { 'a.js': 'x' } });
    const r = run(fx);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/PASSED/);
  });

  it('fails on a vendor file that differs and is not baselined (differs, vendor-only, upstream-only)', () => {
    const fx = fixture({ vendor: { 'a.js': 'x', 'only-here.js': 'v' }, upstream: { 'a.js': 'y', 'only-there.js': 'u' } });
    const r = run(fx);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEW DIVERGENCE/);
    expect(r.stderr).toMatch(/differs\s+vendor\/commander-shared\/src\/a\.js/);
    expect(r.stderr).toMatch(/vendor-only\s+vendor\/commander-shared\/src\/only-here\.js/);
    expect(r.stderr).toMatch(/upstream-only\s+vendor\/commander-shared\/src\/only-there\.js/);
  });

  it('passes when every divergence is baselined, and only reports a reconciled entry', () => {
    const fx = fixture({
      vendor: { 'a.js': 'x', 'b.js': 'same' }, upstream: { 'a.js': 'y', 'b.js': 'same' },
      baseline: { 'a.js': { kind: 'differs', reason: 'test' }, 'b.js': { kind: 'differs', reason: 'reconciled since' } },
    });
    const r = run(fx);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/RECONCILED.*b\.js/);
    expect(r.stdout).toMatch(/PASSED/);
  });

  it('exits 2 (not silently green) when upstream cannot be obtained', () => {
    const fx = fixture({ vendor: { 'a.js': 'x' }, upstream: {} });
    const r = spawnSync('node', ['scripts/check-vendor-upstream-sync.mjs'], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, VENDOR_DIR: join(fx.root, 'vendor'), UPSTREAM_DIR: join(fx.root, 'does-not-exist'), BASELINE_FILE: fx.baselineFile, CI: '1', GH_PAT: '', GITHUB_TOKEN: '' },
    });
    expect(r.status).toBe(2);
  });

  it('the real baseline is well-formed and every entry names a reason', () => {
    const doc = JSON.parse(require('fs').readFileSync('scripts/ci/vendor-upstream-divergence.json', 'utf8'));
    for (const [path, entry] of Object.entries(doc.allowed)) {
      expect(entry.reason, path).toBeTruthy();
      expect(['differs', 'vendor-only', 'upstream-only']).toContain(entry.kind);
    }
  });
});
