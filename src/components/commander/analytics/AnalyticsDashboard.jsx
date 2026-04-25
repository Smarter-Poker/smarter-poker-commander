/**
 * AnalyticsDashboard Component
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * Dark industrial sci-fi gaming theme
 */
import React, { memo, useMemo, useState } from 'react';
import {
  Users, Clock, DollarSign, TrendingUp, TrendingDown,
  Calendar, Trophy, Gift, Activity, ChevronDown
} from 'lucide-react';

const PERIOD_OPTIONS = [
  { value: 7, label: 'Last 7 Days' },
  { value: 14, label: 'Last 14 Days' },
  { value: 30, label: 'Last 30 Days' },
  { value: 90, label: 'Last 90 Days' }
];

function StatCard({ icon: Icon, label, value, change, changeLabel, color = '#22D3EE' }) {
  const isPositive = change > 0;
  const isNegative = change < 0;

  return (
    <div className="cmd-panel p-4">
      <div className="flex items-start justify-between">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}20` }}
        >
          <Icon size={20} style={{ color }} />
        </div>
        {change !== undefined && change !== null && (
          <div className={`flex items-center gap-1 text-xs ${
            isPositive ? 'text-green-400' : isNegative ? 'text-red-400' : 'text-[#4A5E78]'
          }`}>
            {isPositive ? <TrendingUp size={14} /> : IsNegative ? <TrendingDown size={14} /> : null}
            {Math.abs(change).toFixed(1)}%
          </div>
        )}
      </div>
      <div className="mt-3">
        <div className="text-2xl font-bold text-white">{value}</div>
        <div className="text-sm text-[#64748B]">{label}</div>
        {changeLabel && (
          <div className="text-xs text-[#4A5E78] mt-1">{changeLabel}</div>
        )}
      </div>
    </div>
  );
}

function MiniChart({ data, color = '#22D3EE' }) {
  if (!data || data.length === 0) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  return (
    <div className="flex items-end gap-1 h-12">
      {data.map((value, idx) => (
        <div
          key={idx}
          className="flex-1 rounded-t"
          style={{
            backgroundColor: color,
            opacity: 0.4 + ((value - min) / range) * 0.6,
            height: `${20 + ((value - min) / range) * 80}%`
          }}
        />
      ))}
    </div>
  );
}

function AnalyticsDashboard({
  analytics = [],
  summary = {},
  isLoading = false,
  onPeriodChange
}) {
  const [period, setPeriod] = useState(30);
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);

  // Calculate trends from analytics data
  const trends = useMemo(() => {
    if (analytics.length < 2) return {};

    const midpoint = Math.floor(analytics.length / 2);
    const recent = analytics.slice(0, midpoint);
    const older = analytics.slice(midpoint);

    const calcAvg = (arr, field) => {
      const sum = arr.reduce((acc, item) => acc + (parseFloat(item[field]) || 0), 0);
      return arr.length > 0 ? sum / arr.length : 0;
    };

    const calcChange = (recentAvg, olderAvg) => {
      if (olderAvg === 0) return 0;
      return ((recentAvg - olderAvg) / olderAvg) * 100;
    };

    return {
      sessions: calcChange(calcAvg(recent, 'total_sessions'), calcAvg(older, 'total_sessions')),
      players: calcChange(calcAvg(recent, 'unique_players'), calcAvg(older, 'unique_players')),
      hours: calcChange(calcAvg(recent, 'total_play_hours'), calcAvg(older, 'total_play_hours')),
      buyin: calcChange(calcAvg(recent, 'total_buyin'), calcAvg(older, 'total_buyin'))
    };
  }, [analytics]);

  // Chart data
  const chartData = useMemo(() => ({
    sessions: analytics.slice(0, 14).reverse().map(d => d.total_sessions || 0),
    players: analytics.slice(0, 14).reverse().map(d => d.unique_players || 0),
    hours: analytics.slice(0, 14).reverse().map(d => parseFloat(d.total_play_hours) || 0)
  }), [analytics]);

  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    setShowPeriodDropdown(false);
    onPeriodChange?.(newPeriod);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 rounded animate-pulse bg-[#0D192E]" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div
              key={i}
              className="h-32 rounded-xl animate-pulse bg-[#0D192E]"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Analytics Overview</h2>
        <div className="relative">
          <button
            onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-[#0D192E] text-gray-200"
          >
            <Calendar size={16} />
            {PERIOD_OPTIONS.find(p => p.value === period)?.label}
            <ChevronDown size={16} />
          </button>
          {showPeriodDropdown && (
            <div className="absolute right-0 mt-2 w-40 rounded-lg shadow-lg z-10 cmd-panel">
              {PERIOD_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handlePeriodChange(opt.value)}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-[#132240] first:rounded-t-lg last:rounded-b-lg ${
                    period === opt.value ? 'text-[#22D3EE]' : 'text-gray-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Activity}
          label="Total Sessions"
          value={summary.total_sessions?.toLocaleString() || '0'}
          change={trends.sessions}
          color="#3B82F6"
        />
        <StatCard
          icon={Users}
          label="Unique Players"
          value={summary.unique_players?.toLocaleString() || '0'}
          change={trends.players}
          color="#8B5CF6"
        />
        <StatCard
          icon={Clock}
          label="Play Hours"
          value={summary.total_play_hours?.toFixed(0) || '0'}
          change={trends.hours}
          color="#10B981"
        />
        <StatCard
          icon={DollarSign}
          label="Total Buy-Ins"
          value={`$${(summary.total_buyin || 0).toLocaleString()}`}
          change={trends.buyin}
          color="#F59E0B"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Sessions Chart */}
        <div className="cmd-panel p-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-[#64748B]">Sessions</span>
            <Activity size={16} className="text-[#22D3EE]" />
          </div>
          <MiniChart data={chartData.sessions} color="#3B82F6" />
          <div className="text-xs text-[#4A5E78] mt-2">Last 14 Days</div>
        </div>

        {/* Players Chart */}
        <div className="cmd-panel p-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-[#64748B]">Players</span>
            <Users size={16} className="text-purple-400" />
          </div>
          <MiniChart data={chartData.players} color="#8B5CF6" />
          <div className="text-xs text-[#4A5E78] mt-2">Last 14 Days</div>
        </div>

        {/* Hours Chart */}
        <div className="cmd-panel p-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-[#64748B]">Play Hours</span>
            <Clock size={16} className="text-green-400" />
          </div>
          <MiniChart data={chartData.hours} color="#10B981" />
          <div className="text-xs text-[#4A5E78] mt-2">Last 14 Days</div>
        </div>
      </div>

      {/* Additional Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="cmd-panel p-4">
          <div className="flex items-center gap-2 text-[#64748B] mb-2">
            <Trophy size={16} className="text-yellow-400" />
            <span className="text-sm">Tournaments</span>
          </div>
          <div className="text-xl font-bold text-white">
            {summary.tournaments_run || 0}
          </div>
          <div className="text-xs text-[#4A5E78]">Tournaments Run</div>
        </div>

        <div className="cmd-panel p-4">
          <div className="flex items-center gap-2 text-[#64748B] mb-2">
            <Gift size={16} className="text-pink-400" />
            <span className="text-sm">Promotions</span>
          </div>
          <div className="text-xl font-bold text-white">
            {summary.promotions_awarded || 0}
          </div>
          <div className="text-xs text-[#4A5E78]">Awards Given</div>
        </div>

        <div className="cmd-panel p-4">
          <div className="flex items-center gap-2 text-[#64748B] mb-2">
            <Clock size={16} className="text-cyan-400" />
            <span className="text-sm">Avg Session</span>
          </div>
          <div className="text-xl font-bold text-white">
            {analytics.length > 0
              ? (analytics.reduce((sum, d) => sum + (parseFloat(d.avg_session_hours) || 0), 0) / analytics.length).toFixed(1)
              : '0'}h
          </div>
          <div className="text-xs text-[#4A5E78]">Average Duration</div>
        </div>

        <div className="cmd-panel p-4">
          <div className="flex items-center gap-2 text-[#64748B] mb-2">
            <DollarSign size={16} className="text-emerald-400" />
            <span className="text-sm">Avg Buy-in</span>
          </div>
          <div className="text-xl font-bold text-white">
            ${analytics.length > 0
              ? Math.round(analytics.reduce((sum, d) => sum + (d.avg_buyin || 0), 0) / analytics.length)
              : 0}
          </div>
          <div className="text-xs text-[#4A5E78]">Per Session</div>
        </div>
      </div>

      {/* Daily Breakdown Table */}
      {analytics.length > 0 && (
        <div className="cmd-panel overflow-hidden">
          <div className="p-4 border-b border-[#4A5E78]">
            <h3 className="font-medium text-white">Daily Breakdown</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-[#4A5E78] border-b border-[#4A5E78]">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">Sessions</th>
                  <th className="px-4 py-3 font-medium text-right">Players</th>
                  <th className="px-4 py-3 font-medium text-right">Hours</th>
                  <th className="px-4 py-3 font-medium text-right">Buy-ins</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#4A5E78]">
                {analytics.slice(0, 7).map((day) => (
                  <tr key={day.date} className="text-sm">
                    <td className="px-4 py-3 text-gray-300">
                      {new Date(day.date).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </td>
                    <td className="px-4 py-3 text-right text-white">{day.total_sessions || 0}</td>
                    <td className="px-4 py-3 text-right text-white">{day.unique_players || 0}</td>
                    <td className="px-4 py-3 text-right text-white">{parseFloat(day.total_play_hours || 0).toFixed(1)}</td>
                    <td className="px-4 py-3 text-right text-white">${(day.total_buyin || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(AnalyticsDashboard);
