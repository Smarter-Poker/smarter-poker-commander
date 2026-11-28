/**
 * CLUB ARENA TABLE SKIN LAW (2026-11-28, #SMARTERDESIGN)
 *
 * World Hub docs/SMARTERDESIGN.md: any poker table workspace renders the
 * authentic Club Arena table skin, room background and Arena dealer button.
 * Commander's five table views drew a black-and-gold table photo
 * (poker-table-black-gold.png) instead. This pins that:
 *  1. nothing in source, styles or public references the gold table again,
 *     and the file itself is gone;
 *  2. every table view renders the shared Club Arena felt, room and puck;
 *  3. the Club Arena assets exist and are real WebP images;
 *  4. seat badges scale with the table: every seat, dealer and avatar/name/
 *     meta element is sized through seatScale() (clamp of the seat box), never
 *     a fixed pixel number, the seat box is a size container, and the compact
 *     phone layout exists (2026-11-28: on 375-430px phones nine fixed 180px
 *     badges piled on top of each other).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const TABLE_VIEWS = [
  'pages/commander/tables.js',
  'pages/commander/table-tablets.js',
  'pages/commander/tablet/[tableNumber].js',
  'pages/commander/waitlist/desk.js',
  'pages/commander/displays/tables.js',
];

const SKIN = 'src/components/commander/shared/ClubArenaTable.jsx';
const ASSETS = [
  'public/images/club-arena-table/ocean-blue-felt-landscape.webp',
  'public/images/club-arena-table/ocean-abyss-room.webp',
];

function filesUnder(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...filesUnder(p));
    else if (/\.(js|jsx|mjs|ts|tsx|css|json)$/.test(name)) out.push(p);
  }
  return out;
}

describe('Club Arena table skin', () => {
  it('nothing references the retired black-and-gold table', () => {
    const offenders = ['pages', 'src', 'styles', 'vendor/commander-shared/src', 'public', 'next.config.js']
      .flatMap((d) => (d.endsWith('.js') ? [d] : filesUnder(d)))
      .filter((f) => /poker-table-black-gold/.test(read(f)))
      .map((f) => relative(ROOT, join(ROOT, f)));
    expect(offenders).toEqual([]);
    expect(existsSync(join(ROOT, 'public/images/poker-table-black-gold.png'))).toBe(false);
  });

  it.each(TABLE_VIEWS)('%s draws the Club Arena felt, room and dealer puck', (file) => {
    const src = read(file);
    expect(src).toMatch(/from '[./]+\/src\/components\/commander\/shared\/ClubArenaTable'/);
    expect(src).toMatch(/<ClubArenaTableFelt\s*\/>/);
    expect(src).toMatch(/clubArenaRoomStyle\(/);
    expect(src).toMatch(/clubArenaDealerPuckStyle\(/);
  });

  it('the skin module imports the Club Arena assets and paints the Arena puck', () => {
    const src = read(SKIN);
    expect(src).toMatch(/import feltImage from '[./]+\/public\/images\/club-arena-table\/ocean-blue-felt-landscape\.webp'/);
    expect(src).toMatch(/import roomImage from '[./]+\/public\/images\/club-arena-table\/ocean-abyss-room\.webp'/);
    // Arena classic-white dealer button (TablePage.css .dealer-button)
    expect(src).toContain('linear-gradient(145deg, #ffffff 0%, #e8e8e8 50%, #d0d0d0 100%)');
    // The felt is decorative: seat clicks and drags must reach the seats.
    expect(src).toMatch(/pointerEvents: 'none'/);
  });

  it.each(ASSETS)('%s exists and is a WebP image', (file) => {
    const abs = join(ROOT, file);
    expect(existsSync(abs)).toBe(true);
    const head = readFileSync(abs).subarray(0, 12);
    expect(head.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(head.subarray(8, 12).toString('ascii')).toBe('WEBP');
    expect(statSync(abs).size).toBeLessThan(200 * 1024);
  });

  describe('seat badges scale with the table', () => {
    const SIZE_KEYS = /\b(width|height|fontSize|minWidth|maxWidth|gap|borderRadius):\s*\d/;
    const FIXED_PADDING = /\bpadding:\s*'\d/;

    it.each(TABLE_VIEWS)('%s sizes no seat badge in fixed pixels', (file) => {
      const src = read(file);
      expect(src).toMatch(/const sp = seatScale\((\d+|isFullscreen \? \d+ : \d+)\)/);
      expect(src).toMatch(/className=\{SEAT_BOX_CLASS\} style=\{\{ \.\.\.SEAT_BOX_STYLE/);
      expect(src).not.toMatch(/translate\(-\d+px/);
      expect(src).not.toMatch(/calc\(-100% \+ \d+px\)/);

      const markers = [...src.matchAll(/className=(\{seatClass\([^)]*\)\}|"ca-seat__(avatar|card|text|name|meta)")/g)];
      expect(markers.length).toBeGreaterThanOrEqual(6);
      const offenders = [];
      for (const m of markers) {
        const rest = src.slice(m.index);
        const end = rest.search(/\}\}>|\)\}>/);
        const block = rest.slice(0, end === -1 ? 400 : end);
        if (SIZE_KEYS.test(block) || FIXED_PADDING.test(block)) {
          offenders.push(block.split('\n')[0].trim().slice(0, 120));
        }
      }
      expect(offenders).toEqual([]);
      // Dealer pucks take a scaled size.
      for (const call of src.matchAll(/clubArenaDealerPuckStyle\(([^,)]+)/g)) {
        expect(call[1]).toMatch(/^(sp\(|avatarSize)/);
      }
    });

    it('the skin module scales by the seat box and has the compact phone layout', () => {
      const src = read(SKIN);
      expect(src).toMatch(/export function seatScale\(ref\)/);
      expect(src).toContain('${unit(((px / ref) * 100).toFixed(3))}, ${px}px)');
      expect(src).toContain('var(${SEAT_UNIT_VAR}, 1cqw)');
      expect(src).toContain("containerType: 'inline-size'");
      expect(src).toMatch(/@container \(max-width: \$\{SEAT_COMPACT_MAX_PX\}px\)/);
      expect(src).toMatch(/\.ca-seat__meta\{display:none!important\}/);
      expect(src).toMatch(/\.ca-seat__name\{[^}]*text-overflow|\.ca-seat__name,\.ca-seat__meta\{overflow:hidden;text-overflow:ellipsis/);
      expect(src).toMatch(/<InlineStyle css=\{SEAT_CSS\}/);
    });
  });
});

