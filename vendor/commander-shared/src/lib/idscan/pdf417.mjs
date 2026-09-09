/**
 * PDF417 DECODER FACADE
 *
 * The back of every North American driver's licence carries a PDF417 barcode
 * holding the AAMVA record: name, date of birth, address, licence number,
 * expiry and issuing state. Reading it is what a hardware ID scanner does, and
 * it is what lets a tablet replace one.
 *
 * Decoding goes through the browser's native Barcode Detection API, which is
 * the same API the table tablets, dealer terminals and time clock in this
 * codebase already use for QR codes. That is a deliberate match: those screens
 * ship with no fallback at all, so the deployed tablet fleet is already known
 * to support it.
 *
 * WHERE IT IS NOT AVAILABLE
 * Safari implements no Barcode Detection API on any iOS device and Apple has
 * not shipped one, so an iPad cannot decode here. That is reported honestly
 * rather than failing quietly: capture still produces a clean cropped image,
 * and the keyboard-wedge ID scanner field and manual entry both remain open.
 * A WebAssembly decoder closes that gap. It is REGISTERED by the consumer
 * rather than imported here (see the extension point at the bottom), so this
 * package stays dependency-free and the multi megabyte download is paid only
 * by the browsers that cannot decode natively, at the moment they try.
 */

const PDF417 = 'pdf417';

let supportCache = null;

/**
 * Can this browser decode PDF417 natively?
 *
 * `getSupportedFormats` matters: some builds expose BarcodeDetector while
 * supporting only a subset of symbologies, and PDF417 is exactly the kind of
 * format that gets left out. Asking is cheaper than a failed scan.
 */
export async function isPdf417Supported() {
    if (supportCache !== null) return supportCache;
    if (typeof window === 'undefined' || typeof window.BarcodeDetector === 'undefined') {
        supportCache = false;
        return supportCache;
    }
    try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        supportCache = Array.isArray(formats) && formats.includes(PDF417);
    } catch (_err) {
        supportCache = false;
    }
    return supportCache;
}

let detector = null;
async function getDetector() {
    if (detector) return detector;
    if (!(await isPdf417Supported())) return null;
    detector = new window.BarcodeDetector({ formats: [PDF417] });
    return detector;
}

/**
 * Decode PDF417 from anything canvas-shaped.
 *
 * @param {ImageBitmap|HTMLCanvasElement|HTMLVideoElement|ImageData|Blob} source
 * @returns {Promise<{ok:boolean, value?:string, reason?:string}>}
 *          `reason` is 'unsupported' when the browser cannot decode at all,
 *          which the caller must present differently from 'not-found'.
 */
export async function decodePdf417(source) {
    const det = await getDetector();
    if (!det) return decodeWithFallback(source);

    try {
        const results = await det.detect(source);
        if (!results || !results.length) return { ok: false, reason: 'not-found' };
        // Longest wins: a licence barcode is hundreds of bytes, and anything
        // shorter that happens to decode is not the record we want.
        const best = results.reduce((a, b) => ((b.rawValue || '').length > (a.rawValue || '').length ? b : a));
        const value = best.rawValue || '';
        if (!value) return { ok: false, reason: 'not-found' };
        return { ok: true, value };
    } catch (err) {
        return { ok: false, reason: 'decode-failed', error: String((err && err.message) || err) };
    }
}

/**
 * Try several renderings of the same capture before giving up.
 *
 * A licence barcode is low, wide and often printed with poor contrast on a
 * glossy laminate. The perspective-corrected crop usually decodes when the raw
 * frame does not, because the bars are square to the pixel grid again; the raw
 * frame occasionally wins when the crop clipped an edge. Trying both costs
 * milliseconds and meaningfully raises the hit rate.
 *
 * @param {Array<{label:string, source:*}>} candidates in preference order
 */
export async function decodePdf417FromCandidates(candidates) {
    // No native decoder and nothing registered means nothing to try. With a
    // fallback registered, every candidate goes through it exactly as it would
    // through the native detector.
    if (!(await isPdf417Supported()) && !hasPdf417Fallback()) return { ok: false, reason: 'unsupported' };

    let lastReason = 'not-found';
    for (const candidate of candidates) {
        if (!candidate || !candidate.source) continue;
        const result = await decodePdf417(candidate.source);
        if (result.ok) return { ...result, via: candidate.label };
        if (result.reason !== 'not-found') lastReason = result.reason;
    }
    return { ok: false, reason: lastReason };
}

