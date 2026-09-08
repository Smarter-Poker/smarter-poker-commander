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
 * A WebAssembly decoder would close the gap and is the single extension point
 * marked below, deliberately left out for now rather than adding a multi
 * megabyte dependency to a shared package on a platform nobody here can test.
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

/** Test seam: lets the browser pass force the unsupported path. */
export function resetPdf417SupportCache() {
    supportCache = null;
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
    if (!det) return { ok: false, reason: 'unsupported' };

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
    if (!(await isPdf417Supported())) return { ok: false, reason: 'unsupported' };

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
// EXTENSION POINT
// ---------------------------------------------------------------------------
// To support iPad and Firefox, install a WebAssembly decoder here. The contract
// is the whole of it: take the same sources decodePdf417 takes, return the same
// shape. Nothing else in the ID capture flow needs to change, because
// everything downstream consumes the raw payload string through aamva.mjs.
//
//   let wasmDecode = null;
//   export function registerPdf417Fallback(fn) { wasmDecode = fn; }
//
// It is left unregistered on purpose: the only browsers that need it are the
// ones this change could not be tested on.
