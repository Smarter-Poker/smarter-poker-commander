/**
 * AddWalkInModal - Modal for adding walk-in players to waitlist
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState } from 'react';
import { X, UserPlus, Phone } from 'lucide-react';
import { broadcastChange } from '../../../lib/commander/useCommanderSync';

const GAME_TYPES = [
  { value: 'nlh', label: 'No Limit Hold\'em' },
  { value: 'plo', label: 'Pot Limit Omaha' },
  { value: 'plo5', label: 'PLO Hi-Lo' },
  { value: 'mixed', label: 'Mixed Games' },
  { value: 'limit', label: 'Limit Hold\'em' }
];

const COMMON_STAKES = [
  '1/2', '1/3', '2/5', '5/10', '10/20', '25/50'
];

export default function AddWalkInModal({ isOpen, onClose, onSubmit, venueId, activeGames = [] }) {
  const [playerName, setPlayerName] = useState('');
  const [playerPhone, setPlayerPhone] = useState('');
  const [gameType, setGameType] = useState('nlh');
  const [stakes, setStakes] = useState('1/3');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Get unique game/stakes combinations from active games
  const activeGameOptions = activeGames
    .filter(g => ['waiting', 'running'].includes(g.status))
    .map(g => ({ gameType: g.game_type, stakes: g.stakes, id: g.id }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/commander/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venueId,
          game_type: gameType,
          stakes: stakes,
          player_name: playerName || 'Walk-in',
          player_phone: playerPhone || null,
          notes: notes || null,
          source: 'walk_in'
        })
      });
      if (!res.ok) throw new Error('Request failed');

      const data = await res.json();

      if (data.success) {
        onSubmit(data.data);
        resetForm();
        onClose();
        broadcastChange('waitlist');
        broadcastChange('games');
      } else {
        setError(data.error?.message || 'Failed to add player');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setPlayerName('');
    setPlayerPhone('');
    setGameType('nlh');
    setStakes('1/3');
    setNotes('');
    setError(null);
  }

  function formatPhoneNumber(value) {
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="cmd-panel cmd-corner-lights w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#4A5E78]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#10B981] rounded-lg flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-white">Add Walk-In</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#132240] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#64748B]" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-[#EF4444]/10 rounded-lg">
              <p className="text-sm text-[#EF4444]">{error}</p>
            </div>
          )}

          {/* Player Name */}
          <div>
            <label className="block text-sm font-medium text-white mb-1">
              Player Name
            </label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Optional - For Announcements"
              className="cmd-input w-full h-12"
            />
          </div>

          {/* Player Phone */}
          <div>
            <label className="block text-sm font-medium text-white mb-1">
              Phone Number
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#4A5E78]" />
              <input
                type="tel"
                value={playerPhone}
                onChange={(e) => setPlayerPhone(formatPhoneNumber(e.target.value))}
                placeholder="(555) 555-5555"
                className="cmd-input w-full h-12 pl-10 pr-3"
              />
            </div>
            <p className="text-xs text-[#64748B] mt-1">For SMS Notifications When Seat Is Ready</p>
          </div>

          {/* Quick Select from Active Games */}
          {activeGameOptions.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-white mb-1">
                Active Games
              </label>
              <div className="flex flex-wrap gap-2">
                {activeGameOptions.map((game, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setGameType(game.gameType);
                      setStakes(game.stakes);
                    }}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${gameType === game.gameType && stakes === game.stakes
                        ? 'bg-[#22D3EE] text-white'
                        : 'bg-[#0D192E] text-white hover:bg-[#132240]'
                      }`}
                  >
                    {game.stakes} {game.gameType.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Game Type */}
          <div>
            <label className="block text-sm font-medium text-white mb-1">
              Game Type
            </label>
            <select
              value={gameType}
              onChange={(e) => setGameType(e.target.value)}
              className="cmd-input w-full h-12"
            >
              {GAME_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {/* Stakes */}
          <div>
            <label className="block text-sm font-medium text-white mb-1">
              Stakes
            </label>
            <div className="grid grid-cols-3 gap-2">
              {COMMON_STAKES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStakes(s)}
                  className={`h-10 rounded-lg text-sm font-medium transition-colors ${stakes === s
                      ? 'bg-[#22D3EE] text-white'
                      : 'bg-[#0D192E] text-white hover:bg-[#132240]'
                    }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-white mb-1">
              Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional Notes"
              className="cmd-input w-full h-12"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 bg-[#10B981] text-white font-semibold rounded-lg hover:bg-[#059669] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <UserPlus className="w-5 h-5" />
            {submitting ? 'Adding...' : 'Add to Waitlist'}
          </button>
        </form>
      </div>
    </div>
  );
}
