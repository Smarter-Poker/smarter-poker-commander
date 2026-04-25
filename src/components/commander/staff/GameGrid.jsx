/**
 * GameGrid Component - Displays running games in a grid
 * Reference: IMPLEMENTATION_PHASES.md - Step 1.5
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { Users, Clock, ChevronRight } from 'lucide-react';

export default function GameGrid({ games = [], onGameSelect, onOpenGame }) {
  if (games.length === 0) {
    return (
      <div className="cmd-panel p-8 text-center">
        <div className="text-[#64748B] mb-4">
          <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p className="text-lg font-medium">No Active Games</p>
          <p className="text-sm">Open A Game To Get Started</p>
        </div>
        {onOpenGame && (
          <button
            onClick={onOpenGame}
            className="mt-4 px-6 py-3 cmd-btn cmd-btn-primary min-h-[44px]"
          >
            Open New Game
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {games.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          onClick={() => onGameSelect?.(game)}
        />
      ))}
    </div>
  );
}

function GameCard({ game, onClick }) {
  const statusColors = {
    waiting: 'bg-[#F59E0B] text-white',
    running: 'bg-[#10B981] text-white',
    breaking: 'bg-[#6B7280] text-white',
    closed: 'bg-[#EF4444] text-white'
  };

  const occupiedSeats = game.commander_seats?.filter(s => s.status === 'occupied').length || game.current_players || 0;
  const maxSeats = game.max_players || 9;
  const seatPercentage = (occupiedSeats / maxSeats) * 100;

  return (
    <button
      onClick={onClick}
      className="cmd-panel p-4 text-left hover:border-[#22D3EE] hover:shadow-md transition-all min-h-[44px] w-full"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-white">
              {game.game_type?.toUpperCase()} {game.stakes}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[game.status] || statusColors.waiting}`}>
              {game.status?.charAt(0).toUpperCase() + game.status?.slice(1)}
            </span>
          </div>
          {game.commander_tables && (
            <p className="text-sm text-[#64748B] mt-1">
              Table {game.commander_tables.table_number}
              {game.commander_tables.table_name && ` - ${game.commander_tables.table_name}`}
            </p>
          )}
        </div>
        <ChevronRight className="w-5 h-5 text-[#64748B]" />
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-white">
          <Users className="w-4 h-4" />
          <span className="font-medium">{occupiedSeats}/{maxSeats}</span>
        </div>
        {game.waitlist_count > 0 && (
          <div className="text-sm text-[#22D3EE] font-medium">
            +{game.waitlist_count} waiting
          </div>
        )}
      </div>

      <div className="mt-3 h-2 bg-[#4A5E78] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#22D3EE] transition-all"
          style={{ width: `${seatPercentage}%` }}
        />
      </div>

      {game.is_must_move && (
        <div className="mt-2 text-xs text-[#F59E0B] font-medium">
          Must-Move Game
        </div>
      )}
    </button>
  );
}
