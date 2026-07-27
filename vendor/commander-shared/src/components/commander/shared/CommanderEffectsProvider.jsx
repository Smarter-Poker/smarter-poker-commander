/**
 * Commander Effects Provider
 * ═══════════════════════════════════════════════════════
 * Subscribes to EventBus visual events and renders effects:
 *   CELEBRATION  → CSS confetti burst
 *   SCREEN_SHAKE → body shake animation
 *   SCREEN_FLASH → full-screen color flash overlay
 *
 * Mount once inside CommanderLayout to enable effects globally.
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { eventBus, EventType } from '../../../engine/EventBus';

// ─── Confetti Particle Component ───────────────────────────────
function ConfettiParticle({ x, delay, color, size, shape, duration }) {
    return (
        <div style={{
            position: 'fixed',
            left: `${x}%`,
            top: -20,
            width: size,
            height: size,
            background: color,
            borderRadius: shape === 'circle' ? '50%' : '2px',
            zIndex: 99999,
            pointerEvents: 'none',
            animation: `cmd-confetti-fall ${duration}s ease-in ${delay}s forwards`,
            opacity: 0.9,
        }} />
    );
}

export default function CommanderEffectsProvider({ children }) {
    const [confettiActive, setConfettiActive] = useState(false);
    const [confettiParticles, setConfettiParticles] = useState([]);
    const [flashColor, setFlashColor] = useState(null);
    const [shaking, setShaking] = useState(false);
    const shakeRef = useRef(null);
    const flashRef = useRef(null);
    const confettiTimerRef = useRef(null);

    // ── Confetti Effect ──
    const triggerConfetti = useCallback(() => {
        const colors = ['#1877F2', '#31A24C', '#F59E0B', '#EF4444', '#22D3EE', '#A855F7', '#fff'];
        const particles = [];
        for (let i = 0; i < 40; i++) {
            particles.push({
                id: i,
                x: 5 + Math.random() * 90,
                delay: Math.random() * 0.4,
                color: colors[Math.floor(Math.random() * colors.length)],
                size: 6 + Math.random() * 6,
                shape: Math.random() > 0.5 ? 'circle' : 'square',
                duration: 1.5 + Math.random(),
            });
        }
        setConfettiParticles(particles);
        setConfettiActive(true);
        if (confettiTimerRef.current) clearTimeout(confettiTimerRef.current);
        confettiTimerRef.current = setTimeout(() => {
            confettiTimerRef.current = null;
            setConfettiActive(false);
            setConfettiParticles([]);
        }, 3000);
    }, []);

    // ── Screen Shake Effect ──
    const triggerShake = useCallback((intensity = 'medium') => {
        const px = intensity === 'heavy' ? 8 : intensity === 'light' ? 2 : 4;
        setShaking(true);
        document.documentElement.style.setProperty('--cmd-shake-px', `${px}px`);
        if (shakeRef.current) clearTimeout(shakeRef.current);
        shakeRef.current = setTimeout(() => setShaking(false), 400);
    }, []);

    // ── Screen Flash Effect ──
    const triggerFlash = useCallback((color = '#1877F2', duration = 200) => {
        setFlashColor(color);
        if (flashRef.current) clearTimeout(flashRef.current);
        flashRef.current = setTimeout(() => setFlashColor(null), duration);
    }, []);

    // ── Subscribe to EventBus ──
    useEffect(() => {
        const unsubs = [
            eventBus.on(EventType.CELEBRATION, (e) => {
                const type = e.payload?.type;
                if (type === 'confetti' || !type) triggerConfetti();
                if (type === 'flash') triggerFlash('#31A24C', 300);
            }),
            eventBus.on(EventType.SCREEN_SHAKE, (e) => {
                triggerShake(e.payload?.intensity);
            }),
            eventBus.on(EventType.SCREEN_FLASH, (e) => {
                triggerFlash(e.payload?.color, e.payload?.duration);
            }),
        ];
        return () => {
            unsubs.forEach(fn => fn());
            if (confettiTimerRef.current) clearTimeout(confettiTimerRef.current);
            if (shakeRef.current) clearTimeout(shakeRef.current);
            if (flashRef.current) clearTimeout(flashRef.current);
        };
    }, [triggerConfetti, triggerShake, triggerFlash]);

    return (
        <>
            {/* ── Global Keyframe Styles ── */}
            <style>{`
        @keyframes cmd-confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(540deg); opacity: 0; }
        }
        @keyframes cmd-shake {
          0%, 100% { transform: translate(0, 0); }
          10% { transform: translate(var(--cmd-shake-px, 4px), calc(var(--cmd-shake-px, 4px) * -1)); }
          20% { transform: translate(calc(var(--cmd-shake-px, 4px) * -1), var(--cmd-shake-px, 4px)); }
          30% { transform: translate(var(--cmd-shake-px, 4px), var(--cmd-shake-px, 4px)); }
          40% { transform: translate(calc(var(--cmd-shake-px, 4px) * -1), calc(var(--cmd-shake-px, 4px) * -1)); }
          50% { transform: translate(var(--cmd-shake-px, 4px), calc(var(--cmd-shake-px, 4px) * -0.5)); }
          60% { transform: translate(calc(var(--cmd-shake-px, 4px) * -0.5), var(--cmd-shake-px, 4px)); }
          70% { transform: translate(calc(var(--cmd-shake-px, 4px) * 0.5), calc(var(--cmd-shake-px, 4px) * -1)); }
          80% { transform: translate(calc(var(--cmd-shake-px, 4px) * -1), calc(var(--cmd-shake-px, 4px) * 0.5)); }
          90% { transform: translate(calc(var(--cmd-shake-px, 4px) * 0.5), var(--cmd-shake-px, 4px)); }
        }
        .cmd-effects-shaking { animation: cmd-shake 0.4s ease-in-out; }
        @keyframes cmd-flash-fade {
          0% { opacity: 0.35; }
          100% { opacity: 0; }
        }
      `}</style>

            {/* ── Shake wrapper ── */}
            <div className={shaking ? 'cmd-effects-shaking' : ''}>
                {children}
            </div>

            {/* ── Confetti Layer ── */}
            {confettiActive && confettiParticles.map(p => (
                <ConfettiParticle key={p.id} x={p.x} delay={p.delay} color={p.color} size={p.size} shape={p.shape} duration={p.duration} />
            ))}

            {/* ── Flash Overlay ── */}
            {flashColor && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 99998,
                    pointerEvents: 'none',
                    background: flashColor,
                    animation: 'cmd-flash-fade 0.3s ease-out forwards',
                }} />
            )}
        </>
    );
}
