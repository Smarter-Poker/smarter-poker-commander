/**
 * RsvpForm Component - RSVP to home game events
 * Reference: SCOPE_LOCK.md - Phase 4 Components
 * Dark industrial sci-fi gaming theme
 */
import { useState } from 'react';
import { Check, X, HelpCircle, Users } from 'lucide-react';

export default function RsvpForm({
  event,
  currentRsvp,
  onSubmit,
  onClose,
  isLoading = false
}) {
  const [response, setResponse] = useState(currentRsvp?.response || null);
  const [bringingGuests, setBringingGuests] = useState(currentRsvp?.bringing_guests || 0);
  const [guestNames, setGuestNames] = useState(currentRsvp?.guest_names?.join(', ') || '');
  const [message, setMessage] = useState(currentRsvp?.message || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!response) return;

    onSubmit({
      response,
      bringing_guests: bringingGuests,
      guest_names: guestNames.split(',').map(n => n.trim()).filter(Boolean),
      message
    });
  };

  const spotsLeft = event.max_players - event.rsvp_yes;
  const willBeWaitlisted = response === 'yes' && spotsLeft <= 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Response buttons */}
      <div>
        <label className="block text-sm font-medium text-white mb-2">
          Your Response
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setResponse('yes')}
            className={`flex-1 py-3 rounded-lg border-2 font-medium transition-colors flex items-center justify-center gap-2 ${
              response === 'yes'
                ? 'border-[#10B981] bg-[#10B981]/10 text-[#10B981]'
                : 'border-[#4A5E78] text-[#64748B] hover:border-[#10B981]'
            }`}
          >
            <Check className="w-5 h-5" />
            Going
          </button>
          <button
            type="button"
            onClick={() => setResponse('maybe')}
            className={`flex-1 py-3 rounded-lg border-2 font-medium transition-colors flex items-center justify-center gap-2 ${
              response === 'maybe'
                ? 'border-[#F59E0B] bg-[#F59E0B]/10 text-[#F59E0B]'
                : 'border-[#4A5E78] text-[#64748B] hover:border-[#F59E0B]'
            }`}
          >
            <HelpCircle className="w-5 h-5" />
            Maybe
          </button>
          <button
            type="button"
            onClick={() => setResponse('no')}
            className={`flex-1 py-3 rounded-lg border-2 font-medium transition-colors flex items-center justify-center gap-2 ${
              response === 'no'
                ? 'border-[#EF4444] bg-[#EF4444]/10 text-[#EF4444]'
                : 'border-[#4A5E78] text-[#64748B] hover:border-[#EF4444]'
            }`}
          >
            <X className="w-5 h-5" />
            No
          </button>
        </div>
      </div>

      {/* Capacity warning */}
      {willBeWaitlisted && (
        <div className="p-3 bg-[#F59E0B]/10 border border-[#F59E0B] rounded-lg">
          <p className="text-sm text-[#D97706]">
            This event is full. You will be added to the waitlist.
          </p>
        </div>
      )}

      {/* Guests (only if allowed and responding yes) */}
      {event.allow_guests && response === 'yes' && (
        <div>
          <label className="block text-sm font-medium text-white mb-2">
            Bringing Guests?
          </label>
          <div className="flex items-center gap-3">
            <select
              value={bringingGuests}
              onChange={(e) => setBringingGuests(parseInt(e.target.value))}
              className="cmd-input px-3 py-2"
            >
              <option value={0}>No Guests</option>
              {Array.from({ length: event.guest_limit || 1 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1} guest{i > 0 ? 's' : ''}
                </option>
              ))}
            </select>
            <span className="text-sm text-[#64748B]">
              Max {event.guest_limit || 1} guest{(event.guest_limit || 1) > 1 ? 's' : ''} allowed
            </span>
          </div>

          {bringingGuests > 0 && (
            <input
              type="text"
              value={guestNames}
              onChange={(e) => setGuestNames(e.target.value)}
              placeholder="Guest Names (comma Separated)"
              className="cmd-input mt-2 w-full px-3 py-2"
            />
          )}
        </div>
      )}

      {/* Message to host */}
      <div>
        <label className="block text-sm font-medium text-white mb-2">
          Message to Host (optional)
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Any Notes For The Host..."
          rows={2}
          className="cmd-input w-full px-3 py-2 resize-none"
        />
      </div>

      {/* Submit */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="cmd-btn cmd-btn-secondary flex-1 py-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!response || isLoading}
          className="cmd-btn cmd-btn-primary flex-1 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Submitting...' : currentRsvp ? 'Update RSVP' : 'Submit RSVP'}
        </button>
      </div>
    </form>
  );
}

// RSVP list display
export function RsvpList({ rsvps, isHost = false, onManage }) {
  const sections = [
    { key: 'yes', label: 'Going', items: rsvps?.yes || [] },
    { key: 'maybe', label: 'Maybe', items: rsvps?.maybe || [] },
    { key: 'waitlist', label: 'Waitlist', items: rsvps?.waitlist || [] }
  ];

  return (
    <div className="space-y-4">
      {sections.map(section => (
        section.items.length > 0 && (
          <div key={section.key}>
            <h4 className="text-sm font-medium text-[#64748B] mb-2">
              {section.label} ({section.items.length})
            </h4>
            <div className="space-y-2">
              {section.items.map(rsvp => (
                <div
                  key={rsvp.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-[#0B1426]"
                >
                  <div className="flex items-center gap-2">
                    {rsvp.profiles?.avatar_url ? (
                      <img
                        src={rsvp.profiles.avatar_url}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[#0D192E] flex items-center justify-center">
                        <Users className="w-4 h-4 text-[#64748B]" />
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-white">
                        {rsvp.profiles?.display_name || 'Unknown'}
                      </p>
                      {rsvp.bringing_guests > 0 && (
                        <p className="text-xs text-[#64748B]">
                          +{rsvp.bringing_guests} guest{rsvp.bringing_guests > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {rsvp.is_confirmed && (
                      <span className="px-2 py-0.5 bg-[#10B981]/10 text-[#10B981] text-xs rounded">
                        Confirmed
                      </span>
                    )}
                    {rsvp.seat_number && (
                      <span className="text-xs text-[#64748B]">
                        Seat {rsvp.seat_number}
                      </span>
                    )}
                    {isHost && section.key !== 'waitlist' && (
                      <button
                        onClick={() => onManage?.(rsvp, rsvp.is_confirmed ? 'unconfirm' : 'confirm')}
                        className="text-xs text-[#22D3EE] hover:underline"
                      >
                        {rsvp.is_confirmed ? 'Unconfirm' : 'Confirm'}
                      </button>
                    )}
                    {isHost && section.key === 'waitlist' && (
                      <button
                        onClick={() => onManage?.(rsvp, 'move_from_waitlist')}
                        className="text-xs text-[#22D3EE] hover:underline"
                      >
                        Add to Game
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ))}

      {Object.values(rsvps || {}).every(arr => arr.length === 0) && (
        <p className="text-center text-[#64748B] py-4">
          No RSVPs yet
        </p>
      )}
    </div>
  );
}
