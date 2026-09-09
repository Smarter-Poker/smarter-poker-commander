#!/usr/bin/env node
/**
 * PUT THE OCR ENGINE WHERE THE BROWSER CAN FETCH IT.
 *
 * Same problem as the barcode decoder, same answer. tesseract.js ships its
 * worker, its WebAssembly cores and its language model inside the package and
 * defaults every path to a CDN. A room whose ID reader stops working because
 * somebody else's host is down is not an ID reader, so the files are copied
 * out and located explicitly.
 *
 * THE VERSION IS IN THE PATH. That is what lets vercel.json serve these
 * `immutable`, and immutable is what lets a tablet that has already loaded
 * the engine keep reading with no signal. Without it the browser must
 * revalidate, and a tablet with no network cannot.
 *
 * THREE CORES, and that is not a mistake: tesseract.js picks one at runtime
 * from what the device's WebAssembly can do. Ship fewer and the tablets that
 * need the others get nothing. Each browser downloads exactly one.
 *
 * Run by `prebuild` AND by the vercel.json buildCommand, because only one of
 * those is the build that deploys. The barcode decoder learned that the hard
 * way: it shipped for weeks with its wasm 404ing in production because it was
 * wired into prebuild alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESSERACT_ROOT = path.join(ROOT, 'public', 'tesseract');

function engineVersion() {
    const installed = path.join(ROOT, 'node_modules', 'tesseract.js', 'package.json');
    if (fs.existsSync(installed)) {
        const version = JSON.parse(fs.readFileSync(installed, 'utf8')).version;
        if (/^\d+\.\d+\.\d+$/.test(version)) return version;
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const raw = String((pkg.dependencies && pkg.dependencies['tesseract.js']) || '').replace(/^[^0-9]*/, '');
    if (/^\d+\.\d+\.\d+$/.test(raw)) return raw;
    console.error('[copy-tesseract-assets] cannot determine a tesseract.js version');
    process.exit(1);
}

export const VERSION = engineVersion();
export const OUT_DIR = `public/tesseract/${VERSION}`;
const OUT = path.join(TESSERACT_ROOT, VERSION);

export const ASSETS = [
    ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
    ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
    ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
    ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
    ['tesseract.js-core/LICENSE', 'LICENSE.tesseract.js-core.txt'],
    ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
];

/** What this adds to public/, measured from node_modules whether or not it has run. */
export function generatedBytes() {
    const modules = path.join(ROOT, 'node_modules');
    if (!fs.existsSync(modules)) return null;
    let bytes = 0;
    for (const [from] of ASSETS) {
        const src = path.join(modules, from);
        if (!fs.existsSync(src)) return null;
        bytes += fs.statSync(src).size;
    }
    return { bytes, files: ASSETS.length };
}

function run() {
    if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
        console.error('[copy-tesseract-assets] node_modules is missing. Run npm install.');
        process.exit(1);
    }

    // This directory holds exactly the version we ship and nothing else.
    const dropped = [];
    if (fs.existsSync(TESSERACT_ROOT)) {
        for (const entry of fs.readdirSync(TESSERACT_ROOT)) {
            if (entry === VERSION) continue;
            fs.rmSync(path.join(TESSERACT_ROOT, entry), { recursive: true, force: true });
            dropped.push(entry);
        }
    }
    fs.mkdirSync(path.join(OUT, 'lang'), { recursive: true });

    let bytes = 0;
    let copied = 0;
    for (const [from, to] of ASSETS) {
        const src = path.join(ROOT, 'node_modules', from);
        const dest = path.join(OUT, to);
        if (!fs.existsSync(src)) {
            console.error(`[copy-tesseract-assets] missing ${from}. The reader would fall back to a CDN or fail.`);
            process.exit(1);
        }
        const stat = fs.statSync(src);
        bytes += stat.size;
        if (fs.existsSync(dest) && fs.statSync(dest).size === stat.size) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        copied += 1;
    }
    console.log(`[copy-tesseract-assets] ${ASSETS.length} assets in ${OUT_DIR} (${(bytes / (1024 * 1024)).toFixed(1)} MB, ${copied} newly copied).`);
    if (dropped.length) console.log(`[copy-tesseract-assets] removed stale: ${dropped.join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
