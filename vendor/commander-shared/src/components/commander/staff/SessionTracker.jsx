/**
 * SessionTracker Component - Shows active player sessions
 * Reference: SCOPE_LOCK.md - Phase 2 Components
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { Clock, LogOut, User, DollarSign } from 'lucide-react';

export default function SessionTracker({
  sessions = [],
  onCheckout,
  onViewSession,
  showSummary = true
}) {
  const activeSessions = sessions.filter(s => s.status === 'active');

  if (activeSessions.length === 0) {
    return (
      <div className="cmd-panel p-6 text-center">
        <User className="w-8 h-8 mx-auto mb-2 text-[#64748B] opacity-50" />
        <p className="text-[#64748B]">No Active Sessions</p>
      </div>
    );
  }

  // Calculate summary
  const summary = {
    total: activeSessions.length,
    totalBuyin: activeSessions.reduce((sum, s) => sum + (s.total_buyin || 0), 0),
    avgDuration: Math.round(
      activeSessions.reduce((sum, s) => {
        const duration = (Date.now() - new Date(s.check_in_at).getTime()) / 60000;
        return sum + duration;
      }, 0) / activeSessions.length
    )
  };

  return (
    <div className="space-y-4">
      {showSummary && (
        <div className="grid grid-cols-3 gap-4">
          <div className="cmd-panel p-4 text-center">
            <p className="text-2xl font-bold text-[#22D3EE]">{summary.total}</p>
            <p className="text-sm text-[#64748B]">Active</p>
          </div>
          <div className="cmd-panel p-4 text-center">
            <p className="text-2xl font-bold text-white">{summary.avgDuration}m</p>
            <p className="text-sm text-[#64748B]">Avg Time</p>
          </div>
          <div className="cmd-panel p-4 text-center">
            <p className="text-2xl font-bold text-[#10B981]">${summary.totalBuyin}</p>
            <p className="text-sm text-[#64748B]">Total Buy-in</p>
          </div>
        </div>
      )}

      <div className="cmd-panel overflow-hidden">
        <div className="p-4 border-b border-[#4A5E78]">
          <h3 className="font-semibold text-white">Active Sessions</h3>
        </div>
        <div className="divide-y divide-[#4A5E78] max-h-[400px] overflow-y-auto">
          {activeSessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              onCheckout={() => onCheckout?.(session)}
              onView={() => onViewSession?.(session)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionRow({ session, onCheckout, onView }) {
  const duration = Math.floor(
    (Date.now() - new Date(session.check_in_at).getTime()) / 60000
  );

  const playerName = session.player_name ||
    session.profiles?.display_name ||
    'Guest';

  return (
    <div className="flex items-center justify-between p-4">
      <button
        onClick={onView}
        className="flex items-center gap-3 text-left hover:bg-[#0B1426] -m-2 p-2 rounded-lg transition-colors"
      >
        <div className="w-10 h-10 rounded-full bg-[#22D3EE]/10 flex items-center justify-center">
          {session.profiles?.avatar_url ? (
            <img
              src={session.profiles.avatar_url}
              alt=""
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <User className="w-5 h-5 text-[#22D3EE]" />
          )}
        </div>
        <div>
          <p className="font-medium text-white">{playerName}</p>
          <div className="flex items-center gap-3 text-sm text-[#64748B]">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDuration(duration)}
            </span>
            {session.games_played > 0 && (
              <span>{session.games_played} games</span>
            )}
            {session.total_buyin > 0 && (
              <span className="flex items-center gap-1">
                <DollarSign className="w-3 h-3" />
                {session.total_buyin}
              </span>
            )}
          </div>
        </div>
      </button>

      <button
        onClick={onCheckout}
        className="p-3 rounded-lg border border-[#4A5E78] text-[#64748B] hover:border-[#EF4444] hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
        title="Check Out Player"
      >
        <LogOut className="w-5 h-5" />
      </button>
    </div>
  );
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}
