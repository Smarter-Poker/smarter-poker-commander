/**
 * Tournament Director - Tables Map
 * /commander/td/[tournamentId]/tables
 * Visual floor map showing all tournament tables as ovals
 * Seat dots: filled (occupied) / empty, color-coded by balance status
 * Tap table -> detail modal with player list, chip counts, break button
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import CommanderLayout from '../../../../src/components/commander/shared/CommanderLayout';
import useTournamentRealtime from '../../../../src/hooks/useTournamentRealtime';
import { broadcastChange } from '../../../../src/lib/commander/useCommanderSync';
import { Trophy, LayoutGrid, Users, Monitor, Loader2, RefreshCw, X, ArrowRightLeft, AlertTriangle, Printer, UserX, DollarSign, FileText, Shuffle, Coins } from 'lucide-react';
import { busEmit } from '../../../../src/engine/EventBus';
import { commanderFetch } from '../../../../src/lib/commander/commanderFetch';
import { printSeatChangeCards } from '../../../../src/lib/commander/receiptTemplates';
import { useConfirmAction } from "../../../../src/components/commander/shared/ConfirmModal";

const NAV_ITEMS = [
  { key: 'control', icon: Trophy, label: 'Control', path: '' },
  { key: 'tables', icon: LayoutGrid, label: 'Tables', path: '/tables' },
  { key: 'players', icon: Users, label: 'Players', path: '/players' },
  { key: 'payouts', icon: DollarSign, label: 'Payouts', path: '/payouts' },
  { key: 'reports', icon: FileText, label: 'Reports', path: '/reports' },
  { key: 'clock', icon: Monitor, label: 'Clock', path: '/clock' },
];

const COLOR_MAP = {
  green: { bg: 'bg-[#31A24C]/15', border: 'border-[#31A24C]/40', dot: 'bg-[#31A24C]', text: 'text-[#31A24C]' },
  yellow: { bg: 'bg-[#F59E0B]/15', border: 'border-[#F59E0B]/40', dot: 'bg-[#F59E0B]', text: 'text-[#F59E0B]' },
  red: { bg: 'bg-[#EF4444]/15', border: 'border-[#EF4444]/40', dot: 'bg-[#EF4444]', text: 'text-[#EF4444]' },
  blue: { bg: 'bg-[#1877F2]/15', border: 'border-[#1877F2]/40', dot: 'bg-[#1877F2]', text: 'text-[#1877F2]' },
  grey: { bg: 'bg-[#3A3B3C]/30', border: 'border-[#3A3B3C]', dot: 'bg-[#3A3B3C]', text: 'text-[#B0B3B8]' } };

function formatChips(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
  return n.toLocaleString();
}

function getSeatPositions(maxSeats) {
  const positions = [];
  for (let i = 0; i < maxSeats; i++) {
    const angle = (i / maxSeats) * 2 * Math.PI - Math.PI / 2;
    const rx = 44;
    const ry = 28;
    positions.push({
      x: 50 + Math.cos(angle) * rx,
      y: 50 + Math.sin(angle) * ry,
      seat: i + 1
    });
  }
  return positions;
}

export default function TDTablesMap() {

  // ── Toast auto-dismiss ──
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-td-tournamentId-tables'); }, []);
  const router = useRouter();
  const { tournamentId } = router.query;
  const [floor, setFloor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [autoBreak, setAutoBreak] = useState(null);
  const [breakExecuting, setBreakExecuting] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [seatDrawResults, setSeatDrawResults] = useState(null);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchFloor = useCallback(async (signal) => {

  if (!router.isReady) return null;

    if (!tournamentId) return;
    try {
      const headers = { };
      const fetchOpts = signal ? { headers, signal } : { headers };
      const [floorRes, breakRes] = await Promise.all([
        commanderFetch(`/api/commander/tournaments/${tournamentId}/floor-view`, fetchOpts),
        commanderFetch(`/api/commander/tournaments/${tournamentId}/auto-break`, fetchOpts).catch(() => null)
      ]);
      const json = await floorRes.json();
      if (json.success) setFloor(json.data);
      if (breakRes) {
        const breakJson = await breakRes.json();
        if (breakJson.success) setAutoBreak(breakJson.data);
      }
    } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
    finally { setLoading(false); }
  }, [tournamentId]);

  useTournamentRealtime(tournamentId, fetchFloor);
  useEffect(() => {
    const controller = new AbortController();
    fetchFloor(controller.signal);
    const interval = setInterval(() => fetchFloor(controller.signal), 30000); // 30s fallback safety poll
    return () => { controller.abort(); clearInterval(interval); };
  }, [fetchFloor]);

  // ── Seat Change Cards ──
  // Rendered by the shared template module so all four TD screens and the floor
  // print station produce identical paper (dealer copy + player copy, with the
  // from-seat and chip count that this screen used to discard).
  // A blocked popup no longer loses the cards silently: the server already
  // queued them for /commander/print-station, and the floor is told so.
  const printAutoBreakReceipts = (autoBreakResult) => {
    const receipts = autoBreakResult?.receipts || [];
    if (receipts.length === 0) return false;
    const printed = printSeatChangeCards(receipts);
    if (!printed) {
      setToast({ type: 'error', text: 'Popup Blocked. Seat Change Cards Are Waiting At The Print Station.' });
    }
    return printed;
  };

  const handleEliminate = async (entryId, playerName) => {
    setConfirmAction({
      type: 'eliminate',
      message: `Eliminate ${playerName || 'this player'}?`,
      detail: `Position #${floor?.stats?.players_remaining || '?'}. Cannot Be Undone.`,
      color: '#EF4444',
      onConfirm: async () => {
        setActionLoading(entryId);
        try {
          const elimRes = await commanderFetch(`/api/commander/tournaments/${tournamentId}/eliminate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entry_id: entryId, finish_position: floor?.stats?.players_remaining || 0 })
          });
          if (!elimRes.ok) throw new Error('Request failed');
          const elimJson = await elimRes.json();
          // Auto-print receipts if elimination triggered an auto table break
          if (elimJson.success) {
            if (elimJson.data?.auto_break?.executed) {
              printAutoBreakReceipts(elimJson.data.auto_break);
            }
            // An alternate may have been auto-seated into the freed seat
            if (elimJson.data?.promoted_alternate) {
              const pa = elimJson.data.promoted_alternate;
              setToast({ type: 'success', text: `Alternate ${pa.player_name || 'Player'} Seated At Table ${pa.table_number}, Seat ${pa.seat_number}` });
            }
          } else {
            setToast({ type: 'error', text: elimJson.error || 'Elimination Failed.' });
          }
          await fetchFloor();
          broadcastChange('tournaments');
          // Close modal after elimination - fresh data shown on next open
          setSelectedTable(null);
        } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Elimination Failed. Check Console.' }); }
        finally { setActionLoading(null); }
      }
    });
  };

  // Random seat draw for all unseated registered players
  const handleSeatDraw = () => {
    const count = floor?.stats?.players_registered || 0;
    setConfirmAction({
      type: 'seat_draw',
      message: `Randomly Seat ${count} Registered Player${count === 1 ? '' : 's'}?`,
      detail: 'Every Unseated Registered Player Will Be Assigned A Random Seat.',
      color: '#1877F2',
      onConfirm: async () => {
        setActionLoading('seat_draw');
        try {
          const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/seat-draw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
          const json = await res.json().catch(() => null);
          if (json?.success) {
            setSeatDrawResults(json.data);
            await fetchFloor();
            broadcastChange('tournaments');
          } else {
            setToast({ type: 'error', text: json?.error?.message || 'Seat Draw Failed.' });
          }
        } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Seat Draw Failed. Check Console.' }); }
        finally { setActionLoading(null); }
      }
    });
  };

  const navigateTo = (path) => {
    const base = `/commander/td/${tournamentId}`;
    router.push(path ? `${base}${path}` : base);
  };

  if (loading) return <div className="min-h-screen bg-[#18191A] flex items-center justify-center"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" /></div>;

  const tables = floor?.tables || [];

  // Seat conflicts come from floor-view alerts: two live players holding the
  // same table + seat. Mark the table tile and the exact seat dot so the floor
  // can see which chair is double-booked without opening every table.
  const seatConflicts = floor?.alerts?.seat_conflicts || [];
  const conflictSeatKeys = new Set(seatConflicts.map(c => `${c.table_number}:${c.seat_number}`));
  const conflictTableNumbers = new Set(seatConflicts.map(c => c.table_number));

  return (
    <CommanderLayout title="Commander - Tables" backHref={`/commander/td/${tournamentId}`}>
      <SEOHead
        title="Commander - Tables"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] pb-20 font-['Inter']">

        {/* Header */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Table Map</h1>
            <p className="text-xs text-[#B0B3B8]">{tables.length} Tables Active, {floor?.stats?.players_remaining || 0} Players</p>
          </div>
          <button onClick={fetchFloor} className="p-2 rounded-lg active:bg-[#3A3B3C]">
            <RefreshCw className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        {/* Auto-Break Alert */}
        {autoBreak?.should_break && (
          <div className="mx-4 mt-3 p-4 bg-[#F59E0B]/10 border-2 border-[#F59E0B]/40 rounded-2xl">
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle className="w-6 h-6 text-[#F59E0B] flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-base font-bold text-[#F59E0B]">Break Table {autoBreak.break_table}</h3>
                <p className="text-xs text-[#B0B3B8] mt-0.5">{autoBreak.reason}</p>
              </div>
            </div>
            {/* Assignment preview */}
            <div className="space-y-1 mb-3">
              {(autoBreak.assignments || []).map((a, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-[#18191A]/60 rounded-lg text-xs">
                  <span className="text-white flex-1 truncate">{a.player_name}</span>
                  <span className="text-[#B0B3B8] font-mono">T{a.from_table}-S{a.from_seat}</span>
                  <span className="text-[#F59E0B]">→</span>
                  <span className="text-[#31A24C] font-bold font-mono">T{a.to_table}-S{a.to_seat}</span>
                </div>
              ))}
            </div>
            <button
              onClick={async () => {
                setBreakExecuting(true);
                try {
                  const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/auto-break`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      break_table: autoBreak.break_table,
                      assignments: autoBreak.assignments
                    })
                  });
                  if (!res.ok) throw new Error(`Request failed (${res.status})`);
                  const json = await res.json();
                  if (json.success && json.data.receipts) {
                    // Print SEAT CHANGE CARDs via shared helper
                    printAutoBreakReceipts({ receipts: json.data.receipts });
                    setAutoBreak(null);
                    await fetchFloor();
                    broadcastChange('tournaments');
                  } else {
                    setToast({ type: 'error', text: json.error || 'Break Failed. Please Try Again.' });
                  }
                } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Break Failed. Check Console.' }); }
                finally { setBreakExecuting(false); }
              }}
              disabled={breakExecuting}
              className="w-full py-3.5 rounded-xl bg-[#F59E0B] text-black text-sm font-bold flex items-center justify-center gap-2 active:bg-[#D97706] disabled:opacity-50"
            >
              {breakExecuting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Breaking Table...</>
                : <><Printer className="w-4 h-4" /> Break Table & Print {(autoBreak.assignments || []).length} Receipts</>
              }
            </button>
          </div>
        )}

        {/* Run Seat Draw */}
        {(floor?.stats?.players_registered || 0) > 0 && (
          <div className="mx-4 mt-3">
            <button
              onClick={handleSeatDraw}
              disabled={actionLoading === 'seat_draw'}
              className="w-full py-3.5 rounded-xl bg-[#1877F2] text-white text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {actionLoading === 'seat_draw'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Drawing Seats...</>
                : <><Shuffle className="w-4 h-4" /> Run Seat Draw ({floor.stats.players_registered} Registered)</>
              }
            </button>
          </div>
        )}

        {/* Chip Counts (break-time stack entry). A bottom-nav entry would make
            seven targets and drop each below 44px at 375px, so it lives here. */}
        <div className="mx-4 mt-3">
          <button
            onClick={() => navigateTo('/chips')}
            className="w-full py-3.5 rounded-xl bg-[#242526] border border-[#3A3B3C] text-[#E4E6EB] text-sm font-bold flex items-center justify-center gap-2 active:bg-[#3A3B3C] transition-colors"
          >
            <Coins className="w-4 h-4 text-[#F59E0B]" /> Chip Counts
          </button>
        </div>

        {/* Tables Grid */}
        <div className="p-4">
          <div className="grid grid-cols-2 gap-4">
            {tables.map(table => {
              const colors = COLOR_MAP[table.color] || COLOR_MAP.green;
              const maxSeats = table.max_seats || 9;
              const seatPositions = getSeatPositions(maxSeats);
              const occupiedSeats = table.players.map(p => p.seat_number);
              const hasConflict = conflictTableNumbers.has(table.table_number);

              return (
                <button
                  key={table.table_number}
                  onClick={() => setSelectedTable(table)}
                  className={`relative rounded-2xl border-2 p-4 aspect-[4/3] flex flex-col items-center justify-center ${colors.bg} ${colors.border} active:scale-[0.98] transition-transform ${hasConflict ? 'ring-2 ring-[#EF4444] ring-offset-2 ring-offset-[#18191A]' : ''}`}
                >
                  {hasConflict && (
                    <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-[#EF4444] flex items-center justify-center z-10"
                      title="Seat Conflict On This Table">
                      <AlertTriangle className="w-3.5 h-3.5 text-white" />
                    </span>
                  )}
                  {/* Oval table shape with seat dots */}
                  <div className="relative w-full h-full">
                    {/* Center table info */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xs text-[#B0B3B8] uppercase tracking-wider">Table</span>
                      <span className="text-3xl font-bold text-white">{table.table_number}</span>
                      <span className={`text-sm font-semibold ${colors.text}`}>
                        {table.player_count}/{maxSeats}
                      </span>
                    </div>

                    {/* Seat dots positioned around oval */}
                    {seatPositions.map(pos => {
                      const isOccupied = occupiedSeats.includes(pos.seat);
                      const isConflicted = conflictSeatKeys.has(`${table.table_number}:${pos.seat}`);
                      return (
                        <div
                          key={pos.seat}
                          className={`absolute w-4 h-4 rounded-full border-2 ${isConflicted
                            ? 'bg-[#EF4444] border-white animate-pulse'
                            : isOccupied
                              ? `${colors.dot} border-white/30`
                              : 'bg-transparent border-[#3A3B3C]'
                            }`}
                          style={{
                            left: `${pos.x}%`,
                            top: `${pos.y}%`,
                            transform: 'translate(-50%, -50%)'
                          }}
                        />
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>

          {tables.length === 0 && (
            <div className="text-center py-16">
              <LayoutGrid className="w-12 h-12 text-[#3A3B3C] mx-auto mb-3" />
              <p className="text-[#B0B3B8]">No Active Tables</p>
            </div>
          )}

          {/* ===== SEAT CONFLICTS ===== */}
          {seatConflicts.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
                <h2 className="text-sm font-semibold text-[#EF4444] uppercase tracking-wider">
                  Seat Conflicts ({seatConflicts.length})
                </h2>
              </div>
              <div className="bg-[#EF4444]/10 border-2 border-[#EF4444]/40 rounded-2xl overflow-hidden">
                <div className="divide-y divide-[#EF4444]/20">
                  {seatConflicts.map((c, i) => (
                    <button
                      key={`${c.table_number}-${c.seat_number}-${i}`}
                      onClick={() => {
                        const t = tables.find(tt => tt.table_number === c.table_number);
                        if (t) setSelectedTable(t);
                      }}
                      className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-[#EF4444]/15"
                    >
                      <span className="px-2 py-1 rounded-lg bg-[#EF4444] text-white text-xs font-bold font-mono flex-shrink-0">
                        T{c.table_number}-S{c.seat_number}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#EF4444]">
                          Table {c.table_number} Seat {c.seat_number} Has {c.players?.length || 2} Players
                        </p>
                        <p className="text-xs text-[#E4E6EB] truncate">
                          {(c.players || []).filter(Boolean).join(' And ') || 'Unknown Players'}
                        </p>
                      </div>
                      <ArrowRightLeft className="w-4 h-4 text-[#EF4444] flex-shrink-0" />
                    </button>
                  ))}
                </div>
                <p className="px-4 py-2.5 text-xs text-[#B0B3B8] border-t border-[#EF4444]/20">
                  Open The Table And Move One Player To An Open Seat.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ===== TABLE DETAIL MODAL ===== */}
        {selectedTable && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center"
            onClick={() => setSelectedTable(null)}>
            <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}>

              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#3A3B3C]">
                <div>
                  <h3 className="text-lg font-bold text-white">Table {selectedTable.table_number}</h3>
                  <p className="text-xs text-[#B0B3B8]">
                    {selectedTable.player_count} Players, {selectedTable.available_seats} Seats Open
                  </p>
                </div>
                <button onClick={() => setSelectedTable(null)}
                  className="w-10 h-10 rounded-full bg-[#3A3B3C] flex items-center justify-center active:bg-[#4A4B4C]">
                  <X className="w-5 h-5 text-[#E4E6EB]" />
                </button>
              </div>

              {/* Seat layout visual */}
              <div className="px-5 py-4">
                <div className="relative w-full aspect-[2/1] bg-[#31A24C]/10 rounded-[50%] border-2 border-[#31A24C]/30 mx-auto max-w-xs">
                  {getSeatPositions(selectedTable.max_seats || 9).map(pos => {
                    const player = selectedTable.players.find(p => p.seat_number === pos.seat);
                    const posConflicted = conflictSeatKeys.has(`${selectedTable.table_number}:${pos.seat}`);
                    return (
                      <div key={pos.seat} className="absolute flex flex-col items-center"
                        style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}>
                        {player?.avatar_url ? (
                          <img src={player.avatar_url} alt="" width={28} height={28} loading="lazy" decoding="async" className={`w-7 h-7 rounded-full object-cover border-2 ${posConflicted ? 'border-[#EF4444]' : 'border-white/30'}`} />
                        ) : (
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${posConflicted ? 'bg-[#EF4444] text-white' : player ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'
                            }`}>
                            {player ? (player.player_name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || pos.seat) : pos.seat}
                          </div>
                        )}
                        {player && (
                          <span className="text-[8px] text-[#B0B3B8] mt-0.5 max-w-[50px] truncate text-center">
                            {player.player_name?.split(' ')[0]}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Player list */}
              <div className="flex-1 overflow-y-auto px-5 pb-5">
                <div className="space-y-1">
                  {selectedTable.players
                    .sort((a, b) => a.seat_number - b.seat_number)
                    .map(player => {
                      const seatConflicted = conflictSeatKeys.has(`${selectedTable.table_number}:${player.seat_number}`);
                      return (
                      <div key={player.entry_id}
                        className={`flex items-center gap-3 px-3 py-3 rounded-xl ${seatConflicted ? 'bg-[#EF4444]/15 ring-1 ring-[#EF4444]/50' : 'bg-[#3A3B3C]/50'}`}>
                        {player.avatar_url ? (
                          <img src={player.avatar_url} alt="" width={28} height={28} loading="lazy" decoding="async" className="w-7 h-7 rounded-full object-cover border-2 border-[#1877F2]/40 flex-shrink-0" />
                        ) : (
                          <span className="w-7 h-7 rounded-full bg-[#1877F2]/20 text-[#1877F2] flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {player.seat_number}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#E4E6EB] truncate">{player.player_name}</p>
                          <p className="text-xs text-[#B0B3B8]">
                            {formatChips(player.current_chips)} Chips
                            {player.rebuy_count > 0 && ` - ${player.rebuy_count}R`}
                            {player.addon_taken && ' - A'}
                          </p>
                          {seatConflicted && (
                            <p className="text-xs font-bold text-[#EF4444] mt-0.5">
                              Seat Conflict, Move One Player
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => router.push(`/commander/td/${tournamentId}/players?move=${player.entry_id}`)}
                            className="w-10 h-10 rounded-lg bg-[#3A3B3C] flex items-center justify-center active:bg-[#4A4B4C]"
                            title="Move Player"
                          >
                            <ArrowRightLeft className="w-4 h-4 text-[#B0B3B8]" />
                          </button>
                          <button
                            onClick={() => handleEliminate(player.entry_id, player.player_name)}
                            disabled={actionLoading === player.entry_id}
                            className="w-10 h-10 rounded-lg bg-[#EF4444]/10 flex items-center justify-center active:bg-[#EF4444]/20 disabled:opacity-50"
                            title="Eliminate"
                          >
                            {actionLoading === player.entry_id
                              ? <Loader2 className="w-4 h-4 text-[#EF4444] animate-spin" />
                              : <UserX className="w-4 h-4 text-[#EF4444]" />
                            }
                          </button>
                        </div>
                      </div>
                      );
                    })}
                </div>

                {/* Break Table button */}
                {selectedTable.players.length > 0 && (
                  <div className="px-5 pb-5">
                    <button
                      onClick={async () => {
                        if (!confirm(`Break Table ${selectedTable.table_number}? All ${selectedTable.players.length} Players Will Be Auto-Assigned To Available Seats.`)) return;
                        setActionLoading('break');
                        try {
                          // Step 1: Fetch auto-break assignments for THIS specific table
                          // Use ?force_table= so the API generates assignments for the TD's chosen table,
                          // not the system's automatically-detected smallest table.
                          const breakSuggestRes = await commanderFetch(`/api/commander/tournaments/${tournamentId}/auto-break?force_table=${selectedTable.table_number}`,
                            {}
                          );
                          if (!breakSuggestRes.ok) throw new Error(`Request failed (${breakSuggestRes.status})`);
                          const breakSuggestJson = await breakSuggestRes.json();

                          // Use assignments if available - these are now specifically for selectedTable.table_number
                          let assignments = breakSuggestJson.data?.assignments || [];

                          if (!breakSuggestJson.success || assignments.length === 0) {
                            // No auto assignments available - alert the TD
                            setToast({ type: 'error', text: `Cannot Auto-Break Table ${selectedTable.table_number}: Not Enough Available Seats At Other Tables. Manually Move Players First.` });
                            setActionLoading(null);
                            return;
                          }

                          // Step 2: Execute the break via break-table API
                          const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/break-table`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              table_number: selectedTable.table_number,
                              assignments
                            })
                          });
                          if (!res.ok) throw new Error(`Request failed (${res.status})`);
                          const json = await res.json();

                          // Step 3: Print Potawatomi SEAT CHANGE CARDs
                          if (json.success && json.data?.receipts?.length) {
                            printAutoBreakReceipts({ receipts: json.data.receipts });
                          } else if (!json.success) {
                            setToast({ type: 'error', text: `Break Failed: ${json.error || 'Unknown Error'}` });
                          }

                          setSelectedTable(null);
                          await fetchFloor();
                          broadcastChange('tournaments');
                        } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Break Failed. Check Console.' }); }
                        finally { setActionLoading(null); }
                      }}
                      disabled={actionLoading === 'break'}
                      className="w-full py-4 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#EF4444] text-base font-semibold active:bg-[#EF4444]/20 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {actionLoading === 'break'
                        ? <><Loader2 className="w-5 h-5 animate-spin" /> Breaking Table...</>
                        : <><Printer className="w-5 h-5" /> Break Table &amp; Print {selectedTable.players.length} Receipts</>
                      }
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===== SEAT DRAW RESULTS SHEET ===== */}
        {seatDrawResults && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center"
            onClick={() => setSeatDrawResults(null)}>
            <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-[#3A3B3C]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#31A24C]/20 flex items-center justify-center flex-shrink-0">
                    <Shuffle className="w-5 h-5 text-[#31A24C]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Seat Draw Complete</h3>
                    <p className="text-xs text-[#B0B3B8]">
                      {seatDrawResults.message || `${seatDrawResults.players_drawn || 0} Players Seated`}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {(() => {
                  const groups = {};
                  (seatDrawResults.assignments || []).forEach(a => {
                    const key = a.table_number ?? 0;
                    if (!groups[key]) groups[key] = [];
                    groups[key].push(a);
                  });
                  const tableNums = Object.keys(groups).map(Number).sort((a, b) => a - b);
                  if (tableNums.length === 0) {
                    return <p className="text-sm text-[#B0B3B8] text-center py-6">No Assignments Returned</p>;
                  }
                  return tableNums.map(tn => (
                    <div key={tn}>
                      <p className="text-xs font-bold text-[#B0B3B8] uppercase tracking-wider mb-2">Table {tn}</p>
                      <div className="space-y-1">
                        {groups[tn].sort((a, b) => (a.seat_number || 0) - (b.seat_number || 0)).map(a => (
                          <div key={a.entry_id} className="flex items-center gap-3 px-3 py-2.5 bg-[#3A3B3C]/50 rounded-xl">
                            <span className="w-7 h-7 rounded-full bg-[#1877F2]/20 text-[#1877F2] flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {a.seat_number}
                            </span>
                            <span className="flex-1 text-sm font-medium text-[#E4E6EB] truncate">{a.player_name || 'Player'}</span>
                            <span className="text-xs text-[#B0B3B8] font-mono">T{a.table_number}-S{a.seat_number}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()}
              </div>
              <div className="px-5 pb-5 pt-2 border-t border-[#3A3B3C]">
                <button onClick={() => setSeatDrawResults(null)}
                  className="w-full py-3.5 rounded-xl bg-[#1877F2] text-white text-base font-bold active:scale-[0.98] transition-transform">
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== CONFIRMATION MODAL ===== */}
        {confirmAction && (
          <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center px-4" onClick={() => setConfirmAction(null)}>
            <div className="bg-[#242526] rounded-2xl w-full max-w-sm p-6 border border-[#3A3B3C]" onClick={e => e.stopPropagation()}>
              <div className="text-center mb-4">
                <div className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ backgroundColor: `${confirmAction.color}20` }}>
                  {confirmAction.type === 'seat_draw'
                    ? <Shuffle className="w-7 h-7" style={{ color: confirmAction.color }} />
                    : <UserX className="w-7 h-7" style={{ color: confirmAction.color }} />
                  }
                </div>
                <h3 className="text-lg font-bold text-white">{confirmAction.message}</h3>
                <p className="text-sm text-[#B0B3B8] mt-1">{confirmAction.detail}</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setConfirmAction(null)}
                  className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] font-medium active:bg-[#4A4B4C]">Cancel</button>
                <button onClick={async () => { setConfirmAction(null); await confirmAction.onConfirm(); }}
                  className="flex-1 py-3 rounded-xl text-white font-bold active:opacity-80"
                  style={{ backgroundColor: confirmAction.color }}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bottom Nav */}
        <nav className="fixed bottom-0 left-0 right-0 bg-[#242526] border-t border-[#3A3B3C] z-40">
          <div className="flex items-center justify-around h-16 max-w-2xl mx-auto">
            {NAV_ITEMS.map(item => {
              const Icon = item.icon;
              const isActive = item.key === 'tables';
              return (
                <button key={item.key} onClick={() => navigateTo(item.path)}
                  className={`flex flex-col items-center justify-center gap-0.5 w-16 h-14 rounded-lg ${isActive ? 'text-[#1877F2]' : 'text-[#B0B3B8] active:text-[#E4E6EB]'
                    }`}>
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
    
      <ConfirmDialog />
    </CommanderLayout>
  );
}
