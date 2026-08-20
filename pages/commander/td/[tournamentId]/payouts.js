/**
 * Tournament Director - Payouts Calculator & Manager
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
    ChevronDown, ChevronUp, AlertTriangle, Handshake, X
} from 'lucide-react';
import { commanderFetch, commanderFetchJSON } from '../../../../src/lib/commander/commanderFetch';
import { calculateICM } from '../../../../src/lib/commander/icm-utils';

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
    const [showDealCalc, setShowDealCalc] = useState(false);

    // 2026-07-25 audit fix: toast state lived only in the ICMCalculator child but
    // is rendered (and set) here; hoist it with an auto-dismiss effect.
    const [toast, setToast] = useState(null);
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(t);
    }, [toast]);

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
            // 2026-07-25 audit fix: pass entry_id so chop payouts for still-active
            // players (player_id null) are saved per-entry instead of filtered out
            const payouts = (calcData.calculated_payouts || []).map(p => ({
                entry_id: p.entry_id || null,
                player_id: p.player_id,
                position: p.position,
                amount: overrides[p.position] !== undefined ? overrides[p.position] : p.amount
            })).filter(p => p.entry_id || p.player_id);

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
            setToast({ type: 'error', text: 'Failed To Save Payouts. Please Try Again.' });
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
                            <p className="text-xs text-[#B0B3B8]">Auto-Calculate Or Override For Deals</p>
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
                                    Guaranteed {formatMoney(calcData.guaranteed)} Exceeds Prize Pool By {formatMoney(calcData.guaranteed - prizePool)} Overlay
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
                                    {diff > 0 ? `${formatMoney(diff)} Over Prize Pool` : `${formatMoney(Math.abs(diff))} Remaining`}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Deal Calculator */}
                    <button onClick={() => setShowDealCalc(true)}
                        className="w-full bg-[#242526] rounded-xl border border-[#3A3B3C] px-4 py-3 flex items-center justify-between active:bg-[#3A3B3C]">
                        <div className="flex items-center gap-2">
                            <Handshake className="w-4 h-4 text-[#31A24C]" />
                            <span className="text-sm font-medium text-[#E4E6EB]">Deal Calculator</span>
                        </div>
                        <ChevronDown className="w-4 h-4 text-[#B0B3B8] rotate-[-90deg]" />
                    </button>

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

                {/* ===== DEAL CALCULATOR SHEET ===== */}
                {showDealCalc && (
                    <DealCalculator
                        tournamentId={tournamentId}
                        calcData={calcData}
                        overrides={overrides}
                        setToast={setToast}
                        onClose={() => setShowDealCalc(false)}
                        onApplied={async () => { await fetchPayouts(); broadcastChange('tournaments'); }}
                    />
                )}

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
 * Deal Calculator - bottom sheet with Even Chop / Chip Chop / ICM modes.
 * Operates on the remaining players (floor-view entries with current chips)
 * and the remaining prize money (sum of unpaid payout places, editable).
 * Per-player results are whole dollars summing exactly to the chopped amount
 * (rounding remainder fixed on the largest stack). Optional Reserve For 1st
 * is taken off the top and goes to the eventual 1st place finisher (added to
 * the chip leader line when the deal is applied).
 */
const DEAL_MODES = [
    { key: 'even', label: 'Even Chop' },
    { key: 'chip', label: 'Chip Chop' },
    { key: 'icm', label: 'ICM' },
];

