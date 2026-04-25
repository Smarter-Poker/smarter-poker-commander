/**
 * Combined TV Display
 * /commander/displays/combined
 * Multi-panel split-screen display for TV via wireless HDMI transmitter
 * Shows 2-4 panels simultaneously based on ?layout= parameter
 * Layouts:
 *   2-panel: clock+waitlist (default), clock+promotions, waitlist+tables
 *   3-panel: clock+waitlist+promotions
 *   4-panel: clock+waitlist+promotions+tables
 * Auto-refreshes all panels, no interaction needed
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';

import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync } from '../../../src/lib/commander/useCommanderSync';
import DealerTicker from '../../../src/components/commander/shared/DealerTicker';
import { busEmit } from '../../../src/engine/EventBus';
import SEOHead from '../../../src/components/seo/SEOHead';
import { getStaffSession, getStaffData } from '../../../src/lib/commander/clientAuth';

function formatClockTime(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function CombinedDisplay() {
  useEffect(() => { busEmit.sessionStart('commander-displays-combined'); }, []);
  const router = useRouter();
  const { layout = 'clock+waitlist', tournament } = router.query;

  const [clockData, setClockData] = useState(null);
  const [waitlists, setWaitlists] = useState([]);
  const [tables, setTables] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [now, setNow] = useState(new Date());
  const [clockSeconds, setClockSeconds] = useState(null);
  const wakeLockRef = useRef(null);

  const panels = layout.split('+').filter(Boolean);

  const venueIdRef = useRef(null);
  try { venueIdRef.current = typeof window !== 'undefined' ? getStaffData().venue_id : null; } catch { venueIdRef.current = null; }

  const getHeaders = () => {
    try {
      const staff = getStaffSession() || '';
return { 'x-staff-session': staff };
    } catch { return {}; }
  };

  const fetchData = useCallback(async () => {
    try {
      const fetches = [];
      const vid = venueIdRef.current;
      const headers = getHeaders();

      if (panels.includes('clock') && tournament) {
        fetches.push(
          fetch(`/api/commander/tournaments/${tournament}/clock`, { headers }).then(r => r.json()).catch(() => ({}))
            .then(json => { if (json.success) { setClockData(json.data); setClockSeconds(json.data?.remaining_seconds); } })
        );
      }
      if (panels.includes('waitlist') && vid) {
        fetches.push(
          fetch(`/api/commander/waitlist?venue_id=${vid}`, { headers }).then(r => r.json()).catch(() => ({}))
            .then(json => { if (json.success) setWaitlists((json.data || []).filter(w => ['waiting', 'called'].includes(w.status))); })
        );
      }
      if (panels.includes('tables') && vid) {
        fetches.push(
          fetch(`/api/commander/tables?venue_id=${vid}`, { headers }).then(r => r.json()).catch(() => ({}))
            .then(json => { if (json.success) setTables(json.data?.tables || json.data || []); })
        );
      }
      if (panels.includes('promotions') && vid) {
        fetches.push(
          fetch(`/api/commander/promotions?venue_id=${vid}`, { headers }).then(r => r.json()).catch(() => ({}))
            .then(json => { if (json.success) setPromotions((json.data || []).filter(p => p.is_active !== false)); })
        );
      }
      await Promise.allSettled(fetches);
    } catch (err) { console.warn(err); }
    setNow(new Date());
  }, [panels, tournament]);

  useEffect(() => {
    fetchData();
    const poll = setInterval(fetchData, 30000); // fallback — real-time sync handles instant updates
    const clock = setInterval(() => {
      setNow(new Date());
      setClockSeconds(s => s !== null && s > 0 ? s - 1 : s);
    }, 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [fetchData]);

  // Commander Data Bus — instant sync for TV display
  useCommanderSync(venueIdRef.current, fetchData, { entities: ['tables', 'waitlist', 'tournaments', 'settings'] });

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

  const goFullscreen = () => document.documentElement.requestFullscreen?.();

  // Grid layout based on panel count
  const gridClass = panels.length <= 2
    ? 'grid-cols-2 grid-rows-1'
    : panels.length === 3
      ? 'grid-cols-3 grid-rows-1'
      : 'grid-cols-2 grid-rows-2';

  return (
    <CommanderLayout title="Combined Display" backHref="/commander/dashboard?card=displays">
      <SEOHead
              title="Commander — Combined Display"
              description="Club Commander Poker Room Management Tool."
              noindex={true}
            />
      <style>{`
        @keyframes pulse-called { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        .called { animation: pulse-called 1.5s ease-in-out infinite; }
      `}</style>

      <div onClick={goFullscreen}
        className="h-screen bg-black text-white font-['Inter'] select-none overflow-hidden flex flex-col">

        {/* Thin header */}
        <div className="bg-[#1877F2] px-4 py-2 flex items-center justify-between flex-shrink-0">
          <span className="text-sm font-bold tracking-wider">SMARTER.POKER</span>
          <span className="text-lg font-mono font-bold tabular-nums">
            {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>

        {/* Panel Grid */}
        <div className={`flex-1 grid ${gridClass} gap-px bg-white/10 overflow-hidden`}>

          {panels.map(panel => {
            switch (panel) {
              case 'clock':
                return <ClockPanel key="clock" data={clockData} seconds={clockSeconds} />;
              case 'waitlist':
                return <WaitlistPanel key="waitlist" entries={waitlists} />;
              case 'tables':
                return <TablesPanel key="tables" tables={tables} />;
              case 'promotions':
                return <PromotionsPanel key="promotions" promotions={promotions} />;
              default:
                return <div key={panel} className="bg-black flex items-center justify-center"><p className="text-white/20">{panel}</p></div>;
            }
          })}
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
      </div>
    </CommanderLayout>
  );
}

