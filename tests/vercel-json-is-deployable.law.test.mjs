// ----------------------------------------------------------------------------
// vercel.json IS DEPLOYABLE (Commander law, ported from World Hub 2026-09-08)
//
// A schema-invalid vercel.json does not fail a check, fail a build, or produce
// a build log. It fails the DEPLOYMENT, instantly, with no output at all --
// which means main stops publishing while CI ticks stay green.
//
// This law test runs with zero external npm dependencies so it executes both
// in local pre-push (including config-only pushes) and early in CI before npm
// install.
// ----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

// Vercel's route-object & top-level schema. Anything else is rejected at deploy time.
export const ALLOWED_TOP_LEVEL_KEYS = new Set([
  '$schema',
  'alias',
  'build',
  'buildCommand',
  'builds',
  'cleanUrls',
  'crons',
  'devCommand',
  'env',
  'fluid',
  'framework',
  'functions',
  'git',
  'github',
  'headers',
  'ignoreCommand',
  'images',
  'installCommand',
  'name',
  'outputDirectory',
  'public',
  'redirects',
  'regions',
  'rewrites',
  'routes',
  'scope',
  'trailingSlash',
  'version',
]);
export const ALLOWED_HEADER_KEYS = new Set(['source', 'headers', 'has', 'missing']);
export const ALLOWED_REWRITE_KEYS = new Set(['source', 'destination', 'has', 'missing']);
export const ALLOWED_REDIRECT_KEYS = new Set([
  'source',
  'destination',
  'permanent',
  'statusCode',
  'has',
  'missing',
  'basePath',
  'locale',
]);
export const ALLOWED_CRON_KEYS = new Set(['path', 'schedule']);

export const MAX_LENGTH = {
  buildCommand: 256,
  installCommand: 256,
  devCommand: 256,
  ignoreCommand: 256,
  outputDirectory: 256,
};

test('no top-level property in vercel.json will be refused by Vercel schema validation', () => {
  const offenders = Object.keys(vercel).filter((k) => !ALLOWED_TOP_LEVEL_KEYS.has(k));
  assert.deepEqual(
    offenders,
    [],
    `Unknown top-level vercel.json key(s) will fail deploy schema validation before build starts: ${offenders.join(', ')}`,
  );
});

test('no header entry carries a property Vercel will refuse', () => {
  const offenders = [];
  (vercel.headers ?? []).forEach((entry, i) => {
    for (const key of Object.keys(entry)) {
      if (!ALLOWED_HEADER_KEYS.has(key)) offenders.push(`headers[${i}].${key} (source: ${entry.source})`);
    }
  });
  assert.deepEqual(
    offenders,
    [],
    'These keys will fail deployment schema validation before a build starts, ' +
      'with no build log to read:\n  ' +
      offenders.join('\n  ') +
      '\n\nvercel.json has no comment syntax. Put the reasoning in a test like ' +
      'this one, or in the commit message - not in the config.',
  );
});

test('no rewrite, redirect, or cron entry carries a property Vercel will refuse', () => {
  const offenders = [];
  (vercel.rewrites ?? []).forEach((e, i) => {
    for (const k of Object.keys(e)) if (!ALLOWED_REWRITE_KEYS.has(k)) offenders.push(`rewrites[${i}].${k}`);
  });
  (vercel.redirects ?? []).forEach((e, i) => {
    for (const k of Object.keys(e)) if (!ALLOWED_REDIRECT_KEYS.has(k)) offenders.push(`redirects[${i}].${k}`);
  });
  (vercel.crons ?? []).forEach((e, i) => {
    for (const k of Object.keys(e)) if (!ALLOWED_CRON_KEYS.has(k)) offenders.push(`crons[${i}].${k}`);
  });
  assert.deepEqual(offenders, [], `unknown keys: ${offenders.join(', ')}`);
});

test('every header entry is actually shaped like a header entry', () => {
  (vercel.headers ?? []).forEach((entry, i) => {
    assert.equal(typeof entry.source, 'string', `headers[${i}].source must be a string`);
    assert.ok(Array.isArray(entry.headers), `headers[${i}].headers must be an array`);
    entry.headers.forEach((h, j) => {
      assert.equal(typeof h.key, 'string', `headers[${i}].headers[${j}].key`);
      assert.equal(typeof h.value, 'string', `headers[${i}].headers[${j}].value`);
    });
  });
});

