/**
 * EliminatePlayerModal - Eliminate a player from tournament
 * Records elimination and updates remaining player count
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState, useEffect } from 'react';
import { X, UserMinus, Search, Trophy, Loader2 } from 'lucide-react';
import { broadcastChange } from '../../../lib/commander/useCommanderSync';

export default function EliminatePlayerModal({
  isOpen,
  onClose,
  onSubmit,
  tournament,
  entries = []
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [eliminatedBy, setEliminatedBy] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Filter active entries (not yet eliminated)
  const activeEntries = entries.filter(e => e.status === 'active');

  const filteredEntries = activeEntries.filter(entry => {
    const name = entry.player_name || entry.profiles?.display_name || '';
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedEntry(null);
      setEliminatedBy(null);
      setError(null);
    }
  }, [isOpen]);

  async function handleSubmit() {
    if (!selectedEntry) return;

    setSubmitting(true);
    setError(null);

    try {
      const staffSession = localStorage.getItem('commander_staff') || '';
      const res = await fetch(`/api/commander/tournaments/${tournament.id}/eliminate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-staff-session': staffSession },
        body: JSON.stringify({
          entry_id: selectedEntry.id,
          eliminated_by_id: eliminatedBy?.id || null,
          finish_position: activeEntries.length
        })
      });
      if (!res.ok) throw new Error('Request failed');

      const data = await res.json();

      if (data.success) {
        broadcastChange('tournaments');
        onSubmit?.({
          entry: selectedEntry,
          eliminatedBy,
          position: activeEntries.length
        });
        onClose();
      } else {
        setError(data.error?.message || 'Failed to eliminate player');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen || !tournament) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="cmd-panel cmd-corner-lights w-full max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#4A5E78]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#EF4444] rounded-lg flex items-center justify-center">
              <UserMinus className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Eliminate Player</h2>
              <p className="text-sm text-[#64748B]">
                {activeEntries.length} players remaining
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#132240] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#64748B]" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="p-3 bg-[#EF4444]/10 rounded-lg">
              <p className="text-sm text-[#EF4444]">{error}</p>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#64748B]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Player..."
              className="cmd-input w-full h-12 pl-10 pr-4"
            />
          </div>

          {/* Select player to eliminate */}
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Player to Eliminate
            </label>
            {filteredEntries.length === 0 ? (
              <div className="text-center py-6 bg-[#0D192E] rounded-lg">
                <p className="text-[#64748B]">No Players Found</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {filteredEntries.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                    disabled={entry.id === eliminatedBy?.id}
                    className={`w-full p-3 rounded-lg text-left transition-colors flex items-center justify-between ${selectedEntry?.id === entry.id
                      ? 'bg-[#EF4444] text-white'
                      : entry.id === eliminatedBy?.id
                        ? 'bg-[#0D192E] text-[#4A5E78] cursor-not-allowed'
                        : 'bg-[#0D192E] text-white hover:bg-[#132240]'
                      }`}
                  >
                    <span className="font-medium">
                      {entry.player_name || entry.profiles?.display_name || `Entry #${entry.id.slice(0, 8)}`}
                    </span>
                    {entry.seat_number && (
                      <span className={`text-sm ${selectedEntry?.id === entry.id ? 'text-white/80' : 'text-[#64748B]'}`}>
                        Seat {entry.seat_number}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Optional: Eliminated by */}
          {selectedEntry && activeEntries.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Eliminated By (optional)
              </label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                <button
                  onClick={() => setEliminatedBy(null)}
                  className={`w-full p-3 rounded-lg text-left transition-colors ${!eliminatedBy
                    ? 'bg-[#22D3EE] text-white'
                    : 'bg-[#0D192E] text-white hover:bg-[#132240]'
                    }`}
                >
                  Not specified
                </button>
                {activeEntries
                  .filter(e => e.id !== selectedEntry?.id)
                  .map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => setEliminatedBy(entry)}
                      className={`w-full p-3 rounded-lg text-left transition-colors ${eliminatedBy?.id === entry.id
                        ? 'bg-[#22D3EE] text-white'
                        : 'bg-[#0D192E] text-white hover:bg-[#132240]'
                        }`}
                    >
                      {entry.player_name || entry.profiles?.display_name || `Entry #${entry.id.slice(0, 8)}`}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Position indicator */}
          {selectedEntry && (
            <div className="p-4 bg-[#EF4444]/10 rounded-lg">
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-[#EF4444]" />
                <span className="font-medium text-white">
                  Finishing position: {activeEntries.length}
                  {activeEntries.length === 1 ? 'st' :
                    activeEntries.length === 2 ? 'nd' :
                      activeEntries.length === 3 ? 'rd' : 'th'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#4A5E78]">
          <button
            onClick={handleSubmit}
            disabled={!selectedEntry || submitting}
            className="w-full h-12 bg-[#EF4444] text-white font-semibold rounded-lg hover:bg-[#DC2626] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Eliminating...
              </>
            ) : (
              <>
                <UserMinus className="w-5 h-5" />
                Eliminate Player
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
