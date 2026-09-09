/**
 * A WORN CARD STILL GETS READ.
 *
 * The barcode on the back is the right answer when it scans. It stops
 * scanning on a card that has spent eight years in a wallet, and that card is
 * standing at the desk with its owner. commander-shared's licenceFace facade
 * takes a registered reader for exactly this, and it is registered HERE, in
 * the app, rather than imported there, so the shared package stays
 * dependency-free and only an app that meets worn cards pays for it.
 *
 * The same two deferrals the barcode decoder uses:
 *
 *   1. `{ lazy: true }` means the loader below runs at most once, and only
 *      when a card has actually failed to scan. A room whose cards all read
 *      cleanly never downloads an OCR engine.
 *   2. The loader is a dynamic import, so webpack emits tesseract.js as its
 *      own async chunk. It is not in anybody's initial bundle.
 *
 * The engine is served from /tesseract/<version>/, copied out of the package
 * at build time by scripts/copy-tesseract-assets.mjs and located explicitly.
 * Never a CDN: an ID reader that depends on a third-party host is an ID
 * reader that stops working when that host does, and the room has no other
 * way to take a member's details.
 */
import { registerFaceReader } from '@smarter-poker/commander-shared/lib/idscan/licenceFace.mjs';

/**
 * Must match what scripts/copy-tesseract-assets.mjs writes. A drift here is a
 * 404 for every asset and a fallback that silently never fires, which is how
 * the barcode decoder shipped broken for weeks.
 */
export const TESSERACT_VERSION = '7.0.0';
export const TESSERACT_BASE = `/tesseract/${TESSERACT_VERSION}`;

/**
 * A licence prints uppercase letters, digits and a small punctuation set.
 * Restricting the alphabet stops the engine offering a lookalike glyph for a
 * digit in a date of birth, which is the field it is least acceptable to be
 * wrong about.
 */
const LICENCE_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/-.,'# ";

let registered = false;
let worker = null;

/** Register once. Safe to call from any entry point that opens ID capture. */
export function installFaceReader() {
    if (registered) return;
    registered = true;

    registerFaceReader(async () => {
        const { createWorker } = await import('tesseract.js');
        worker = await createWorker('eng', 1, {
            workerPath: `${TESSERACT_BASE}/worker.min.js`,
            corePath: `${TESSERACT_BASE}/`,
            langPath: `${TESSERACT_BASE}/lang`,
            gzip: true,
            cacheMethod: 'write',
            logger: () => {},
        });
        await worker.setParameters({
            tessedit_char_whitelist: LICENCE_CHARSET,
            // A card is a single block of text in reading order. Saying so
            // beats letting the engine hunt for columns on a photograph taken
            // at a desk under a downlight.
            tessedit_pageseg_mode: '6',
            preserve_interword_spaces: '1',
        });

        return async (source) => {
            const { data } = await worker.recognize(source);
            return {
                text: String((data && data.text) || ''),
                confidence: Number.isFinite(data && data.confidence) ? Math.round(data.confidence) : 0,
            };
        };
    }, { lazy: true });
}

/**
 * Let the engine go.
 *
 * A tesseract worker holds a WebAssembly heap of tens of megabytes. On a
 * tablet that is the difference between a shift's worth of check-ins and a
 * page reload halfway through one.
 */
export async function releaseFaceReader() {
    const held = worker;
    worker = null;
    registered = false;
    registerFaceReader(null);
    if (!held) return;
    try {
        await held.terminate();
    } catch (_err) {
        // Terminating a worker that never started is not a failure.
    }
}

installFaceReader();
