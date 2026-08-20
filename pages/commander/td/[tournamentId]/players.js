/**
 * Tournament Director - Players Management
 * /commander/td/[tournamentId]/players
 * Searchable player list with filter tabs (All/Active/Eliminated/Registered)
 * Tap player -> action sheet: Move, Eliminate, Rebuy, Add-on, Update Chips, Seat Change
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import CommanderLayout from '../../../../src/components/commander/shared/CommanderLayout';
import useTournamentRealtime from '../../../../src/hooks/useTournamentRealtime';
import { broadcastChange } from '../../../../src/lib/commander/useCommanderSync';
import { Trophy, LayoutGrid, Users, Monitor, Search, X, Loader2, ChevronDown, ArrowRightLeft, UserX, RotateCcw, Star, Coins, DollarSign, FileText, UserPlus, Undo2, Package } from 'lucide-react';
import { busEmit } from '../../../../src/engine/EventBus';
import { commanderFetch } from '../../../../src/lib/commander/commanderFetch';
import { buildActionReceiptsHtml, printHtml, printSeatChangeCards } from '../../../../src/lib/commander/receiptTemplates';

const NAV_ITEMS = [
  { key: 'control', path: '' }, { key: 'tables', path: '/tables' },
  { key: 'players', path: '/players' }, { key: 'payouts', path: '/payouts' },
  { key: 'reports', path: '/reports' }, { key: 'clock', path: '/clock' },
];
const NAV_ICONS = { control: Trophy, tables: LayoutGrid, players: Users, payouts: DollarSign, reports: FileText, clock: Monitor };

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  // Multi-day: players who bagged their chips at the end of a day. They are
  // still in the tournament, they just hold no seat until the day resumes.
  { key: 'bagged', label: 'Bagged' },
  { key: 'eliminated', label: 'Out' },
  { key: 'registered', label: 'Registered' },
  { key: 'alternate', label: 'Alternates' },
];

function formatChips(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
  return n.toLocaleString();
}

export default function TDPlayers() {

  useEffect(() => { busEmit.sessionStart('commander-td-tournamentId-players'); }, []);
  const router = useRouter();
  const { tournamentId, move: moveEntryId, tab: tabParam } = router.query;
  const [floor, setFloor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [chipModal, setChipModal] = useState(null);
  const [chipValue, setChipValue] = useState('');
  const [moveModal, setMoveModal] = useState(null);
  const [moveTable, setMoveTable] = useState('');
  const [moveSeat, setMoveSeat] = useState('');
  // 'move'   -> POST /move-player, keeps the player's current status
  // 'assign' -> PUT  /entries/[entryId]/seat, promotes 'registered' to 'seated'
  const [moveMode, setMoveMode] = useState('move');
  const [confirmAction, setConfirmAction] = useState(null); // { type, player, message }
  const [eliminatorId, setEliminatorId] = useState('');

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
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/floor-view`, { ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) setFloor(json.data);
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, [tournamentId]);

  useTournamentRealtime(tournamentId, fetchFloor);
  useEffect(() => { const _c = new AbortController(); fetchFloor(_c.signal); const i = setInterval(() => fetchFloor(_c.signal), 30000); return () => { _c.abort(); clearInterval(i); }; }, [fetchFloor]); // 30s fallback

  // 2026-08-04 audit fix: the tables page deep-links here with ?move=<entry_id>
  // but the param was read and never used - open the move modal for that entry
  // once floor data arrives.
  useEffect(() => {
    if (!moveEntryId || !floor?.entries?.length || moveModal) return;
    const entry = floor.entries.find(e => e.entry_id === moveEntryId);
    // Only a player who currently holds a seat can be "moved" to another one.
    // 'bagged' excluded on purpose: they have no seat to move from, and the
    // action sheet offers Assign Exact Seat for them instead.
    if (entry && ['active', 'seated'].includes(entry.status)) {
      setMoveMode('move');
      setMoveModal({ ...entry, status: entry.status === 'seated' ? 'active' : entry.status });
    }
    // Clear the param so closing the modal doesn't reopen it
    router.replace(`/commander/td/${tournamentId}/players`, undefined, { shallow: true });
  }, [moveEntryId, floor, moveModal, router, tournamentId]);

  // Deep link support: the Control Center links here with ?tab=alternate so the
  // TD lands directly on the waiting list instead of hunting for the tab.
  useEffect(() => {
    if (!tabParam) return;
    if (FILTERS.some(f => f.key === tabParam)) setFilter(tabParam);
  }, [tabParam]);

  // Build flat player list from full entries array (all statuses)
  const allPlayers = [];
  if (floor) {
    // Use the full entries array from API (includes all statuses)
    if (floor.entries?.length > 0) {
      floor.entries.forEach(e => {
        allPlayers.push({
          ...e,
          status: e.status === 'seated' ? 'active' : e.status });
      });
    } else {
      // Fallback to old table-based approach
      floor.tables?.forEach(t => {
        t.players.forEach(p => {
          allPlayers.push({ ...p, table_number: t.table_number, status: 'active' });
        });
      });
      floor.eliminated?.forEach(e => {
        allPlayers.push({ ...e, status: 'eliminated', current_chips: 0 });
      });
    }
  }

  const alternateCount = allPlayers.filter(p => p.status === 'alternate').length;
  const baggedCount = allPlayers.filter(p => p.status === 'bagged').length;

  const filtered = allPlayers.filter(p => {
    if (filter !== 'all' && p.status !== filter) return false;
    if (search && !p.player_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    // Alternates are a queue, not a name list: first registered is next up.
    if (a.status === 'alternate' && b.status === 'alternate') {
      return (a.queue_position || 9999) - (b.queue_position || 9999);
    }
    // Bagged players are read as a chip-count sheet, biggest stack first,
    // which is the order the overnight leader board is announced in.
    if (a.status === 'bagged' && b.status === 'bagged') {
      return (Number(b.current_chips) || 0) - (Number(a.current_chips) || 0);
    }
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return (a.player_name || '').localeCompare(b.player_name || '');
  });

  const apiCall = async (url, body) => {
    // 2026-07-25 audit fix: bare fetch omitted auth headers (x-staff-session),
    // so every action 401'd; use commanderFetch which injects them.
    const res = await commanderFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) return { success: false, error: 'API Error' };
    return res.json();
  };

  const confirmEliminate = (player) => {
    setEliminatorId('');
    setConfirmAction({
      type: 'eliminate', player,
      message: `Eliminate ${player.player_name}?`,
      detail: `Position #${floor?.stats?.players_remaining || '?'}. This Cannot Be Undone.`,
      color: '#EF4444' });
  };

  const confirmRebuy = (player) => {
    setConfirmAction({
      type: 'rebuy', player,
      message: `Rebuy for ${player.player_name}?`,
      detail: floor?.tournament?.rebuy_cost ? `Cost: $${floor.tournament.rebuy_cost}, Chips: ${formatChips(floor.tournament.rebuy_chips || floor.tournament.starting_chips)}` : 'Process Rebuy For This Player.',
      color: '#31A24C' });
  };

  // Rebuy / add-on card, rendered by the shared template module.
  // Returns false when the popup was blocked so the floor gets told.
  const printBluetoothReceipt = (player, actionType, cost, chips) => {
    const html = buildActionReceiptsHtml([{
      tournamentName: floor?.tournament?.name || 'Tournament',
      actionType,
      playerName: player?.player_name || 'Player',
      cost,
      chips
    }], { title: `${actionType} Receipt` });
    const printed = printHtml(html, { title: `${actionType} Receipt` });
    if (!printed) {
      setToast({ type: 'error', text: `Popup Blocked. The ${actionType} Receipt Did Not Print.` });
    }
    return printed;
  };

  // Seat change cards from the shared template module (dealer copy + player copy).
  // The server already queued these for the floor print station, so a blocked
  // popup is a warning here, not a lost card.
  const printAutoBreakReceipts = (autoBreakResult) => {
    const receipts = autoBreakResult?.receipts || [];
    if (receipts.length === 0) return false;
    const printed = printSeatChangeCards(receipts);
    if (!printed) {
      setToast({ type: 'error', text: 'Popup Blocked. Seat Change Cards Are Waiting At The Print Station.' });
    }
    return printed;
  };

  // Seat a waiting alternate into a random open seat via the promote endpoint
  const performPromote = async (player) => {
    setActionLoading('promote');
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/entries/${player.entry_id}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const json = await res.json().catch(() => null);
      if (json?.success) {
        setToast({ type: 'success', text: json.data?.message || 'Alternate Seated.' });
        setSelectedPlayer(null);
        await fetchFloor();
        broadcastChange('tournaments');
      } else {
        setToast({ type: 'error', text: json?.error?.message || 'Failed To Seat Alternate.' });
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Failed To Seat Alternate. Check Console.' }); }
    finally { setActionLoading(null); }
  };

  // Undo an elimination. On 409 PAYOUT_RECORDED, ask for confirmation before
  // retrying with force:true (the recorded payout will be cleared).
  const performRestore = async (player, force = false) => {
    setActionLoading('restore');
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/entries/${player.entry_id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(force ? { force: true } : {})
      });
      const json = await res.json().catch(() => null);
      if (json?.success) {
        setToast({
          type: 'success',
          text: `${json.data?.message || 'Elimination Undone.'}${json.data?.bounty_reversed ? ' Bounty Reversed.' : ''}`
        });
        setSelectedPlayer(null);
        await fetchFloor();
        broadcastChange('tournaments');
      } else if (res.status === 409 && json?.error?.code === 'PAYOUT_RECORDED' && !force) {
        setConfirmAction({
          type: 'restore_force', player,
          message: `Undo Elimination For ${player.player_name}?`,
          detail: 'A Payout Is Already Recorded For This Player. Forcing The Undo Will Clear That Payout. Continue?',
          color: '#F59E0B' });
      } else {
        setToast({ type: 'error', text: json?.error?.message || 'Failed To Undo Elimination.' });
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Failed To Undo Elimination. Check Console.' }); }
    finally { setActionLoading(null); }
  };

  const executeConfirmedAction = async () => {
    if (!confirmAction) return;
    const { type, player } = confirmAction;
    setActionLoading(type);
    setConfirmAction(null);
    let success = false;
    try {
      if (type === 'eliminate') {
        const res = await apiCall(`/api/commander/tournaments/${tournamentId}/eliminate`, {
          entry_id: player.entry_id, finish_position: floor?.stats?.players_remaining || 0,
          eliminated_by_id: eliminatorId || null
        });
        if (res.success) {
          success = true;
          // Auto-print receipts if the elimination triggered an auto table break
          if (res.data?.auto_break?.executed) {
            printAutoBreakReceipts(res.data.auto_break);
          }
          // An alternate may have been auto-seated into the freed seat
          if (res.data?.promoted_alternate) {
            const pa = res.data.promoted_alternate;
            setToast({ type: 'success', text: `Alternate ${pa.player_name || 'Player'} Seated At Table ${pa.table_number}, Seat ${pa.seat_number}` });
          }
        } else {
          setToast({ type: 'error', text: res.error?.message || res.error || 'Elimination Failed.' });
        }
      } else if (type === 'rebuy') {
        const res = await apiCall(`/api/commander/tournaments/${tournamentId}/entries/${player.entry_id}/rebuy`, {});
        if (res.success) {
          success = true;
          printBluetoothReceipt(player, 'Rebuy', floor?.tournament?.rebuy_cost, floor?.tournament?.rebuy_chips || floor?.tournament?.starting_chips);
        } else {
          setToast({ type: 'error', text: res.error || 'Rebuy Failed.' });
        }
      } else if (type === 'addon') {
        const res = await apiCall(`/api/commander/tournaments/${tournamentId}/entries/${player.entry_id}/addon`, {});
        if (res.success) {
          success = true;
          printBluetoothReceipt(player, 'Add-on', floor?.tournament?.addon_cost, floor?.tournament?.addon_chips || floor?.tournament?.starting_chips);
        } else {
          setToast({ type: 'error', text: res.error || 'Add-On Failed.' });
        }
      } else if (type === 'restore_force') {
        // performRestore handles toast, refetch, and closing the sheet itself
        await performRestore(player, true);
      }
      
      if (success) {
        setSelectedPlayer(null);
        await fetchFloor();
        broadcastChange('tournaments');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action Failed. Check Console.' }); }
    finally { setActionLoading(null); }
  };

  const handleEliminate = (player) => confirmEliminate(player);
  const handleRebuy = (player) => confirmRebuy(player);

  const handleAddon = (player) => {
    setConfirmAction({
      type: 'addon', player,
      message: `Add-on for ${player.player_name}?`,
      detail: floor?.tournament?.addon_cost ? `Cost: $${floor.tournament.addon_cost}, Chips: ${formatChips(floor.tournament.addon_chips || floor.tournament.starting_chips)}` : 'Process Add-On For This Player.',
      color: '#8B5CF6' });
  };

  const handleUpdateChips = async () => {
    if (!chipModal || !chipValue) return;
    setActionLoading('chips');
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/entries/${chipModal.entry_id}/chips`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chips: parseInt(chipValue) })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setChipModal(null);
          setChipValue('');
          setSelectedPlayer(null);
          await fetchFloor();
          broadcastChange('tournaments');
        } else {
          setToast({ type: 'error', text: json.error || 'Failed To Update Chips.' });
        }
      } else {
        setToast({ type: 'error', text: 'Failed To Update Chips.' });
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Failed To Update Chips. Check Console.' }); }
    finally { setActionLoading(null); }
  };

  const closeMoveModal = () => {
    setMoveModal(null);
    setMoveTable('');
    setMoveSeat('');
    setMoveMode('move');
  };

  // Same picker, two endpoints. Opening it always clears the previous choice
  // so a stale table or seat cannot be submitted for the next player.
  const openMovePlayer = (player) => {
    setMoveMode('move');
    setMoveTable('');
    setMoveSeat('');
    setMoveModal(player);
  };

  const openAssignSeat = (player) => {
    setMoveMode('assign');
    setMoveTable('');
    setMoveSeat('');
    setMoveModal(player);
  };

  // ── Assign Seat ─────────────────────────────────────────────────────────
  // PUT /api/commander/tournaments/[id]/entries/[entryId]/seat
  //     body { table_number, seat_number }
  //     -> { success, data: { entry_id, player_name, from_table, from_seat,
  //          to_table, to_seat } }
  // Error codes: VALIDATION_ERROR (400, seat must be a whole number 1 to 12),
  //              PLAYER_NOT_ACTIVE (400), SEAT_OCCUPIED (409, names the
  //              occupant), NOT_FOUND (404), DB_ERROR / SERVER_ERROR (500).
  // This is the only path that seats a specific registered player in a
  // specific chair: it advances 'registered' to 'seated', which the bulk seat
  // draw and the late-registration auto-claim otherwise own. move-player
  // leaves the status untouched, so it cannot be used to seat a registrant.
  const performAssignSeat = async () => {
    if (!moveModal || !moveTable || !moveSeat) return;
    setActionLoading('move');
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/entries/${moveModal.entry_id}/seat`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_number: parseInt(moveTable), seat_number: parseInt(moveSeat) })
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        const d = json.data || {};
        setToast({
          type: 'success',
          text: `${d.player_name || moveModal.player_name} Seated At Table ${d.to_table} Seat ${d.to_seat}.`
        });
        closeMoveModal();
        setSelectedPlayer(null);
        await fetchFloor();
        broadcastChange('tournaments');
      } else {
        setToast({ type: 'error', text: json?.error?.message || `Could Not Assign That Seat (${res.status}).` });
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Could Not Assign That Seat. Check Console.' }); }
    finally { setActionLoading(null); }
  };

  const handleMove = async () => {
    if (!moveModal || !moveTable || !moveSeat) return;
    if (moveMode === 'assign') return performAssignSeat();
    setActionLoading('move');
    try {
      const res = await apiCall(`/api/commander/tournaments/${tournamentId}/move-player`, {
        entry_id: moveModal.entry_id, to_table: parseInt(moveTable), to_seat: parseInt(moveSeat)
      });
      if (res.success) {
        closeMoveModal();
        setSelectedPlayer(null);
        await fetchFloor();
        broadcastChange('tournaments');
      } else {
        setToast({ type: 'error', text: res.error || 'Move Failed. Seat May Be Occupied.' });
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Move Failed. Check Console.' }); }
    finally { setActionLoading(null); }
  };

  const navigateTo = (path) => router.push(`/commander/td/${tournamentId}${path}`);

  if (loading) return <div className="min-h-screen bg-[#18191A] flex items-center justify-center"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" /></div>;

  return (
    <CommanderLayout title="Commander - Players" backHref={`/commander/td/${tournamentId}`}>
      <SEOHead
        title="Commander - Players"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] pb-20 font-['Inter']">

        {/* Header */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3">
          <h1 className="text-lg font-bold text-white">Players</h1>
          <p className="text-xs text-[#B0B3B8]">
            {allPlayers.filter(p => p.status === 'active').length} Active
            {baggedCount > 0 ? `, ${baggedCount} Bagged` : ''}
            , {allPlayers.length} Total
          </p>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#B0B3B8]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search Players..."
              className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl pl-10 pr-10 py-3 text-[#E4E6EB] text-base placeholder-[#B0B3B8]/50 focus:outline-none focus:border-[#1877F2]"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-5 h-5 text-[#B0B3B8]" />
              </button>
            )}
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="px-4 flex gap-2 pb-3 overflow-x-auto">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-4 py-2 rounded-full text-sm font-medium flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 ${filter === f.key
                ? 'bg-[#1877F2] text-white'
                : 'bg-[#3A3B3C] text-[#B0B3B8] active:bg-[#4A4B4C]'
                }`}>
              {f.label}
              {f.key === 'alternate' && alternateCount > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${filter === f.key ? 'bg-white/25 text-white' : 'bg-[#F59E0B]/20 text-[#F59E0B]'}`}>
                  {alternateCount}
                </span>
              )}
              {f.key === 'bagged' && baggedCount > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${filter === f.key ? 'bg-white/25 text-white' : 'bg-[#F59E0B]/20 text-[#F59E0B]'}`}>
                  {baggedCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Player List */}
        <div className="px-4 space-y-1">
          {filtered.map(player => (
            <button
              key={player.entry_id}
              onClick={() => setSelectedPlayer(player)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-[#242526] rounded-xl border border-[#3A3B3C] active:bg-[#3A3B3C] text-left"
            >
              {player.avatar_url ? (
                <img src={player.avatar_url} alt="" width={36} height={36} loading="lazy" decoding="async" className="w-9 h-9 rounded-full object-cover flex-shrink-0 border-2" />
              ) : (
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${player.status === 'active' ? 'bg-[#1877F2]/20 text-[#1877F2]' :
                  player.status === 'eliminated' ? 'bg-[#EF4444]/20 text-[#EF4444]' :
                    player.status === 'alternate' || player.status === 'bagged' ? 'bg-[#F59E0B]/20 text-[#F59E0B]' :
                      'bg-[#B0B3B8]/20 text-[#B0B3B8]'
                  }`}>
                  {player.player_name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??'}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#E4E6EB] truncate">{player.player_name}</p>
                <p className="text-xs text-[#B0B3B8]">
                  {player.status === 'active'
                    ? `${formatChips(player.current_chips)} Chips${player.rebuy_count > 0 ? ` - ${player.rebuy_count}R` : ''}${player.addon_taken ? ' - A' : ''}`
                    : player.status === 'eliminated'
                      ? `Eliminated${player.finish_position ? ` #${player.finish_position}` : ''}`
                      : player.status === 'alternate'
                        ? 'Alternate, Waiting For Seat'
                        : player.status === 'bagged'
                          // The bagged stack is the whole point of this row, so
                          // it is spelled out in full rather than abbreviated.
                          ? `Bagged ${(Number(player.current_chips) || 0).toLocaleString()} Chips`
                          : 'Registered'
                  }
                </p>
              </div>
              {player.status === 'alternate' && player.queue_position && (
                <span className={`flex-shrink-0 px-2 py-1 rounded-full text-[11px] font-bold whitespace-nowrap border ${player.queue_position === 1
                  ? 'bg-[#F59E0B]/20 border-[#F59E0B]/50 text-[#F59E0B]'
                  : 'bg-[#F59E0B]/10 border-[#F59E0B]/30 text-[#F59E0B]'
                  }`}>
                  {player.queue_position === 1 ? '#1 Next Up' : `#${player.queue_position}`}
                </span>
              )}
              <ChevronDown className="w-4 h-4 text-[#B0B3B8] rotate-[-90deg]" />
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12">
              <Users className="w-10 h-10 text-[#3A3B3C] mx-auto mb-2" />
              <p className="text-[#B0B3B8]">{search ? 'No Players Found' : 'No Players In This Category'}</p>
            </div>
          )}
        </div>

        {/* ===== PLAYER ACTION SHEET ===== */}
        {selectedPlayer && !chipModal && !moveModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={() => setSelectedPlayer(null)}>
            <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${['alternate', 'bagged'].includes(selectedPlayer.status) ? 'bg-[#F59E0B]/20' : 'bg-[#1877F2]/20'}`}>
                  {selectedPlayer.status === 'bagged'
                    ? <Package className="w-5 h-5 text-[#F59E0B]" />
                    : <Users className={`w-5 h-5 ${selectedPlayer.status === 'alternate' ? 'text-[#F59E0B]' : 'text-[#1877F2]'}`} />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-white truncate">{selectedPlayer.player_name}</h3>
                    {selectedPlayer.status === 'alternate' && selectedPlayer.queue_position && (
                      <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-[#F59E0B]/20 border border-[#F59E0B]/50 text-[#F59E0B] text-[11px] font-bold whitespace-nowrap">
                        {selectedPlayer.queue_position === 1 ? '#1 Next Up' : `#${selectedPlayer.queue_position}`}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#B0B3B8]">
                    {selectedPlayer.status === 'alternate'
                      ? selectedPlayer.queue_position
                        ? `Alternate, Position ${selectedPlayer.queue_position} In Line`
                        : 'Alternate, Waiting For Seat'
                      : selectedPlayer.status === 'bagged'
                        ? 'Bagged, No Seat Until The Day Resumes'
                        : selectedPlayer.table_number
                          ? `Table ${selectedPlayer.table_number} Seat ${selectedPlayer.seat_number}`
                          : 'No Seat Assigned'}
                    {selectedPlayer.current_chips > 0 && ` - ${formatChips(selectedPlayer.current_chips)}`}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {selectedPlayer.status === 'active' && (
                  <>
                    <ActionBtn icon={ArrowRightLeft} label="Move Player" color="#1877F2"
                      onClick={() => openMovePlayer(selectedPlayer)} />
                    <ActionBtn icon={UserPlus} label="Assign Exact Seat" color="#1877F2"
                      onClick={() => openAssignSeat(selectedPlayer)} />
                    <ActionBtn icon={Coins} label="Update Chips" color="#F59E0B"
                      onClick={() => { setChipModal(selectedPlayer); setChipValue(String(selectedPlayer.current_chips || '')); }} />
                    <ActionBtn icon={RotateCcw} label="Rebuy" color="#31A24C"
                      loading={actionLoading === 'rebuy'}
                      onClick={() => handleRebuy(selectedPlayer)} />
                    <ActionBtn icon={Star} label="Add-On" color="#B0B3B8"
                      loading={actionLoading === 'addon'}
                      onClick={() => handleAddon(selectedPlayer)} />
                    <ActionBtn icon={UserX} label="Eliminate" color="#EF4444" danger
                      loading={actionLoading === 'eliminate'}
                      onClick={() => handleEliminate(selectedPlayer)} />
                  </>
                )}
                {selectedPlayer.status === 'eliminated' && (
                  <>
                    <ActionBtn icon={Undo2} label="Undo Elimination" color="#F59E0B"
                      loading={actionLoading === 'restore'}
                      onClick={() => performRestore(selectedPlayer)} />
                    <ActionBtn icon={RotateCcw} label="Re-Entry" color="#31A24C"
                      onClick={() => navigateTo(`/register?reentry=${selectedPlayer.entry_id}`)} />
                  </>
                )}
                {/* Registered but unseated. The bulk seat draw and the late-reg
                    auto-claim both pick the chair at random, so this is the only
                    way the floor can put a named player in a named seat
                    (accessibility, a feature table, or fixing a manual mistake). */}
                {selectedPlayer.status === 'registered' && (
                  <ActionBtn icon={UserPlus} label="Assign Seat" color="#31A24C"
                    loading={actionLoading === 'move'}
                    onClick={() => openAssignSeat(selectedPlayer)} />
                )}
                {selectedPlayer.status === 'alternate' && (
                  <ActionBtn icon={UserPlus} label="Seat Alternate" color="#31A24C"
                    loading={actionLoading === 'promote'}
                    onClick={() => performPromote(selectedPlayer)} />
                )}
                {/* Bagged (multi-day). The whole field is normally brought back
                    by Start Day on the Control Center, which redraws seats and
                    restores every bagged stack in one action. These two cover
                    the exceptions: a late arrival who needs a specific chair,
                    and a player who forfeits without returning. */}
                {selectedPlayer.status === 'bagged' && (
                  <>
                    <ActionBtn icon={UserPlus} label="Assign Exact Seat" color="#31A24C"
                      loading={actionLoading === 'move'}
                      onClick={() => openAssignSeat(selectedPlayer)} />
                    <ActionBtn icon={Coins} label="Correct Bagged Chips" color="#F59E0B"
                      onClick={() => { setChipModal(selectedPlayer); setChipValue(String(selectedPlayer.current_chips || '')); }} />
                    <ActionBtn icon={UserX} label="Eliminate" color="#EF4444" danger
                      loading={actionLoading === 'eliminate'}
                      onClick={() => handleEliminate(selectedPlayer)} />
                  </>
                )}
              </div>

              <button onClick={() => setSelectedPlayer(null)}
                className="w-full mt-3 py-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-base font-medium active:bg-[#4A4B4C]">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ===== CHIP UPDATE MODAL ===== */}
        {chipModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={() => setChipModal(null)}>
            <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white mb-1">Update Chip Count</h3>
              <p className="text-sm text-[#B0B3B8] mb-4">{chipModal.player_name}</p>
              <input
                type="number"
                value={chipValue}
                onChange={e => setChipValue(e.target.value)}
                placeholder="Enter Chip Count"
                className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl px-4 py-3 text-white text-2xl font-mono text-center focus:outline-none focus:border-[#1877F2] mb-4"
                autoFocus
              />
              <div className="flex gap-2 flex-wrap mb-4">
                {[1000, 5000, 10000, 25000, 50000, 100000].map(v => (
                  <button key={v} onClick={() => setChipValue(String(v))}
                    className="px-3 py-2 rounded-lg bg-[#3A3B3C] text-[#B0B3B8] text-sm active:bg-[#4A4B4C]">
                    {formatChips(v)}
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setChipModal(null)}
                  className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] font-medium active:bg-[#4A4B4C]">Cancel</button>
                <button onClick={handleUpdateChips}
                  disabled={!chipValue || actionLoading === 'chips'}
                  className="flex-1 py-3 rounded-xl bg-[#1877F2] text-white font-medium active:bg-[#1565D8] disabled:opacity-50">
                  {actionLoading === 'chips' ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== MOVE PLAYER MODAL ===== */}
        {moveModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={closeMoveModal}>
            <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white mb-1">
                {moveMode === 'assign' ? 'Assign Seat' : 'Move Player'}
              </h3>
              <p className="text-sm text-[#B0B3B8] mb-4">
                {moveModal.player_name}
                {moveModal.table_number
                  ? `, Currently Table ${moveModal.table_number} Seat ${moveModal.seat_number}`
                  : ', No Seat Assigned Yet'}
              </p>
              {/* Quick table buttons */}
              {floor?.tables && (
                <div className="flex gap-2 flex-wrap mb-3">
                  {floor.tables.filter(t => t.available_seats > 0).map(t => (
                    <button key={t.table_number} onClick={() => {
                      setMoveTable(String(t.table_number));
                      setMoveSeat('');
                    }}
                      className={`px-3 py-2 rounded-lg text-sm ${moveTable === String(t.table_number) ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8] active:bg-[#4A4B4C]'
                        }`}>
                      T{t.table_number} ({t.available_seats} Open)
                    </button>
                  ))}
                </div>
              )}
              {/* Visual seat grid */}
              {moveTable && (() => {
                const t = floor?.tables?.find(tbl => tbl.table_number === parseInt(moveTable));
                if (!t) return (
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                      <label className="text-xs text-[#B0B3B8] mb-1 block">Table</label>
                      <input type="number" value={moveTable} onChange={e => setMoveTable(e.target.value)}
                        placeholder="Table #"
                        className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl px-4 py-3 text-white text-lg text-center focus:outline-none focus:border-[#1877F2]" />
                    </div>
                    <div>
                      <label className="text-xs text-[#B0B3B8] mb-1 block">Seat</label>
                      <input type="number" value={moveSeat} onChange={e => setMoveSeat(e.target.value)}
                        placeholder="Seat #"
                        className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl px-4 py-3 text-white text-lg text-center focus:outline-none focus:border-[#1877F2]" />
                    </div>
                  </div>
                );
                const occupied = t.players.map(p => p.seat_number);
                return (
                  <div className="mb-4">
                    <p className="text-xs text-[#B0B3B8] mb-2">Tap An Open Seat On Table {t.table_number}</p>
                    <div className="grid grid-cols-5 gap-2">
                      {Array.from({ length: t.max_seats }, (_, i) => i + 1).map(s => {
                        const isOccupied = occupied.includes(s);
                        const player = t.players.find(p => p.seat_number === s);
                        const isSelected = moveSeat === String(s);
                        return (
                          <button key={s} onClick={() => !isOccupied && setMoveSeat(String(s))}
                            disabled={isOccupied}
                            className={`relative rounded-xl p-2 text-center border-2 transition-all ${isSelected ? 'bg-[#1877F2]/20 border-[#1877F2] text-[#1877F2]' :
                              isOccupied ? 'bg-[#3A3B3C]/40 border-[#3A3B3C] text-[#666] cursor-not-allowed' :
                                'bg-[#31A24C]/10 border-[#31A24C]/40 text-[#31A24C] active:bg-[#31A24C]/20'
                              }`}>
                            <div className="text-lg font-bold">{s}</div>
                            <div className="text-[9px] truncate">
                              {isOccupied ? (player?.player_name?.split(' ')[0] || '●') : 'Open'}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {!moveTable && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="text-xs text-[#B0B3B8] mb-1 block">Table</label>
                    <input type="number" value={moveTable} onChange={e => setMoveTable(e.target.value)}
                      placeholder="Table #"
                      className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl px-4 py-3 text-white text-lg text-center focus:outline-none focus:border-[#1877F2]"
                      autoFocus />
                  </div>
                  <div>
                    <label className="text-xs text-[#B0B3B8] mb-1 block">Seat</label>
                    <input type="number" value={moveSeat} onChange={e => setMoveSeat(e.target.value)}
                      placeholder="Seat #"
                      className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl px-4 py-3 text-white text-lg text-center focus:outline-none focus:border-[#1877F2]" />
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={closeMoveModal}
                  className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] font-medium active:bg-[#4A4B4C]">Cancel</button>
                <button onClick={handleMove}
                  disabled={!moveTable || !moveSeat || actionLoading === 'move'}
                  className="flex-1 py-3 rounded-xl bg-[#1877F2] text-white font-medium active:bg-[#1565D8] disabled:opacity-50">
                  {actionLoading === 'move'
                    ? (moveMode === 'assign' ? 'Seating...' : 'Moving...')
                    : (moveMode === 'assign' ? 'Assign Seat' : 'Move')}
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
                  {confirmAction.type === 'eliminate'
                    ? <UserX className="w-7 h-7" style={{ color: confirmAction.color }} />
                    : confirmAction.type === 'addon'
                      ? <Coins className="w-7 h-7" style={{ color: confirmAction.color }} />
                      : <RotateCcw className="w-7 h-7" style={{ color: confirmAction.color }} />
                  }
                </div>
                <h3 className="text-lg font-bold text-white">{confirmAction.message}</h3>
                <p className="text-sm text-[#B0B3B8] mt-1">{confirmAction.detail}</p>
              </div>
              {confirmAction.type === 'eliminate' && floor?.tournament?.bounty_amount > 0 && (
                <div className="mb-4 text-left">
                  <label className="text-xs text-[#B0B3B8] mb-1 block">Eliminated By, Awards ${floor.tournament.bounty_amount} Bounty</label>
                  <select value={eliminatorId} onChange={e => setEliminatorId(e.target.value)}
                    className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[#1877F2]">
                    <option value="">Unknown, No Bounty Awarded</option>
                    {allPlayers.filter(p => p.status === 'active' && p.entry_id !== confirmAction.player.entry_id).map(p => (
                      <option key={p.entry_id} value={p.entry_id}>{p.player_name}{p.table_number ? ` (T${p.table_number})` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={() => setConfirmAction(null)}
                  className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] font-medium active:bg-[#4A4B4C]">Cancel</button>
                <button onClick={executeConfirmedAction}
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
              const Icon = NAV_ICONS[item.key];
              const isActive = item.key === 'players';
              return (
                <button key={item.key} onClick={() => navigateTo(item.path)}
                  className={`flex flex-col items-center justify-center gap-0.5 w-16 h-14 rounded-lg ${isActive ? 'text-[#1877F2]' : 'text-[#B0B3B8] active:text-[#E4E6EB]'
                    }`}>
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium capitalize">{item.key}</span>
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

function ActionBtn({ icon: Icon, label, color, danger, onClick, loading }) {
  return (
    <button onClick={onClick} disabled={loading}
      className={`w-full flex items-center gap-3 px-4 py-4 rounded-xl active:scale-[0.98] transition-transform disabled:opacity-50 ${danger ? 'bg-[#EF4444]/10 border border-[#EF4444]/30' : 'bg-[#3A3B3C]/50 border border-[#3A3B3C]'
        }`}>
      {loading
        ? <Loader2 className="w-5 h-5 animate-spin" style={{ color }} />
        : <Icon className="w-5 h-5" style={{ color }} />
      }
      <span className="text-base font-medium text-[#E4E6EB]">{label}</span>
    </button>
  );
}
