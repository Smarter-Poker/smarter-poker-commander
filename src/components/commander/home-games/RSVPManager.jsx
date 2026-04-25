/**
 * RSVPManager Component - Manage RSVPs for home game events
 * Reference: SCOPE_LOCK.md - Phase 4 Components
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState, useMemo } from 'react';
import {
  Users, UserCheck, UserX, Clock, Search, Check, X,
  MessageSquare, ChevronDown, ChevronUp
} from 'lucide-react';

const RSVP_STATUS = {
  yes: { label: 'Going', color: '#10B981', icon: UserCheck },
  maybe: { label: 'Maybe', color: '#F59E0B', icon: Clock },
  no: { label: 'Declined', color: '#EF4444', icon: UserX },
  waitlist: { label: 'Waitlist', color: '#6B7280', icon: Clock },
  pending: { label: 'Pending', color: '#3B82F6', icon: Clock }
};

export default function RSVPManager({
  rsvps = [],
  event,
  isHost = false,
  onApprove,
  onDecline,
  onWaitlist,
  onSendMessage,
  onRemove,
  isLoading = false
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [expandedRsvp, setExpandedRsvp] = useState(null);

  const grouped = useMemo(() => {
    const groups = { yes: [], maybe: [], waitlist: [], pending: [], no: [] };
    rsvps.forEach(rsvp => {
      const status = rsvp.status || 'pending';
      if (groups[status]) {
        groups[status].push(rsvp);
      }
    });
    return groups;
  }, [rsvps]);

  const filtered = useMemo(() => {
    return rsvps.filter(rsvp => {
      const name = rsvp.player_name || rsvp.profiles?.display_name || '';
      const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesFilter = filterStatus === 'all' || rsvp.status === filterStatus;
      return matchesSearch && matchesFilter;
    });
  }, [rsvps, searchTerm, filterStatus]);

  const capacity = event?.max_players || 9;
  const confirmed = grouped.yes.length;
  const spotsLeft = capacity - confirmed;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-3">
        {Object.entries(RSVP_STATUS || {}).map(([key, config]) => {
          const Icon = config.icon;
          const count = grouped[key]?.length || 0;
          return (
            <button
              key={key}
              onClick={() => setFilterStatus(filterStatus === key ? 'all' : key)}
              className={`cmd-panel p-3 text-center transition-colors ${
                filterStatus === key ? 'ring-1 ring-[#22D3EE]' : ''
              }`}
            >
              <Icon size={18} className="mx-auto mb-1" style={{ color: config.color }} />
              <p className="text-lg font-bold text-white">{count}</p>
              <p className="text-xs text-[#64748B]">{config.label}</p>
            </button>
          );
        })}
      </div>

      {/* Capacity Bar */}
      <div className="cmd-panel p-3">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-[#64748B]">Capacity</span>
          <span className="text-white font-medium">
            {confirmed} / {capacity}
            {spotsLeft > 0 && (
              <span className="text-[#10B981] ml-2">({spotsLeft} spots left)</span>
            )}
            {spotsLeft <= 0 && (
              <span className="text-[#EF4444] ml-2">(Full)</span>
            )}
          </span>
        </div>
        <div className="w-full h-2 bg-[#0B1426] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min((confirmed / capacity) * 100, 100)}%`,
              backgroundColor: confirmed >= capacity ? '#EF4444' : '#10B981'
            }}
          />
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search Players..."
          className="w-full pl-10 pr-4 py-2.5 cmd-input"
        />
      </div>

      {/* RSVP List */}
      <div className="cmd-panel overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Users size={36} className="mx-auto text-[#4A5E78] mb-2" />
            <p className="text-[#64748B]">
              {searchTerm || filterStatus !== 'all'
                ? 'No matching RSVPs'
                : 'No RSVPs yet'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#4A5E78]">
            {filtered.map(rsvp => {
              const playerName = rsvp.player_name || rsvp.profiles?.display_name || 'Unknown';
              const config = RSVP_STATUS[rsvp.status] || RSVP_STATUS.pending;
              const isExpanded = expandedRsvp === rsvp.id;

              return (
                <div key={rsvp.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-[#0D192E] flex items-center justify-center">
                        {rsvp.profiles?.avatar_url ? (
                          <img
                            src={rsvp.profiles.avatar_url}
                            alt=""
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <Users size={18} className="text-[#64748B]" />
                        )}
                      </div>

                      {/* Info */}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white">{playerName}</span>
                          <span
                            className="px-2 py-0.5 rounded text-xs font-medium"
                            style={{ backgroundColor: `${config.color}20`, color: config.color }}
                          >
                            {config.label}
                          </span>
                          {rsvp.guest_count > 0 && (
                            <span className="text-xs text-[#64748B]">+{rsvp.guest_count} guest(s)</span>
                          )}
                        </div>
                        {rsvp.message && (
                          <p className="text-xs text-[#64748B] mt-0.5 flex items-center gap-1">
                            <MessageSquare size={12} />
                            {rsvp.message.length > 50 ? rsvp.message.slice(0, 50) + '...' : rsvp.message}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Host Actions */}
                    <div className="flex items-center gap-2">
                      {isHost && onSendMessage && rsvp.user_id && (
                        <button
                          onClick={() => onSendMessage(rsvp.user_id)}
                          className="p-2 rounded-lg border border-[#4A5E78] text-[#22D3EE] hover:border-[#22D3EE] transition-colors"
                          title="Message Player"
                        >
                          <MessageSquare size={16} />
                        </button>
                      )}
                      {isHost && rsvp.status === 'pending' && (
                        <>
                          <button
                            onClick={() => onApprove?.(rsvp.id)}
                            disabled={isLoading}
                            className="p-2 rounded-lg border border-[#4A5E78] text-[#10B981] hover:border-[#10B981] transition-colors disabled:opacity-50"
                            title="Approve"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            onClick={() => onWaitlist?.(rsvp.id)}
                            disabled={isLoading}
                            className="p-2 rounded-lg border border-[#4A5E78] text-[#F59E0B] hover:border-[#F59E0B] transition-colors disabled:opacity-50"
                            title="Waitlist"
                          >
                            <Clock size={16} />
                          </button>
                          <button
                            onClick={() => onDecline?.(rsvp.id)}
                            disabled={isLoading}
                            className="p-2 rounded-lg border border-[#4A5E78] text-[#EF4444] hover:border-[#EF4444] transition-colors disabled:opacity-50"
                            title="Decline"
                          >
                            <X size={16} />
                          </button>
                        </>
                      )}

                      {isHost && rsvp.status !== 'pending' && (
                        <button
                          onClick={() => onRemove?.(rsvp.id)}
                          disabled={isLoading}
                          className="p-2 rounded-lg border border-[#4A5E78] text-[#EF4444] hover:border-[#EF4444] transition-colors disabled:opacity-50"
                          title="Remove"
                        >
                          <UserX size={16} />
                        </button>
                      )}

                      <button
                        onClick={() => setExpandedRsvp(isExpanded ? null : rsvp.id)}
                        className="p-2 rounded-lg text-[#64748B] hover:text-white transition-colors"
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="mt-3 pl-13 pt-3 border-t border-[#4A5E78]/50 text-sm">
                      <div className="grid grid-cols-2 gap-2 text-[#64748B]">
                        <div>Status: <span className="text-white">{config.label}</span></div>
                        {rsvp.guest_count > 0 && (
                          <div>Guests: <span className="text-white">{rsvp.guest_count}</span></div>
                        )}
                        {rsvp.seat_assignment && (
                          <div>Seat: <span className="text-white">{rsvp.seat_assignment}</span></div>
                        )}
                        {rsvp.created_at && (
                          <div>
                            RSVP Date: <span className="text-white">
                              {new Date(rsvp.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        )}
                      </div>
                      {rsvp.message && (
                        <div className="mt-2">
                          <span className="text-[#64748B]">Message:</span>
                          <p className="text-white mt-1">{rsvp.message}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
