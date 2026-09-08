/**
 * DOCUMENT SCAN WORKER
 *
 * Runs the detection and perspective-correction pipeline off the main thread so
 * the camera preview keeps its frame rate and a full-resolution warp does not
 * freeze the page. It imports the same pipeline.mjs the main-thread fallback in
 * scanClient.js uses, so there is exactly one implementation of the geometry.
 *
 * Pixel buffers are transferred, never copied, in both directions. A transferred
 * buffer is detached on the sending side, which is also how the caller knows not
 * to hold on to it.
 */

import {
    detectDocument,
    warpPerspective,
    applyFilter,
    rotateRGBA,
    sharpness,
    exposure,
    outputSizeFor,
} from './pipeline.mjs';

function run(msg) {
    const { type, width, height, buffer } = msg;

    // Handshake. Carries no pixels, so the client can establish that this
    // worker actually loaded before it transfers any buffer into it.
    if (type === 'ping') return { result: { pong: true }, transfer: [] };

    const data = new Uint8ClampedArray(buffer);

    if (type === 'detect') {
        const found = detectDocument(data, width, height, msg.opts || {});
        return {
            result: {
                detection: found,
                sharpness: sharpness(data, width, height),
                exposure: exposure(data, width, height),
            },
            transfer: [],
        };
    }

    if (type === 'rectify') {
        const size = msg.outSize || outputSizeFor(msg.quad);
        if (!size) throw new Error('degenerate-quad');
        const warped = warpPerspective(data, width, height, msg.quad, size.width, size.height);
        if (!warped) throw new Error('degenerate-quad');
        const rotated = msg.quarterTurns ? rotateRGBA(warped.data, warped.width, warped.height, msg.quarterTurns) : warped;
        const filtered = applyFilter(rotated.data, rotated.width, rotated.height, msg.filter || 'original');
        return {
            result: { width: filtered.width, height: filtered.height, buffer: filtered.data.buffer },
            transfer: [filtered.data.buffer],
        };
    }

    if (type === 'filter') {
        const source = msg.quarterTurns ? rotateRGBA(data, width, height, msg.quarterTurns) : { data, width, height };
        const filtered = applyFilter(source.data, source.width, source.height, msg.filter || 'original');
        // applyFilter returns the input untouched for 'original', so copy before
        // transferring or the caller loses the buffer it still needs.
        const out = filtered.data === source.data ? new Uint8ClampedArray(filtered.data) : filtered.data;
        return {
            result: { width: filtered.width, height: filtered.height, buffer: out.buffer },
            transfer: [out.buffer],
        };
    }

    throw new Error(`unknown-task:${type}`);
}

self.onmessage = (event) => {
    const msg = event.data;
    if (!msg || typeof msg.id !== 'number') return;
    try {
        const { result, transfer } = run(msg);
        self.postMessage({ id: msg.id, ok: true, result }, transfer);
    } catch (err) {
        self.postMessage({ id: msg.id, ok: false, error: String((err && err.message) || err) });
    }
};
