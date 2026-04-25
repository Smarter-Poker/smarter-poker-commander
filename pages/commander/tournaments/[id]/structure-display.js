/**
 * Tournament Structure TV Display
 * /commander/tournaments/[id]/structure-display
 * 
 * Full-screen blind schedule display for TV via HDMI transmitter.
 * Shows all levels, current level highlighted, upcoming blinds.
 * Auto-refreshes to stay in sync with clock state.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import DealerTicker from '../../../../src/components/commander/shared/DealerTicker';
import useTournamentRealtime from '../../../../src/hooks/useTournamentRealtime';
import useWakeLock from '../../../../src/hooks/useWakeLock';
import { busEmit } from '../../../../src/engine/EventBus';
import { getToken, getStaffSession } from '../../../../src/lib/commander/clientAuth';

const parseBlinds = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.length > 0) { try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch (e) { console.warn('[App] Handled exception:', e); } }
  return [];
};

export default function StructureDisplay() {
  useEffect(() => { busEmit.sessionStart('commander-tournaments-id-structure-display'); }, []);
  const router = useRouter();
  const { id } = router.query;
  const [tournament, setTournament] = useState(null);
  const [clockData, setClockData] = useState(null);
  const [now, setNow] = useState(new Date());
  useWakeLock();
  const currentRef = useRef(null);

  const fetchData = useCallback(async () => {

  if (!router.isReady) return null;

    if (!id) return;
    try {
      const staffSession = typeof window !== 'undefined' ? (getStaffSession() || '') : '';
      const bearerToken = typeof window !== 'undefined' ? (getToken()) : '';
      const headers = { Authorization: `Bearer ${bearerToken}` };
      const [tRes, cRes] = await Promise.all([
        fetch(`/api/commander/tournaments/${id}`, { headers }).then(r => r.json()).catch(() => ({ success: false })),
        fetch(`/api/commander/tournaments/${id}/clock`, { headers }).then(r => r.json()).catch(() => ({ success: false }))
      ]);
      if (tRes.success) setTournament(tRes.data);
      if (cRes.success) setClockData(cRes.data);
    } catch (err) { console.warn(err); }
    setNow(new Date());
  }, [id]);

  // Supabase Realtime — instant sync when level changes
  useTournamentRealtime(id, fetchData);

  useEffect(() => {
    if (!id) return;
    fetchData();
    const poll = setInterval(fetchData, 30000); // fallback — real-time sync handles instant updates
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [id, fetchData]);

  // Scroll current level into view
  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [clockData?.current_level]);



  const goFullscreen = () => document.documentElement.requestFullscreen?.();
  const levels = parseBlinds(tournament?.blind_structure).length > 0 ? parseBlinds(tournament?.blind_structure) : (clockData?.levels || []);
  const currentLevel = clockData?.current_level ?? -1;

  let levelNum = 0;

  return (
    <>
      <SEOHead
        title="Commander — Structure Display"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <style>{`
        * { cursor: none !important; }
        body { overflow: hidden; }
        @keyframes pulse-current { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        .current-level { animation: pulse-current 2s ease-in-out infinite; }
      `}</style>

      <div onClick={goFullscreen}
        className="h-screen bg-black text-white font-['Inter'] select-none flex flex-col">

        {/* Header */}
        <div className="bg-[#1877F2] px-8 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-2xl font-bold">{tournament?.name || 'Tournament Structure'}</h1>
            <p className="text-sm opacity-80">
              ${tournament?.buyin_amount || 0}+${tournament?.buyin_fee || 0} — {tournament?.starting_chips?.toLocaleString() || '15,000'} chips
            </p>
          </div>
          <p className="text-3xl font-mono font-bold tabular-nums">
            {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>

        {/* Structure Table */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Column headers */}
          <div className="grid grid-cols-[60px_1fr_1fr_1fr_80px] gap-4 px-4 py-2 text-sm text-white/40 uppercase tracking-wider border-b border-white/10 sticky top-0 bg-black z-10">
            <span>Level</span><span>Small-Blind</span><span>Big-Blind</span><span>Ante</span><span className="text-right">Duration</span>
          </div>

          <div className="space-y-0.5 pt-1">
            {levels.map((level, i) => {
              if (!level.is_break) levelNum++;
              const isCurrent = i === currentLevel;
              const isPast = i < currentLevel;

              if (level.is_break) {
                return (
                  <div key={i} ref={isCurrent ? currentRef : null}
                    className={`grid grid-cols-[60px_1fr_80px] gap-4 px-4 py-3 rounded-lg ${isCurrent ? 'bg-[#F59E0B]/20 border border-[#F59E0B]/50 current-level' :
                      isPast ? 'opacity-30' : 'bg-[#F59E0B]/5'
                      }`}>
                    <span className="text-[#F59E0B] font-bold">BRK</span>
                    <span className="text-[#F59E0B]">Break</span>
                    <span className="text-right text-[#F59E0B]">{level.duration}m</span>
                  </div>
                );
              }

              return (
                <div key={i} ref={isCurrent ? currentRef : null}
                  className={`grid grid-cols-[60px_1fr_1fr_1fr_80px] gap-4 px-4 py-3 rounded-lg ${isCurrent ? 'bg-[#1877F2]/20 border-2 border-[#1877F2] current-level text-white' :
                    isPast ? 'opacity-30' : 'bg-white/2 hover:bg-white/5'
                    }`}>
                  <span className={`font-bold ${isCurrent ? 'text-[#1877F2]' : 'text-white/60'}`}>{levelNum}</span>
                  <span className={`text-lg font-medium ${isCurrent ? 'text-white font-bold' : ''}`}>{level.small_blind?.toLocaleString()}</span>
                  <span className={`text-lg font-medium ${isCurrent ? 'text-white font-bold' : ''}`}>{level.big_blind?.toLocaleString()}</span>
                  <span className={`text-lg ${level.ante > 0 ? '' : 'text-white/20'} ${isCurrent ? 'font-bold' : ''}`}>
                    {level.ante > 0 ? level.ante.toLocaleString() : '-'}
                  </span>
                  <span className={`text-right ${isCurrent ? 'font-bold' : 'text-white/50'}`}>{level.duration}m</span>
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

        {/* Footer with payout info if available */}
        <div className="border-t border-white/10 px-8 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex gap-6 text-sm text-white/40">
            {tournament?.rebuy_allowed && <span>Rebuys thru Level {tournament.rebuy_levels}</span>}
            {tournament?.addon_allowed && <span>Add-On Available At Break</span>}
            {tournament?.late_reg_levels && <span>Late reg thru Level {tournament.late_reg_levels}</span>}
          </div>
          <p className="text-white/15 text-xs tracking-wider">Powered By Smarter.Poker</p>
        </div>
      </div>
    </>
  );
}
