/**
 * #SMARTERDESIGN APPROVED COLOURS FOR EVERY SAVED COLOUR SETTING (2026-11-28)
 *
 * Dan's #SMARTERDESIGN law (World Hub docs/SMARTERDESIGN.md) prohibits
 * yellow, gold, amber, purple, violet, lavender, pink and magenta anywhere.
 * PR #166 moved every colour written in source to the approved tokens, but four
 * editors still offered a free browser colour wheel (clock presets, chip
 * denominations, game types, the waitlist desk theme) and the boards painted
 * whatever had been saved. One click on the wheel, or any colour saved before
 * the migration, put a banned hue straight back on a TV board.
 *
 * The fix has two halves and both live here:
 *  1. SD_SWATCHES is the only set an editor may offer (SdSwatchPicker renders
 *     it as real buttons), so a new banned value cannot be chosen.
 *  2. normalizeSdColor() runs on every read of a saved colour. A banned hue
 *     becomes the approved colour nearest in lightness, so a stored value from
 *     before this change renders in-palette without touching the database;
 *     the next save through the picker stores the approved value.
 *
 * Values come from styles/smarterdesign.css (--sd-ink, --sd-surface,
 * --sd-text, --sd-silver, --sd-ice, --sd-line, the cobalt stops) and the
 * targets of scripts/smarterdesign-palette.mjs.
 */

/**
 * The approved swatches, in picker order. `role`: 'neutral' (white, silvers,
 * black), 'semantic' (green / red, for felt and alerts), none for the blues.
 */
export const SD_SWATCHES = Object.freeze([
  { hex: '#FFFFFF', label: 'White', role: 'neutral' },
  { hex: '#F2F7FF', label: 'Frost', role: 'neutral' },
  { hex: '#BDD0E2', label: 'Silver', role: 'neutral' },
  { hex: '#7F97B0', label: 'Steel', role: 'neutral' },
  { hex: '#445E77', label: 'Slate', role: 'neutral' },
  { hex: '#86DAFF', label: 'Ice' },
  { hex: '#22D3EE', label: 'Cyan' },
  { hex: '#38BDF8', label: 'Sky' },
  { hex: '#5AA9FF', label: 'Light Blue' },
  { hex: '#3A8FC0', label: 'Azure' },
  { hex: '#1981EC', label: 'Cobalt' },
  { hex: '#0C55C0', label: 'Royal Blue' },
  { hex: '#07377E', label: 'Deep Cobalt' },
  { hex: '#132A42', label: 'Deep Blue' },
  { hex: '#0D192E', label: 'Midnight' },
  { hex: '#0A1829', label: 'Surface' },
  { hex: '#040D18', label: 'Ink' },
  { hex: '#000000', label: 'Black', role: 'neutral' },
  { hex: '#31A24C', label: 'Green', role: 'semantic' },
  { hex: '#0A3D0A', label: 'Felt Green', role: 'semantic' },
  { hex: '#EF4444', label: 'Red', role: 'semantic' },
  { hex: '#2A0A0A', label: 'Deep Red', role: 'semantic' },
].map(Object.freeze));

/** A banned hue is replaced by one of the blues, so emphasis stays emphasis. */
const REPLACEMENTS = SD_SWATCHES.filter((s) => !s.role);

// CSS colour names a saved setting might hold, as [r, g, b]. Written as numbers,
// not hex, so scripts/smarterdesign-palette.mjs has nothing here to rewrite.
const NAMED = {
  yellow: [255, 255, 0], gold: [255, 215, 0], goldenrod: [218, 165, 32], darkgoldenrod: [184, 134, 11],
  orange: [255, 165, 0], amber: [255, 191, 0], khaki: [240, 230, 140], purple: [128, 0, 128],
  violet: [238, 130, 238], darkviolet: [148, 0, 211], blueviolet: [138, 43, 226], lavender: [230, 230, 250],
  pink: [255, 192, 203], hotpink: [255, 105, 180], deeppink: [255, 20, 147], magenta: [255, 0, 255],
  fuchsia: [255, 0, 255], orchid: [218, 112, 214], plum: [221, 160, 221], indigo: [75, 0, 130],
  white: [255, 255, 255], black: [0, 0, 0],
};

