/**
 * Tournament Public Page
 * /commander/tournaments/[id]/public
 * 
 * Player-facing tournament info page (linked from QR codes, texts, clock display).
 * Features:
 * - Dynamic SEO/OG tags (shareable on social media)
 * - Tournament name, date, buy-in, status
 * - Live clock & blinds (when running)
 * - Chip counts leaderboard (during breaks)
 * - Final standings (when completed)
 * - Blind structure & payouts
 * - Share button (native share / clipboard copy)
 * - Post to My Smarter.Poker Page
 * 
 * No staff login required for viewing.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { Users, DollarSign, Trophy, Loader2, ChevronDown, ChevronUp, Share2, CheckCircle2, Copy } from 'lucide-react';
import useTournamentRealtime from '../../../../src/hooks/useTournamentRealtime';
import { busEmit, eventBus, EventType } from '../../../../src/engine/EventBus';
import useTrainingBus from '../../../../src/hooks/useTrainingBus';
import { getAuthToken, getAuthData } from '../../../../src/lib/getAuthToken';

const parseBlinds = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.length > 0) { try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch (e) { console.warn('[App] Handled exception:', e); } }
  return [];
};

// Prefer real name from profiles over manually typed player_name (alias)
function getName(e) {
  return e?.profiles?.display_name || e?.player_name || 'Unknown';
}

function formatTime(seconds) {
  if (!seconds && seconds !== 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ordinal(n) {
  if (!n) return '-';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const STATUS_CONFIG = {
  scheduled: { color: '#B0B3B8', label: 'Upcoming', bg: '#B0B3B8' },
  registering: { color: '#1877F2', label: 'Registration Open', bg: '#1877F2' },
  registration: { color: '#1877F2', label: 'Registration Open', bg: '#1877F2' },
  running: { color: '#31A24C', label: 'In Progress', bg: '#31A24C' },
  break: { color: '#F59E0B', label: 'On Break', bg: '#F59E0B' },
  final_table: { color: '#A855F7', label: 'Final Table', bg: '#A855F7' },
  completed: { color: '#31A24C', label: 'Completed', bg: '#31A24C' },
  cancelled: { color: '#EF4444', label: 'Cancelled', bg: '#EF4444' }
};

export default function TournamentPublic() {
  const router = useRouter();
  const { id } = router.query;
  useTrainingBus('commander-tournament-public');

  useEffect(() => { busEmit.sessionStart('commander-tournament-public'); }, []);
  const [tournament, setTournament] = useState(null);
  const [clock, setClock] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showStructure, setShowStructure] = useState(false);
  const [showPayouts, setShowPayouts] = useState(false);
  const [showChipCounts, setShowChipCounts] = useState(false);
  const [showResults, setShowResults] = useState(true);
  const [copied, setCopied] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchData = useCallback(async (signal) => {
    try {
      const fo = signal ? { signal } : {};
      const [tRes, cRes, eRes] = await Promise.all([
        fetch(`/api/commander/tournaments/${id}`, fo).then(r => r.json()).catch(() => ({ success: false })),
        fetch(`/api/commander/tournaments/${id}/clock`, fo).then(r => r.json()).catch(() => ({})),
        fetch(`/api/commander/tournaments/${id}/entries`, fo).then(r => r.json()).catch(() => ({ entries: [] }))
      ]);

      // Tournament API returns { success, data: { tournament } }
      if (tRes.data?.tournament) setTournament(tRes.data.tournament);
      else if (tRes.data) setTournament(tRes.data);
      else if (tRes.success) setTournament(tRes);

      // Clock API returns { success, data: { clock, currentBlind, nextBlind, tournament } }
      // Normalize to flat clock object the render expects
      if (cRes.data) {
        const cd = cRes.data;
        setClock({
          // currentBlind.level from the clock API is already the break-aware display number
          current_level: cd.currentBlind?.level || cd.tournament?.current_level || null,
          is_break: !!cd.currentBlind?.isBreak,
          break_label: cd.currentBlind?.label || null,
          time_remaining: cd.clock?.timeRemaining ?? null,
          is_running: cd.clock?.isRunning || false,
          blinds: cd.currentBlind ? {
            small_blind: cd.currentBlind.smallBlind,
            big_blind: cd.currentBlind.bigBlind,
            ante: cd.currentBlind.ante || 0
          } : null
        });
      }

      // 2026-07-25 audit fix: entries API returns { success, data: { entries } };
      // storing the whole data object made `entries` a non-array.
      setEntries(eRes.data?.entries || eRes.entries || []);
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    if (!router.isReady) return;

    const _c = new AbortController();
    fetchData(_c.signal);
    return () => { _c.abort(); };
  }, [id, fetchData, router.isReady]);

  // Supabase Realtime - instant sync when tournament data changes, with the
  // fallback poll adapting: 30s while the channel is unproven (unchanged),
  // 5 minutes once it has actually delivered an event to this page. This is
  // the public live page, so it is polled by every player in the room at once.
  useTournamentRealtime(id, fetchData, { poll: true });

  // EventBus - refresh on cross-page mutations
  useEffect(() => {
    const unsub = eventBus.on(EventType.DATA_MUTATED, (e) => {
      const relevant = ['tournament_updated', 'tournament_registration', 'tournament_created'];
      if (relevant.includes(e?.payload?.entity)) fetchData();
    });
    return () => unsub();
  }, [fetchData]);

  // Local clock tick
  useEffect(() => {
    if (!clock?.is_running) return;
    const tick = setInterval(() => {
      setClock(prev => prev ? ({
        ...prev,
        time_remaining: Math.max(0, (prev.time_remaining || 0) - 1)
      }) : null);
    }, 1000);
    return () => clearInterval(tick);
  }, [clock?.is_running, clock?.current_level]);

  // Local clock tick
  const handleShare = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const title = tournament ? `${tournament.name} - Tournament Results` : 'Tournament';
    const text = tournament ? `Check Out ${tournament.name}, $${tournament.buyin_amount || 0} Buy-In Tournament` : '';

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
      } catch (err) {
        if (err.name !== 'AbortError') console.warn(err);
      }
    } else {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* ignore */ }
    }
  };

  // Post to My Smarter.Poker Page
  const handlePostToMyPage = async () => {
    const authData = getAuthData();
    const token = authData?.access_token;
    if (!token) {
      // Redirect to login if not authenticated
      router.push(`/auth/login?redirect=${encodeURIComponent(router.asPath)}`);
      return;
    }

    setPosting(true);
    try {
      const t = tournament;
      const url = typeof window !== 'undefined' ? window.location.href : '';
      const localAllEntries = entries.length || t.current_entries || 0;
      const localPrizePool = localAllEntries * (t.buyin_amount || 0);
      const localActiveEntries = entries.filter(e => e.status === 'active' || e.status === 'playing' || e.status === 'registered');

      const content = t.status === 'completed'
        ? `Tournament Results: ${t.name} | $${t.buyin_amount || 0} Buy-In | ${entries.length} Entries | $${localPrizePool.toLocaleString()} Prize Pool | ${url}`
        : `Playing in: ${t.name} | $${t.buyin_amount || 0} Buy-In | ${localActiveEntries.length} Players Remaining | ${url}`;

      const res = await fetch('/api/social/create-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          content,
          content_type: 'tournament_result',
          visibility: 'public',
          metadata: {
            tournament_id: id,
            tournament_name: t.name,
            buyin: t.buyin_amount,
            entries: entries.length,
            prize_pool: localPrizePool
          }
        })
      });
      if (res.ok) {
        setPosted(true);
        setTimeout(() => setPosted(false), 3000);
      } else {
        // 2026-07-25 audit fix: surface non-OK responses instead of failing silently
        setToast({ type: 'error', text: 'Could Not Post To Your Page. Please Try Again.' });
      }
    } catch (err) { console.warn('Post error:', err); setToast({ type: 'error', text: 'Post Failed. Please Try Again.' }); }
    finally { setPosting(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#18191A] flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
    </div>
  );

  if (!tournament) return (
    <div className="min-h-screen bg-[#18191A] flex items-center justify-center p-6">
      <p className="text-[#B0B3B8] text-lg">Tournament Not Found</p>
    </div>
  );

  const t = tournament;
  const sc = STATUS_CONFIG[t.status] || STATUS_CONFIG.scheduled;
  const activeEntries = entries.filter(e => e.status === 'active' || e.status === 'playing' || e.status === 'registered');
  const eliminatedEntries = entries.filter(e => e.status === 'eliminated' || e.status === 'busted');
  const blindStructure = parseBlinds(t.blind_structure);
  const payoutStructure = t.payout_structure || t.custom_payouts || [];
  const allEntries = entries.length || t.current_entries || 0;
  // 2026-08-04 audit fix: prefer the recorded prize pool over the buy-in estimate
  const prizePool = t.actual_prizepool || allEntries * (t.buyin_amount || 0);
  const isCompleted = t.status === 'completed';
  const isLive = ['running', 'break', 'final_table'].includes(t.status);

  // Final standings: entries with finish_position, sorted
  const finalStandings = entries
    .filter(e => e.finish_position)
    .sort((a, b) => a.finish_position - b.finish_position);

  // Dynamic SEO
  const pageTitle = t.name ? `${t.name} - ${isCompleted ? 'Results' : isLive ? 'Live' : 'Tournament'}` : 'Tournament';
  const pageDesc = `${t.name || 'Tournament'} - $${t.buyin_amount || 0} Buy-In | ${allEntries} Entries | $${prizePool.toLocaleString()} Prize Pool`;
  const pageUrl = typeof window !== 'undefined' ? window.location.href : '';

  return (
    <>
      <Head>
        <title>{pageTitle} | Smarter.Poker</title>
        <meta name="description" content={pageDesc} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDesc} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:site_name" content="Smarter.Poker" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDesc} />
      </Head>
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter'] pb-12">

        {/* Header */}
        <div className="px-6 py-6 text-center" style={{ backgroundColor: `${sc.bg}10` }}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold mb-3"
            style={{ backgroundColor: `${sc.bg}20`, color: sc.color }}>
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: sc.bg }} />
            {sc.label}
          </div>
          <h1 className="text-2xl font-bold text-white">{t.name}</h1>
          {t.scheduled_start && (
            <p className="text-sm text-[#B0B3B8] mt-1">
              {new Date(t.scheduled_start).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              {' At '}
              {new Date(t.scheduled_start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </p>
          )}
          {/* Share + Post buttons */}
          <div className="flex items-center justify-center gap-2 mt-3">
            <button onClick={handleShare}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#242526] border border-[#3A3B3C] text-[#E4E6EB] text-xs font-semibold active:bg-[#3A3B3C]">
              {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-[#31A24C]" /> : <Share2 className="w-3.5 h-3.5" />}
              {copied ? 'Link Copied!' : 'Share'}
            </button>
            <button onClick={handlePostToMyPage} disabled={posting || posted}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold ${posted ? 'bg-[#31A24C]/20 border border-[#31A24C]/40 text-[#31A24C]' : 'bg-[#1877F2] text-white active:bg-[#1565D8]'} disabled:opacity-60`}>
              {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : posted ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {posted ? 'Posted!' : 'Post To My Page'}
            </button>
          </div>
        </div>

        {/* Live Clock (if running) */}
        {clock && isLive && (
          <div className="mx-4 mt-4 bg-[#242526] border border-[#3A3B3C] rounded-2xl p-5 text-center">
            <p className="text-xs text-[#B0B3B8] uppercase tracking-wider mb-1">
              {(t.status === 'break' || clock.is_break) ? (clock.break_label || 'Break') : `Level ${clock.current_level || '?'}`}
            </p>
            <p className="text-5xl font-mono font-bold text-white mb-2">
              {formatTime(clock.time_remaining)}
            </p>
            {clock.blinds && (
              <p className="text-lg text-[#1877F2] font-semibold">
                Blinds: {clock.blinds.small_blind?.toLocaleString()}/{clock.blinds.big_blind?.toLocaleString()}
                {clock.blinds.ante > 0 && ` (Ante ${clock.blinds.ante?.toLocaleString()})`}
              </p>
            )}
          </div>
        )}

        {/* COMPLETED: Winner banner */}
        {isCompleted && finalStandings.length > 0 && (
          <div className="mx-4 mt-4 bg-gradient-to-r from-[#F59E0B]/20 to-[#F59E0B]/5 border border-[#F59E0B]/30 rounded-2xl p-5 text-center">
            <Trophy className="w-10 h-10 text-[#F59E0B] mx-auto mb-2" />
            <p className="text-xs text-[#F59E0B] uppercase tracking-wider mb-1">Champion</p>
            <p className="text-2xl font-bold text-white">{getName(finalStandings[0]) || 'TBD'}</p>
            {finalStandings[0]?.payout_amount > 0 && (
              <p className="text-lg font-semibold text-[#31A24C] mt-1">${finalStandings[0].payout_amount.toLocaleString()}</p>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="px-4 mt-4 grid grid-cols-3 gap-2">
          <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-3 text-center">
            <DollarSign className="w-5 h-5 text-[#31A24C] mx-auto mb-1" />
            <p className="text-lg font-bold text-white">
              ${t.buyin_amount || 0}{t.buyin_fee ? `+$${t.buyin_fee}` : ''}
            </p>
            <p className="text-[10px] text-[#B0B3B8]">Buy-In</p>
          </div>
          <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-3 text-center">
            <Users className="w-5 h-5 text-[#1877F2] mx-auto mb-1" />
            <p className="text-lg font-bold text-white">{isCompleted ? allEntries : activeEntries.length}</p>
            <p className="text-[10px] text-[#B0B3B8]">
              {isCompleted ? 'Total Entries' : isLive ? 'Remaining' : 'Registered'}
            </p>
          </div>
          <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-3 text-center">
            <Trophy className="w-5 h-5 text-[#F59E0B] mx-auto mb-1" />
            <p className="text-lg font-bold text-white">${prizePool.toLocaleString()}</p>
            <p className="text-[10px] text-[#B0B3B8]">Prize Pool</p>
          </div>
        </div>

        {/* Info cards */}
        <div className="px-4 mt-4 space-y-2">
          {t.starting_chips && (
            <div className="flex items-center justify-between px-4 py-3 bg-[#242526] border border-[#3A3B3C] rounded-xl">
              <span className="text-sm text-[#B0B3B8]">Starting Chips</span>
              <span className="text-sm font-bold text-white">{t.starting_chips?.toLocaleString()}</span>
            </div>
          )}
          {t.tournament_type && (
            <div className="flex items-center justify-between px-4 py-3 bg-[#242526] border border-[#3A3B3C] rounded-xl">
              <span className="text-sm text-[#B0B3B8]">Format</span>
              <span className="text-sm font-bold text-white capitalize">{t.tournament_type}</span>
            </div>
          )}
          {/* 2026-08-04 audit fix: real columns are late_registration_levels / guaranteed_pool -
              the old field names never existed so these rows never rendered */}
          {t.late_registration_levels && (
            <div className="flex items-center justify-between px-4 py-3 bg-[#242526] border border-[#3A3B3C] rounded-xl">
              <span className="text-sm text-[#B0B3B8]">Late Reg</span>
              <span className="text-sm font-bold text-white">Through Level {t.late_registration_levels}</span>
            </div>
          )}
          {t.guaranteed_pool > 0 && (
            <div className="flex items-center justify-between px-4 py-3 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl">
              <span className="text-sm text-[#F59E0B]">Guaranteed</span>
              <span className="text-sm font-bold text-[#F59E0B]">${t.guaranteed_pool?.toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* COMPLETED: Final Standings */}
        {isCompleted && finalStandings.length > 0 && (
          <div className="px-4 mt-4">
            <button onClick={() => setShowResults(!showResults)}
              className="w-full flex items-center justify-between px-4 py-3 bg-[#242526] border border-[#3A3B3C] rounded-xl">
              <span className="text-sm font-semibold text-white">Final Standings ({finalStandings.length} Places)</span>
              {showResults ? <ChevronUp className="w-4 h-4 text-[#B0B3B8]" /> : <ChevronDown className="w-4 h-4 text-[#B0B3B8]" />}
            </button>
            {showResults && (
              <div className="mt-1 space-y-1">
                {finalStandings.map((e, i) => (
                  <div key={e.id || i} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border ${i === 0 ? 'bg-[#F59E0B]/10 border-[#F59E0B]/30' :
                    i === 1 ? 'bg-[#B0B3B8]/10 border-[#B0B3B8]/20' :
                      i === 2 ? 'bg-[#CD7F32]/10 border-[#CD7F32]/20' :
                        'bg-[#242526] border-[#3A3B3C]'
                    }`}>
                    <span className={`w-8 text-center text-sm font-bold ${i === 0 ? 'text-[#F59E0B]' : i === 1 ? 'text-[#B0B3B8]' : i === 2 ? 'text-[#CD7F32]' : 'text-[#B0B3B8]'
                      }`}>
                      {ordinal(e.finish_position)}
                    </span>
                    <span className="flex-1 text-sm font-medium text-white">{getName(e)}</span>
                    {e.payout_amount > 0 && (
                      <span className="text-sm font-bold text-[#31A24C]">${e.payout_amount.toLocaleString()}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Blind Structure (collapsible) */}
        {blindStructure.length > 0 && (
          <div className="px-4 mt-4">
            <button onClick={() => setShowStructure(!showStructure)}
              className="w-full flex items-center justify-between px-4 py-3 bg-[#242526] border border-[#3A3B3C] rounded-xl">
              <span className="text-sm font-semibold text-white">Blind Structure ({blindStructure.filter(l => !l.is_break).length} Levels)</span>
              {showStructure ? <ChevronUp className="w-4 h-4 text-[#B0B3B8]" /> : <ChevronDown className="w-4 h-4 text-[#B0B3B8]" />}
            </button>
            {showStructure && (
              <div className="mt-1 bg-[#242526] border border-[#3A3B3C] rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#3A3B3C] text-[#B0B3B8]">
                      <th className="px-3 py-2 text-left">Lvl</th>
                      <th className="px-3 py-2 text-right">SB</th>
                      <th className="px-3 py-2 text-right">BB</th>
                      <th className="px-3 py-2 text-right">Ante</th>
                      <th className="px-3 py-2 text-right">Min</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Break-aware numbering: current_level is the display number,
                      // so compare it against a counter that skips break rows.
                      let displayNum = 0;
                      return blindStructure.map((level, i) => {
                        const isBreakLvl = level.is_break;
                        if (!isBreakLvl) displayNum++;
                        const isCurrent = !isBreakLvl && !clock?.is_break && clock?.current_level === displayNum;
                        return (
                          <tr key={i} className={`border-b border-[#3A3B3C]/50 ${isCurrent ? 'bg-[#1877F2]/10 text-[#1877F2]' :
                            isBreakLvl ? 'bg-[#F59E0B]/5 text-[#F59E0B]' : 'text-white'
                            }`}>
                            <td className="px-3 py-2 font-medium">
                              {isBreakLvl ? (level.label || 'Break') : displayNum}{isCurrent ? ' *' : ''}
                            </td>
                            <td className="px-3 py-2 text-right">{isBreakLvl ? '-' : level.small_blind?.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">{isBreakLvl ? '-' : level.big_blind?.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">{isBreakLvl ? '-' : (level.ante || 0).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">{(level.duration ?? level.duration_minutes) || 20}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Payouts (collapsible) */}
        {payoutStructure.length > 0 && (
          <div className="px-4 mt-3">
            <button onClick={() => setShowPayouts(!showPayouts)}
              className="w-full flex items-center justify-between px-4 py-3 bg-[#242526] border border-[#3A3B3C] rounded-xl">
              <span className="text-sm font-semibold text-white">Payouts ({payoutStructure.length} Places)</span>
              {showPayouts ? <ChevronUp className="w-4 h-4 text-[#B0B3B8]" /> : <ChevronDown className="w-4 h-4 text-[#B0B3B8]" />}
            </button>
            {showPayouts && (
              <div className="mt-1 space-y-1">
                {payoutStructure.map((p, i) => {
                  const placeColors = ['#F59E0B', '#B0B3B8', '#CD7F32'];
                  const color = placeColors[i] || '#B0B3B8';
                  const amount = p.amount || (prizePool * (p.percentage || 0) / 100);
                  return (
                    <div key={i} className="flex items-center justify-between px-4 py-2 bg-[#242526] border border-[#3A3B3C] rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold" style={{ color }}>
                          {ordinal(i + 1)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold text-white">${amount.toLocaleString()}</span>
                        {p.percentage && <span className="text-[10px] text-[#B0B3B8] ml-1">({p.percentage}%)</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Chip Counts Leaderboard (live - during running/break/final_table) */}
        {isLive && entries
            .filter(e => (e.status === 'active' || e.status === 'playing' || e.status === 'seated') && e.current_chips > 0)
            .sort((a, b) => (b.current_chips || 0) - (a.current_chips || 0))
            .length > 0 && (
          <div className="px-4 mt-3">
            <button onClick={() => setShowChipCounts(!showChipCounts)}
              className="w-full flex items-center justify-between px-4 py-3 bg-[#242526] border border-[#3A3B3C] rounded-xl">
              <span className="text-sm font-semibold text-white">
                Chip Counts ({entries.filter(e => (e.status === 'active' || e.status === 'playing' || e.status === 'seated') && e.current_chips > 0).length} Players)
              </span>
              {showChipCounts ? <ChevronUp className="w-4 h-4 text-[#B0B3B8]" /> : <ChevronDown className="w-4 h-4 text-[#B0B3B8]" />}
            </button>
            {showChipCounts && (
              <div className="mt-1 space-y-1">
                {entries
                  .filter(e => (e.status === 'active' || e.status === 'playing' || e.status === 'seated') && e.current_chips > 0)
                  .sort((a, b) => (b.current_chips || 0) - (a.current_chips || 0))
                  .map((e, i) => (
                    <div key={e.id || i} className="flex items-center gap-3 px-4 py-2 bg-[#242526] border border-[#3A3B3C] rounded-lg">
                      <span className="w-8 text-center text-sm font-bold text-[#B0B3B8]">
                        {i + 1}.
                      </span>
                      <span className="flex-1 text-sm font-medium text-white">{getName(e)}</span>
                      <span className="text-sm font-bold text-[#31A24C] tabular-nums">{(e.current_chips || 0).toLocaleString()}</span>
                    </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Branding */}
        <div className="mt-8 text-center">
          <p className="text-white/10 text-xs tracking-wider">Powered By Smarter.Poker</p>
        </div>
      </div>
    
      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: toast.type === 'success' ? '#22C55E' : '#EF4444',
          color: '#fff', fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
          maxWidth: 360,
        }}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8,
          }}>×</button>
        </div>
      )}
    </>
  );
}
