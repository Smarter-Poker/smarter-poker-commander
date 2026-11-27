/**
 * tests/module-parse-and-bindings.law.test.mjs
 *
 * Permanent adversarial regression fortress for Commander Vercel build & deploy
 * safety (ported from World Hub incident 86bcafc1 / VercelDeploymentFailed).
 *
 * Proves that scripts/ci/check-module-parse-and-bindings.mjs catches:
 *   1. Syntax errors (including JSX unclosed tags and unclosed JSX comments).
 *   2. Duplicate import bindings (exact 208edab4 #3131+#3136 cross-PR shape).
 *   3. Duplicate top-level & block lexical bindings, duplicate named exports,
 *      and duplicate default exports.
 *   4. Missing, untracked, or Linux case-mismatched local relative imports and
 *      re-exports.
 *   5. Missing, case-mismatched, or missing-export `@/*` path-alias imports and
 *      re-exports honoring Commander's tsconfig.json `["./src/*", "./*"]` paths.
 *   6. Broken or case-mismatched dynamic `import()` and `require()` local/`@/`
 *      paths (while allowing valid dynamic imports and requires).
 *   7. Missing named and default exports from local/`@/` static ESM modules
 *      (allowing TS type exports for .ts/.tsx importers, CJS modules, and
 *      `export * from` barrels).
 *   8. Next.js pages/ extension collisions, pages/ vs app/ route collisions,
 *      getStaticProps+getServerSideProps conflicts, getStaticPaths without
 *      getStaticProps, next/document outside pages/_document.*, and local/@/
 *      global CSS outside pages/_app.* / app/**.
 *   9. Malformed critical config JSON (vercel.json, package.json,
 *      package-lock.json, tsconfig.json) and malformed imported JSON data.
 *  10. Cleanly auto-merged cross-PR collisions and broken config JSON under
 *      strict:false via read-only `git merge-tree --write-tree`.
 *  11. Permanent wiring into both CI (.github/workflows/ci.yml) and local
 *      pre-push (.husky/pre-push), including config-only pushes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  validateModuleTree,
  validateSimulatedMerge,
  validateWorkingTree,
} from '../scripts/ci/check-module-parse-and-bindings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const cleanGitEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith('GIT_') && !['NODE_PATH', 'NODE_OPTIONS'].includes(key),
  ),
);

function makeVirtualTree(fileMap) {
  const allTrackedFiles = Object.keys(fileMap);
  return validateModuleTree({
    allTrackedFiles,
    readFile: (f) => {
      if (!(f in fileMap)) throw new Error(`missing virtual file ${f}`);
      return fileMap[f];
    },
  });
}

test('negative proof: catches JSX syntax errors (unclosed comment & mismatched tag)', () => {
  const res = makeVirtualTree({
    'pages/bad-comment.js':
      'export default function BadComment() { return (<div>{/* unclosed */\n<span>hi</span></div>); }\n',
    'pages/bad-tag.jsx':
      'export default function BadTag() { return (<div><span>hi</div>); }\n',
  });

  const byFile = new Map(res.violations.map((v) => [v.file, v]));
  assert.equal(byFile.get('pages/bad-comment.js')?.kind, 'parse-or-binding-error');
  assert.equal(byFile.get('pages/bad-tag.jsx')?.kind, 'parse-or-binding-error');
});

test('negative proof: catches exact 208edab4 (#3131 + #3136) duplicate import binding', () => {
  const res = makeVirtualTree({
    'src/lib/analytics.mjs': 'export const trackEvent = () => {};\n',
    'src/lib/intro.mjs': 'export const INTRO_REASON = "x";\nexport const trackEvent = () => {};\n',
    'pages/commander/store.js': [
      "import { trackEvent } from '../../src/lib/analytics.mjs';",
      "import React from 'react';",
      'import {',
      '  INTRO_REASON,',
      '  trackEvent,',
      "} from '../../src/lib/intro.mjs';",
      'export default function Store() { return <div data-r={INTRO_REASON} onClick={trackEvent} />; }',
    ].join('\n'),
  });

  assert.equal(res.violations.length, 1);
  assert.equal(res.violations[0].kind, 'parse-or-binding-error');
  assert.equal(res.violations[0].file, 'pages/commander/store.js');
  assert.match(res.violations[0].message, /trackEvent.*already been declared/i);
});

