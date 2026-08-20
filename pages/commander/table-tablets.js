/**
 * Table Tablets - Dealer View Dashboard
 * /commander/table-tablets
 *
 * Shows all tables with inline dealer view matching the Table Management visuals:
 * - Poker table image with positioned seat badges (avatars, names, timers)
 * - Dealer "D" badge on each table
 * - Fullscreen popup when a table is clicked
 * Tapping a table opens a fullscreen overlay with real-time seat data.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Monitor, Users, Loader2, Trophy, Clock, Timer, Armchair, ScanLine, Camera, X, CheckCircle, Maximize2, Copy, ExternalLink, ChevronDown, ChevronUp, Link2, Lock, Unlock, ShieldCheck, AlertTriangle, ArrowRightLeft, Coins, Skull, XCircle } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getToken, getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';
import { useConfirmAction } from "../../src/components/commander/shared/ConfirmModal";

const STATUS_BADGE = {
    in_use: { bg: '#31A24C', label: 'Active' },
    available: { bg: '#1877F2', label: 'Open' },
    reserved: { bg: '#F59E0B', label: 'Reserved' },
    maintenance: { bg: '#6B7280', label: 'Maint.' } };

// Full game type name mapping - never show abbreviations to dealers
const GAME_TYPE_MAP = {
    nlh: 'No Limit Hold\'em', nolimit: 'No Limit Hold\'em',
    plo: 'Pot Limit Omaha', potlimitomaha: 'Pot Limit Omaha',
    plh: 'Pot Limit Hold\'em',
    lh: 'Limit Hold\'em', limit: 'Limit Hold\'em',
    lo: 'Limit Omaha',
    mix: 'Mixed Games', mixed: 'Mixed Games',
    plo5: 'PLO 5-Card', plo6: 'PLO 6-Card',
    stud: 'Seven Card Stud', razz: 'Razz',
    horse: 'H.O.R.S.E.' };
function getFullGameName(type) {
    if (!type) return 'Cash Game';
    return GAME_TYPE_MAP[type.toLowerCase()] || type.toUpperCase();
}
// 2026-08-19: surface the server's real message instead of "Network error".
// Every handler below used to `throw` on !res.ok BEFORE reading the response
// body, so a 400 ("Insufficient time balance"), a 401 (staff session expired)
// or a 409 (ambiguous venue) all reached the dealer as a generic "Network
// error" - the actionable detail the API had already sent was discarded one
// line too early. This reads the body regardless of status and normalises the
// two error shapes the Commander APIs use (`error: 'text'` and
// `error: { code, message }`).
async function parseApiResponse(res) {
    let json = null;
    try { json = await res.json(); } catch (e) { /* empty or non-JSON body */ }
    if (!res.ok) {
        const msg = (json && (json.error?.message || (typeof json.error === 'string' ? json.error : null) || json.message))
            || (res.status === 401 ? 'Session expired - sign in again'
            :  res.status === 403 ? 'Not permitted for this venue'
            :  `Request failed (${res.status})`);
        return { ...(json || {}), success: false, error: msg, httpStatus: res.status };
    }
    return { ...(json || {}), httpStatus: res.status };
}

function isTournamentTable(table) {
    const mode = table.mode || table.table_purpose || 'cash';
    return mode === 'tournament';
}
function formatStakes(stakes) {
    if (!stakes) return '';
    // Already has $ → return as is
    if (stakes.includes('$')) return stakes;
    // Format: "1/2" → "$1/$2"
    const parts = stakes.split('/');
    return parts.map(p => `$${p.trim()}`).join('/');
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
    if (seconds <= 300) return '#EF4444';   // < 5 min - red
    if (seconds <= 900) return '#F59E0B';   // < 15 min - yellow
    return '#31A24C';                       // green
}

// ── Haptic feedback for tablet buttons ──
// Uses navigator.vibrate() where supported (Android tablets).
// On iOS, vibration API isn't available - we use AudioContext as a fallback buzz.
function haptic(intensity = 'medium') {
    try {
        const ms = intensity === 'light' ? 10 : intensity === 'heavy' ? 50 : 25;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(ms);
        }
    } catch (e) { console.warn("[table-tablets.js]", e); }
}

// Arc-length parameterized ellipse for equal visual spacing - matches tables.js
const _seatPositionsCache = {};
function computeSeatPositions(maxSeats) {
    if (_seatPositionsCache[maxSeats]) return _seatPositionsCache[maxSeats];
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
    const totalSlots = maxSeats + 1; // +1 for dealer
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
    // Per-seat vertical nudges (seats are 1-indexed, array is 0-indexed)
    // Seats 3 & 7 down toward middle, Seats 2 & 8 up toward middle - fills the side gap
    const nudge = { 2: -3, 3: 3, 7: 3, 8: -3 };
    Object.entries(nudge || {}).forEach(([seat, offset]) => {
        const idx = parseInt(seat) - 1;
        if (seatPositions[idx]) {
            seatPositions[idx].top = `${parseFloat(seatPositions[idx].top) + offset}%`;
        }
    });
    const _seatResult = { dealerPos, seatPositions };
    _seatPositionsCache[maxSeats] = _seatResult;
    return _seatResult;
}

