/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Leaderboard TV Display - PRODUCTION v3
 * /commander/displays/leaderboard
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Self-generating + staff-managed leaderboard display.
 * 
 * AUTO-GENERATED BOARDS (from commander_members + sessions):
 *   Most Visits         - commander_members.total_visits ranked
 *   Hours Played        - from commander_player_sessions or estimate
 *   Today's Check-Ins   - who's here today
 *   VIP Hall of Fame    - tier + lifetime visits
 * 
 * LEAGUE BOARDS (from commander_leagues):
 *   [League Name]       - live standings with points, events, wins
 * 
 * CUSTOM BOARDS (from commander_leaderboards):
 *   [Custom Name]       - staff-created via leaderboard builder
 * 
 * Priority: Custom boards first → League boards → Auto boards
 * Auto-rotates 12s. Wake lock. Real-time via Commander Data Bus.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync } from '../../../src/lib/commander/useCommanderSync';
import DealerTicker from '../../../src/components/commander/shared/DealerTicker';
import useWakeLock from '../../../src/hooks/useWakeLock';
import { busEmit } from '../../../src/engine/EventBus';
import SEOHead from '../../../src/components/seo/SEOHead';
import { getToken, getStaffSession, getStaffData } from '../../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../../src/lib/commander/commanderFetch';

const MEDAL = ['#FFD700', '#C0C0C0', '#CD7F32'];
const MEDAL_E = ['1st', '2nd', '3rd'];