test('negative proof: catches duplicate top-level & block bindings, duplicate named exports, and duplicate default exports', () => {
  const res = makeVirtualTree({
    'src/dup-const.js': 'const limit = 1;\nconst limit = 2;\nexport { limit };\n',
    'src/dup-block.js': 'export function run() { const x = 1; const x = 2; return x; }\n',
    'src/dup-fn.js': 'function helper() { return 1; }\nfunction helper() { return 2; }\nexport { helper };\n',
    'src/dup-export.ts': 'export const a = 1;\nconst b = 2;\nexport { b as a };\n',
    'src/dup-default.jsx':
      'export default function A() { return <div />; }\nexport default function B() { return <span />; }\n',
    'src/ts-overloads-ok.ts':
      'export function fmt(x: number): string;\nexport function fmt(x: string): string;\nexport function fmt(x: number | string): string { return String(x); }\n',
  });

  const byFile = new Map(res.violations.map((v) => [v.file, v]));
  assert.equal(byFile.get('src/dup-const.js')?.kind, 'parse-or-binding-error');
  assert.equal(byFile.get('src/dup-block.js')?.kind, 'parse-or-binding-error');
  assert.equal(byFile.get('src/dup-fn.js')?.kind, 'parse-or-binding-error');
  assert.equal(byFile.get('src/dup-export.ts')?.kind, 'parse-or-binding-error');
  assert.equal(byFile.get('src/dup-default.jsx')?.kind, 'parse-or-binding-error');
  assert.equal(byFile.has('src/ts-overloads-ok.ts'), false, 'TS function overloads must not trigger false duplicates');
});

test('negative proof: catches missing local relative imports and Linux case-mismatched paths', () => {
  const res = makeVirtualTree({
    'src/lib/RealHelper.mjs': 'export const ok = 1;\n',
    'pages/demo.js': [
      "import { ok } from '../src/lib/realhelper.mjs';",
      "import { gone } from '../src/lib/does-not-exist.mjs';",
      'export default function Demo() { return <div>{ok}{gone}</div>; }',
    ].join('\n'),
  });

  const broken = res.violations.filter((v) => v.kind === 'broken-or-case-mismatched-import');
  assert.equal(broken.length, 2);
  assert.ok(broken.some((v) => v.message.includes('realhelper.mjs')));
  assert.ok(broken.some((v) => v.message.includes('does-not-exist.mjs')));
});

test('negative & positive proof: honors Commander tsconfig.json @/* -> ["./src/*", "./*"] and catches broken/case-mismatched alias imports', () => {
  const res = makeVirtualTree({
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        paths: {
          '@/*': ['./src/*', './*'],
        },
      },
    }),
    'src/lib/AliasHelper.mjs': 'export const realValue = 1;\n',
    'pages/shared/RootThing.js': 'export const rootThing = 2;\n',
    'pages/alias-good.js': [
      "import { realValue } from '@/lib/AliasHelper.mjs';",
      "import { realValue as rv2 } from '@/src/lib/AliasHelper.mjs';",
      "import { rootThing } from '@/pages/shared/RootThing';",
      'export default function AliasGood() { return <div>{realValue}{rv2}{rootThing}</div>; }',
    ].join('\n'),
    'pages/alias-bad.js': [
      "import { realValue } from '@/lib/aliashelper.mjs';",
      "import { missingExport } from '@/lib/AliasHelper.mjs';",
      "import { gone } from '@/lib/does-not-exist.mjs';",
      'export default function AliasBad() { return <div>{realValue}{missingExport}{gone}</div>; }',
    ].join('\n'),
    'src/reexport-bad.js': "export * from '@/lib/missing-reexport.mjs';\n",
  });

  assert.equal(
    res.violations.filter((v) => v.file === 'pages/alias-good.js').length,
    0,
    'valid @/lib/* and @/src/* and @/pages/* aliases must pass',
  );

  const broken = res.violations.filter((v) => v.kind === 'broken-or-case-mismatched-import');
  const missingNamed = res.violations.filter((v) => v.kind === 'missing-local-named-export');

  assert.equal(broken.length, 3);
  assert.ok(broken.some((v) => v.message.includes('@/lib/aliashelper.mjs')));
  assert.ok(broken.some((v) => v.message.includes('@/lib/does-not-exist.mjs')));
  assert.ok(broken.some((v) => v.message.includes('@/lib/missing-reexport.mjs')));
  assert.equal(missingNamed.length, 1);
  assert.match(missingNamed[0].message, /missingExport/);
});

