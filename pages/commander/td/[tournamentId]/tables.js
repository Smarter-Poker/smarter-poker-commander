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
import { Trophy, LayoutGrid, Users, Monitor, Loader2, RefreshCw, X, ArrowRightLeft, AlertTriangle, Printer, UserX, DollarSign, FileText } from 'lucide-react';
import { busEmit } from '../../../../src/engine/EventBus';
import { commanderFetch } from '../../../../src/lib/commander/commanderFetch';
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

  // ── Seat Change Card - matches tournament buy-in receipt format ──
  const printAutoBreakReceipts = (autoBreak) => {
    if (!autoBreak?.receipts?.length) return;
    const pw = window.open('', '_blank', 'width=420,height=700');
    if (!pw) return;
    const receipts = autoBreak.receipts;
    pw.document.write(`<!DOCTYPE html><html><head><title>Seat Change Cards</title>
<style>
@page { margin: 0; size: 80mm auto; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #000; font-size: 15px; }
.card { width: 72mm; margin: 0 auto; padding: 7mm 5mm 9mm; border-bottom: 2px dashed #000; page-break-after: always; }
.card:last-child { page-break-after: avoid; border-bottom: none; }
.logo-wrap { text-align: center; margin-bottom: 3mm; }
.logo-wrap img { max-width: 36mm; max-height: 20mm; object-fit: contain; }
.venue-name { text-align: center; font-size: 24px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; line-height: 1.1; margin-bottom: 1mm; }
.venue-location { text-align: center; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #444; margin-bottom: 2mm; }
.receipt-type { text-align: center; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 1.5mm; }
.tourn-name { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 4mm; }
.divider { border-top: 1px solid #000; margin: 4mm 0; }
.field-row { display: flex; align-items: baseline; margin: 4mm 0; font-size: 15px; }
.field-label { font-weight: bold; min-width: 20mm; }
.field-val { font-size: 17px; font-weight: bold; text-transform: uppercase; }
.boxes { display: flex; gap: 8mm; justify-content: center; margin: 7mm 0; }
.box-wrap { text-align: center; width: 90px; }
.box-title { font-size: 14px; font-weight: bold; margin-bottom: 1.5mm; }
.box-num { border: 2.5px solid #000; font-size: 30px; font-weight: 900; padding: 3mm 0; width: 90px; display: block; text-align: center; line-height: 1.1; }
.footer-line { font-size: 13px; margin: 1.5mm 0; }
.customer-copy { text-align: center; font-size: 13px; font-weight: bold; letter-spacing: 1px; margin-top: 4mm; }
</style></head><body>
${receipts.map(r => `<div class="card">
  ${r.venue_logo_url ? `<div class="logo-wrap"><img src="${r.venue_logo_url}" alt="${r.venue_name}"  loading="lazy" /></div>` : ''}
  <div class="venue-name">${r.venue_name || 'Club'}</div>
  ${(r.venue_city || r.venue_state) ? `<div class="venue-location">${[r.venue_city, r.venue_state].filter(Boolean).join(', ')}</div>` : ''}
  <div class="receipt-type">Tournament Seat Change Card</div>
  <div class="tourn-name">${r.tournament_name}${r.buyin_amount ? ` - $${Number(r.buyin_amount).toLocaleString()}` : ''}</div>
  <div class="divider"></div>
  <div class="field-row"><span class="field-label">Name:</span><span class="field-val">&nbsp;${r.player_name}</span></div>
  <div class="divider"></div>
  <div class="boxes">
    <div class="box-wrap"><div class="box-title">Table</div><span class="box-num">${r.to_table}</span></div>
    <div class="box-wrap"><div class="box-title">Seat</div><span class="box-num">${r.to_seat}</span></div>
  </div>
  <div class="divider"></div>
  <div class="footer-line">${new Date(r.timestamp).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}&nbsp;&nbsp;${new Date(r.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
  <div class="customer-copy">&mdash; Dealer's Copy &mdash;</div>
</div>`).join('')}
</body></html>`);
    pw.document.close();
    setTimeout(() => { pw.print(); pw.close(); }, 500);
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

  const navigateTo = (path) => {
    const base = `/commander/td/${tournamentId}`;
    router.push(path ? `${base}${path}` : base);
  };

  if (loading) return <div className="min-h-screen bg-[#18191A] flex items-center justify-center"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" /></div>;

  const tables = floor?.tables || [];

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

        {/* Tables Grid */}
        <div className="p-4">
          <div className="grid grid-cols-2 gap-4">
            {tables.map(table => {
              const colors = COLOR_MAP[table.color] || COLOR_MAP.green;
              const maxSeats = table.max_seats || 9;
              const seatPositions = getSeatPositions(maxSeats);
              const occupiedSeats = table.players.map(p => p.seat_number);

              return (
                <button
                  key={table.table_number}
                  onClick={() => setSelectedTable(table)}
                  className={`relative rounded-2xl border-2 p-4 aspect-[4/3] flex flex-col items-center justify-center ${colors.bg} ${colors.border} active:scale-[0.98] transition-transform`}
                >
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
                      return (
                        <div
                          key={pos.seat}
                          className={`absolute w-4 h-4 rounded-full border-2 ${isOccupied
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
                    return (
                      <div key={pos.seat} className="absolute flex flex-col items-center"
                        style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}>
                        {player?.avatar_url ? (
                          <img src={player.avatar_url} alt="" width={28} height={28} loading="lazy" decoding="async" className="w-7 h-7 rounded-full object-cover border-2 border-white/30" />
                        ) : (
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${player ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'
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
                    .map(player => (
                      <div key={player.entry_id}
                        className="flex items-center gap-3 px-3 py-3 bg-[#3A3B3C]/50 rounded-xl">
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
                    ))}
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

        {/* ===== CONFIRMATION MODAL ===== */}
        {confirmAction && (
          <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center px-4" onClick={() => setConfirmAction(null)}>
            <div className="bg-[#242526] rounded-2xl w-full max-w-sm p-6 border border-[#3A3B3C]" onClick={e => e.stopPropagation()}>
              <div className="text-center mb-4">
                <div className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ backgroundColor: `${confirmAction.color}20` }}>
                  <UserX className="w-7 h-7" style={{ color: confirmAction.color }} />
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
