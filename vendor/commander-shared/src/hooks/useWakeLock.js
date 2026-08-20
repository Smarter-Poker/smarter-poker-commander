import { useEffect, useRef } from 'react';

/**
 * useWakeLock - Keeps the screen awake on display/kiosk/tablet pages.
 * Uses the Screen Wake Lock API with proper visibilitychange re-acquisition
 * and named handler cleanup to prevent event listener leaks.
 *
 * Usage: just call useWakeLock() at the top of any component.
 * No arguments needed - it self-manages the entire lifecycle.
 *
 * Safe on all browsers: gracefully no-ops if Wake Lock API is unsupported.
 */
export default function useWakeLock() {
    const wakeLockRef = useRef(null);

    useEffect(() => {
        const requestWakeLock = async () => {
            try {
                if ('wakeLock' in navigator) {
                    wakeLockRef.current = await navigator.wakeLock.request('screen');
                }
            } catch { /* not supported or permission denied */ }
        };

        requestWakeLock();

        const handleVisChange = () => {
            if (document.visibilityState === 'visible') requestWakeLock();
        };
        document.addEventListener('visibilitychange', handleVisChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisChange);
            wakeLockRef.current?.release();
        };
    }, []);
}