export default function LeaderboardDisplay() {
  useEffect(() => { busEmit.sessionStart('commander-displays-leaderboard'); }, []);
  const [boards, setBoards] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [now, setNow] = useState(new Date());
  const [venueName, setVenueName] = useState('');
  const [totalMembers, setTotalMembers] = useState(0);
  useWakeLock();

  const [venueId] = useState(() => {
    try { const s = getStaffData(); return s.venue_id || null; } catch { return null; }
  });

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════
  function mName(m) {
    const f = m.first_name || ''; const l = m.last_name || '';
    if (f && l) return `${f} ${l.charAt(0)}.`;
    return f || m.member_number || 'Member';
  }
  function tAgo(d) {
    if (!d) return '-';
    const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
    if (m < 1) return 'Just now'; if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
  function mSince(d) { return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '-'; }
  function fmtHours(h) {
    if (!h || h === 0) return '0h';
    if (h < 1) return `${Math.round(h * 60)}m`;
    return h >= 100 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`;
  }
  const TIERS = {
    platinum: { l: 'Platinum', i: '', c: '#E5E4E2' }, gold: { l: 'Gold', i: '', c: '#FFD700' },
    vip: { l: 'VIP', i: '', c: '#FFD700' }, silver: { l: 'Silver', i: '', c: '#C0C0C0' },
    annual: { l: 'Annual', i: '', c: '#8B5CF6' }, monthly: { l: 'Monthly', i: '', c: '#3B82F6' },
    weekly: { l: 'Weekly', i: '', c: '#10B981' }, daily: { l: 'Daily', i: '', c: '#6B7280' } };
  function ti(t) { return TIERS[(t || '').toLowerCase()] || { l: t || 'Member', i: '', c: '#6B7280' }; }

  // ═══════════════════════════════════════════════════════════════
  // FETCH & BUILD ALL BOARDS
  // ═══════════════════════════════════════════════════════════════
  const fetchData = useCallback(async (signal) => {
    if (!venueId) return;
    const staffSession = typeof window !== 'undefined' ? getStaffSession() || '' : '';
    const token = typeof window !== 'undefined' ? (getToken()) : '';
    const headers = { };
    const fetchOpts = signal ? { headers, signal } : { headers };
    try {
      // ── Fetch members ──
      const mRes = await commanderFetch(`/api/commander/members?venue_id=${venueId}&limit=200`, fetchOpts);
      if (!mRes.ok) throw new Error(`Request failed (${mRes.status})`);
      const mJson = await mRes.json();
      const members = (mJson?.data?.members || mJson?.members || []).filter(m => m.membership_status === 'active');
      setTotalMembers(members.length);
      if (!venueName) { try { setVenueName(getStaffData().venue_name || ''); } catch (e) { console.warn("[leaderboard.js]", e); } }

      const built = [];

      // ════════════════════════════════════════════════════════════
      // SECTION A: CUSTOM LEADERBOARDS (staff-created, first priority)
      // ════════════════════════════════════════════════════════════
      try {
        const lbRes = await commanderFetch(`/api/commander/leaderboards?venue_id=${venueId}&status=active`, fetchOpts);
        if (!lbRes.ok) throw new Error(`Request failed (${lbRes.status})`);
        const lbJson = await lbRes.json();
        const customs = lbJson?.leaderboards || lbJson?.data || [];
        if (Array.isArray(customs)) {
          const activeBoards = customs.slice(0, 4);
          const entryResults = await Promise.all(
            activeBoards.map(lb => commanderFetch(`/api/commander/leaderboards/${lb.id}/entries`, fetchOpts).then(r => r.json()).catch(() => ({})))
          );
          activeBoards.forEach((lb, idx) => {
            const entries = (entryResults[idx]?.entries || entryResults[idx]?.data || [])
              .sort((a, b) => (b.score || b.points || 0) - (a.score || a.points || 0));
            if (entries.length > 0) {
              const maxScore = Math.max(...entries.map(e => e.score || e.points || 0), 1);
              const typeLabel = lb.leaderboard_type === 'hours_played' ? 'HOURS' :
                lb.leaderboard_type === 'sessions' ? 'SESSIONS' :
                  lb.leaderboard_type === 'high_hand' ? 'HIGH HAND' :
                    lb.leaderboard_type === 'referrals' ? 'REFERRALS' : 'POINTS';
              built.push({
                id: `custom-${lb.id}`, icon: '', title: lb.name,
                subtitle: lb.description || `${entries.length} players • Staff-managed board`,
                scoreHeader: typeLabel, source: 'custom',
                entries: entries.slice(0, 15).map((e, i) => ({
                  rank: i + 1, name: e.player_name || e.profiles?.display_name || 'Player',
                  avatar: e.profiles?.avatar_url, score: e.score || e.points || 0,
                  scoreDisplay: lb.leaderboard_type === 'hours_played' ? fmtHours(e.hours_played || e.score || 0) : String(e.score || e.points || 0),
                  detail: [e.hours_played ? `${fmtHours(e.hours_played)} played` : null, e.sessions_count ? `${e.sessions_count} sessions` : null].filter(Boolean).join(' • ') || '',
                  barPct: Math.round(((e.score || e.points || 0) / maxScore) * 100) })) });
            }
          });
        }
      } catch (e) { console.warn("[leaderboard.js]", e); }

      // ════════════════════════════════════════════════════════════
      // SECTION B: LEAGUE STANDINGS
      // ════════════════════════════════════════════════════════════
      try {
        const lgRes = await commanderFetch(`/api/commander/leagues?venue_id=${venueId}&status=active`, fetchOpts);
        if (!lgRes.ok) throw new Error(`Request failed (${lgRes.status})`);
        const lgJson = await lgRes.json();
        const leagues = lgJson?.data?.leagues || lgJson?.leagues || [];
        if (Array.isArray(leagues)) {
          for (const lg of leagues.slice(0, 3)) {
            try {
              const stRes = await commanderFetch(`/api/commander/leagues/${lg.id}/standings?venue_id=${venueId}`, fetchOpts);
              if (!stRes.ok) throw new Error(`Request failed (${stRes.status})`);
              const stJson = await stRes.json();
              const standings = stJson?.data?.standings || stJson?.standings || [];
              if (standings.length > 0) {
                const maxPts = Math.max(...standings.map(s => s.points || 0), 1);
                built.push({
                  id: `league-${lg.id}`, icon: '', title: lg.name,
                  subtitle: `${standings.length} players • ${typeof lg.scoring_system === 'string' && !lg.scoring_system.startsWith('{') ? lg.scoring_system : 'Custom points'} system${lg.prize_pool ? ` • $${Number(lg.prize_pool).toLocaleString()} prize pool` : ''}`,
                  scoreHeader: 'POINTS', source: 'league',
                  entries: standings.slice(0, 15).map((s, i) => ({
                    rank: i + 1, name: s.player_name || 'Player', avatar: s.avatar_url,
                    score: s.points || 0, scoreDisplay: String(s.points || 0),
                    detail: [s.events_played ? `${s.events_played} events` : null, s.wins ? `${s.wins} wins` : null, s.cashes ? `${s.cashes} cashes` : null, s.earnings ? `$${Number(s.earnings).toLocaleString()}` : null].filter(Boolean).join(' • '),
                    barPct: Math.round(((s.points || 0) / maxPts) * 100) })) });
              }
            } catch (e) { console.warn("[leaderboard.js]", e); }
          }
        }
      } catch (e) { console.warn("[leaderboard.js]", e); }

      // ════════════════════════════════════════════════════════════
      // SECTION C: AUTO-GENERATED BOARDS
      // ════════════════════════════════════════════════════════════

      // ── C1: Hours Played ──
      try {
        const hRes = await commanderFetch(`/api/commander/members/hours?venue_id=${venueId}&period=all&limit=15`, fetchOpts);
        if (!hRes.ok) throw new Error(`Request failed (${hRes.status})`);
        const hJson = await hRes.json();
        const players = hJson?.data?.players || [];
        if (players.length > 0 && players.some(p => p.total_hours > 0)) {
          const maxH = Math.max(...players.map(p => p.total_hours), 1);
          built.push({
            id: 'hours', icon: '', title: 'Hours Played - All Time',
            subtitle: `${players.length} players ranked by total play time${!hJson?.data?.has_session_data ? ' (estimated from visits)' : ''}`,
            scoreHeader: 'HOURS', source: 'auto',
            entries: players.slice(0, 15).map((p, i) => ({
              rank: p.rank || i + 1, name: mName(p),
              avatar: p.photo_url, score: p.total_hours,
              scoreDisplay: fmtHours(p.total_hours),
              detail: `${p.session_count} sessions • ${p.visit_count} visits • ${ti(p.membership_tier).i} ${ti(p.membership_tier).l}`,
              barPct: Math.round((p.total_hours / maxH) * 100),
              tier: p.membership_tier })) });
        }
      } catch (e) { console.warn("[leaderboard.js]", e); }

      // ── C2: Most Visits (All Time) ──
      const byVisits = [...members].filter(m => (m.total_visits || 0) > 0).sort((a, b) => (b.total_visits || 0) - (a.total_visits || 0)).slice(0, 15);
      if (byVisits.length > 0) {
        const topV = byVisits[0].total_visits || 1;
        built.push({
          id: 'visits', icon: '', title: 'Most Visits - All Time',
          subtitle: `Top ${byVisits.length} by total check-ins | ${members.length} total members`,
          scoreHeader: 'VISITS', source: 'auto',
          entries: byVisits.map((m, i) => ({
            rank: i + 1, name: mName(m), avatar: m.photo_url, score: m.total_visits || 0,
            scoreDisplay: String(m.total_visits), detail: m.last_visit ? `Last seen ${tAgo(m.last_visit)}` : 'Never checked in',
            barPct: Math.round(((m.total_visits || 0) / topV) * 100), tier: m.membership_tier })) });
      }

      // ── C3: Today's Check-Ins ──
      const tStart = new Date(); tStart.setHours(0, 0, 0, 0);
      const todayIn = [...members].filter(m => m.last_visit && new Date(m.last_visit) >= tStart).sort((a, b) => new Date(b.last_visit) - new Date(a.last_visit)).slice(0, 15);
      if (todayIn.length > 0) {
        built.push({
          id: 'today', icon: '', title: "Today's Check-Ins",
          subtitle: `${todayIn.length} player${todayIn.length !== 1 ? 's' : ''} today | ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
          scoreHeader: 'CHECKED IN', source: 'auto',
          entries: todayIn.map((m, i) => ({
            rank: i + 1, name: mName(m), avatar: m.photo_url, score: m.total_visits || 0,
            scoreDisplay: tAgo(m.last_visit), detail: `${m.total_visits || 0} lifetime visits • ${ti(m.membership_tier).l}`,
            barPct: 0, tier: m.membership_tier })) });
      }

      // ── C4: VIP Hall of Fame ──
      const vips = [...members].filter(m => m.membership_tier && m.membership_tier !== 'daily')
        .sort((a, b) => { const o = { platinum: 0, gold: 1, vip: 2, silver: 3, annual: 4, monthly: 5, weekly: 6 }; return (o[(a.membership_tier || '').toLowerCase()] ?? 99) - (o[(b.membership_tier || '').toLowerCase()] ?? 99) || (b.total_visits || 0) - (a.total_visits || 0); })
        .slice(0, 15);
      if (vips.length > 0 && vips.some(m => (m.total_visits || 0) > 0)) {
        built.push({
          id: 'vip', icon: '', title: 'VIP Hall of Fame',
          subtitle: `${vips.length} premium members | Ranked by tier and activity`,
          scoreHeader: 'VISITS', source: 'auto',
          entries: vips.map((m, i) => ({
            rank: i + 1, name: mName(m), avatar: m.photo_url, score: m.total_visits || 0,
            scoreDisplay: String(m.total_visits || 0), detail: `${ti(m.membership_tier).i} ${ti(m.membership_tier).l} • Member since ${mSince(m.created_at)}`,
            barPct: 0, tier: m.membership_tier, tierBadge: true })) });
      }

      // ── FALLBACK ──
      if (built.length === 0) {
        built.push({ id: 'setup', icon: '', title: 'Leaderboard Setup', subtitle: 'Check in members or create custom boards', scoreHeader: '', source: 'none', entries: [] });
      }

      setBoards(built);
    } catch (err) { if (err.name !== 'AbortError') console.warn('[LeaderboardDisplay]', err); }
  }, [venueId]);

  // ── TIMERS ──
  useEffect(() => { const controller = new AbortController(); fetchData(controller.signal); const p = setInterval(() => fetchData(controller.signal), 30000); const c = setInterval(() => setNow(new Date()), 1000); return () => { controller.abort(); clearInterval(p); clearInterval(c); }; }, [fetchData]);
  useEffect(() => { if (boards.length <= 1) return; const r = setInterval(() => setActiveIdx(p => (p + 1) % boards.length), 12000); return () => clearInterval(r); }, [boards.length]);
  useCommanderSync(venueId, fetchData, { entities: ['members'] });

  const goFS = () => document.documentElement.requestFullscreen?.();
  const board = boards[activeIdx] || boards[0];

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <CommanderLayout title="Leaderboard Display" backHref="/commander/dashboard?card=displays">
      <SEOHead
              title="Commander - Leaderboard Display"
              description="Club Commander Poker Room Management Tool."
              noindex={true}
            />
      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateX(-30px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes crownPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.2); } }
        @keyframes barGrow { from { width: 0; } }
        .lb-row { animation: slideIn 0.35s ease-out forwards; opacity: 0; }
        .crown { animation: crownPulse 2.5s ease-in-out infinite; display: inline-block; }
        .bar-fill { animation: barGrow 0.6s ease-out forwards; }
      `}</style>

      <div onClick={goFS} className="bg-black text-white font-['Inter'] select-none flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>
        {/* HEADER */}
        <div className="bg-gradient-to-r from-[#1877F2] to-[#6366F1] px-8 py-4 flex items-center justify-between flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold truncate">{board?.icon} {board?.title || 'Leaderboard'}</h1>
              {board?.source === 'custom' && <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-bold">CUSTOM</span>}
              {board?.source === 'league' && <span className="text-[10px] bg-yellow-500/30 text-yellow-300 px-2 py-0.5 rounded-full font-bold">LEAGUE</span>}
            </div>
            <p className="text-sm text-white/70 mt-0.5 truncate">{board?.subtitle}</p>
          </div>
          <div className="text-right flex-shrink-0 ml-4">
            <p className="text-3xl font-mono font-bold tabular-nums">{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
            {boards.length > 1 && (
              <div className="flex gap-2 justify-end mt-1.5">
                {boards.map((b, i) => (
                  <button key={i} onClick={e => { e.stopPropagation(); setActiveIdx(i); }}
                    className={`h-2 rounded-full transition-all duration-500 cursor-pointer ${i === activeIdx ? 'w-6 bg-white' : 'w-2 bg-white/30 hover:bg-white/50'}`}
                    title={b.title} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* CONTENT */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {!board || board.entries.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-6 px-8">
              <div className="text-7xl"></div>
              <div className="text-center max-w-lg">
                <p className="text-2xl font-bold text-white/40 mb-3">No Leaderboard Data Yet</p>
                <div className="text-left bg-white/5 rounded-xl p-6 border border-white/10 space-y-3">
                  <p className="text-sm text-white/50 font-semibold uppercase tracking-wider mb-3">How to get started:</p>
                  <div className="flex items-start gap-3 text-sm text-white/40"><span className="text-lg">1.</span><p><strong className="text-white/60">Add Members</strong> - Register players in Commander → Members</p></div>
                  <div className="flex items-start gap-3 text-sm text-white/40"><span className="text-lg">2.</span><p><strong className="text-white/60">Check In Players</strong> - Track visits via kiosk or manual check-in</p></div>
                  <div className="flex items-start gap-3 text-sm text-white/40"><span className="text-lg">3.</span><p><strong className="text-white/60">Create Custom Boards</strong> - Go to Commander → Leaderboard Builder to add custom boards</p></div>
                  <div className="flex items-start gap-3 text-sm text-white/40"><span className="text-lg">4.</span><p><strong className="text-white/60">Create a League</strong> - Go to Commander → Leagues to set up a poker league with custom points</p></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="px-6 py-3">
              {/* Column header */}
              <div className="flex items-center px-4 py-2 text-[11px] text-white/25 uppercase tracking-widest font-semibold border-b border-white/5 mb-1">
                <span className="w-14 text-center">#</span>
                <span className="flex-1 pl-2">Player</span>
                <span className="w-36 text-right">{board.scoreHeader}</span>
              </div>

              {board.entries.map((entry, i) => {
                const rank = entry.rank || i + 1;
                const isTop3 = rank <= 3;
                const mc = isTop3 ? MEDAL[rank - 1] : null;
                const t = ti(entry.tier);

                return (
                  <div key={`${board.id}-${i}`} className="lb-row flex items-center px-4 py-2.5 rounded-lg mb-0.5"
                    style={{ animationDelay: `${i * 50}ms`, background: isTop3 ? `linear-gradient(90deg, ${mc}0D 0%, transparent 60%)` : i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>

                    {/* Rank */}
                    <div className="w-14 flex items-center justify-center flex-shrink-0">
                      {isTop3 ? <span className={`text-2xl ${rank === 1 ? 'crown' : ''}`}>{MEDAL_E[rank - 1]}</span> : <span className="text-base font-bold text-white/20 font-mono">{rank}</span>}
                    </div>

                    {/* Player */}
                    <div className="flex-1 flex items-center gap-3 min-w-0 pl-1">
                      <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden"
                        style={{ background: mc ? `${mc}20` : 'rgba(255,255,255,0.06)', border: mc ? `2px solid ${mc}50` : '2px solid rgba(255,255,255,0.05)' }}>
                        {entry.avatar ? <img src={entry.avatar} alt="" className="w-full h-full object-cover"  loading="lazy" /> : <span className="text-sm font-bold" style={{ color: mc || 'rgba(255,255,255,0.25)' }}>{entry.name?.charAt(0)?.toUpperCase()}</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold truncate ${isTop3 ? 'text-white text-base' : 'text-white/70 text-sm'}`}>{entry.name}</span>
                          {entry.tierBadge && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: `${t.c}20`, color: t.c, border: `1px solid ${t.c}30` }}>{t.i} {t.l}</span>}
                        </div>
                        {entry.detail && <p className="text-[11px] text-white/25 truncate mt-0.5">{entry.detail}</p>}
                        {entry.barPct > 0 && (
                          <div className="h-1 bg-white/5 rounded-full mt-1.5 overflow-hidden" style={{ maxWidth: '200px' }}>
                            <div className="bar-fill h-full rounded-full" style={{ width: `${entry.barPct}%`, animationDelay: `${i * 50 + 200}ms`, background: mc ? `linear-gradient(90deg, ${mc}, ${mc}80)` : 'linear-gradient(90deg, #3B82F6, #6366F1)' }} />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Score */}
                    <div className="w-36 text-right flex-shrink-0 pl-2">
                      <div className={`font-mono font-bold ${isTop3 ? 'text-xl' : 'text-base text-white/40'}`} style={mc ? { color: mc } : {}}>{entry.scoreDisplay}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* TICKER */}
        <div className="flex-shrink-0"><DealerTicker accentColor="#6366F1" bgColor="#000" fontSize={18} borderColor="rgba(255,255,255,0.1)" speed={50} showBorder={true} /></div>

        {/* FOOTER */}
        <div className="border-t border-white/10 px-6 py-1.5 flex items-center justify-between flex-shrink-0">
          <p className="text-white/15 text-xs">{boards.length > 1 && `Board ${activeIdx + 1}/${boards.length} • `}{totalMembers > 0 && `${totalMembers} members • `}Auto-refreshes</p>
          <p className="text-white/15 text-xs tracking-wider">Powered By Smarter.Poker</p>
        </div>
      </div>
    </CommanderLayout>
  );
}
