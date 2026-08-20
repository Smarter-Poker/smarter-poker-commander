/**
 * Tournament Director - Color Up / Chip Race Helper
 * /commander/td/[tournamentId]/color-up
 * Floor helper for racing off a denomination at a break.
 * The TD types the denomination being raced and how many of those chips each
 * player holds. The screen computes total value raced, higher-denom chips owed
 * per player, the odd-chip remainders, and the race order.
 * This assists the floor. It does not run the race.
 * UI: Dark theme, SmarterPoker colors, Inter font, 44px+ touch targets
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import CommanderLayout from '../../../../src/components/commander/shared/CommanderLayout';
import useTournamentRealtime from '../../../../src/hooks/useTournamentRealtime';
import { busEmit } from '../../../../src/engine/EventBus';
import {
  Trophy, Users, DollarSign, LayoutGrid, Monitor, FileText,
  Loader2, RefreshCw, AlertTriangle, Layers, Printer, Plus, X, Coins
} from 'lucide-react';
import { commanderFetch } from '../../../../src/lib/commander/commanderFetch';

const NAV_ITEMS = [
  { key: 'control', icon: Trophy, label: 'Control', path: '' },
  { key: 'tables', icon: LayoutGrid, label: 'Tables', path: '/tables' },
  { key: 'players', icon: Users, label: 'Players', path: '/players' },
  { key: 'payouts', icon: DollarSign, label: 'Payouts', path: '/payouts' },
  { key: 'reports', icon: FileText, label: 'Reports', path: '/reports' },
  { key: 'clock', icon: Monitor, label: 'Clock', path: '/clock' },
];

const DEFAULT_DENOMS = [25, 100, 500, 1000, 5000];

function digitsOnly(v) {
  return String(v == null ? '' : v).replace(/[^0-9]/g, '').slice(0, 10);
}

export default function TDColorUp() {

  useEffect(() => { busEmit.sessionStart('commander-td-tournamentId-color-up'); }, []);
  const router = useRouter();
  const { tournamentId } = router.query;

  const [floor, setFloor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [raceDenomRaw, setRaceDenomRaw] = useState('25');
  const [denomsRaw, setDenomsRaw] = useState(DEFAULT_DENOMS.map(String));
  // entry_id -> raw count string of raced-off chips held
  const [held, setHeld] = useState({});

  const fetchFloor = useCallback(async (signal) => {
    if (!tournamentId) return;
    try {
      const res = await commanderFetch(
        `/api/commander/tournaments/${tournamentId}/floor-view`,
        { ...(signal ? { signal } : {}) }
      );
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setFloor(json.data);
        setError(null);
      } else {
        setError(json.error || 'Failed To Load Tournament Data');
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError('Failed To Load Tournament Data');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useTournamentRealtime(tournamentId, fetchFloor);
  useEffect(() => {
    const controller = new AbortController();
    fetchFloor(controller.signal);
    return () => controller.abort();
  }, [fetchFloor]);

  const denoms = useMemo(
    () => denomsRaw.map(d => Number(d)).filter(d => Number.isFinite(d) && d > 0).sort((a, b) => a - b),
    [denomsRaw]
  );

  const raceDenom = useMemo(() => {
    const n = Number(raceDenomRaw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [raceDenomRaw]);

  const nextDenom = useMemo(
    () => denoms.find(d => d > raceDenom) || 0,
    [denoms, raceDenom]
  );

  const players = useMemo(() => {
    const out = [];
    (floor?.tables || []).forEach(t => {
      (t.players || []).forEach(p => out.push({ ...p, table_number: t.table_number }));
    });
    return out.sort((a, b) =>
      (a.table_number - b.table_number) || ((a.seat_number || 0) - (b.seat_number || 0))
    );
  }, [floor]);

  const rows = useMemo(() => {
    return players.map(p => {
      const raw = held[p.entry_id];
      const count = raw ? Number(raw) : 0;
      const safeCount = Number.isFinite(count) && count > 0 ? count : 0;
      const value = safeCount * raceDenom;
      const received = nextDenom > 0 ? Math.floor(value / nextDenom) : 0;
      const remainderValue = value - (received * nextDenom);
      const remainderChips = raceDenom > 0 ? Math.round(remainderValue / raceDenom) : 0;
      return { ...p, count: safeCount, value, received, remainderValue, remainderChips };
    });
  }, [players, held, raceDenom, nextDenom]);

  const totals = useMemo(() => {
    const totalChips = rows.reduce((s, r) => s + r.count, 0);
    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const totalReceived = rows.reduce((s, r) => s + r.received, 0);
    const totalRemainderValue = rows.reduce((s, r) => s + r.remainderValue, 0);
    const chipsToAward = nextDenom > 0 ? Math.floor(totalRemainderValue / nextDenom) : 0;
    return { totalChips, totalValue, totalReceived, totalRemainderValue, chipsToAward };
  }, [rows, nextDenom]);

  const raceOrder = useMemo(
    () => rows
      .filter(r => r.remainderChips > 0)
      .sort((a, b) =>
        (b.remainderChips - a.remainderChips) ||
        (b.remainderValue - a.remainderValue) ||
        (a.table_number - b.table_number) ||
        ((a.seat_number || 0) - (b.seat_number || 0))
      ),
    [rows]
  );

  const summaryRows = useMemo(() => rows.filter(r => r.count > 0), [rows]);

  const handleHeld = (entryId, raw) => {
    setHeld(prev => ({ ...prev, [entryId]: digitsOnly(raw) }));
  };

  const handleDenom = (index, raw) => {
    setDenomsRaw(prev => prev.map((d, i) => (i === index ? digitsOnly(raw) : d)));
  };

  const handleRemoveDenom = (index) => {
    setDenomsRaw(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddDenom = () => {
    setDenomsRaw(prev => [...prev, '']);
  };

  const handleResetDenoms = () => {
    setDenomsRaw(DEFAULT_DENOMS.map(String));
  };

  const handleClearCounts = () => {
    setHeld({});
  };

  const handlePrint = () => {
    if (summaryRows.length === 0) return;
    const pw = window.open('', '_blank', 'width=760,height=900');
    if (!pw) return;
    const tName = floor?.tournament?.name || 'Tournament';
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    pw.document.write(`<!DOCTYPE html><html><head><title>Color Up Summary</title>
<style>
@page { margin: 12mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 13px; }
h1 { font-size: 20px; margin-bottom: 2mm; }
h2 { font-size: 14px; margin: 6mm 0 2mm; }
.meta { font-size: 12px; color: #444; margin-bottom: 4mm; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #999; padding: 2mm 3mm; text-align: left; }
th { background: #eee; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
td.num, th.num { text-align: right; }
</style></head><body>
<h1>Color Up Summary</h1>
<div class="meta">${esc(tName)}<br/>Racing Off ${raceDenom.toLocaleString()} Into ${nextDenom.toLocaleString()}<br/>${new Date().toLocaleString()}</div>
<table>
<thead><tr><th class="num">Table</th><th class="num">Seat</th><th>Player</th><th class="num">Chips Held</th><th class="num">Value</th><th class="num">Chips Received</th><th class="num">Odd Chips</th></tr></thead>
<tbody>
${summaryRows.map(r => `<tr>
<td class="num">${esc(r.table_number)}</td>
<td class="num">${esc(r.seat_number ?? '')}</td>
<td>${esc(r.player_name)}</td>
<td class="num">${r.count.toLocaleString()}</td>
<td class="num">${r.value.toLocaleString()}</td>
<td class="num">${r.received.toLocaleString()}</td>
<td class="num">${r.remainderChips.toLocaleString()}</td>
</tr>`).join('')}
</tbody>
</table>
<h2>Race Order, Highest Remainder First</h2>
<table>
<thead><tr><th class="num">Rank</th><th class="num">Table</th><th class="num">Seat</th><th>Player</th><th class="num">Odd Chips</th><th class="num">Odd Value</th></tr></thead>
<tbody>
${raceOrder.map((r, i) => `<tr>
<td class="num">${i + 1}</td>
<td class="num">${esc(r.table_number)}</td>
<td class="num">${esc(r.seat_number ?? '')}</td>
<td>${esc(r.player_name)}</td>
<td class="num">${r.remainderChips.toLocaleString()}</td>
<td class="num">${r.remainderValue.toLocaleString()}</td>
</tr>`).join('')}
</tbody>
</table>
<h2>Chips Available To Award: ${totals.chipsToAward.toLocaleString()} At ${nextDenom.toLocaleString()}</h2>
</body></html>`);
    pw.document.close();
    setTimeout(() => { pw.print(); pw.close(); }, 400);
  };

  const navigateTo = (path) => {
    const base = `/commander/td/${tournamentId}`;
    router.push(path ? `${base}${path}` : base);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#18191A] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
      </div>
    );
  }

  if (error || !floor) {
    return (
      <div className="min-h-screen bg-[#18191A] flex items-center justify-center p-4">
        <div className="bg-[#242526] rounded-xl p-6 text-center max-w-md">
          <AlertTriangle className="w-10 h-10 text-[#F59E0B] mx-auto mb-3" />
          <p className="text-[#E4E6EB] text-lg mb-4">{error || 'Tournament Not Found'}</p>
          <button onClick={() => navigateTo('')}
            className="px-6 py-3 bg-[#1877F2] text-white rounded-lg text-base font-medium">
            Back To Control Center
          </button>
        </div>
      </div>
    );
  }

  return (
    <CommanderLayout title="Commander - Color Up" backHref={`/commander/td/${tournamentId}`}>
      <SEOHead
        title="Commander - Color Up"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />

      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] pb-24 font-['Inter']">

        {/* ===== HEADER ===== */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-white truncate">Color Up Helper</h1>
            <p className="text-xs text-[#B0B3B8]">
              {players.length} Player{players.length === 1 ? '' : 's'} Live, Floor Helper Only
            </p>
          </div>
          <button onClick={() => fetchFloor()} className="p-2 rounded-lg active:bg-[#3A3B3C]" title="Refresh">
            <RefreshCw className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        {/* ===== RACE SETUP ===== */}
        <div className="px-4 pt-3 space-y-3">
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Layers className="w-4 h-4 text-[#F59E0B]" />
              <span className="text-xs text-[#B0B3B8] uppercase tracking-wider font-semibold">
                Denomination Being Raced Off
              </span>
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={raceDenomRaw}
              onChange={e => setRaceDenomRaw(digitsOnly(e.target.value))}
              onFocus={e => e.target.select()}
              aria-label="Denomination Being Raced Off"
              className="w-full h-14 rounded-xl bg-[#3A3B3C] border border-[#4A4B4C] px-4 text-2xl font-bold text-white focus:outline-none focus:border-[#1877F2]"
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-[#B0B3B8]">Next Denomination Up</span>
              <span className={`text-sm font-bold ${nextDenom > 0 ? 'text-[#31A24C]' : 'text-[#EF4444]'}`}>
                {nextDenom > 0 ? nextDenom.toLocaleString() : 'None Available'}
              </span>
            </div>
            {nextDenom === 0 && (
              <p className="mt-2 text-xs text-[#EF4444]">
                Add A Higher Denomination To The List Below Before Racing.
              </p>
            )}
          </div>

          {/* ===== DENOMINATIONS IN PLAY ===== */}
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-[#B0B3B8] uppercase tracking-wider font-semibold">
                Denominations In Play
              </span>
              <button onClick={handleResetDenoms}
                className="text-xs text-[#1877F2] font-semibold px-2 py-1 rounded-lg active:bg-[#3A3B3C]">
                Reset
              </button>
            </div>
            <div className="space-y-2">
              {denomsRaw.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={d}
                    onChange={e => handleDenom(i, e.target.value)}
                    onFocus={e => e.target.select()}
                    aria-label={`Denomination ${i + 1}`}
                    className="flex-1 h-12 rounded-xl bg-[#3A3B3C] border border-[#4A4B4C] px-4 text-base font-semibold text-white focus:outline-none focus:border-[#1877F2]"
                  />
                  <button onClick={() => handleRemoveDenom(i)}
                    className="w-12 h-12 rounded-xl bg-[#3A3B3C] flex items-center justify-center active:bg-[#4A4B4C] flex-shrink-0"
                    title="Remove Denomination">
                    <X className="w-4 h-4 text-[#EF4444]" />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={handleAddDenom}
              className="mt-3 w-full h-12 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-semibold flex items-center justify-center gap-2 active:bg-[#4A4B4C]">
              <Plus className="w-4 h-4" /> Add Denomination
            </button>
          </div>

          {/* ===== RACE TOTALS ===== */}
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Coins className="w-4 h-4 text-[#F59E0B]" />
              <span className="text-xs text-[#B0B3B8] uppercase tracking-wider font-semibold">
                Race Totals
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-lg font-bold text-white">{totals.totalChips.toLocaleString()}</p>
                <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Chips Being Raced</p>
              </div>
              <div>
                <p className="text-lg font-bold text-white">{totals.totalValue.toLocaleString()}</p>
                <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Total Value Raced</p>
              </div>
              <div>
                <p className="text-lg font-bold text-[#31A24C]">{totals.totalReceived.toLocaleString()}</p>
                <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Chips Handed Out</p>
              </div>
              <div>
                <p className="text-lg font-bold text-[#F59E0B]">{totals.chipsToAward.toLocaleString()}</p>
                <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Chips To Award By Race</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-[#3A3B3C] flex items-center justify-between">
              <span className="text-xs text-[#B0B3B8]">Total Odd Chip Value</span>
              <span className="text-sm font-bold text-white">{totals.totalRemainderValue.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* ===== PLAYER ENTRY ===== */}
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider">
              Chips Held Per Player
            </h2>
            <button onClick={handleClearCounts}
              className="text-xs text-[#1877F2] font-semibold px-2 py-1 rounded-lg active:bg-[#3A3B3C]">
              Clear All
            </button>
          </div>
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] divide-y divide-[#3A3B3C] overflow-hidden">
            {rows.map(r => (
              <div key={r.entry_id} className="px-4 py-3 flex items-center gap-3">
                <span className="w-14 text-[11px] text-[#B0B3B8] font-mono flex-shrink-0">
                  T{r.table_number}-S{r.seat_number ?? '-'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#E4E6EB] truncate">{r.player_name}</p>
                  <p className="text-[11px] text-[#B0B3B8]">
                    Value {r.value.toLocaleString()}, Receives {r.received.toLocaleString()}, Odd {r.remainderChips.toLocaleString()}
                  </p>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={held[r.entry_id] ?? ''}
                  placeholder="0"
                  onChange={e => handleHeld(r.entry_id, e.target.value)}
                  onFocus={e => e.target.select()}
                  aria-label={`Raced Chips Held By ${r.player_name}`}
                  className="w-24 h-14 rounded-xl bg-[#3A3B3C] border border-[#4A4B4C] px-3 text-right text-xl font-bold text-white placeholder-[#B0B3B8]/40 focus:outline-none focus:border-[#1877F2] flex-shrink-0"
                />
              </div>
            ))}
            {rows.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-[#B0B3B8]">No Live Players</div>
            )}
          </div>
        </div>

        {/* ===== RACE ORDER ===== */}
        <div className="px-4 pt-4">
          <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">
            Race Order, Highest Remainder First
          </h2>
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <p className="text-xs text-[#B0B3B8] mb-3">
              {totals.chipsToAward.toLocaleString()} Chip{totals.chipsToAward === 1 ? '' : 's'} At {nextDenom > 0 ? nextDenom.toLocaleString() : '--'} Available To Award. One Chip Per Player Down The List.
            </p>
            <div className="divide-y divide-[#3A3B3C]">
              {raceOrder.map((r, i) => (
                <div key={r.entry_id} className="py-2.5 flex items-center gap-3">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${i < totals.chipsToAward
                    ? 'bg-[#31A24C]/20 text-[#31A24C]'
                    : 'bg-[#3A3B3C] text-[#B0B3B8]'
                    }`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#E4E6EB] truncate">{r.player_name}</p>
                    <p className="text-[11px] text-[#B0B3B8] font-mono">T{r.table_number}-S{r.seat_number ?? '-'}</p>
                  </div>
                  <span className="text-sm font-bold text-[#F59E0B] flex-shrink-0">
                    {r.remainderChips.toLocaleString()} Odd
                  </span>
                </div>
              ))}
              {raceOrder.length === 0 && (
                <p className="py-4 text-center text-sm text-[#B0B3B8]">No Odd Chips To Race</p>
              )}
            </div>
          </div>
        </div>

        {/* ===== PRINT / DISPLAY SUMMARY ===== */}
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider">
              Print / Display Summary
            </h2>
            <button onClick={handlePrint} disabled={summaryRows.length === 0}
              className="px-3 h-9 rounded-lg bg-[#1877F2] text-white text-xs font-bold flex items-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-40">
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
          </div>
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <p className="text-sm font-bold text-white">{floor.tournament?.name}</p>
            <p className="text-xs text-[#B0B3B8] mb-3">
              Racing Off {raceDenom.toLocaleString()} Into {nextDenom > 0 ? nextDenom.toLocaleString() : '--'}
            </p>
            <div className="grid grid-cols-[2.5rem_2.5rem_1fr_4.5rem] gap-x-2 gap-y-1.5 text-xs">
              <span className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Table</span>
              <span className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Seat</span>
              <span className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Name</span>
              <span className="text-[10px] text-[#B0B3B8] uppercase tracking-wider text-right">Received</span>
              {summaryRows.map(r => (
                <div key={r.entry_id} className="contents">
                  <span className="text-[#E4E6EB] font-mono">{r.table_number}</span>
                  <span className="text-[#E4E6EB] font-mono">{r.seat_number ?? '-'}</span>
                  <span className="text-[#E4E6EB] truncate">{r.player_name}</span>
                  <span className="text-[#31A24C] font-bold text-right">{r.received.toLocaleString()}</span>
                </div>
              ))}
            </div>
            {summaryRows.length === 0 && (
              <p className="text-sm text-[#B0B3B8] text-center py-4">Enter Chip Counts To Build The Summary</p>
            )}
          </div>
        </div>

        {/* ===== BOTTOM NAV BAR ===== */}
        <nav className="fixed bottom-0 left-0 right-0 bg-[#242526] border-t border-[#3A3B3C] z-40">
          <div className="flex items-center justify-around h-16 max-w-2xl mx-auto">
            {NAV_ITEMS.map(item => {
              const Icon = item.icon;
              return (
                <button key={item.key} onClick={() => navigateTo(item.path)}
                  className="flex flex-col items-center justify-center gap-0.5 w-16 h-14 rounded-lg text-[#B0B3B8] active:text-[#E4E6EB]">
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </CommanderLayout>
  );
}
