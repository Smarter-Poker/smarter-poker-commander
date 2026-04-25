/**
 * Player Mobile Check-In Page
 * /commander/check-in/[code]
 * 
 * When a player scans their QR code (CMD-xxxx-xxxxxxxx), this page loads.
 * Shows them:
 * - Their membership status
 * - Time balance remaining on their card
 * - Current table session (if seated) with live countdown
 * - Quick actions: add to waitlist, buy time
 * 
 * No login required - QR code IS the authentication.
 * Mobile-optimized, auto-refreshes.
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import { Shield, Timer, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useCommanderSync } from '../../../src/lib/commander/useCommanderSync';
import { commanderFetch } from '../../../src/lib/commander/commanderFetch';
import { getVenueId } from '../../../src/lib/commander/clientAuth';

function formatCountdown(seconds) {
  if (seconds === null || seconds === undefined || seconds < 0) return '--:--';
  if (seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getTimeColor(seconds) {
  if (seconds <= 0) return '#EF4444';
  if (seconds <= 300) return '#EF4444';
  if (seconds <= 900) return '#F59E0B';
  return '#31A24C';
}

const TIER_LABELS = { standard: 'Standard', gold: 'Gold', platinum: 'Platinum', vip: 'VIP' };
const TIER_COLORS = { standard: '#B0B3B8', gold: '#F59E0B', platinum: '#94A3B8', vip: '#A855F7' };

export default function PlayerCheckIn() {
  const router = useRouter();
  const { code } = router.query;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [member, setMember] = useState(null);
  const [membershipActive, setMembershipActive] = useState(false);
  const [timeBalance, setTimeBalance] = useState(0);
  const [activeSession, setActiveSession] = useState(null);
  const [now, setNow] = useState(new Date());

  
  // fetchMember declared first — must precede useEffect/useCommanderSync that reference it
  const fetchMember = async () => {
    try {
      // Use the dealer scan API to validate QR code
      const res = await commanderFetch('/api/commander/dealer/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_code: code })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();

      if (!json.success) {
        setError(json.error || 'Member not found');
        setLoading(false);
        return;
      }

      setMember(json.data.member);
      setMembershipActive(json.data.membership_active);
      setTimeBalance(json.data.time_balance_minutes || 0);

      // Check for active session
      if (json.data.already_seated) {
        const sessionRes = await commanderFetch(`/api/commander/dealer/sessions?table=${json.data.already_seated.table_number}`);
        if (!sessionRes.ok) throw new Error(`Session request failed (${sessionRes.status})`);
        const sessionJson = await sessionRes.json();
        if (sessionJson.success) {
          const mySession = (sessionJson.data || []).find(s => s.member_id === json.data.member.id);
          setActiveSession(mySession || null);
        }
      } else {
        setActiveSession(null);
      }
    } catch (err) {
      setError('Failed to load member data');
    } finally {
      setLoading(false);
    }
  };

useEffect(() => {

  if (!router.isReady) return;

    if (!code) return;
    fetchMember();
    const poll = setInterval(fetchMember, 30000); // fallback — real-time sync handles instant updates
    return () => clearInterval(poll);
  }, [code]);

  // Extract venueId for cross-device Supabase sync
  const [venueId] = useState(() => {
    return getVenueId();
  });

  // Commander Data Bus — sync member status in real-time
  useCommanderSync(venueId, fetchMember, { entities: ['members', 'tables'] });

  // Local countdown ticker
  useEffect(() => {
    const _ctrl = new AbortController();
    const ticker = setInterval(() => {
      if (activeSession) {
        setActiveSession(prev => prev ? ({
          ...prev,
          time_remaining: Math.max(0, (prev.time_remaining || 0) - 1)
        }) : null);
      }
      setNow(new Date());
    }, 1000);
    return () => { _ctrl.abort(); clearInterval(ticker); };
  }, [activeSession?.session_id]);
  if (loading) return (
    <div className="min-h-screen bg-[#18191A] flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-10 h-10 text-[#1877F2] animate-spin mx-auto mb-4" />
        <p className="text-[#B0B3B8] text-sm">Loading Your Account...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-[#18191A] flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <XCircle className="w-16 h-16 text-[#EF4444] mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Not Found</h2>
        <p className="text-[#B0B3B8]">{error}</p>
        <p className="text-sm text-[#B0B3B8] mt-4">Show This Screen To Staff For Help.</p>
      </div>
    </div>
  );

  const tierColor = TIER_COLORS[member?.membership_tier] || '#B0B3B8';
  const tierLabel = TIER_LABELS[member?.membership_tier] || 'Standard';
  const t = activeSession?.time_remaining;

  return (
    <>
      <SEOHead
        title="Commander — Details"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter'] p-4 pb-12 max-w-md mx-auto">

        {/* Header */}
        <div className="text-center mb-6 pt-2">
          <h1 className="text-2xl font-bold text-white">
            {member?.first_name} {member?.last_name}
          </h1>
          <div className="flex items-center justify-center gap-2 mt-1">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tierColor }} />
            <span className="text-sm font-medium" style={{ color: tierColor }}>{tierLabel} Member</span>
          </div>
          {member?.member_number && (
            <p className="text-xs text-[#B0B3B8] mt-1">{member.member_number}</p>
          )}
        </div>

        {/* Membership Status */}
        <div className={`rounded-2xl p-4 mb-3 border ${membershipActive
          ? 'bg-[#31A24C]/10 border-[#31A24C]/30'
          : 'bg-[#EF4444]/10 border-[#EF4444]/30'
          }`}>
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6" style={{ color: membershipActive ? '#31A24C' : '#EF4444' }} />
            <div>
              <p className="text-base font-semibold" style={{ color: membershipActive ? '#31A24C' : '#EF4444' }}>
                {membershipActive ? 'Membership Active' : 'Membership Inactive'}
              </p>
              {!membershipActive && (
                <p className="text-xs text-[#EF4444]">See Front Desk To Renew</p>
              )}
            </div>
          </div>
        </div>

        {/* Time Balance */}
        <div className={`rounded-2xl p-5 mb-3 border text-center ${timeBalance > 0
          ? 'bg-[#1877F2]/10 border-[#1877F2]/30'
          : 'bg-[#F59E0B]/10 border-[#F59E0B]/30'
          }`}>
          <Timer className="w-8 h-8 mx-auto mb-2" style={{ color: timeBalance > 0 ? '#1877F2' : '#F59E0B' }} />
          <p className="text-3xl font-bold text-white">{timeBalance} min</p>
          <p className="text-sm text-[#B0B3B8]">Time Balance On Card</p>
          {timeBalance === 0 && (
            <p className="text-xs text-[#F59E0B] mt-2">Visit The Kiosk Or Front Desk To Add Time</p>
          )}
        </div>

        {/* Active Session / Countdown */}
        {activeSession && (
          <div className="rounded-2xl p-5 mb-3 border text-center"
            style={{
              backgroundColor: `${getTimeColor(t)}10`,
              borderColor: `${getTimeColor(t)}40`
            }}>
            <p className="text-sm text-[#B0B3B8] mb-1">Currently Seated</p>
            <p className="text-lg font-bold text-white mb-3">
              Table {activeSession.table_number} — Seat {activeSession.seat_number}
            </p>
            <p className="text-5xl font-mono font-bold mb-1" style={{ color: getTimeColor(t) }}>
              {t !== null && t !== undefined ? formatCountdown(t) : '--:--'}
            </p>
            <p className="text-sm" style={{ color: getTimeColor(t) }}>
              {t <= 0 ? 'Time Expired — Add more time' :
                t <= 300 ? 'Time is running out!' :
                  t <= 900 ? 'Time is getting low' :
                    'Time remaining'}
            </p>
            {t <= 900 && t > 0 && (
              <p className="text-xs text-[#F59E0B] mt-3">
                Visit the kiosk or ask a dealer to add more time
              </p>
            )}
          </div>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-white">{member?.total_visits || 0}</p>
            <p className="text-[10px] text-[#B0B3B8]">Total Visits</p>
          </div>
          <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-white">
              {member?.total_visits ? new Date(member.last_visit || member.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--'}
            </p>
            <p className="text-[10px] text-[#B0B3B8]">Last Visit</p>
          </div>
        </div>

        {/* Actions */}
        {!activeSession && (
          <div className="space-y-2">
            {timeBalance > 0 && membershipActive && (
              <div className="bg-[#31A24C]/10 border border-[#31A24C]/30 rounded-xl p-4 text-center">
                <CheckCircle2 className="w-6 h-6 text-[#31A24C] mx-auto mb-2" />
                <p className="text-sm text-[#31A24C] font-medium">
                  Ready to play! Show this screen to a dealer to be seated.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Branding */}
        <div className="mt-8 text-center">
          <p className="text-white/10 text-xs tracking-wider">Powered By Smarter.Poker</p>
        </div>
      </div>
    </>
  );
}
