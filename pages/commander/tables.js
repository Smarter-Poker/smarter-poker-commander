/**
 * Commander Table Management Page
 * Oval poker table visualization with real-time seat data
 * Staff actions: start/close game, set status, add/delete tables
 * UI: Dark industrial sci-fi gaming theme, Inter font
 */
import { useState, useEffect, useCallback } from 'react';
import { busEmit } from '../../src/engine/EventBus';
import { useRouter } from 'next/router';
import Image from 'next/image';
import SEOHead from '../../src/components/seo/SEOHead';
import { Plus, Trash2, Table2, Users, Loader2, Play, Square, X } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import Pagination from '../../src/components/commander/shared/Pagination';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';
import { useConfirmAction } from "../../src/components/commander/shared/ConfirmModal";

const STATUS_COLORS = {
  available: { bg: 'rgba(49,162,76,0.15)', border: '#31A24C', text: '#31A24C', label: 'Available' },
  in_use: { bg: 'rgba(24,119,242,0.15)', border: '#1877F2', text: '#1877F2', label: 'In Use' },
  reserved: { bg: 'rgba(245,158,11,0.15)', border: '#F59E0B', text: '#F59E0B', label: 'Reserved' } };

const PURPOSE_COLORS = {
  cash_game: { bg: 'rgba(49,162,76,0.15)', border: '#31A24C', text: '#31A24C', label: 'Cash Game' },
  tournament: { bg: 'rgba(255,215,0,0.15)', border: '#FFD700', text: '#FFD700', label: 'Tournament' } };

// 2026-08-04 audit fix: must match /api/games VALID_GAME_TYPES - NLO8/PLO8/Draw were rejected with 400
const GAME_TYPES = ['NLH', 'PLO', 'PLO5', 'Mixed', 'Limit', 'Stud', 'Razz'];
const COMMON_STAKES = ['$1/$2', '$1/$3', '$2/$5', '$5/$10', '$10/$20', '$25/$50'];

// Arc-length parameterized ellipse for equal visual spacing of seats
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
  return { dealerPos, seatPositions };
}

