/**
 * Leagues & Free Rolls Management
 * /commander/leagues
 * Staff page for managing inter-club leagues, seasons, standings,
 * AND freeroll events with qualification tracking.
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Trophy, Plus, Users, Calendar, DollarSign, Loader2, ChevronDown, ChevronUp, Gift, Target, UserPlus, Trash2, Check, RefreshCw } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';
import { useConfirmAction } from "../../src/components/commander/shared/ConfirmModal";

/* ───────── Status colors ───────── */
const STATUS_COLORS = {
  active: { bg: 'bg-[#31A24C]/10', text: 'text-[#31A24C]' },
  completed: { bg: 'bg-[#64748B]/10', text: 'text-[#64748B]' },
  upcoming: { bg: 'bg-[#1877F2]/10', text: 'text-[#1877F2]' },
  qualifying: { bg: 'bg-[#1877F2]/10', text: 'text-[#1877F2]' },
  closed: { bg: 'bg-[#EF4444]/10', text: 'text-[#EF4444]' },
  running: { bg: 'bg-[#31A24C]/10', text: 'text-[#31A24C]' },
  cancelled: { bg: 'bg-[#64748B]/10', text: 'text-[#64748B]' } };

const QUAL_TYPES = [
  { value: 'cash_hours', label: 'Cash Game Hours' },
  { value: 'tournament_points', label: 'Tournament Points' },
  { value: 'custom', label: 'Custom Rules' },
  { value: 'open', label: 'Open (No Qualification)' },
];

const QUAL_PERIODS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'season', label: 'Season' },
  { value: 'custom', label: 'Custom' },
];

