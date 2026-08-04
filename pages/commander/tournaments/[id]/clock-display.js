/**
 * Tournament Clock Display — Full Tournament Director Clone
 * /commander/tournaments/[id]/clock-display
 * 
 * Features matching TheTournamentDirector.net:
 * - LEFT: Round, Entries, Players In, Rebuys, Chip Count, Avg Stack, Total Pot
 * - CENTER: Big countdown timer, game type, blinds, ante, next round preview
 * - RIGHT: Current Time, Elapsed Time, Next Break, Chip denomination colors
 * - BOTTOM: Payout bar
 * - ICM/Chop calculator panel (toggleable)
 * - Multiple cycling screens (Clock → Payouts → Schedule → Seating)
 * - Custom background/logo from preset
 * - Sound alerts on level change, break, final table
 * - Hand timer overlay (put a player on the clock)
 * - Burn-in prevention (subtle pixel shift)
 * - Upcoming blind schedule preview (next 5 levels)
 * 
 * Full-screen for TV/projector via HDMI or browser cast.
 * Auto-refreshes, wake lock, click for fullscreen.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import { calculateICM, calculateChipChop } from '../../../../src/lib/commander/icm-utils';
import { useCommanderSync, broadcastChange } from '../../../../src/lib/commander/useCommanderSync';
import useWakeLock from '../../../../src/hooks/useWakeLock';
import { busEmit } from '../../../../src/engine/EventBus';
import { getStaffSession } from '../../../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../../../src/lib/commander/commanderFetch';

const parseBlinds = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.length > 0) { try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch (e) { console.warn('[App] Handled exception:', e); } }
  return [];
};

function formatClock(seconds) {
  if (!seconds && seconds !== 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatMoney(n) {
  if (!n && n !== 0) return '$0.00';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatChipCount(n) {
  if (!n) return '0';
  return Number(n).toLocaleString();
}

function formatElapsed(startTime) {
  if (!startTime) return '0:00';
  const diff = Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}`;
  return `0:${m.toString().padStart(2, '0')}`;
}

// Chip denominations removed — replaced by prize payouts + chip leaders in right panel

const DEFAULT_THEME = {
  background: '#0D192E', text: '#ffffff', accent: '#1877F2',
  blinds: '#ffffff', headerBg: 'rgba(0,0,0,0.3)' };

// Display screens for cycling
const SCREENS = { CLOCK: 'clock', PAYOUTS: 'payouts', SCHEDULE: 'schedule', ICM: 'icm' };

export default function ClockDisplay() {
  useEffect(() => { busEmit.sessionStart('commander-tournaments-id-clock-display'); }, []);
  const router = useRouter();
  const { id } = router.query;
  const [data, setData] = useState(null);
  const [seconds, setSeconds] = useState(null);
  const [showControls, setShowControls] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [preset, setPreset] = useState(null);
  const [activeScreen, setActiveScreen] = useState(SCREENS.CLOCK);
  const [handTimerActive, setHandTimerActive] = useState(false);
  const [handTimerSeconds, setHandTimerSeconds] = useState(60);
  const [burnInOffset, setBurnInOffset] = useState({ x: 0, y: 0 });
  const [venueId, setVenueId] = useState(null);
  // Editable ICM/Chop state
  const [editableStacks, setEditableStacks] = useState([]);
  const [chopMode, setChopMode] = useState('icm'); // 'icm' or 'chip_chop'
  const [needsPayoutScroll, setNeedsPayoutScroll] = useState(false);
  const payoutViewportRef = useRef(null);
  const payoutContentRef = useRef(null);
  const timerRef = useRef(null);
  const handTimerRef = useRef(null);
  useWakeLock();
  const isRunningRef = useRef(false);
  const controlsTimeoutRef = useRef(null);
  const cycleRef = useRef(null);
  const prevLevelRef = useRef(null);
  const audioRef = useRef(null);

  // Auto-scroll logic for payouts
  useEffect(() => {

  if (!router.isReady) return null;

    if (!payoutViewportRef.current || !payoutContentRef.current) return;
    const checkScroll = () => {
      if (payoutViewportRef.current && payoutContentRef.current) {
        // If the inner content is taller than the viewport, we need to scroll it.
        // We measure against half the scroll height if it's already duplicated and scrolling, 
        // to prevent it toggling rapidly, but measuring the raw height is best. 
        // Since the class might be applied, we just check if scrollHeight > clientHeight.
        const scrollH = payoutContentRef.current.scrollHeight;
        const clientH = payoutViewportRef.current.clientHeight;

        // If it's already duplicating the array (needsPayoutScroll=true), the scrollHeight is 2x. 
        // We only want to turn it off if the single list height would fit.
        // A simple heuristic: if it needs scroll, actual single list height is roughly scrollH / 2.
        const singleListHeight = payoutContentRef.current.classList.contains('payout-ticker') ? (scrollH / 2) : scrollH;

        const needsScroll = singleListHeight > clientH + 5;
        setNeedsPayoutScroll(prev => prev !== needsScroll ? needsScroll : prev);
      }
    };
    checkScroll();

    // Give DOM a tick to layout
    const timeoutMsg = setTimeout(checkScroll, 100);

    // Also re-check on resize
    let observer;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(checkScroll);
      if (payoutViewportRef.current) observer.observe(payoutViewportRef.current);
    }

    return () => {
      clearTimeout(timeoutMsg);
      if (observer) observer.disconnect();
    };
  }, [activeScreen, data?.stats?.players_remaining, data?.tournament?.payout_structure, data?.stats?.payouts]);

  // (Current Time display removed — wall clock no longer needed)

  // Burn-in prevention
  useEffect(() => {
    const displayOpts = preset?.display_options || {};
    if (!displayOpts.burn_in_prevention) return;
    const interval = setInterval(() => {
      setBurnInOffset({ x: Math.random() * 4 - 2, y: Math.random() * 4 - 2 });
    }, 30000);
    return () => clearInterval(interval);
  }, [preset]);

  // Screen cycling
  useEffect(() => {
    if (cycleRef.current) clearInterval(cycleRef.current);
    const displayOpts = preset?.display_options || {};
    if (!displayOpts.screen_cycle_enabled) return;
    const screenList = [SCREENS.CLOCK];
    if (displayOpts.show_payouts) screenList.push(SCREENS.PAYOUTS);
    if (displayOpts.show_schedule_preview) screenList.push(SCREENS.SCHEDULE);
    if (displayOpts.show_icm) screenList.push(SCREENS.ICM);
    if (screenList.length <= 1) return;
    const intervalMs = (displayOpts.screen_cycle_interval || 15) * 1000;
    let idx = 0;
    cycleRef.current = setInterval(() => {
      idx = (idx + 1) % screenList.length;
      setActiveScreen(screenList[idx]);
    }, intervalMs);
    return () => { if (cycleRef.current) clearInterval(cycleRef.current); };
  }, [preset]);

  // Fetch clock preset
  const fetchPreset = useCallback(async (presetId) => {
    try {
const json = await commanderFetchJSON('/api/commander/clock-presets', { });
      if (json.success) {
        const found = (json.data || []).find(p => p.id === presetId);
        if (found) setPreset(found);
      }
    } catch (err) { console.warn(err); }
  }, []);

  // Fetch floor-view data
  const fetchData = useCallback(async (signal) => {
    if (!id) return;
    try {
const res = await commanderFetch(`/api/commander/tournaments/${id}/floor-view`, { ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        if (json.data.tournament?.venue_id) setVenueId(json.data.tournament.venue_id);

        const cs = json.data.clock?.clock_state;
        if (cs?.remaining_seconds !== undefined && cs.remaining_seconds > 0) {
          // Only update local seconds if the clock is NOT running, OR if the server value is way off (manually adjusted by TD)
          setSeconds(prev => {
            if (cs.status !== 'running') return cs.remaining_seconds;
            if (Math.abs(prev - cs.remaining_seconds) > 3) return cs.remaining_seconds;
            return prev; // Trust local tick
          });
        } else if (cs?.remaining_seconds === 0 || cs?.remaining_seconds === undefined) {
          // Wait for next level to fetch
          if (cs?.status !== 'running') {
            const blindStructure = parseBlinds(json.data.tournament?.blind_structure);
            const currentLvl = json.data.clock?.current_level || 0;
            const levelData = blindStructure[currentLvl];
            if (levelData?.duration) {
              setSeconds(levelData.duration * 60);
            }
          }
        }
        isRunningRef.current = cs?.status === 'running';

        // Sound alerts — detect level change
        const currentLevel = json.data.clock?.current_level;
        const displayOpts = preset?.display_options || {};
        if (prevLevelRef.current !== null && currentLevel !== prevLevelRef.current) {
          if (displayOpts.sound_level_change) playAlert('level');
        }
        if (json.data.alerts?.on_break && displayOpts.sound_break) playAlert('break');
        if (json.data.alerts?.final_table && displayOpts.sound_final_table) playAlert('final');
        prevLevelRef.current = currentLevel;

        // Load preset if tournament has clock_preset_id
        // 2026-08-04 audit fix: the preset id is stored in settings.clock_preset_id
        // (floor-view has no top-level clock_preset_id) — read both locations.
        const presetId = json.data.tournament?.clock_preset_id || json.data.tournament?.settings?.clock_preset_id;
        if (!preset && presetId) {
          fetchPreset(presetId);
        }
      }
    } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
  }, [id, preset, fetchPreset]);

  // Initial fetch and polling fallback
  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    const poll = setInterval(() => fetchData(controller.signal), 3000);
    return () => { controller.abort(); clearInterval(poll); };
  }, [fetchData]);

  // Instant Real-Time Synchronization
  useCommanderSync(venueId, fetchData, { entities: ['tournaments'] });

  // Sound alert playback
  const playAlert = (type) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
      if (type === 'break') { osc.frequency.setValueAtTime(660, ctx.currentTime); }
      else if (type === 'final') { osc.frequency.setValueAtTime(880, ctx.currentTime); }
      else { osc.frequency.setValueAtTime(523, ctx.currentTime); }
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.8);
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  };

  // Countdown tick
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const status = data?.clock?.clock_state?.status;
    isRunningRef.current = status === 'running';
    if (status === 'running') {
      timerRef.current = setInterval(() => {
        if (isRunningRef.current) {
          setSeconds(prev => (prev > 0 ? prev - 1 : 0));
        }
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [data?.clock?.clock_state?.status]);

  // Auto-advance level when timer hits 0
  useEffect(() => {
    if (seconds === 0 && isRunningRef.current && !actionLoading && data?.clock?.clock_state?.status === 'running') {
      const blindStructure = parseBlinds(data?.tournament?.blind_structure);
      const currentLevelIdx = data?.clock?.current_level ?? 0;
      const isLastLevel = currentLevelIdx >= blindStructure.length - 1;

      // Prevent multiple fires
      isRunningRef.current = false;

      if (isLastLevel) {
        // On the final level — reset local timer to the full level duration immediately
        // so the display never hits 0:00 for more than one tick, then call API to persist.
        const lastLevelDuration = blindStructure[currentLevelIdx]?.duration || 20;
        setSeconds(lastLevelDuration * 60);
      }

      // Always call next_level — the API handles both normal and final-level extension
      // 2026-07-25 audit fix: send from_level so concurrent displays cannot
      // double-advance (the API 409s when the level already moved).
      clockAction('next_level', isLastLevel, { from_level: currentLevelIdx });
    }
  }, [seconds, actionLoading, data?.clock?.clock_state?.status]);

  // Hand timer tick
  useEffect(() => {
    if (handTimerRef.current) clearInterval(handTimerRef.current);
    if (handTimerActive && handTimerSeconds > 0) {
      handTimerRef.current = setInterval(() => {
        setHandTimerSeconds(prev => {
          if (prev <= 1) { setHandTimerActive(false); playAlert('break'); return 0; }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (handTimerRef.current) clearInterval(handTimerRef.current); };
  }, [handTimerActive, handTimerSeconds]);

  // Clock action handler
  // skipSecondsOverride: true when we've already set seconds locally (final level reset)
  // 2026-07-25 audit fix: extraBody lets auto-advance pass from_level for the
  // API's optimistic-concurrency check; a 409 just means another display won.
  const clockAction = async (action, skipSecondsOverride = false, extraBody = {}) => {
    if (!id || actionLoading) return;
    setActionLoading(true);
    try {
const res = await commanderFetch(`/api/commander/tournaments/${id}/clock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extraBody })
      });
      if (res.status === 409) {
        // Another display already advanced the level — refresh state instead of erroring
        fetchData();
        setActionLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        const res2 = await commanderFetch(`/api/commander/tournaments/${id}/floor-view`, { });
        if (!res2.ok) throw new Error(`Request failed (${res2.status})`);
        const json2 = await res2.json();
        if (json2.success) {
          setData(json2.data);
          const cs = json2.data.clock?.clock_state;
          // Don't override seconds if the caller already set a fresh local value
          // (e.g. final-level reset) — the server re-read might return 0 briefly
          if (!skipSecondsOverride && cs?.remaining_seconds !== undefined && cs.remaining_seconds > 0) {
            setSeconds(cs.remaining_seconds);
          }
          isRunningRef.current = cs?.status === 'running';
        }
        broadcastChange('tournaments');
      }
    } catch (err) { console.warn('Clock action error:', err); }
    setActionLoading(false);
  };

  const toggleControls = (e) => {
    e.stopPropagation();
    setShowControls(prev => !prev);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 10000);
  };

  const goFullscreen = () => { document.documentElement.requestFullscreen?.(); };

  if (!data) return (
    <div style={S.loading}><p style={{ color: '#fff', fontSize: 24, fontFamily: 'Inter, sans-serif' }}>Loading Tournament Clock...</p></div>
  );

  const { tournament: t = {}, clock = {}, stats = {}, alerts = {} } = data;
  const theme = { ...DEFAULT_THEME, ...(preset?.theme || {}) };
  const displayOpts = preset?.display_options || {
    show_prize_pool: true, show_payouts: true, show_icm: false,
    show_chip_chop: false, show_chip_colors: false, show_next_round: true,
    show_schedule_preview: false, show_seating: false };

  // Chip leaders — unique by name, top 20 sorted by stack
  const uniqueLeaders = [];
  const seenNames = new Set();
  for (const p of (stats.player_stacks || []).sort((a, b) => b.chips - a.chips)) {
    if (p.chips > 0 && !seenNames.has(p.name)) {
      seenNames.add(p.name);
      uniqueLeaders.push(p);
    }
  }
  const chipLeaders = uniqueLeaders.slice(0, 20);

  const blinds = clock.current_blinds || {};
  const nextBlinds = clock.next_blinds || {};
  const afterBreakBlinds = clock.after_break_blinds || null;
  const clockState = clock.clock_state || {};
  // 2026-07-25 audit fix: surface staff floor messages (settings.clock_state.current_message)
  const currentMessage = data?.currentMessage || clockState.current_message || null;
  const messageActive = currentMessage && currentMessage.text &&
    (!currentMessage.expires_at || new Date(currentMessage.expires_at).getTime() > Date.now());
  const displaySeconds = seconds ?? clockState.remaining_seconds ?? 0;
  const isBreak = alerts.on_break;
  const isH4H = alerts.hand_for_hand;
  const currentLevel = (clock.current_level || 0) + 1;
  const gameType = t.game_type || 'No Limit Texas Hold \'Em';

  const totalEntries = stats.total_entries || 0;
  const playersIn = stats.players_remaining || 0;
  const totalRebuys = stats.total_rebuys || 0;
  const totalChips = stats.total_chips || totalEntries * (t.starting_chips || 1500);
  const avgStack = playersIn > 0 ? Math.round(totalChips / playersIn) : 0;
  const prizePool = stats.prize_pool || 0;
  const payouts = t.payout_structure || t.custom_payouts || stats.payouts || [];

  // Dynamic payouts — only show remaining positions for remaining players
  const remainingPayouts = payouts.filter((_, i) => i < playersIn);

  const blindStructure = parseBlinds(t.blind_structure);

  // Calculate next break accurately: remaining seconds in current level + duration of future levels until break
  let nextBreakSec = clockState.next_break_seconds; // If API provided it, use it
  if (!nextBreakSec && blindStructure.length > 0) {
    const currentLevelIdx = clock.current_level || 0;

    // Are there any future breaks?
    const hasFutureBreak = blindStructure.some((l, i) => i > currentLevelIdx && l.is_break);

    if (hasFutureBreak) {
      let secsUntilBreak = displaySeconds; // Start with current remaining time

      // Add full duration of any levels between now and the break
      for (let i = currentLevelIdx + 1; i < blindStructure.length; i++) {
        if (blindStructure[i].is_break) break; // Found the break, stop adding
        secsUntilBreak += (blindStructure[i].duration || 0) * 60;
      }
      nextBreakSec = secsUntilBreak > 0 ? secsUntilBreak : null;
    } else {
      nextBreakSec = null; // No breaks left
    }
  }
  const elapsedDisplay = formatElapsed(t.started_at || clockState.started_at);
  const playerStacks = stats.player_stacks || [];
  const prizeAmounts = payouts.map(p => p.amount || (prizePool * (p.percentage || 0) / 100));
  const icmResults = playerStacks.length > 1 ? calculateICM(playerStacks.map(p => p.chips), prizeAmounts) : [];
  const chipChopResults = playerStacks.length > 1 ? calculateChipChop(playerStacks.map(p => p.chips), prizePool) : [];

  const bgStyle = displayOpts.background_image_url
    ? { backgroundImage: `url(${displayOpts.background_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: `linear-gradient(180deg, ${theme.background} 0%, ${adjustColor(theme.background, -20)} 100%)` };

  // Top 3 chip leaders (fixed under Next Round)
  const top3Leaders = chipLeaders.slice(0, 3);
  // Top 20 for horizontal sports ticker at bottom
  const top20Leaders = chipLeaders.slice(0, 20);

  return (
    <>
      <SEOHead title="Commander — Clock Display" description="Club Commander Poker Room Management Tool." noindex={true} />

      {/* Ticker animations */}
      <style>{`
        html, body { overflow: hidden !important; overscroll-behavior: none !important; }
        @keyframes payoutTickerScroll {
          0% { transform: translateY(-50%); }
          100% { transform: translateY(0); }
        }
        .payout-ticker {
          animation: payoutTickerScroll 15s linear infinite;
        }
        @keyframes sportsTickerScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .sports-ticker {
          animation: sportsTickerScroll 75s linear infinite;
        }
      `}</style>

      <div style={{
        ...S.container, ...bgStyle,
        transform: `translate(${burnInOffset.x}px, ${burnInOffset.y}px)` }} onClick={goFullscreen}>

        {/* ===== HAND TIMER OVERLAY ===== */}
        {handTimerActive && (
          <div style={S.handTimerOverlay} onClick={(e) => { e.stopPropagation(); setHandTimerActive(false); }}>
            <div style={S.handTimerBox}>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 2, opacity: 0.7, marginBottom: 4 }}>PLAYER ON THE CLOCK</div>
              <div style={{ fontSize: 96, fontWeight: 800, fontFamily: "var(--font-inter), 'Segoe UI', sans-serif", fontFeatureSettings: "'zero' 0", color: handTimerSeconds <= 10 ? '#EF4444' : '#fff' }}>
                {handTimerSeconds}
              </div>
              <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>Click to dismiss</div>
            </div>
          </div>
        )}

        {/* ===== MANAGEMENT CONTROLS ===== */}
        {showControls && (
          <div style={S.controlBar} onClick={e => e.stopPropagation()}>
            <button style={{ ...S.controlBtn, background: 'rgba(239,68,68,0.3)', borderColor: '#EF4444' }} onClick={() => clockAction('previous_level')} disabled={actionLoading}>
              ← Prev Level
            </button>
            {data?.clock?.clock_state?.status === 'running' ? (
              <button style={{ ...S.controlBtn, ...S.controlBtnPrimary, background: 'rgba(245,158,11,0.3)', borderColor: '#F59E0B' }} onClick={() => clockAction('pause')} disabled={actionLoading}>
                ⏸ Pause
              </button>
            ) : (
              <button style={{ ...S.controlBtn, ...S.controlBtnPrimary, background: 'rgba(49,162,76,0.3)', borderColor: '#31A24C' }} onClick={() => clockAction('resume')} disabled={actionLoading}>
                ▶ Resume
              </button>
            )}
            <button style={{ ...S.controlBtn, background: 'rgba(24,119,242,0.3)', borderColor: '#1877F2' }} onClick={() => clockAction('next_level')} disabled={actionLoading}>
              Next Level →
            </button>
            <button style={{ ...S.controlBtn, background: 'rgba(139,92,246,0.3)', borderColor: '#8B5CF6' }} onClick={() => { setHandTimerSeconds(60); setHandTimerActive(true); }}>
              Hand Timer
            </button>
            {/* Screen selector */}
            <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
              {[
                { key: SCREENS.CLOCK, label: 'Clock' },
                { key: SCREENS.PAYOUTS, label: 'Payouts' },
                { key: SCREENS.SCHEDULE, label: 'Schedule' },
                { key: SCREENS.ICM, label: 'ICM' },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setActiveScreen(key)} style={{
                  ...S.controlBtn, padding: '8px 14px', fontSize: 13,
                  background: activeScreen === key ? 'rgba(24,119,242,0.4)' : 'rgba(255,255,255,0.1)',
                  borderColor: activeScreen === key ? '#1877F2' : 'rgba(255,255,255,0.2)' }}>{label}</button>
              ))}
            </div>
            {/* Chop / ICM toggles */}
            <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
              <button onClick={() => setActiveScreen(SCREENS.ICM)} style={{
                ...S.controlBtn, padding: '8px 14px', fontSize: 12,
                background: 'rgba(49,162,76,0.3)', borderColor: '#31A24C' }}>Chop / ICM</button>
            </div>
          </div>
        )}

        {/* ===== HEADER ===== */}
        <div style={{ ...S.header, background: theme.headerBg, borderBottomColor: theme.accent + '26' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            {displayOpts.logo_url && <img src={displayOpts.logo_url} alt="" style={{ height: 32 }}  loading="lazy" />}
            <div style={{ ...S.headerTitle, fontSize: 44, textTransform: 'uppercase' }}>{t.name || 'Tournament'}</div>
          </div>
        </div>

        {/* 2026-07-25 audit fix: staff announcement banner */}
        {messageActive && (
          <div style={S.messageBanner}>{currentMessage.text}</div>
        )}

        {/* ===== MAIN CONTENT — SCREEN SWITCHER ===== */}
        {activeScreen === SCREENS.CLOCK && (
          <>
            <div style={S.main}>
              {/* LEFT — Stats */}
              <div style={S.leftPanel}>
                <StatCell label="Round" value={isBreak ? 'Break' : currentLevel} />
                <StatCell label="Entries" value={totalEntries} />
                <StatCell label="Players In" value={playersIn} />
                {t.allows_rebuys && <StatCell label="Rebuys" value={totalRebuys} />}{/* 2026-08-04 audit fix: floor-view exposes allows_rebuys, not rebuy_allowed */}
                <StatCell label="Chip Count" value={formatChipCount(totalChips)} />
                <StatCell label="Avg Stack" value={formatChipCount(avgStack)} />
                <StatCell label="Total Pot" value={formatMoney(prizePool)} />
              </div>

              {/* CENTER — Clock + Blinds + Top 3 Leaders */}
              <div style={S.centerPanel}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: '100%' }}>
                  {isH4H && <div style={S.h4hBanner}>HAND FOR HAND</div>}
                  {isBreak && !isH4H && <div style={S.breakBanner}>BREAK</div>}

                  <div style={{ ...S.timer, color: '#FFFFFF', cursor: 'pointer' }} onClick={toggleControls}>
                    {formatClock(displaySeconds)}
                  </div>

                  {data?.clock?.clock_state?.status === 'paused' && <div style={S.pausedBanner}>PAUSED</div>}
                </div>

                <div style={S.blindsBlock}>
                  <div style={{ ...S.blindsLabel, color: '#FFFFFF' }}>Blinds</div>
                  <div style={{ ...S.blindsValue, color: '#FFFFFF' }}>
                    {(blinds.small_blind || 0).toLocaleString()} / {(blinds.big_blind || 0).toLocaleString()}
                  </div>
                  {(blinds.ante || 0) > 0 && <div style={{ ...S.blindsAnte, color: '#FFFFFF' }}>BB Ante: {(blinds.ante || 0).toLocaleString()}</div>}
                </div>

                {nextBlinds && Object.keys(nextBlinds || {}).length > 0 && (
                  <div style={S.nextRound}>
                    {nextBlinds.is_break ? (
                      <>
                        <div><strong>Next Round</strong> — BREAK ({nextBlinds.duration || 0} min)</div>
                        {afterBreakBlinds && (
                          <div style={{ fontSize: '0.78em', opacity: 0.75, marginTop: 4 }}>
                            After Break: {(afterBreakBlinds.small_blind || 0).toLocaleString()} / {(afterBreakBlinds.big_blind || 0).toLocaleString()}
                            {(afterBreakBlinds.ante || 0) > 0 && <> — BB Ante: {(afterBreakBlinds.ante || 0).toLocaleString()}</>}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <strong>Next Round</strong> — Blinds: {(nextBlinds.small_blind || 0).toLocaleString()} / {(nextBlinds.big_blind || 0).toLocaleString()}
                        {(nextBlinds.ante || 0) > 0 && <> | BB Ante: {(nextBlinds.ante || 0).toLocaleString()}</>}
                      </>
                    )}
                  </div>
                )}

                {/* Top 3 Chip Leaders — fixed under Next Round */}
                {top3Leaders.length > 0 && (
                  <div style={S.top3Container}>
                    <div style={S.top3Header}>CURRENT CHIP LEADERS</div>
                    {top3Leaders.map((player, i) => (
                      <div key={i} style={{ ...S.top3Row, borderBottom: i === top3Leaders.length - 1 ? 'none' : S.top3Row.borderBottom }}>
                        <span style={{ fontSize: 35, fontWeight: 800, opacity: 0.5, minWidth: 30 }}>{i + 1}</span>
                        <span style={{ flex: 1, fontSize: 35, fontWeight: 700 }}>{player.name || 'Player'}</span>
                        <span style={{ fontSize: 35, fontWeight: 800, color: '#FFFFFF' }}>{formatChipCount(player.chips)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* RIGHT — Next Break (compact) + Payouts Ticker */}
              <div style={S.rightPanel}>
                <div style={S.nextBreakCompact}>
                  <div style={S.statLabel}>Next Break</div>
                  <div style={S.statValue}>{nextBreakSec ? formatClock(nextBreakSec) : '--:--'}</div>
                </div>

                {/* Payouts — all white, auto-scrolling ticker (dynamic) */}
                {remainingPayouts.length > 0 && (
                  <div style={S.rightSection}>
                    <div style={S.rightSectionHeader}>Remaining Payouts</div>
                    <div style={S.payoutTickerViewport} ref={payoutViewportRef}>
                      <div className={needsPayoutScroll ? "payout-ticker" : ""} ref={payoutContentRef}>
                        {(needsPayoutScroll ? [...remainingPayouts, ...remainingPayouts] : remainingPayouts).map((p, i) => {
                          const idx = i % remainingPayouts.length;
                          const amount = p.amount || (prizePool * (p.percentage || 0) / 100);
                          const place = idx === 0 ? '1st' : idx === 1 ? '2nd' : idx === 2 ? '3rd' : `${idx + 1}th`;
                          return (
                            <div key={i} style={S.payoutRow}>
                              <span style={{ opacity: 0.6, minWidth: 40, fontSize: 26, fontWeight: 600 }}>{place}</span>
                              <span style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 30 }}>{formatMoney(amount)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* BOTTOM — Chip Leaders horizontal sports ticker (top 20) */}
            {top20Leaders.length > 0 && (
              <div style={S.sportsTickerBar}>
                <div className="sports-ticker" style={S.sportsTickerTrack}>
                  {[...top20Leaders, ...top20Leaders].map((player, i) => (
                    <span key={i} style={S.sportsTickerItem}>
                      <span style={{ opacity: 0.5, fontWeight: 800 }}>{(i % top20Leaders.length) + 1}.</span>{' '}
                      <span style={{ fontWeight: 700 }}>{player.name || 'Player'}</span>{' '}
                      <span style={{ color: '#FFFFFF', fontWeight: 800 }}>{formatChipCount(player.chips)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== PAYOUTS SCREEN ===== */}
        {activeScreen === SCREENS.PAYOUTS && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 3, opacity: 0.5, marginBottom: 16, textTransform: 'uppercase' }}>Prize Pool: {formatMoney(prizePool)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto', gap: '8px 24px', fontSize: 24, fontWeight: 700 }}>
              {payouts.slice(0, 10).map((p, i) => {
                const amount = p.amount || (prizePool * (p.percentage || 0) / 100);
                const place = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`;
                return (
                  <React.Fragment key={i}>
                    <span style={{ opacity: 0.5, textAlign: 'right' }}>{place}</span>
                    <span>—</span>
                    <span style={{ color: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '#fff' }}>{formatMoney(amount)}</span>
                  </React.Fragment>
                );
              })}
            </div>
            {payouts.length === 0 && <div style={{ opacity: 0.3, fontSize: 20, marginTop: 20 }}>Payouts TBD</div>}
          </div>
        )}

        {/* ===== SCHEDULE SCREEN ===== */}
        {activeScreen === SCREENS.SCHEDULE && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 3, opacity: 0.5, marginBottom: 16, textTransform: 'uppercase' }}>Blind Schedule</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto auto auto', gap: '6px 20px', fontSize: 18, fontWeight: 600 }}>
              <span style={{ fontWeight: 700, opacity: 0.5, fontSize: 13 }}>Level</span>
              <span style={{ fontWeight: 700, opacity: 0.5, fontSize: 13 }}>Small</span>
              <span style={{ fontWeight: 700, opacity: 0.5, fontSize: 13 }}>Big</span>
              <span style={{ fontWeight: 700, opacity: 0.5, fontSize: 13 }}>Ante</span>
              <span style={{ fontWeight: 700, opacity: 0.5, fontSize: 13 }}>Time</span>
              {blindStructure.slice(Math.max(0, (clock.current_level || 0) - 1), (clock.current_level || 0) + 6).map((level, i) => {
                const levelNum = Math.max(0, (clock.current_level || 0) - 1) + i + 1;
                const isCurrent = levelNum === currentLevel;
                return (
                  <React.Fragment key={i}>
                    <span style={{ color: isCurrent ? '#1877F2' : '#fff', fontWeight: isCurrent ? 800 : 600 }}>{level.is_break ? 'Break' : levelNum}</span>
                    <span style={{ color: isCurrent ? '#1877F2' : '#fff' }}>{level.is_break ? '-' : (level.small_blind || 0).toLocaleString()}</span>
                    <span style={{ color: isCurrent ? '#1877F2' : '#fff' }}>{level.is_break ? '-' : (level.big_blind || 0).toLocaleString()}</span>
                    <span style={{ color: isCurrent ? '#1877F2' : '#fff' }}>{level.is_break ? '-' : (level.ante || 0).toLocaleString()}</span>
                    <span style={{ color: isCurrent ? '#1877F2' : '#fff' }}>{level.duration || '-'}m</span>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== ICM / CHOP CALCULATOR SCREEN ===== */}
        {activeScreen === SCREENS.ICM && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            {/* Header + Mode Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 12, flexShrink: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 3, opacity: 0.5, textTransform: 'uppercase' }}>
                {chopMode === 'icm' ? 'ICM Chop Calculator' : 'Chip Chop Calculator'}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => setChopMode('icm')} style={{
                  padding: '6px 16px', borderRadius: 6, border: '2px solid',
                  borderColor: chopMode === 'icm' ? '#31A24C' : 'rgba(255,255,255,0.2)',
                  background: chopMode === 'icm' ? 'rgba(49,162,76,0.3)' : 'rgba(255,255,255,0.05)',
                  color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>ICM</button>
                <button onClick={() => setChopMode('chip_chop')} style={{
                  padding: '6px 16px', borderRadius: 6, border: '2px solid',
                  borderColor: chopMode === 'chip_chop' ? '#1877F2' : 'rgba(255,255,255,0.2)',
                  background: chopMode === 'chip_chop' ? 'rgba(24,119,242,0.3)' : 'rgba(255,255,255,0.05)',
                  color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Chip Chop</button>
              </div>
            </div>

            {/* Prize Pool + Load from API */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 12, flexShrink: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                Prize Pool: <span style={{ color: '#31A24C' }}>{formatMoney(prizePool)}</span>
              </div>
              <button onClick={() => {
                const stacks = (stats.player_stacks || []).filter(p => p.chips > 0).sort((a, b) => b.chips - a.chips);
                setEditableStacks(stacks.map(p => ({ name: p.name || 'Player', chips: p.chips })));
              }} style={{
                padding: '6px 14px', borderRadius: 6, border: '2px solid rgba(24,119,242,0.5)',
                background: 'rgba(24,119,242,0.15)', color: '#1877F2', fontSize: 12,
                fontWeight: 700, cursor: 'pointer' }}>Load from Tournament</button>
              <button onClick={() => {
                setEditableStacks([...editableStacks, { name: `Player ${editableStacks.length + 1}`, chips: 0 }]);
              }} style={{
                padding: '6px 14px', borderRadius: 6, border: '2px solid rgba(49,162,76,0.5)',
                background: 'rgba(49,162,76,0.15)', color: '#31A24C', fontSize: 12,
                fontWeight: 700, cursor: 'pointer' }}>+ Add Player</button>
              <div style={{ fontSize: 13, opacity: 0.5 }}>{editableStacks.length} Players</div>
            </div>

            {/* Editable player stacks table */}
            {editableStacks.length > 0 ? (
              <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                {/* Column headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 140px 140px 140px 80px 36px', gap: '0 12px', padding: '4px 8px', position: 'sticky', top: 0, background: 'rgba(13,25,46,0.95)', zIndex: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.4 }}>#</span>
                  <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.4 }}>PLAYER</span>
                  <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.4 }}>CHIPS</span>
                  <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.4, color: '#31A24C' }}>{chopMode === 'icm' ? 'ICM VALUE' : 'CHOP VALUE'}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.4, color: '#1877F2' }}>{chopMode === 'icm' ? 'CHIP CHOP' : 'VS ICM'}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.4 }}>EQUITY</span>
                  <span></span>
                </div>

                {(() => {
                  const stacks = editableStacks.map(p => p.chips).filter(c => c > 0);
                  const icm = stacks.length > 1 ? calculateICM(stacks, prizeAmounts) : [];
                  const chipChop = stacks.length > 1 ? calculateChipChop(stacks, prizePool) : [];
                  let icmIdx = 0;

                  return editableStacks.map((player, i) => {
                    const isValid = player.chips > 0;
                    const icmRow = isValid ? icm[icmIdx] : null;
                    const chopRow = isValid ? chipChop[icmIdx] : null;
                    if (isValid) icmIdx++;

                    return (
                      <div key={i} style={{
                        display: 'grid', gridTemplateColumns: '30px 1fr 140px 140px 140px 80px 36px',
                        gap: '0 12px', padding: '6px 8px', alignItems: 'center',
                        background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
                        borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <span style={{ fontSize: 14, fontWeight: 800, opacity: 0.4 }}>{i + 1}</span>
                        <input
                          value={player.name}
                          onChange={e => {
                            const updated = [...editableStacks];
                            updated[i] = { ...updated[i], name: e.target.value };
                            setEditableStacks(updated);
                          }}
                          style={{
                            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: 4, padding: '5px 8px', color: '#fff', fontSize: 14,
                            fontWeight: 600, fontFamily: "var(--font-inter), sans-serif", width: '100%' }}
                        />
                        <input
                          type="number"
                          value={player.chips || ''}
                          onChange={e => {
                            const updated = [...editableStacks];
                            updated[i] = { ...updated[i], chips: parseInt(e.target.value) || 0 };
                            setEditableStacks(updated);
                          }}
                          style={{
                            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: 4, padding: '5px 8px', color: '#fff', fontSize: 14,
                            fontWeight: 700, fontFamily: "var(--font-inter), sans-serif", width: '100%',
                            textAlign: 'right' }}
                        />
                        <span style={{ color: '#31A24C', fontWeight: 700, fontSize: 15, textAlign: 'right' }}>
                          {isValid && icmRow ? formatMoney(chopMode === 'icm' ? icmRow.equity : chopRow?.chop || 0) : '-'}
                        </span>
                        <span style={{ color: '#1877F2', fontWeight: 700, fontSize: 15, textAlign: 'right' }}>
                          {isValid && chopRow ? formatMoney(chopMode === 'icm' ? chopRow.chop : icmRow?.equity || 0) : '-'}
                        </span>
                        <span style={{ opacity: 0.6, fontSize: 13, textAlign: 'right' }}>
                          {isValid && icmRow ? `${icmRow.percentage}%` : '-'}
                        </span>
                        <button onClick={() => {
                          setEditableStacks(editableStacks.filter((_, j) => j !== i));
                        }} style={{
                          background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                          borderRadius: 4, color: '#EF4444', fontSize: 14, cursor: 'pointer',
                          padding: '4px 8px', fontWeight: 700 }}>×</button>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, opacity: 0.4 }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>No Players Entered</div>
                <div style={{ fontSize: 14 }}>Click "Load from Tournament" or "+ Add Player" to begin</div>
              </div>
            )}
          </div>
        )}

        {/* Footer removed — payouts now displayed in right panel */}

        {/* Branding */}
        <div style={{ position: 'absolute', bottom: 4, right: 12, opacity: 0.15, fontSize: 10, color: '#fff' }}>
          Powered by Smarter.Poker
        </div>
      </div>
    </>
  );
}

// Helper to darken/lighten hex color
function adjustColor(hex, amount) {
  try {
    const h = hex.replace('#', '');
    const r = Math.max(0, Math.min(255, parseInt(h.substring(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(h.substring(2, 4), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(h.substring(4, 6), 16) + amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  } catch { return hex; }
}

function StatCell({ label, value }) {
  return (
    <div style={S.statCell}>
      <div style={S.statLabel}>{label}</div>
      <div style={S.statValue}>{value}</div>
    </div>
  );
}

// Inline styles for zero-dependency TV rendering
const S = {
  loading: { minHeight: '100vh', background: '#0D192E', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  container: {
    height: '100vh', maxHeight: '100vh', fontFamily: "var(--font-inter), 'Segoe UI', sans-serif", color: '#fff',
    display: 'flex', flexDirection: 'column', userSelect: 'none', position: 'relative',
    overflow: 'hidden', transition: 'transform 0.5s ease', fontFeatureSettings: "'zero' 0",
    overscrollBehavior: 'none' },
  header: {
    background: 'rgba(0,0,0,0.3)', textAlign: 'center', padding: '10px 16px 8px',
    borderBottom: '2px solid rgba(255,255,255,0.15)', flexShrink: 0
  },
  headerTitle: { fontSize: 28, fontWeight: 700 },
  headerSub: { fontSize: 13, opacity: 0.65, marginTop: 2 },
  main: {
    flex: 1, display: 'grid', gridTemplateColumns: '160px 1fr 260px', minHeight: 0,
    overflow: 'hidden', borderBottom: '2px solid rgba(255,255,255,0.15)' },
  leftPanel: { display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  rightPanel: { display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  centerPanel: {
    display: 'flex', flexDirection: 'column',
    position: 'relative', padding: '0',
    overflow: 'hidden' },
  statCell: {
    flex: 1, background: 'rgba(255,255,255,0.06)', border: '2px solid rgba(255,255,255,0.15)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '4px 8px', textAlign: 'center'
  },
  statLabel: { fontSize: 18, color: '#FFFFFF', fontWeight: 600, lineHeight: 1.2 },
  statValue: { fontSize: 28, color: '#FFFFFF', fontWeight: 800, lineHeight: 1.3 },
  timer: {
    fontSize: 'min(15vw, 160px)', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
    lineHeight: 1, textShadow: '0 4px 20px rgba(0,0,0,0.5)', letterSpacing: -2,
    fontFamily: "var(--font-inter), 'Segoe UI', sans-serif", padding: '8px 0', textAlign: 'center', width: '100%',
    fontFeatureSettings: "'zero' 0" },
  blindsBlock: {
    background: 'rgba(0,0,0,0.25)', border: '2px solid rgba(255,255,255,0.15)',
    width: '100%', textAlign: 'center', padding: '8px 16px'
  },
  blindsGame: { fontSize: 16, opacity: 0.8, fontWeight: 500 },
  blindsLabel: { fontSize: 28, fontWeight: 600, opacity: 0.5 },
  blindsValue: { fontSize: 48, fontWeight: 800, lineHeight: 1.15 },
  blindsAnte: { fontSize: 34, fontWeight: 700 },
  nextRound: {
    background: 'rgba(0,0,0,0.15)', border: '2px solid rgba(255,255,255,0.12)',
    width: '100%', textAlign: 'center', padding: '20px 12px', fontSize: 27, lineHeight: 1.5, flexShrink: 0,
    overflow: 'hidden' },
  // Right panel sections — Prizes + Chip Leaders
  rightSection: {
    flex: 1, display: 'flex', flexDirection: 'column',
    background: 'rgba(255,255,255,0.04)',
    border: '2px solid rgba(255,255,255,0.12)',
    overflow: 'hidden', minHeight: 0 },
  // Top 3 chip leaders fixed at bottom
  top3Container: {
    width: '100%', background: 'rgba(0,0,0,0.2)', border: '2px solid rgba(255,255,255,0.10)',
    borderBottom: 'none', padding: '4px 16px', marginTop: 0, flexShrink: 0
  },
  top3Row: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  // Next Break — compact fixed-height box in right panel
  nextBreakCompact: {
    background: 'rgba(255,255,255,0.06)', border: '2px solid rgba(255,255,255,0.15)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '8px', textAlign: 'center', flexShrink: 0 },
  // Payout auto-scroll ticker viewport
  payoutTickerViewport: {
    flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0,
    WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 1%, black 99%, transparent)',
    maskImage: 'linear-gradient(to bottom, transparent, black 1%, black 99%, transparent)'
  },
  // Bottom sports ticker bar
  sportsTickerBar: {
    flexShrink: 0, background: 'rgba(0,0,0,0.4)',
    borderTop: '2px solid rgba(255,255,255,0.15)',
    overflow: 'hidden', whiteSpace: 'nowrap', height: 80,
    display: 'flex', alignItems: 'center' },
  sportsTickerTrack: {
    display: 'inline-flex', gap: 32, whiteSpace: 'nowrap', fontSize: 35 },
  sportsTickerItem: {
    display: 'inline-flex', gap: 6, alignItems: 'center' },
  rightSectionHeader: {
    fontSize: 22, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase',
    textAlign: 'center', padding: '10px 8px', color: '#FFFFFF',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(0,0,0,0.2)', flexShrink: 0 },
  top3Header: {
    fontSize: 22, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase',
    textAlign: 'center', padding: '10px 8px', color: '#FFFFFF',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    marginBottom: 8 },
  payoutScroll: {
    flex: 1, overflowY: 'auto', padding: '4px 10px',
    display: 'flex', flexDirection: 'column', gap: 2 },
  payoutRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  leadersScroll: {
    flex: 1, overflowY: 'auto', padding: '4px 8px',
    display: 'flex', flexDirection: 'column', gap: 3 },
  leaderRow: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  leaderRank: {
    fontSize: 13, fontWeight: 800, opacity: 0.5, minWidth: 18, textAlign: 'center' },
  leaderName: {
    flex: 1, fontSize: 13, fontWeight: 600, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  leaderChips: {
    fontSize: 13, fontWeight: 700, color: '#31A24C', whiteSpace: 'nowrap' },
  // Chip leaders in center panel (under blinds)
  chipLeadersCenter: {
    width: '100%', maxWidth: 500, marginTop: 8,
    background: 'rgba(0,0,0,0.25)', border: '2px solid rgba(255,255,255,0.12)',
    display: 'flex', flexDirection: 'column', maxHeight: 160, overflow: 'hidden' },
  chipLeadersHeader: {
    fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase',
    textAlign: 'center', padding: '4px 8px', opacity: 0.6,
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(0,0,0,0.2)', flexShrink: 0 },
  chipLeadersScroll: {
    flex: 1, overflowY: 'auto', padding: '2px 12px',
    display: 'flex', flexDirection: 'column', gap: 1 },
  chipLeaderItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  chipLeaderRank: {
    fontSize: 12, fontWeight: 800, opacity: 0.5, minWidth: 18, textAlign: 'center' },
  chipLeaderName: {
    flex: 1, fontSize: 13, fontWeight: 600, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  chipLeaderChips: {
    fontSize: 13, fontWeight: 700, color: '#31A24C', whiteSpace: 'nowrap' },
  breakBanner: {
    position: 'absolute', top: 8, background: 'rgba(245,158,11,0.2)',
    border: '2px solid rgba(245,158,11,0.5)', padding: '8px 32px', borderRadius: 8,
    color: '#F59E0B', fontSize: 28, fontWeight: 800, letterSpacing: 4, zIndex: 10
  },
  h4hBanner: {
    position: 'absolute', top: 8, background: 'rgba(239,68,68,0.2)',
    border: '2px solid rgba(239,68,68,0.5)', padding: '8px 32px', borderRadius: 8,
    color: '#EF4444', fontSize: 28, fontWeight: 800, letterSpacing: 4, zIndex: 10,
    animation: 'pulse 1.5s infinite'
  },
  // 2026-07-25 audit fix: banner style for staff floor messages
  messageBanner: {
    flexShrink: 0, textAlign: 'center', padding: '10px 24px',
    background: 'rgba(24,119,242,0.25)', borderBottom: '2px solid rgba(24,119,242,0.5)',
    color: '#fff', fontSize: 28, fontWeight: 800, letterSpacing: 1
  },
  pausedBanner: {
    background: 'rgba(245,158,11,0.2)', border: '2px solid rgba(245,158,11,0.5)',
    padding: '6px 28px', borderRadius: 8, color: '#F59E0B', fontSize: 24,
    fontWeight: 800, letterSpacing: 4, marginTop: 4
  },
  controlBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50,
    background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
    padding: '12px 24px', borderBottom: '2px solid rgba(255,255,255,0.2)',
    flexWrap: 'wrap'
  },
  controlBtn: {
    padding: '8px 18px', borderRadius: 8, border: '2px solid', color: '#fff',
    fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "var(--font-inter), sans-serif",
    transition: 'all 0.2s', opacity: 0.9
  },
  controlBtnPrimary: { padding: '10px 28px', fontSize: 16 },
  handTimerOverlay: {
    position: 'absolute', inset: 0, zIndex: 100,
    background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' },
  handTimerBox: {
    textAlign: 'center', padding: 40,
    border: '4px solid rgba(239,68,68,0.5)', borderRadius: 24,
    background: 'rgba(239,68,68,0.1)' } };
