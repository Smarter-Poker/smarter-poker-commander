/**
 * Player Waitlist Status
 * /commander/waitlist/status/[id]
 * 
 * What players see on their phone after joining the waitlist.
 * Shows:
 * - Their position in line
 * - Estimated wait time
 * - Game type they're waiting for
 * - Live updates when position changes
 * - Notification when called
 * 
 * No login required - URL serves as auth token.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import { supabase } from '../../../../src/lib/supabase';
import { Clock, CheckCircle2, AlertTriangle, Loader2, Bell, XCircle } from 'lucide-react';
import { commanderFetch } from '../../../../src/lib/commander/commanderFetch';

export default function WaitlistStatus() {
  const router = useRouter();
  const { id } = router.query;
  const [entry, setEntry] = useState(null);
  const [position, setPosition] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStatus = useCallback(async (signal) => {

  if (!router.isReady) return null;

    if (!id) return;
    try {
      const res = await commanderFetch(`/api/commander/waitlist/${id}`);
      // HIGH FIX #2b: Add response.ok check before .json()
      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      const json = await res.json();
      if (!json.success) {
        setError('Entry not found');
        setLoading(false);
        return;
      }
      setEntry(json.data);

      // Get position in waitlist
      // 2026-07-25 audit fix: waitlist handler requires venue_id (400s without it) - scope to the entry's venue
      const listRes = await commanderFetch(`/api/commander/waitlist?venue_id=${json.data.venue_id}`);
      // HIGH FIX #2c: Add response.ok check before .json()
      if (!listRes.ok) {
        const errorText = await listRes.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${listRes.status}: ${errorText}`);
      }
      const listJson = await listRes.json();
      if (listJson.success) {
        const waiting = (listJson.data || [])
          .filter(w => w.status === 'waiting' && w.game_type === json.data.game_type)
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const pos = waiting.findIndex(w => w.id === id);
        setPosition(pos >= 0 ? pos + 1 : null);
      }
    } catch (err) {
      setError('Failed to load status');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const _c = new AbortController();
    fetchStatus(_c.signal);
    const poll = setInterval(() => fetchStatus(_c.signal), 15000); // fallback - Supabase Realtime handles instant updates
    return () => { _c.abort(); clearInterval(poll); };
  }, [id, fetchStatus]);

  // Supabase Realtime - instant updates when waitlist changes
  const channelRef = useRef(null);
  const reconnectsRef = useRef(0);
  useEffect(() => {
    if (!id) return;
    const MAX_RECONNECT = 3;

    function connectChannel() {
      if (channelRef.current) {
        try { supabase.removeChannel(channelRef.current); } catch { /* ignore */ }
        channelRef.current = null;
      }
      const channel = supabase
        .channel(`waitlist-status-${id}-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'commander_waitlist', filter: `id=eq.${id}` }, () => fetchStatus())
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            reconnectsRef.current = 0;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`[WaitlistStatus] Realtime channel error: ${status}`);
            if (reconnectsRef.current < MAX_RECONNECT) {
              reconnectsRef.current++;
              setTimeout(connectChannel, 3000 * reconnectsRef.current);
            }
          }
        });
      channelRef.current = channel;
    }

    connectChannel();
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [id, fetchStatus]);

  if (loading) return (
    <div className="min-h-screen bg-[#18191A] flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-[#18191A] flex items-center justify-center p-6">
      <div className="text-center">
        <XCircle className="w-16 h-16 text-[#EF4444] mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">{error}</h2>
        <p className="text-sm text-[#B0B3B8]">This Link May Have Expired.</p>
      </div>
    </div>
  );

  const status = entry?.status;
  const isCalled = status === 'called';
  const isSeated = status === 'seated';
  const isWaiting = status === 'waiting';
  const isPassed = status === 'passed' || status === 'removed' || status === 'expired';
  const estWait = position ? position * (entry?.est_wait_per_player || 15) : null;

  return (
    <>
      <SEOHead
        title="Commander - Details"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter'] flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">

          {/* Player name */}
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white">
              {entry?.player_name || entry?.name || 'Player'}
            </h1>
            <p className="text-sm text-[#B0B3B8] mt-1">{entry?.game_type || 'Cash Game'}</p>
          </div>

          {/* CALLED - urgent notification */}
          {isCalled && (
            <div className="bg-[#31A24C] rounded-2xl p-6 text-center animate-pulse">
              <Bell className="w-12 h-12 text-white mx-auto mb-3" />
              <h2 className="text-3xl font-bold text-white mb-2">YOUR SEAT IS READY</h2>
              <p className="text-white/80">Please Report To The Front Desk Immediately</p>
              <p className="text-white/60 text-sm mt-3">
                You have {entry?.call_timeout || 5} minutes to respond
              </p>
            </div>
          )}

          {/* SEATED - done */}
          {isSeated && (
            <div className="bg-[#1877F2]/10 border-2 border-[#1877F2]/40 rounded-2xl p-6 text-center">
              <CheckCircle2 className="w-12 h-12 text-[#1877F2] mx-auto mb-3" />
              <h2 className="text-2xl font-bold text-white">Seated</h2>
              <p className="text-[#B0B3B8] mt-1">You've Been Seated. Enjoy Your Game!</p>
              {entry?.table_number && (
                <p className="text-lg font-bold text-[#1877F2] mt-3">Table {entry.table_number}</p>
              )}
            </div>
          )}

          {/* WAITING - show position */}
          {isWaiting && (
            <>
              <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl p-8 text-center">
                <p className="text-sm text-[#B0B3B8] mb-2">Your Position</p>
                <p className="text-7xl font-bold text-[#1877F2]">{position || '-'}</p>
                <p className="text-sm text-[#B0B3B8] mt-2">
                  {position === 1 ? "You're next!" : position ? `${position - 1} ahead of you` : 'Calculating...'}
                </p>
              </div>

              {estWait && (
                <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl p-4 flex items-center gap-3">
                  <Clock className="w-6 h-6 text-[#F59E0B]" />
                  <div>
                    <p className="text-base font-semibold text-white">~{estWait} min estimated</p>
                    <p className="text-xs text-[#B0B3B8]">We'll Notify You When Called</p>
                  </div>
                </div>
              )}

              <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4 text-center">
                <p className="text-xs text-[#B0B3B8]">Live Updates Active</p>
                <p className="text-xs text-[#B0B3B8] mt-1">Position Updates Instantly</p>
              </div>
            </>
          )}

          {/* PASSED / REMOVED */}
          {isPassed && (
            <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-2xl p-6 text-center">
              <AlertTriangle className="w-12 h-12 text-[#EF4444] mx-auto mb-3" />
              <h2 className="text-xl font-bold text-white">
                {status === 'passed' ? 'Seat Passed' : status === 'expired' ? 'Entry Expired' : 'Removed'}
              </h2>
              <p className="text-[#B0B3B8] mt-2">
                {status === 'passed'
                  ? 'Your seat was passed. Visit the desk to rejoin.'
                  : 'Your waitlist entry is no longer active.'}
              </p>
            </div>
          )}

          {/* Join time */}
          {entry?.created_at && (
            <p className="text-center text-xs text-[#B0B3B8]">
              Joined at {new Date(entry.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </p>
          )}

          <div className="text-center">
            <p className="text-white/10 text-xs tracking-wider">Powered By Smarter.Poker</p>
          </div>
        </div>
      </div>
    </>
  );
}
