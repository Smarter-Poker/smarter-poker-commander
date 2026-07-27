/**
 * GameCalendar Component - Calendar view for home game events
 * Reference: SCOPE_LOCK.md - Phase 4 Components
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Clock, Users, MapPin } from 'lucide-react';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

export default function GameCalendar({
  events = [],
  onSelectDate,
  onSelectEvent,
  selectedDate = null
}) {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [viewSelectedDate, setViewSelectedDate] = useState(selectedDate);

  // Map events by date string
  const eventsByDate = useMemo(() => {
    const map = {};
    events.forEach(event => {
      const dateStr = event.event_date?.split('T')[0];
      if (dateStr) {
        if (!map[dateStr]) map[dateStr] = [];
        map[dateStr].push(event);
      }
    });
    return map;
  }, [events]);

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
  const prevMonthDays = getDaysInMonth(
    currentMonth === 0 ? currentYear - 1 : currentYear,
    currentMonth === 0 ? 11 : currentMonth - 1
  );

  const navigateMonth = (direction) => {
    if (direction === -1) {
      if (currentMonth === 0) {
        setCurrentMonth(11);
        setCurrentYear(currentYear - 1);
      } else {
        setCurrentMonth(currentMonth - 1);
      }
    } else {
      if (currentMonth === 11) {
        setCurrentMonth(0);
        setCurrentYear(currentYear + 1);
      } else {
        setCurrentMonth(currentMonth + 1);
      }
    }
  };

  const goToToday = () => {
    setCurrentMonth(today.getMonth());
    setCurrentYear(today.getFullYear());
    handleSelectDate(today);
  };

  const handleSelectDate = (date) => {
    setViewSelectedDate(date);
    onSelectDate?.(date);
  };

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const days = [];

    // Previous month trailing days
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const month = currentMonth === 0 ? 11 : currentMonth - 1;
      const year = currentMonth === 0 ? currentYear - 1 : currentYear;
      days.push({ day, month, year, isCurrentMonth: false });
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      days.push({ day, month: currentMonth, year: currentYear, isCurrentMonth: true });
    }

    // Next month leading days
    const remaining = 42 - days.length;
    for (let day = 1; day <= remaining; day++) {
      const month = currentMonth === 11 ? 0 : currentMonth + 1;
      const year = currentMonth === 11 ? currentYear + 1 : currentYear;
      days.push({ day, month, year, isCurrentMonth: false });
    }

    return days;
  }, [currentMonth, currentYear, daysInMonth, firstDay, prevMonthDays]);

  // Events for selected date
  const selectedDateEvents = useMemo(() => {
    if (!viewSelectedDate) return [];
    const dateStr = `${viewSelectedDate.getFullYear()}-${String(viewSelectedDate.getMonth() + 1).padStart(2, '0')}-${String(viewSelectedDate.getDate()).padStart(2, '0')}`;
    return eventsByDate[dateStr] || [];
  }, [viewSelectedDate, eventsByDate]);

  return (
    <div className="space-y-4">
      {/* Calendar */}
      <div className="cmd-panel p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => navigateMonth(-1)}
            className="p-2 rounded-lg hover:bg-[#132240] text-[#64748B] hover:text-white transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-white">
              {MONTHS[currentMonth]} {currentYear}
            </h3>
            <button
              onClick={goToToday}
              className="px-3 py-1 rounded text-xs font-medium text-[#22D3EE] border border-[#22D3EE]/30 hover:bg-[#22D3EE]/10 transition-colors"
            >
              Today
            </button>
          </div>
          <button
            onClick={() => navigateMonth(1)}
            className="p-2 rounded-lg hover:bg-[#132240] text-[#64748B] hover:text-white transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Weekday Headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map(day => (
            <div key={day} className="text-center text-xs font-medium text-[#4A5E78] py-2">
              {day}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((item, index) => {
            const date = new Date(item.year, item.month, item.day);
            const dateStr = `${item.year}-${String(item.month + 1).padStart(2, '0')}-${String(item.day).padStart(2, '0')}`;
            const dayEvents = eventsByDate[dateStr] || [];
            const isToday = isSameDay(date, today);
            const isSelected = viewSelectedDate && isSameDay(date, viewSelectedDate);
            const hasEvents = dayEvents.length > 0;

            return (
              <button
                key={index}
                onClick={() => handleSelectDate(date)}
                className={`relative h-10 rounded-lg text-sm font-medium transition-colors ${
                  !item.isCurrentMonth
                    ? 'text-[#4A5E78]/50'
                    : isSelected
                    ? 'bg-[#22D3EE] text-white'
                    : isToday
                    ? 'bg-[#22D3EE]/20 text-[#22D3EE]'
                    : 'text-white hover:bg-[#132240]'
                }`}
              >
                {item.day}
                {hasEvents && !isSelected && (
                  <span
                    className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: '#22D3EE' }}
                  />
                )}
                {hasEvents && isSelected && (
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-white" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Events for Selected Date */}
      {viewSelectedDate && (
        <div>
          <h4 className="text-sm font-medium text-[#64748B] mb-2">
            {isSameDay(viewSelectedDate, today)
              ? 'Today'
              : viewSelectedDate.toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric'
                })}
          </h4>

          {selectedDateEvents.length === 0 ? (
            <div className="cmd-panel p-6 text-center">
              <Calendar size={28} className="mx-auto text-[#4A5E78] mb-2" />
              <p className="text-sm text-[#64748B]">No Games Scheduled</p>
            </div>
          ) : (
            <div className="space-y-2">
              {selectedDateEvents.map(event => (
                <button
                  key={event.id}
                  onClick={() => onSelectEvent?.(event)}
                  className="w-full cmd-panel p-4 text-left hover:ring-1 hover:ring-[#22D3EE]/30 transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: '#22D3EE20' }}
                    >
                      <Calendar size={18} className="text-[#22D3EE]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h5 className="font-medium text-white truncate">{event.title}</h5>
                      <div className="flex items-center gap-3 mt-1 text-xs text-[#64748B]">
                        {event.start_time && (
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            {event.start_time}
                          </span>
                        )}
                        {event.game_type && (
                          <span>{event.game_type.toUpperCase()}</span>
                        )}
                        {event.stakes && (
                          <span>{event.stakes}</span>
                        )}
                        {event.max_players && (
                          <span className="flex items-center gap-1">
                            <Users size={12} />
                            {event.rsvp_count || 0}/{event.max_players}
                          </span>
                        )}
                      </div>
                      {event.city && event.state && (
                        <p className="text-xs text-[#4A5E78] mt-1 flex items-center gap-1">
                          <MapPin size={12} />
                          {event.city}, {event.state}
                        </p>
                      )}
                    </div>
                    <span
                      className="px-2 py-0.5 rounded text-xs font-medium flex-shrink-0"
                      style={{
                        backgroundColor: event.status === 'confirmed' ? '#10B98120' :
                          event.status === 'cancelled' ? '#EF444420' : '#22D3EE20',
                        color: event.status === 'confirmed' ? '#10B981' :
                          event.status === 'cancelled' ? '#EF4444' : '#22D3EE'
                      }}
                    >
                      {event.status || 'Scheduled'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
