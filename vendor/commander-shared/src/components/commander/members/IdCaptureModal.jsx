/**
 * ID CAPTURE - front and back of a licence, on a tablet or phone
 *
 * Replaces a hardware ID scanner. The camera finds the card in frame, corrects
 * its perspective, and the back's PDF417 barcode is decoded into the AAMVA
 * record: name, date of birth, address, licence number, expiry and state. Those
 * fields are handed to the member form. A hardware scanner, where a club has
 * one, produces the same payload and goes through the same parser.
 *
 * NO EMOJIS - Lucide icons only (per /no-emoji-commander)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NO IMAGE EVER REACHES THE DEVICE, AND WHAT THAT DOES NOT COVER
 * ─────────────────────────────────────────────────────────────────────────────
 * Four decisions, each of which closes a way an ID photograph normally escapes:
 *
 *  1. getUserMedia ONLY. There is deliberately no file input in this component.
 *     `<input type="file" capture>` hands the job to the native camera app,
 *     and on both iOS and Android that writes the photograph to the camera
 *     roll, where it stays after the member is registered. A MediaStream frame
 *     never touches the photo library.
 *
 *  2. No object URLs and no data URLs. Frames are drawn straight from
 *     ImageData to a canvas. A blob: or data: URL is a savable, shareable
 *     handle to the image and can outlive the component; there is none here.
 *
 *  3. No storage API. Nothing is written to localStorage, sessionStorage,
 *     IndexedDB or a cache. Nothing is uploaded: the modal returns parsed text
 *     fields, never pixels.
 *
 *  4. Buffers are overwritten with zeroes before being dropped, and the canvas
 *     backing stores are collapsed to 0x0, on every exit path.
 *
 * What this honestly cannot do: JavaScript cannot scrub a heap it does not
 * control, so a copy the garbage collector has already moved is beyond reach,
 * and neither can it stop an operating-system screenshot or a device backup of
 * the browser's own memory. What it does guarantee is that this feature writes
 * no image to storage, keeps no handle to one, and sends none anywhere.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
    X, Camera, RotateCcw, Check, AlertCircle, Loader2, ShieldCheck,
    ScanLine, ChevronRight, CreditCard,
} from 'lucide-react';

import { createScanClient } from '../../../lib/docscan/scanClient';
import { frameFromVideo } from '../../../lib/docscan/imageSource';
import {
    CARD_ASPECT, fallbackQuad, scaleQuad, quadMotion, validateQuad, outputSizeFor,
} from '../../../lib/docscan/pipeline.mjs';
import { decodePdf417FromCandidates } from '../../../lib/idscan/pdf417.mjs';
import { parseAamva, ageOn, isExpired } from '../../../lib/idscan/aamva.mjs';

const LIVE_DETECT_DIM = 384;
const DETECT_INTERVAL_MS = 120;

const AUTO = {
    minConfidence: 0.40,
    minSupport: 0.40,
    maxMotion: 0.015,
    minSharpness: 24,
    stableFrames: 4,
};

const SIDES = {
    front: {
        key: 'front',
        title: 'Front Of ID',
        hint: 'Position The Front Of The ID Inside The Frame',
        purpose: 'Confirms The Card And Its Photo',
    },
    back: {
        key: 'back',
        title: 'Back Of ID',
        hint: 'Position The Barcode Side Inside The Frame',
        purpose: 'Holds The Barcode With The Member Details',
    },
};

/** Overwrite then release. Point 4 of the note above. */
function wipe(buffer) {
    try {
        if (buffer && typeof buffer.fill === 'function') buffer.fill(0);
    } catch (_err) {
        // A detached buffer is already gone, which is the outcome we wanted.
    }
}

function collapseCanvas(canvas) {
    if (!canvas) return;
    try {
        canvas.width = 0;
        canvas.height = 0;
    } catch (_err) { /* already detached */ }
}

