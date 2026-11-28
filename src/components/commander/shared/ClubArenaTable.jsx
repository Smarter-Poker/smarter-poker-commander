/**
 * ClubArenaTable - the Club Arena table skin for every Commander table view
 * (2026-11-28, #SMARTERDESIGN).
 *
 * docs/SMARTERDESIGN.md (World Hub): "Any poker table workspace ... must render
 * the authentic Club Arena / Poker Arena table skin, room background ... and
 * Arena dealer button." Commander's floor views (Tables, Table Tablets, the
 * dealer tablet, the Waitlist Desk floor and the TV table board) all drew the
 * retired black-and-gold table photo instead. They now draw Club Arena's own
 * "Ocean Suite" look, the free preset whose felt is blue and whose rail light
 * is cyan, so it sits inside the #SmarterDesign palette:
 *
 *   felt   club-arena/src/assets/tables/skin_ocean_blue.png (table_id
 *          ocean_blue), cropped to its painted edge and turned on its side
 *          for the landscape floor view: public/images/club-arena-table/
 *          ocean-blue-felt-landscape.webp
 *   room   club-arena/src/assets/backgrounds/bg_ocean_abyss.jpg (the same
 *          file World Hub ships at public/hub/table-theme/backgrounds/),
 *          resized to 720x1280: ocean-abyss-room.webp. Painted the way Arena
 *          paints it (src/lib/tableTheme.ts resolveBackgroundLayersForUrl):
 *          ambience over the art over an always-paints CSS floor.
 *   button Arena's classic-white dealer puck (TablePage.css .dealer-button
 *          and World Hub clubArenaTheme DEALER_BUTTON_STYLES['classic-white']).
 *
 * The images are imported, not referenced by a /images path, so their URLs
 * carry the production assetPrefix and load on both commander.smarter.poker
 * and the proxied smarter.poker/commander origin.
 *
 * Geometry: the felt fills the same square box the old photo filled and spans
 * the same oval (93% wide, centred), so every view's seat ring - an ellipse of
 * rx 47 / ry 22 around the centre - still stands on the rail.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import InlineStyle from './InlineStyle';
import feltImage from '../../../../public/images/club-arena-table/ocean-blue-felt-landscape.webp';
import roomImage from '../../../../public/images/club-arena-table/ocean-abyss-room.webp';

const srcOf = (mod) => (mod && typeof mod === 'object' ? mod.src : mod);

export const CLUB_ARENA_FELT_SRC = srcOf(feltImage);
export const CLUB_ARENA_ROOM_SRC = srcOf(roomImage);

/* Arena DEFAULT_TABLE_AMBIENCE / DEFAULT_TABLE_BACKDROP, verbatim. */
const AMBIENCE = [
  'radial-gradient(ellipse 120% 100% at 50% 55%, transparent 30%, rgba(0,0,0,0.5) 100%)',
  'radial-gradient(ellipse 88% 60% at 50% 46%, rgba(84,116,168,0.30) 0%, rgba(38,54,86,0.16) 45%, transparent 74%)',
].join(', ');
const BACKDROP = [
  'repeating-linear-gradient(45deg, rgba(255,255,255,0.014) 0px, rgba(255,255,255,0.014) 1px, transparent 1px, transparent 14px)',
  'linear-gradient(180deg, #101828 0%, #0b1424 45%, #060a12 100%)',
].join(', ');

/**
 * Style for the element that frames a table (the cropped viewport each view
 * already has): the Arena room behind the felt.
 */
export function clubArenaRoomStyle(extra) {
  return {
    backgroundColor: '#0a1020',
    backgroundImage: `${AMBIENCE}, url(${CLUB_ARENA_ROOM_SRC}), ${BACKDROP}`,
    backgroundSize: 'auto, auto, cover, auto, auto',
    backgroundPosition: 'center, center, center, center, center',
    backgroundRepeat: 'no-repeat, no-repeat, no-repeat, repeat, no-repeat',
    ...extra,
  };
}

