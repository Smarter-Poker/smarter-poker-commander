/**
 * DOCUMENT SCAN PIPELINE
 *
 * Dependency-free image processing for document boundary detection and
 * perspective correction. Every function here operates on plain typed arrays,
 * so the exact same code runs in the browser main thread, inside a Web Worker,
 * and inside Node (which is how it is unit tested without a browser).
 *
 * WHY NOT OpenCV.js
 * -----------------
 * The previous scanner waited on a global `cv` that nothing loads: OpenCV was
 * deleted from pages/_document.js and the promised lazy load was never written,
 * so LiveCameraScanner timed out after 20s on every device. Re-adding a ~9MB
 * WASM download in front of a mobile-first receipt capture reintroduces that
 * failure mode (and its offline one). No image-processing dependency is
 * installed in this repo, so the pipeline is implemented here instead.
 *
 * PIPELINE
 *   1. downscale        - detection runs small, correction runs at source res
 *   2. luminance + blur - separable gaussian
 *   3. sobel            - gradient magnitude AND direction (direction matters:
 *                         it is what separates a real document border from a
 *                         long incidental edge)
 *   4. candidate masks  - canny binary at several dilations, plus otsu on
 *                         brightness in both polarities. Two independent
 *                         sources, because a receipt can be separated from its
 *                         background by edges, by brightness, or by both.
 *   5. per component    - convex hull, then max-area inscribed quadrilateral
 *                         (handles perspective trapezoids) and min-area rect
 *                         (handles broken outlines)
 *   6. scoring          - boundary support with gradient-direction agreement,
 *                         plus size, rectangularity and centering. The largest
 *                         rectangle is deliberately NOT the answer.
 *   7. validation       - convex, non self-intersecting, sane angles, sane
 *                         aspect, not the whole frame
 *   8. homography       - exact 8x8 solve, bilinear inverse warp
 */

// ---------------------------------------------------------------------------
// TUNING
// ---------------------------------------------------------------------------

export const DEFAULTS = {
    // Longest edge of the image used for detection. Live frames use less.
    detectMaxDim: 512,
    // A quad smaller than this fraction of the frame is not a document.
    minAreaFraction: 0.05,
    // A quad larger than this is the frame itself unless its borders are strong.
    maxAreaFraction: 0.995,
    // Smallest acceptable interior angle, degrees. Kills slivers.
    minCornerAngleDeg: 45,
    // Long receipts are legitimate. Cash-register tape runs past 10:1.
    maxAspectRatio: 18,
    // Fraction of perimeter samples that must sit on a real border.
    minBoundarySupport: 0.32,
    // Score below which we report "no document".
    minScore: 0.34,
    // Hull vertices kept before the O(n^2) quad search.
    maxHullPoints: 40,
    // Components examined per mask.
    componentsPerMask: 4,
    // Optional shape hint. An ID-1 card (every driver licence, every state ID)
    // is 85.6mm by 54mm, so its long side over its short side is 1.586 whatever
    // way up it is held. Scoring candidates against that separates the card
    // from the desk, the hand and the table edge far better than size alone.
    preferAspect: null,
    // How much of the score the aspect hint is worth when one is supplied.
    //
    // Measured, not guessed. A licence lying on a clipboard is the real case,
    // and the clipboard has perfect edges and five times the area, so it wins
    // on support and size no matter how card-shaped the card is. At 0.22 the
    // clipboard still took it; at 0.42 the card wins by a clear margin while a
    // passport data page, at 1.42 to 1, still agrees about 0.8 and is found.
    aspectWeight: 0.42,
};

/** Long side over short side of an ID-1 card, the format of every US licence. */
export const CARD_ASPECT = 85.6 / 54;

const DEG = Math.PI / 180;

// Sobel magnitude of a one-grey-level step is about 4. A boundary between
// paper and any surface it is lying on clears 40 even in poor light, while
// sensor noise on a blank wall sits well under 15. Both floors below exist so
// that a featureless frame reports "no document" instead of normalising its
// own noise up to a confident answer.
const MIN_GRADIENT_ABSOLUTE = 16;
const MIN_GRADIENT_REFERENCE = 24;

// ---------------------------------------------------------------------------
// SMALL GEOMETRY HELPERS
// ---------------------------------------------------------------------------

export function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function triArea(a, b, c) {
    return Math.abs(cross(a, b, c)) / 2;
}

export function polygonArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        s += p.x * q.y - q.x * p.y;
    }
    return Math.abs(s) / 2;
}

function signedArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        s += p.x * q.y - q.x * p.y;
    }
    return s / 2;
}

/**
 * Convex hull, Andrew monotone chain. Returns counter-clockwise in maths
 * orientation, which is clockwise on screen because y grows downward.
 */