test('negative proof: catches broken or case-mismatched dynamic import() and require() paths', () => {
  const res = makeVirtualTree({
    'src/components/RealModal.jsx': 'export default function RealModal() { return <div />; }\n',
    'src/lib/realCjs.cjs': 'module.exports = { ok: true };\n',
    'pages/dynamic-bad.js': [
      "import dynamic from 'next/dynamic';",
      "const BadDyn = dynamic(() => import('../src/components/realmodal.jsx'));",
      "const BadAliasDyn = dynamic(() => import('@/components/MissingModal'));",
      "const badReq = require('../src/lib/missingCjs.cjs');",
      "const goodDyn = () => import('../src/components/RealModal.jsx');",
      "const goodAliasDyn = () => import('@/components/RealModal.jsx');",
      "const goodReq = () => require('../src/lib/realCjs.cjs');",
      'export default function DynPage() { return <div>{BadDyn && BadAliasDyn && badReq && goodDyn && goodAliasDyn && goodReq}</div>; }',
    ].join('\n'),
  });

  const broken = res.violations.filter((v) => v.kind === 'broken-or-case-mismatched-import');
  assert.equal(broken.length, 3);
  assert.ok(broken.some((v) => v.message.includes('realmodal.jsx')));
  assert.ok(broken.some((v) => v.message.includes('@/components/MissingModal')));
  assert.ok(broken.some((v) => v.message.includes('missingCjs.cjs')));
});

test('negative proof: catches missing named & default imports from local/@/ static ESM modules', () => {
  const res = makeVirtualTree({
    'src/lib/store.ts': 'export interface StoreRow { id: string }\nexport const realExport = 42;\n',
    'src/lib/namedOnly.mjs': 'export const alpha = 1;\n',
    'src/lib/hasDefault.mjs': 'export default function ok() { return 1; }\n',
    'src/lib/cjsMod.js': 'module.exports = function legacy() { return 2; };\n',
    'src/lib/reExportAll.mjs': "export * from './hasDefault.mjs';\n",
    'src/good.ts':
      "import { StoreRow, realExport } from './lib/store';\nexport const x: StoreRow = { id: String(realExport) };\n",
    'src/bad-named.js': "import { ghostExport } from './lib/store';\nexport const y = ghostExport;\n",
    'pages/default-check.js': [
      "import NamedOnly from '../src/lib/namedOnly.mjs';",
      "import AliasNamedOnly from '@/lib/namedOnly.mjs';",
      "import GoodDefault from '../src/lib/hasDefault.mjs';",
      "import GoodCjs from '../src/lib/cjsMod.js';",
      "import GoodStar from '../src/lib/reExportAll.mjs';",
      'export default function Page() { return <div>{String(NamedOnly || AliasNamedOnly || GoodDefault || GoodCjs || GoodStar)}</div>; }',
    ].join('\n'),
  });

  const missingNamed = res.violations.filter((v) => v.kind === 'missing-local-named-export');
  assert.equal(missingNamed.length, 1);
  assert.equal(missingNamed[0].file, 'src/bad-named.js');
  assert.match(missingNamed[0].message, /ghostExport/);

  const missingDefaults = res.violations.filter((v) => v.kind === 'missing-local-default-export');
  assert.equal(missingDefaults.length, 2);
  assert.ok(missingDefaults.every((v) => v.file === 'pages/default-check.js'));
});

