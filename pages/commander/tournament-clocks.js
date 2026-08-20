/**
 * RETIRED 2026-08-20 - /commander/tournament-clocks
 *
 * This was a "multi-clock hub": a list of live tournaments where each row had a
 * single Open Clock button that popped /commander/tournaments/[id]/clock-display
 * into a new window.
 *
 * /commander/displays already does all of that and strictly more. It lists the
 * same tournaments with the same clock-display URLs, and additionally offers the
 * structure board, the seating chart, the waitlist board and the combined
 * display, each with a copyable absolute URL for pasting into a wireless HDMI
 * source device. Two screens listing the same clock URLs is exactly the kind of
 * duplication that makes a fix land in one place and not the other.
 *
 * Nothing was ported: every feature of this page exists on /commander/displays.
 * The TV clock itself (/commander/tournaments/[id]/clock-display) is NOT
 * retired. It is the real board, it is iframed by the TD Clock screen and by
 * the table tablets, and it has no modern equivalent.
 *
 * Kept as a redirect rather than deleted: this URL is on the dashboard and on
 * floor bookmarks.
 */
import RetiredRoute from '../../src/components/commander/shared/RetiredRoute';

export default function TournamentClocksRetired() {
  return (
    <RetiredRoute
      to="/commander/displays"
      title="Tournament Clocks"
      replacedBy="Display Management, Which Launches Every TV Board"
    />
  );
}
