/**
 * Promotions TV Display - Player-Facing
 * /commander/displays/promotions
 * Full-screen display for TV via wireless HDMI transmitter
 * Shows: active promotions with prize values, countdown timers, highhand leaders
 * Auto-rotates between promotions every 8 seconds
 * Real-time sync via Supabase + Commander Data Bus
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../src/lib/supabase';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync } from '../../../src/lib/commander/useCommanderSync';
import DealerTicker from '../../../src/components/commander/shared/DealerTicker';
import useClubBranding from '../../../src/lib/commander/useClubBranding';
import useWakeLock from '../../../src/hooks/useWakeLock';
import { getToken, getStaffSession, getVenueId } from '../../../src/lib/commander/clientAuth';
import { busEmit } from '../../../src/engine/EventBus';
import SEOHead from '../../../src/components/seo/SEOHead';

const PROMO_TYPE_STYLES = {
  high_hand: { bg: 'from-yellow-900/40 to-yellow-700/20', accent: '#F59E0B', label: 'HIGH HAND' },
  bad_beat: { bg: 'from-red-900/40 to-red-700/20', accent: '#EF4444', label: 'BAD BEAT JACKPOT' },
  splash_pot: { bg: 'from-blue-900/40 to-blue-700/20', accent: '#1877F2', label: 'SPLASH POT' },
  happy_hour: { bg: 'from-amber-900/40 to-amber-700/20', accent: '#F59E0B', label: 'HAPPY HOUR' },
  new_player: { bg: 'from-purple-900/40 to-purple-700/20', accent: '#8B5CF6', label: 'NEW PLAYER BONUS' },
  referral: { bg: 'from-pink-900/40 to-pink-700/20', accent: '#EC4899', label: 'REFERRAL BONUS' },
  loyalty: { bg: 'from-cyan-900/40 to-cyan-700/20', accent: '#22D3EE', label: 'LOYALTY REWARD' },
  drawing: { bg: 'from-orange-900/40 to-orange-700/20', accent: '#F97316', label: 'DRAWING' },
  tournament_bonus: { bg: 'from-green-900/40 to-green-700/20', accent: '#10B981', label: 'TOURNAMENT BONUS' },
  cash_back: { bg: 'from-indigo-900/40 to-indigo-700/20', accent: '#6366F1', label: 'CASH BACK' },
  custom: { bg: 'from-gray-900/40 to-gray-700/20', accent: '#9CA3AF', label: 'PROMOTION' },
  default: { bg: 'from-blue-900/40 to-blue-700/20', accent: '#1877F2', label: 'PROMOTION' }
};

export default function PromotionsDisplay() {
  useEffect(() => { busEmit.sessionStart('commander-displays-promotions'); }, []);
  const [promotions, setPromotions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [now, setNow] = useState(new Date());
  useWakeLock();

  // Extract venue info for API calls and cross-device sync
  const [venueId] = useState(() => {
    return getVenueId();
  });

  // Central club branding - logo + name from Settings
  const { clubName, logoUrl: clubLogoUrl } = useClubBranding();

  const fetchData = useCallback(async () => {
    try {
      const token = getToken() || '';
      const staffSession = getStaffSession() || '';
      const url = venueId
        ? `/api/commander/promotions?venue_id=${venueId}&status=active`
        : '/api/commander/promotions?status=active';
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'x-staff-session': staffSession
        }
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        const promos = json.data?.promotions || json.data || [];
        const arr = Array.isArray(promos) ? promos : [];
        const active = arr.filter(p => p.status === 'active' || p.is_active)
          .sort((a, b) => ((a.settings?.display_order ?? 999) - (b.settings?.display_order ?? 999)));
        setPromotions(active);
      }
    } catch (err) { console.warn('Display fetch error:', err); }
    setNow(new Date());
  }, [venueId]);

  // Reset currentIndex when promotions list changes size
  useEffect(() => {
    setCurrentIndex(prev => (promotions.length === 0 ? 0 : prev >= promotions.length ? 0 : prev));
  }, [promotions.length]);

  useEffect(() => {
    const _c = new AbortController(); fetchData(_c.signal);
    const poll = setInterval(() => fetchData(_c.signal), 30000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [fetchData]);

  // Commander Data Bus
  useCommanderSync(venueId, fetchData, { entities: ['settings'] });

  // Supabase realtime
  useEffect(() => {
    if (!venueId || !supabase) return;
    let reconnects = 0;
    const MAX_RECONNECT = 3;
    let currentChannel = null;

    function connectChannel() {
      if (currentChannel) {
        try { supabase.removeChannel(currentChannel); } catch { /* ignore */ }
      }
      const channel = supabase.channel(`display-promotions-realtime-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'commander_promotions', filter: `venue_id=eq.${venueId}` },
          () => { fetchData(); }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            reconnects = 0;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`[PromoDisplay] Realtime channel error: ${status}`);
            if (reconnects < MAX_RECONNECT) {
              reconnects++;
              setTimeout(connectChannel, 3000 * reconnects);
            }
          }
        });
      currentChannel = channel;
    }

    connectChannel();
    return () => { if (currentChannel) supabase.removeChannel(currentChannel); };
  }, [venueId, fetchData]);

  // Auto-rotate every 8 seconds
  useEffect(() => {
    if (promotions.length <= 1) return;
    const rotate = setInterval(() => {
      setCurrentIndex(i => (i + 1) % promotions.length);
    }, 8000);
    return () => clearInterval(rotate);
  }, [promotions.length]);



  const goFullscreen = () => document.documentElement.requestFullscreen?.();
  const current = promotions[currentIndex];

  // Format prize value - returns empty string if nothing to show
  const formatPrize = (promo) => {
    if (!promo) return '';
    if (promo.prize_value && Number(promo.prize_value) > 0) {
      if (promo.prize_type === 'cash' || promo.prize_type === 'chips') {
        return `$${Number(promo.prize_value).toLocaleString()}`;
      }
      return promo.prize_description || `${promo.prize_value}`;
    }
    return promo.prize_description || '';
  };

  // Countdown remaining
  const getDaysRemaining = (promo) => {
    if (!promo?.end_date) return null;
    const end = new Date(promo.end_date);
    end.setHours(23, 59, 59, 999);
    const diff = end - now;
    if (diff <= 0) return null;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days > 0) return `${days} day${days !== 1 ? 's' : ''} remaining`;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    return `${hours} hour${hours !== 1 ? 's' : ''} remaining`;
  };

  return (
    <CommanderLayout title="Promotions Display" backHref="/commander/dashboard?card=displays">
      <SEOHead
              title="Commander - Promotions Display"
              description="Club Commander Poker Room Management Tool."
              noindex={true}
            />
      <style>{`
        @keyframes shimmer { 0% { opacity: 0.7; } 50% { opacity: 1; } 100% { opacity: 0.7; } }
        .shimmer { animation: shimmer 3s ease-in-out infinite; }
        @keyframes slideIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .slide-in { animation: slideIn 0.6s ease-out; }
        @keyframes pulse-glow { 0%, 100% { box-shadow: 0 0 30px rgba(24,119,242,0.3); } 50% { box-shadow: 0 0 60px rgba(24,119,242,0.5); } }
        .pulse-glow { animation: pulse-glow 3s ease-in-out infinite; }
      `}</style>

      <div onClick={goFullscreen}
        className="min-h-screen bg-black text-white font-['Inter'] select-none overflow-hidden flex flex-col">

        {/* ── CLUB BRANDING HEADER ── */}
        <div style={{
          background: 'linear-gradient(135deg, #1877F2 0%, #0D47A1 100%)',
          padding: '16px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '3px solid rgba(255,255,255,0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Club Logo - uploaded from Settings, or initial letter fallback */}
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: 'rgba(255,255,255,0.15)',
              border: '2px solid rgba(255,255,255,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', flexShrink: 0,
            }}>
              {clubLogoUrl ? (
                <img src={clubLogoUrl} alt={clubName} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={e => { e.target.style.display = 'none'; }} />
              ) : (
                <span style={{
                  fontSize: 28, fontWeight: 900, color: '#fff',
                  fontFamily: "var(--font-orbitron), sans-serif", textTransform: 'uppercase',
                }}>
                  {clubName.charAt(0)}
                </span>
              )}
            </div>
            <div>
              <h1 style={{
                fontSize: 28, fontWeight: 900, color: '#fff', margin: 0,
                fontFamily: "var(--font-orbitron), sans-serif",
                letterSpacing: '2px', textTransform: 'uppercase',
                textShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}>
                {clubName}
              </h1>
              <p style={{
                fontSize: 14, color: 'rgba(255,255,255,0.7)', margin: '2px 0 0',
                fontWeight: 600, letterSpacing: '3px', textTransform: 'uppercase',
              }}>
                PROMOTIONS
              </p>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{
              fontSize: 42, fontWeight: 700, color: '#fff', margin: 0,
              fontFamily: "var(--font-orbitron), monospace",
              letterSpacing: '2px',
              textShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}>
              {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
            </p>
            <p style={{
              fontSize: 14, color: 'rgba(255,255,255,0.6)', margin: 0,
              fontWeight: 500, letterSpacing: '1px',
            }}>
              {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>

        {/* ── FULL-SCREEN PROMOTION DISPLAY ── */}
        <div className="flex-1 flex items-center justify-center" style={{ padding: '24px 32px' }}>
          {promotions.length === 0 ? (
            <div className="text-center">
              <p className="text-5xl font-bold text-white/20 mb-4">No Active Promotions</p>
              <p className="text-xl text-white/10">Check Back Soon!</p>
            </div>
          ) : current ? (
            <div key={currentIndex}
              className={`slide-in w-full bg-gradient-to-br ${(PROMO_TYPE_STYLES[current.promotion_type] || PROMO_TYPE_STYLES.default).bg} rounded-3xl text-center border border-white/10 pulse-glow`}
              style={{ padding: '48px 64px', maxWidth: '100%' }}
            >

              {/* Image Banner */}
              {current.image_url && (
                <div className="mb-8 rounded-2xl overflow-hidden mx-auto" style={{ maxHeight: 240, maxWidth: 800 }}>
                  <img src={current.image_url} alt={current.name} className="w-full h-full object-cover" onError={e => { e.target.style.display = 'none'; }} />
                </div>
              )}

              {/* Type Badge */}
              <div className="inline-block px-8 py-3 rounded-full mb-6"
                style={{
                  backgroundColor: `${(PROMO_TYPE_STYLES[current.promotion_type] || PROMO_TYPE_STYLES.default).accent}30`,
                  border: `2px solid ${(PROMO_TYPE_STYLES[current.promotion_type] || PROMO_TYPE_STYLES.default).accent}50`
                }}>
                <p className="text-lg font-bold tracking-[0.3em] uppercase"
                  style={{ color: (PROMO_TYPE_STYLES[current.promotion_type] || PROMO_TYPE_STYLES.default).accent, margin: 0 }}>
                  {(PROMO_TYPE_STYLES[current.promotion_type] || PROMO_TYPE_STYLES.default).label}
                </p>
              </div>

              {/* Promo Name - LARGE */}
              <h2 style={{
                fontSize: 'clamp(36px, 5vw, 72px)',
                fontWeight: 900,
                color: '#fff',
                margin: '0 0 12px',
                lineHeight: 1.1,
                textShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}>
                {current.name}
              </h2>

              {/* Prize Amount - HERO SIZE */}
              {formatPrize(current) && (
                <p className="shimmer" style={{
                  fontSize: 'clamp(64px, 10vw, 120px)',
                  fontWeight: 900,
                  margin: '0 0 12px',
                  lineHeight: 1,
                  color: (PROMO_TYPE_STYLES[current.promotion_type] || PROMO_TYPE_STYLES.default).accent,
                  textShadow: `0 0 40px ${(PROMO_TYPE_STYLES[current.promotion_type] || PROMO_TYPE_STYLES.default).accent}40`,
                }}>
                  {formatPrize(current)}
                </p>
              )}

              {/* Description */}
              {current.description && (
                <p style={{
                  fontSize: 'clamp(18px, 2.5vw, 28px)',
                  color: 'rgba(255,255,255,0.7)',
                  maxWidth: 900,
                  margin: '0 auto 20px',
                  lineHeight: 1.4,
                }}>
                  {current.description}
                </p>
              )}

              {/* Countdown Timer */}
              {getDaysRemaining(current) && (
                <div className="inline-block px-8 py-4 rounded-full bg-white/5 border border-white/10">
                  <p style={{ fontSize: 20, color: 'rgba(255,255,255,0.6)', fontWeight: 600, margin: 0 }}>
                    {getDaysRemaining(current)}
                  </p>
                </div>
              )}

              {/* Qualifying Hands */}
              {current.qualifying_hands && (
                <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.4)', marginTop: 16 }}>
                  Qualifying: {current.qualifying_hands}
                </p>
              )}
            </div>
          ) : null}
        </div>

        {/* Pagination dots */}
        {promotions.length > 1 && (
          <div className="flex justify-center gap-3 pb-4">
            {promotions.map((_, i) => (
              <div key={i} className={`h-3 rounded-full transition-all ${i === currentIndex ? 'bg-[#1877F2] w-10' : 'bg-white/20 w-3'
                }`} />
            ))}
          </div>
        )}

        {/* ── DEALER TICKER - 2x size, raised up, 100% slower ── */}
        <DealerTicker
          accentColor="#F59E0B"
          bgColor="rgba(0,0,0,0.95)"
          fontSize={36}
          borderColor="rgba(255,255,255,0.15)"
          speed={44}
          showBorder={true}
        />

        {/* Branding */}
        <div className="absolute bottom-20 right-6">
          <p className="text-white/15 text-xs tracking-wider">Powered By Smarter.Poker</p>
        </div>
      </div>
    </CommanderLayout>
  );
}
