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
    UserCheck, CreditCard
} from 'lucide-react';
import { commanderFetchJSON } from '../../../../src/lib/commander/commanderFetch';

const NAV_ITEMS = [
    { key: 'control', label: 'Control', path: '' },
    { key: 'tables', label: 'Tables', path: '/tables' },
    { key: 'players', label: 'Players', path: '/players' },
    { key: 'payouts', label: 'Payouts', path: '/payouts' },
    { key: 'reports', label: 'Reports', path: '/reports' },
    { key: 'clock', label: 'Clock', path: '/clock' },
];

const NAV_ICONS = { control: Trophy, tables: LayoutGrid, players: Users, payouts: DollarSign, reports: FileText, clock: Monitor };

const REPORT_TABS = [
    { key: 'registration', label: 'Registration', icon: ClipboardList },
    { key: 'cashier', label: 'Cashier', icon: CreditCard },
    { key: 'activity', label: 'Activity', icon: UserCheck },
];

function formatMoney(n) {
    if (!n && n !== 0) return '$0';
    return '$' + Number(n).toLocaleString();
}

export default function TDReports() {
    useEffect(() => { busEmit.sessionStart('commander-td-tournamentId-reports'); }, []);
    const router = useRouter();
    const { tournamentId } = router.query;
    const [tab, setTab] = useState('registration');
    const [loading, setLoading] = useState(true);
    const [reportData, setReportData] = useState(null);

    const fetchReport = useCallback(async (type) => {
        if (!tournamentId) return;
        setLoading(true);
        try {
            const json = await commanderFetchJSON(`/api/commander/tournaments/${tournamentId}/reports?type=${type}`, {});
            if (json.success) setReportData(json.data);
        } catch (err) {
            console.warn('Fetch report error:', err);
        } finally {
            setLoading(false);
        }
    }, [tournamentId]);

    useEffect(() => {
        const _c = new AbortController();
        fetchReport(tab);
        return () => _c.abort();
    }, [tab, fetchReport]);

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
                        <button onClick={exportCSV} disabled={loading}
                            className="px-3 py-2 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-medium flex items-center gap-2 active:scale-95 disabled:opacity-50">
                            <Download className="w-4 h-4" /> Export CSV
                        </button>
                    </div>
                </div>

                <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
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
                                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${e.status === 'eliminated' ? 'bg-[#EF4444]' :
                                                        e.status === 'winner' ? 'bg-[#F59E0B]' :
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
                        </>
                    )}
                </div>

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
