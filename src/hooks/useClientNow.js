/**
 * useClientNow - the current time, only once the page is running in the
 * browser (2026-11-28, React hydration errors #425 / #423).
 *
 * `const [now, setNow] = useState(new Date())` reads the clock twice: once on
 * the server (UTC, at render) and again in the browser (local time zone,
 * seconds later). A wall clock rendered from it ("1:46:07 AM" vs
 * "1:46:08 AM") never matches, React throws #425 then #423 and re-renders the
 * whole page on the client. The display boards, lobby and player screens did
 * this on every load.
 *
 * This hook starts as `null` on the server AND on the first client render, so
 * both produce the same placeholder, then sets the real time right after mount
 * (and every `intervalMs` when given). It returns `[now, setNow]` so pages that
 * already refresh `now` themselves keep their own timers and setters.
 *
 *   const [now, setNow] = useClientNow();                 // Date | null
 *   const [nowMs] = useClientNow({ asNumber: true, intervalMs: 1000 });
 *
 * Render through formatClientTime / formatClientDate, which print the stable
 * placeholder while `now` is null. Law: tests/unit/hydrationSafeRender.law.test.js.
 */
import { useEffect, useState } from 'react';

export const CLIENT_TIME_PLACEHOLDER = ' ';

export default function useClientNow({ asNumber = false, intervalMs = 0 } = {}) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    const read = () => (asNumber ? Date.now() : new Date());
    setNow(read());
    if (!intervalMs) return undefined;
    const id = setInterval(() => setNow(read()), intervalMs);
    return () => clearInterval(id);
  }, [asNumber, intervalMs]);
  return [now, setNow];
}

/** `now.toLocaleTimeString('en-US', options)`, or the placeholder before mount. */
export function formatClientTime(now, options) {
  if (now == null) return CLIENT_TIME_PLACEHOLDER;
  return new Date(now).toLocaleTimeString('en-US', options);
}

/** `now.toLocaleDateString('en-US', options)`, or the placeholder before mount. */
export function formatClientDate(now, options) {
  if (now == null) return CLIENT_TIME_PLACEHOLDER;
  return new Date(now).toLocaleDateString('en-US', options);
}

/** `now.toLocaleString('en-US', options)`, or the placeholder before mount. */
export function formatClientDateTime(now, options) {
  if (now == null) return CLIENT_TIME_PLACEHOLDER;
  return new Date(now).toLocaleString('en-US', options);
}
