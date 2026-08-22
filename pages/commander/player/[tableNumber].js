/**
 * Player Table Display + Dealer Scan-In + Player Scan-In
 * /commander/player/[tableNumber]
 * 
 * Player-facing screen mounted at the table or on a small tablet.
 * Shows ALL seated players at this table with live timing.
 * 
 * DUAL MODE:
 *   Texas clubs: countdown timers (time remaining from purchased balance)
 *   Charity/Home: count-up timers (elapsed play duration)
 * 
 * DEALER SCAN-IN:
 * - Shows current dealer in a banner below the header
 * - "Change Dealer" button opens camera QR scanner
 * - Dealer scans their QR to assign themselves to this table
 * 
 * PLAYER SCAN-IN:
 * - Tap empty seat → opens QR scanner → scans player card → seats player
 * - Tap occupied seat → shows player info with option to remove
 * - "Scan Player" button for quick-scan without picking a seat first
 * 
 * No authentication required - unauthenticated tablet.
 * Auto-refreshes every 3 seconds, timers tick locally every second.
 * 
 * Color coding (Texas mode):
 *   Green  = plenty of time (> 15 min)
 *   Yellow = running low (< 15 min)
 *   Red    = critical (< 5 min)
 *   Red pulse = expired (0:00)
 * 
 * Color coding (Charity/Home mode):
 *   Cyan for all players (no urgency)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import Script from 'next/script';
import { useCommanderSync, broadcastChange } from '../../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../../src/engine/EventBus';
import { getStaffData } from '../../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';
import { createClient } from '@supabase/supabase-js';

/* ─── Supabase client for Realtime (no auth needed for display) ── */
/* GUARD: createClient must NOT run during SSG - localStorage doesn't exist on server */
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const supabase = (typeof window !== 'undefined' && supabaseUrl && supabaseAnonKey) ? createClient(supabaseUrl, supabaseAnonKey) : null;

function formatCountdown(seconds) {
  if (seconds === null || seconds === undefined) return '--:--';
  if (seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatElapsed(startedAt) {
  if (!startedAt) return '--:--';
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getSeatPositions(count) {
  const positions = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
    positions.push({ x: 50 + Math.cos(angle) * 42, y: 50 + Math.sin(angle) * 38, seat: i + 1 });
  }
  return positions;
}

function getTimeColor(seconds) {
  if (seconds === null || seconds === undefined) return '#3A3B3C';
  if (seconds <= 0) return '#EF4444';
  if (seconds <= 300) return '#EF4444';
  if (seconds <= 900) return '#F59E0B';
  return '#31A24C';
}

function formatDealerTime(startedAt) {
  if (!startedAt) return '';
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now - start;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just Started';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

/* ── QR Scanner Modal ── */
function QRScannerModal({ onScan, onClose, title, subtitle }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    let animFrame;
    let active = true;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      } catch (err) {
        console.warn('Camera error:', err);
        setError('Camera Access Denied. Please Allow Camera Access To Scan QR Codes.');
        return;
      }

      // Scan loop
      const scan = () => {
        if (!active || !videoRef.current || !canvasRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          if (typeof window.jsQR === 'function') {
            const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'dontInvert'
            });
            if (code?.data) {
              setScanning(false);
              onScan(code.data);
              return;
            }
          }
        }
        animFrame = requestAnimationFrame(scan);
      };

      if (videoRef.current) {
        videoRef.current.onloadeddata = () => {
          if (active) scan();
        };
      }
    };

    startCamera();

    return () => {
      active = false;
      if (animFrame) cancelAnimationFrame(animFrame);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [onScan]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '20px'
    }}>
      <h2 style={{ color: '#fff', fontSize: '20px', fontWeight: 700, marginBottom: '16px' }}>
        {title || 'Scan Card'}
      </h2>
      <p style={{ color: '#B0B3B8', fontSize: '14px', marginBottom: '20px', textAlign: 'center' }}>
        {subtitle || 'Hold The Member Card QR Code In Front Of The Camera'}
      </p>

      {error ? (
        <div style={{
          background: '#3A1010', border: '2px solid #EF4444', borderRadius: '12px',
          padding: '20px', color: '#EF4444', maxWidth: '400px', textAlign: 'center'
        }}>
          <p>{error}</p>
          <button onClick={onClose} style={{
            marginTop: '16px', padding: '10px 24px', background: '#EF4444',
            color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer',
            fontWeight: 600
          }}>Close</button>
        </div>
      ) : (
        <>
          <div style={{
            position: 'relative', width: '100%', maxWidth: '400px',
            aspectRatio: '4/3', borderRadius: '16px', overflow: 'hidden',
            border: scanning ? '3px solid #22D3EE' : '3px solid #31A24C'
          }}>
            <video
              ref={videoRef}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              playsInline
              muted
            />
            {scanning && (
              <div style={{
                position: 'absolute', left: '10%', right: '10%', height: '2px',
                background: '#22D3EE', boxShadow: '0 0 8px #22D3EE',
                animation: 'scanLine 2s linear infinite'
              }} />
            )}
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} viewBox="0 0 100 100">
              <path d="M20 5 L5 5 L5 20" fill="none" stroke="#22D3EE" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M80 5 L95 5 L95 20" fill="none" stroke="#22D3EE" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M20 95 L5 95 L5 80" fill="none" stroke="#22D3EE" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M80 95 L95 95 L95 80" fill="none" stroke="#22D3EE" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </>
      )}

      <button onClick={onClose} style={{
        marginTop: '24px', padding: '12px 32px', background: 'transparent',
        color: '#B0B3B8', border: '2px solid #3A3B3C', borderRadius: '10px',
        cursor: 'pointer', fontWeight: 600, fontSize: '16px'
      }}>Cancel</button>
    </div>
  );
}