test('every vercel.json cron has a unique path resolving to a real API handler and valid 5-field schedule', () => {
  const seen = new Set();
  const missingRoutes = [];
  const badSchedules = [];
  const duplicates = [];

  for (const cron of vercel.crons ?? []) {
    assert.equal(typeof cron.path, 'string', 'cron.path must be a string');
    assert.ok(cron.path.startsWith('/'), `cron.path must start with /: ${cron.path}`);
    assert.equal(typeof cron.schedule, 'string', `cron.schedule must be a string for ${cron.path}`);

    if (seen.has(cron.path)) {
      duplicates.push(cron.path);
    }
    seen.add(cron.path);

    const fields = cron.schedule.trim().split(/\s+/);
    if (fields.length !== 5 || fields.some((f) => !/^[0-9*,/-]+$/.test(f))) {
      badSchedules.push(`${cron.path}: "${cron.schedule}"`);
    }

    const clean = cron.path.split('?')[0].replace(/^\//, '');
    const candidates = [
      `pages/${clean}.js`,
      `pages/${clean}.ts`,
      `pages/${clean}.mjs`,
      `pages/${clean}/index.js`,
      `pages/${clean}/index.ts`,
      `app/${clean}/route.js`,
      `app/${clean}/route.ts`,
    ];
    if (!candidates.some((rel) => existsSync(join(ROOT, rel)))) {
      missingRoutes.push(cron.path);
    }
  }

  assert.deepEqual(duplicates, [], `Duplicate vercel.json cron path(s): ${duplicates.join(', ')}`);
  assert.deepEqual(badSchedules, [], `Invalid 5-field vercel.json cron schedule(s): ${badSchedules.join(', ')}`);
  assert.deepEqual(
    missingRoutes,
    [],
    `vercel.json cron path(s) have no matching pages/api or app/api route: ${missingRoutes.join(', ')}`,
  );
});

test('no command in vercel.json is longer than the schema allows', () => {
  for (const [field, max] of Object.entries(MAX_LENGTH)) {
    const value = vercel[field];
    if (typeof value !== 'string') continue;
    assert.ok(
      value.length <= max,
      `${field} is ${value.length} characters, and Vercel refuses the whole deployment above ${max}. ` +
        'Move the steps into one script rather than chaining another into the command.',
    );
  }
});

test('Commander vercel.json buildCommand preserves required asset copies before next build', () => {
  assert.equal(vercel.framework, 'nextjs');
  assert.equal(typeof vercel.buildCommand, 'string');
  const zxingAt = vercel.buildCommand.indexOf('copy-zxing-wasm.mjs');
  const tesseractAt = vercel.buildCommand.indexOf('copy-tesseract-assets.mjs');
  const buildAt = vercel.buildCommand.indexOf('next build');
  assert.ok(zxingAt >= 0, 'vercel.json buildCommand must run copy-zxing-wasm.mjs');
  assert.ok(tesseractAt >= 0, 'vercel.json buildCommand must run copy-tesseract-assets.mjs');
  assert.ok(buildAt >= 0, 'vercel.json buildCommand must invoke next build');
  assert.ok(zxingAt < buildAt && tesseractAt < buildAt, 'asset copy scripts must run before next build');
  assert.match(pkg.scripts?.prebuild ?? '', /copy-zxing-wasm\.mjs/);
  assert.match(pkg.scripts?.prebuild ?? '', /copy-tesseract-assets\.mjs/);
});

test('tsconfig.json is valid JSON', () => {
  const tsconfig = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8'));
  assert.ok(tsconfig && typeof tsconfig === 'object');
  assert.ok(tsconfig.compilerOptions && typeof tsconfig.compilerOptions === 'object');
});

test('package.json and package-lock.json root dependency specifiers stay in sync for Vercel installs', () => {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const rootLock = lock.packages?.[''];
  assert.ok(rootLock && typeof rootLock === 'object', 'package-lock.json must contain packages[""] root metadata');

  const mismatches = [];
  for (const section of ['dependencies', 'devDependencies']) {
    const pkgDeps = pkg[section] || {};
    const lockDeps = rootLock[section] || {};
    for (const [name, spec] of Object.entries(pkgDeps)) {
      if (lockDeps[name] !== spec) {
        mismatches.push(
          `${section}.${name}: package.json="${spec}" vs package-lock.json="${lockDeps[name] ?? '<missing>'}"`,
        );
      }
    }
    for (const name of Object.keys(lockDeps)) {
      if (!(name in pkgDeps)) {
        mismatches.push(
          `${section}.${name}: present in package-lock.json ("${lockDeps[name]}") but missing from package.json`,
        );
      }
    }
  }
  assert.deepEqual(
    mismatches,
    [],
    'package.json and package-lock.json are out of sync (cached CI can miss this while Vercel installs fail):\n  ' +
      mismatches.join('\n  '),
  );
});
