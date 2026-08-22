/**
 * Tournament Season Leaderboards
 * /commander/tournament-leaderboards
 *
 * The season points system existed end to end in the API layer and had never
 * produced a single row in production, because nothing in the UI could create
 * a season and nothing could mark one active. Points are awarded on finalize
 * against the venue's ACTIVE season, so with zero seasons every finish scored
 * against nothing.
 *
 * This screen closes that: create a season (name, dates, points per entry,
 * points by finishing position), activate exactly one, and read the standings
 * aggregated from commander_tournament_points.
 *
 * NOT the same thing as /commander/leaderboard-builder, which manages the TV
 * display boards in commander_leaderboards. These are the tournament points
 * seasons in commander_tournament_leaderboards.
 *
 * UI: Dark theme, SmarterPoker colors, Inter font, 44px+ touch targets.
 */
import { useState, useEffect, useCallback } from 'react';
import SEOHead from '../../src/components/seo/SEOHead';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../src/engine/EventBus';
import { broadcastChange } from '../../src/lib/commander/useCommanderSync';
import {
    Trophy, Plus, Loader2, ChevronDown, Check, Power, Medal
} from 'lucide-react';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

const DEFAULT_STRUCTURE = [
    { position: 1, points: 100 },
    { position: 2, points: 75 },
    { position: 3, points: 60 },
    { position: 4, points: 50 },
    { position: 5, points: 40 },
    { position: 6, points: 35 },
    { position: 7, points: 30 },
    { position: 8, points: 25 },
    { position: 9, points: 20 },
    { position: 10, points: 15 }
];

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function yearEndISO() {
    const d = new Date();
    return new Date(d.getFullYear(), 11, 31).toISOString().slice(0, 10);
}