test('negative proof: catches Next.js route collisions, page data-method conflicts, next/document misuse, and global CSS outside _app', () => {
  const res = makeVirtualTree({
    'styles/global.css': 'body { margin: 0; }\n',
    'styles/card.module.css': '.card { padding: 8px; }\n',
    'pages/_document.js':
      "import { Html, Head, Main, NextScript } from 'next/document';\nexport default function Doc() { return <Html><Head /><body><Main /><NextScript /></body></Html>; }\n",
    'pages/_app.js':
      "import '../styles/global.css';\nexport default function App({ Component, pageProps }) { return <Component {...pageProps} />; }\n",
    'app/layout.tsx':
      "import '../styles/global.css';\nexport default function Layout({ children }: { children: unknown }) { return <div>{children}</div>; }\n",
    'pages/commander/promo.js': 'export default function A() { return <div />; }\n',
    'pages/commander/promo.tsx': 'export default function B() { return <div />; }\n',
    'pages/commander/clash.js': 'export default function C() { return <div />; }\n',
    'app/commander/clash/page.tsx': 'export default function D() { return <div />; }\n',
    'pages/conflict.js': [
      'export async function getStaticProps() { return { props: {} }; }',
      'export async function getServerSideProps() { return { props: {} }; }',
      'export default function Conflict() { return <div />; }',
    ].join('\n'),
    'pages/orphan-paths.js': [
      'export async function getStaticPaths() { return { paths: [], fallback: false }; }',
      'export default function OrphanPaths() { return <div />; }',
    ].join('\n'),
    'pages/bad-doc.js': [
      "import { Html } from 'next/document';",
      'export default function BadDoc() { return <Html />; }',
    ].join('\n'),
    'pages/bad-css.js': [
      "import '../styles/global.css';",
      "import styles from '../styles/card.module.css';",
      'export default function BadCss() { return <div className={styles.card} />; }',
    ].join('\n'),
  });

  const kinds = new Set(res.violations.map((v) => `${v.kind}:${v.file}`));
  assert.ok(res.violations.some((v) => v.kind === 'route-extension-collision'));
  assert.ok(res.violations.some((v) => v.kind === 'app-pages-route-collision'));
  assert.ok(kinds.has('next-page-data-method-conflict:pages/conflict.js'));
  assert.ok(kinds.has('next-page-static-paths-without-props:pages/orphan-paths.js'));
  assert.ok(kinds.has('next-document-import-outside-document:pages/bad-doc.js'));
  assert.ok(kinds.has('next-global-css-outside-app:pages/bad-css.js'));
  assert.equal(res.violations.length, 6, `Expected exactly 6 violations, got: ${JSON.stringify(res.violations)}`);
});

test('negative proof: catches invalid JSON in critical config files and imported JSON data', () => {
  const res = makeVirtualTree({
    'vercel.json': '{ "framework": "nextjs", }\n',
    'package.json': '{ "name": "ok" }\n',
    'package-lock.json': '{ "broken": \n',
    'tsconfig.json': '{ "compilerOptions": { } }\n',
    'src/data/broken.json': '{ "bad": }\n',
    'pages/json-consumer.js':
      "import data from '../src/data/broken.json';\nexport default function P() { return <div>{String(data)}</div>; }\n",
  });

  const badJson = res.violations.filter((v) => v.kind === 'invalid-json');
  assert.equal(badJson.length, 3);
  assert.ok(badJson.some((v) => v.file === 'vercel.json'));
  assert.ok(badJson.some((v) => v.file === 'package-lock.json'));
  assert.ok(badJson.some((v) => v.file === 'src/data/broken.json'));
});