export default function CommanderTablesPage() {
  const router = useRouter();

  // ── EventBus: Commander session telemetry ──

  // ── Toast auto-dismiss ──
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-tables'); }, []);
  const [staff, setStaff] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [venue, setVenue] = useState(null);
  const [tables, setTables] = useState([]);
  const [games, setGames] = useState([]);
  const [sessions, setSessions] = useState({}); // keyed by table_number
  const [dealerMap, setDealerMap] = useState({}); // table_number -> dealer_name
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const totalPages = Math.ceil(tables.length / 24);
    if (page > totalPages && totalPages > 0) setPage(totalPages);
  }, [tables.length, page]);

  // Start Game state
  const [showStartGame, setShowStartGame] = useState(false);
  const [newGameType, setNewGameType] = useState('NLH');
  const [newStakes, setNewStakes] = useState('$1/$2');
  const [newMaxPlayers, setNewMaxPlayers] = useState(9);

  // Check staff session
  useEffect(() => {
    const storedStaff = getStaffSession();
    if (!storedStaff) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
    try {
      const staffData = JSON.parse(storedStaff);
      if (!staffData.venue_id) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
      setStaff(staffData);
      setVenueId(staffData.venue_id);
      if (staffData.venue_name) setVenue({ id: staffData.venue_id, name: staffData.venue_name });
    } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
  }, [router]);

  // Fetch tables + games + sessions
  const fetchTables = useCallback(async (signal) => {
    if (!venueId) return;
const headers = { };

    // Fetch tables
    let tablesArr = [];
    try {
      const tablesRes = await commanderFetch(`/api/commander/tables?venue_id=${venueId}`, { headers, signal });
      if (!tablesRes.ok) throw new Error(`Tables fetch failed (${tablesRes.status})`);
      const tablesData = await tablesRes.json();
      if (tablesData.success) {
        tablesArr = Array.isArray(tablesData.data) ? tablesData.data
          : Array.isArray(tablesData.data?.tables) ? tablesData.data.tables
            : [];
        setTables(tablesArr);
      }
    } catch (err) { console.warn('Failed to fetch tables:', err); setLoadError('Failed to load tables. Tap to retry.'); }

    // Fetch games
    try {
      const gamesRes = await commanderFetch(`/api/commander/games/venue/${venueId}`, { headers, signal });
      if (!gamesRes.ok) throw new Error(`Games fetch failed (${gamesRes.status})`);
      const gamesData = await gamesRes.json();
      if (gamesData.success) {
        const gamesArr = Array.isArray(gamesData.data?.games) ? gamesData.data.games
          : Array.isArray(gamesData.data) ? gamesData.data
            : [];
        setGames(gamesArr);
      }
    } catch (err) { console.warn('Failed to fetch games:', err); }

    // Fetch sessions per in-use table (reuse fetched tablesArr)
    try {
      const activeTables = tablesArr.filter(t => t.status === 'in_use');
      const sessionData = {};
      await Promise.all(activeTables.map(async (t) => {
        try {
          const tNum = t.table_number || t.number;
          // 2026-07-25 audit fix: sessions handler requires venue_id (400s without it)
          const json = await commanderFetchJSON(`/api/commander/dealer/sessions?table=${tNum}&venue_id=${venueId}`, { headers });
          if (json.success) sessionData[tNum] = json.data || [];
        } catch (e) { console.warn("[tables.js]", e); }
      }));
      setSessions(sessionData);
    } catch (e) { console.warn("[tables.js]", e); }

    setLoading(false);

    // Fetch active dealer rotations - maps table_number to dealer_name
    try {
      const rotRes = await commanderFetch(`/api/commander/dealers/rotations?venue_id=${venueId}`, { headers });
      if (!rotRes.ok) throw new Error(`Rotation fetch failed (${rotRes.status})`);
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
    fetchTables(controller.signal);
    return () => controller.abort();
  }, [venueId, fetchTables]);

  // Auto-refresh every 15s
  useEffect(() => {
    if (!venueId) return;
    const interval = setInterval(fetchTables, 30000); // fallback - real-time sync handles instant updates
    return () => clearInterval(interval);
  }, [venueId, fetchTables]);

  // Cross-tab + cross-device real-time sync
  useCommanderSync(venueId, fetchTables, { entities: ['tables', 'games', 'dealers'] });

  // Get the game running on a table
  const getGameForTable = (table) => {
    if (Array.isArray(table.commander_games) && table.commander_games.length > 0) {
      return table.commander_games.find(g => g.status !== 'closed') || null;
    }
    return games.find(g => g.table_id === table.id && g.status !== 'closed') || null;
  };

  const selectedTable = tables.find(t => t.id === selectedTableId) || null;
  const selectedGame = selectedTable ? getGameForTable(selectedTable) : null;

  // ── ACTIONS ──
  const handleStartGame = async () => {
    if (!selectedTable) return;
    setActionLoading(true);
    try {
const res = await commanderFetch('/api/commander/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venueId, table_id: selectedTable.id,
          game_type: newGameType, stakes: newStakes,
          max_players: newMaxPlayers, status: 'waiting'
        })
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      if (data.success || data.data) {
        const res = await commanderFetch(`/api/commander/tables/${selectedTable.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'in_use', game_type: newGameType, stakes: newStakes, mode: 'cash', table_purpose: 'cash_game' })
        });
        if (!res.ok) throw new Error('Request failed');
        setShowStartGame(false);
        await fetchTables();
        broadcastChange('games');
        busEmit.celebration('confetti');
      }
    } catch (err) { console.warn('Start game error:', err); setToast({ type: 'error', text: 'Action failed: Start game. Please try again.' }); }
    finally { setActionLoading(false); }
  };

  const handleCloseGame = async (gameId) => {
    requestConfirm('Close this game? Players will be unseated.', async () => {
      setActionLoading(true);
      try {
        // 2026-08-04 audit fix: use DELETE - it closes the game AND clears the
        // table's current_game_id. PATCH {status:'closed'} left current_game_id
        // set, so the follow-up table PATCH to 'available' always failed 400.
        const res1 = await commanderFetch(`/api/commander/games/${gameId}`, {
          method: 'DELETE' });
        if (!res1.ok) throw new Error('Failed to close game');
        if (selectedTable) {
          const res2 = await commanderFetch(`/api/commander/tables/${selectedTable.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'available', game_type: null, stakes: null, mode: 'inactive' })
          });
          if (!res2.ok) throw new Error('Failed to update table status');
        }
        await fetchTables();
        broadcastChange('games');
      } catch (err) { console.warn('Close game error:', err); setToast({ type: 'error', text: 'Action failed: Close game. Please try again.' }); }
      finally { setActionLoading(false); }
    }, { confirmLabel: 'Close Game', variant: 'danger' });
  };

  const handleSetStatus = async (status) => {
    if (!selectedTable) return;
    setActionLoading(true);
    try {
const updates = { status };
      if (status === 'available') {
        updates.game_type = null;
        updates.stakes = null;
      }
      const res = await commanderFetch(`/api/commander/tables/${selectedTable.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        await fetchTables();
        broadcastChange('tables');
      }
    } catch (err) { console.warn('Set status error:', err); setToast({ type: 'error', text: 'Action failed: Set status. Please try again.' }); }
    finally { setActionLoading(false); }
  };

  const handleDeleteTable = async () => {
    if (!selectedTable) return;
    requestConfirm(`Delete Table ${selectedTable.table_number}? This cannot be undone.`, async () => {
      setActionLoading(true);
      try {
        const res = await commanderFetch(`/api/commander/tables/${selectedTable.id}`, {
          method: 'DELETE'});
        if (res.ok) {
          setSelectedTableId(null);
          await fetchTables();
          broadcastChange('tables');
        }
      } catch (err) { console.warn('Delete table error:', err); setToast({ type: 'error', text: 'Action failed: Delete table. Please try again.' }); }
      finally { setActionLoading(false); }
    }, { confirmLabel: 'Delete Table', variant: 'danger' });
  };

  const handleAddTable = async (tableData) => {
    try {
const res = await commanderFetch('/api/commander/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...tableData, venue_id: venueId })
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      if (data.success) {
        setShowAddModal(false);
        await fetchTables();
        broadcastChange('tables');
      }
    } catch (err) { console.warn('Add table error:', err); setToast({ type: 'error', text: 'Action failed: Add table. Please try again.' }); }
  setActionLoading(false);
  };

  // Set table purpose (cash_game or tournament)
  const handleSetPurpose = async (purpose) => {
    if (!selectedTable) return;
    setActionLoading(true);
    try {
// Sync both table_purpose and mode columns
      const mode = purpose === 'tournament' ? 'tournament' : 'cash';
      const res = await commanderFetch(`/api/commander/tables/${selectedTable.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_purpose: purpose, mode })
      });
      if (res.ok) {
        await fetchTables();
        broadcastChange('tables');
      }
    } catch (err) { console.warn('Set purpose error:', err); setToast({ type: 'error', text: 'Action failed: Set purpose. Please try again.' }); }
    finally { setActionLoading(false); }
  };

  // Update selectedTableId ref when tables refresh
  useEffect(() => {
    if (selectedTableId) {
      const updated = tables.find(t => t.id === selectedTableId);
      if (!updated) setSelectedTableId(null);
    }
  }, [tables, selectedTableId]);

  if (!staff || loading) {
    if (loadError) return (
      <div style={{ minHeight: '100vh', background: '#18191A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#fff' }}>
        <span style={{ fontSize: 16 }}>{loadError}</span>
        <button onClick={() => { setLoadError(null); fetchTables(); }} style={{ padding: '8px 20px', background: '#1877F2', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Retry</button>
      </div>
    );
    return (
      <div className="cmd-page flex items-center justify-center" style={{ minHeight: '100vh', background: '#18191A' }}>
        <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
      </div>
    );
  }

  // Apply pagination first
  const ITEMS_PER_PAGE = 24;
  const paginatedTables = tables.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  // Separate tables into active (with game) and idle (no game)
  const activeTables = paginatedTables.filter(t => getGameForTable(t));
  const idleTables = paginatedTables.filter(t => !getGameForTable(t));

  return (
    <CommanderLayout title={`Table Management | ${venue?.name || 'Commander'}`} backHref="/commander/dashboard?card=floor">
      <>
        <SEOHead title="Commander - Tables & Floor" description="Club Commander Poker Room Management Tool." noindex={true} />
        <div className="cmd-page" style={{ minHeight: '100vh', background: '#18191A', fontFamily: 'Inter, sans-serif' }}>

          {/* Header */}
          <header style={{ position: 'sticky', top: 0, zIndex: 50, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #3A3B3C', background: '#242526' }}>
            <div>
              <h1 style={{ color: '#fff', fontWeight: 700, fontSize: '18px' }}>Tables and Floor</h1>
              <p style={{ color: '#B0B3B8', fontSize: '13px' }}>{venue?.name} - {tables.length} Tables ({activeTables.length} active)</p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: '#1877F2', color: '#fff', fontWeight: 600, fontSize: '14px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
            >
              <Plus size={16} /> Add Table
            </button>
          </header>

          <main style={{ maxWidth: '1400px', margin: '0 auto', padding: '20px 16px' }}>

            {tables.length === 0 ? (
              <div style={{ background: '#242526', border: '1px solid #3A3B3C', borderRadius: '12px', padding: '48px', textAlign: 'center' }}>
                <Table2 size={48} color="#3A3B3C" style={{ margin: '0 auto 16px' }} />
                <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#fff', marginBottom: '8px' }}>No Tables Yet</h2>
                <p style={{ color: '#B0B3B8', marginBottom: '16px' }}>Add tables to start managing your poker room</p>
                <button
                  onClick={() => setShowAddModal(true)}
                  style={{ padding: '10px 24px', background: '#1877F2', color: '#fff', fontWeight: 600, borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                >
                  Add First Table
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                {/* ═══ ACTIVE TABLES - Oval Visualization ═══ */}
                {activeTables.length > 0 && (
                  <div>
                    <h2 style={{ color: '#1877F2', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>
                      Live Tables ({activeTables.length})
                    </h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {activeTables.map(table => {
                        const game = getGameForTable(table);
                        if (!game) return null;
                        const maxSeats = table.max_seats || game.max_players || 9;
                        const tNum = table.table_number;
                        const tableSessions = sessions[tNum] || [];
                        const isSelected = selectedTableId === table.id;

                        // Build seat array - merge sessions, table_seats, then fill with anonymous badges
                        const seatArr = Array.from({ length: maxSeats }, (_, i) => {
                          const seatNum = i + 1;
                          // Priority 1: session data (has time_remaining)
                          const session = tableSessions.find(s => s.seat_number === seatNum);
                          if (session) return { number: seatNum, taken: session };
                          // Priority 2: table_seats data from API (has player_name)
                          const tableSeat = (table.seats || []).find(s => s.seat_number === seatNum && s.status === 'occupied');
                          if (tableSeat) return { number: seatNum, taken: { player_name: tableSeat.player_name, seat_number: seatNum } };
                          return { number: seatNum, taken: null };
                        });

                        // Fill with anonymous players if game.current_players > seated records
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

                        // Compute seat positions
                        const { dealerPos, seatPositions } = computeSeatPositions(maxSeats);

                        return (
                          <div key={table.id}>
                            {/* Game Header */}
                            <div
                              style={{
                                background: '#242526', borderRadius: 16,
                                border: `2px solid ${isSelected ? '#1877F2' : '#3A3B3C'}`,
                                overflow: 'hidden', cursor: 'pointer',
                                transition: 'border-color 0.2s' }}
                              onClick={() => { setSelectedTableId(isSelected ? null : table.id); setShowStartGame(false); }}
                            >
                              <div style={{
                                padding: '12px 16px',
                                background: game.status === 'running'
                                  ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                                  : 'linear-gradient(135deg, #1877F2 0%, #1565c0 100%)',
                                color: '#fff' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <div>
                                    <div style={{ fontSize: 16, fontWeight: 800 }}>
                                      {(game.game_type || table.game_type || 'NLH').toUpperCase()} {game.stakes || table.stakes || ''}
                                    </div>
                                    <div style={{ fontSize: 13, opacity: 0.9 }}>
                                      Table {tNum}{table.table_name ? ` · ${table.table_name}` : ''} · {maxSeats}-max
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{
                                      padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                                      background: 'rgba(255,255,255,0.2)', textTransform: 'uppercase',
                                      display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
                                      {game.status === 'running' ? 'RUNNING' : game.status?.toUpperCase() || 'ACTIVE'}
                                    </span>
                                    <span style={{ fontSize: 13, fontWeight: 600 }}>{occupiedCount}/{maxSeats} seated</span>
                                  </div>
                                </div>
                              </div>

                              {/* ── Oval Table Visualization (cropped viewport) ── */}
                              <div style={{ position: 'relative', width: '100%', paddingBottom: '64%', overflow: 'hidden' }}>
                                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, aspectRatio: '1 / 1', marginTop: '-18%' }}>
                                  {/* Table image */}
                                  <Image src="/images/poker-table-black-gold.png" alt="Poker Table" width={640} height={640} style={{
                                    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                                    objectFit: 'contain', pointerEvents: 'none', zIndex: 0 }} />

                                  {/* Game info in center */}
                                  <div style={{
                                    position: 'absolute', top: '48%', left: '50%',
                                    transform: 'translate(-50%, -50%)', zIndex: 5, textAlign: 'center' }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>
                                      {venue?.name || 'Table'} #{tNum}
                                    </div>
                                    <div style={{ fontSize: 20, fontWeight: 800, color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: 1 }}>
                                      {(game.game_type || table.game_type || '').toUpperCase()}
                                    </div>
                                    <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', marginTop: 2, fontWeight: 700 }}>
                                      {game.stakes || table.stakes || ''}
                                    </div>
                                  </div>

                                  {/* Dealer */}
                                  <div style={{
                                    position: 'absolute', top: dealerPos.top, left: dealerPos.left,
                                    transform: 'translate(-50%, -50%)', textAlign: 'center', width: 80, zIndex: 3 }}>
                                    <div style={{
                                      width: 64, height: 64, borderRadius: '50%', margin: '0 auto 4px',
                                      background: 'linear-gradient(135deg, #1877F2 0%, #1565c0 100%)',
                                      border: '3px solid #E4E6EB',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      boxShadow: '0 2px 12px rgba(0,0,0,0.6), 0 0 16px rgba(24,119,242,0.4)',
                                      fontSize: 28, fontWeight: 900, color: '#fff' }}>D</div>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: '#1877F2', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {dealerMap[tNum] || game.dealer_name || 'No Dealer'}
                                    </div>
                                  </div>

                                  {/* Seat badges */}
                                  {seatArr.slice(0, seatPositions.length).map((seat, idx) => {
                                    const pos = seatPositions[idx];
                                    const isOccupied = !!seat.taken;
                                    const firstName = seat.taken?.player_name?.split(' ')[0] || '';
                                    const fullName = seat.taken?.player_name || '';

                                    const leftPct = parseFloat(pos.left);
                                    const isLeftSide = leftPct < 25;
                                    const isRightSide = leftPct > 75;
                                    const badgeTransform = isLeftSide
                                      ? 'translate(-17px, -50%)'
                                      : isRightSide
                                        ? 'translate(calc(-100% + 17px), -50%)'
                                        : 'translate(-50%, -50%)';
                                    const badgeDirection = isRightSide ? 'row-reverse' : 'row';

                                    // Timer computation
                                    let timerText = null, timerColor = null;
                                    if (isOccupied && seat.taken) {
                                      const isTexas = game.venue_type === 'texas';
                                      if (isTexas && seat.taken.time_remaining != null) {
                                        const rem = Math.max(0, seat.taken.time_remaining || 0);
                                        const mins = Math.floor(rem / 60);
                                        const secs = rem % 60;
                                        timerText = rem <= 0 ? 'EXPIRED' : `${mins}:${String(secs).padStart(2, '0')}`;
                                        timerColor = rem <= 0 ? '#ef4444' : rem <= 300 ? '#ef4444' : rem <= 900 ? '#f59e0b' : '#22c55e';
                                      } else if (seat.taken.elapsed_seconds != null) {
                                        const elapsed = seat.taken.elapsed_seconds || 0;
                                        const hrs = Math.floor(elapsed / 3600);
                                        const mins = Math.floor((elapsed % 3600) / 60);
                                        timerText = `${hrs}:${String(mins).padStart(2, '0')}`;
                                        timerColor = '#a78bfa';
                                      }
                                    }

                                    return (
                                      <div key={seat.number} style={{
                                        position: 'absolute', top: pos.top, left: pos.left,
                                        transform: badgeTransform, zIndex: 2,
                                        display: 'flex', flexDirection: badgeDirection, alignItems: 'center', gap: 8,
                                        background: 'rgba(36,37,38,0.9)',
                                        borderRadius: 12,
                                        padding: '5px 10px 5px 5px',
                                        border: `2px solid ${isOccupied ? 'rgba(24,119,242,0.5)' : 'rgba(255,255,255,0.08)'}`,
                                        backdropFilter: 'blur(6px)',
                                        minWidth: 70 }}>
                                        {/* Avatar circle */}
                                        <div style={{
                                          width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
                                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                                          background: isOccupied
                                            ? 'linear-gradient(135deg, #1877F2 0%, #1565c0 100%)'
                                            : 'rgba(255,255,255,0.06)',
                                          border: `2px solid ${isOccupied ? '#1877F2' : 'rgba(62,64,66,0.5)'}`,
                                          overflow: 'hidden' }}>
                                          {isOccupied ? (
                                            <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{firstName.charAt(0).toUpperCase()}</span>
                                          ) : (
                                            <span style={{ fontSize: 16, fontWeight: 600, color: '#B0B3B8' }}>{seat.number}</span>
                                          )}
                                        </div>
                                        {/* Name + Timer */}
                                        <div style={{ overflow: 'hidden', textAlign: isRightSide ? 'right' : 'left' }}>
                                          <div style={{
                                            fontSize: 13, fontWeight: 600, lineHeight: 1.2,
                                            color: isOccupied ? '#E4E6EB' : '#B0B3B8',
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            maxWidth: 110 }}>
                                            {isOccupied ? fullName : 'Open'}
                                          </div>
                                          {timerText && (
                                            <div style={{
                                              fontSize: 12, fontWeight: 700, color: timerColor,
                                              fontFamily: 'monospace', lineHeight: 1.2 }}>
                                              {timerText}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>

                            {/* ── Action Panel (if selected) ── */}
                            {isSelected && (
                              <div style={{
                                background: '#242526', border: '2px solid #1877F2', borderTop: 'none',
                                borderRadius: '0 0 12px 12px', padding: '16px',
                                animation: 'fadeIn 0.2s' }}>
                                {/* Active Game Info */}
                                <div style={{
                                  background: 'rgba(24,119,242,0.1)', border: '1px solid #1877F240',
                                  borderRadius: '8px', padding: '12px', marginBottom: '12px',
                                  display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div>
                                    <div style={{ color: '#1877F2', fontWeight: 700, fontSize: '15px' }}>
                                      {(game.game_type || table.game_type || '').toUpperCase()} {game.stakes || table.stakes || ''}
                                    </div>
                                    <div style={{ color: '#B0B3B8', fontSize: '13px', marginTop: '2px' }}>
                                      <Users size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                                      {occupiedCount} / {maxSeats} players
                                      {game.started_at && ` - Running ${formatDuration(game.started_at)}`}
                                    </div>
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleCloseGame(game.id); }}
                                    disabled={actionLoading}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: '6px',
                                      padding: '8px 16px', background: 'rgba(239,68,68,0.15)', color: '#EF4444',
                                      fontWeight: 600, fontSize: '13px', borderRadius: '8px', border: '1px solid #EF444440',
                                      cursor: 'pointer', opacity: actionLoading ? 0.5 : 1 }}
                                  >
                                    <Square size={14} /> Close Game
                                  </button>
                                </div>

                                {/* Quick Actions */}
                                {/* Table Purpose Toggle */}
                                <div style={{ marginBottom: 10, display: 'flex', gap: 8 }}>
                                  {Object.entries(PURPOSE_COLORS || {}).map(([key, pc]) => {
                                    // Use mode to determine the active purpose, with fallback to table_purpose
                                    const tableMode = table.mode || table.table_purpose || 'cash';
                                    const mappedPurpose = tableMode === 'tournament' ? 'tournament' : 'cash_game';
                                    const isActive = mappedPurpose === key;
                                    return (
                                      <button key={key} onClick={(e) => { e.stopPropagation(); handleSetPurpose(key); }} disabled={actionLoading}
                                        style={{
                                          flex: 1, padding: '8px 14px', fontSize: '13px', fontWeight: 700,
                                          borderRadius: '8px', cursor: 'pointer',
                                          background: isActive ? pc.bg : 'rgba(58,59,60,0.4)',
                                          color: isActive ? pc.text : '#B0B3B8',
                                          border: `2px solid ${isActive ? pc.border : '#3A3B3C'}`,
                                          opacity: actionLoading ? 0.5 : 1 }}
                                      >{pc.label}</button>
                                    );
                                  })}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                  {['available', 'reserved'].filter(s => s !== table.status).map(status => {
                                    const sc = STATUS_COLORS[status];
                                    return (
                                      <button
                                        key={status}
                                        onClick={(e) => { e.stopPropagation(); handleSetStatus(status); }}
                                        disabled={actionLoading}
                                        style={{
                                          padding: '8px 14px', fontSize: '13px', fontWeight: 600,
                                          borderRadius: '8px', cursor: 'pointer',
                                          background: sc.bg, color: sc.text, border: `1px solid ${sc.border}40`,
                                          opacity: actionLoading ? 0.4 : 1 }}
                                      >
                                        Set {sc.label}
                                      </button>
                                    );
                                  })}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleDeleteTable(); }}
                                    disabled={actionLoading || table.status === 'in_use'}
                                    style={{
                                      padding: '8px 14px', fontSize: '13px', fontWeight: 600,
                                      borderRadius: '8px', cursor: 'pointer', marginLeft: 'auto',
                                      background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid #EF444430',
                                      opacity: (actionLoading || table.status === 'in_use') ? 0.4 : 1 }}
                                  >
                                    <Trash2 size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                                    Delete
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ═══ IDLE TABLES - Compact Grid ═══ */}
                {idleTables.length > 0 && (
                  <div>
                    <h2 style={{ color: '#B0B3B8', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>
                      Idle Tables ({idleTables.length})
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                      {idleTables.map(table => {
                        const sc = STATUS_COLORS[table.status] || STATUS_COLORS.available;
                        const isSelected = selectedTableId === table.id;
                        return (
                          <button
                            key={table.id}
                            onClick={() => { setSelectedTableId(isSelected ? null : table.id); setShowStartGame(false); }}
                            style={{
                              width: '100%', textAlign: 'left', padding: '14px',
                              background: isSelected ? 'rgba(24,119,242,0.1)' : '#242526',
                              border: `2px solid ${isSelected ? '#1877F2' : '#3A3B3C'}`,
                              borderRadius: '10px', cursor: 'pointer',
                              transition: 'all 0.2s' }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                              <div>
                                <div style={{ color: '#fff', fontWeight: 700, fontSize: '15px' }}>
                                  Table {table.table_number}
                                </div>
                                {table.table_name && (
                                  <div style={{ color: '#B0B3B8', fontSize: '12px', marginTop: '2px' }}>{table.table_name}</div>
                                )}
                              </div>
                              <span style={{
                                padding: '3px 8px', fontSize: '11px', fontWeight: 600, borderRadius: '6px',
                                background: sc.bg, color: sc.text, border: `1px solid ${sc.border}40` }}>
                                {sc.label}
                              </span>
                            </div>
                            <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ color: '#B0B3B8', fontSize: '12px' }}>{table.max_seats || 9} seats</span>
                              {(() => {
                                const tableMode = table.mode || table.table_purpose || 'cash';
                                const isTournament = tableMode === 'tournament';
                                const isInactive = tableMode === 'inactive';
                                const pc = isTournament ? PURPOSE_COLORS.tournament : PURPOSE_COLORS.cash_game;
                                const label = isInactive ? 'INACTIVE' : isTournament ? 'TOURNAMENT' : 'CASH GAME';
                                return (
                                  <span style={{
                                    fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px',
                                    background: isInactive ? 'rgba(176,179,184,0.15)' : pc.bg,
                                    color: isInactive ? '#B0B3B8' : pc.text,
                                    border: `1px solid ${isInactive ? '#B0B3B840' : pc.border + '40'}`,
                                    textTransform: 'uppercase' }}>{label}</span>
                                );
                              })()}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Action Panel for Idle Tables */}
                    {selectedTable && !selectedGame && (
                      <div style={{
                        background: '#242526', border: '2px solid #1877F2', borderRadius: '12px',
                        padding: '20px', marginTop: '16px', animation: 'fadeIn 0.2s' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                          <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#fff' }}>
                            Table {selectedTable.table_number}
                            {selectedTable.table_name && <span style={{ color: '#B0B3B8', fontWeight: 400, marginLeft: '8px', fontSize: '14px' }}>({selectedTable.table_name})</span>}
                          </h3>
                          <button onClick={() => { setSelectedTableId(null); setShowStartGame(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <X size={20} color="#B0B3B8" />
                          </button>
                        </div>

                        {/* Start Game */}
                        {selectedTable.status !== 'in_use' && (
                          <>
                            {!showStartGame ? (
                              <button
                                onClick={() => setShowStartGame(true)}
                                style={{
                                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                                  padding: '12px', background: 'rgba(49,162,76,0.15)', color: '#31A24C',
                                  fontWeight: 600, fontSize: '14px', borderRadius: '8px', border: '1px solid #31A24C40',
                                  cursor: 'pointer', marginBottom: '16px' }}
                              >
                                <Play size={16} /> Start Game on Table {selectedTable.table_number}
                              </button>
                            ) : (
                              <div style={{
                                background: '#18191A', borderRadius: '10px', padding: '16px',
                                marginBottom: '16px', border: '1px solid #3A3B3C' }}>
                                <h4 style={{ color: '#fff', fontWeight: 600, fontSize: '15px', marginBottom: '12px' }}>Start New Game</h4>

                                <div style={{ marginBottom: '12px' }}>
                                  <label style={{ display: 'block', color: '#B0B3B8', fontSize: '12px', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase' }}>Game Type</label>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    {GAME_TYPES.map(gt => (
                                      <button key={gt} onClick={() => setNewGameType(gt)}
                                        style={{
                                          padding: '6px 14px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: 'none', cursor: 'pointer',
                                          background: newGameType === gt ? '#1877F2' : '#3A3B3C', color: newGameType === gt ? '#fff' : '#B0B3B8' }}
                                      >{gt}</button>
                                    ))}
                                  </div>
                                </div>

                                <div style={{ marginBottom: '12px' }}>
                                  <label style={{ display: 'block', color: '#B0B3B8', fontSize: '12px', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase' }}>Stakes</label>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    {COMMON_STAKES.map(s => (
                                      <button key={s} onClick={() => setNewStakes(s)}
                                        style={{
                                          padding: '6px 14px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: 'none', cursor: 'pointer',
                                          background: newStakes === s ? '#1877F2' : '#3A3B3C', color: newStakes === s ? '#fff' : '#B0B3B8' }}
                                      >{s}</button>
                                    ))}
                                  </div>
                                </div>

                                <div style={{ marginBottom: '16px' }}>
                                  <label style={{ display: 'block', color: '#B0B3B8', fontSize: '12px', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase' }}>Max Players</label>
                                  <div style={{ display: 'flex', gap: '6px' }}>
                                    {[6, 8, 9, 10].map(n => (
                                      <button key={n} onClick={() => setNewMaxPlayers(n)}
                                        style={{
                                          padding: '6px 16px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: 'none', cursor: 'pointer',
                                          background: newMaxPlayers === n ? '#1877F2' : '#3A3B3C', color: newMaxPlayers === n ? '#fff' : '#B0B3B8' }}
                                      >{n}</button>
                                    ))}
                                  </div>
                                </div>

                                <div style={{ display: 'flex', gap: '10px' }}>
                                  <button onClick={() => setShowStartGame(false)}
                                    style={{ flex: 1, padding: '10px', background: '#3A3B3C', color: '#B0B3B8', fontWeight: 600, fontSize: '14px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                                  >Cancel</button>
                                  <button onClick={handleStartGame} disabled={actionLoading}
                                    style={{
                                      flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                      padding: '10px', background: '#31A24C', color: '#fff', fontWeight: 700, fontSize: '14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                      opacity: actionLoading ? 0.5 : 1 }}
                                  ><Play size={16} /> Start {newGameType} {newStakes}</button>
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {/* Quick Actions */}
                        {/* Table Purpose Toggle */}
                        <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
                          {Object.entries(PURPOSE_COLORS || {}).map(([key, pc]) => {
                            const tableMode = selectedTable.mode || selectedTable.table_purpose || 'cash';
                            const mappedPurpose = tableMode === 'tournament' ? 'tournament' : 'cash_game';
                            const isActive = mappedPurpose === key;
                            return (
                              <button key={key} onClick={() => handleSetPurpose(key)} disabled={actionLoading}
                                style={{
                                  flex: 1, padding: '10px 14px', fontSize: '14px', fontWeight: 700,
                                  borderRadius: '8px', cursor: 'pointer',
                                  background: isActive ? pc.bg : 'rgba(58,59,60,0.4)',
                                  color: isActive ? pc.text : '#B0B3B8',
                                  border: `2px solid ${isActive ? pc.border : '#3A3B3C'}`,
                                  opacity: actionLoading ? 0.5 : 1 }}
                              >{pc.label}</button>
                            );
                          })}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {['available', 'reserved'].filter(s => s !== selectedTable.status).map(status => {
                            const sc = STATUS_COLORS[status];
                            return (
                              <button key={status} onClick={() => handleSetStatus(status)} disabled={actionLoading}
                                style={{
                                  padding: '8px 14px', fontSize: '13px', fontWeight: 600, borderRadius: '8px', cursor: 'pointer',
                                  background: sc.bg, color: sc.text, border: `1px solid ${sc.border}40`,
                                  opacity: actionLoading ? 0.4 : 1 }}
                              >Set {sc.label}</button>
                            );
                          })}
                          <button onClick={handleDeleteTable} disabled={actionLoading || selectedTable.status === 'in_use'}
                            style={{
                              padding: '8px 14px', fontSize: '13px', fontWeight: 600, borderRadius: '8px', cursor: 'pointer', marginLeft: 'auto',
                              background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid #EF444430',
                              opacity: (actionLoading || selectedTable.status === 'in_use') ? 0.4 : 1 }}
                          >
                            <Trash2 size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} /> Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {tables.length > 0 && (
              <Pagination
                className="mt-8"
                currentPage={page}
                totalPages={Math.ceil(tables.length / ITEMS_PER_PAGE)}
                onPageChange={setPage}
              />
            )}
          </main>
        </div>

        {/* Add Table Modal */}
        {showAddModal && (
          <AddTableModal
            existingCount={tables.length}
            onClose={() => setShowAddModal(false)}
            onSubmit={handleAddTable}
          />
        )}

        <style>{`
          @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        `}</style>
      </>
    
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
    
      <ConfirmDialog />
    </CommanderLayout>
  );
}

function AddTableModal({ existingCount, onClose, onSubmit }) {
  const [tableNumber, setTableNumber] = useState(existingCount + 1);
  const [tableName, setTableName] = useState('');
  const [maxSeats, setMaxSeats] = useState(9);
  const [bulkCount, setBulkCount] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    if (bulkCount > 1) {
      for (let i = 0; i < bulkCount; i++) {
        await onSubmit({ table_number: tableNumber + i, table_name: null, max_seats: maxSeats });
      }
    } else {
      await onSubmit({ table_number: parseInt(tableNumber), table_name: tableName || null, max_seats: maxSeats });
    }
    setSubmitting(false);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '16px' }}>
      <div style={{ background: '#242526', border: '1px solid #3A3B3C', borderRadius: '12px', width: '100%', maxWidth: '420px' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #3A3B3C', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ color: '#fff', fontWeight: 700, fontSize: '16px' }}>Add Table</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} color="#B0B3B8" /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', color: '#B0B3B8', fontSize: '12px', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase' }}>Add Multiple Tables</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[1, 5, 10, 20].map(n => (
                <button key={n} type="button" onClick={() => setBulkCount(n)}
                  style={{ flex: 1, padding: '8px', fontSize: '14px', fontWeight: 600, borderRadius: '6px', border: 'none', cursor: 'pointer', background: bulkCount === n ? '#1877F2' : '#3A3B3C', color: bulkCount === n ? '#fff' : '#B0B3B8' }}
                >{n}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ display: 'block', color: '#B0B3B8', fontSize: '12px', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase' }}>
              {bulkCount > 1 ? `Starting Table Number (${bulkCount} tables: ${tableNumber} - ${tableNumber + bulkCount - 1})` : 'Table Number'}
            </label>
            <input type="number" value={tableNumber} onChange={e => setTableNumber(parseInt(e.target.value) || 1)} min="1" required
              style={{ width: '100%', height: '44px', padding: '0 12px', background: '#18191A', border: '1px solid #3A3B3C', borderRadius: '8px', color: '#E4E6EB', fontSize: '14px', outline: 'none' }} />
          </div>
          {bulkCount <= 1 && (
            <div>
              <label style={{ display: 'block', color: '#B0B3B8', fontSize: '12px', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase' }}>Table Name (Optional)</label>
              <input type="text" value={tableName} onChange={e => setTableName(e.target.value)} placeholder="e.g., Feature Table, VIP Table"
                style={{ width: '100%', height: '44px', padding: '0 12px', background: '#18191A', border: '1px solid #3A3B3C', borderRadius: '8px', color: '#E4E6EB', fontSize: '14px', outline: 'none' }} />
            </div>
          )}
          <div>
            <label style={{ display: 'block', color: '#B0B3B8', fontSize: '12px', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase' }}>Max Seats Per Table</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[6, 8, 9, 10].map(n => (
                <button key={n} type="button" onClick={() => setMaxSeats(n)}
                  style={{ flex: 1, padding: '8px', fontSize: '14px', fontWeight: 600, borderRadius: '6px', border: 'none', cursor: 'pointer', background: maxSeats === n ? '#1877F2' : '#3A3B3C', color: maxSeats === n ? '#fff' : '#B0B3B8' }}
                >{n}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, padding: '12px', background: '#3A3B3C', color: '#B0B3B8', fontWeight: 600, borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '14px' }}>Cancel</button>
            <button type="submit" disabled={submitting}
              style={{ flex: 2, padding: '12px', background: '#1877F2', color: '#fff', fontWeight: 700, borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '14px', opacity: submitting ? 0.5 : 1 }}>
              {submitting ? 'Adding...' : bulkCount > 1 ? `Add ${bulkCount} Tables` : 'Add Table'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatDuration(startTime) {
  const start = new Date(startTime);
  const now = new Date();
  const minutes = Math.floor((now - start) / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}
