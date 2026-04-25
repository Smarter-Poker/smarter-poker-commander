/**
 * TableStatus Component - Shows table status with game info
 * Reference: SCOPE_LOCK.md - Phase 2 Components
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { Users, Clock, Play, Wrench } from 'lucide-react';

const STATUS_CONFIG = {
  available: {
    color: 'bg-[#10B981]',
    textColor: 'text-[#10B981]',
    bgColor: 'bg-[#10B981]/10',
    icon: Play,
    label: 'Available'
  },
  in_use: {
    color: 'bg-[#22D3EE]',
    textColor: 'text-[#22D3EE]',
    bgColor: 'bg-[#22D3EE]/10',
    icon: Users,
    label: 'In Use'
  },
  reserved: {
    color: 'bg-[#F59E0B]',
    textColor: 'text-[#F59E0B]',
    bgColor: 'bg-[#F59E0B]/10',
    icon: Clock,
    label: 'Reserved'
  },
  maintenance: {
    color: 'bg-[#6B7280]',
    textColor: 'text-[#6B7280]',
    bgColor: 'bg-[#6B7280]/10',
    icon: Wrench,
    label: 'Maintenance'
  }
};

export default function TableStatus({
  table,
  game,
  onClick,
  selected = false,
  showDetails = true
}) {
  const config = STATUS_CONFIG[table.status] || STATUS_CONFIG.available;
  const Icon = config.icon;

  const occupiedSeats = game?.current_players || 0;
  const maxSeats = table.max_seats || 9;

  return (
    <button
      onClick={onClick}
      className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
        selected
          ? 'border-[#22D3EE] bg-[#22D3EE]/10'
          : 'border-[#4A5E78] bg-[#132240] hover:border-[#22D3EE]'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-semibold text-white">
            Table {table.table_number}
          </h3>
          {table.table_name && (
            <p className="text-sm text-[#64748B]">{table.table_name}</p>
          )}
        </div>
        <span className={`px-2 py-1 rounded text-xs font-medium ${config.bgColor} ${config.textColor}`}>
          {config.label}
        </span>
      </div>

      {showDetails && game && table.status === 'in_use' && (
        <div className="mt-3 pt-3 border-t border-[#4A5E78]">
          <p className="font-medium text-white">
            {game.game_type?.toUpperCase()} {game.stakes}
          </p>
          <div className="flex items-center gap-4 mt-2 text-sm text-[#64748B]">
            <span className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              {occupiedSeats}/{maxSeats}
            </span>
            {game.started_at && (
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {formatDuration(game.started_at)}
              </span>
            )}
          </div>

          {/* Seat visualization */}
          <div className="flex gap-1 mt-3">
            {Array.from({ length: maxSeats }).map((_, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full ${
                  i < occupiedSeats ? 'bg-[#22D3EE]' : 'bg-[#4A5E78]'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {table.status === 'available' && showDetails && (
        <div className="mt-3 pt-3 border-t border-[#4A5E78]">
          <p className="text-sm text-[#64748B]">
            {maxSeats} seats available
          </p>
        </div>
      )}
    </button>
  );
}

function formatDuration(startTime) {
  const start = new Date(startTime);
  const now = new Date();
  const minutes = Math.floor((now - start) / 60000);

  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

// Grid layout for multiple tables
export function TableGrid({ tables = [], games = [], selectedTable, onSelectTable }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {tables.map((table) => {
        const game = games.find(g => g.table_id === table.id);
        return (
          <TableStatus
            key={table.id}
            table={table}
            game={game}
            selected={selectedTable === table.id}
            onClick={() => onSelectTable?.(table)}
          />
        );
      })}
    </div>
  );
}