test('integration proof: git merge-tree catches cleanly auto-merged cross-PR duplicate import before merge', (t) => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-merge-tree-guard-'));
  t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));

  const git = (...args) =>
    execFileSync('git', args, {
      cwd: repoDir,
      env: cleanGitEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

  const writeAndCommit = (files, msg) => {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(repoDir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      git('add', '--', rel);
    }
    git('commit', '-m', msg);
  };

  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');

  const pad = Array.from({ length: 30 }, (_, i) => `const filler${i} = ${i};`).join('\n');
  writeAndCommit(
    {
      'src/lib/a.mjs': 'export const trackEvent = () => 1;\n',
      'src/lib/b.mjs': 'export const trackEvent = () => 2;\nexport const other = 3;\n',
      'pages/store.js': `import React from 'react';\n${pad}\nexport default function Store() { return <div />; }\n`,
    },
    'base',
  );

  // Branch B branches from base and adds import near the bottom of header block
  git('checkout', '-b', 'pr-b');
  writeAndCommit(
    {
      'pages/store.js': `import React from 'react';\n${pad}\nimport { trackEvent, other } from '../src/lib/b.mjs';\nconst useB = () => [trackEvent, other];\nexport default function Store() { return <div />; }\n`,
    },
    'pr-b adds import from b.mjs',
  );

  // Meanwhile PR A merges onto main adding import at line 1 -- non-overlapping hunk
  git('checkout', 'main');
  writeAndCommit(
    {
      'pages/store.js': `import { trackEvent } from '../src/lib/a.mjs';\nimport React from 'react';\nconst useA = () => trackEvent;\n${pad}\nexport default function Store() { return <div />; }\n`,
    },
    'pr-a adds import from a.mjs',
  );

  // Switch back to pr-b: on its own, pr-b is 100% syntactically valid
  git('checkout', 'pr-b');
  const soloRes = validateWorkingTree(repoDir);
  assert.equal(soloRes.violations.length, 0, 'pr-b alone is valid');

  // Simulated merge onto main catches the cross-PR SyntaxError BEFORE merge
  // (including when invoked inside a Git hook with GIT_DIR exported in process.env)
  const prevGitDir = process.env.GIT_DIR;
  process.env.GIT_DIR = path.join(ROOT, '.git');
  let mergeRes;
  try {
    mergeRes = validateSimulatedMerge(repoDir, 'main', 'HEAD');
  } finally {
    if (prevGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = prevGitDir;
  }
  assert.equal(mergeRes.skipped, false);
  assert.equal(mergeRes.violations.length, 1);
  assert.equal(mergeRes.violations[0].kind, 'parse-or-binding-error');
  assert.equal(mergeRes.violations[0].file, 'pages/store.js');
  assert.match(mergeRes.violations[0].message, /trackEvent.*already been declared/i);
});

test('integration proof: git merge-tree catches broken vercel.json introduced on a branch', (t) => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-json-merge-guard-'));
  t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));

  const git = (...args) =>
    execFileSync('git', args, {
      cwd: repoDir,
      env: cleanGitEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

  const writeAndCommit = (files, msg) => {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(repoDir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      git('add', '--', rel);
    }
    git('commit', '-m', msg);
  };

  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');

  writeAndCommit(
    {
      'vercel.json': '{"framework":"nextjs"}\n',
      'pages/index.js': 'export default function Home() { return <div />; }\n',
    },
    'base',
  );

  git('checkout', '-b', 'bad-config');
  writeAndCommit({ 'vercel.json': '{"framework":"nextjs",}\n' }, 'break vercel.json');

  git('checkout', 'main');
  writeAndCommit({ 'pages/other.js': 'export default function Other() { return <div />; }\n' }, 'advance main');

  git('checkout', 'bad-config');
  const mergeRes = validateSimulatedMerge(repoDir, 'main', 'HEAD');
  assert.equal(mergeRes.skipped, false);
  assert.ok(mergeRes.violations.some((v) => v.kind === 'invalid-json' && v.file === 'vercel.json'));
});

test('positive proof: Commander working tree passes module parse, binding, export, route & config checks', () => {
  const res = validateWorkingTree(ROOT);
  assert.ok(res.checkedCount > 500, `expected >500 Commander modules scanned, got ${res.checkedCount}`);
  assert.deepEqual(res.violations, [], `Commander working tree has violations: ${JSON.stringify(res.violations)}`);
});

test('wiring proof: AST/merge-tree gate and vercel.json deployability law are wired into CI and pre-push', () => {
  const ciYml = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const prePush = fs.readFileSync(path.join(ROOT, '.husky/pre-push'), 'utf8');

  assert.match(
    ciYml,
    /node --test tests\/vercel-json-is-deployable\.law\.test\.mjs/,
    'ci.yml must run tests/vercel-json-is-deployable.law.test.mjs',
  );
  assert.match(
    ciYml,
    /node scripts\/ci\/check-module-parse-and-bindings\.mjs --merge-against/,
    'ci.yml must execute check-module-parse-and-bindings.mjs with --merge-against',
  );
  assert.match(
    ciYml,
    /node --test tests\/module-parse-and-bindings\.law\.test\.mjs/,
    'ci.yml must run tests/module-parse-and-bindings.law.test.mjs',
  );

  assert.match(
    prePush,
    /vercel-json-is-deployable\.law\.test\.mjs/,
    '.husky/pre-push must run tests/vercel-json-is-deployable.law.test.mjs',
  );
  assert.match(
    prePush,
    /DEPLOY_CONFIG_FILES/,
    '.husky/pre-push must explicitly validate deploy/config JSON changes (vercel.json, package.json, package-lock.json, tsconfig.json)',
  );
  assert.match(
    prePush,
    /check-module-parse-and-bindings\.mjs/,
    '.husky/pre-push must invoke check-module-parse-and-bindings.mjs',
  );
  assert.match(
    prePush,
    /--merge-against refs\/remotes\/origin\/main/,
    '.husky/pre-push must validate simulated merge against refs/remotes/origin/main',
  );
});
