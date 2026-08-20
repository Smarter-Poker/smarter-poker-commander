/**
 * Tournament Director - Unified Selector
 * Lists all active/scheduled tournaments with 3 actions each:
 *   - TD Controls (floor management)
 *   - Launch Clock (TV/projector display)
 *   - Edit Settings (blind structure, configuration)
 * Route: /commander/tournament-controls
 */
import { useState, useEffect, useCallback } from 'react';
import { busEmit } from '../../src/engine/EventBus';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Trophy, Users, Loader2, Play, Monitor, Settings } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync } from '../../src/lib/commander/useCommanderSync';
import { getStaffSession, getVenueId } from '../../src/lib/commander/clientAuth';
import { commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

// Break-aware level label: current_level is an ARRAY INDEX into blind_structure,
// which interleaves break rows. Count only non-break rows for the display number.
function levelLabel(t) {
    let bs = t?.blind_structure;
    if (typeof bs === 'string') { try { bs = JSON.parse(bs); } catch { bs = []; } }
    if (!Array.isArray(bs)) bs = [];
    const idx = t?.current_level || 0;
    if (!bs.length) return `Level ${idx + 1}`;
    const row = bs[idx];
    if (row?.is_break) return row.label || 'Break';
    return `Level ${bs.slice(0, idx + 1).filter(l => !l.is_break).length}`;
}

const STATUS_COLORS = {
    running: { bg: 'bg-[#31A24C]/10', text: 'text-[#31A24C]', label: 'Running' },
    break: { bg: 'bg-[#F59E0B]/10', text: 'text-[#F59E0B]', label: 'On Break' },
    paused: { bg: 'bg-[#F59E0B]/10', text: 'text-[#F59E0B]', label: 'Paused' }, // 2026-08-04 audit fix: paused tournaments were unstyled
    final_table: { bg: 'bg-[#8B5CF6]/10', text: 'text-[#8B5CF6]', label: 'Final Table' },
    // 2026-08-20 audit fix: the real commander_tournaments value is
    // 'registration'. Only the legacy 'registering' spelling was mapped, so a
    // tournament that had opened registration rendered with the grey
    // "Scheduled" fallback pill.
    registration: { bg: 'bg-[#1877F2]/10', text: 'text-[#1877F2]', label: 'Registration' },
    registering: { bg: 'bg-[#1877F2]/10', text: 'text-[#1877F2]', label: 'Registration' },
    hand_for_hand: { bg: 'bg-[#EF4444]/10', text: 'text-[#EF4444]', label: 'Hand For Hand' },
    scheduled: { bg: 'bg-[#B0B3B8]/10', text: 'text-[#B0B3B8]', label: 'Scheduled' } };

export default function TournamentDirector() {
    const router = useRouter();

    // ── EventBus: Commander session telemetry ──
    useEffect(() => { busEmit.sessionStart('commander-tournament-controls'); }, []);
    const [tournaments, setTournaments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('current'); // 'current' or 'upcoming'

    const fetchTournaments = useCallback(async (signal) => {
        try {
            // 2026-07-25 audit fix: the list API requires venue_id - omit and it 400s
            const venueId = getVenueId();
            if (!venueId) return;
            const data = await commanderFetchJSON(`/api/commander/tournaments?venue_id=${encodeURIComponent(venueId)}`, { });
            if (data.success) {
                const active = (data.data?.tournaments || [])
                    .filter(t => !['completed', 'cancelled'].includes(t.status));
                setTournaments(active);
            }
        } catch (err) { console.warn(err); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => {
        const _c = new AbortController();

        const staff = getStaffSession();
        if (!staff) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
        fetchTournaments();
        return () => _c.abort();
    }, [router, fetchTournaments]);

    // Commander Data Bus - sync tournaments across tabs
    const [syncVenueId] = useState(() => getVenueId());
    useCommanderSync(syncVenueId, fetchTournaments, { entities: ['tournaments'] });

    // 2026-08-04 audit fix: include 'paused' - the clock API sets status 'paused',
    // and without it a paused tournament vanished from both tabs of this selector.
    // 2026-08-20 audit fix: 'registration' (the value actually stored in
    // commander_tournaments; only the legacy 'registering' spelling was listed)
    // and 'hand_for_hand'. A tournament in either state matched NEITHER tab and
    // was unreachable from the one page built for reaching the TD console.
    const currentStatuses = ['running', 'paused', 'break', 'final_table', 'hand_for_hand', 'registration', 'registering'];
    const currentTournaments = tournaments.filter(t => currentStatuses.includes(t.status));
    // Catch-all rather than status === 'scheduled': any future status value is
    // still reachable instead of silently disappearing from both tabs.
    const upcomingTournaments = tournaments.filter(t => !currentStatuses.includes(t.status));
    const displayList = tab === 'current' ? currentTournaments : upcomingTournaments;

    // A freshly created tournament is 'scheduled'. Land on the tab that has it
    // rather than on an empty "No Live Tournaments" panel.
    useEffect(() => {
        if (loading) return;
        if (currentTournaments.length === 0 && upcomingTournaments.length > 0) setTab('upcoming');
        // Runs once per load result, not on every user tab click.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, currentTournaments.length, upcomingTournaments.length]);

    return (
        <CommanderLayout title="Tournament Director | Commander" backHref="/commander/dashboard?card=tournaments">
            <SEOHead title="Commander - Tournament Director" description="Club Commander Poker Room Management Tool." noindex={true} />
            <div className="cmd-page">
                <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-[#1877F2]/10 rounded-lg flex items-center justify-center">
                            <Trophy className="w-5 h-5 text-[#1877F2]" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-white">Tournament Director</h1>
                            <p className="text-sm text-[#B0B3B8]">Manage Live Tournaments, Controls, Clock Display, And Settings</p>
                        </div>
                    </div>

                    {/* Current / Upcoming Tabs */}
                    <div className="flex gap-2">
                        <button onClick={() => setTab('current')}
                            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${tab === 'current'
                                ? 'bg-[#1877F2] text-white'
                                : 'bg-[#3A3B3C] text-[#B0B3B8] hover:bg-[#4A4B4C]'
                                }`}>
                            Current ({currentTournaments.length})
                        </button>
                        <button onClick={() => setTab('upcoming')}
                            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${tab === 'upcoming'
                                ? 'bg-[#1877F2] text-white'
                                : 'bg-[#3A3B3C] text-[#B0B3B8] hover:bg-[#4A4B4C]'
                                }`}>
                            Upcoming ({upcomingTournaments.length})
                        </button>
                    </div>

                    {loading ? (
                        <div className="py-20 text-center">
                            <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin mx-auto" />
                        </div>
                    ) : displayList.length === 0 ? (
                        <div className="cmd-panel p-8 text-center">
                            <Trophy className="w-12 h-12 text-[#3A3B3C] mx-auto mb-3" />
                            <p className="text-[#B0B3B8] mb-4">
                                {tab === 'current' ? 'No Live Tournaments' : 'No Upcoming Tournaments'}
                            </p>
                            <button onClick={() => router.push('/commander/tournaments')}
                                className="px-4 py-2 cmd-btn cmd-btn-primary rounded-lg text-sm font-medium">
                                Go To Tournament Manager
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {displayList.map(t => {
                                const sc = STATUS_COLORS[t.status] || STATUS_COLORS.scheduled;
                                const isLive = ['running', 'break', 'final_table'].includes(t.status);
                                return (
                                    <div key={t.id} className={`cmd-panel overflow-hidden ${isLive ? 'border-[#1877F2]/30' : ''}`}>
                                        {/* Tournament Info Header */}
                                        <div className="p-4 pb-3">
                                            <div className="flex items-start gap-3">
                                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isLive ? 'bg-[#1877F2]/10' : 'bg-[#242526]'}`}>
                                                    <Trophy className={`w-5 h-5 ${isLive ? 'text-[#1877F2]' : 'text-[#B0B3B8]'}`} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-white truncate">{t.name}</p>
                                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${sc.bg} ${sc.text}`}>{sc.label}</span>
                                                        {t.scheduled_start && (
                                                            <span className="text-xs text-[#B0B3B8]">
                                                                {new Date(t.scheduled_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                                                {' '}
                                                                {new Date(t.scheduled_start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                                            </span>
                                                        )}
                                                        {t.current_entries > 0 && (/* 2026-08-04 audit fix: rows expose current_entries, not player_count */
                                                            <span className="text-xs text-[#B0B3B8] flex items-center gap-1">
                                                                <Users className="w-3 h-3" /> {t.current_entries}
                                                            </span>
                                                        )}
                                                        {t.current_level > 0 && <span className="text-xs text-[#B0B3B8]">{levelLabel(t)}</span>}
                                                    </div>
                                                </div>
                                                {isLive && (
                                                    <span className="flex items-center gap-1 text-xs font-medium text-[#31A24C] flex-shrink-0">
                                                        <span className="w-2 h-2 bg-[#31A24C] rounded-full animate-pulse" />
                                                        LIVE
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Action Buttons */}
                                        <div className="border-t border-[#3A3B3C] grid grid-cols-3 divide-x divide-[#3A3B3C]">
                                            <button
                                                onClick={() => router.push(`/commander/td/${t.id}`)}
                                                className="flex items-center justify-center gap-2 py-3 px-2 hover:bg-[#3A3B3C] transition-colors text-sm"
                                            >
                                                <Play className="w-4 h-4 text-[#1877F2]" />
                                                <span className="text-[#E4E6EB] font-medium">TD Controls</span>
                                            </button>
                                            <button
                                                onClick={() => window.open(`/commander/tournaments/${t.id}/clock-display`, '_blank')}
                                                className="flex items-center justify-center gap-2 py-3 px-2 hover:bg-[#3A3B3C] transition-colors text-sm"
                                            >
                                                <Monitor className="w-4 h-4 text-[#F59E0B]" />
                                                <span className="text-[#E4E6EB] font-medium">Launch Clock</span>
                                            </button>
                                            <button
                                                onClick={() => router.push(`/commander/tournaments/${t.id}/settings`)}
                                                className="flex items-center justify-center gap-2 py-3 px-2 hover:bg-[#3A3B3C] transition-colors text-sm"
                                            >
                                                <Settings className="w-4 h-4 text-[#B0B3B8]" />
                                                <span className="text-[#E4E6EB] font-medium">Settings</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </CommanderLayout>
    );
}