function formatDate(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '--';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TournamentLeaderboards() {
    useEffect(() => { busEmit.sessionStart('commander-tournament-leaderboards'); }, []);

    const [boards, setBoards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [expandedId, setExpandedId] = useState(null);
    const [showCreate, setShowCreate] = useState(false);
    const [toast, setToast] = useState(null);

    const [form, setForm] = useState({
        name: '',
        season_start: todayISO(),
        season_end: yearEndISO(),
        point_for_entry: '1',
        structure: DEFAULT_STRUCTURE.map(s => ({ ...s })),
        is_active: true
    });

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(t);
    }, [toast]);

    const fetchBoards = useCallback(async (signal) => {
        try {
            const json = await commanderFetchJSON(
                '/api/commander/tournaments/leaderboards',
                { ...(signal ? { signal } : {}) }
            );
            if (json?.success) setBoards(json.data?.leaderboards || []);
        } catch (err) {
            console.warn('Fetch leaderboards error:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const c = new AbortController();
        fetchBoards(c.signal);
        return () => c.abort();
    }, [fetchBoards]);

    // ── Structure editing ─────────────────────────────────────────────────
    const setStructurePoints = (index, value) => {
        setForm(prev => {
            const next = prev.structure.map((s, i) =>
                i === index ? { ...s, points: value === '' ? '' : Number(value) } : s
            );
            return { ...prev, structure: next };
        });
    };

    const addPlace = () => {
        setForm(prev => ({
            ...prev,
            structure: [...prev.structure, { position: prev.structure.length + 1, points: 0 }]
        }));
    };

    const removePlace = () => {
        setForm(prev => ({
            ...prev,
            structure: prev.structure.length > 1 ? prev.structure.slice(0, -1) : prev.structure
        }));
    };

    // ── Create ────────────────────────────────────────────────────────────
    const createSeason = async () => {
        if (!form.name.trim()) {
            setToast({ type: 'error', text: 'Season Name Is Required.' });
            return;
        }
        if (new Date(form.season_end) < new Date(form.season_start)) {
            setToast({ type: 'error', text: 'Season End Must Not Be Before Season Start.' });
            return;
        }

        setBusy(true);
        try {
            const res = await commanderFetch('/api/commander/tournaments/leaderboards', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: form.name.trim(),
                    season_start: form.season_start,
                    season_end: form.season_end,
                    point_for_entry: Number(form.point_for_entry) || 0,
                    point_structure: form.structure.map((s, i) => ({
                        position: s.position || i + 1,
                        points: Number(s.points) || 0
                    })),
                    is_active: form.is_active
                })
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.success) {
                setToast({ type: 'error', text: json?.error?.message || 'Failed To Create The Season.' });
                return;
            }
            setToast({ type: 'success', text: `Season "${form.name.trim()}" Created.` });
            setShowCreate(false);
            setForm(prev => ({ ...prev, name: '' }));
            broadcastChange('leaderboards');
            await fetchBoards();
        } catch (err) {
            console.warn('Create season error:', err);
            setToast({ type: 'error', text: 'Failed To Create The Season.' });
        } finally {
            setBusy(false);
        }
    };

    // ── Activate / Deactivate ─────────────────────────────────────────────
    const toggleActive = async (board) => {
        setBusy(true);
        try {
            const res = await commanderFetch(`/api/commander/tournaments/leaderboards/${board.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: !board.is_active })
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.success) {
                setToast({ type: 'error', text: json?.error?.message || 'Failed To Update The Season.' });
                return;
            }
            setToast({
                type: 'success',
                text: board.is_active
                    ? 'Season Deactivated. New Finishes Will Not Score Into It.'
                    : 'Season Activated. New Finishes Score Into It Automatically.'
            });
            broadcastChange('leaderboards');
            await fetchBoards();
        } catch (err) {
            console.warn('Toggle season error:', err);
            setToast({ type: 'error', text: 'Failed To Update The Season.' });
        } finally {
            setBusy(false);
        }
    };

    const activeCount = boards.filter(b => b.is_active).length;

    return (
        <CommanderLayout title="Tournament Leaderboards" backHref="/commander/dashboard?card=tournaments">
            <SEOHead
                title="Commander - Tournament Leaderboards"
                description="Club Commander Poker Room Management Tool."
                noindex={true}
            />
            <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter'] pb-16">

                {/* Header */}
                <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3">
                    <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <h1 className="text-lg font-bold text-white">Tournament Leaderboards</h1>
                            <p className="text-xs text-[#B0B3B8]">Season Points From Tournament Finishes</p>
                        </div>
                        <button onClick={() => setShowCreate(v => !v)}
                            className="h-11 px-4 rounded-xl bg-[#1877F2] text-white text-sm font-semibold flex items-center gap-2 active:opacity-90 flex-shrink-0">
                            <Plus className="w-4 h-4" /> {showCreate ? 'Close' : 'New Season'}
                        </button>
                    </div>
                </div>

                <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">

                    {/* How this works */}
                    <div className="bg-[#1877F2]/10 border border-[#1877F2]/30 rounded-xl p-4">
                        <p className="text-xs text-[#B0B3B8] leading-relaxed">
                            Points Are Awarded Automatically When A Tournament Is Finalized From The
                            Director's Final Results Screen. A Finish Scores Into The Season Attached To
                            That Tournament, Or Into This Venue's Active Season When None Is Attached.
                            Keep Exactly One Season Active At A Time.
                        </p>
                        {activeCount === 0 && !loading && (
                            <p className="text-xs text-[#F59E0B] font-medium mt-2">
                                No Active Season. Create One So Finishes Start Scoring.
                            </p>
                        )}
                    </div>

                    {/* Create form */}
                    {showCreate && (
                        <div className="bg-[#242526] border border-[#1877F2] rounded-xl p-4 space-y-4">
                            <h2 className="text-sm font-bold text-white">Create Season</h2>

                            <div>
                                <label className="block text-xs text-[#B0B3B8] uppercase tracking-wider mb-1">Season Name</label>
                                <input type="text" value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                    placeholder="Fall Points Race"
                                    className="w-full h-12 px-3 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-[#E4E6EB] text-sm focus:outline-none focus:border-[#1877F2] placeholder-[#6A6B6D]" />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-[#B0B3B8] uppercase tracking-wider mb-1">Season Start</label>
                                    <input type="date" value={form.season_start}
                                        onChange={e => setForm({ ...form, season_start: e.target.value })}
                                        className="w-full h-12 px-3 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-[#E4E6EB] text-sm focus:outline-none focus:border-[#1877F2]" />
                                </div>
                                <div>
                                    <label className="block text-xs text-[#B0B3B8] uppercase tracking-wider mb-1">Season End</label>
                                    <input type="date" value={form.season_end}
                                        onChange={e => setForm({ ...form, season_end: e.target.value })}
                                        className="w-full h-12 px-3 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-[#E4E6EB] text-sm focus:outline-none focus:border-[#1877F2]" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-[#B0B3B8] uppercase tracking-wider mb-1">Points Per Entry</label>
                                    <input type="number" min="0" value={form.point_for_entry}
                                        onChange={e => setForm({ ...form, point_for_entry: e.target.value })}
                                        className="w-full h-12 px-3 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-[#E4E6EB] text-sm focus:outline-none focus:border-[#1877F2]" />
                                    <p className="text-[10px] text-[#B0B3B8] mt-1">Awarded To Every Scored Finisher</p>
                                </div>
                                <div>
                                    <label className="block text-xs text-[#B0B3B8] uppercase tracking-wider mb-1">Activate On Create</label>
                                    <button onClick={() => setForm({ ...form, is_active: !form.is_active })}
                                        className={`w-full h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 ${form.is_active ? 'bg-[#31A24C] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'}`}>
                                        {form.is_active ? <Check className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                                        {form.is_active ? 'Active' : 'Inactive'}
                                    </button>
                                    <p className="text-[10px] text-[#B0B3B8] mt-1">Deactivates Any Other Active Season</p>
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs text-[#B0B3B8] uppercase tracking-wider">Points By Finishing Position</label>
                                    <div className="flex gap-2">
                                        <button onClick={removePlace}
                                            className="h-11 px-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-xs font-medium active:bg-[#4A4B4C]">
                                            Remove Place
                                        </button>
                                        <button onClick={addPlace}
                                            className="h-11 px-3 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-xs font-medium active:bg-[#4A4B4C]">
                                            Add Place
                                        </button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {form.structure.map((slot, i) => (
                                        <div key={slot.position || i} className="flex items-center gap-2 bg-[#3A3B3C] rounded-xl px-3 h-12">
                                            <span className="text-xs text-[#B0B3B8] w-10 flex-shrink-0">
                                                {slot.position || i + 1}
                                            </span>
                                            <input type="number" min="0" value={slot.points}
                                                onChange={e => setStructurePoints(i, e.target.value)}
                                                className="flex-1 min-w-0 bg-transparent text-[#E4E6EB] text-sm text-right focus:outline-none" />
                                            <span className="text-[10px] text-[#B0B3B8] flex-shrink-0">Pts</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <button onClick={() => setShowCreate(false)} disabled={busy}
                                    className="flex-1 h-12 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-bold active:bg-[#4A4B4C] disabled:opacity-50">
                                    Cancel
                                </button>
                                <button onClick={createSeason} disabled={busy}
                                    className="flex-1 h-12 rounded-xl bg-[#1877F2] text-white text-sm font-bold flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-50">
                                    {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                                    Create Season
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Board list */}
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
                        </div>
                    ) : boards.length === 0 ? (
                        <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-8 text-center">
                            <Trophy className="w-10 h-10 text-[#3A3B3C] mx-auto mb-3" />
                            <p className="text-[#B0B3B8] text-sm">No Seasons Yet</p>
                            <p className="text-[#B0B3B8] text-xs mt-1">Create One To Start Tracking Tournament Points.</p>
                        </div>
                    ) : boards.map(board => {
                        const isExpanded = expandedId === board.id;
                        const standings = board.standings || [];
                        return (
                            <div key={board.id}
                                className="bg-[#242526] border border-[#3A3B3C] rounded-xl overflow-hidden"
                                style={{ borderLeft: `4px solid ${board.is_active ? '#31A24C' : '#3A3B3C'}` }}>
                                <div className="p-4 flex items-center gap-3">
                                    <button onClick={() => setExpandedId(isExpanded ? null : board.id)}
                                        className="flex-1 min-w-0 text-left">
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-base font-semibold text-white truncate">{board.name}</h3>
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${board.is_active ? 'bg-[#31A24C]/15 text-[#31A24C]' : 'bg-[#3A3B3C] text-[#B0B3B8]'}`}>
                                                {board.is_active ? 'ACTIVE' : 'INACTIVE'}
                                            </span>
                                        </div>
                                        <p className="text-xs text-[#B0B3B8] mt-0.5">
                                            {formatDate(board.season_start)} To {formatDate(board.season_end)},
                                            {' '}{(board.point_for_entry || 0).toLocaleString()} Per Entry,
                                            {' '}{standings.length.toLocaleString()} Player{standings.length === 1 ? '' : 's'}
                                        </p>
                                    </button>
                                    <button onClick={() => toggleActive(board)} disabled={busy}
                                        className={`h-11 px-3 rounded-xl text-xs font-bold flex-shrink-0 disabled:opacity-50 ${board.is_active ? 'bg-[#3A3B3C] text-[#EF4444]' : 'bg-[#31A24C] text-white'}`}>
                                        {board.is_active ? 'Deactivate' : 'Activate'}
                                    </button>
                                    <button onClick={() => setExpandedId(isExpanded ? null : board.id)}
                                        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0">
                                        <ChevronDown className={`w-5 h-5 text-[#B0B3B8] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                </div>

                                {isExpanded && (
                                    <div className="border-t border-[#3A3B3C]">
                                        {standings.length === 0 ? (
                                            <p className="px-4 py-6 text-center text-sm text-[#B0B3B8]">
                                                No Points Awarded Yet. Finalize A Tournament To Populate This Board.
                                            </p>
                                        ) : (
                                            <div className="divide-y divide-[#3A3B3C]">
                                                {standings.slice(0, 100).map(row => (
                                                    <div key={`${board.id}-${row.player_id || row.player_name}`}
                                                        className="px-4 py-3 flex items-center gap-3">
                                                        <span className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${row.rank === 1 ? 'bg-[#F59E0B]/20 text-[#F59E0B]'
                                                            : row.rank <= 3 ? 'bg-[#1877F2]/20 text-[#1877F2]'
                                                                : 'bg-[#3A3B3C] text-[#B0B3B8]'
                                                            }`}>
                                                            {row.rank}
                                                        </span>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm text-[#E4E6EB] truncate">{row.player_name || 'Player'}</p>
                                                            <p className="text-[10px] text-[#B0B3B8]">
                                                                {(row.events_played || 0).toLocaleString()} Event{row.events_played === 1 ? '' : 's'}
                                                                {row.best_finish ? `, Best Finish ${row.best_finish}` : ''}
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                                            <Medal className="w-4 h-4 text-[#F59E0B]" />
                                                            <span className="text-sm font-bold text-white">
                                                                {(row.total_points || 0).toLocaleString()}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {toast && (
                    <div className="fixed bottom-6 left-4 right-4 z-50 flex justify-center">
                        <div className={`max-w-md w-full px-4 py-3 rounded-xl text-sm font-semibold text-white shadow-lg ${toast.type === 'error' ? 'bg-[#EF4444]' : 'bg-[#31A24C]'}`}>
                            {toast.text}
                        </div>
                    </div>
                )}
            </div>
        </CommanderLayout>
    );
}
