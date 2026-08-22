/**
 * Commander Shared Color Utilities
 * Centralized hex color manipulation - previously copy-pasted in desk.js and displays/waitlist.js.
 */

/**
 * Lighten a hex color by a percentage.
 * @param {string} hex - Hex color (e.g., '#B8860B')
 * @param {number} percent - Percentage (0-100)
 * @returns {string} Lightened hex color
 */
export function lighten(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + Math.round(2.55 * percent));
  const g = Math.min(255, ((num >> 8) & 0x00FF) + Math.round(2.55 * percent));
  const b = Math.min(255, (num & 0x0000FF) + Math.round(2.55 * percent));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

/**
 * Darken a hex color by a percentage.
 * @param {string} hex - Hex color (e.g., '#B8860B')
 * @param {number} percent - Percentage (0-100)
 * @returns {string} Darkened hex color
 */
export function darken(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - Math.round(2.55 * percent));
  const g = Math.max(0, ((num >> 8) & 0x00FF) - Math.round(2.55 * percent));
  const b = Math.max(0, (num & 0x0000FF) - Math.round(2.55 * percent));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}
