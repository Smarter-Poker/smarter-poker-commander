/**
 * Staff Analytics Dashboard
 * View venue performance metrics and player stats
 * Dark industrial sci-fi gaming theme
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { BarChart3, Users, DollarSign, Clock, TrendingUp, TrendingDown, Trophy, Target, Loader2 } from 'lucide-react';
// Peak Hours Grid — visual heatmap of hour-by-hour activity
function PeakHoursGrid({ analytics }) {
  // Build hourly counts from analytics data
  const hourCounts = new Array(24).fill(0);
  (analytics || []).forEach(day => {
    if (day.peak_hour != null) {
      hourCounts[day.peak_hour] += (day.total_sessions || 1);
    }
  });
  const maxCount = Math.max(...hourCounts, 1);

  return (
    <div className="cmd-panel p-6">
      <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
        <Clock className="w-5 h-5 text-[#F59E0B]" />
        Peak Hours Heatmap
      </h3>
      <div className="grid grid-cols-12 gap-1">
        {hourCounts.map((count, hour) => {
          const intensity = count / maxCount;
          const h = hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`;
          return (
            <div key={hour} className="flex flex-col items-center gap-1">
              <div
                className="w-full aspect-square rounded-sm transition-colors"
                style={{
                  backgroundColor: intensity > 0
                    ? `rgba(24, 119, 242, ${0.15 + intensity * 0.85})`
                    : '#3A3B3C'
                }}
                title={`${h}: ${count} sessions`}
              />
              {hour % 3 === 0 && (
                <span className="text-[10px] text-[#B0B3B8]">{h}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <span className="text-xs text-[#B0B3B8]">Less</span>
        {[0.15, 0.35, 0.55, 0.75, 1].map((opacity, i) => (
          <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: `rgba(24, 119, 242, ${opacity})` }} />
        ))}
        <span className="text-xs text-[#B0B3B8]">More</span>
      </div>
    </div>
  );
}

// Activity Trend Line — SVG sparkline
function ActivityTrendLine({ dailyData }) {
  const data = dailyData || [];
  if (data.length < 2) return (
    <div className="cmd-panel p-6">
      <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-[#31A24C]" />
        Activity Trend
      </h3>
      <p className="text-sm text-[#B0B3B8]">Not enough data for trend visualization</p>
    </div>
  );

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const width = 400;
  const height = 120;
  const padding = 10;
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * usableW;
    const y = padding + usableH - (d.value / maxVal) * usableH;
    return `${x},${y}`;
  });

  const areaPoints = [...points, `${padding + usableW},${padding + usableH}`, `${padding},${padding + usableH}`];

  return (
    <div className="cmd-panel p-6">
      <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-[#31A24C]" />
        Activity Trend
      </h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: 140 }}>
        {/* Gradient fill */}
        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1877F2" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#1877F2" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={areaPoints.join(' ')} fill="url(#trendGrad)" />
        <polyline points={points.join(' ')} fill="none" stroke="#1877F2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* Data point dots */}
        {data.map((d, i) => {
          const x = padding + (i / (data.length - 1)) * usableW;
          const y = padding + usableH - (d.value / maxVal) * usableH;
          return <circle key={i} cx={x} cy={y} r="3.5" fill="#1877F2" stroke="#18191A" strokeWidth="1.5" />;
        })}
      </svg>
      <div className="flex justify-between mt-2">
        {data.map((d, i) => (
          <span key={i} className="text-[10px] text-[#B0B3B8]">{d.label}</span>
        ))}
      </div>
    </div>
  );
}
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';

