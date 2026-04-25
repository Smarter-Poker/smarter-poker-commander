/**
 * Game Types Configuration Page
 * /commander/game-types
 * TC equivalent: "Configuration" tile — game types, stakes, buy-ins, rake
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Plus, Edit2, Trash2, X, Loader2, Save, DollarSign, Users, Percent, Clock, ToggleLeft, ToggleRight } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';
import { useConfirmAction } from "../../src/components/commander/shared/ConfirmModal";

const PRESET_GAMES = [
  { name: 'No Limit Hold\'em', short_code: 'NLH', max_players: 9, color: '#1877F2' },
  { name: 'Pot Limit Omaha', short_code: 'PLO', max_players: 9, color: '#F59E0B' },
  { name: 'PLO Hi-Lo', short_code: 'PLO8', max_players: 9, color: '#EF4444' },
  { name: 'Limit Hold\'em', short_code: 'LHE', max_players: 10, color: '#31A24C' },
  { name: 'No Limit Omaha 5', short_code: 'PLO5', max_players: 8, color: '#8B5CF6' },
  { name: '7 Card Stud', short_code: 'STUD', max_players: 8, color: '#EC4899' },
  { name: 'Mixed Game', short_code: 'MIXED', max_players: 8, color: '#14B8A6' },
  { name: 'Big O', short_code: 'BIGO', max_players: 8, color: '#F97316' },
  { name: 'Short Deck', short_code: 'SD', max_players: 9, color: '#6366F1' },
];

export default function GameTypesPage() {
  const router = useRouter();
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-game-types'); }, []);
  const [gameTypes, setGameTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [staff, setStaff] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [venueName, setVenueName] = useState('');

  // Form state
  const [form, setForm] = useState({
    name: '', short_code: '', stakes: '', min_buyin: 100, max_buyin: 0,
    max_players: 9, rake_type: 'pot', rake_percent: 5, rake_cap: 15,
    time_rate: 0, color: '#1877F2', notes: ''
  });

  useEffect(() => {
    const stored = getStaffSession();
    if (!stored) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
    try {
      const s = JSON.parse(stored);
      if (!s.venue_id) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
      setStaff(s);
      setVenueId(s.venue_id);
      setVenueName(s.venue_name || '');
    } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
  }, [router]);

  const fetchGameTypes = useCallback(async () => {
    if (!venueId) return;
    try {
const json = await commanderFetchJSON('/api/commander/game-types?include_inactive=true');
      if (json.success) setGameTypes(json.data || []);
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, [venueId]);

  useEffect(() => { const _c = new AbortController(); fetchGameTypes(_c.signal); return () => _c.abort(); }, [fetchGameTypes]);

  // Commander Data Bus — sync game types across tabs
  useCommanderSync(venueId, fetchGameTypes, { entities: ['games'] });

  function resetForm() {
    setForm({
      name: '', short_code: '', stakes: '', min_buyin: 100, max_buyin: 0,
      max_players: 9, rake_type: 'pot', rake_percent: 5, rake_cap: 15,
      time_rate: 0, color: '#1877F2', notes: ''
    });
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(gt) {
    setForm({
      name: gt.name, short_code: gt.short_code, stakes: gt.stakes,
      min_buyin: gt.min_buyin, max_buyin: gt.max_buyin, max_players: gt.max_players,
      rake_type: gt.rake_type, rake_percent: gt.rake_percent, rake_cap: gt.rake_cap,
      time_rate: gt.time_rate, color: gt.color || '#1877F2', notes: gt.notes || ''
    });
    setEditingId(gt.id);
    setShowForm(true);
  }

  function applyPreset(preset) {
    setForm(prev => ({
      ...prev, name: preset.name, short_code: preset.short_code,
      max_players: preset.max_players, color: preset.color
    }));
  }

  async function handleSave(signal) {
    if (!form.name || !form.short_code || !form.stakes) {
      setError('Name, code, and stakes are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
const url = editingId
        ? `/api/commander/game-types?id=${editingId}`
        : '/api/commander/game-types';
      const res = await commanderFetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        broadcastChange('games');
        setSuccess(editingId ? 'Game type updated' : 'Game type created');
        setTimeout(() => setSuccess(null), 3000);
        resetForm();
        fetchGameTypes();
      } else {
        setError(json.error || 'Failed to save');
      }
    } catch (err) { setError('Failed to save game type'); }
    finally { setSaving(false); }
  }

  async function handleToggleActive(gt) {
    try {
const res = await commanderFetch(`/api/commander/game-types/${gt.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venueId, is_active: !gt.is_active })
      });
      if (res.ok) {
        fetchGameTypes();
        broadcastChange('games');
      }
    } catch (err) { console.warn(err); setError('Action failed. Please check your connection and try again.'); }
  }

  async function handleDelete(gt) {
    if (!confirm(`Remove "${gt.name} ${gt.stakes}" permanently?`)) return;
    try {
const res = await commanderFetch(`/api/commander/game-types/${gt.id}?venue_id=${venueId}`, {
        method: 'DELETE'});
      if (res.ok) {
        fetchGameTypes();
        broadcastChange('games');
      }
    } catch (err) { console.warn(err); setError('Action failed. Please check your connection and try again.'); }
  }

  const canManage = staff?.role === 'owner' || staff?.role === 'manager';

  return (
    <CommanderLayout title={`Game Types | ${venueName || 'Commander'}`} backHref="/commander/dashboard?card=floor">
      <>
        <SEOHead
          title="Commander — Game Types"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />
        <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">
          {/* Header */}
          <header className="bg-[#242526] border-b border-[#3A3B3C] sticky top-0 z-50">
            <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <h1 className="font-bold text-white text-lg">Game Types</h1>
                  <p className="text-sm text-[#B0B3B8]">{venueName} — {gameTypes.filter(g => g.is_active).length} active</p>
                </div>
              </div>
              {canManage && (
                <button onClick={() => { resetForm(); setShowForm(true); }}
                  className="flex items-center gap-2 px-4 py-2 bg-[#1877F2] text-white rounded-xl text-sm font-medium hover:bg-[#1877F2]/80">
                  <Plus className="w-4 h-4" /> Add Game
                </button>
              )}
            </div>
          </header>

          <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
            {/* Alerts */}
            {success && <div className="p-3 bg-[#31A24C]/10 rounded-xl text-sm text-[#31A24C] font-medium">{success}</div>}
            {error && <div className="p-3 bg-[#EF4444]/10 rounded-xl text-sm text-[#EF4444]">{error}</div>}

            {/* Add/Edit Form */}
            {showForm && (
              <div className="bg-[#242526] rounded-2xl border border-[#3A3B3C] overflow-hidden">
                <div className="p-4 border-b border-[#3A3B3C] flex items-center justify-between">
                  <h2 className="font-semibold text-white">{editingId ? 'Edit Game Type' : 'New Game Type'}</h2>
                  <button onClick={resetForm} className="p-1 hover:bg-[#3A3B3C] rounded"><X className="w-5 h-5 text-[#B0B3B8]" /></button>
                </div>

                {/* Quick presets */}
                {!editingId && (
                  <div className="p-4 border-b border-[#3A3B3C]">
                    <p className="text-xs text-[#B0B3B8] uppercase mb-2">Quick Start</p>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_GAMES.map(p => (
                        <button key={p.short_code} onClick={() => applyPreset(p)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                          style={{ borderColor: p.color + '40', color: p.color, backgroundColor: p.color + '10' }}>
                          {p.short_code}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="p-4 space-y-4">
                  {/* Row 1: Name + Code + Color */}
                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-5">
                      <label className="text-xs text-[#B0B3B8] uppercase">Game Name *</label>
                      <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                        placeholder="No Limit Hold'em"
                        className="w-full mt-1 px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-sm text-white placeholder-[#6A6B6D] focus:outline-none focus:border-[#1877F2]" />
                    </div>
                    <div className="col-span-3">
                      <label className="text-xs text-[#B0B3B8] uppercase">Short Code *</label>
                      <input value={form.short_code} onChange={e => setForm(p => ({ ...p, short_code: e.target.value.toUpperCase() }))}
                        placeholder="NLH" maxLength={6}
                        className="w-full mt-1 px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-sm text-white placeholder-[#6A6B6D] focus:outline-none focus:border-[#1877F2]" />
                    </div>
                    <div className="col-span-3">
                      <label className="text-xs text-[#B0B3B8] uppercase">Stakes *</label>
                      <input value={form.stakes} onChange={e => setForm(p => ({ ...p, stakes: e.target.value }))}
                        placeholder="1/3"
                        className="w-full mt-1 px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-sm text-white placeholder-[#6A6B6D] focus:outline-none focus:border-[#1877F2]" />
                    </div>
                    <div className="col-span-1">
                      <label className="text-xs text-[#B0B3B8] uppercase">Color</label>
                      <input type="color" value={form.color} onChange={e => setForm(p => ({ ...p, color: e.target.value }))}
                        className="w-full mt-1 h-[42px] bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl cursor-pointer" />
                    </div>
                  </div>

                  {/* Row 2: Buy-in + Players */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-[#B0B3B8] uppercase flex items-center gap-1"><DollarSign className="w-3 h-3" /> Min Buy-In</label>
                      <input type="number" value={form.min_buyin} onChange={e => setForm(p => ({ ...p, min_buyin: parseInt(e.target.value) || 0 }))}
                        className="w-full mt-1 px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-sm text-white focus:outline-none focus:border-[#1877F2]" />
                    </div>
                    <div>
                      <label className="text-xs text-[#B0B3B8] uppercase flex items-center gap-1"><DollarSign className="w-3 h-3" /> Max Buy-In (0=no Cap)</label>
                      <input type="number" value={form.max_buyin} onChange={e => setForm(p => ({ ...p, max_buyin: parseInt(e.target.value) || 0 }))}
                        className="w-full mt-1 px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-sm text-white focus:outline-none focus:border-[#1877F2]" />
                    </div>
                    <div>
                      <label className="text-xs text-[#B0B3B8] uppercase flex items-center gap-1"><Users className="w-3 h-3" /> Max Players</label>
                      <input type="number" value={form.max_players} onChange={e => setForm(p => ({ ...p, max_players: parseInt(e.target.value) || 9 }))}
                        min={2} max={10}
                        className="w-full mt-1 px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-sm text-white focus:outline-none focus:border-[#1877F2]" />
                    </div>
                  </div>

                  {/* Row 3: Rake Configuration */}
                  <div>
                    <label className="text-xs text-[#B0B3B8] uppercase mb-2 block">Rake / Collection Method</label>
                    <div className="flex gap-2 mb-3">
                      {[{ v: 'pot', l: 'Pot Rake', icon: Percent }, { v: 'time', l: 'Time Collection', icon: Clock }, { v: 'none', l: 'No Rake', icon: X }].map(opt => (
                        <button key={opt.v}
                          onClick={() => setForm(p => ({ ...p, rake_type: opt.v }))}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors flex items-center justify-center gap-2 ${form.rake_type === opt.v
                            ? 'bg-[#1877F2]/10 border-[#1877F2] text-[#1877F2]'
                            : 'border-[#3A3B3C] text-[#B0B3B8] hover:bg-[#3A3B3C]'
                            }`}>
                          <opt.icon className="w-4 h-4" /> {opt.l}
                        </button>
                      ))}
                    </div>
                    {form.rake_type === 'pot' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-[#B0B3B8]">Rake %</label>
                          <input type="number" value={form.rake_percent} step="0.5"
                            onChange={e => setForm(p => ({ ...p, rake_percent: parseFloat(e.target.value) || 0 }))}
                            className="w-full mt-1 px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-sm text-white focus:outline-none focus:border-[#1877F2]" />
                        </div>
                        <div>
                          <label className="text-xs text-[#B0B3B8]">Rake Cap ($)</label>
                          <input type="number" value={form.rake_cap} step="1"
                            onChange={e => setForm(p => ({ ...p, rake_cap: parseFloat(e.target.value) || 0 }))}
                            className="w-full mt-1 px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-sm text-white focus:outline-none focus:border-[#1877F2]" />
                        </div>
                      </div>
                    )}
                    {form.rake_type === 'time' && (
                      <div>
                        <label className="text-xs text-[#B0B3B8]">Hourly Rate ($/hr)</label>
                        <input type="number" value={form.time_rate} step="1"
                          onChange={e => setForm(p => ({ ...p, time_rate: parseFloat(e.target.value) || 0 }))}
                          className="w-full mt-1 px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-sm text-white focus:outline-none focus:border-[#1877F2]" />
                      </div>
                    )}
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-xs text-[#B0B3B8] uppercase">Notes (optional)</label>
                    <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                      rows={2} placeholder="Special Rules, House Rules, etc."
                      className="w-full mt-1 px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-sm text-white placeholder-[#6A6B6D] focus:outline-none focus:border-[#1877F2] resize-none" />
                  </div>

                  {/* Save */}
                  <div className="flex gap-3 pt-2">
                    <button onClick={handleSave} disabled={saving}
                      className="flex-1 py-3 bg-[#1877F2] text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2 hover:bg-[#1877F2]/80 disabled:opacity-50">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {editingId ? 'Update Game Type' : 'Create Game Type'}
                    </button>
                    <button onClick={resetForm} className="px-6 py-3 bg-[#3A3B3C] text-[#B0B3B8] rounded-xl text-sm hover:bg-[#4A4B4C]">Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {/* Game Types List */}
            {loading ? (
              <div className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin text-[#1877F2] mx-auto" /></div>
            ) : gameTypes.length === 0 ? (
              <div className="bg-[#242526] rounded-2xl border border-[#3A3B3C] p-12 text-center">
                <DollarSign className="w-12 h-12 text-[#3A3B3C] mx-auto mb-3" />
                <h3 className="text-lg font-medium text-white mb-1">No Game Types Configured</h3>
                <p className="text-sm text-[#B0B3B8] mb-4">Add Your First Game Type To Get Started</p>
                {canManage && (
                  <button onClick={() => { resetForm(); setShowForm(true); }}
                    className="px-6 py-2.5 bg-[#1877F2] text-white rounded-xl text-sm font-medium">
                    <Plus className="w-4 h-4 inline mr-2" /> Add Game Type
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {gameTypes.map(gt => (
                  <div key={gt.id}
                    className={`bg-[#242526] rounded-2xl border overflow-hidden transition-all ${gt.is_active ? 'border-[#3A3B3C]' : 'border-[#3A3B3C]/50 opacity-60'
                      }`}>
                    <div className="p-4 flex items-center gap-4">
                      {/* Color badge */}
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xs font-bold"
                        style={{ backgroundColor: (gt.color || '#1877F2') + '20', color: gt.color || '#1877F2' }}>
                        {gt.short_code}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-white truncate">{gt.name}</h3>
                          <span className="text-lg font-bold" style={{ color: gt.color || '#1877F2' }}>{gt.stakes}</span>
                          {!gt.is_active && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#3A3B3C] text-[#B0B3B8]">INACTIVE</span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-[#B0B3B8] mt-1">
                          <span>Buy-in: ${gt.min_buyin}{gt.max_buyin > 0 ? `–$${gt.max_buyin}` : '+'}</span>
                          <span>{gt.max_players} max</span>
                          {gt.rake_type === 'pot' && <span>Rake: {gt.rake_percent}% / ${gt.rake_cap} cap</span>}
                          {gt.rake_type === 'time' && <span>${gt.time_rate}/hr</span>}
                          {gt.rake_type === 'none' && <span>No Rake</span>}
                        </div>
                      </div>

                      {/* Actions */}
                      {canManage && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleToggleActive(gt)}
                            className="p-2 hover:bg-[#3A3B3C] rounded-lg" title={gt.is_active ? 'Deactivate' : 'Activate'}>
                            {gt.is_active ? <ToggleRight className="w-5 h-5 text-[#31A24C]" /> : <ToggleLeft className="w-5 h-5 text-[#B0B3B8]" />}
                          </button>
                          <button onClick={() => startEdit(gt)}
                            className="p-2 hover:bg-[#3A3B3C] rounded-lg"><Edit2 className="w-4 h-4 text-[#B0B3B8]" /></button>
                          <button onClick={() => handleDelete(gt)}
                            className="p-2 hover:bg-[#EF4444]/10 rounded-lg"><Trash2 className="w-4 h-4 text-[#EF4444]" /></button>
                        </div>
                      )}
                    </div>
                    {gt.notes && (
                      <div className="px-4 pb-3">
                        <p className="text-xs text-[#B0B3B8] italic">{gt.notes}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
        <style>{`
`}</style>
      </>
    
      <ConfirmDialog />
    </CommanderLayout>
  );
}
