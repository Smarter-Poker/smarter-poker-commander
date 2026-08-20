/**
 * Tablet Display - Fullscreen Kiosk View for a Single Table
 * /commander/tablet/[tableNumber]?venue=VENUE_ID
 *
 * Each physical tablet opens this URL locked to one table.
 * No auth required - the URL IS the assignment.
 *
 * Features:
 * - Fullscreen poker table with seat badges, live timers, dealer info
 * - Real-time via Supabase Realtime + 10s fallback polling
 * - Promotion/announcement ticker across bottom
 * - Screen-wake lock to prevent tablet sleep
 * - Heartbeat ping every 30s for admin online-status monitoring
 * - Landscape-optimized kiosk styling
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { createClient } from '@supabase/supabase-js';
import { busEmit } from '../../../src/engine/EventBus';
import { commanderFetch } from '../../../src/lib/commander/commanderFetch';
import { getVenueId } from '../../../src/lib/commander/clientAuth';

/* ─── Supabase client for Realtime (no auth needed for display) ── */
/* GUARD: createClient must NOT run during SSG - localStorage doesn't exist on server */
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const supabase = (typeof window !== 'undefined' && supabaseUrl && supabaseAnonKey) ? createClient(supabaseUrl, supabaseAnonKey) : null;

/* ─── Constants ──────────────────────────────────────────────── */

const POLL_INTERVAL = 10000; // 10s data poll
const HEARTBEAT_INTERVAL = 30000; // 30s heartbeat

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

// Arc-length ellipse for equal seat spacing - same algo as table-tablets.js
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
        allPos.push({
            top: `${cyE + ry * Math.sin(angle)}%`,
            left: `${cxE + rx * Math.cos(angle)}%` });
    }
    const dealerPos = allPos[0];
    const seatPositions = allPos.slice(1);
    seatPositions.forEach(p => { const t = parseFloat(p.top); if (t < 30) p.top = '30%'; });
    return { dealerPos, seatPositions };
}

/* ─── Page Component ─────────────────────────────────────────── */