function StatCard({ title, value, change, icon: Icon, color = '#1877F2' }) {
  const hasChange = change !== undefined && change !== null;
  const isPositive = hasChange && change >= 0;

  return (
    <div className="cmd-panel p-4">
      <div className="flex items-start justify-between mb-2">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        {change === null ? (
          <span className="text-sm font-medium text-[#B0B3B8]">N/A</span>
        ) : hasChange ? (
          <div className={`flex items-center gap-1 text-sm font-medium ${isPositive ? 'text-[#31A24C]' : 'text-[#EF4444]'}`}>
            {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {Math.abs(change)}%
          </div>
        ) : null}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-sm text-[#B0B3B8]">{title}</p>
    </div>
  );
}

function SimpleBarChart({ data, label }) {
  const maxValue = Math.max(...(data || []).map(d => d.value), 1);

  return (
    <div className="space-y-2">
      {(data || []).map((item, index) => (
        <div key={index} className="flex items-center gap-3">
          <span className="text-sm text-[#B0B3B8] w-12">{item.label}</span>
          <div className="flex-1 h-6 bg-[#3A3B3C] rounded overflow-hidden">
            <div
              className="h-full bg-[#1877F2] rounded transition-all duration-500"
              style={{ width: `${(item.value / maxValue) * 100}%` }}
            />
          </div>
          <span className="text-sm font-medium text-white w-12 text-right">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function TopPlayersTable({ players }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-[#3A3B3C]">
            <th className="text-left py-3 px-4 text-sm font-medium text-[#B0B3B8]">Player</th>
            <th className="text-right py-3 px-4 text-sm font-medium text-[#B0B3B8]">Sessions</th>
            <th className="text-right py-3 px-4 text-sm font-medium text-[#B0B3B8]">Hours</th>
            <th className="text-right py-3 px-4 text-sm font-medium text-[#B0B3B8]">Buy-Ins</th>
          </tr>
        </thead>
        <tbody>
          {players.map((player, index) => (
            <tr key={player.id || index} className="border-b border-[#3A3B3C] last:border-b-0">
              <td className="py-3 px-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#1877F2]/10 flex items-center justify-center">
                    <span className="text-sm font-medium text-[#1877F2]">{index + 1}</span>
                  </div>
                  <span className="font-medium text-white">{player.name}</span>
                </div>
              </td>
              <td className="text-right py-3 px-4 text-white">{player.sessions}</td>
              <td className="text-right py-3 px-4 text-white">{player.hours}h</td>
              <td className="text-right py-3 px-4 font-medium text-[#31A24C]">${player.buyins.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AnalyticsPage() {
  useEffect(() => { busEmit.sessionStart('commander-analytics'); }, []);
  const router = useRouter();

  const [staff, setStaff] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [period, setPeriod] = useState('week');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalPlayers: 0,
    totalSessions: 0,
    totalHours: 0,
    totalBuyins: 0,
    avgSessionLength: 0,
    peakHour: '--',
    playersChange: undefined,
    sessionsChange: undefined,
    hoursChange: undefined,
    buyinsChange: undefined,
    dailyData: [],
    topPlayers: [],
    gameTypeBreakdown: []
  });
  const [analytics, setAnalytics] = useState([]);
  const [summary, setSummary] = useState({});

  useEffect(() => {
    const storedStaff = getStaffSession();
    if (!storedStaff) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
      return;
    }
    try {
      const staffData = JSON.parse(storedStaff);
      setStaff(staffData);
      setVenueId(staffData.venue_id);
    } catch (err) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    }
  }, [router]);

  const fetchAnalytics = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);

    try {
      // Convert period to days; fetch 2x to get previous period for comparison
      const periodDays = period === 'week' ? 7 : period === 'month' ? 30 : 365;
const headers = { };
      const [dailyRes, playersRes] = await Promise.all([
        fetch(`/api/commander/analytics/daily?venue_id=${venueId}&days=${periodDays * 2}`, { headers }).catch(() => ({ ok: false })),
        fetch(`/api/commander/analytics/players?venue_id=${venueId}&limit=10`, { headers }).catch(() => ({ ok: false }))
      ]);

      if (!dailyRes || !dailyRes.ok) throw new Error(`Daily analytics failed (${dailyRes?.status || 'network error'})`);
      const dailyData = await dailyRes.json();
      if (!playersRes || !playersRes.ok) throw new Error(`Players analytics failed (${playersRes?.status || 'network error'})`);
      const playersData = await playersRes.json();

      // API returns { analytics: [...], summary, period } and { players: [...], total, ... }
      const allDays = dailyData.analytics || [];
      setAnalytics(allDays);
      setSummary(dailyData.summary || {});
      const players = playersData.players || [];
      const totalPlayerCount = playersData.total || players.length;

      // allDays is sorted descending by date; split into current and previous periods
      const currentPeriod = allDays.slice(0, periodDays);
      const previousPeriod = allDays.slice(periodDays, periodDays * 2);

      // Aggregate current period stats
      const totalSessions = currentPeriod.reduce((sum, d) => sum + (d.total_sessions || 0), 0);
      const totalPlayHours = currentPeriod.reduce((sum, d) => sum + (parseFloat(d.total_play_hours) || 0), 0);
      const totalBuyin = currentPeriod.reduce((sum, d) => sum + (d.total_buyin || 0), 0);
      const curUniquePlayers = currentPeriod.reduce((sum, d) => sum + (d.unique_players || 0), 0);

      // Aggregate previous period stats for comparison
      const prevSessions = previousPeriod.reduce((sum, d) => sum + (d.total_sessions || 0), 0);
      const prevPlayHours = previousPeriod.reduce((sum, d) => sum + (parseFloat(d.total_play_hours) || 0), 0);
      const prevBuyin = previousPeriod.reduce((sum, d) => sum + (d.total_buyin || 0), 0);
      const prevUniquePlayers = previousPeriod.reduce((sum, d) => sum + (d.unique_players || 0), 0);

      // Calculate change percentages; returns null when no previous data (renders as "N/A")
      function calcChange(current, previous) {
        if (previous === 0) return null;
        return Math.round(((current - previous) / previous) * 100);
      }

      // Derive peak hour from the most frequent peak_hour weighted by sessions
      const peakHourWeights = {};
      currentPeriod.forEach(d => {
        if (d.peak_hour != null) {
          peakHourWeights[d.peak_hour] = (peakHourWeights[d.peak_hour] || 0) + (d.total_sessions || 1);
        }
      });
      let peakHour = '--';
      const peakEntries = Object.entries(peakHourWeights || {});
      if (peakEntries.length > 0) {
        const [topHourStr] = peakEntries.reduce((a, b) => (a[1] > b[1] ? a : b));
        const h = parseInt(topHourStr, 10);
        peakHour = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
      }

      // Game type breakdown from actual hours columns
      const nlheHours = currentPeriod.reduce((sum, d) => sum + (parseFloat(d.nlhe_hours) || 0), 0);
      const ploHours = currentPeriod.reduce((sum, d) => sum + (parseFloat(d.plo_hours) || 0), 0);
      const otherHours = currentPeriod.reduce((sum, d) => sum + (parseFloat(d.other_hours) || 0), 0);
      const gameTypeBreakdown = [];
      if (nlheHours > 0) gameTypeBreakdown.push({ label: 'NLHE', value: Math.round(nlheHours) });
      if (ploHours > 0) gameTypeBreakdown.push({ label: 'PLO', value: Math.round(ploHours) });
      if (otherHours > 0) gameTypeBreakdown.push({ label: 'Other', value: Math.round(otherHours) });

      setStats({
        totalPlayers: totalPlayerCount,
        totalSessions,
        totalHours: Math.round(totalPlayHours),
        totalBuyins: totalBuyin,
        avgSessionLength: totalSessions > 0 ? Math.round(totalPlayHours / totalSessions * 10) / 10 : 0,
        peakHour,
        playersChange: calcChange(curUniquePlayers, prevUniquePlayers),
        sessionsChange: calcChange(totalSessions, prevSessions),
        hoursChange: calcChange(totalPlayHours, prevPlayHours),
        buyinsChange: calcChange(totalBuyin, prevBuyin),
        dailyData: [...currentPeriod].reverse().slice(-7).map(d => ({
          label: new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' }),
          value: d.total_sessions || 0
        })),
        topPlayers: players.map(p => ({
          id: p.id,
          name: p.profiles?.display_name || p.display_name || 'Unknown',
          sessions: p.total_visits || 0,
          hours: Math.round(parseFloat(p.total_hours) || 0),
          buyins: p.total_buyin || 0
        })),
        gameTypeBreakdown
      });
    } catch (error) {
      console.warn('Fetch analytics failed:', error);
      setAnalytics([]);
      setSummary({});
      setStats({
        totalPlayers: 0,
        totalSessions: 0,
        totalHours: 0,
        totalBuyins: 0,
        avgSessionLength: 0,
        peakHour: '--',
        playersChange: undefined,
        sessionsChange: undefined,
        hoursChange: undefined,
        buyinsChange: undefined,
        dailyData: [],
        topPlayers: [],
        gameTypeBreakdown: []
      });
    } finally {
      setLoading(false);
    }
  }, [venueId, period]);

  useEffect(() => {
    if (venueId) fetchAnalytics();
  }, [venueId, period, fetchAnalytics]);

  // Commander Data Bus — refresh analytics on changes
  useCommanderSync(venueId, fetchAnalytics, { entities: ['tables', 'members', 'waitlist'] });

  if (!staff) {
    return (
      <div className="cmd-page flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
      </div>
    );
  }

  return (
    <CommanderLayout title="Analytics | Commander" backHref="/commander/dashboard?card=reports">
      <>
        <SEOHead
          title="Commander — Analytics & Reports"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />

        <div className="cmd-page">
          {/* Period selector */}
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-end">
            <div className="flex gap-2">
              {['week', 'month', 'year'].map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${period === p
                    ? 'bg-[#3A3B3C] text-[#1877F2] border-2 border-[#1877F2]'
                    : 'bg-[#242526] text-[#B0B3B8] border-2 border-[#3A3B3C] hover:bg-[#3A3B3C]'
                    }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
              </div>
            ) : (
              <>
                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard
                    title="Unique Players"
                    value={stats.totalPlayers}
                    change={stats.playersChange}
                    icon={Users}
                    color="#1877F2"
                  />
                  <StatCard
                    title="Total Sessions"
                    value={stats.totalSessions}
                    change={stats.sessionsChange}
                    icon={Target}
                    color="#31A24C"
                  />
                  <StatCard
                    title="Total Hours"
                    value={`${stats.totalHours}h`}
                    change={stats.hoursChange}
                    icon={Clock}
                    color="#1877F2"
                  />
                  <StatCard
                    title="Total Buy-Ins"
                    value={`$${stats.totalBuyins.toLocaleString()}`}
                    change={stats.buyinsChange}
                    icon={DollarSign}
                    color="#F59E0B"
                  />
                </div>

                {/* Charts Row */}
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Daily Sessions */}
                  <div className="cmd-panel p-6">
                    <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-[#1877F2]" />
                      Daily Sessions
                    </h3>
                    <SimpleBarChart data={stats.dailyData} label="Sessions" />
                  </div>

                  {/* Game Type Breakdown */}
                  <div className="cmd-panel p-6">
                    <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-[#F59E0B]" />
                      Game Type Breakdown
                    </h3>
                    <SimpleBarChart data={stats.gameTypeBreakdown} label="Sessions" />
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="cmd-panel p-4 text-center">
                    <p className="text-2xl font-bold text-white">{stats.avgSessionLength}h</p>
                    <p className="text-sm text-[#B0B3B8]">Avg Session</p>
                  </div>
                  <div className="cmd-panel p-4 text-center">
                    <p className="text-2xl font-bold text-white">{stats.peakHour}</p>
                    <p className="text-sm text-[#B0B3B8]">Peak Hour</p>
                  </div>
                  <div className="cmd-panel p-4 text-center">
                    <p className="text-2xl font-bold text-white">
                      ${stats.totalSessions > 0 ? Math.round(stats.totalBuyins / stats.totalSessions) : 0}
                    </p>
                    <p className="text-sm text-[#B0B3B8]">Avg Buy-In</p>
                  </div>
                  <div className="cmd-panel p-4 text-center">
                    <p className="text-2xl font-bold text-white">
                      {stats.totalPlayers > 0 ? (stats.totalSessions / stats.totalPlayers).toFixed(1) : 0}
                    </p>
                    <p className="text-sm text-[#B0B3B8]">Sessions/Player</p>
                  </div>
                </div>

                {/* Top Players */}
                <div className="cmd-panel">
                  <div className="p-4 border-b border-[#3A3B3C]">
                    <h3 className="font-semibold text-white flex items-center gap-2">
                      <Users className="w-5 h-5 text-[#1877F2]" />
                      Top Players
                    </h3>
                  </div>
                  <TopPlayersTable players={stats.topPlayers} />
                </div>

                {/* Peak Hours + Activity Trend */}
                <div className="grid md:grid-cols-2 gap-6">
                  <PeakHoursGrid analytics={analytics} />
                  <ActivityTrendLine dailyData={stats.dailyData} />
                </div>
              </>
            )}
          </main>
        </div>
        <style>{`
`}</style>
      </>
    </CommanderLayout>
  );
}
