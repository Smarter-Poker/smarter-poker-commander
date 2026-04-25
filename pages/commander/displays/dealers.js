/**
 * Dealer Rotation TV Display
 * /commander/displays/dealers
 * Full-screen display for dealer break room or floor manager TV
 * Shows: current table assignments, on-break dealers, next rotation time
 * Auto-refreshes every 10 seconds
 */
import { useState, useEffect, useRef, useCallback } from 'react';

import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync } from '../../../src/lib/commander/useCommanderSync';
import DealerTicker from '../../../src/components/commander/shared/DealerTicker';
import { busEmit } from '../../../src/engine/EventBus';
import SEOHead from '../../../src/components/seo/SEOHead';
import { getStaffSession, getStaffData } from '../../../src/lib/commander/clientAuth';

export default function DealerRotationDisplay() {
  useEffect(() => { busEmit.sessionStart('commander-displays-dealers'); }, []);
  const [dealers, setDealers] = useState([]);
  const [rotations, setRotations] = useState([]);
  const [now, setNow] = useState(new Date());
  const wakeLockRef = useRef(null);

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
      const vid = venueIdRef.current;
      if (!vid) return;
      const headers = getHeaders();
      const [dealerRes, rotRes] = await Promise.all([
        fetch(`/api/commander/dealers?venue_id=${vid}`, { headers }).catch(() => ({ ok: false })),
        fetch(`/api/commander/dealers/rotations?venue_id=${vid}`, { headers }).catch(() => ({ ok: false }))
      ]);
      if (dealerRes.ok) {
        const dealerJson = await dealerRes.json();
        if (dealerJson.success) setDealers(dealerJson.data?.dealers || dealerJson.data || []);
      }
      if (rotRes.ok) {
        const rotJson = await rotRes.json();
        if (rotJson.success) setRotations(rotJson.data?.rotations || rotJson.data || []);
      }
    } catch (err) { console.warn(err); }
    setNow(new Date());
  }, []);

  useEffect(() => {
    fetchData();
    const poll = setInterval(fetchData, 30000); // fallback — real-time sync handles instant updates
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [fetchData]);

  // Commander Data Bus — instant sync when dealers change
  useCommanderSync(venueIdRef.current, fetchData, { entities: ['dealers'] });

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

  // Group dealers by status
  const dealing = dealers.filter(d => d.status === 'dealing' || d.current_table);
  const onBreak = dealers.filter(d => d.status === 'break');
  const standby = dealers.filter(d => d.status === 'standby' || d.status === 'available');
  const clocked = dealers.filter(d => d.is_active !== false && d.status !== 'off');

  // Find next rotation time from rotations
  const nextRotation = rotations.find(r => r.next_rotation_at && new Date(r.next_rotation_at) > now);
  const nextRotationTime = nextRotation ? new Date(nextRotation.next_rotation_at) : null;
  const minutesUntil = nextRotationTime ? Math.max(0, Math.floor((nextRotationTime - now) / 60000)) : null;

  return (
    <CommanderLayout title="Dealer Rotation Display" backHref="/commander/dashboard?card=displays">
      <SEOHead
              title="Commander — Dealer Display"
              description="Club Commander Poker Room Management Tool."
              noindex={true}
            />
      <style>{`
        @keyframes pulse-break { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .break-pulse { animation: pulse-break 2s ease-in-out infinite; }
      `}</style>

      <div onClick={goFullscreen}
        className="min-h-screen bg-black text-white font-['Inter'] select-none overflow-hidden flex flex-col">

        {/* Header */}
        <div className="bg-[#F59E0B] px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-3xl font-bold tracking-wide text-black">DEALER ROTATION</h1>
            <span className="text-lg text-black/70">
              <strong className="text-black">{clocked.length}</strong> Dealers On Duty
            </span>
          </div>
          <div className="text-right text-black">
            <p className="text-4xl font-mono font-bold tabular-nums">
              {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
            </p>
            {minutesUntil !== null && (
              <p className="text-sm opacity-70">Next rotation in {minutesUntil} min</p>
            )}
          </div>
        </div>

        {/* Main Layout */}
        <div className="flex-1 flex overflow-hidden">

          {/* LEFT: Currently Dealing */}
          <div className="flex-1 p-6 border-r border-white/10">
            <h2 className="text-lg text-white/50 uppercase tracking-[0.2em] mb-4">
              At Tables ({dealing.length})
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {dealing.map(d => (
                <div key={d.id} className="bg-[#1877F2]/10 border border-[#1877F2]/30 rounded-xl p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#1877F2]/20 flex items-center justify-center">
                    <span className="text-lg font-bold text-[#1877F2]">T{d.current_table || '?'}</span>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-white">{d.name || d.first_name}</p>
                    <p className="text-xs text-white/40">
                      {d.game_type || 'NLH'} {d.started_at ? `• ${Math.floor((now - new Date(d.started_at)) / 60000)}m` : ''}
                    </p>
                  </div>
                </div>
              ))}
              {dealing.length === 0 && (
                <p className="text-xl text-white/20 col-span-2 text-center py-8">No Dealers At Tables</p>
              )}
            </div>
          </div>

          {/* RIGHT: Break & Standby */}
          <div className="w-80 p-6">
            {/* On Break */}
            <div className="mb-6">
              <h2 className="text-lg text-white/50 uppercase tracking-[0.2em] mb-3">
                On Break ({onBreak.length})
              </h2>
              {onBreak.length === 0 ? (
                <p className="text-white/20 text-sm">No Dealers On Break</p>
              ) : (
                <div className="space-y-2">
                  {onBreak.map(d => (
                    <div key={d.id} className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl p-3 flex items-center gap-3 break-pulse">
                      <div className="w-8 h-8 rounded-full bg-[#F59E0B]/20 flex items-center justify-center">
                        <span className="text-sm font-bold text-[#F59E0B]">B</span>
                      </div>
                      <div>
                        <p className="text-base font-medium text-white">{d.name || d.first_name}</p>
                        <p className="text-xs text-[#F59E0B]/60">
                          {d.break_started ? `${Math.floor((now - new Date(d.break_started)) / 60000)}m` : 'On break'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Standby */}
            <div>
              <h2 className="text-lg text-white/50 uppercase tracking-[0.2em] mb-3">
                Standby ({standby.length})
              </h2>
              {standby.length === 0 ? (
                <p className="text-white/20 text-sm">No Dealers On Standby</p>
              ) : (
                <div className="space-y-2">
                  {standby.map(d => (
                    <div key={d.id} className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#31A24C]" />
                      <p className="text-base text-white/70">{d.name || d.first_name}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dealer Push & Break Ticker */}
        <DealerTicker
          accentColor="#F59E0B"
          bgColor="#000"
          fontSize={18}
          borderColor="rgba(255,255,255,0.1)"
          speed={50}
          showBorder={true}
        />

        {/* Footer */}
        <div className="border-t border-white/10 px-8 py-2 flex items-center justify-between">
          <p className="text-sm text-white/20">Rotation Schedule Managed From Floor Manager Tablet</p>
          <p className="text-white/15 text-xs tracking-wider">Powered By Smarter.Poker</p>
        </div>
      </div>
    </CommanderLayout>
  );
}
