/**
 * Tournament Director - Reports
 * /commander/td/[tournamentId]/reports
 * Tab-based report viewer: Registration, Cashier, Activity
 * CSV export capability
 * UI: Dark theme, SmarterPoker colors, Inter font, 44px+ touch targets
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import CommanderLayout from '../../../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../../../src/engine/EventBus';
import {
    Trophy, Users, DollarSign, LayoutGrid, Monitor,
    FileText, Download, Loader2, ClipboardList,
    UserCheck, CreditCard, ChevronRight, Scale, Printer,
    AlertTriangle, CheckCircle2, Receipt
} from 'lucide-react';
import { commanderFetch, commanderFetchJSON } from '../../../../src/lib/commander/commanderFetch';
import { getStaffData } from '../../../../src/lib/commander/clientAuth';

const NAV_ITEMS = [
    { key: 'control', label: 'Control', path: '' },
    { key: 'tables', label: 'Tables', path: '/tables' },
    { key: 'players', label: 'Players', path: '/players' },
    { key: 'payouts', label: 'Payouts', path: '/payouts' },
    { key: 'reports', label: 'Reports', path: '/reports' },
    { key: 'clock', label: 'Clock', path: '/clock' },
];

const NAV_ICONS = { control: Trophy, tables: LayoutGrid, players: Users, payouts: DollarSign, reports: FileText, clock: Monitor };

// Labels stay short: four tabs at 375px leave roughly 80px each, and a longer
// word ("Reconciliation") wraps and drops the row under the 44px target.
const REPORT_TABS = [
    { key: 'registration', label: 'Registration', icon: ClipboardList },
    { key: 'cashier', label: 'Cashier', icon: CreditCard },
    { key: 'activity', label: 'Activity', icon: UserCheck },
    { key: 'reconciliation', label: 'Drawer', icon: Scale },
];

function formatMoney(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return '$0';
    const rounded = Math.round(num * 100) / 100;
    return '$' + rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Signed, so a short drawer reads "-$125" and never a bare "125". */
