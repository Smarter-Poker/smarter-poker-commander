/**
 * Waitlist Desk View — The Board
 * /commander/waitlist/desk
 * Professional grid display: black background, uniform colored headers,
 * table numbers sub-row, venue branding, scrolling ticker.
 * 4 games per page, auto-rotates every 10s if more games exist.
 * Click a player name → action buttons. Real-time via Supabase + 15s polling.
 *
 * FULLY CUSTOMIZABLE: Colors, logo, game types via ⚙️ Settings modal.
 * Settings persist to Supabase via /api/commander/settings (desk_customization field).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { busEmit } from '../../../src/engine/EventBus';
import { useRouter } from 'next/router';
import Image from 'next/image';
import SEOHead from '../../../src/components/seo/SEOHead';
import Pagination from '../../../src/components/commander/shared/Pagination';

import { useCommanderSync, broadcastChange } from '../../../src/lib/commander/useCommanderSync';
import { Loader2, Users, UserPlus, ArrowLeft, ArrowRight, ArrowRightLeft, PhoneCall, Armchair, SkipForward, Trash2, MessageSquare, Phone, X, Settings, Upload, Plus, Trash, GripVertical, CheckCircle } from 'lucide-react';
import dynamic from 'next/dynamic';
const SkeletonDark = dynamic(() => import('../../../src/components/ui/SkeletonDark'), { ssr: false });
import DealerTicker from '../../../src/components/commander/shared/DealerTicker';
import { getVenueId, getStaffData } from '../../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';
import { supabase } from '../../../src/lib/supabase'; // 2026-08-04 audit fix: used by the settings logo upload
import { useConfirmAction } from "../../../src/components/commander/shared/ConfirmModal";
import { formatPhone, titleCase } from '../../../src/lib/commander/formatters';
import { lighten, darken } from '../../../src/lib/commander/colorUtils';

// formatPhone, titleCase imported from '@/lib/commander/formatters'
// lighten, darken imported from '@/lib/commander/colorUtils'

const GAMES_PER_PAGE = 4;
const ROTATE_INTERVAL = 10000;

// Default customization — the classic gold theme
const DEFAULT_CUSTOM = {
  headerColor: '#B8860B',
  accentColor: '#D4AF37',
  bgColor: '#000000',
  cardBgColor: '#050505',
  textColor: '#E0E0E0',
  borderColor: '#666666',
  logoUrl: '',
  tickerMessage: '',
  gameTypes: [],  // empty = auto-detect from tables
  playerFontSize: 28 };

export default function WaitlistDesk() {
  const router = useRouter();

  // ── EventBus: Commander session telemetry ──

  // ── Toast auto-dismiss ──
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-waitlist-desk'); }, []);
  const [tables, setTables] = useState([]);
  const [waitlists, setWaitlists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seatModal, setSeatModal] = useState(null);
  const [callLoading, setCallLoading] = useState(null);
  const [smsStatus, setSmsStatus] = useState(null);
  const [showAddWalkIn, setShowAddWalkIn] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [venueName, setVenueName] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [custom, setCustom] = useState(DEFAULT_CUSTOM);
  const [addGameType, setAddGameType] = useState('');
  const [editGame, setEditGame] = useState(null); // { oldLabel, gameType, stakes }
  const [showAddGame, setShowAddGame] = useState(false);
  const [newGameType, setNewGameType] = useState('');
  const [newGameStakes, setNewGameStakes] = useState('');
  const [newGameTable, setNewGameTable] = useState('');
  const [mustMoveData, setMustMoveData] = useState(null); // Must-move groups from the API
  const [moveLoading, setMoveLoading] = useState(null);
  // ── Hardening: optimistic UI lock ──
  const [actionLock, setActionLock] = useState(null); // entry.id being processed
  // 2026-08-04 audit fix: several catch blocks call setToast but no toast state
  // existed in this component — error paths crashed with a ReferenceError.
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const genIdempotencyKey = () => `wl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Load venue info + saved desk customization
  useEffect(() => {
    try {
      const staff = getStaffData();
      if (staff.venue_name) setVenueName(staff.venue_name);
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

    // Fetch saved settings
    const controller = new AbortController();
    (async () => {
      try {
const json = await commanderFetchJSON('/api/commander/settings', { signal: controller.signal });
        if (json.success && json.data?.desk_customization) {
          setCustom(prev => ({ ...prev, ...json.data.desk_customization }));
        }
      } catch (e) { if (e.name !== 'AbortError') console.warn(e); }
    })();
    return () => controller.abort();
  }, []);

  const saveCustomization = async (newCustom) => {
    setCustom(newCustom);
    try {
const res = await commanderFetch('/api/commander/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desk_customization: newCustom })
      });
      if (!res.ok) throw new Error('Request failed');
    } catch (err) { console.warn('Failed to save customization:', err); setToast({ type: 'error', text: 'Action failed: Failed to save customization. Please try again.' }); }
  };

  const CALL_EXPIRY_MINUTES = 10; // Auto-delete called entries after 10 minutes

  const fetchData = useCallback(async (signal) => {
    try {
const staffData = getStaffData();
      const vid = staffData.venue_id || '';
      const headers = { };
      const fetchOpts = (signal instanceof AbortSignal) ? { headers, signal } : { headers }; // 2026-08-04 audit fix: useCommanderSync passes an entity string, not an AbortSignal
      const [tabRes, wlRes, mmRes] = await Promise.all([
        commanderFetch(`/api/commander/tables?venue_id=${vid}`, fetchOpts).then(r => { if (!r.ok) throw new Error(`tables ${r.status}`); return r; }).catch(() => ({ json: async () => ({ success: false }) })),
        commanderFetch(`/api/commander/waitlist?venue_id=${vid}`, fetchOpts).then(r => { if (!r.ok) throw new Error(`waitlist ${r.status}`); return r; }).catch(() => ({ json: async () => ({ success: false }) })),
        commanderFetch(`/api/commander/games/must-move-status?venue_id=${vid}`, fetchOpts).catch(() => ({ json: async () => ({ success: false }) }))
      ]);
      const tabJson = await tabRes.json();
      const wlJson = await wlRes.json();
      const mmJson = await mmRes.json();
      if (tabJson.success) setTables(tabJson.data?.tables || tabJson.data || []);
      if (mmJson.success) setMustMoveData(mmJson.data);
      if (wlJson.success) {
        const entries = wlJson.data || [];
        // Auto-delete called entries older than 10 minutes
        const now = Date.now();
        const expiredCalled = entries.filter(e =>
          e.status === 'called' && e.last_called_at &&
          (now - new Date(e.last_called_at).getTime()) > CALL_EXPIRY_MINUTES * 60 * 1000
        );
        if (expiredCalled.length > 0) {
          await Promise.all(expiredCalled.map(e =>
            commanderFetch(`/api/commander/waitlist/${e.id}`, {
              method: 'DELETE'}).then(r => { if (!r.ok) console.warn('Non-critical cleanup err'); }).catch(e => { console.warn('[App] Handled promise rejection:', e?.message || e); })
          ));
          // Filter out expired entries from the display
          const expiredIds = new Set(expiredCalled.map(e => e.id));
          setWaitlists(entries.filter(e => !expiredIds.has(e.id)));
        } else {
          setWaitlists(entries);
        }
      }
    } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    const interval = setInterval(() => fetchData(controller.signal), 30000); // fallback — real-time sync handles instant updates
    return () => { controller.abort(); clearInterval(interval); };
  }, [fetchData]);

  const [venueId] = useState(() => {
    return getVenueId();
  });
  useCommanderSync(venueId, fetchData, { entities: ['waitlist', 'tables', 'games'] });

  // ── ACTION HANDLERS ─────────────────────────────────────────────
  const handleCall = async (entry) => {
    if (actionLock) return; // Optimistic lock — prevent double-tap
    if (!entry.player_phone) {
      alert(`NO PHONE NUMBER\n\n${titleCase(entry.player_name || '')} does not have a phone number on file. Please page them verbally in the room.`);
    }
    setActionLock(entry.id); setCallLoading(entry.id); setSmsStatus(null);
    setSelectedPlayer(null);
    try {
const res = await commanderFetch(`/api/commander/waitlist/${entry.id}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-idempotency-key': genIdempotencyKey() },
        body: JSON.stringify({ notify_sms: true, notify_push: true })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        console.warn('Call API error:', json);
        setSmsStatus({ type: 'none', text: json.error?.message || json.error || 'Call failed' });
        setTimeout(() => setSmsStatus(null), 4000);
        await fetchData();
        return;
      }
      // Update UI with the [id]/call response shape
      setWaitlists(prev => prev.map(e => e.id === entry.id ? { ...e, status: 'called' } : e));
      const notifCount = json.data?.notifications_sent || 0;
      if (notifCount > 0) setSmsStatus({ type: 'sent', text: `${titleCase(entry.player_name)} notified (${notifCount} notification${notifCount > 1 ? 's' : ''})` });
      else if (!entry.player_phone) setSmsStatus({ type: 'none', text: 'No Phone — Verbal Page Only' });
      else setSmsStatus({ type: 'none', text: 'Called — Notifications Unavailable' });
      busEmit.waitlistPlayerCalled(entry.player_name, entry.game_type);
      await fetchData();
      broadcastChange('waitlist');
      busEmit.screenFlash('#1877F2', 300);
      setTimeout(() => setSmsStatus(null), 3000);
    } catch (err) { console.warn('Call error:', err); setSmsStatus({ type: 'none', text: 'Network error' }); setTimeout(() => setSmsStatus(null), 3000); }
    finally { setCallLoading(null); setActionLock(null); }
  };

  const handleSeat = async (entry, tableNumber, seatNumber) => {
    if (actionLock) return; // Optimistic lock — prevent double-tap
    setActionLock(entry.id);
    try {
const res = await commanderFetch('/api/commander/waitlist/seat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-idempotency-key': genIdempotencyKey() },
        body: JSON.stringify({ waitlist_id: entry.id, table_number: tableNumber, seat_number: seatNumber })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        console.warn('Seat API error:', json);
        setSmsStatus({ type: 'none', text: 'Seat failed: ' + (json.error?.message || json.error || 'Unknown error') });
        setTimeout(() => setSmsStatus(null), 4000);
      } else {
        // Only remove from UI after confirmed success
        setWaitlists(prev => prev.filter(e => e.id !== entry.id));
        setSeatModal(null); setSelectedPlayer(null);
        busEmit.waitlistPlayerSeated(entry.player_name, tableNumber, seatNumber);
        busEmit.celebration('confetti');
        setSmsStatus({ type: 'sent', text: `${titleCase(entry.player_name)} seated at Table ${tableNumber} Seat ${seatNumber}` });
        setTimeout(() => setSmsStatus(null), 4000);
        await fetchData();
        broadcastChange('waitlist');
      }
    } catch (err) { console.warn('Seat error:', err); setSmsStatus({ type: 'none', text: 'Seat failed: ' + err.message }); setTimeout(() => setSmsStatus(null), 4000); await fetchData(); }
    finally { setActionLock(null); }
  };

  const handlePass = async (entry) => {
    if (actionLock) return; // Optimistic lock
    setActionLock(entry.id);
    setSelectedPlayer(null);
    try {
const res = await commanderFetch(`/api/commander/waitlist/${entry.id}/pass`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-idempotency-key': genIdempotencyKey() }
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        console.warn('Pass API error:', json);
        setSmsStatus({ type: 'none', text: 'Pass failed: ' + (json.error?.message || json.error || 'Unknown error') });
        setTimeout(() => setSmsStatus(null), 4000);
        await fetchData();
      } else {
        // Move player to bottom of their game column upon success
        setWaitlists(prev => {
          const sameGame = prev.filter(e => e.game_type === entry.game_type && e.stakes === entry.stakes);
          const maxPos = Math.max(...sameGame.map(e => e.position || 0), 0);
          return prev.map(e => e.id === entry.id ? { ...e, position: maxPos + 1, status: 'waiting' } : e);
        });
        await fetchData();
        broadcastChange('waitlist');
      }
    } catch (err) { console.warn('Pass error:', err); setToast({ type: 'error', text: 'Action failed: Pass. Please try again.' }); await fetchData(); }
    finally { setActionLock(null); }
  };

  const handleRemove = async (entry) => {
    if (actionLock) return; // Optimistic lock
    setActionLock(entry.id);
    setSelectedPlayer(null);
    try {
const res = await commanderFetch(`/api/commander/waitlist/${entry.id}`, {
        method: 'DELETE',
        headers: { 'x-idempotency-key': genIdempotencyKey() }
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        console.warn('Remove API error:', json);
        setSmsStatus({ type: 'none', text: 'Delete failed: ' + (json.error?.message || json.error || 'Unknown error') });
        setTimeout(() => setSmsStatus(null), 4000);
        await fetchData();
      } else {
        // Only remove from UI after confirmed success
        setWaitlists(prev => prev.filter(e => e.id !== entry.id));
        busEmit.screenShake('light');
        await fetchData();
        broadcastChange('waitlist');
      }
    } catch (err) { console.warn('Remove error:', err); setToast({ type: 'error', text: 'Action failed: Remove. Please try again.' }); await fetchData(); }
    finally { setActionLock(null); }
  };

  const handleCheckIn = async (entry) => {
    try {
const res = await commanderFetch(`/api/commander/waitlist/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked_in_at: new Date().toISOString() })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        setSmsStatus({ type: 'none', text: 'Check-in failed: ' + (json.error?.message || json.error || 'Unknown error') });
        setTimeout(() => setSmsStatus(null), 4000);
      } else {
        setSmsStatus({ type: 'sent', text: `${titleCase(entry.player_name)} checked in` });
        setTimeout(() => setSmsStatus(null), 3000);
      }
      setSelectedPlayer(null); await fetchData();
      broadcastChange('waitlist');
    } catch (err) { console.warn(err); setSmsStatus({ type: 'none', text: 'Check-in failed: network error' }); setTimeout(() => setSmsStatus(null), 4000); }
  };

  const handleAddWalkIn = async (playerData) => {
    // ── Hardening: Duplicate-name guard ——
    const nameNorm = (playerData.player_name || '').trim().toLowerCase();
    const duplicate = waitlists.find(w =>
      (w.status === 'waiting' || w.status === 'called') &&
      (w.player_name || '').trim().toLowerCase() === nameNorm
    );
    if (duplicate) {
      const proceed = confirm(`"${titleCase(playerData.player_name)}" is already on the waitlist for ${duplicate.game_type || 'a game'}. Add them again?`);
      if (!proceed) return;
    }
    try {
const staffData = getStaffData();
      const parts = (playerData.game_type || 'NLH 1/3').split(' ');
      const gameType = parts[0] || 'NLH';
      const stakes = parts.slice(1).join(' ') || '1/3';
      const res = await commanderFetch('/api/commander/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-idempotency-key': genIdempotencyKey() },
        body: JSON.stringify({
          venue_id: staffData.venue_id, player_name: playerData.player_name,
          game_type: gameType, stakes: stakes,
          player_phone: playerData.phone || null, signup_method: 'staff'
        })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setShowAddWalkIn(false);
        busEmit.waitlistPlayerAdded(playerData.player_name, `${gameType} ${stakes}`);
        setSmsStatus({ type: 'sent', text: `${titleCase(playerData.player_name)} added to waitlist` });
        setTimeout(() => setSmsStatus(null), 3000);
        await fetchData(); broadcastChange('waitlist');
      } else {
        setSmsStatus({ type: 'none', text: json.error?.message || json.error || 'Failed to add player' });
        setTimeout(() => setSmsStatus(null), 4000);
      }
    } catch (err) { console.warn(err); setSmsStatus({ type: 'none', text: 'Failed to add player: network error' }); setTimeout(() => setSmsStatus(null), 4000); }
  };

  // ── RENAME GAME: Batch-update all entries for old game to new name/stakes ──
  const handleRenameGame = async () => {
    if (!editGame) return;
    const { oldLabel, gameType, stakes } = editGame;
    const newGameType = (gameType || '').trim().toUpperCase();
    const newStakes = (stakes || '').trim();
    if (!newGameType || !newStakes) return;

    const oldParts = oldLabel.split(' ');
    const oldGameType = oldParts[0];
    const oldStakes = oldParts.slice(1).join(' ');

    // Skip if nothing changed
    if (newGameType === oldGameType && newStakes === oldStakes) {
      setEditGame(null);
      return;
    }

    try {
// Find all entries that match the old game/stakes
      const entriesToUpdate = waitlists.filter(w =>
        (w.game_type || '').toUpperCase() === oldGameType &&
        (w.stakes || '') === oldStakes &&
        (w.status === 'waiting' || w.status === 'called')
      );
      // Batch update each entry
      await Promise.all(entriesToUpdate.map(entry =>
        commanderFetch(`/api/commander/waitlist/${entry.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ game_type: newGameType, stakes: newStakes })
        }).then(r => { if (!r.ok) console.warn('err'); })
      ));
      setEditGame(null);
      await fetchData();
      broadcastChange('waitlist');
    } catch (err) { console.warn('Rename game error:', err); setToast({ type: 'error', text: 'Action failed: Rename game. Please try again.' }); }
  };

  // ── ADD GAME: Create a new game column (interest list) ──
  const handleAddGame = async () => {
    const gt = (newGameType || '').trim().toUpperCase();
    const st = (newGameStakes || '').trim();
    const tn = (newGameTable || '').trim();
    if (!gt || !st) return;
    const label = `${gt} ${st}`;
    // Add to customization gameTypes for persistence
    const updatedGameTypes = [...new Set([...(custom.gameTypes || []), label])];
    saveCustomization({ ...custom, gameTypes: updatedGameTypes });
    // Auto-create table if a table number was provided
    if (tn) {
      try {
const staffData = getStaffData();
        const r = await commanderFetch('/api/commander/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ venue_id: staffData.venue_id, table_number: parseInt(tn) || tn, table_name: `Table ${tn}`, max_seats: 9, game_type: gt, stakes: st })
        });
        if (!r.ok) console.warn('Auto table err');
      } catch { /* table may already exist — ignore */ }
      await fetchData();
    } else {
      await fetchData();
    }
    setNewGameType(''); setNewGameStakes(''); setNewGameTable(''); setShowAddGame(false);
    broadcastChange('waitlist');
  };

  // ── REMOVE GAME: Delete all waitlist entries for a game + remove from custom ──
  const handleRemoveGame = async (gameLabel) => {
    if (!confirm(`Remove "${gameLabel}" and all its waitlist entries?`)) return;
    try {
const parts = gameLabel.split(' ');
      const gameType = parts[0];
      const stakes = parts.slice(1).join(' ');
      // Delete all matching waitlist entries
      const entriesToDelete = waitlists.filter(w =>
        (w.game_type || '').toUpperCase() === gameType &&
        (w.stakes || '') === stakes &&
        (w.status === 'waiting' || w.status === 'called')
      );
      await Promise.all(entriesToDelete.map(entry =>
        commanderFetch(`/api/commander/waitlist/${entry.id}`, {
          method: 'DELETE'}).then(r => { if (!r.ok) throw new Error('Delete failed'); })
      ));
      // Remove from custom gameTypes
      const updatedGameTypes = (custom.gameTypes || []).filter(g => g !== gameLabel);
      saveCustomization({ ...custom, gameTypes: updatedGameTypes });
      setEditGame(null);
      await fetchData();
      broadcastChange('waitlist');
    } catch (err) { console.warn('Remove game error:', err); setToast({ type: 'error', text: 'Action failed: Remove game. Please try again.' }); }
  };

  // ── GROUP & SORT ────────────────────────────────────────────────
  const waitlistByGame = {};
  // First, seed with custom game types so empty columns persist
  if (custom.gameTypes && custom.gameTypes.length > 0) {
    custom.gameTypes.forEach(label => {
      if (!waitlistByGame[label]) waitlistByGame[label] = [];
    });
  }
  // Also seed from active tables — auto-sync with live floor
  tables.forEach(t => {
    // Skip inactive or maintenance tables
    if (t.is_active === false || t.status === 'maintenance') return;
    // Get game info from table directly OR from joined commander_games
    const games = Array.isArray(t.commander_games) ? t.commander_games : [];
    const activeGame = games.find(g => g.status !== 'closed') || games[0];
    const gameType = (t.game_type || activeGame?.game_type || '').toUpperCase();
    const stakes = (t.stakes || activeGame?.stakes || '').trim();
    if (!gameType) return; // No game assigned to this table
    const key = stakes ? `${gameType} ${stakes}` : gameType;
    if (!waitlistByGame[key]) waitlistByGame[key] = [];
  });
  waitlists.filter(w => w.status === 'waiting' || w.status === 'called').forEach(w => {
    const key = w.stakes ? `${(w.game_type || 'NLH').toUpperCase()} ${w.stakes}` : (w.game_type || 'Unknown').toUpperCase();
    if (!waitlistByGame[key]) waitlistByGame[key] = [];
    waitlistByGame[key].push(w);
  });
  Object.values(waitlistByGame || {}).forEach(entries => {
    entries.sort((a, b) => {
      if (a.status === 'called' && b.status !== 'called') return -1;
      if (b.status === 'called' && a.status !== 'called') return 1;
      // Sort by position first, then by created_at as tiebreaker
      const posA = a.position ?? 9999;
      const posB = b.position ?? 9999;
      if (posA !== posB) return posA - posB;
      return new Date(a.created_at) - new Date(b.created_at);
    });
  });

  const getTableNums = (gameLabel) => {
    const parts = gameLabel.split(' ');
    const gameType = parts[0];
    const stakes = parts.slice(1).join(' ');
    const cleanStakes = stakes.replace(/\$/g, '');
    const cleanLabel = gameLabel.replace(/\$/g, '');
    return tables
      .filter(t => {
        if (t.is_active === false || t.status === 'maintenance') return false;
        const games = Array.isArray(t.commander_games) ? t.commander_games : [];
        const activeGame = games.find(g => g.status !== 'closed') || games[0];
        const tGame = (t.game_type || activeGame?.game_type || '').toUpperCase();
        const tStakes = (t.stakes || activeGame?.stakes || '').trim();
        const cleanTStakes = tStakes.replace(/\$/g, '');
        if (tGame === gameType && cleanTStakes === cleanStakes) return true;
        if (tGame === gameType && !cleanTStakes && !cleanStakes) return true;
        return `${tGame} ${cleanTStakes}`.trim() === cleanLabel;
      })
      .map(t => t.table_number)
      .sort((a, b) => a - b);
  };

  const breakTables = tables
    .filter(t => t.status === 'break' || t.status === 'dealer_break')
    .map(t => t.table_number)
    .sort((a, b) => a - b);

  const activeTables = tables.filter(t => t.is_active !== false && t.status !== 'maintenance');
  const totalWaiting = waitlists.filter(w => w.status === 'waiting').length;
  const gameEntries = Object.entries(waitlistByGame || {});

  // ── PAGINATION ─────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(gameEntries.length / GAMES_PER_PAGE));
  const visibleGames = gameEntries.slice(
    currentPage * GAMES_PER_PAGE,
    (currentPage + 1) * GAMES_PER_PAGE
  );

  useEffect(() => {
    if (totalPages <= 1) return;
    // Freeze rotation while staff is interacting with a player
    if (selectedPlayer || seatModal || showAddWalkIn) return;
    const timer = setInterval(() => {
      setCurrentPage(prev => (prev + 1) % totalPages);
    }, ROTATE_INTERVAL);
    return () => clearInterval(timer);
  }, [totalPages, selectedPlayer, seatModal, showAddWalkIn]);

  useEffect(() => {
    if (currentPage >= totalPages) setCurrentPage(0);
  }, [totalPages, currentPage]);

  // Ticker
  const tickerParts = [];
  if (breakTables.length > 0) tickerParts.push(`BREAK ${breakTables.join('--')}`);
  if (custom.tickerMessage) tickerParts.push(custom.tickerMessage);
  else tickerParts.push('Download the Smarter Poker App for live waitlist updates');
  tickerParts.push(`${totalWaiting} players currently waiting`);
  // 2026-07-25 audit fix: build the non-breaking-space separator from a named
  // constant instead of inline unicode escape sequences. Identical output,
  // but keeps the source free of escapes that deploy tooling can mangle.
  const NBSP = String.fromCharCode(160);
  const tickerMessage = tickerParts.join(`   ${NBSP}${NBSP}${NBSP}-${NBSP}${NBSP}${NBSP}   `);

  // ── DYNAMIC STYLES ──────────────────────────────────────────────
  const c = custom;
  const headerGradient = `linear-gradient(180deg, ${lighten(c.headerColor, 15)}, ${c.headerColor}, ${darken(c.headerColor, 25)})`;
  const headerBorderBottom = `2px solid ${darken(c.headerColor, 30)}`;

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#18191A', padding: '16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ background: '#2A2B2C', height: 24, width: 200, borderRadius: 6, marginBottom: 16 }} />
          <SkeletonDark variant="stat-cards" count={3} />
          <div style={{ marginTop: 16 }}>
            <SkeletonDark variant="waitlist" rows={8} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <SEOHead title="The Board — Poker Waiting List" noindex={true} />
      <div style={{ minHeight: '100vh', background: c.bgColor, color: c.textColor, fontFamily: "var(--font-inter), 'Segoe UI', sans-serif", display: 'flex', flexDirection: 'column' }}>

        {/* ═══ TOP BAR ═══ */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: `2px solid ${c.borderColor}44`, background: c.cardBgColor }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto' }}>
            <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}>
              <ArrowLeft size={16} color={c.accentColor} />
            </button>
            {c.logoUrl && <img src={c.logoUrl} alt="" style={{ height: '64px', width: 'auto', borderRadius: '6px', objectFit: 'contain' }} loading="lazy" />}
            <span style={{ fontSize: '22px', fontWeight: 700, color: c.accentColor, letterSpacing: '0.5px', textTransform: 'uppercase', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {venueName || 'Poker Room'}
            </span>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <span style={{ fontSize: '36px', fontWeight: 800, color: c.accentColor, letterSpacing: '4px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              POKER WAITING LIST
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: '0 0 auto' }}>
            <span style={{ fontSize: '13px', color: `${c.textColor}88`, textAlign: 'right', lineHeight: '1.3', letterSpacing: '0.3px', textTransform: 'uppercase' }}>
              Powered By<br /><strong>Club Commander</strong>
            </span>
          </div>
        </div>

        {/* ═══ CONTROLS BAR ═══ */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 16px', borderBottom: `1px solid ${c.borderColor}33`, background: c.cardBgColor }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '18px', color: `${c.textColor}88`, fontWeight: 600 }}>
              {totalWaiting} waiting &bull; {gameEntries.length} game{gameEntries.length !== 1 ? 's' : ''}
            </span>
            <Pagination
              currentPage={currentPage + 1}
              totalPages={totalPages}
              onPageChange={(p) => setCurrentPage(p - 1)}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setShowAddWalkIn(true)} style={makeBtn(c)}>
              <UserPlus size={18} /> Add Player
            </button>
            <button onClick={() => setShowAddGame(true)} style={{ ...makeBtn(c), background: `${c.accentColor}22`, border: `1px solid ${c.accentColor}`, color: c.accentColor }}>
              <Plus size={18} /> Add Game
            </button>
            <button onClick={() => setShowSettings(true)} style={makeBtn(c)} title="Customize Desk">
              <Settings size={18} />
            </button>
          </div>
        </div>

        {/* ═══ SMS TOAST ═══ */}
        {smsStatus && (
          <div style={{ margin: '6px 16px 0', padding: '6px 12px', fontSize: '12px', fontWeight: 600, color: c.accentColor, background: c.cardBgColor, border: `1px solid ${c.borderColor}55`, borderRadius: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {smsStatus.type === 'sent' ? <MessageSquare size={14} /> : <Phone size={14} />}
            {smsStatus.text}
          </div>
        )}

        {/* ═══ BRAVO GRID ═══ */}
        {gameEntries.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px' }}>
            <Users size={40} color={`${c.textColor}33`} />
            <p style={{ color: `${c.textColor}66`, marginTop: '12px', fontSize: '16px' }}>No Games — Tap "Add Game" To Create An Interest List</p>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', padding: '12px 16px', gap: '2px', alignItems: 'stretch' }}>
            {visibleGames.map(([gameLabel, entries]) => {
              const tableNums = getTableNums(gameLabel);

              // ── Find must-move chain for this game ──
              const mmGroups = mustMoveData?.must_move_groups || [];
              const glParts = gameLabel.split(' ');
              const colGameType = glParts[0].toLowerCase();
              const colStakes = glParts.slice(1).join(' ');
              const mmGroup = mmGroups.find(g => {
                const gt = (g.game_type || '').toLowerCase();
                const st = (g.stakes || '').trim();
                return gt === colGameType && st === colStakes;
              });
              // Build must-move tables from the chain (skip index 0 = main game)
              const chain = mmGroup?.chain || [];
              const mmTables = chain.filter((g, i) => i > 0 && g.is_must_move && (g.seats || []).length > 0);

              // Calculate column width — shrink to fit must-move columns
              const totalCols = 1 + mmTables.length; // game col + must-move cols
              const baseWidth = totalCols > 1 ? `calc(25% - 2px)` : `calc(25% - 2px)`;

              return (
                <div key={gameLabel} style={{ display: 'flex', gap: '2px', flex: mmTables.length > 0 ? `0 0 calc(${25 * (1 + mmTables.length * 0.6)}% - 2px)` : '0 0 calc(25% - 2px)', maxWidth: mmTables.length > 0 ? `calc(${25 * (1 + mmTables.length * 0.6)}% - 2px)` : 'calc(25% - 2px)', minWidth: '140px' }}>
                  {/* ═══ WAITLIST COLUMN ═══ */}
                  <div style={{ flex: '1 1 0', minWidth: '140px', border: `3px solid ${c.borderColor}`, borderRadius: '4px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* Header — Click to edit game name/stakes */}
                    <div
                      onClick={() => {
                        const parts = gameLabel.split(' ');
                        setEditGame({ oldLabel: gameLabel, gameType: parts[0], stakes: parts.slice(1).join(' ') });
                      }}
                      style={{ padding: '14px 10px', textAlign: 'center', fontWeight: 800, fontSize: '26px', color: '#fff', textTransform: 'uppercase', letterSpacing: '1px', background: headerGradient, textShadow: '0 2px 4px rgba(0,0,0,0.5)', borderBottom: headerBorderBottom, cursor: 'pointer', position: 'relative' }}
                      title="Click to edit game name & stakes"
                    >
                      {gameLabel}
                    </div>
                    {/* Table Numbers with Main/Feeder labels */}
                    <div style={{ padding: '4px 8px', textAlign: 'center', fontSize: '14px', color: `${c.textColor}99`, borderBottom: `1px solid ${c.borderColor}55`, background: c.cardBgColor, fontWeight: 600, letterSpacing: '0.5px' }}>
                      {tableNums.length > 0 ? tableNums.map((tn, i) => (
                        <span key={tn}>
                          {i > 0 && ' · '}
                          <span style={{ color: i === 0 ? c.accentColor : `${c.textColor}77` }}>
                            T{tn}{tableNums.length > 1 ? (i === 0 ? ' ★' : ' ⇢') : ''}
                          </span>
                        </span>
                      )) : '—'}
                    </div>
                    {/* Player Names */}
                    <div style={{ flex: 1, background: c.bgColor }}>
                      {entries.map((entry) => {
                        const isCalled = entry.status === 'called';
                        const isSelected = selectedPlayer?.id === entry.id;
                        const hasApp = entry.signup_method === 'app';
                        const isWeb = entry.signup_method === 'web';
                        const isCheckedIn = !!entry.checked_in_at;
                        // Calculate web check-in countdown (1 hour from creation)
                        const webMinutesLeft = isWeb && !isCheckedIn && entry.created_at
                          ? Math.max(0, Math.ceil((new Date(entry.created_at).getTime() + 60 * 60 * 1000 - Date.now()) / 60000))
                          : null;
                        const isExpired = webMinutesLeft !== null && webMinutesLeft <= 0;
                        // Calculate texted countdown (10 min from last_called_at)
                        const calledMinutesLeft = isCalled && entry.last_called_at
                          ? Math.max(0, Math.ceil((new Date(entry.last_called_at).getTime() + CALL_EXPIRY_MINUTES * 60 * 1000 - Date.now()) / 60000))
                          : null;
                        return (
                          <div key={entry.id}>
                            <div
                              onClick={() => setSelectedPlayer(isSelected ? null : entry)}
                              style={{
                                padding: '8px 12px', borderBottom: `1px solid ${c.bgColor === '#000000' ? '#1a1a1a' : c.borderColor + '22'}`,
                                cursor: 'pointer', display: 'flex', alignItems: 'center',
                                justifyContent: 'space-between', transition: 'background-color 0.1s',
                                backgroundColor: isCalled ? `${c.accentColor}14` : isExpired ? 'rgba(239,68,68,0.08)' : isSelected ? 'rgba(255,255,255,0.04)' : 'transparent'
                              }}
                            >
                              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                {hasApp && <span style={{ color: c.accentColor, fontSize: '16px' }}>♦</span>}
                                {isWeb && !isCheckedIn && (
                                  <span style={{ fontSize: '11px', fontWeight: 800, color: '#fff', background: isExpired ? '#EF4444' : '#3B82F6', padding: '1px 5px', borderRadius: '3px', letterSpacing: '0.5px', lineHeight: '16px' }}>
                                    {isExpired ? '⚠ EXPIRED' : 'WEB'}
                                  </span>
                                )}
                                {isWeb && isCheckedIn && (
                                  <CheckCircle size={14} style={{ color: '#10B981' }} />
                                )}
                                <span style={{ fontSize: `${c.playerFontSize}px`, fontWeight: 700, letterSpacing: '0.3px', color: isCalled ? c.accentColor : isExpired ? '#EF4444' : c.textColor }}>
                                  {titleCase(entry.player_name)}
                                </span>
                                {isWeb && !isCheckedIn && webMinutesLeft !== null && !isExpired && (
                                  <span style={{ fontSize: '12px', color: webMinutesLeft <= 10 ? '#F59E0B' : '#64748B', fontWeight: 600 }}>
                                    {webMinutesLeft}m
                                  </span>
                                )}
                              </span>
                              {isCalled && (
                                <span style={{ fontSize: '12px', fontWeight: 800, color: c.bgColor, background: calledMinutesLeft !== null && calledMinutesLeft <= 3 ? '#EF4444' : c.accentColor, padding: '2px 6px', borderRadius: '3px', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  TEXTED{calledMinutesLeft !== null ? ` ${calledMinutesLeft}m` : ''}
                                </span>
                              )}
                            </div>

                            {isSelected && (
                              <div style={{ display: 'flex', padding: '8px 12px', gap: '8px', background: `linear-gradient(180deg, ${lighten(c.cardBgColor, 5)}, ${c.cardBgColor})`, borderBottom: `2px solid ${c.borderColor}55`, flexWrap: 'wrap' }}>
                                {isWeb && !isCheckedIn && (
                                  <button onClick={(e) => { e.stopPropagation(); handleCheckIn(entry); }} style={makeActionBtnGreen(c)}>
                                    <CheckCircle size={18} /> Check In
                                  </button>
                                )}
                                {entry.status !== 'called' && (
                                  <button onClick={(e) => { e.stopPropagation(); handleCall(entry); }}
                                    disabled={callLoading === entry.id} style={makeActionBtn(c)}>
                                    {callLoading === entry.id ? <Loader2 size={18} className="animate-spin" /> : <PhoneCall size={18} />}
                                    Text
                                  </button>
                                )}
                                <button onClick={(e) => { e.stopPropagation(); setSeatModal(entry); }} style={makeActionBtnGreen(c)}>
                                  <Armchair size={18} /> Seat
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); handlePass(entry); }} style={makeActionBtn(c)}>
                                  <SkipForward size={18} /> Pass
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); handleRemove(entry); }} style={makeActionBtnRed(c)}>
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Join Wait List Button */}
                    <div style={{ padding: '8px', background: c.cardBgColor, borderTop: `1px solid ${c.borderColor}44`, marginTop: 'auto' }}>
                      <button
                        onClick={() => {
                          setAddGameType(gameLabel);
                          setShowAddWalkIn(true);
                        }}
                        style={{
                          width: '100%', padding: '12px 8px', fontSize: '16px', fontWeight: 800,
                          letterSpacing: '1px', textTransform: 'uppercase',
                          background: `linear-gradient(180deg, ${lighten(c.headerColor, 15)}, ${c.headerColor})`,
                          border: `2px solid ${c.accentColor}`,
                          borderRadius: '6px', color: '#fff', cursor: 'pointer',
                          boxShadow: `0 2px 8px ${c.accentColor}33, inset 0 1px 0 rgba(255,255,255,0.15)`,
                          textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
                      >
                        Join Wait List
                      </button>
                    </div>
                  </div>

                  {/* ═══ MUST-MOVE COLUMNS — Separate columns next to the game ═══ */}
                  {mmTables.map(mmGame => {
                    const seats = mmGame.seats || [];
                    const targetGame = chain.find(g => g.id === mmGame.move_target_game_id) || chain[0];
                    const targetOpenSeats = targetGame ? (targetGame.max_seats - targetGame.player_count) : 0;
                    const canMove = targetOpenSeats > 0 && seats.length > 0;
                    const nextPlayer = seats[0] || null;
                    const mmTimeAgo = (dateStr) => {
                      if (!dateStr) return '';
                      const diff = Date.now() - new Date(dateStr).getTime();
                      const mins = Math.floor(diff / 60000);
                      if (mins < 60) return `${mins}m`;
                      return `${Math.floor(mins / 60)}h ${mins % 60}m`;
                    };

                    return (
                      <div key={`mm-${mmGame.id}`} style={{
                        flex: '0 0 180px', minWidth: '140px',
                        border: `3px solid ${c.accentColor}44`,
                        borderRadius: '4px',
                        display: 'flex', flexDirection: 'column', overflow: 'hidden',
                        background: c.bgColor }}>
                        {/* Must-Move Header */}
                        <div style={{
                          padding: '10px 8px', textAlign: 'center',
                          background: `linear-gradient(180deg, ${c.accentColor}25, ${c.accentColor}10)`,
                          borderBottom: `2px solid ${c.accentColor}33` }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', marginBottom: '2px' }}>
                            <ArrowRightLeft size={14} color={c.accentColor} />
                            <span style={{ fontSize: '13px', fontWeight: 800, color: c.accentColor, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                              Must Move List
                            </span>
                          </div>
                          <div style={{ fontSize: '11px', color: `${c.textColor}77`, fontWeight: 600 }}>
                            T{mmGame.table_number} → T{targetGame?.table_number || '?'}
                          </div>
                        </div>

                        {/* Player Queue (FIFO ordered) */}
                        <div style={{ flex: 1, overflow: 'auto' }}>
                          {seats.map((seat, idx) => {
                            const isNext = idx === 0;
                            return (
                              <div key={seat.id} style={{
                                padding: '6px 8px', display: 'flex', alignItems: 'center', gap: '6px',
                                borderBottom: `1px solid ${c.bgColor === '#000000' ? '#1a1a1a' : c.borderColor + '22'}`,
                                background: isNext ? `${c.accentColor}12` : 'transparent' }}>
                                <span style={{
                                  width: '20px', height: '20px', borderRadius: '4px', flexShrink: 0,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: '10px', fontWeight: 800,
                                  background: isNext ? c.accentColor : `${c.textColor}15`,
                                  color: isNext ? c.bgColor : `${c.textColor}66` }}>
                                  {idx + 1}
                                </span>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{
                                    fontSize: `${Math.max(14, c.playerFontSize - 8)}px`,
                                    fontWeight: isNext ? 700 : 500,
                                    color: isNext ? c.accentColor : `${c.textColor}99`,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                                    {titleCase(seat.player_name || 'Unknown')}
                                  </span>
                                  {seat.seated_at && (
                                    <span style={{ fontSize: '10px', color: `${c.textColor}44` }}>
                                      {mmTimeAgo(seat.seated_at)}
                                    </span>
                                  )}
                                </span>
                                {isNext && (
                                  <span style={{
                                    padding: '2px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: 800,
                                    letterSpacing: '0.5px', flexShrink: 0,
                                    background: canMove ? c.accentColor : '#EF4444',
                                    color: canMove ? c.bgColor : '#fff' }}>
                                    {canMove ? 'NEXT' : 'FULL'}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Move button */}
                        {canMove && nextPlayer && (
                          <div style={{ padding: '6px 8px', borderTop: `1px solid ${c.accentColor}22` }}>
                            <button
                              disabled={moveLoading === mmGame.id}
                              onClick={async () => {
                                setMoveLoading(mmGame.id);
                                try {
const res = await commanderFetch('/api/commander/games/must-move-status', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ must_move_game_id: mmGame.id, target_game_id: targetGame.id })
                                  });
                                  if (!res.ok) throw new Error(`Request failed (${res.status})`);
                                  const json = await res.json();
                                  if (json.success) {
                                    setSmsStatus({ type: 'sent', text: json.data.message });
                                    setTimeout(() => setSmsStatus(null), 4000);
                                    await fetchData();
                                    broadcastChange('games');
                                  } else {
                                    setSmsStatus({ type: 'none', text: json.error || 'Move failed' });
                                    setTimeout(() => setSmsStatus(null), 4000);
                                  }
                                } catch { setSmsStatus({ type: 'none', text: 'Network error' }); setTimeout(() => setSmsStatus(null), 4000); }
                                finally { setMoveLoading(null); }
                              }}
                              style={{
                                width: '100%', padding: '7px 6px', fontSize: '11px', fontWeight: 800,
                                letterSpacing: '0.3px', textTransform: 'uppercase',
                                background: `linear-gradient(180deg, ${lighten(c.headerColor, 10)}, ${darken(c.headerColor, 10)})`,
                                border: `1px solid ${c.accentColor}`, borderRadius: '4px',
                                color: '#fff', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                                opacity: moveLoading === mmGame.id ? 0.6 : 1 }}
                            >
                              {moveLoading === mmGame.id
                                ? <Loader2 size={12} className="animate-spin" />
                                : <ArrowRight size={12} />}
                              Move → T{targetGame?.table_number}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                </div>
              );
            })}
          </div>
        )}

        {/* ═══ PAGE DOTS ═══ */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', padding: '6px 0', background: c.cardBgColor }}>
            {Array.from({ length: totalPages }, (_, i) => (
              <span
                key={i}
                onClick={() => setCurrentPage(i)}
                style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  cursor: 'pointer', transition: 'all 0.2s',
                  background: i === currentPage ? c.accentColor : `${c.textColor}33`,
                  transform: i === currentPage ? 'scale(1.3)' : 'scale(1)'
                }}
              />
            ))}
          </div>
        )}

        {/* ═══ SCROLLING TICKER ═══ */}
        <div style={{ padding: '18px 0', borderTop: `2px solid ${c.borderColor}55`, background: c.cardBgColor, overflow: 'hidden', whiteSpace: 'nowrap', position: 'relative' }}>
          <div style={{ display: 'inline-flex', animation: 'tickerScroll 30s linear infinite' }}>
            <span style={{ fontSize: '39px', color: c.accentColor, fontWeight: 700, letterSpacing: '1px', paddingRight: '150px', whiteSpace: 'nowrap' }}>{tickerMessage}</span>
            <span style={{ fontSize: '39px', color: c.accentColor, fontWeight: 700, letterSpacing: '1px', paddingRight: '150px', whiteSpace: 'nowrap' }}>{tickerMessage}</span>
          </div>
        </div>

        {/* ═══ DEALER PUSH & BREAK TICKER ═══ */}
        <DealerTicker
          accentColor={c.accentColor}
          bgColor={c.cardBgColor}
          fontSize={24}
          borderColor={c.borderColor}
          speed={20}
          showBorder={true}
        />

        {/* ═══ SEAT MODAL — Oval Poker Table Visual ═══ */}
        {seatModal && (() => {
          // Filter tables to match the player's game type
          const seatGameType = (seatModal.game_type || '').toUpperCase();
          const seatStakes = (seatModal.stakes || '').trim();
          const matchingTables = activeTables.filter(t => {
            const tGame = (t.game_type || t.current_game_type || '').toUpperCase();
            const tStakes = (t.stakes || t.current_stakes || '').trim();
            return tGame === seatGameType && tStakes === seatStakes;
          });
          const tablesToShow = matchingTables.length > 0 ? matchingTables : activeTables;
          const tablesWithOpen = tablesToShow.filter(t => {
            const seated = (t.seats || []).filter(s => s.status === 'occupied').length;
            return seated < (t.max_seats || 9);
          });

          // Arc-length parameterized ellipse for equal visual spacing (same as Club Arena)
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
          const allPos = [];
          for (let p = 0; p < 10; p++) {
            const target = (p / 10) * totalArc;
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

          return (
            <div style={overlayStyle} onClick={() => setSeatModal(null)}>
              <div style={{ ...modalStyle(c), maxWidth: '700px', padding: '20px' }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <h3 style={{ fontSize: '18px', fontWeight: 700, color: c.accentColor, margin: 0 }}>Seat Player</h3>
                    <p style={{ fontSize: '14px', color: `${c.textColor}88`, margin: '2px 0 0' }}>
                      {titleCase(seatModal.player_name)} — {seatStakes} {seatGameType}
                    </p>
                  </div>
                  <button onClick={() => setSeatModal(null)} style={modalCloseStyle(c)}><X size={14} /></button>
                </div>
                <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                  {tablesWithOpen.length === 0 ? (
                    <p style={{ color: `${c.textColor}66`, textAlign: 'center', padding: '24px', fontSize: '14px' }}>No tables with open seats for {seatStakes} {seatGameType}</p>
                  ) : tablesWithOpen.map((table, tIdx) => {
                    const maxSeats = table.max_seats || 9;
                    const seats = table.seats || [];
                    const isMain = tIdx === 0 && tablesWithOpen.length > 1;
                    const isFeeder = tIdx > 0 && tablesWithOpen.length > 1;
                    const tGame = (table.game_type || table.current_game_type || '').toUpperCase();
                    const tStakes = (table.stakes || table.current_stakes || '').trim();
                    const occupiedCount = seats.filter(s => s.status === 'occupied').length;
                    const openCount = maxSeats - occupiedCount;
                    const seatArr = Array.from({ length: maxSeats }, (_, i) => {
                      const taken = seats.find(s => s.seat_number === i + 1 && s.status === 'occupied');
                      return { number: i + 1, taken };
                    });

                    return (
                      <div key={table.table_number} style={{ background: '#0a0f1a', borderRadius: '12px', border: `1px solid ${c.borderColor}`, marginBottom: '12px', overflow: 'hidden' }}>
                        {/* Table Header */}
                        <div style={{ padding: '10px 16px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: '15px', fontWeight: 800 }}>Table {table.table_number}</div>
                            <div style={{ fontSize: '12px', opacity: 0.9 }}>{tGame} · {tStakes} · {maxSeats}-max</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            {isMain && <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.25)', marginRight: 6 }}>MAIN</span>}
                            {isFeeder && <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', marginRight: 6 }}>FEEDER</span>}
                            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>
                              {occupiedCount}/{maxSeats} seated
                              {openCount > 0 && <span style={{ color: '#86efac', marginLeft: 4 }}>({openCount} open)</span>}
                            </div>
                          </div>
                        </div>

                        {/* Oval Poker Table */}
                        <div style={{ position: 'relative', width: '100%', aspectRatio: '5 / 3' }}>
                          <Image src="/images/poker-table-black-gold.png" alt="Poker Table" width={640} height={640} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', zIndex: 0 }} />

                          {/* Center Info */}
                          <div style={{ position: 'absolute', top: '48%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 5, textAlign: 'center' }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>
                              Table {table.table_number}
                            </div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: 1 }}>
                              {tStakes} {tGame}
                            </div>
                            <div style={{ fontSize: 12, color: '#4CAF50', marginTop: 6, fontWeight: 700 }}>
                              TAP OPEN SEAT TO ASSIGN
                            </div>
                          </div>

                          {/* Dealer */}
                          <div style={{ position: 'absolute', top: dealerPos.top, left: dealerPos.left, transform: 'translate(-50%, -50%)', textAlign: 'center', width: 70, zIndex: 3 }}>
                            <div style={{ width: 50, height: 50, borderRadius: '50%', margin: '0 auto 2px', background: 'linear-gradient(135deg, #1877F2 0%, #1565c0 100%)', border: '2px solid #E4E6EB', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.6)', fontSize: 22, fontWeight: 900, color: '#fff' }}>D</div>
                          </div>

                          {/* Player Seats */}
                          {seatArr.slice(0, seatPositions.length).map((seat, idx) => {
                            const pos = seatPositions[idx];
                            const isOccupied = !!seat.taken;
                            const firstName = seat.taken?.player_name?.split(' ')[0] || '';
                            const initial = firstName ? firstName[0].toUpperCase() : '';
                            const leftPct = parseFloat(pos.left);
                            const isLeftSide = leftPct < 25;
                            const isRightSide = leftPct > 75;
                            const badgeTransform = isLeftSide
                              ? 'translate(-14px, -50%)'
                              : isRightSide
                                ? 'translate(calc(-100% + 14px), -50%)'
                                : 'translate(-50%, -50%)';
                            const badgeDirection = isRightSide ? 'row-reverse' : 'row';

                            if (isOccupied) {
                              return (
                                <div key={seat.number} style={{
                                  position: 'absolute', top: pos.top, left: pos.left,
                                  transform: badgeTransform, zIndex: 2,
                                  display: 'flex', flexDirection: badgeDirection, alignItems: 'center', gap: 6,
                                  background: 'rgba(36,37,38,0.9)', borderRadius: 12,
                                  padding: '4px 10px 4px 4px',
                                  border: '2px solid rgba(24,119,242,0.5)',
                                  backdropFilter: 'blur(6px)', minWidth: 60 }}>
                                  <div style={{
                                    width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                                    background: 'linear-gradient(135deg, #1877F2, #1565c0)',
                                    border: '2px solid rgba(24,119,242,0.6)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 18, fontWeight: 800, color: '#fff' }}>{initial}</div>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: '#E4E6EB', maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {firstName}
                                  </div>
                                </div>
                              );
                            }

                            // Open seat — clickable to assign player
                            return (
                              <button key={seat.number} onClick={() => handleSeat(seatModal, table.table_number, seat.number)} style={{
                                position: 'absolute', top: pos.top, left: pos.left,
                                transform: badgeTransform, zIndex: 2,
                                display: 'flex', flexDirection: badgeDirection, alignItems: 'center', gap: 6,
                                background: 'rgba(36,37,38,0.7)', borderRadius: 12,
                                padding: '4px 10px 4px 4px',
                                border: '2px solid rgba(76,175,80,0.5)',
                                backdropFilter: 'blur(6px)', minWidth: 60,
                                cursor: 'pointer', transition: 'all 0.2s' }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(76,175,80,0.2)'; e.currentTarget.style.borderColor = '#4CAF50'; e.currentTarget.style.boxShadow = '0 0 12px rgba(76,175,80,0.5)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(36,37,38,0.7)'; e.currentTarget.style.borderColor = 'rgba(76,175,80,0.5)'; e.currentTarget.style.boxShadow = 'none'; }}
                              >
                                <div style={{
                                  width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                                  background: 'rgba(76,175,80,0.15)',
                                  border: '2px solid rgba(76,175,80,0.4)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 16, fontWeight: 800, color: '#4CAF50' }}>{seat.number}</div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: '#4CAF50', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                  Open
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ═══ ADD PLAYER MODAL ═══ */}
        {showAddWalkIn && (
          <div style={overlayStyle} onClick={() => setShowAddWalkIn(false)}>
            <div style={modalStyle(c)} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: c.accentColor, margin: 0 }}>Add Player To Waitlist</h3>
                <button onClick={() => setShowAddWalkIn(false)} style={modalCloseStyle(c)}><X size={14} /></button>
              </div>
              <WalkInForm onSubmit={handleAddWalkIn} activeTables={activeTables} custom={custom} defaultGame={addGameType} />
            </div>
          </div>
        )}

        {/* ═══ EDIT GAME MODAL ═══ */}
        {editGame && (
          <div onClick={() => setEditGame(null)} style={overlayStyle}>
            <div onClick={e => e.stopPropagation()} style={{ ...modalStyle(c), maxWidth: '400px' }}>
              <button onClick={() => setEditGame(null)} style={modalCloseStyle(c)}><X size={16} /></button>
              <h3 style={{ fontSize: '20px', fontWeight: 700, color: c.accentColor, marginBottom: '16px', textAlign: 'center' }}>Edit Game</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '13px', color: `${c.textColor}88`, marginBottom: '4px', display: 'block' }}>Game Type</label>
                  <input
                    value={editGame.gameType}
                    onChange={e => setEditGame(prev => ({ ...prev, gameType: e.target.value }))}
                    placeholder="NLH, PLO, etc."
                    style={{ ...formInputStyle(c), textTransform: 'uppercase' }}
                    autoFocus
                  />
                </div>
                <div>
                  <label style={{ fontSize: '13px', color: `${c.textColor}88`, marginBottom: '4px', display: 'block' }}>Stakes</label>
                  <input
                    value={editGame.stakes}
                    onChange={e => setEditGame(prev => ({ ...prev, stakes: e.target.value }))}
                    placeholder="$1/$2, $2/$5, etc."
                    style={formInputStyle(c)}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button onClick={() => setEditGame(null)} style={{ ...makeBtn(c), flex: 1, background: `${c.textColor}22`, color: c.textColor }}>Cancel</button>
                  <button onClick={handleRenameGame} style={{ ...makeBtn(c), flex: 1, background: c.accentColor, color: '#000', fontWeight: 700 }}>Save</button>
                </div>
                <button
                  onClick={() => handleRemoveGame(editGame.oldLabel)}
                  style={{ ...makeBtn(c), width: '100%', background: 'rgba(239,68,68,0.15)', border: '1px solid #EF4444', color: '#EF4444', fontWeight: 700, marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  <Trash size={16} /> Remove This Game
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ ADD GAME MODAL ═══ */}
        {showAddGame && (
          <div onClick={() => setShowAddGame(false)} style={overlayStyle}>
            <div onClick={e => e.stopPropagation()} style={{ ...modalStyle(c), maxWidth: '400px' }}>
              <button onClick={() => setShowAddGame(false)} style={modalCloseStyle(c)}><X size={16} /></button>
              <h3 style={{ fontSize: '20px', fontWeight: 700, color: c.accentColor, marginBottom: '16px', textAlign: 'center' }}>Add Game / Interest List</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '13px', color: `${c.textColor}88`, marginBottom: '4px', display: 'block' }}>Game Type</label>
                  <input
                    value={newGameType}
                    onChange={e => setNewGameType(e.target.value)}
                    placeholder="NLH, PLO, etc."
                    style={{ ...formInputStyle(c), textTransform: 'uppercase' }}
                    autoFocus
                  />
                </div>
                <div>
                  <label style={{ fontSize: '13px', color: `${c.textColor}88`, marginBottom: '4px', display: 'block' }}>Stakes</label>
                  <input
                    value={newGameStakes}
                    onChange={e => setNewGameStakes(e.target.value)}
                    placeholder="$1/$2, $2/$5, etc."
                    style={formInputStyle(c)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '13px', color: `${c.textColor}88`, marginBottom: '4px', display: 'block' }}>Table Number</label>
                  <input
                    value={newGameTable}
                    onChange={e => setNewGameTable(e.target.value)}
                    placeholder="1, 2, 3... (assigns table)"
                    type="number"
                    min="1"
                    style={formInputStyle(c)}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button onClick={() => setShowAddGame(false)} style={{ ...makeBtn(c), flex: 1, background: `${c.textColor}22`, color: c.textColor }}>Cancel</button>
                  <button onClick={handleAddGame} disabled={!newGameType.trim() || !newGameStakes.trim()} style={{ ...makeBtn(c), flex: 1, background: c.accentColor, color: '#000', fontWeight: 700, opacity: (!newGameType.trim() || !newGameStakes.trim()) ? 0.5 : 1 }}>Add Game</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ SETTINGS MODAL ═══ */}
        {showSettings && (
          <DeskSettingsModal
            custom={custom}
            onSave={(newCustom) => { saveCustomization(newCustom); setShowSettings(false); }}
            onClose={() => setShowSettings(false)}
            onUpdate={setCustom}
          />
        )}
      </div>

      {/* TOAST — error feedback for action handlers (2026-08-04 audit fix) */}
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

      <style>{`
        @keyframes tickerScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </>
  );
}

// ── WALK-IN FORM ──────────────────────────────────────────────────
function WalkInForm({ onSubmit, activeTables, custom: c, defaultGame }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gameType, setGameType] = useState(defaultGame || 'NLH 1/3');
  const [submitting, setSubmitting] = useState(false);

  let gameTypes = [...new Set(activeTables.map(t => t.game_type).filter(Boolean))];
  // Merge custom game types
  if (c.gameTypes && c.gameTypes.length > 0) {
    gameTypes = [...new Set([...c.gameTypes, ...gameTypes])];
  }
  if (gameTypes.length === 0) gameTypes.push('NLH 1/3', 'NLH 2/5', 'PLO 1/3');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    await onSubmit({ player_name: name.trim(), phone: phone.trim(), game_type: gameType });
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: c.textColor, marginBottom: '4px' }}>Player Name *</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g., Mike S." autoFocus required style={formInputStyle(c)} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: c.textColor, marginBottom: '4px' }}>Phone <span style={{ color: `${c.textColor}55` }}>(for SMS)</span></label>
        <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
          placeholder="(555) 123-4567" style={formInputStyle(c)} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: c.textColor, marginBottom: '4px' }}>Game</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {gameTypes.map(g => (
            <button key={g} type="button" onClick={() => setGameType(g)}
              style={{
                padding: '6px 14px', borderRadius: '4px', border: `1px solid ${c.borderColor}`,
                fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                background: gameType === g ? c.accentColor : c.cardBgColor,
                color: gameType === g ? '#000' : c.textColor
              }}>{g}</button>
          ))}
        </div>
      </div>
      <button type="submit" disabled={!name.trim() || submitting} style={{
        width: '100%', height: '40px', background: c.accentColor, color: '#000',
        borderRadius: '4px', border: 'none', fontWeight: 700, fontSize: '14px', cursor: 'pointer'
      }}>
        {submitting ? 'Adding...' : 'Add to Waitlist'}
      </button>
    </form>
  );
}

// ══════════════════════════════════════════════════════════════════
// ⚙️ DESK SETTINGS MODAL
// ══════════════════════════════════════════════════════════════════
function DeskSettingsModal({ custom, onSave, onClose, onUpdate }) {
  const [draft, setDraft] = useState({ ...DEFAULT_CUSTOM, ...custom });
  const [activeTab, setActiveTab] = useState('colors');
  const [newGame, setNewGame] = useState('');
  const [uploading, setUploading] = useState(false);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const logoInputRef = useRef(null);

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'logos');
      formData.append('prefix', 'waitlist-desk');
      const { data: { session: _deskSess } } = await supabase.auth.getSession();
      const res = await fetch('/api/social/upload', {
        method: 'POST',
        headers: _deskSess?.access_token ? { Authorization: `Bearer ${_deskSess.access_token}` } : {},
        body: formData });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success && json.url) {
        update('logoUrl', json.url);
      } else {
        setToast({ type: 'error', text: 'Upload failed: ' + (json.error || 'Unknown error') });
      }
    } catch (err) {
      console.warn('Logo upload error:', err);
      setToast({ type: 'error', text: 'Upload failed' });
    }
    setUploading(false);
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const update = (field, value) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    onUpdate(next); // live preview
  };

  const tabs = [
    { id: 'colors', label: 'Colors' },
    { id: 'branding', label: 'Logo & Branding' },
    { id: 'games', label: 'Game Types' },
  ];

  const colorFields = [
    { key: 'headerColor', label: 'Column Header' },
    { key: 'accentColor', label: 'Accent / Gold' },
    { key: 'bgColor', label: 'Background' },
    { key: 'cardBgColor', label: 'Bar Background' },
    { key: 'textColor', label: 'Player Text' },
    { key: 'borderColor', label: 'Borders' },
  ];

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ background: '#111', border: '1px solid #444', borderRadius: '12px', width: '100%', maxWidth: '520px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Settings size={20} color="#D4AF37" />
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#fff' }}>Desk Customization</h3>
          </div>
          <button onClick={onClose} style={{ width: '32px', height: '32px', borderRadius: '6px', background: '#222', border: '1px solid #444', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#888' }}>
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #333', background: '#0a0a0a' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{
                flex: 1, padding: '10px 8px', background: 'transparent', border: 'none',
                borderBottom: activeTab === t.id ? '2px solid #D4AF37' : '2px solid transparent',
                color: activeTab === t.id ? '#D4AF37' : '#888', fontSize: '13px',
                fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s'
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {activeTab === 'colors' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {colorFields.map(cf => (
                <div key={cf.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '14px', fontWeight: 600, color: '#ccc' }}>{cf.label}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="color"
                      value={draft[cf.key]}
                      onChange={e => update(cf.key, e.target.value)}
                      style={{ width: '44px', height: '36px', border: '2px solid #444', borderRadius: '6px', cursor: 'pointer', background: '#111', padding: '2px' }}
                    />
                    <input
                      type="text"
                      value={draft[cf.key]}
                      onChange={e => update(cf.key, e.target.value)}
                      style={{ width: '90px', padding: '6px 8px', background: '#1a1a1a', border: '1px solid #444', borderRadius: '4px', color: '#fff', fontSize: '13px', fontFamily: 'monospace' }}
                    />
                  </div>
                </div>
              ))}
              <button onClick={() => {
                setDraft({ ...draft, ...DEFAULT_CUSTOM });
                onUpdate({ ...draft, ...DEFAULT_CUSTOM });
              }} style={{ marginTop: '8px', padding: '8px 16px', background: '#222', border: '1px solid #444', borderRadius: '6px', color: '#888', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                Reset to Defaults
              </button>
            </div>
          )}

          {activeTab === 'branding' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#ccc', marginBottom: '8px' }}>Club Logo</label>
                <input type="file" ref={logoInputRef} accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} />
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploading}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px',
                      background: 'linear-gradient(180deg, #1a1a1a, #0a0a0a)', border: '2px solid #D4AF37',
                      borderRadius: '8px', color: '#D4AF37', fontSize: '14px', fontWeight: 700,
                      cursor: uploading ? 'wait' : 'pointer',
                      boxShadow: '0 2px 8px rgba(212,175,55,0.2)',
                      opacity: uploading ? 0.6 : 1
                    }}
                  >
                    {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                    {uploading ? 'Uploading...' : 'Upload Logo'}
                  </button>
                  {draft.logoUrl && (
                    <button onClick={() => update('logoUrl', '')} style={{ padding: '8px 12px', background: '#1a0a0a', border: '1px solid #C62828', borderRadius: '6px', color: '#EF5350', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      Remove
                    </button>
                  )}
                </div>
                {draft.logoUrl && (
                  <div style={{ marginTop: '12px', padding: '16px', background: '#0a0a0a', borderRadius: '8px', border: '1px solid #333', textAlign: 'center' }}>
                    <img src={draft.logoUrl} alt="Logo Preview" style={{ maxHeight: '80px', maxWidth: '240px', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} />
                  </div>
                )}
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#ccc', marginBottom: '8px' }}>Ticker Message</label>
                <input
                  type="text"
                  value={draft.tickerMessage}
                  onChange={e => update('tickerMessage', e.target.value)}
                  placeholder="Download the Smarter Poker App for live waitlist updates"
                  style={{ width: '100%', padding: '10px 12px', background: '#1a1a1a', border: '1px solid #444', borderRadius: '6px', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          )}

          {activeTab === 'games' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ fontSize: '13px', color: '#888', margin: 0 }}>
                Add custom game types. If empty, games auto-detect from your active tables.
              </p>
              {(draft.gameTypes || []).map((g, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <GripVertical size={16} color="#555" />
                  <span style={{ flex: 1, padding: '8px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '4px', color: '#fff', fontSize: '14px' }}>{g}</span>
                  <button onClick={() => {
                    const next = draft.gameTypes.filter((_, idx) => idx !== i);
                    update('gameTypes', next);
                  }} style={{ width: '32px', height: '32px', borderRadius: '4px', background: '#1a0a0a', border: '1px solid #C62828', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#EF5350' }}>
                    <Trash size={14} />
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={newGame}
                  onChange={e => setNewGame(e.target.value)}
                  placeholder="e.g., NLH 5/10"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newGame.trim()) {
                      update('gameTypes', [...(draft.gameTypes || []), newGame.trim()]);
                      setNewGame('');
                    }
                  }}
                  style={{ flex: 1, padding: '8px 12px', background: '#1a1a1a', border: '1px solid #444', borderRadius: '4px', color: '#fff', fontSize: '14px' }}
                />
                <button onClick={() => {
                  if (newGame.trim()) {
                    update('gameTypes', [...(draft.gameTypes || []), newGame.trim()]);
                    setNewGame('');
                  }
                }} style={{ padding: '8px 14px', background: '#D4AF37', color: '#000', borderRadius: '4px', border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Plus size={14} /> Add
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid #333', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', background: '#222', border: '1px solid #444', borderRadius: '6px', color: '#ccc', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={() => onSave(draft)} style={{ padding: '10px 24px', background: '#D4AF37', border: 'none', borderRadius: '6px', color: '#000', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
            Save Settings
          </button>
        </div>
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
    </div>
  );
}

// lighten, darken imported from '@/lib/commander/colorUtils'

function makeBtn(c) {
  return {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px',
    background: `linear-gradient(180deg, ${lighten(c.cardBgColor, 8)}, ${c.cardBgColor})`,
    border: `2px solid ${c.accentColor}`, borderRadius: '6px', color: c.accentColor,
    fontSize: '16px', fontWeight: 700, cursor: 'pointer',
    boxShadow: `0 2px 8px ${c.accentColor}33, inset 0 1px 0 rgba(255,255,255,0.05)`,
    textTransform: 'uppercase', letterSpacing: '0.5px'
  };
}

function makeActionBtn(c) {
  return {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px',
    borderRadius: '6px', border: `2px solid ${c.borderColor}`, fontSize: '18px',
    fontWeight: 700, cursor: 'pointer',
    background: `linear-gradient(180deg, ${lighten(c.cardBgColor, 10)}, ${c.cardBgColor})`, color: c.textColor,
    boxShadow: '0 3px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
    textTransform: 'uppercase', letterSpacing: '0.5px'
  };
}

function makeActionBtnGreen(c) {
  return {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px',
    borderRadius: '6px', border: '2px solid #2E7D32', fontSize: '18px',
    fontWeight: 700, cursor: 'pointer',
    background: 'linear-gradient(180deg, #1a2e1a, #0a1a0a)', color: '#4CAF50',
    boxShadow: '0 3px 8px rgba(46,125,50,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
    textTransform: 'uppercase', letterSpacing: '0.5px'
  };
}

function makeActionBtnRed(c) {
  return {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px',
    borderRadius: '6px', border: '2px solid #C62828', fontSize: '18px',
    fontWeight: 700, cursor: 'pointer',
    background: 'linear-gradient(180deg, #2a1a1a, #1a0a0a)', color: '#EF5350',
    boxShadow: '0 3px 8px rgba(198,40,40,0.3), inset 0 1px 0 rgba(255,255,255,0.05)'
  };
}

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.85)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
};

function modalStyle(c) {
  return {
    background: '#111', border: `1px solid ${c.borderColor}`, borderRadius: '8px',
    width: '100%', maxWidth: '420px', padding: '20px'
  };
}

function modalCloseStyle(c) {
  return {
    width: '28px', height: '28px', borderRadius: '4px', background: '#222',
    border: `1px solid ${c.borderColor}`, display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', color: `${c.textColor}88`
  };
}

function formInputStyle(c) {
  return {
    width: '100%', height: '40px', padding: '0 10px', background: '#1a1a1a',
    border: `1px solid ${c.borderColor}`, borderRadius: '4px', color: '#fff',
    fontSize: '14px', outline: 'none', boxSizing: 'border-box'
  };
}