export function convexHull(points) {
    if (points.length < 3) return points.slice();
    const pts = points.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
    const lower = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

/** Keep the n most significant hull vertices so the quad search stays cheap. */
function decimateHull(hull, maxPoints) {
    if (hull.length <= maxPoints) return hull;
    // Drop the vertex whose removal loses the least area, repeatedly.
    const pts = hull.slice();
    while (pts.length > maxPoints) {
        let worst = 0;
        let worstLoss = Infinity;
        for (let i = 0; i < pts.length; i++) {
            const loss = triArea(pts[(i - 1 + pts.length) % pts.length], pts[i], pts[(i + 1) % pts.length]);
            if (loss < worstLoss) { worstLoss = loss; worst = i; }
        }
        pts.splice(worst, 1);
    }
    return pts;
}

/**
 * Largest-area quadrilateral whose corners are hull vertices.
 * For every diagonal, take the farthest vertex on each side. O(n^2) amortised
 * over a decimated hull. This is what makes a perspective trapezoid come out
 * as a trapezoid instead of being over-covered by its bounding rectangle.
 */
export function maxAreaQuad(hull) {
    const n = hull.length;
    if (n < 4) return null;
    if (n === 4) return hull.slice();

    let best = null;
    let bestArea = 0;
    for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue;
            let ai = -1, aArea = 0;
            for (let k = i + 1; k < j; k++) {
                const ar = triArea(hull[i], hull[k], hull[j]);
                if (ar > aArea) { aArea = ar; ai = k; }
            }
            let bi = -1, bArea = 0;
            for (let k = j + 1; k < i + n; k++) {
                const kk = k % n;
                const ar = triArea(hull[j], hull[kk], hull[i]);
                if (ar > bArea) { bArea = ar; bi = kk; }
            }
            if (ai < 0 || bi < 0) continue;
            const area = aArea + bArea;
            if (area > bestArea) {
                bestArea = area;
                best = [hull[i], hull[ai], hull[j], hull[bi]];
            }
        }
    }
    return best;
}

/** Minimum-area enclosing rectangle by rotating calipers over hull edges. */
export function minAreaRect(hull) {
    const n = hull.length;
    if (n < 3) return null;
    let best = null;
    let bestArea = Infinity;
    for (let i = 0; i < n; i++) {
        const p = hull[i];
        const q = hull[(i + 1) % n];
        const ex = q.x - p.x;
        const ey = q.y - p.y;
        const len = Math.hypot(ex, ey);
        if (len < 1e-6) continue;
        const ux = ex / len, uy = ey / len;
        const vx = -uy, vy = ux;
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const r of hull) {
            const du = r.x * ux + r.y * uy;
            const dv = r.x * vx + r.y * vy;
            if (du < minU) minU = du;
            if (du > maxU) maxU = du;
            if (dv < minV) minV = dv;
            if (dv > maxV) maxV = dv;
        }
        const area = (maxU - minU) * (maxV - minV);
        if (area < bestArea) {
            bestArea = area;
            best = [
                { x: minU * ux + minV * vx, y: minU * uy + minV * vy },
                { x: maxU * ux + minV * vx, y: maxU * uy + minV * vy },
                { x: maxU * ux + maxV * vx, y: maxU * uy + maxV * vy },
                { x: minU * ux + maxV * vx, y: minU * uy + maxV * vy },
            ];
        }
    }
    return best;
}

/**
 * Order four points as [topLeft, topRight, bottomRight, bottomLeft] in screen
 * coordinates (y down), traversed clockwise.
 *
 * Sorting by angle around the centroid is rotation-safe, unlike sorting by y
 * then x, which swaps corners as soon as the document tilts past the point
 * where two corners share a row. The starting corner is the one closest to the
 * image origin, which is the conventional top-left for anything within +/-45
 * degrees of upright; past that the labelling is arbitrary but still
 * consistent, and the review screen offers Rotate.
 */
export function orderQuad(points) {
    if (!points || points.length !== 4) return null;
    const cx = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
    const cy = (points[0].y + points[1].y + points[2].y + points[3].y) / 4;

    const byAngle = points
        .map((p) => ({ p, a: Math.atan2(p.y - cy, p.x - cx) }))
        .sort((m, n) => m.a - n.a)
        .map((m) => m.p);

    // atan2 ascending with y down traverses clockwise on screen. Force it.
    let ring = byAngle;
    if (signedArea(ring) < 0) ring = ring.slice().reverse();

    let start = 0;
    let bestKey = Infinity;
    for (let i = 0; i < 4; i++) {
        const key = ring[i].x + ring[i].y;
        if (key < bestKey) { bestKey = key; start = i; }
    }
    return [ring[start], ring[(start + 1) % 4], ring[(start + 2) % 4], ring[(start + 3) % 4]];
}

/**
 * Reject degenerate, crossed and implausible quadrilaterals.
 * Returns { ok: true } or { ok: false, reason }.
 */
