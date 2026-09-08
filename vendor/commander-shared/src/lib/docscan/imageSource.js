/**
 * IMAGE SOURCE HELPERS
 *
 * Decoding, orientation, memory capping and export for the document scanner.
 * Kept apart from pipeline.mjs because everything here touches browser APIs and
 * so cannot run in the Node tests that cover the geometry.
 */

/** Longest edge kept for the in-memory source. Above this, phones run out of RAM. */
export const SOURCE_MAX_DIM = 3000;

export class UndecodableImageError extends Error {
    constructor(fileName, type) {
        super('undecodable-image');
        this.name = 'UndecodableImageError';
        this.fileName = fileName || '';
        this.mimeType = type || '';
        this.likelyHeic = /heic|heif/i.test(`${type || ''} ${fileName || ''}`);
    }
}

function drawToImageData(source, width, height, maxDim) {
    const longest = Math.max(width, height);
    const scale = longest > maxDim ? maxDim / longest : 1;
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas-unavailable');
    ctx.drawImage(source, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    // Let the canvas go; only the pixels are kept.
    canvas.width = 0;
    canvas.height = 0;
    return imageData;
}

function loadViaElement(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('decode-failed'));
        };
        img.src = url;
    });
}

/**
 * Decode a File/Blob into ImageData with EXIF orientation already applied and
 * the size capped.
 *
 * createImageBitmap with imageOrientation 'from-image' is the reliable path;
 * where it is missing or refuses the format, an <img> element is used, which
 * modern browsers also orient from EXIF. A format neither can decode (HEIC
 * outside Safari) raises UndecodableImageError so the caller can say something
 * useful instead of failing silently.
 */
export async function decodeToImageData(blob, maxDim = SOURCE_MAX_DIM) {
    if (typeof createImageBitmap === 'function') {
        let bitmap = null;
        try {
            bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        } catch (_err) {
            try {
                bitmap = await createImageBitmap(blob);
            } catch (_err2) {
                bitmap = null;
            }
        }
        if (bitmap) {
            try {
                return drawToImageData(bitmap, bitmap.width, bitmap.height, maxDim);
            } finally {
                if (typeof bitmap.close === 'function') bitmap.close();
            }
        }
    }

    try {
        const img = await loadViaElement(blob);
        return drawToImageData(img, img.naturalWidth, img.naturalHeight, maxDim);
    } catch (_err) {
        throw new UndecodableImageError(blob && blob.name, blob && blob.type);
    }
}

/** Grab the current video frame at the camera's own resolution, not the preview's. */
export function frameFromVideo(video, maxDim) {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    return drawToImageData(video, w, h, maxDim || SOURCE_MAX_DIM);
}

/** Downscale ImageData for live detection. Returns a fresh buffer plus the scale used. */
export function downscaleImageData(imageData, maxDim) {
    const { width, height } = imageData;
    const longest = Math.max(width, height);
    if (longest <= maxDim) {
        return { imageData: new ImageData(new Uint8ClampedArray(imageData.data), width, height), scale: 1 };
    }
    const scale = maxDim / longest;
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const src = document.createElement('canvas');
    src.width = width;
    src.height = height;
    src.getContext('2d').putImageData(imageData, 0, 0);

    const dst = document.createElement('canvas');
    dst.width = w;
    dst.height = h;
    const ctx = dst.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(src, 0, 0, w, h);
    const out = ctx.getImageData(0, 0, w, h);

    src.width = 0; src.height = 0;
    dst.width = 0; dst.height = 0;
    return { imageData: out, scale: w / width };
}

export function canvasFromRGBA(buffer, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(buffer), width, height), 0, 0);
    return canvas;
}

/**
 * Export to JPEG. Canvas encoding writes no EXIF, GPS or maker notes, so the
 * saved receipt carries none of the metadata the original photo did.
 *
 * Quality is deliberately high: receipt totals are small dark text on light
 * paper, which is exactly what aggressive JPEG chroma subsampling destroys.
 */
export function rgbaToBlob(buffer, width, height, quality = 0.92) {
    const canvas = canvasFromRGBA(buffer, width, height);
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                canvas.width = 0;
                canvas.height = 0;
                if (blob) resolve(blob);
                else reject(new Error('encode-failed'));
            },
            'image/jpeg',
            quality,
        );
    });
}

export function rgbaToDataUrl(buffer, width, height, quality = 0.9) {
    const canvas = canvasFromRGBA(buffer, width, height);
    const url = canvas.toDataURL('image/jpeg', quality);
    canvas.width = 0;
    canvas.height = 0;
    return url;
}
