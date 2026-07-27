/**
 * ActivityFeed Component - Shows recent activity
 * Reference: IMPLEMENTATION_PHASES.md - Step 1.5
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { UserCheck, UserPlus, UserX, Play, Square, Bell, Clock } from 'lucide-react';

const ACTIVITY_ICONS = {
  player_seated: UserCheck,
  player_joined: UserPlus,
  player_removed: UserX,
  game_started: Play,
  game_closed: Square,
  player_called: Bell,
  default: Clock
};

const ACTIVITY_COLORS = {
  player_seated: 'text-[#10B981] bg-[#10B981]/10',
  player_joined: 'text-[#22D3EE] bg-[#22D3EE]/10',
  player_removed: 'text-[#EF4444] bg-[#EF4444]/10',
  game_started: 'text-[#10B981] bg-[#10B981]/10',
  game_closed: 'text-[#6B7280] bg-[#6B7280]/10',
  player_called: 'text-[#F59E0B] bg-[#F59E0B]/10',
  default: 'text-[#6B7280] bg-[#6B7280]/10'
};

export default function ActivityFeed({ activities = [], maxItems = 10 }) {
  const displayActivities = activities.slice(0, maxItems);

  if (displayActivities.length === 0) {
    return (
      <div className="cmd-panel p-6 text-center">
        <Clock className="w-8 h-8 mx-auto mb-2 text-[#64748B] opacity-50" />
        <p className="text-[#64748B] text-sm">No Recent Activity</p>
      </div>
    );
  }

  return (
    <div className="cmd-panel overflow-hidden">
      <div className="p-4 border-b border-[#4A5E78]">
        <h3 className="font-semibold text-white">Recent Activity</h3>
      </div>
      <div className="divide-y divide-[#4A5E78] max-h-[400px] overflow-y-auto">
        {displayActivities.map((activity, index) => (
          <ActivityItem key={activity.id || index} activity={activity} />
        ))}
      </div>
    </div>
  );
}

function ActivityItem({ activity }) {
  const Icon = ACTIVITY_ICONS[activity.type] || ACTIVITY_ICONS.default;
  const colorClass = ACTIVITY_COLORS[activity.type] || ACTIVITY_COLORS.default;

  const timeAgo = activity.timestamp
    ? formatTimeAgo(new Date(activity.timestamp))
    : '';

  return (
    <div className="flex items-start gap-3 p-4">
      <div className={`p-2 rounded-lg ${colorClass}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white">{activity.message}</p>
        {activity.details && (
          <p className="text-xs text-[#64748B] mt-0.5">{activity.details}</p>
        )}
      </div>
      {timeAgo && (
        <span className="text-xs text-[#64748B] whitespace-nowrap">{timeAgo}</span>
      )}
    </div>
  );
}

function formatTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Helper to create activity items
export function createActivity(type, message, details = null) {
  return {
    id: Date.now().toString(),
    type,
    message,
    details,
    timestamp: new Date().toISOString()
  };
}