export default function TableTabletsPage() {
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-table-tablets'); }, []);
    const router = useRouter();
    const [tables, setTables] = useState([]);
    const [loading, setLoading] = useState(true);
    const [venueId, setVenueId] = useState(null);
    const [venueName, setVenueName] = useState('');
    // Fullscreen table popup
    const [fullscreenTable, setFullscreenTable] = useState(null);
    const [dealerMap, setDealerMap] = useState({}); // table_number -> dealer_name
    // Dealer scan state
    const [scanningTable, setScanningTable] = useState(null);
    const [scanCameraActive, setScanCameraActive] = useState(false);
    const [scanResult, setScanResult] = useState(null);
    const [scanError, setScanError] = useState('');
    // manualDealerQR removed - scan only (issue #6)
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const scanIntervalRef = useRef(null);
    // 2026-08-19: synchronous single-submit guards.
    // detector.detect() is async and the scan interval fires every 300ms
    // regardless, so clearInterval() stops future ticks but CANNOT cancel a
    // detect() already in flight. A second detection resolving after the
    // scanner closed would call the handler again with the same card -
    // double-seating the player and deducting their time balance twice.
    // These are refs, not state: a ref flips synchronously, so a rapid
    // double-tap or a duplicate frame cannot slip through the window before
    // React re-renders and disables the button.
    const seatSubmitRef = useRef(false);
    const dealerScanSubmitRef = useRef(false);
    const unseatSubmitRef = useRef(false);
    // Live countdown tick - tracks when API data was last fetched
    const lastFetchAt = useRef(Date.now());
    const [tickCounter, setTickCounter] = useState(0);
    // Tablet assignment panel
    const [showAssignPanel, setShowAssignPanel] = useState(false);
    const [displayStatus, setDisplayStatus] = useState({}); // table_number -> { is_online, last_heartbeat }
    const [copiedTable, setCopiedTable] = useState(null);
    // Tablet lock mode
    const [lockedTable, setLockedTable] = useState(null); // table_number that is locked
    const [showPinModal, setShowPinModal] = useState(false);
    const [pinValue, setPinValue] = useState('');
    const [pinError, setPinError] = useState('');
    const [pinLoading, setPinLoading] = useState(false);
    // Player interactions (fullscreen mode)
    const [showPlayerMenu, setShowPlayerMenu] = useState(null); // { number, taken, tableNumber }
    const [playerActionLoading, setPlayerActionLoading] = useState(false);
    const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
    const [seatScanner, setSeatScanner] = useState(null); // { tableNumber, seatNumber }
    const seatScannerVideoRef = useRef(null);
    const seatScannerStreamRef = useRef(null);
    const [movingPlayer, setMovingPlayer] = useState(null); // { seat, player_name, tableNumber }
    // Call Clock (60-second countdown)
    const [callClockSeconds, setCallClockSeconds] = useState(null);
    const callClockRef = useRef(null);
    // Shot Clock (tournament per-hand decision timer)
    const [shotClockSeconds, setShotClockSeconds] = useState(null);
    const [shotClockCollapsed, setShotClockCollapsed] = useState(false);
    const shotClockRef = useRef(null);
    const shotClockVoiceFired = useRef(false);
    // Call Floor state
    const [callFloorSending, setCallFloorSending] = useState(false);
    const [callFloorSent, setCallFloorSent] = useState(false);
    const [callFloorId, setCallFloorId] = useState(null);
    // Tournament Clock overlay - SAFEGUARD: lockedTournamentId is the ONLY source
    // for the iframe URL. It is captured at button-click time and validated as a UUID.
    // This ensures the clock display can NEVER show a different tournament.
    const [showTournamentClock, setShowTournamentClock] = useState(false);
    const [lockedTournamentId, setLockedTournamentId] = useState(null);
    // Chip count input
    const [chipCountInput, setChipCountInput] = useState(null);
    // Tournament Director consequences the floor must see (auto-break, alternate seated)
    const [tournamentNotice, setTournamentNotice] = useState(null); // { title, lines: [] }
    const [lastBustedEntry, setLastBustedEntry] = useState(null); // { tournament_id, entry_id, player_name }
    const [restoreConfirm, setRestoreConfirm] = useState(null); // 409 PAYOUT_RECORDED confirm-then-force

    useEffect(() => {
        try {
            const staff = getStaffSession();
            if (!staff) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
            const parsed = JSON.parse(staff);
            setVenueId(parsed.venue_id);
            if (parsed.venue_name) setVenueName(parsed.venue_name);
        } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }

        // Restore locked table from localStorage
        try {
            const saved = localStorage.getItem('tablet_locked_table');
            if (saved) {
                const { table_number, venue_id: savedVenue } = JSON.parse(saved);
                if (table_number) setLockedTable(table_number);
            }
        } catch (e) { console.warn("[table-tablets.js]", e); }
    }, [router]);

    // When locked table is set, also set it as the fullscreen table
    useEffect(() => {
        if (lockedTable && tables.length > 0) {
            const table = tables.find(t => (t.table_number || t.number) === lockedTable);
            if (table) setFullscreenTable(table);
        }
    }, [lockedTable, tables]);

    // ── CRITICAL: Keep fullscreenTable in sync with tables after any data refresh ──
    // Without this, tournament actions (bust/move/chip update) would call fetchAll()
    // which updates `tables`, but fullscreenTable would remain stale.
    useEffect(() => {
        if (!fullscreenTable || !tables.length) return;
        const tNum = fullscreenTable.table_number || fullscreenTable.number;
        const freshTable = tables.find(t => (t.table_number || t.number) === tNum);
        if (freshTable && freshTable !== fullscreenTable) {
            setFullscreenTable(freshTable);
        }
    }, [tables]);

    // SAFEGUARD: When fullscreen table changes, ALWAYS close the tournament clock overlay
    // and clear the locked tournament ID. Also auto-close if the table's tournament_id
    // no longer matches what was locked (e.g., table was reassigned to a different tournament).
    const prevTableNumRef = useRef(null);
    useEffect(() => {
        if (!fullscreenTable) {
            setShowTournamentClock(false);
            setLockedTournamentId(null);
            prevTableNumRef.current = null;
            // Full reset when closing fullscreen
            setCallFloorSent(false);
            setCallFloorId(null);
            if (callClockRef.current) { clearInterval(callClockRef.current); callClockRef.current = null; }
            setCallClockSeconds(null);
            if (shotClockRef.current) { clearInterval(shotClockRef.current); shotClockRef.current = null; }
            setShotClockSeconds(null);
            setShotClockCollapsed(false);
            shotClockVoiceFired.current = false;
            setShowPlayerMenu(null);
            setMovingPlayer(null);
            setChipCountInput(null);
        } else {
            if (lockedTournamentId && fullscreenTable.tournament_id !== lockedTournamentId) {
                setShowTournamentClock(false);
                setLockedTournamentId(null);
            }
            // Only reset interactive state when SWITCHING tables (not during data refresh)
            const currentNum = fullscreenTable.table_number || fullscreenTable.number;
            if (prevTableNumRef.current !== null && prevTableNumRef.current !== currentNum) {
                setCallFloorSent(false);
                setCallFloorId(null);
                if (callClockRef.current) { clearInterval(callClockRef.current); callClockRef.current = null; }
                setCallClockSeconds(null);
                if (shotClockRef.current) { clearInterval(shotClockRef.current); shotClockRef.current = null; }
                setShotClockSeconds(null);
                setShotClockCollapsed(false);
                shotClockVoiceFired.current = false;
                setShowPlayerMenu(null);
                setMovingPlayer(null);
                setChipCountInput(null);
            }
            prevTableNumRef.current = currentNum;
        }
    }, [fullscreenTable, lockedTournamentId]);

    // ── Body scroll lock when fullscreen is active ──
    // Prevents iOS rubber-band overscroll from revealing the page underneath
    useEffect(() => {
        if (!fullscreenTable && !lockedTable) return;
        const orig = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        // Also prevent touch-move on body to stop pull-to-refresh / overscroll on tablets
        const preventTouchMove = (e) => {
            // Allow scrolling inside specific scrollable containers
            if (e.target.closest('[data-scrollable]')) return;
            e.preventDefault();
        };
        document.body.addEventListener('touchmove', preventTouchMove, { passive: false });
        // Set overscroll-behavior on html+body for full coverage
        document.documentElement.style.overscrollBehavior = 'none';
        document.body.style.overscrollBehavior = 'none';
        return () => {
            document.body.style.overflow = orig;
            document.body.removeEventListener('touchmove', preventTouchMove);
            document.documentElement.style.overscrollBehavior = '';
            document.body.style.overscrollBehavior = '';
        };
    }, [fullscreenTable, lockedTable]);

    // ── Cleanup camera streams on unmount - prevents tablet camera resource leaks ──
    useEffect(() => {
        return () => {
            if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
            if (seatScannerStreamRef.current) { seatScannerStreamRef.current.getTracks().forEach(t => t.stop()); seatScannerStreamRef.current = null; }
            if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
            if (typeof seatScanIntervalRef !== 'undefined' && seatScanIntervalRef?.current) { clearInterval(seatScanIntervalRef.current); seatScanIntervalRef.current = null; }
        };
    }, []);

    // Browser back/navigation prevention when locked
    useEffect(() => {
        if (!lockedTable) return;
        const handleBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
        const handlePopState = (e) => { window.history.pushState(null, '', window.location.href); };
        window.addEventListener('beforeunload', handleBeforeUnload);
        window.addEventListener('popstate', handlePopState);
        window.history.pushState(null, '', window.location.href);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            window.removeEventListener('popstate', handlePopState);
        };
    }, [lockedTable]);

    // Lock a table
    const lockToTable = (tableNumber) => {
        setLockedTable(tableNumber);
        localStorage.setItem('tablet_locked_table', JSON.stringify({ table_number: tableNumber, venue_id: venueId }));
    };

    // Unlock with PIN
    const handleUnlockAttempt = async () => {
        if (!pinValue || pinValue.length !== 4) { setPinError('Enter your 4-digit PIN'); return; }
        setPinLoading(true);
        setPinError('');
        try {
            const res = await commanderFetch('/api/commander/staff/verify-pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' || '' },
                body: JSON.stringify({ pin_code: pinValue, venue_id: venueId }) });
            const json = await parseApiResponse(res);
            if (json.success && json.data?.staff) {
                const role = json.data.staff.role;
                if (role === 'owner' || role === 'manager') {
                    // Unlock!
                    setLockedTable(null);
                    setFullscreenTable(null);
                    setShowPinModal(false);
                    setPinValue('');
                    localStorage.removeItem('tablet_locked_table');
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

    const fetchAll = useCallback(async (signal) => {
        if (!venueId) return;
const headers = { };

        // Fetch tables - API already joins commander_games + commander_table_seats
        try {
            const json = await commanderFetchJSON(`/api/commander/tables?venue_id=${venueId}`, { headers, signal });
            if (json.success) {
                let tablesArr = Array.isArray(json.data) ? json.data
                    : Array.isArray(json.data?.tables) ? json.data.tables : [];

                // For active tables, fetch sessions to get time_remaining for countdown clocks
                const activeTbls = tablesArr.filter(t => t.status === 'in_use');
                if (activeTbls.length > 0) {
                    const sessionsByTable = {};
                    const tournamentEntriesByTable = {};

                    // Separate cash tables and tournament tables
                    const cashTbls = activeTbls.filter(t => !isTournamentTable(t));
                    const tournTbls = activeTbls.filter(t => isTournamentTable(t));

                    // OPTIMIZED: Single batch call instead of N+1 per-table calls
                    const cashTableNums = cashTbls.map(t => t.table_number || t.number);
                    if (cashTableNums.length > 0) {
                        try {
                            const batchRes = await commanderFetch(`/api/commander/dealer/sessions-batch?tables=${cashTableNums.join(',')}&venue_id=${venueId}`, { headers });
                            if (!batchRes.ok) throw new Error(`Request failed (${batchRes.status})`);
                            const batchJson = await batchRes.json();
                            if (batchJson.success && batchJson.data) {
                                Object.entries(batchJson.data || {}).forEach(([tNum, sessions]) => {
                                    if (sessions.length > 0) sessionsByTable[parseInt(tNum)] = sessions;
                                });
                            }
                        } catch (e) { console.warn("[table-tablets.js]", e); }
                    }

                    // Fetch tournament entries - one floor-view call per unique tournament_id
                    const uniqueTournaments = [...new Set(tournTbls.map(t => t.tournament_id).filter(Boolean))];
                    await Promise.all(uniqueTournaments.map(async (tid) => {
                        try {
                            const fRes = await commanderFetch(`/api/commander/tournaments/${tid}/floor-view`, { headers });
                            if (!fRes.ok) throw new Error(`Request failed (${fRes.status})`);
                            const fJson = await fRes.json();
                            if (fJson.success && fJson.data?.tables) {
                                fJson.data.tables.forEach(ft => {
                                    tournamentEntriesByTable[ft.table_number] = {
                                        tournament_id: tid,
                                        tournament: fJson.data.tournament,
                                        stats: fJson.data.stats,
                                        players: ft.players || [] };
                                });
                            }
                        } catch (e) { console.warn("[table-tablets.js]", e); }
                    }));

                    // Merge session data for cash tables
                    tablesArr = tablesArr.map(t => {
                        const tNum = t.table_number || t.number;

                        // Tournament table - merge entry data
                        if (isTournamentTable(t) && tournamentEntriesByTable[tNum]) {
                            const tData = tournamentEntriesByTable[tNum];
                            return {
                                ...t,
                                _tournamentData: tData.tournament,
                                _tournamentStats: tData.stats,
                                seats: tData.players.map(p => ({
                                    seat_number: p.seat_number,
                                    player_name: p.player_name,
                                    entry_id: p.entry_id,
                                    tournament_id: tData.tournament_id,
                                    current_chips: p.current_chips,
                                    rebuy_count: p.rebuy_count || 0,
                                    addon_taken: p.addon_taken || false,
                                    status: 'occupied' }))
                            };
                        }

                        // Cash table - merge session data
                        const tableSessions = sessionsByTable[tNum];
                        if (!tableSessions || tableSessions.length === 0) return t;
                        return {
                            ...t,
                            seats: tableSessions.map(s => ({
                                seat_number: s.seat_number,
                                player_name: s.player_name,
                                member_id: s.member_id,
                                membership_tier: s.membership_tier,
                                membership_status: s.membership_status,
                                time_remaining: s.time_remaining,
                                time_balance_minutes: s.time_balance_minutes,
                                is_low: s.is_low,
                                is_critical: s.is_critical,
                                is_expired: s.is_expired,
                                session_status: s.session_status || 'active',
                                missed_blinds: s.missed_blinds || 0,
                                session_id: s.session_id,
                                member_number: s.member_number,
                                status: 'occupied' }))
                        };
                    });
                }

                setTables(tablesArr);
            }
        } catch (err) { console.warn('Failed to fetch tables:', err); }

        lastFetchAt.current = Date.now();
        setLoading(false);

        // Fetch active dealer rotations - maps table_number to dealer_name
        try {
            const rotRes = await commanderFetch(`/api/commander/dealers/rotations?venue_id=${venueId}`, { headers });
            if (!rotRes.ok) throw new Error(`Request failed (${rotRes.status})`);
            const rotData = await rotRes.json();
            if (rotData.success) {
                const rots = rotData.data?.rotations || rotData.data || [];
                const map = {};
                (Array.isArray(rots) ? rots : []).forEach(r => {
                    if (r.table_number && !r.ended_at) {
                        map[r.table_number] = r.dealer_name || r.commander_dealers?.name || 'Dealer';
                    }
                });
                setDealerMap(map);
            }
        } catch (err) { console.warn('Failed to fetch dealer rotations:', err); }
    }, [venueId]);

    useEffect(() => {
        if (!venueId) return;
        const controller = new AbortController();
        fetchAll(controller.signal);
        fetchDisplayStatus();
        return () => controller.abort();
    }, [venueId, fetchAll]);

    // Fetch tablet online status from commander_table_displays
    const fetchDisplayStatus = useCallback(async () => {
        if (!venueId) return;
        try {
const json = await commanderFetchJSON(`/api/commander/displays/status?venue_id=${venueId}`, { });
            if (json.success && json.data) {
                const map = {};
                json.data.forEach(d => {
                    const tNum = d.device_id?.match(/table-(\d+)/)?.[1];
                    if (tNum) map[parseInt(tNum)] = { is_online: d.is_online, last_heartbeat: d.last_heartbeat };
                });
                setDisplayStatus(map);
            }
        } catch (e) { console.warn("[table-tablets.js]", e); }
    }, [venueId]);

    const copyTabletUrl = (tableNum) => {
        const url = `${window.location.origin}/commander/tablet/${tableNum}${venueId ? `?venue=${venueId}` : ''}`;
        navigator.clipboard.writeText(url).then(() => {
            setCopiedTable(tableNum);
            setTimeout(() => setCopiedTable(null), 2000);
        }).catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    };

    // Auto-refresh every 30s (fallback; realtime sync handles instant updates)
    useEffect(() => {
        if (!venueId) return;
        const interval = setInterval(fetchAll, 30000); // fallback - real-time sync handles instant updates
        return () => clearInterval(interval);
    }, [venueId, fetchAll]);

    // Commander Data Bus - instant cross-tab sync for tables, games, dealers
    useCommanderSync(venueId, fetchAll, { entities: ['tables', 'games', 'dealers'] });

    // 1-second tick for live countdown display.
    // 2026-08-19: the tick now pauses while the page is hidden (tablet screen off
    // or app backgrounded). This component is ~2,000 lines with no memoisation, so
    // every tick re-renders the entire table grid; on a tablet left running for a
    // whole shift that burned CPU and battery animating a display nobody could see.
    // Nothing is lost on resume - adjustTime() recomputes every countdown from
    // lastFetchAt, and we force one immediate tick when the screen comes back.
    useEffect(() => {
        let tick = null;
        const start = () => { if (tick == null) tick = setInterval(() => setTickCounter(c => c + 1), 1000); };
        const stop = () => { if (tick != null) { clearInterval(tick); tick = null; } };
        const onVisibility = () => {
            if (typeof document !== 'undefined' && document.hidden) { stop(); }
            else { setTickCounter(c => c + 1); start(); }
        };
        if (typeof document === 'undefined' || !document.hidden) start();
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
        return () => {
            stop();
            if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);

    // 2026-08-19: hold a screen Wake Lock for the length of the shift.
    // A dealer tablet must stay readable at the table - seat timers, the floor-call
    // button and the scan flow are useless behind a sleeping screen, and a dealer
    // having to wake and unlock the device mid-hand is a real operational cost.
    // The lock is released by the browser whenever the page is hidden, so it is
    // re-acquired on visibilitychange. Wrapped in try/catch and feature-detected:
    // on a browser without the API (or if the request is refused) this is a no-op
    // and the tablet behaves exactly as it does today.
    useEffect(() => {
        if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
        let sentinel = null;
        let cancelled = false;
        const acquire = async () => {
            try {
                if (typeof document !== 'undefined' && document.hidden) return;
                if (sentinel) return;
                sentinel = await navigator.wakeLock.request('screen');
                if (cancelled) { try { await sentinel.release(); } catch (e) { /* ignore */ } sentinel = null; return; }
                sentinel.addEventListener('release', () => { sentinel = null; });
            } catch (e) {
                // Refused (battery saver, permissions policy, unsupported) - non-fatal.
                console.warn('[table-tablets] wake lock unavailable:', e?.message || e);
            }
        };
        const onVisibility = () => { if (typeof document !== 'undefined' && !document.hidden) acquire(); };
        acquire();
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
        return () => {
            cancelled = true;
            if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
            if (sentinel) { try { sentinel.release(); } catch (e) { /* ignore */ } sentinel = null; }
        };
    }, []);

    // 2026-08-19: refetch the grid the moment connectivity returns.
    // CommanderLayout already owns the *visual* offline state - it listens for
    // online/offline and renders the *You are offline* banner - so this
    // deliberately does NOT toast, which would give the dealer two
    // notifications for one event. What the layout does not do is recover the
    // data: previously a Wi-Fi drop left the grid showing seats and countdowns
    // from before the outage, with no refresh until the next 30s poll happened
    // to land. A dealer could unseat a player, or read a seat as open, from a
    // stale grid. This closes that window by refreshing immediately on
    // reconnect.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onOnline = () => {
            if (!venueId) return;
            try { fetchAll(); } catch (e) { console.warn('[table-tablets] reconnect refresh failed:', e?.message || e); }
        };
        window.addEventListener('online', onOnline);
        return () => window.removeEventListener('online', onOnline);
    }, [venueId, fetchAll]);

    // Compute adjusted time_remaining accounting for seconds elapsed since last API fetch
    const adjustTime = useCallback((apiTimeRemaining) => {
        if (apiTimeRemaining == null) return null;
        const elapsed = Math.floor((Date.now() - lastFetchAt.current) / 1000);
        return Math.max(0, apiTimeRemaining - elapsed);
    }, [tickCounter]); // eslint-disable-line react-hooks/exhaustive-deps

    // Helper: get game + player info from table data.
    // 2026-08-19: wrapped in useCallback so their identity is stable across
    // renders - otherwise anything downstream that depends on them is
    // invalidated on every tick.
    const getTableGame = useCallback((table) => {
        const games = Array.isArray(table.commander_games) ? table.commander_games : [];
        return games.find(g => g.status !== 'closed') || games[0] || null;
    }, []);

    const getSeatedCount = useCallback((table) => {
        const game = getTableGame(table);
        if (game && game.current_players) return game.current_players;
        if (table.seats && table.seats.length > 0) return table.seats.length;
        return 0;
    }, [getTableGame]);

    // 2026-08-19: these four derived lists previously ran three .filter() passes
    // and a spread on EVERY render - including each 1-second countdown tick, and
    // every keystroke in an unrelated input. Beyond the wasted work, they handed
    // back a brand-new array identity each time, which defeats memoisation for
    // anything consuming them. They only change when `tables` changes, so they
    // are memoised on that.
    const activeCashTables = useMemo(
        () => tables.filter(t => t.status === 'in_use' && !isTournamentTable(t)),
        [tables]);
    const activeTournamentTables = useMemo(
        () => tables.filter(t => t.status === 'in_use' && isTournamentTable(t)),
        [tables]);
    const activeTables = useMemo(
        () => [...activeCashTables, ...activeTournamentTables],
        [activeCashTables, activeTournamentTables]);
    const idleTables = useMemo(
        () => tables.filter(t => t.status !== 'in_use'),
        [tables]);

    // Dealer scan functions
    const openDealerScan = (tableNumber) => {
        setScanningTable(tableNumber);
        setScanResult(null);
        setScanError('');
    };

    const closeDealerScan = () => {
        stopDealerCamera();
        setScanningTable(null);
        setScanResult(null);
        setScanError('');
    };

    const startDealerCamera = async () => {
        dealerScanSubmitRef.current = false; // fresh scan session
        setScanError('');
        // Mount the video element FIRST by setting camera active before acquiring stream
        setScanCameraActive(true);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
            });
            streamRef.current = stream;
            // Wait for video element to mount (callback ref will attach stream)
            // Poll for up to 2 seconds
            let attempts = 0;
            const waitForVideo = () => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.play().catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
                } else if (attempts < 20) {
                    attempts++;
                    setTimeout(waitForVideo, 100);
                    return;
                }
                // Start barcode detection once video is ready
                if ('BarcodeDetector' in window) {
                    const detector = new BarcodeDetector({ formats: ['qr_code'] });
                    const interval = setInterval(async () => {
                        if (!videoRef.current || videoRef.current.readyState < 2) return;
                        try {
                            const barcodes = await detector.detect(videoRef.current);
                            if (barcodes.length > 0) {
                                if (dealerScanSubmitRef.current) return;
                                dealerScanSubmitRef.current = true;
                                stopDealerCamera();
                                handleDealerScan(barcodes[0].rawValue);
                            }
                        } catch (e) { console.warn("[table-tablets.js]", e); }
                    }, 300);
                    scanIntervalRef.current = interval;
                }
            };
            waitForVideo();
        } catch {
            setScanCameraActive(false);
            setScanError('Camera access denied. Please check permissions.');
        }
    };

    const stopDealerCamera = () => {
        if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        setScanCameraActive(false);
    };

    const handleDealerScan = async (qrCode) => {
        dealerScanSubmitRef.current = false; // allow a retry after this attempt resolves
        setScanError('');
        setScanResult(null);
        try {
const res = await commanderFetch('/api/commander/dealer/scan-in', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ venue_id: venueId, qr_code: qrCode, table_number: scanningTable }) });
            const data = await parseApiResponse(res);
            if (data.success) {
                setScanResult({
                    dealer_name: data.data?.dealer?.name || data.data?.dealer_name || 'Dealer',
                    table_number: data.data?.table_number || scanningTable });
                fetchAll();
                broadcastChange('dealers');
                broadcastChange('tables'); // <== NEW FIX: ensuring other clients know the dealer changed
                setTimeout(() => closeDealerScan(), 3000);
            } else {
                setScanError(data.error || 'Failed to assign dealer');
            }
        } catch {
            setScanError('Network error');
        }
    };

    // Manual dealer scan function removed (code cleanup for issue #6)

    // ── Toast auto-clear ──
    useEffect(() => {
        if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }
    }, [toast]);

    // ── Player action handlers (for fullscreen mode) ──
    const callSessionAction = async (tableNumber, seatNumber, action, extra = {}) => {
        setPlayerActionLoading(true);
        try {
const res = await commanderFetch('/api/commander/dealer/session-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ table_number: tableNumber, seat_number: seatNumber, venue_id: venueId, action, ...extra }) });
            const json = await parseApiResponse(res);
            if (json.success) broadcastChange('tables'); // <== NEW FIX: Sync player actions across floor
            setPlayerActionLoading(false);
            return json;
        } catch {
            setPlayerActionLoading(false);
            return { success: false, error: 'Network error' };
        }
    };

    const removePlayer = async (tableNumber, seatNumber) => {
        // Unseating credits unused minutes back to the member and writes a comp
        // row, so a double-tap is a real money event. setPlayerActionLoading is
        // React state and does not flip until the next render; this ref does.
        if (unseatSubmitRef.current) return;
        unseatSubmitRef.current = true;
        setPlayerActionLoading(true);
        try {
const res = await commanderFetch('/api/commander/dealer/player-unseat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ table_number: tableNumber, seat_number: seatNumber, venue_id: venueId }) });
            const json = await parseApiResponse(res);
            if (json.success) {
                setToast({ type: 'success', text: `${json.data.player_name} removed · ${json.data.unused_minutes_returned}m returned` });
                setShowPlayerMenu(null);
                broadcastChange('tables');
                fetchAll();
            } else {
                setToast({ type: 'error', text: json.error || 'Failed to remove player' });
            }
        } catch { setToast({ type: 'error', text: 'Network error' }); }
        unseatSubmitRef.current = false;
        setPlayerActionLoading(false);
    };

    // ── Tournament-specific actions ──
    const bustTournamentPlayer = async (tournamentId, entryId, playerName) => {
        setPlayerActionLoading(true);
const headers = { 'Content-Type': 'application/json' };
        try {
            const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/eliminate`, {
                method: 'POST', headers,
                body: JSON.stringify({ entry_id: entryId }) });
            const json = await parseApiResponse(res);
            if (json.success) {
                // 2026-08-20 fix: eliminate answers { success, data: {...} }. These
                // four fields were read off the top level, so finish position and
                // payout never rendered, and auto_break / promoted_alternate - the
                // two things the floor MUST see - were discarded entirely.
                const d = json.data || {};
                const pos = d.finishPosition ? ` - finished ${d.finishPosition}${['st', 'nd', 'rd'][d.finishPosition - 1] || 'th'}` : '';
                const payout = d.payoutAmount ? ` · $${d.payoutAmount.toLocaleString()}` : '';
                setToast({ type: 'success', text: `${playerName} eliminated${pos}${payout}` });
                setLastBustedEntry({ tournament_id: tournamentId, entry_id: entryId, player_name: playerName });
                const noticeLines = [];
                if (d.promoted_alternate) {
                    noticeLines.push(`Alternate ${d.promoted_alternate.player_name} Was Seated At Table ${d.promoted_alternate.table_number}, Seat ${d.promoted_alternate.seat_number}.`);
                }
                if (d.auto_break && d.auto_break.executed) {
                    const ab = d.auto_break;
                    const moved = Number(ab.players_moved || 0);
                    noticeLines.push(ab.print_job_id
                        ? `Table ${ab.break_table} Was Broken, ${moved.toLocaleString()} Card${moved === 1 ? '' : 's'} Queued At The Print Station.`
                        : `Table ${ab.break_table} Was Broken, ${moved.toLocaleString()} Player${moved === 1 ? '' : 's'} Moved.`);
                }
                if (noticeLines.length > 0) {
                    setTournamentNotice({ title: `${playerName} Busted Out`, lines: noticeLines });
                }
                setShowPlayerMenu(null);
                broadcastChange('tables');
                // If during rebuy/late-reg, notify cashier
                const menuTable = tables.find(t => t.tournament_id === tournamentId);
                const tData = menuTable?._tournamentData;
                const tStats = menuTable?._tournamentStats;
                if (tData && tStats?.late_reg_open) {
                    broadcastChange('cashier');
                    setToast({ type: 'success', text: `${playerName} eliminated - seat available for resale (late reg open)` });
                } else if (tData?.allows_rebuys) {
                    const currentLevel = tData.settings?.clock_state?.currentLevel || 0;
                    const rebuyEndLevel = tData.rebuy_end_level || 99;
                    if (currentLevel <= rebuyEndLevel) {
                        broadcastChange('cashier');
                    }
                }
                fetchAll();
            } else {
                setToast({ type: 'error', text: json.error || 'Failed to bust player' });
            }
        } catch { setToast({ type: 'error', text: 'Network error' }); }
        setPlayerActionLoading(false);
    };

    const rebuyTournamentPlayer = async (tournamentId, entryId, playerName) => {
        setPlayerActionLoading(true);
        try {
            const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/entries/${entryId}/rebuy`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}) });
            const json = await parseApiResponse(res);
            if (json.success) {
                const d = json.data || {};
                setToast({ type: 'success', text: `Rebuy ${Number(d.rebuy_number || 1).toLocaleString()} for ${playerName} · ${Number(d.total_chips || 0).toLocaleString()} chips` });
                setShowPlayerMenu(null);
                broadcastChange('tables');
                broadcastChange('cashier');
                fetchAll();
            } else {
                setToast({ type: 'error', text: json.error || 'Rebuy failed' });
            }
        } catch { setToast({ type: 'error', text: 'Network error' }); }
        setPlayerActionLoading(false);
    };

    const addonTournamentPlayer = async (tournamentId, entryId, playerName) => {
        setPlayerActionLoading(true);
        try {
            const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/entries/${entryId}/addon`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}) });
            const json = await parseApiResponse(res);
            if (json.success) {
                const d = json.data || {};
                setToast({ type: 'success', text: `Add-on for ${playerName} · ${Number(d.total_chips || 0).toLocaleString()} chips` });
                setShowPlayerMenu(null);
                broadcastChange('tables');
                broadcastChange('cashier');
                fetchAll();
            } else {
                setToast({ type: 'error', text: json.error || 'Add-on failed' });
            }
        } catch { setToast({ type: 'error', text: 'Network error' }); }
        setPlayerActionLoading(false);
    };

    // Undo an accidental bust. A 409 PAYOUT_RECORDED means money is already
    // recorded against the entry - confirm with the floor, then retry forced.
    // This reads the raw body instead of parseApiResponse because the decision
    // hinges on error.code, which parseApiResponse flattens to a message.
    const restoreTournamentEntry = async (tournamentId, entryId, playerName, force = false) => {
        setPlayerActionLoading(true);
        try {
            const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/entries/${entryId}/restore`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(force ? { force: true } : {}) });
            let raw = null;
            try { raw = await res.json(); } catch (e) { /* empty or non-JSON body */ }
            const errMsg = (raw && (raw.error?.message || (typeof raw.error === 'string' ? raw.error : null))) || null;
            if (res.status === 409 && raw?.error?.code === 'PAYOUT_RECORDED' && !force) {
                setRestoreConfirm({
                    tournament_id: tournamentId,
                    entry_id: entryId,
                    player_name: playerName,
                    message: errMsg || 'A Payout Is Recorded For This Entry.' });
                setPlayerActionLoading(false);
                return;
            }
            if (!res.ok || raw?.success === false) {
                setToast({ type: 'error', text: errMsg || 'Undo bust failed' });
                setPlayerActionLoading(false);
                return;
            }
            setRestoreConfirm(null);
            setLastBustedEntry(null);
            setShowPlayerMenu(null);
            setTournamentNotice({
                title: `${playerName} Is Back In`,
                lines: [raw?.data?.message || 'Elimination Undone.'] });
            broadcastChange('tables');
            fetchAll();
        } catch { setToast({ type: 'error', text: 'Network error' }); }
        setPlayerActionLoading(false);
    };

    const moveTournamentPlayer = async (tournamentId, entryId, toTable, toSeat, playerName) => {
        setPlayerActionLoading(true);
const headers = { 'Content-Type': 'application/json' };
        try {
            const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/move-player`, {
                method: 'POST', headers,
                body: JSON.stringify({ entry_id: entryId, to_table: toTable, to_seat: toSeat }) });
            const json = await parseApiResponse(res);
            if (json.success) {
                const move = json.data?.move;
                setToast({ type: 'success', text: `${playerName} moved T${move?.from_table}S${move?.from_seat} → T${move?.to_table}S${move?.to_seat}` });
                broadcastChange('tables');
                fetchAll();
            } else {
                setToast({ type: 'error', text: json.error || 'Move failed' });
            }
        } catch { setToast({ type: 'error', text: 'Network error' }); }
        setPlayerActionLoading(false);
    };

    const updateTournamentChipCount = async (tournamentId, entryId, chipCount, playerName) => {
        setPlayerActionLoading(true);
const headers = { 'Content-Type': 'application/json' };
        try {
            // Direct Supabase-backed update via a lightweight API call
            const res = await commanderFetch('/api/commander/dealer/session-action', {
                method: 'POST', headers,
                body: JSON.stringify({
                    action: 'tournament_chip_update',
                    tournament_id: tournamentId,
                    entry_id: entryId,
                    chip_count: chipCount,
                    venue_id: venueId }) });
            const json = await parseApiResponse(res);
            if (json.success) {
                setToast({ type: 'success', text: `Chip count updated: ${chipCount.toLocaleString()} - ${playerName}` });
                broadcastChange('tables');
                fetchAll();
            } else {
                setToast({ type: 'error', text: json.error || 'Failed to update chips' });
            }
        } catch { setToast({ type: 'error', text: 'Network error' }); }
        setPlayerActionLoading(false);
    };

    const handleSeatScan = async (qrData, tableNumber, seatNumber) => {
        // Previously this cleared playerActionLoading at the end without ever
        // setting it, so seat-in showed no busy state and could re-enable
        // buttons belonging to a different in-flight action.
        setPlayerActionLoading(true);
        closeSeatScanner();
        try {
const res = await commanderFetch('/api/commander/dealer/player-scan-in', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ qr_code: qrData, table_number: tableNumber, seat_number: seatNumber, venue_id: venueId }) });
            const json = await parseApiResponse(res);
            if (json.success) {
                setToast({ type: 'success', text: `${json.data.player_name} seated at S${seatNumber}` });
                broadcastChange('tables'); // <== NEW FIX: Realtime sync across the floor
                fetchAll();
            } else {
                setToast({ type: 'error', text: json.error || 'Could not seat player' });
            }
        } catch { setToast({ type: 'error', text: 'Network error' }); }
        // Release the scan guard so a declined/failed scan can be retried.
        seatSubmitRef.current = false;
    setPlayerActionLoading(false);
    };

    const seatScanIntervalRef = useRef(null);

    const openSeatScanner = (tableNumber, seatNumber) => {
        seatSubmitRef.current = false; // fresh scan session
        setSeatScanner({ tableNumber, seatNumber });
        setShowPlayerMenu(null);
        // Wait for the modal + video element to mount before acquiring camera
        setTimeout(async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
                });
                seatScannerStreamRef.current = stream;
                // Poll for video element mount (up to 2s)
                let attempts = 0;
                const waitForVideo = () => {
                    if (seatScannerVideoRef.current) {
                        seatScannerVideoRef.current.srcObject = stream;
                        seatScannerVideoRef.current.play().catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
                    } else if (attempts < 20) {
                        attempts++;
                        setTimeout(waitForVideo, 100);
                        return;
                    }
                    // Use setInterval instead of requestAnimationFrame for lower CPU on tablets
                    if ('BarcodeDetector' in window) {
                        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
                        seatScanIntervalRef.current = setInterval(async () => {
                            if (!seatScannerStreamRef.current || !seatScannerVideoRef.current) return;
                            if (seatScannerVideoRef.current.readyState < 2) return;
                            try {
                                const barcodes = await detector.detect(seatScannerVideoRef.current);
                                if (barcodes.length > 0) {
                                    if (seatSubmitRef.current) return;
                                    seatSubmitRef.current = true;
                                    handleSeatScan(barcodes[0].rawValue, tableNumber, seatNumber);
                                }
                            } catch (e) { console.warn("[table-tablets.js]", e); }
                        }, 300);
                    }
                };
                waitForVideo();
            } catch {
                setToast({ type: 'error', text: 'Camera access denied - check permissions' });
            }
        }, 300);
    };

    const closeSeatScanner = () => {
        if (seatScanIntervalRef.current) {
            clearInterval(seatScanIntervalRef.current);
            seatScanIntervalRef.current = null;
        }
        if (seatScannerStreamRef.current) {
            seatScannerStreamRef.current.getTracks().forEach(t => t.stop());
            seatScannerStreamRef.current = null;
        }
        setSeatScanner(null);
    };

    // ── Renders a single table visualization (reused in grid and fullscreen) ──
    const renderTableVisual = (table, isFullscreen = false) => {
        const tNum = table.table_number || table.number;
        const maxSeats = table.max_seats || 9;
        const game = getTableGame(table);
        const seatedCount = getSeatedCount(table);
        const seatData = table.seats || [];
        const hasTimed = seatData.some(s => s.time_remaining !== undefined && s.time_remaining !== null);
        const { dealerPos, seatPositions } = computeSeatPositions(maxSeats);

        // Build seat array - merge session data, table_seats data, then fill with anonymous badges
        const seatArr = Array.from({ length: maxSeats }, (_, i) => {
            const seatNum = i + 1;
            // Priority 1: session data (from dealer sessions API - has time_remaining)
            const session = seatData.find(s => s.seat_number === seatNum);
            if (session) return { number: seatNum, taken: session };
            // Priority 2: table_seats data (from tables API - has player_name)
            const tableSeat = (table.seats || []).find(s => s.seat_number === seatNum && s.status === 'occupied');
            if (tableSeat) return { number: seatNum, taken: { ...tableSeat } };
            return { number: seatNum, taken: null };
        });

        // If game has current_players but few/no seat records, fill with anonymous players
        const gamePlayers = game?.current_players || 0;
        const actuallySeated = seatArr.filter(s => s.taken).length;
        if (gamePlayers > actuallySeated) {
            let toFill = gamePlayers - actuallySeated;
            let pNum = 1;
            for (let i = 0; i < seatArr.length && toFill > 0; i++) {
                if (!seatArr[i].taken) {
                    seatArr[i].taken = { player_name: `P${pNum}`, seat_number: seatArr[i].number, _anonymous: true };
                    pNum++;
                    toFill--;
                }
            }
        }
        const occupiedCount = seatArr.filter(s => s.taken).length;

        const avatarSize = isFullscreen ? 64 : 52;
        const fontSize = isFullscreen ? 14 : 13;
        const nameMaxWidth = isFullscreen ? 140 : 110;

        return (
            <div style={{ position: 'relative', width: '100%', paddingBottom: isFullscreen ? '52%' : '60%', overflow: isFullscreen ? 'visible' : 'hidden', background: `radial-gradient(ellipse 85% 65% at 50% 42%, #0d1210 0%, #151a1d 40%, ${isFullscreen ? '#1a1f22' : '#1a1a2e'} 90%)`, borderRadius: isFullscreen ? 0 : 12 }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, aspectRatio: '1 / 1', marginTop: isFullscreen ? '-20%' : '-16%' }}>
                    {/* Poker table image */}
                    <img
                        src="/images/poker-table-black-gold.png"
                        alt="Poker Table"
                        style={{
                            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                            objectFit: 'contain', pointerEvents: 'none', zIndex: 0 }} loading="lazy" />

                    {/* Game info in center */}
                    <div style={{
                        position: 'absolute', top: '48%', left: '50%',
                        transform: 'translate(-50%, -50%)', zIndex: 5, textAlign: 'center' }}>
                        <div style={{ fontSize: isFullscreen ? 16 : 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>
                            {venueName || ''}{venueName ? ' · ' : ''}TABLE {tNum}
                        </div>
                        {isTournamentTable(table) && (table.tournament?.name || table._tournamentData?.name) && (
                            <div style={{ fontSize: isFullscreen ? 16 : 12, fontWeight: 900, color: '#FFD700', letterSpacing: 0.5, marginBottom: 4, textShadow: '0 0 12px rgba(255,215,0,0.3)' }}>
                                {table.tournament?.name || table._tournamentData?.name}
                            </div>
                        )}
                        <div style={{ fontSize: isFullscreen ? 22 : 18, fontWeight: 800, color: 'rgba(255,255,255,0.85)', letterSpacing: 0.5 }}>
                            {isTournamentTable(table) && !game?.game_type && !table.game_type ? 'Tournament' : getFullGameName(game?.game_type || table.game_type)}
                        </div>
                        <div style={{ fontSize: isFullscreen ? 20 : 16, color: 'rgba(255,255,255,0.7)', marginTop: 2, fontWeight: 700 }}>
                            {formatStakes(game?.stakes || table.stakes)}
                        </div>
                        {table.table_purpose && (
                            <div style={{ fontSize: isFullscreen ? 11 : 9, fontWeight: 800, marginTop: 6, padding: '2px 10px', borderRadius: 4, display: 'inline-block', letterSpacing: 1.5, textTransform: 'uppercase', background: isTournamentTable(table) ? 'rgba(255,215,0,0.25)' : table.table_purpose === 'must_move' ? 'rgba(245,158,11,0.3)' : 'rgba(24,119,242,0.25)', color: isTournamentTable(table) ? '#FFD700' : table.table_purpose === 'must_move' ? '#F59E0B' : '#1877F2', border: `1px solid ${isTournamentTable(table) ? 'rgba(255,215,0,0.5)' : table.table_purpose === 'must_move' ? 'rgba(245,158,11,0.5)' : 'rgba(24,119,242,0.4)'}` }}>
                                {isTournamentTable(table) ? 'Tournament' : table.table_purpose === 'must_move' ? 'Must Move' : 'Main Game'}
                            </div>
                        )}
                    </div>

                    {/* Dealer badge - card style matching player cards */}
                    {(() => {
                        const dealerName = dealerMap[tNum] || game?.dealer_name || 'No Dealer';
                        return (
                            <div
                                onClick={isFullscreen ? (e) => { e.stopPropagation(); haptic(); openDealerScan(tNum); } : undefined}
                                style={{
                                    position: 'absolute', top: dealerPos.top, left: dealerPos.left,
                                    transform: 'translate(-50%, -50%)', zIndex: 3,
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                                    cursor: isFullscreen ? 'pointer' : 'default' }}>
                                {/* Dealer card */}
                                <div style={{
                                    display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
                                    background: 'rgba(36,37,38,0.9)',
                                    borderRadius: 12,
                                    padding: '5px 10px 5px 5px',
                                    border: `2px solid ${isFullscreen ? 'rgba(24,119,242,0.8)' : 'rgba(24,119,242,0.6)'}`,
                                    backdropFilter: 'blur(6px)',
                                    minWidth: isFullscreen ? 80 : 70 }}>
                                    {/* D avatar circle */}
                                    <div style={{
                                        width: avatarSize, height: avatarSize, borderRadius: '50%', flexShrink: 0,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        background: 'linear-gradient(135deg, #1877F2 0%, #1565c0 100%)',
                                        border: '2px solid #1877F2',
                                        boxShadow: '0 2px 12px rgba(0,0,0,0.6), 0 0 16px rgba(24,119,242,0.4)',
                                        fontSize: isFullscreen ? 28 : 24, fontWeight: 900, color: '#fff' }}>
                                        D
                                    </div>
                                    {/* Name + DEALER label */}
                                    <div style={{ overflow: 'hidden' }}>
                                        <div style={{
                                            fontSize, fontWeight: 600, lineHeight: 1.2,
                                            color: '#E4E6EB',
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            maxWidth: nameMaxWidth }}>
                                            {dealerName}
                                        </div>
                                        <div style={{ fontSize: isFullscreen ? 11 : 10, fontWeight: 700, color: '#1877F2', lineHeight: 1.2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                            {isFullscreen ? 'Tap to Scan' : 'Dealer'}
                                        </div>
                                    </div>
                                </div>

                            </div>
                        );
                    })()}

                    {/* Seat badges - matching tables.js avatar style */}
                    {seatArr.slice(0, seatPositions.length).map((seat, idx) => {
                        const pos = seatPositions[idx];
                        const isOccupied = !!seat.taken;
                        const firstName = seat.taken?.player_name?.split(' ')[0] || '';
                        const fullName = seat.taken?.player_name || '';
                        const memberActive = seat.taken?.membership_status === 'active';

                        const leftPct = parseFloat(pos.left);
                        const isLeftSide = leftPct < 25;
                        const isRightSide = leftPct > 75;
                        const badgeTransform = isLeftSide
                            ? 'translate(-17px, -50%)'
                            : isRightSide
                                ? 'translate(calc(-100% + 17px), -50%)'
                                : 'translate(-50%, -50%)';
                        const badgeDirection = isRightSide ? 'row-reverse' : 'row';

                        // Timer computation - live 1-second countdown (FREEZE when paused/meal_break)
                        let timerText = null, timerColor = null;
                        const isPausedOrBreak = seat.taken?.session_status === 'paused' || seat.taken?.session_status === 'meal_break';
                        if (isOccupied && seat.taken) {
                            if (seat.taken.time_remaining != null) {
                                const rem = isPausedOrBreak ? Math.max(0, seat.taken.time_remaining) : adjustTime(seat.taken.time_remaining);
                                timerText = rem <= 0 ? 'EXPIRED' : (isPausedOrBreak ? `⏸ ${formatTime(rem)}` : formatTime(rem));
                                timerColor = isPausedOrBreak ? '#8A8D91' : getTimerColor(rem);
                            }
                        }

                        return (
                            <div key={seat.number}
                                onClick={isFullscreen ? () => {
                                    haptic('light');
                                    if (movingPlayer && !isOccupied) {
                                        // Complete the move
                                        (async () => {
                                            const srcTable = tables.find(t => (t.table_number || t.number) === movingPlayer.tableNumber);
                                            const isTournMove = srcTable && isTournamentTable(srcTable);
                                            if (isTournMove && movingPlayer.seat?.taken?.entry_id && movingPlayer.seat?.taken?.tournament_id) {
                                                await moveTournamentPlayer(
                                                    movingPlayer.seat.taken.tournament_id,
                                                    movingPlayer.seat.taken.entry_id,
                                                    tNum,
                                                    seat.number,
                                                    movingPlayer.player_name
                                                );
                                            } else if (!isTournMove) {
                                                const json = await callSessionAction(movingPlayer.tableNumber, movingPlayer.seat.number, 'move', { target_seat: seat.number });
                                                if (json.success) {
                                                    setToast({ type: 'success', text: `${json.data.player_name} moved S${json.data.from_seat} → S${json.data.to_seat}` });
                                                    broadcastChange('tables');
                                                    fetchAll();
                                                } else {
                                                    setToast({ type: 'error', text: json.error || 'Move failed' });
                                                }
                                            } else {
                                                setToast({ type: 'error', text: 'Missing entry data - try refreshing' });
                                            }
                                            setMovingPlayer(null);
                                        })();
                                        return;
                                    }
                                    if (movingPlayer && isOccupied) { setToast({ type: 'error', text: 'Seat occupied - pick an empty seat' }); return; }
                                    if (isOccupied) setShowPlayerMenu({ ...seat, tableNumber: tNum });
                                    else openSeatScanner(tNum, seat.number);
                                } : undefined}
                                style={{
                                    position: 'absolute', top: pos.top, left: pos.left,
                                    transform: badgeTransform, zIndex: 2,
                                    cursor: isFullscreen ? 'pointer' : 'default',
                                    display: 'flex', flexDirection: badgeDirection, alignItems: 'center', gap: 8,
                                    background: 'rgba(36,37,38,0.9)',
                                    borderRadius: 12,
                                    padding: '5px 10px 5px 5px',
                                    border: `2px solid ${isOccupied
                                        ? (memberActive ? 'rgba(49,162,76,0.7)' : seat.taken?.membership_status ? 'rgba(239,68,68,0.5)' : 'rgba(24,119,242,0.5)')
                                        : 'rgba(62,64,66,0.6)'}`,
                                    backdropFilter: 'blur(6px)',
                                    minWidth: isFullscreen ? 80 : 70 }}>
                                {/* Avatar circle */}
                                <div style={{
                                    width: avatarSize, height: avatarSize, borderRadius: '50%', flexShrink: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: isOccupied
                                        ? 'linear-gradient(135deg, #1877F2 0%, #1565c0 100%)'
                                        : 'rgba(255,255,255,0.06)',
                                    border: `2px solid ${isOccupied
                                        ? (memberActive ? '#31A24C' : seat.taken?.membership_status ? '#EF4444' : '#1877F2')
                                        : 'rgba(62,64,66,0.5)'}`,
                                    overflow: 'hidden' }}>
                                    {isOccupied ? (
                                        <span style={{ fontSize: isFullscreen ? 24 : 20, fontWeight: 800, color: '#fff' }}>{firstName.charAt(0).toUpperCase()}</span>
                                    ) : (
                                        <span style={{ fontSize: isFullscreen ? 18 : 16, fontWeight: 600, color: movingPlayer && isFullscreen ? '#22c55e' : '#B0B3B8' }}>{seat.number}</span>
                                    )}
                                    {/* Missed Blinds Sticker - overlays top-right of avatar */}
                                    {isOccupied && (seat.taken?.missed_blinds || 0) > 0 && (
                                        <div style={{
                                            position: 'absolute', top: -4, right: -4,
                                            width: isFullscreen ? 22 : 18, height: isFullscreen ? 22 : 18,
                                            borderRadius: '50%',
                                            background: (seat.taken.missed_blinds >= 2) ? '#EF4444' : '#F97316',
                                            border: '2px solid #242526',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: isFullscreen ? 10 : 8, fontWeight: 900, color: '#fff',
                                            boxShadow: '0 2px 6px rgba(0,0,0,0.6)',
                                            zIndex: 3 }}>
                                            {seat.taken.missed_blinds}
                                        </div>
                                    )}
                                </div>
                                {/* Name + Timer */}
                                <div style={{ overflow: 'hidden', textAlign: isRightSide ? 'right' : 'left' }}>
                                    <div style={{
                                        fontSize, fontWeight: 600, lineHeight: 1.2,
                                        color: isOccupied ? '#E4E6EB' : (movingPlayer && isFullscreen ? '#22c55e' : '#B0B3B8'),
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        maxWidth: nameMaxWidth, position: 'relative' }}>
                                        {isOccupied ? fullName : (movingPlayer && isFullscreen ? 'Move here' : (isFullscreen ? 'Open' : 'Open'))}

                                    </div>
                                    {/* Session Status (Paused / Meal Break) */}
                                    {isOccupied && seat.taken?.session_status && seat.taken.session_status !== 'active' && (
                                        <div style={{ fontSize: isFullscreen ? 11 : 10, fontWeight: 700, color: seat.taken.session_status === 'meal_break' ? '#22c55e' : '#F59E0B', lineHeight: 1.2 }}>
                                            {seat.taken.session_status === 'paused' ? '⏸️ PAUSED' : '🍽️ MEAL BREAK'}
                                        </div>
                                    )}
                                    {!isOccupied && isFullscreen && (
                                        <div style={{ fontSize: 10, color: movingPlayer ? 'rgba(34,197,94,0.6)' : 'rgba(255,255,255,0.25)' }}>{movingPlayer ? 'Tap to confirm' : 'Tap to seat'}</div>
                                    )}
                                    {timerText && (
                                        <div style={{
                                            fontSize: isFullscreen ? 13 : 12, fontWeight: 700, color: timerColor,
                                            fontFamily: 'monospace', lineHeight: 1.2 }}>
                                            {timerText}
                                        </div>
                                    )}
                                    {isOccupied && seat.taken?.time_balance_minutes > 0 && (
                                        <div style={{ fontSize: isFullscreen ? 11 : 10, color: '#1877F2', fontWeight: 600 }}>
                                            {Math.floor(seat.taken.time_balance_minutes / 60)}h bal
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <CommanderLayout title="Table Tablets | Commander" backHref="/commander/dashboard?card=floor">
            <SEOHead title="Commander - Table Tablets" description="Dealer tablet view for all tables." noindex={true} />
            <div style={{ minHeight: '100vh', background: '#1a1f22', color: '#E4E6EB', fontFamily: 'Inter, sans-serif' }}>
                <div style={{ maxWidth: 1200, margin: '0 auto', padding: '16px' }}>

                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                        <div style={{ width: 40, height: 40, background: 'rgba(24,119,242,0.1)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Monitor size={20} color="#1877F2" />
                        </div>
                        <div>
                            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>Table Tablets</h1>
                            <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
                                {tables.length} tables - {activeTables.length} active • Tap to expand
                            </p>
                        </div>
                    </div>

                    {/* ── Tablet Assignment Panel ────────── */}
                    <div style={{ background: '#242526', border: '1px solid #3A3B3C', borderRadius: 14, marginBottom: 16, overflow: 'hidden' }}>
                        <button
                            onClick={() => setShowAssignPanel(!showAssignPanel)}
                            style={{
                                width: '100%', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                background: 'transparent', border: 'none', cursor: 'pointer', color: '#E4E6EB' }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <Link2 size={16} color="#1877F2" />
                                <span style={{ fontSize: 14, fontWeight: 700 }}>Tablet Assignment</span>
                                <span style={{ fontSize: 11, color: '#8A8D91', fontWeight: 500 }}>
                                    Copy a URL → open on tablet → done
                                </span>
                            </div>
                            {showAssignPanel ? <ChevronUp size={16} color="#B0B3B8" /> : <ChevronDown size={16} color="#B0B3B8" />}
                        </button>
                        {showAssignPanel && (
                            <div style={{ padding: '0 16px 16px', borderTop: '1px solid #3A3B3C' }}>
                                <p style={{ fontSize: 12, color: '#8A8D91', margin: '12px 0 12px', lineHeight: 1.5 }}>
                                    Each table gets a unique URL. Open this URL in the tablet browser and it will auto-display that table fullscreen.
                                    Tablets auto-register and show as online when the page is active.
                                </p>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                                    {tables.map(table => {
                                        const tNum = table.table_number || table.number;
                                        const status = displayStatus[tNum];
                                        const isOnline = status?.is_online && status?.last_heartbeat &&
                                            (Date.now() - new Date(status.last_heartbeat).getTime()) < 120000; // 2 min threshold
                                        const isCopied = copiedTable === tNum;
                                        return (
                                            <div key={tNum} style={{
                                                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                                                background: '#1a1b1d', border: '1px solid #3A3B3C', borderRadius: 10 }}>
                                                {/* Online indicator */}
                                                <div style={{
                                                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                                    background: isOnline ? '#31A24C' : '#4E4F50',
                                                    boxShadow: isOnline ? '0 0 6px rgba(49,162,76,0.5)' : 'none' }} title={isOnline ? 'Tablet Online' : 'Tablet Offline'} />
                                                {/* Table info */}
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 13, fontWeight: 700, color: '#E4E6EB' }}>Table {tNum}</div>
                                                    <div style={{ fontSize: 10, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        /commander/tablet/{tNum}
                                                    </div>
                                                </div>
                                                {/* Actions */}
                                                <button
                                                    onClick={() => copyTabletUrl(tNum)}
                                                    style={{
                                                        padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                                                        background: isCopied ? '#31A24C' : '#3A3B3C',
                                                        color: isCopied ? '#fff' : '#B0B3B8',
                                                        border: 'none', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', gap: 4,
                                                        transition: 'all 0.2s' }}
                                                >
                                                    {isCopied ? <><CheckCircle size={12} /> Copied</> : <><Copy size={12} /> Copy URL</>}
                                                </button>
                                                <a
                                                    href={`/commander/tablet/${tNum}${venueId ? `?venue=${venueId}` : ''}`}
                                                    target="_blank" rel="noopener noreferrer"
                                                    style={{
                                                        padding: '6px 10px', borderRadius: 8,
                                                        background: 'rgba(24,119,242,0.1)', border: '1px solid rgba(24,119,242,0.3)',
                                                        color: '#1877F2', textDecoration: 'none',
                                                        display: 'flex', alignItems: 'center' }}
                                                    title="Preview in new tab"
                                                >
                                                    <ExternalLink size={12} />
                                                </a>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {loading ? (
                        <div style={{ padding: '80px 0', textAlign: 'center' }}>
                            <Loader2 size={32} color="#1877F2" style={{ animation: 'spin 1s linear infinite' }} />
                        </div>
                    ) : tables.length === 0 ? (
                        <div style={{ background: '#242526', border: '1px solid #3A3B3C', borderRadius: 16, padding: 40, textAlign: 'center' }}>
                            <Monitor size={48} color="#4A5E78" style={{ margin: '0 auto 12px' }} />
                            <p style={{ color: '#64748B', marginBottom: 16 }}>No tables configured</p>
                            <button onClick={() => router.push('/commander/tables')}
                                style={{ padding: '10px 20px', background: '#1877F2', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, cursor: 'pointer' }}>
                                Go to Tables & Floor
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* ACTIVE TOURNAMENT TABLES - amber section */}
                            {activeTournamentTables.length > 0 && (
                                <>
                                    <h2 style={{ fontSize: 15, fontWeight: 700, color: '#FFD700', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Trophy size={20} /> Tournament Tables ({activeTournamentTables.length})
                                    </h2>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 8, marginBottom: 16 }}>
                                        {activeTournamentTables.map(table => {
                                            const tNum = table.table_number || table.number;
                                            const maxSeats = table.max_seats || 9;
                                            const game = getTableGame(table);
                                            const seatedCount = getSeatedCount(table);

                                            return (
                                                <div key={table.id || tNum}
                                                    onClick={() => setFullscreenTable(table)}
                                                    style={{
                                                        background: '#1a1a2e', border: '2px solid rgba(255,215,0,0.5)', borderRadius: 16,
                                                        cursor: 'pointer', overflow: 'hidden', transition: 'border-color 0.2s, transform 0.2s' }}>

                                                    {/* Table header - tournament amber gradient */}
                                                    <div style={{
                                                        padding: '6px 12px',
                                                        background: 'linear-gradient(135deg, #FFD700 0%, #B8860B 100%)',
                                                        color: '#fff',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                        <div>
                                                            <div style={{ fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                <Trophy size={22} />
                                                                {table.tournament?.name || 'Tournament'}
                                                            </div>
                                                            <div style={{ fontSize: 14, opacity: 0.9 }}>
                                                                Table {tNum} · {table.tournament?.buyin_amount > 0 ? `$${table.tournament.buyin_amount}${table.tournament.buyin_fee ? `+$${table.tournament.buyin_fee}` : ''}  Buy-In` : 'Freeroll'} · {maxSeats}-max
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 16, fontWeight: 700 }}>
                                                                <Users size={20} /> {seatedCount}/{maxSeats}
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', animation: 'pulse 2s infinite' }} />
                                                                <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.9 }}>TOURNAMENT</span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Table visual */}
                                                    <div style={{ padding: '4px 8px 6px' }}>
                                                        {renderTableVisual(table)}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}

                            {/* ACTIVE CASH TABLES - expanded cards with full table visual */}
                            {activeCashTables.length > 0 && (
                                <>
                                    <h2 style={{ fontSize: 14, fontWeight: 700, color: '#B0B3B8', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Timer size={14} /> Active Cash Tables ({activeCashTables.length})
                                    </h2>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 12, marginBottom: 24 }}>
                                        {activeCashTables.map(table => {
                                            const tNum = table.table_number || table.number;
                                            const maxSeats = table.max_seats || 9;
                                            const game = getTableGame(table);
                                            const seatedCount = getSeatedCount(table);

                                            return (
                                                <div key={table.id || tNum}
                                                    onClick={() => setFullscreenTable(table)}
                                                    style={{
                                                        background: '#1a1a2e', border: '2px solid rgba(24,119,242,0.3)', borderRadius: 16,
                                                        cursor: 'pointer', overflow: 'hidden', transition: 'border-color 0.2s, transform 0.2s' }}>

                                                    {/* Table header - game info bar */}
                                                    <div style={{
                                                        padding: '12px 16px',
                                                        background: 'linear-gradient(135deg, #1877F2 0%, #1565c0 100%)',
                                                        color: '#fff',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                        <div>
                                                            <div style={{ fontSize: 16, fontWeight: 800 }}>
                                                                {formatStakes(game?.stakes || table.stakes)} {getFullGameName(game?.game_type || table.game_type)}
                                                            </div>
                                                            <div style={{ fontSize: 13, opacity: 0.9 }}>
                                                                Table {tNum}{table.table_name && table.table_name !== `Table ${tNum}` ? ` · ${table.table_name}` : ''} · {maxSeats}-max
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); openDealerScan(tNum); }}
                                                                style={{
                                                                    background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)',
                                                                    borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
                                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                                    fontSize: 10, fontWeight: 700, color: '#fff' }}
                                                                title="Scan dealer QR code"
                                                            >
                                                                <ScanLine size={12} /> Dealer
                                                            </button>
                                                            <span style={{
                                                                padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                                                                background: 'rgba(255,255,255,0.2)', textTransform: 'uppercase',
                                                                display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                <Users size={13} /> {seatedCount}/{maxSeats}
                                                            </span>
                                                            <Maximize2 size={14} color="rgba(255,255,255,0.7)" />
                                                        </div>
                                                    </div>

                                                    {/* Full poker table visualization */}
                                                    {renderTableVisual(table, false)}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}

                            {/* IDLE TABLES - compact grid */}
                            {idleTables.length > 0 && (
                                <>
                                    <h2 style={{ fontSize: 14, fontWeight: 700, color: '#B0B3B8', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Armchair size={14} /> Available Tables ({idleTables.length})
                                    </h2>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                                        {idleTables.map(table => {
                                            const tNum = table.table_number || table.number;
                                            const maxSeats = table.max_seats || 9;
                                            const statusCfg = STATUS_BADGE[table.status] || STATUS_BADGE.available;
                                            return (
                                                <button key={table.id || tNum} onClick={() => setFullscreenTable(table)}
                                                    style={{
                                                        background: '#242526', border: '1px solid #3A3B3C', borderRadius: 12,
                                                        padding: '14px 12px', cursor: 'pointer', textAlign: 'left',
                                                        display: 'flex', flexDirection: 'column', gap: 6, transition: 'border-color 0.2s' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                                        <span style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>Table {tNum}</span>
                                                        <span style={{
                                                            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                                                            background: `${statusCfg.bg}20`, color: statusCfg.bg }}>
                                                            {statusCfg.label}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748B' }}>
                                                        <Armchair size={12} /> {maxSeats} seats
                                                        {table.table_name && table.table_name !== `Table ${tNum}` && (
                                                            <span>- {table.table_name}</span>
                                                        )}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>

            <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        button:hover { border-color: rgba(24,119,242,0.4) !important; }
        @keyframes fullscreenIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes pulse { from { transform: scale(1); opacity: 1; } to { transform: scale(1.08); opacity: 0.85; } }
      `}</style>

            {/* ── FULLSCREEN TABLE POPUP ── */}
            {fullscreenTable && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#1a1f22', display: 'flex', flexDirection: 'column', animation: 'fullscreenIn 0.2s ease-out', overscrollBehavior: 'none', touchAction: 'manipulation', overflow: 'hidden', height: '100vh', width: '100vw' }}>
                    {/* NO HEADER in fullscreen - table takes up full screen */}
                    {!lockedTable && (
                        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 70, display: 'flex', alignItems: 'center', gap: 10 }}>
                            {/* Lock button - only on tournament tables, shows Unlock icon since page is unlocked */}
                            {isTournamentTable(fullscreenTable) && (
                                <button
                                    onClick={() => { haptic(); lockToTable(fullscreenTable.table_number || fullscreenTable.number); }}
                                    style={{
                                        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.7))' }}
                                >
                                    <Unlock size={42} color="#C0C0C0" strokeWidth={2.2} />
                                </button>
                            )}
                            {/* Close X button */}
                            <button
                                onClick={() => { haptic('light'); setFullscreenTable(null); }}
                                style={{
                                    background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '50%',
                                    width: 40, height: 40, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                                <X size={20} color="#fff" />
                            </button>
                        </div>
                    )}
                    {/* Locked: show small unlock button in top-right corner */}
                    {/* Locked state: show Lock icon (page IS locked) with Unlock button */}
                    {lockedTable && (
                        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
                            <button
                                onClick={() => { haptic(); setShowPinModal(true); setPinValue(''); setPinError(''); }}
                                style={{
                                    background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
                                    borderRadius: 10, padding: '6px 14px', cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}
                                title="Unlock - requires manager PIN"
                            >
                                <Lock size={12} /> Unlock
                            </button>
                        </div>
                    )}

                    {/* Fullscreen table visual - leaves room for bottom icons */}
                    <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8px 0 0 0', overflow: 'hidden', position: 'relative', background: '#1a1f22' }}>
                        <div style={{ width: '100%', maxWidth: 1100 }}>
                            {renderTableVisual(fullscreenTable, true)}
                        </div>

                        {/* ── Corner Floating Buttons ── */}

                        {/* BOTTOM-LEFT: Call Floor */}
                        {(() => {
                            const isA = callFloorSent; const _ss = getStaffSession() || ''; const _tk = getToken(); return (
                                <button disabled={callFloorSending} onClick={!isA ? async () => { haptic('heavy'); setCallFloorSending(true); try { const n = fullscreenTable.table_number || fullscreenTable.number; const r = await commanderFetch('/api/commander/floor-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ venue_id: venueId, table_number: n, table_name: fullscreenTable.table_name || `Table ${n}` }) }).then(r => { if (!r.ok) throw new Error('fail'); return r; }); const j = await r.json(); if (j.success) { setCallFloorSent(true); setCallFloorId(j.data?.id || null); setToast({ type: 'success', text: `Floor called - Table ${n}` }); broadcastChange('floor_calls'); } else { setToast({ type: 'error', text: j.error || 'Floor call failed' }); } } catch { setToast({ type: 'error', text: 'Network error' }); } setCallFloorSending(false); } : async () => { haptic(); if (callFloorId) { try { const j = await commanderFetchJSON('/api/commander/floor-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', call_id: callFloorId }) }); if (j.success) { setToast({ type: 'success', text: 'Floor call cancelled' }); broadcastChange('floor_calls'); setCallFloorSent(false); setCallFloorId(null); } else { setToast({ type: 'error', text: j.error || 'Cancel failed' }); } } catch (e) { console.warn("[table-tablets.js]", e); setToast({ type: 'error', text: 'Network error' }); } } }}
                                    style={{ position: 'fixed', bottom: 4, left: 4, zIndex: 60, height: '20.25vh', width: '27vh', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, opacity: callFloorSending ? 0.5 : 1, transition: 'opacity 0.2s, transform 0.1s', filter: isA ? 'hue-rotate(320deg) saturate(1.5)' : 'none' }}>

                                    <img src='/assets/tablet-buttons/call-floor.png' alt="" style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} loading="lazy" />
                                    {isA && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#EF4444', fontSize: 13, fontWeight: 900, textShadow: '0 0 8px rgba(0,0,0,0.9)', letterSpacing: 0.5 }}>Cancel Floor</div>}
                                </button>);
                        })()}

                        {/* BOTTOM-RIGHT: Call Clock */}
                        {(() => {
                            const a = callClockSeconds !== null; const d = a && callClockSeconds <= 10; return (
                                <button onClick={() => { if (a) { haptic('light'); clearInterval(callClockRef.current); setCallClockSeconds(null); } else { haptic(); setCallClockSeconds(60); if (callClockRef.current) clearInterval(callClockRef.current); callClockRef.current = setInterval(() => { setCallClockSeconds(p => { if (p <= 1) { clearInterval(callClockRef.current); callClockRef.current = null; return 0; } return p - 1; }); }, 1000); } }}
                                    style={{ position: 'fixed', bottom: 4, right: 4, zIndex: 60, height: '20.25vh', width: '27vh', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, transition: 'opacity 0.2s, transform 0.1s' }}>

                                    <img src="/assets/tablet-buttons/call-clock.png" alt="" style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', filter: a ? (d ? 'hue-rotate(320deg) saturate(1.8)' : 'hue-rotate(200deg) saturate(1.3)') : 'none' }} loading="lazy" />
                                </button>);
                        })()}

                        {/* BOTTOM-CENTER: Tournament Clock - only on tournament tables, only when clock overlay is NOT open */}
                        {fullscreenTable && isTournamentTable(fullscreenTable) && fullscreenTable.tournament_id && !showTournamentClock && (
                            <button onClick={() => { haptic(); const t = fullscreenTable.tournament_id; const U = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; if (!t || !U.test(t)) { console.warn('[SAFEGUARD] Invalid tournament_id:', t); return; } if (!isTournamentTable(fullscreenTable)) { console.warn('[SAFEGUARD] Not tournament table'); return; } setLockedTournamentId(t); setShowTournamentClock(true); }}
                                style={{ position: 'fixed', top: 4, left: 4, zIndex: 60, height: '20.25vh', width: '27vh', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, transition: 'opacity 0.2s, transform 0.1s' }}>

                                <img src='/assets/tablet-buttons/tournament-clock.png' alt='' style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} loading="lazy" />
                            </button>
                        )}

                        {/* TOP-CENTER: Shot Clock button - only on tournament tables with shot_clock_enabled */}
                        {fullscreenTable && isTournamentTable(fullscreenTable) && fullscreenTable._tournamentData?.settings?.shot_clock_enabled && (() => {
                            const scDuration = fullscreenTable._tournamentData.settings.shot_clock_seconds || 30;
                            const scActive = shotClockSeconds !== null;
                            return (
                                <button onClick={() => {
                                    haptic();
                                    // Start or reset the shot clock
                                    setShotClockSeconds(scDuration);
                                    setShotClockCollapsed(false);
                                    shotClockVoiceFired.current = false;
                                    if (shotClockRef.current) clearInterval(shotClockRef.current);
                                    shotClockRef.current = setInterval(() => {
                                        setShotClockSeconds(p => {
                                            if (p <= 0) return p; // Already expired, waiting for reset timeout
                                            if (p <= 1) {
                                                // Hit zero - schedule auto-reset after brief flash
                                                const dur = scDuration;
                                                setTimeout(() => {
                                                    shotClockVoiceFired.current = false;
                                                    setShotClockSeconds(dur);
                                                }, 1500);
                                                return 0;
                                            }
                                            // Voice announcement at 5 seconds
                                            if (p === 6 && !shotClockVoiceFired.current) {
                                                shotClockVoiceFired.current = true;
                                                try {
                                                    const u = new SpeechSynthesisUtterance('5 seconds');
                                                    u.rate = 1.1; u.pitch = 1.0; u.volume = 1.0;
                                                    speechSynthesis.speak(u);
                                                } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
                                            }
                                            return p - 1;
                                        });
                                    }, 1000);
                                }}
                                    style={{
                                        position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
                                        zIndex: 60, width: 72, height: 48, border: 'none', cursor: 'pointer', padding: 0,
                                        background: scActive ? 'rgba(239,68,68,0.2)' : 'rgba(59,130,246,0.15)',
                                        borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                        transition: 'background 0.2s' }}>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={scActive ? '#EF4444' : '#3B82F6'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M5 3l2 2" /><path d="M19 3l-2 2" /><path d="M12 5V3" />
                                    </svg>
                                    <span style={{ fontSize: 14, fontWeight: 800, color: scActive ? '#EF4444' : '#3B82F6' }}>
                                        {scActive ? shotClockSeconds : scDuration}
                                    </span>
                                </button>
                            );
                        })()}

                    </div>

                    {/* ── TOURNAMENT CLOCK OVERLAY - 1:1 mirror via iframe ──
                        SAFEGUARD CHAIN:
                        1. lockedTournamentId must exist (set at click-time, UUID-validated)
                        2. fullscreenTable must still be a tournament table
                        3. fullscreenTable.tournament_id must MATCH lockedTournamentId
                        If ANY condition fails, the overlay does NOT render.
                    */}
                    {showTournamentClock
                        && lockedTournamentId
                        && fullscreenTable?.tournament_id
                        && fullscreenTable.tournament_id === lockedTournamentId
                        && isTournamentTable(fullscreenTable) && (
                            <div style={{
                                position: 'absolute', inset: 0, zIndex: 10001,
                                background: '#0D192E', display: 'flex', flexDirection: 'column' }}>
                                {/* Tournament Table back button - icon only, top-left of overlay */}
                                <button onClick={() => { haptic(); setShowTournamentClock(false); setLockedTournamentId(null); }}
                                    style={{
                                        position: 'absolute', top: 8, left: 8, zIndex: 10002,
                                        width: 102, height: 76, border: 'none', background: 'transparent',
                                        cursor: 'pointer', padding: 0 }}>
                                    <img src='/assets/tablet-buttons/tournament-table.png' alt='' style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} loading="lazy" />
                                </button>
                                <iframe
                                    src={'/commander/tournaments/' + lockedTournamentId + '/clock-display'}
                                    style={{ flex: 1, width: '100%', border: 'none', display: 'block' }}
                                    allow="autoplay; fullscreen"
                                    title="Tournament Clock"
                                />
                            </div>
                        )}

                    {/* ── CALL CLOCK FULLSCREEN OVERLAY ── */}
                    {callClockSeconds !== null && (() => {
                        const secs = callClockSeconds;
                        const isUrgent = secs <= 10;
                        const isExpired = secs <= 0;
                        const pct = Math.max(0, secs / 60);
                        const radius = 120;
                        const circumference = 2 * Math.PI * radius;
                        const dashOffset = circumference * (1 - pct);
                        return (
                            <div onClick={() => { haptic('light'); clearInterval(callClockRef.current); callClockRef.current = null; setCallClockSeconds(null); }}
                                style={{
                                    position: 'absolute', inset: 0, zIndex: 10000,
                                    background: isExpired ? 'rgba(239,68,68,0.92)' : isUrgent ? 'rgba(30,10,10,0.95)' : 'rgba(10,20,40,0.95)',
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                    cursor: 'pointer', transition: 'background 0.5s',
                                    animation: isUrgent && !isExpired ? 'pulse 0.5s infinite alternate' : 'none' }}>
                                {/* Title */}
                                <div style={{ fontSize: 22, fontWeight: 800, color: '#FFFFFF', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 24, opacity: 0.9 }}>
                                    {isExpired ? 'TIME\'S UP' : 'CALL CLOCK'}
                                </div>
                                {/* Circular timer */}
                                <div style={{ position: 'relative', width: 280, height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <svg width="280" height="280" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
                                        <circle cx="140" cy="140" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
                                        <circle cx="140" cy="140" r={radius} fill="none"
                                            stroke={isExpired ? '#FFFFFF' : isUrgent ? '#EF4444' : '#3B82F6'}
                                            strokeWidth="10" strokeLinecap="round"
                                            strokeDasharray={circumference} strokeDashoffset={dashOffset}
                                            style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.5s' }} />
                                    </svg>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                        <span style={{
                                            fontSize: isExpired ? 72 : 96, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
                                            color: isExpired ? '#FFFFFF' : isUrgent ? '#EF4444' : '#FFFFFF',
                                            textShadow: isUrgent ? '0 0 40px rgba(239,68,68,0.6)' : '0 0 20px rgba(59,130,246,0.3)',
                                            lineHeight: 1, transition: 'color 0.5s' }}>{secs}</span>
                                        <span style={{ fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginTop: 4, letterSpacing: 2 }}>SECONDS</span>
                                    </div>
                                </div>
                                {/* Cancel hint */}
                                <div style={{ marginTop: 32, fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.35)', letterSpacing: 1 }}>
                                    TAP ANYWHERE TO CANCEL
                                </div>
                            </div>
                        );
                    })()}

                    {/* ── SHOT CLOCK OVERLAY - collapsible fullscreen decision timer ── */}
                    {shotClockSeconds !== null && (() => {
                        const secs = shotClockSeconds;
                        const scDuration = fullscreenTable?._tournamentData?.settings?.shot_clock_seconds || 30;
                        const isUrgent = secs <= 5;
                        const isExpired = secs <= 0;
                        const pct = Math.max(0, secs / scDuration);
                        const radius = 110;
                        const circumference = 2 * Math.PI * radius;
                        const dashOffset = circumference * (1 - pct);

                        if (shotClockCollapsed) {
                            // Collapsed: small floating badge
                            return (
                                <div onClick={() => { haptic('light'); setShotClockCollapsed(false); }}
                                    style={{
                                        position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
                                        zIndex: 9999, width: 80, height: 50,
                                        background: isUrgent ? 'rgba(239,68,68,0.95)' : 'rgba(10,20,40,0.92)',
                                        borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', border: `2px solid ${isUrgent ? '#EF4444' : '#3B82F6'}`,
                                        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                                        animation: isUrgent ? 'pulse 0.5s infinite alternate' : 'none' }}>
                                    <span style={{ fontSize: 26, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{secs}</span>
                                    <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginLeft: 2 }}>s</span>
                                </div>
                            );
                        }

                        // Expanded: fullscreen overlay
                        return (
                            <div style={{
                                position: 'absolute', inset: 0, zIndex: 9999,
                                background: isExpired ? 'rgba(239,68,68,0.92)' : isUrgent ? 'rgba(30,10,10,0.95)' : 'rgba(10,20,40,0.95)',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                transition: 'background 0.5s',
                                animation: isUrgent && !isExpired ? 'pulse 0.5s infinite alternate' : 'none' }}>
                                {/* Title */}
                                <div style={{ fontSize: 20, fontWeight: 800, color: '#FFFFFF', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 20, opacity: 0.9 }}>
                                    {isExpired ? 'TIME\'S UP' : 'SHOT CLOCK'}
                                </div>
                                {/* Circular timer */}
                                <div style={{ position: 'relative', width: 260, height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <svg width="260" height="260" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
                                        <circle cx="130" cy="130" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
                                        <circle cx="130" cy="130" r={radius} fill="none"
                                            stroke={isExpired ? '#FFFFFF' : isUrgent ? '#EF4444' : '#3B82F6'}
                                            strokeWidth="8" strokeLinecap="round"
                                            strokeDasharray={circumference} strokeDashoffset={dashOffset}
                                            style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.5s' }} />
                                    </svg>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                        <span style={{
                                            fontSize: isExpired ? 64 : 88, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
                                            color: isExpired ? '#FFFFFF' : isUrgent ? '#EF4444' : '#FFFFFF',
                                            textShadow: isUrgent ? '0 0 40px rgba(239,68,68,0.6)' : '0 0 20px rgba(59,130,246,0.3)',
                                            lineHeight: 1, transition: 'color 0.5s' }}>{secs}</span>
                                        <span style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginTop: 4, letterSpacing: 2 }}>SECONDS</span>
                                    </div>
                                </div>
                                {/* Bottom actions */}
                                <div style={{ marginTop: 28, display: 'flex', gap: 16, alignItems: 'center' }}>
                                    {/* Collapse button */}
                                    <button onClick={(e) => { e.stopPropagation(); haptic('light'); setShotClockCollapsed(true); }}
                                        style={{
                                            padding: '10px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)',
                                            background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 13, fontWeight: 600,
                                            cursor: 'pointer', letterSpacing: 1 }}>
                                        MINIMIZE
                                    </button>
                                    {/* Reset button */}
                                    <button onClick={(e) => {
                                        e.stopPropagation(); haptic();
                                        shotClockVoiceFired.current = false;
                                        setShotClockSeconds(scDuration);
                                    }}
                                        style={{
                                            padding: '10px 20px', borderRadius: 10, border: 'none',
                                            background: '#3B82F6', color: '#fff', fontSize: 13, fontWeight: 700,
                                            cursor: 'pointer', letterSpacing: 1 }}>
                                        RESET
                                    </button>
                                    {/* Stop button */}
                                    <button onClick={(e) => {
                                        e.stopPropagation(); haptic('light');
                                        clearInterval(shotClockRef.current); shotClockRef.current = null;
                                        setShotClockSeconds(null); setShotClockCollapsed(false);
                                        shotClockVoiceFired.current = false;
                                    }}
                                        style={{
                                            padding: '10px 20px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.4)',
                                            background: 'rgba(239,68,68,0.15)', color: '#EF4444', fontSize: 13, fontWeight: 600,
                                            cursor: 'pointer', letterSpacing: 1 }}>
                                        STOP
                                    </button>
                                </div>
                            </div>
                        );
                    })()}

                    {toast && (
                        <div style={{
                            position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 10001,
                            padding: '12px 24px', borderRadius: 14,
                            background: toast.type === 'success' ? 'rgba(49,162,76,0.95)' : 'rgba(239,68,68,0.95)',
                            color: '#fff', fontSize: 15, fontWeight: 700, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                            {toast.text}
                        </div>
                    )}

                    {/* ── Move Mode Banner ── */}
                    {movingPlayer && (
                        <div style={{
                            position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 10001,
                            padding: '10px 20px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 12,
                            background: 'rgba(24,119,242,0.95)', color: '#fff', fontSize: 14, fontWeight: 700,
                            boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                            Moving {movingPlayer.player_name} - tap an empty seat
                            <button onClick={() => { haptic(); setMovingPlayer(null); setToast({ type: 'success', text: 'Move cancelled' }); }}
                                style={{ padding: '4px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                            >Cancel</button>
                        </div>
                    )}
                </div>
            )}

            {/* ── PLAYER ACTION MENU (fullscreen mode) ── */}
            {showPlayerMenu && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => { haptic('light'); setShowPlayerMenu(null); }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#242526', borderRadius: 20, padding: '24px', width: '90%', maxWidth: 340, border: '2px solid #3A3B3C', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
                        <div style={{ textAlign: 'center', marginBottom: 20 }}>
                            <div style={{ width: 64, height: 64, borderRadius: '50%', margin: '0 auto 10px', background: 'linear-gradient(135deg, #1877F2, #1565c0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 900, color: '#fff' }}>
                                {(showPlayerMenu.taken?.player_name || 'P').charAt(0).toUpperCase()}
                            </div>
                            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#fff' }}>{showPlayerMenu.taken?.player_name || 'Player'}</h3>
                            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8A8D91' }}>Seat {showPlayerMenu.number} · Table {showPlayerMenu.tableNumber}</p>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {(() => {
                                const menuTable = tables.find(t => (t.table_number || t.number) === showPlayerMenu.tableNumber);
                                const isTournMenu = menuTable && isTournamentTable(menuTable);
                                const entryId = showPlayerMenu.taken?.entry_id;
                                const tournId = showPlayerMenu.taken?.tournament_id || menuTable?.tournament_id;
                                const pName = showPlayerMenu.taken?.player_name || 'Player';
                                const iconSize = 16;
                                const actions = isTournMenu ? [
                                    { label: 'Move Player', icon: React.createElement(ArrowRightLeft, { size: iconSize }), color: '#1877F2', action: () => { setMovingPlayer({ seat: showPlayerMenu, player_name: pName, tableNumber: showPlayerMenu.tableNumber }); setShowPlayerMenu(null); setToast({ type: 'success', text: 'Tap an empty seat to move ' + pName }); } },
                                    { label: 'Bust Player', icon: React.createElement(Skull, { size: iconSize }), color: '#EF4444', action: async () => { if (!confirm('Bust ' + pName + '?')) return; if (entryId && tournId) { await bustTournamentPlayer(tournId, entryId, pName); } else { setToast({ type: 'error', text: 'Missing entry data - try refreshing' }); } } },
                                    { label: 'Update Chip Count', icon: React.createElement(Coins, { size: iconSize }), color: '#FFD700', action: () => { setChipCountInput(''); } },
                                    { label: 'Rebuy', icon: React.createElement(Coins, { size: iconSize }), color: '#31A24C', action: async () => { if (entryId && tournId) { await rebuyTournamentPlayer(tournId, entryId, pName); } else { setToast({ type: 'error', text: 'Missing entry data - try refreshing' }); } } },
                                    { label: 'Add-On', icon: React.createElement(Coins, { size: iconSize }), color: '#22c55e', action: async () => { if (entryId && tournId) { await addonTournamentPlayer(tournId, entryId, pName); } else { setToast({ type: 'error', text: 'Missing entry data - try refreshing' }); } } },
                                    ...(lastBustedEntry && lastBustedEntry.tournament_id === tournId
                                        ? [{ label: `Undo Bust, ${lastBustedEntry.player_name}`, icon: React.createElement(Clock, { size: iconSize }), color: '#8A8D91', action: async () => { await restoreTournamentEntry(lastBustedEntry.tournament_id, lastBustedEntry.entry_id, lastBustedEntry.player_name); } }]
                                        : []),
                                ] : [
                                    { label: 'Move Player', icon: React.createElement(ArrowRightLeft, { size: iconSize }), color: '#1877F2', action: () => { setMovingPlayer({ seat: showPlayerMenu, player_name: pName, tableNumber: showPlayerMenu.tableNumber }); setShowPlayerMenu(null); setToast({ type: 'success', text: 'Tap an empty seat to move ' + pName }); } },
                                    { label: 'Remove Player', icon: React.createElement(XCircle, { size: iconSize }), color: '#EF4444', action: () => removePlayer(showPlayerMenu.tableNumber, showPlayerMenu.number) },
                                    ...(showPlayerMenu.taken?.session_status === 'paused' || showPlayerMenu.taken?.session_status === 'meal_break'
                                        ? [{ label: 'Resume Timer', icon: React.createElement(Clock, { size: iconSize }), color: '#22c55e', action: async () => { const json = await callSessionAction(showPlayerMenu.tableNumber, showPlayerMenu.number, 'resume'); if (json.success) { setToast({ type: 'success', text: json.data.player_name + ' resumed' }); } else { setToast({ type: 'error', text: json.error || 'Resume failed' }); } setShowPlayerMenu(null); fetchAll(); } }]
                                        : [{ label: 'Pause Timer', icon: React.createElement(Timer, { size: iconSize }), color: '#F59E0B', action: async () => { const json = await callSessionAction(showPlayerMenu.tableNumber, showPlayerMenu.number, 'pause'); if (json.success) { setToast({ type: 'success', text: json.data.player_name + ' paused' }); } else { setToast({ type: 'error', text: json.error || 'Pause failed' }); } setShowPlayerMenu(null); fetchAll(); } }]
                                    ),
                                    { label: 'Missed Blinds', icon: React.createElement(AlertTriangle, { size: iconSize }), color: '#F97316', action: async () => { const json = await callSessionAction(showPlayerMenu.tableNumber, showPlayerMenu.number, 'missed_blinds'); if (json.success) { const count = json.data.missed_blinds_count; if (count >= 3) { setToast({ type: 'error', text: json.data.player_name + ' removed - 3 missed blinds' }); await removePlayer(showPlayerMenu.tableNumber, showPlayerMenu.number); } else { setToast({ type: 'success', text: 'Missed blind #' + count + ' for ' + json.data.player_name }); } fetchAll(); } else { setToast({ type: 'error', text: json.error || 'Failed' }); } setShowPlayerMenu(null); } },
                                    { label: '30-Min Meal Break', icon: React.createElement(Clock, { size: iconSize }), color: '#8B5CF6', action: async () => { const json = await callSessionAction(showPlayerMenu.tableNumber, showPlayerMenu.number, 'meal_break'); if (json.success) { setToast({ type: 'success', text: '30-min meal break for ' + json.data.player_name }); } else { setToast({ type: 'error', text: json.error || 'Failed' }); } setShowPlayerMenu(null); fetchAll(); } },
                                    { label: 'Add Time', icon: React.createElement(Clock, { size: iconSize }), color: '#0EA5E9', action: async () => { const raw = window.prompt('Minutes to add for ' + pName + '?', '60'); const mins = parseInt(raw, 10); if (!mins || isNaN(mins) || mins <= 0) { setShowPlayerMenu(null); return; } const json = await callSessionAction(showPlayerMenu.tableNumber, showPlayerMenu.number, 'add_time', { minutes: mins }); if (json.success) { setToast({ type: 'success', text: 'Added ' + mins + 'm for ' + (json.data.player_name || pName) }); } else { setToast({ type: 'error', text: json.error || 'Failed to add time' }); } setShowPlayerMenu(null); fetchAll(); } },
                                ];
                                return actions.map((btn, i) => (
                                    React.createElement('button', {
                                        key: i, onClick: () => { haptic(); btn.action(); }, disabled: playerActionLoading,
                                        style: { padding: '14px 16px', borderRadius: 12, border: '1px solid #3A3B3C', borderLeft: `3px solid ${btn.color}`, cursor: 'pointer', background: '#3A3B3C', color: '#E4E6EB', fontSize: 15, fontWeight: 700, textAlign: 'left', display: 'flex', alignItems: 'center', transition: 'background 0.15s' }
                                    }, btn.label)
                                ));
                            })()}
                        </div>
                        {chipCountInput !== null && tables.find(t => (t.table_number || t.number) === showPlayerMenu?.tableNumber && isTournamentTable(t)) && (() => {
                            const appendDigit = (d) => { const raw = (chipCountInput || '').replace(/[^0-9]/g, '') + d; if (raw.length > 10) return; setChipCountInput(parseInt(raw).toLocaleString()); };
                            const backspace = () => { const raw = (chipCountInput || '').replace(/[^0-9]/g, ''); if (!raw) return; const trimmed = raw.slice(0, -1); setChipCountInput(trimmed ? parseInt(trimmed).toLocaleString() : ''); };
                            const clearAll = () => setChipCountInput('');
                            const rawVal = parseInt((chipCountInput || '').replace(/[^0-9]/g, ''));
                            const kBtn = { minHeight: 56, borderRadius: 10, border: '1px solid #3A3B3C', background: '#2A2B2C', color: '#E4E6EB', fontSize: 22, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.1s' };
                            return (
                                <div style={{ marginTop: 16 }}>
                                    {/* Chip count display */}
                                    <div style={{ padding: '14px 16px', borderRadius: 12, border: '2px solid #FFD700', background: '#18191A', marginBottom: 10, textAlign: 'center', minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <span style={{ fontSize: chipCountInput ? 28 : 16, fontWeight: 800, color: chipCountInput ? '#FFD700' : '#555', letterSpacing: 2, fontVariantNumeric: 'tabular-nums' }}>
                                            {chipCountInput || 'Enter chip count'}
                                        </span>
                                    </div>
                                    {/* Keypad grid */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                                            <button key={n} onClick={() => { haptic('light'); appendDigit(String(n)); }} style={kBtn}>{n}</button>
                                        ))}
                                        <button onClick={() => { haptic('light'); clearAll(); }} style={{ ...kBtn, color: '#EF4444', fontSize: 14, fontWeight: 800 }}>CLR</button>
                                        <button onClick={() => { haptic('light'); appendDigit('0'); }} style={kBtn}>0</button>
                                        <button onClick={() => { haptic('light'); backspace(); }} style={{ ...kBtn, color: '#F59E0B', fontSize: 18 }}>⌫</button>
                                    </div>
                                    {/* Save button */}
                                    <button disabled={!rawVal || isNaN(rawVal) || playerActionLoading} onClick={async () => {
                                        if (!rawVal || isNaN(rawVal)) return;
                                        haptic();
                                        const eId = showPlayerMenu.taken?.entry_id;
                                        const tId = showPlayerMenu.taken?.tournament_id || tables.find(t => (t.table_number || t.number) === showPlayerMenu?.tableNumber)?.tournament_id;
                                        const pN = showPlayerMenu.taken?.player_name || 'Player';
                                        if (eId && tId) {
                                            await updateTournamentChipCount(tId, eId, rawVal, pN);
                                        } else {
                                            setToast({ type: 'error', text: 'Missing entry data - try refreshing' });
                                        }
                                        setChipCountInput(null);
                                        setShowPlayerMenu(null);
                                    }} style={{ width: '100%', marginTop: 10, padding: '14px', borderRadius: 12, background: (!rawVal || isNaN(rawVal)) ? '#3A3B3C' : '#FFD700', border: 'none', color: (!rawVal || isNaN(rawVal)) ? '#666' : '#000', fontSize: 16, fontWeight: 800, cursor: (!rawVal || isNaN(rawVal)) ? 'not-allowed' : 'pointer', transition: 'background 0.2s' }}>
                                        {playerActionLoading ? 'Saving...' : `Save - ${rawVal && !isNaN(rawVal) ? rawVal.toLocaleString() : '0'} chips`}
                                    </button>
                                </div>
                            );
                        })()}
                        <button onClick={() => { haptic('light'); setShowPlayerMenu(null); setChipCountInput(null); }} style={{ width: '100%', marginTop: 12, padding: '12px', borderRadius: 12, background: '#3A3B3C', border: 'none', color: '#8A8D91', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                    </div>
                </div>
            )}

            {/* ── TOURNAMENT NOTICE (auto-break, promoted alternate, restore) ── */}
            {tournamentNotice && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10004, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => { haptic('light'); setTournamentNotice(null); }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#242526', borderRadius: 20, padding: 24, width: '90%', maxWidth: 380, border: '2px solid #3A3B3C', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
                        <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800, color: '#fff' }}>{tournamentNotice.title}</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
                            {(tournamentNotice.lines || []).map((line, i) => (
                                <p key={i} style={{ margin: 0, fontSize: 14, color: '#B0B3B8', lineHeight: 1.45 }}>{line}</p>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            {lastBustedEntry && (
                                <button onClick={() => { haptic(); restoreTournamentEntry(lastBustedEntry.tournament_id, lastBustedEntry.entry_id, lastBustedEntry.player_name); }}
                                    disabled={playerActionLoading}
                                    style={{ flex: 1, padding: '13px', borderRadius: 12, background: '#3A3B3C', border: '1px solid #4E4F50', color: '#E4E6EB', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                                    Undo Bust
                                </button>
                            )}
                            <button onClick={() => { haptic('light'); setTournamentNotice(null); }}
                                style={{ flex: 1, padding: '13px', borderRadius: 12, background: '#1877F2', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                                Got It
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── UNDO BUST CONFIRMATION (409 PAYOUT_RECORDED) ── */}
            {restoreConfirm && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 10005, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => { haptic('light'); setRestoreConfirm(null); }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#242526', borderRadius: 20, padding: 24, width: '90%', maxWidth: 380, border: '2px solid #3A3B3C', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', textAlign: 'center' }}>
                        <div style={{ width: 56, height: 56, borderRadius: '50%', margin: '0 auto 12px', background: 'rgba(245,158,11,0.1)', border: '2px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <AlertTriangle size={28} color="#F59E0B" />
                        </div>
                        <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800, color: '#fff' }}>Payout Already Recorded</h3>
                        <p style={{ margin: '0 0 20px', fontSize: 14, color: '#B0B3B8', lineHeight: 1.45 }}>{restoreConfirm.message}</p>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => { haptic('light'); setRestoreConfirm(null); }}
                                style={{ flex: 1, padding: '13px', borderRadius: 12, background: '#3A3B3C', border: 'none', color: '#E4E6EB', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                                Cancel
                            </button>
                            <button onClick={() => { haptic('heavy'); restoreTournamentEntry(restoreConfirm.tournament_id, restoreConfirm.entry_id, restoreConfirm.player_name, true); }}
                                disabled={playerActionLoading}
                                style={{ flex: 1, padding: '13px', borderRadius: 12, background: '#EF4444', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                                Undo Anyway
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── SEAT SCANNER MODAL ── */}
            {seatScanner && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 10003, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ textAlign: 'center', marginBottom: 20 }}>
                        <div style={{ fontSize: 36, marginBottom: 8 }}><ScanLine size={36} color="#10B981" /></div>
                        <h3 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>Scan Player for Seat {seatScanner.seatNumber}</h3>
                        <p style={{ fontSize: 13, color: '#8A8D91', margin: '6px 0 0' }}>Hold QR code in front of camera</p>
                    </div>
                    <div style={{ width: '90%', maxWidth: 400, aspectRatio: '4/3', borderRadius: 16, overflow: 'hidden', border: '3px solid #1877F2', position: 'relative' }}>
                        <video ref={seatScannerVideoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline muted />
                    </div>
                    {/* Manual entry removed - scan only */}
                    <button onClick={() => { haptic(); closeSeatScanner(); }} style={{ marginTop: 12, padding: '14px 48px', borderRadius: 12, background: '#EF4444', border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                </div>
            )}

            {/* ── DEALER SCAN-IN MODAL ── */}
            {scanningTable && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={() => { haptic('light'); closeDealerScan(); }} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)' }} />
                    <div style={{
                        position: 'relative', background: '#242526', borderRadius: 16,
                        width: '90%', maxWidth: 400, padding: 24,
                        border: '2px solid #3A3B3C', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                            <div>
                                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>Dealer Scan-In</h3>
                                <p style={{ margin: 0, fontSize: 12, color: '#B0B3B8' }}>Table {scanningTable}</p>
                            </div>
                            <button onClick={() => { haptic('light'); closeDealerScan(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                                <X size={20} color="#B0B3B8" />
                            </button>
                        </div>

                        {scanResult ? (
                            <div style={{ textAlign: 'center', padding: '24px 0' }}>
                                <CheckCircle size={48} color="#10B981" style={{ margin: '0 auto 12px' }} />
                                <p style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>{scanResult.dealer_name}</p>
                                <p style={{ fontSize: 13, color: '#10B981', fontWeight: 600, margin: 0 }}>
                                    Assigned to Table {scanResult.table_number}
                                </p>
                            </div>
                        ) : (
                            <>
                                {scanError && (
                                    <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#EF4444' }}>
                                        {scanError}
                                    </div>
                                )}

                                {scanCameraActive ? (
                                    <div style={{ textAlign: 'center' }}>
                                        <video
                                            ref={(el) => { videoRef.current = el; if (el && streamRef.current) el.srcObject = streamRef.current; }}
                                            autoPlay playsInline
                                            style={{ width: '100%', borderRadius: 12, background: '#000', marginBottom: 12 }}
                                        />
                                        <button onClick={() => { haptic(); stopDealerCamera(); }}
                                            style={{ padding: '8px 20px', background: '#3A3B3C', color: '#E4E6EB', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                                            Cancel
                                        </button>
                                    </div>
                                ) : (
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ width: 64, height: 64, background: 'rgba(16,185,129,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                                            <ScanLine size={32} color="#10B981" />
                                        </div>
                                        <p style={{ fontSize: 13, color: '#B0B3B8', marginBottom: 16 }}>Scan dealer QR code to assign</p>
                                        <button onClick={startDealerCamera}
                                            style={{ padding: '10px 24px', background: '#10B981', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            <Camera size={16} /> Open Scanner
                                        </button>
                                    </div>
                                )}

                                {/* Manual entry removed - scan only */}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ── PIN UNLOCK MODAL ── */}
            {showPinModal && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 20000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={() => { haptic('light'); setShowPinModal(false); }} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.85)' }} />
                    <div style={{
                        position: 'relative', background: '#242526', borderRadius: 20,
                        width: '90%', maxWidth: 360, padding: 32,
                        border: '2px solid #3A3B3C', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
                        {/* Header */}
                        <div style={{ textAlign: 'center', marginBottom: 24 }}>
                            <div style={{
                                width: 64, height: 64, borderRadius: '50%', margin: '0 auto 12px',
                                background: 'rgba(239,68,68,0.1)', border: '2px solid rgba(239,68,68,0.3)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <ShieldCheck size={32} color="#EF4444" />
                            </div>
                            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#fff' }}>Unlock Tablet</h3>
                            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#8A8D91' }}>
                                Enter manager or owner PIN to unlock
                            </p>
                        </div>

                        {/* PIN display */}
                        <div style={{
                            display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 20 }}>
                            {[0, 1, 2, 3].map(i => (
                                <div key={i} style={{
                                    width: 40, height: 48, borderRadius: 10,
                                    background: pinValue.length > i ? '#1877F2' : '#3A3B3C',
                                    border: `2px solid ${pinValue.length > i ? '#1877F2' : '#4E4F50'}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'all 0.15s' }}>
                                    {pinValue.length > i && (
                                        <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#fff' }} />
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Error */}
                        {pinError && (
                            <div style={{
                                padding: '8px 12px', marginBottom: 16, borderRadius: 10,
                                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                                color: '#EF4444', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
                                {pinError}
                            </div>
                        )}

                        {/* Numeric keypad */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'].map((key, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => {
                                        haptic('light');
                                        if (key === null) return;
                                        if (key === 'del') { setPinValue(v => v.slice(0, -1)); setPinError(''); }
                                        else if (pinValue.length < 4) { setPinValue(v => v + key); setPinError(''); }
                                    }}
                                    style={{
                                        padding: '16px 0', borderRadius: 12,
                                        background: key === null ? 'transparent' : key === 'del' ? '#3A3B3C' : '#3A3B3C',
                                        border: key === null ? 'none' : '1px solid #4E4F50',
                                        color: '#E4E6EB', fontSize: key === 'del' ? 14 : 22, fontWeight: 700,
                                        cursor: key === null ? 'default' : 'pointer',
                                        visibility: key === null ? 'hidden' : 'visible',
                                        transition: 'background 0.15s' }}
                                >
                                    {key === 'del' ? '⌫' : key}
                                </button>
                            ))}
                        </div>

                        {/* Submit */}
                        <button
                            onClick={() => { haptic('heavy'); handleUnlockAttempt(); }}
                            disabled={pinLoading || pinValue.length !== 4}
                            style={{
                                width: '100%', padding: '14px', borderRadius: 12,
                                background: pinValue.length === 4 ? '#EF4444' : '#3A3B3C',
                                color: '#fff', border: 'none', fontSize: 16, fontWeight: 700,
                                cursor: pinValue.length === 4 ? 'pointer' : 'not-allowed',
                                opacity: pinLoading ? 0.7 : 1,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                transition: 'all 0.2s' }}
                        >
                            {pinLoading ? (
                                <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Verifying...</>
                            ) : (
                                <><Unlock size={18} /> Unlock Tablet</>
                            )}
                        </button>

                        {/* Cancel */}
                        <button
                            onClick={() => { setShowPinModal(false); setPinValue(''); setPinError(''); }}
                            style={{
                                width: '100%', padding: '10px', marginTop: 8,
                                background: 'transparent', border: 'none', borderRadius: 8,
                                color: '#8A8D91', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        
      <ConfirmDialog />
    </CommanderLayout>
    );
}
