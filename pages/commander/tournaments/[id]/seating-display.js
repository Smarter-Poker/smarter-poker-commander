/**
 * Tournament Seating Chart TV Display
 * /commander/tournaments/[id]/seating-display
 * 
 * Full-screen display showing all tournament tables with player seat assignments.
 * Players check this screen to find their table and seat.
 * Auto-refreshes as players are moved/eliminated.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import DealerTicker from '../../../../src/components/commander/shared/DealerTicker';
import useTournamentRealtime from '../../../../src/hooks/useTournamentRealtime';
import useWakeLock from '../../../../src/hooks/useWakeLock';
import { busEmit } from '../../../../src/engine/EventBus';
import { getToken } from '../../../../src/lib/commander/clientAuth';

export default function SeatingDisplay() {
  useEffect(() => { busEmit.sessionStart('commander-tournaments-id-seating-display'); }, []);
  const router = useRouter();
  const { id } = router.query;
  const [tournament, setTournament] = useState(null);
  const [entries, setEntries] = useState([]);
  const [now, setNow] = useState(new Date());
  useWakeLock();

  const fetchData = useCallback(async () => {

  if (!router.isReady) return null;

    if (!id) return;
    try {
      const bearerToken = typeof window !== 'undefined' ? (getToken()) : '';
      const headers = { Authorization: `Bearer ${bearerToken}` };
      const [tRes, eRes] = await Promise.all([
        fetch(`/api/commander/tournaments/${id}`, { headers }).then(r => r.json()).catch(() => ({ success: false })),
        fetch(`/api/commander/tournaments/${id}/entries`, { headers }).then(r => r.json()).catch(() => ({ success: false }))
      ]);
      // 2026-07-25 audit fix: unwrap API payloads - data is { tournament } / { entries }
      if (tRes.success) setTournament(tRes.data?.tournament || null);
      if (eRes.success) setEntries(eRes.data?.entries || []);
    } catch (err) { console.warn(err); }
    setNow(new Date());
  }, [id]);

  // Supabase Realtime - instant sync when player seating changes, with the
  // fallback poll adapting: 30s while the channel is unproven (unchanged),
  // 5 minutes once it has actually delivered an event to this display.
  useTournamentRealtime(id, fetchData, { poll: true });

  useEffect(() => {
    if (!id) return;
    fetchData();
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(clock); };
  }, [id, fetchData]);



  const goFullscreen = () => document.documentElement.requestFullscreen?.();

  // Group active entries by table
  // 2026-08-04 audit fix: entries use status 'seated' as well - include it so
  // seated players appear on the chart.
  const active = entries.filter(e => e.status === 'active' || e.status === 'seated' || e.status === 'playing');
  const byTable = {};
  active.forEach(e => {
    const t = e.table_number || 'Unassigned';
    if (!byTable[t]) byTable[t] = [];
    byTable[t].push(e);
  });
  // Sort each table by seat
  Object.values(byTable || {}).forEach(arr => arr.sort((a, b) => (a.seat_number || 0) - (b.seat_number || 0)));
  const tableNumbers = Object.keys(byTable || {}).sort((a, b) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return parseInt(a) - parseInt(b);
  });

  return (
    <>
      <SEOHead
        title="Commander - Seating Display"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <style>{`
        * { cursor: none !important; }
        body { overflow: hidden; }
      `}</style>

      <div onClick={goFullscreen}
        className="h-screen bg-black text-white font-['Inter'] select-none flex flex-col">

        {/* Header */}
        <div className="bg-[#1877F2] px-8 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-2xl font-bold">{tournament?.name || 'Tournament'} - Seating Chart</h1>
            <p className="text-sm opacity-80">{active.length} Players, {tableNumbers.filter(t => t !== 'Unassigned').length} Tables</p>
          </div>
          <p className="text-3xl font-mono font-bold tabular-nums">
            {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>

        {/* Tables Grid */}
        <div className="flex-1 p-6 overflow-y-auto">
          <div className={`grid gap-4 ${tableNumbers.length <= 4 ? 'grid-cols-2' :
            tableNumbers.length <= 6 ? 'grid-cols-3' :
              tableNumbers.length <= 9 ? 'grid-cols-3' : 'grid-cols-4'
            }`}>
            {tableNumbers.map(tableNum => {
              const players = byTable[tableNum];
              const isUnassigned = tableNum === 'Unassigned';

              return (
                <div key={tableNum}
                  className={`rounded-xl p-4 border ${isUnassigned ? 'bg-[#F59E0B]/5 border-[#F59E0B]/30' : 'bg-white/3 border-white/10'
                    }`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className={`text-lg font-bold ${isUnassigned ? 'text-[#F59E0B]' : 'text-[#1877F2]'}`}>
                      {isUnassigned ? 'Unassigned' : `Table ${tableNum}`}
                    </h3>
                    <span className="text-sm text-white/40">{players.length} Players</span>
                  </div>
                  <div className="space-y-1">
                    {players.map(p => (
                      <div key={p.id || p.entry_id} className="flex items-center gap-2 px-2 py-1 rounded bg-white/3">
                        <span className="text-xs text-white/40 w-5 text-right">{p.seat_number || '-'}</span>
                        <span className="text-sm text-white flex-1 truncate">
                          {p.player_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()}
                        </span>
                        {p.current_chips > 0 && (/* 2026-08-04 audit fix: entry rows expose current_chips, not chip_count */
                          <span className="text-xs text-white/30">{p.current_chips?.toLocaleString()}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Dealer Push/Break + Promo Ticker */}
        <DealerTicker
          accentColor="#1877F2"
          bgColor="#000"
          fontSize={16}
          borderColor="rgba(255,255,255,0.1)"
          speed={50}
          showBorder={true}
        />

        {/* Footer */}
        <div className="border-t border-white/10 px-8 py-2 flex items-center justify-between flex-shrink-0">
          <p className="text-sm text-white/20">Find Your Name Above For Your Table And Seat Assignment</p>
          <p className="text-white/15 text-xs tracking-wider">Powered By Smarter.Poker</p>
        </div>
      </div>
    </>
  );
}