function formatSigned(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return '$0';
    const rounded = Math.round(num * 100) / 100;
    const abs = Math.abs(rounded).toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (rounded > 0) return `+$${abs}`;
    if (rounded < 0) return `-$${abs}`;
    return '$0';
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

function csvCell(value) {
    const s = value === null || value === undefined ? '' : String(value);
    return `"${s.replace(/"/g, '""')}"`;
}

export default function TDReports() {
    useEffect(() => { busEmit.sessionStart('commander-td-tournamentId-reports'); }, []);
    const router = useRouter();
    const { tournamentId } = router.query;
    const [tab, setTab] = useState('registration');
    const [loading, setLoading] = useState(true);
    const [reportData, setReportData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [toast, setToast] = useState(null);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 5000);
        return () => clearTimeout(t);
    }, [toast]);

    const fetchReport = useCallback(async (type) => {
        if (!tournamentId) return;
        setLoading(true);
        try {
            // The drawer tab is its own endpoint: it reconciles the entries
            // against commander_cash_transactions, which the three report
            // types never look at.
            const url = type === 'reconciliation'
                ? `/api/commander/tournaments/${tournamentId}/reconciliation`
                : `/api/commander/tournaments/${tournamentId}/reports?type=${type}`;
            const json = await commanderFetchJSON(url, {});
            // Clear stale data rather than leaving the previous tab's payload
            // on screen when a fetch fails: a cage sheet showing the wrong
            // tournament's money is worse than an empty one.
            setReportData(json?.success ? json.data : null);
        } catch (err) {
            console.warn('Fetch report error:', err);
            setReportData(null);
        } finally {
            setLoading(false);
        }
    }, [tournamentId]);

    useEffect(() => {
        const _c = new AbortController();
        fetchReport(tab);
        return () => _c.abort();
    }, [tab, fetchReport]);

    /**
     * Queue the reconciliation sheet at the floor print station.
     * job_type 'payout' with receipt_kind 'reconciliation'; buildJobHtml
     * dispatches on that marker (commander_print_jobs has no 'reconciliation'
     * job_type and the CHECK constraint rejects one).
     */
    const printReconciliation = async () => {
        if (!tournamentId || !reportData?.variance) return;

        let staff = {};
        try { staff = getStaffData() || {}; } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
        let venue = {};
        try { venue = JSON.parse(localStorage.getItem('commander_venue') || '{}') || {}; }
        catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

        const receipt = {
            receipt_kind: 'reconciliation',
            venue_name: staff.venue_name || venue.name || '',
            venue_city: staff.venue_city || venue.city || '',
            venue_state: staff.venue_state || venue.state || '',
            tournament_name: reportData.tournament?.name || 'Tournament',
            started_at: reportData.tournament?.actual_start || reportData.tournament?.scheduled_start || null,
            ended_at: reportData.tournament?.ended_at || null,
            timestamp: new Date().toISOString(),
            counts: reportData.counts,
            expected_in: reportData.expected_in,
            actual_in: reportData.actual_in,
            expected_out: reportData.expected_out,
            actual_out: reportData.actual_out,
            derivation: reportData.derivation,
            variance: reportData.variance,
            balanced: reportData.balanced,
            discrepancies: reportData.discrepancies,
            unpaid_itm: reportData.unpaid_itm,
            w2g_candidates: reportData.w2g_candidates
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
                    title: `Cash Drawer Reconciliation, ${reportData.tournament?.name || 'Tournament'}`,
                    source: 'td_reports_reconciliation'
                })
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.success) {
                setToast({ type: 'error', text: json?.error?.message || 'Failed To Queue The Reconciliation Sheet.' });
                return;
            }
            setToast({ type: 'success', text: 'Reconciliation Sheet Queued At The Print Station.' });
        } catch (err) {
            console.warn('Print reconciliation error:', err);
            setToast({ type: 'error', text: 'Failed To Queue The Reconciliation Sheet.' });
        } finally {
            setBusy(false);
        }
    };

    const exportCSV = () => {
        if (!reportData) return;
        let csv = '';
        let filename = '';

        if (tab === 'registration') {
            csv = 'Player,Status,Table,Seat,Payment,Rebuys,Add-on,Payout,Registered\n';
            (reportData.entries || []).forEach(e => {
                const name = e.profiles?.display_name || e.player_name || 'Unknown';
                // 2026-07-28 audit fix: this printed "cash" for every row even
                // when no payment method was recorded - a fabricated value in a
                // document that gets reconciled. Render 'unknown' instead.
                csv += `"${name}",${e.status},${e.table_number || ''},${e.seat_number || ''},${e.payment_method || 'unknown'},${e.rebuy_count || 0},${e.addon_taken ? 'Yes' : 'No'},${e.payout_amount || ''},${e.registered_at}\n`;
            });
            filename = `registration_report_${tournamentId}.csv`;
        } else if (tab === 'cashier') {
            csv = 'Cashier,Entries,Rebuys,Add-ons,Total Cash,Fees\n';
            (reportData.cashiers || []).forEach(c => {
                csv += `"${c.cashier_name}",${c.entries_count},${c.rebuys_count},${c.addons_count},${c.total_cash},${c.total_fees}\n`;
            });
            filename = `cashier_report_${tournamentId}.csv`;
        } else if (tab === 'reconciliation') {
            const v = reportData.variance || {};
            const rows = [
                ['Bucket', 'Expected', 'Actual', 'Difference'],
                ['Buy-Ins', reportData.expected_in?.buyins?.amount ?? 0, reportData.actual_in?.by_type?.buyin?.amount ?? 0, ''],
                ['Rebuys', reportData.expected_in?.rebuys?.amount ?? 0, reportData.actual_in?.by_type?.rebuy?.amount ?? 0, ''],
                ['Add-Ons', reportData.expected_in?.addons?.amount ?? 0, reportData.actual_in?.by_type?.addon?.amount ?? 0, ''],
                ['Total Cash In', v.cash_in?.expected ?? 0, v.cash_in?.actual ?? 0, v.cash_in?.variance ?? 0],
                ['Total Cash Out', v.cash_out?.expected ?? 0, v.cash_out?.actual ?? 0, v.cash_out?.variance ?? 0],
                ['Net', v.net?.expected ?? 0, v.net?.actual ?? 0, v.net?.variance ?? 0],
                ['Over Short', '', '', v.over_short ?? 0]
            ];
            csv = rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n\n';
            csv += 'Discrepancy Severity,Code,Message\n';
            (reportData.discrepancies || []).forEach(d => {
                csv += [d.severity, d.code, d.message].map(csvCell).join(',') + '\n';
            });
            csv += '\nUnpaid In The Money,Position,Payout,Bounty Winnings\n';
            (reportData.unpaid_itm || []).forEach(u => {
                csv += [u.player_name, u.finish_position ?? '', u.payout_amount ?? 0, u.bounty_winnings ?? 0]
                    .map(csvCell).join(',') + '\n';
            });
            csv += '\nW-2G Required,Gross,Buy-In,Net\n';
            (reportData.w2g_candidates || []).forEach(w => {
                csv += [w.player_name, w.gross_amount, w.buy_in, w.net_amount].map(csvCell).join(',') + '\n';
            });
            filename = `cash_drawer_reconciliation_${tournamentId}.csv`;
        } else {
            csv = 'Type,Player,Details,Time\n';
            (reportData.activities || []).forEach(a => {
                csv += `${a.type},"${a.player_name}","${a.details}",${a.timestamp}\n`;
            });
            filename = `activity_report_${tournamentId}.csv`;
        }

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    const navigateTo = (path) => {
        router.push(`/commander/td/${tournamentId}${path}`);
    };

    if (!router.isReady) return null;

    return (
        <CommanderLayout title="Reports">
            <SEOHead title="TD Reports" />
            <div className="min-h-screen bg-[#18191A] pb-24">
                {/* Header */}
                <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 sticky top-0 z-30">
                    <div className="flex items-center justify-between max-w-2xl mx-auto">
                        <h1 className="text-lg font-bold text-white">Reports</h1>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {tab === 'reconciliation' && (
                                <button onClick={printReconciliation} disabled={busy || loading || !reportData?.variance}
                                    className="h-11 px-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-medium flex items-center gap-2 active:scale-95 disabled:opacity-50">
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Print
                                </button>
                            )}
                            <button onClick={exportCSV} disabled={loading || !reportData}
                                className="h-11 px-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-medium flex items-center gap-2 active:scale-95 disabled:opacity-50">
                                <Download className="w-4 h-4" /> CSV
                            </button>
                        </div>
                    </div>
                </div>

                <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
                    {/* Final Results.
                        Lives here rather than as a seventh bottom-nav item: a
                        seventh entry drops every nav target below the 44px
                        minimum at 375px. */}
                    <button onClick={() => navigateTo('/results')}
                        className="w-full bg-[#242526] border border-[#3A3B3C] rounded-xl p-4 flex items-center justify-between active:bg-[#3A3B3C] transition-colors">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-[#F59E0B]/20 flex items-center justify-center flex-shrink-0">
                                <Trophy className="w-5 h-5 text-[#F59E0B]" />
                            </div>
                            <div className="flex flex-col items-start">
                                <span className="text-white font-semibold text-base">Final Results</span>
                                <span className="text-[#B0B3B8] text-xs text-left">Finishing Order, Payouts And Finalize</span>
                            </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-[#B0B3B8] flex-shrink-0" />
                    </button>

                    {/* Tabs */}
                    <div className="flex gap-2">
                        {REPORT_TABS.map(t => {
                            const Icon = t.icon;
                            return (
                                <button key={t.key} onClick={() => setTab(t.key)}
                                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${tab === t.key ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8] active:bg-[#4A4B4C]'
                                        }`}>
                                    <Icon className="w-4 h-4" />
                                    {t.label}
                                </button>
                            );
                        })}
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
                        </div>
                    ) : (
                        <>
                            {/* Registration Report */}
                            {tab === 'registration' && reportData && (
                                <div className="space-y-4">
                                    {/* Summary Cards */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <SummaryCard label="Entries" value={reportData.summary?.total_entries || 0} />
                                        <SummaryCard label="Prize Pool" value={formatMoney(reportData.summary?.prize_pool)} color="#31A24C" />
                                        <SummaryCard label="House Fees" value={formatMoney(reportData.summary?.house_fees)} color="#F59E0B" />
                                        <SummaryCard label="Rebuys" value={reportData.summary?.total_rebuys || 0} />
                                    </div>

                                    {/* Entries Table */}
                                    <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
                                        <div className="px-4 py-2 border-b border-[#3A3B3C]">
                                            <h3 className="text-xs font-bold text-[#B0B3B8] uppercase tracking-wider">Entry Details</h3>
                                        </div>
                                        <div className="divide-y divide-[#3A3B3C]">
                                            {(reportData.entries || []).map((e, i) => (
                                                <div key={e.id || i} className="px-4 py-2.5 flex items-center gap-3">
                                                    {/* Bagged gets its own colour: still in the event, but not playing right now. */}
                                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${e.status === 'eliminated' ? 'bg-[#EF4444]' :
                                                        e.status === 'winner' ? 'bg-[#F59E0B]' :
                                                            e.status === 'bagged' ? 'bg-[#F59E0B]' :
                                                                ['active', 'seated'].includes(e.status) ? 'bg-[#31A24C]' : 'bg-[#1877F2]'
                                                        }`} />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm text-[#E4E6EB] truncate">{e.profiles?.display_name || e.player_name || 'Unknown'}</p>
                                                        <p className="text-[10px] text-[#B0B3B8]">
                                                            T{e.table_number || '?'}-S{e.seat_number || '?'} | {e.payment_method || 'unknown'} | {e.rebuy_count || 0}R
                                                            {e.addon_taken ? ' +A' : ''}
                                                        </p>
                                                    </div>
                                                    <div className="text-right flex-shrink-0">
                                                        {e.payout_amount ? (
                                                            <p className="text-sm font-bold text-[#31A24C]">{formatMoney(e.payout_amount)}</p>
                                                        ) : null}
                                                        <p className="text-[10px] text-[#B0B3B8]">
                                                            {e.registered_at ? new Date(e.registered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Cashier Report */}
                            {tab === 'cashier' && reportData && (
                                <div className="space-y-4">
                                    <SummaryCard label="Total Collected" value={formatMoney(reportData.total_collected)} color="#31A24C" />

                                    <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
                                        <div className="px-4 py-2 border-b border-[#3A3B3C]">
                                            <h3 className="text-xs font-bold text-[#B0B3B8] uppercase tracking-wider">Cashier Breakdown</h3>
                                        </div>
                                        <div className="divide-y divide-[#3A3B3C]">
                                            {(reportData.cashiers || []).map((c, i) => (
                                                <div key={c.cashier_id || i} className="px-4 py-3">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <p className="text-sm font-medium text-[#E4E6EB]">{c.cashier_name}</p>
                                                        <p className="text-sm font-bold text-[#31A24C]">{formatMoney(c.total_cash)}</p>
                                                    </div>
                                                    <div className="flex gap-4 text-[10px] text-[#B0B3B8]">
                                                        <span>{c.entries_count} Entries</span>
                                                        <span>{c.rebuys_count} Rebuys</span>
                                                        <span>{c.addons_count} Add-Ons</span>
                                                        <span>Fees: {formatMoney(c.total_fees)}</span>
                                                    </div>
                                                    <div className="flex gap-2 mt-1.5">
                                                        {Object.entries(c.payment_methods || {}).map(([method, amount]) => (
                                                            <span key={method} className="px-2 py-0.5 rounded bg-[#3A3B3C] text-[10px] text-[#B0B3B8]">
                                                                {method}: {formatMoney(amount)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                            {(reportData.cashiers || []).length === 0 && (
                                                <div className="px-4 py-8 text-center text-[#B0B3B8] text-sm">No Cashier Data Recorded</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Activity Report */}
                            {tab === 'activity' && reportData && (
                                <div className="space-y-4">
                                    <SummaryCard label="Total Events" value={reportData.total_events || 0} />

                                    <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
                                        <div className="divide-y divide-[#3A3B3C]">
                                            {(reportData.activities || []).slice(0, 100).map((a, i) => (
                                                <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${a.type === 'elimination' ? 'bg-[#EF4444]' :
                                                        a.type === 'registration' ? 'bg-[#31A24C]' :
                                                            a.type === 'rebuy' ? 'bg-[#F59E0B]' : 'bg-[#1877F2]'
                                                        }`} />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm text-[#E4E6EB]">
                                                            <span className="font-medium">{a.player_name}</span>
                                                        </p>
                                                        <p className="text-[10px] text-[#B0B3B8]">{a.details}</p>
                                                    </div>
                                                    <div className="text-right flex-shrink-0">
                                                        <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-medium ${a.type === 'elimination' ? 'bg-[#EF4444]/10 text-[#EF4444]' :
                                                            a.type === 'registration' ? 'bg-[#31A24C]/10 text-[#31A24C]' :
                                                                'bg-[#F59E0B]/10 text-[#F59E0B]'
                                                            }`}>{a.type}</span>
                                                        <p className="text-[10px] text-[#B0B3B8] mt-0.5">
                                                            {a.timestamp ? new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))}
                                            {(reportData.activities || []).length === 0 && (
                                                <div className="px-4 py-8 text-center text-[#B0B3B8] text-sm">No Activity Yet</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Cash Drawer Reconciliation */}
                            {tab === 'reconciliation' && reportData && (
                                <ReconciliationSection data={reportData} />
                            )}
                            {tab === 'reconciliation' && !reportData && (
                                <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] px-4 py-8 text-center text-[#B0B3B8] text-sm">
                                    The Cash Drawer Could Not Be Reconciled For This Tournament.
                                </div>
                            )}
                        </>
                    )}
                </div>

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

/** One expected / actual / difference line. Zero difference is muted, not green. */
function VarianceRow({ label, expected, actual }) {
    const diff = (Number(actual) || 0) - (Number(expected) || 0);
    const balanced = Math.abs(diff) <= 0.01;
    return (
        <div className="flex items-center gap-2 px-4 py-2.5 text-sm">
            <span className="flex-1 min-w-0 truncate text-[#E4E6EB]">{label}</span>
            <span className="w-20 text-right text-[#B0B3B8] tabular-nums">{formatMoney(expected)}</span>
            <span className="w-20 text-right text-[#E4E6EB] tabular-nums">{formatMoney(actual)}</span>
            <span
                className="w-20 text-right font-bold tabular-nums"
                style={{ color: balanced ? '#B0B3B8' : '#EF4444' }}
            >
                {balanced ? '--' : formatSigned(diff)}
            </span>
        </div>
    );
}

/**
 * The cage sheet.
 *
 * Expected, actual and difference side by side for every bucket, then the
 * single over/short figure a manager balances against, then everything that
 * needs a human: the specific discrepancies, the finishers still owed money
 * and the W-2G forms that have to be handled before those players leave.
 */
function ReconciliationSection({ data }) {
    const v = data.variance || {};
    const expIn = data.expected_in || {};
    const actIn = data.actual_in || {};
    const expOut = data.expected_out || {};
    const actOut = data.actual_out || {};
    const derivation = data.derivation || {};
    const counts = data.counts || {};
    const overShort = Number(v.over_short) || 0;
    const balanced = data.balanced === true;
    const discrepancies = data.discrepancies || [];
    const unpaid = data.unpaid_itm || [];
    const w2g = data.w2g_candidates || [];
    const methods = Object.entries(actIn.by_payment_method || {});

    return (
        <div className="space-y-4">
            {/* The headline figure */}
            <div
                className="rounded-xl border p-5 text-center"
                style={{
                    background: balanced ? 'rgba(49,162,76,0.10)' : 'rgba(239,68,68,0.10)',
                    borderColor: balanced ? 'rgba(49,162,76,0.35)' : 'rgba(239,68,68,0.35)'
                }}
            >
                <div className="flex items-center justify-center gap-2 mb-1">
                    {balanced
                        ? <CheckCircle2 className="w-5 h-5 text-[#31A24C]" />
                        : <AlertTriangle className="w-5 h-5 text-[#EF4444]" />}
                    <p className="text-xs uppercase tracking-wider text-[#B0B3B8]">Cash Drawer</p>
                </div>
                <p className="text-3xl font-bold" style={{ color: balanced ? '#31A24C' : '#EF4444' }}>
                    {balanced ? 'Balanced' : formatSigned(overShort)}
                </p>
                <p className="text-xs mt-1" style={{ color: balanced ? '#31A24C' : '#EF4444' }}>
                    {balanced
                        ? 'Expected And Actual Cash Agree'
                        : `Drawer Is ${v.over_short_label || (overShort > 0 ? 'Over' : 'Short')}`}
                </p>
            </div>

            {/* Field */}
            <div className="grid grid-cols-2 gap-3">
                <SummaryCard label="Entries" value={Number(counts.entries || 0).toLocaleString()} />
                <SummaryCard label="Rebuys" value={Number(counts.rebuys || 0).toLocaleString()} />
                <SummaryCard label="Add-Ons" value={Number(counts.addons || 0).toLocaleString()} />
                <SummaryCard label="Paid Places" value={Number(counts.paid_places || 0).toLocaleString()} />
            </div>

            {/* Cash in */}
            <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
                <div className="px-4 py-2 border-b border-[#3A3B3C] flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-[#B0B3B8]" />
                    <h3 className="text-xs font-bold text-[#B0B3B8] uppercase tracking-wider flex-1">Cash In</h3>
                </div>
                <div className="flex items-center gap-2 px-4 py-1.5 text-[10px] uppercase tracking-wider text-[#B0B3B8] border-b border-[#3A3B3C]">
                    <span className="flex-1">Bucket</span>
                    <span className="w-20 text-right">Expected</span>
                    <span className="w-20 text-right">Actual</span>
                    <span className="w-20 text-right">Diff</span>
                </div>
                <div className="divide-y divide-[#3A3B3C]">
                    <VarianceRow
                        label={`Buy-Ins x${Number(expIn.buyins?.count || 0)}`}
                        expected={expIn.buyins?.amount}
                        actual={actIn.by_type?.buyin?.amount}
                    />
                    <VarianceRow
                        label={`Rebuys x${Number(expIn.rebuys?.count || 0)}`}
                        expected={expIn.rebuys?.amount}
                        actual={actIn.by_type?.rebuy?.amount}
                    />
                    <VarianceRow
                        label={`Add-Ons x${Number(expIn.addons?.count || 0)}`}
                        expected={expIn.addons?.amount}
                        actual={actIn.by_type?.addon?.amount}
                    />
                    <VarianceRow label="Total In" expected={expIn.total} actual={actIn.total} />
                </div>
                {methods.length > 0 && (
                    <div className="px-4 py-2.5 border-t border-[#3A3B3C] flex flex-wrap gap-2">
                        {methods.map(([method, m]) => (
                            <span key={method} className="px-2 py-0.5 rounded bg-[#3A3B3C] text-[10px] text-[#B0B3B8]">
                                {method}: {formatMoney(m?.amount)}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Pool derivation */}
            <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4 space-y-2">
                <h3 className="text-xs font-bold text-[#B0B3B8] uppercase tracking-wider mb-1">Pool Derivation</h3>
                <DerivationRow label="House Fees" value={formatMoney(derivation.house_fees)} color="#F59E0B" />
                {Number(derivation.bounty_pool_collected) > 0 && (
                    <DerivationRow label="Bounty Pool" value={formatMoney(derivation.bounty_pool_collected)} color="#F59E0B" />
                )}
                <DerivationRow label="Prize Pool Collected" value={formatMoney(derivation.prize_pool_collected)} />
                {Number(derivation.overlay) > 0 && (
                    <DerivationRow label="Overlay" value={formatMoney(derivation.overlay)} color="#EF4444" />
                )}
                <DerivationRow label="Effective Prize Pool" value={formatMoney(derivation.effective_prize_pool)} color="#31A24C" />
            </div>

            {/* Cash out */}
            <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
                <div className="px-4 py-2 border-b border-[#3A3B3C]">
                    <h3 className="text-xs font-bold text-[#B0B3B8] uppercase tracking-wider">Cash Out</h3>
                </div>
                <div className="flex items-center gap-2 px-4 py-1.5 text-[10px] uppercase tracking-wider text-[#B0B3B8] border-b border-[#3A3B3C]">
                    <span className="flex-1">Bucket</span>
                    <span className="w-20 text-right">Expected</span>
                    <span className="w-20 text-right">Actual</span>
                    <span className="w-20 text-right">Diff</span>
                </div>
                <div className="divide-y divide-[#3A3B3C]">
                    <VarianceRow label="Payouts" expected={expOut.payouts} actual={actOut.by_type?.payout?.amount} />
                    {Number(expOut.bounty_winnings) > 0 && (
                        <VarianceRow label="Bounty Winnings" expected={expOut.bounty_winnings} actual={0} />
                    )}
                    <VarianceRow label="Total Out" expected={expOut.total} actual={actOut.total} />
                </div>
            </div>

            {/* Discrepancies */}
            <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
                <div className="px-4 py-2 border-b border-[#3A3B3C] flex items-center justify-between">
                    <h3 className="text-xs font-bold text-[#B0B3B8] uppercase tracking-wider">Discrepancies</h3>
                    <span className="text-[10px] text-[#B0B3B8]">{discrepancies.length}</span>
                </div>
                <div className="divide-y divide-[#3A3B3C]">
                    {discrepancies.length === 0 ? (
                        <div className="px-4 py-6 text-center text-sm text-[#31A24C]">Nothing To Investigate</div>
                    ) : discrepancies.map((d, i) => (
                        <div key={`${d.code}-${i}`} className="px-4 py-3 flex items-start gap-3">
                            <div
                                className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                                style={{ background: d.severity === 'error' ? '#EF4444' : '#F59E0B' }}
                            />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-[#E4E6EB]">{d.message}</p>
                                <p className="text-[10px] text-[#B0B3B8] mt-0.5">{d.code}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Unpaid in the money */}
            {unpaid.length > 0 && (
                <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
                    <div className="px-4 py-2 border-b border-[#3A3B3C] flex items-center justify-between">
                        <h3 className="text-xs font-bold text-[#B0B3B8] uppercase tracking-wider">Unpaid In The Money</h3>
                        <span className="text-[10px] text-[#B0B3B8]">{unpaid.length}</span>
                    </div>
                    <div className="divide-y divide-[#3A3B3C]">
                        {unpaid.map(u => (
                            <div key={u.entry_id} className="px-4 py-3 flex items-center gap-3">
                                <span className="w-10 text-xs font-bold text-[#B0B3B8] flex-shrink-0">
                                    {ordinal(u.finish_position)}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-[#E4E6EB] truncate">{u.player_name}</p>
                                    {Number(u.bounty_winnings) > 0 && (
                                        <p className="text-[10px] text-[#F59E0B]">
                                            Plus {formatMoney(u.bounty_winnings)} Bounty
                                        </p>
                                    )}
                                </div>
                                <span className="text-sm font-bold text-[#F59E0B] flex-shrink-0">
                                    {formatMoney(Number(u.payout_amount) > 0 ? u.payout_amount : u.scheduled_amount)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* W-2G */}
            {w2g.length > 0 && (
                <div className="rounded-xl border border-[#EF4444]/40 bg-[#EF4444]/10 overflow-hidden">
                    <div className="px-4 py-2 border-b border-[#EF4444]/30 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
                        <h3 className="text-xs font-bold text-[#EF4444] uppercase tracking-wider flex-1">
                            W-2G Required
                        </h3>
                        <span className="text-[10px] text-[#EF4444]">{w2g.length}</span>
                    </div>
                    <div className="divide-y divide-[#EF4444]/20">
                        {w2g.map(x => (
                            <div key={x.entry_id} className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-[#E4E6EB] truncate">{x.player_name}</p>
                                        <p className="text-[10px] text-[#B0B3B8]">
                                            Gross {formatMoney(x.gross_amount)}, Buy-In {formatMoney(x.buy_in)}
                                        </p>
                                    </div>
                                    <span className="text-sm font-bold text-[#EF4444] flex-shrink-0">
                                        Net {formatMoney(x.net_amount)}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                    <p className="px-4 py-2.5 text-[11px] text-[#E4E6EB] border-t border-[#EF4444]/20">
                        Reportable Amount Is Net Of That Entry Buy-In. Collect The Taxpayer Identification
                        Number Before The Player Leaves The Building.
                    </p>
                </div>
            )}
        </div>
    );
}

function DerivationRow({ label, value, color }) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-sm text-[#B0B3B8]">{label}</span>
            <span className="text-sm font-bold tabular-nums" style={{ color: color || '#E4E6EB' }}>{value}</span>
        </div>
    );
}
