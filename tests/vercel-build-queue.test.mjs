/**
 * ═══ THE BUILD QUEUE MUST BELONG TO PRODUCTION FIRST (Dan 2026-08-30) ══════
 *
 * Measured 2026-08-29/30: a Club Arena fix merged, synced into this repo at
 * 03:55, and did not reach smarter.poker until ~04:20 — the Vercel build
 * concurrency pool was full of PREVIEW builds for `agent/*` branches pushed
 * by other agents in the same minutes. Not merely slow: the production deploy
 * for the sync commit was CANCELED while queued, and the change only shipped
 * by riding a later commit's build.
 *
 * `scripts/vercel-should-build.sh` is Vercel's Ignored Build Step:
 *     exit 0 = SKIP the build, exit 1 = BUILD.
 *
 * These run the REAL script against throwaway git repos, so they pin
 * behaviour rather than wording. The one that matters most is the third:
 * the Club Arena sync lands on main as a PRODUCTION deploy, and if the
 * agent-branch rule were ever applied without the preview check, that is the
 * build that would vanish — taking every Club Arena release with it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../scripts/vercel-should-build.sh');

/**
 * Run the gate in a throwaway repo holding two commits, so the script's own
 * `git diff HEAD~1 HEAD` resolves exactly as it does on Vercel.
 * @returns 0 when the build is SKIPPED, 1 when it PROCEEDS.
 */
