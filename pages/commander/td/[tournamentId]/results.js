/**
 * Tournament Director - Final Results / End Of Event
 * /commander/td/[tournamentId]/results
 *
 * The end of an event was the weakest part of the director. Payouts could be
 * recorded, but nothing stamped the finishing order, nothing closed the clock,
 * nothing printed a results sheet and nothing awarded season points. This
 * screen is the single place a TD ends a tournament:
 *
 *   - Shows the finishing order, payout per place and the champion
 *   - Shows prize pool, collected, overlay, entries, rebuys, add-ons
 *   - Shows start time, end time and duration
 *   - "Finalize Tournament" stamps finish_position + status on every paid
 *     entry (PUT payout with deal_only:false, which also awards leaderboard
 *     points) and then ends the clock (POST clock {action:'end'})
 *   - "Print Results" queues a print job so the sheet comes out at the floor
 *     print station instead of relying on a popup on this tablet
 *   - "Export CSV" downloads the same table for the room's records
 *
 * UI: Dark theme, SmarterPoker colors, Inter font, 44px+ touch targets.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import CommanderLayout from '../../../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../../../src/engine/EventBus';
import { broadcastChange } from '../../../../src/lib/commander/useCommanderSync';
import {
    Trophy, Users, DollarSign, LayoutGrid, Monitor, FileText,
    Download, Loader2, Printer, CheckCircle2, AlertTriangle, Clock, Ticket, Coins,
    FileJson, FileSpreadsheet, Scale, X
} from 'lucide-react';
import { commanderFetch, commanderFetchJSON } from '../../../../src/lib/commander/commanderFetch';
import { getStaffData } from '../../../../src/lib/commander/clientAuth';
// W-2G is assessed on NET winnings (payout minus that entry's own buy-in).
// Same helper the server uses, so this screen and the filed tax event can
// never disagree about who needs a form.
import { assessW2G, entryTotalInvested, W2G_NET_THRESHOLD } from '../../../../src/lib/commander/taxEvents';

const NAV_ITEMS = [
    { key: 'control', label: 'Control', path: '' },
    { key: 'tables', label: 'Tables', path: '/tables' },
    { key: 'players', label: 'Players', path: '/players' },
    { key: 'payouts', label: 'Payouts', path: '/payouts' },
    { key: 'reports', label: 'Reports', path: '/reports' },
    { key: 'clock', label: 'Clock', path: '/clock' },
];

const NAV_ICONS = {
    control: Trophy, tables: LayoutGrid, players: Users,
    payouts: DollarSign, reports: FileText, clock: Monitor
};

// Still alive in the tournament, used for "players without a finish position
// yet". 'bagged' (multi-day, chips in a bag overnight) belongs here: those
// players have not finished, so leaving them out understated how many places
// were still to be decided.
const ACTIVE_STATUSES = ['seated', 'active', 'bagged'];

function formatMoney(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return '$0';
    return '$' + Math.round(num).toLocaleString();
}

function formatCount(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return '0';
    return num.toLocaleString();
}

function ordinal(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num <= 0) return '--';
    const rem100 = num % 100;
    if (rem100 >= 11 && rem100 <= 13) return `${num}th`;
    const rem10 = num % 10;
    if (rem10 === 1) return `${num}st`;
    if (rem10 === 2) return `${num}nd`;
    if (rem10 === 3) return `${num}rd`;
    return `${num}th`;
}

function formatDateTime(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '--';
    return d.toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
}

function formatDuration(startTs, endTs) {
    if (!startTs) return '--';
    const start = new Date(startTs).getTime();
    const end = endTs ? new Date(endTs).getTime() : Date.now();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return '--';
    const totalMinutes = Math.round((end - start) / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}

function csvCell(value) {
    const s = value === null || value === undefined ? '' : String(value);
    return `"${s.replace(/"/g, '""')}"`;
}

export default function TDResults() {
    useEffect(() => { busEmit.sessionStart('commander-td-tournamentId-results'); }, []);
    const router = useRouter();
    const { tournamentId } = router.query;

    const [tournament, setTournament] = useState(null);
    const [payoutData, setPayoutData] = useState(null);
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [confirmFinalize, setConfirmFinalize] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [toast, setToast] = useState(null);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 5000);
        return () => clearTimeout(t);
    }, [toast]);

    const fetchAll = useCallback(async (signal) => {
        if (!tournamentId) return;
        try {
            const opts = { ...(signal ? { signal } : {}) };
            const [tJson, pJson, eJson] = await Promise.all([
                commanderFetchJSON(`/api/commander/tournaments/${tournamentId}`, opts).catch(() => null),
                commanderFetchJSON(`/api/commander/tournaments/${tournamentId}/payout?mode=calculate`, opts).catch(() => null),
                commanderFetchJSON(`/api/commander/tournaments/${tournamentId}/entries`, opts).catch(() => null)
            ]);
            if (tJson?.success) setTournament(tJson.data?.tournament || tJson.data || null);
            if (pJson?.success) setPayoutData(pJson.data || null);
            if (eJson?.success) setEntries(Array.isArray(eJson.data?.entries) ? eJson.data.entries : []);
        } catch (err) {
            console.warn('Fetch results error:', err);
        } finally {
            setLoading(false);
        }
    }, [tournamentId]);

    useEffect(() => {
        const c = new AbortController();
        fetchAll(c.signal);
        return () => c.abort();
    }, [fetchAll]);

    // ── Derived ───────────────────────────────────────────────────────────
    const liveEntries = useMemo(
        () => (entries || []).filter(e => e.status !== 'cancelled'),
        [entries]
    );

    const playersRemaining = useMemo(
        () => liveEntries.filter(e => !e.finish_position && ACTIVE_STATUSES.includes(e.status)).length,
        [liveEntries]
    );

    // A recorded deal wins over the calculated table: those are the amounts the
    // players actually agreed to and the cage already knows about.
    const dealTable = useMemo(() => {
        const deal = payoutData?.final_payouts;
        if (!Array.isArray(deal) || deal.length === 0) return null;
        const map = {};
        deal.forEach((p, i) => { map[Number(p.position || i + 1)] = Number(p.amount) || 0; });
        return map;
    }, [payoutData]);

    /**
     * The finishing order as it stands right now. Entries carrying a
     * finish_position are authoritative; the calculated table fills in the
     * still-unassigned paid places from the current chip order so the TD can
     * see (and finalize) what the sheet will say.
     */
    // Satellite: which places win a SEAT rather than a cash prize. Taken from
    // the calculated table, which is built by the same shared helper the busts
    // use, so the sheet says "Seat" for exactly the places that were paid one.
    const seatPositions = useMemo(() => {
        const set = new Set();
        (payoutData?.calculated_payouts || []).forEach(slot => {
            if (slot.is_seat) set.add(Number(slot.position));
        });
        return set;
    }, [payoutData]);

    const isSatellite = !!payoutData?.is_satellite;
    const seatValue = Number(payoutData?.seat_value) || 0;

    // A recorded deal replaces the seat schedule with cash, so a dealt place is
    // never labelled as a seat.
    const wonSeatAt = useCallback((position, entry) => {
        if (dealTable && dealTable[position] !== undefined) return false;
        if (entry?.metadata?.won_seat) return true;
        return seatPositions.has(Number(position));
    }, [dealTable, seatPositions]);

    const standings = useMemo(() => {
        const finished = liveEntries
            .filter(e => e.finish_position)
            .sort((a, b) => a.finish_position - b.finish_position)
            .map(e => ({
                position: e.finish_position,
                player_name: e.profiles?.display_name || e.player_name || 'Player',
                amount: Number(e.payout_amount) || dealTable?.[e.finish_position] || 0,
                entry_id: e.id,
                player_id: e.player_id || null,
                rebuys: e.rebuy_count || 0,
                addon: !!e.addon_taken,
                // entryTotalInvested, not the raw column: a row written before
                // the total_invested trigger existed reads 0, and a 0 wager
                // would make every payout look like a W-2G.
                invested: entryTotalInvested(tournament, e),
                eliminated_at: e.eliminated_at || null,
                knockouts: Number(e.bounties_collected) || 0,
                bounty_winnings: Number(e.bounty_winnings ?? e.metadata?.bounty_winnings) || 0,
                is_seat: wonSeatAt(e.finish_position, e),
                projected: false
            }));

        const takenPositions = new Set(finished.map(r => r.position));
        const projected = (payoutData?.calculated_payouts || [])
            .filter(slot => slot.is_projected && !takenPositions.has(slot.position))
            .map(slot => {
                const entry = liveEntries.find(e => e.id === slot.entry_id) || {};
                return {
                    position: slot.position,
                    player_name: slot.player_name || entry.player_name || 'Player',
                    amount: dealTable?.[slot.position] ?? (Number(slot.amount) || 0),
                    entry_id: slot.entry_id || null,
                    player_id: slot.player_id || null,
                    rebuys: entry.rebuy_count || 0,
                    addon: !!entry.addon_taken,
                    invested: entryTotalInvested(tournament, entry),
                    eliminated_at: null,
                    knockouts: Number(entry.bounties_collected) || 0,
                    bounty_winnings: Number(entry.bounty_winnings ?? entry.metadata?.bounty_winnings) || 0,
                    is_seat: wonSeatAt(slot.position, entry),
                    projected: true
                };
            });

        return [...finished, ...projected].sort((a, b) => a.position - b.position);
        // `tournament` is a dependency because entryTotalInvested derives the
        // wager from its prices when total_invested is missing.
    }, [liveEntries, payoutData, dealTable, wonSeatAt, tournament]);

    /**
     * Finishers who trigger a W-2G.
     *
     * Net of THAT ENTRY's own buy-in, more than $5,000. Bounty winnings are
     * deliberately not folded in: they are paid at the table as they are won,
     * not as tournament proceeds at the window, and the server-side assessment
     * (which is what actually files the event) reads payout_amount alone. The
     * two must agree or the floor gets a different list from the cage.
     */
    const w2gRows = useMemo(() => standings
        .map(r => ({ row: r, assessment: assessW2G({ grossPayout: r.amount, totalInvested: r.invested }) }))
        .filter(x => x.assessment.reportable)
        .sort((a, b) => b.assessment.net - a.assessment.net)
        .map(({ row, assessment }) => ({
            key: row.entry_id || `${row.position}-${row.player_name}`,
            position: row.position,
            player_name: row.player_name,
            projected: row.projected,
            gross: assessment.gross,
            buy_in: assessment.buy_in,
            net: assessment.net
        })), [standings]);

    // Bounty winnings, whole field (not just the money places): a player can
    // take five bounties and still bust on the bubble.
    const bountyStandings = useMemo(() => {
        if (!(Number(payoutData?.bounty_pool) > 0)) return [];
        return liveEntries
            .map(e => ({
                entry_id: e.id,
                player_name: e.profiles?.display_name || e.player_name || 'Player',
                knockouts: Number(e.bounties_collected) || 0,
                winnings: Number(e.bounty_winnings ?? e.metadata?.bounty_winnings) || 0
            }))
            .filter(r => r.knockouts > 0 || r.winnings > 0)
            .sort((a, b) => b.winnings - a.winnings || b.knockouts - a.knockouts);
    }, [liveEntries, payoutData]);

    const totalBountyWinnings = bountyStandings.reduce((s, r) => s + r.winnings, 0);

    const winner = standings.find(r => r.position === 1) || null;
    const totalPaid = standings.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const isCompleted = tournament?.status === 'completed';
    const hasProjected = standings.some(r => r.projected);

    // ── Finalize ──────────────────────────────────────────────────────────
    const finalize = async () => {
        if (!tournamentId) return;
        // The WHOLE finishing order is sent, not just the money places, so
        // every finisher accrues season leaderboard points. The API only
        // rewrites status for 1st place or a place that was actually paid, so
        // a $0 bustout keeps its 'eliminated' status.
        const payouts = standings
            .filter(r => r.entry_id || r.player_id)
            .map(r => ({
                entry_id: r.entry_id || undefined,
                player_id: r.player_id || undefined,
                position: r.position,
                amount: Number(r.amount) || 0
            }));

        if (payouts.length === 0) {
            setToast({ type: 'error', text: 'No Finishing Order To Record Yet.' });
            setConfirmFinalize(false);
            return;
        }

        setBusy(true);
        try {
            // 1. Stamp the finishing order + award leaderboard points.
            //    deal_only:false is what turns a recorded chop into a result.
            const payoutRes = await commanderFetch(`/api/commander/tournaments/${tournamentId}/payout`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payouts, deal_only: false })
            });
            const payoutJson = await payoutRes.json().catch(() => ({}));
            if (!payoutRes.ok || !payoutJson.success) {
                setToast({ type: 'error', text: payoutJson?.error?.message || 'Failed To Record The Finishing Order.' });
                return;
            }

            // 2. End the clock. The finishing order is already saved at this
            //    point, so a rejected clock action is reported but never
            //    silently rolls the payouts back.
            const clockRes = await commanderFetch(`/api/commander/tournaments/${tournamentId}/clock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'end' })
            });
            const clockJson = await clockRes.json().catch(() => ({}));

            if (!clockRes.ok || !clockJson.success) {
                setToast({
                    type: 'error',
                    text: `Results Saved, But The Clock Did Not End: ${clockJson?.error?.message || 'Unknown Error'}`
                });
            } else {
                setToast({ type: 'success', text: 'Tournament Finalized. Results Recorded And Clock Ended.' });
            }

            broadcastChange('tournaments');
            await fetchAll();
        } catch (err) {
            console.warn('Finalize error:', err);
            setToast({ type: 'error', text: 'Finalize Failed. Check The Connection And Try Again.' });
        } finally {
            setBusy(false);
            setConfirmFinalize(false);
        }
    };

    // ── Print ─────────────────────────────────────────────────────────────
    const printResults = async () => {
        if (!tournamentId) return;
        if (standings.length === 0) {
            setToast({ type: 'error', text: 'Nothing To Print Until A Finishing Order Exists.' });
            return;
        }

        let staff = {};
        try { staff = getStaffData() || {}; } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
        let venue = {};
        try { venue = JSON.parse(localStorage.getItem('commander_venue') || '{}') || {}; }
        catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

        const receipt = {
            receipt_kind: 'tournament_results',
            venue_name: staff.venue_name || venue.name || '',
            venue_city: staff.venue_city || venue.city || '',
            venue_state: staff.venue_state || venue.state || '',
            tournament_name: tournament?.name || 'Tournament',
            started_at: tournament?.actual_start || tournament?.scheduled_start || null,
            ended_at: tournament?.ended_at || null,
            total_entries: payoutData?.total_entries ?? liveEntries.length,
            total_rebuys: payoutData?.total_rebuys ?? 0,
            total_addons: payoutData?.total_addons ?? 0,
            prize_pool: payoutData?.prize_pool ?? 0,
            total_paid: totalPaid,
            overlay: payoutData?.overlay ?? 0,
            timestamp: new Date().toISOString(),
            // The paper sheet lists the money places plus the final table, not
            // every one of a 150-runner field. The CSV export carries the full
            // finishing order for anyone who needs it.
            // Satellites pay seats, so the sheet has to say so or the cage
            // hands over cash for a place that won a tournament entry.
            is_satellite: isSatellite,
            seat_value: seatValue,
            seats_awarded: Number(payoutData?.seats_awarded) || 0,
            bounty_pool: Number(payoutData?.bounty_pool) || 0,
            total_bounty_winnings: totalBountyWinnings,
            results: standings
                .filter(r => Number(r.amount) > 0 || r.position <= 9)
                .map(r => ({
                    position: r.position,
                    player_name: r.player_name,
                    amount: Number(r.amount) || 0,
                    is_seat: !!r.is_seat,
                    bounty_winnings: Number(r.bounty_winnings) || 0
                }))
        };

        setBusy(true);
        try {
            const res = await commanderFetch('/api/commander/print-jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_type: 'payout',
                    tournament_id: tournamentId,
                    receipts: [receipt],
                    title: `Final Results, ${tournament?.name || 'Tournament'}`,
                    source: 'td_results'
                })
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.success) {
                setToast({ type: 'error', text: json?.error?.message || 'Failed To Queue The Results Sheet.' });
                return;
            }
            setToast({ type: 'success', text: 'Results Sheet Queued At The Print Station.' });
        } catch (err) {
            console.warn('Print results error:', err);
            setToast({ type: 'error', text: 'Failed To Queue The Results Sheet.' });
        } finally {
            setBusy(false);
        }
    };

    // ── Event packet export ───────────────────────────────────────────────
    /**
     * Pull one format of the end-of-event packet and hand it to the browser.
     *
     * Goes through commanderFetch so the staff session travels with it: the
     * export route is staff-guarded and venue-scoped, so a plain anchor href
     * would just download a 401 body as a file.
     */
    const downloadPacket = async (format, filename) => {
        if (!tournamentId) return;
        setExportOpen(false);
        setBusy(true);
        try {
            const res = await commanderFetch(
                `/api/commander/tournaments/${tournamentId}/export?format=${encodeURIComponent(format)}`
            );
            if (!res.ok) {
                const json = await res.json().catch(() => ({}));
                setToast({ type: 'error', text: json?.error?.message || 'Failed To Build The Export.' });
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            setToast({ type: 'success', text: 'Export Downloaded.' });
        } catch (err) {
            console.warn('Export error:', err);
            setToast({ type: 'error', text: 'Failed To Build The Export.' });
        } finally {
            setBusy(false);
        }
    };

    // ── CSV ───────────────────────────────────────────────────────────────
    const exportCSV = () => {
        setExportOpen(false);
        if (standings.length === 0) return;
        const header = 'Position,Player,Payout,Prize Type,Knockouts,Bounty Winnings,Rebuys,Add-On,Total Invested,Eliminated At,Provisional\n';
        const rows = standings.map(r => [
            r.position,
            csvCell(r.player_name),
            Number(r.amount) || 0,
            csvCell(Number(r.amount) > 0 ? (r.is_seat ? 'Seat' : 'Cash') : ''),
            r.knockouts || 0,
            Number(r.bounty_winnings) || 0,
            r.rebuys,
            r.addon ? 'Yes' : 'No',
            r.invested,
            r.eliminated_at || '',
            r.projected ? 'Yes' : 'No'
        ].join(','));

        const csv = header + rows.join('\n') + '\n';
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tournament_results_${tournamentId}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const navigateTo = (path) => router.push(`/commander/td/${tournamentId}${path}`);

    if (!router.isReady) return null;

    return (
        <CommanderLayout title="Final Results">
            <SEOHead title="TD Final Results" noindex={true} />
            <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter'] pb-24">

                {/* Header */}
                <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 sticky top-0 z-30">
                    <div className="flex items-center justify-between gap-2 max-w-2xl mx-auto">
                        <div className="min-w-0">
                            <h1 className="text-lg font-bold text-white truncate">Final Results</h1>
                            <p className="text-xs text-[#B0B3B8] truncate">{tournament?.name || 'Tournament'}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <button onClick={printResults} disabled={busy || loading || standings.length === 0}
                                className="h-11 px-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-medium flex items-center gap-2 active:scale-95 disabled:opacity-50">
                                <Printer className="w-4 h-4" /> Print
                            </button>
                            <button onClick={() => setExportOpen(true)} disabled={busy || loading}
                                className="h-11 px-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-medium flex items-center gap-2 active:scale-95 disabled:opacity-50">
                                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Export
                            </button>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
                    </div>
                ) : (
                    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

                        {/* Champion */}
                        <div className="bg-gradient-to-br from-[#242526] to-[#3A3B3C] border border-[#4A4B4C] rounded-xl p-5 text-center">
                            <Trophy className="w-8 h-8 text-[#F59E0B] mx-auto mb-2" />
                            <p className="text-xs uppercase tracking-wider text-[#B0B3B8]">
                                {isCompleted ? 'Champion' : 'Current Chip Leader Or Winner'}
                            </p>
                            <p className="text-2xl font-bold text-white mt-1 break-words">
                                {winner ? winner.player_name : 'Not Decided Yet'}
                            </p>
                            {winner && Number(winner.amount) > 0 && (
                                winner.is_seat ? (
                                    <p className="text-lg font-bold text-[#1877F2] mt-1 flex items-center justify-center gap-2">
                                        <Ticket className="w-5 h-5" /> Seat, {formatMoney(winner.amount)} Value
                                    </p>
                                ) : (
                                    <p className="text-lg font-bold text-[#31A24C] mt-1">{formatMoney(winner.amount)}</p>
                                )
                            )}
                            {winner?.projected && (
                                <p className="text-[11px] text-[#F59E0B] mt-2">
                                    Provisional. Finalize To Lock This In.
                                </p>
                            )}
                        </div>

                        {/* Money summary */}
                        <div className="grid grid-cols-2 gap-3">
                            <SummaryCard label="Prize Pool" value={formatMoney(payoutData?.prize_pool)} color="#31A24C" />
                            <SummaryCard label="Total Paid" value={formatMoney(totalPaid)} color="#31A24C" />
                            <SummaryCard label="Collected" value={formatMoney(payoutData?.collected_pool)} />
                            <SummaryCard
                                label="Overlay"
                                value={formatMoney(payoutData?.overlay)}
                                color={Number(payoutData?.overlay) > 0 ? '#EF4444' : '#B0B3B8'}
                            />
                            <SummaryCard label="Entries" value={formatCount(payoutData?.total_entries ?? liveEntries.length)} />
                            <SummaryCard label="House Fees" value={formatMoney(payoutData?.house_fees)} color="#F59E0B" />
                            <SummaryCard label="Rebuys" value={formatCount(payoutData?.total_rebuys)} />
                            <SummaryCard label="Add-Ons" value={formatCount(payoutData?.total_addons)} />
                            {isSatellite && (
                                <>
                                    <SummaryCard label="Seats Awarded" value={formatCount(payoutData?.seats_awarded)} color="#1877F2" />
                                    <SummaryCard label="Seat Value" value={formatMoney(seatValue)} color="#1877F2" />
                                </>
                            )}
                            {Number(payoutData?.bounty_pool) > 0 && (
                                <>
                                    <SummaryCard label="Bounty Pool" value={formatMoney(payoutData?.bounty_pool)} color="#F59E0B" />
                                    <SummaryCard label="Bounties Paid" value={formatMoney(totalBountyWinnings)} color="#F59E0B" />
                                </>
                            )}
                        </div>

                        {/* W-2G, before the player leaves the building */}
                        {w2gRows.length > 0 && (
                            <div className="rounded-xl border border-[#EF4444]/40 bg-[#EF4444]/10 overflow-hidden">
                                <div className="px-4 py-2 border-b border-[#EF4444]/30 flex items-center gap-2">
                                    <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
                                    <h3 className="text-xs font-bold text-[#EF4444] uppercase tracking-wider flex-1">
                                        W-2G Required
                                    </h3>
                                    <span className="text-[10px] text-[#EF4444]">{w2gRows.length}</span>
                                </div>
                                <div className="divide-y divide-[#EF4444]/20">
                                    {w2gRows.map(x => (
                                        <div key={x.key} className="px-4 py-3 flex items-center gap-3">
                                            <span className="w-10 text-xs font-bold text-[#B0B3B8] flex-shrink-0">
                                                {ordinal(x.position)}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-[#E4E6EB] truncate">{x.player_name}</p>
                                                <p className="text-[10px] text-[#B0B3B8]">
                                                    Gross {formatMoney(x.gross)}, Buy-In {formatMoney(x.buy_in)}
                                                    {x.projected ? ', Provisional' : ''}
                                                </p>
                                            </div>
                                            <span className="text-sm font-bold text-[#EF4444] flex-shrink-0">
                                                Net {formatMoney(x.net)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <p className="px-4 py-2.5 text-[11px] text-[#E4E6EB] border-t border-[#EF4444]/20">
                                    Reportable Amount Is Net Of That Entry Buy-In, Over {formatMoney(W2G_NET_THRESHOLD)}.
                                    Collect The Taxpayer Identification Number At The Window. No TIN Is Stored By This
                                    System, So Backup Withholding Is Never Applied Automatically.
                                </p>
                            </div>
                        )}

                        {/* Bounty winnings, whole field */}
                        {bountyStandings.length > 0 && (
                            <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
                                <div className="px-4 py-2 border-b border-[#3A3B3C] flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Coins className="w-4 h-4 text-[#F59E0B]" />
                                        <h3 className="text-xs font-bold text-[#B0B3B8] uppercase tracking-wider">Bounty Winnings</h3>
                                    </div>
                                    <span className="text-[10px] text-[#B0B3B8]">
                                        {formatMoney(totalBountyWinnings)} Paid On Knockouts
                                    </span>
                                </div>
                                <div className="divide-y divide-[#3A3B3C]">
                                    {bountyStandings.map(r => (
                                        <div key={r.entry_id} className="px-4 py-3 flex items-center gap-3">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-[#E4E6EB] truncate">{r.player_name}</p>
                                                <p className="text-[10px] text-[#B0B3B8]">
                                                    {formatCount(r.knockouts)} Knockout{r.knockouts === 1 ? '' : 's'}
                                                </p>
                                            </div>
                                            <span className="text-sm font-bold text-[#F59E0B] flex-shrink-0">
                                                {formatMoney(r.winnings)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Timing */}
                        <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4 space-y-2">
                            <div className="flex items-center gap-2 mb-1">
                                <Clock className="w-4 h-4 text-[#B0B3B8]" />
                                <h3 className="text-xs font-bold text-[#B0B3B8] uppercase tracking-wider">Event Timing</h3>
                            </div>
                            <InfoRow label="Started" value={formatDateTime(tournament?.actual_start || tournament?.scheduled_start)} />
                            <InfoRow label="Ended" value={formatDateTime(tournament?.ended_at)} />
                            <InfoRow
                                label="Duration"
                                value={formatDuration(
                                    tournament?.actual_start || tournament?.scheduled_start,
                                    tournament?.ended_at
                                )}
                            />
                            <InfoRow label="Players Remaining" value={formatCount(playersRemaining)} />
                        </div>

                        {/* Finishing order */}
                        <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
                            <div className="px-4 py-2 border-b border-[#3A3B3C] flex items-center justify-between">
                                <h3 className="text-xs font-bold text-[#B0B3B8] uppercase tracking-wider">Finishing Order</h3>
                                <span className="text-[10px] text-[#B0B3B8]">{standings.length} Place{standings.length === 1 ? '' : 's'}</span>
                            </div>
                            <div className="divide-y divide-[#3A3B3C]">
                                {standings.length === 0 ? (
                                    <div className="px-4 py-8 text-center text-[#B0B3B8] text-sm">
                                        No Finishing Order Recorded Yet
                                    </div>
                                ) : standings.map(r => (
                                    <div key={`${r.position}-${r.entry_id || r.player_name}`} className="px-4 py-3 flex items-center gap-3">
                                        <span className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${r.position === 1 ? 'bg-[#F59E0B]/20 text-[#F59E0B]'
                                            : r.position <= 3 ? 'bg-[#1877F2]/20 text-[#1877F2]'
                                                : 'bg-[#3A3B3C] text-[#B0B3B8]'
                                            }`}>
                                            {r.position}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-[#E4E6EB] truncate">{r.player_name}</p>
                                            <p className="text-[10px] text-[#B0B3B8]">
                                                {ordinal(r.position)}
                                                {r.rebuys > 0 ? `, ${r.rebuys}R` : ''}
                                                {r.addon ? ', Add-On' : ''}
                                                {r.knockouts > 0 ? `, ${r.knockouts} KO` : ''}
                                                {r.bounty_winnings > 0 ? `, ${formatMoney(r.bounty_winnings)} Bounty` : ''}
                                                {r.is_seat && Number(r.amount) > 0 ? `, Seat Worth ${formatMoney(r.amount)}` : ''}
                                                {r.projected ? ', Provisional' : ''}
                                            </p>
                                        </div>
                                        <span className={`text-sm font-bold flex-shrink-0 ${Number(r.amount) <= 0
                                            ? 'text-[#B0B3B8]'
                                            : r.is_seat ? 'text-[#1877F2]' : 'text-[#31A24C]'}`}>
                                            {Number(r.amount) <= 0 ? '--' : (r.is_seat ? 'Seat' : formatMoney(r.amount))}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Finalize */}
                        {!isCompleted && (
                            <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4 space-y-3">
                                <h3 className="text-sm font-bold text-white">Finalize Tournament</h3>
                                <p className="text-xs text-[#B0B3B8]">
                                    Stamps The Finishing Order And Payouts Onto Every Paid Entry, Awards Season
                                    Leaderboard Points And Ends The Clock. This Marks The Event Completed.
                                </p>

                                {playersRemaining > 1 && (
                                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30">
                                        <AlertTriangle className="w-4 h-4 text-[#F59E0B] flex-shrink-0 mt-0.5" />
                                        <p className="text-xs text-[#F59E0B]">
                                            {playersRemaining} Players Are Still In. Finalizing Now Ends The Event Early
                                            And Locks The Provisional Order Below.
                                        </p>
                                    </div>
                                )}

                                {hasProjected && playersRemaining <= 1 && (
                                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[#1877F2]/10 border border-[#1877F2]/30">
                                        <AlertTriangle className="w-4 h-4 text-[#1877F2] flex-shrink-0 mt-0.5" />
                                        <p className="text-xs text-[#1877F2]">
                                            Some Places Are Still Provisional And Will Be Stamped From The Order Above.
                                        </p>
                                    </div>
                                )}

                                {!confirmFinalize ? (
                                    <button onClick={() => setConfirmFinalize(true)} disabled={busy || standings.length === 0}
                                        className="w-full h-12 rounded-xl bg-[#31A24C] text-white text-sm font-bold flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-50">
                                        <CheckCircle2 className="w-5 h-5" /> Finalize Tournament
                                    </button>
                                ) : (
                                    <div className="space-y-2">
                                        <p className="text-xs text-[#E4E6EB]">
                                            {playersRemaining > 1
                                                ? `Confirm Early Finalize With ${playersRemaining} Players Still Seated?`
                                                : 'Confirm Finalize? This Cannot Be Undone From This Screen.'}
                                        </p>
                                        <div className="flex gap-2">
                                            <button onClick={() => setConfirmFinalize(false)} disabled={busy}
                                                className="flex-1 h-12 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-bold active:bg-[#4A4B4C] disabled:opacity-50">
                                                Cancel
                                            </button>
                                            <button onClick={finalize} disabled={busy}
                                                className="flex-1 h-12 rounded-xl bg-[#EF4444] text-white text-sm font-bold flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-50">
                                                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                                                Yes, Finalize
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {isCompleted && (
                            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#31A24C]/10 border border-[#31A24C]/30">
                                <CheckCircle2 className="w-5 h-5 text-[#31A24C] flex-shrink-0" />
                                <p className="text-sm text-[#31A24C] font-medium">This Tournament Is Completed.</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Export sheet */}
                {exportOpen && (
                    <div
                        className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center"
                        onClick={() => setExportOpen(false)}
                        role="presentation"
                    >
                        <div
                            className="w-full max-w-md bg-[#242526] border-t border-[#3A3B3C] rounded-t-xl p-4 pb-8 space-y-2"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-bold text-white">Export Event</h3>
                                <button onClick={() => setExportOpen(false)}
                                    className="w-11 h-11 rounded-xl flex items-center justify-center text-[#B0B3B8] active:bg-[#3A3B3C]">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <ExportOption
                                icon={FileJson}
                                title="Compliance Packet, JSON"
                                subtitle="Configuration, Structure Played, Full Finishing Order, Pool Derivation, W-2G Events And The Drawer Reconciliation"
                                onClick={() => downloadPacket('json', `event_packet_${tournamentId}.json`)}
                                disabled={busy}
                            />
                            <ExportOption
                                icon={FileSpreadsheet}
                                title="Finishing Order, CSV"
                                subtitle="Flat Sheet With Payouts, Bounties, Investment And Net Result"
                                onClick={() => downloadPacket('csv', `results_${tournamentId}.csv`)}
                                disabled={busy}
                            />
                            <ExportOption
                                icon={Scale}
                                title="Hendon Mob, CSV"
                                subtitle="Tournament Database Import Format"
                                onClick={() => downloadPacket('hendon_csv', `hendon_mob_${tournamentId}.csv`)}
                                disabled={busy}
                            />
                            <ExportOption
                                icon={Download}
                                title="Screen Results, CSV"
                                subtitle="Exactly What Is Shown Above, Including Provisional Places"
                                onClick={exportCSV}
                                disabled={standings.length === 0}
                            />
                            <ExportOption
                                icon={Printer}
                                title="Print Results Sheet"
                                subtitle="Queued At The Floor Print Station"
                                onClick={() => { setExportOpen(false); printResults(); }}
                                disabled={busy || standings.length === 0}
                            />
                        </div>
                    </div>
                )}

                {/* Toast */}
                {toast && (
                    <div className="fixed bottom-24 left-4 right-4 z-50 flex justify-center">
                        <div className={`max-w-md w-full px-4 py-3 rounded-xl text-sm font-semibold text-white shadow-lg ${toast.type === 'error' ? 'bg-[#EF4444]' : 'bg-[#31A24C]'}`}>
                            {toast.text}
                        </div>
                    </div>
                )}

                {/* Bottom Nav */}
                <nav className="fixed bottom-0 left-0 right-0 bg-[#242526] border-t border-[#3A3B3C] z-40">
                    <div className="flex items-center justify-around h-16 max-w-2xl mx-auto">
                        {NAV_ITEMS.map(item => {
                            const Icon = NAV_ICONS[item.key];
                            // Results is reached from Reports, so Reports stays lit while
                            // this screen is open rather than adding a seventh nav item
                            // (a seventh drops every target under 44px at 375px).
                            const isActive = item.key === 'reports';
                            return (
                                <button key={item.key} onClick={() => navigateTo(item.path)}
                                    className={`flex flex-col items-center justify-center gap-0.5 w-14 h-14 rounded-lg ${isActive ? 'text-[#1877F2]' : 'text-[#B0B3B8] active:text-[#E4E6EB]'}`}>
                                    <Icon className="w-5 h-5" />
                                    <span className="text-[9px] font-medium">{item.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </nav>
            </div>
        </CommanderLayout>
    );
}

function SummaryCard({ label, value, color }) {
    return (
        <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-3 text-center">
            <p className="text-xs text-[#B0B3B8] uppercase tracking-wider">{label}</p>
            <p className="text-lg font-bold" style={{ color: color || '#E4E6EB' }}>{value}</p>
        </div>
    );
}

function ExportOption({ icon: Icon, title, subtitle, onClick, disabled }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="w-full min-h-[56px] px-4 py-3 rounded-xl bg-[#3A3B3C] text-left flex items-center gap-3 active:bg-[#4A4B4C] disabled:opacity-50"
        >
            <Icon className="w-5 h-5 text-[#1877F2] flex-shrink-0" />
            <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-[#E4E6EB]">{title}</span>
                <span className="block text-[11px] text-[#B0B3B8] leading-snug">{subtitle}</span>
            </span>
        </button>
    );
}

function InfoRow({ label, value }) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-sm text-[#B0B3B8]">{label}</span>
            <span className="text-sm font-medium text-white">{value}</span>
        </div>
    );
}
