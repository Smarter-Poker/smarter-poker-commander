#!/usr/bin/env node
// Vercel ignore command: 0 skips; 1 builds. Run before installing dependencies.
import { execFileSync } from 'node:child_process';

const finish = (build, reason) => {
  console.log(`[should-build] ${build ? 'BUILD' : 'SKIP'}: ${reason}`);
  process.exit(build ? 1 : 0);
};
if (process.env.VERCEL_ENV === 'preview' &&
    !process.env.VERCEL_GIT_COMMIT_REF?.startsWith('preview/')) {
  finish(false, 'preview requires a preview/ branch');
}

// HEAD~1 can hide an earlier failed/canceled application deployment when the
// newest commit is documentation. Vercel supplies the last successful SHA for
// this project/branch. Without that baseline, no skip is safe.
const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
if (!/^[a-f0-9]{40}$/i.test(previous || '')) finish(true, 'no previous successful deployment');
const git = (...args) => execFileSync('git', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
});
try {
  const head = git('rev-parse', 'HEAD').trim();
  // An explicit redeployment may repair environment/settings without a commit.
  if (head === previous) finish(true, 'explicit redeployment of the same revision');
  try {
    git('cat-file', '-e', `${previous}^{commit}`);
  } catch {
    // Vercel clones only ten commits. Fetch this one known SHA, once, bounded.
    // Never print Git stderr: a remote URL may contain provider credentials.
    git('fetch', '--no-tags', '--depth=1', 'origin', previous);
    git('cat-file', '-e', `${previous}^{commit}`);
  }
  const changed = git('diff', '--name-only', '--no-renames', '-z', previous, head, '--')
    .split('\0').filter(Boolean);
  const documentation = /^(docs\/|references\/|__tests__\/|playwright\/|e2e\/|tests\/|\.github\/)|^(README|CHANGELOG|CONTRIBUTING|AGENTS|AGENT-PLAYBOOK|PUBLISHING|CLAUDE)\.md$/;
  // Exact Node-only delivery tools have no app import/export consumer. Keep
  // neighbouring scripts/vendor paths conservative and the full deployed backlog.
  const tools = new Set(['.husky/pre-push','scripts/ci/execution-preview.mjs',
    'vendor/commander-shared/src/lib/agentExecution.mjs',
    'scripts/vercel-should-build.mjs','scripts/vercel-should-build.sh']);
  const toolChanges = changed.filter(file => tools.has(file));
  if (toolChanges.length) {
    const raw = git('diff','--raw','--no-abbrev','--no-renames','-z',previous,head,'--',...toolChanges);
    const parts = raw.split('\0');
    if (parts.pop() !== '' || parts.length !== toolChanges.length * 2) throw Error('Incomplete tool mode evidence');
    for (let i=0;i<parts.length;i+=2) {
      const mode = /^:(\d{6}) (\d{6}) [0-9a-f]{40} [0-9a-f]{40} [AMD]$/.exec(parts[i]);
      if (!mode || ![mode[1],mode[2]].every(value=>['000000','100644','100755'].includes(value)) || !tools.has(parts[i+1]))
        throw Error('Unknown or nonregular tooling input');
    }
  }
  const appFile = changed.find(file => !documentation.test(file) && !tools.has(file));
  if (appFile) finish(true, `application input changed: ${JSON.stringify(appFile)}`);
  finish(false, `${changed.length} documentation/test/tool changes since ${previous.slice(0, 12)}`);
} catch {
  finish(true, 'Git history unavailable; preserving the application release');
}
