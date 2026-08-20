/**
 * Player Activity Report - Expanded
 * /commander/reports/player-activity
 * TC equivalent: "Player Reports" - deep player analytics
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import {
  Users, Clock, TrendingUp, Star, Loader2,
  BarChart3, Repeat, ChevronDown, Search, ArrowLeft
} from 'lucide-react';
import { busEmit } from '../../../src/engine/EventBus';
import { getStaffSession } from '../../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../../src/lib/commander/commanderFetch';

export default function PlayerActivityReport() {
  useEffect(() => { busEmit.sessionStart('commander-reports-player-activity'); }, []);
  const router = useRouter();
  const [players, setPlayers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('30d');
  const [sortBy, setSortBy] = useState('visits');
  const [search, setSearch] = useState('');
  const [expandedPlayer, setExpandedPlayer] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
const headers = { };
      const [membersRes, sessionsRes] = await Promise.all([
        commanderFetch(`/api/commander/members?sort=${sortBy}&limit=100`, { headers }).catch(() => ({ ok: false })),
        commanderFetch('/api/commander/time-billing/sessions?limit=200&status=all', { headers }).catch(() => ({ ok: false }))
      ]);
      if (!membersRes.ok) throw new Error(`Request failed (${membersRes.status})`);
      const [membersJson, sessionsJson] = await Promise.all([membersRes.json(), sessionsRes.json()]);
      // Members API nests under data.members - data itself is an object
      if (membersJson.success) setPlayers(membersJson.data?.members || (Array.isArray(membersJson.data) ? membersJson.data : []));
      if (sessionsJson.success) setSessions(Array.isArray(sessionsJson.data) ? sessionsJson.data : []);
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, [sortBy]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Calculate metrics
  const now = Date.now();
  const rangeMs = dateRange === '7d' ? 7 * 86400000 : dateRange === '30d' ? 30 * 86400000 : dateRange === '90d' ? 90 * 86400000 : 365 * 86400000;
  const cutoff = now - rangeMs;

  const recentPlayers = players.filter(p => p.last_checkin && new Date(p.last_checkin).getTime() > cutoff);
  const totalVisits = players.reduce((sum, p) => sum + (p.visit_count || 0), 0);
  const regulars = players.filter(p => (p.visit_count || 0) >= 5);
  const newThisMonth = players.filter(p => p.created_at && new Date(p.created_at).getTime() > (now - 30 * 86400000));

  const recentSessions = sessions.filter(s => s.started_at && new Date(s.started_at).getTime() > cutoff);
  const avgSessionMinutes = recentSessions.length > 0
    ? Math.round(recentSessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0) / recentSessions.length) : 0;

  // Game preference distribution
  const gamePrefs = {};
  sessions.forEach(s => { const g = s.game_type || 'Unknown'; gamePrefs[g] = (gamePrefs[g] || 0) + 1; });
  const sortedGames = Object.entries(gamePrefs || {}).sort((a, b) => b[1] - a[1]);
  const totalGameSessions = Object.values(gamePrefs || {}).reduce((a, b) => a + b, 0);

  // Visit frequency distribution
  const freqBuckets = { '1 visit': 0, '2-5': 0, '6-10': 0, '11-20': 0, '20+': 0 };
  players.forEach(p => {
    const v = p.visit_count || 0;
    if (v <= 1) freqBuckets['1 visit']++;
    else if (v <= 5) freqBuckets['2-5']++;
    else if (v <= 10) freqBuckets['6-10']++;
    else if (v <= 20) freqBuckets['11-20']++;
    else freqBuckets['20+']++;
  });

  const filteredPlayers = players.filter(p => {
    if (!search) return true;
    const name = (p.name || `${p.first_name || ''} ${p.last_name || ''}`).toLowerCase();
    return name.includes(search.toLowerCase());
  });

  function getPlayerSessions(playerId) {
    return sessions.filter(s => s.player_id === playerId || s.member_id === playerId).slice(0, 10);
  }

  return (
    <>
      <SEOHead
        title="Commander - Player Activity"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">
        <header className="bg-[#242526] border-b border-[#3A3B3C] sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => router.push('/commander/reports')} className="p-2 rounded-lg flex-shrink-0" style={{ background: '#3A3B3C', border: '1px solid #4A4B4C' }}><ArrowLeft className="w-5 h-5 text-white" /></button>
              <h1 className="text-lg font-bold text-white">Player Activity</h1>
            </div>
            <div className="flex items-center gap-2">
              {['7d', '30d', '90d', '1y'].map(r => (
                <button key={r} onClick={() => setDateRange(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${dateRange === r ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8] hover:bg-[#4A4B4C]'
                    }`}>{r}</button>
              ))}
            </div>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          {loading ? (
            <div className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin text-[#1877F2] mx-auto" /></div>
          ) : (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Total Members', value: players.length, icon: Users, color: '#1877F2' },
                  { label: 'Active (Period)', value: recentPlayers.length, icon: TrendingUp, color: '#31A24C' },
                  { label: 'Regulars (5+)', value: regulars.length, icon: Star, color: '#F59E0B' },
                  { label: 'New (30d)', value: newThisMonth.length, icon: Users, color: '#8B5CF6' },
                  { label: 'Avg Session', value: `${avgSessionMinutes}m`, icon: Clock, color: '#EF4444' },
                ].map(kpi => (
                  <div key={kpi.label} className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-3 text-center">
                    <kpi.icon className="w-5 h-5 mx-auto mb-1" style={{ color: kpi.color }} />
                    <p className="text-xl font-bold text-white">{kpi.value}</p>
                    <p className="text-[10px] text-[#B0B3B8] uppercase">{kpi.label}</p>
                  </div>
                ))}
              </div>

              {/* Game Preferences + Visit Frequency */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#242526] rounded-2xl border border-[#3A3B3C] p-4">
                  <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-[#1877F2]" /> Game Preferences
                  </h3>
                  {sortedGames.length === 0 ? (
                    <p className="text-sm text-[#B0B3B8] text-center py-4">No Session Data Yet</p>
                  ) : (
                    <div className="space-y-2">
                      {sortedGames.slice(0, 6).map(([game, count]) => {
                        const pct = totalGameSessions > 0 ? Math.round((count / totalGameSessions) * 100) : 0;
                        return (
                          <div key={game}>
                            <div className="flex justify-between text-sm mb-1">
                              <span className="text-[#E4E6EB]">{game}</span>
                              <span className="text-[#B0B3B8]">{count} ({pct}%)</span>
                            </div>
                            <div className="w-full bg-[#3A3B3C] rounded-full h-2">
                              <div className="bg-[#1877F2] h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="bg-[#242526] rounded-2xl border border-[#3A3B3C] p-4">
                  <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
                    <Repeat className="w-4 h-4 text-[#F59E0B]" /> Visit Frequency
                  </h3>
                  <div className="space-y-2">
                    {Object.entries(freqBuckets || {}).map(([label, count]) => {
                      const pct = players.length > 0 ? Math.round((count / players.length) * 100) : 0;
                      return (
                        <div key={label}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-[#E4E6EB]">{label} Visits</span>
                            <span className="text-[#B0B3B8]">{count} ({pct}%)</span>
                          </div>
                          <div className="w-full bg-[#3A3B3C] rounded-full h-2">
                            <div className="bg-[#F59E0B] h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Player Table */}
              <div className="bg-[#242526] rounded-2xl border border-[#3A3B3C] overflow-hidden">
                <div className="p-4 border-b border-[#3A3B3C] flex items-center justify-between">
                  <h3 className="font-semibold text-white">Player Leaderboard</h3>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-4 h-4 text-[#B0B3B8] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search..." className="pl-9 pr-3 py-1.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-xs text-white placeholder-[#6A6B6D] focus:outline-none focus:border-[#1877F2] w-40" />
                    </div>
                    <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                      className="px-3 py-1.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-xs text-white">
                      <option value="visits">Most Visits</option>
                      <option value="recent">Most Recent</option>
                      <option value="name">Name</option>
                    </select>
                  </div>
                </div>

                <div className="px-4 py-2 bg-[#3A3B3C]/30 grid grid-cols-12 text-xs text-[#B0B3B8] uppercase">
                  <span className="col-span-1">#</span>
                  <span className="col-span-4">Player</span>
                  <span className="col-span-2 text-center">Visits</span>
                  <span className="col-span-2 text-center">Member Since</span>
                  <span className="col-span-3 text-right">Last Visit</span>
                </div>

                <div className="divide-y divide-[#3A3B3C] max-h-[500px] overflow-y-auto">
                  {filteredPlayers.slice(0, 50).map((p, idx) => {
                    const name = p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
                    const isExpanded = expandedPlayer === p.id;
                    const playerSessions = isExpanded ? getPlayerSessions(p.id) : [];

                    return (
                      <>
                        <div key={p.id}>
                          <button onClick={() => setExpandedPlayer(isExpanded ? null : p.id)}
                            className="w-full px-4 py-3 grid grid-cols-12 items-center hover:bg-[#18191A] transition-colors text-left">
                            <span className="col-span-1 text-sm text-[#B0B3B8]">{idx + 1}</span>
                            <span className="col-span-4 text-sm text-[#E4E6EB] font-medium truncate flex items-center gap-2">
                              {name}
                              {(p.visit_count || 0) >= 20 && <Star className="w-3 h-3 text-[#F59E0B]" />}
                            </span>
                            <span className="col-span-2 text-center text-sm font-bold text-white">{p.visit_count || 0}</span>
                            <span className="col-span-2 text-center text-xs text-[#B0B3B8]">
                              {p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : '--'}
                            </span>
                            <span className="col-span-3 text-right text-xs text-[#B0B3B8] flex items-center justify-end gap-1">
                              {p.last_checkin ? new Date(p.last_checkin).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--'}
                              <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </span>
                          </button>

                          {isExpanded && (
                            <div className="px-4 pb-4 bg-[#18191A]">
                              <div className="grid grid-cols-3 gap-2 mb-3">
                                <div className="bg-[#242526] rounded-lg p-2 text-center">
                                  <p className="text-xs text-[#B0B3B8]">Phone</p>
                                  <p className="text-sm text-white">{p.phone || '-'}</p>
                                </div>
                                <div className="bg-[#242526] rounded-lg p-2 text-center">
                                  <p className="text-xs text-[#B0B3B8]">Email</p>
                                  <p className="text-sm text-white truncate">{p.email || '-'}</p>
                                </div>
                                <div className="bg-[#242526] rounded-lg p-2 text-center">
                                  <p className="text-xs text-[#B0B3B8]">Tier</p>
                                  <p className="text-sm text-white capitalize">{p.tier || 'bronze'}</p>
                                </div>
                              </div>
                              {playerSessions.length > 0 ? (
                                <div>
                                  <p className="text-xs text-[#B0B3B8] uppercase mb-2">Recent Sessions</p>
                                  <div className="space-y-1">
                                    {playerSessions.map(s => (
                                      <div key={s.id} className="flex items-center justify-between bg-[#242526] rounded-lg px-3 py-2 text-xs">
                                        <span className="text-white">{s.game_type || 'Cash'} {s.stakes || ''}</span>
                                        <span className="text-[#B0B3B8]">{s.duration_minutes ? `${s.duration_minutes}m` : '-'}</span>
                                        <span className="text-[#B0B3B8]">{s.started_at ? new Date(s.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs text-[#B0B3B8] text-center py-2">No Session History Available</p>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })}
                  {filteredPlayers.length === 0 && (
                    <div className="py-8 text-center text-[#B0B3B8] text-sm">No Players Found</div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      <style>{`
`}</style>
    </>
  );
}