/** Arena classic-white dealer puck. Size and position come from the caller. */
export function clubArenaDealerPuckStyle(size, extra) {
  return {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(145deg, #ffffff 0%, #e8e8e8 50%, #d0d0d0 100%)',
    color: '#111',
    fontWeight: 900,
    fontSize: typeof size === 'number' ? Math.round(size * 0.44) : `calc(${size} * 0.44)`,
    letterSpacing: '-0.02em',
    textShadow: '0 1px 0 rgba(255,255,255,0.5)',
    border: '1.5px solid rgba(0,0,0,0.15)',
    boxShadow: '0 3px 8px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.3), inset 0 2px 3px rgba(255,255,255,0.8), inset 0 -1px 2px rgba(0,0,0,0.15)',
    flexShrink: 0,
    ...extra,
  };
}


/* ═══════════════════════════════════════════════════════════════════════════
   SEATS SCALE WITH THE TABLE, NOT WITH THE SCREEN (2026-11-28)
   ═══════════════════════════════════════════════════════════════════════════

   Every view used to size its seat badges in fixed pixels (52px avatars,
   13px names, 110px name boxes) while the table itself shrank with the
   screen. On a 375-430px phone the seat box is ~330px wide and nine 180px
   badges piled on top of each other.

   The square seat box is now a CSS size container (SEAT_BOX_STYLE /
   SEAT_BOX_CLASS) and every badge dimension is `seatScale(ref)(px)`:
   clamp(min, px/ref of the box, px). `ref` is the box width the view has on
   a 1280px desktop, so at 1280 every badge is exactly the size it was and
   below that it shrinks with the table. Under 520px of box width the badges
   switch to a compact stack (avatar over a short ellipsised name, secondary
   text such as timers and "Tap To Seat" hidden), sized so no two seats of a
   2-10 seat ring overlap. Classes: ca-seat (+ --left / --right / --dealer),
   ca-seat__card (an inner card when the positioned element is a wrapper),
   ca-seat__avatar, ca-seat__text, ca-seat__name, ca-seat__meta.
*/

export const SEAT_BOX_CLASS = 'ca-seat-box';
export const SEAT_BOX_STYLE = { containerType: 'inline-size' };

/*
   OLD BROWSERS (2026-11-28). Container queries and container units arrived in
   Safari 16 and Chrome 105. An older venue tablet drops every declaration that
   names `cqw` and ignores `@container`, so the badges fell back to unstyled
   sizes and, on a phone-sized box, overlapped. The share of the box is
   therefore written `calc(N * var(--ca-u, 1cqw))`:
     - a modern browser never sets --ca-u, so the fallback `1cqw` is used and
       the computed size is exactly the container-unit size it was;
     - an old browser keeps the declaration (a var() is only checked when it
       is used) and ClubArenaTableFelt measures the seat box with a
       ResizeObserver and writes --ca-u = 1% of its width in px, plus
       data-ca-compact under SEAT_COMPACT_MAX_PX, which switches on a copy of
       the compact rules written in var(--ca-u) instead of cqw.
   The fallback only runs where seatBoxNeedsFallback() is true.
*/
export const SEAT_UNIT_VAR = '--ca-u';
const unit = (n) => `calc(${n} * var(${SEAT_UNIT_VAR}, 1cqw))`;

/** px -> clamp(min, share of the seat box, px). */
export function seatScale(ref) {
  return (px, min) => {
    const floor = min ?? Math.max(6, Math.round(px * 0.45));
    return `clamp(${floor}px, ${unit(((px / ref) * 100).toFixed(3))}, ${px}px)`;
  };
}

/** Class list for a seat badge positioned at `leftPct` across the ring. */
export function seatClass(leftPct, extra) {
  const side = leftPct < 25 ? ' ca-seat--left' : leftPct > 75 ? ' ca-seat--right' : '';
  return `ca-seat${side}${extra ? ` ${extra}` : ''}`;
}

export const SEAT_COMPACT_MAX_PX = 520;

/* The compact phone layout, written once in container units. */
const SEAT_COMPACT_RULES = `
.ca-seat{flex-direction:column!important;align-items:center!important;gap:1px!important;padding:2px 3px!important;min-width:0!important;width:auto!important;max-width:16cqw!important;border-radius:8px!important;transform:translate(-50%,-50%)!important}
.ca-seat__card{flex-direction:column!important;align-items:center!important;gap:1px!important;padding:2px 3px!important;min-width:0!important;max-width:16cqw!important;border-radius:8px!important}
.ca-seat--left{transform:translate(-30%,-50%)!important}
.ca-seat--right{transform:translate(-70%,-50%)!important}
.ca-seat--dealer{transform:translate(-50%,-70%)!important}
.ca-seat>div:not(.ca-seat__avatar):not(.ca-seat__text){max-width:15cqw}
.ca-seat__avatar{width:7.5cqw!important;height:7.5cqw!important;min-width:0!important;min-height:0!important;font-size:3.2cqw!important;border-width:1.5px!important;margin:0!important}
.ca-seat__avatar span{font-size:3.2cqw!important}
.ca-seat__text{max-width:15cqw!important;text-align:center!important}
.ca-seat__name{font-size:clamp(8px,2.5cqw,10px)!important;max-width:15cqw!important;line-height:1.1!important}
.ca-seat__meta{display:none!important}
.ca-seat-center{transform:translate(-50%,-50%) scale(0.7)!important}
`;

/**
 * The same rules for a browser without container units: every rule scoped to
 * a seat box the fallback marked data-ca-compact, every `Ncqw` rewritten as
 * N% of the measured box (--ca-u). Inert where the attribute is never set.
 */
export function compactFallbackCss(rules = SEAT_COMPACT_RULES) {
  return rules
    .replace(/(\d+(?:\.\d+)?)cqw/g, (_, n) => `calc(${n} * var(${SEAT_UNIT_VAR}))`)
    .replace(/(^|\})\s*([^{}]+)\{/g, (_, close, sel) => `${close}\n${sel.split(',').map((x) => `.${SEAT_BOX_CLASS}[data-ca-compact] ${x.trim()}`).join(',')}{`)
    .trim();
}

const SEAT_CSS = `
.ca-seat-box{container-type:inline-size}
.ca-seat__name,.ca-seat__meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ca-seat__text{min-width:0;overflow:hidden}
@container (max-width: ${SEAT_COMPACT_MAX_PX}px){${SEAT_COMPACT_RULES}}
${compactFallbackCss()}
`;

/**
 * True where `css` (window.CSS) lacks container units or size containers
 * (Safari < 16, Chrome < 105), or cannot say.
 */
export function cssLacksContainerUnits(css) {
  if (!css || typeof css.supports !== 'function') return true;
  try {
    return !(css.supports('width: 1cqw') && css.supports('container-type: inline-size'));
  } catch {
    return true;
  }
}

/** The fallback runs in such a browser, never during server rendering. */
export function seatBoxNeedsFallback() {
  return typeof window !== 'undefined' && cssLacksContainerUnits(window.CSS);
}

/**
 * Writes the fallback onto one seat box: --ca-u (1% of its width, px) and
 * data-ca-compact when it is SEAT_COMPACT_MAX_PX or narrower. Where
 * aspect-ratio is missing too (Safari < 15) the square box gets its height.
 */
export function applySeatBoxFallback(box, width, css) {
  if (!box || !(width > 0)) return;
  box.style.setProperty(SEAT_UNIT_VAR, `${(width / 100).toFixed(3)}px`);
  if (width <= SEAT_COMPACT_MAX_PX) box.setAttribute('data-ca-compact', '');
  else box.removeAttribute('data-ca-compact');
  let ratio = true;
  try { ratio = !!(css && css.supports && css.supports('aspect-ratio: 1 / 1')); } catch { ratio = false; }
  if (!ratio) box.style.height = `${width}px`;
}

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** Measures the enclosing seat box on browsers without container units. */
function useSeatBoxFallback(ref) {
  useIsoLayoutEffect(() => {
    if (!seatBoxNeedsFallback()) return undefined;
    const box = ref.current && ref.current.closest ? ref.current.closest(`.${SEAT_BOX_CLASS}`) : null;
    if (!box) return undefined;
    const css = window.CSS;
    const measure = () => applySeatBoxFallback(box, box.getBoundingClientRect().width, css);
    measure();
    if (typeof window.ResizeObserver === 'function') {
      const ro = new window.ResizeObserver(measure);
      ro.observe(box);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [ref]);
}

/**
 * The felt, drawn into the square seat box every view uses. Decorative: it
 * never takes a pointer event, so seat clicks and drags reach the seats.
 */
export default function ClubArenaTableFelt({ zIndex = 0 }) {
  const ref = useRef(null);
  useSeatBoxFallback(ref);
  return (
    <>
    <InlineStyle css={SEAT_CSS} data-club-arena-seat-css="" />
    <img
      ref={ref}
      src={CLUB_ARENA_FELT_SRC}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-club-arena-table="ocean_blue"
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: '93%',
        height: 'auto',
        aspectRatio: '999 / 580',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex,
        filter: 'drop-shadow(0 18px 30px rgba(0,0,0,0.55))',
      }}
    />
    </>
  );
}
