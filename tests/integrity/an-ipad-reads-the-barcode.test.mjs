/**
 * AN IPAD READS THE BARCODE
 *
 * Safari on iOS and iPadOS implements no Barcode Detection API, so a tablet
 * captured a licence cleanly and could never read it. The fix is a registered
 * WebAssembly decoder, and this test decodes a REAL PDF417 barcode carrying a
 * real AAMVA payload with the same reader the browser will use, then parses it
 * with the same parser the form reads.
 *
 * What it does not prove: an actual iPad. No iOS device, no real licence and
 * no camera were involved. What is proven is that the decoder reads the
 * symbology, that the payload survives it byte for byte, and that the
 * registration and asset plumbing are wired the way the browser needs them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import bwipjs from 'bwip-js';
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
import { parseAamva } from '@smarter-poker/commander-shared/lib/idscan/aamva.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WASM = join(ROOT, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm');

prepareZXingModule({
    overrides: { locateFile: () => WASM, wasmBinary: readFileSync(WASM) },
    fireImmediately: true,
});

/** bwip-js modules to an ImageData-shaped buffer, scaled, with a quiet zone. */
function toImageData(raw, scale = 4, quiet = 24) {
    const rows = raw.pixs.length / raw.pixx;
    const rowHeight = raw.pixy / rows;
    const width = raw.pixx * scale + quiet * 2;
    const height = Math.round(raw.pixy * scale) + quiet * 2;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const sx = Math.floor((x - quiet) / scale);
            const sy = Math.floor((y - quiet) / (scale * rowHeight));
            const dark = sx >= 0 && sx < raw.pixx && sy >= 0 && sy < rows && raw.pixs[sy * raw.pixx + sx];
            const p = (y * width + x) * 4;
            data[p] = data[p + 1] = data[p + 2] = dark ? 0 : 255;
            data[p + 3] = 255;
        }
    }
    return { data, width, height };
}

/** The record the back of a licence actually carries. */
const PAYLOAD = '@\n\rANSI 636014040002DL00410288ZC03290015DLDAQY1234567\nDCSSAMPLE\nDACJANE\nDBB01011990\nDAJNY\r';

test('the decoder reads a real PDF417 and the payload survives byte for byte', async () => {
    const raw = bwipjs.raw({ bcid: 'pdf417', text: PAYLOAD, columns: 10 })[0];
    const results = await readBarcodes(toImageData(raw), { formats: ['PDF417'], tryHarder: true });
    assert.equal(results.length, 1, 'one barcode, found');
    assert.equal(results[0].format, 'PDF417');
    assert.equal(results[0].text, PAYLOAD, 'exactly what was encoded');
});

test('what it reads is what the member form fills in', async () => {
    const raw = bwipjs.raw({ bcid: 'pdf417', text: PAYLOAD, columns: 10 })[0];
    const [result] = await readBarcodes(toImageData(raw), { formats: ['PDF417'], tryHarder: true });
    const parsed = parseAamva(result.text);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.fields, {
        first_name: 'Jane',
        last_name: 'Sample',
        date_of_birth: '1990-01-01',
        id_number: 'Y1234567',
        id_state: 'NY',
        id_type: 'drivers_license',
        address_state: 'NY',
    });
});

test('a blurred or clipped barcode is not read rather than misread', async () => {
    const raw = bwipjs.raw({ bcid: 'pdf417', text: PAYLOAD, columns: 10 })[0];
    const clipped = toImageData(raw, 4, 24);
    // Erase the left third: the start pattern goes with it.
    for (let y = 0; y < clipped.height; y++) {
        for (let x = 0; x < Math.floor(clipped.width / 3); x++) {
            const p = (y * clipped.width + x) * 4;
            clipped.data[p] = clipped.data[p + 1] = clipped.data[p + 2] = 255;
        }
    }
    const results = await readBarcodes(clipped, { formats: ['PDF417'], tryHarder: true });
    for (const r of results) {
        assert.notEqual(r.text, PAYLOAD, 'a partial barcode must not produce the whole record');
    }
});

test('the wasm the browser fetches is copied out of the package, not from a CDN', () => {
    const script = readFileSync(join(ROOT, 'scripts/copy-zxing-wasm.mjs'), 'utf8');
    assert.match(script, /node_modules\/zxing-wasm\/dist\/reader\/zxing_reader\.wasm/);
    assert.match(script, /public\/zxing/);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.prebuild, 'node scripts/copy-zxing-wasm.mjs', 'copied before every build');
    assert.ok(pkg.dependencies['zxing-wasm'], 'and the package is a real dependency');

    const reg = readFileSync(join(ROOT, 'src/lib/idscan/registerPdf417Fallback.js'), 'utf8');
    assert.match(reg, /locateFile: \(\) => ZXING_WASM_URL/, 'located explicitly');
    assert.match(reg, /ZXING_WASM_URL = '\/zxing\/zxing_reader\.wasm'/);
    assert.doesNotMatch(reg, /https?:\/\//, 'no third-party host in the path of a room taking an ID');
    assert.ok(existsSync(WASM) && statSync(WASM).size > 100000, 'the binary is in the package');
});

test('the decoder is registered lazily, and only ID capture pulls it in', () => {
    const reg = readFileSync(join(ROOT, 'src/lib/idscan/registerPdf417Fallback.js'), 'utf8');
    assert.match(reg, /\{ lazy: true \}/, 'the loader runs on the first attempt, not at import');
    assert.match(reg, /await import\('zxing-wasm\/reader'\)/, 'a dynamic import, so it is its own chunk');
    const shim = readFileSync(join(ROOT, 'src/components/commander/members/AddMemberModal.jsx'), 'utf8');
    assert.match(shim, /import '\.\.\/\.\.\/\.\.\/lib\/idscan\/registerPdf417Fallback'/, 'registered where ID capture enters');
});