export function validateQuad(quad, width, height, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    if (!quad || quad.length !== 4) return { ok: false, reason: 'not-four-points' };
    for (const p of quad) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return { ok: false, reason: 'non-finite' };
    }

    // Convex and consistently wound. A crossed quad flips the cross product.
    let positive = 0;
    let negative = 0;
    for (let i = 0; i < 4; i++) {
        const a = quad[i];
        const b = quad[(i + 1) % 4];
        const c = quad[(i + 2) % 4];
        const z = cross(a, b, c);
        if (z > 0) positive++;
        else if (z < 0) negative++;
    }
    if (positive > 0 && negative > 0) return { ok: false, reason: 'not-convex-or-crossed' };
    if (positive === 0 && negative === 0) return { ok: false, reason: 'collinear' };

    const area = polygonArea(quad);
    const frame = width * height;
    const frac = area / frame;
    if (frac < o.minAreaFraction) return { ok: false, reason: 'too-small', areaFraction: frac };
    if (frac > o.maxAreaFraction) return { ok: false, reason: 'whole-frame', areaFraction: frac };

    // Interior angles.
    for (let i = 0; i < 4; i++) {
        const prev = quad[(i + 3) % 4];
        const cur = quad[i];
        const next = quad[(i + 1) % 4];
        const v1x = prev.x - cur.x, v1y = prev.y - cur.y;
        const v2x = next.x - cur.x, v2y = next.y - cur.y;
        const l1 = Math.hypot(v1x, v1y);
        const l2 = Math.hypot(v2x, v2y);
        if (l1 < 1e-6 || l2 < 1e-6) return { ok: false, reason: 'duplicate-corner' };
        const cosA = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
        const ang = Math.acos(cosA) / DEG;
        if (ang < o.minCornerAngleDeg || ang > 180 - o.minCornerAngleDeg / 4) {
            return { ok: false, reason: 'bad-angle', angle: ang };
        }
    }

    // Edge lengths and aspect. Long thin receipts are allowed; hairlines are not.
    const top = dist(quad[0], quad[1]);
    const right = dist(quad[1], quad[2]);
    const bottom = dist(quad[2], quad[3]);
    const left = dist(quad[3], quad[0]);
    const minEdge = Math.min(top, right, bottom, left);
    const shortSide = Math.min(width, height);
    if (minEdge < shortSide * 0.05) return { ok: false, reason: 'edge-too-short' };

    const w = (top + bottom) / 2;
    const h = (left + right) / 2;
    const aspect = Math.max(w, h) / Math.max(1e-6, Math.min(w, h));
    if (aspect > o.maxAspectRatio) return { ok: false, reason: 'aspect-extreme', aspect };

    return { ok: true, areaFraction: frac, aspect };
}

// ---------------------------------------------------------------------------
// PIXELS
// ---------------------------------------------------------------------------

/** Box-average downscale of RGBA. Returns the new buffer plus the scale used. */
export function downscaleRGBA(data, width, height, maxDim) {
    const longest = Math.max(width, height);
    if (longest <= maxDim) {
        return { data, width, height, scale: 1 };
    }
    const scale = maxDim / longest;
    const outW = Math.max(1, Math.round(width * scale));
    const outH = Math.max(1, Math.round(height * scale));
    const out = new Uint8ClampedArray(outW * outH * 4);
    const xRatio = width / outW;
    const yRatio = height / outH;

    for (let y = 0; y < outH; y++) {
        const sy0 = Math.floor(y * yRatio);
        const sy1 = Math.min(height, Math.max(sy0 + 1, Math.floor((y + 1) * yRatio)));
        for (let x = 0; x < outW; x++) {
            const sx0 = Math.floor(x * xRatio);
            const sx1 = Math.min(width, Math.max(sx0 + 1, Math.floor((x + 1) * xRatio)));
            let r = 0, g = 0, b = 0, a = 0, n = 0;
            for (let sy = sy0; sy < sy1; sy++) {
                let idx = (sy * width + sx0) * 4;
                for (let sx = sx0; sx < sx1; sx++) {
                    r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; a += data[idx + 3];
                    idx += 4; n++;
                }
            }
            const o = (y * outW + x) * 4;
            out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
        }
    }
    return { data: out, width: outW, height: outH, scale: outW / width };
}

export function luminance(data, width, height) {
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
        gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }
    return gray;
}

/** Separable gaussian blur on a Float32 plane. */
export function gaussianBlur(src, width, height, sigma) {
    const radius = Math.max(1, Math.round(sigma * 2.5));
    const size = radius * 2 + 1;
    const kernel = new Float32Array(size);
    let sum = 0;
    for (let i = 0; i < size; i++) {
        const d = i - radius;
        kernel[i] = Math.exp(-(d * d) / (2 * sigma * sigma));
        sum += kernel[i];
    }
    for (let i = 0; i < size; i++) kernel[i] /= sum;

    const tmp = new Float32Array(width * height);
    const out = new Float32Array(width * height);

    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            let acc = 0;
            for (let k = -radius; k <= radius; k++) {
                const xx = Math.min(width - 1, Math.max(0, x + k));
                acc += src[row + xx] * kernel[k + radius];
            }
            tmp[row + x] = acc;
        }
    }
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            let acc = 0;
            for (let k = -radius; k <= radius; k++) {
                const yy = Math.min(height - 1, Math.max(0, y + k));
                acc += tmp[yy * width + x] * kernel[k + radius];
            }
            out[y * width + x] = acc;
        }
    }
    return out;
}

