/**
 * MustMoveModal - Manage must-move game relationships
 * When main game is full, players go to must-move game first
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState, useEffect } from 'react';
import { X, ArrowRight, Users, Loader2, Link2, Unlink } from 'lucide-react';
import { broadcastChange } from '../../../lib/commander/useCommanderSync';

export default function MustMoveModal({
  isOpen,
  onClose,
  onSubmit,
  game,
  allGames = [],
  venueId
}) {
  const [linkedGame, setLinkedGame] = useState(null);
  const [availableGames, setAvailableGames] = useState([]);
  const [selectedGameId, setSelectedGameId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Filter games that can be must-move (same type/stakes, not the current game)
  useEffect(() => {
    if (game) {
      const compatible = allGames.filter(g =>
        g.id !== game.id &&
        g.game_type === game.game_type &&
        g.stakes === game.stakes &&
        ['waiting', 'running'].includes(g.status) &&
        !g.must_move_to // Not already a must-move game
      );
      setAvailableGames(compatible);

      // Check if this game already has a must-move link
      if (game.must_move_to) {
        const linked = allGames.find(g => g.id === game.must_move_to);
        setLinkedGame(linked);
      } else {
        setLinkedGame(null);
      }
    }
  }, [game, allGames]);

  async function handleLink() {
    if (!selectedGameId) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/commander/games/${game.id}/must-move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          must_move_to: selectedGameId
        })
      });
      if (!res.ok) throw new Error('Request failed');

      const data = await res.json();

      if (data.success) {
        onSubmit({ game, linkedTo: selectedGameId, action: 'linked' });
        onClose();
        broadcastChange('games');
        broadcastChange('tables');
      } else {
        setError(data.error?.message || 'Failed to link games');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnlink() {
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/commander/games/${game.id}/must-move`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Request failed');

      const data = await res.json();

      if (data.success) {
        onSubmit({ game, action: 'unlinked' });
        setLinkedGame(null);
        broadcastChange('games');
        broadcastChange('tables');
      } else {
        setError(data.error?.message || 'Failed to unlink games');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen || !game) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="cmd-panel cmd-corner-lights w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#4A5E78]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#8B5CF6] rounded-lg flex items-center justify-center">
              <Link2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Must-Move Setup</h2>
              <p className="text-sm text-[#64748B]">
                {game.stakes} {game.game_type?.toUpperCase()} - Table {game.table_number}
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
        <div className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-[#EF4444]/10 rounded-lg">
              <p className="text-sm text-[#EF4444]">{error}</p>
            </div>
          )}

          {/* Info box */}
          <div className="p-3 bg-[#0D192E] rounded-lg">
            <p className="text-sm text-[#64748B]">
              When the main game is full, new players are seated at the must-move game.
              As seats open in the main game, players move up in order.
            </p>
          </div>

          {linkedGame ? (
            // Already linked - show unlink option
            <div className="space-y-4">
              <div className="p-4 bg-[#8B5CF6]/10 rounded-lg">
                <p className="text-sm font-medium text-[#8B5CF6] mb-2">Currently Linked</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 p-3 bg-[#0B1426] rounded-lg border border-[#4A5E78]">
                    <p className="font-medium text-white">
                      Table {game.table_number}
                    </p>
                    <p className="text-sm text-[#64748B]">Main Game</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-[#8B5CF6]" />
                  <div className="flex-1 p-3 bg-[#0B1426] rounded-lg border border-[#4A5E78]">
                    <p className="font-medium text-white">
                      Table {linkedGame.table_number}
                    </p>
                    <p className="text-sm text-[#64748B]">Must-Move</p>
                  </div>
                </div>
              </div>

              <button
                onClick={handleUnlink}
                disabled={submitting}
                className="w-full h-12 bg-[#EF4444] text-white font-semibold rounded-lg hover:bg-[#DC2626] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Unlinking...
                  </>
                ) : (
                  <>
                    <Unlink className="w-5 h-5" />
                    Unlink Games
                  </>
                )}
              </button>
            </div>
          ) : (
            // Not linked - show link options
            <div className="space-y-4">
              {availableGames.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="w-12 h-12 text-[#4A5E78] mx-auto mb-2" />
                  <p className="text-[#64748B]">No Compatible Games Available</p>
                  <p className="text-sm text-[#4A5E78] mt-1">
                    Open another {game.stakes} {game.game_type?.toUpperCase()} game first
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-white mb-2">
                      Select Must-Move Game
                    </label>
                    <div className="space-y-2">
                      {availableGames.map((g) => (
                        <button
                          key={g.id}
                          onClick={() => setSelectedGameId(g.id)}
                          className={`w-full p-3 rounded-lg text-left transition-colors ${selectedGameId === g.id
                              ? 'bg-[#8B5CF6] text-white'
                              : 'bg-[#0D192E] text-white hover:bg-[#132240]'
                            }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">
                                {g.table_name || `Table ${g.table_number}`}
                              </p>
                              <p className={`text-sm ${selectedGameId === g.id ? 'text-white/80' : 'text-[#64748B]'}`}>
                                {g.player_count || 0}/{g.max_players} players
                              </p>
                            </div>
                            {selectedGameId === g.id && (
                              <ArrowRight className="w-5 h-5" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={handleLink}
                    disabled={!selectedGameId || submitting}
                    className="w-full h-12 bg-[#8B5CF6] text-white font-semibold rounded-lg hover:bg-[#7C3AED] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Linking...
                      </>
                    ) : (
                      <>
                        <Link2 className="w-5 h-5" />
                        Link as Must-Move
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
