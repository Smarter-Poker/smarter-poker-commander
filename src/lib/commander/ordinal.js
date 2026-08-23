/**
 * Ordinal formatting - one copy, no dependencies.
 *
 * `ordinal()` was exported from alternateNotifications.js, and four screens
 * (must-move.js, td/results.js, td/reports.js, tournaments/[id]/public.js) had
 * each defined their own private copy rather than import it. The reason is
 * visible in that module's first line: it imports pushNotifications, which is
 * server-side, so pulling `ordinal` from there drags OneSignal configuration
 * into a client bundle. The duplication was a workaround for a layering
 * problem, not laziness.
 *
 * This module has no imports at all and never will, so any surface - server
 * route, client screen, print template - can use the same function.
 *
 * alternateNotifications.js re-exports from here, so existing importers are
 * unaffected.
 */

/**
 * 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th", 1021 -> "1,021st".
 *
 * Anything that is not a finite number >= 1 comes back as its own string:
 * a finishing position is either real or it is not, and inventing "0th" or
 * "NaNth" for a missing one hides the gap instead of showing it.
 */
export function ordinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 1) return String(n);
  const rem100 = num % 100;
  // 11th, 12th, 13th break the 1st/2nd/3rd pattern.
  if (rem100 >= 11 && rem100 <= 13) return `${num.toLocaleString()}th`;
  switch (num % 10) {
    case 1: return `${num.toLocaleString()}st`;
    case 2: return `${num.toLocaleString()}nd`;
    case 3: return `${num.toLocaleString()}rd`;
    default: return `${num.toLocaleString()}th`;
  }
}

export default ordinal;
