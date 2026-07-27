/**
 * SeatPlayerModal - Modal for seating a player from waitlist
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState, useEffect } from 'react';
import { X, UserPlus, Loader2 } from 'lucide-react';
import { SeatPickerList } from '../staff/SeatPicker';
import { broadcastChange } from '../../../lib/commander/useCommanderSync';

export default function SeatPlayerModal({
  isOpen,
  onClose,
  onSubmit,
  player,
  games = []
}) {
  const [selectedGame, setSelectedGame] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [seats, setSeats] = useState([]);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Filter matching games
  const matchingGames = games.filter(g =>
    g.game_type === player?.game_type &&
    g.stakes === player?.stakes &&
    ['waiting', 'running'].includes(g.status)
  );

  // Auto-select first matching game
  useEffect(() => {
    if (isOpen && matchingGames.length > 0 && !selectedGame) {
      setSelectedGame(matchingGames[0]);
    }
  }, [isOpen, matchingGames, selectedGame]);

  // Fetch seats when game selected
  useEffect(() => {
    if (selectedGame) {
      fetchSeats(selectedGame.id);
    }
  }, [selectedGame]);

  async function fetchSeats(gameId) {
    setLoadingSeats(true);
    try {
      const res = await fetch(`/api/commander/games/${gameId}`);
      const data = await res.json();
      if (data.success && data.data.game) {
        setSeats(data.data.game.seats || []);
      }
    } catch (err) {
      console.warn('Failed to fetch seats:', err);
    } finally {
      setLoadingSeats(false);
    }
  }

  async function handleSubmit() {
    if (!selectedGame || !selectedSeat) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/commander/waitlist/${player.id}/seat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_id: selectedGame.id,
          seat_number: selectedSeat
        })
      });
      if (!res.ok) throw new Error('Request failed');

      const data = await res.json();

      if (data.success) {
        onSubmit({
          player,
          game: selectedGame,
          seat_number: selectedSeat
        });
        resetAndClose();
        broadcastChange('waitlist');
        broadcastChange('tables');
        broadcastChange('games');
      } else {
        setError(data.error?.message || 'Failed to seat player');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetAndClose() {
    setSelectedGame(null);
    setSelectedSeat(null);
    setSeats([]);
    setError(null);
    onClose();
  }

  if (!isOpen || !player) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="cmd-panel cmd-corner-lights w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#4A5E78]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#10B981] rounded-lg flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Seat Player</h2>
              <p className="text-sm text-[#64748B]">
                {player.player_name || 'Player'} - {player.stakes} {player.game_type?.toUpperCase()}
              </p>
            </div>
          </div>
          <button
            onClick={resetAndClose}
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

          {matchingGames.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-[#64748B]">No Matching Games Available</p>
              <p className="text-sm text-[#4A5E78] mt-1">
                Open a {player.stakes} {player.game_type?.toUpperCase()} game first
              </p>
            </div>
          ) : (
            <>
              {/* Game Selection */}
              {matchingGames.length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Select Table
                  </label>
                  <div className="space-y-2">
                    {matchingGames.map((game) => (
                      <button
                        key={game.id}
                        onClick={() => {
                          setSelectedGame(game);
                          setSelectedSeat(null);
                        }}
                        className={`w-full p-3 rounded-lg text-left transition-colors ${selectedGame?.id === game.id
                            ? 'bg-[#22D3EE] text-white'
                            : 'bg-[#0D192E] text-white hover:bg-[#132240]'
                          }`}
                      >
                        <div className="font-medium">
                          {game.table_name || `Table ${game.table_number}`}
                        </div>
                        <div className={`text-sm ${selectedGame?.id === game.id ? 'text-white/80' : 'text-[#64748B]'}`}>
                          {game.player_count || 0}/{game.max_players} players
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Seat Selection */}
              {selectedGame && (
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Select Seat - {selectedGame.table_name || `Table ${selectedGame.table_number}`}
                  </label>
                  {loadingSeats ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-[#22D3EE]" />
                    </div>
                  ) : (
                    <SeatPickerList
                      seats={seats}
                      maxSeats={selectedGame.max_players || 9}
                      selectedSeat={selectedSeat}
                      onSelectSeat={setSelectedSeat}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {matchingGames.length > 0 && (
          <div className="p-4 border-t border-[#4A5E78]">
            <button
              onClick={handleSubmit}
              disabled={!selectedGame || !selectedSeat || submitting}
              className="w-full h-12 bg-[#10B981] text-white font-semibold rounded-lg hover:bg-[#059669] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Seating...
                </>
              ) : (
                <>
                  <UserPlus className="w-5 h-5" />
                  Seat at Position {selectedSeat || '?'}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