export default function LeaguesAndFreerollsManagement() {
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-leagues'); }, []);
  const router = useRouter();
  const [staff, setStaff] = useState(null);
  const [activeTab, setActiveTab] = useState('leagues');
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ── Leagues state ── */
  const [leagues, setLeagues] = useState([]);
  const [leaguesLoading, setLeaguesLoading] = useState(true);
  const [showCreateLeague, setShowCreateLeague] = useState(false);
  const [leagueExpandedId, setLeagueExpandedId] = useState(null);
  const [standings, setStandings] = useState({});
  const [leagueSubmitting, setLeagueSubmitting] = useState(false);
  const [leagueForm, setLeagueForm] = useState({
    name: '', description: '', scoring_system: 'points',
    season_start: '', season_end: '', prize_pool: ''
  });

  /* ── Freerolls state ── */
  const [freerolls, setFreerolls] = useState([]);
  const [freerollsLoading, setFreerollsLoading] = useState(true);
  const [showCreateFreeroll, setShowCreateFreeroll] = useState(false);
  const [freerollExpandedId, setFreerollExpandedId] = useState(null);
  const [qualifications, setQualifications] = useState({});
  const [freerollSubmitting, setFreerollSubmitting] = useState(false);
  const [showAddPlayer, setShowAddPlayer] = useState(null);
  const [addPlayerForm, setAddPlayerForm] = useState({ player_name: '', hours_logged: '', points_earned: '', custom_value: '', manually_added: true });
  const [syncingFreeroll, setSyncingFreeroll] = useState(null);
  const [freerollFilter, setFreerollFilter] = useState(null); // 'active' | 'qualified' | 'upcoming' | null
  const [freerollForm, setFreerollForm] = useState({
    name: '', description: '', qualification_type: 'cash_hours',
    qualification_threshold: '', qualification_period: 'weekly',
    qualification_min_stakes: '', qualification_rules_text: '',
    scheduled_date: '', prize_pool: '', prize_description: '', max_qualifiers: ''
  });

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  /* ── Auth ── */
  useEffect(() => {
    const stored = getStaffSession();
    if (!stored) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
    try {
      const s = JSON.parse(stored);
      if (!s.venue_id) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
      setStaff(s);
    } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
  }, []);

  /* ── Fetch leagues ── */
  const fetchLeagues = useCallback(async (signal) => {
    setLeaguesLoading(true);
    try {
      const res = await commanderFetch('/api/commander/leagues?limit=50', { ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) setLeagues(json.data?.leagues || []);
    } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
    finally { setLeaguesLoading(false); }
  }, []);

  /* ── Fetch freerolls ── */
  const fetchFreerolls = useCallback(async (signal) => {
    setFreerollsLoading(true);
    try {
      const res = await commanderFetch('/api/commander/freerolls?limit=50', { ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) setFreerolls(json.data?.freerolls || []);
    } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
    finally { setFreerollsLoading(false); }
  }, []);

  const fetchAll = useCallback(() => {
    fetchLeagues();
    fetchFreerolls();
  }, [fetchLeagues, fetchFreerolls]);

  useEffect(() => {
    if (staff) {
      const c = new AbortController();
      fetchLeagues(c.signal);
      fetchFreerolls(c.signal);
      return () => c.abort();
    }
  }, [staff, fetchLeagues, fetchFreerolls]);

  // Commander Data Bus — both BroadcastChannel (instant) + Supabase Realtime (cross-device)
  useCommanderSync(staff?.venue_id || '', fetchAll, { entities: ['settings'] });

  /* ── League standings ── */
  const fetchStandings = async (leagueId) => {
    try {
      const json = await commanderFetchJSON(`/api/commander/leagues/${leagueId}/standings`, {});
      if (json.success) {
        setStandings(prev => ({ ...prev, [leagueId]: json.data?.standings || [] }));
      }
    } catch (err) { console.warn(err); }
  setFreerollsLoading(false);
  };

  const handleLeagueExpand = (id) => {
    if (leagueExpandedId === id) { setLeagueExpandedId(null); }
    else { setLeagueExpandedId(id); if (!standings[id]) fetchStandings(id); }
  };

  /* ── Create league ── */
  const handleCreateLeague = async () => {
    if (!leagueForm.name.trim()) { showToast('error', 'League name required'); return; }
    setLeagueSubmitting(true);
    try {
      const body = {
        name: leagueForm.name.trim(),
        description: leagueForm.description.trim() || null,
        scoring_system: leagueForm.scoring_system,
        season_start: leagueForm.season_start || null,
        season_end: leagueForm.season_end || null,
        prize_pool: leagueForm.prize_pool ? parseFloat(leagueForm.prize_pool) : null,
        venues: [staff.venue_id],
        status: 'active'
      };
      const res = await commanderFetch('/api/commander/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success || json.data) {
        showToast('success', 'League created');
        setShowCreateLeague(false);
        setLeagueForm({ name: '', description: '', scoring_system: 'points', season_start: '', season_end: '', prize_pool: '' });
        fetchLeagues();
        broadcastChange('settings'); // notify other tabs
        busEmit.celebration('confetti');
      } else {
        showToast('error', json.error?.message || 'Failed to create');
      }
    } catch { showToast('error', 'Network error'); }
    finally { setLeagueSubmitting(false); }
  };

  /* ── Freeroll qualifications ── */
  const fetchQualifications = async (freerollId) => {
    try {
      const json = await commanderFetchJSON(`/api/commander/freerolls/${freerollId}/qualifications`, {});
      if (json.success) {
        setQualifications(prev => ({ ...prev, [freerollId]: json.data?.qualifications || [] }));
      }
    } catch (err) { console.warn(err); }
  };

  const handleFreerollExpand = (id) => {
    if (freerollExpandedId === id) { setFreerollExpandedId(null); }
    else { setFreerollExpandedId(id); if (!qualifications[id]) fetchQualifications(id); }
  };

  /* ── Create freeroll ── */
  const handleCreateFreeroll = async () => {
    if (!freerollForm.name.trim()) { showToast('error', 'Freeroll name required'); return; }
    setFreerollSubmitting(true);
    try {
      const body = {
        name: freerollForm.name.trim(),
        description: freerollForm.description.trim() || null,
        qualification_type: freerollForm.qualification_type,
        qualification_threshold: freerollForm.qualification_threshold ? parseFloat(freerollForm.qualification_threshold) : 0,
        qualification_period: freerollForm.qualification_period,
        qualification_min_stakes: freerollForm.qualification_min_stakes || null,
        qualification_rules_text: freerollForm.qualification_rules_text || null,
        scheduled_date: freerollForm.scheduled_date ? new Date(freerollForm.scheduled_date).toISOString() : null,
        prize_pool: freerollForm.prize_pool ? parseFloat(freerollForm.prize_pool) : 0,
        prize_description: freerollForm.prize_description || null,
        max_qualifiers: freerollForm.max_qualifiers ? parseInt(freerollForm.max_qualifiers) : null,
        status: 'upcoming'
      };
      const res = await commanderFetch('/api/commander/freerolls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success || json.data) {
        showToast('success', 'Freeroll created');
        setShowCreateFreeroll(false);
        setFreerollForm({
          name: '', description: '', qualification_type: 'cash_hours',
          qualification_threshold: '', qualification_period: 'weekly',
          qualification_min_stakes: '', qualification_rules_text: '',
          scheduled_date: '', prize_pool: '', prize_description: '', max_qualifiers: ''
        });
        fetchFreerolls();
        broadcastChange('settings'); // notify other tabs
        busEmit.celebration('confetti');
      } else {
        showToast('error', json.error?.message || 'Failed to create');
      }
    } catch { showToast('error', 'Network error'); }
    finally { setFreerollSubmitting(false); }
  };

  /* ── Add player qualification ── */
  const handleAddPlayer = async (freerollId) => {
    if (!addPlayerForm.player_name.trim()) { showToast('error', 'Player name required'); return; }
    try {
      const body = {
        player_name: addPlayerForm.player_name.trim(),
        hours_logged: addPlayerForm.hours_logged ? parseFloat(addPlayerForm.hours_logged) : 0,
        points_earned: addPlayerForm.points_earned ? parseInt(addPlayerForm.points_earned) : 0,
        custom_value: addPlayerForm.custom_value || null,
        manually_added: true,
        is_qualified: addPlayerForm.manually_added };
      const res = await commanderFetch(`/api/commander/freerolls/${freerollId}/qualifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        showToast('success', 'Player added');
        setShowAddPlayer(null);
        setAddPlayerForm({ player_name: '', hours_logged: '', points_earned: '', custom_value: '', manually_added: true });
        fetchQualifications(freerollId);
        broadcastChange('settings'); // notify other tabs
      } else {
        showToast('error', json.error?.message || 'Failed');
      }
    } catch { showToast('error', 'Network error'); }
  };

  /* ── Sync qualifications from player sessions ── */
  const handleSyncQualifications = async (freerollId) => {
    setSyncingFreeroll(freerollId);
    try {
      const res = await fetch('/api/cron/freeroll-qualification-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ freeroll_id: freerollId, manual: true })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        const synced = json.results?.[0];
        showToast('success', `Synced: ${synced?.players_processed || 0} players processed, ${synced?.players_qualified || 0} qualified`);
        fetchQualifications(freerollId);
        broadcastChange('settings'); // notify other tabs
      } else {
        showToast('error', json.error || 'Sync failed');
      }
    } catch { showToast('error', 'Network error during sync'); }
    finally { setSyncingFreeroll(null); }
  };

  /* ── Remove player qualification ── */
  const handleRemovePlayer = async (freerollId, playerId, playerName) => {
    if (!confirm(`Remove ${playerName || 'this player'} from qualifications?`)) return;
    try {
      const json = await commanderFetchJSON(`/api/commander/freerolls/${freerollId}/qualifications?player_id=${playerId}`, {
        method: 'DELETE'});
      if (json.success) {
        showToast('success', `${playerName || 'Player'} removed`);
        fetchQualifications(freerollId);
        broadcastChange('settings'); // notify other tabs
      } else {
        showToast('error', json.error?.message || 'Failed to remove');
      }
    } catch { showToast('error', 'Network error'); }
  };

  /* ── Loading state ── */
  if (!staff) {
    return (
      <div className="cmd-page flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
      </div>
    );
  }

  const isLoading = activeTab === 'leagues' ? leaguesLoading : freerollsLoading;

  return (
    <CommanderLayout title="Leagues & Free Rolls | Commander" backHref="/commander/dashboard?card=tournaments">
      <SEOHead title="Commander — Leagues & Free Rolls" description="Club Commander Poker Room Management Tool." noindex={true} />
      <div className="cmd-page">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#1877F2]/10 rounded-lg flex items-center justify-center">
                <Trophy className="w-5 h-5 text-[#1877F2]" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Leagues & Free Rolls</h1>
                <p className="text-sm text-[#64748B]">Manage leagues, seasons, and freeroll qualification</p>
              </div>
            </div>
          </div>

          {/* Tab Switcher */}
          <div className="flex gap-1 p-1 bg-[#0D192E] rounded-xl">
            <button
              onClick={() => setActiveTab('leagues')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'leagues'
                ? 'bg-[#1877F2] text-white shadow-lg shadow-[#1877F2]/20'
                : 'text-[#64748B] hover:text-white hover:bg-[#132240]'
                }`}
            >
              <Trophy className="w-4 h-4" /> Leagues
            </button>
            <button
              onClick={() => setActiveTab('freerolls')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'freerolls'
                ? 'bg-[#1877F2] text-white shadow-lg shadow-[#1877F2]/20'
                : 'text-[#64748B] hover:text-white hover:bg-[#132240]'
                }`}
            >
              <Gift className="w-4 h-4" /> Free Rolls
            </button>
          </div>

          {/* Toast */}
          {toast && (
            <div className={`p-3 rounded-lg text-sm font-medium ${toast.type === 'success'
              ? 'bg-[#10B981]/10 border border-[#10B981]/30 text-[#10B981]'
              : 'bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#EF4444]'
              }`}>
              {toast.msg}
            </div>
          )}

          {/* ═══════════════════════════════════════ */}
          {/* LEAGUES TAB                            */}
          {/* ═══════════════════════════════════════ */}
          {activeTab === 'leagues' && (
            <>
              {/* Create button */}
              <div className="flex justify-end">
                <button onClick={() => setShowCreateLeague(!showCreateLeague)}
                  className="flex items-center gap-2 px-4 py-2 cmd-btn cmd-btn-primary font-medium rounded-lg">
                  <Plus className="w-4 h-4" /> New League
                </button>
              </div>

              {/* Create Form */}
              {showCreateLeague && (
                <div className="cmd-panel p-4 border-[#1877F2]/30 space-y-3">
                  <h2 className="font-semibold text-white">Create New League</h2>
                  <input value={leagueForm.name} onChange={e => setLeagueForm({ ...leagueForm, name: e.target.value })}
                    placeholder="League Name *"
                    className="w-full px-3 py-2.5 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none" />
                  <textarea value={leagueForm.description} onChange={e => setLeagueForm({ ...leagueForm, description: e.target.value })}
                    placeholder="Description (optional)" rows={2}
                    className="w-full px-3 py-2.5 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none resize-vertical font-[inherit]" />
                  <div className="grid grid-cols-2 gap-3">
                    <select value={leagueForm.scoring_system} onChange={e => setLeagueForm({ ...leagueForm, scoring_system: e.target.value })}
                      className="px-3 py-2.5 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white focus:border-[#1877F2] focus:outline-none">
                      <option value="points">Points System</option>
                      <option value="bounty">Bounty System</option>
                      <option value="chips">Chip Count</option>
                      <option value="custom">Custom</option>
                    </select>
                    <input value={leagueForm.prize_pool} onChange={e => setLeagueForm({ ...leagueForm, prize_pool: e.target.value })}
                      placeholder="Prize Pool $" type="number"
                      className="px-3 py-2.5 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[#64748B] font-semibold block mb-1">Season Start</label>
                      <input type="date" value={leagueForm.season_start} onChange={e => setLeagueForm({ ...leagueForm, season_start: e.target.value })}
                        className="w-full px-3 py-2.5 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white focus:border-[#1877F2] focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-[#64748B] font-semibold block mb-1">Season End</label>
                      <input type="date" value={leagueForm.season_end} onChange={e => setLeagueForm({ ...leagueForm, season_end: e.target.value })}
                        className="w-full px-3 py-2.5 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white focus:border-[#1877F2] focus:outline-none" />
                    </div>
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setShowCreateLeague(false)}
                      className="flex-1 py-2.5 border border-[#4A5E78] rounded-lg text-[#94A3B8] font-medium hover:bg-[#132240] transition-colors">
                      Cancel
                    </button>
                    <button onClick={handleCreateLeague} disabled={leagueSubmitting}
                      className="flex-[2] py-2.5 cmd-btn cmd-btn-primary rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                      {leagueSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create League
                    </button>
                  </div>
                </div>
              )}

              {/* Leagues List */}
              {leaguesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-[#1877F2]" />
                </div>
              ) : leagues.length === 0 ? (
                <div className="cmd-panel p-8 text-center">
                  <Trophy className="w-12 h-12 text-[#4A5E78] mx-auto mb-3" />
                  <p className="text-[#64748B] mb-4">No leagues created yet. Tap "New League" to get started.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {leagues.map(league => {
                    const isExpanded = leagueExpandedId === league.id;
                    const sc = STATUS_COLORS[league.status] || STATUS_COLORS.upcoming;
                    const leagueStandings = standings[league.id] || [];
                    return (
                      <div key={league.id} className="cmd-panel overflow-hidden">
                        <button onClick={() => handleLeagueExpand(league.id)}
                          className="w-full p-4 flex items-center gap-3 text-left hover:bg-[#132240] transition-colors">
                          <div className="w-10 h-10 rounded-xl bg-[#1877F2]/10 flex items-center justify-center flex-shrink-0">
                            <Trophy className="w-5 h-5 text-[#1877F2]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-white truncate">{league.name}</p>
                            <div className="flex items-center gap-3 mt-0.5 text-xs text-[#64748B]">
                              <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {league.player_count || 0} players</span>
                              {league.prize_pool > 0 && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> ${league.prize_pool}</span>}
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${sc.bg} ${sc.text}`}>{league.status}</span>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-[#64748B]" /> : <ChevronDown className="w-4 h-4 text-[#64748B]" />}
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-4 border-t border-[#1E3A5F]">
                            {league.description && (
                              <p className="text-sm text-[#94A3B8] mt-3 leading-relaxed">{league.description}</p>
                            )}
                            <div className="grid grid-cols-3 gap-2 mt-3">
                              <div className="bg-[#0D192E] rounded-lg p-3 text-center">
                                <p className="text-[10px] text-[#64748B] font-semibold uppercase">Scoring</p>
                                <p className="text-sm font-bold text-white capitalize">{league.scoring_system || 'Points'}</p>
                              </div>
                              <div className="bg-[#0D192E] rounded-lg p-3 text-center">
                                <p className="text-[10px] text-[#64748B] font-semibold uppercase">Start</p>
                                <p className="text-sm font-bold text-white">
                                  {league.season_start ? new Date(league.season_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD'}
                                </p>
                              </div>
                              <div className="bg-[#0D192E] rounded-lg p-3 text-center">
                                <p className="text-[10px] text-[#64748B] font-semibold uppercase">End</p>
                                <p className="text-sm font-bold text-white">
                                  {league.season_end ? new Date(league.season_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD'}
                                </p>
                              </div>
                            </div>
                            {leagueStandings.length > 0 ? (
                              <div className="mt-3">
                                <p className="text-xs text-[#64748B] font-semibold uppercase tracking-wider mb-2">Standings</p>
                                <div className="space-y-1">
                                  {leagueStandings.slice(0, 10).map((s, i) => (
                                    <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${i < 3 ? 'bg-[#1877F2]/5 border border-[#1877F2]/20' : 'bg-[#0D192E]'}`}>
                                      <span className={`font-bold text-base min-w-[24px] ${i === 0 ? 'text-[#1877F2]' : i === 1 ? 'text-[#94A3B8]' : i === 2 ? 'text-[#CD7F32]' : 'text-[#64748B]'}`}>
                                        {i + 1}
                                      </span>
                                      <span className="flex-1 font-medium text-white">{s.player_name || s.display_name || 'Player'}</span>
                                      <span className="font-bold text-[#1877F2]">{s.points || s.total_points || 0} pts</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="mt-3 p-4 text-center text-[#64748B] text-sm bg-[#0D192E] rounded-lg">
                                No standings yet -- players join via the app
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ═══════════════════════════════════════ */}
          {/* FREE ROLLS TAB                         */}
          {/* ═══════════════════════════════════════ */}
          {activeTab === 'freerolls' && (
            <>
              {/* Stats Row — clickable filters */}
              <div className="grid grid-cols-3 gap-3">
                <button onClick={() => setFreerollFilter(freerollFilter === 'active' ? null : 'active')}
                  className={`cmd-panel p-3 text-center transition-all cursor-pointer hover:bg-[#132240] ${freerollFilter === 'active' ? 'ring-2 ring-[#1877F2] bg-[#1877F2]/5' : ''}`}>
                  <Gift className="w-5 h-5 text-[#1877F2] mx-auto mb-1" />
                  <p className="text-2xl font-bold text-white">{freerolls.filter(f => ['qualifying', 'running'].includes(f.status)).length}</p>
                  <p className="text-[10px] text-[#64748B] font-semibold uppercase">Active</p>
                </button>
                <button onClick={() => setFreerollFilter(freerollFilter === 'qualified' ? null : 'qualified')}
                  className={`cmd-panel p-3 text-center transition-all cursor-pointer hover:bg-[#132240] ${freerollFilter === 'qualified' ? 'ring-2 ring-[#31A24C] bg-[#31A24C]/5' : ''}`}>
                  <Users className="w-5 h-5 text-[#31A24C] mx-auto mb-1" />
                  <p className="text-2xl font-bold text-white">{freerolls.reduce((s, f) => s + (f.qualified_count || 0), 0)}</p>
                  <p className="text-[10px] text-[#64748B] font-semibold uppercase">Qualified</p>
                </button>
                <button onClick={() => setFreerollFilter(freerollFilter === 'upcoming' ? null : 'upcoming')}
                  className={`cmd-panel p-3 text-center transition-all cursor-pointer hover:bg-[#132240] ${freerollFilter === 'upcoming' ? 'ring-2 ring-[#1877F2] bg-[#1877F2]/5' : ''}`}>
                  <Calendar className="w-5 h-5 text-[#1877F2] mx-auto mb-1" />
                  <p className="text-2xl font-bold text-white">{freerolls.filter(f => f.status === 'upcoming').length}</p>
                  <p className="text-[10px] text-[#64748B] font-semibold uppercase">Upcoming</p>
                </button>
              </div>

              {/* Active filter indicator */}
              {freerollFilter && (
                <div className="flex items-center justify-between px-3 py-2 bg-[#0D192E] rounded-lg border border-[#1E3A5F]">
                  <span className="text-xs text-[#94A3B8]">Showing: <strong className="text-white capitalize">{freerollFilter}</strong> freerolls</span>
                  <button onClick={() => setFreerollFilter(null)} className="text-xs text-[#64748B] hover:text-white">Clear</button>
                </div>
              )}

              {/* Create button */}
              <div className="flex justify-end">
                <button onClick={() => setShowCreateFreeroll(!showCreateFreeroll)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#1877F2] text-white font-semibold rounded-lg hover:bg-[#1565D0] transition-colors">
                  <Plus className="w-4 h-4" /> New Free Roll
                </button>
              </div>

              {/* Create Freeroll Form */}
              {showCreateFreeroll && (
                <div className="cmd-panel p-4 border-[#1877F2]/30 space-y-3">
                  <h2 className="font-semibold text-white">Create New Free Roll</h2>

                  <input value={freerollForm.name} onChange={e => setFreerollForm({ ...freerollForm, name: e.target.value })}
                    placeholder="Free Roll Name *"
                    className="w-full px-3 py-2.5 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none" />

                  <textarea value={freerollForm.description} onChange={e => setFreerollForm({ ...freerollForm, description: e.target.value })}
                    placeholder="Description (optional)" rows={2}
                    className="w-full px-3 py-2.5 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none resize-vertical font-[inherit]" />

                  {/* Qualification Rules */}
                  <div className="p-3 bg-[#0D192E] rounded-lg border border-[#1E3A5F] space-y-3">
                    <p className="text-xs text-[#1877F2] font-semibold uppercase tracking-wider">Qualification Rules</p>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-[#64748B] font-semibold block mb-1">Qualification Type</label>
                        <select value={freerollForm.qualification_type}
                          onChange={e => setFreerollForm({ ...freerollForm, qualification_type: e.target.value })}
                          className="w-full px-3 py-2.5 bg-[#0A1628] border border-[#1E3A5F] rounded-lg text-white focus:border-[#1877F2] focus:outline-none">
                          {QUAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-[#64748B] font-semibold block mb-1">Period</label>
                        <select value={freerollForm.qualification_period}
                          onChange={e => setFreerollForm({ ...freerollForm, qualification_period: e.target.value })}
                          className="w-full px-3 py-2.5 bg-[#0A1628] border border-[#1E3A5F] rounded-lg text-white focus:border-[#1877F2] focus:outline-none">
                          {QUAL_PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                      </div>
                    </div>

                    {freerollForm.qualification_type !== 'open' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-[#64748B] font-semibold block mb-1">
                            {freerollForm.qualification_type === 'cash_hours' ? 'Hours Required' :
                              freerollForm.qualification_type === 'tournament_points' ? 'Points Required' : 'Threshold'}
                          </label>
                          <input type="number" value={freerollForm.qualification_threshold}
                            onChange={e => setFreerollForm({ ...freerollForm, qualification_threshold: e.target.value })}
                            placeholder={freerollForm.qualification_type === 'cash_hours' ? 'e.g. 20' : 'e.g. 100'}
                            className="w-full px-3 py-2.5 bg-[#0A1628] border border-[#1E3A5F] rounded-lg text-white placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none" />
                        </div>
                        <div>
                          <label className="text-xs text-[#64748B] font-semibold block mb-1">Min Stakes</label>
                          <input value={freerollForm.qualification_min_stakes}
                            onChange={e => setFreerollForm({ ...freerollForm, qualification_min_stakes: e.target.value })}
                            placeholder="e.g. 1/3"
                            className="w-full px-3 py-2.5 bg-[#0A1628] border border-[#1E3A5F] rounded-lg text-white placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none" />
                        </div>
                      </div>
                    )}

                    {freerollForm.qualification_type === 'custom' && (
                      <textarea value={freerollForm.qualification_rules_text}
                        onChange={e => setFreerollForm({ ...freerollForm, qualification_rules_text: e.target.value })}
                        placeholder="Describe custom qualification rules..."
                        rows={2}
                        className="w-full px-3 py-2.5 bg-[#0A1628] border border-[#1E3A5F] rounded-lg text-white placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none resize-vertical font-[inherit]" />
                    )}
                  </div>

                  {/* Event details */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[#64748B] font-semibold block mb-1">Event Date</label>
                      <input type="datetime-local" value={freerollForm.scheduled_date}
                        onChange={e => setFreerollForm({ ...freerollForm, scheduled_date: e.target.value })}
                        className="w-full px-3 py-2.5 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white focus:border-[#1877F2] focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-[#64748B] font-semibold block mb-1">Prize Pool $</label>
                      <input type="number" value={freerollForm.prize_pool}
                        onChange={e => setFreerollForm({ ...freerollForm, prize_pool: e.target.value })}
                        placeholder="500"
                        className="w-full px-3 py-2.5 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <input value={freerollForm.prize_description}
                      onChange={e => setFreerollForm({ ...freerollForm, prize_description: e.target.value })}
                      placeholder="Prize description (optional)"
                      className="px-3 py-2.5 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none" />
                    <input type="number" value={freerollForm.max_qualifiers}
                      onChange={e => setFreerollForm({ ...freerollForm, max_qualifiers: e.target.value })}
                      placeholder="Max qualifiers"
                      className="px-3 py-2.5 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none" />
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setShowCreateFreeroll(false)}
                      className="flex-1 py-2.5 border border-[#4A5E78] rounded-lg text-[#94A3B8] font-medium hover:bg-[#132240] transition-colors">
                      Cancel
                    </button>
                    <button onClick={handleCreateFreeroll} disabled={freerollSubmitting}
                      className="flex-[2] py-2.5 bg-[#1877F2] text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-[#1565D0] transition-colors">
                      {freerollSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create Free Roll
                    </button>
                  </div>
                </div>
              )}

              {/* Freerolls List */}
              {freerollsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-[#1877F2]" />
                </div>
              ) : freerolls.length === 0 ? (
                <div className="cmd-panel p-8 text-center">
                  <Gift className="w-12 h-12 text-[#4A5E78] mx-auto mb-3" />
                  <p className="text-[#64748B] mb-2">No freerolls created yet.</p>
                  <p className="text-xs text-[#4A5E78]">Create a freeroll to start tracking player qualification by cash game hours, tournament points, or custom rules.</p>
                </div>
              ) : (() => {
                const filteredFreerolls = freerollFilter === 'active'
                  ? freerolls.filter(f => ['qualifying', 'running'].includes(f.status))
                  : freerollFilter === 'upcoming'
                    ? freerolls.filter(f => f.status === 'upcoming')
                    : freerollFilter === 'qualified'
                      ? freerolls.filter(f => (f.qualified_count || 0) > 0)
                      : freerolls;

                return filteredFreerolls.length === 0 ? (
                  <div className="cmd-panel p-8 text-center">
                    <Gift className="w-12 h-12 text-[#4A5E78] mx-auto mb-3" />
                    <p className="text-[#64748B] mb-2">No {freerollFilter} freerolls found.</p>
                    <button onClick={() => setFreerollFilter(null)} className="text-xs text-[#1877F2] hover:underline">Show all</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredFreerolls.map(fr => {
                      const isExpanded = freerollExpandedId === fr.id;
                      const sc = STATUS_COLORS[fr.status] || STATUS_COLORS.upcoming;
                      const frQuals = qualifications[fr.id] || [];
                      const qualLabel = QUAL_TYPES.find(t => t.value === fr.qualification_type)?.label || fr.qualification_type;

                      return (
                        <div key={fr.id} className="cmd-panel overflow-hidden">
                          <button onClick={() => handleFreerollExpand(fr.id)}
                            className="w-full p-4 flex items-center gap-3 text-left hover:bg-[#132240] transition-colors">
                            <div className="w-10 h-10 rounded-xl bg-[#1877F2]/10 flex items-center justify-center flex-shrink-0">
                              <Gift className="w-5 h-5 text-[#1877F2]" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-white truncate">{fr.name}</p>
                              <div className="flex items-center gap-3 mt-0.5 text-xs text-[#64748B]">
                                <span className="flex items-center gap-1"><Target className="w-3 h-3" /> {qualLabel}</span>
                                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {fr.qualified_count || 0} qualified</span>
                                {fr.prize_pool > 0 && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> ${fr.prize_pool}</span>}
                              </div>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${sc.bg} ${sc.text}`}>{fr.status}</span>
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-[#64748B]" /> : <ChevronDown className="w-4 h-4 text-[#64748B]" />}
                          </button>

                          {isExpanded && (
                            <div className="px-4 pb-4 border-t border-[#1E3A5F]">
                              {fr.description && (
                                <p className="text-sm text-[#94A3B8] mt-3 leading-relaxed">{fr.description}</p>
                              )}

                              {/* Rules summary */}
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                                <div className="bg-[#0D192E] rounded-lg p-3 text-center">
                                  <p className="text-[10px] text-[#64748B] font-semibold uppercase">Type</p>
                                  <p className="text-xs font-bold text-[#1877F2]">{qualLabel}</p>
                                </div>
                                <div className="bg-[#0D192E] rounded-lg p-3 text-center">
                                  <p className="text-[10px] text-[#64748B] font-semibold uppercase">Threshold</p>
                                  <p className="text-sm font-bold text-white">
                                    {fr.qualification_type === 'open' ? 'Open' :
                                      fr.qualification_type === 'cash_hours' ? `${fr.qualification_threshold || 0}h` :
                                        fr.qualification_type === 'tournament_points' ? `${fr.qualification_threshold || 0} pts` :
                                          fr.qualification_threshold || 'Custom'}
                                  </p>
                                </div>
                                <div className="bg-[#0D192E] rounded-lg p-3 text-center">
                                  <p className="text-[10px] text-[#64748B] font-semibold uppercase">Period</p>
                                  <p className="text-sm font-bold text-white capitalize">{fr.qualification_period || 'N/A'}</p>
                                </div>
                                <div className="bg-[#0D192E] rounded-lg p-3 text-center">
                                  <p className="text-[10px] text-[#64748B] font-semibold uppercase">Date</p>
                                  <p className="text-sm font-bold text-white">
                                    {fr.scheduled_date ? new Date(fr.scheduled_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD'}
                                  </p>
                                </div>
                              </div>

                              {fr.qualification_rules_text && (
                                <div className="mt-2 p-2 bg-[#0D192E]/50 rounded-lg text-xs text-[#94A3B8] italic">
                                  {fr.qualification_rules_text}
                                </div>
                              )}

                              {/* Qualifications table */}
                              <div className="mt-4">
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-xs text-[#64748B] font-semibold uppercase tracking-wider">
                                    Player Qualifications ({frQuals.length})
                                  </p>
                                  <div className="flex items-center gap-2">
                                    {(fr.qualification_type === 'cash_hours' || fr.qualification_type === 'tournament_points') && (
                                      <button
                                        onClick={() => handleSyncQualifications(fr.id)}
                                        disabled={syncingFreeroll === fr.id}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-[#1877F2]/10 text-[#1877F2] text-xs font-semibold rounded-lg hover:bg-[#1877F2]/20 transition-colors disabled:opacity-50">
                                        <RefreshCw className={`w-3.5 h-3.5 ${syncingFreeroll === fr.id ? 'animate-spin' : ''}`} />
                                        {syncingFreeroll === fr.id ? 'Syncing...' : 'Sync Qualifications'}
                                      </button>
                                    )}
                                    <button onClick={() => setShowAddPlayer(showAddPlayer === fr.id ? null : fr.id)}
                                      className="flex items-center gap-1 px-3 py-1.5 bg-[#1877F2]/10 text-[#1877F2] text-xs font-semibold rounded-lg hover:bg-[#1877F2]/20 transition-colors">
                                      <UserPlus className="w-3.5 h-3.5" /> Add Player
                                    </button>
                                  </div>
                                </div>

                                {/* Add Player Form */}
                                {showAddPlayer === fr.id && (
                                  <div className="mb-3 p-3 bg-[#0A1628] rounded-lg border border-[#1877F2]/20 space-y-2">
                                    <input value={addPlayerForm.player_name}
                                      onChange={e => setAddPlayerForm({ ...addPlayerForm, player_name: e.target.value })}
                                      placeholder="Player Name *"
                                      className="w-full px-3 py-2 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white text-sm placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none" />
                                    <div className="grid grid-cols-2 gap-2">
                                      {(fr.qualification_type === 'cash_hours' || fr.qualification_type === 'custom') && (
                                        <input type="number" step="0.5" value={addPlayerForm.hours_logged}
                                          onChange={e => setAddPlayerForm({ ...addPlayerForm, hours_logged: e.target.value })}
                                          placeholder="Hours logged"
                                          className="px-3 py-2 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white text-sm placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none" />
                                      )}
                                      {(fr.qualification_type === 'tournament_points' || fr.qualification_type === 'custom') && (
                                        <input type="number" value={addPlayerForm.points_earned}
                                          onChange={e => setAddPlayerForm({ ...addPlayerForm, points_earned: e.target.value })}
                                          placeholder="Points earned"
                                          className="px-3 py-2 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white text-sm placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none" />
                                      )}
                                    </div>
                                    {fr.qualification_type === 'custom' && (
                                      <input value={addPlayerForm.custom_value}
                                        onChange={e => setAddPlayerForm({ ...addPlayerForm, custom_value: e.target.value })}
                                        placeholder="Custom qualification value"
                                        className="w-full px-3 py-2 bg-[#0D192E] border border-[#1E3A5F] rounded-lg text-white text-sm placeholder-[#4A5E78] focus:border-[#1877F2] focus:outline-none" />
                                    )}
                                    <div className="flex items-center gap-2">
                                      <label className="flex items-center gap-2 text-xs text-[#94A3B8] cursor-pointer">
                                        <input type="checkbox" checked={addPlayerForm.manually_added}
                                          onChange={e => setAddPlayerForm({ ...addPlayerForm, manually_added: e.target.checked })}
                                          className="w-4 h-4 rounded border-[#1E3A5F] bg-[#0D192E] text-[#1877F2] focus:ring-[#1877F2]" />
                                        Auto-qualify (skip threshold)
                                      </label>
                                    </div>
                                    <div className="flex gap-2">
                                      <button onClick={() => setShowAddPlayer(null)}
                                        className="px-3 py-1.5 text-xs text-[#64748B] border border-[#4A5E78] rounded-lg hover:bg-[#132240]">Cancel</button>
                                      <button onClick={() => handleAddPlayer(fr.id)}
                                        className="px-4 py-1.5 text-xs bg-[#1877F2] text-white font-semibold rounded-lg hover:bg-[#1565D0]">Add</button>
                                    </div>
                                  </div>
                                )}

                                {/* Qualifications list */}
                                {frQuals.length > 0 ? (
                                  <div className="space-y-1">
                                    {frQuals.map((q, i) => {
                                      const progressValue = fr.qualification_type === 'cash_hours' ? (q.hours_logged || 0)
                                        : fr.qualification_type === 'tournament_points' ? (q.points_earned || 0)
                                          : (q.hours_logged || q.points_earned || 0);
                                      const progress = fr.qualification_threshold > 0
                                        ? Math.min(100, (progressValue / fr.qualification_threshold) * 100)
                                        : (q.is_qualified ? 100 : 0);

                                      return (
                                        <div key={q.id || i} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${q.is_qualified ? 'bg-[#31A24C]/5 border border-[#31A24C]/20' : 'bg-[#0D192E]'
                                          }`}>
                                          <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${q.is_qualified ? 'bg-[#31A24C]/20' : 'bg-[#1E3A5F]'
                                            }`}>
                                            {q.is_qualified
                                              ? <Check className="w-3.5 h-3.5 text-[#31A24C]" />
                                              : <span className="text-[10px] font-bold text-[#64748B]">{i + 1}</span>
                                            }
                                          </span>

                                          <div className="flex-1 min-w-0">
                                            <p className="font-medium text-white text-sm truncate">
                                              {q.player_name || 'Unknown Player'}
                                              {q.manually_added && <span className="ml-1 text-[10px] text-[#1877F2]">(manual)</span>}
                                            </p>
                                            {fr.qualification_threshold > 0 && (
                                              <div className="mt-1 flex items-center gap-2">
                                                <div className="flex-1 h-1.5 bg-[#1E3A5F] rounded-full overflow-hidden">
                                                  <div className="h-full rounded-full transition-all duration-500"
                                                    style={{
                                                      width: `${progress}%`,
                                                      background: progress >= 100 ? '#31A24C' : '#1877F2'
                                                    }} />
                                                </div>
                                                <span className="text-[10px] text-[#64748B] font-mono whitespace-nowrap">
                                                  {fr.qualification_type === 'cash_hours'
                                                    ? `${q.hours_logged || 0}/${fr.qualification_threshold}h`
                                                    : fr.qualification_type === 'tournament_points'
                                                      ? `${q.points_earned || 0}/${fr.qualification_threshold} pts`
                                                      : fr.qualification_type === 'custom'
                                                        ? (q.custom_value || `${q.hours_logged || q.points_earned || 0}/${fr.qualification_threshold}`)
                                                        : `${q.hours_logged || 0}/${fr.qualification_threshold}`
                                                  }
                                                </span>
                                              </div>
                                            )}
                                          </div>

                                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${q.is_qualified
                                            ? 'bg-[#31A24C]/10 text-[#31A24C]'
                                            : 'bg-[#1877F2]/10 text-[#1877F2]'
                                            }`}>
                                            {q.is_qualified ? 'Qualified' : 'In Progress'}
                                          </span>

                                          {q.player_id && (
                                            <button onClick={() => handleRemovePlayer(fr.id, q.player_id, q.player_name)}
                                              className="p-1 rounded hover:bg-[#EF4444]/10 text-[#64748B] hover:text-[#EF4444] transition-colors ml-1"
                                              title="Remove player">
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="p-4 text-center text-[#64748B] text-sm bg-[#0D192E] rounded-lg">
                                    {(fr.qualification_type === 'cash_hours' || fr.qualification_type === 'tournament_points')
                                      ? 'No players tracked yet — tap "Sync Qualifications" to auto-pull from player sessions'
                                      : 'No players tracked yet — use "Add Player" to start tracking qualification'}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    
      <ConfirmDialog />
    </CommanderLayout>
  );
}