/** Sobel gradients. Direction is kept because scoring needs it. */
export function sobel(gray, width, height) {
    const gx = new Float32Array(width * height);
    const gy = new Float32Array(width * height);
    const mag = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = y * width + x;
            const tl = gray[i - width - 1], t = gray[i - width], tr = gray[i - width + 1];
            const l = gray[i - 1], r = gray[i + 1];
            const bl = gray[i + width - 1], b = gray[i + width], br = gray[i + width + 1];
            const dx = -tl + tr - 2 * l + 2 * r - bl + br;
            const dy = -tl - 2 * t - tr + bl + 2 * b + br;
            gx[i] = dx;
            gy[i] = dy;
            mag[i] = Math.hypot(dx, dy);
        }
    }
    return { gx, gy, mag };
}

/**
 * Percentile of the non-zero values, by histogram rather than by sort.
 * A live frame has ~110k gradient samples and this runs several times per
 * frame; sorting that many floats was the single largest cost in the loop.
 */
function percentile(values, p) {
    let max = 0;
    for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i];
    if (max <= 0) return 0;

    const BINS = 512;
    const hist = new Int32Array(BINS);
    const k = (BINS - 1) / max;
    let total = 0;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v > 0) { hist[(v * k) | 0]++; total++; }
    }
    if (!total) return 0;

    const target = Math.min(total - 1, Math.max(0, Math.round((total - 1) * p)));
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
        acc += hist[b];
        if (acc > target) return (b + 0.5) / k;
    }
    return max;
}

/**
 * Canny with percentile-derived thresholds, so a faint low-contrast receipt
 * still produces a border instead of an empty map.
 */
export function cannyBinary(mag, gx, gy, width, height, highPercentile = 0.88) {
    const high = percentile(mag, highPercentile) || 1;
    const low = high * 0.4;

    // Non-maximum suppression.
    const thin = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = y * width + x;
            const m = mag[i];
            if (m < low) continue;
            const ax = Math.abs(gx[i]);
            const ay = Math.abs(gy[i]);
            let n1, n2;
            if (ax >= ay) {
                if ((gx[i] > 0) === (gy[i] > 0)) { n1 = mag[i - width - 1]; n2 = mag[i + width + 1]; }
                else { n1 = mag[i + width - 1]; n2 = mag[i - width + 1]; }
                const w = ay / (ax || 1e-6);
                n1 = mag[i - 1] * (1 - w) + n1 * w;
                n2 = mag[i + 1] * (1 - w) + n2 * w;
            } else {
                if ((gx[i] > 0) === (gy[i] > 0)) { n1 = mag[i - width - 1]; n2 = mag[i + width + 1]; }
                else { n1 = mag[i + width - 1]; n2 = mag[i - width + 1]; }
                const w = ax / (ay || 1e-6);
                n1 = mag[i - width] * (1 - w) + n1 * w;
                n2 = mag[i + width] * (1 - w) + n2 * w;
            }
            if (m >= n1 && m >= n2) thin[i] = m;
        }
    }

    // Hysteresis.
    const out = new Uint8Array(width * height);
    const stack = [];
    for (let i = 0; i < thin.length; i++) {
        if (thin[i] >= high) { out[i] = 1; stack.push(i); }
    }
    while (stack.length) {
        const i = stack.pop();
        const y = (i / width) | 0;
        const x = i - y * width;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                const j = ny * width + nx;
                if (!out[j] && thin[j] >= low) { out[j] = 1; stack.push(j); }
            }
        }
    }
    return out;
}

export function otsu(gray) {
    const hist = new Float64Array(256);
    for (let i = 0; i < gray.length; i++) {
        const v = gray[i] < 0 ? 0 : gray[i] > 255 ? 255 : gray[i] | 0;
        hist[v]++;
    }
    const total = gray.length;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = 0, bestVar = -1;
    for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (!wB) continue;
        const wF = total - wB;
        if (!wF) break;
        sumB += t * hist[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > bestVar) { bestVar = between; best = t; }
    }
    return best;
}

/**
 * Square-structuring-element dilation, done as two 1-D passes with a running
 * count. Separable: 2*(2r+1) reads per pixel instead of (2r+1)^2.
 */
export function dilate(bin, width, height, radius) {
    if (radius <= 0) return bin;

    const tmp = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        const row = y * width;
        let count = 0;
        for (let x = 0; x <= Math.min(width - 1, radius); x++) count += bin[row + x];
        for (let x = 0; x < width; x++) {
            tmp[row + x] = count > 0 ? 1 : 0;
            const add = x + radius + 1;
            if (add < width) count += bin[row + add];
            const sub = x - radius;
            if (sub >= 0) count -= bin[row + sub];
        }
    }

    const out = new Uint8Array(width * height);
    for (let x = 0; x < width; x++) {
        let count = 0;
        for (let y = 0; y <= Math.min(height - 1, radius); y++) count += tmp[y * width + x];
        for (let y = 0; y < height; y++) {
            out[y * width + x] = count > 0 ? 1 : 0;
            const add = y + radius + 1;
            if (add < height) count += tmp[add * width + x];
            const sub = y - radius;
            if (sub >= 0) count -= tmp[sub * width + x];
        }
    }
    return out;
}