function runGate({ env = {}, changedFile = 'pages/index.js', earlierAppChange = false, missingGit = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'should-build-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
  try {
    git('init', '-q');
    git('config', 'user.email', 't@t.t');
    git('config', 'user.name', 't');
    writeFileSync(path.join(dir, 'seed.txt'), 'seed');
    git('add', '-A');
    git('commit', '-qm', 'seed');
    const previous = git('rev-parse', 'HEAD').toString().trim();
    if (earlierAppChange) {
      writeFileSync(path.join(dir, 'app.js'), 'unpublished app change');
      git('add', '-A');
      git('commit', '-qm', 'app before docs');
    }

    const target = path.join(dir, changedFile);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, 'change');
    git('add', '-A');
    git('commit', '-qm', 'change');

    if (missingGit) rmSync(path.join(dir, '.git'), { recursive: true });
    try {
      execFileSync('bash', [SCRIPT], {
        cwd: dir,
        stdio: 'pipe',
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', VERCEL_GIT_PREVIOUS_SHA: previous, ...env },
      });
      return 0;
    } catch (err) {
      return err.status;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PREVIEW = (ref) => ({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: ref });
const PRODUCTION = { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' };

describe('agent branch previews never take a build slot', () => {
  test('an agent/* preview is skipped even though app code changed', () => {
    assert.equal(
      runGate({ env: PREVIEW('agent/cowork-x/fix/thing'), changedFile: 'pages/index.js' }),
      0
    );
  });

  test('production is NEVER skipped by the branch rule', () => {
    assert.equal(runGate({ env: PRODUCTION, changedFile: 'pages/index.js' }), 1);
  });

  // The Club Arena sync is gone (2026-09-03): it publishes to its own origin
  // and this repo carries one rewrite, so no Club Arena release changes a file
  // here and none needs a Vercel build. What still matters is that a real
  // change to THIS repo on main always builds.
  test('THE ONE THAT MATTERS: a change on main still builds', () => {
    assert.equal(
      runGate({ env: PRODUCTION, changedFile: 'next.config.js' }),
      1,
      'a production change was skipped — the World Hub would stop shipping'
    );
  });

  // INVERTED 2026-09-08. These two tests used to assert that a non-agent
  // preview still builds, and that `feat/user-agent-parser` is not an agent
  // branch. Both were correct readings of a deny-list, and the deny-list is
  // what turned out to be wrong: measured that day, 8 of the last 20
  // hub-vanguard deployments were CANCELED, seven of them previews, and 8 of
  // the last 11 pull-request branches were named chore/ feat/ refactor/ perf/
  // fix/ - none of which `agent/*` matched. A deny-list has to name every
  // prefix anyone will ever invent; it was wrong the first time somebody typed
  // a new one. The policy is now an allow-list, so the assertions flip.
  //
  // The substring case is kept, because it still says something true and it
  // still matters: matching must be on the ref SHAPE, not on a substring.
  // `feat/user-agent-parser` is skipped now for being off the allow-list, not
  // for containing the word "agent" - and `preview/user-agent-parser` builds,
  // which is the assertion that proves the difference.
  test('a preview that did not ask for one is skipped', () => {
    assert.equal(runGate({ env: PREVIEW('codex/some-fix'), changedFile: 'pages/index.js' }), 0);
    assert.equal(runGate({ env: PREVIEW('chore/whatever'), changedFile: 'pages/index.js' }), 0);
    assert.equal(runGate({ env: PREVIEW('feat/user-agent-parser'), changedFile: 'pages/index.js' }), 0);
  });

  test('THE OPT-IN: a preview/* branch builds, and asking is the whole mechanism', () => {
    assert.equal(
      runGate({ env: PREVIEW('preview/checking-the-new-header'), changedFile: 'pages/index.js' }),
      1,
      'naming a branch preview/<x> is the documented way to get a preview - if ' +
        'this fails there is no way to get one at all'
    );
    assert.equal(
      runGate({ env: PREVIEW('preview/user-agent-parser'), changedFile: 'pages/index.js' }),
      1,
      'matched on the ref shape, not on a substring anywhere in the name'
    );
  });

  test('an opted-in preview still honours the docs-only saving', () => {
    // Opting in asks for a preview, not for a guaranteed rebuild of an
    // unchanged app: preview/* falls through to the file-diff gate.
    assert.equal(runGate({ env: PREVIEW('preview/typo-fix'), changedFile: 'docs/notes.md' }), 0);
  });

  test('with no Vercel env at all (a local run) nothing is skipped by branch', () => {
    assert.equal(runGate({ env: {}, changedFile: 'pages/index.js' }), 1);
  });
});

describe('the 2026-05-18 docs-only saving is unchanged', () => {
  test('a docs-only production change is still skipped', () => {
    assert.equal(runGate({ env: PRODUCTION, changedFile: 'docs/notes.md' }), 0);
  });

  test('an app-code production change still builds', () => {
    assert.equal(runGate({ env: PRODUCTION, changedFile: 'src/lib/thing.js' }), 1);
  });
});

// Regression: a docs commit must not conceal an unpublished application change.
test('compares the entire change since the last successful deployment', () => {
  assert.equal(runGate({ env: PRODUCTION, changedFile: 'docs/note.md', earlierAppChange: true }), 1);
});
test('unknown history builds rather than silently skipping production', () => {
  assert.equal(runGate({ env: PRODUCTION, changedFile: 'docs/note.md', missingGit: true }), 1);
  assert.equal(runGate({ env: { ...PRODUCTION, VERCEL_GIT_PREVIOUS_SHA: '' }, changedFile: 'docs/note.md' }), 1);
});
test('runtime Markdown is an application input', () => {
  assert.equal(runGate({ env: PRODUCTION, changedFile: 'data/article.md' }), 1);
});
test('Git metadata survives provider filtering and previews are opt-in before queueing', () => {
  const root = path.resolve(HERE, '..');
  const exclusions = readFileSync(path.join(root, '.vercelignore'), 'utf8').split('\n').map(s => s.trim());
  assert.ok(!exclusions.includes('.git/') && !exclusions.includes('/.git/'));
  const config = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.deepEqual(config.git.deploymentEnabled, { '**': false, main: true, 'preview/**': true });
  assert.equal(config.ignoreCommand, 'bash scripts/vercel-should-build.sh');
});

test('a baseline beyond the provider shallow clone is fetched once and compared', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'build-history-'));
  const source = path.join(dir, 'source');
  const clone = path.join(dir, 'clone');
  mkdirSync(source);
  const git = (...args) => execFileSync('git', args, { cwd: source, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
  try {
    git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Build gate test');
    writeFileSync(path.join(source, 'README.md'), 'baseline');
    git('add', '.'); git('commit', '-qm', 'baseline');
    const previous = git('rev-parse', 'HEAD').toString().trim();
    writeFileSync(path.join(source, 'README.md'), 'documentation');
    git('commit', '-qam', 'docs');
    git('clone', '--depth=1', `file://${source}`, clone);
    assert.equal(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: clone }).toString().trim(), '1');
    const run = () => {
      try { execFileSync('bash', [SCRIPT], { cwd: clone, stdio: 'pipe', env: { ...process.env, ...PRODUCTION, VERCEL_GIT_PREVIOUS_SHA: previous } }); return 0; }
      catch (error) { return error.status; }
    };
    assert.equal(run(), 0, 'known documentation changes still skip with shallow history');
    // A deleted application file is a change even when there is no new content.
    writeFileSync(path.join(source, 'app.js'), 'application'); git('add', '.'); git('commit', '-qm', 'app');
    const deployed = git('rev-parse', 'HEAD').toString().trim();
    rmSync(path.join(source, 'app.js')); git('commit', '-qam', 'delete app');
    assert.throws(() => execFileSync('bash', [SCRIPT], { cwd: source, stdio: 'pipe', env: { ...process.env, ...PRODUCTION, VERCEL_GIT_PREVIOUS_SHA: deployed } }), error => error.status === 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
