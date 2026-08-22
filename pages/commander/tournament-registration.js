/**
 * RETIRED 2026-08-20 - /commander/tournament-registration
 *
 * This was the cashier's tournament registration screen. It duplicated
 * /commander/td/[tournamentId]/register almost exactly: the same member search
 * endpoint, the same POST .../register, the same receipt template.
 *
 * The ONE thing it did that the modern screen could not was let the cashier
 * CHOOSE which event to register into, because the modern screen takes the
 * tournament from the URL. /commander/tournament-controls is already the room's
 * event picker, so it now carries a Register action per tournament that lands
 * directly on the modern screen. Nothing is lost and there is one registration
 * UI instead of two.
 *
 * PORTED BEFORE RETIREMENT (both into td/[tournamentId]/register.js):
 *   - Direct browser printing of the 3-copy buy-in receipt (PLAYER / DEALER /
 *     CASHIER, staggered 800ms to survive popup blockers). The modern screen
 *     queued the job at the print station, which is right for a TD tablet and
 *     wrong for a cage workstation with a wired printer. It now does both:
 *     queue automatically, plus a "Print Receipts Here" button.
 *   - The confetti celebration on a successful registration.
 *
 * The file is kept as a redirect rather than deleted: floor tablets have this
 * URL bookmarked and a 404 mid-event is not an acceptable upgrade path.
 */
import RetiredRoute from '../../src/components/commander/shared/RetiredRoute';

export default function TournamentRegistrationRetired() {
  return (
    <RetiredRoute
      to="/commander/tournament-controls"
      title="Tournament Registration"
      replacedBy="The Tournament Director List, Where Each Event Has A Register Button"
    />
  );
}