/**
 * Label 4-connected components and return the largest few.
 *
 * Each component is returned as its per-row leftmost and rightmost pixels, not
 * as every pixel it contains. For a connected component those extremes have
 * exactly the same convex hull as the full set (every other pixel in a row lies
 * on the segment between them), and it turns a 50,000-point hull sort into a
 * few-hundred-point one.
 */
export function largestComponents(bin, width, height, limit) {
    const labels = new Int32Array(width * height).fill(-1);
    const queue = new Int32Array(width * height);
    const rowMin = new Int32Array(height);
    const rowMax = new Int32Array(height);
    const comps = [];

    for (let start = 0; start < bin.length; start++) {
        if (!bin[start] || labels[start] !== -1) continue;
        const id = comps.length;
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        labels[start] = id;

        let size = 0;
        let minY = height;
        let maxY = -1;

        while (head < tail) {
            const i = queue[head++];
            const y = (i / width) | 0;
            const x = i - y * width;
            size++;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (rowMax[y] === 0 && rowMin[y] === 0) { rowMin[y] = x; rowMax[y] = x; }
            if (x < rowMin[y]) rowMin[y] = x;
            if (x > rowMax[y]) rowMax[y] = x;

            if (x > 0) { const j = i - 1; if (bin[j] && labels[j] === -1) { labels[j] = id; queue[tail++] = j; } }
            if (x < width - 1) { const j = i + 1; if (bin[j] && labels[j] === -1) { labels[j] = id; queue[tail++] = j; } }
            if (y > 0) { const j = i - width; if (bin[j] && labels[j] === -1) { labels[j] = id; queue[tail++] = j; } }
            if (y < height - 1) { const j = i + width; if (bin[j] && labels[j] === -1) { labels[j] = id; queue[tail++] = j; } }
        }

        const points = [];
        for (let y = minY; y <= maxY; y++) {
            points.push({ x: rowMin[y], y });
            if (rowMax[y] !== rowMin[y]) points.push({ x: rowMax[y], y });
            rowMin[y] = 0;
            rowMax[y] = 0;
        }
        comps.push({ points, size });
    }

    comps.sort((a, b) => b.size - a.size);
    return comps.slice(0, limit);
}

// ---------------------------------------------------------------------------
// SCORING
// ---------------------------------------------------------------------------

function sampleMag(mag, width, height, x, y) {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 1 || yi < 1 || xi >= width - 1 || yi >= height - 1) return null;
    return { m: mag[yi * width + xi], i: yi * width + xi };
}

/**
 * Boundary support: walk each edge, and at every sample look a couple of pixels
 * either side for a gradient that is both strong AND pointing across the edge.
 * A long incidental line lying along the edge fails the direction test, which
 * is what stops "biggest rectangle in the frame" from winning.
 */
export function boundarySupport(quad, gx, gy, mag, width, height, reference) {
    const ref = Math.max(reference || percentile(mag, 0.9) || 1, MIN_GRADIENT_REFERENCE);
    let hits = 0;
    let total = 0;
    const perEdge = 18;

    for (let e = 0; e < 4; e++) {
        const a = quad[e];
        const b = quad[(e + 1) % 4];
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len = Math.hypot(ex, ey);
        if (len < 2) { total += perEdge; continue; }
        const ux = ex / len, uy = ey / len;
        const nx = -uy, ny = ux;

        for (let s = 0; s < perEdge; s++) {
            const t = (s + 0.5) / perEdge;
            const px = a.x + ex * t;
            const py = a.y + ey * t;
            total++;
            let bestScore = 0;
            for (let off = -2; off <= 2; off++) {
                const sm = sampleMag(mag, width, height, px + nx * off, py + ny * off);
                if (!sm) continue;
                // Absolute floor as well as a relative one. Without it, a flat
                // frame of sensor noise normalises its own noise up to "strong"
                // and every quad scores as fully supported.
                if (sm.m < MIN_GRADIENT_ABSOLUTE) continue;
                const strength = Math.min(1, sm.m / ref);
                if (strength < 0.18) continue;
                const glen = Math.hypot(gx[sm.i], gy[sm.i]) || 1e-6;
                const align = Math.abs((gx[sm.i] * nx + gy[sm.i] * ny) / glen);
                const score = strength * align;
                if (score > bestScore) bestScore = score;
            }
            if (bestScore >= 0.22) hits++;
        }
    }
    return total ? hits / total : 0;
}

/** How close the quad is to its own minimum-area rectangle. */
function rectangularity(quad) {
    const rect = minAreaRect(quad);
    if (!rect) return 0;
    const ra = polygonArea(rect);
    if (ra <= 0) return 0;
    return Math.min(1, polygonArea(quad) / ra);
}