// ---------------------------------------------------------------------------
// EXTENSION POINT, NOW WIRED
// ---------------------------------------------------------------------------
// Safari on iOS and iPadOS implements no Barcode Detection API, so an iPad
// could capture a licence and never read it. A WebAssembly decoder closes that
// gap, and the cost of one is why it is registered rather than imported:
//
//   - This package stays dependency-free. A consumer that never sees an iPad
//     never installs or ships a decoder.
//   - The consumer's registration uses a dynamic import, so the download
//     happens on the first decode attempt on a browser that needs it, not in
//     anybody's initial bundle.
//
// The contract is the whole of it: take the same sources decodePdf417 takes,
// return the same shape. Everything downstream consumes the raw payload string
// through aamva.mjs and does not care which decoder produced it.

/** @type {null | ((source:*) => Promise<{ok:boolean, value?:string, reason?:string}>)} */
let fallbackDecode = null;
let fallbackLoader = null;
let fallbackLoading = null;

/**
 * Register a decoder for browsers with no native PDF417 support.
 *
 * @param {Function} fn        decode(source) -> {ok, value?, reason?}
 * @param {object}   [options]
 * @param {boolean}  [options.lazy] when true, `fn` is a LOADER called once on
 *                   the first attempt and expected to resolve to the decoder.
 *                   This is how a consumer defers a multi megabyte import.
 */
export function registerPdf417Fallback(fn, options = {}) {
    if (typeof fn !== 'function') { fallbackDecode = null; fallbackLoader = null; fallbackLoading = null; return; }
    if (options.lazy) { fallbackLoader = fn; fallbackDecode = null; fallbackLoading = null; return; }
    fallbackDecode = fn;
    fallbackLoader = null;
    fallbackLoading = null;
}

/** Is there anything to fall back TO? Registered counts, loaded or not. */
export function hasPdf417Fallback() {
    return Boolean(fallbackDecode || fallbackLoader);
}

/** Test seam: forget the native support answer and any registration. */
export function resetPdf417ForTests() {
    supportCache = null;
    detector = null;
    fallbackDecode = null;
    fallbackLoader = null;
    fallbackLoading = null;
}

async function decodeWithFallback(source) {
    if (!hasPdf417Fallback()) return { ok: false, reason: 'unsupported' };
    if (!fallbackDecode) {
        // One load, however many candidates are tried. A loader that throws
        // leaves the browser exactly where it was: unsupported, said plainly.
        if (!fallbackLoading) {
            fallbackLoading = Promise.resolve()
                .then(() => fallbackLoader())
                .then((fn) => { fallbackDecode = typeof fn === 'function' ? fn : null; })
                .catch(() => { fallbackDecode = null; });
        }
        await fallbackLoading;
        if (!fallbackDecode) return { ok: false, reason: 'unsupported' };
    }
    try {
        const result = await fallbackDecode(source);
        if (!result || typeof result !== 'object') return { ok: false, reason: 'decode-failed' };
        if (result.ok && result.value) return { ok: true, value: result.value, via: 'wasm' };
        return { ok: false, reason: result.reason || 'not-found' };
    } catch (err) {
        return { ok: false, reason: 'decode-failed', error: String((err && err.message) || err) };
    }
}

/**
 * Adapt a zxing-wasm style reader into the contract above.
 *
 * `loadReader` is called at most once and must resolve to a module exposing
 * `readBarcodes(source, options)`. Kept here rather than in the consumer so
 * every consumer adapts it the same way, and so the adaptation is tested in
 * this package with a fake reader instead of in three apps with none.
 */
export function createZxingPdf417Decoder(loadReader) {
    let readerPromise = null;
    return async function decode(source) {
        if (!readerPromise) readerPromise = Promise.resolve().then(() => loadReader());
        const mod = await readerPromise;
        const readBarcodes = mod && (mod.readBarcodes || (mod.default && mod.default.readBarcodes));
        if (typeof readBarcodes !== 'function') return { ok: false, reason: 'unsupported' };
        const results = await readBarcodes(source, { formats: ['PDF417'], tryHarder: true });
        if (!Array.isArray(results) || results.length === 0) return { ok: false, reason: 'not-found' };
        const best = results.reduce((a, b) => ((b.text || '').length > (a.text || '').length ? b : a));
        const value = best.text || '';
        return value ? { ok: true, value } : { ok: false, reason: 'not-found' };
    };
}
