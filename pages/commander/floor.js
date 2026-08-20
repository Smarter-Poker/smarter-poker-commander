/**
 * Spatial Floor Map - Drag-&-Drop Canvas
 * /commander/floor
 *
 * A 2D canvas where poker table ovals are positioned to
 * mirror the physical room layout. Staff can:
 *  - Toggle Edit Mode to drag tables into position
 *  - Save the layout (position_x/y persisted to Supabase)
 *  - View live game status, seats, and elapsed time
 *  - Tap a table for details in View Mode
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { busEmit } from '../../src/engine/EventBus';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { RefreshCw, Users, Loader2, Lock, Unlock, Save, AlertTriangle, Activity, X, Clock, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';

const STATUS_CONFIG = {
  in_use: { color: '#31A24C', glow: '0 0 12px rgba(49,162,76,0.5)', label: 'Active' },
  available: { color: '#1877F2', glow: '0 0 8px rgba(24,119,242,0.3)', label: 'Open' },
  reserved: { color: '#F59E0B', glow: '0 0 8px rgba(245,158,11,0.3)', label: 'Reserved' },
  maintenance: { color: '#6B7280', glow: '0 0 6px rgba(107,114,128,0.2)', label: 'Maintenance' },
  breaking: { color: '#EF4444', glow: '0 0 8px rgba(239,68,68,0.3)', label: 'Breaking' } };

const GAME_COLORS = {
  'NLH': '#1877F2', 'PLO': '#31A24C', 'MIXED': '#F59E0B',
  'TOURNAMENT': '#A855F7', 'OMAHA': '#EF4444', 'NLO': '#22D3EE' };

const TABLE_WIDTH = 150;
const TABLE_HEIGHT = 100;
const GRID_COLS = 5;

export default function FloorMap() {
  const router = useRouter();

  // ── EventBus: Commander session telemetry ──

  useEffect(() => { busEmit.sessionStart('commander-floor'); }, []);
  const canvasRef = useRef(null);
  const [tables, setTables] = useState([]);
  const [waitlists, setWaitlists] = useState({});
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [venueId, setVenueId] = useState(null);
  const [venueName, setVenueName] = useState('');
  const [now, setNow] = useState(new Date());
  const [selectedTable, setSelectedTable] = useState(null);
  const [zoom, setZoom] = useState(1);

  // Drag state
  const [draggingId, setDraggingId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [positions, setPositions] = useState({}); // { table_id: { x, y } }
  const [hasChanges, setHasChanges] = useState(false);
  const [rotations, setRotations] = useState({}); // { table_id: degrees }

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Auth
  useEffect(() => {
    try {
      const staff = getStaffSession();
      if (!staff) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
      const parsed = JSON.parse(staff);
      if (!parsed.venue_id) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
      setVenueId(parsed.venue_id);
      setVenueName(parsed.venue_name || '');
    } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
  }, [router]);

  const getHeaders = () => {
return { };
  };

  const fetchAll = useCallback(async () => {
    const controller = new AbortController();
    const { signal } = controller;
    if (!venueId) return;
    try {
      const headers = getHeaders();
      // 2026-08-20 audit fix: these three used bare fetch with an empty header
      // bag, which only worked because the routes were unauthenticated. They
      // now require a staff session, so go through commanderFetch (which
      // injects x-staff-session and the Bearer token).
      const [tablesRes, waitlistRes, gamesRes] = await Promise.all([
        commanderFetch(`/api/commander/tables?venue_id=${venueId}`, { headers }).then(r => r.json()).catch(() => ({ success: false })),
        commanderFetch(`/api/commander/waitlist?venue_id=${venueId}`, { headers }).then(r => r.json()).catch(() => ({ success: false })),
        commanderFetch(`/api/commander/games/venue/${venueId}`, { headers }).then(r => r.json()).catch(() => ({ success: false })),
      ]);

      let rawTables = Array.isArray(tablesRes.data) ? tablesRes.data : (tablesRes.data?.tables || []);

      // Merge game data
      const gamesArr = Array.isArray(gamesRes.data?.games) ? gamesRes.data.games
        : Array.isArray(gamesRes.data) ? gamesRes.data : [];
      const activeGames = gamesArr.filter(g => g.status === 'running' || g.status === 'waiting');

      if (rawTables.length > 0 && activeGames.length > 0) {
        rawTables = rawTables.map(t => {
          const game = activeGames.find(g => g.table_id === t.id);
          if (game) {
            return {
              ...t, status: 'in_use',
              game_type: (game.game_type || t.game_type || '').toUpperCase(),
              stakes: game.stakes || t.stakes || '',
              current_players: game.current_players || 0,
              max_players: game.max_players || t.max_seats || 9,
              game_started_at: game.started_at || game.created_at };
          }
          return t;
        });
      }

      setTables(rawTables);

      // Initialize positions from saved data or auto-grid
      const posMap = {};
      rawTables.forEach((t, idx) => {
        if (t.position_x != null && t.position_y != null) {
          posMap[t.id] = { x: t.position_x, y: t.position_y };
        } else {
          // Auto-grid: 5 columns, spaced 180px apart
          const col = idx % GRID_COLS;
          const row = Math.floor(idx / GRID_COLS);
          posMap[t.id] = { x: 40 + col * 190, y: 40 + row * 140 };
        }
      });
      setPositions(prev => {
        // Only set if we don't have positions yet or table count changed
        if (Object.keys(prev || {}).length === 0 || Object.keys(prev || {}).length !== rawTables.length) {
          return posMap;
        }
        return prev;
      });

      // Load saved rotations
      const rotMap = {};
      rawTables.forEach(t => { rotMap[t.id] = t.rotation || 0; });
      setRotations(prev => Object.keys(prev || {}).length === 0 ? rotMap : prev);

      if (waitlistRes.success) {
        const grouped = {};
        const arr = Array.isArray(waitlistRes.data) ? waitlistRes.data : [];
        arr.filter(w => w.status === 'waiting').forEach(w => {
          const game = (w.game_type || 'Unknown').toUpperCase();
          grouped[game] = (grouped[game] || 0) + 1;
        });
        setWaitlists(grouped);
      }
    } catch (err) { console.warn('Floor fetch error:', err); }
    finally { setLoading(false); }
  }, [venueId]);

  useEffect(() => { if (venueId) fetchAll(); }, [venueId, fetchAll]);
  useEffect(() => {
    if (!venueId) return;
    const poll = setInterval(fetchAll, 30000); // fallback - real-time sync handles instant updates
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [venueId, fetchAll]);

  // Cross-tab + cross-device real-time sync
  useCommanderSync(venueId, fetchAll, { entities: ['tables', 'games', 'waitlist', 'dealers'] });

  // Save positions to API
  const savePositions = async () => {
    setSaving(true);
    try {
      const headers = { ...getHeaders(), 'Content-Type': 'application/json' };
      await Promise.all(tables.map(t => {
        const pos = positions[t.id];
        if (!pos) return Promise.resolve();
        const rot = rotations[t.id] || 0;
        return commanderFetch(`/api/commander/tables/${t.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position_x: pos.x, position_y: pos.y, rotation: rot }) }).then(r => { if (!r.ok) throw new Error('fail'); return r; });
      }));
      setHasChanges(false);
      setSaved(true);
      busEmit.celebration('confetti');
      setTimeout(() => setSaved(false), 2000);
      broadcastChange('tables');
    } catch (err) { console.warn('Save error:', err); setToast({ type: 'error', text: 'Action failed: Save. Please try again.' }); }
    finally { setSaving(false); }
  };

  // Drag handlers - works for both mouse and touch
  const getEventPos = (e) => {
    if (e.touches && e.touches.length > 0) {
      return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    }
    return { clientX: e.clientX, clientY: e.clientY };
  };

  const handleDragStart = (e, tableId) => {
    if (!editMode) return;
    e.preventDefault();
    const pos = positions[tableId] || { x: 0, y: 0 };
    const { clientX, clientY } = getEventPos(e);
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const scrollTop = canvasRef.current?.scrollTop || 0;
    const scrollLeft = canvasRef.current?.scrollLeft || 0;
    setDraggingId(tableId);
    setDragOffset({
      x: clientX - (canvasRect?.left || 0) + scrollLeft - pos.x * zoom,
      y: clientY - (canvasRect?.top || 0) + scrollTop - pos.y * zoom });
  };

  const handleDragMove = useCallback((e) => {
    if (!draggingId || !canvasRef.current) return;
    e.preventDefault();
    const { clientX, clientY } = getEventPos(e);
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const scrollTop = canvasRef.current.scrollTop || 0;
    const scrollLeft = canvasRef.current.scrollLeft || 0;
    const newX = (clientX - canvasRect.left + scrollLeft - dragOffset.x) / zoom;
    const newY = (clientY - canvasRect.top + scrollTop - dragOffset.y) / zoom;
    setPositions(prev => ({
      ...prev,
      [draggingId]: { x: Math.max(0, newX), y: Math.max(0, newY) } }));
    setHasChanges(true);
  }, [draggingId, dragOffset, zoom]);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
  }, []);

  useEffect(() => {
    if (draggingId) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove, { passive: false });
      window.addEventListener('touchend', handleDragEnd);
      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
        window.removeEventListener('touchmove', handleDragMove);
        window.removeEventListener('touchend', handleDragEnd);
      };
    }
  }, [draggingId, handleDragMove, handleDragEnd]);

  // Computed stats
  const activeTables = tables.filter(t => t.status === 'in_use');
  const activeCount = activeTables.length;
  const cashActive = activeTables.filter(t => (t.mode || t.table_purpose || 'cash') !== 'tournament').length;
  const tournamentActive = activeTables.filter(t => (t.mode || t.table_purpose) === 'tournament').length;
  const openCount = tables.filter(t => t.status === 'available').length;
  const totalSeats = tables.reduce((s, t) => s + (t.max_seats || 9), 0);
  const occupiedSeats = tables.reduce((s, t) => s + (t.current_players || 0), 0);
  const totalWaiting = Object.values(waitlists || {}).reduce((s, n) => s + n, 0);

  const getElapsed = (startedAt) => {
    if (!startedAt) return '';
    const diff = Math.floor((now - new Date(startedAt)) / 1000);
    if (diff < 0) return '';
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  // Canvas dimensions based on furthest table position
  const canvasWidth = Math.max(980, ...Object.values(positions || {}).map(p => p.x + TABLE_WIDTH + 60));
  const canvasHeight = Math.max(600, ...Object.values(positions || {}).map(p => p.y + TABLE_HEIGHT + 60));

  return (
    <CommanderLayout title="Floor Map" backHref="/commander/dashboard?card=floor">
      <SEOHead title="Commander - Floor Map" description="Spatial Poker Room Floor Map." noindex={true} />
      <div style={{ minHeight: '100vh', background: '#0D0E10', color: '#E4E6EB', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>

        {/* Top bar */}
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#18191A', borderBottom: '1px solid #2A2B2D', flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Activity size={16} color="#31A24C" /> Floor Map
            </h1>
            <p style={{ fontSize: 11, color: '#6A6B6D', margin: 0 }}>
              {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {tables.length} Tables
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Zoom controls */}
            <button onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} style={btnStyle}>
              <ZoomOut size={14} color="#B0B3B8" />
            </button>
            <span style={{ fontSize: 11, color: '#8A8D91', minWidth: 36, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(1.5, z + 0.1))} style={btnStyle}>
              <ZoomIn size={14} color="#B0B3B8" />
            </button>
            <div style={{ width: 1, height: 20, background: '#3A3B3C', margin: '0 4px' }} />

            {/* Edit/View toggle */}
            <button onClick={() => { setEditMode(!editMode); setSelectedTable(null); }}
              title={editMode ? 'Lock Layout' : 'Unlock To Edit'}
              style={{
                background: 'none', border: 'none', padding: 6,
                cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              {editMode ? <Unlock size={22} color="#F59E0B" /> : <Lock size={22} color="#8A8D91" />}
            </button>

            {/* Save button (only in edit mode with changes) */}
            {editMode && hasChanges && (
              <button onClick={savePositions} disabled={saving}
                style={{ ...btnStyle, background: '#1877F2', border: '1px solid #1877F2', padding: '6px 12px', display: 'flex', gap: 4, alignItems: 'center' }}>
                {saving ? <Loader2 size={14} color="#fff" style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} color="#fff" />}
                <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>{saving ? 'Saving...' : 'Save'}</span>
              </button>
            )}
            {saved && (
              <span style={{ fontSize: 11, color: '#31A24C', fontWeight: 600 }}>✓ Saved</span>
            )}

            <button onClick={fetchAll} style={btnStyle}>
              <RefreshCw size={14} color="#B0B3B8" />
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{ padding: '8px 16px', display: 'flex', gap: 12, background: '#18191A', borderBottom: '1px solid #2A2B2D', flexShrink: 0 }}>
          <StatPill label="Cash" value={cashActive} color="#31A24C" />
          <StatPill label="Tourney" value={tournamentActive} color="#F59E0B" />
          <StatPill label="Open" value={openCount} color="#1877F2" />
          <StatPill label="Seats" value={`${occupiedSeats}/${totalSeats}`} color="#E4E6EB" />
          {totalWaiting > 0 && <StatPill label="Waiting" value={totalWaiting} color="#F59E0B" />}
          {Object.entries(waitlists || {}).map(([g, c]) => (
            <span key={g} style={{ fontSize: 11, color: '#F59E0B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={10} /> {g}: {c}
            </span>
          ))}
        </div>

        {/* Canvas area */}
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Loader2 size={32} color="#1877F2" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : (
          <div ref={canvasRef} style={{
            flex: 1, overflow: 'auto', position: 'relative',
            touchAction: editMode ? 'none' : 'auto', overscrollBehavior: 'none',
            background: `
              radial-gradient(circle at 50% 50%, rgba(24,119,242,0.03) 0%, transparent 70%),
              linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px),
              #0D0E10
            `,
            backgroundSize: '100% 100%, 40px 40px, 40px 40px',
            cursor: editMode ? 'crosshair' : 'default' }}>
            <div style={{ width: canvasWidth * zoom, height: canvasHeight * zoom, position: 'relative', transformOrigin: '0 0' }}>
              {tables.map(table => {
                const tNum = table.table_number || table.number;
                const status = table.status || 'available';
                const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.available;
                const gameType = (table.game_type || '').toUpperCase();
                const gameColor = GAME_COLORS[gameType] || '#B0B3B8';
                const maxSeats = table.max_seats || 9;
                const occupied = table.current_players || 0;
                const isActive = status === 'in_use';
                const pos = positions[table.id] || { x: 0, y: 0 };
                const rot = rotations[table.id] || 0;
                const isDragging = draggingId === table.id;
                const elapsed = isActive ? getElapsed(table.game_started_at) : '';

                return (
                  <div key={table.id}
                    onMouseDown={(e) => handleDragStart(e, table.id)}
                    onTouchStart={(e) => handleDragStart(e, table.id)}
                    onClick={() => { if (!editMode && !draggingId) setSelectedTable(selectedTable?.id === table.id ? null : table); }}
                    style={{
                      position: 'absolute',
                      left: pos.x * zoom,
                      top: pos.y * zoom,
                      width: TABLE_WIDTH * zoom,
                      height: TABLE_HEIGHT * zoom,
                      transform: rot ? `rotate(${rot}deg)` : undefined,
                      transformOrigin: 'center center',
                      cursor: editMode ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
                      zIndex: isDragging ? 100 : isActive ? 2 : 1,
                      transition: isDragging ? 'none' : 'box-shadow 0.2s, transform 0.3s',
                      userSelect: 'none',
                      WebkitUserSelect: 'none' }}>
                    {/* Table oval */}
                    <div style={{
                      width: '100%', height: '100%',
                      borderRadius: '50%',
                      background: isActive
                        ? `radial-gradient(ellipse, rgba(26,92,42,0.9) 0%, rgba(13,51,24,0.95) 100%)`
                        : status === 'reserved'
                          ? `radial-gradient(ellipse, rgba(80,60,10,0.6) 0%, rgba(40,30,5,0.8) 100%)`
                          : status === 'maintenance'
                            ? `radial-gradient(ellipse, rgba(50,50,50,0.6) 0%, rgba(30,30,30,0.8) 100%)`
                            : `radial-gradient(ellipse, rgba(30,50,80,0.5) 0%, rgba(15,25,40,0.7) 100%)`,
                      border: `2px solid ${cfg.color}${isActive ? 'AA' : '55'}`,
                      boxShadow: isDragging ? `0 8px 32px rgba(0,0,0,0.5), ${cfg.glow}` : cfg.glow,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      padding: `${4 * zoom}px`,
                      position: 'relative',
                      overflow: 'hidden' }}>
                      {/* Gold rim for active tables */}
                      {isActive && (
                        <div style={{
                          position: 'absolute', inset: 2, borderRadius: '50%',
                          border: '1px solid rgba(180,150,60,0.3)',
                          pointerEvents: 'none' }} />
                      )}

                      {/* Table number */}
                      <div style={{ fontSize: Math.max(10, 16 * zoom), fontWeight: 800, color: '#fff', lineHeight: 1, textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
                        T{tNum}
                      </div>

                      {/* Game type + stakes (active) or status (idle) */}
                      {isActive && gameType ? (
                        <div style={{ fontSize: Math.max(8, 10 * zoom), fontWeight: 700, color: gameColor, marginTop: 2 * zoom, textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                          {gameType} {table.stakes || ''}
                        </div>
                      ) : (
                        <div style={{ fontSize: Math.max(7, 9 * zoom), fontWeight: 600, color: cfg.color, marginTop: 2 * zoom, opacity: 0.8 }}>
                          {cfg.label}
                        </div>
                      )}

                      {/* Seat count */}
                      <div style={{ fontSize: Math.max(8, 10 * zoom), color: isActive ? '#fff' : '#8A8D91', fontWeight: 600, marginTop: 2 * zoom, display: 'flex', alignItems: 'center', gap: 2 * zoom }}>
                        <Users size={Math.max(7, 9 * zoom)} /> {occupied}/{maxSeats}
                      </div>

                      {/* Purpose badge */}
                      {(table.mode || table.table_purpose) === 'tournament' && (
                        <div style={{
                          position: 'absolute', top: 2 * zoom, right: 6 * zoom,
                          fontSize: Math.max(7, 8 * zoom), fontWeight: 800,
                          color: '#F59E0B', background: 'rgba(245,158,11,0.15)',
                          padding: `${1 * zoom}px ${3 * zoom}px`, borderRadius: 3 * zoom,
                          border: '1px solid rgba(245,158,11,0.3)',
                          lineHeight: 1, letterSpacing: 0.5 }}>T</div>
                      )}
                    </div>

                    {/* Edit mode: drag handle + rotate button */}
                    {editMode && (
                      <>
                        <div style={{
                          position: 'absolute', top: -4, right: -4,
                          width: 12, height: 12, borderRadius: 6,
                          background: '#F59E0B', border: '2px solid #0D0E10',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }} />
                        <button
                          onClick={(e) => { e.stopPropagation(); setRotations(prev => ({ ...prev, [table.id]: ((prev[table.id] || 0) + 90) % 360 })); setHasChanges(true); }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          style={{
                            position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)',
                            width: 22, height: 22, borderRadius: 11,
                            background: '#1877F2', border: '2px solid #0D0E10',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', zIndex: 10, padding: 0,
                            boxShadow: '0 2px 6px rgba(0,0,0,0.5)' }}>
                          <RotateCw size={11} color="#fff" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Table detail popup */}
        {selectedTable && !editMode && (
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            background: '#242526', borderTop: '2px solid #3A3B3C',
            borderRadius: '16px 16px 0 0', padding: '16px 20px',
            boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
            zIndex: 50 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: 0 }}>
                  Table {selectedTable.table_number}
                </h3>
                {selectedTable.table_name && selectedTable.table_name !== `Table ${selectedTable.table_number}` && (
                  <p style={{ fontSize: 12, color: '#8A8D91', margin: 0 }}>{selectedTable.table_name}</p>
                )}
              </div>
              <button onClick={() => setSelectedTable(null)} style={{ ...btnStyle, padding: 6 }}>
                <X size={16} color="#B0B3B8" />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {(() => {
                const status = selectedTable.status || 'available';
                const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.available;
                const isActive = status === 'in_use';
                const gameType = (selectedTable.game_type || '').toUpperCase();
                const gameColor = GAME_COLORS[gameType] || '#B0B3B8';
                const maxSeats = selectedTable.max_seats || 9;
                const occupied = selectedTable.current_players || 0;
                const elapsed = isActive ? getElapsed(selectedTable.game_started_at) : '';

                return (
                  <>
                    <div style={{ background: `${cfg.color}15`, border: `1px solid ${cfg.color}40`, borderRadius: 10, padding: '8px 14px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: cfg.color, textTransform: 'uppercase' }}>{cfg.label}</div>
                    </div>
                    {isActive && gameType && (
                      <div style={{ background: `${gameColor}15`, border: `1px solid ${gameColor}40`, borderRadius: 10, padding: '8px 14px' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: gameColor }}>{gameType} {selectedTable.stakes || ''}</div>
                      </div>
                    )}
                    <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Users size={14} color="#B0B3B8" />
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{occupied}/{maxSeats}</span>
                      {occupied < maxSeats && occupied > 0 && (
                        <span style={{ fontSize: 11, color: '#31A24C' }}>{maxSeats - occupied} Open</span>
                      )}
                    </div>
                    {elapsed && (
                      <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Clock size={14} color="#8A8D91" />
                        <span style={{ fontSize: 12, color: '#8A8D91' }}>Running {elapsed}</span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button onClick={() => router.push(`/commander/tables`)}
                style={{ flex: 1, padding: '10px 16px', borderRadius: 10, background: '#1877F2', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                Open Tables & Floor
              </button>
              <button onClick={() => router.push(`/commander/table-tablets`)}
                style={{ flex: 1, padding: '10px 16px', borderRadius: 10, background: '#242526', color: '#B0B3B8', fontSize: 13, fontWeight: 600, border: '1px solid #3A3B3C', cursor: 'pointer' }}>
                Table Tablets
              </button>
            </div>
          </div>
        )}

        {/* Edit mode instructions */}
        {editMode && (
          <div style={{
            position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 12, padding: '8px 20px', zIndex: 40,
            display: 'flex', alignItems: 'center', gap: 8,
            backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
            <Unlock size={14} color="#F59E0B" />
            <span style={{ fontSize: 12, color: '#F59E0B', fontWeight: 600 }}>
              Drag Tables To Match Your Room Layout · {hasChanges ? 'Unsaved Changes' : 'No Changes'}
            </span>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    
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

// Helper: stat pill
function StatPill({ label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 16, fontWeight: 800, color }}>{value}</span>
      <span style={{ fontSize: 10, color: '#6A6B6D', fontWeight: 600, textTransform: 'uppercase' }}>{label}</span>
    </div>
  );
}

// Shared button style
const btnStyle = {
  width: 32, height: 32, borderRadius: 8,
  background: '#242526', border: '1px solid #3A3B3C',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', flexShrink: 0 };
