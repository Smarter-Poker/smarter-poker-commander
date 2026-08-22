/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Leaderboard Builder - Staff Management Page
 * /commander/leaderboard-builder
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Staff can:
 * - Create custom leaderboards (name, type, period, prizes)
 * - Add/edit entries (pick player, set score/points/hours)
 * - Set boards active/inactive for display rotation
 * - Delete old boards
 * - View current boards on the TV display
 *
 * Uses existing API:
 *   POST /api/commander/leaderboards - create board
 *   PUT  /api/commander/leaderboards/[id] - update board
 *   POST /api/commander/leaderboards/[id]/entries - add/update entry
 *   GET  /api/commander/leaderboards - list all boards
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../src/engine/EventBus';
import { broadcastChange } from '../../src/lib/commander/useCommanderSync';
import SEOHead from '../../src/components/seo/SEOHead';
import { getVenueId } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

const BOARD_TYPES = [
    { value: 'custom', label: 'Custom Points', icon: '', desc: 'Manually Assign Points To Players' },
    { value: 'hours_played', label: 'Hours Played', icon: '', desc: 'Auto-Calculated From Player Sessions' },
    { value: 'sessions', label: 'Session Count', icon: '', desc: 'Number Of Play Sessions' },
    { value: 'high_hand', label: 'High Hand', icon: '', desc: 'High Hand Promotion Tracker' },
    { value: 'tournament_points', label: 'Tournament Points', icon: '', desc: 'Points From Tournament Finishes' },
    { value: 'referrals', label: 'Referral Count', icon: '', desc: 'Player Referral Leaderboard' },
];

const PERIOD_TYPES = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'yearly', label: 'Annual' },
    { value: 'custom', label: 'Custom Dates' },
];

