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
    fontSize: Math.round(size * 0.44),
    letterSpacing: '-0.02em',
    textShadow: '0 1px 0 rgba(255,255,255,0.5)',
    border: '1.5px solid rgba(0,0,0,0.15)',
    boxShadow: '0 3px 8px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.3), inset 0 2px 3px rgba(255,255,255,0.8), inset 0 -1px 2px rgba(0,0,0,0.15)',
    flexShrink: 0,
    ...extra,
  };
}

/**
 * The felt, drawn into the square seat box every view uses. Decorative: it
 * never takes a pointer event, so seat clicks and drags reach the seats.
 */
export default function ClubArenaTableFelt({ zIndex = 0 }) {
  return (
    <img
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
  );
}