/** How close a quad's proportions are to an expected aspect. 1 is exact. */
function aspectAgreement(quad, expected) {
    const w = (dist(quad[0], quad[1]) + dist(quad[2], quad[3])) / 2;
    const h = (dist(quad[3], quad[0]) + dist(quad[1], quad[2])) / 2;
    if (w < 1 || h < 1) return 0;
    const observed = Math.max(w, h) / Math.min(w, h);
    const ratio = observed > expected ? expected / observed : observed / expected;
    // Squared so a near miss still scores well and a wild miss scores nothing.
    return Math.max(0, ratio) ** 2;
}

export function scoreQuad(quad, ctx) {
    const { gx, gy, mag, width, height, reference, preferAspect, aspectWeight } = ctx;
    const support = boundarySupport(quad, gx, gy, mag, width, height, reference);
    const areaFrac = polygonArea(quad) / (width * height);
    const rect = rectangularity(quad);

    const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
    const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
    const offCentre = Math.hypot(cx / width - 0.5, cy / height - 0.5) / 0.707;
    const centring = 1 - Math.min(1, offCentre);

    const base =
        0.50 * support +
        0.26 * Math.sqrt(Math.min(1, areaFrac)) +
        0.16 * rect +
        0.08 * centring;

    if (!preferAspect) {
        return { score: base, support, areaFraction: areaFrac, rectangularity: rect };
    }

    // With a shape hint, the hint takes a share of the score rather than being
    // added on top, so a hinted score stays comparable to an unhinted one.
    const w = aspectWeight == null ? DEFAULTS.aspectWeight : aspectWeight;
    const agreement = aspectAgreement(quad, preferAspect);
    return {
        score: base * (1 - w) + agreement * w,
        support,
        areaFraction: areaFrac,
        rectangularity: rect,
        aspectAgreement: agreement,
    };
}

// ---------------------------------------------------------------------------
// DETECTION
// ---------------------------------------------------------------------------

function quadKey(quad) {
    return quad.map((p) => `${Math.round(p.x / 4)},${Math.round(p.y / 4)}`).join('|');
}

/**
 * Detect the document boundary.
 *
 * @param {Uint8ClampedArray} data RGBA of the (already downscaled) frame
 * @param {number} width
 * @param {number} height
 * @param {object} opts
 * @returns {{quad:Array,score:number,support:number,confidence:number,areaFraction:number}|null}
 *          Corners are in the coordinate space of the data passed in, ordered
 *          [topLeft, topRight, bottomRight, bottomLeft].
 */
export function detectDocument(data, width, height, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    if (width < 24 || height < 24) return null;

    const gray = luminance(data, width, height);
    const blurred = gaussianBlur(gray, width, height, Math.max(1, Math.min(width, height) / 220));
    const { gx, gy, mag } = sobel(blurred, width, height);
    const reference = percentile(mag, 0.9) || 1;

    const masks = [];
    const edges = cannyBinary(mag, gx, gy, width, height, 0.86);
    masks.push(dilate(edges, width, height, 1));
    masks.push(dilate(edges, width, height, 2));

    const t = otsu(blurred);
    const bright = new Uint8Array(width * height);
    const dark = new Uint8Array(width * height);
    for (let i = 0; i < blurred.length; i++) {
        if (blurred[i] > t) bright[i] = 1; else dark[i] = 1;
    }
    masks.push(bright);
    masks.push(dark);

    const ctx = {
        gx, gy, mag, width, height, reference,
        preferAspect: o.preferAspect,
        aspectWeight: o.aspectWeight,
    };
    const seen = new Set();
    let best = null;

    for (const mask of masks) {
        const comps = largestComponents(mask, width, height, o.componentsPerMask);
        for (const comp of comps) {
            if (comp.size < 40) continue;
            const hullFull = convexHull(comp.points);
            if (hullFull.length < 4) continue;
            const hull = decimateHull(hullFull, o.maxHullPoints);

            const candidates = [];
            const mq = maxAreaQuad(hull);
            if (mq) candidates.push(mq);
            const mr = minAreaRect(hull);
            if (mr) candidates.push(mr);

            for (const raw of candidates) {
                const quad = orderQuad(raw);
                if (!quad) continue;
                const key = quadKey(quad);
                if (seen.has(key)) continue;
                seen.add(key);

                const valid = validateQuad(quad, width, height, o);
                if (!valid.ok) continue;

                const scored = scoreQuad(quad, ctx);
                if (!best || scored.score > best.score) {
                    best = { quad, ...scored };
                }
            }
        }
    }

    if (!best) return null;
    if (best.support < o.minBoundarySupport) return null;
    if (best.score < o.minScore) return null;

    return {
        quad: best.quad,
        score: best.score,
        support: best.support,
        areaFraction: best.areaFraction,
        confidence: Math.max(0, Math.min(1, (best.score - o.minScore) / (0.85 - o.minScore))),
    };
}

/** Sharpness proxy: variance of the Laplacian, normalised. Used for auto-capture. */
export function sharpness(data, width, height) {
    const gray = luminance(data, width, height);
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = y * width + x;
            const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
            sum += lap;
            sumSq += lap * lap;
            n++;
        }
    }
    if (!n) return 0;
    const mean = sum / n;
    return sumSq / n - mean * mean;
}

