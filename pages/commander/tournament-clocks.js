/**
 * Tournament Clocks — Multi-Clock Hub
 * Supports up to 6 simultaneous tournament clocks for TV/HDMI streaming
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync } from '../../src/lib/commander/useCommanderSync';
import { Clock, Monitor, Play, Loader2, Tv } from 'lucide-react';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

export default function TournamentClocks() {
  useEffect(() => { busEmit.sessionStart('commander-tournament-clocks'); }, []);
    const router = useRouter();
    const [staff, setStaff] = useState(null);
    const [tournaments, setTournaments] = useState([]);
    const [loading, setLoading] = useState(true);

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
            const json = await commanderFetchJSON('/api/commander/tournaments?limit=50', {});
            if (json.success || json.data) {
                const all = json.data?.tournaments || json.data || [];
                // Show running, paused, registration, and scheduled tournaments
                const active = all.filter(t => ['running', 'paused', 'registering', 'final_table', 'scheduled'].includes(t.status));
                setTournaments(active);
            }
        } catch (err) { console.warn(err); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { if (staff) { const _c = new AbortController(); fetchTournaments(_c.signal); return () => _c.abort(); } }, [staff, fetchTournaments]);

    // Commander Data Bus — sync tournaments across tabs
    useCommanderSync(staff?.venue_id || '', fetchTournaments, { entities: ['tournaments'] });

    if (!staff) {
        return (
            <div className="cmd-page flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
            </div>
        );
    }

    const runningTournaments = tournaments.filter(t => ['running', 'paused', 'final_table'].includes(t.status));
    const upcomingTournaments = tournaments.filter(t => ['scheduled', 'registering'].includes(t.status));

    return (
        <CommanderLayout title="Tournament Clocks | Commander" backHref="/commander/dashboard?card=tournaments">
            <SEOHead title="Commander — Tournament Clocks" description="Live tournament clocks for TV streaming" noindex={true} />
            <div className="cmd-page">
                <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">

                    {/* Header */}
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#1877F2]/10 rounded-lg flex items-center justify-center">
                            <Clock className="w-5 h-5 text-[#1877F2]" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-white">Tournament Clocks</h1>
                            <p className="text-sm text-[#64748B]">Stream up to 6 clocks to TVs via HDMI</p>
                        </div>
                    </div>

                    {/* Info Banner */}
                    <div className="cmd-panel p-4 border-[#1877F2]/20">
                        <div className="flex items-start gap-3">
                            <Tv className="w-5 h-5 text-[#1877F2] mt-0.5 flex-shrink-0" />
                            <div className="text-sm text-[#94A3B8]">
                                <p className="font-semibold text-white mb-1">HDMI Streaming Ready</p>
                                <p>Open any clock in fullscreen mode, then connect your device to a TV via HDMI transmitter. Each clock runs independently — stream up to 6 tournaments simultaneously on different screens.</p>
                            </div>
                        </div>
                    </div>

                    {/* Running Tournaments */}
                    {runningTournaments.length > 0 && (
                        <div>
                            <p className="text-xs text-[#64748B] font-semibold uppercase tracking-wider mb-2 flex items-center gap-2">
                                <span className="w-2 h-2 bg-[#31A24C] rounded-full animate-pulse"></span> Live Clocks
                            </p>
                            <div className="space-y-2">
                                {runningTournaments.map(t => (
                                    <div key={t.id} className="cmd-panel p-4 border-[#31A24C]/20 flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-[#31A24C]/10 flex items-center justify-center flex-shrink-0">
                                            <Play className="w-5 h-5 text-[#31A24C]" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-white truncate">{t.name}</p>
                                            <p className="text-xs text-[#64748B]">
                                                Level {t.current_level || 1} • {t.players_remaining || '?'} remaining • {t.status}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => window.open(`/commander/tournaments/${t.id}/clock-display`, '_blank')}
                                            className="flex items-center gap-2 px-4 py-2 bg-[#1877F2] text-white font-semibold rounded-lg hover:bg-[#1565D0] transition-colors text-sm"
                                        >
                                            <Monitor className="w-4 h-4" /> Open Clock
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Upcoming Tournaments */}
                    {upcomingTournaments.length > 0 && (
                        <div>
                            <p className="text-xs text-[#64748B] font-semibold uppercase tracking-wider mb-2">Upcoming</p>
                            <div className="space-y-2">
                                {upcomingTournaments.map(t => (
                                    <div key={t.id} className="cmd-panel p-3 flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-[#1877F2]/10 flex items-center justify-center flex-shrink-0">
                                            <Clock className="w-4 h-4 text-[#1877F2]" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-white text-sm truncate">{t.name}</p>
                                            <p className="text-xs text-[#64748B]">
                                                {t.scheduled_start ? new Date(t.scheduled_start).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'TBD'}
                                            </p>
                                        </div>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-[#1877F2]/10 text-[#1877F2]">{t.status}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Empty State */}
                    {!loading && tournaments.length === 0 && (
                        <div className="cmd-panel p-8 text-center">
                            <Clock className="w-12 h-12 text-[#4A5E78] mx-auto mb-3" />
                            <p className="text-[#64748B] mb-2">No active tournaments</p>
                            <p className="text-xs text-[#4A5E78]">Start a tournament from the Tournament Manager to see its clock here.</p>
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
