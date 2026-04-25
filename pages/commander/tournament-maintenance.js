/**
 * Tournament Maintenance — Calendar View
 * See entire tournament schedule and make corrections to scheduled tournaments
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync } from '../../src/lib/commander/useCommanderSync';
import { Calendar, ChevronLeft, ChevronRight, Edit2, Loader2, Clock, DollarSign, Users } from 'lucide-react';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

export default function TournamentMaintenance() {
  useEffect(() => { busEmit.sessionStart('commander-tournament-maintenance'); }, []);
    const router = useRouter();
    const [staff, setStaff] = useState(null);
    const [tournaments, setTournaments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(null);

    useEffect(() => {
        const stored = getStaffSession();
        if (!stored) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
        try {
            const s = JSON.parse(stored);
            if (!s.venue_id) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
            setStaff(s);
        } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
    }, []);

    const fetchTournaments = useCallback(async () => {
        setLoading(true);
        try {
            const json = await commanderFetchJSON('/api/commander/tournaments?limit=100', {});
            if (json.success || json.data) {
                setTournaments(json.data?.tournaments || json.data || []);
            }
        } catch (err) { console.warn(err); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { if (staff) { const _c = new AbortController(); fetchTournaments(_c.signal); return () => _c.abort(); } }, [staff, fetchTournaments]);

    // Commander Data Bus — sync tournaments across tabs
    useCommanderSync(staff?.venue_id || '', fetchTournaments, { entities: ['tournaments'] });

    // Calendar helpers
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthName = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

    const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

    // Get tournaments for a specific date
    const getTournamentsForDate = (day) => {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return tournaments.filter(t => {
            if (!t.scheduled_start) return false;
            return t.scheduled_start.startsWith(dateStr);
        });
    };

    const selectedTournaments = selectedDate ? getTournamentsForDate(selectedDate) : [];

    const STATUS_COLORS = {
        scheduled: 'bg-[#1877F2]/10 text-[#1877F2]',
        registration: 'bg-[#22D3EE]/10 text-[#22D3EE]',
        running: 'bg-[#31A24C]/10 text-[#31A24C]',
        completed: 'bg-[#64748B]/10 text-[#64748B]',
        cancelled: 'bg-[#EF4444]/10 text-[#EF4444]',
        paused: 'bg-[#F59E0B]/10 text-[#F59E0B]',
        final_table: 'bg-[#8B5CF6]/10 text-[#8B5CF6]' };

    if (!staff) {
        return (
            <div className="cmd-page flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
            </div>
        );
    }

    return (
        <CommanderLayout title="Tournament Maintenance | Commander" backHref="/commander/dashboard?card=tournaments">
            <SEOHead title="Commander — Tournament Maintenance" description="Tournament schedule calendar" noindex={true} />
            <div className="cmd-page">
                <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">

                    {/* Header */}
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#1877F2]/10 rounded-lg flex items-center justify-center">
                            <Calendar className="w-5 h-5 text-[#1877F2]" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-white">Tournament Maintenance</h1>
                            <p className="text-sm text-[#64748B]">View schedule and make corrections to tournaments</p>
                        </div>
                    </div>

                    {/* Calendar */}
                    <div className="cmd-panel p-4">
                        {/* Month Navigation */}
                        <div className="flex items-center justify-between mb-4">
                            <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-[#132240] text-[#64748B] hover:text-white transition-colors">
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <h2 className="text-lg font-bold text-white">{monthName}</h2>
                            <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-[#132240] text-[#64748B] hover:text-white transition-colors">
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Day Headers */}
                        <div className="grid grid-cols-7 gap-1 mb-1">
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                                <div key={d} className="text-center text-[10px] font-semibold text-[#64748B] uppercase py-1">{d}</div>
                            ))}
                        </div>

                        {/* Calendar Grid */}
                        <div className="grid grid-cols-7 gap-1">
                            {/* Empty cells for days before 1st */}
                            {Array(firstDay).fill(null).map((_, i) => (
                                <div key={`empty-${i}`} className="min-h-[72px]"></div>
                            ))}
                            {/* Day cells */}
                            {Array(daysInMonth).fill(null).map((_, i) => {
                                const day = i + 1;
                                const dayTournaments = getTournamentsForDate(day);
                                const isToday = new Date().getDate() === day && new Date().getMonth() === month && new Date().getFullYear() === year;
                                const isSelected = selectedDate === day;

                                const STATUS_DOT = {
                                    scheduled: 'text-[#1877F2]',
                                    registration: 'text-[#22D3EE]',
                                    running: 'text-[#31A24C]',
                                    completed: 'text-[#64748B]',
                                    cancelled: 'text-[#EF4444]',
                                    paused: 'text-[#F59E0B]',
                                    final_table: 'text-[#8B5CF6]' };

                                return (
                                    <button
                                        key={day}
                                        onClick={() => setSelectedDate(isSelected ? null : day)}
                                        className={`min-h-[72px] rounded-lg flex flex-col items-start p-1.5 transition-all relative text-left ${isSelected ? 'bg-[#1877F2] text-white ring-2 ring-[#1877F2]/50'
                                            : isToday ? 'bg-[#1877F2]/10 text-white border border-[#1877F2]/30'
                                                : 'text-[#94A3B8] hover:bg-[#132240]'
                                            }`}
                                    >
                                        <span className="text-xs font-semibold">{day}</span>
                                        {dayTournaments.length > 0 && (
                                            <div className="mt-0.5 w-full space-y-px overflow-hidden flex-1">
                                                {dayTournaments.slice(0, 3).map((t, j) => {
                                                    const dotColor = isSelected ? 'text-white/70' : (STATUS_DOT[t.status] || 'text-[#1877F2]');
                                                    // Abbreviate: take first ~8 chars of name
                                                    const shortName = t.name.length > 10 ? t.name.slice(0, 9) + '…' : t.name;
                                                    return (
                                                        <div key={j} className={`text-[8px] leading-[11px] font-medium truncate ${isSelected ? 'text-white/90' : dotColor}`}>
                                                            {shortName}
                                                        </div>
                                                    );
                                                })}
                                                {dayTournaments.length > 3 && (
                                                    <div className={`text-[7px] leading-[10px] font-semibold ${isSelected ? 'text-white/60' : 'text-[#64748B]'}`}>
                                                        +{dayTournaments.length - 3} more
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Selected Date Detail */}
                    {selectedDate && (
                        <div>
                            <p className="text-xs text-[#64748B] font-semibold uppercase tracking-wider mb-2">
                                {new Date(year, month, selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                            </p>
                            {selectedTournaments.length > 0 ? (
                                <div className="space-y-2">
                                    {selectedTournaments.map(t => (
                                        <div key={t.id} className="cmd-panel p-4 flex items-center gap-3">
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-white truncate">{t.name}</p>
                                                <div className="flex items-center gap-3 mt-1 text-xs text-[#64748B]">
                                                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />
                                                        {new Date(t.scheduled_start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                                    </span>
                                                    <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />
                                                        ${t.buyin_amount || 0}
                                                    </span>
                                                    <span className="flex items-center gap-1"><Users className="w-3 h-3" />
                                                        {t.current_entries || 0}/{t.max_entries || '∞'}
                                                    </span>
                                                </div>
                                            </div>
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${STATUS_COLORS[t.status] || STATUS_COLORS.scheduled}`}>{t.status}</span>
                                            <button
                                                onClick={() => router.push(`/commander/tournaments?edit=${t.id}`)}
                                                className="p-2 rounded-lg hover:bg-[#1877F2]/10 text-[#64748B] hover:text-[#1877F2] transition-colors"
                                                title="Edit tournament"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="cmd-panel p-4 text-center text-[#64748B] text-sm">
                                    No tournaments scheduled for this date
                                </div>
                            )}
                        </div>
                    )}

                    {loading && (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-[#1877F2]" />
                        </div>
                    )}
                </div>
            </div>
        </CommanderLayout>
    );
}
