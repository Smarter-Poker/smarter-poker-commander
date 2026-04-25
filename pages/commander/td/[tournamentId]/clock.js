/**
 * Tournament Director — Clock & Broadcast
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
import { Trophy, LayoutGrid, Users, Monitor, Play, Pause, SkipForward, SkipBack, Loader2, RefreshCw, Maximize, Minimize, Coffee, Hand, Star, Volume2, Plus, Minus, DollarSign, FileText } from 'lucide-react';
import { busEmit } from '../../../../src/engine/EventBus';
import { commanderFetch } from '../../../../src/lib/commander/commanderFetch';

const NAV_ITEMS = [
  { key: 'control', path: '' }, { key: 'tables', path: '/tables' },
  { key: 'players', path: '/players' }, { key: 'payouts', path: '/payouts' },
  { key: 'reports', path: '/reports' }, { key: 'clock', path: '/clock' },
];
const NAV_ICONS = { control: Trophy, tables: LayoutGrid, players: Users, payouts: DollarSign, reports: FileText, clock: Monitor };

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
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/floor-view`, { ...(signal ? { signal } : {}) });
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

  useTournamentRealtime(tournamentId, fetchFloor);
  useEffect(() => { const controller = new AbortController(); fetchFloor(controller.signal); const i = setInterval(() => fetchFloor(controller.signal), 30000); return () => { controller.abort(); clearInterval(i); }; }, [fetchFloor]); // 30s fallback

  // Client-side countdown — only restart interval when clock status changes (not on every tick)
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

  // ── Seat Change Card — matches tournament buy-in receipt format ──
  const printAutoBreakReceipts = (autoBreak) => {
    if (!autoBreak?.receipts?.length) return;
    const pw = window.open('', '_blank', 'width=420,height=700');
    if (!pw) return;
    const receipts = autoBreak.receipts;
    pw.document.write(`<!DOCTYPE html><html><head><title>Seat Change Cards</title>
<style>
@page { margin: 0; size: 80mm auto; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #000; font-size: 12px; }
.card {
  width: 72mm; margin: 0 auto; padding: 5mm 4mm 6mm;
  border-bottom: 2px dashed #000;
  page-break-after: always;
}
.card:last-child { page-break-after: avoid; border-bottom: none; }
/* HEADER ── Venue name large at top like POTAWATOMI */
.venue-name {
  text-align: center; font-size: 20px; font-weight: 900;
  letter-spacing: 1px; text-transform: uppercase;
  line-height: 1.1; margin-bottom: 1mm;
}
.venue-sub { text-align: center; font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: #444; margin-bottom: 2mm; }
.receipt-type { text-align: center; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 1mm; }
.tourn-name { text-align: center; font-size: 11px; font-weight: bold; margin-bottom: 3mm; }
.divider { border-top: 1px solid #000; margin: 2.5mm 0; }
/* PLAYER ROW */
.field-row { display: flex; align-items: baseline; margin: 2mm 0; font-size: 11px; }
.field-label { font-weight: bold; min-width: 18mm; }
.field-val { font-size: 11px; text-transform: uppercase; }
/* TWO BOXES ── Table | Seat — exactly like the reference photo */
.boxes { display: flex; gap: 4mm; justify-content: center; margin: 4mm 0 2mm; }
.box-wrap { text-align: center; flex: 1; }
.box-title { font-size: 11px; font-weight: bold; margin-bottom: 1mm; }
.box-num {
  border: 2px solid #000;
  font-size: 30px; font-weight: 900;
  padding: 2mm 0; min-width: 22mm;
  display: block; text-align: center;
  line-height: 1.1;
}
/* Previous seat + chips */
.moved-from { font-size: 9px; text-align: center; color: #555; margin-top: 1mm; }
.chips-row { display: flex; justify-content: space-between; font-size: 10px; margin: 2mm 0; }
/* FOOTER */
.footer-line { font-size: 9px; margin: 1mm 0; }
.customer-copy { text-align: center; font-size: 9px; font-weight: bold; letter-spacing: 1px; margin-top: 3mm; }
</style></head><body>
${receipts.map(r => `<div class="card">
  <div class="venue-name">${r.venue_name || 'Smarter Poker'}</div>
  <div class="venue-sub">Poker Room</div>
  <div class="receipt-type">Tournament Seat Change Card</div>
  <div class="tourn-name">${r.tournament_name}${r.buyin_amount ? ` — $${Number(r.buyin_amount).toLocaleString()}` : ''}</div>
  <div class="divider"></div>
  <div class="field-row"><span class="field-label">Name:</span><span class="field-val">&nbsp;${r.player_name}</span></div>
  <div class="divider"></div>
  <div class="boxes">
    <div class="box-wrap">
      <div class="box-title">Table</div>
      <span class="box-num">${r.to_table}</span>
    </div>
    <div class="box-wrap">
      <div class="box-title">Seat</div>
      <span class="box-num">${r.to_seat}</span>
    </div>
  </div>
  <div class="moved-from">Moved from Table ${r.from_table}, Seat ${r.from_seat}</div>
  ${r.chips ? `<div class="divider"></div><div class="chips-row"><span>Chip Count:</span><span><b>${Number(r.chips).toLocaleString()}</b></span></div>` : ''}
  <div class="divider"></div>
  <div class="footer-line">${new Date(r.timestamp).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}&nbsp;&nbsp;${new Date(r.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
  <div class="customer-copy">Customer Copy</div>
</div>`).join('')}
</body></html>`);
    pw.document.close();
    setTimeout(() => { pw.print(); pw.close(); }, 500);
  };

  const clockAction = async (action) => {
    setActionLoading(action);
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/clock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
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
          setToast({ type: 'error', text: json.error?.message || json.error || 'Clock action failed. Please try again.' });
        }
      } else {
        setToast({ type: 'error', text: 'Clock action failed.' });
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Clock action failed. Check console.' }); }
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
          setToast({ type: 'error', text: json.error?.message || json.error || 'Failed to toggle Hand-for-Hand. Please try again.' });
        } else {
          await fetchFloor();
          broadcastChange('tournaments');
        }
      } else {
        setToast({ type: 'error', text: 'Failed to toggle Hand-for-Hand.' });
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Hand-for-Hand toggle failed.' }); }
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
          setToast({ type: 'error', text: json.error?.message || json.error || 'Final table action failed. Please try again.' });
        } else {
          await fetchFloor();
          broadcastChange('tournaments');
        }
      } else {
        setToast({ type: 'error', text: 'Final table action failed.' });
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Final table action failed. Check console.' }); }
    finally { setActionLoading(null); }
  };

  const sendMessage = async () => {
    if (!messageText.trim()) return;
    const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: messageText, type: 'announcement', duration_seconds: 60 })
    });
    if (res.ok) {
      setMessageText('');
      setShowMessage(false);
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

  return (
    <CommanderLayout title="Commander — Clock" backHref={`/commander/td/${tournamentId}`}>
      <SEOHead
        title="Commander — Clock"
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
