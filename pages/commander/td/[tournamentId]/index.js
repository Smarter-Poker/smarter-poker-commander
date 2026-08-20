/**
 * Tournament Director - Control Center
 * /commander/td/[tournamentId]
 * Main command screen for the TD holding a tablet on the floor
 * Shows: tournament header, stats, alerts, activity feed
 * Bottom nav bar links to Tables, Players, Clock screens
 * UI: Dark theme, SmarterPoker colors, Inter font, 44px+ touch targets
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import CommanderLayout from '../../../../src/components/commander/shared/CommanderLayout';
import useTournamentRealtime from '../../../../src/hooks/useTournamentRealtime';
import { broadcastChange } from '../../../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../../../src/engine/EventBus';
import {
  Trophy, Users, DollarSign,
  AlertTriangle, ChevronRight, RefreshCw, Loader2,
  LayoutGrid, UserPlus, Monitor,
  Star, Volume2, X, FileText, Coins, Layers
} from 'lucide-react';
import { commanderFetch } from '../../../../src/lib/commander/commanderFetch';

const STATUS_CONFIG = {
  scheduled: { bg: 'bg-[#B0B3B8]/10', text: 'text-[#B0B3B8]', border: 'border-[#B0B3B8]/30', label: 'Scheduled' },
  registration: { bg: 'bg-[#1877F2]/10', text: 'text-[#1877F2]', border: 'border-[#1877F2]/30', label: 'Registration' },
  running: { bg: 'bg-[#31A24C]/10', text: 'text-[#31A24C]', border: 'border-[#31A24C]/30', label: 'Running' },
  paused: { bg: 'bg-[#F59E0B]/10', text: 'text-[#F59E0B]', border: 'border-[#F59E0B]/30', label: 'Paused' },
  break: { bg: 'bg-[#F59E0B]/10', text: 'text-[#F59E0B]', border: 'border-[#F59E0B]/30', label: 'On Break' },
  final_table: { bg: 'bg-[#1877F2]/10', text: 'text-[#1877F2]', border: 'border-[#1877F2]/30', label: 'Final Table' },
  hand_for_hand: { bg: 'bg-[#EF4444]/10', text: 'text-[#EF4444]', border: 'border-[#EF4444]/30', label: 'Hand For Hand' },
  completed: { bg: 'bg-[#B0B3B8]/10', text: 'text-[#B0B3B8]', border: 'border-[#B0B3B8]/30', label: 'Completed' },
  cancelled: { bg: 'bg-[#EF4444]/10', text: 'text-[#EF4444]', border: 'border-[#EF4444]/30', label: 'Cancelled' }
};

const NAV_ITEMS = [
  { key: 'control', icon: Trophy, label: 'Control' },
  { key: 'tables', icon: LayoutGrid, label: 'Tables' },
  { key: 'players', icon: Users, label: 'Players' },
  { key: 'payouts', icon: DollarSign, label: 'Payouts' },
  { key: 'reports', icon: FileText, label: 'Reports' },
  { key: 'clock', icon: Monitor, label: 'Clock' },
];

function formatChips(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
  return n.toLocaleString();
}

function formatMoney(n) {
  if (!n) return '$0';
  return '$' + n.toLocaleString();
}

export default function TDControlCenter() {

  useEffect(() => { busEmit.sessionStart('commander-td-tournamentId-index'); }, []);
  const router = useRouter();
  const { tournamentId } = router.query;
  const [floor, setFloor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [messageModal, setMessageModal] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);

  // ── Table assignment state ──
  // floor-view derives its tables[] from SEATED ENTRIES, so a table that is
  // assigned but still empty is invisible to it. Auto-break and the seat draw
  // both read commander_tables, so the setup check has to read that directly.
  const [tableSetup, setTableSetup] = useState(null);
  const [assignModal, setAssignModal] = useState(false);
  const [assignCount, setAssignCount] = useState('4');
  const [assigning, setAssigning] = useState(false);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const pollRef = useRef(null);

  const fetchFloor = useCallback(async (signal) => {
    if (!tournamentId) return;
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/floor-view`, { ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setFloor(json.data);
        setError(null);
      } else {
        setError(json.error);
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError('Failed To Load Tournament Data');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  const fetchTables = useCallback(async (signal) => {
    if (!tournamentId) return;
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/tables`, { ...(signal ? { signal } : {}) });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setTableSetup(json.data);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('Table setup check failed:', err);
    }
  }, [tournamentId]);

  // Initial load + Realtime subscription + 5-min fallback poll
  useTournamentRealtime(tournamentId, fetchFloor);
  useEffect(() => {
    const _c = new AbortController();
    fetchFloor(_c.signal);
    fetchTables(_c.signal);
    pollRef.current = setInterval(() => fetchFloor(_c.signal), 300000); // 5-min fallback (realtime handles instant updates)
    return () => {
      _c.abort();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchFloor, fetchTables]);

  const handleAssignTables = async () => {
    const count = parseInt(assignCount, 10);
    if (!Number.isInteger(count) || count < 1) {
      setToast({ type: 'error', text: 'Enter How Many Tables To Assign.' });
      return;
    }
    setAssigning(true);
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/tables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setToast({ type: 'error', text: json?.error?.message || 'Tables Could Not Be Assigned.' });
        return;
      }
      setToast({ type: 'success', text: json.data?.message || 'Tables Assigned.' });
      setAssignModal(false);
      await fetchTables();
      await fetchFloor();
      broadcastChange('tables');
    } catch (err) {
      console.warn('Assign tables failed:', err);
      setToast({ type: 'error', text: 'Tables Could Not Be Assigned.' });
    } finally {
      setAssigning(false);
    }
  };

  // Memoize sorted activity entries (prevents re-sorting 5000 entries on every render)
  const sortedActivityEntries = useMemo(() => {
    if (!floor?.entries?.length) return [];
    return [...floor.entries]
      .sort((a, b) => {
        const aTime = a.eliminated_at || a.registered_at || '1970';
        const bTime = b.eliminated_at || b.registered_at || '1970';
        return new Date(bTime) - new Date(aTime);
      })
      .slice(0, 50);
  }, [floor?.entries]);

  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    setSendingMessage(true);
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, type: 'announcement', duration_seconds: 60 })
      });
      if (!res.ok) throw new Error('Request failed');
      setMessageText('');
      setMessageModal(false);
    } catch (err) {
      console.warn('Send message failed:', err);
      setError('Failed To Send Tournament Message. Please Try Again.');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleHandForHand = async () => {
    const isActive = floor?.alerts?.hand_for_hand;
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/hand-for-hand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !isActive })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (!json.success) setToast({ type: 'error', text: json.error || 'Failed To Toggle Hand-For-Hand.' });
      await fetchFloor();
      broadcastChange('tournaments');
    } catch (err) {
      console.warn('H4H toggle failed:', err);
      setError('Hand-For-Hand Toggle Failed.');
    }
  };

  const navigateTo = (screen) => {
    if (screen === 'control') return;
    router.push(`/commander/td/${tournamentId}/${screen}`);
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
          <button onClick={() => router.push('/commander/tournaments')}
            className="px-6 py-3 bg-[#1877F2] text-white rounded-lg text-base font-medium">
            Back To Tournaments
          </button>
        </div>
      </div>
    );
  }

  const { tournament, clock, stats, alerts, tables, alternates } = floor;
  const chipLeader = (stats.player_stacks || []).reduce((top, p) => (!top || p.chips > top.chips) ? p : top, null);
  const statusConf = STATUS_CONFIG[tournament.status] || STATUS_CONFIG.scheduled;

  return (
    <CommanderLayout title="Commander - Control Center" backHref="/commander/tournament-controls">
      <SEOHead
        title="Commander - Control Center"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />

      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] pb-20 font-['Inter']">

        {/* ===== TOURNAMENT HEADER ===== */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-white truncate">{tournament.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusConf.bg} ${statusConf.text}`}>
                  {statusConf.label}
                </span>
                {alerts.hand_for_hand && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-[#EF4444]/10 text-[#EF4444]">
                    H4H
                  </span>
                )}
                {alerts.on_break && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-[#F59E0B]/10 text-[#F59E0B]">
                    Break
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {/* 2026-08-04 audit fix: the announcement modal and H4H handler existed
                  but nothing opened/invoked them - surface both controls here */}
              <button onClick={handleHandForHand} title="Toggle Hand-For-Hand"
                className={`p-2 rounded-lg hover:bg-[#3A3B3C] active:bg-[#4A4B4C] ${alerts.hand_for_hand ? 'bg-[#EF4444]/10' : ''}`}>
                <AlertTriangle className={`w-5 h-5 ${alerts.hand_for_hand ? 'text-[#EF4444]' : 'text-[#B0B3B8]'}`} />
              </button>
              <button onClick={() => setMessageModal(true)} title="Broadcast Announcement"
                className="p-2 rounded-lg hover:bg-[#3A3B3C] active:bg-[#4A4B4C]">
                <Volume2 className="w-5 h-5 text-[#B0B3B8]" />
              </button>
              <button onClick={fetchFloor} className="p-2 rounded-lg hover:bg-[#3A3B3C] active:bg-[#4A4B4C]">
                <RefreshCw className="w-5 h-5 text-[#B0B3B8]" />
              </button>
            </div>
          </div>
        </div>

        {/* ===== TABLE SETUP BANNER =====
            Fewer than two commander_tables rows carrying this tournament_id
            means tournamentAutoBreak.js returns null on every call and the
            seat draw has to invent table numbers. Neither failure surfaces
            anywhere, so the room can run all night without a table ever
            breaking. Say so, and fix it in one tap. */}
        {tableSetup && tableSetup.assigned_count < 2 && (
          <div className="px-4 pt-3">
            <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <LayoutGrid className="w-5 h-5 text-[#F59E0B] flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[#F59E0B] text-sm font-bold">
                    {tableSetup.assigned_count === 0 ? 'No Tables Assigned' : 'Only One Table Assigned'}
                  </p>
                  <p className="text-[#B0B3B8] text-xs mt-1">
                    Assign Tables To Enable The Seat Draw And Automatic Table Breaking.
                    {tableSetup.available_count > 0
                      ? ` ${tableSetup.available_count} Table${tableSetup.available_count === 1 ? '' : 's'} Free Right Now.`
                      : ' No Free Tables In The Room Right Now.'}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    const suggested = tournament.max_entries
                      ? Math.max(2, Math.ceil(Number(tournament.max_entries) / 9))
                      : 4;
                    setAssignCount(String(Math.max(2, suggested - (tableSetup.assigned_count || 0))));
                    setAssignModal(true);
                  }}
                  className="flex-1 h-11 rounded-xl bg-[#F59E0B] text-black text-sm font-bold active:opacity-90"
                >
                  Assign Tables
                </button>
                <button
                  onClick={() => router.push('/commander/table-assignments')}
                  className="flex-1 h-11 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-bold active:bg-[#4A4B4C]"
                >
                  Table Assignments
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== ALERT BANNER ===== */}
        {(alerts.seat_conflicts?.length > 0 || alerts.imbalanced || alerts.can_break_table || stats.late_reg_open) && (
          <div className="px-4 py-2 space-y-2">
            {/* Seat conflicts outrank every other alert: two players are sitting
                in one chair right now and the floor has to move one of them. */}
            {alerts.seat_conflicts?.length > 0 && (
              <button onClick={() => navigateTo('tables')}
                className="w-full flex items-start gap-3 px-4 py-3 bg-[#EF4444]/15 border-2 border-[#EF4444]/50 rounded-xl active:bg-[#EF4444]/25">
                <AlertTriangle className="w-5 h-5 text-[#EF4444] flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 text-left">
                  {alerts.seat_conflicts.slice(0, 3).map((c, i) => (
                    <span key={`${c.table_number}-${c.seat_number}-${i}`} className="block text-[#EF4444] text-sm font-bold">
                      Seat Conflict: Table {c.table_number} Seat {c.seat_number} Has {c.players?.length || 2} Players
                    </span>
                  ))}
                  {alerts.seat_conflicts.length > 3 && (
                    <span className="block text-[#EF4444] text-xs font-medium mt-0.5">
                      And {alerts.seat_conflicts.length - 3} More
                    </span>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-[#EF4444] flex-shrink-0 mt-0.5" />
              </button>
            )}
            {alerts.imbalanced && (
              <button onClick={() => navigateTo('tables')}
                className="w-full flex items-center gap-3 px-4 py-3 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl">
                <AlertTriangle className="w-5 h-5 text-[#EF4444] flex-shrink-0" />
                <span className="text-[#EF4444] text-sm font-medium flex-1 text-left">Tables Are Imbalanced</span>
                <ChevronRight className="w-4 h-4 text-[#EF4444]" />
              </button>
            )}
            {alerts.can_break_table && (
              <button onClick={() => navigateTo('tables')}
                className="w-full flex items-center gap-3 px-4 py-3 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl">
                <LayoutGrid className="w-5 h-5 text-[#F59E0B] flex-shrink-0" />
                <span className="text-[#F59E0B] text-sm font-medium flex-1 text-left">A Table Can Be Broken</span>
                <ChevronRight className="w-4 h-4 text-[#F59E0B]" />
              </button>
            )}
            {stats.late_reg_open && (
              <div className="flex items-center gap-3 px-4 py-3 bg-[#1877F2]/10 border border-[#1877F2]/30 rounded-xl">
                <UserPlus className="w-5 h-5 text-[#1877F2] flex-shrink-0" />
                <span className="text-[#1877F2] text-sm font-medium">
                  Late Registration Open, {stats.levels_until_late_reg_closes} Level{stats.levels_until_late_reg_closes !== 1 ? 's' : ''} Remaining
                </span>
              </div>
            )}
          </div>
        )}

        {/* ===== ALTERNATES WAITING ===== */}
        {stats.players_alternate > 0 && (
          <div className="px-4 py-2">
            <button onClick={() => router.push(`/commander/td/${tournamentId}/players?tab=alternate`)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl active:bg-[#F59E0B]/20">
              <UserPlus className="w-5 h-5 text-[#F59E0B] flex-shrink-0" />
              <div className="flex-1 min-w-0 text-left">
                <span className="block text-[#F59E0B] text-sm font-medium">
                  {stats.players_alternate} Alternate{stats.players_alternate !== 1 ? 's' : ''} Waiting
                </span>
                {alternates?.[0] && (
                  <span className="block text-[#B0B3B8] text-xs truncate">
                    Next Up: {alternates[0].player_name}
                  </span>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-[#F59E0B] flex-shrink-0" />
            </button>
          </div>
        )}

        {/* ===== CLOCK DISPLAY LINK ===== */}
        <div className="px-4 py-3">
          <button onClick={() => navigateTo('clock')}
            className="w-full bg-[#1877F2] rounded-xl p-4 flex items-center justify-between active:scale-[0.98] transition-transform shadow-lg">
            <div className="flex flex-col items-start gap-1">
              <span className="text-white font-bold text-lg">Tournament Clock</span>
              <span className="text-white/80 text-xs">Tap To Open Fullscreen Mirror Display</span>
            </div>
            <Monitor className="w-8 h-8 text-white opacity-90" />
          </button>
        </div>

        {/* ===== ADD PLAYER / REGISTER ===== */}
        <div className="px-4 pb-1">
          <button onClick={() => navigateTo('register')}
            className="w-full bg-[#242526] border border-[#3A3B3C] rounded-xl p-4 flex items-center justify-between active:bg-[#3A3B3C] transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#1877F2]/20 flex items-center justify-center">
                <UserPlus className="w-5 h-5 text-[#1877F2]" />
              </div>
              <div className="flex flex-col items-start">
                <span className="text-white font-semibold text-base">Add Player</span>
                <span className="text-[#B0B3B8] text-xs">Register An Entrant Or Re-Entry</span>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        {/* ===== BREAK TOOLS: CHIP COUNTS + COLOR UP =====
            Deliberately buttons and not bottom-nav items. The nav already
            carries six entries and a seventh shrinks every target below the
            44px minimum at 375px. */}
        <div className="px-4 pt-2 grid grid-cols-2 gap-2">
          <button onClick={() => navigateTo('chips')}
            className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4 flex flex-col items-start gap-2 active:bg-[#3A3B3C] transition-colors">
            <div className="w-10 h-10 rounded-full bg-[#F59E0B]/20 flex items-center justify-center">
              <Coins className="w-5 h-5 text-[#F59E0B]" />
            </div>
            <span className="text-white font-semibold text-sm">Chip Counts</span>
            <span className="text-[#B0B3B8] text-xs text-left">Enter Stacks At The Break</span>
          </button>
          <button onClick={() => navigateTo('color-up')}
            className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4 flex flex-col items-start gap-2 active:bg-[#3A3B3C] transition-colors">
            <div className="w-10 h-10 rounded-full bg-[#1877F2]/20 flex items-center justify-center">
              <Layers className="w-5 h-5 text-[#1877F2]" />
            </div>
            <span className="text-white font-semibold text-sm">Color Up</span>
            <span className="text-[#B0B3B8] text-xs text-left">Race Off A Denomination</span>
          </button>
        </div>

        {/* ===== STATS GRID ===== */}
        <div className="px-4 py-2">
          <div className="grid grid-cols-3 gap-2">
            <StatCard icon={Users} label="Remaining" value={stats.players_remaining} color="#31A24C" />
            <StatCard icon={Trophy} label="Entries" value={stats.total_entries} color="#1877F2" />
            <StatCard icon={DollarSign} label="Prize Pool" value={formatMoney(stats.prize_pool)} color="#F59E0B" />
            <StatCard icon={RefreshCw} label="Rebuys" value={stats.total_rebuys} color="#B0B3B8" />
            <StatCard icon={Star} label="Add-Ons" value={stats.total_addons} color="#B0B3B8" />
            <StatCard icon={DollarSign} label="Avg Stack" value={formatChips(stats.average_stack)} color="#B0B3B8" />
          </div>
        </div>

        {/* ===== CHIP LEADER & PAYOUTS ===== */}
        {(chipLeader || tournament.paying_places || tournament.actual_prizepool) && (
          <div className="px-4 py-2 grid grid-cols-2 gap-2">
            <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-3">
              <div className="flex items-center gap-1 mb-1">
                <Trophy className="w-3.5 h-3.5" style={{ color: '#F59E0B' }} />
                <span className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Chip Leader</span>
              </div>
              <p className="text-sm font-bold text-white truncate">{chipLeader ? chipLeader.name : '--'}</p>
              <p className="text-xs text-[#31A24C] font-medium">{chipLeader ? `${formatChips(chipLeader.chips)} chips` : ''}</p>
            </div>
            <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-3">
              <div className="flex items-center gap-1 mb-1">
                <DollarSign className="w-3.5 h-3.5" style={{ color: '#31A24C' }} />
                <span className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Prize Pool / Paying</span>
              </div>
              <p className="text-sm font-bold text-white truncate">{formatMoney(tournament.actual_prizepool || stats.prize_pool)}</p>
              <p className="text-xs text-[#B0B3B8] font-medium">{tournament.paying_places ? `${tournament.paying_places} Places Paid` : 'Places TBD'}</p>
              {stats.overlay_amount > 0 && (
                <p className="text-xs text-[#EF4444] font-medium">Overlay {formatMoney(stats.overlay_amount)}</p>
              )}
            </div>
          </div>
        )}

        {/* ===== TABLES OVERVIEW (compact) ===== */}
        <div className="px-4 py-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider">
              Tables ({stats.tables_active})
            </h2>
            <button onClick={() => navigateTo('tables')}
              className="text-xs text-[#1877F2] font-medium flex items-center gap-1">
              View All <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {tables.map(table => (
              <button key={table.table_number}
                onClick={() => navigateTo('tables')}
                className={`flex-shrink-0 w-20 h-20 rounded-xl border flex flex-col items-center justify-center ${table.color === 'red' ? 'bg-[#EF4444]/10 border-[#EF4444]/30' :
                  table.color === 'yellow' ? 'bg-[#F59E0B]/10 border-[#F59E0B]/30' :
                    table.color === 'blue' ? 'bg-[#1877F2]/10 border-[#1877F2]/30' :
                      'bg-[#242526] border-[#3A3B3C]'
                  }`}
              >
                <span className="text-xs text-[#B0B3B8]">Table</span>
                <span className="text-lg font-bold text-white">{table.table_number}</span>
                <span className={`text-xs font-medium ${table.color === 'red' ? 'text-[#EF4444]' :
                  table.color === 'yellow' ? 'text-[#F59E0B]' :
                    'text-[#B0B3B8]'
                  }`}>
                  {table.player_count}/{table.max_seats}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ===== RECENT ELIMINATIONS ===== */}
        {floor.eliminated && floor.eliminated.length > 0 && (
          <div className="px-4 py-2">
            <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">
              Recent Eliminations
            </h2>
            <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] divide-y divide-[#3A3B3C]">
              {floor.eliminated.slice(0, 5).map((e, i) => (
                <div key={e.entry_id} className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[#B0B3B8] w-6 text-right">
                      {e.finish_position ? `#${e.finish_position}` : '--'}
                    </span>
                    <span className="text-sm text-[#E4E6EB]">{e.player_name}</span>
                  </div>
                  {e.payout_amount > 0 && (
                    <span className="text-sm font-medium text-[#31A24C]">
                      {formatMoney(e.payout_amount)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== FLOATING ACTIVITY BUTTON & SHEET ===== */}
        <div className="fixed bottom-20 left-0 right-0 px-4 z-40 flex justify-center pointer-events-none">
          <button
            onClick={() => setShowActivityLog(true)}
            className="pointer-events-auto bg-[#3A3B3C] border border-[#4A4B4C] rounded-full px-6 py-3 shadow-lg flex items-center gap-2 active:scale-95 transition-transform"
          >
            <RefreshCw className="w-4 h-4 text-[#E4E6EB]" />
            <span className="text-sm font-bold text-white tracking-widest uppercase">Activity Log</span>
          </button>
        </div>

        {showActivityLog && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={() => setShowActivityLog(false)}>
            <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg max-h-[70vh] flex flex-col pointer-events-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#3A3B3C]">
                <h3 className="text-lg font-bold text-white">Activity Log</h3>
                <button onClick={() => setShowActivityLog(false)} className="w-10 h-10 rounded-full bg-[#3A3B3C] flex items-center justify-center">
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>
              <div className="overflow-y-auto px-2 py-2">
                {floor.entries && floor.entries.length > 0 ? (
                  <div className="divide-y divide-[#3A3B3C]">
                    {sortedActivityEntries.map((e, i) => {
                      const isEliminated = e.status === 'eliminated';
                      const isAlternate = e.status === 'alternate';
                      const isActive = ['active', 'seated'].includes(e.status);
                      const time = e.eliminated_at || e.registered_at;
                      const timeStr = time ? new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

                      return (
                        <div key={e.entry_id + '-' + i} className="px-4 py-3 flex items-center gap-3">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isEliminated ? 'bg-[#EF4444]' :
                            isAlternate ? 'bg-[#F59E0B]' :
                              isActive ? 'bg-[#31A24C]' : 'bg-[#1877F2]'
                            }`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[#E4E6EB] truncate">{e.player_name}</p>
                            <p className="text-xs text-[#B0B3B8] mt-0.5">
                              {isEliminated ? `Eliminated #${e.finish_position || '?'}` :
                                isAlternate ? 'Added To Alternates' :
                                  isActive ? `Seated T${e.table_number || '?'}-S${e.seat_number || '?'}` :
                                    'Registered'}
                              {e.rebuy_count > 0 ? ` • ${e.rebuy_count}R` : ''}
                              {e.addon_taken ? ' • Add-on' : ''}
                            </p>
                          </div>
                          <span className="text-xs text-[#B0B3B8] flex-shrink-0">{timeStr}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-8 text-center text-[#B0B3B8]">No Activity Yet</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===== ASSIGN TABLES MODAL ===== */}
        {assignModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center p-4"
            onClick={() => !assigning && setAssignModal(false)}>
            <div className="bg-[#242526] rounded-2xl w-full max-w-lg p-5 space-y-4"
              onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white">Assign Tables</h3>
              <p className="text-[#B0B3B8] text-sm">
                Reserves Free Tables In Table Number Order For This Tournament.
                A Table Running A Cash Game Or Another Tournament Is Never Taken.
              </p>
              <div>
                <label className="block text-xs font-bold text-[#B0B3B8] uppercase tracking-wider mb-2">
                  How Many Tables
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={assignCount}
                  onChange={e => setAssignCount(e.target.value)}
                  className="w-full h-12 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl px-4 text-[#E4E6EB] text-base focus:outline-none focus:border-[#1877F2]"
                />
                <p className="text-[#B0B3B8] text-xs mt-2">
                  Currently Assigned: {tableSetup?.assigned_count || 0}. Free In The Room: {tableSetup?.available_count || 0}.
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setAssignModal(false)} disabled={assigning}
                  className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-base font-medium active:bg-[#4A4B4C] disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleAssignTables} disabled={assigning}
                  className="flex-1 py-3 rounded-xl bg-[#F59E0B] text-black text-base font-bold active:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                  {assigning ? <Loader2 className="w-4 h-4 animate-spin" /> : <LayoutGrid className="w-4 h-4" />}
                  Assign
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== BROADCAST MESSAGE MODAL ===== */}
        {messageModal && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center p-4"
            onClick={() => setMessageModal(false)}>
            <div className="bg-[#242526] rounded-2xl w-full max-w-lg p-5 space-y-4"
              onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white">Broadcast Announcement</h3>
              <textarea
                value={messageText}
                onChange={e => setMessageText(e.target.value)}
                placeholder="Enter Message For Clock Displays..."
                rows={3}
                className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl px-4 py-3 text-[#E4E6EB] text-base placeholder-[#B0B3B8]/50 focus:outline-none focus:border-[#1877F2] resize-none"
                autoFocus
              />
              <div className="flex gap-2 flex-wrap">
                {['Color Up', 'Break Time', 'Registration Closing', 'Final Table', 'Dealers Stand'].map(q => (
                  <button key={q} onClick={() => setMessageText(q)}
                    className="px-3 py-2 rounded-lg bg-[#3A3B3C] text-[#B0B3B8] text-xs active:bg-[#4A4B4C]">
                    {q}
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setMessageModal(false)}
                  className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-base font-medium active:bg-[#4A4B4C]">
                  Cancel
                </button>
                <button onClick={handleSendMessage}
                  disabled={!messageText.trim() || sendingMessage}
                  className="flex-1 py-3 rounded-xl bg-[#1877F2] text-white text-base font-medium active:bg-[#1565D8] disabled:opacity-50 flex items-center justify-center gap-2">
                  {sendingMessage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                  Broadcast
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== BOTTOM NAV BAR ===== */}
        <nav className="fixed bottom-0 left-0 right-0 bg-[#242526] border-t border-[#3A3B3C] z-40">
          <div className="flex items-center justify-around h-16 max-w-2xl mx-auto">
            {NAV_ITEMS.map(item => {
              const Icon = item.icon;
              const isActive = item.key === 'control';
              return (
                <button
                  key={item.key}
                  onClick={() => navigateTo(item.key)}
                  className={`flex flex-col items-center justify-center gap-0.5 w-16 h-14 rounded-lg ${isActive ? 'text-[#1877F2]' : 'text-[#B0B3B8] active:text-[#E4E6EB]'
                    }`}
                >
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
    </CommanderLayout>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-3 flex flex-col items-center">
      <Icon className="w-4 h-4 mb-1" style={{ color }} />
      <span className="text-lg font-bold text-white">{value}</span>
      <span className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">{label}</span>
    </div>
  );
}
