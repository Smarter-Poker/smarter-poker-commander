/**
 * Poker Room Functions - Live Command Center
 * /commander/poker-room
 * Real-time room operations dashboard:
 * - Open/Close Room toggle
 * - Live table grid with game types, stakes, player counts
 * - Room statistics at a glance
 * - Quick actions for room-specific operations only
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Power, PowerOff, Users, Settings, Loader2, RefreshCw, LayoutGrid, Wifi, WifiOff, ArrowRightLeft, AlertTriangle, Zap, Trophy } from 'lucide-react';
import dynamic from 'next/dynamic';
const SkeletonDark = dynamic(() => import('../../src/components/ui/SkeletonDark'), { ssr: false });
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffData } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';

export default function PokerRoomFunctions() {

  useEffect(() => { busEmit.sessionStart('commander-poker-room'); }, []);
  const router = useRouter();
  const [roomOpen, setRoomOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [venueId, setVenueId] = useState(null);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Init venueId from localStorage
  useEffect(() => {
    try {
      const s = getStaffData();
      if (s.venue_id) setVenueId(s.venue_id);
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  }, []);

  const fetchData = useCallback(async (signal) => {
    try {
const headers = { };

      // Get settings (room open/close state + venue_id)
      const vRes = await commanderFetch('/api/commander/settings', { headers });
      if (!vRes.ok) throw new Error(`Request failed (${vRes.status})`);
      const vJson = await vRes.json();
      let vid = venueId;
      if (vJson.success && vJson.data) {
        setRoomOpen(vJson.data.room_open || false);
        vid = vJson.data.venue_id || vid;
        if (vid) setVenueId(vid);
      }

      // Fetch tables AND games data
      if (vid) {
        const [tabRes, gamesRes] = await Promise.all([
          commanderFetch(`/api/commander/tables?venue_id=${vid}`, { headers }).then(r => r.json()).catch(() => ({ success: false })),
          commanderFetch(`/api/commander/games/venue/${vid}`, { headers }).then(r => r.json()).catch(() => ({ success: false })),
        ]);

        if (tabRes.success) {
          let tList = tabRes.data?.tables || (Array.isArray(tabRes.data) ? tabRes.data : []);

          // Merge game data onto tables (same pattern as floor.js)
          const gamesArr = Array.isArray(gamesRes.data?.games) ? gamesRes.data.games
            : Array.isArray(gamesRes.data) ? gamesRes.data : [];
          const activeGames = gamesArr.filter(g => g.status === 'running' || g.status === 'waiting');

          if (tList.length > 0 && activeGames.length > 0) {
            tList = tList.map(t => {
              const game = activeGames.find(g => g.table_id === t.id);
              if (game) {
                return {
                  ...t, status: 'in_use',
                  game_type: (game.game_type || t.game_type || '').toUpperCase(),
                  stakes: game.stakes || t.stakes || '',
                  current_players: game.current_players || 0,
                  max_players: game.max_players || t.max_seats || 9 };
              }
              return t;
            });
          }

          setTables(tList);

          // Auto-open room if there are active tables/games but room shows closed
          const hasActiveGames = tList.some(t => t.status === 'in_use');
          if (hasActiveGames && !vJson.data?.room_open) {
            try {
              const res = await commanderFetch('/api/commander/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room_open: true })
              });
              if (res.ok) setRoomOpen(true);
            } catch { /* non-fatal auto-open */ }
          }
        }
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action Failed. Please Check Your Connection And Try Again.' }); }
    finally { setLoading(false); }
  }, [venueId]);

  useEffect(() => { const _c = new AbortController(); fetchData(_c.signal); const i = setInterval(() => fetchData(_c.signal), 30000); return () => { _c.abort(); clearInterval(i); }; }, [fetchData]);

  // Cross-tab + cross-device real-time sync
  useCommanderSync(venueId, fetchData, { entities: ['tables', 'games', 'waitlist', 'settings'] });

  const toggleRoom = async () => {
    setToggling(true);
    try {
const res = await commanderFetch('/api/commander/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_open: !roomOpen })
      });
      if (res.ok) {
        setRoomOpen(!roomOpen);
        broadcastChange('settings');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action Failed. Please Check Your Connection And Try Again.' }); }
    finally { setToggling(false); }
  };

  const activeTables = tables.filter(t => t.status === 'in_use');
  // Split by mode (set by table-assignments, synced to table_purpose)
  const cashTables = activeTables.filter(t => (t.mode || t.table_purpose || 'cash') !== 'tournament');
  const tournamentTables = activeTables.filter(t => (t.mode || t.table_purpose) === 'tournament');
  const cashSeated = cashTables.reduce((sum, t) => sum + (t.current_players || t.seated_count || 0), 0);
  const tournamentSeated = tournamentTables.reduce((sum, t) => sum + (t.current_players || t.seated_count || 0), 0);
  const totalSeated = cashSeated + tournamentSeated;
  const totalCapacity = tables.reduce((sum, t) => sum + (t.max_seats || 9), 0);
  const occupancyPct = totalCapacity > 0 ? Math.round((totalSeated / totalCapacity) * 100) : 0;

  // Group cash tables by game type
  const cashGameGroups = {};
  cashTables.forEach(t => {
    const game = t.game_type || t.commander_games?.game_type || 'Cash Game';
    const stakes = t.stakes || t.commander_games?.stakes || '';
    const key = `${game}${stakes ? ` ${stakes}` : ''}`;
    if (!cashGameGroups[key]) cashGameGroups[key] = { tables: 0, players: 0 };
    cashGameGroups[key].tables++;
    cashGameGroups[key].players += (t.current_players || t.seated_count || 0);
  });

  // Group tournament tables by game type
  const tournamentGameGroups = {};
  tournamentTables.forEach(t => {
    const game = t.game_type || t.commander_games?.game_type || 'Tournament';
    const stakes = t.stakes || t.commander_games?.stakes || '';
    const key = `${game}${stakes ? ` ${stakes}` : ''}`;
    if (!tournamentGameGroups[key]) tournamentGameGroups[key] = { tables: 0, players: 0 };
    tournamentGameGroups[key].tables++;
    tournamentGameGroups[key].players += (t.current_players || t.seated_count || 0);
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-[#18191A] p-4" style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ background: '#2A2B2C', height: 28, width: 220, borderRadius: 6, marginBottom: 8 }} />
          <div style={{ background: '#2A2B2C', height: 14, width: 140, borderRadius: 6 }} />
        </div>
        <SkeletonDark variant="stat-cards" count={4} />
        <div style={{ marginTop: 16 }}>
          <SkeletonDark variant="poker-room" count={6} rows={4} />
        </div>
      </div>
    );
  }

  return (
    <CommanderLayout title="Poker Room Functions" backHref="/commander/dashboard?card=staff">
      <>
        <SEOHead title="Commander - Poker Room Functions" description="Club Commander Poker Room Management Tool." noindex={true} />
        <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">

          {/* Room Status Banner */}
          <div className="px-4 pt-4 pb-2">
            <button onClick={toggleRoom} disabled={toggling}
              className={`w-full rounded-2xl border-2 p-5 flex items-center justify-between active:scale-[0.99] transition-transform ${roomOpen
                ? 'bg-[#31A24C]/10 border-[#31A24C]/40'
                : 'bg-[#EF4444]/10 border-[#EF4444]/40'
                }`}>
              <div className="flex items-center gap-4">
                {roomOpen
                  ? <div className="w-14 h-14 rounded-2xl bg-[#31A24C]/20 flex items-center justify-center">
                    <Wifi className="w-7 h-7 text-[#31A24C]" />
                  </div>
                  : <div className="w-14 h-14 rounded-2xl bg-[#EF4444]/20 flex items-center justify-center">
                    <WifiOff className="w-7 h-7 text-[#EF4444]" />
                  </div>
                }
                <div className="text-left">
                  <h2 className="text-xl font-bold text-white">
                    Room {roomOpen ? 'Open' : 'Closed'}
                  </h2>
                  <p className="text-sm text-[#B0B3B8]">
                    {roomOpen
                      ? `${activeTables.length} Tables Running • ${totalSeated} Seated`
                      : 'Tap To Open The Room'
                    }
                  </p>
                </div>
              </div>
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${roomOpen ? 'bg-[#EF4444]' : 'bg-[#31A24C]'}`}>
                {toggling
                  ? <Loader2 className="w-6 h-6 text-white animate-spin" />
                  : roomOpen
                    ? <PowerOff className="w-6 h-6 text-white" />
                    : <Power className="w-6 h-6 text-white" />
                }
              </div>
            </button>
          </div>

          {/* Live Stats Bar */}
          <div className="px-4 py-2">
            <div className="grid grid-cols-4 gap-2">
              <StatCard value={cashTables.length} label="Cash" icon={LayoutGrid} color="#31A24C" />
              <StatCard value={tournamentTables.length} label="Tourney" icon={Trophy} color="#F59E0B" />
              <StatCard value={totalSeated} label="Players" icon={Users} color="#1877F2" />
              <StatCard value={`${occupancyPct}%`} label="Full" icon={Zap}
                color={occupancyPct > 80 ? '#EF4444' : occupancyPct > 50 ? '#F59E0B' : '#31A24C'} />
            </div>
          </div>

          {/* Active Cash Games Breakdown */}
          {Object.keys(cashGameGroups || {}).length > 0 && (
            <div className="px-4 py-2">
              <h3 className="text-xs font-semibold text-[#31A24C] uppercase tracking-wider mb-2">Cash Games ({cashTables.length})</h3>
              <div className="space-y-1.5">
                {Object.entries(cashGameGroups || {}).map(([game, data]) => (
                  <div key={game} className="bg-[#242526] rounded-xl border border-[#3A3B3C] px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-[#31A24C] animate-pulse" />
                      <span className="text-sm font-medium text-white">{game}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-[#B0B3B8]">{data.tables} Table{data.tables !== 1 ? 's' : ''}</span>
                      <span className="text-sm font-bold text-[#1877F2]">{data.players} <span className="text-[#B0B3B8] font-normal text-xs">Players</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tournament Tables Breakdown */}
          {Object.keys(tournamentGameGroups || {}).length > 0 && (
            <div className="px-4 py-2">
              <h3 className="text-xs font-semibold text-[#F59E0B] uppercase tracking-wider mb-2">Tournament Tables ({tournamentTables.length})</h3>
              <div className="space-y-1.5">
                {Object.entries(tournamentGameGroups || {}).map(([game, data]) => (
                  <div key={game} className="bg-[#242526] rounded-xl border border-[#F59E0B]/20 px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse" />
                      <span className="text-sm font-medium text-white">{game}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-[#B0B3B8]">{data.tables} Table{data.tables !== 1 ? 's' : ''}</span>
                      <span className="text-sm font-bold text-[#F59E0B]">{data.players} <span className="text-[#B0B3B8] font-normal text-xs">Players</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Table Grid */}
          <div className="px-4 py-2">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-[#B0B3B8] uppercase tracking-wider">Table Floor</h3>
              <button onClick={fetchData} className="flex items-center gap-1 text-xs text-[#1877F2] active:text-[#1565D8]">
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>

            {tables.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {tables
                  .sort((a, b) => (a.table_number || 0) - (b.table_number || 0))
                  .map(table => {
                    const isActive = table.status === 'in_use';
                    const players = table.current_players || table.seated_count || 0;
                    const maxSeats = table.max_seats || 9;
                    const fillPct = maxSeats > 0 ? Math.round((players / maxSeats) * 100) : 0;
                    const game = table.game_type || table.commander_games?.game_type || '';
                    const stakes = table.stakes || table.commander_games?.stakes || '';

                    return (
                      <button key={table.id || table.table_number}
                        onClick={() => router.push(`/commander/table/${table.id || table.table_number}`)}
                        className={`rounded-xl border p-3 text-center active:scale-[0.97] transition-transform relative ${isActive
                          ? (table.mode || table.table_purpose) === 'tournament'
                            ? 'bg-[#242526] border-[#F59E0B]/30'
                            : 'bg-[#242526] border-[#31A24C]/30'
                          : 'bg-[#1E1F20] border-[#3A3B3C]/50 opacity-50'
                          }`}>
                        {/* Purpose badge */}
                        <div className={`absolute top-1 right-1 text-[8px] font-bold px-1.5 py-0.5 rounded-md ${(table.mode || table.table_purpose) === 'tournament'
                          ? 'bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/30'
                          : 'bg-[#31A24C]/15 text-[#31A24C] border border-[#31A24C]/30'
                          }`}>{(table.mode || table.table_purpose) === 'tournament' ? 'T' : 'C'}</div>
                        <div className="text-lg font-bold text-white">T{table.table_number}</div>
                        {isActive ? (
                          <>
                            <div className={`text-xl font-black ${fillPct >= 90 ? 'text-[#EF4444]' :
                              fillPct >= 60 ? 'text-[#F59E0B]' : 'text-[#31A24C]'
                              }`}>
                              {players}/{maxSeats}
                            </div>
                            {game && <div className="text-[9px] text-[#B0B3B8] truncate mt-0.5">{game}</div>}
                            {stakes && <div className={`text-[10px] font-medium ${(table.mode || table.table_purpose) === 'tournament' ? 'text-[#F59E0B]' : 'text-[#31A24C]'}`}>{stakes}</div>}
                            {/* Fill bar */}
                            <div className="mt-1.5 h-1 bg-[#3A3B3C] rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${fillPct >= 90 ? 'bg-[#EF4444]' :
                                fillPct >= 60 ? 'bg-[#F59E0B]' : 'bg-[#31A24C]'
                                }`} style={{ width: `${fillPct}%` }} />
                            </div>
                          </>
                        ) : (
                          <div className="text-xs text-[#666] mt-1">
                            {table.status === 'maintenance' ? 'Maintenance' :
                              table.status === 'reserved' ? 'Reserved' : 'Available'}
                          </div>
                        )}
                      </button>
                    );
                  })}
              </div>
            ) : (
              <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-8 text-center">
                <LayoutGrid className="w-10 h-10 text-[#3A3B3C] mx-auto mb-2" />
                <p className="text-[#B0B3B8] text-sm">No Tables Configured</p>
                <button onClick={() => router.push('/commander/tables')}
                  className="mt-3 px-4 py-2 rounded-lg bg-[#1877F2] text-white text-sm font-medium active:bg-[#1565D8]">
                  Set Up Tables
                </button>
              </div>
            )}
          </div>

          {/* Quick Actions - Room-specific only */}
          <div className="px-4 py-3">
            <h3 className="text-xs font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              <QuickAction icon={LayoutGrid} label="Manage Tables" desc="Add, Edit, Close Tables" path="/commander/tables" router={router} />
              <QuickAction icon={ArrowRightLeft} label="Must-Move" desc="Move Players Between Games" path="/commander/must-move" router={router} />
              <QuickAction icon={Users} label="Waitlists" desc="Manage Game Waitlists" path="/commander/waitlist/desk" router={router} />
              <QuickAction icon={Settings} label="Room Presets" desc="Game Configs & Defaults" path="/commander/room-presets" router={router} />
            </div>
          </div>

          {/* Capacity Alert */}
          {occupancyPct >= 80 && roomOpen && (
            <div className="px-4 pb-4">
              <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl px-4 py-3 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-[#F59E0B] flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-[#F59E0B]">High Occupancy</p>
                  <p className="text-xs text-[#B0B3B8]">{occupancyPct}% Of Seats Filled - Consider Opening More Tables</p>
                </div>
              </div>
            </div>
          )}

        </div>
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
    </CommanderLayout>
  );
}

function StatCard({ value, label, icon: Icon, color }) {
  return (
    <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-2.5 text-center">
      <Icon className="w-4 h-4 mx-auto mb-1" style={{ color }} />
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-[9px] text-[#B0B3B8] uppercase">{label}</p>
    </div>
  );
}

function QuickAction({ icon: Icon, label, desc, path, router }) {
  return (
    <button onClick={() => router.push(path)}
      className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-3.5 flex items-start gap-3 active:bg-[#3A3B3C] text-left">
      <div className="w-9 h-9 rounded-lg bg-[#1877F2]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-4.5 h-4.5 text-[#1877F2]" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-[10px] text-[#B0B3B8]">{desc}</p>
      </div>
    </button>
  );
}