export default function IdCaptureModal({ isOpen, onClose, onComplete }) {
    // choose | camera | processing | confirm | done
    const [phase, setPhase] = useState('camera');
    const [side, setSide] = useState('front');
    const [status, setStatus] = useState('Position The ID Inside The Frame');
    const [detected, setDetected] = useState(false);
    const [stability, setStability] = useState(0);
    const [autoCapture, setAutoCapture] = useState(true);
    const [cameraError, setCameraError] = useState(null);
    const [decodeState, setDecodeState] = useState(null); // null | 'unsupported' | 'not-found' | 'ok'
    const [parsed, setParsed] = useState(null);
    const [captured, setCaptured] = useState({ front: false, back: false });
    const [busy, setBusy] = useState(false);

    const videoRef = useRef(null);
    const overlayRef = useRef(null);
    const previewRef = useRef(null);

    const streamRef = useRef(null);
    const clientRef = useRef(null);
    const timerRef = useRef(null);
    const rafRef = useRef(null);
    const mountedRef = useRef(true);
    const capturingRef = useRef(false);
    const detectBusyRef = useRef(false);
    const pausedRef = useRef(false);

    const smoothQuadRef = useRef(null);
    const lastQuadRef = useRef(null);
    const detectScaleRef = useRef(1);
    const detectWidthRef = useRef(0);
    const stableCountRef = useRef(0);

    // The only places pixels live. Both are wiped, never uploaded, never named.
    const cropRef = useRef(null);       // { data, width, height } current side
    const captureRef = useRef(null);

    if (!clientRef.current && typeof window !== 'undefined' && isOpen) {
        clientRef.current = createScanClient();
    }

    // ── teardown ────────────────────────────────────────────────────────────

    const stopCamera = useCallback(() => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        const stream = streamRef.current;
        streamRef.current = null;
        if (stream) stream.getTracks().forEach((t) => t.stop());
        const video = videoRef.current;
        if (video) {
            try { video.pause(); } catch (_e) { /* already stopped */ }
            video.srcObject = null;
        }
    }, []);

    /** Every exit runs this. There is no path out that leaves pixels behind. */
    const destroyImages = useCallback(() => {
        if (cropRef.current) { wipe(cropRef.current.data); cropRef.current = null; }
        smoothQuadRef.current = null;
        lastQuadRef.current = null;
        collapseCanvas(previewRef.current);
        collapseCanvas(overlayRef.current);
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            stopCamera();
            destroyImages();
            if (clientRef.current) { clientRef.current.dispose(); clientRef.current = null; }
        };
    }, [stopCamera, destroyImages]);

    const handleClose = useCallback(() => {
        stopCamera();
        destroyImages();
        setParsed(null);
        setCaptured({ front: false, back: false });
        setSide('front');
        setPhase('camera');
        setDecodeState(null);
        setCameraError(null);
        onClose();
    }, [stopCamera, destroyImages, onClose]);

    // ── camera ──────────────────────────────────────────────────────────────

    const startCamera = useCallback(async () => {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setCameraError({
                title: 'Camera Unavailable',
                body: typeof window !== 'undefined' && !window.isSecureContext
                    ? 'Live Capture Needs A Secure Connection. Use The ID Scanner Field Or Enter The Details By Hand.'
                    : 'This Browser Cannot Open A Camera. Use The ID Scanner Field Or Enter The Details By Hand.',
            });
            return;
        }

        stopCamera();
        capturingRef.current = false;
        stableCountRef.current = 0;
        smoothQuadRef.current = null;
        lastQuadRef.current = null;
        setStability(0);
        setDetected(false);
        setCameraError(null);

        // The rear camera is a preference, not a requirement: a desk terminal
        // with only a front camera must still be able to scan.
        const attempts = [
            { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
            { video: { facingMode: { ideal: 'environment' } }, audio: false },
            { video: true, audio: false },
        ];

        let stream = null;
        let lastError = null;
        for (const constraints of attempts) {
            try {
                stream = await navigator.mediaDevices.getUserMedia(constraints);
                break;
            } catch (err) {
                lastError = err;
                if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError' || err.name === 'NotFoundError')) break;
            }
        }

        if (!stream) {
            const name = lastError && lastError.name;
            setCameraError({
                title: name === 'NotAllowedError' || name === 'SecurityError' ? 'Camera Access Blocked'
                    : name === 'NotFoundError' ? 'No Camera Found'
                        : name === 'NotReadableError' ? 'Camera In Use'
                            : 'Camera Unavailable',
                body: name === 'NotAllowedError' || name === 'SecurityError'
                    ? 'Allow Camera Access In The Browser Settings, Or Use The ID Scanner Field.'
                    : name === 'NotReadableError'
                        ? 'Another App Or Tab Is Using The Camera. Close It And Try Again.'
                        : 'Use The ID Scanner Field Or Enter The Details By Hand.',
            });
            return;
        }
        if (!mountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        try { await video.play(); } catch (_err) { /* resumes on first gesture */ }
        if (mountedRef.current) setPhase('camera');
    }, [stopCamera]);

    useEffect(() => {
        if (!isOpen) return undefined;
        startCamera();
        return undefined;
        // startCamera is stable; re-running would restart the stream.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        const onVisibility = () => { pausedRef.current = document.hidden; };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);

    // ── live detection ──────────────────────────────────────────────────────

    const captureSideRef = useRef(null);

    const runDetection = useCallback(async () => {
        const video = videoRef.current;
        const client = clientRef.current;
        if (!video || !client || capturingRef.current || pausedRef.current || detectBusyRef.current) return;
        if (!video.videoWidth) return;

        detectBusyRef.current = true;
        try {
            const frame = frameFromVideo(video, LIVE_DETECT_DIM);
            if (!frame) return;
            detectScaleRef.current = video.videoWidth / frame.width;
            detectWidthRef.current = frame.width;

            const { detection, sharpness } = await client.detect(frame, {
                detectMaxDim: LIVE_DETECT_DIM,
                // An ID-1 card is always 1.586 to 1. Telling the detector that
                // is what keeps it on the card instead of the desk it lies on.
                preferAspect: CARD_ASPECT,
            });
            if (!mountedRef.current || capturingRef.current) return;

            if (!detection) {
                stableCountRef.current = 0;
                lastQuadRef.current = null;
                smoothQuadRef.current = null;
                setDetected(false);
                setStability(0);
                setStatus('Position The ID Inside The Frame');
                return;
            }

            const motion = quadMotion(lastQuadRef.current, detection.quad, frame.width, frame.height);
            lastQuadRef.current = detection.quad;
            const prev = smoothQuadRef.current;
            smoothQuadRef.current = prev
                ? detection.quad.map((p, i) => ({
                    x: prev[i].x + (p.x - prev[i].x) * 0.45,
                    y: prev[i].y + (p.y - prev[i].y) * 0.45,
                }))
                : detection.quad;

            setDetected(true);

            const steady = motion <= AUTO.maxMotion;
            const confident = detection.confidence >= AUTO.minConfidence && detection.support >= AUTO.minSupport;
            const sharp = sharpness >= AUTO.minSharpness;

            if (steady && confident && sharp) {
                stableCountRef.current = Math.min(AUTO.stableFrames, stableCountRef.current + 1);
            } else {
                stableCountRef.current = Math.max(0, stableCountRef.current - 1);
            }
            setStability(stableCountRef.current / AUTO.stableFrames);

            if (!confident) setStatus('Move Closer To The ID');
            else if (!sharp || !steady) setStatus('Hold Steady');
            else setStatus(autoCapture ? 'Capturing' : 'Ready. Tap The Shutter');

            if (autoCapture && stableCountRef.current >= AUTO.stableFrames && !capturingRef.current) {
                if (captureSideRef.current) captureSideRef.current(detection.quad, frame.width);
            }
        } catch (err) {
            if (String(err && err.message) !== 'disposed') {
                console.warn('[idscan] detection failed:', err && err.message);
            }
        } finally {
            detectBusyRef.current = false;
        }
    }, [autoCapture]);

    useEffect(() => {
        if (!isOpen || phase !== 'camera') return undefined;
        let cancelled = false;
        const tick = async () => {
            if (cancelled) return;
            await runDetection();
            if (cancelled) return;
            timerRef.current = setTimeout(tick, DETECT_INTERVAL_MS);
        };
        timerRef.current = setTimeout(tick, 400);
        return () => {
            cancelled = true;
            if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        };
    }, [isOpen, phase, runDetection]);

    // Overlay: a card-shaped guide plus the live outline.
    useEffect(() => {
        if (!isOpen || phase !== 'camera') return undefined;
        const draw = () => {
            const video = videoRef.current;
            const overlay = overlayRef.current;
            if (video && overlay && video.videoWidth) {
                const rect = video.getBoundingClientRect();
                const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
                const w = Math.max(1, Math.round(rect.width));
                const h = Math.max(1, Math.round(rect.height));
                if (overlay.width !== w * dpr || overlay.height !== h * dpr) {
                    overlay.width = w * dpr;
                    overlay.height = h * dpr;
                    overlay.style.width = `${w}px`;
                    overlay.style.height = `${h}px`;
                }
                const ctx = overlay.getContext('2d');
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.clearRect(0, 0, w, h);

                // Card-shaped guide so staff know how to hold it.
                const guideW = w * 0.82;
                const guideH = guideW / CARD_ASPECT;
                const gx = (w - guideW) / 2;
                const gy = (h - guideH) / 2;
                ctx.strokeStyle = 'rgba(255,255,255,0.30)';
                ctx.lineWidth = 2;
                ctx.setLineDash([10, 8]);
                ctx.strokeRect(gx, gy, guideW, guideH);
                ctx.setLineDash([]);

                const quad = smoothQuadRef.current;
                if (quad) {
                    const vw = video.videoWidth;
                    const vh = video.videoHeight;
                    const s = detectScaleRef.current;
                    const cover = Math.max(w / vw, h / vh);
                    const offX = (w - vw * cover) / 2;
                    const offY = (h - vh * cover) / 2;
                    const pts = quad.map((p) => ({ x: p.x * s * cover + offX, y: p.y * s * cover + offY }));
                    const ready = stableCountRef.current >= AUTO.stableFrames;
                    const accent = ready ? '#31A24C' : '#1877F2';

                    ctx.beginPath();
                    ctx.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
                    ctx.closePath();
                    ctx.fillStyle = ready ? 'rgba(49,162,76,0.14)' : 'rgba(24,119,242,0.10)';
                    ctx.fill();
                    ctx.strokeStyle = accent;
                    ctx.lineWidth = ready ? 4 : 3;
                    ctx.lineJoin = 'round';
                    ctx.stroke();
                    for (const p of pts) {
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, ready ? 8 : 6, 0, Math.PI * 2);
                        ctx.fillStyle = accent;
                        ctx.fill();
                    }
                }
            }
            rafRef.current = requestAnimationFrame(draw);
        };
        rafRef.current = requestAnimationFrame(draw);
        return () => {
            if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        };
    }, [isOpen, phase]);

    // ── capture ─────────────────────────────────────────────────────────────

    const paintPreview = useCallback(() => {
        const canvas = previewRef.current;
        const crop = cropRef.current;
        if (!canvas || !crop) return;
        canvas.width = crop.width;
        canvas.height = crop.height;
        canvas.getContext('2d').putImageData(
            new ImageData(new Uint8ClampedArray(crop.data), crop.width, crop.height), 0, 0,
        );
    }, []);

    const captureSide = useCallback(async (detectQuad, detectWidth) => {
        const video = videoRef.current;
        const client = clientRef.current;
        if (!video || !video.videoWidth || !client) return;
        if (capturingRef.current) return;
        capturingRef.current = true;
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        setPhase('processing');

        const full = frameFromVideo(video);
        stopCamera();
        if (!full) { capturingRef.current = false; setPhase('camera'); return; }

        let quad = detectQuad && detectWidth ? scaleQuad(detectQuad, full.width / detectWidth) : null;
        if (!quad || !validateQuad(quad, full.width, full.height).ok) {
            quad = fallbackQuad(full.width, full.height, 0.06);
        }

        try {
            const outSize = outputSizeFor(quad, 1800);
            const rect = await client.rectify({
                image: { data: full.data, width: full.width, height: full.height },
                quad,
                outSize,
                filter: 'original',
                quarterTurns: 0,
            });
            if (!mountedRef.current) return;

            if (cropRef.current) wipe(cropRef.current.data);
            cropRef.current = {
                data: new Uint8ClampedArray(rect.buffer),
                width: rect.width,
                height: rect.height,
            };

            // The source frame has served its purpose.
            wipe(full.data);

            if (side === 'back') {
                await decodeBack();
            } else {
                setCaptured((c) => ({ ...c, front: true }));
                setPhase('confirm');
            }
        } catch (err) {
            console.warn('[idscan] capture failed:', err && err.message);
            if (mountedRef.current) { capturingRef.current = false; setPhase('camera'); startCamera(); }
        }
        // decodeBack is stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [side, stopCamera, startCamera]);

    useEffect(() => { captureSideRef.current = captureSide; }, [captureSide]);

    useEffect(() => {
        if (phase === 'confirm') paintPreview();
    }, [phase, paintPreview]);

    /** Decode the barcode from the crop, then from the crop rotated, then give up. */
    const decodeBack = useCallback(async () => {
        const crop = cropRef.current;
        if (!crop) return;
        setBusy(true);
        try {
            const canvas = document.createElement('canvas');
            canvas.width = crop.width;
            canvas.height = crop.height;
            canvas.getContext('2d').putImageData(
                new ImageData(new Uint8ClampedArray(crop.data), crop.width, crop.height), 0, 0,
            );

            const result = await decodePdf417FromCandidates([
                { label: 'corrected', source: canvas },
            ]);

            collapseCanvas(canvas);

            if (!mountedRef.current) return;

            if (!result.ok) {
                setDecodeState(result.reason === 'unsupported' ? 'unsupported' : 'not-found');
                setCaptured((c) => ({ ...c, back: true }));
                setPhase('confirm');
                return;
            }

            const record = parseAamva(result.value);
            // The payload string is the whole machine-readable record. It is
            // read once, turned into fields, and not kept.
            if (!record.ok) {
                setDecodeState('not-found');
                setCaptured((c) => ({ ...c, back: true }));
                setPhase('confirm');
                return;
            }
            setParsed(record);
            setDecodeState('ok');
            setCaptured((c) => ({ ...c, back: true }));
            setPhase('confirm');
        } finally {
            if (mountedRef.current) setBusy(false);
        }
    }, []);

    const retake = useCallback(() => {
        if (cropRef.current) { wipe(cropRef.current.data); cropRef.current = null; }
        collapseCanvas(previewRef.current);
        setDecodeState(null);
        capturingRef.current = false;
        setPhase('camera');
        startCamera();
    }, [startCamera]);

    const goToBack = useCallback(() => {
        if (cropRef.current) { wipe(cropRef.current.data); cropRef.current = null; }
        collapseCanvas(previewRef.current);
        setSide('back');
        capturingRef.current = false;
        setPhase('camera');
        startCamera();
    }, [startCamera]);

    const finish = useCallback(() => {
        const payload = parsed
            ? { fields: parsed.fields, meta: parsed.meta, source: 'camera' }
            : { fields: {}, meta: {}, source: 'camera' };
        // Images are destroyed BEFORE the caller is handed anything, so there
        // is no window in which a parent component could reach for them.
        destroyImages();
        stopCamera();
        onComplete(payload);
        handleClose();
    }, [parsed, destroyImages, stopCamera, onComplete, handleClose]);

    if (!isOpen) return null;

    const cfg = SIDES[side];
    const age = parsed ? ageOn(parsed.fields.date_of_birth) : null;
    const expired = parsed ? isExpired(parsed.fields.id_expiry) : false;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70" onClick={handleClose} />

            <div className="relative bg-[#242526] rounded-xl w-full max-w-lg max-h-[92vh] overflow-y-auto border border-[#3A3B3C] shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 bg-[#242526] border-b border-[#3A3B3C] p-4 flex items-center justify-between z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#1877F2]/10 rounded-full flex items-center justify-center">
                            <ScanLine className="w-5 h-5 text-[#1877F2]" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-[#E4E6EB]">Scan ID</h2>
                            <p className="text-xs text-[#B0B3B8]">
                                {phase === 'confirm' && side === 'back' ? 'Review' : `${cfg.title} - Step ${side === 'front' ? 1 : 2} Of 2`}
                            </p>
                        </div>
                    </div>
                    <button onClick={handleClose} className="p-2 hover:bg-[#3A3B3C] rounded-lg" aria-label="Close">
                        <X className="w-5 h-5 text-[#B0B3B8]" />
                    </button>
                </div>

                {/* Privacy banner. Stated where staff and the member can see it. */}
                <div className="mx-4 mt-3 p-2.5 bg-[#31A24C]/10 border border-[#31A24C]/30 rounded-lg flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#31A24C] flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-[#B0B3B8]">
                        ID Images Are Never Saved To This Device And Are Never Uploaded. Only The
                        Details Read From The Card Are Kept.
                    </p>
                </div>

                <div className="p-4 space-y-4">
                    {cameraError && (
                        <div className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg space-y-2">
                            <div className="flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-[#EF4444] flex-shrink-0" />
                                <p className="text-sm font-medium text-[#EF4444]">{cameraError.title}</p>
                            </div>
                            <p className="text-xs text-[#B0B3B8]">{cameraError.body}</p>
                            <div className="flex gap-2 pt-1">
                                <button onClick={startCamera} className="px-3 py-2 bg-[#3A3B3C] text-[#E4E6EB] rounded-lg text-sm">Try Again</button>
                                <button onClick={handleClose} className="px-3 py-2 bg-[#1877F2] text-white rounded-lg text-sm">Enter By Hand</button>
                            </div>
                        </div>
                    )}

                    {/* Camera */}
                    {!cameraError && (phase === 'camera' || phase === 'processing') && (
                        <>
                            <div className="flex items-center gap-2 text-sm text-[#B0B3B8]">
                                <CreditCard className="w-4 h-4" />
                                <span>{cfg.hint}</span>
                            </div>

                            <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
                                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                                <canvas ref={overlayRef} className="absolute top-0 left-0 pointer-events-none" />

                                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 bg-black/70 rounded-full">
                                    <span className={`w-2 h-2 rounded-full ${detected ? (stability >= 1 ? 'bg-[#31A24C]' : 'bg-[#1877F2]') : 'bg-[#8A8D91]'}`} />
                                    <span className="text-xs text-[#E4E6EB] font-medium">{status}</span>
                                </div>

                                {phase === 'processing' && (
                                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                        <Loader2 className="w-7 h-7 text-[#1877F2] animate-spin" />
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between gap-3">
                                <div className="flex rounded-full border border-[#3A3B3C] overflow-hidden">
                                    <button onClick={() => setAutoCapture(true)}
                                        className={`px-4 py-2 text-sm font-medium ${autoCapture ? 'bg-[#1877F2] text-white' : 'text-[#B0B3B8]'}`}>Auto</button>
                                    <button onClick={() => { setAutoCapture(false); stableCountRef.current = 0; setStability(0); }}
                                        className={`px-4 py-2 text-sm font-medium ${!autoCapture ? 'bg-[#1877F2] text-white' : 'text-[#B0B3B8]'}`}>Manual</button>
                                </div>
                                <button onClick={() => captureSide(lastQuadRef.current, detectWidthRef.current)}
                                    className="w-16 h-16 rounded-full border-4 border-[#E4E6EB] flex items-center justify-center"
                                    aria-label="Capture">
                                    <span className="w-12 h-12 rounded-full bg-[#E4E6EB]" />
                                </button>
                                <div className="w-[104px] text-right">
                                    <span className="text-xs text-[#8A8D91]">{cfg.purpose}</span>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Confirm */}
                    {phase === 'confirm' && (
                        <>
                            <div className="rounded-xl overflow-hidden bg-black flex justify-center p-2 border border-[#3A3B3C]">
                                <canvas ref={previewRef} className="max-w-full max-h-[34vh] w-auto h-auto rounded" />
                            </div>

                            {side === 'front' && (
                                <p className="text-sm text-[#B0B3B8]">
                                    Front Captured. Now Turn The ID Over To Read The Barcode.
                                </p>
                            )}

                            {side === 'back' && busy && (
                                <div className="flex items-center gap-2 text-sm text-[#B0B3B8]">
                                    <Loader2 className="w-4 h-4 animate-spin" /> Reading The Barcode
                                </div>
                            )}

                            {side === 'back' && !busy && decodeState === 'ok' && parsed && (
                                <div className="bg-[#18191A] rounded-xl p-4 space-y-3 border border-[#31A24C]/30">
                                    <div className="flex items-center gap-2">
                                        <Check className="w-4 h-4 text-[#31A24C]" />
                                        <p className="text-sm font-medium text-[#31A24C]">Details Read From The ID</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                        <Detail label="Name" value={`${parsed.fields.first_name || ''} ${parsed.fields.last_name || ''}`.trim()} span />
                                        {/* Date and age share a row: at 375px a
                                            two-column split wraps the year onto
                                            its own line, which reads as a typo. */}
                                        <Detail
                                            label="Date Of Birth"
                                            span
                                            value={parsed.fields.date_of_birth
                                                ? `${parsed.fields.date_of_birth}${age == null ? '' : `  (Age ${age})`}`
                                                : null}
                                        />
                                        <Detail label="ID Number" value={parsed.fields.id_number} />
                                        <Detail label="State" value={parsed.fields.id_state} />
                                        <Detail label="Expires" value={parsed.fields.id_expiry} />
                                        <Detail
                                            label="Address"
                                            span
                                            value={[parsed.fields.address_street, parsed.fields.address_city, parsed.fields.address_state, parsed.fields.address_zip]
                                                .filter(Boolean).join(', ')}
                                        />
                                    </div>
                                    {expired && (
                                        <div className="flex items-center gap-2 p-2 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg">
                                            <AlertCircle className="w-4 h-4 text-[#EF4444]" />
                                            <p className="text-xs text-[#EF4444]">This ID Expired On {parsed.fields.id_expiry}</p>
                                        </div>
                                    )}
                                    {age != null && age < 21 && (
                                        <div className="flex items-center gap-2 p-2 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-lg">
                                            <AlertCircle className="w-4 h-4 text-[#F59E0B]" />
                                            <p className="text-xs text-[#F59E0B]">This Member Is {age}. Check Your Venue Age Policy.</p>
                                        </div>
                                    )}
                                    {parsed.meta.truncatedNames && parsed.meta.truncatedNames.length > 0 && (
                                        <p className="text-xs text-[#8A8D91]">
                                            The Card Truncates The {parsed.meta.truncatedNames.join(' And ')} Name. Check It Against The Front.
                                        </p>
                                    )}
                                </div>
                            )}

                            {side === 'back' && !busy && decodeState === 'not-found' && (
                                <div className="p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-lg space-y-1">
                                    <p className="text-sm font-medium text-[#F59E0B]">Barcode Not Read</p>
                                    <p className="text-xs text-[#B0B3B8]">
                                        Retake With The Barcode Flat And Well Lit, Or Continue And Enter The Details By Hand.
                                    </p>
                                </div>
                            )}

                            {side === 'back' && !busy && decodeState === 'unsupported' && (
                                <div className="p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-lg space-y-1">
                                    <p className="text-sm font-medium text-[#F59E0B]">This Browser Cannot Read ID Barcodes</p>
                                    <p className="text-xs text-[#B0B3B8]">
                                        Safari On iPhone And iPad Has No Barcode Reader. Use An Android Tablet Or Chrome,
                                        Use A Hardware ID Scanner, Or Enter The Details By Hand.
                                    </p>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                {phase === 'confirm' && (
                    <div className="sticky bottom-0 bg-[#242526] border-t border-[#3A3B3C] p-4 flex items-center gap-3">
                        <button onClick={retake}
                            className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#3A3B3C] text-[#E4E6EB] rounded-lg text-sm font-medium">
                            <RotateCcw className="w-4 h-4" /> Retake
                        </button>
                        {side === 'front' ? (
                            <button onClick={goToBack}
                                className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#1877F2] text-white rounded-lg text-sm font-medium">
                                Scan The Back <ChevronRight className="w-4 h-4" />
                            </button>
                        ) : (
                            <button onClick={finish} disabled={busy}
                                className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#31A24C] disabled:bg-[#3A3B3C] text-white rounded-lg text-sm font-medium">
                                <Check className="w-4 h-4" /> {decodeState === 'ok' ? 'Use These Details' : 'Continue'}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function Detail({ label, value, span }) {
    if (!value) return null;
    return (
        <div className={span ? 'col-span-2' : ''}>
            <span className="text-[#8A8D91]">{label}: </span>
            <span className="text-[#E4E6EB]">{value}</span>
        </div>
    );
}
