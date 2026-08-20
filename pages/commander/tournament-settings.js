/**
 * Tournament Settings - Template picker, blind structure editor, defaults
 * Users can select from 7 pre-built templates or create custom ones
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Trophy, Zap, Crown, Target, RefreshCw, Rocket, Crosshair, ChevronRight, Settings, Clock, Loader2, Eye, Copy, Timer } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { broadcastChange } from '../../src/lib/commander/useCommanderSync';
import BlindStructureEditor from '../../src/components/commander/tournaments/BlindStructureEditor';
import { TOURNAMENT_TEMPLATES, TOURNAMENT_TYPES, formatBuyin, formatChips } from '../../src/components/commander/tournaments/tournamentTemplates';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

const ICON_MAP = {
    Trophy, Zap, Crown, Target, RefreshCw, Rocket, Crosshair };

export default function TournamentSettingsPage() {

  useEffect(() => { busEmit.sessionStart('commander-tournament-settings'); }, []);
    const router = useRouter();
    const [staff, setStaff] = useState(null);
    const [venue, setVenue] = useState(null);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [viewingStructure, setViewingStructure] = useState(null);
    const [creating, setCreating] = useState(false);
    const [createSuccess, setCreateSuccess] = useState(null);
    const [clockPresets, setClockPresets] = useState([]);
    const [selectedPreset, setSelectedPreset] = useState('');
    const [shotClockEnabled, setShotClockEnabled] = useState(false);
    const [shotClockSeconds, setShotClockSeconds] = useState(30);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

    useEffect(() => {    const _c = new AbortController();

        const storedStaff = getStaffSession();
        if (!storedStaff) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
        try {
            const staffData = JSON.parse(storedStaff);
            if (!staffData.venue_id) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
            setStaff(staffData);
            setVenue({ id: staffData.venue_id, name: staffData.venue_name });
            // Fetch clock presets
            fetchClockPresets(storedStaff);
        } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
    return () => _c.abort();
  }, [router]);

    async function fetchClockPresets(staffSession) {
        try {
            const json = await commanderFetchJSON('/api/commander/clock-presets');
            if (json.success) {
                setClockPresets(json.data || []);
                const def = (json.data || []).find(p => p.is_default);
                if (def) setSelectedPreset(def.id);
            }
        } catch (err) { console.warn(err); }
    }

    async function applyTemplate(template) {
        setCreating(true);
        setCreateSuccess(null);

        // Build the tournament payload from template
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(19, 0, 0, 0);

        try {
            const staffSession = getStaffSession();
            const payload = {
                venue_id: venue.id,
                name: template.name,
                tournament_type: template.tournament_type,
                buyin_amount: template.buyin_amount,
                buyin_fee: template.buyin_fee,
                starting_chips: template.starting_chips,
                scheduled_start: tomorrow.toISOString(),
                blind_structure: template.blind_structure,
                late_registration_levels: template.late_registration_levels,
                allows_rebuys: template.allows_rebuys || false,
                rebuy_amount: template.rebuy_amount || null,
                rebuy_chips: template.rebuy_chips || null,
                max_rebuys: template.max_rebuys || null,
                rebuy_end_level: template.rebuy_end_level || null,
                allows_addon: template.allows_addon || false,
                addon_amount: template.addon_amount || null,
                addon_chips: template.addon_chips || null,
                addon_at_break: template.addon_at_break || null,
                bounty_amount: template.bounty_amount || null,
                status: 'scheduled',
                broadcast_to_smarter: true,
                settings: {
                    ...(selectedPreset ? { clock_preset_id: selectedPreset } : {}),
                    ...(shotClockEnabled ? { shot_clock_enabled: true, shot_clock_seconds: shotClockSeconds } : {}) } };
            const res = await commanderFetch('/api/commander/tournaments', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json' || '' },
                body: JSON.stringify(payload) });

            if (!res.ok) throw new Error('Failed to create tournament');
            const data = await res.json();
            if (data.success) {
                setCreateSuccess(template.name);
                broadcastChange('tournaments');
                // Auto-sync to Club Page
                try {
                    const syncPayload = {
                        venue_id: venue.id,
                        tournament: data.data?.tournament || {
                            name: template.name,
                            tournament_type: template.tournament_type,
                            buyin_amount: template.buyin_amount,
                            buyin_fee: template.buyin_fee,
                            scheduled_start: tomorrow.toISOString(),
                            starting_chips: template.starting_chips,
                            guaranteed_pool: null } };
                    const r = await commanderFetch('/api/commander/sync-tournament-to-club', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json' || '' },
                        body: JSON.stringify(syncPayload) });
                    if (!r.ok) console.warn('Club sync failed');
                } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

                setTimeout(() => setCreateSuccess(null), 4000);
            }
        } catch (err) {
            console.warn('Failed to create tournament:', err);
            setToast({ type: 'error', text: 'Failed To Create Tournament. Please Try Again.' });
        } finally {
            setCreating(false);
        }
    }

    if (!staff) {
        return (
            <div className="cmd-page flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
            </div>
        );
    }

    return (
        <CommanderLayout title={`Tournament Settings | ${venue?.name || 'Commander'}`} backHref="/commander/dashboard?card=tournaments">
            <SEOHead
                title="Commander - Tournament Settings"
                description="Club Commander Poker Room Management Tool."
                noindex={true}
            />
            <div className="cmd-page">
                <div className="max-w-4xl mx-auto px-4 py-4 space-y-6">

                    {/* Success Banner */}
                    {createSuccess && (
                        <div className="p-3 bg-[#10B981]/10 border border-[#10B981]/30 rounded-lg flex items-center gap-3 animate-fadeIn">
                            <Trophy className="w-5 h-5 text-[#10B981]" />
                            <span className="text-sm text-[#10B981] font-medium">
                                "{createSuccess}" Created And Added To Schedule. Edit Details In Tournament Manager.
                            </span>
                        </div>
                    )}

                    {/* Section Header */}
                    <div>
                        <h1 className="text-xl font-bold text-white">Tournament Templates</h1>
                        <p className="text-sm text-[#64748B] mt-1">
                            Choose A Pre-Built Template To Instantly Create A Tournament With Expert Blind Structures, Or View The Structure Details First.
                        </p>
                    </div>

                    {/* Clock Display Preset Selector */}
                    {clockPresets.length > 0 && (
                        <div className="cmd-panel p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-[#8B5CF6]/10 rounded-lg flex items-center justify-center">
                                        <Settings className="w-5 h-5 text-[#8B5CF6]" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-semibold text-white">Clock Display Preset</h3>
                                        <p className="text-xs text-[#64748B]">Applied To The TV Clock When Tournament Runs</p>
                                    </div>
                                </div>
                                <select
                                    value={selectedPreset}
                                    onChange={e => setSelectedPreset(e.target.value)}
                                    className="bg-[#0D192E] border-2 border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#1877F2] min-w-[200px]"
                                >
                                    <option value="">No Preset (Default Theme)</option>
                                    {clockPresets.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}{p.is_default ? ' (Default)' : ''}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Shot Clock Setting */}
                    <div className="cmd-panel p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-[#EF4444]/10 rounded-lg flex items-center justify-center">
                                    <Timer className="w-5 h-5 text-[#EF4444]" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-white">Shot Clock</h3>
                                    <p className="text-xs text-[#64748B]">Per-Hand Decision Timer Visible On Dealer Tablets</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShotClockEnabled(!shotClockEnabled)}
                                className={`relative w-12 h-6 rounded-full transition-colors ${shotClockEnabled ? 'bg-[#EF4444]' : 'bg-[#3A3B3C]'
                                    }`}>
                                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${shotClockEnabled ? 'translate-x-[26px]' : 'translate-x-0.5'
                                    }`} />
                            </button>
                        </div>
                        {shotClockEnabled && (
                            <div className="mt-3 pt-3 border-t border-[#1E3A5F]">
                                <p className="text-xs text-[#64748B] mb-2">Decision Time</p>
                                <div className="grid grid-cols-4 gap-2">
                                    {[20, 30, 45, 60].map(s => (
                                        <button key={s}
                                            onClick={() => setShotClockSeconds(s)}
                                            className={`py-2.5 rounded-lg text-sm font-semibold transition-colors ${shotClockSeconds === s
                                                    ? 'bg-[#EF4444] text-white'
                                                    : 'bg-[#0D192E] text-[#94A3B8] hover:bg-[#132240]'
                                                }`}>
                                            {s}s
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[10px] text-[#64748B] mt-2 flex items-center gap-1">
                                    <Timer className="w-3 h-3" /> Dealer Taps To Start/Reset. Voice Announces "5 Seconds" At 5s Remaining.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Template Cards Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {TOURNAMENT_TEMPLATES.map((template) => {
                            const IconComponent = ICON_MAP[template.icon] || Trophy;
                            const isExpanded = viewingStructure === template.id;

                            return (
                                <div key={template.id} className="cmd-panel overflow-hidden">
                                    {/* Card Header */}
                                    <div className="p-4">
                                        <div className="flex items-start gap-3">
                                            <div
                                                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                                                style={{ backgroundColor: `${template.color}20` }}
                                            >
                                                <IconComponent className="w-5 h-5" style={{ color: template.color }} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="text-base font-semibold text-white">{template.name}</h3>
                                                <p className="text-xs text-[#64748B] mt-0.5 line-clamp-2">{template.description}</p>
                                            </div>
                                        </div>

                                        {/* Stats Row */}
                                        <div className="grid grid-cols-4 gap-2 mt-3">
                                            <div className="text-center">
                                                <p className="text-xs text-[#64748B]">Buy-In</p>
                                                <p className="text-sm font-medium text-white">
                                                    {formatBuyin(template.buyin_amount, template.buyin_fee, 0)}
                                                </p>
                                            </div>
                                            <div className="text-center">
                                                <p className="text-xs text-[#64748B]">Chips</p>
                                                <p className="text-sm font-medium text-white">{formatChips(template.starting_chips)}</p>
                                            </div>
                                            <div className="text-center">
                                                <p className="text-xs text-[#64748B]">Duration</p>
                                                <p className="text-sm font-medium text-[#22D3EE]">{template.estimated_duration}</p>
                                            </div>
                                            <div className="text-center">
                                                <p className="text-xs text-[#64748B]">Type</p>
                                                <p className="text-sm font-medium capitalize" style={{ color: template.color }}>
                                                    {template.tournament_type}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Extra Info for Bounty/Rebuy */}
                                        {(template.bounty_amount > 0 || template.allows_rebuys) && (
                                            <div className="mt-2 flex gap-2 flex-wrap">
                                                {template.bounty_amount > 0 && (
                                                    <span className="px-2 py-0.5 bg-[#EF4444]/10 rounded text-xs text-[#EF4444]">
                                                        ${template.bounty_amount} Bounty
                                                    </span>
                                                )}
                                                {template.allows_rebuys && (
                                                    <span className="px-2 py-0.5 bg-[#10B981]/10 rounded text-xs text-[#10B981]">
                                                        Rebuys L1-{template.rebuy_end_level}
                                                    </span>
                                                )}
                                                {template.allows_addon && (
                                                    <span className="px-2 py-0.5 bg-[#A855F7]/10 rounded text-xs text-[#A855F7]">
                                                        Add-On: {formatChips(template.addon_chips)} Chips
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {/* Action Buttons */}
                                        <div className="flex gap-2 mt-3">
                                            <button
                                                onClick={() => applyTemplate(template)}
                                                disabled={creating}
                                                className="flex-1 h-9 cmd-btn cmd-btn-primary flex items-center justify-center gap-2 text-sm font-medium rounded-lg"
                                            >
                                                {creating ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <>
                                                        <Copy className="w-3.5 h-3.5" />
                                                        Use Template
                                                    </>
                                                )}
                                            </button>
                                            <button
                                                onClick={() => setViewingStructure(isExpanded ? null : template.id)}
                                                className="h-9 px-3 bg-[#0D192E] hover:bg-[#132240] rounded-lg transition-colors flex items-center gap-1.5 text-sm text-[#94A3B8]"
                                            >
                                                <Eye className="w-3.5 h-3.5" />
                                                {isExpanded ? 'Hide' : 'View'} Structure
                                            </button>
                                        </div>
                                    </div>

                                    {/* Expanded Blind Structure */}
                                    {isExpanded && (
                                        <div className="border-t border-[#1E3A5F] p-4 bg-[#0A1628]">
                                            <BlindStructureEditor
                                                structure={template.blind_structure}
                                                onChange={() => { }}
                                                readOnly={true}
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Quick Actions */}
                    <div className="space-y-3">
                        <h2 className="text-lg font-semibold text-white">Quick Actions</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button
                                onClick={() => router.push('/commander/tournaments')}
                                className="cmd-panel p-4 flex items-center gap-3 hover:bg-[#132240] transition-colors text-left"
                            >
                                <div className="w-10 h-10 bg-[#22D3EE]/10 rounded-lg flex items-center justify-center">
                                    <Trophy className="w-5 h-5 text-[#22D3EE]" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-white">Tournament Manager</p>
                                    <p className="text-xs text-[#64748B]">View, Edit, And Manage All Tournaments</p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-[#64748B] ml-auto" />
                            </button>

                            <button
                                onClick={() => router.push('/commander/tournament-controls')}
                                className="cmd-panel p-4 flex items-center gap-3 hover:bg-[#132240] transition-colors text-left"
                            >
                                <div className="w-10 h-10 bg-[#F59E0B]/10 rounded-lg flex items-center justify-center">
                                    <Clock className="w-5 h-5 text-[#F59E0B]" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-white">Tournament Clock</p>
                                    <p className="text-xs text-[#64748B]">Select A Tournament To Run Its Clock Display</p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-[#64748B] ml-auto" />
                            </button>
                        </div>
                    </div>

                    {/* Tournament Type Reference */}
                    <div className="space-y-3">
                        <h2 className="text-lg font-semibold text-white">Tournament Types Reference</h2>
                        <div className="cmd-panel p-4">
                            <div className="space-y-3">
                                {TOURNAMENT_TYPES.map((type) => (
                                    <div key={type.value} className="flex items-start gap-3 py-2 border-b border-[#1E3A5F]/50 last:border-0">
                                        <span className="text-sm font-medium text-[#22D3EE] capitalize min-w-[100px]">{type.label}</span>
                                        <span className="text-sm text-[#94A3B8]">{type.description}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
      `}</style>
        
      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: toast.type === 'success' ? '#22C55E' : '#EF4444',
          color: '#fff', fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'slideUp 0.3s ease',
          maxWidth: 360,
        }}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8,
          }}>×</button>
        </div>
      )}
    </CommanderLayout>
    );
}
