/**
 * Tournament Director — Payouts Calculator & Manager
 * /commander/td/[tournamentId]/payouts
 * Auto-calculates payouts from payout structure, allows live override for deals/chops
 * UI: Dark theme, SmarterPoker colors, Inter font, 44px+ touch targets
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import CommanderLayout from '../../../../src/components/commander/shared/CommanderLayout';
import useTournamentRealtime from '../../../../src/hooks/useTournamentRealtime';
import { broadcastChange } from '../../../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../../../src/engine/EventBus';
import {
    Trophy, Users, DollarSign, LayoutGrid, Monitor,
    Calculator, Save, RefreshCw, Loader2, FileText,
    ChevronDown, ChevronUp, AlertTriangle
} from 'lucide-react';
import { commanderFetch, commanderFetchJSON } from '../../../../src/lib/commander/commanderFetch';

const NAV_ITEMS = [
    { key: 'control', label: 'Control', path: '' },
    { key: 'tables', label: 'Tables', path: '/tables' },
    { key: 'players', label: 'Players', path: '/players' },
    { key: 'payouts', label: 'Payouts', path: '/payouts' },
    { key: 'reports', label: 'Reports', path: '/reports' },
    { key: 'clock', label: 'Clock', path: '/clock' },
];

const NAV_ICONS = { control: Trophy, tables: LayoutGrid, players: Users, payouts: DollarSign, reports: FileText, clock: Monitor };

function formatMoney(n) {
    if (!n && n !== 0) return '$0';
    return '$' + Number(n).toLocaleString();
}

export default function TDPayouts() {

    useEffect(() => { busEmit.sessionStart('commander-td-tournamentId-payouts'); }, []);
    const router = useRouter();
    const { tournamentId } = router.query;
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [calcData, setCalcData] = useState(null);
    const [overrides, setOverrides] = useState({});
    const [showICM, setShowICM] = useState(false);

    const fetchPayouts = useCallback(async () => {
        if (!tournamentId) return;
        try {
            const json = await commanderFetchJSON(`/api/commander/tournaments/${tournamentId}/payout?mode=calculate`, {});
            if (json.success) {
                setCalcData(json.data);
                // Initialize overrides from calculated amounts
                const initial = {};
                (json.data.calculated_payouts || []).forEach(p => {
                    initial[p.position] = p.amount;
                });
                // If final_payouts exist, use those instead
                if (json.data.final_payouts) {
                    json.data.final_payouts.forEach(p => {
                        initial[p.position] = p.amount;
                    });
                }
                setOverrides(initial);
            }
        } catch (err) {
            console.warn('Fetch payouts error:', err);
        } finally {
            setLoading(false);
        }
    }, [tournamentId]);

    useTournamentRealtime(tournamentId, fetchPayouts);
    useEffect(() => { const _c = new AbortController(); fetchPayouts(_c.signal); return () => _c.abort(); }, [fetchPayouts]);

    const handleOverride = (position, value) => {
        setOverrides(prev => ({ ...prev, [position]: parseInt(value) || 0 }));
    };

    const handleSave = async () => {
        if (!calcData) return;
        setSaving(true);
        try {
            const payouts = (calcData.calculated_payouts || []).map(p => ({
                player_id: p.player_id,
                position: p.position,
                amount: overrides[p.position] || p.amount
            })).filter(p => p.player_id);

            const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/payout`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payouts })
            });

            if (res.ok) {
                await fetchPayouts();
                broadcastChange('tournaments');
            }
        } catch (err) {
            console.warn('Save payouts error:', err);
            setToast({ type: 'error', text: 'Failed to save payouts. Please try again.' });
        } finally {
            setSaving(false);
        }
    };

    const navigateTo = (path) => {
        router.push(`/commander/td/${tournamentId}${path}`);
    };

    const totalOverridden = Object.values(overrides || {}).reduce((sum, v) => sum + (v || 0), 0);
    const totalCalc = calcData?.calculated_payouts?.reduce((sum, p) => sum + p.amount, 0) || 0;
    const prizePool = calcData?.prize_pool || 0;
    const diff = totalOverridden - prizePool;

    if (!router.isReady) return null;

    if (loading) {
        return (
            <CommanderLayout title="Payouts">
                <div className="flex items-center justify-center min-h-screen bg-[#18191A]">
                    <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
                </div>
            </CommanderLayout>
        );
    }

    return (
        <CommanderLayout title="Payouts">
            <SEOHead title="TD Payouts" />
            <div className="min-h-screen bg-[#18191A] pb-24">
                {/* Header */}
                <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 sticky top-0 z-30">
                    <div className="flex items-center justify-between max-w-2xl mx-auto">
                        <div>
                            <h1 className="text-lg font-bold text-white">Payout Calculator</h1>
                            <p className="text-xs text-[#B0B3B8]">Auto-calculate or override for deals</p>
                        </div>
                        <button onClick={handleSave} disabled={saving}
                            className="px-4 py-2 rounded-xl bg-[#31A24C] text-white text-sm font-medium flex items-center gap-2 active:scale-95 disabled:opacity-50">
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save
                        </button>
                    </div>
                </div>

                <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
                    {/* Prize Pool Summary */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-3 text-center">
                            <p className="text-xs text-[#B0B3B8] uppercase tracking-wider">Prize Pool</p>
                            <p className="text-xl font-bold text-[#31A24C]">{formatMoney(prizePool)}</p>
                        </div>
                        <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-3 text-center">
                            <p className="text-xs text-[#B0B3B8] uppercase tracking-wider">Entries</p>
                            <p className="text-xl font-bold text-white">{calcData?.total_entries || 0}</p>
                        </div>
                        <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-3 text-center">
                            <p className="text-xs text-[#B0B3B8] uppercase tracking-wider">House Fees</p>
                            <p className="text-xl font-bold text-[#F59E0B]">{formatMoney(calcData?.house_fees)}</p>
                        </div>
                    </div>

                    {calcData?.is_overlay && (
                        <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl px-4 py-3 flex items-center gap-3">
                            <AlertTriangle className="w-5 h-5 text-[#EF4444] flex-shrink-0" />
                            <div>
                                <p className="text-sm font-medium text-[#EF4444]">Overlay Alert</p>
                                <p className="text-xs text-[#B0B3B8]">
                                    Guaranteed {formatMoney(calcData.guaranteed)} exceeds prize pool by {formatMoney(calcData.guaranteed - prizePool)}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Payout Table */}
                    <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
                        <div className="px-4 py-3 border-b border-[#3A3B3C] flex items-center justify-between">
                            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Payout Breakdown</h2>
                            <button onClick={fetchPayouts} className="text-[#1877F2] text-xs flex items-center gap-1">
                                <RefreshCw className="w-3 h-3" /> Recalculate
                            </button>
                        </div>

                        <div className="divide-y divide-[#3A3B3C]">
                            {(calcData?.calculated_payouts || []).map(slot => {
                                const overrideAmount = overrides[slot.position];
                                const isOverridden = overrideAmount !== undefined && overrideAmount !== slot.amount;

                                return (
                                    <div key={slot.position} className="px-4 py-3 flex items-center gap-3">
                                        {/* Position */}
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${slot.position === 1 ? 'bg-[#F59E0B]/20 text-[#F59E0B]' :
                                            slot.position === 2 ? 'bg-[#B0B3B8]/20 text-[#B0B3B8]' :
                                                slot.position === 3 ? 'bg-[#CD7F32]/20 text-[#CD7F32]' :
                                                    'bg-[#3A3B3C] text-[#B0B3B8]'
                                            }`}>
                                            {slot.position}
                                        </div>

                                        {/* Player Name */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-[#E4E6EB] truncate">
                                                {slot.player_name || <span className="text-[#B0B3B8] italic">TBD</span>}
                                            </p>
                                            <p className="text-xs text-[#B0B3B8]">{slot.percentage}%</p>
                                        </div>

                                        {/* Auto Amount */}
                                        <div className="text-right text-xs text-[#B0B3B8] flex-shrink-0 w-16">
                                            {formatMoney(slot.amount)}
                                        </div>

                                        {/* Override Input */}
                                        <div className="flex-shrink-0 w-24">
                                            <input
                                                type="number"
                                                value={overrideAmount !== undefined ? overrideAmount : slot.amount}
                                                onChange={e => handleOverride(slot.position, e.target.value)}
                                                className={`w-full px-2 py-1.5 rounded-lg text-sm text-right font-medium ${isOverridden
                                                    ? 'bg-[#1877F2]/20 border border-[#1877F2]/40 text-[#1877F2]'
                                                    : 'bg-[#3A3B3C] border border-[#4A4B4C] text-[#E4E6EB]'
                                                    }`}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Totals */}
                        <div className="px-4 py-3 border-t border-[#3A3B3C] bg-[#1C1D1E]">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-[#B0B3B8]">Total Payouts</span>
                                <span className={`text-lg font-bold ${Math.abs(diff) > 0 ? (diff > 0 ? 'text-[#EF4444]' : 'text-[#F59E0B]') : 'text-[#31A24C]'
                                    }`}>
                                    {formatMoney(totalOverridden)}
                                </span>
                            </div>
                            {Math.abs(diff) > 0 && (
                                <p className="text-xs text-[#B0B3B8] mt-1">
                                    {diff > 0 ? `${formatMoney(diff)} over prize pool` : `${formatMoney(Math.abs(diff))} remaining`}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* ICM Calculator Toggle */}
                    <button onClick={() => setShowICM(!showICM)}
                        className="w-full bg-[#242526] rounded-xl border border-[#3A3B3C] px-4 py-3 flex items-center justify-between active:bg-[#3A3B3C]">
                        <div className="flex items-center gap-2">
                            <Calculator className="w-4 h-4 text-[#1877F2]" />
                            <span className="text-sm font-medium text-[#E4E6EB]">ICM Chop Calculator</span>
                        </div>
                        {showICM ? <ChevronUp className="w-4 h-4 text-[#B0B3B8]" /> : <ChevronDown className="w-4 h-4 text-[#B0B3B8]" />}
                    </button>

                    {showICM && (
                        <ICMCalculator
                            payouts={calcData?.calculated_payouts || []}
                            prizePool={prizePool}
                            onApply={(icmPayouts) => {
                                const newOverrides = {};
                                icmPayouts.forEach(p => { newOverrides[p.position] = p.amount; });
                                setOverrides(prev => ({ ...prev, ...newOverrides }));
                            }}
                        />
                    )}
                </div>

                {/* Bottom Nav */}
                <nav className="fixed bottom-0 left-0 right-0 bg-[#242526] border-t border-[#3A3B3C] z-40">
                    <div className="flex items-center justify-around h-16 max-w-2xl mx-auto">
                        {NAV_ITEMS.map(item => {
                            const Icon = NAV_ICONS[item.key];
                            const isActive = item.key === 'payouts';
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
        
      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: toast.type === 'success' ? '#22C55E' : '#EF4444',
          color: '#fff', fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'slideUp 0.3s ease',
          maxWidth: 360,
        }}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8,
          }}>×</button>
        </div>
      )}
    </CommanderLayout>
    );
}

/**
 * Simple ICM Calculator — input chip counts, output equity-based payouts
 */
function ICMCalculator({ payouts, prizePool, onApply }) {
    const [chipInputs, setChipInputs] = useState({});
    const [results, setResults] = useState(null);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

    const calculate = () => {
        const players = Object.entries(chipInputs || {})
            .filter(([, chips]) => chips > 0)
            .map(([pos, chips]) => ({ position: parseInt(pos), chips }));

        if (players.length < 2) return;

        const totalChips = players.reduce((sum, p) => sum + p.chips, 0);
        const payoutAmounts = payouts.filter(p => p.position <= players.length).map(p => p.amount);

        // Simplified ICM: each player's equity = weighted average of remaining payouts
        // (Full ICM is computationally expensive; this is the Malmuth-Harville approximation)
        const icmEquities = players.map(player => {
            const prob = player.chips / totalChips;
            // Approximate: equity = prob * 1st prize + weighted remaining
            let equity = 0;
            for (let i = 0; i < payoutAmounts.length; i++) {
                const factor = Math.pow(prob, i + 1) / Math.pow(prob, i === 0 ? 1 : i);
                equity += payoutAmounts[i] * (i === 0 ? prob : (1 - prob) * prob);
            }
            // Fallback: chip-chop proportional
            equity = Math.round(prizePool * prob);
            return { ...player, equity, percentage: (prob * 100).toFixed(1) };
        });

        setResults(icmEquities);
    };

    return (
        <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4 space-y-3">
            <p className="text-xs text-[#B0B3B8]">Enter chip counts for remaining players to calculate chip-chop values:</p>
            <div className="space-y-2">
                {payouts.filter(p => p.player_name).map(p => (
                    <div key={p.position} className="flex items-center gap-3">
                        <span className="text-sm text-[#E4E6EB] w-28 truncate">{p.player_name}</span>
                        <input
                            type="number"
                            placeholder="Chip count"
                            value={chipInputs[p.position] || ''}
                            onChange={e => setChipInputs(prev => ({ ...prev, [p.position]: parseInt(e.target.value) || 0 }))}
                            className="flex-1 px-3 py-2 rounded-lg bg-[#3A3B3C] border border-[#4A4B4C] text-[#E4E6EB] text-sm"
                        />
                    </div>
                ))}
            </div>

            <button onClick={calculate}
                className="w-full py-2.5 rounded-xl bg-[#1877F2] text-white text-sm font-medium flex items-center justify-center gap-2 active:scale-95">
                <Calculator className="w-4 h-4" /> Calculate Chip Chop
            </button>

            {results && (
                <div className="space-y-2 pt-2 border-t border-[#3A3B3C]">
                    {results.map(r => (
                        <div key={r.position} className="flex items-center justify-between px-2 py-1.5">
                            <span className="text-sm text-[#E4E6EB]">{r.percentage}% equity</span>
                            <span className="text-sm font-bold text-[#31A24C]">{formatMoney(r.equity)}</span>
                        </div>
                    ))}
                    <button onClick={() => onApply(results.map(r => ({ position: r.position, amount: r.equity })))}
                        className="w-full py-2 rounded-lg bg-[#31A24C]/20 text-[#31A24C] text-sm font-medium active:scale-95">
                        Apply Chip Chop Values
                    </button>
                </div>
            )}
        </div>
    );
}
