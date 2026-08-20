/**
 * Lobby Display
 * /commander/lobby
 * 
 * Full-screen TV display for poker room lobby/entrance.
 * Walk-in players see at a glance:
 * - All currently running cash games with stakes
 * - Number of seats available per table
 * - Waitlist count per game type
 * - Active tournaments with status
 * - Current promotions / high hand
 * 
 * Auto-refreshes, wake lock, fullscreen on tap.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import useWakeLock from '../../src/hooks/useWakeLock';
import { useCommanderSync } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getVenueId } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';

export default function LobbyDisplay() {
  useEffect(() => { busEmit.sessionStart('commander-lobby'); }, []);
  const router = useRouter();
  const [tables, setTables] = useState([]);
  const [waitlists, setWaitlists] = useState({});
  const [tournaments, setTournaments] = useState([]);
  const [now, setNow] = useState(new Date());
  useWakeLock();
  const [venueId] = useState(() => {
    return getVenueId();
  });

  const fetchData = useCallback(async (signal) => {
    if (!venueId) return;
    try {
const headers = { };
      const opts = signal ? { headers, signal } : { headers };
      // 2026-08-20 audit fix: the tables and waitlist reads used bare fetch with
      // no auth headers, which only worked because those routes were public
      // (the waitlist one leaked player phone numbers). They now require a
      // staff session, so route them through commanderFetch.
      const [tablesRes, waitlistRes, tournamentsRes] = await Promise.all([
        commanderFetch(`/api/commander/tables?venue_id=${venueId}`, opts).then(r => r.json()).catch(() => ({ data: [] })),
        commanderFetch(`/api/commander/waitlist?venue_id=${venueId}`, opts).then(r => r.json()).catch(() => ({ data: [] })),
        commanderFetch(`/api/commander/tournaments?venue_id=${venueId}`, opts).then(r => r.json()).catch(() => ({ data: [] }))
      ]);

      // Tables: data may be {tables: []} or array directly
      const tablesArr = Array.isArray(tablesRes.data) ? tablesRes.data
        : Array.isArray(tablesRes.data?.tables) ? tablesRes.data.tables : [];
      setTables(tablesArr);

      // Group waitlists by game type
      const grouped = {};
      const waitlistArr = Array.isArray(waitlistRes.data) ? waitlistRes.data : [];
      waitlistArr.filter(w => w.status === 'waiting').forEach(w => {
        const game = w.game_type || 'Unknown';
        grouped[game] = (grouped[game] || 0) + 1;
      });
      setWaitlists(grouped);

      // Tournaments API nests under data.tournaments - handle both shapes
      const tournamentsArr = Array.isArray(tournamentsRes.data) ? tournamentsRes.data
        : Array.isArray(tournamentsRes.data?.tournaments) ? tournamentsRes.data.tournaments : [];
      setTournaments(tournamentsArr.filter(t =>
        ['scheduled', 'registering', 'registration', 'running', 'break', 'final_table'].includes(t.status)
      ).slice(0, 4));
    } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
    setNow(new Date());
  }, [venueId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    const poll = setInterval(fetchData, 30000); // fallback - real-time sync handles instant updates
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { controller.abort(); clearInterval(poll); clearInterval(clock); };
  }, [fetchData]);

  // Cross-tab + cross-device real-time sync
  useCommanderSync(venueId, fetchData, { entities: ['tables', 'waitlist', 'games', 'tournaments'] });

  const goFullscreen = () => document.documentElement.requestFullscreen?.();

  // Group active tables by game type
  const activeTables = tables.filter(t => t.status === 'active');
  const gameGroups = {};
  activeTables.forEach(t => {
    const key = `${t.game_type || 'Cash'} ${t.stakes || ''}`.trim();
    if (!gameGroups[key]) gameGroups[key] = { tables: [], totalSeats: 0, openSeats: 0 };
    gameGroups[key].tables.push(t);
    const max = t.max_seats || t.seats || 9;
    const occupied = t.occupied_seats || t.player_count || 0;
    gameGroups[key].totalSeats += max;
    gameGroups[key].openSeats += (max - occupied);
  });

  const GAME_COLORS = {
    'NLH': '#1877F2', 'PLO': '#31A24C', 'Mixed': '#F59E0B',
    'Omaha': '#EF4444', 'Stud': '#A855F7', 'Cash': '#B0B3B8'
  };

  const getGameColor = (name) => {
    for (const [key, color] of Object.entries(GAME_COLORS || {})) {
      if (name.includes(key)) return color;
    }
    return '#1877F2';
  };

  return (
    <>
      <SEOHead
        title="Commander - Player Lobby"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <style>{`
        * { cursor: none !important; }
        body { overflow: hidden; }
        @keyframes scroll-left { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .ticker { animation: scroll-left 30s linear infinite; }
      `}</style>

      <div onClick={goFullscreen}
        className="h-screen bg-black text-white font-['Inter'] select-none flex flex-col">

        {/* Header */}
        <div className="bg-[#1877F2] px-8 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Now Playing</h1>
            <p className="text-sm opacity-80">{activeTables.length} Tables Running, {Object.keys(waitlists || {}).length > 0 ? `${Object.values(waitlists || {}).reduce((s, n) => s + n, 0)} On Waitlist` : 'No Waitlist'}</p>
          </div>
          <p className="text-4xl font-mono font-bold tabular-nums">
            {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>

        {/* Main content */}
        <div className="flex-1 flex overflow-hidden">

          {/* left: Running Games */}
          <div className="flex-1 p-6 overflow-y-auto">
            {Object.keys(gameGroups || {}).length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <p className="text-4xl font-bold text-white/20 mb-2">No Games Running</p>
                  <p className="text-lg text-white/10">Check Back Soon</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(gameGroups || {}).map(([gameName, group]) => {
                  const color = getGameColor(gameName);
                  return (
                    <div key={gameName} className="rounded-xl border border-white/10 overflow-hidden">
                      {/* Game header */}
                      <div className="px-6 py-3 flex items-center justify-between"
                        style={{ backgroundColor: `${color}20` }}>
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: color }} />
                          <h2 className="text-xl font-bold text-white">{gameName}</h2>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-white/60">{group.tables.length} Table{group.tables.length > 1 ? 's' : ''}</span>
                          {group.openSeats > 0 ? (
                            <span className="px-3 py-1 rounded-full text-sm font-bold" style={{ backgroundColor: `${color}30`, color }}>
                              {group.openSeats} Open Seat{group.openSeats > 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span className="px-3 py-1 rounded-full text-sm font-bold bg-white/5 text-white/40">
                              Full
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Individual tables */}
                      <div className="divide-y divide-white/5">
                        {group.tables.map(t => {
                          const tNum = t.table_number || t.number;
                          const max = t.max_seats || t.seats || 9;
                          const occupied = t.occupied_seats || t.player_count || 0;
                          const open = max - occupied;
                          return (
                            <div key={t.id || tNum} className="px-6 py-3 flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <span className="text-lg font-bold text-white/80 w-20">Table {tNum}</span>
                                {/* Seat dots */}
                                <div className="flex gap-1">
                                  {Array.from({ length: max }).map((_, i) => (
                                    <div key={i} className={`w-3 h-3 rounded-full ${i < occupied ? 'bg-white/60' : 'bg-white/10'
                                      }`} />
                                  ))}
                                </div>
                              </div>
                              <span className={`text-sm font-medium ${open > 0 ? 'text-white/60' : 'text-white/20'}`}>
                                {occupied}/{max}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right sidebar: Waitlists + Tournaments */}
          <div className="w-80 border-l border-white/10 flex flex-col">

            {/* Waitlist */}
            <div className="p-4 border-b border-white/10">
              <h3 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">Waitlist</h3>
              {Object.keys(waitlists || {}).length === 0 ? (
                <p className="text-sm text-white/20">No One Waiting</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(waitlists || {}).map(([game, count]) => (
                    <div key={game} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/3">
                      <span className="text-sm text-white">{game}</span>
                      <span className="text-lg font-bold text-[#F59E0B]">{count}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-white/15 mt-3">Sign Up At The Front Desk Or Kiosk</p>
            </div>

            {/* Tournaments */}
            {tournaments.length > 0 && (
              <div className="p-4 flex-1">
                <h3 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">Tournaments</h3>
                <div className="space-y-2">
                  {tournaments.map(t => {
                    const statusColors = {
                      scheduled: '#B0B3B8', registering: '#1877F2', registration: '#1877F2',
                      running: '#31A24C', break: '#F59E0B', final_table: '#A855F7'
                    };
                    const statusLabels = {
                      scheduled: 'Upcoming', registering: 'Reg Open', registration: 'Reg Open',
                      running: 'In Progress', break: 'On Break', final_table: 'Final Table'
                    };
                    const color = statusColors[t.status] || '#B0B3B8';
                    return (
                      <>
                        <div key={t.id} className="bg-white/3 rounded-lg p-3">
                          <p className="text-sm font-semibold text-white truncate">{t.name}</p>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs" style={{ color }}>{statusLabels[t.status] || t.status}</span>
                            {t.buyin_amount && (
                              <span className="text-xs text-white/40">${t.buyin_amount}+${t.buyin_fee || 0}</span>
                            )}
                          </div>
                          {t.scheduled_start && t.status === 'scheduled' && (
                            <p className="text-[10px] text-white/30 mt-1">
                              {new Date(t.scheduled_start).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                      </>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer ticker */}
        <div className="border-t border-white/10 px-6 py-2 flex items-center justify-between flex-shrink-0">
          <p className="text-white/10 text-xs">Ask Staff For Details, Scan Your Member QR Code At The Kiosk To Check In</p>
          <p className="text-white/10 text-xs tracking-wider">Powered By Smarter.Poker</p>
        </div>
      </div>
    </>
  );
}
