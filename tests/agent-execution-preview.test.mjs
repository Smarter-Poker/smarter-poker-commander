import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const root = new URL('../', import.meta.url);
const inputs = ['scripts/ci/execution-preview.mjs', '.husky/pre-push',
  'docs/agent-policy/agent-policy.mjs', 'vendor/commander-shared/src/lib/agentExecution.mjs'];
test('consumer preview records the actual candidate without executing publication', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'consumer-preview-'));
  const git = (...args) => execFileSync('git', args, { cwd: fixture, env: cleanEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    for (const path of inputs) {
      mkdirSync(join(fixture, path, '..'), { recursive: true });
      writeFileSync(join(fixture, path), readFileSync(new URL(path, root)));
    }
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'baseline');
    const base = git('rev-parse', 'HEAD');
    mkdirSync(join(fixture, 'src'));
    writeFileSync(join(fixture, 'src/example.js'), 'export const example = 1;');
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'client');
    const head = git('rev-parse', 'HEAD');
    const env = { ...cleanEnv, CI_BASE_SHA: base, CI_HEAD_SHA: head };
    delete env.GITHUB_STEP_SUMMARY;
    execFileSync(process.execPath, ['scripts/ci/execution-preview.mjs'], { cwd: fixture, env, stdio: 'pipe' });
    const plan = JSON.parse(readFileSync(join(fixture, '.git/agent-execution-plan.json')));
    assert.equal(plan.candidate.head, head);
    assert.deepEqual(plan.candidate.delivery.components, ['client']);
    assert.equal(plan.mode, 'shadow');
    assert.equal(plan.inventory.checks.length, 5);
    assert.equal(plan.dependencyPreview.checks.find(c=>c.id==='ci-build').selected,true);
    assert.ok(plan.dependencyPreview.overlap.some(row=>row.checks.includes('production-build')));
    assert.equal(plan.dependencyPreview.estimatedSeconds,null);
    assert.match(plan.adapterFingerprint, /^[0-9a-f]{64}$/);
    assert.equal(git('rev-parse', 'HEAD'), head);
    mkdirSync(join(fixture, 'supabase'));
    writeFileSync(join(fixture, 'supabase/pending.sql'), 'select 1;');
    execFileSync(process.execPath, ['scripts/ci/execution-preview.mjs', '--working-tree'], { cwd: fixture, env, stdio: 'pipe' });
    const working = JSON.parse(readFileSync(join(fixture, '.git/agent-execution-plan.json')));
    assert.ok(working.candidate.delivery.components.includes('database'));
    assert.equal(working.candidate.source, 'working-tree-advisory-only');
    execFileSync(process.execPath, ['scripts/ci/execution-preview.mjs'], {
      cwd: fixture, env: { ...env, CI_BASE_SHA: 'unreadable' }, stdio: 'pipe',
    });
    const unknown = JSON.parse(readFileSync(join(fixture, '.git/agent-execution-plan.json')));
    assert.equal(unknown.candidate.status, 'unknown');
    assert.equal(unknown.dependencyPreview.checks.every(c=>c.selected),true);
    assert.deepEqual(unknown.candidate.delivery.components, ['unclassified']);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
test('consumer precheck signal cannot become a passed receipt', () => {
  const hook = readFileSync(new URL('.husky/pre-push', root), 'utf8');
  const traps = hook.match(/^trap 'exit (?:129|130|143)' (?:HUP|INT|TERM)$/gm);
  assert.equal(traps?.length, 3);
  for (const [signal, code] of [['HUP',129], ['INT',130], ['TERM',143]]) {
    try {
      execFileSync('sh', ['-c', `trap 'rc=$?; printf "%s" "$rc"' EXIT\n${traps.join('\n')}\nkill -${signal} $$`]);
      assert.fail('interruption passed');
    } catch (error) { assert.equal(error.status, code); assert.equal(error.stdout.toString(), String(code)); }
  }
});