/** Parse #RGB, #RRGGBB, #RRGGBBAA, rgb()/rgba() or a known name. Null if not a colour we read. */
export function parseColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (NAMED[v]) { const [r, g, b] = NAMED[v]; return { r, g, b, a: null, form: 'hex' }; }
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b, a: null, form: 'hex' };
  }
  m = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) {
    return {
      r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16),
      a: m[2] ? m[2] : null, form: 'hex',
    };
  }
  m = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+%?)\s*)?\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] ?? null, form: 'rgb' };
  return null;
}

export function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

/** CIE L* (0-100): perceived lightness, so a pale gold maps to a pale blue. */
function lightness({ r, g, b }) {
  const lin = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/**
 * True for a prohibited hue: yellow / gold / amber / orange-gold (33-72 deg),
 * purple / violet / magenta / pink (250-345 deg), lavender (235-250 deg,
 * pale) and pale pink (345-360 deg, light). Greys, near-black and near-white carry no hue.
 */
export function isBannedColor(value) {
  const c = typeof value === 'string' ? parseColor(value) : value;
  if (!c) return false;
  const { h, s, l } = rgbToHsl(c);
  if (s < 0.2 || l < 0.05 || l > 0.97) return false;
  if (h >= 33 && h < 72) return true;
  if (h >= 250 && h < 345) return true;
  if (h >= 235 && h < 250 && l >= 0.8) return true;
  if (h >= 345 && l >= 0.7) return true;
  return false;
}

const APPROVED = new Set(SD_SWATCHES.map((s) => s.hex));
export function isApprovedSwatch(value) {
  return typeof value === 'string' && APPROVED.has(value.trim().toUpperCase());
}

/** The approved replacement for a parsed banned colour: nearest in perceived lightness. */
function nearestApproved(c) {
  const target = lightness(c);
  let best = REPLACEMENTS[0];
  let bestD = Infinity;
  for (const s of REPLACEMENTS) {
    const d = Math.abs(lightness(parseColor(s.hex)) - target);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best.hex;
}

/**
 * Every read of a saved colour goes through this. Approved and non-banned
 * colours come back unchanged (same string); a banned hue comes back as the
 * nearest approved colour, keeping any alpha. Unparseable values (gradients,
 * empty) come back unchanged, or as `fallback` when one is given and the value
 * is empty.
 */
export function normalizeSdColor(value, fallback) {
  if (value == null || value === '') return fallback !== undefined ? fallback : value;
  const c = parseColor(value);
  if (!c || !isBannedColor(c)) return value;
  const hex = nearestApproved(c);
  if (c.form === 'hex') return c.a ? `${hex}${c.a.toUpperCase()}` : hex;
  const p = parseColor(hex);
  return c.a != null ? `rgba(${p.r}, ${p.g}, ${p.b}, ${c.a})` : `rgb(${p.r}, ${p.g}, ${p.b})`;
}

/** Normalise the named colour fields of a saved settings object (returns a new object). */
export function normalizeSdColors(obj, keys) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const k of keys) if (k in out) out[k] = normalizeSdColor(out[k]);
  return out;
}

/** Waitlist desk / waitlist TV board customisation (settings.desk_customization). */
export const DESK_COLOR_KEYS = Object.freeze(['headerColor', 'accentColor', 'bgColor', 'cardBgColor', 'textColor', 'borderColor']);
/** Tournament clock preset theme (clock_presets.theme). */
export const CLOCK_THEME_KEYS = Object.freeze(['background', 'text', 'accent', 'blinds', 'headerBg']);

/** Clock preset display options: each chip denomination's colour. */
export function normalizeClockDisplayOptions(opts) {
  if (!opts || typeof opts !== 'object' || !Array.isArray(opts.chip_denominations)) return opts;
  return { ...opts, chip_denominations: opts.chip_denominations.map((ch) => (ch && typeof ch === 'object' ? { ...ch, color: normalizeSdColor(ch.color) } : ch)) };
}

/** A saved clock preset with every colour it carries normalised (theme + chip colours). */
export function normalizeClockPreset(preset) {
  if (!preset || typeof preset !== 'object') return preset;
  return {
    ...preset,
    theme: preset.theme ? normalizeSdColors(preset.theme, CLOCK_THEME_KEYS) : preset.theme,
    display_options: normalizeClockDisplayOptions(preset.display_options),
  };
}