function ClockPanel({ data, seconds }) {
  if (!data) return (
    <div className="bg-black flex items-center justify-center">
      <p className="text-3xl text-white/20 font-bold">No Tournament</p>
    </div>
  );

  const timeColor = seconds < 60 ? '#EF4444' : seconds < 120 ? '#F59E0B' : '#FFFFFF';
  const level = data.levels?.[data.current_level] || {};

  return (
    <div className="bg-black flex flex-col items-center justify-center p-4">
      <p className="text-sm text-white/40 uppercase tracking-wider mb-1">Level {(data.current_level || 0) + 1}</p>
      <p className="text-xl text-white/70 mb-2">
        {level.small_blind?.toLocaleString()}/{level.big_blind?.toLocaleString()}
        {level.ante > 0 && <span className="text-white/40"> ({level.ante})</span>}
      </p>
      <p className="font-mono font-bold tabular-nums leading-none" style={{ fontSize: '80px', color: timeColor }}>
        {formatClockTime(seconds)}
      </p>
      {data.hand_for_hand && (
        <div className="mt-2 px-4 py-1 bg-[#EF4444] rounded-full text-sm font-bold animate-pulse">HAND FOR HAND</div>
      )}
      {data.is_break && (
        <div className="mt-2 px-4 py-1 bg-[#F59E0B] rounded-full text-sm font-bold text-black animate-pulse">BREAK</div>
      )}
      <div className="mt-3 flex gap-4 text-xs text-white/40">
        <span>Players: <strong className="text-white/70">{data.stats?.players_remaining || 0}</strong></span>
        <span>Tables: <strong className="text-white/70">{data.stats?.tables_remaining || 0}</strong></span>
      </div>
    </div>
  );
}

function WaitlistPanel({ entries }) {
  const byGame = {};
  entries.forEach(e => {
    const key = e.game_type || 'Open';
    if (!byGame[key]) byGame[key] = [];
    byGame[key].push(e);
  });

  return (
    <div className="bg-black p-4 overflow-hidden">
      <h2 className="text-sm text-white/40 uppercase tracking-[0.2em] mb-3">Waitlist</h2>
      {Object.keys(byGame || {}).length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-xl text-white/15">No Wait</p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(byGame || {}).map(([game, players]) => (
            <div key={game}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold text-white/60">{game}</span>
                <span className="text-xs text-[#1877F2]">{players.length}</span>
              </div>
              <div className="space-y-0.5">
                {players.slice(0, 8).map((p, i) => (
                  <div key={p.id} className={`flex items-center gap-2 px-2 py-1 rounded ${p.status === 'called' ? 'bg-[#31A24C]/20 called' : ''
                    }`}>
                    <span className="text-xs text-white/40 w-4">{i + 1}</span>
                    <span className={`text-sm ${p.status === 'called' ? 'text-[#31A24C] font-medium' : 'text-white/80'}`}>
                      {p.player_name}
                    </span>
                    {p.status === 'called' && (
                      <span className="ml-auto text-[10px] text-[#31A24C] font-bold">SEAT OPEN</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TablesPanel({ tables }) {
  const active = tables.filter(t => t.is_active !== false);

  return (
    <div className="bg-black p-4 overflow-hidden">
      <h2 className="text-sm text-white/40 uppercase tracking-[0.2em] mb-3">Tables</h2>
      {active.length === 0 ? (
        <p className="text-xl text-white/15 text-center">No Active Tables</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {active.slice(0, 12).map(t => {
            const max = t.max_seats || 9;
            const seated = (t.seats || []).filter(s => s.status === 'occupied').length || (t.seated_count || 0);
            const open = max - seated;
            return (
              <div key={t.id || t.table_number}
                className={`rounded-lg p-2 text-center border ${open > 0 ? 'bg-[#31A24C]/10 border-[#31A24C]/30' :
                  seated > 0 ? 'bg-[#1877F2]/10 border-[#1877F2]/30' :
                    'bg-white/5 border-white/10'
                  }`}>
                <p className="text-base font-bold text-white">T{t.table_number}</p>
                <p className="text-[10px] text-white/40">{t.game_type || 'NLH'}</p>
                <p className="text-xs text-white/60">{seated}/{max}</p>
                {open > 0 && <p className="text-[10px] text-[#31A24C] font-bold">{open} OPEN</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PromotionsPanel({ promotions }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (promotions.length <= 1) return;
    const i = setInterval(() => setIdx(prev => (prev + 1) % promotions.length), 6000);
    return () => clearInterval(i);
  }, [promotions.length]);

  const promo = promotions[idx];

  return (
    <div className="bg-black p-4 flex flex-col items-center justify-center overflow-hidden">
      <h2 className="text-sm text-white/40 uppercase tracking-[0.2em] mb-3">Promotions</h2>
      {!promo ? (
        <p className="text-xl text-white/15">No Active Promotions</p>
      ) : (
        <div className="text-center">
          <p className="text-xs text-[#F59E0B] font-bold uppercase tracking-wider mb-1">
            {promo.type?.replace('_', ' ') || 'PROMOTION'}
          </p>
          <p className="text-2xl font-bold text-white mb-2">{promo.name || promo.title}</p>
          {(promo.prize_amount || promo.jackpot_amount) && (
            <p className="text-4xl font-bold text-[#F59E0B]">
              ${(promo.prize_amount || promo.jackpot_amount || 0).toLocaleString()}
            </p>
          )}
          {promo.description && (
            <p className="text-sm text-white/50 mt-2 max-w-xs">{promo.description}</p>
          )}
        </div>
      )}
    </div>
  );
}
