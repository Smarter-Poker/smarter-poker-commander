/**
 * Tournament Director - Clock & Broadcast
 * /commander/td/[tournamentId]/clock
 * Large countdown display optimized for TV casting via HDMI/Airplay
 * Full clock controls, break management, H4H, final table mode
 * Can open in fullscreen for projector display
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import CommanderLayout from '../../../../src/components/commander/shared/CommanderLayout';
import useTournamentRealtime from '../../../../src/hooks/useTournamentRealtime';
import { broadcastChange } from '../../../../src/lib/commander/useCommanderSync';
import { Trophy, LayoutGrid, Users, Monitor, Play, Pause, SkipForward, SkipBack, Loader2, RefreshCw, Maximize, Minimize, Coffee, Hand, Star, Volume2, Plus, Minus, DollarSign, FileText, Square, Timer, UserPlus, Coins, Megaphone } from 'lucide-react';
import { busEmit } from '../../../../src/engine/EventBus';
import { commanderFetch } from '../../../../src/lib/commander/commanderFetch';
import { printSeatChangeCards } from '../../../../src/lib/commander/receiptTemplates';

const NAV_ITEMS = [
  { key: 'control', path: '' }, { key: 'tables', path: '/tables' },
  { key: 'players', path: '/players' }, { key: 'payouts', path: '/payouts' },
  { key: 'reports', path: '/reports' }, { key: 'clock', path: '/clock' },
];
const NAV_ICONS = { control: Trophy, tables: LayoutGrid, players: Users, payouts: DollarSign, reports: FileText, clock: Monitor };

function formatClock(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return '--:--';
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}:${String(rem).padStart(2, '0')}`;
}

// ── Floor announcements ────────────────────────────────────────────────────
// One tap = the banner on every clock display (message.js writes
// settings.clock_state.current_message) AND the matching push to every
// registered player (notify.js). The two used to be separate screens and the
// push side had no caller at all, so nobody outside the room ever heard a
// break call.
const FLOOR_ANNOUNCEMENTS = [
  {
    key: 'break', label: 'Break Time', icon: Coffee, color: '#F59E0B',
    message: 'Break Time', messageType: 'announcement', durationSeconds: 300,
    notifyType: 'break'
  },
  {
    key: 'break_ending', label: 'Break Ending, Two Minutes', icon: Timer, color: '#F59E0B',
    message: 'Break Ending, Two Minutes', messageType: 'alert', durationSeconds: 120,
    notifyType: 'break_ending'
  },
  {
    key: 'registration_closing', label: 'Registration Closing', icon: UserPlus, color: '#EF4444',
    message: 'Registration Closing', messageType: 'alert', durationSeconds: 300,
    notifyType: 'custom',
    notifyMessage: 'Registration Is Closing. This Is The Last Call To Enter Or Re-Enter.'
  },
  {
    key: 'final_table', label: 'Final Table', icon: Star, color: '#1877F2',
    message: 'Final Table', messageType: 'announcement', durationSeconds: 300,
    notifyType: 'final_table'
  },
  {
    key: 'color_up', label: 'Color Up', icon: Coins, color: '#31A24C',
    message: 'Color Up', messageType: 'announcement', durationSeconds: 300,
    notifyType: 'custom',
    notifyMessage: 'Color Up In Progress. Please Stack Your Chips For The Race.'
  }
];

// Approximate wall-clock time late registration closes: remaining seconds of
// the current level plus the full duration of every structure row (breaks
// included, since they delay it) up to and including the late-reg cutoff index.
function lateRegCloseDate(blindStructure, currentLevelIdx, remainingSeconds, lateRegLevels) {
  if (!Array.isArray(blindStructure) || blindStructure.length === 0) return null;
  const cutoff = Math.min(Number(lateRegLevels) || 0, blindStructure.length - 1);
  const idx = Number(currentLevelIdx) || 0;
  if (idx > cutoff) return null;
  let secs = Math.max(0, Number(remainingSeconds) || 0);
  for (let i = idx + 1; i <= cutoff; i++) {
    const row = blindStructure[i];
    secs += ((row?.duration ?? row?.duration_minutes ?? 0) * 60);
  }
  return new Date(Date.now() + secs * 1000);
}

export default function TDClock() {

  useEffect(() => { busEmit.sessionStart('commander-td-tournamentId-clock'); }, []);
  const router = useRouter();
  const { tournamentId } = router.query;
  const [floor, setFloor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clockSeconds, setClockSeconds] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [showMessage, setShowMessage] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  // Key of the floor announcement currently being sent (banner + push).
  const [announcing, setAnnouncing] = useState(null);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const timerRef = useRef(null);
  const containerRef = useRef(null);

  const fetchFloor = useCallback(async (signal) => {

  if (!router.isReady) return null;

    if (!tournamentId) return;
    try {
      // Payload split: the TD clock draws the header, the clock, the counts
      // and the break/H4H flags. No entry list, no table map, no chip board.
      const res = await commanderFetch(
        `/api/commander/tournaments/${tournamentId}/floor-view?include=tournament,clock,stats,alerts`,
        { ...(signal ? { signal } : {}) }
      );
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setFloor(json.data);
        const cs = json.data.clock?.clock_state;
        if (cs?.remaining_seconds !== undefined) setClockSeconds(cs.remaining_seconds);
      }
    } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
    finally { setLoading(false); }
  }, [tournamentId]);

  // Realtime first: 30s fallback while the channel is unproven, 5 minutes
  // once it has delivered. The countdown ticks locally in between either way.
  useTournamentRealtime(tournamentId, fetchFloor, { poll: true });
  useEffect(() => { const controller = new AbortController(); fetchFloor(controller.signal); return () => { controller.abort(); }; }, [fetchFloor]);

  // Client-side countdown - only restart interval when clock status changes (not on every tick)
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const cs = floor?.clock?.clock_state;
    if (cs?.status === 'running') {
      timerRef.current = setInterval(() => {
        setClockSeconds(prev => {
          if (prev === 1) {
            // Play alert sound when level ends
            try {
              const ctx = new (window.AudioContext || window.webkitAudioContext)();
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.frequency.value = 880;
              gain.gain.value = 0.3;
              osc.start();
              osc.stop(ctx.currentTime + 0.5);
              // Second beep
              setTimeout(() => {
                const osc2 = ctx.createOscillator();
                const gain2 = ctx.createGain();
                osc2.connect(gain2);
                gain2.connect(ctx.destination);
                osc2.frequency.value = 1100;
                gain2.gain.value = 0.3;
                osc2.start();
                osc2.stop(ctx.currentTime + 0.5);
              }, 600);
            } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
          }
          return prev > 0 ? prev - 1 : 0;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [floor?.clock?.clock_state?.status]);

  // ── Seat Change Cards ──
  // Shared template module: identical paper on every screen and at the floor
  // print station, dealer copy + player copy, from-seat and chip count included.
  const printAutoBreakReceipts = (autoBreakResult) => {
    const receipts = autoBreakResult?.receipts || [];
    if (receipts.length === 0) return false;
    const printed = printSeatChangeCards(receipts);
    if (!printed) {
      setToast({ type: 'error', text: 'Popup Blocked. Seat Change Cards Are Waiting At The Print Station.' });
    }
    return printed;
  };

  const clockAction = async (action) => {
    setActionLoading(action);
    try {
      const body = { action };
      // Optimistic-concurrency guard: send the level index this screen believes
      // is current so two displays cannot double-advance (API 409s on conflict).
      if (action === 'next_level') body.from_level = floor?.clock?.current_level ?? 0;
      if (action === 'add_time' || action === 'subtract_time') body.seconds = 60;
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/clock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.status === 409) {
        // Another display already advanced the level, just refresh state
        await fetchFloor();
        broadcastChange('tournaments');
        return;
      }
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          // Auto-print break receipts if the level advance triggered an auto-break
          if (json.data?.auto_break?.executed) {
            printAutoBreakReceipts(json.data.auto_break);
          }
          await fetchFloor();
          broadcastChange('tournaments');
        } else {
          setToast({ type: 'error', text: json.error?.message || json.error || 'Clock Action Failed. Please Try Again.' });
        }
      } else {
        setToast({ type: 'error', text: 'Clock Action Failed.' });
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Clock Action Failed. Check Console.' }); }
    finally { setActionLoading(null); }
  };

  const toggleH4H = async () => {
    const isActive = floor?.alerts?.hand_for_hand;
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/hand-for-hand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !isActive })
      });
      if (res.ok) {
        const json = await res.json();
        if (!json.success) {
          setToast({ type: 'error', text: json.error?.message || json.error || 'Failed To Toggle Hand-For-Hand. Please Try Again.' });
        } else {
          await fetchFloor();
          broadcastChange('tournaments');
        }
      } else {
        setToast({ type: 'error', text: 'Failed To Toggle Hand-For-Hand.' });
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Hand-For-Hand Toggle Failed.' }); }
  };

  const triggerFinalTable = async () => {
    setActionLoading('final');
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/final-table`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ final_table_number: 1 })
      });
      if (res.ok) {
        const json = await res.json();
        if (!json.success) {
          setToast({ type: 'error', text: json.error?.message || json.error || 'Final Table Action Failed. Please Try Again.' });
        } else {
          await fetchFloor();
          broadcastChange('tournaments');
        }
      } else {
        setToast({ type: 'error', text: 'Final Table Action Failed.' });
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Final Table Action Failed. Check Console.' }); }
    finally { setActionLoading(null); }
  };

  const sendMessage = async () => {
    if (!messageText.trim()) return;
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, type: 'announcement', duration_seconds: 60 })
      });
      const json = await res.json().catch(() => null);
      // A failed broadcast used to leave the modal open with no explanation.
      if (!res.ok || !json?.success) {
        setToast({ type: 'error', text: json?.error?.message || 'Broadcast Failed. Please Try Again.' });
        return;
      }
      setMessageText('');
      setShowMessage(false);
      setToast({ type: 'success', text: 'Message Is On The Clock Displays.' });
      await fetchFloor();
      broadcastChange('tournaments');
    } catch (err) {
      console.warn(err);
      setToast({ type: 'error', text: 'Broadcast Failed. Check Console.' });
    }
  };

  // One tap: banner on the displays (message.js) + push to players (notify.js).
  // The two calls are independent, so a push failure never swallows the banner
  // and the TD is told exactly which half landed.
  const sendFloorAnnouncement = async (item) => {
    if (announcing) return;
    setAnnouncing(item.key);
    try {
      const [msgRes, pushRes] = await Promise.all([
        commanderFetch(`/api/commander/tournaments/${tournamentId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: item.message,
            type: item.messageType,
            duration_seconds: item.durationSeconds
          })
        }).catch(() => null),
        commanderFetch(`/api/commander/tournaments/${tournamentId}/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: item.notifyType,
            message: item.notifyMessage || item.message
          })
        }).catch(() => null)
      ]);

      const msgJson = msgRes ? await msgRes.json().catch(() => null) : null;
      const pushJson = pushRes ? await pushRes.json().catch(() => null) : null;
      const bannerOk = !!(msgRes && msgRes.ok && msgJson?.success);
      const pushOk = !!(pushRes && pushRes.ok && pushJson?.success);
      const notified = pushJson?.data?.in_app ?? pushJson?.data?.sent ?? 0;

      if (!bannerOk && !pushOk) {
        setToast({
          type: 'error',
          text: msgJson?.error?.message || pushJson?.error?.message || 'Announcement Failed. Please Try Again.'
        });
      } else if (!bannerOk) {
        setToast({ type: 'error', text: 'Push Sent, But The Display Banner Failed.' });
      } else if (!pushOk) {
        setToast({ type: 'error', text: `"${item.message}" Is On The Displays, But The Push Failed.` });
      } else {
        setToast({
          type: 'success',
          text: `"${item.message}" On The Displays, ${notified} Player${notified === 1 ? '' : 's'} Notified.`
        });
      }

      await fetchFloor();
      broadcastChange('tournaments');
    } catch (err) {
      console.warn(err);
      setToast({ type: 'error', text: 'Announcement Failed. Check Console.' });
    } finally {
      setAnnouncing(null);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const navigateTo = (path) => router.push(`/commander/td/${tournamentId}${path}`);

  if (loading) return <div className="min-h-screen bg-[#18191A] flex items-center justify-center"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" /></div>;

  const clock = floor?.clock || {};
  const stats = floor?.stats || {};
  const alerts = floor?.alerts || {};
  const tournament = floor?.tournament || {};
  const clockState = clock.clock_state || {};
  const isRunning = clockState.status === 'running';
  const isPaused = clockState.status === 'paused';

  // Break state has two sources and the screen showed neither: the manual
  // toggle (settings.clock_state.on_break, surfaced as alerts.on_break) and a
  // scheduled break ROW in the structure (row.is_break with its own duration).
  const blindStructure = Array.isArray(tournament.blind_structure) ? tournament.blind_structure : [];
  const currentRow = blindStructure[clock.current_level ?? 0] || null;
  const rowIsBreak = !!currentRow?.is_break;
  const breakRowMinutes = currentRow ? (currentRow.duration ?? currentRow.duration_minutes ?? 0) : 0;
  const manualBreak = !!alerts.on_break;
  const onBreak = manualBreak || rowIsBreak;
  const breakSecondsLeft = clockSeconds ?? clockState.remaining_seconds ?? null;

  return (
    <CommanderLayout title="Commander - Clock" backHref={`/commander/td/${tournamentId}`}>
      <SEOHead
        title="Commander - Clock"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div ref={containerRef} className={`min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter'] flex flex-col ${isFullscreen ? '' : 'pb-20'}`}>

        {/* Fullscreen header bar */}
        {!isFullscreen && (
          <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-white">Clock Control</h1>
              <p className="text-xs text-[#B0B3B8]">{tournament.name}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={toggleFullscreen} className="p-2 rounded-lg active:bg-[#3A3B3C]">
                <Maximize className="w-5 h-5 text-[#B0B3B8]" />
              </button>
              <button onClick={fetchFloor} className="p-2 rounded-lg active:bg-[#3A3B3C]">
                <RefreshCw className="w-5 h-5 text-[#B0B3B8]" />
              </button>
            </div>
          </div>
        )}

        {/* Main Clock Mirror */}
        <div className={`w-full bg-black relative ${isFullscreen ? 'flex-1' : 'aspect-[16/9] min-h-[250px] max-h-[50vh]'}`}>
          <iframe
            src={`/commander/tournaments/${tournamentId}/clock-display`}
            className="absolute inset-0 w-full h-full border-0 pointer-events-none"
            title="Clock Mirror"
            style={{ pointerEvents: 'none' }}
          />
          {isFullscreen && (
            <button onClick={toggleFullscreen} className="absolute top-4 right-4 z-50 p-3 bg-black/50 hover:bg-black/80 rounded-full backdrop-blur">
              <Minimize className="w-6 h-6 text-white" />
            </button>
          )}
        </div>

        {/* Controls Section */}
        {!isFullscreen && (
          <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col items-center">
            {/* Late Reg indicator + approximate wall-clock close time */}
            {stats.late_reg_open && (() => {
              const closeAt = lateRegCloseDate(
                tournament.blind_structure,
                clock.current_level || 0,
                clockSeconds ?? clockState.remaining_seconds,
                tournament.late_registration_levels
              );
              return (
                <div className="mb-4 px-4 py-2 rounded-xl bg-[#31A24C]/10 border border-[#31A24C]/30 text-center">
                  <p className="text-xs font-bold text-[#31A24C] uppercase tracking-wider">Late Reg Open</p>
                  {closeAt && (
                    <p className="text-[11px] text-[#B0B3B8] mt-0.5">
                      Late Reg Closes ~{closeAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  )}
                </div>
              );
            })()}
            {/* ON BREAK state, with the scheduled-break countdown */}
            {onBreak && (
              <div className="w-full max-w-lg mb-5 p-4 rounded-2xl bg-[#F59E0B]/10 border-2 border-[#F59E0B]/40">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-[#F59E0B]/20 flex items-center justify-center flex-shrink-0">
                    <Coffee className="w-6 h-6 text-[#F59E0B]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-[#F59E0B] uppercase tracking-wider">On Break</h2>
                    <p className="text-xs text-[#B0B3B8] truncate">
                      {rowIsBreak
                        ? `${currentRow?.label || 'Scheduled Break'}${breakRowMinutes > 0 ? `, ${breakRowMinutes} Min` : ''}`
                        : 'Manual Break, Clock Paused'}
                    </p>
                  </div>
                  {rowIsBreak && (
                    <div className="text-right flex-shrink-0">
                      <p className="text-3xl font-bold text-white tabular-nums leading-none">
                        {formatClock(breakSecondsLeft)}
                      </p>
                      <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider mt-1">Break Remaining</p>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex gap-2">
                  {manualBreak && (
                    <button
                      onClick={() => clockAction('break')}
                      disabled={!!actionLoading}
                      className="flex-1 h-12 rounded-xl bg-[#F59E0B] text-black text-sm font-bold flex items-center justify-center gap-2 active:bg-[#D97706] disabled:opacity-50"
                    >
                      {actionLoading === 'break'
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Ending Break...</>
                        : <><Play className="w-4 h-4" /> End Break And Resume Play</>
                      }
                    </button>
                  )}
                  {rowIsBreak && !manualBreak && (
                    <button
                      onClick={() => clockAction('next_level')}
                      disabled={!!actionLoading}
                      className="flex-1 h-12 rounded-xl bg-[#F59E0B] text-black text-sm font-bold flex items-center justify-center gap-2 active:bg-[#D97706] disabled:opacity-50"
                    >
                      {actionLoading === 'next_level'
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting Level...</>
                        : <><SkipForward className="w-4 h-4" /> End Break, Start Next Level</>
                      }
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Controls */}
            <div className="flex items-center gap-3 mb-6">
              <button onClick={() => clockAction('prev_level')} disabled={!!actionLoading}
                className="w-14 h-14 rounded-xl bg-[#3A3B3C] flex items-center justify-center active:bg-[#4A4B4C] disabled:opacity-50">
                <SkipBack className="w-6 h-6 text-[#E4E6EB]" />
              </button>

              <button onClick={() => clockAction('subtract_time')} disabled={!!actionLoading}
                className="w-14 h-14 rounded-xl bg-[#3A3B3C] flex items-center justify-center active:bg-[#4A4B4C] disabled:opacity-50">
                <Minus className="w-6 h-6 text-[#E4E6EB]" />
              </button>

              {isRunning ? (
                <button onClick={() => clockAction('pause')} disabled={!!actionLoading}
                  className="w-24 h-24 rounded-3xl bg-[#F59E0B] flex items-center justify-center active:bg-[#D97706] disabled:opacity-50 shadow-lg shadow-[#F59E0B]/20">
                  {actionLoading === 'pause' ? <Loader2 className="w-10 h-10 text-white animate-spin" /> : <Pause className="w-10 h-10 text-white" />}
                </button>
              ) : (
                <button onClick={() => clockAction(isPaused ? 'resume' : 'start')} disabled={!!actionLoading}
                  className="w-24 h-24 rounded-3xl bg-[#31A24C] flex items-center justify-center active:bg-[#28883F] disabled:opacity-50 shadow-lg shadow-[#31A24C]/20">
                  {actionLoading === 'start' || actionLoading === 'resume'
                    ? <Loader2 className="w-10 h-10 text-white animate-spin" />
                    : <Play className="w-10 h-10 text-white ml-1" />}
                </button>
              )}

              <button onClick={() => clockAction('add_time')} disabled={!!actionLoading}
                className="w-14 h-14 rounded-xl bg-[#3A3B3C] flex items-center justify-center active:bg-[#4A4B4C] disabled:opacity-50">
                <Plus className="w-6 h-6 text-[#E4E6EB]" />
              </button>

              <button onClick={() => clockAction('next_level')} disabled={!!actionLoading}
                className="w-14 h-14 rounded-xl bg-[#3A3B3C] flex items-center justify-center active:bg-[#4A4B4C] disabled:opacity-50">
                <SkipForward className="w-6 h-6 text-[#E4E6EB]" />
              </button>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              <ActionChip icon={Coffee} label="Break" onClick={() => clockAction('break')}
                active={alerts.on_break} activeColor="#F59E0B" />
              <ActionChip icon={Hand} label={alerts.hand_for_hand ? 'End H4H' : 'H4H'}
                onClick={toggleH4H} active={alerts.hand_for_hand} activeColor="#EF4444" />
              <ActionChip icon={Star} label="Final" onClick={triggerFinalTable}
                active={floor?.tournament?.status === 'final_table'} activeColor="#1877F2"
                disabled={stats.players_remaining > 10} />
              <ActionChip icon={Volume2} label="Announce" onClick={() => setShowMessage(true)} />
              <ActionChip icon={Maximize} label="Fullscreen" onClick={toggleFullscreen} />
              <ActionChip icon={Square} label="End Event" onClick={() => setShowEndConfirm(true)}
                active={true} activeColor="#EF4444" disabled={!!actionLoading} />
            </div>

            {/* ===== FLOOR ANNOUNCEMENTS (single tap: banner + push) ===== */}
            <div className="w-full max-w-lg mt-6">
              <div className="flex items-center gap-2 mb-2">
                <Megaphone className="w-4 h-4 text-[#1877F2]" />
                <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider">
                  Floor Announcements
                </h2>
              </div>
              <p className="text-xs text-[#B0B3B8] mb-3">
                Each One Sets The Banner On Every Clock Display And Pushes To Every Registered Player.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {FLOOR_ANNOUNCEMENTS.map(item => {
                  const Icon = item.icon;
                  const busy = announcing === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => sendFloorAnnouncement(item)}
                      disabled={!!announcing}
                      className="h-14 px-4 rounded-xl bg-[#242526] border border-[#3A3B3C] text-[#E4E6EB] text-sm font-semibold flex items-center gap-3 text-left active:bg-[#3A3B3C] transition-colors disabled:opacity-50"
                    >
                      {busy
                        ? <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" style={{ color: item.color }} />
                        : <Icon className="w-5 h-5 flex-shrink-0" style={{ color: item.color }} />
                      }
                      <span className="flex-1 min-w-0 truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {/* Message Modal */}
        {showMessage && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center p-4"
            onClick={() => setShowMessage(false)}>
            <div className="bg-[#242526] rounded-2xl w-full max-w-lg p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white">Broadcast To Displays</h3>
              <textarea value={messageText} onChange={e => setMessageText(e.target.value)}
                placeholder="Message To Show On Clock Displays..."
                rows={2}
                className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl px-4 py-3 text-[#E4E6EB] text-base placeholder-[#B0B3B8]/50 focus:outline-none focus:border-[#1877F2] resize-none"
                autoFocus />
              <div className="flex gap-2 flex-wrap">
                {['Color Up', 'Break Time', 'Last Hand', 'Seats Open', 'Registration Closed'].map(q => (
                  <button key={q} onClick={() => setMessageText(q)}
                    className="px-3 py-2 rounded-lg bg-[#3A3B3C] text-[#B0B3B8] text-xs active:bg-[#4A4B4C]">{q}</button>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowMessage(false)}
                  className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] font-medium active:bg-[#4A4B4C]">Cancel</button>
                <button onClick={sendMessage} disabled={!messageText.trim()}
                  className="flex-1 py-3 rounded-xl bg-[#1877F2] text-white font-medium active:bg-[#1565D8] disabled:opacity-50 flex items-center justify-center gap-2">
                  <Volume2 className="w-4 h-4" /> Broadcast
                </button>
              </div>
            </div>
          </div>
        )}

        {/* End Tournament Confirmation */}
        {showEndConfirm && (
          <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
            onClick={() => setShowEndConfirm(false)}>
            <div className="bg-[#242526] rounded-2xl w-full max-w-sm p-6 border border-[#3A3B3C]" onClick={e => e.stopPropagation()}>
              <div className="text-center mb-4">
                <div className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ backgroundColor: '#EF444420' }}>
                  <Square className="w-7 h-7 text-[#EF4444]" />
                </div>
                <h3 className="text-lg font-bold text-white">End Tournament?</h3>
                <p className="text-sm text-[#B0B3B8] mt-1">This Marks The Tournament Completed And Stops The Clock. This Cannot Be Undone.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowEndConfirm(false)}
                  className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] font-medium active:bg-[#4A4B4C]">Cancel</button>
                <button onClick={async () => { setShowEndConfirm(false); await clockAction('end'); }}
                  disabled={actionLoading === 'end'}
                  className="flex-1 py-3 rounded-xl bg-[#EF4444] text-white font-bold active:opacity-80 disabled:opacity-50">
                  {actionLoading === 'end' ? 'Ending...' : 'End Tournament'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bottom Nav (hidden in fullscreen) */}
        {!isFullscreen && (
          <nav className="fixed bottom-0 left-0 right-0 bg-[#242526] border-t border-[#3A3B3C] z-40">
            <div className="flex items-center justify-around h-16 max-w-2xl mx-auto">
              {NAV_ITEMS.map(item => {
                const Icon = NAV_ICONS[item.key];
                const isActive = item.key === 'clock';
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
        )}
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

function ActionChip({ icon: Icon, label, onClick, active, activeColor, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 active:scale-[0.97] transition-transform disabled:opacity-40 ${active
        ? `text-white`
        : 'bg-[#3A3B3C] text-[#B0B3B8] active:bg-[#4A4B4C]'
        }`}
      style={active ? { backgroundColor: activeColor } : undefined}>
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}
