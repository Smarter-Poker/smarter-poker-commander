/**
 * Commander Shared Formatting Utilities
 * Centralized pure functions — previously copy-pasted across 4+ pages.
 */

/**
 * Capitalize first letter of every word.
 * @param {string} str - Input string
 * @returns {string} Title-cased string
 */
export function titleCase(str) {
  if (!str) return '';
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Format a phone number as 555-555-5555 (US display format).
 * Strips leading country code '1' if 11 digits.
 * @param {string} raw - Raw phone input
 * @returns {string} Formatted phone or raw fallback
 */
export function formatPhone(raw) {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  // Strip leading country code '1' if 11 digits
  const digits = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  if (digits.length !== 10) return raw; // fallback: return as-is if not 10 digits
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