function DealCalculator({ tournamentId, calcData, overrides, setToast, onClose, onApplied }) {
    const [players, setPlayers] = useState(null); // null = loading
    const [mode, setMode] = useState('icm');
    const [moneyInput, setMoneyInput] = useState('');
    const [reserveInput, setReserveInput] = useState('');
    const [applying, setApplying] = useState(false);

    // Load remaining players from floor-view (entries carry entry_id + chips)
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/floor-view`, {});
                const json = await res.json().catch(() => null);
                if (cancelled) return;
                let remaining = [];
                if (json?.success) {
                    remaining = (json.data?.entries || [])
                        .filter(e => ['active', 'seated'].includes(e.status))
                        .map(e => ({
                            entry_id: e.entry_id,
                            player_id: e.user_id || null,
                            name: e.player_name || 'Player',
                            chips: Math.max(0, Number(e.current_chips) || 0)
                        }));
                    if (remaining.length === 0) {
                        // Fallback: stacks only (cannot apply, but can still calculate)
                        remaining = (json.data?.stats?.player_stacks || []).map(p => ({
                            entry_id: null, player_id: null,
                            name: p.name || 'Player',
                            chips: Math.max(0, Number(p.chips) || 0)
                        }));
                    }
                }
                remaining.sort((a, b) => b.chips - a.chips);
                setPlayers(remaining);
                // Prefill Money To Chop: sum of the unpaid payout places, which
                // are positions 1..N for the N remaining players.
                const slots = (calcData?.calculated_payouts || []).filter(p => p.position <= remaining.length);
                const prefill = slots.reduce((sum, p) => sum + (overrides?.[p.position] !== undefined ? overrides[p.position] : (p.amount || 0)), 0);
                setMoneyInput(prefill > 0 ? String(Math.round(prefill)) : '');
            } catch (err) {
                console.warn('Deal calc floor fetch:', err);
                if (!cancelled) setPlayers([]);
            }
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tournamentId]);

    const n = players?.length || 0;
    const money = Math.max(0, Math.round(Number(moneyInput) || 0));
    const reserve = Math.min(money, Math.max(0, Math.round(Number(reserveInput) || 0)));
    const chopAmount = money - reserve;

    // Per-player whole-dollar amounts summing exactly to chopAmount
    let amounts = [];
    if (n > 0 && chopAmount >= 0) {
        const chips = players.map(p => p.chips);
        const totalChips = chips.reduce((s, c) => s + c, 0);
        let raw;
        if (mode === 'even') {
            raw = players.map(() => chopAmount / n);
        } else if (mode === 'chip') {
            raw = chips.map(c => totalChips > 0 ? (c / totalChips) * chopAmount : chopAmount / n);
        } else {
            // ICM: scale the remaining payout places to the chopped amount
            const baseSlots = (calcData?.calculated_payouts || []).filter(p => p.position <= n);
            let prizes = baseSlots.map(p => (overrides?.[p.position] !== undefined ? overrides[p.position] : (p.amount || 0)));
            const baseSum = prizes.reduce((s, a) => s + a, 0);
            prizes = baseSum > 0 ? prizes.map(a => (a / baseSum) * chopAmount) : [chopAmount];
            raw = totalChips > 0
                ? calculateICM(chips, prizes).map(r => r.equity || 0)
                : players.map(() => chopAmount / n);
        }
        amounts = raw.map(v => Math.round(v));
        // Fix the rounding remainder on the largest stack (index 0, sorted desc)
        const drift = chopAmount - amounts.reduce((s, a) => s + a, 0);
        if (drift !== 0) amounts[0] += drift;
    }

    const canApply = n > 0 && money > 0 && !applying && players.every(p => p.entry_id);

    const applyDeal = async () => {
        if (!canApply) return;
        setApplying(true);
        try {
            // Positions assigned by chip count; the reserve rides on the chip
            // leader line (1st place) so the totals reconcile.
            const payouts = players.map((p, i) => ({
                entry_id: p.entry_id,
                player_id: p.player_id,
                position: i + 1,
                amount: (amounts[i] || 0) + (i === 0 ? reserve : 0)
            }));
            const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/payout`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                // deal_only: the money is recorded now, but the players are
                // still in the tournament. Statuses and finishing order stay
                // untouched so play continues normally.
                body: JSON.stringify({ payouts, deal_only: true })
            });
            const json = await res.json().catch(() => null);
            if (json?.success) {
                setToast({ type: 'success', text: `Deal Applied. ${json.data?.updated ?? payouts.length} Payouts Saved. Play Continues.` });
                await onApplied();
                onClose();
            } else {
                setToast({ type: 'error', text: json?.error?.message || 'Failed To Apply Deal.' });
            }
        } catch (err) {
            console.warn('Apply deal error:', err);
            setToast({ type: 'error', text: 'Failed To Apply Deal. Check Console.' });
        } finally {
            setApplying(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={onClose}>
            <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#3A3B3C]">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[#31A24C]/20 flex items-center justify-center">
                            <Handshake className="w-5 h-5 text-[#31A24C]" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">Deal Calculator</h3>
                            <p className="text-xs text-[#B0B3B8]">{n} Player{n === 1 ? '' : 's'} Remaining</p>
                        </div>
                    </div>
                    <button onClick={onClose}
                        className="w-10 h-10 rounded-full bg-[#3A3B3C] flex items-center justify-center active:bg-[#4A4B4C]">
                        <X className="w-5 h-5 text-[#E4E6EB]" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    {players === null ? (
                        <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 text-[#1877F2] animate-spin" /></div>
                    ) : n === 0 ? (
                        <p className="text-sm text-[#B0B3B8] text-center py-8">No Remaining Players Found</p>
                    ) : (
                        <>
                            {/* Mode Tabs */}
                            <div className="flex gap-2">
                                {DEAL_MODES.map(m => (
                                    <button key={m.key} onClick={() => setMode(m.key)}
                                        className={`flex-1 py-2.5 rounded-xl text-sm font-medium ${mode === m.key
                                            ? 'bg-[#1877F2] text-white'
                                            : 'bg-[#3A3B3C] text-[#B0B3B8] active:bg-[#4A4B4C]'}`}>
                                        {m.label}
                                    </button>
                                ))}
                            </div>

                            {/* Inputs */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-[#B0B3B8] mb-1 block">Money To Chop</label>
                                    <input type="number" value={moneyInput} onChange={e => setMoneyInput(e.target.value)}
                                        placeholder="Amount"
                                        className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl px-4 py-3 text-white text-lg text-center focus:outline-none focus:border-[#1877F2]" />
                                </div>
                                <div>
                                    <label className="text-xs text-[#B0B3B8] mb-1 block">Reserve For 1st (Optional)</label>
                                    <input type="number" value={reserveInput} onChange={e => setReserveInput(e.target.value)}
                                        placeholder="0"
                                        className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl px-4 py-3 text-white text-lg text-center focus:outline-none focus:border-[#1877F2]" />
                                </div>
                            </div>

                            {/* Results */}
                            <div className="bg-[#18191A] rounded-xl border border-[#3A3B3C] divide-y divide-[#3A3B3C]">
                                {players.map((p, i) => (
                                    <div key={p.entry_id || `${p.name}-${i}`} className="px-4 py-3 flex items-center gap-3">
                                        <span className="w-7 h-7 rounded-full bg-[#3A3B3C] text-[#B0B3B8] flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-[#E4E6EB] truncate">{p.name}</p>
                                            <p className="text-xs text-[#B0B3B8]">{p.chips.toLocaleString()} Chips</p>
                                        </div>
                                        <span className="text-base font-bold text-[#31A24C]">${(amounts[i] || 0).toLocaleString()}</span>
                                    </div>
                                ))}
                            </div>

                            {reserve > 0 && (
                                <p className="text-xs text-[#F59E0B]">
                                    Plus ${reserve.toLocaleString()} Reserved For 1st Place. It Goes To Whoever Finishes 1st (Added To The Chip Leader Line When Applied).
                                </p>
                            )}

                            <div className="flex items-center justify-between px-1">
                                <span className="text-sm text-[#B0B3B8]">Total{reserve > 0 ? ' (Chop + Reserve)' : ''}</span>
                                <span className="text-base font-bold text-white">${money.toLocaleString()}</span>
                            </div>

                            {!players.every(p => p.entry_id) && (
                                <p className="text-xs text-[#B0B3B8]">Entry Records Were Not Found For Every Player, So This Deal Can Be Calculated But Not Applied.</p>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 pb-5 pt-3 border-t border-[#3A3B3C] flex gap-3">
                    <button onClick={onClose}
                        className="flex-1 py-3.5 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] font-medium active:bg-[#4A4B4C]">Close</button>
                    <button onClick={applyDeal} disabled={!canApply}
                        className="flex-1 py-3.5 rounded-xl bg-[#31A24C] text-white font-bold active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-2">
                        {applying ? <><Loader2 className="w-4 h-4 animate-spin" /> Applying...</> : 'Apply As Deal'}
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Simple ICM Calculator - input chip counts, output equity-based payouts
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

        const payoutAmounts = payouts.filter(p => p.position <= players.length).map(p => p.amount);

        // 2026-07-28 audit fix. What stood here was labelled "the Malmuth-Harville
        // approximation" but was not one: it paid 1st place at chip share `prob`
        // and EVERY later place at `(1 - prob) * prob`. Those terms are not a
        // probability distribution and do not sum to 1, so the allocated equity
        // never summed to the prize pool. Heads-up 80/20 on a $10,000 pool paying
        // 6000/4000 produced 5440 / 1840 - it handed the short stack $1,840 where
        // true ICM gives $4,400, and left $2,720 of real money assigned to nobody.
        // Three-way equal stacks on $10,000 produced 2778 each, totalling $8,334.
        // Every deal struck off this screen mis-allocated the pool.
        //
        // Replaced with the exact Malmuth-Harville subset DP in
        // src/lib/commander/icm-utils.js, whose reconciled cent-level values sum
        // to the prize pool exactly (commander_tournament_entries.payout_amount
        // is numeric(12,2), so the cents persist).
        const icm = calculateICM(players.map(p => p.chips), payoutAmounts);

        const icmEquities = players.map((player, i) => ({
            ...player,
            equity: icm[i].equity,
            percentage: (icm[i].percentage || 0).toFixed(1)
        }));

        setResults(icmEquities);
    };

    return (
        <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4 space-y-3">
            <p className="text-xs text-[#B0B3B8]">Enter Chip Counts For Remaining Players To Calculate Chip-Chop Values:</p>
            <div className="space-y-2">
                {payouts.filter(p => p.player_name).map(p => (
                    <div key={p.position} className="flex items-center gap-3">
                        <span className="text-sm text-[#E4E6EB] w-28 truncate">{p.player_name}</span>
                        <input
                            type="number"
                            placeholder="Chip Count"
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
                            <span className="text-sm text-[#E4E6EB]">{r.percentage}% Equity</span>
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
