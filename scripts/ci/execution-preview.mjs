import { execFileSync } from 'node:child_process';
import { writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectCandidate, classifyDelivery } from '../../docs/agent-policy/agent-policy.mjs';
import { inputFingerprint } from '../../vendor/commander-shared/src/lib/agentExecution.mjs';
const root = process.cwd();
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', timeout: 30000 }).trim();
let candidate;
try { candidate = inspectCandidate(root, process.env.CI_BASE_SHA || 'origin/main', process.env.CI_HEAD_SHA || 'HEAD'); }
catch { candidate = { delivery: { components: ['unclassified'] }, paths: null, status: 'unknown' }; }
if (process.argv.includes('--working-tree') && candidate.paths) {
  try {
    const pending = git('diff', '--name-only', '--no-renames', '-z', 'HEAD', '--').split('\0').filter(Boolean);
    const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
    candidate.paths = [...new Set([...candidate.paths, ...pending, ...untracked])].sort();
    candidate.delivery = classifyDelivery(candidate.paths);
    candidate.source = 'working-tree-advisory-only';
  } catch { candidate = { delivery: { components: ['unclassified'] }, paths: null, status: 'unknown' }; }
}
const plan = {
  version: 1, mode: 'shadow', candidate,
  adapterFingerprint: inputFingerprint(root, {
    inputs: ['.husky/pre-push', 'scripts/ci/execution-preview.mjs',
      'docs/agent-policy/agent-policy.mjs', 'vendor/commander-shared/src/lib/agentExecution.mjs'],
    command: ['execution-preview'], runtime: process.version,
    environment: `${process.platform}/${process.arch}`, schema: 'preview-only-no-gate-reuse',
  }),
  checkSelection: 'Existing repository hooks and protected workflow retain authority',
  scopeExpansion: candidate.paths?.filter(path => /^(\.github|\.husky|package(?:-lock)?\.json)/.test(path)) ?? null,
  access: 'unknown_until_authenticated_provider_readback', estimates: null,
  limitation: 'Preview only. No skipped checks, release actions, token-price guesses or new approval gate.',
};
const summary = `Execution preview (shadow): ${candidate.delivery.components.join(', ')}; existing required checks unchanged.`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${summary}\n`);
else {
  const file = resolve(root, git('rev-parse', '--git-path', 'agent-execution-plan.json'));
  const temporary = `${file}.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, file);
}
