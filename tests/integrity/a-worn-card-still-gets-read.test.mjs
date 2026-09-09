/**
 * A WORN CARD STILL GETS READ
 *
 * The barcode on the back is the right answer when it scans. It stops
 * scanning on a card that has spent eight years in a wallet, and that card is
 * standing at the desk with its owner. commander-shared reads the printed
 * FRONT in that case; this app is what gives it an engine to read with.
 *
 * These tests hold the wiring to the three things that have already gone
 * wrong once each in this estate:
 *
 *   1. the engine is served from our own origin, not a CDN;
 *   2. it is copied by the build that ACTUALLY DEPLOYS, not only by prebuild,
 *      which is how the barcode decoder shipped with its wasm 404ing;
 *   3. it is cached immutably, so a tablet that has loaded it once keeps
 *      reading with no signal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('ID capture registers a face reader, not only a barcode decoder', () => {
    const entry = read('src/components/commander/members/AddMemberModal.jsx');
    assert.match(entry, /import '\.\.\/\.\.\/\.\.\/lib\/idscan\/registerPdf417Fallback'/);
    assert.match(entry, /import '\.\.\/\.\.\/\.\.\/lib\/idscan\/registerFaceReader'/,
        'a worn card has nothing to fall back to without this');
});

test('the engine is loaded lazily, so a room whose cards all scan never pays for it', () => {
    const reg = read('src/lib/idscan/registerFaceReader.js');
    assert.match(reg, /\{ lazy: true \}/, 'the loader runs on the first failure, not at import');
    assert.match(reg, /await import\('tesseract\.js'\)/, 'a dynamic import keeps it out of the initial bundle');
    // Registered once, whatever calls it.
    assert.match(reg, /if \(registered\) return;/);
});

test('the engine comes from our own origin, never a CDN', () => {
    const reg = read('src/lib/idscan/registerFaceReader.js');
    // tesseract.js defaults every path to jsdelivr. An ID reader that depends
    // on a third-party host is an ID reader that stops working when that host
    // does, and the room has no other way to take a member's details.
    assert.match(reg, /workerPath: `\$\{TESSERACT_BASE\}\/worker\.min\.js`/);
    assert.match(reg, /corePath: `\$\{TESSERACT_BASE\}\/`/);
    assert.match(reg, /langPath: `\$\{TESSERACT_BASE\}\/lang`/);
    assert.doesNotMatch(reg, /jsdelivr|unpkg|cdn\./i);
    assert.doesNotMatch(reg, /https?:\/\//);
});

test('the version the code asks for is the version the build writes', () => {
    // A drift is a 404 for every asset and a fallback that silently never
    // fires. The barcode decoder shipped exactly that way.
    const reg = read('src/lib/idscan/registerFaceReader.js');
    const declared = reg.match(/export const TESSERACT_VERSION = '([\d.]+)'/);
    assert.ok(declared, 'the version must be a constant');
    const installed = JSON.parse(read('node_modules/tesseract.js/package.json')).version;
    assert.equal(declared[1], installed, 'the constant and the installed package must agree');
    const copy = read('scripts/copy-tesseract-assets.mjs');
    assert.match(copy, /OUT_DIR = `public\/tesseract\/\$\{VERSION\}`/);
    assert.match(copy, /node_modules', 'tesseract\.js', 'package\.json'/, 'the script reads the version, never hardcodes it');
});

test('every asset the engine asks for is one the script writes', () => {
    const copy = read('scripts/copy-tesseract-assets.mjs');
    assert.match(copy, /'tesseract\.js\/dist\/worker\.min\.js', 'worker\.min\.js'/);
    assert.match(copy, /'lang\/eng\.traineddata\.gz'/);
    // Three cores: the device picks one at runtime, and shipping fewer means
    // the tablets that need the others get nothing.
    // Distinct names: each entry names the file twice, from and to.
    const cores = new Set(copy.match(/tesseract-core-[a-z-]*lstm\.wasm\.js/g) || []);
    assert.equal(cores.size, 3, `expected three distinct cores, found ${[...cores].join(', ')}`);
    assert.match(copy, /process\.exit\(1\)/, 'a missing asset must fail the build, not ship a dead reader');
});

test('the copy runs in the build that actually deploys', () => {
    // package.json's prebuild is not enough and this repo has the scar: the
    // barcode wasm was wired into prebuild alone and 404'd in production for
    // weeks, because vercel.json calls `next build` directly and npm does not
    // run a hook for a command nobody asked it to run.
    const vercel = JSON.parse(read('vercel.json'));
    assert.match(vercel.buildCommand, /copy-tesseract-assets\.mjs/);
    const copyAt = vercel.buildCommand.indexOf('copy-tesseract-assets.mjs');
    const buildAt = vercel.buildCommand.indexOf('next build');
    assert.ok(copyAt >= 0 && buildAt >= 0 && copyAt < buildAt, 'and before next build collects public/');
    const pkg = JSON.parse(read('package.json'));
    assert.match(pkg.scripts.prebuild, /copy-tesseract-assets\.mjs/, 'a local build must generate it too');
});

test('the engine is cached so a tablet with no signal keeps reading', () => {
    const vercel = JSON.parse(read('vercel.json'));
    const rule = (vercel.headers || []).find((h) => h.source === '/tesseract/(.*)');
    assert.ok(rule, 'Vercel serves public/ as max-age=0, must-revalidate without this');
    const cc = rule.headers.find((h) => /^cache-control$/i.test(h.key));
    assert.match(cc.value, /\bimmutable\b/);
    assert.doesNotMatch(cc.value, /must-revalidate|max-age=0/);
});

test('the worker is released, because a tablet does not have the memory to leak', () => {
    const reg = read('src/lib/idscan/registerFaceReader.js');
    assert.match(reg, /export async function releaseFaceReader/);
    assert.match(reg, /held\.terminate\(\)/);
});

test('the shared facade is vendored, so the import resolves', () => {
    assert.ok(existsSync(join(ROOT, 'vendor/commander-shared/src/lib/idscan/licenceFace.mjs')),
        'the app imports this; without the vendored copy the build fails');
    const reg = read('src/lib/idscan/registerFaceReader.js');
    assert.match(reg, /@smarter-poker\/commander-shared\/lib\/idscan\/licenceFace\.mjs/);
});
