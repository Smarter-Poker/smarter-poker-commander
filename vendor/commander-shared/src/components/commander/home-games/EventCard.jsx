/**
 * EventCard Component - Display home game event
 * Reference: SCOPE_LOCK.md - Phase 4 Components
 * Dark industrial sci-fi gaming theme
 */
import { Calendar, Clock, Users, User } from 'lucide-react';

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: 'bg-[#6B7280]' },
  scheduled: { label: 'Scheduled', color: 'bg-[#22D3EE]' },
  confirmed: { label: 'Confirmed', color: 'bg-[#10B981]' },
  in_progress: { label: 'In Progress', color: 'bg-[#F59E0B]' },
  completed: { label: 'Completed', color: 'bg-[#6B7280]' },
  cancelled: { label: 'Cancelled', color: 'bg-[#EF4444]' }
};

const RSVP_CONFIG = {
  yes: { label: 'Going', color: 'text-[#10B981]', bg: 'bg-[#10B981]/10' },
  maybe: { label: 'Maybe', color: 'text-[#F59E0B]', bg: 'bg-[#F59E0B]/10' },
  no: { label: 'Not Going', color: 'text-[#EF4444]', bg: 'bg-[#EF4444]/10' },
  waitlist: { label: 'Waitlist', color: 'text-[#64748B]', bg: 'bg-[#0D192E]' }
};

export default function EventCard({
  event,
  onClick,
  onRsvp,
  showGroup = false
}) {
  const statusConfig = STATUS_CONFIG[event.status] || STATUS_CONFIG.scheduled;
  const myRsvpConfig = event.my_rsvp ? RSVP_CONFIG[event.my_rsvp] : null;

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    }
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const spotsLeft = event.max_players - event.rsvp_yes;
  const isFull = spotsLeft <= 0;

  return (
    <div
      onClick={onClick}
      className="cmd-panel overflow-hidden hover:border-[#22D3EE] transition-colors cursor-pointer"
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            {showGroup && event.commander_home_groups && (
              <p className="text-xs text-[#64748B] mb-1">
                {event.commander_home_groups.name}
              </p>
            )}
            <h3 className="font-semibold text-white">
              {event.title || 'Home Game'}
            </h3>
          </div>
          <span className={`px-2 py-1 rounded text-xs text-white ${statusConfig.color}`}>
            {statusConfig.label}
          </span>
        </div>

        {/* Date/Time */}
        <div className="flex items-center gap-4 text-sm text-[#64748B] mt-3">
          <span className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            {formatDate(event.scheduled_date)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            {formatTime(event.start_time)}
            {event.end_time && ` - ${formatTime(event.end_time)}`}
          </span>
        </div>

        {/* Game info */}
        <div className="flex items-center gap-3 mt-3">
          <span className="px-2 py-1 bg-[#0D192E] rounded text-xs font-medium text-white">
            {event.game_type?.toUpperCase() || 'NLHE'}
          </span>
          {event.stakes && (
            <span className="px-2 py-1 bg-[#22D3EE]/10 rounded text-xs font-medium text-[#22D3EE]">
              {event.stakes}
            </span>
          )}
          {(event.buyin_min || event.buyin_max) && (
            <span className="text-xs text-[#64748B]">
              ${event.buyin_min || 0}
              {event.buyin_max && event.buyin_max !== event.buyin_min && ` - $${event.buyin_max}`}
              {' buy-in'}
            </span>
          )}
        </div>

        {/* Host */}
        {event.profiles && (
          <div className="flex items-center gap-2 mt-3">
            {event.profiles.avatar_url ? (
              <img
                src={event.profiles.avatar_url}
                alt=""
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-[#0D192E] flex items-center justify-center">
                <User className="w-3 h-3 text-[#64748B]" />
              </div>
            )}
            <span className="text-sm text-[#64748B]">
              Hosted by {event.profiles.display_name || 'Unknown'}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-[#0B1426] border-t border-[#4A5E78] flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1 text-white">
            <Users className="w-4 h-4" />
            {event.rsvp_yes}/{event.max_players}
          </span>
          {event.rsvp_maybe > 0 && (
            <span className="text-[#F59E0B]">
              +{event.rsvp_maybe} maybe
            </span>
          )}
          {event.waitlist_count > 0 && (
            <span className="text-[#64748B]">
              {event.waitlist_count} waitlist
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {myRsvpConfig && (
            <span className={`px-2 py-1 rounded text-xs font-medium ${myRsvpConfig.bg} ${myRsvpConfig.color}`}>
              {myRsvpConfig.label}
            </span>
          )}

          {!myRsvpConfig && event.status === 'scheduled' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRsvp?.(event);
              }}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                isFull
                  ? 'bg-[#0D192E] text-[#64748B]'
                  : 'cmd-btn cmd-btn-primary'
              }`}
            >
              {isFull ? 'Join Waitlist' : 'RSVP'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// List item version
export function EventListItem({ event, onClick }) {
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-[#0B1426] text-left transition-colors"
    >
      <div className="w-12 h-12 rounded-lg bg-[#22D3EE]/10 flex flex-col items-center justify-center">
        <span className="text-xs text-[#22D3EE] font-medium">
          {formatDate(event.scheduled_date).split(' ')[0]}
        </span>
        <span className="text-lg font-bold text-[#22D3EE]">
          {formatDate(event.scheduled_date).split(' ')[1]}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-medium text-white truncate">
          {event.title || 'Home Game'}
        </h4>
        <p className="text-sm text-[#64748B]">
          {event.game_type?.toUpperCase()} {event.stakes && `• ${event.stakes}`}
          {' • '}{event.rsvp_yes}/{event.max_players} going
        </p>
      </div>
      {event.my_rsvp && (
        <span className={`px-2 py-1 rounded text-xs ${RSVP_CONFIG[event.my_rsvp]?.bg} ${RSVP_CONFIG[event.my_rsvp]?.color}`}>
          {RSVP_CONFIG[event.my_rsvp]?.label}
        </span>
      )}
    </button>
  );
}
