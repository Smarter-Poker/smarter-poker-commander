/**
 * Tournament Director - Chip Count Entry
 * /commander/td/[tournamentId]/chips
 * Fast break-time chip count entry for the whole field.
 * Table selector filters to one table, each player gets a large numeric input
 * prefilled with their current count, and Save Table writes only the rows that
 * actually changed via PUT /api/commander/tournaments/[id]/entries/[entryId]/chips
 * UI: Dark theme, SmarterPoker colors, Inter font, 44px+ touch targets
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import CommanderLayout from '../../../../src/components/commander/shared/CommanderLayout';
import useTournamentRealtime from '../../../../src/hooks/useTournamentRealtime';
import { broadcastChange } from '../../../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../../../src/engine/EventBus';
import {
  Trophy, Users, DollarSign, LayoutGrid, Monitor, FileText,
  Loader2, RefreshCw, Save, Check, AlertTriangle, Coins, Layers, ChevronRight
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

// Mirrors MAX_CHIPS in pages/api/tournaments/[id]/entries/[entryId]/chips.js
const MAX_CHIPS = 2000000000;

function digitsOnly(v) {
  return String(v == null ? '' : v).replace(/[^0-9]/g, '').slice(0, 12);
}

export default function TDChipCounts() {

  useEffect(() => { busEmit.sessionStart('commander-td-tournamentId-chips'); }, []);
  const router = useRouter();
  const { tournamentId } = router.query;

  const [floor, setFloor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // entry_id -> raw string typed by the TD. Absent means "untouched".
  const [counts, setCounts] = useState({});
  // entry_id -> 'saving' | 'saved' | 'failed'
  const [rowState, setRowState] = useState({});
  const [savingTable, setSavingTable] = useState(null);
  const [selectedTable, setSelectedTable] = useState('all');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchFloor = useCallback(async (signal) => {
    if (!tournamentId) return;
    try {
      // Payload split: the chip-count screen works off the table map and the
      // room totals. It never reads the entry list or the clock.
      const res = await commanderFetch(
        `/api/commander/tournaments/${tournamentId}/floor-view?include=tournament,stats,tables`,
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

  // 5-min fallback only. A tight poll would fight the TD while typing, so the
  // fast and slow tiers are both 5 minutes: this screen gains the hidden-tab
  // suppression and the catch-up on focus, and nothing else changes.
  useTournamentRealtime(tournamentId, fetchFloor, {
    poll: true,
    fastMs: 300000,
    slowMs: 300000
  });
  useEffect(() => {
    const controller = new AbortController();
    fetchFloor(controller.signal);
    return () => { controller.abort(); };
  }, [fetchFloor]);

  const tables = useMemo(() => floor?.tables || [], [floor]);

  const allPlayers = useMemo(() => {
    const out = [];
    tables.forEach(t => {
      (t.players || []).forEach(p => out.push({ ...p, table_number: t.table_number }));
    });
    return out;
  }, [tables]);

  // Value shown in a row's input: the typed value if the TD touched it,
  // otherwise the live server count.
  const inputValue = useCallback((player) => {
    const typed = counts[player.entry_id];
    if (typed !== undefined) return typed;
    return String(player.current_chips ?? 0);
  }, [counts]);

  const parsedValue = useCallback((player) => {
    const raw = inputValue(player);
    if (raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > MAX_CHIPS) return null;
    return n;
  }, [inputValue]);

  const isChanged = useCallback((player) => {
    const typed = counts[player.entry_id];
    if (typed === undefined || typed === '') return false;
    const n = parsedValue(player);
    if (n === null) return false;
    return n !== (player.current_chips || 0);
  }, [counts, parsedValue]);

  // ── Chips Accounted For ──
  const accounting = useMemo(() => {
    let entered = 0;
    allPlayers.forEach(p => {
      const n = parsedValue(p);
      entered += n === null ? (p.current_chips || 0) : n;
    });

    const t = floor?.tournament || {};
    const s = floor?.stats || {};
    const startingChips = Number(t.starting_chips) || 0;
    const rebuyChips = Number(t.rebuy_chips) || 0;
    const addonChips = Number(t.addon_chips) || 0;
    const hasExpected = startingChips > 0;
    const expected = hasExpected
      ? (Number(s.total_entries) || 0) * startingChips
        + (Number(s.total_rebuys) || 0) * rebuyChips
        + (Number(s.total_addons) || 0) * addonChips
      : null;

    return {
      entered,
      recorded: Number(s.total_chips) || 0,
      expected,
      variance: expected === null ? null : entered - expected
    };
  }, [allPlayers, parsedValue, floor]);

  const changedCount = useMemo(
    () => allPlayers.filter(isChanged).length,
    [allPlayers, isChanged]
  );

  const handleInput = (entryId, raw) => {
    const clean = digitsOnly(raw);
    setCounts(prev => ({ ...prev, [entryId]: clean }));
    setRowState(prev => {
      if (!prev[entryId]) return prev;
      const next = { ...prev };
      delete next[entryId];
      return next;
    });
  };

  const handleSaveTable = async (table) => {
    const players = (table.players || []).filter(isChanged);
    if (players.length === 0) {
      setToast({ type: 'error', text: `No Changes To Save On Table ${table.table_number}` });
      return;
    }
    setSavingTable(table.table_number);

    let saved = 0;
    let failed = 0;

    // Sequential on purpose. The write route is rate limited and a break-time
    // burst of 9 parallel writes per table would trip it.
    for (const player of players) {
      const chips = parsedValue(player);
      if (chips === null) { failed += 1; continue; }
      setRowState(prev => ({ ...prev, [player.entry_id]: 'saving' }));
      try {
        const res = await commanderFetch(
          `/api/commander/tournaments/${tournamentId}/entries/${player.entry_id}/chips`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chips })
          }
        );
        const json = await res.json().catch(() => null);
        if (res.ok && json?.success) {
          saved += 1;
          setRowState(prev => ({ ...prev, [player.entry_id]: 'saved' }));
          // Drop the local override so the row falls back to the server value
          setCounts(prev => {
            const next = { ...prev };
            delete next[player.entry_id];
            return next;
          });
        } else {
          failed += 1;
          setRowState(prev => ({ ...prev, [player.entry_id]: 'failed' }));
        }
      } catch (err) {
        console.warn('Chip save failed:', err);
        failed += 1;
        setRowState(prev => ({ ...prev, [player.entry_id]: 'failed' }));
      }
    }

    setSavingTable(null);
    await fetchFloor();
    broadcastChange('tournaments');

    setToast({
      type: failed > 0 ? 'error' : 'success',
      text: failed > 0
        ? `Table ${table.table_number}: ${saved} Saved, ${failed} Failed`
        : `Table ${table.table_number}: ${saved} Chip Count${saved === 1 ? '' : 's'} Saved`
    });
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

  const visibleTables = selectedTable === 'all'
    ? tables
    : tables.filter(t => t.table_number === selectedTable);

  const varianceColor = accounting.variance === null
    ? '#B0B3B8'
    : accounting.variance === 0
      ? '#31A24C'
      : '#EF4444';

  return (
    <CommanderLayout title="Commander - Chip Counts" backHref={`/commander/td/${tournamentId}`}>
      <SEOHead
        title="Commander - Chip Counts"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />

      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] pb-24 font-['Inter']">

        {/* ===== HEADER ===== */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-white truncate">Chip Counts</h1>
            <p className="text-xs text-[#B0B3B8]">
              {allPlayers.length} Player{allPlayers.length === 1 ? '' : 's'} Across {tables.length} Table{tables.length === 1 ? '' : 's'}
              {changedCount > 0 ? `, ${changedCount} Unsaved` : ''}
            </p>
          </div>
          <button onClick={() => fetchFloor()} className="p-2 rounded-lg active:bg-[#3A3B3C]" title="Refresh">
            <RefreshCw className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        {/* ===== CHIPS ACCOUNTED FOR ===== */}
        <div className="px-4 pt-3">
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Coins className="w-4 h-4 text-[#F59E0B]" />
              <span className="text-xs text-[#B0B3B8] uppercase tracking-wider font-semibold">
                Chips Accounted For
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <p className="text-base font-bold text-white">{accounting.entered.toLocaleString()}</p>
                <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider mt-0.5">Entered</p>
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-white">{accounting.recorded.toLocaleString()}</p>
                <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider mt-0.5">Recorded</p>
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-white">
                  {accounting.expected === null ? '--' : accounting.expected.toLocaleString()}
                </p>
                <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider mt-0.5">Expected</p>
              </div>
            </div>
            {accounting.variance !== null && (
              <div className="mt-3 pt-3 border-t border-[#3A3B3C] flex items-center justify-between">
                <span className="text-xs text-[#B0B3B8]">Variance Vs Expected</span>
                <span className="text-sm font-bold" style={{ color: varianceColor }}>
                  {accounting.variance > 0 ? '+' : ''}{accounting.variance.toLocaleString()}
                </span>
              </div>
            )}
            {accounting.expected === null && (
              <p className="mt-3 pt-3 border-t border-[#3A3B3C] text-xs text-[#B0B3B8]">
                Expected Total Needs A Starting Stack On The Tournament Setup.
              </p>
            )}
          </div>
        </div>

        {/* ===== COLOR UP LINK ===== */}
        <div className="px-4 pt-3">
          <button onClick={() => navigateTo('/color-up')}
            className="w-full bg-[#242526] border border-[#3A3B3C] rounded-xl p-3 flex items-center justify-between active:bg-[#3A3B3C] transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#F59E0B]/20 flex items-center justify-center">
                <Layers className="w-4 h-4 text-[#F59E0B]" />
              </div>
              <div className="flex flex-col items-start">
                <span className="text-white font-semibold text-sm">Color Up Helper</span>
                <span className="text-[#B0B3B8] text-xs">Race Off A Denomination</span>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        {/* ===== TABLE SELECTOR ===== */}
        <div className="px-4 pt-3">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setSelectedTable('all')}
              className={`flex-shrink-0 px-4 h-11 rounded-xl text-sm font-semibold border active:scale-[0.98] transition-transform ${selectedTable === 'all'
                ? 'bg-[#1877F2] border-[#1877F2] text-white'
                : 'bg-[#242526] border-[#3A3B3C] text-[#B0B3B8]'
                }`}
            >
              All Tables
            </button>
            {tables.map(t => (
              <button
                key={t.table_number}
                onClick={() => setSelectedTable(t.table_number)}
                className={`flex-shrink-0 px-4 h-11 rounded-xl text-sm font-semibold border active:scale-[0.98] transition-transform ${selectedTable === t.table_number
                  ? 'bg-[#1877F2] border-[#1877F2] text-white'
                  : 'bg-[#242526] border-[#3A3B3C] text-[#B0B3B8]'
                  }`}
              >
                Table {t.table_number}
              </button>
            ))}
          </div>
        </div>

        {/* ===== TABLE SECTIONS ===== */}
        <div className="px-4 py-3 space-y-4">
          {visibleTables.map(table => {
            const players = [...(table.players || [])].sort(
              (a, b) => (a.seat_number || 0) - (b.seat_number || 0)
            );
            const tableChanged = players.filter(isChanged).length;
            const tableTotal = players.reduce((sum, p) => {
              const n = parsedValue(p);
              return sum + (n === null ? (p.current_chips || 0) : n);
            }, 0);
            const isSaving = savingTable === table.table_number;

            return (
              <div key={table.table_number} className="bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#3A3B3C] flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-white">Table {table.table_number}</h2>
                    <p className="text-xs text-[#B0B3B8]">
                      {players.length} Seated, {tableTotal.toLocaleString()} Chips
                    </p>
                  </div>
                  {tableChanged > 0 && (
                    <span className="px-2 py-1 rounded-lg bg-[#F59E0B]/10 text-[#F59E0B] text-xs font-semibold">
                      {tableChanged} Changed
                    </span>
                  )}
                </div>

                <div className="divide-y divide-[#3A3B3C]">
                  {players.map(player => {
                    const state = rowState[player.entry_id];
                    const changed = isChanged(player);
                    const invalid = inputValue(player) !== '' && parsedValue(player) === null;
                    return (
                      <div key={player.entry_id} className="px-4 py-3 flex items-center gap-3">
                        <span className="w-9 h-9 rounded-full bg-[#1877F2]/20 text-[#1877F2] flex items-center justify-center text-sm font-bold flex-shrink-0">
                          {player.seat_number ?? '-'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#E4E6EB] truncate">{player.player_name}</p>
                          <p className="text-[11px] text-[#B0B3B8]">
                            Seat {player.seat_number ?? '-'}, Now {(player.current_chips || 0).toLocaleString()}
                            {state === 'saved' ? ', Saved' : ''}
                            {state === 'failed' ? ', Failed' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {state === 'saving' && <Loader2 className="w-4 h-4 text-[#1877F2] animate-spin" />}
                          {state === 'saved' && <Check className="w-4 h-4 text-[#31A24C]" />}
                          {state === 'failed' && <AlertTriangle className="w-4 h-4 text-[#EF4444]" />}
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={inputValue(player)}
                            onChange={e => handleInput(player.entry_id, e.target.value)}
                            onFocus={e => e.target.select()}
                            aria-label={`Chip Count For ${player.player_name}`}
                            className={`w-28 h-14 rounded-xl bg-[#3A3B3C] border px-3 text-right text-xl font-bold text-white focus:outline-none ${invalid
                              ? 'border-[#EF4444]'
                              : state === 'failed'
                                ? 'border-[#EF4444]'
                                : changed
                                  ? 'border-[#F59E0B]'
                                  : 'border-[#4A4B4C] focus:border-[#1877F2]'
                              }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {players.length === 0 && (
                    <div className="px-4 py-6 text-center text-sm text-[#B0B3B8]">No Players Seated</div>
                  )}
                </div>

                <div className="p-4 border-t border-[#3A3B3C]">
                  <button
                    onClick={() => handleSaveTable(table)}
                    disabled={isSaving || tableChanged === 0}
                    className="w-full h-12 rounded-xl bg-[#1877F2] text-white text-base font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-40"
                  >
                    {isSaving
                      ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving Table {table.table_number}...</>
                      : <><Save className="w-5 h-5" /> Save Table {table.table_number}{tableChanged > 0 ? ` (${tableChanged})` : ''}</>
                    }
                  </button>
                </div>
              </div>
            );
          })}

          {visibleTables.length === 0 && (
            <div className="text-center py-16">
              <Coins className="w-12 h-12 text-[#3A3B3C] mx-auto mb-3" />
              <p className="text-[#B0B3B8]">No Active Tables</p>
            </div>
          )}
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

      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 88, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: toast.type === 'success' ? '#22C55E' : '#EF4444',
          color: '#fff', fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
          maxWidth: 360,
        }}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8,
          }}>x</button>
        </div>
      )}
    </CommanderLayout>
  );
}
