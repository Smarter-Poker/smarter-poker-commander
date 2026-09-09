#!/usr/bin/env node
/**
 * PUT THE BARCODE DECODER WHERE THE BROWSER CAN FETCH IT.
 *
 * zxing-wasm ships its WebAssembly binary inside the package. The browser
 * needs it at a URL, and the two ways of not doing this are both worse:
 * letting the bundler guess an asset path (it changes between Next versions
 * and fails silently) or pointing at a CDN (a room whose ID scanner stops
 * working because somebody else's host is down).
 *
 * So it is copied to public/zxing/ before every build, and src/lib/idscan/
 * registerPdf417Fallback.js locates it there. Run by `prebuild`.
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm');
const DEST_DIR = join(ROOT, 'public/zxing');
const DEST = join(DEST_DIR, 'zxing_reader.wasm');

if (!existsSync(SRC)) {
    console.error(`[copy-zxing-wasm] ${SRC} is missing. Run npm install.`);
    process.exit(1);
}

mkdirSync(DEST_DIR, { recursive: true });
copyFileSync(SRC, DEST);
const kb = Math.round(statSync(DEST).size / 1024);
console.log(`[copy-zxing-wasm] public/zxing/zxing_reader.wasm (${kb} KB)`);