export default function TabletDisplay() {
    useEffect(() => { busEmit.sessionStart('commander-tablet-tableNumber'); }, []);
    const router = useRouter();
    const { tableNumber, venue } = router.query;

    const [data, setData] = useState(null);
    const [promotions, setPromotions] = useState([]);
    const [announcements, setAnnouncements] = useState([]);
    const [venueName, setVenueName] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [now, setNow] = useState(Date.now());
    const lastFetchAt = useRef(Date.now());

    // Resolve venue_id from query or localStorage
    const venueId = venue || (() => {
        return getVenueId();
    })();

    /* ─── Data Fetching ─────────────────────────────────────────── */

    const fetchData = useCallback(async () => {
        if (!tableNumber) return;
        try {
            const url = `/api/commander/dealer/tablet-data?table=${tableNumber}${venueId ? `&venue_id=${venueId}` : ''}`;
            const res = await fetch(url);
            // HIGH FIX #2a: Add response.ok check before .json()
            if (!res.ok) {
                const errorText = await res.text().catch(() => 'Unknown error');
                throw new Error(`HTTP ${res.status}: ${errorText}`);
            }
            const json = await res.json();
            if (json.success) {
                setData(json.data);
                if (json.data.venue_name) setVenueName(json.data.venue_name);
                if (json.data.promotions) setPromotions(json.data.promotions);
                if (json.data.announcements) setAnnouncements(json.data.announcements);
                lastFetchAt.current = Date.now();
                setError(null);
            } else {
                setError(json.error || 'Failed to load table data');
            }
        } catch (err) {
            console.warn('Tablet fetch error:', err);
            setError('Connection lost - retrying...');
        }
        setLoading(false);
    }, [tableNumber, venueId]);

    // Initial fetch + polling
    useEffect(() => {
        if (!tableNumber) return;
        fetchData();
        const poll = setInterval(fetchData, POLL_INTERVAL);
        return () => clearInterval(poll);
    }, [tableNumber, fetchData]);

    // 1-second clock for live countdowns
    useEffect(() => {
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(tick);
    }, []);

    /* ─── Screen Wake Lock ─────────────────────────────────────── */

    useEffect(() => {
        let wakeLock = null;
        const requestWakeLock = async () => {
            try {
                if ('wakeLock' in navigator) {
                    wakeLock = await navigator.wakeLock.request('screen');
                }
            } catch { /* Not supported or permission denied */ }
        };
        requestWakeLock();
        // Re-acquire on visibility change
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') requestWakeLock();
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            if (wakeLock) wakeLock.release().catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
        };
    }, []);

    /* ─── Heartbeat ────────────────────────────────────────────── */

    useEffect(() => {
        if (!tableNumber || !venueId) return;
        const sendHeartbeat = () => {
            commanderFetch('/api/commander/displays/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ table_number: parseInt(tableNumber), venue_id: venueId, device_type: 'tablet' }) }).then(res => { if (!res.ok) console.warn('Heartbeat failed'); }).catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
        };
        sendHeartbeat();
        const hb = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
        return () => clearInterval(hb);
    }, [tableNumber, venueId]);

    /* ─── Supabase Realtime ────────────────────────────────────── */

    useEffect(() => {
        if (!supabase || !tableNumber || !venueId) return;
        let reconnects = 0;
        const MAX_RECONNECT = 3;
        let currentChannel = null;

        function connectChannel() {
            if (currentChannel) {
                try { supabase.removeChannel(currentChannel); } catch { /* ignore */ }
            }
            const channel = supabase
                .channel(`tablet-${tableNumber}-${Date.now()}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'commander_table_sessions',
                    filter: `table_number=eq.${tableNumber}` }, () => fetchData())
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'commander_dealer_rotations',
                    filter: `table_number=eq.${tableNumber}` }, () => fetchData())
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'commander_games',
                    filter: `venue_id=eq.${venueId}` }, () => fetchData())
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'commander_tournament_entries',
                    filter: `table_number=eq.${tableNumber}` }, () => fetchData())
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        reconnects = 0;
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        console.warn(`[Tablet] Realtime channel error: ${status}`);
                        if (reconnects < MAX_RECONNECT) {
                            reconnects++;
                            setTimeout(connectChannel, 3000 * reconnects);
                        }
                    }
                });
            currentChannel = channel;
        }

        connectChannel();
        return () => { if (currentChannel) supabase.removeChannel(currentChannel); };
    }, [tableNumber, venueId, fetchData]);

    /* ─── Computed Values ──────────────────────────────────────── */

    const adjustTime = useCallback((apiTimeRemaining) => {
        if (apiTimeRemaining == null) return null;
        const elapsed = Math.floor((Date.now() - lastFetchAt.current) / 1000);
        return Math.max(0, apiTimeRemaining - elapsed);
    }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

    const table = data?.table;
    const players = data?.players || [];
    const dealer = data?.dealer;
    const maxSeats = table?.max_seats || 9;
    const { dealerPos, seatPositions } = computeSeatPositions(maxSeats);
    const gameType = (table?.game_type || 'NLH').toUpperCase();
    const stakes = table?.stakes || '';
    const tableNum = parseInt(tableNumber) || 0;
    const isActive = table?.status === 'in_use';

    // Build seat array
    const seatArr = Array.from({ length: maxSeats }, (_, i) => {
        const seatNum = i + 1;
        const player = players.find(p => p.seat_number === seatNum);
        return { number: seatNum, player: player || null };
    });
    const occupiedCount = seatArr.filter(s => s.player).length;

    // Ticker items
    const tickerItems = [
        ...promotions.map(p => `🎲 ${p.title || p.name || 'Promotion'}`),
        ...announcements.map(a => `📢 ${a.title || a.message || 'Announcement'}`),
    ];
    if (tickerItems.length === 0) tickerItems.push(`Welcome to ${venueName || 'the Poker Room'}`);

    /* ─── Loading / Error States ───────────────────────────────── */

    if (!tableNumber) return null;

    if (loading) return (
        <div style={fullScreenStyle}>
            <Head><title>Table {tableNumber} | Tablet</title></Head>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 48, height: 48, border: '4px solid #1877F2', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <div style={{ color: '#8A8D91', fontSize: 16.5, fontWeight: 600 }}>Loading Table {tableNumber}...</div>
            </div>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );

    /* ─── Main Render ──────────────────────────────────────────── */

    return (
        <>
            <Head>
                <title>Table {tableNum} | {venueName || 'Tablet'}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
                <meta name="robots" content="noindex, nofollow" />
            </Head>

            <div style={fullScreenStyle}>
                {/* NO header - fullscreen table view matching table-tablets.js */}

                {/* ── Table Visual (full height) ─────────── */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 24px', overflow: 'hidden' }}>
                    <div style={{ width: '100%', maxWidth: 1100, position: 'relative' }}>
                        <div style={{ position: 'relative', width: '100%', paddingBottom: '52%', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, aspectRatio: '1 / 1', marginTop: '-20%' }}>
                                {/* Poker table image */}
                                <img
                                    src="/images/poker-table-black-gold.png"
                                    alt="Poker Table"
                                    style={{
                                        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                                        objectFit: 'contain', pointerEvents: 'none', zIndex: 0 }} />

                                {/* Center info */}
                                <div style={{
                                    position: 'absolute', top: '48%', left: '50%',
                                    transform: 'translate(-50%, -50%)', zIndex: 5, textAlign: 'center' }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 6 }}>
                                        {venueName || 'Poker Room'}
                                    </div>
                                    <div style={{ fontSize: 32, fontWeight: 900, color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: 1 }}>
                                        {gameType}
                                    </div>
                                    <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.6)', marginTop: 4, fontWeight: 700 }}>
                                        {stakes}
                                    </div>
                                    {!isActive && (
                                        <div style={{ fontSize: 14, color: '#1877F2', fontWeight: 700, marginTop: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                                            Table Open
                                        </div>
                                    )}
                                </div>

                                {/* Dealer badge */}
                                <div style={{
                                    position: 'absolute', top: dealerPos.top, left: dealerPos.left,
                                    transform: 'translate(-50%, -50%)', textAlign: 'center', width: 100, zIndex: 3 }}>
                                    <div style={{
                                        width: 76, height: 76, borderRadius: '50%', margin: '0 auto 6px',
                                        background: dealer ? 'linear-gradient(135deg, #1877F2 0%, #1565c0 100%)' : 'rgba(62,64,66,0.5)',
                                        border: '3px solid #E4E6EB',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        boxShadow: '0 2px 16px rgba(0,0,0,0.6), 0 0 20px rgba(24,119,242,0.3)',
                                        overflow: 'hidden' }}>
                                        {dealer?.photo_url ? (
                                            <img src={dealer.photo_url} alt={dealer.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                            <span style={{ fontSize: 34, fontWeight: 900, color: '#fff' }}>D</span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: dealer ? '#1877F2' : '#6B7280', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {dealer?.name || 'No Dealer'}
                                    </div>
                                </div>

                                {/* Seat badges */}
                                {seatArr.slice(0, seatPositions.length).map((seat, idx) => {
                                    const pos = seatPositions[idx];
                                    const isOccupied = !!seat.player;
                                    const firstName = seat.player?.player_name?.split(' ')[0] || '';
                                    const fullName = seat.player?.player_name || '';
                                    const leftPct = parseFloat(pos.left);
                                    const isLeftSide = leftPct < 25;
                                    const isRightSide = leftPct > 75;
                                    const badgeTransform = isLeftSide
                                        ? 'translate(-17px, -50%)'
                                        : isRightSide
                                            ? 'translate(calc(-100% + 17px), -50%)'
                                            : 'translate(-50%, -50%)';
                                    const badgeDirection = isRightSide ? 'row-reverse' : 'row';

                                    let timerText = null, timerColor = null;
                                    if (isOccupied && seat.player?.time_remaining != null) {
                                        const rem = adjustTime(seat.player.time_remaining);
                                        timerText = rem <= 0 ? 'EXPIRED' : formatTime(rem);
                                        timerColor = getTimerColor(rem);
                                    }

                                    const isExpired = seat.player?.is_expired;
                                    const isCritical = seat.player?.is_critical;
                                    const borderColor = isOccupied
                                        ? (isExpired ? '#EF4444' : isCritical ? '#F59E0B' : 'rgba(24,119,242,0.5)')
                                        : 'rgba(62,64,66,0.5)';

                                    return (
                                        <div key={seat.number} style={{
                                            position: 'absolute', top: pos.top, left: pos.left,
                                            transform: badgeTransform, zIndex: 2,
                                            display: 'flex', flexDirection: badgeDirection, alignItems: 'center', gap: 10,
                                            background: isExpired
                                                ? 'rgba(239,68,68,0.15)'
                                                : 'rgba(36,37,38,0.92)',
                                            borderRadius: 14,
                                            padding: '6px 12px 6px 6px',
                                            border: `2px solid ${borderColor}`,
                                            backdropFilter: 'blur(8px)',
                                            minWidth: 90,
                                            animation: isExpired ? 'pulse-border 1.5s ease-in-out infinite' : 'none' }}>
                                            {/* Avatar circle */}
                                            <div style={{
                                                width: 60, height: 60, borderRadius: '50%', flexShrink: 0,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                background: isOccupied
                                                    ? 'linear-gradient(135deg, #1877F2 0%, #1565c0 100%)'
                                                    : 'rgba(255,255,255,0.06)',
                                                border: `2px solid ${borderColor}`,
                                                overflow: 'hidden' }}>
                                                {isOccupied ? (
                                                    <span style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>{firstName.charAt(0).toUpperCase()}</span>
                                                ) : (
                                                    <span style={{ fontSize: 20, fontWeight: 600, color: '#6B7280' }}>{seat.number}</span>
                                                )}
                                            </div>
                                            {/* Name + Timer */}
                                            <div style={{ overflow: 'hidden', textAlign: isRightSide ? 'right' : 'left' }}>
                                                <div style={{
                                                    fontSize: 15, fontWeight: 600, lineHeight: 1.2,
                                                    color: isOccupied ? '#E4E6EB' : '#6B7280',
                                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    maxWidth: 140 }}>
                                                    {isOccupied ? fullName : 'Open'}
                                                </div>
                                                {timerText && (
                                                    <div style={{
                                                        fontSize: 14, fontWeight: 700, color: timerColor,
                                                        fontFamily: 'monospace', lineHeight: 1.3 }}>
                                                        {timerText}
                                                    </div>
                                                )}
                                                {isOccupied && seat.player?.membership_tier && (
                                                    <div style={{ fontSize: 11, color: '#8B5CF6', fontWeight: 600 }}>
                                                        {seat.player.membership_tier}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Promotion / announcement ticker (CSS marquee) ─────── */}
                <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    height: 44, display: 'flex', alignItems: 'center',
                    background: 'rgba(20,20,20,0.92)', borderTop: '1px solid rgba(255,255,255,0.08)',
                    overflow: 'hidden', whiteSpace: 'nowrap', zIndex: 15 }}>
                    <div style={{
                        display: 'inline-flex', flexShrink: 0, willChange: 'transform',
                        animation: 'ticker-marquee 40s linear infinite' }}>
                        {[...tickerItems, ...tickerItems].map((item, i) => (
                            <span key={i} style={{
                                display: 'inline-block', padding: '0 40px',
                                fontSize: 16, fontWeight: 600, color: '#E4E6EB', letterSpacing: 0.3 }}>
                                {item}
                            </span>
                        ))}
                    </div>
                </div>

                {/* ── Error overlay ───────────────────────── */}
                {error && (
                    <div style={{
                        position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)',
                        padding: '8px 20px', borderRadius: 12,
                        background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                        color: '#EF4444', fontSize: 13, fontWeight: 600, zIndex: 20 }}>
                        {error}
                    </div>
                )}
            </div>

            <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { overflow: hidden; background: #0A0A0A; }
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse-border {
          0%, 100% { border-color: rgba(239,68,68,0.5); box-shadow: 0 0 0 0 rgba(239,68,68,0); }
          50% { border-color: rgba(239,68,68,0.9); box-shadow: 0 0 16px 0 rgba(239,68,68,0.2); }
        }
        @keyframes ticker-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        ::-webkit-scrollbar { display: none; }
      `}</style>
        </>
    );
}

/* ─── Styles ──────────────────────────────────────────────── */

const fullScreenStyle = {
    position: 'fixed', inset: 0,
    display: 'flex', flexDirection: 'column',
    background: '#0A0A0A', color: '#E4E6EB',
    fontFamily: 'Inter, sans-serif',
    overflow: 'hidden' };
