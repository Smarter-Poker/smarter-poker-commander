/**
 * RETIRED 2026-08-20 - /commander/tournaments/[id]
 *
 * This was the first-generation tournament detail screen: a mini console with a
 * clock panel, an eliminate modal, a payout modal and two player lists. Every
 * one of those is covered, and comfortably beaten, by the modern TD console at
 * /commander/td/[tournamentId]:
 *
 *   clock pause/resume/next level  ->  td/[id]/clock (also prev level, add and
 *                                      subtract time, break, hand for hand,
 *                                      final table, end)
 *   eliminate player               ->  td/[id]/players
 *   payouts                        ->  td/[id]/payouts (deal calculator, ICM,
 *                                      denomination rounding, cage payouts)
 *   active / eliminated lists      ->  td/[id]/players
 *   stats row                      ->  td/[id] stat grid
 *
 * PORTED BEFORE RETIREMENT (all into td/[tournamentId]/index.js):
 *   - Open Registration. This screen was the only place a scheduled tournament
 *     could be moved to open registration. It also sent status 'registering',
 *     which commander_tournaments_status_check does not allow; the ported
 *     version sends 'registration', the value that actually exists.
 *   - Start Tournament. Ported through POST .../clock {action:'start'} rather
 *     than the bare status PATCH this screen used, so actual_start, the level
 *     reset, the break-flag clear and the start push notification all happen.
 *   - Cancel Tournament (DELETE .../tournaments/[id]). Nothing in the modern
 *     console could close an event at all.
 *   - Public Clock pop-out. The modern Clock screen only mirrors the TV board
 *     in an iframe, so there was no way to throw it onto a second monitor.
 *     A pop-out button now sits in the Control Center header.
 *   - The link through to the Event Settings editor, which is now a tile in the
 *     Control Center rather than only being reachable from the selector.
 *
 * Kept as a redirect rather than deleted: the tournament list linked here on
 * every card tap, and floor tablets have it bookmarked.
 */
import { useRouter } from 'next/router';
import RetiredRoute from '../../../src/components/commander/shared/RetiredRoute';

export default function TournamentDetailRetired() {
  const router = useRouter();
  const { id } = router.query;

  return (
    <RetiredRoute
      to={id ? `/commander/td/${id}` : '/commander/tournament-controls'}
      title="Tournament Detail"
      replacedBy="The Tournament Director Control Center"
    />
  );
}