export default function LeaderboardBuilder() {
    useEffect(() => { busEmit.sessionStart('commander-leaderboard-builder'); }, []);
    const [boards, setBoards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState(null);
    const [entries, setEntries] = useState({});
    const [members, setMembers] = useState([]);
    const [showCreate, setShowCreate] = useState(false);
    const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

    // Create form state
    const [newBoard, setNewBoard] = useState({
        name: '', description: '', leaderboard_type: 'custom',
        period_type: 'monthly', start_date: '', end_date: '',
        prizes: '', rules_description: '', status: 'active' });

    // Add entry form
    const [addEntry, setAddEntry] = useState({ player_id: '', score: '', hours_played: '', sessions_count: '' });

    const [venueId] = useState(() => {
        return getVenueId();
    });

    const flash = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 4000); };

    // ── Fetch boards ──
    const fetchBoards = useCallback(async (signal) => {
        try {
            // 2026-08-04 audit fix: without venue_id the list API returns every
            // venue's leaderboards - scope the builder to this venue's boards.
            const res = await commanderFetch(`/api/commander/leaderboards?status=all${venueId ? `&venue_id=${encodeURIComponent(venueId)}` : ''}`, { ...(signal ? { signal } : {}) });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const json = await res.json();
            setBoards(json?.leaderboards || json?.data || []);
        } catch (err) { console.warn(err); }
        setLoading(false);
    }, [venueId]);

    // ── Fetch members for dropdown ──
    const fetchMembers = useCallback(async (signal) => {
        if (!venueId) return;
        try {
            const res = await commanderFetch(`/api/commander/members?venue_id=${venueId}&limit=200`, { ...(signal ? { signal } : {}) });
            if (!res.ok) throw new Error('err');
            const json = await res.json();
            setMembers(json?.data?.members || json?.members || []);
        } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    }, [venueId]);

    // ── Fetch entries for a board ──
    const fetchEntries = async (boardId) => {
        try {
            const json = await commanderFetchJSON(`/api/commander/leaderboards/${boardId}/entries`, {});
            setEntries(prev => ({ ...prev, [boardId]: (json?.entries || json?.data || []).sort((a, b) => (b.score || 0) - (a.score || 0)) }));
        } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    };

    useEffect(() => { const c = new AbortController(); fetchBoards(c.signal); fetchMembers(c.signal); return () => c.abort(); }, [fetchBoards, fetchMembers]);

    // ── Create board ──
    const handleCreate = async () => {
        if (!newBoard.name.trim()) { flash('error', 'Board Name Required'); return; }
        try {
const today = new Date();
            const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

            const res = await commanderFetch('/api/commander/leaderboards', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    venue_id: venueId,
                    name: newBoard.name,
                    description: newBoard.description || null,
                    leaderboard_type: newBoard.leaderboard_type,
                    period_type: newBoard.period_type,
                    start_date: newBoard.start_date || today.toISOString().split('T')[0],
                    end_date: newBoard.end_date || endOfMonth.toISOString().split('T')[0],
                    prizes: newBoard.prizes ? [{ description: newBoard.prizes }] : [],
                    rules_description: newBoard.rules_description || null,
                    status: newBoard.status }) });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const json = await res.json();
            if (res.ok) {
                flash('success', `Board "${newBoard.name}" Created!`);
                setShowCreate(false);
                setNewBoard({ name: '', description: '', leaderboard_type: 'custom', period_type: 'monthly', start_date: '', end_date: '', prizes: '', rules_description: '', status: 'active' });
                fetchBoards();
                broadcastChange('leaderboards');
            } else {
                flash('error', json.error || 'Failed To Create Board');
            }
        } catch (err) { flash('error', 'Network error'); }
    };

    // ── Add entry to board ──
    const handleAddEntry = async (boardId) => {
        if (!addEntry.player_id) { flash('error', 'Select A Player'); return; }
        try {
const res = await commanderFetch(`/api/commander/leaderboards/${boardId}/entries`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    player_id: addEntry.player_id,
                    score: Number(addEntry.score) || 0,
                    hours_played: Number(addEntry.hours_played) || 0,
                    sessions_count: Number(addEntry.sessions_count) || 0,
                    points_earned: Number(addEntry.score) || 0 }) });
            if (res.ok) {
                flash('success', 'Entry Added!');
                setAddEntry({ player_id: '', score: '', hours_played: '', sessions_count: '' });
                fetchEntries(boardId);
                broadcastChange('leaderboards');
            } else {
                const json = await res.json();
                flash('error', json.error || 'Failed To Add Entry');
            }
        } catch { flash('error', 'Network Error'); }
    };

    // ── Toggle status ──
    const toggleStatus = async (board) => {
        const newStatus = board.status === 'active' ? 'completed' : 'active';
        try {
const res = await commanderFetch(`/api/commander/leaderboards/${board.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }) });
            if (res.ok) {
                flash('success', `Board ${newStatus === 'active' ? 'Activated' : 'Deactivated'}`);
                fetchBoards();
                broadcastChange('leaderboards');
            } else {
                const json = await res.json().catch(() => ({}));
                flash('error', json.error || `Failed To Update (${res.status})`);
            }
        } catch { flash('error', 'Failed To Update'); }
    };

    // ── Auto-calculate ──
    const autoCalculate = async (boardId) => {
        try {
const res = await commanderFetch(`/api/commander/leaderboards/${boardId}/entries`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'calculate' }) });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const json = await res.json().catch(() => ({}));
            if (res.ok) {
                flash('success', `Calculated ${json.entries_updated || 0} Entries`);
                broadcastChange('leaderboards');
            } else {
                flash('error', json.error || `Calculation Failed (${res.status})`);
            }
            fetchEntries(boardId);
        } catch { flash('error', 'Calculation Failed'); }
    };

    const expandBoard = (id) => {
        if (expandedId === id) { setExpandedId(null); return; }
        setExpandedId(id);
        if (!entries[id]) fetchEntries(id);
    };

    // ═══════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════
    const s = {
        card: { background: '#1a1a2e', border: '2px solid rgba(255,255,255,0.15)', borderRadius: '12px', padding: '20px', marginBottom: '12px' },
        btn: { padding: '8px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', fontWeight: 600, fontSize: '13px' },
        input: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', padding: '10px 14px', color: 'white', width: '100%', fontSize: '14px', outline: 'none', boxSizing: 'border-box' },
        select: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', padding: '10px 14px', color: 'white', width: '100%', fontSize: '14px', outline: 'none', boxSizing: 'border-box' },
        label: { display: 'block', fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' } };

    return (
        <CommanderLayout title="Leaderboard Builder" backHref="/commander/dashboard?card=displays">
            <SEOHead
                title="Commander - Leaderboard Builder"
                description="Club Commander Poker Room Management Tool."
                noindex={true}
            />
            <div style={{ minHeight: '100vh', background: '#0a0a1a', padding: '20px', fontFamily: 'Inter, sans-serif', color: 'white' }}>
                {/* Toast */}
                {toast && (
                    <div style={{ position: 'fixed', top: 80, right: 20, zIndex: 999, padding: '12px 20px', borderRadius: '10px', background: toast.type === 'error' ? '#EF4444' : '#31A24C', color: 'white', fontWeight: 600, fontSize: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
                        {toast.msg}
                    </div>
                )}

                {/* HEADER */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <div>
                        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Leaderboard Builder</h1>
                        <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: '4px 0 0' }}>Create And Manage Custom Leaderboards For The TV Display</p>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button onClick={() => setShowCreate(!showCreate)} style={{ ...s.btn, background: '#1877F2', color: 'white' }}>
                            {showCreate ? '✕ Cancel' : '+ Create Board'}
                        </button>
                        <a href="/commander/displays/leaderboard" target="_blank" rel="noopener" style={{ ...s.btn, background: 'rgba(255,255,255,0.1)', color: 'white', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            Preview Display
                        </a>
                    </div>
                </div>

                {/* CREATE FORM */}
                {showCreate && (
                    <div style={{ ...s.card, border: '2px solid #1877F2' }}>
                        <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>Create New Leaderboard</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <div>
                                <label style={s.label}>Board Name *</label>
                                <input style={s.input} placeholder="E.g. February Points Race" value={newBoard.name} onChange={e => setNewBoard({ ...newBoard, name: e.target.value })} />
                            </div>
                            <div>
                                <label style={s.label}>Board Type</label>
                                <select style={s.select} value={newBoard.leaderboard_type} onChange={e => setNewBoard({ ...newBoard, leaderboard_type: e.target.value })}>
                                    {BOARD_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                                </select>
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={s.label}>Description</label>
                                <input style={s.input} placeholder="What Does This Leaderboard Track?" value={newBoard.description} onChange={e => setNewBoard({ ...newBoard, description: e.target.value })} />
                            </div>
                            <div>
                                <label style={s.label}>Period</label>
                                <select style={s.select} value={newBoard.period_type} onChange={e => setNewBoard({ ...newBoard, period_type: e.target.value })}>
                                    {PERIOD_TYPES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={s.label}>Status</label>
                                <select style={s.select} value={newBoard.status} onChange={e => setNewBoard({ ...newBoard, status: e.target.value })}>
                                    <option value="active">Active (Shows On Display)</option>
                                    <option value="upcoming">Upcoming (Hidden)</option>
                                    <option value="completed">Completed (Archived)</option>
                                </select>
                            </div>
                            <div>
                                <label style={s.label}>Start Date</label>
                                <input type="date" style={s.input} value={newBoard.start_date} onChange={e => setNewBoard({ ...newBoard, start_date: e.target.value })} />
                            </div>
                            <div>
                                <label style={s.label}>End Date</label>
                                <input type="date" style={s.input} value={newBoard.end_date} onChange={e => setNewBoard({ ...newBoard, end_date: e.target.value })} />
                            </div>
                            <div>
                                <label style={s.label}>Prizes (Optional)</label>
                                <input style={s.input} placeholder="E.g. 1st: $500, 2nd: $250" value={newBoard.prizes} onChange={e => setNewBoard({ ...newBoard, prizes: e.target.value })} />
                            </div>
                            <div>
                                <label style={s.label}>Rules (Optional)</label>
                                <input style={s.input} placeholder="E.g. Min 4 Hours Played To Qualify" value={newBoard.rules_description} onChange={e => setNewBoard({ ...newBoard, rules_description: e.target.value })} />
                            </div>
                        </div>

                        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button onClick={() => setShowCreate(false)} style={{ ...s.btn, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>Cancel</button>
                            <button onClick={handleCreate} style={{ ...s.btn, background: '#1877F2', color: 'white' }}>Create Board</button>
                        </div>
                    </div>
                )}

                {/* BOARD LIST */}
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '60px', color: 'rgba(255,255,255,0.3)' }}>Loading Boards...</div>
                ) : boards.length === 0 ? (
                    <div style={{ ...s.card, textAlign: 'center', padding: '60px' }}>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}></div>
                        <p style={{ fontSize: '18px', fontWeight: 600, color: 'rgba(255,255,255,0.4)' }}>No Custom Boards Yet</p>
                        <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.25)', maxWidth: '400px', margin: '8px auto 0' }}>Click "Create Board" To Build Your First Custom Leaderboard. It Will Automatically Appear On The TV Display.</p>
                    </div>
                ) : (
                    boards.map(board => {
                        const isExpanded = expandedId === board.id;
                        const boardEntries = entries[board.id] || [];
                        const typeInfo = BOARD_TYPES.find(t => t.value === board.leaderboard_type) || BOARD_TYPES[0];
                        const isActive = board.status === 'active';

                        return (
                            <div key={board.id} style={{ ...s.card, borderLeft: isActive ? '4px solid #31A24C' : '4px solid #64748B' }}>
                                {/* Board header */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => expandBoard(board.id)}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <span style={{ fontSize: '24px' }}>{typeInfo.icon}</span>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>{board.name}</h3>
                                                <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '99px', background: isActive ? 'rgba(49,162,76,0.15)' : 'rgba(100,116,139,0.15)', color: isActive ? '#31A24C' : '#64748B' }}>
                                                    {isActive ? 'ON DISPLAY' : board.status?.toUpperCase()}
                                                </span>
                                            </div>
                                            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', margin: '2px 0 0' }}>
                                                {typeInfo.label} • {board.period_type}{board.description ? ` • ${board.description}` : ''}
                                            </p>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <button onClick={e => { e.stopPropagation(); toggleStatus(board); }} style={{ ...s.btn, background: isActive ? 'rgba(239,68,68,0.15)' : 'rgba(49,162,76,0.15)', color: isActive ? '#EF4444' : '#31A24C', fontSize: '12px', padding: '6px 12px' }}>
                                            {isActive ? 'Deactivate' : 'Activate'}
                                        </button>
                                        <span style={{ fontSize: '18px', color: 'rgba(255,255,255,0.3)', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▼</span>
                                    </div>
                                </div>

                                {/* Expanded: entries + add form */}
                                {isExpanded && (
                                    <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '16px' }}>
                                        {/* Auto-calculate button for session-based types */}
                                        {['hours_played', 'sessions'].includes(board.leaderboard_type) && (
                                            <div style={{ marginBottom: '16px' }}>
                                                <button onClick={() => autoCalculate(board.id)} style={{ ...s.btn, background: 'rgba(99,102,241,0.15)', color: '#6366F1', fontSize: '12px' }}>
                                                    Auto-Calculate From Player Sessions
                                                </button>
                                                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)', marginLeft: '10px' }}>
                                                    Pulls Data From Player Session History
                                                </span>
                                            </div>
                                        )}

                                        {/* Entries table */}
                                        {boardEntries.length > 0 ? (
                                            <div style={{ marginBottom: '16px' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                    <thead>
                                                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                                            <th style={{ textAlign: 'left', padding: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>RANK</th>
                                                            <th style={{ textAlign: 'left', padding: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>PLAYER</th>
                                                            <th style={{ textAlign: 'right', padding: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>SCORE</th>
                                                            <th style={{ textAlign: 'right', padding: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>HOURS</th>
                                                            <th style={{ textAlign: 'right', padding: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>SESSIONS</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {boardEntries.map((e, i) => (
                                                            <tr key={e.id || i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                                                <td style={{ padding: '8px', color: i < 3 ? '#FFD700' : 'rgba(255,255,255,0.5)', fontWeight: 700 }}>{i + 1}</td>
                                                                <td style={{ padding: '8px', fontWeight: 600 }}>{e.player_name || e.profiles?.display_name || 'Player'}</td>
                                                                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#3B82F6' }}>{e.score || 0}</td>
                                                                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)' }}>{e.hours_played ? `${Number(e.hours_played).toFixed(1)}h` : '-'}</td>
                                                                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)' }}>{e.sessions_count || '-'}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ) : (
                                            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.25)', marginBottom: '16px' }}>No Entries Yet. Add Players Below Or Auto-Calculate.</p>
                                        )}

                                        {/* Add entry form */}
                                        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '14px', border: '1px solid rgba(255,255,255,0.12)' }}>
                                            <p style={{ fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: '10px' }}>+ ADD PLAYER ENTRY</p>
                                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: '10px', alignItems: 'end' }}>
                                                <div>
                                                    <label style={{ ...s.label, fontSize: '10px' }}>Player</label>
                                                    <select style={s.select} value={addEntry.player_id} onChange={e => setAddEntry({ ...addEntry, player_id: e.target.value })}>
                                                        <option value="">Select Player...</option>
                                                        {members.filter(m => m.membership_status === 'active').map(m => (
                                                            <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label style={{ ...s.label, fontSize: '10px' }}>Score/Points</label>
                                                    <input type="number" style={s.input} placeholder="0" value={addEntry.score} onChange={e => setAddEntry({ ...addEntry, score: e.target.value })} />
                                                </div>
                                                <div>
                                                    <label style={{ ...s.label, fontSize: '10px' }}>Hours</label>
                                                    <input type="number" step="0.1" style={s.input} placeholder="0" value={addEntry.hours_played} onChange={e => setAddEntry({ ...addEntry, hours_played: e.target.value })} />
                                                </div>
                                                <div>
                                                    <label style={{ ...s.label, fontSize: '10px' }}>Sessions</label>
                                                    <input type="number" style={s.input} placeholder="0" value={addEntry.sessions_count} onChange={e => setAddEntry({ ...addEntry, sessions_count: e.target.value })} />
                                                </div>
                                                <button onClick={() => handleAddEntry(board.id)} style={{ ...s.btn, background: '#1877F2', color: 'white', whiteSpace: 'nowrap' }}>+ Add</button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}

                {/* INFO SECTION */}
                <div style={{ ...s.card, marginTop: '24px', background: 'rgba(24,119,242,0.05)', border: '2px solid rgba(24,119,242,0.25)' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px' }}>How Leaderboards Work</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '13px', color: 'rgba(255,255,255,0.5)' }}>
                        <div>
                            <p style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>Custom Boards</p>
                            <p>Boards You Create Here Appear On The TV Display Automatically When Set To "Active". Add Players And Scores Manually.</p>
                        </div>
                        <div>
                            <p style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>Auto-Calculate</p>
                            <p>For Hours/Sessions Types, Click "Auto-Calculate" To Pull Data From Player Session History.</p>
                        </div>
                        <div>
                            <p style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>League Boards</p>
                            <p>League Standings From Commander → Leagues Also Appear On The Display Automatically.</p>
                        </div>
                        <div>
                            <p style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>Display Priority</p>
                            <p>Custom Boards Show First, Then League Standings, Then Auto-Generated Boards (Visits, Hours, VIP).</p>
                        </div>
                    </div>
                </div>
            </div>
        </CommanderLayout>
    );
}
