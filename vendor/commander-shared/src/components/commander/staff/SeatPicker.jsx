/**
 * SeatPicker Component - Visual seat selection for seating players
 * Reference: SCOPE_LOCK.md - Phase 2 Components
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { User } from 'lucide-react';

export default function SeatPicker({
  seats = [],
  maxSeats = 9,
  selectedSeat,
  onSelectSeat,
  disabled = false
}) {
  // Create seat array with empty slots
  const seatArray = Array.from({ length: maxSeats }, (_, i) => {
    const seatNumber = i + 1;
    return seats.find(s => s.seat_number === seatNumber) || {
      seat_number: seatNumber,
      status: 'empty'
    };
  });

  // Arrange seats in a poker table layout (oval)
  const getPosition = (index, total) => {
    const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
    const radiusX = 120;
    const radiusY = 60;
    return {
      left: `calc(50% + ${Math.cos(angle) * radiusX}px - 24px)`,
      top: `calc(50% + ${Math.sin(angle) * radiusY}px - 24px)`
    };
  };

  return (
    <div className="relative w-full h-64 bg-[#10B981]/20 rounded-[100px] border-4 border-[#10B981]">
      {/* Table label */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[#10B981] font-semibold">Select Seat</span>
      </div>

      {/* Seats */}
      {seatArray.map((seat, index) => {
        const position = getPosition(index, maxSeats);
        const isAvailable = seat.status === 'empty';
        const isSelected = selectedSeat === seat.seat_number;

        return (
          <button
            key={seat.seat_number}
            onClick={() => isAvailable && !disabled && onSelectSeat?.(seat.seat_number)}
            disabled={!isAvailable || disabled}
            className={`absolute w-12 h-12 rounded-full flex flex-col items-center justify-center transition-all ${
              isSelected
                ? 'bg-[#22D3EE] text-white ring-4 ring-[#22D3EE]/30'
                : isAvailable
                  ? 'bg-[#132240] border-2 border-[#4A5E78] hover:border-[#22D3EE] text-white'
                  : 'bg-[#6B7280] text-white cursor-not-allowed'
            }`}
            style={position}
            title={isAvailable ? `Seat ${seat.seat_number} - Available` : `Seat ${seat.seat_number} - ${seat.player_name || 'Occupied'}`}
          >
            {isAvailable ? (
              <>
                <span className="text-xs font-bold">{seat.seat_number}</span>
              </>
            ) : (
              <User className="w-5 h-5" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// Compact list version for smaller spaces
export function SeatPickerList({
  seats = [],
  maxSeats = 9,
  selectedSeat,
  onSelectSeat,
  disabled = false
}) {
  const seatArray = Array.from({ length: maxSeats }, (_, i) => {
    const seatNumber = i + 1;
    return seats.find(s => s.seat_number === seatNumber) || {
      seat_number: seatNumber,
      status: 'empty'
    };
  });

  return (
    <div className="grid grid-cols-5 gap-2">
      {seatArray.map((seat) => {
        const isAvailable = seat.status === 'empty';
        const isSelected = selectedSeat === seat.seat_number;

        return (
          <button
            key={seat.seat_number}
            onClick={() => isAvailable && !disabled && onSelectSeat?.(seat.seat_number)}
            disabled={!isAvailable || disabled}
            className={`p-3 rounded-lg flex flex-col items-center justify-center min-h-[60px] transition-all ${
              isSelected
                ? 'bg-[#22D3EE] text-white'
                : isAvailable
                  ? 'bg-[#132240] border border-[#4A5E78] hover:border-[#22D3EE] text-white'
                  : 'bg-[#0D192E] text-[#4A5E78] cursor-not-allowed'
            }`}
          >
            <span className="text-lg font-bold">{seat.seat_number}</span>
            <span className="text-xs">
              {isAvailable ? 'Open' : seat.player_name?.split(' ')[0] || 'Taken'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
