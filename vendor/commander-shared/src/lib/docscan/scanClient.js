/**
 * DOCUMENT SCAN CLIENT
 *
 * One object that answers detect / rectify / filter, using a Web Worker when
 * the browser gives us one and falling back to the main thread when it does
 * not. The fallback imports the identical pipeline.mjs the worker imports, so
 * there is no second implementation to drift.
 *
 * The fallback is not hypothetical: worker construction fails under some
 * privacy modes, some embedded webviews, and any Content-Security-Policy
 * without worker-src. A scanner that dies in those places is the failure this
 * whole change exists to remove, so it degrades to throttled main-thread work
 * instead.
 */

let pipelinePromise = null;
function loadPipeline() {
    if (!pipelinePromise) pipelinePromise = import('./pipeline.mjs');
    return pipelinePromise;
}

function createWorker() {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
    try {
        return new Worker(new URL('./scanWorker.js', import.meta.url));
    } catch (err) {
        console.warn('[docscan] worker unavailable, using main thread:', err && err.message);
        return null;
    }
}

/** How long a worker gets to answer its handshake before we give up on it. */
const HANDSHAKE_MS = 4000;

export function createScanClient() {
    let worker = createWorker();
    let nextId = 1;
    const pending = new Map();
    let disposed = false;

    if (worker) {
        worker.onmessage = (event) => {
            const msg = event.data;
            const entry = pending.get(msg.id);
            if (!entry) return;
            pending.delete(msg.id);
            if (msg.ok) entry.resolve(msg.result);
            else entry.reject(new Error(msg.error));
        };
        worker.onerror = (event) => {
            console.warn('[docscan] worker error, falling back to main thread:', (event && event.message) || '');
            const outstanding = Array.from(pending.values());
            pending.clear();
            try { worker.terminate(); } catch (_e) { /* already gone */ }
            worker = null;
            outstanding.forEach((entry) => entry.reject(new Error('worker-failed')));
        };
    }

    function post(msg, transfer) {
        return new Promise((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            try {
                worker.postMessage({ ...msg, id }, transfer);
            } catch (err) {
                pending.delete(id);
                reject(err);
            }
        });
    }

    /**
     * Handshake before any real work.
     *
     * A worker script can fail to load for reasons the page never sees coming:
     * a Content-Security-Policy without worker-src, a privacy mode that blocks
     * workers, an embedded webview, or simply a chunk that 404s. The failure
     * arrives asynchronously, AFTER postMessage has already transferred the
     * caller's pixel buffer away. Falling back at that point means falling back
     * onto a detached buffer, which produces a black image rather than an
     * error, so nobody notices.
     *
     * Asking the worker to prove it is alive first, with a message that carries
     * no pixels, means every later transfer goes to a worker known to be there.
     */
    let readyPromise = null;
    function ready() {
        if (!worker) return Promise.resolve(false);
        if (!readyPromise) {
            readyPromise = new Promise((resolve) => {
                let settled = false;
                const done = (ok) => {
                    if (settled) return;
                    settled = true;
                    resolve(ok);
                };
                const timer = setTimeout(() => {
                    if (worker) {
                        console.warn('[docscan] worker did not answer in time, using the main thread');
                        try { worker.terminate(); } catch (_e) { /* already gone */ }
                        worker = null;
                    }
                    done(false);
                }, HANDSHAKE_MS);
                post({ type: 'ping' }, [])
                    .then(() => { clearTimeout(timer); done(true); })
                    .catch(() => { clearTimeout(timer); done(false); });
            });
        }
        // Re-check the worker after the handshake resolves. The answer is
        // cached, but a worker can die LATER (onerror nulls it), and a cached
        // "yes" then sent every subsequent call into postMessage on null. That
        // threw a TypeError, which is not the 'worker-failed' the callers look
        // for, so instead of falling back to the main thread they rethrew and
        // detection stayed broken for the rest of the session.
        return readyPromise.then((ok) => ok && Boolean(worker));
    }

    // ---- main-thread equivalents of the worker tasks -----------------------

    async function localDetect(data, width, height, opts) {
        const p = await loadPipeline();
        return {
            detection: p.detectDocument(data, width, height, opts || {}),
            sharpness: p.sharpness(data, width, height),
            exposure: p.exposure(data, width, height),
        };
    }

    async function localRectify(data, width, height, quad, outSize, filter, quarterTurns) {
        const p = await loadPipeline();
        const size = outSize || p.outputSizeFor(quad);
        if (!size) throw new Error('degenerate-quad');
        const warped = p.warpPerspective(data, width, height, quad, size.width, size.height);
        if (!warped) throw new Error('degenerate-quad');
        const rotated = quarterTurns ? p.rotateRGBA(warped.data, warped.width, warped.height, quarterTurns) : warped;
        const filtered = p.applyFilter(rotated.data, rotated.width, rotated.height, filter || 'original');
        return { width: filtered.width, height: filtered.height, buffer: filtered.data.buffer };
    }

    async function localFilter(data, width, height, filter, quarterTurns) {
        const p = await loadPipeline();
        const rotated = quarterTurns ? p.rotateRGBA(data, width, height, quarterTurns) : { data, width, height };
        const filtered = p.applyFilter(rotated.data, rotated.width, rotated.height, filter || 'original');
        const out = filtered.data === data ? new Uint8ClampedArray(filtered.data) : filtered.data;
        return { width: filtered.width, height: filtered.height, buffer: out.buffer };
    }

    return {
        get usingWorker() { return Boolean(worker); },

        /**
         * @param {ImageData|{data:Uint8ClampedArray,width:number,height:number}} image
         *        The caller must not use `image.data` afterwards when a worker
         *        is in play: its buffer is transferred and detached.
         */
        async detect(image, opts) {
            if (disposed) throw new Error('disposed');
            const { data, width, height } = image;
            if (await ready()) {
                try {
                    return await post({ type: 'detect', width, height, buffer: data.buffer, opts }, [data.buffer]);
                } catch (err) {
                    if (String(err.message) !== 'worker-failed') throw err;
                    // This frame's pixels went with the worker. Skip it; the
                    // next frame will be handled on the main thread.
                    return { detection: null, sharpness: 0, exposure: 1 };
                }
            }
            return localDetect(data, width, height, opts);
        },

        async rectify({ image, quad, outSize, filter, quarterTurns }) {
            if (disposed) throw new Error('disposed');
            const { data, width, height } = image;
            if (await ready()) {
                // The caller keeps `data` for later edits, so a copy is what
                // gets transferred. If the worker dies mid-flight that copy is
                // detached, so the fallback re-copies from `data`, which is
                // still intact.
                const copy = new Uint8ClampedArray(data);
                try {
                    return await post(
                        { type: 'rectify', width, height, buffer: copy.buffer, quad, outSize, filter, quarterTurns },
                        [copy.buffer],
                    );
                } catch (err) {
                    if (String(err.message) !== 'worker-failed') throw err;
                }
            }
            return localRectify(new Uint8ClampedArray(data), width, height, quad, outSize, filter, quarterTurns);
        },

        async filter({ image, filter, quarterTurns }) {
            if (disposed) throw new Error('disposed');
            const { data, width, height } = image;
            if (await ready()) {
                const copy = new Uint8ClampedArray(data);
                try {
                    return await post(
                        { type: 'filter', width, height, buffer: copy.buffer, filter, quarterTurns },
                        [copy.buffer],
                    );
                } catch (err) {
                    if (String(err.message) !== 'worker-failed') throw err;
                }
            }
            return localFilter(new Uint8ClampedArray(data), width, height, filter, quarterTurns);
        },

        dispose() {
            disposed = true;
            pending.forEach((entry) => entry.reject(new Error('disposed')));
            pending.clear();
            if (worker) {
                try { worker.terminate(); } catch (_e) { /* already gone */ }
                worker = null;
            }
        },
    };
}
