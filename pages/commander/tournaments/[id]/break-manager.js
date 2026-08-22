/**
 * RETIRED 2026-08-20 - /commander/tournaments/[id]/break-manager
 *
 * A standalone screen for one job: read GET .../auto-break, show the suggested
 * table and its seat assignments, then POST it and print the seat-change cards.
 *
 * /commander/td/[tournamentId]/tables does all of that (same GET, same POST,
 * same printSeatChangeCards) and adds everything this page never had: forcing a
 * specific table with ?force_table=, the manual break-table route, the
 * balance-suggest / balance-execute review flow with per-move failure
 * reporting, seat-conflict detection and repair, the seat draw, and eliminating
 * a player straight off the table map. It also falls back to queueing the seat
 * cards at the print station when the tablet has no printer, which this page
 * could not do.
 *
 * Nothing was ported: this page has no feature the modern one lacks. It also
 * had ZERO inbound links anywhere in the repo, so nothing but a bookmark could
 * reach it.
 *
 * Kept as a redirect rather than deleted, for exactly those bookmarks.
 */
import { useRouter } from 'next/router';
import RetiredRoute from '../../../../src/components/commander/shared/RetiredRoute';

export default function BreakManagerRetired() {
  const router = useRouter();
  const { id } = router.query;

  return (
    <RetiredRoute
      to={id ? `/commander/td/${id}/tables` : '/commander/tournament-controls'}
      title="Break Manager"
      replacedBy="The Tournament Director Tables Screen"
    />
  );
}