/** Fraction of pixels that are neither crushed nor blown out. */
export function exposure(data, width, height) {
    const gray = luminance(data, width, height);
    let ok = 0;
    for (let i = 0; i < gray.length; i++) {
        if (gray[i] > 12 && gray[i] < 246) ok++;
    }
    return gray.length ? ok / gray.length : 0;
}

// ---------------------------------------------------------------------------
// PERSPECTIVE CORRECTION
// ---------------------------------------------------------------------------

/**
 * Solve the homography mapping src[i] -> dst[i] exactly (four correspondences,
 * eight unknowns, h8 fixed at 1). Gaussian elimination with partial pivoting.
 */
export function computeHomography(src, dst) {
    const A = [];
    for (let i = 0; i < 4; i++) {
        const { x: sx, y: sy } = src[i];
        const { x: dx, y: dy } = dst[i];
        A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx, dx]);
        A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy, dy]);
    }

    const n = 8;
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let r = col + 1; r < n; r++) {
            if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
        }
        if (Math.abs(A[pivot][col]) < 1e-12) return null;
        const tmp = A[col]; A[col] = A[pivot]; A[pivot] = tmp;

        const p = A[col][col];
        for (let j = col; j <= n; j++) A[col][j] /= p;

        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = A[r][col];
            if (!f) continue;
            for (let j = col; j <= n; j++) A[r][j] -= f * A[col][j];
        }
    }

    const h = new Float64Array(9);
    for (let i = 0; i < n; i++) h[i] = A[i][n];
    h[8] = 1;
    return h;
}

export function applyHomography(h, x, y) {
    const w = h[6] * x + h[7] * y + h[8];
    if (Math.abs(w) < 1e-12) return { x: NaN, y: NaN };
    return {
        x: (h[0] * x + h[1] * y + h[2]) / w,
        y: (h[3] * x + h[4] * y + h[5]) / w,
    };
}

/**
 * Output size for a quad: the measured edge lengths, so a long receipt stays a
 * long receipt and nothing is stretched to a fixed page size. Capped so a
 * 48MP phone photo cannot allocate an unbounded buffer on a low-memory device.
 */
export function outputSizeFor(quad, maxDim = 2600, maxPixels = 9e6) {
    const top = dist(quad[0], quad[1]);
    const bottom = dist(quad[2], quad[3]);
    const left = dist(quad[3], quad[0]);
    const right = dist(quad[1], quad[2]);

    let w = Math.max(top, bottom);
    let h = Math.max(left, right);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;

    const longest = Math.max(w, h);
    if (longest > maxDim) {
        const k = maxDim / longest;
        w *= k; h *= k;
    }
    if (w * h > maxPixels) {
        const k = Math.sqrt(maxPixels / (w * h));
        w *= k; h *= k;
    }
    return { width: Math.max(8, Math.round(w)), height: Math.max(8, Math.round(h)) };
}

/**
 * Inverse-map every destination pixel through the homography and sample the
 * source bilinearly. Bilinear rather than nearest because receipt text is thin
 * and nearest-neighbour shreds it.
 */
export function warpPerspective(src, srcWidth, srcHeight, quad, outWidth, outHeight) {
    const dstCorners = [
        { x: 0, y: 0 },
        { x: outWidth - 1, y: 0 },
        { x: outWidth - 1, y: outHeight - 1 },
        { x: 0, y: outHeight - 1 },
    ];
    const h = computeHomography(dstCorners, quad);
    if (!h) return null;

    const out = new Uint8ClampedArray(outWidth * outHeight * 4);
    for (let y = 0; y < outHeight; y++) {
        for (let x = 0; x < outWidth; x++) {
            const w = h[6] * x + h[7] * y + h[8];
            const sx = (h[0] * x + h[1] * y + h[2]) / w;
            const sy = (h[3] * x + h[4] * y + h[5]) / w;
            const o = (y * outWidth + x) * 4;

            if (!(sx >= 0 && sy >= 0 && sx <= srcWidth - 1 && sy <= srcHeight - 1)) {
                out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; out[o + 3] = 255;
                continue;
            }
            const x0 = sx | 0;
            const y0 = sy | 0;
            const x1 = Math.min(srcWidth - 1, x0 + 1);
            const y1 = Math.min(srcHeight - 1, y0 + 1);
            const fx = sx - x0;
            const fy = sy - y0;
            const i00 = (y0 * srcWidth + x0) * 4;
            const i10 = (y0 * srcWidth + x1) * 4;
            const i01 = (y1 * srcWidth + x0) * 4;
            const i11 = (y1 * srcWidth + x1) * 4;
            const w00 = (1 - fx) * (1 - fy);
            const w10 = fx * (1 - fy);
            const w01 = (1 - fx) * fy;
            const w11 = fx * fy;
            for (let c = 0; c < 3; c++) {
                out[o + c] = src[i00 + c] * w00 + src[i10 + c] * w10 + src[i01 + c] * w01 + src[i11 + c] * w11;
            }
            out[o + 3] = 255;
        }
    }
    return { data: out, width: outWidth, height: outHeight };
}