/* ── Player Info Modal (tap occupied seat) ── */
function PlayerInfoModal({ player, venueType, onRemove, onClose }) {
  const [confirming, setConfirming] = useState(false);
  const isTexas = venueType === 'texas';
  const t = player.time_remaining;
  const color = isTexas ? getTimeColor(t) : '#22D3EE';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'rgba(0,0,0,0.85)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '20px'
    }} onClick={onClose}>
      <div style={{
        background: '#1C1C1E', borderRadius: '16px', border: `2px solid ${color}40`,
        padding: '24px', maxWidth: '360px', width: '100%',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)'
      }} onClick={e => e.stopPropagation()}>
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: `${color}15`, border: `3px solid ${color}50`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 12px', fontSize: '24px', fontWeight: 700, color
          }}>
            S{player.seat_number}
          </div>
          <p style={{ fontSize: '18px', fontWeight: 700, color: '#fff' }}>{player.player_name}</p>
          {player.membership_tier && (
            <p style={{ fontSize: '12px', color: '#B0B3B8', marginTop: '4px' }}>
              {player.membership_tier} Member
            </p>
          )}
        </div>

        <div style={{
          background: `${color}10`, borderRadius: '12px', border: `1px solid ${color}30`,
          padding: '16px', textAlign: 'center', marginBottom: '16px'
        }}>
          <p style={{ fontSize: '12px', color: '#B0B3B8', marginBottom: '4px' }}>
            {isTexas ? 'Time Remaining' : 'Playing For'}
          </p>
          <p style={{ fontSize: '32px', fontFamily: 'monospace', fontWeight: 700, color }}>
            {isTexas ? formatCountdown(t) : formatElapsed(player.started_at)}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '12px', borderRadius: '10px',
            background: '#3A3B3C', color: '#fff', border: 'none',
            fontWeight: 600, fontSize: '14px', cursor: 'pointer'
          }}>Close</button>

          {!confirming ? (
            <button onClick={() => setConfirming(true)} style={{
              flex: 1, padding: '12px', borderRadius: '10px',
              background: '#3A1515', color: '#EF4444', border: '2px solid #EF444440',
              fontWeight: 600, fontSize: '14px', cursor: 'pointer'
            }}>Remove Player</button>
          ) : (
            <button onClick={() => onRemove(player)} style={{
              flex: 1, padding: '12px', borderRadius: '10px',
              background: '#EF4444', color: '#fff', border: 'none',
              fontWeight: 600, fontSize: '14px', cursor: 'pointer',
              animation: 'fadeIn 0.2s ease'
            }}>Confirm Remove</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PlayerTableDisplay() {
  useEffect(() => { busEmit.sessionStart('commander-player-tableNumber'); }, []);
  const router = useRouter();
  const { tableNumber } = router.query;
  const [players, setPlayers] = useState([]);
  const [table, setTable] = useState(null);
  const [now, setNow] = useState(new Date());
  const [dealer, setDealer] = useState(null);
  const [venueType, setVenueType] = useState('texas');
  const [showScanner, setShowScanner] = useState(false);
  const [scanMode, setScanMode] = useState('dealer'); // 'dealer' or 'player'
  const [targetSeat, setTargetSeat] = useState(null); // seat number for player scan
  const [scanStatus, setScanStatus] = useState(null); // { type: 'success'|'error'|'loading', message }
  const [selectedPlayer, setSelectedPlayer] = useState(null); // for player info modal
  const wakeLockRef = useRef(null);

  const isTexas = venueType === 'texas';

  // Fetch all tablet data (table info, sessions, dealer) in one call
  const fetchData = useCallback(async () => {
    if (!tableNumber) return;
    try {
      const venueParam = table?.venue_id ? `&venue_id=${table.venue_id}` : '';
      const json = await commanderFetchJSON(`/api/commander/dealer/tablet-data?table=${tableNumber}${venueParam}`);
      if (json.success) {
        setPlayers(json.data.players || []);
        setTable(json.data.table || null);
        setDealer(json.data.dealer || null);
        if (json.data.venue_type) setVenueType(json.data.venue_type);
      }
    } catch (err) { console.warn(err); }
  }, [tableNumber, table?.venue_id]);

  useEffect(() => {
    if (!tableNumber) return;
    fetchData();
    const poll = setInterval(fetchData, 30000); // fallback - Supabase Realtime handles instant updates
    return () => clearInterval(poll);
  }, [tableNumber, fetchData]);

  // Local ticker (countdown for Texas, re-render for elapsed display)
  useEffect(() => {
    const ticker = setInterval(() => {
      if (isTexas) {
        setPlayers(prev => prev.map(p => ({
          ...p,
          time_remaining: p.time_remaining !== null && p.time_remaining !== undefined
            ? Math.max(0, p.time_remaining - 1) : null
        })));
      }
      setNow(new Date());
    }, 1000);
    return () => clearInterval(ticker);
  }, [isTexas]);

  // Commander Data Bus - instant sync for player and dealer changes
  const [syncVenueId] = useState(() => {
    try { return getStaffData().venue_id; } catch { return table?.venue_id || null; }
  });
  useCommanderSync(syncVenueId || table?.venue_id || '', fetchData, { entities: ['tables', 'dealers'] });

  /* ─── Supabase Realtime - mirrors tablet/[tableNumber].js ──────── */
  // Coalesce bursts of change events into a single refetch.
  const refetchTimer = useRef(null);
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => { fetchData(); }, 400);
  }, [fetchData]);

  const realtimeVenueId = table?.venue_id || syncVenueId || null;

  useEffect(() => {
    if (!supabase || !tableNumber) return;
    let reconnects = 0;
    const MAX_RECONNECT = 3;
    let currentChannel = null;

    function connectChannel() {
      if (currentChannel) {
        try { supabase.removeChannel(currentChannel); } catch { /* ignore */ }
      }
      let channel = supabase
        .channel(`player-${tableNumber}-${Date.now()}`)
        .on('postgres_changes', {
          event: '*', schema: 'public',
          table: 'commander_table_sessions',
          filter: `table_number=eq.${tableNumber}` }, () => scheduleRefetch())
        .on('postgres_changes', {
          event: '*', schema: 'public',
          table: 'commander_dealer_rotations',
          filter: `table_number=eq.${tableNumber}` }, () => scheduleRefetch());
      if (realtimeVenueId) {
        channel = channel
          .on('postgres_changes', {
            event: '*', schema: 'public',
            table: 'commander_games',
            filter: `venue_id=eq.${realtimeVenueId}` }, () => scheduleRefetch())
          .on('postgres_changes', {
            event: '*', schema: 'public',
            table: 'commander_floor_calls',
            filter: `venue_id=eq.${realtimeVenueId}` }, () => scheduleRefetch());
      }
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          reconnects = 0;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[Player] Realtime channel error: ${status}`);
          if (reconnects < MAX_RECONNECT) {
            reconnects++;
            setTimeout(connectChannel, 3000 * reconnects);
          }
        }
      });
      currentChannel = channel;
    }

    connectChannel();
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      if (currentChannel) supabase.removeChannel(currentChannel);
    };
  }, [tableNumber, realtimeVenueId, scheduleRefetch]);

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

  // Handle dealer QR scan
  const handleDealerScan = useCallback(async (qrData) => {
    setShowScanner(false);
    setScanStatus({ type: 'loading', message: 'Scanning...' });

    try {
      const res = await commanderFetch('/api/commander/dealer/scan-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qr_code: qrData,
          table_number: parseInt(tableNumber),
          venue_id: table?.venue_id
        })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();

      if (json.success) {
        setDealer(json.data.dealer);
        setScanStatus({ type: 'success', message: `${json.data.dealer.name} Is Now Dealing` });
        broadcastChange('dealers');
        broadcastChange('tables');
      } else {
        setScanStatus({ type: 'error', message: json.error || 'Scan Failed' });
      }
    } catch (err) {
      setScanStatus({ type: 'error', message: 'Network Error. Please Try Again.' });
    }

    setTimeout(() => setScanStatus(null), 4000);
  }, [tableNumber, table]);

  // Handle player QR scan
  const handlePlayerScan = useCallback(async (qrData) => {
    setShowScanner(false);
    setScanStatus({ type: 'loading', message: 'Scanning Player...' });

    try {
      const res = await commanderFetch('/api/commander/dealer/player-scan-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qr_code: qrData,
          table_number: parseInt(tableNumber),
          seat_number: targetSeat || undefined,
          venue_id: table?.venue_id
        })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();

      if (json.success) {
        const d = json.data;
        setScanStatus({
          type: 'success',
          message: `${d.player_name} Seated At S${d.seat_number}${d.time_allocated_minutes ? ` (${d.time_allocated_minutes}m)` : ''}`
        });
        setTargetSeat(null);
        broadcastChange('tables');
      } else {
        setScanStatus({ type: 'error', message: json.error || 'Scan Failed' });
      }
    } catch (err) {
      setScanStatus({ type: 'error', message: 'Network Error. Please Try Again.' });
    }

    setTimeout(() => setScanStatus(null), 4000);
  }, [tableNumber, table, targetSeat]);

  // Handle player removal
  const handleRemovePlayer = useCallback(async (player) => {
    setSelectedPlayer(null);
    setScanStatus({ type: 'loading', message: 'Removing Player...' });

    try {
      const res = await commanderFetch('/api/commander/dealer/player-unseat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: player.session_id, venue_id: table?.venue_id })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();

      if (json.success) {
        const d = json.data;
        let msg = `${d.player_name} Removed (${d.elapsed_minutes}m Played)`;
        if (d.unused_minutes_returned > 0) msg += ` · ${d.unused_minutes_returned}m Returned`;
        if (d.comp_earned > 0) msg += ` · $${d.comp_earned} Comp`;
        setScanStatus({ type: 'success', message: msg });
        broadcastChange('tables');
      } else {
        setScanStatus({ type: 'error', message: json.error || 'Remove Failed' });
      }
    } catch (err) {
      setScanStatus({ type: 'error', message: 'Network Error. Please Try Again.' });
    }

    setTimeout(() => setScanStatus(null), 5000);
  }, [table?.venue_id]);

  // Open scanner
  const openDealerScanner = (e) => {
    e.stopPropagation();
    setScanMode('dealer');
    setTargetSeat(null);
    setShowScanner(true);
  };

  const openPlayerScanner = (e, seatNum) => {
    e?.stopPropagation();
    setScanMode('player');
    setTargetSeat(seatNum || null);
    setShowScanner(true);
  };

  // Tap occupied seat
  const handleSeatTap = (e, player) => {
    e.stopPropagation();
    setSelectedPlayer(player);
  };

  const goFullscreen = () => document.documentElement.requestFullscreen?.();
  const maxSeats = table?.max_seats || 9;
  const seatPositions = getSeatPositions(maxSeats);

  return (
    <>
      <SEOHead
        title="Commander - Details"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />

      <Script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js" strategy="beforeInteractive" />

      <style>{`
        body { overflow: hidden; }
        @keyframes pulse-expired { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .expired-pulse { animation: pulse-expired 1s ease-in-out infinite; }
        @keyframes ring-pulse { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(1.4); opacity: 0; } }
        @keyframes scanLine { 0% { top: 10%; } 100% { top: 90%; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes seat-glow { 0%, 100% { border-color: rgba(34,211,238,0.15); } 50% { border-color: rgba(34,211,238,0.4); } }
        .empty-seat-pulse { animation: seat-glow 3s ease-in-out infinite; }
      `}</style>

      <div onClick={goFullscreen}
        className="h-screen bg-[#0A0A0A] text-white font-['Inter'] select-none overflow-hidden flex flex-col">

        {/* Header */}
        <div className="bg-[#1877F2] px-6 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">Table {tableNumber}</h1>
            <span className="text-sm opacity-80">
              {table?.game_type || 'NLH'} {table?.stakes || ''} - {players.length}/{maxSeats}
            </span>
            {!isTexas && (
              <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
                {venueType === 'charity' ? 'Charity' : 'Home Game'}
              </span>
            )}
          </div>
          <p className="text-2xl font-mono font-bold tabular-nums">
            {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
          </p>
        </div>

        {/* Dealer Banner */}
        <div style={{
          background: dealer ? '#1a2a1a' : '#1a1a2a',
          borderBottom: `2px solid ${dealer ? '#31A24C40' : '#22D3EE30'}`,
          padding: '8px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '50%',
              background: dealer ? '#31A24C20' : '#22D3EE15',
              border: `2px solid ${dealer ? '#31A24C50' : '#22D3EE30'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden'
            }}>
              {dealer?.photo_url ? (
                <img src={dealer.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={dealer ? '#31A24C' : '#22D3EE'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              )}
            </div>
            <div>
              {dealer ? (
                <>
                  <p style={{ fontSize: '14px', fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                    {dealer.name}
                  </p>
                  <p style={{ fontSize: '11px', color: '#B0B3B8', lineHeight: 1.2 }}>
                    Dealer · {formatDealerTime(dealer.started_at)}
                  </p>
                </>
              ) : (
                <p style={{ fontSize: '14px', color: '#888', fontWeight: 500 }}>No Dealer Assigned</p>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {/* Scan Player button */}
            <button
              onClick={(e) => openPlayerScanner(e)}
              style={{
                padding: '8px 16px', borderRadius: '8px', cursor: 'pointer',
                fontWeight: 600, fontSize: '13px', border: 'none',
                background: '#22D3EE', color: '#000',
                transition: 'all 0.2s'
              }}
            >
              Scan Player
            </button>

            {/* Change Dealer button */}
            <button
              onClick={openDealerScanner}
              style={{
                padding: '8px 16px', borderRadius: '8px', cursor: 'pointer',
                fontWeight: 600, fontSize: '13px', border: 'none',
                background: dealer ? '#3A3B3C' : '#22D3EE',
                color: dealer ? '#fff' : '#000',
                transition: 'all 0.2s'
              }}
            >
              {dealer ? 'Change Dealer' : 'Scan Dealer'}
            </button>
          </div>
        </div>

        {/* Scan Status Toast */}
        {scanStatus && (
          <div style={{
            position: 'absolute', top: '120px', left: '50%', transform: 'translateX(-50%)',
            padding: '12px 24px', borderRadius: '12px', zIndex: 100,
            background: scanStatus.type === 'success' ? '#1a3a1a' : scanStatus.type === 'error' ? '#3a1a1a' : '#1a1a3a',
            border: `2px solid ${scanStatus.type === 'success' ? '#31A24C' : scanStatus.type === 'error' ? '#EF4444' : '#22D3EE'}`,
            color: '#fff', fontWeight: 600, fontSize: '14px',
            animation: 'fadeIn 0.3s ease', whiteSpace: 'nowrap',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
          }}>
            {scanStatus.type === 'success' ? '✓ ' : scanStatus.type === 'error' ? '✗ ' : ''}
            {scanStatus.message}
          </div>
        )}

        {/* Main: Seat Map with Timers */}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="relative w-full max-w-2xl" style={{ aspectRatio: '16/10' }}>

            {/* Table felt */}
            <div className="absolute inset-[10%] rounded-[50%] bg-[#1a3a1a]/30 border-2 border-[#2a5a2a]/40" />

            {/* Center label */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
              <p className="text-sm text-white/20 uppercase tracking-[0.3em]">T{tableNumber}</p>
              {!isTexas && (
                <p className="text-xs text-[#22D3EE]/30 mt-1">
                  {venueType === 'charity' ? 'Charity Game' : 'Home Game'}
                </p>
              )}
            </div>

            {/* Seat positions */}
            {seatPositions.map(pos => {
              const player = players.find(p => p.seat_number === pos.seat);
              const t = player?.time_remaining;
              const color = isTexas ? getTimeColor(t) : '#22D3EE';
              const isExpired = isTexas && t !== null && t !== undefined && t <= 0;
              const isCritical = isTexas && t !== null && t !== undefined && t <= 300 && t > 0;

              return (
                <div key={pos.seat} className="absolute flex flex-col items-center"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}>

                  {!player ? (
                    /* Empty seat - tappable to scan player */
                    <div
                      className="w-16 h-16 rounded-full bg-white/3 border border-white/8 flex items-center justify-center cursor-pointer empty-seat-pulse"
                      style={{ borderColor: 'rgba(34,211,238,0.15)' }}
                      onClick={(e) => openPlayerScanner(e, pos.seat)}
                    >
                      <div className="flex flex-col items-center">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22D3EE" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                        <span className="text-[10px] text-white/15 mt-0.5">{pos.seat}</span>
                      </div>
                    </div>
                  ) : (
                    /* Occupied seat - tappable for player info */
                    <>
                      <div
                        className={`relative w-16 h-16 rounded-full flex items-center justify-center border-2 cursor-pointer ${isExpired ? 'expired-pulse' : ''}`}
                        style={{ backgroundColor: `${color}15`, borderColor: `${color}60` }}
                        onClick={(e) => handleSeatTap(e, player)}
                      >
                        <span className="text-base font-mono font-bold" style={{ color }}>
                          {isTexas
                            ? (isExpired ? 'OUT' : formatCountdown(t))
                            : formatElapsed(player.started_at)
                          }
                        </span>

                        {isCritical && (
                          <div className="absolute inset-0 rounded-full border-2 opacity-0"
                            style={{ borderColor: color, animation: 'ring-pulse 1.5s ease-out infinite' }} />
                        )}
                      </div>

                      <span className="text-xs text-white/70 mt-1 max-w-[80px] truncate text-center font-medium">
                        {player.player_name}
                      </span>
                      <span className="text-[9px] text-white/30">S{pos.seat}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Player List at bottom */}
        {players.length > 0 && (
          <div className="bg-[#111] border-t border-white/10 px-6 py-3">
            <div className="flex flex-wrap gap-4 justify-center">
              {players
                .sort((a, b) => {
                  if (isTexas) return (a.time_remaining ?? Infinity) - (b.time_remaining ?? Infinity);
                  // Charity: sort by longest playing first
                  return new Date(a.started_at) - new Date(b.started_at);
                })
                .map(p => {
                  const t = p.time_remaining;
                  const color = isTexas ? getTimeColor(t) : '#22D3EE';
                  const isExpired = isTexas && t !== null && t !== undefined && t <= 0;
                  return (
                    <div key={p.session_id || p.seat_number}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl cursor-pointer ${isExpired ? 'expired-pulse' : ''}`}
                      style={{ backgroundColor: `${color}10`, border: `2px solid ${color}30` }}
                      onClick={(e) => handleSeatTap(e, p)}
                    >
                      <span className="text-xs text-white/50">S{p.seat_number}</span>
                      <span className="text-sm font-medium text-white">{p.player_name?.split(' ')[0]}</span>
                      <span className="text-lg font-mono font-bold" style={{ color }}>
                        {isTexas
                          ? (isExpired ? 'EXPIRED' : formatCountdown(t))
                          : formatElapsed(p.started_at)
                        }
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Branding */}
        <div className="flex-shrink-0 py-1 text-center">
          <p className="text-white/10 text-[10px] tracking-wider">Powered By Smarter.Poker</p>
        </div>
      </div>

      {/* QR Scanner Modal */}
      {showScanner && (
        <QRScannerModal
          onScan={scanMode === 'dealer' ? handleDealerScan : handlePlayerScan}
          onClose={() => { setShowScanner(false); setTargetSeat(null); }}
          title={scanMode === 'dealer' ? 'Scan Dealer Card' : `Scan Player Card${targetSeat ? `, Seat ${targetSeat}` : ''}`}
          subtitle={scanMode === 'dealer'
            ? 'Hold The Employee Card QR Code In Front Of The Camera'
            : 'Hold The Player Member Card QR Code In Front Of The Camera'
          }
        />
      )}

      {/* Player Info Modal */}
      {selectedPlayer && (
        <PlayerInfoModal
          player={selectedPlayer}
          venueType={venueType}
          onRemove={handleRemovePlayer}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </>
  );
}
