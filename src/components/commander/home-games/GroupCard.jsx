/**
 * GroupCard Component - Display home game group summary
 * Reference: SCOPE_LOCK.md - Phase 4 Components
 * Dark industrial sci-fi gaming theme
 */
import { Users, MapPin, Calendar, Lock, Globe } from 'lucide-react';

const GAME_TYPES = {
  nlhe: "No-Limit Hold'em",
  plo: 'Pot-Limit Omaha',
  mixed: 'Mixed Games',
  other: 'Other'
};

export default function GroupCard({
  group,
  onClick,
  showJoinButton = true
}) {
  const gameType = GAME_TYPES[group.default_game_type] || group.default_game_type;

  return (
    <div
      onClick={onClick}
      className="cmd-panel p-4 hover:border-[#22D3EE] transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white">{group.name}</h3>
            {group.is_private ? (
              <Lock className="w-4 h-4 text-[#64748B]" />
            ) : (
              <Globe className="w-4 h-4 text-[#10B981]" />
            )}
          </div>
          {group.description && (
            <p className="text-sm text-[#64748B] mt-1 line-clamp-2">
              {group.description}
            </p>
          )}
        </div>
        {group.profiles?.avatar_url && (
          <img
            src={group.profiles.avatar_url}
            alt=""
            className="w-10 h-10 rounded-full object-cover"
          />
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-sm text-[#64748B]">
        <span className="flex items-center gap-1">
          <Users className="w-4 h-4" />
          {group.member_count} member{group.member_count !== 1 ? 's' : ''}
        </span>

        {(group.city || group.state) && (
          <span className="flex items-center gap-1">
            <MapPin className="w-4 h-4" />
            {[group.city, group.state].filter(Boolean).join(', ')}
          </span>
        )}

        {group.frequency && (
          <span className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            {group.frequency.charAt(0).toUpperCase() + group.frequency.slice(1)}
          </span>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-[#4A5E78] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 bg-[#0D192E] rounded text-xs font-medium text-white">
            {gameType}
          </span>
          {group.default_stakes && (
            <span className="px-2 py-1 bg-[#22D3EE]/10 rounded text-xs font-medium text-[#22D3EE]">
              {group.default_stakes}
            </span>
          )}
        </div>

        {showJoinButton && !group.my_membership && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
            className="cmd-btn cmd-btn-primary px-3 py-1 text-sm"
          >
            {group.is_private ? 'Request to Join' : 'Join'}
          </button>
        )}

        {group.my_membership?.status === 'pending' && (
          <span className="px-3 py-1 bg-[#F59E0B]/10 text-[#D97706] text-sm font-medium rounded-lg">
            Pending
          </span>
        )}

        {group.my_membership?.status === 'approved' && (
          <span className="px-3 py-1 bg-[#10B981]/10 text-[#10B981] text-sm font-medium rounded-lg">
            Member
          </span>
        )}
      </div>
    </div>
  );
}

// Compact version for lists
export function GroupCardCompact({ group, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-[#0B1426] text-left transition-colors"
    >
      <div className="w-12 h-12 rounded-lg bg-[#22D3EE]/10 flex items-center justify-center">
        <Users className="w-6 h-6 text-[#22D3EE]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-white truncate">{group.name}</h4>
          {group.is_private && <Lock className="w-3 h-3 text-[#64748B]" />}
        </div>
        <p className="text-sm text-[#64748B]">
          {group.member_count} members
          {group.city && ` • ${group.city}`}
        </p>
      </div>
    </button>
  );
}
