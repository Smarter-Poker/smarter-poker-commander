/**
 * Daily Presets Page
 * /commander/room-presets
 * One-click day launcher: opens tables, activates promotions, creates tournaments
 * Also includes Hard Stop controls and Hourly Comp Rate
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import {
  Plus, Save, Trash2, Edit2, Play, X, Loader2, CheckCircle, AlertCircle,
  Layout, Clock, Calendar, Trophy, Gift,
  StopCircle, AlertTriangle, DollarSign
} from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { hasFeature } from '../../src/lib/commander/tierConfig';
import { busEmit } from '../../src/engine/EventBus';
import { getToken, getStaffSession, getStaffData } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';
import { useConfirmAction } from "../../src/components/commander/shared/ConfirmModal";

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function DailyPresetsPage() {
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-room-presets'); }, []);
  const router = useRouter();
  const [presets, setPresets] = useState([]);
  const [gameTypes, setGameTypes] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [staff, setStaff] = useState(null);
  const [venueName, setVenueName] = useState('');
  const [currentTier, setCurrentTier] = useState('home_game');

  // Hard Stop state
  const [hardStopEnabled, setHardStopEnabled] = useState(false);
  const [hardStopTime, setHardStopTime] = useState('23:00');
  const [hardStopSaving, setHardStopSaving] = useState(false);
  const [hardStopSuccess, setHardStopSuccess] = useState(null);
  const [hardStopDirty, setHardStopDirty] = useState(false);

  // Auto Comp state
  const [autoCompRate, setAutoCompRate] = useState(0);
  const [autoCompSaving, setAutoCompSaving] = useState(false);
  const [autoCompSuccess, setAutoCompSuccess] = useState(null);
  const [autoCompDirty, setAutoCompDirty] = useState(false);

  // Form state — now includes promotions, tournaments, and schedule
  const [form, setForm] = useState({
    name: '', description: '',
    tables: [],
    promotions: [],
    tournaments: [],
    start_time: '',
    day_of_week: []
  });

  useEffect(() => {
    const stored = getStaffSession();
    if (!stored) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
    try {
      const s = JSON.parse(stored);
      if (!s.venue_id) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
      setStaff(s);
      setVenueName(s.venue_name || '');
    } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
    try {
      const sub = JSON.parse(localStorage.getItem('commander_subscription') || '{}');
      if (sub.tier) setCurrentTier(sub.tier);
    } catch (e) { console.warn("[room-presets.js]", e); }
  }, [router]);

  // Fetch hard stop settings
  useEffect(() => {
    if (!staff) return;
    try {
      commanderFetch('/api/commander/settings', {})
        .then(r => r.json())
        .then(data => {
          if (data?.data) {
            setHardStopEnabled(data.data.hard_stop_enabled || false);
            setHardStopTime(data.data.hard_stop_time || '23:00');
            setAutoCompRate(parseFloat(data.data.auto_comp_rate) || 0);
          }
        })
        .catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    } catch (e) { console.warn("[room-presets.js]", e); }
  }, [staff]);

  async function handleHardStopSave() {
    setHardStopSaving(true);
    try {
      const token = getToken();
      if (!token) return;
const res = await commanderFetch('/api/commander/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hard_stop_enabled: hardStopEnabled, hard_stop_time: hardStopTime })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setHardStopDirty(false);
          setHardStopSuccess('Hard Stop settings saved');
          broadcastChange('settings');
          setTimeout(() => setHardStopSuccess(null), 3000);
        }
      }
    } catch (e) { console.warn("[room-presets.js]", e); setError('Action failed. Please check your connection and try again.'); }
    finally { setHardStopSaving(false); }
  }

  async function handleAutoCompSave() {
    setAutoCompSaving(true);
    try {
      const token = getToken();
      if (!token) return;
const res = await commanderFetch('/api/commander/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_comp_rate: autoCompRate })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setAutoCompDirty(false);
          setAutoCompSuccess('Hourly comp rate saved');
          broadcastChange('settings');
          setTimeout(() => setAutoCompSuccess(null), 3000);
        }
      }
    } catch (e) { console.warn("[room-presets.js]", e); setError('Action failed. Please check your connection and try again.'); }
    finally { setAutoCompSaving(false); }
  }

  const fetchData = useCallback(async () => {
    try {
      const stored = getStaffData();
      const venueId = stored.venue_id;
      const safeJson = (r) => (r && typeof r.json === 'function') ? r.json().catch(() => ({})) : Promise.resolve({});
      const [presetsRes, typesRes, promosRes] = await Promise.all([
        commanderFetch(`/api/commander/room-presets?venue_id=${venueId}`).catch(() => null),
        commanderFetch(`/api/commander/game-types?venue_id=${venueId}`).catch(() => null),
        commanderFetch(`/api/commander/promotions?venue_id=${venueId}&status=all`).catch(() => null)
      ]);
      const [presetsJson, typesJson, promosJson] = await Promise.all([
        safeJson(presetsRes), safeJson(typesRes), safeJson(promosRes)
      ]);
      if (presetsJson.success) setPresets(presetsJson.data || []);
      if (typesJson.success) setGameTypes(typesJson.data || []);
      if (promosJson.success) setPromotions(promosJson.data?.promotions || []);
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (staff) fetchData(); }, [staff, fetchData]);

  // Commander Data Bus — sync settings/tables across tabs
  const venueId = staff?.venue_id || '';
  useCommanderSync(venueId, fetchData, { entities: ['settings', 'tables', 'tournaments'] });

  async function handleApply(preset) {
    const tableCount = getTotalTables(preset.tables);
    const promoCount = (preset.promotions || []).length;
    const tourneyCount = (preset.tournaments || []).length;
    const parts = [];
    if (tableCount > 0) parts.push(`${tableCount} table${tableCount !== 1 ? 's' : ''}`);
    if (promoCount > 0) parts.push(`${promoCount} promotion${promoCount !== 1 ? 's' : ''}`);
    if (tourneyCount > 0) parts.push(`${tourneyCount} tournament${tourneyCount !== 1 ? 's' : ''}`);

    if (!confirm(`Launch "${preset.name}"?\n\nThis will activate: ${parts.join(', ') || 'nothing configured'}`)) return;
    setApplying(preset.id);
    setError(null);
    try {
      const res = await commanderFetch(`/api/commander/room-presets?id=${preset.id}&action=apply`, {
        method: 'POST'});
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          const results = [];
          if (json.data.games_opened > 0) results.push(`${json.data.games_opened} games opened`);
          if (json.data.promotions_activated > 0) results.push(`${json.data.promotions_activated} promotions activated`);
          if (json.data.tournaments_created > 0) results.push(`${json.data.tournaments_created} tournaments created`);
          setSuccess(`"${preset.name}" launched — ${results.join(', ') || 'preset applied'}`);
          setTimeout(() => setSuccess(null), 5000);
          fetchData();
          broadcastChange('tables');
          broadcastChange('games');
          broadcastChange('tournaments');
          broadcastChange('settings');
        } else {
          setError(json.error || 'Failed to apply preset');
        }
      } else {
        setError('Failed to apply preset');
      }
    } catch { setError('Failed to apply preset'); }
    finally { setApplying(null); }
  }

  // ── Table row helpers ──
  function addTableRow() {
    setForm(prev => ({
      ...prev,
      tables: [...prev.tables, { game_type_id: '', game_type_name: '', short_code: '', stakes: '', count: 1, min_buyin: 100, max_buyin: 0, max_players: 9 }]
    }));
  }

  function updateTableRow(idx, field, value) {
    setForm(prev => {
      const tables = [...prev.tables];
      tables[idx] = { ...tables[idx], [field]: value };
      if (field === 'game_type_id' && value) {
        const gt = gameTypes.find(g => g.id === value);
        if (gt) {
          tables[idx] = {
            ...tables[idx],
            game_type_id: gt.id,
            game_type_name: gt.name,
            short_code: gt.short_code,
            stakes: gt.stakes,
            min_buyin: gt.min_buyin,
            max_buyin: gt.max_buyin,
            max_players: gt.max_players
          };
        }
      }
      return { ...prev, tables };
    });
  }

  function removeTableRow(idx) {
    setForm(prev => ({ ...prev, tables: prev.tables.filter((_, i) => i !== idx) }));
  }

  // ── Tournament template helpers ──
  function addTournament() {
    setForm(prev => ({
      ...prev,
      tournaments: [...prev.tournaments, {
        name: '', tournament_type: 'freezeout', buyin_amount: 0, buyin_fee: 0,
        starting_chips: 10000, start_time: '', guaranteed_pool: 0, max_entries: null,
        allows_rebuys: false, allows_addon: false
      }]
    }));
  }

  function updateTournament(idx, field, value) {
    setForm(prev => {
      const tournaments = [...prev.tournaments];
      tournaments[idx] = { ...tournaments[idx], [field]: value };
      return { ...prev, tournaments };
    });
  }

  function removeTournament(idx) {
    setForm(prev => ({ ...prev, tournaments: prev.tournaments.filter((_, i) => i !== idx) }));
  }

  // ── Promotion toggle ──
  function togglePromotion(promoId) {
    setForm(prev => ({
      ...prev,
      promotions: prev.promotions.includes(promoId)
        ? prev.promotions.filter(id => id !== promoId)
        : [...prev.promotions, promoId]
    }));
  }

  // ── Day toggle ──
  function toggleDay(dayNum) {
    setForm(prev => ({
      ...prev,
      day_of_week: prev.day_of_week.includes(dayNum)
        ? prev.day_of_week.filter(d => d !== dayNum)
        : [...prev.day_of_week, dayNum].sort()
    }));
  }

  // ── Save ──
  async function handleSave() {
    if (!form.name) { setError('Preset name required'); return; }
    if (form.tables.length === 0 && form.promotions.length === 0 && form.tournaments.length === 0) {
      setError('Add at least one table, promotion, or tournament configuration');
      return;
    }
    setError(null);
    try {
      const url = editingId ? `/api/commander/room-presets?id=${editingId}` : '/api/commander/room-presets';
      const res = await commanderFetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setSuccess(editingId ? 'Preset updated' : 'Preset created');
          setTimeout(() => setSuccess(null), 3000);
          setShowForm(false);
          setEditingId(null);
          resetForm();
          fetchData();
          broadcastChange('settings');
        } else {
          setError(json.error || 'Failed to save');
        }
      } else {
        setError('Failed to save preset');
      }
    } catch { setError('Failed to save preset'); }
  }

  async function handleDelete(preset) {
    if (!confirm(`Delete "${preset.name}"? This cannot be undone.`)) return;
    try {
      const res = await commanderFetch(`/api/commander/room-presets?id=${preset.id}`, {
        method: 'DELETE'});
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          fetchData();
          broadcastChange('settings');
        }
      }
    } catch (err) { console.warn(err); setError('Action failed. Please check your connection and try again.'); }
  }

  function startEdit(preset) {
    setForm({
      name: preset.name,
      description: preset.description || '',
      tables: preset.tables || [],
      promotions: preset.promotions || [],
      tournaments: preset.tournaments || [],
      start_time: preset.auto_apply_schedule?.start_time || '',
      day_of_week: preset.auto_apply_schedule?.day_of_week || []
    });
    setEditingId(preset.id);
    setShowForm(true);
  }

  function resetForm() {
    setForm({ name: '', description: '', tables: [], promotions: [], tournaments: [], start_time: '', day_of_week: [] });
  }

  function getTotalTables(tables) {
    return (tables || []).reduce((sum, t) => sum + (t.count || 1), 0);
  }

  function getPromoName(id) {
    const p = promotions.find(pr => pr.id === id);
    return p ? p.name : 'Unknown';
  }

  const canManage = staff?.role === 'owner' || staff?.role === 'manager';
  const canHardStop = hasFeature(currentTier, 'close_day');

  return (
    <CommanderLayout title={`Daily Presets | ${venueName || 'Commander'}`} backHref="/commander/dashboard?card=staff">
      <>
        <SEOHead
          title="Commander — Room Presets"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />
        <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">
          <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
            {canManage && !showForm && (
              <div className="flex justify-end">
                <button onClick={() => { resetForm(); setEditingId(null); setShowForm(true); }}
                  className="flex items-center gap-2 px-4 py-2 bg-[#1877F2] text-white rounded-xl text-sm font-medium">
                  <Plus className="w-4 h-4" /> New Preset
                </button>
              </div>
            )}
            {success && <div className="p-3 bg-[#31A24C]/10 rounded-xl text-sm text-[#31A24C] font-medium flex items-center gap-2"><CheckCircle className="w-4 h-4" />{success}</div>}
            {hardStopSuccess && <div className="p-3 bg-[#31A24C]/10 rounded-xl text-sm text-[#31A24C] font-medium flex items-center gap-2"><CheckCircle className="w-4 h-4" />{hardStopSuccess}</div>}
            {error && <div className="p-3 bg-[#EF4444]/10 rounded-xl text-sm text-[#EF4444] flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>}

            {/* Hard Stop — Charity + Club only */}
            {canHardStop && (
              <div className="bg-[#242526] rounded-2xl border border-[#3A3B3C] overflow-hidden">
                <div className="p-4 border-b border-[#3A3B3C] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#EF4444]/10 rounded-lg flex items-center justify-center">
                      <StopCircle className="w-5 h-5 text-[#EF4444]" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-white">Hard Stop</h2>
                      <p className="text-xs text-[#B0B3B8]">Auto-Close All Cash Games At A Set Time</p>
                    </div>
                  </div>
                  {hardStopDirty && (
                    <button onClick={handleHardStopSave} disabled={hardStopSaving}
                      className="px-4 py-2 bg-[#1877F2] text-white rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                      {hardStopSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                    </button>
                  )}
                </div>
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-white">Enable Hard Stop</p>
                      <p className="text-sm text-[#B0B3B8]">Automatically Close All Games And Log Out Players At The Scheduled Time</p>
                    </div>
                    <button onClick={() => { setHardStopEnabled(!hardStopEnabled); setHardStopDirty(true); }}
                      className={`w-12 h-7 rounded-full transition-colors relative ${hardStopEnabled ? 'bg-[#1877F2]' : 'bg-[#3A3B3C]'}`}>
                      <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${hardStopEnabled ? 'right-1' : 'left-1'}`} />
                    </button>
                  </div>
                  {hardStopEnabled && (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-white">Stop Time</p>
                          <p className="text-sm text-[#B0B3B8]">All Cash Games End At This Time</p>
                        </div>
                        <input type="time" value={hardStopTime} onChange={(e) => { setHardStopTime(e.target.value); setHardStopDirty(true); }}
                          className="h-10 px-3 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-sm text-white text-center focus:outline-none focus:border-[#1877F2]"
                          style={{ colorScheme: 'dark' }} />
                      </div>
                      <div className="p-3 bg-[#F59E0B]/10 rounded-lg flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-[#F59E0B] mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-[#F59E0B]">
                          At {hardStopTime ? new Date(`2000-01-01T${hardStopTime}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'the set time'}, all open tables will be closed, all active sessions ended, and the room set to closed.
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Hourly Comp Rate */}
            {hasFeature(currentTier, 'comps') && (
              <div className="bg-[#242526] rounded-2xl border border-[#3A3B3C] overflow-hidden">
                <div className="p-4 border-b border-[#3A3B3C] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#31A24C]/15 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-[#31A24C]" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-white">Hourly Comp Rate</h2>
                      <p className="text-xs text-[#B0B3B8]">Auto-Award Comps To All Seated Players Per Hour</p>
                    </div>
                  </div>
                  {autoCompDirty && (
                    <button onClick={handleAutoCompSave} disabled={autoCompSaving}
                      className="px-4 py-2 bg-[#31A24C] text-white rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                      {autoCompSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                    </button>
                  )}
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <p className="text-sm text-[#B0B3B8] mb-2">Select Rate Per Hour Of Play</p>
                    <div className="flex flex-wrap gap-2">
                      {[0, 0.5, 1, 1.5, 2].map(rate => (
                        <button key={rate} onClick={() => { setAutoCompRate(rate); setAutoCompDirty(true); }}
                          className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${autoCompRate === rate
                            ? 'bg-[#31A24C]/20 border-[#31A24C] text-[#31A24C]'
                            : 'bg-[#3A3B3C] border-[#4A4B4C] text-[#B0B3B8] hover:border-[#31A24C]/50'
                            }`}>
                          {rate === 0 ? 'Off' : `$${rate.toFixed(2)}/hr`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-[#B0B3B8]">Custom:</p>
                    <div className="flex items-center bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl overflow-hidden">
                      <span className="pl-3 text-sm text-[#B0B3B8]">$</span>
                      <input type="number" value={autoCompRate || ''} onChange={(e) => { setAutoCompRate(parseFloat(e.target.value) || 0); setAutoCompDirty(true); }}
                        step="0.25" min="0" max="50" placeholder="0.00"
                        className="w-20 px-2 py-2 bg-transparent text-sm text-white focus:outline-none" />
                      <span className="pr-3 text-sm text-[#B0B3B8]">/hr</span>
                    </div>
                  </div>
                  {autoCompRate > 0 && (
                    <div className="p-3 bg-[#31A24C]/10 rounded-lg flex items-start gap-2">
                      <DollarSign className="w-4 h-4 text-[#31A24C] mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-[#31A24C]">
                        Players Will Automatically Earn <strong>${autoCompRate.toFixed(2)}</strong> In Comps For Every Hour They Are Seated At A Cash Game Table.
                      </p>
                    </div>
                  )}
                  {autoCompSuccess && (
                    <div className="p-3 bg-[#31A24C]/10 rounded-lg flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-[#31A24C]" />
                      <p className="text-xs text-[#31A24C]">{autoCompSuccess}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════════
                CREATE / EDIT DAILY PRESET FORM
            ════════════════════════════════════════════════════════════════ */}
            {showForm && (
              <div className="bg-[#242526] rounded-2xl border border-[#3A3B3C] overflow-hidden">
                <div className="p-4 border-b border-[#3A3B3C] flex items-center justify-between">
                  <h2 className="font-semibold text-white">{editingId ? 'Edit Daily Preset' : 'Create Daily Preset'}</h2>
                  <button onClick={() => { setShowForm(false); setEditingId(null); }} className="p-1 hover:bg-[#3A3B3C] rounded"><X className="w-5 h-5 text-[#B0B3B8]" /></button>
                </div>
                <div className="p-4 space-y-6">
                  {/* Name + Description */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[#B0B3B8] uppercase">Preset Name *</label>
                      <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                        placeholder="Friday Night" className="w-full mt-1 px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-sm text-white placeholder-[#6A6B6D] focus:outline-none focus:border-[#1877F2]" />
                    </div>
                    <div>
                      <label className="text-xs text-[#B0B3B8] uppercase">Description</label>
                      <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                        placeholder="Peak Hours Config" className="w-full mt-1 px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-sm text-white placeholder-[#6A6B6D] focus:outline-none focus:border-[#1877F2]" />
                    </div>
                  </div>

                  {/* ── SECTION 1: TABLE CONFIGURATION ── */}
                  <div className="border border-[#3A3B3C] rounded-xl overflow-hidden">
                    <div className="p-3 bg-[#1877F2]/5 border-b border-[#3A3B3C] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layout className="w-4 h-4 text-[#1877F2]" />
                        <span className="text-sm font-semibold text-white">Tables</span>
                        {form.tables.length > 0 && <span className="text-xs text-[#B0B3B8]">({getTotalTables(form.tables)} total)</span>}
                      </div>
                      <button onClick={addTableRow} className="text-xs text-[#1877F2] hover:text-[#1877F2]/80 flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add
                      </button>
                    </div>
                    <div className="p-3">
                      {form.tables.length === 0 ? (
                        <p className="text-center text-sm text-[#B0B3B8] py-4">No Tables Configured</p>
                      ) : (
                        <div className="space-y-2">
                          {form.tables.map((row, idx) => (
                            <div key={idx} className="bg-[#3A3B3C]/30 rounded-xl p-3 space-y-2">
                              <div className="flex items-center gap-2">
                                {gameTypes.length > 0 ? (
                                  <select value={row.game_type_id || ''} onChange={e => updateTableRow(idx, 'game_type_id', e.target.value)}
                                    className="flex-1 px-2 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-sm text-white">
                                    <option value="">{row.short_code ? `${row.short_code} ${row.stakes || ''}`.trim() : 'Select Game Type...'}</option>
                                    {gameTypes.map(gt => (
                                      <option key={gt.id} value={gt.id}>{gt.short_code} — {gt.name} {gt.stakes}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <div className="flex-1 flex gap-2">
                                    <input value={row.short_code || ''} onChange={e => updateTableRow(idx, 'short_code', e.target.value.toUpperCase())}
                                      placeholder="NLH" className="w-20 px-2 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-sm text-white text-center placeholder-[#6A6B6D]" />
                                    <input value={row.stakes || ''} onChange={e => updateTableRow(idx, 'stakes', e.target.value)}
                                      placeholder="1/3" className="flex-1 px-2 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-sm text-white placeholder-[#6A6B6D]" />
                                  </div>
                                )}
                                <div className="w-20">
                                  <input type="number" value={row.count || 1} min={1} max={20}
                                    onChange={e => updateTableRow(idx, 'count', parseInt(e.target.value) || 1)}
                                    className="w-full px-2 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-sm text-white text-center" />
                                  <p className="text-[10px] text-[#B0B3B8] text-center mt-0.5">Tables</p>
                                </div>
                                <button onClick={() => removeTableRow(idx)} className="p-1.5 hover:bg-[#EF4444]/10 rounded-lg">
                                  <X className="w-4 h-4 text-[#EF4444]" />
                                </button>
                              </div>
                              {/* Inline editable fields for game code + stakes when game has no dropdown ID */}
                              {!row.game_type_id && row.short_code && gameTypes.length > 0 && (
                                <div className="flex gap-2 pl-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-[#B0B3B8] uppercase">Game:</span>
                                    <input value={row.short_code || ''} onChange={e => updateTableRow(idx, 'short_code', e.target.value.toUpperCase())}
                                      className="w-16 px-2 py-1 bg-[#3A3B3C] border border-[#4A4B4C] rounded text-xs text-white text-center" />
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-[#B0B3B8] uppercase">Stakes:</span>
                                    <input value={row.stakes || ''} onChange={e => updateTableRow(idx, 'stakes', e.target.value)}
                                      className="w-20 px-2 py-1 bg-[#3A3B3C] border border-[#4A4B4C] rounded text-xs text-white text-center" />
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-[#B0B3B8] uppercase">Name:</span>
                                    <input value={row.game_type_name || ''} onChange={e => updateTableRow(idx, 'game_type_name', e.target.value)}
                                      placeholder="No Limit Hold'em" className="flex-1 px-2 py-1 bg-[#3A3B3C] border border-[#4A4B4C] rounded text-xs text-white placeholder-[#6A6B6D]" />
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── SECTION 2: PROMOTIONS ── */}
                  <div className="border border-[#3A3B3C] rounded-xl overflow-hidden">
                    <div className="p-3 bg-[#31A24C]/5 border-b border-[#3A3B3C] flex items-center gap-2">
                      <Gift className="w-4 h-4 text-[#31A24C]" />
                      <span className="text-sm font-semibold text-white">Promotions To Activate</span>
                      {form.promotions.length > 0 && <span className="text-xs text-[#B0B3B8]">({form.promotions.length} selected)</span>}
                    </div>
                    <div className="p-3">
                      {promotions.length === 0 ? (
                        <p className="text-center text-sm text-[#B0B3B8] py-4">No Promotions Created Yet. Create Promotions First On The Promotions Page.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {promotions.map(promo => (
                            <button key={promo.id} onClick={() => togglePromotion(promo.id)}
                              className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${form.promotions.includes(promo.id)
                                ? 'bg-[#31A24C]/10 border border-[#31A24C]'
                                : 'bg-[#3A3B3C]/30 border border-transparent hover:border-[#4A4B4C]'
                                }`}>
                              <div className="flex items-center gap-3 text-left">
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${form.promotions.includes(promo.id)
                                  ? 'bg-[#31A24C] border-[#31A24C]'
                                  : 'border-[#4A4B4C]'
                                  }`}>
                                  {form.promotions.includes(promo.id) && <CheckCircle className="w-3 h-3 text-white" />}
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-white">{promo.name}</p>
                                  <p className="text-xs text-[#B0B3B8]">{promo.promotion_type?.replace(/_/g, ' ')}</p>
                                </div>
                              </div>
                              {promo.is_active && <span className="text-[10px] text-[#31A24C] font-medium">ACTIVE</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── SECTION 3: TOURNAMENTS ── */}
                  <div className="border border-[#3A3B3C] rounded-xl overflow-hidden">
                    <div className="p-3 bg-[#F59E0B]/5 border-b border-[#3A3B3C] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-[#F59E0B]" />
                        <span className="text-sm font-semibold text-white">Tournaments To Create</span>
                        {form.tournaments.length > 0 && <span className="text-xs text-[#B0B3B8]">({form.tournaments.length})</span>}
                      </div>
                      <button onClick={addTournament} className="text-xs text-[#F59E0B] hover:text-[#F59E0B]/80 flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add
                      </button>
                    </div>
                    <div className="p-3">
                      {form.tournaments.length === 0 ? (
                        <p className="text-center text-sm text-[#B0B3B8] py-4">No Tournaments Configured</p>
                      ) : (
                        <div className="space-y-3">
                          {form.tournaments.map((tmpl, idx) => (
                            <div key={idx} className="bg-[#3A3B3C]/30 rounded-xl p-3 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-[#F59E0B] font-bold uppercase">Tournament {idx + 1}</span>
                                <button onClick={() => removeTournament(idx)} className="p-1 hover:bg-[#EF4444]/10 rounded">
                                  <X className="w-4 h-4 text-[#EF4444]" />
                                </button>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[10px] text-[#B0B3B8] uppercase">Name *</label>
                                  <input value={tmpl.name} onChange={e => updateTournament(idx, 'name', e.target.value)}
                                    placeholder="$200 NLH Freezeout"
                                    className="w-full mt-0.5 px-2 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-sm text-white placeholder-[#6A6B6D] focus:outline-none focus:border-[#F59E0B]" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-[#B0B3B8] uppercase">Start Time</label>
                                  <input type="time" value={tmpl.start_time} onChange={e => updateTournament(idx, 'start_time', e.target.value)}
                                    className="w-full mt-0.5 px-2 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-sm text-white focus:outline-none focus:border-[#F59E0B]"
                                    style={{ colorScheme: 'dark' }} />
                                </div>
                              </div>
                              <div className="grid grid-cols-4 gap-2">
                                <div>
                                  <label className="text-[10px] text-[#B0B3B8] uppercase">Type</label>
                                  <select value={tmpl.tournament_type} onChange={e => updateTournament(idx, 'tournament_type', e.target.value)}
                                    className="w-full mt-0.5 px-2 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-xs text-white">
                                    <option value="freezeout">Freezeout</option>
                                    <option value="rebuy">Rebuy</option>
                                    <option value="bounty">Bounty</option>
                                    <option value="shootout">Shootout</option>
                                    <option value="sit_n_go">Sit & Go</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] text-[#B0B3B8] uppercase">Buy-In $</label>
                                  <input type="number" value={tmpl.buyin_amount || ''} onChange={e => updateTournament(idx, 'buyin_amount', parseInt(e.target.value) || 0)}
                                    className="w-full mt-0.5 px-2 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-sm text-white text-center focus:outline-none focus:border-[#F59E0B]" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-[#B0B3B8] uppercase">Starting Chips</label>
                                  <input type="number" value={tmpl.starting_chips || ''} onChange={e => updateTournament(idx, 'starting_chips', parseInt(e.target.value) || 10000)}
                                    className="w-full mt-0.5 px-2 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-sm text-white text-center focus:outline-none focus:border-[#F59E0B]" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-[#B0B3B8] uppercase">GTD Pool $</label>
                                  <input type="number" value={tmpl.guaranteed_pool || ''} onChange={e => updateTournament(idx, 'guaranteed_pool', parseInt(e.target.value) || 0)}
                                    className="w-full mt-0.5 px-2 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-sm text-white text-center focus:outline-none focus:border-[#F59E0B]" />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── SCHEDULE (optional) ── */}
                  <div className="border border-[#3A3B3C] rounded-xl overflow-hidden">
                    <div className="p-3 bg-[#8B5CF6]/5 border-b border-[#3A3B3C] flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-[#8B5CF6]" />
                      <span className="text-sm font-semibold text-white">Auto-Launch Schedule</span>
                      <span className="text-xs text-[#B0B3B8]">(optional)</span>
                    </div>
                    <div className="p-3 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label className="text-[10px] text-[#B0B3B8] uppercase">Launch Time</label>
                          <input type="time" value={form.start_time} onChange={e => setForm(p => ({ ...p, start_time: e.target.value }))}
                            className="w-full mt-0.5 px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                            style={{ colorScheme: 'dark' }} />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-[#B0B3B8] uppercase mb-1.5 block">Active Days</label>
                        <div className="flex gap-2">
                          {DAY_LABELS.map((label, idx) => (
                            <button key={idx} onClick={() => toggleDay(idx)}
                              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${form.day_of_week.includes(idx)
                                ? 'bg-[#8B5CF6]/20 border border-[#8B5CF6] text-[#8B5CF6]'
                                : 'bg-[#3A3B3C] border border-[#4A4B4C] text-[#B0B3B8] hover:border-[#8B5CF6]/50'
                                }`}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {form.start_time && form.day_of_week.length > 0 && (
                        <div className="p-3 bg-[#8B5CF6]/10 rounded-lg flex items-start gap-2">
                          <Clock className="w-4 h-4 text-[#8B5CF6] mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-[#8B5CF6]">
                            This preset will auto-launch at <strong>{new Date(`2000-01-01T${form.start_time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong> on {form.day_of_week.map(d => DAY_LABELS[d]).join(', ')}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Save / Cancel */}
                  <div className="flex gap-3 pt-2">
                    <button onClick={handleSave} className="flex-1 py-3 bg-[#1877F2] text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2">
                      <Save className="w-4 h-4" /> {editingId ? 'Update Preset' : 'Save Preset'}
                    </button>
                    <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-6 py-3 bg-[#3A3B3C] text-[#B0B3B8] rounded-xl text-sm">Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════════
                PRESETS LIST
            ════════════════════════════════════════════════════════════════ */}
            {loading ? (
              <div className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin text-[#1877F2] mx-auto" /></div>
            ) : presets.length === 0 && !showForm ? (
              <div className="bg-[#242526] rounded-2xl border border-[#3A3B3C] p-12 text-center">
                <Layout className="w-12 h-12 text-[#3A3B3C] mx-auto mb-3" />
                <h3 className="text-lg font-medium text-white mb-1">No Daily Presets Yet</h3>
                <p className="text-sm text-[#B0B3B8] mb-4">Create Presets To Launch Your Entire Room With One Click</p>
                {canManage && (
                  <button onClick={() => { resetForm(); setShowForm(true); }}
                    className="px-6 py-2.5 bg-[#1877F2] text-white rounded-xl text-sm font-medium">
                    <Plus className="w-4 h-4 inline mr-2" /> Create First Preset
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {presets.map(preset => {
                  const tableCount = getTotalTables(preset.tables);
                  const promoCount = (preset.promotions || []).length;
                  const tourneyCount = (preset.tournaments || []).length;
                  const schedule = preset.auto_apply_schedule;
                  const hasSchedule = schedule?.start_time && schedule?.day_of_week?.length > 0;

                  return (
                    <div key={preset.id} className="bg-[#242526] rounded-2xl border border-[#3A3B3C] overflow-hidden">
                      <div className="p-4">
                        {/* Header */}
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h3 className="font-semibold text-white text-lg">{preset.name}</h3>
                            {preset.description && <p className="text-xs text-[#B0B3B8] mt-0.5">{preset.description}</p>}
                          </div>
                        </div>

                        {/* Summary badges */}
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {tableCount > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#1877F2]/10 text-[#1877F2] text-xs font-medium">
                              <Layout className="w-3 h-3" /> {tableCount} table{tableCount !== 1 ? 's' : ''}
                            </span>
                          )}
                          {promoCount > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#31A24C]/10 text-[#31A24C] text-xs font-medium">
                              <Gift className="w-3 h-3" /> {promoCount} promo{promoCount !== 1 ? 's' : ''}
                            </span>
                          )}
                          {tourneyCount > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#F59E0B]/10 text-[#F59E0B] text-xs font-medium">
                              <Trophy className="w-3 h-3" /> {tourneyCount} tourney{tourneyCount !== 1 ? 's' : ''}
                            </span>
                          )}
                          {hasSchedule && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#8B5CF6]/10 text-[#8B5CF6] text-xs font-medium">
                              <Clock className="w-3 h-3" /> {new Date(`2000-01-01T${schedule.start_time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                              {' '}{schedule.day_of_week.map(d => DAY_LABELS[d]).join(', ')}
                            </span>
                          )}
                        </div>

                        {/* Expandable details */}
                        {tableCount > 0 && (
                          <div className="space-y-1 mb-3">
                            {(preset.tables || []).map((t, i) => (
                              <div key={i} className="flex items-center justify-between text-sm">
                                <span className="text-[#E4E6EB]">{t.short_code || t.game_type_name} {t.stakes}</span>
                                <span className="text-[#B0B3B8]">×{t.count || 1}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Tournament details */}
                        {tourneyCount > 0 && (
                          <div className="space-y-1 mb-3">
                            {(preset.tournaments || []).map((t, i) => (
                              <div key={i} className="flex items-center justify-between text-sm">
                                <span className="text-[#E4E6EB]">{t.name || 'Tournament'}</span>
                                <span className="text-[#B0B3B8]">${t.buyin_amount || 0}{t.start_time ? ` @ ${new Date(`2000-01-01T${t.start_time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Promotion names */}
                        {promoCount > 0 && (
                          <div className="mb-3">
                            <p className="text-xs text-[#B0B3B8]">
                              Promos: {(preset.promotions || []).map(id => getPromoName(id)).join(', ')}
                            </p>
                          </div>
                        )}

                        {preset.last_applied_at && (
                          <p className="text-[10px] text-[#B0B3B8] mb-3">
                            Last launched: {new Date(preset.last_applied_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </p>
                        )}

                        {/* Actions */}
                        <div className="flex gap-2">
                          <button onClick={() => handleApply(preset)} disabled={applying === preset.id}
                            className="flex-1 py-2.5 bg-[#31A24C] text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-[#31A24C]/80 disabled:opacity-50">
                            {applying === preset.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                            Launch Now
                          </button>
                          {canManage && (
                            <>
                              <button onClick={() => startEdit(preset)} className="p-2.5 bg-[#3A3B3C] rounded-xl hover:bg-[#4A4B4C]">
                                <Edit2 className="w-4 h-4 text-[#B0B3B8]" />
                              </button>
                              <button onClick={() => handleDelete(preset)} className="p-2.5 bg-[#3A3B3C] rounded-xl hover:bg-[#EF4444]/10">
                                <Trash2 className="w-4 h-4 text-[#EF4444]" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════════
                STARTER PRESET TEMPLATES — 6 unique configurations
            ════════════════════════════════════════════════════════════════ */}
            <div className="mt-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-[#3A3B3C]" />
                <span className="text-xs text-[#B0B3B8] font-semibold uppercase tracking-wider">Starter Templates</span>
                <div className="flex-1 h-px bg-[#3A3B3C]" />
              </div>
              <p className="text-sm text-[#B0B3B8] text-center mb-4">Quick-Start Configurations — Click To Use As A Starting Point</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  {
                    name: 'Weeknight Cash',
                    description: 'Standard evening session — 3 tables for regular weeknight traffic',
                    icon: '🌙',
                    color: '#1877F2',
                    tables: [
                      { game_type_name: 'No Limit Hold\'em', short_code: 'NLH', stakes: '1/3', count: 2, max_players: 9 },
                      { game_type_name: 'No Limit Hold\'em', short_code: 'NLH', stakes: '2/5', count: 1, max_players: 9 }
                    ],
                    promotions: [],
                    tournaments: []
                  },
                  {
                    name: 'Weekend Warriors',
                    description: 'Peak hours — 6 tables across NLH and PLO for maximum action',
                    icon: '🔥',
                    color: '#EF4444',
                    tables: [
                      { game_type_name: 'No Limit Hold\'em', short_code: 'NLH', stakes: '1/3', count: 3, max_players: 9 },
                      { game_type_name: 'No Limit Hold\'em', short_code: 'NLH', stakes: '2/5', count: 2, max_players: 9 },
                      { game_type_name: 'Pot Limit Omaha', short_code: 'PLO', stakes: '2/5', count: 1, max_players: 9 }
                    ],
                    promotions: [],
                    tournaments: []
                  },
                  {
                    name: 'Tournament Thursday',
                    description: 'Cash game + weekly freezeout tournament combo',
                    icon: '🏆',
                    color: '#F59E0B',
                    tables: [
                      { game_type_name: 'No Limit Hold\'em', short_code: 'NLH', stakes: '1/2', count: 2, max_players: 9 }
                    ],
                    promotions: [],
                    tournaments: [
                      { name: '$100 NLH Freezeout', tournament_type: 'freezeout', buyin_amount: 100, buyin_fee: 20, starting_chips: 15000, start_time: '19:00', guaranteed_pool: 2000, max_entries: null, allows_rebuys: false, allows_addon: false }
                    ]
                  },
                  {
                    name: 'High Stakes Night',
                    description: '3 premium tables for high-roller action',
                    icon: '💎',
                    color: '#8B5CF6',
                    tables: [
                      { game_type_name: 'No Limit Hold\'em', short_code: 'NLH', stakes: '5/10', count: 2, max_players: 9 },
                      { game_type_name: 'Pot Limit Omaha', short_code: 'PLO', stakes: '5/10', count: 1, max_players: 9 }
                    ],
                    promotions: [],
                    tournaments: []
                  },
                  {
                    name: 'Sunday Special',
                    description: 'Full day — cash games + bounty tournament for the Sunday crowd',
                    icon: '☀️',
                    color: '#31A24C',
                    tables: [
                      { game_type_name: 'No Limit Hold\'em', short_code: 'NLH', stakes: '1/3', count: 2, max_players: 9 },
                      { game_type_name: 'No Limit Hold\'em', short_code: 'NLH', stakes: '2/5', count: 1, max_players: 9 }
                    ],
                    promotions: [],
                    tournaments: [
                      { name: '$200 Bounty Special', tournament_type: 'bounty', buyin_amount: 200, buyin_fee: 30, starting_chips: 20000, start_time: '14:00', guaranteed_pool: 5000, max_entries: null, allows_rebuys: false, allows_addon: false }
                    ]
                  },
                  {
                    name: 'Minimal Monday',
                    description: 'Single table for slow nights — low overhead, easy to manage',
                    icon: '🎯',
                    color: '#6B7280',
                    tables: [
                      { game_type_name: 'No Limit Hold\'em', short_code: 'NLH', stakes: '1/2', count: 1, max_players: 9 }
                    ],
                    promotions: [],
                    tournaments: []
                  }
                ].map((tmpl, idx) => (
                  <div key={idx} className="bg-[#242526] rounded-2xl border border-[#3A3B3C] p-4 flex flex-col">
                    <div className="flex items-start gap-3 mb-3">
                      <span className="text-2xl">{tmpl.icon}</span>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-white text-sm">{tmpl.name}</h4>
                        <p className="text-xs text-[#B0B3B8] mt-0.5 line-clamp-2">{tmpl.description}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {tmpl.tables.map((t, i) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded-md font-medium" style={{ background: `${tmpl.color}15`, color: tmpl.color }}>
                          {t.count}× {t.short_code} {t.stakes}
                        </span>
                      ))}
                      {tmpl.tournaments.map((t, i) => (
                        <span key={`t${i}`} className="text-[10px] px-2 py-0.5 rounded-md bg-[#F59E0B]/10 text-[#F59E0B] font-medium">
                          🏆 {t.name}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        setForm({
                          name: tmpl.name,
                          description: tmpl.description,
                          tables: tmpl.tables.map(t => ({ ...t })),
                          promotions: [],
                          tournaments: tmpl.tournaments.map(t => ({ ...t })),
                          start_time: '',
                          day_of_week: []
                        });
                        setEditingId(null);
                        setShowForm(true);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="mt-auto w-full py-2 rounded-xl text-xs font-semibold border transition-all hover:opacity-80"
                      style={{ borderColor: `${tmpl.color}66`, color: tmpl.color, background: `${tmpl.color}08` }}
                    >
                      Use This Template
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </main>
        </div>
        <style>{``}</style>
      </>
    
      <ConfirmDialog />
    </CommanderLayout>
  );
}
