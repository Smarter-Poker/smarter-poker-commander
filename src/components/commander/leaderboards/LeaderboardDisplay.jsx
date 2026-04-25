/**
 * LeaderboardDisplay Component
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * Dark industrial sci-fi gaming theme
 */
import React from 'react';
import { Trophy, Medal, Calendar, Users, Award, ChevronRight } from 'lucide-react';

const RANK_STYLES = {
  1: { bg: '#FEF3C7', text: '#92400E', icon: '#F59E0B' },
  2: { bg: '#E5E7EB', text: '#374151', icon: '#9CA3AF' },
  3: { bg: '#FED7AA', text: '#9A3412', icon: '#F97316' }
};

function LeaderboardDisplay({
  leaderboard,
  entries = [],
  currentUserId,
  onViewDetails,
  compact = false
}) {
  if (!leaderboard) return null;

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return '#22C55E';
      case 'upcoming': return '#3B82F6';
      case 'completed': return '#6B7280';
      default: return '#6B7280';
    }
  };

  const formatScore = (entry) => {
    switch (leaderboard.leaderboard_type) {
      case 'hours_played':
        return `${entry.hours_played?.toFixed(1) || 0}h`;
      case 'sessions':
        return `${entry.sessions_count || 0} sessions`;
      case 'tournament_points':
        return `${entry.points_earned || 0} pts`;
      default:
        return entry.score?.toFixed(1) || '0';
    }
  };

  // Find current user's position
  const userEntry = currentUserId
    ? entries.find(e => e.player_id === currentUserId)
    : null;

  if (compact) {
    return (
      <div
        className="cmd-panel p-4 cursor-pointer hover:border-[#22D3EE] transition-colors"
        onClick={() => onViewDetails?.(leaderboard)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[#0D192E]">
              <Trophy size={20} className="text-yellow-400" />
            </div>
            <div>
              <h3 className="font-medium text-white">{leaderboard.name}</h3>
              <div className="flex items-center gap-2 text-xs text-[#4A5E78]">
                <span
                  className="px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: `${getStatusColor(leaderboard.status)}20`, color: getStatusColor(leaderboard.status) }}
                >
                  {leaderboard.status}
                </span>
                <span>{entries.length} participants</span>
              </div>
            </div>
          </div>
          <ChevronRight size={20} className="text-[#4A5E78]" />
        </div>
      </div>
    );
  }

  return (
    <div className="cmd-panel overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[#4A5E78]">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-[#0D192E]">
              <Trophy size={24} className="text-yellow-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{leaderboard.name}</h2>
              <div className="flex items-center gap-3 text-sm text-[#64748B] mt-1">
                <span className="flex items-center gap-1">
                  <Calendar size={14} />
                  {formatDate(leaderboard.start_date)} - {formatDate(leaderboard.end_date)}
                </span>
                <span className="flex items-center gap-1">
                  <Users size={14} />
                  {entries.length} players
                </span>
              </div>
            </div>
          </div>
          <span
            className="px-3 py-1 rounded-full text-sm font-medium"
            style={{
              backgroundColor: `${getStatusColor(leaderboard.status)}20`,
              color: getStatusColor(leaderboard.status)
            }}
          >
            {leaderboard.status}
          </span>
        </div>

        {leaderboard.description && (
          <p className="mt-3 text-sm text-[#64748B]">{leaderboard.description}</p>
        )}

        {/* Prizes */}
        {leaderboard.prizes && leaderboard.prizes.length > 0 && (
          <div className="mt-4 flex items-center gap-4">
            <span className="text-sm text-[#4A5E78]">Prizes:</span>
            <div className="flex items-center gap-3">
              {leaderboard.prizes.slice(0, 3).map((prize, idx) => (
                <span
                  key={idx}
                  className="px-2 py-1 rounded text-xs font-medium bg-[#0D192E] text-gray-200"
                >
                  #{prize.position}: {prize.prize}
                </span>
              ))}
              {leaderboard.prizes.length > 3 && (
                <span className="text-xs text-[#4A5E78]">+{leaderboard.prizes.length - 3} more</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* User's Position (if logged in and participating) */}
      {userEntry && (
        <div className="px-4 py-3 flex items-center justify-between bg-[#22D3EE]/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold bg-[#22D3EE] text-white">
              {userEntry.rank || '-'}
            </div>
            <span className="text-white font-medium">Your Position</span>
          </div>
          <span className="text-[#22D3EE] font-medium">{formatScore(userEntry)}</span>
        </div>
      )}

      {/* Rankings */}
      <div className="divide-y divide-[#4A5E78]">
        {entries.length === 0 ? (
          <div className="p-8 text-center text-[#4A5E78]">
            No entries yet
          </div>
        ) : (
          entries.slice(0, 10).map((entry, idx) => {
            const rankStyle = RANK_STYLES[entry.rank] || { bg: '#0D192E', text: '#E5E7EB' };
            const isCurrentUser = entry.player_id === currentUserId;

            return (
              <div
                key={entry.id}
                className={`px-4 py-3 flex items-center justify-between ${
                  isCurrentUser ? 'bg-[#22D3EE]/10' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Rank */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm"
                    style={{
                      backgroundColor: entry.rank <= 3 ? rankStyle.bg : '#0D192E',
                      color: entry.rank <= 3 ? rankStyle.text : '#9CA3AF'
                    }}
                  >
                    {entry.rank <= 3 ? (
                      <Medal size={16} style={{ color: rankStyle.icon }} />
                    ) : (
                      entry.rank
                    )}
                  </div>

                  {/* Player */}
                  <div className="flex items-center gap-2">
                    {entry.profiles?.avatar_url ? (
                      <img
                        src={entry.profiles.avatar_url}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium bg-[#0D192E] text-[#64748B]">
                        {entry.profiles?.display_name?.[0]?.toUpperCase() || '?'}
                      </div>
                    )}
                    <span className={`font-medium ${isCurrentUser ? 'text-[#22D3EE]' : 'text-white'}`}>
                      {entry.profiles?.display_name || 'Anonymous'}
                    </span>
                  </div>
                </div>

                {/* Score */}
                <div className="text-right">
                  <div className="font-medium text-white">{formatScore(entry)}</div>
                  {entry.prize_won && (
                    <div className="flex items-center gap-1 text-xs text-yellow-400">
                      <Award size={12} />
                      {entry.prize_won}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* View All */}
      {entries.length > 10 && onViewDetails && (
        <button
          onClick={() => onViewDetails(leaderboard)}
          className="w-full py-3 text-center text-sm font-medium text-[#22D3EE] hover:bg-[#132240] transition-colors border-t border-[#4A5E78]"
        >
          View all {entries.length} participants
        </button>
      )}
    </div>
  );
}

export default React.memo(LeaderboardDisplay);
