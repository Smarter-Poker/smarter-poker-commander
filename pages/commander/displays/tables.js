/**
 * Table Status TV Display - with click-to-lock kiosk mode
 * /commander/displays/tables
 * 
 * Full-screen display for TV / tablet via wireless HDMI transmitter
 * Shows: all tables, game type, stakes, players seated, open seats
 * Color-coded: green = open seats, blue = full, grey = inactive
 * 
 * LOCK MODE: Tap any table → locks display to that single table
 * Only owner/manager PIN can unlock back to all-tables view.
 * Lock state persists in localStorage across refreshes.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';

import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import DealerTicker from '../../../src/components/commander/shared/DealerTicker';
import useCommanderSync, { broadcastChange } from '../../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../../src/engine/EventBus';
import SEOHead from '../../../src/components/seo/SEOHead';
import { getStaffData } from '../../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';

/* ─── Helpers ────────────────────────────────────────────── */

function computeSeatPositions(maxSeats) {
  const rx = 47, ry = 22, cxE = 50, cyE = 50;
  const STEPS = 360;
  const startAngle = Math.PI / 2;
  const cumArc = [0];
  for (let i = 1; i <= STEPS; i++) {
    const t0 = startAngle + ((i - 1) / STEPS) * 2 * Math.PI;
    const t1 = startAngle + (i / STEPS) * 2 * Math.PI;
    const dx = rx * (Math.cos(t1) - Math.cos(t0));
    const dy = ry * (Math.sin(t1) - Math.sin(t0));
    cumArc.push(cumArc[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalArc = cumArc[STEPS];
  const totalSlots = maxSeats + 1;
  const allPos = [];
  for (let p = 0; p < totalSlots; p++) {
    const target = (p / totalSlots) * totalArc;
    let idx = 1;
    while (idx <= STEPS && cumArc[idx] < target) idx++;
    const angle = startAngle + (idx / STEPS) * 2 * Math.PI;
    allPos.push({ top: `${cyE + ry * Math.sin(angle)}%`, left: `${cxE + rx * Math.cos(angle)}%` });
  }
  const dealerPos = allPos[0];
  const seatPositions = allPos.slice(1);
  seatPositions.forEach(p => { const t = parseFloat(p.top); if (t < 30) p.top = '30%'; });
  return { dealerPos, seatPositions };
}

function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getTimerColor(seconds) {
  if (seconds <= 0) return '#EF4444';
  if (seconds <= 300) return '#EF4444';
  if (seconds <= 900) return '#F59E0B';
  return '#31A24C';
}

/* ─── Main Component ─────────────────────────────────────── */

export default function TablesDisplay() {
  useEffect(() => { busEmit.sessionStart('commander-displays-tables'); }, []);
  const [tables, setTables] = useState([]);
  const [now, setNow] = useState(new Date());
  const [dealerMap, setDealerMap] = useState({});
  const wakeLockRef = useRef(null);
  const lastFetchAt = useRef(Date.now());

  // Lock mode state
  const [lockedTableNum, setLockedTableNum] = useState(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);

  // Interactive kiosk state
  const [showScanner, setShowScanner] = useState(null); // { type: 'dealer'|'seat', seatNumber? }
  const scannerVideoRef = useRef(null);
  const scannerStreamRef = useRef(null);
  const [showPlayerMenu, setShowPlayerMenu] = useState(null); // seat object
  const [playerActionLoading, setPlayerActionLoading] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success'|'error', text }

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const [movingPlayer, setMovingPlayer] = useState(null); // { seat, player_name } - active move mode

  // Extract venueId/venueName from staff session (client-only)
  const [venueId, setVenueId] = useState(null);
  const [venueName, setVenueName] = useState('');

  // Mount: read localStorage for staff session + restore lock state
  useEffect(() => {
    try {
      const staff = getStaffData();
      if (staff.venue_id) setVenueId(staff.venue_id);
      if (staff.venue_name) setVenueName(staff.venue_name);
    } catch { /* ignore */ }
    try {
      const saved = localStorage.getItem('display_locked_table');
      if (saved) {
        const { table_number } = JSON.parse(saved);
        if (table_number) setLockedTableNum(table_number);
      }
    } catch { /* ignore */ }
  }, []);

  // Prevent back navigation while locked
  useEffect(() => {
    if (!lockedTableNum) return;
    const handleBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    const handlePopState = () => { window.history.pushState(null, '', window.location.href); };
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);
    window.history.pushState(null, '', window.location.href);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [lockedTableNum]);

  /* ─── Data Fetching ──────────────────────────────── */

  const fetchData = useCallback(async () => {
    if (!venueId) return;
    try {
const headers = { };

      const json = await commanderFetchJSON(`/api/commander/tables?venue_id=${venueId}`, { headers });
      if (json.success) {
        let tablesArr = Array.isArray(json.data) ? json.data
          : Array.isArray(json.data?.tables) ? json.data.tables : [];

        // Fetch sessions for tables with active games to get seat + timer data
        const activeTbls = tablesArr.filter(t => t.status === 'in_use');
        if (activeTbls.length > 0) {
          const sessionsByTable = {};
          await Promise.all(activeTbls.map(async (t) => {
            const tNum = t.table_number || t.number;
            try {
              const sRes = await commanderFetch(`/api/commander/dealer/sessions?table=${tNum}`, { headers });
              if (!sRes.ok) throw new Error(`Request failed (${sRes.status})`);
              const sJson = await sRes.json();
              if (sJson.success) sessionsByTable[tNum] = sJson.data || [];
            } catch { /* non-fatal */ }
          }));
          tablesArr = tablesArr.map(t => {
            const tNum = t.table_number || t.number;
            const tableSessions = sessionsByTable[tNum];
            if (!tableSessions || tableSessions.length === 0) return t;
            return {
              ...t,
              seats: tableSessions.map(s => ({
                seat_number: s.seat_number,
                player_name: s.player_name,
                member_id: s.member_id,
                membership_tier: s.membership_tier,
                time_remaining: s.time_remaining,
                is_expired: s.is_expired,
                is_critical: s.is_critical,
                missed_blinds: s.missed_blinds || 0,
                session_status: s.session_status || 'active',
                session_id: s.session_id,
                status: 'occupied' }))
            };
          });
        }

        setTables(tablesArr);
        lastFetchAt.current = Date.now();
      }
    } catch (err) { console.warn('Display fetch error:', err); }
    setNow(new Date());
  }, [venueId]);

  // Fetch dealer rotations
  const fetchDealers = useCallback(async () => {
    if (!venueId) return;
    try {
const json = await commanderFetchJSON(`/api/commander/dealers/rotations?venue_id=${venueId}`, { });
      if (json.success) {
        const rots = json.data?.rotations || json.data || [];
        const map = {};
        (Array.isArray(rots) ? rots : []).forEach(r => {
          if (r.table_number && !r.ended_at) {
            map[r.table_number] = r.dealer_name || r.commander_dealers?.name || 'Dealer';
          }
        });
        setDealerMap(map);
      }
    } catch { /* non-fatal */ }
  }, [venueId]);

  useEffect(() => {
    fetchData();
    fetchDealers();
    const poll = setInterval(() => { fetchData(); fetchDealers(); }, 30000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [fetchData, fetchDealers]);

  // Commander Data Bus - instant sync
  useCommanderSync(venueId, () => { fetchData(); fetchDealers(); }, { entities: ['tables', 'games', 'dealers'] });

  // Wake lock
  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen');
      } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    };
    requestWakeLock();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') requestWakeLock();
    });
    return () => { wakeLockRef.current?.release(); };
  }, []);

  /* ─── Lock / Unlock ──────────────────────────────── */

  const lockToTable = (tableNumber) => {
    setLockedTableNum(tableNumber);
    localStorage.setItem('display_locked_table', JSON.stringify({ table_number: tableNumber, venue_id: venueId }));
  };

  const handleUnlockAttempt = async () => {
    if (!pinValue || pinValue.length !== 4) { setPinError('Enter your 4-digit PIN'); return; }
    setPinLoading(true);
    setPinError('');
    try {
      const res = await commanderFetch('/api/commander/staff/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' || '' },
        body: JSON.stringify({ pin_code: pinValue, venue_id: venueId }) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success && json.data?.staff) {
        const role = json.data.staff.role;
        if (role === 'owner' || role === 'manager') {
          setLockedTableNum(null);
          setShowPinModal(false);
          setPinValue('');
          localStorage.removeItem('display_locked_table');
        } else {
          setPinError('Owner or Manager PIN required');
        }
      } else {
        setPinError(json.error || 'Invalid PIN');
      }
    } catch {
      setPinError('Network error - try again');
    }
    setPinLoading(false);
  };

  /* ─── Toast Auto-Clear ─────────────────────────────── */
  useEffect(() => {
    if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }
  }, [toast]);

  /* ─── Camera Scanner ───────────────────────────────── */

  const openScanner = (type, seatNumber) => {
    setShowScanner({ type, seatNumber });
    setShowPlayerMenu(null);
    setTimeout(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        scannerStreamRef.current = stream;
        if (scannerVideoRef.current) {
          scannerVideoRef.current.srcObject = stream;
          scannerVideoRef.current.play();
        }
        // Start scanning loop
        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          const scanLoop = async () => {
            if (!scannerStreamRef.current || !scannerVideoRef.current) return;
            try {
              const barcodes = await detector.detect(scannerVideoRef.current);
              if (barcodes.length > 0) {
                handleScan(barcodes[0].rawValue, type, seatNumber);
                return;
              }
            } catch { /* ignore frame errors */ }
            if (scannerStreamRef.current) requestAnimationFrame(scanLoop);
          };
          setTimeout(scanLoop, 500);
        }
      } catch {
        setToast({ type: 'error', text: 'Camera access denied or unavailable' });
        closeScanner();
      }
    }, 200);
  };

  const closeScanner = () => {
    if (scannerStreamRef.current) {
      scannerStreamRef.current.getTracks().forEach(t => t.stop());
      scannerStreamRef.current = null;
    }
    setShowScanner(null);
  };

  const handleScan = async (qrData, type, seatNumber) => {
    closeScanner();
const headers = { 'Content-Type': 'application/json' };

    if (type === 'dealer') {
      // Scan in a dealer
      try {
        const res = await commanderFetch('/api/commander/dealer/scan-in', {
          method: 'POST', headers,
          body: JSON.stringify({ venue_id: venueId, qr_code: qrData, table_number: lockedTableNum }) });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = await res.json();
        if (json.success) {
          const dealerName = json.data?.dealer?.name || json.data?.dealer_name || 'Dealer';
          setToast({ type: 'success', text: `✓ ${dealerName} scanned in as dealer` });
          fetchData(); fetchDealers();
          broadcastChange('dealers');
        } else {
          setToast({ type: 'error', text: json.error || 'Dealer not found' });
        }
      } catch { setToast({ type: 'error', text: 'Network error' }); }
    } else if (type === 'seat') {
      // Seat a player - single call to unauthenticated player-scan-in
      try {
        const seatRes = await commanderFetch('/api/commander/dealer/player-scan-in', {
          method: 'POST', headers,
          body: JSON.stringify({ qr_code: qrData, table_number: lockedTableNum, seat_number: seatNumber, venue_id: venueId }) });
        if (!seatRes.ok) throw new Error('Request failed');
        const seatJson = await seatRes.json();
        if (seatJson.success) {
          setToast({ type: 'success', text: `✓ ${seatJson.data.player_name} seated at S${seatNumber}` });
          fetchData();
          broadcastChange('tables');
        } else {
          setToast({ type: 'error', text: seatJson.error || 'Could not seat player' });
        }
      } catch { setToast({ type: 'error', text: 'Network error' }); }
    }
  };

  /* ─── Player Actions (all wired to /api/commander/dealer/session-action) ── */

   const callSessionAction = async (seat, action, extra = {}) => {
    setPlayerActionLoading(true);
    try {
const res = await commanderFetch('/api/commander/dealer/session-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_number: lockedTableNum, seat_number: seat.number, venue_id: venueId, action, ...extra }) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      setPlayerActionLoading(false);
      if (json.success) broadcastChange('tables');
      return json;
    } catch {
      setPlayerActionLoading(false);
      return { success: false, error: 'Network error' };
    }
  };

  const removePlayer = async (seat) => {
    setPlayerActionLoading(true);
    try {
const res = await commanderFetch('/api/commander/dealer/player-unseat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_number: lockedTableNum, seat_number: seat.number, venue_id: venueId }) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setToast({ type: 'success', text: `${json.data.player_name} removed · ${json.data.unused_minutes_returned}m returned` });
        setShowPlayerMenu(null);
        fetchData();
        broadcastChange('tables');
      } else {
        setToast({ type: 'error', text: json.error || 'Failed to remove player' });
      }
    } catch { setToast({ type: 'error', text: 'Network error' }); }
    setPlayerActionLoading(false);
  };

  const startMovePlayer = (seat) => {
    setMovingPlayer({ seat, player_name: seat.player?.player_name || 'Player' });
    setShowPlayerMenu(null);
    setToast({ type: 'success', text: `Tap an empty seat to move ${seat.player?.player_name || 'player'}` });
  };

  const completeMove = async (targetSeatNumber) => {
    if (!movingPlayer) return;
    const json = await callSessionAction(movingPlayer.seat, 'move', { target_seat: targetSeatNumber });
    if (json.success) {
      setToast({ type: 'success', text: `✓ ${json.data.player_name} moved S${json.data.from_seat} → S${json.data.to_seat}` });
      fetchData();
    } else {
      setToast({ type: 'error', text: json.error || 'Move failed' });
    }
    setMovingPlayer(null);
  };

  const addMealBreak = async (seat) => {
    const json = await callSessionAction(seat, 'meal_break');
    if (json.success) {
      setToast({ type: 'success', text: `🍽️ 30-min meal break started for ${json.data.player_name}` });
    } else {
      setToast({ type: 'error', text: json.error || 'Failed to set meal break' });
    }
    setShowPlayerMenu(null);
    fetchData();
  };

  const markMissedBlinds = async (seat) => {
    const json = await callSessionAction(seat, 'missed_blinds');
    if (json.success) {
      const count = json.data.missed_blinds_count;
      if (count >= 3) {
        // Auto-remove player after 3rd missed blind
        setToast({ type: 'error', text: `🚫 ${json.data.player_name} removed - 3 missed blinds` });
        await removePlayer(seat);
      } else {
        setToast({ type: 'success', text: `Missed blind #${count} for ${json.data.player_name}` });
      }
      fetchData();
    } else {
      setToast({ type: 'error', text: json.error || 'Failed to log missed blind' });
    }
    setShowPlayerMenu(null);
  };

  const pausePlayer = async (seat) => {
    const json = await callSessionAction(seat, 'pause');
    if (json.success) {
      setToast({ type: 'success', text: `⏸️ Timer paused for ${json.data.player_name}` });
    } else {
      setToast({ type: 'error', text: json.error || 'Failed to pause' });
    }
    setShowPlayerMenu(null);
    fetchData();
  };

  /* ─── Computed ────────────────────────────────────── */

  const adjustTime = useCallback((apiTimeRemaining) => {
    if (apiTimeRemaining == null) return null;
    const elapsed = Math.floor((Date.now() - lastFetchAt.current) / 1000);
    return Math.max(0, apiTimeRemaining - elapsed);
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  const goFullscreen = () => document.documentElement.requestFullscreen?.();

  // All tables - show everything (active, available, reserved, maintenance)
  const allTables = tables;
  const activeTables = tables.filter(t => t.status === 'in_use');
  const totalSeated = activeTables.reduce((sum, t) => {
    const games = Array.isArray(t.commander_games) ? t.commander_games : [];
    const game = games.find(g => g.status !== 'closed') || games[0];
    const seated = (t.seats || []).filter(s => s.status === 'occupied').length;
    return sum + (game?.current_players || seated || 0);
  }, 0);
  const totalOpen = activeTables.reduce((sum, t) => {
    const max = t.max_seats || 9;
    const games = Array.isArray(t.commander_games) ? t.commander_games : [];
    const game = games.find(g => g.status !== 'closed') || games[0];
    const seated = (t.seats || []).filter(s => s.status === 'occupied').length;
    const count = game?.current_players || seated || 0;
    return sum + Math.max(0, max - count);
  }, 0);

  // Locked table data - find the specific table for kiosk view
  const lockedTable = lockedTableNum ? tables.find(t => (t.table_number || t.number) === lockedTableNum) : null;

  /* ─── LOCKED KIOSK VIEW ──────────────────────────── */

  if (lockedTableNum) {
    const table = lockedTable;
    const maxSeats = table?.max_seats || 9;
    const { dealerPos, seatPositions } = computeSeatPositions(maxSeats);
    const games = table ? (Array.isArray(table.commander_games) ? table.commander_games : []) : [];
    const game = games.find(g => g.status !== 'closed') || games[0] || null;
    const gameType = (game?.game_type || table?.game_type || 'NLH').toUpperCase();
    const stakes = game?.stakes || table?.stakes || '';
    const dealerName = dealerMap[lockedTableNum] || game?.dealer_name || 'No Dealer';
    const seatData = table?.seats || [];
    const isActive = table?.status === 'in_use';
    const isTournament = gameType.includes('TOURN') || game?.tournament_id;

    // Build seat array
    const seatArr = Array.from({ length: maxSeats }, (_, i) => {
      const seatNum = i + 1;
      const seat = seatData.find(s => s.seat_number === seatNum);
      return { number: seatNum, player: seat || null };
    });

    // Fill anonymous players if game has current_players but few seat records
    const gamePlayers = game?.current_players || 0;
    const actuallySeated = seatArr.filter(s => s.player).length;
    if (gamePlayers > actuallySeated) {
      let toFill = gamePlayers - actuallySeated;
      let pNum = 1;
      for (let i = 0; i < seatArr.length && toFill > 0; i++) {
        if (!seatArr[i].player) {
          seatArr[i].player = { player_name: `Player ${pNum}`, seat_number: seatArr[i].number };
          pNum++; toFill--;
        }
      }
    }
    const occupiedCount = seatArr.filter(s => s.player).length;

    return (
      <CommanderLayout title="Table Status Display" backHref="/commander/dashboard?card=displays">
        <SEOHead
          title="Commander - Tables Display"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
          background: 'radial-gradient(ellipse at 50% 45%, #0f1a12 0%, #0c1210 25%, #080d0b 50%, #050808 75%, #020303 100%)',
          color: '#E4E6EB', fontFamily: 'Inter, sans-serif', overflow: 'hidden', zIndex: 50 }}>

          {/* ── Minimal Top Bar (no green header) ── */}
          <div style={{
            position: 'absolute', top: 12, right: 16, zIndex: 60,
            display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              padding: '6px 14px', borderRadius: 20, background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)', fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
              display: 'flex', alignItems: 'center', gap: 6 }}>
              👥 {occupiedCount}/{maxSeats}
            </div>
            <div style={{
              fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
              {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </div>
            <button
              onClick={() => { setShowPinModal(true); setPinValue(''); setPinError(''); }}
              style={{
                width: 40, height: 40, borderRadius: 10,
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                color: '#EF4444', fontSize: 18, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >🔓</button>
          </div>

          {/* ── Toast Notification ── */}
          {toast && (
            <div style={{
              position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 80,
              padding: '12px 24px', borderRadius: 14,
              background: toast.type === 'success' ? 'rgba(49,162,76,0.95)' : 'rgba(239,68,68,0.95)',
              color: '#fff', fontSize: 15, fontWeight: 700, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              animation: 'fadeIn 0.2s ease' }}>
              {toast.text}
            </div>
          )}

          {/* ── Move Mode Banner ── */}
          {movingPlayer && (
            <div style={{
              position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 80,
              padding: '10px 20px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 12,
              background: 'rgba(24,119,242,0.95)', color: '#fff', fontSize: 14, fontWeight: 700,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
              🪑 Moving {movingPlayer.player_name} - tap an empty seat
              <button onClick={() => { setMovingPlayer(null); setToast({ type: 'success', text: 'Move cancelled' }); }}
                style={{
                  padding: '4px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.3)',
                  background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >Cancel</button>
            </div>
          )}

          {/* ── Table Visual ── */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 24px', overflow: 'hidden' }}>
            {!table ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🔒</div>
                <p style={{ fontSize: 20, color: '#8A8D91', fontWeight: 600 }}>Table {lockedTableNum} - Loading...</p>
              </div>
            ) : (
              <div style={{ width: '100%', maxWidth: 1100, position: 'relative' }}>
                <div style={{ position: 'relative', width: '100%', paddingBottom: '52%', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, aspectRatio: '1 / 1', marginTop: '-24%' }}>
                    <Image src="/images/poker-table-black-gold.png" alt="Poker Table" width={640} height={640} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', zIndex: 0 }} />

                    {/* ── Center Info: Club Name + Game + Table ── */}
                    <div style={{ position: 'absolute', top: '48%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 5, textAlign: 'center' }}>
                      <div style={{
                        fontSize: 28, fontWeight: 900, color: 'rgba(255,215,0,0.85)',
                        textTransform: 'uppercase', letterSpacing: 3, marginBottom: 8,
                        textShadow: '0 2px 12px rgba(255,215,0,0.3)' }}>
                        {venueName || 'Poker Room'}
                      </div>
                      <div style={{
                        fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
                        letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>
                        Table {lockedTableNum}
                      </div>
                      <div style={{ fontSize: 36, fontWeight: 900, color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: 1 }}>
                        {isTournament ? (game?.tournament_name || 'TOURNAMENT') : gameType}
                      </div>
                      <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.6)', marginTop: 4, fontWeight: 700 }}>
                        {isTournament ? (game?.buy_in ? `$${game.buy_in} Buy-In` : '') : stakes}
                      </div>
                      {!isActive && (
                        <div style={{ fontSize: 14, color: '#1877F2', fontWeight: 700, marginTop: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                          Table Open
                        </div>
                      )}
                    </div>

                    {/* ── Dealer Badge (same card style as players, clickable → scanner) ── */}
                    <div
                      onClick={() => openScanner('dealer')}
                      style={{
                        position: 'absolute', top: dealerPos.top, left: dealerPos.left,
                        transform: 'translate(-50%, -50%)', zIndex: 3, cursor: 'pointer',
                        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10,
                        background: 'rgba(24,119,242,0.15)', borderRadius: 14, padding: '6px 12px 6px 6px',
                        border: '2px solid rgba(24,119,242,0.6)', backdropFilter: 'blur(8px)', minWidth: 90,
                        transition: 'border-color 0.2s, box-shadow 0.2s',
                        boxShadow: '0 2px 16px rgba(0,0,0,0.4), 0 0 12px rgba(24,119,242,0.15)' }}
                    >
                      <div style={{
                        width: 60, height: 60, borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'linear-gradient(135deg, #1877F2 0%, #1565c0 100%)',
                        border: '2px solid rgba(24,119,242,0.6)', overflow: 'hidden',
                        fontSize: 26, fontWeight: 800, color: '#fff' }}>D</div>
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.2, color: '#E4E6EB', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                          {dealerName}
                        </div>
                        <div style={{ fontSize: 10, color: 'rgba(24,119,242,0.6)' }}>Tap to scan</div>
                      </div>
                    </div>

                    {/* ── Seat Badges (interactive) ── */}
                    {seatArr.slice(0, seatPositions.length).map((seat, idx) => {
                      const pos = seatPositions[idx];
                      const isOccupied = !!seat.player;
                      const firstName = seat.player?.player_name?.split(' ')[0] || '';
                      const fullName = seat.player?.player_name || '';
                      const leftPct = parseFloat(pos.left);
                      const isLeftSide = leftPct < 25;
                      const isRightSide = leftPct > 75;
                      const badgeTransform = isLeftSide ? 'translate(-17px, -50%)' : isRightSide ? 'translate(calc(-100% + 17px), -50%)' : 'translate(-50%, -50%)';
                      const badgeDirection = isRightSide ? 'row-reverse' : 'row';

                      let timerText = null, timerColor = null;
                      const isPausedOrBreak = seat.player?.session_status === 'paused' || seat.player?.session_status === 'meal_break';
                      if (isOccupied && seat.player?.time_remaining != null) {
                        const rem = isPausedOrBreak ? Math.max(0, seat.player.time_remaining) : adjustTime(seat.player.time_remaining);
                        timerText = rem <= 0 ? 'EXPIRED' : (isPausedOrBreak ? `⏸ ${formatTime(rem)}` : formatTime(rem));
                        timerColor = isPausedOrBreak ? '#8A8D91' : getTimerColor(rem);
                      }
                      const isExpired = seat.player?.is_expired;
                      const borderColor = isOccupied
                        ? (isExpired ? '#EF4444' : 'rgba(24,119,242,0.5)')
                        : 'rgba(62,64,66,0.5)';

                      return (
                        <div key={seat.number}
                          onClick={() => {
                            if (movingPlayer && !isOccupied) { completeMove(seat.number); return; }
                            if (movingPlayer && isOccupied) { setToast({ type: 'error', text: 'Seat occupied - pick an empty seat' }); return; }
                            if (isOccupied) setShowPlayerMenu(seat);
                            else openScanner('seat', seat.number);
                          }}
                          style={{
                            position: 'absolute', top: pos.top, left: pos.left,
                            transform: badgeTransform, zIndex: 2, cursor: 'pointer',
                            display: 'flex', flexDirection: badgeDirection, alignItems: 'center', gap: 10,
                            background: isExpired ? 'rgba(239,68,68,0.15)' : 'rgba(36,37,38,0.92)',
                            borderRadius: 14, padding: '6px 12px 6px 6px',
                            border: `2px solid ${borderColor}`, backdropFilter: 'blur(8px)', minWidth: 90,
                            transition: 'border-color 0.2s, box-shadow 0.2s' }}
                        >
                          <div style={{
                            width: 60, height: 60, borderRadius: '50%', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: isOccupied ? 'linear-gradient(135deg, #1877F2 0%, #1565c0 100%)' : 'rgba(255,255,255,0.06)',
                            border: `2px solid ${borderColor}`,
                            position: 'relative' }}>
                            {isOccupied ? (
                              <span style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>{firstName.charAt(0).toUpperCase()}</span>
                            ) : (
                              <span style={{ fontSize: 20, fontWeight: 600, color: '#6B7280' }}>{seat.number}</span>
                            )}
                            {/* Missed Blinds Sticker - overlays top-right of avatar */}
                            {isOccupied && (seat.player?.missed_blinds || 0) > 0 && (
                              <div style={{
                                position: 'absolute', top: -4, right: -4,
                                width: 22, height: 22, borderRadius: '50%',
                                background: (seat.player.missed_blinds >= 2) ? '#EF4444' : '#F97316',
                                border: '2px solid #18191A',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 10, fontWeight: 900, color: '#fff',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.6)',
                                zIndex: 3, overflow: 'visible' }}>
                                {seat.player.missed_blinds}
                              </div>
                            )}
                          </div>
                          <div style={{ overflow: 'hidden', textAlign: isRightSide ? 'right' : 'left' }}>
                            <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.2, color: isOccupied ? '#E4E6EB' : (movingPlayer ? '#22c55e' : '#6B7280'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                              {isOccupied ? fullName : (movingPlayer ? 'Move here' : 'Open')}
                            </div>
                            {/* Session Status Overlay (Paused / Meal Break) */}
                            {isOccupied && seat.player?.session_status && seat.player.session_status !== 'active' && (
                              <div style={{ fontSize: 10, fontWeight: 700, color: seat.player.session_status === 'meal_break' ? '#22c55e' : '#F59E0B', lineHeight: 1.2 }}>
                                {seat.player.session_status === 'paused' ? '⏸️ PAUSED' : '🍽️ MEAL BREAK'}
                              </div>
                            )}
                            {!isOccupied && (
                              <div style={{ fontSize: 10, color: movingPlayer ? 'rgba(34,197,94,0.6)' : 'rgba(255,255,255,0.25)' }}>{movingPlayer ? 'Tap to confirm' : 'Tap to seat'}</div>
                            )}
                            {timerText && (
                              <div style={{ fontSize: 14, fontWeight: 700, color: timerColor, fontFamily: 'monospace', lineHeight: 1.3 }}>
                                {timerText}
                              </div>
                            )}
                            {isOccupied && seat.player?.membership_tier && (
                              <div style={{ fontSize: 11, color: '#8B5CF6', fontWeight: 600 }}>{seat.player.membership_tier}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Ticker */}
          <DealerTicker accentColor="#1877F2" bgColor="#000" fontSize={18} borderColor="rgba(255,255,255,0.1)" speed={50} showBorder={true} />

          {/* Footer */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', padding: '6px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)', margin: 0 }}>🔒 Locked to Table {lockedTableNum} - Manager PIN required to unlock</p>
            <p style={{ color: 'rgba(255,255,255,0.15)', fontSize: 11, letterSpacing: 1, margin: 0 }}>Powered By Smarter.Poker</p>
          </div>

          {/* ── Player Action Menu ── */}
          {showPlayerMenu && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 90,
              display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowPlayerMenu(null)}>
              <div onClick={e => e.stopPropagation()} style={{
                background: '#242526', borderRadius: 20, padding: '24px', width: '90%', maxWidth: 340,
                border: '2px solid #3A3B3C', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
                {/* Player Header */}
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <div style={{
                    width: 64, height: 64, borderRadius: '50%', margin: '0 auto 10px',
                    background: 'linear-gradient(135deg, #1877F2, #1565c0)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 28, fontWeight: 900, color: '#fff' }}>
                    {(showPlayerMenu.player?.player_name || 'P').charAt(0).toUpperCase()}
                  </div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#fff' }}>
                    {showPlayerMenu.player?.player_name || 'Player'}
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8A8D91' }}>
                    Seat {showPlayerMenu.number} · Table {lockedTableNum}
                  </p>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { label: '🪑 Move Player', color: '#1877F2', action: () => startMovePlayer(showPlayerMenu) },
                    { label: '✗ Remove Player', color: '#EF4444', action: () => removePlayer(showPlayerMenu) },
                    ...(showPlayerMenu.player?.session_status === 'paused' || showPlayerMenu.player?.session_status === 'meal_break'
                      ? [{ label: '▶️ Resume Timer', color: '#22c55e', action: async () => { const json = await callSessionAction(showPlayerMenu, 'resume'); if (json.success) { setToast({ type: 'success', text: `▶️ ${json.data.player_name} resumed` }); } else { setToast({ type: 'error', text: json.error || 'Resume failed' }); } setShowPlayerMenu(null); fetchData(); } }]
                      : [{ label: '⏸️ Pause Timer', color: '#F59E0B', action: () => pausePlayer(showPlayerMenu) }]
                    ),
                    { label: 'Missed Blinds', color: '#F97316', action: () => markMissedBlinds(showPlayerMenu) },
                    { label: '🍽️ 30-Min Meal Break', color: '#8B5CF6', action: () => addMealBreak(showPlayerMenu) },
                  ].map((btn, i) => (
                    <button key={i} onClick={btn.action} disabled={playerActionLoading}
                      style={{
                        padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer',
                        background: `${btn.color}15`, color: btn.color, fontSize: 15, fontWeight: 700,
                        textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                        transition: 'background 0.15s' }}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>

                <button onClick={() => setShowPlayerMenu(null)}
                  style={{
                    width: '100%', marginTop: 12, padding: '12px', borderRadius: 12,
                    background: '#3A3B3C', border: 'none', color: '#8A8D91', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >Cancel</button>
              </div>
            </div>
          )}

          {/* ── Camera Scanner Modal ── */}
          {showScanner && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 95,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>
                  {showScanner.type === 'dealer' ? '🃏' : '📸'}
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>
                  {showScanner.type === 'dealer' ? 'Scan Dealer QR Code' : `Scan Player for Seat ${showScanner.seatNumber}`}
                </h3>
                <p style={{ fontSize: 13, color: '#8A8D91', margin: '6px 0 0' }}>
                  Hold QR code in front of camera
                </p>
              </div>
              <div style={{
                width: '90%', maxWidth: 400, aspectRatio: '4/3', borderRadius: 16, overflow: 'hidden',
                border: '3px solid #1877F2', position: 'relative' }}>
                <video ref={scannerVideoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline muted />
                <div style={{
                  position: 'absolute', inset: 0, border: '3px solid rgba(24,119,242,0.5)',
                  borderRadius: 14, pointerEvents: 'none' }} />
              </div>
              {/* Manual QR Entry */}
              <form onSubmit={(e) => { e.preventDefault(); const val = e.target.elements.qr.value.trim(); if (val) handleScan(val, showScanner.type, showScanner.seatNumber); }}
                style={{ display: 'flex', gap: 8, marginTop: 16, width: '90%', maxWidth: 400 }}>
                <input name="qr" type="text" placeholder="Or enter QR code manually..."
                  style={{
                    flex: 1, padding: '12px 16px', borderRadius: 12, border: '2px solid #3A3B3C',
                    background: '#18191A', color: '#E4E6EB', fontSize: 14, outline: 'none' }} autoComplete="off" />
                <button type="submit" style={{
                  padding: '12px 20px', borderRadius: 12, background: '#1877F2', border: 'none',
                  color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Scan</button>
              </form>
              <button onClick={closeScanner}
                style={{
                  marginTop: 12, padding: '14px 48px', borderRadius: 12,
                  background: '#EF4444', border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}
              >Cancel</button>
            </div>
          )}

          {/* ── PIN Modal ── */}
          {showPinModal && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100,
              display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowPinModal(false)}>
              <div onClick={(e) => e.stopPropagation()} style={{
                background: '#242526', borderRadius: 20, padding: '32px 28px', width: '90%', maxWidth: 360,
                border: '2px solid #3A3B3C', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>🔐</div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#E4E6EB', margin: 0 }}>Manager Unlock</h3>
                  <p style={{ fontSize: 13, color: '#8A8D91', marginTop: 6 }}>Enter owner or manager PIN</p>
                </div>
                <div style={{
                  background: '#18191A', border: '2px solid #3A3B3C', borderRadius: 14,
                  padding: '16px', textAlign: 'center', marginBottom: 16,
                  fontSize: 32, fontWeight: 700, color: '#E4E6EB', letterSpacing: 12, fontFamily: 'monospace',
                  minHeight: 50 }}>
                  {'•'.repeat(pinValue.length) || <span style={{ color: '#4E4F50', fontSize: 16, letterSpacing: 1 }}>Enter PIN</span>}
                </div>
                {pinError && (
                  <div style={{
                    padding: '8px 12px', borderRadius: 8, marginBottom: 12,
                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                    color: '#EF4444', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>{pinError}</div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'].map((key, i) => {
                    if (key === null) return <div key={i} />;
                    const isDelete = key === 'del';
                    return (
                      <button key={i}
                        onClick={() => {
                          if (isDelete) setPinValue(v => v.slice(0, -1));
                          else if (pinValue.length < 4) setPinValue(v => v + key);
                        }}
                        style={{
                          padding: '14px', borderRadius: 12, fontSize: isDelete ? 14 : 22,
                          fontWeight: 700, cursor: 'pointer',
                          background: isDelete ? '#3A3B3C' : '#2A2B2D',
                          border: '1px solid #4A4B4D', color: '#E4E6EB' }}
                      >
                        {isDelete ? '⌫' : key}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={handleUnlockAttempt}
                  disabled={pinLoading || pinValue.length !== 4}
                  style={{
                    width: '100%', padding: '14px', borderRadius: 12,
                    background: pinValue.length === 4 ? '#1877F2' : '#3A3B3C',
                    color: '#fff', border: 'none', fontSize: 16, fontWeight: 700,
                    cursor: pinValue.length === 4 ? 'pointer' : 'default',
                    opacity: pinLoading ? 0.6 : 1 }}
                >
                  {pinLoading ? 'Verifying...' : '🔓 Unlock Display'}
                </button>
              </div>
            </div>
          )}
        </div>
      </CommanderLayout>
    );
  }

  /* ─── NORMAL ALL-TABLES VIEW ─────────────────────── */

  return (
    <CommanderLayout title="Table Status Display" backHref="/commander/dashboard?card=displays">
      <div onClick={goFullscreen}
        className="min-h-screen bg-black text-white font-['Inter'] select-none overflow-hidden flex flex-col">

        {/* Header */}
        <div className="bg-[#1877F2] px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-3xl font-bold tracking-wide">TABLE STATUS</h1>
            <div className="flex gap-4">
              <span className="text-lg opacity-90">
                <strong>{allTables.length}</strong> Tables
              </span>
              <span className="text-lg opacity-90">
                <strong>{totalSeated}</strong> Playing
              </span>
              <span className="text-lg opacity-90">
                <strong className={totalOpen > 0 ? 'text-[#31A24C]' : ''}>{totalOpen}</strong> Open
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <p className="text-sm text-white/60">Tap a table to lock display</p>
            <p className="text-3xl font-mono font-bold tabular-nums">
              {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
        </div>

        {/* Table Grid */}
        <div className="flex-1 p-6 overflow-hidden">
          {allTables.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-4xl font-bold text-white/15">No Active Tables</p>
            </div>
          ) : (
            <div className={`grid gap-4 h-full ${allTables.length <= 6 ? 'grid-cols-3 grid-rows-2' :
              allTables.length <= 9 ? 'grid-cols-3 grid-rows-3' :
                allTables.length <= 12 ? 'grid-cols-4 grid-rows-3' :
                  allTables.length <= 16 ? 'grid-cols-4 grid-rows-4' :
                    'grid-cols-5 grid-rows-4'
              }`}>
              {allTables.map(table => {
                const tNum = table.table_number || table.number;
                const maxSeats = table.max_seats || 9;
                const seats = table.seats || [];
                const games = Array.isArray(table.commander_games) ? table.commander_games : [];
                const game = games.find(g => g.status !== 'closed') || games[0];
                const seated = game?.current_players || seats.filter(s => s.status === 'occupied').length || 0;
                const open = Math.max(0, maxSeats - seated);
                const isFull = open === 0 && seated > 0;
                const isEmpty = seated === 0;
                const isActive = table.status === 'in_use';
                const seatPositions = computeSeatPositions(maxSeats).seatPositions;
                const dealer = dealerMap[tNum];

                return (
                  <div key={table.id || tNum}
                    onClick={(e) => { e.stopPropagation(); lockToTable(tNum); }}
                    className={`relative rounded-2xl p-3 flex flex-col items-center justify-center border-2 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:brightness-110 ${!isActive ? 'bg-white/[0.03] border-white/10' :
                      isFull ? 'bg-[#1877F2]/10 border-[#1877F2]/30' :
                        'bg-[#31A24C]/10 border-[#31A24C]/30'
                      }`}>

                    {/* Mini seat ring */}
                    <div className="relative w-20 h-16 mb-1">
                      <div className={`absolute inset-[15%] rounded-[50%] border ${!isActive ? 'border-white/10' : isFull ? 'border-[#1877F2]/20' : 'border-[#31A24C]/20'}`} />
                      {seatPositions.map((pos, i) => {
                        const seatData = seats.find(s => s.seat_number === i + 1);
                        const isOccupied = seatData?.status === 'occupied' || (isActive && i < seated);
                        return (
                          <div key={i}
                            className={`absolute w-2.5 h-2.5 rounded-full ${isOccupied ? 'bg-[#1877F2]' : 'bg-white/15'}`}
                            style={{ left: `${parseFloat(pos.left)}%`, top: `${parseFloat(pos.top)}%`, transform: 'translate(-50%, -50%)' }} />
                        );
                      })}
                    </div>

                    {/* Table number */}
                    <p className="text-2xl font-bold text-white">T{tNum}</p>

                    {/* Game info */}
                    <p className="text-xs text-white/50 truncate max-w-full">
                      {(game?.game_type || table.game_type || 'NLH').toUpperCase()} {game?.stakes || table.stakes || ''}
                    </p>

                    {/* Dealer */}
                    {dealer && (
                      <p className="text-[10px] text-[#1877F2] font-semibold truncate max-w-full mt-0.5">
                        🎲 {dealer}
                      </p>
                    )}

                    {/* Seat count */}
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-sm font-medium text-white/70">{seated}/{maxSeats}</span>
                      {isActive && open > 0 && (
                        <span className="text-xs font-bold text-[#31A24C] bg-[#31A24C]/20 px-2 py-0.5 rounded-full">
                          {open} OPEN
                        </span>
                      )}
                      {isActive && isFull && (
                        <span className="text-xs font-bold text-[#1877F2] bg-[#1877F2]/20 px-2 py-0.5 rounded-full">
                          FULL
                        </span>
                      )}
                      {!isActive && (
                        <span className="text-xs font-bold text-white/30 bg-white/5 px-2 py-0.5 rounded-full">
                          {table.status === 'reserved' ? 'RSVD' : table.status === 'maintenance' ? 'MAINT' : 'IDLE'}
                        </span>
                      )}
                    </div>

                    {/* Lock hint on hover */}
                    <div className="absolute inset-0 rounded-2xl flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/40">
                      <span className="text-white text-sm font-bold bg-black/60 px-4 py-2 rounded-xl">🔒 Tap to Lock</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Dealer Push/Break + Promo Ticker */}
        <DealerTicker
          accentColor="#1877F2"
          bgColor="#000"
          fontSize={18}
          borderColor="rgba(255,255,255,0.1)"
          speed={50}
          showBorder={true}
        />

        {/* Footer */}
        <div className="border-t border-white/10 px-8 py-2 flex items-center justify-between">
          <p className="text-sm text-white/20">See The Front Desk Or Join The Waitlist For An Open Seat</p>
          <p className="text-white/15 text-xs tracking-wider">Powered By Smarter.Poker</p>
        </div>
      </div>
    </CommanderLayout>
  );
}
