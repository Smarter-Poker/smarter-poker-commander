/**
 * Dealer Tablet - Complete Table Management
 * /commander/dealer/[tableNumber]
 * 
 * Flow:
 * 1. Dealer taps empty seat → QR scanner opens
 * 2. Scan player's member QR code (CMD-xxxx-xxxxxxxx)
 * 3. System checks: active membership + time balance on account
 * 4. If valid → player seated, countdown timer starts
 * 5. All seated players show live countdown timers
 * 6. Low time warnings (< 15 min = yellow, < 5 min = red pulse)
 * 7. Dealer can add time, request floor, track hands
 * 
 * Designed for tablet mounted at dealer position
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import { AlertTriangle, Coffee, Hash, Loader2, RefreshCw, UserX, Bell, RotateCcw, ScanLine, Camera, X, CheckCircle2, Shield, Timer, Plus, DollarSign, AlertCircle, User, Power, Lock, Unlock, Trophy, ArrowRightLeft, Coins, Users } from 'lucide-react';
import { useCommanderSync, broadcastChange } from '../../../src/lib/commander/useCommanderSync';
import useWakeLock from '../../../src/hooks/useWakeLock';
import { busEmit } from '../../../src/engine/EventBus';
import { getToken, getStaffSession, getVenueId } from '../../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../../src/lib/commander/commanderFetch';

const TIER_COLORS = { standard: '#B0B3B8', gold: '#F59E0B', platinum: '#94A3B8', vip: '#A855F7' };

function formatCountdown(seconds) {
  if (seconds === null || seconds === undefined) return '--:--';
  if (seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Commander APIs answer with either { error: 'text' } or { error: { code, message } }.
// Reading the body regardless of status keeps the server's real message (rebuy
// period closed, seat occupied, add-on already taken) instead of a generic
// "network error" the dealer cannot act on.
async function readJson(res) {
  try { return await res.json(); } catch (e) { return null; }
}
function apiMessage(json, fallback) {
  const e = json && json.error;
  if (!e) return (json && json.message) || fallback;
  if (typeof e === 'string') return e;
  return e.message || fallback;
}

function getSeatPositions(count) {
  const positions = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
    positions.push({ x: 50 + Math.cos(angle) * 42, y: 50 + Math.sin(angle) * 35, seat: i + 1 });
  }
  return positions;
}

export default function DealerTablet() {

  useEffect(() => { busEmit.sessionStart('commander-dealer-tableNumber'); }, []);
  const router = useRouter();
  const { tableNumber } = router.query;
  const [table, setTable] = useState(null);
  const [seatedPlayers, setSeatedPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [handCount, setHandCount] = useState(0);
  const [floorRequested, setFloorRequested] = useState(false);
  const [breakTimer, setBreakTimer] = useState(null);
  const [breakSeconds, setBreakSeconds] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [targetSeat, setTargetSeat] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scannedMember, setScannedMember] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const longPressRef = useRef(null);
  const [addTimePlayer, setAddTimePlayer] = useState(null);
  const [addTimeMinutes, setAddTimeMinutes] = useState('60');
  const [addingTime, setAddingTime] = useState(false);
  const [tournamentMode, setTournamentMode] = useState(null); // null = cash, or { tournament_id, ... }
  const [bustingOut, setBustingOut] = useState(null); // player being busted
  const [confirmRemoveAll, setConfirmRemoveAll] = useState(false);
  const [removingAll, setRemovingAll] = useState(false);
  const [tournamentActionPlayer, setTournamentActionPlayer] = useState(null); // player tapped in tournament mode
  const [chipEntryPlayer, setChipEntryPlayer] = useState(null); // chip entry modal
  const [chipEntryValue, setChipEntryValue] = useState('');
  const [savingChips, setSavingChips] = useState(false);
  // ── Tournament Director surface (the tablet IS the TD console for this table) ──
  const [levelRemaining, setLevelRemaining] = useState(null); // ticks locally, resyncs each fetch
  const clockAnchorRef = useRef({ remaining: null, at: 0, running: false });
  const [tdBusy, setTdBusy] = useState(''); // '' | 'rebuy' | 'addon' | 'move' | 'promote' | 'restore'
  const [movePlayerFor, setMovePlayerFor] = useState(null); // player being moved to another table/seat
  const [emptySeatAction, setEmptySeatAction] = useState(null); // seat number tapped while empty
  const [seatMovePicker, setSeatMovePicker] = useState(null); // seat number to move someone INTO
  const [tdNotice, setTdNotice] = useState(null); // { title, lines: [] }
  const [lastBusted, setLastBusted] = useState(null); // { entry_id, player_name, seat_number }
  const [restoreConfirm, setRestoreConfirm] = useState(null); // 409 PAYOUT_RECORDED confirm-then-force
  const [currentDealer, setCurrentDealer] = useState(null); // { name, started_at, rotation_id }
  const [dealerPushMenu, setDealerPushMenu] = useState(false);
  const [screenLocked, setScreenLocked] = useState(false);
  const [dealerScanMode, setDealerScanMode] = useState(false); // true when scanning for dealer (not player)
  const dealerLongPressRef = useRef(null);

  // Staff session token for write operations (x-staff-session header)

  const fetchTable = useCallback(async (signal) => {

  if (!router.isReady) return null;

    if (!tableNumber) return;
    try {
      const token = getToken();
      const headers = { };
      // Fetch table by number (includes mode, tournament_id from assignment system)
      const tableRes = await commanderFetch(`/api/commander/tables/by-number?tableNumber=${tableNumber}`, { headers, signal });
      if (!tableRes.ok) throw new Error(`Table fetch failed (${tableRes.status})`);
      const tableJson = await tableRes.json();

      if (!tableJson.success) { setLoading(false); return; }
      const tbl = tableJson.data;
      setTable(tbl);
      // Seed hand count from persisted DB value
      setHandCount(tbl.hands_dealt || 0);

      // Fetch current dealer for this table
      try {
        const dealerRes = await commanderFetch(`/api/commander/dealer/current?table=${tableNumber}`, { headers });
        if (!dealerRes.ok) throw new Error(`Dealer fetch failed (${dealerRes.status})`);
        const dealerJson = await dealerRes.json();
        if (dealerJson.success && dealerJson.data?.dealer) {
          setCurrentDealer(dealerJson.data.dealer);
        } else {
          setCurrentDealer(null);
        }
      } catch { setCurrentDealer(null); }

      // Route based on table mode set by floor manager in Table Assignments
      if (tbl.mode === 'tournament' && tbl.tournament_id) {
        // TOURNAMENT MODE - get players from tournament floor-view
        try {
          // Payload split: this tablet draws the header, the level clock, the
          // room stats, the break flag, the table map (for the move picker)
          // and the alternates queue. It never draws the full entry list.
          const tRes = await commanderFetch(
            `/api/commander/tournaments/${tbl.tournament_id}/floor-view?include=tournament,clock,stats,alerts,tables,alternates`,
            { headers }
          );
          if (!tRes.ok) throw new Error(`Tournament fetch failed (${tRes.status})`);
          const tJson = await tRes.json();
          if (tJson.success) {
            const tData = tJson.data;
            setTournamentMode({
              tournament_id: tbl.tournament_id,
              name: tData?.tournament?.name || tbl.tournament?.name || 'Tournament',
              status: tData?.tournament?.status || tbl.tournament?.status || null,
              players_remaining: tData?.stats?.players_remaining || 0,
              total_entries: tData?.stats?.total_entries || 0,
              average_stack: tData?.stats?.average_stack || 0,
              on_break: tData?.alerts?.on_break === true,
              clock: tData?.clock || null,
              tables: tData?.tables || [],
              alternates: tData?.alternates || []
              // `entries` used to be copied in here and was read by nothing on
              // this screen. It is the single biggest section of the floor
              // view payload, so it is no longer requested at all.
            });
            // Anchor the level clock so the tablet can tick locally between the
            // 30s polls; every fetch re-anchors it, so it cannot drift.
            const remainingSeconds = tData?.clock?.clock_state?.remaining_seconds;
            clockAnchorRef.current = {
              remaining: typeof remainingSeconds === 'number' ? remainingSeconds : null,
              at: Date.now(),
              running: tData?.clock?.clock_state?.status === 'running'
            };
            setLevelRemaining(typeof remainingSeconds === 'number' ? remainingSeconds : null);
            // Populate seats from tournament data (has entry_id, chips)
            const thisTable = (tData?.tables || []).find(t => String(t.table_number) === String(tableNumber));
            if (thisTable) {
              setSeatedPlayers((thisTable.players || []).map(p => ({
                ...p,
                session_id: p.entry_id,
                player_name: p.player_name,
                seat_number: p.seat_number,
                current_chips: p.current_chips,
                time_remaining: null
              })));
            } else {
              setSeatedPlayers([]);
            }
          }
        } catch (e) { console.warn('Tournament fetch error:', e); }
      } else {
        // CASH MODE or INACTIVE - get player sessions
        setTournamentMode(null);
        clockAnchorRef.current = { remaining: null, at: 0, running: false };
        setLevelRemaining(null);
        try {
          const sessionsRes = await commanderFetch(`/api/commander/dealer/sessions?table=${tableNumber}`, { headers });
          if (!sessionsRes.ok) throw new Error(`Sessions fetch failed (${sessionsRes.status})`);
          const sessionsJson = await sessionsRes.json();
          if (sessionsJson.success) setSeatedPlayers(sessionsJson.data || []);
        } catch (e) { console.warn('Sessions fetch error:', e); }
      }
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, [tableNumber]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTable(controller.signal);
    return () => { controller.abort(); };
  }, [fetchTable]); // the fallback poll lives in useCommanderSync below

  // Extract venueId for cross-device Supabase sync
  const [venueId] = useState(() => {
    return getVenueId();
  });

  // Commander Data Bus - instant cross-tab sync + Supabase Realtime cross-device.
  // 'tournaments' is in the entity list because this tablet anchors the level
  // clock from the poll: a level advance writes commander_tournaments, so the
  // channel carries it and the fallback poll is allowed to back off. Without
  // that entity the backoff would let a blind change show up late.
  // fastMs matches the 30s interval this page used to run unconditionally.
  useCommanderSync(venueId, fetchTable, {
    entities: ['tables', 'games', 'dealers', 'tournaments'],
    poll: { fastMs: 30000, slowMs: 180000 }
  });

  // Keep screen awake - this is a dealer tablet mounted at the table
  useWakeLock();

  // Store last sync timestamp for drift-free countdown
  const lastSyncRef = useRef(Date.now());
  const serverSnapshotRef = useRef({});

  // When seatedPlayers updates from server, snapshot the server values + timestamp
  useEffect(() => {
    lastSyncRef.current = Date.now();
    const snapshot = {};
    seatedPlayers.forEach(p => {
      if (p.time_remaining !== null && p.time_remaining !== undefined) {
        snapshot[p.seat_number] = p.time_remaining;
      }
    });
    serverSnapshotRef.current = snapshot;
  }, [seatedPlayers.length, seatedPlayers.map(p => p.session_id).join(',')]);

  // Drift-free countdown ticker - computes display time from server anchor
  const [displayPlayers, setDisplayPlayers] = useState([]);
  useEffect(() => {
    const ticker = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastSyncRef.current) / 1000);
      setDisplayPlayers(seatedPlayers.map(p => {
        const serverTime = serverSnapshotRef.current[p.seat_number];
        if (serverTime !== undefined) {
          return { ...p, time_remaining: Math.max(0, serverTime - elapsed) };
        }
        return p;
      }));
    }, 1000);
    // Initialize immediately
    setDisplayPlayers(seatedPlayers);
    return () => clearInterval(ticker);
  }, [seatedPlayers]);

  // Break timer
  useEffect(() => {
    if (!breakTimer) return;
    const i = setInterval(() => setBreakSeconds(Math.floor((Date.now() - breakTimer) / 1000)), 1000);
    return () => clearInterval(i);
  }, [breakTimer]);

  // Tournament level countdown - ticks locally off the anchor set by fetchTable.
  // A paused clock holds its value instead of counting down.
  useEffect(() => {
    if (!tournamentMode) return;
    const i = setInterval(() => {
      const a = clockAnchorRef.current;
      if (a.remaining === null || a.remaining === undefined) { setLevelRemaining(null); return; }
      if (!a.running) { setLevelRemaining(a.remaining); return; }
      const elapsed = Math.floor((Date.now() - a.at) / 1000);
      setLevelRemaining(Math.max(0, a.remaining - elapsed));
    }, 1000);
    return () => clearInterval(i);
  }, [tournamentMode]);

  const openScanner = (seatNum) => {
    setTargetSeat(seatNum); setScannerOpen(true); setScanError(''); setScannedMember(null); setManualCode('');
  };
  const closeScanner = () => {
    stopCamera(); setScannerOpen(false); setTargetSeat(null); setScannedMember(null); setScanError(''); setManualCode(''); setDealerScanMode(false);
  };

  const startCamera = async () => {
    setScanError(''); setScannedMember(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setScanning(true);
      detectQR();
    } catch { setScanError('Camera Access Denied. Use Manual Entry.'); }
  };

  const stopCamera = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setScanning(false);
  };

  const detectQR = () => {
    if (!videoRef.current || videoRef.current.readyState !== 4) {
      animFrameRef.current = requestAnimationFrame(detectQR); return;
    }
    try {
      if ('BarcodeDetector' in window) {
        new BarcodeDetector({ formats: ['qr_code'] }).detect(videoRef.current).then(barcodes => {
          if (barcodes.length > 0) {
            const code = barcodes[0].rawValue;
            if (code.startsWith('CMD-') || code.includes('/check-in/')) {
              stopCamera();
              if (dealerScanMode) {
                dealerScanIn(code);
              } else {
                lookupMember(code);
              }
              return;
            }
          }
          animFrameRef.current = requestAnimationFrame(detectQR);
        }).catch(() => { animFrameRef.current = requestAnimationFrame(detectQR); });
      } else { animFrameRef.current = requestAnimationFrame(detectQR); }
    } catch { animFrameRef.current = requestAnimationFrame(detectQR); }
  };

  // Dealer scan-in handler
  const dealerScanIn = async (qrCode) => {
    setScanLoading(true); setScanError('');
    try {
      const staffSession = getStaffSession();
      let vid = '';
      try { vid = JSON.parse(staffSession).venue_id || ''; } catch (e) { console.warn("[[tableNumber].js]", e); }
      const res = await commanderFetch('/api/commander/dealer/scan-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_code: qrCode, table_number: parseInt(tableNumber), venue_id: vid })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setCurrentDealer(json.data.dealer);
        setScannerOpen(false);
        setDealerScanMode(false);
        broadcastChange('dealers');
      } else {
        setScanError(json.error || 'Dealer Scan Failed');
      }
    } catch (err) { setScanError('Network Error, Try Again'); }
    finally { setScanLoading(false); }
  };

  const lookupMember = async (qrCode) => {
    setScanLoading(true); setScanError('');
    try {
      const token = getToken();
      const res = await commanderFetch('/api/commander/dealer/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_code: qrCode, table_number: parseInt(tableNumber) })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Member Not Found');
      setScannedMember(json.data);
    } catch (err) { setScanError(err.message); }
    finally { setScanLoading(false); }
  };

  const seatPlayer = async () => {
    if (!scannedMember || !targetSeat) return;
    setScanLoading(true);
    try {
      const token = getToken();
      const res = await commanderFetch('/api/commander/dealer/seat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: scannedMember.member.id,
          table_number: parseInt(tableNumber),
          seat_number: targetSeat,
          time_minutes: scannedMember.time_balance_minutes || 0
        })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed To Seat Player');
      closeScanner(); await fetchTable();
      broadcastChange('tables');
    } catch (err) { setScanError(err.message); }
    finally { setScanLoading(false); }
  };

  const removePlayer = async (sessionId) => {
    try {
      const token = getToken();
      const res = await commanderFetch(`/api/commander/dealer/sessions/${sessionId}/end`, {
        method: 'POST'});
      if (res.ok) {
        await fetchTable();
        broadcastChange('tables');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action Failed. Please Check Your Connection And Try Again.' }); }
  setScanLoading(false);
  };

  const addTime = async () => {
    if (!addTimePlayer) return;
    setAddingTime(true);
    try {
      const token = getToken();
      const res = await commanderFetch(`/api/commander/dealer/sessions/${addTimePlayer.session_id}/add-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: parseInt(addTimeMinutes) || 60 })
      });
      if (res.ok) {
        setAddTimePlayer(null); await fetchTable();
        broadcastChange('tables');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action Failed. Please Check Your Connection And Try Again.' }); }
    finally { setAddingTime(false); }
  };

  // Tournament: Bust out a player
  const bustOutPlayer = async (player) => {
    if (!tournamentMode) return;
    const entryId = player.entry_id || player.id;
    setBustingOut(player);
    try {
      // Use the tournament eliminate API
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentMode.tournament_id}/eliminate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_id: entryId,
          finish_position: tournamentMode.players_remaining || 0,
          table_number: parseInt(tableNumber),
          seat_number: player.seat_number
        })
      });
      const json = await readJson(res);
      if (!res.ok || json?.success === false) {
        setToast({ type: 'error', text: apiMessage(json, 'Bust Out Failed.') });
        return;
      }
      // The eliminate response carries floor-level consequences the dealer has
      // to know about: an alternate auto-seated into the freed seat, and a
      // table the server broke on its own (with seat cards already queued at
      // the print station). Discarding them left the floor blind.
      const d = json?.data || {};
      setLastBusted({ entry_id: entryId, player_name: player.player_name, seat_number: player.seat_number });
      const lines = [];
      if (d.finishPosition) lines.push(`Finished In Position ${Number(d.finishPosition).toLocaleString()}.`);
      if (d.payoutAmount > 0) lines.push(`Payout ${Number(d.payoutAmount).toLocaleString()}.`);
      if (d.promoted_alternate) {
        lines.push(`Alternate ${d.promoted_alternate.player_name} Was Seated At Table ${d.promoted_alternate.table_number}, Seat ${d.promoted_alternate.seat_number}.`);
      }
      if (d.auto_break && d.auto_break.executed) {
        const ab = d.auto_break;
        const moved = Number(ab.players_moved || 0);
        lines.push(ab.print_job_id
          ? `Table ${ab.break_table} Was Broken, ${moved.toLocaleString()} Card${moved === 1 ? '' : 's'} Queued At The Print Station.`
          : `Table ${ab.break_table} Was Broken, ${moved.toLocaleString()} Player${moved === 1 ? '' : 's'} Moved.`);
      }
      if (lines.length > 0) {
        setTdNotice({ title: `${player.player_name} Busted Out`, lines });
      } else {
        setToast({ type: 'success', text: `${player.player_name} Busted Out.` });
      }
      // Also remove from table session if applicable - non-fatal cleanup.
      // In tournament mode session_id is just the entry_id (set in fetchTable),
      // not a real table session, so skip it; and a failed cleanup must not
      // report the whole bust-out as failed after eliminate already succeeded.
      if (player.session_id && player.session_id !== (player.entry_id || player.id)) {
        const res = await commanderFetch(`/api/commander/dealer/sessions/${player.session_id}/end`, {
          method: 'POST'}).catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
        if (!res || !res.ok) console.warn('Session end after bust-out failed (non-fatal)');
      }
      await fetchTable();
      broadcastChange('tables');
      broadcastChange('tournaments');
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Bust Out Failed. Check Console.' }); }
    finally { setBustingOut(null); }
  };

  // Tournament: Rebuy for a seated player
  const rebuyPlayer = async (player) => {
    if (!tournamentMode) return;
    const entryId = player.entry_id || player.id;
    setTdBusy('rebuy');
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentMode.tournament_id}/entries/${entryId}/rebuy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const json = await readJson(res);
      if (!res.ok || json?.success === false) {
        setToast({ type: 'error', text: apiMessage(json, 'Rebuy Failed.') });
        return;
      }
      const d = json?.data || {};
      setToast({
        type: 'success',
        text: `Rebuy ${Number(d.rebuy_number || 1).toLocaleString()} For ${player.player_name}, Now ${Number(d.total_chips || 0).toLocaleString()} Chips.`
      });
      setTournamentActionPlayer(null);
      await fetchTable();
      broadcastChange('tables');
      broadcastChange('tournaments');
      broadcastChange('cashier');
    } catch (err) { console.warn('Rebuy error:', err); setToast({ type: 'error', text: 'Rebuy Failed. Please Check Your Connection And Try Again.' }); }
    finally { setTdBusy(''); }
  };

  // Tournament: Add-On for a seated player (one time only, enforced server-side)
  const addonPlayer = async (player) => {
    if (!tournamentMode) return;
    const entryId = player.entry_id || player.id;
    setTdBusy('addon');
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentMode.tournament_id}/entries/${entryId}/addon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const json = await readJson(res);
      if (!res.ok || json?.success === false) {
        setToast({ type: 'error', text: apiMessage(json, 'Add-On Failed.') });
        return;
      }
      const d = json?.data || {};
      setToast({
        type: 'success',
        text: `Add-On For ${player.player_name}, Now ${Number(d.total_chips || 0).toLocaleString()} Chips.`
      });
      setTournamentActionPlayer(null);
      await fetchTable();
      broadcastChange('tables');
      broadcastChange('tournaments');
      broadcastChange('cashier');
    } catch (err) { console.warn('Add-on error:', err); setToast({ type: 'error', text: 'Add-On Failed. Please Check Your Connection And Try Again.' }); }
    finally { setTdBusy(''); }
  };

  // Tournament: Move a player to another table and seat
  const movePlayerToSeat = async (player, toTable, toSeat) => {
    if (!tournamentMode) return;
    const entryId = player.entry_id || player.id;
    setTdBusy('move');
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentMode.tournament_id}/move-player`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_id: entryId, to_table: toTable, to_seat: toSeat })
      });
      const json = await readJson(res);
      if (!res.ok || json?.success === false) {
        setToast({ type: 'error', text: apiMessage(json, 'Move Failed.') });
        return;
      }
      const m = json?.data?.move || {};
      setToast({
        type: 'success',
        text: `${m.player_name || player.player_name} Moved To Table ${m.to_table || toTable}, Seat ${m.to_seat || toSeat}.`
      });
      setMovePlayerFor(null);
      setSeatMovePicker(null);
      setEmptySeatAction(null);
      setTournamentActionPlayer(null);
      await fetchTable();
      broadcastChange('tables');
      broadcastChange('tournaments');
    } catch (err) { console.warn('Move player error:', err); setToast({ type: 'error', text: 'Move Failed. Please Check Your Connection And Try Again.' }); }
    finally { setTdBusy(''); }
  };

  // Tournament: Seat a waiting alternate into a named seat at this table
  const promoteAlternateToSeat = async (alternate, seatNumber) => {
    if (!tournamentMode || !alternate?.entry_id) return;
    setTdBusy('promote');
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentMode.tournament_id}/entries/${alternate.entry_id}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_number: parseInt(tableNumber), seat_number: seatNumber })
      });
      const json = await readJson(res);
      if (!res.ok || json?.success === false) {
        setToast({ type: 'error', text: apiMessage(json, 'Could Not Seat Alternate.') });
        return;
      }
      setToast({ type: 'success', text: json?.data?.message || `${alternate.player_name} Seated At Seat ${seatNumber}.` });
      setEmptySeatAction(null);
      await fetchTable();
      broadcastChange('tables');
      broadcastChange('tournaments');
    } catch (err) { console.warn('Promote alternate error:', err); setToast({ type: 'error', text: 'Could Not Seat Alternate. Please Check Your Connection And Try Again.' }); }
    finally { setTdBusy(''); }
  };

  // Tournament: Undo an accidental bust. A 409 PAYOUT_RECORDED means money is
  // already recorded against the entry - confirm with the floor, then force it.
  const restoreEntry = async (entryId, playerName, force = false) => {
    if (!tournamentMode || !entryId) return;
    setTdBusy('restore');
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentMode.tournament_id}/entries/${entryId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(force ? { force: true } : {})
      });
      const json = await readJson(res);
      if (res.status === 409 && json?.error?.code === 'PAYOUT_RECORDED' && !force) {
        setRestoreConfirm({
          entry_id: entryId,
          player_name: playerName,
          message: apiMessage(json, 'A Payout Is Recorded For This Entry.')
        });
        return;
      }
      if (!res.ok || json?.success === false) {
        setToast({ type: 'error', text: apiMessage(json, 'Undo Bust Failed.') });
        return;
      }
      setRestoreConfirm(null);
      setLastBusted(null);
      setTournamentActionPlayer(null);
      setTdNotice({
        title: `${playerName} Is Back In`,
        lines: [json?.data?.message || 'Elimination Undone.']
      });
      await fetchTable();
      broadcastChange('tables');
      broadcastChange('tournaments');
    } catch (err) { console.warn('Restore entry error:', err); setToast({ type: 'error', text: 'Undo Bust Failed. Please Check Your Connection And Try Again.' }); }
    finally { setTdBusy(''); }
  };

  // Tournament: Update chip count for a player
  const updatePlayerChips = async () => {
    if (!chipEntryPlayer || !chipEntryValue) return;
    setSavingChips(true);
    try {
      const entryId = chipEntryPlayer.entry_id || chipEntryPlayer.id;
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentMode.tournament_id}/entries/${entryId}/chips`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chips: parseInt(chipEntryValue) || 0 })
      });
      const json = await readJson(res);
      if (!res.ok || json?.success === false) {
        setToast({ type: 'error', text: apiMessage(json, 'Failed To Update Chips.') });
        return;
      }
      setChipEntryPlayer(null);
      setChipEntryValue('');
      await fetchTable();
      broadcastChange('tables');
      broadcastChange('tournaments');
    } catch (err) { console.warn('Update chips error:', err); setToast({ type: 'error', text: 'Failed To Update Chips. Check Console.' }); }
    finally { setSavingChips(false); }
  };

  // Cash Game: Remove ALL players from this table
  const removeAllPlayers = async () => {
    setRemovingAll(true);
    try {
      const token = getToken();
      const headers = { };
      // End all active sessions for this table
      const results = await Promise.all(
        seatedPlayers.map(player =>
          commanderFetch(`/api/commander/dealer/sessions/${player.session_id}/end`, {
            method: 'POST', headers
          }).catch(e => console.warn('[App] Handled promise rejection:', e?.message || e))
        )
      );
      if (results.some(r => r && r.ok)) {
        setConfirmRemoveAll(false);
        await fetchTable();
        broadcastChange('tables');
      } else {
        setConfirmRemoveAll(false);
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action Failed. Please Check Your Connection And Try Again.' }); }
    finally { setRemovingAll(false); }
  };

  // Cash Game: Close table (set inactive via assignment API, no players left)
  const [closingTable, setClosingTable] = useState(false);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const closeTableAction = async () => {
    // The generic close endpoint nulls tournament_id and deletes the seat rows
    // while commander_tournament_entries keep pointing at this table number.
    // Doing that with live players on the table orphans them: they vanish from
    // the floor map but still count as remaining in the tournament. Breaking a
    // table is a TD console action, never a tablet one.
    if (tournamentMode && seatedPlayers.length > 0) {
      setToast({
        type: 'error',
        text: `Table ${tableNumber} Still Has ${seatedPlayers.length} Tournament Player${seatedPlayers.length === 1 ? '' : 's'}. Break This Table From The Tournament Director Console.`
      });
      return;
    }
    setClosingTable(true);
    try {
      const token = getToken();
      const res = await commanderFetch('/api/commander/table-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_id: table?.id })
      });
      const json = await readJson(res);
      if (res.ok && json?.success !== false) {
        // Redirect back to poker room - table is now inactive
        router.push('/commander/poker-room');
      } else {
        setToast({ type: 'error', text: apiMessage(json, 'Close Table Failed.') });
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action Failed. Please Check Your Connection And Try Again.' }); }
    finally { setClosingTable(false); }
  };

  const requestFloor = async () => {
    setFloorRequested(true);
    try {
      const token = getToken();
      const staffSession = getStaffSession();
      let vid = '';
      try { vid = JSON.parse(staffSession).venue_id || ''; } catch (e) { console.warn("[[tableNumber].js]", e); }
      const res = await commanderFetch('/api/commander/floor-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: vid, table_number: parseInt(tableNumber), reason: 'floor_assistance', description: `Floor requested at Table ${tableNumber}`, priority: 'normal', called_by: 'dealer' })
      });
      if (res.ok) broadcastChange('floor_calls');
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action Failed. Please Check Your Connection And Try Again.' }); }
    setTimeout(() => setFloorRequested(false), 30000);
  };

  if (loading) return <div className="min-h-screen bg-[#18191A] flex items-center justify-center"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" /></div>;

  const maxSeats = table?.max_seats || 9;
  const seatPositions = getSeatPositions(maxSeats);
  const lowTimePlayers = displayPlayers.filter(p => p.time_remaining !== null && p.time_remaining > 0 && p.time_remaining <= 900);

  return (
    <>
      <SEOHead
        title="Commander - Details"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <style>{`
        @keyframes pulse-warn { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .time-warn { animation: pulse-warn 1.5s ease-in-out infinite; }
      `}</style>
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter'] flex flex-col">
        {/* Header */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-xl font-bold text-white">Table {tableNumber}</h1>
            <p className="text-xs text-[#B0B3B8]">
              {tournamentMode
                ? <><span className="text-[#F59E0B] font-semibold">{tournamentMode.name}</span> - {seatedPlayers.length}/{maxSeats}</>
                : table?.mode === 'cash'
                  ? <>{table?.game_type || 'NLH'} {table?.stakes || '$1/$2'} - {seatedPlayers.length}/{maxSeats}</>
                  : table?.mode === 'inactive' || !table?.mode
                    ? <span className="text-[#6A6B6D]">Table Not Assigned, Contact Floor</span>
                    : <>{table?.game_type || 'NLH'} - {table?.stakes || '$1/$2'} - {seatedPlayers.length}/{maxSeats}</>
              }
            </p>
          </div>
          <div className="flex items-center gap-2">
            {table?.game?.is_must_move && (
              <div className="bg-[#F59E0B]/15 border border-[#F59E0B]/30 rounded-lg px-2.5 py-1.5">
                <span className="text-xs font-bold text-[#F59E0B]">MUST-MOVE</span>
              </div>
            )}
            {tournamentMode && (
              <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-lg px-2.5 py-1.5">
                <span className="text-xs font-bold text-[#F59E0B]">{tournamentMode.players_remaining} Left</span>
              </div>
            )}
            <div className="bg-[#3A3B3C] rounded-lg px-3 py-1.5 flex items-center gap-1.5">
              <Hash className="w-4 h-4 text-[#B0B3B8]" />
              <span className="text-sm font-mono font-bold text-white">{handCount}</span>
            </div>
            <button onClick={fetchTable} className="p-2 rounded-lg active:bg-[#3A3B3C]"><RefreshCw className="w-5 h-5 text-[#B0B3B8]" /></button>
          </div>
        </div>


        {/* Screen Lock Overlay */}
        {screenLocked && (
          <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center" onClick={() => setScreenLocked(false)}>
            <div className="text-center">
              <Lock className="w-16 h-16 text-[#B0B3B8] mx-auto mb-4" />
              <p className="text-xl font-bold text-white mb-2">Screen Locked</p>
              <p className="text-sm text-[#B0B3B8]">Tap Anywhere To Unlock</p>
            </div>
          </div>
        )}

        {/* Low Time Alert Banner */}
        {lowTimePlayers.length > 0 && (
          <div className="bg-[#F59E0B]/10 border-b border-[#F59E0B]/30 px-4 py-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#F59E0B]" />
            <p className="text-sm text-[#F59E0B]">
              {lowTimePlayers.map(p => `S${p.seat_number} ${p.player_name?.split(' ')[0]} (${formatCountdown(p.time_remaining)})`).join(' - ')}
            </p>
          </div>
        )}

        {/* TOURNAMENT HEADER - level, blinds, level clock, field size */}
        {tournamentMode && (() => {
          const cb = tournamentMode.clock?.current_blinds || {};
          const nb = tournamentMode.clock?.next_blinds || null;
          const isBreak = !!cb.is_break || tournamentMode.on_break;
          const levelText = isBreak
            ? (cb.label || 'Break')
            : `Level ${Number(tournamentMode.clock?.display_level || ((tournamentMode.clock?.current_level || 0) + 1)).toLocaleString()}`;
          const blindsText = (cb.small_blind || cb.big_blind)
            ? `${Number(cb.small_blind || 0).toLocaleString()} / ${Number(cb.big_blind || 0).toLocaleString()}`
            : '--';
          const anteText = cb.ante ? `Ante ${Number(cb.ante).toLocaleString()}` : 'No Ante';
          const nextText = nb && (nb.small_blind || nb.big_blind)
            ? `Next ${Number(nb.small_blind || 0).toLocaleString()} / ${Number(nb.big_blind || 0).toLocaleString()}${nb.ante ? `, Ante ${Number(nb.ante).toLocaleString()}` : ''}`
            : null;
          return (
            <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-2.5 flex-shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="w-4 h-4 text-[#F59E0B] flex-shrink-0" />
                <p className="text-sm font-bold text-[#F59E0B] truncate flex-1">{tournamentMode.name}</p>
                {isBreak && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F59E0B]/15 border border-[#F59E0B]/30 text-[#F59E0B]">On Break</span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-[#18191A] rounded-lg px-2 py-1.5 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-[#B0B3B8]">{isBreak ? 'Status' : 'Level'}</p>
                  <p className="text-sm font-bold text-white truncate">{levelText}</p>
                </div>
                <div className="bg-[#18191A] rounded-lg px-2 py-1.5 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-[#B0B3B8]">Blinds</p>
                  <p className="text-sm font-bold text-white truncate">{isBreak ? '--' : blindsText}</p>
                  <p className="text-[9px] text-[#B0B3B8] truncate">{isBreak ? 'Play Resumes Soon' : anteText}</p>
                </div>
                <div className="bg-[#18191A] rounded-lg px-2 py-1.5 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-[#B0B3B8]">Time Left</p>
                  <p className="text-sm font-mono font-bold text-[#31A24C]">
                    {levelRemaining === null || levelRemaining === undefined ? '--:--' : formatCountdown(levelRemaining)}
                  </p>
                </div>
                <div className="bg-[#18191A] rounded-lg px-2 py-1.5 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-[#B0B3B8]">Players</p>
                  <p className="text-sm font-bold text-white">{Number(tournamentMode.players_remaining || 0).toLocaleString()}</p>
                  <p className="text-[9px] text-[#B0B3B8] truncate">Avg {Number(tournamentMode.average_stack || 0).toLocaleString()}</p>
                </div>
              </div>
              {nextText && !isBreak && (
                <p className="text-[10px] text-[#B0B3B8] mt-1.5 text-center">{nextText}</p>
              )}
            </div>
          );
        })()}

        {/* SEAT MAP */}
        <div className="flex-1 relative p-4 overflow-hidden">
          <div className="relative w-full max-w-lg mx-auto" style={{ aspectRatio: '4/3' }}>
            <div className="absolute inset-[12%] rounded-[50%] bg-[#31A24C]/8 border-2 border-[#31A24C]/20" />
            {/* Dealer Position - center of table */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center flex flex-col items-center gap-2">
              <p className="text-[9px] text-[#B0B3B8] uppercase tracking-wider">T{tableNumber}</p>
              {breakTimer && <p className="text-sm font-mono font-bold text-[#F59E0B]">Break {Math.floor(breakSeconds / 60)}:{(breakSeconds % 60).toString().padStart(2, '0')}</p>}
              {/* Dealer Scan Button - shows "Scan Dealer" if none, dealer name if scanned */}
              <button
                onTouchStart={() => {
                  dealerLongPressRef.current = setTimeout(() => {
                    dealerLongPressRef.current = 'fired';
                    setDealerPushMenu(true);
                  }, 600);
                }}
                onTouchEnd={() => {
                  if (dealerLongPressRef.current !== 'fired') {
                    clearTimeout(dealerLongPressRef.current);
                    if (!currentDealer) {
                      setDealerScanMode(true);
                      setScannerOpen(true);
                      setTargetSeat(null);
                      setScanError('');
                      setScannedMember(null);
                      setManualCode('');
                    }
                  }
                  dealerLongPressRef.current = null;
                }}
                onMouseDown={() => {
                  dealerLongPressRef.current = setTimeout(() => {
                    dealerLongPressRef.current = 'fired';
                    setDealerPushMenu(true);
                  }, 600);
                }}
                onMouseUp={() => {
                  if (dealerLongPressRef.current !== 'fired') {
                    clearTimeout(dealerLongPressRef.current);
                    if (!currentDealer) {
                      setDealerScanMode(true);
                      setScannerOpen(true);
                      setTargetSeat(null);
                      setScanError('');
                      setScannedMember(null);
                      setManualCode('');
                    }
                  }
                  dealerLongPressRef.current = null;
                }}
                onContextMenu={e => e.preventDefault()}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 select-none ${currentDealer
                  ? 'bg-[#31A24C]/20 border border-[#31A24C]/40 text-[#31A24C]'
                  : 'bg-[#1877F2]/20 border border-[#1877F2]/40 text-[#1877F2] animate-pulse'
                  }`}>
                <ScanLine className="w-3.5 h-3.5" />
                {currentDealer ? currentDealer.name?.split(' ')[0] : 'Scan Dealer'}
              </button>
              {/* Lock Screen Button - in dealer position */}
              <button onClick={() => setScreenLocked(!screenLocked)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1 select-none ${screenLocked ? 'bg-[#EF4444]/20 border border-[#EF4444]/40 text-[#EF4444]' : 'bg-[#3A3B3C]/60 border border-[#4A4B4C]/40 text-[#8A8D91]'}`}>
                {screenLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                {screenLocked ? 'Locked' : 'Lock'}
              </button>
            </div>

            {/* Dealer Push Menu (long-press popup) */}
            {dealerPushMenu && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[120%] z-30 bg-[#242526] border border-[#3A3B3C] rounded-xl shadow-2xl p-3 w-48">
                <p className="text-xs text-[#B0B3B8] mb-2 text-center">Dealer Actions</p>
                <button onClick={() => {
                  setDealerPushMenu(false);
                  setDealerScanMode(true);
                  setScannerOpen(true);
                  setTargetSeat(null);
                  setScanError('');
                  setScannedMember(null);
                  setManualCode('');
                }}
                  className="w-full py-2.5 rounded-lg bg-[#1877F2] text-white text-sm font-semibold flex items-center justify-center gap-2 active:bg-[#1565D8] mb-1.5">
                  <Camera className="w-4 h-4" /> Dealer Push
                </button>
                <button onClick={() => setDealerPushMenu(false)}
                  className="w-full py-2 rounded-lg bg-[#3A3B3C] text-[#B0B3B8] text-xs font-medium active:bg-[#4A4B4C]">
                  Cancel
                </button>
              </div>
            )}
            {seatPositions.map(pos => {
              const player = displayPlayers.find(p => p.seat_number === pos.seat);
              const isEmpty = !player;
              const t = player?.time_remaining;
              const isLow = t !== null && t !== undefined && t <= 900 && t > 0;
              const isCritical = t !== null && t !== undefined && t <= 300 && t > 0;
              const isExpired = t !== null && t !== undefined && t <= 0;
              return (
                <div key={pos.seat} className="absolute flex flex-col items-center"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}>
                  {isEmpty ? (
                    <button onClick={() => tournamentMode ? setEmptySeatAction(pos.seat) : openScanner(pos.seat)}
                      className={`w-14 h-14 rounded-full border-2 border-dashed flex items-center justify-center ${tournamentMode ? 'bg-[#3A3B3C]/40 border-[#3A3B3C] active:bg-[#3A3B3C]' : 'bg-[#3A3B3C]/50 border-[#3A3B3C] active:bg-[#3A3B3C]'
                        }`}>
                      {tournamentMode
                        ? <span className="text-xs text-[#B0B3B8]">{pos.seat}</span>
                        : <ScanLine className="w-5 h-5 text-[#B0B3B8]" />
                      }
                    </button>
                  ) : (
                    <button
                      onTouchStart={() => { if (tournamentMode) longPressRef.current = setTimeout(() => { longPressRef.current = 'fired'; setTournamentActionPlayer(player); }, 500); }}
                      onTouchEnd={() => { if (tournamentMode) { if (longPressRef.current !== 'fired') clearTimeout(longPressRef.current); longPressRef.current = null; } else { setAddTimePlayer(player); } }}
                      onMouseDown={() => { if (tournamentMode) longPressRef.current = setTimeout(() => { longPressRef.current = 'fired'; setTournamentActionPlayer(player); }, 500); }}
                      onMouseUp={() => { if (tournamentMode) { if (longPressRef.current !== 'fired') clearTimeout(longPressRef.current); longPressRef.current = null; } else { setAddTimePlayer(player); } }}
                      onContextMenu={e => e.preventDefault()}
                      className={`w-14 h-14 rounded-full flex items-center justify-center border-2 select-none ${tournamentMode
                        ? 'bg-[#F59E0B]/15 border-[#F59E0B]/40 active:bg-[#EF4444]/30'
                        : isExpired ? 'bg-[#EF4444]/20 border-[#EF4444]/60 time-warn'
                          : isCritical ? 'bg-[#EF4444]/15 border-[#EF4444]/40 time-warn'
                            : isLow ? 'bg-[#F59E0B]/15 border-[#F59E0B]/40'
                              : 'bg-[#1877F2]/20 border-[#1877F2]/40'
                        }`}>
                      <span className="text-sm font-bold text-white">{pos.seat}</span>
                    </button>
                  )}
                  {player && <span className="text-[9px] text-[#B0B3B8] mt-0.5 max-w-[70px] truncate text-center font-medium">{player.player_name?.split(' ')[0]}</span>}
                  {/* Cash mode: time remaining */}
                  {!tournamentMode && player && t !== null && t !== undefined && (
                    <span className={`text-[10px] font-mono font-bold ${isExpired ? 'text-[#EF4444] time-warn' : isCritical ? 'text-[#EF4444]' : isLow ? 'text-[#F59E0B]' : 'text-[#31A24C]'}`}>
                      {isExpired ? 'EXPIRED' : formatCountdown(t)}
                    </span>
                  )}
                  {/* Tournament mode: chip count */}
                  {tournamentMode && player && (
                    <span className="text-[9px] font-mono text-[#F59E0B]">
                      {player.current_chips ? (player.current_chips >= 1000 ? `${(player.current_chips / 1000).toFixed(0)}K` : player.current_chips) : ''}
                    </span>
                  )}
                  {!tournamentMode && player?.membership_tier && player.membership_tier !== 'standard' && (
                    <div className="w-2 h-2 rounded-full absolute -top-0.5 -right-0.5" style={{ backgroundColor: TIER_COLORS[player.membership_tier] || '#B0B3B8' }} />
                  )}
                  {isEmpty && !tournamentMode && <span className="text-[9px] text-[#B0B3B8]/50 mt-0.5">{pos.seat}</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Seated Players List */}
        {seatedPlayers.length > 0 && (
          <div className="bg-[#242526] border-t border-[#3A3B3C] px-4 py-2 max-h-44 overflow-y-auto">
            <div className="space-y-1">
              {[...displayPlayers].sort((a, b) => tournamentMode
                ? (a.seat_number - b.seat_number)
                : (a.time_remaining ?? Infinity) - (b.time_remaining ?? Infinity)
              ).map(player => {
                const t = player.time_remaining;
                const isLow = t !== null && t !== undefined && t <= 900 && t > 0;
                const isCritical = t !== null && t !== undefined && t <= 300 && t > 0;
                const isExpired = t !== null && t !== undefined && t <= 0;
                const isBusting = bustingOut?.seat_number === player.seat_number;
                return (
                  <div key={player.session_id || player.seat_number}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${isBusting ? 'bg-[#EF4444]/20' :
                      isExpired ? 'bg-[#EF4444]/10' : isCritical ? 'bg-[#EF4444]/5' : isLow ? 'bg-[#F59E0B]/5' : 'bg-[#3A3B3C]/30'
                      }`}>
                    <span className="text-xs text-[#B0B3B8] w-6">S{player.seat_number}</span>
                    <span className="text-sm text-white flex-1 truncate">{player.player_name}</span>
                    {/* Tournament mode: show chips + bust-out */}
                    {tournamentMode ? (
                      <>
                        {player.current_chips && (
                          <span className="text-xs font-mono text-[#B0B3B8]">{player.current_chips >= 1000 ? `${(player.current_chips / 1000).toFixed(1)}K` : player.current_chips}</span>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); bustOutPlayer(player); }}
                          disabled={isBusting}
                          className="px-3 py-1.5 rounded-lg bg-[#EF4444] text-white text-xs font-bold active:bg-[#DC2626] disabled:opacity-50 flex items-center gap-1">
                          {isBusting ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserX className="w-3 h-3" />}
                          BUST
                        </button>
                      </>
                    ) : (
                      <>
                        {/* Cash mode: tier badge */}
                        {player.membership_tier && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: (TIER_COLORS[player.membership_tier] || '#B0B3B8') + '20', color: TIER_COLORS[player.membership_tier] }}>
                            {player.membership_tier?.toUpperCase()}
                          </span>
                        )}
                        {/* Cash mode: time countdown */}
                        <span className={`text-sm font-mono font-bold w-16 text-right ${isExpired ? 'text-[#EF4444] time-warn' : isCritical ? 'text-[#EF4444]' : isLow ? 'text-[#F59E0B]' : 'text-[#31A24C]'}`}>
                          {t === null || t === undefined ? '--:--' : isExpired ? 'OUT' : formatCountdown(t)}
                        </span>
                        <button onClick={(e) => { e.stopPropagation(); setAddTimePlayer(player); }}
                          className="w-7 h-7 rounded-full bg-[#31A24C]/10 flex items-center justify-center active:bg-[#31A24C]/20">
                          <Plus className="w-3.5 h-3.5 text-[#31A24C]" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); removePlayer(player.session_id); }}
                          className="w-7 h-7 rounded-full bg-[#EF4444]/10 flex items-center justify-center active:bg-[#EF4444]/20">
                          <UserX className="w-3.5 h-3.5 text-[#EF4444]" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bottom Actions */}
        <div className="bg-[#242526] border-t border-[#3A3B3C] px-4 py-3 space-y-2 flex-shrink-0">

          {/* Table not assigned warning */}
          {(!table?.mode || table?.mode === 'inactive') && (
            <div className="p-3 bg-[#3A3B3C]/50 border border-[#3A3B3C] rounded-xl text-center mb-2">
              <Power className="w-6 h-6 text-[#6A6B6D] mx-auto mb-1" />
              <p className="text-xs text-[#6A6B6D]">Table Not Assigned, Ask Floor Manager To Assign Via Table Assignments</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <button onClick={async () => {
              setHandCount(h => h + 1);
              try {
                const token = getToken();
                const res = await commanderFetch('/api/commander/dealer/hand-count', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ table_number: parseInt(tableNumber), action: 'increment' })
                });
                if (!res.ok) throw new Error(`Request failed (${res.status})`);
                const json = await res.json();
                if (json.success) setHandCount(json.hands_dealt);
              } catch (err) { console.warn('Hand count error:', err); setToast({ type: 'error', text: 'Action Failed: Hand Count. Please Try Again.' }); }
            }} className="py-4 rounded-xl bg-[#1877F2] text-white text-sm font-semibold flex items-center justify-center gap-2 active:bg-[#1565D8]"><Hash className="w-5 h-5" /> Hand +1</button>
            <button onClick={requestFloor} disabled={floorRequested}
              className={`py-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 ${floorRequested ? 'bg-[#F59E0B] text-white animate-pulse' : 'bg-[#EF4444] text-white active:bg-[#DC2626]'}`}>
              <Bell className="w-5 h-5" /> {floorRequested ? 'Called' : 'Floor!'}
            </button>
            <button onClick={() => setBreakTimer(breakTimer ? null : Date.now())}
              className={`py-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 ${breakTimer ? 'bg-[#F59E0B] text-white' : 'bg-[#3A3B3C] text-[#E4E6EB] active:bg-[#4A4B4C]'}`}>
              <Coffee className="w-5 h-5" /> {breakTimer ? 'On Break' : 'Break'}
            </button>
          </div>

          {/* Cash game: Remove All when players exist */}
          {seatedPlayers.length > 0 && !tournamentMode && table?.mode === 'cash' && (
            <button onClick={() => setConfirmRemoveAll(true)}
              className="w-full py-3 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#EF4444] text-sm font-semibold flex items-center justify-center gap-2 active:bg-[#EF4444]/20">
              <UserX className="w-4 h-4" /> Remove All Players
            </button>
          )}

          {/* Tournament: undo the last bust taken from this tablet */}
          {tournamentMode && lastBusted && (
            <button onClick={() => restoreEntry(lastBusted.entry_id, lastBusted.player_name)} disabled={tdBusy !== ''}
              className="w-full py-3 rounded-xl bg-[#3A3B3C] border border-[#4A4B4C] text-[#E4E6EB] text-sm font-semibold flex items-center justify-center gap-2 active:bg-[#4A4B4C] disabled:opacity-50">
              {tdBusy === 'restore' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Undo Bust, {lastBusted.player_name}
            </button>
          )}

          {/* Tournament: only closable once the last player is off the table */}
          {seatedPlayers.length === 0 && tournamentMode && (
            <button onClick={closeTableAction} disabled={closingTable}
              className="w-full py-3 rounded-xl bg-[#3A3B3C] border border-[#4A4B4C] text-[#B0B3B8] text-sm font-semibold flex items-center justify-center gap-2 active:bg-[#4A4B4C] disabled:opacity-50">
              {closingTable ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
              {closingTable ? 'Closing...' : 'Close Table'}
            </button>
          )}

          {/* Cash game: Close Table when NO players left */}
          {seatedPlayers.length === 0 && !tournamentMode && table?.mode === 'cash' && (
            <button onClick={closeTableAction} disabled={closingTable}
              className="w-full py-3 rounded-xl bg-[#3A3B3C] border border-[#4A4B4C] text-[#B0B3B8] text-sm font-semibold flex items-center justify-center gap-2 active:bg-[#4A4B4C] disabled:opacity-50">
              {closingTable ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
              {closingTable ? 'Closing...' : 'Close Table'}
            </button>
          )}

          <div className="flex gap-2">
            <button onClick={async () => {
              try {
                const res = await commanderFetch('/api/commander/dealer/hand-count', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' || '' },
                  body: JSON.stringify({ table_number: parseInt(tableNumber), action: 'reset' })
                });
                if (res.ok) setHandCount(0);
              } catch (err) { console.warn('Hand reset error:', err); setToast({ type: 'error', text: 'Action Failed: Hand Reset. Please Try Again.' }); }
            }} className="flex-1 py-2.5 rounded-lg bg-[#3A3B3C] text-[#B0B3B8] text-xs font-medium flex items-center justify-center gap-1 active:bg-[#4A4B4C]"><RotateCcw className="w-3.5 h-3.5" /> Reset</button>
            <button onClick={() => router.push('/commander/poker-room')} className="flex-1 py-2.5 rounded-lg bg-[#3A3B3C] text-[#B0B3B8] text-xs font-medium active:bg-[#4A4B4C]">Exit</button>
          </div>
        </div>

        {/* ===== REMOVE ALL CONFIRMATION ===== */}
        {confirmRemoveAll && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center px-4" onClick={() => setConfirmRemoveAll(false)}>
            <div className="bg-[#242526] rounded-2xl w-full max-w-sm p-6 text-center" onClick={e => e.stopPropagation()}>
              <div className="w-16 h-16 rounded-full bg-[#EF4444]/10 flex items-center justify-center mx-auto mb-4">
                <UserX className="w-8 h-8 text-[#EF4444]" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Remove All Players?</h3>
              <p className="text-sm text-[#B0B3B8] mb-6">
                This Will End Sessions For All {seatedPlayers.length} Player{seatedPlayers.length !== 1 ? 's' : ''} At Table {tableNumber}. Their Time Will Stop Counting Down.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmRemoveAll(false)}
                  className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] font-semibold active:bg-[#4A4B4C]">Cancel</button>
                <button onClick={removeAllPlayers} disabled={removingAll}
                  className="flex-1 py-3 rounded-xl bg-[#EF4444] text-white font-semibold active:bg-[#DC2626] disabled:opacity-50 flex items-center justify-center gap-2">
                  {removingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                  {removingAll ? 'Removing...' : 'Remove All'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* QR SCANNER MODAL */}
        {scannerOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center" onClick={closeScanner}>
            <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center justify-between z-10">
                <div><h3 className="text-lg font-bold text-white">{dealerScanMode ? 'Scan Dealer, Push In' : `Scan Player, Seat ${targetSeat}`}</h3><p className="text-xs text-[#B0B3B8]">{dealerScanMode ? 'Scan Employee QR Code' : 'Scan Member QR Code'}</p></div>
                <button onClick={closeScanner} className="p-2 rounded-lg active:bg-[#3A3B3C]"><X className="w-5 h-5 text-[#B0B3B8]" /></button>
              </div>
              <div className="p-4 space-y-4">
                {scanError && <div className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl flex items-center gap-2"><AlertCircle className="w-4 h-4 text-[#EF4444] flex-shrink-0" /><p className="text-sm text-[#EF4444]">{scanError}</p></div>}
                {scanLoading && <div className="text-center py-8"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin mx-auto mb-2" /><p className="text-sm text-[#B0B3B8]">Checking Membership...</p></div>}
                {scannedMember && !scanLoading && (
                  <div className="space-y-3">
                    <div className="bg-[#18191A] rounded-xl p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 rounded-full bg-[#3A3B3C] flex items-center justify-center"><User className="w-6 h-6 text-[#B0B3B8]" /></div>
                        <div className="flex-1">
                          <h4 className="text-lg font-bold text-white">{scannedMember.member?.first_name} {scannedMember.member?.last_name}</h4>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-[#1877F2]">{scannedMember.member?.member_number}</span>
                            {scannedMember.member?.membership_tier && (
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                                style={{ backgroundColor: (TIER_COLORS[scannedMember.member.membership_tier] || '#B0B3B8') + '20', color: TIER_COLORS[scannedMember.member.membership_tier] }}>
                                {scannedMember.member.membership_tier?.toUpperCase()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className={`p-3 rounded-xl flex items-center gap-2 ${scannedMember.membership_active ? 'bg-[#31A24C]/10' : 'bg-[#EF4444]/10'}`}>
                          <Shield className={`w-5 h-5 ${scannedMember.membership_active ? 'text-[#31A24C]' : 'text-[#EF4444]'}`} />
                          <div><p className={`text-sm font-bold ${scannedMember.membership_active ? 'text-[#31A24C]' : 'text-[#EF4444]'}`}>{scannedMember.membership_active ? 'ACTIVE' : 'INACTIVE'}</p><p className="text-[10px] text-[#B0B3B8]">Membership</p></div>
                        </div>
                        <div className={`p-3 rounded-xl flex items-center gap-2 ${(scannedMember.time_balance_minutes || 0) > 0 ? 'bg-[#31A24C]/10' : 'bg-[#EF4444]/10'}`}>
                          <Timer className={`w-5 h-5 ${(scannedMember.time_balance_minutes || 0) > 0 ? 'text-[#31A24C]' : 'text-[#EF4444]'}`} />
                          <div><p className={`text-sm font-bold ${(scannedMember.time_balance_minutes || 0) > 0 ? 'text-[#31A24C]' : 'text-[#EF4444]'}`}>{scannedMember.time_balance_minutes || 0} MIN</p><p className="text-[10px] text-[#B0B3B8]">Time Balance</p></div>
                        </div>
                      </div>
                    </div>
                    {!scannedMember.membership_active ? (
                      <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl p-4 text-center">
                        <p className="text-[#EF4444] font-medium">Membership Not Active</p>
                        <p className="text-xs text-[#B0B3B8] mt-1">Player Needs To Renew At The Front Desk</p>
                      </div>
                    ) : (scannedMember.time_balance_minutes || 0) <= 0 ? (
                      <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl p-4 text-center">
                        <p className="text-[#F59E0B] font-medium">No Time On Card</p>
                        <p className="text-xs text-[#B0B3B8] mt-1">Player Needs To Add Time At The Front Desk</p>
                      </div>
                    ) : (
                      <>
                        {scannedMember.already_seated && (
                          <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl p-3 flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-[#F59E0B] flex-shrink-0" />
                            <div>
                              <p className="text-sm text-[#F59E0B] font-medium">Already Seated</p>
                              <p className="text-xs text-[#B0B3B8]">Currently At Table {scannedMember.already_seated.table_number} Seat {scannedMember.already_seated.seat_number}</p>
                            </div>
                          </div>
                        )}
                        <button onClick={seatPlayer} className="w-full py-4 rounded-xl bg-[#31A24C] text-white text-lg font-semibold flex items-center justify-center gap-2 active:bg-[#28883F]">
                          <CheckCircle2 className="w-5 h-5" /> Seat At S{targetSeat}, {scannedMember.time_balance_minutes} Min
                        </button>
                      </>
                    )}
                    <button onClick={() => { setScannedMember(null); startCamera(); }} className="w-full py-2 text-[#1877F2] text-sm font-medium">Scan Different Player</button>
                  </div>
                )}
                {!scannedMember && !scanLoading && (
                  <>
                    {scanning ? (
                      <div className="space-y-3">
                        <div className="relative rounded-xl overflow-hidden bg-black">
                          <video ref={videoRef} autoPlay playsInline muted className="w-full aspect-[4/3]" />
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-48 h-48 border-2 border-[#1877F2] rounded-xl animate-pulse" /></div>
                        </div>
                        <p className="text-center text-sm text-[#B0B3B8]">Hold QR Code In View</p>
                        <button onClick={stopCamera} className="w-full py-2.5 bg-[#3A3B3C] text-[#B0B3B8] rounded-lg text-sm font-medium active:bg-[#4A4B4C]">Stop Camera</button>
                      </div>
                    ) : (
                      <button onClick={startCamera} className="w-full py-10 border-2 border-dashed border-[#3A3B3C] rounded-xl flex flex-col items-center gap-3 active:border-[#1877F2]">
                        <Camera className="w-10 h-10 text-[#B0B3B8]" />
                        <span className="text-sm font-medium text-[#E4E6EB]">Open Camera To Scan</span>
                      </button>
                    )}
                    <div className="border-t border-[#3A3B3C] pt-4">
                      <p className="text-xs text-[#B0B3B8] mb-2">Or Enter Code Manually:</p>
                      <div className="flex gap-2">
                        <input type="text" value={manualCode} onChange={e => setManualCode(e.target.value)} placeholder={dealerScanMode ? "Employee QR Code" : "CMD-1996-abc12345"}
                          className="flex-1 px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none"
                          onKeyDown={e => e.key === 'Enter' && (dealerScanMode ? dealerScanIn(manualCode.trim()) : lookupMember(manualCode.trim()))} />
                        <button onClick={() => dealerScanMode ? dealerScanIn(manualCode.trim()) : lookupMember(manualCode.trim())} className="px-4 py-2.5 bg-[#1877F2] text-white rounded-lg text-sm font-medium active:bg-[#1565D8]">{dealerScanMode ? 'Scan In' : 'Look Up'}</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ADD TIME MODAL - Cash mode */}
        {addTimePlayer && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center" onClick={() => setAddTimePlayer(null)}>
            <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white">S{addTimePlayer.seat_number}, {addTimePlayer.player_name}</h3>
              <p className="text-sm text-[#B0B3B8]">Current: <span className="font-mono font-bold text-white">{formatCountdown(addTimePlayer.time_remaining)}</span></p>
              <div className="grid grid-cols-4 gap-2">
                {[30, 60, 120, 180].map(m => (
                  <button key={m} onClick={() => setAddTimeMinutes(String(m))}
                    className={`py-3 rounded-xl text-sm font-medium ${addTimeMinutes === String(m) ? 'bg-[#31A24C] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'}`}>
                    +{m >= 60 ? `${m / 60}hr` : `${m}m`}
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setAddTimePlayer(null)} className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] font-medium active:bg-[#4A4B4C]">Cancel</button>
                <button onClick={addTime} disabled={addingTime}
                  className="flex-1 py-3 rounded-xl bg-[#31A24C] text-white font-medium active:bg-[#28883F] disabled:opacity-50 flex items-center justify-center gap-2">
                  {addingTime ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Time
                </button>
              </div>
              <button onClick={() => removePlayer(addTimePlayer.session_id)}
                className="w-full py-3 rounded-xl bg-[#EF4444]/10 text-[#EF4444] text-sm font-medium active:bg-[#EF4444]/20 flex items-center justify-center gap-2">
                <UserX className="w-4 h-4" /> Remove Player
              </button>
            </div>
          </div>
        )}

        {/* TOURNAMENT ACTION MODAL - the full Tournament Director action set */}
        {tournamentActionPlayer && (() => {
          const p = tournamentActionPlayer;
          const isEliminated = p.status === 'eliminated' || p.status === 'winner';
          const busy = tdBusy !== '';
          return (
            <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center" onClick={() => setTournamentActionPlayer(null)}>
              <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg p-5 space-y-3 max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#F59E0B]/15 flex items-center justify-center flex-shrink-0">
                    <span className="text-lg font-bold text-[#F59E0B]">S{p.seat_number}</span>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-white truncate">{p.player_name}</h3>
                    <p className="text-sm text-[#B0B3B8]">
                      {p.current_chips
                        ? `${Number(p.current_chips).toLocaleString()} Chips`
                        : 'No Chips Recorded'}
                      {p.rebuy_count > 0 ? `, ${Number(p.rebuy_count).toLocaleString()} Rebuy${p.rebuy_count === 1 ? '' : 's'}` : ''}
                      {p.addon_taken ? ', Add-On Taken' : ''}
                    </p>
                  </div>
                </div>

                <button onClick={() => {
                  setChipEntryPlayer(p);
                  setChipEntryValue(String(p.current_chips || ''));
                  setTournamentActionPlayer(null);
                }}
                  className="w-full py-4 rounded-xl bg-[#1877F2] text-white text-lg font-semibold flex items-center justify-center gap-3 active:bg-[#1565D8]">
                  <DollarSign className="w-6 h-6" /> Enter Chip Count
                </button>

                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => rebuyPlayer(p)} disabled={busy}
                    className="py-4 rounded-xl bg-[#31A24C] text-white text-base font-semibold flex items-center justify-center gap-2 active:bg-[#28883F] disabled:opacity-50">
                    {tdBusy === 'rebuy' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Coins className="w-5 h-5" />} Rebuy
                  </button>
                  <button onClick={() => addonPlayer(p)} disabled={busy}
                    className="py-4 rounded-xl bg-[#31A24C]/15 border border-[#31A24C]/40 text-[#31A24C] text-base font-semibold flex items-center justify-center gap-2 active:bg-[#31A24C]/25 disabled:opacity-50">
                    {tdBusy === 'addon' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />} Add-On
                  </button>
                </div>

                <button onClick={() => { setMovePlayerFor(p); setTournamentActionPlayer(null); }} disabled={busy}
                  className="w-full py-4 rounded-xl bg-[#F59E0B] text-white text-lg font-semibold flex items-center justify-center gap-3 active:bg-[#D97706] disabled:opacity-50">
                  <ArrowRightLeft className="w-6 h-6" /> Move Player
                </button>

                {!isEliminated && (
                  <button onClick={() => {
                    bustOutPlayer(p);
                    setTournamentActionPlayer(null);
                  }} disabled={busy}
                    className="w-full py-4 rounded-xl bg-[#EF4444] text-white text-lg font-semibold flex items-center justify-center gap-3 active:bg-[#DC2626] disabled:opacity-50">
                    <UserX className="w-6 h-6" /> Bust Out
                  </button>
                )}

                {(isEliminated || (lastBusted && lastBusted.entry_id === (p.entry_id || p.id))) && (
                  <button onClick={() => restoreEntry(p.entry_id || p.id, p.player_name)} disabled={busy}
                    className="w-full py-4 rounded-xl bg-[#3A3B3C] border border-[#4A4B4C] text-[#E4E6EB] text-base font-semibold flex items-center justify-center gap-3 active:bg-[#4A4B4C] disabled:opacity-50">
                    {tdBusy === 'restore' ? <Loader2 className="w-5 h-5 animate-spin" /> : <RotateCcw className="w-5 h-5" />} Undo Bust
                  </button>
                )}

                <button onClick={() => setTournamentActionPlayer(null)}
                  className="w-full py-3 rounded-xl bg-[#3A3B3C] text-[#B0B3B8] text-sm font-medium active:bg-[#4A4B4C]">
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}

        {/* EMPTY SEAT ACTIONS - Tournament mode */}
        {tournamentMode && emptySeatAction && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center" onClick={() => setEmptySeatAction(null)}>
            <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white">Seat {emptySeatAction} Is Open</h3>
              {(tournamentMode.alternates || []).length > 0 ? (
                <>
                  <p className="text-sm text-[#B0B3B8]">Seat Alternate Here</p>
                  {(tournamentMode.alternates || []).slice(0, 8).map(alt => (
                    <button key={alt.entry_id} onClick={() => promoteAlternateToSeat(alt, emptySeatAction)} disabled={tdBusy !== ''}
                      className="w-full py-3.5 rounded-xl bg-[#31A24C] text-white text-base font-semibold flex items-center justify-center gap-2 active:bg-[#28883F] disabled:opacity-50">
                      {tdBusy === 'promote' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Users className="w-5 h-5" />}
                      {alt.player_name}, Queue {Number(alt.queue_position || 0).toLocaleString()}
                    </button>
                  ))}
                </>
              ) : (
                <p className="text-sm text-[#B0B3B8]">No Alternates Are Waiting.</p>
              )}
              <button onClick={() => { setSeatMovePicker(emptySeatAction); setEmptySeatAction(null); }} disabled={tdBusy !== ''}
                className="w-full py-4 rounded-xl bg-[#1877F2] text-white text-lg font-semibold flex items-center justify-center gap-3 active:bg-[#1565D8] disabled:opacity-50">
                <ArrowRightLeft className="w-6 h-6" /> Move A Player Here
              </button>
              <button onClick={() => setEmptySeatAction(null)}
                className="w-full py-3 rounded-xl bg-[#3A3B3C] text-[#B0B3B8] text-sm font-medium active:bg-[#4A4B4C]">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* MOVE A PLAYER INTO THIS SEAT - candidate list from floor-view tables */}
        {tournamentMode && seatMovePicker && (() => {
          const candidates = [];
          (tournamentMode.tables || []).forEach(t => {
            (t.players || []).forEach(pl => {
              if (String(t.table_number) === String(tableNumber) && pl.seat_number === seatMovePicker) return;
              candidates.push({ ...pl, from_table: t.table_number });
            });
          });
          return (
            <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center" onClick={() => setSeatMovePicker(null)}>
              <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-white">Move A Player To Seat {seatMovePicker}</h3>
                {candidates.length === 0 ? (
                  <p className="text-sm text-[#B0B3B8]">No Other Players Are Seated In This Tournament.</p>
                ) : candidates.map(c => (
                  <button key={c.entry_id} onClick={() => movePlayerToSeat(c, parseInt(tableNumber), seatMovePicker)} disabled={tdBusy !== ''}
                    className="w-full py-3 px-3 rounded-xl bg-[#18191A] border border-[#3A3B3C] text-left flex items-center gap-3 active:bg-[#3A3B3C] disabled:opacity-50">
                    <span className="text-xs font-bold text-[#F59E0B] w-16 flex-shrink-0">T{c.from_table} S{c.seat_number}</span>
                    <span className="text-sm text-white flex-1 truncate">{c.player_name}</span>
                    <span className="text-xs font-mono text-[#B0B3B8]">{Number(c.current_chips || 0).toLocaleString()}</span>
                  </button>
                ))}
                <button onClick={() => setSeatMovePicker(null)}
                  className="w-full py-3 rounded-xl bg-[#3A3B3C] text-[#B0B3B8] text-sm font-medium active:bg-[#4A4B4C]">
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}

        {/* MOVE PLAYER - seat picker built from the floor-view table list */}
        {tournamentMode && movePlayerFor && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center" onClick={() => setMovePlayerFor(null)}>
            <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white">Move {movePlayerFor.player_name}</h3>
              <p className="text-sm text-[#B0B3B8]">Pick An Open Seat</p>
              {(tournamentMode.tables || []).length === 0 && (
                <p className="text-sm text-[#6A6B6D]">No Tables Are Reporting Yet. Refresh And Try Again.</p>
              )}
              {(tournamentMode.tables || []).map(t => {
                const taken = new Set((t.players || []).map(pl => pl.seat_number));
                const tableMax = t.max_seats || 9;
                const openSeats = Array.from({ length: tableMax }, (_, i) => i + 1)
                  .filter(s => !taken.has(s))
                  .filter(s => !(String(t.table_number) === String(tableNumber) && s === movePlayerFor.seat_number));
                return (
                  <div key={t.table_number} className="bg-[#18191A] rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-bold text-white">Table {t.table_number}</p>
                      <p className="text-xs text-[#B0B3B8]">{Number(t.player_count || 0).toLocaleString()} / {Number(tableMax).toLocaleString()} Seated</p>
                    </div>
                    {openSeats.length === 0 ? (
                      <p className="text-xs text-[#6A6B6D]">No Open Seats</p>
                    ) : (
                      <div className="grid grid-cols-5 gap-2">
                        {openSeats.map(s => (
                          <button key={s} onClick={() => movePlayerToSeat(movePlayerFor, t.table_number, s)} disabled={tdBusy !== ''}
                            className="py-2.5 rounded-lg bg-[#3A3B3C] text-[#E4E6EB] text-sm font-semibold active:bg-[#1877F2] disabled:opacity-50">
                            S{s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <button onClick={() => setMovePlayerFor(null)}
                className="w-full py-3 rounded-xl bg-[#3A3B3C] text-[#B0B3B8] text-sm font-medium active:bg-[#4A4B4C]">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* TOURNAMENT NOTICE - auto-break, promoted alternate, restore result */}
        {tdNotice && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center px-4" onClick={() => setTdNotice(null)}>
            <div className="bg-[#242526] rounded-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white mb-3">{tdNotice.title}</h3>
              <div className="space-y-1.5 mb-5">
                {(tdNotice.lines || []).map((line, i) => (
                  <p key={i} className="text-sm text-[#B0B3B8]">{line}</p>
                ))}
              </div>
              <div className="flex gap-3">
                {lastBusted && (
                  <button onClick={() => restoreEntry(lastBusted.entry_id, lastBusted.player_name)} disabled={tdBusy !== ''}
                    className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-semibold flex items-center justify-center gap-2 active:bg-[#4A4B4C] disabled:opacity-50">
                    {tdBusy === 'restore' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Undo Bust
                  </button>
                )}
                <button onClick={() => setTdNotice(null)}
                  className="flex-1 py-3 rounded-xl bg-[#1877F2] text-white text-sm font-semibold active:bg-[#1565D8]">
                  Got It
                </button>
              </div>
            </div>
          </div>
        )}

        {/* UNDO BUST CONFIRMATION - 409 PAYOUT_RECORDED, confirm then force */}
        {restoreConfirm && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center px-4" onClick={() => setRestoreConfirm(null)}>
            <div className="bg-[#242526] rounded-2xl w-full max-w-sm p-6 text-center" onClick={e => e.stopPropagation()}>
              <div className="w-14 h-14 rounded-full bg-[#F59E0B]/10 flex items-center justify-center mx-auto mb-3">
                <AlertTriangle className="w-7 h-7 text-[#F59E0B]" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Payout Already Recorded</h3>
              <p className="text-sm text-[#B0B3B8] mb-5">{restoreConfirm.message}</p>
              <div className="flex gap-3">
                <button onClick={() => setRestoreConfirm(null)}
                  className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] font-semibold active:bg-[#4A4B4C]">Cancel</button>
                <button onClick={() => restoreEntry(restoreConfirm.entry_id, restoreConfirm.player_name, true)} disabled={tdBusy !== ''}
                  className="flex-1 py-3 rounded-xl bg-[#EF4444] text-white font-semibold active:bg-[#DC2626] disabled:opacity-50 flex items-center justify-center gap-2">
                  {tdBusy === 'restore' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Undo Anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CHIP ENTRY MODAL - Tournament mode */}
        {chipEntryPlayer && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center" onClick={() => setChipEntryPlayer(null)}>
            <div className="bg-[#242526] rounded-t-2xl w-full max-w-lg p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white">
                S{chipEntryPlayer.seat_number}, {chipEntryPlayer.player_name}
              </h3>
              <p className="text-sm text-[#B0B3B8]">
                Current: <span className="font-mono font-bold text-white">
                  {chipEntryPlayer.current_chips ? chipEntryPlayer.current_chips.toLocaleString() : 'Not Set'}
                </span>
              </p>
              <input
                type="number"
                inputMode="numeric"
                value={chipEntryValue}
                onChange={e => setChipEntryValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && chipEntryValue) updatePlayerChips(); }}
                placeholder="Enter Chip Count"
                autoFocus
                className="w-full px-4 py-4 bg-[#18191A] border-2 border-[#3A3B3C] rounded-xl text-2xl font-mono font-bold text-white text-center focus:border-[#1877F2] focus:outline-none"
              />
              <div className="flex gap-3">
                <button onClick={() => { setChipEntryPlayer(null); setChipEntryValue(''); }}
                  className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] font-medium active:bg-[#4A4B4C]">Cancel</button>
                <button onClick={updatePlayerChips} disabled={savingChips || !chipEntryValue}
                  className="flex-1 py-3 rounded-xl bg-[#31A24C] text-white font-semibold active:bg-[#28883F] disabled:opacity-50 flex items-center justify-center gap-2">
                  {savingChips ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {savingChips ? 'Saving...' : 'Save Chips'}
                </button>
              </div>
            </div>
          </div>
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
          maxWidth: 360,
        }}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8,
          }}>×</button>
        </div>
      )}
    </>
  );
}

export async function getServerSideProps(context) {
  return { props: {} };
}