export function rotateRGBA(data, width, height, quarterTurns) {
    const turns = ((quarterTurns % 4) + 4) % 4;
    if (turns === 0) return { data, width, height };
    const swap = turns % 2 === 1;
    const outW = swap ? height : width;
    const outH = swap ? width : height;
    const out = new Uint8ClampedArray(outW * outH * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let nx, ny;
            if (turns === 1) { nx = height - 1 - y; ny = x; }
            else if (turns === 2) { nx = width - 1 - x; ny = height - 1 - y; }
            else { nx = y; ny = width - 1 - x; }
            const si = (y * width + x) * 4;
            const di = (ny * outW + nx) * 4;
            out[di] = data[si];
            out[di + 1] = data[si + 1];
            out[di + 2] = data[si + 2];
            out[di + 3] = data[si + 3];
        }
    }
    return { data: out, width: outW, height: outH };
}

// ---------------------------------------------------------------------------
// TONAL FILTERS
// ---------------------------------------------------------------------------
// Every one of these is a local tonal operation over the pixels that were
// actually photographed. Nothing here invents, reconstructs or infills content.

export const FILTERS = ['original', 'enhanced', 'grayscale', 'bw'];

/** Fast box blur of a Float32 plane, used as the local-mean term. */
function boxBlur(src, width, height, radius) {
    const tmp = new Float32Array(width * height);
    const out = new Float32Array(width * height);
    const win = radius * 2 + 1;

    for (let y = 0; y < height; y++) {
        const row = y * width;
        let acc = 0;
        for (let x = -radius; x <= radius; x++) acc += src[row + Math.min(width - 1, Math.max(0, x))];
        for (let x = 0; x < width; x++) {
            tmp[row + x] = acc / win;
            const add = src[row + Math.min(width - 1, x + radius + 1)];
            const sub = src[row + Math.max(0, x - radius)];
            acc += add - sub;
        }
    }
    for (let x = 0; x < width; x++) {
        let acc = 0;
        for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
        for (let y = 0; y < height; y++) {
            out[y * width + x] = acc / win;
            const add = tmp[Math.min(height - 1, y + radius + 1) * width + x];
            const sub = tmp[Math.max(0, y - radius) * width + x];
            acc += add - sub;
        }
    }
    return out;
}

/**
 * @param {string} mode one of FILTERS
 *   original  - untouched, exactly what perspective correction produced
 *   enhanced  - local contrast normalisation, keeps colour, keeps faint print
 *   grayscale - luminance only
 *   bw        - adaptive threshold with a soft ramp, so faint thermal printing
 *               fades rather than disappearing at a hard cut
 */
export function applyFilter(data, width, height, mode) {
    if (mode === 'original' || !FILTERS.includes(mode)) {
        return { data, width, height };
    }

    const gray = luminance(data, width, height);
    const radius = Math.max(6, Math.round(Math.min(width, height) / 22));
    const local = boxBlur(gray, width, height, radius);
    const out = new Uint8ClampedArray(width * height * 4);

    if (mode === 'grayscale') {
        for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
            const v = gray[i];
            out[p] = v; out[p + 1] = v; out[p + 2] = v; out[p + 3] = 255;
        }
        return { data: out, width, height };
    }

    if (mode === 'enhanced') {
        const gain = 1.35;
        for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
            const base = Math.max(1, local[i]);
            // Divide out the illumination field, then lift contrast gently.
            const ratio = gray[i] / base;
            const target = 235 * Math.min(1.25, Math.max(0, 0.5 + (ratio - 0.5) * gain));
            const k = gray[i] > 0.5 ? target / Math.max(1, gray[i]) : 1;
            out[p] = data[p] * k;
            out[p + 1] = data[p + 1] * k;
            out[p + 2] = data[p + 2] * k;
            out[p + 3] = 255;
        }
        return { data: out, width, height };
    }

    // bw
    const softness = 14;
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
        const threshold = local[i] - 9;
        const d = gray[i] - threshold;
        // Soft ramp instead of a hard cut. Faint print survives as light grey.
        const v = 255 / (1 + Math.exp(-d / softness));
        out[p] = v; out[p + 1] = v; out[p + 2] = v; out[p + 3] = 255;
    }
    return { data: out, width, height };
}

/** Default quad used when detection fails: a modest inset of the frame. */
export function fallbackQuad(width, height, inset = 0.1) {
    const mx = width * inset;
    const my = height * inset;
    return [
        { x: mx, y: my },
        { x: width - mx, y: my },
        { x: width - mx, y: height - my },
        { x: mx, y: height - my },
    ];
}

/** Average corner movement between two quads, as a fraction of the diagonal. */
export function quadMotion(a, b, width, height) {
    if (!a || !b) return 1;
    const diag = Math.hypot(width, height) || 1;
    let sum = 0;
    for (let i = 0; i < 4; i++) sum += dist(a[i], b[i]);
    return sum / 4 / diag;
}

export function scaleQuad(quad, factor) {
    return quad.map((p) => ({ x: p.x * factor, y: p.y * factor }));
}
