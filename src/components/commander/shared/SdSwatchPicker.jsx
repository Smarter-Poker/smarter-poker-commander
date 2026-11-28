/**
 * SdSwatchPicker - the only colour control a Commander editor offers
 * (2026-11-28, #SMARTERDESIGN).
 *
 * Replaces the free browser colour wheel (the native colour input), which let
 * staff save yellow, gold, purple or pink straight onto a TV board. It offers
 * SD_SWATCHES from src/lib/commander/sdPalette.js and nothing else, as real
 * buttons: 44px targets, an accessible name per swatch ("Accent: Cobalt"),
 * aria-pressed on the chosen one, and the chosen colour's Title Case name shown
 * beside the group. A saved value that is not a swatch (an older custom
 * colour) is shown through normalizeSdColor, so a banned hue never renders
 * here either, and is replaced the moment staff pick a swatch.
 *
 * Props:
 *   label     - the setting's name; names the group and each swatch
 *   value     - the saved colour
 *   onChange  - called with the chosen swatch hex
 *   size      - swatch diameter inside the 44px target (default 28)
 */
import { SD_SWATCHES, normalizeSdColor } from '../../../lib/commander/sdPalette';

export default function SdSwatchPicker({ label, value, onChange, size = 28, swatches = SD_SWATCHES }) {
  const shown = normalizeSdColor(value);
  const current = typeof shown === 'string'
    ? swatches.find((s) => s.hex === shown.trim().toUpperCase())
    : null;
  return (
    <div className="sd-swatch-picker" style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div role="group" aria-label={`${label} Color`} style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
        {swatches.map((s) => {
          const on = current?.hex === s.hex;
          return (
            <button
              key={s.hex}
              type="button"
              aria-label={`${label}: ${s.label}`}
              aria-pressed={on}
              title={s.label}
              data-swatch={s.hex}
              onClick={() => onChange(s.hex)}
              style={{
                width: 44, height: 44, minWidth: 44, padding: 0, margin: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none', cursor: 'pointer',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: size, height: size, borderRadius: '50%', background: s.hex,
                  boxShadow: on
                    ? '0 0 0 2px #040D18, 0 0 0 4px #86DAFF'
                    : 'inset 0 0 0 1px rgba(242, 247, 255, 0.28)',
                }}
              />
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#BDD0E2' }}>
        {current ? current.label : 'Saved Color'}
      </span>
    </div>
  );
}
