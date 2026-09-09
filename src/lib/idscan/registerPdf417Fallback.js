/**
 * AN IPAD READS THE BARCODE
 *
 * Safari on iOS and iPadOS implements no Barcode Detection API, so a tablet
 * captured a licence cleanly and could never read it. commander-shared's
 * pdf417 facade takes a registered fallback for exactly this; the decoder is
 * registered HERE, in the app, rather than imported there, so the shared
 * package stays dependency-free and only an app that meets iPads pays for it.
 *
 * The cost is paid twice deferred:
 *
 *   1. `{ lazy: true }` means the loader below is called at most once, and
 *      only when a decode is attempted on a browser with no native support.
 *      Chrome and the Android tablets never run it.
 *   2. The loader is a dynamic import, so webpack emits zxing-wasm as its own
 *      async chunk. It is not in anybody's initial bundle.
 *
 * The wasm binary is served from /zxing/, copied out of the package at build
 * time by scripts/copy-zxing-wasm.mjs. It is located explicitly rather than
 * left to the bundler or to a CDN: a barcode reader that silently depends on
 * a third-party host is a barcode reader that stops working when that host
 * does, and the room has no other way to take a member's ID.
 */
import { registerPdf417Fallback, createZxingPdf417Decoder } from '@smarter-poker/commander-shared/lib/idscan/pdf417.mjs';

export const ZXING_WASM_URL = '/zxing/zxing_reader.wasm';

let registered = false;

/** Register once. Safe to call from any entry point that opens ID capture. */
export function installPdf417Fallback() {
    if (registered) return;
    registered = true;
    registerPdf417Fallback(
        createZxingPdf417Decoder(async () => {
            const mod = await import('zxing-wasm/reader');
            // Point the module at our own copy before the first read.
            if (typeof mod.prepareZXingModule === 'function') {
                mod.prepareZXingModule({ overrides: { locateFile: () => ZXING_WASM_URL } });
            }
            return mod;
        }),
        { lazy: true },
    );
}

installPdf417Fallback();
