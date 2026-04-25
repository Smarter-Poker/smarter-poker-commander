/**
 * Tournament Clock Setup — Named Preset Manager
 * Full CRUD for clock display presets saved to Supabase
 * Presets selectable when creating/editing tournaments
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { Palette, Save, Loader2, Check, Plus, Trash2, Copy, Volume2, VolumeX, MonitorPlay } from 'lucide-react';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';
import { useConfirmAction } from "../../src/components/commander/shared/ConfirmModal";

const DEFAULT_THEME = {
    background: '#0D192E',
    text: '#ffffff',
    accent: '#1877F2',
    blinds: '#ffffff',
    headerBg: 'rgba(0,0,0,0.3)' };

const DEFAULT_DISPLAY_OPTIONS = {
    chip_denominations: [
        { value: 25, color: '#2E7D32', label: '25' },
        { value: 100, color: '#1A1A1A', label: '100' },
        { value: 500, color: '#6B2D8B', label: '500' },
        { value: 1000, color: '#DAA520', label: '1,000' },
        { value: 5000, color: '#E65100', label: '5,000' },
        { value: 25000, color: '#880E4F', label: '25,000' },
    ],
    sound_pack: 'classic',
    show_prize_pool: true,
    show_payouts: true,
    show_icm: false,
    show_chip_chop: false,
    show_chip_colors: true,
    show_next_round: true,
    show_schedule_preview: false,
    show_seating: false,
    screen_cycle_enabled: false,
    screen_cycle_interval: 15,
    sound_level_change: true,
    sound_break: true,
    sound_final_table: true,
    burn_in_prevention: false,
    logo_url: '',
    background_image_url: '' };

const SOUND_PACKS = [
    { value: 'classic', label: 'Classic', desc: 'Single clean tones' },
    { value: 'chime', label: 'Chime', desc: 'Ascending arpeggio' },
    { value: 'bell', label: 'Bell', desc: 'Long resonant ring' },
    { value: 'arcade', label: 'Arcade', desc: 'Sweep effects' },
    { value: 'voice', label: 'Voice (Chime)', desc: 'Chime fallback' },
];

const STARTER_THEMES = [
    { name: 'Midnight Blue', theme: { background: '#0D192E', text: '#ffffff', accent: '#1877F2', blinds: '#ffffff', headerBg: 'rgba(0,0,0,0.3)' } },
    { name: 'Classic Green', theme: { background: '#0a3d0a', text: '#ffffff', accent: '#31A24C', blinds: '#ffffff', headerBg: 'rgba(0,0,0,0.3)' } },
    { name: 'Royal Purple', theme: { background: '#1a0a2e', text: '#ffffff', accent: '#8B5CF6', blinds: '#ffffff', headerBg: 'rgba(0,0,0,0.3)' } },
    { name: 'Crimson Red', theme: { background: '#2a0a0a', text: '#ffffff', accent: '#EF4444', blinds: '#ffffff', headerBg: 'rgba(0,0,0,0.3)' } },
    { name: 'Gold Elite', theme: { background: '#1a1508', text: '#ffffff', accent: '#F59E0B', blinds: '#ffffff', headerBg: 'rgba(0,0,0,0.3)' } },
    { name: 'Stealth Black', theme: { background: '#0a0a0a', text: '#ffffff', accent: '#64748B', blinds: '#ffffff', headerBg: 'rgba(0,0,0,0.3)' } },
];

export default function ClockSetup() {

  // ── Toast auto-dismiss ──
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-clock-setup'); }, []);
    const router = useRouter();
    const [staff, setStaff] = useState(null);
    const [presets, setPresets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [editing, setEditing] = useState(null); // preset object being edited, or 'new'
    const [formName, setFormName] = useState('');
    const [formTheme, setFormTheme] = useState({ ...DEFAULT_THEME });
    const [formDisplay, setFormDisplay] = useState({ ...DEFAULT_DISPLAY_OPTIONS });
    const [formDefault, setFormDefault] = useState(false);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

    useEffect(() => {
        const stored = getStaffSession();
        if (!stored) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
        try {
            const s = JSON.parse(stored);
            if (!s.venue_id) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
            setStaff(s);
        } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
    }, []);

    const fetchPresets = useCallback(async () => {
        setLoading(true);
        try {
            const json = await commanderFetchJSON('/api/commander/clock-presets', {});
            if (json.success) setPresets(json.data || []);
        } catch (err) { console.warn(err); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { if (staff) { const _c = new AbortController(); fetchPresets(_c.signal); return () => _c.abort(); } }, [staff, fetchPresets]);

    // Commander Data Bus — sync clock presets
    useCommanderSync(staff?.venue_id || '', fetchPresets, { entities: ['tournaments'] });

    const startNew = (starterTheme = null) => {
        setEditing('new');
        setFormName(starterTheme?.name || '');
        setFormTheme(starterTheme?.theme ? { ...starterTheme.theme } : { ...DEFAULT_THEME });
        setFormDisplay({ ...DEFAULT_DISPLAY_OPTIONS });
        setFormDefault(false);
    };

    const startEdit = (preset) => {
        setEditing(preset);
        setFormName(preset.name);
        setFormTheme({ ...DEFAULT_THEME, ...(preset.theme || {}) });
        setFormDisplay({ ...DEFAULT_DISPLAY_OPTIONS, ...(preset.display_options || {}) });
        setFormDefault(preset.is_default || false);
    };

    const duplicatePreset = (preset) => {
        setEditing('new');
        setFormName(`${preset.name} (Copy)`);
        setFormTheme({ ...DEFAULT_THEME, ...(preset.theme || {}) });
        setFormDisplay({ ...DEFAULT_DISPLAY_OPTIONS, ...(preset.display_options || {}) });
        setFormDefault(false);
    };

    const handleSave = async () => {
        if (!formName.trim()) return;
        setSaving(true);
        try {
            const body = {
                name: formName.trim(),
                theme: formTheme,
                display_options: formDisplay,
                is_default: formDefault };

            const isNew = editing === 'new';
            const url = isNew ? '/api/commander/clock-presets' : `/api/commander/clock-presets?id=${editing.id}`;
            const method = isNew ? 'POST' : 'PUT';

            if (!isNew) body.id = editing.id;

            const res = await commanderFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body) });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const json = await res.json();
            if (res.ok && json.success) {
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
                setEditing(null);
                fetchPresets();
                broadcastChange('tournaments');
            }
        } catch (err) { console.warn(err); }
        finally { setSaving(false); }
    };

    const handleDelete = async (presetId) => {
        if (!confirm('Delete this clock preset?')) return;
        try {
            const res = await commanderFetch(`/api/commander/clock-presets?id=${presetId}`, {
                method: 'DELETE' });
            if (res.ok) {
                fetchPresets();
                broadcastChange('tournaments');
                if (editing?.id === presetId) setEditing(null);
            }
        } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
    };

    if (!staff) {
        return <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
        </div>;
    }

    // ======= EDITOR VIEW =======
    if (editing) {
        return (
            <CommanderLayout title="Clock Setup | Commander" backHref="/commander/dashboard?card=tournaments">
                <SEOHead title="Commander — Clock Preset Editor" description="Configure clock display preset" noindex={true} />
                <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: "var(--font-inter), sans-serif" }}>
                    <div style={{ maxWidth: 800, margin: '0 auto', padding: '20px 16px' }}>

                        {/* Editor Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ width: 40, height: 40, background: 'rgba(24,119,242,0.1)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Palette size={20} color="#1877F2" />
                                </div>
                                <div>
                                    <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{editing === 'new' ? 'New Clock Preset' : 'Edit Preset'}</h1>
                                    <p style={{ fontSize: 12, color: '#64748B', margin: 0 }}>Configure display theme and options</p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={() => setEditing(null)} style={btnSecondary}>Cancel</button>
                                <button onClick={handleSave} disabled={saving || !formName.trim()} style={{ ...btnPrimary, opacity: saving || !formName.trim() ? 0.5 : 1 }}>
                                    {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <><Check size={16} /> Saved!</> : <><Save size={16} /> Save</>}
                                </button>
                            </div>
                        </div>

                        {/* Name */}
                        <div style={panelStyle}>
                            <label style={labelStyle}>Preset Name *</label>
                            <input
                                type="text"
                                value={formName}
                                onChange={e => setFormName(e.target.value)}
                                placeholder="e.g., Friday Night $100 Tournament"
                                style={inputStyle}
                            />
                            <label style={{ ...labelStyle, marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input type="checkbox" checked={formDefault} onChange={e => setFormDefault(e.target.checked)} style={{ accentColor: '#1877F2' }} />
                                Set as Default Preset
                            </label>
                        </div>

                        {/* Live Preview */}
                        <div style={{ ...panelStyle, overflow: 'hidden' }}>
                            <p style={{ fontSize: 11, color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Live Preview</p>
                            <div style={{
                                background: formDisplay.background_image_url ? `url(${formDisplay.background_image_url}) center/cover` : formTheme.background,
                                borderRadius: 12, padding: 24, textAlign: 'center', border: '1px solid rgba(255,255,255,0.1)' }}>
                                {formDisplay.logo_url && <img src={formDisplay.logo_url} alt="" style={{ height: 32, marginBottom: 8, opacity: 0.8 }} loading="lazy" decoding="async" />}
                                <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 3, marginBottom: 2, color: formTheme.accent }}>
                                    Level 8
                                </p>
                                <p style={{ fontSize: 56, fontWeight: 800, fontFamily: "var(--font-inter), 'Segoe UI', sans-serif", fontFeatureSettings: "'zero' 0", margin: 0, lineHeight: 1, color: formTheme.text }}>
                                    12:00
                                </p>
                                <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '8px 16px', margin: '8px 0', border: '1px solid rgba(255,255,255,0.1)' }}>
                                    <p style={{ fontSize: 12, opacity: 0.7, margin: 0, color: formTheme.text }}>No Limit Texas Hold 'Em</p>
                                    <p style={{ fontSize: 16, fontWeight: 600, opacity: 0.4, margin: '2px 0', color: formTheme.text }}>Blinds</p>
                                    <p style={{ fontSize: 32, fontWeight: 800, margin: 0, color: formTheme.blinds }}>400 / 800</p>
                                    <p style={{ fontSize: 10, opacity: 0.5, margin: '2px 0', color: formTheme.accent }}>Ante: 100 • Next: 500/1,000</p>
                                </div>
                                {formDisplay.show_prize_pool && (
                                    <p style={{ fontSize: 11, opacity: 0.5, color: formTheme.text }}>Prize Pool: $5,000.00</p>
                                )}
                            </div>
                        </div>

                        {/* Theme Colors */}
                        <div style={panelStyle}>
                            <p style={sectionTitle}>Theme Colors</p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                {[
                                    { key: 'background', label: 'Background' },
                                    { key: 'text', label: 'Clock Text' },
                                    { key: 'accent', label: 'Accent / Level Info' },
                                    { key: 'blinds', label: 'Blinds Text' },
                                ].map(({ key, label }) => (
                                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <input
                                            type="color" value={formTheme[key]}
                                            onChange={e => setFormTheme({ ...formTheme, [key]: e.target.value })}
                                            style={{ width: 36, height: 36, borderRadius: 8, border: '2px solid #1E3A5F', cursor: 'pointer', background: 'transparent' }}
                                        />
                                        <div>
                                            <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: '#fff' }}>{label}</p>
                                            <p style={{ fontSize: 10, color: '#64748B', fontFamily: 'monospace', margin: 0 }}>{formTheme[key]}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Quick Theme Buttons */}
                            <p style={{ ...sectionTitle, marginTop: 16, fontSize: 10 }}>Quick Themes</p>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {STARTER_THEMES.map(st => (
                                    <button
                                        key={st.name}
                                        onClick={() => setFormTheme({ ...st.theme })}
                                        style={{
                                            padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)',
                                            background: st.theme.background, color: '#fff', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                                    >{st.name}</button>
                                ))}
                            </div>
                        </div>

                        {/* Display Options */}
                        <div style={panelStyle}>
                            <p style={sectionTitle}>Display Options</p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                {[
                                    { key: 'show_prize_pool', label: 'Prize Pool', icon: '💰' },
                                    { key: 'show_payouts', label: 'Payout Bar', icon: '🏆' },
                                    { key: 'show_icm', label: 'ICM Values', icon: '📊' },
                                    { key: 'show_chip_chop', label: 'Chip Chop', icon: '✂️' },
                                    { key: 'show_chip_colors', label: 'Chip Colors', icon: '🎨' },
                                    { key: 'show_next_round', label: 'Next Round', icon: '⏭' },
                                    { key: 'show_schedule_preview', label: 'Blind Schedule (Next 5)', icon: '📋' },
                                    { key: 'show_seating', label: 'Seating Chart', icon: '🪑' },
                                ].map(({ key, label, icon }) => (
                                    <label key={key} style={{
                                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
                                        background: formDisplay[key] ? 'rgba(24,119,242,0.1)' : 'rgba(255,255,255,0.03)',
                                        border: `1px solid ${formDisplay[key] ? 'rgba(24,119,242,0.3)' : 'rgba(255,255,255,0.08)'}`,
                                        cursor: 'pointer', transition: 'all 0.2s' }}>
                                        <input type="checkbox" checked={formDisplay[key]} onChange={e => setFormDisplay({ ...formDisplay, [key]: e.target.checked })} style={{ accentColor: '#1877F2' }} />
                                        <span style={{ fontSize: 12, fontWeight: 500 }}>{icon} {label}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Screen Cycling */}
                        <div style={panelStyle}>
                            <p style={sectionTitle}>Screen Cycling</p>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                <input type="checkbox" checked={formDisplay.screen_cycle_enabled} onChange={e => setFormDisplay({ ...formDisplay, screen_cycle_enabled: e.target.checked })} style={{ accentColor: '#1877F2' }} />
                                <span style={{ fontSize: 13, fontWeight: 500 }}>Auto-rotate between display screens</span>
                            </label>
                            {formDisplay.screen_cycle_enabled && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <label style={{ fontSize: 12, color: '#64748B' }}>Cycle every</label>
                                    <input
                                        type="number" min="5" max="120" value={formDisplay.screen_cycle_interval}
                                        onChange={e => setFormDisplay({ ...formDisplay, screen_cycle_interval: parseInt(e.target.value) || 15 })}
                                        style={{ ...inputStyle, width: 80 }}
                                    />
                                    <label style={{ fontSize: 12, color: '#64748B' }}>seconds</label>
                                </div>
                            )}
                        </div>

                        {/* Sound & Display */}
                        <div style={panelStyle}>
                            <p style={sectionTitle}>Sound Alerts</p>
                            <div style={{ marginBottom: 12 }}>
                                <label style={labelStyle}>Sound Pack</label>
                                <select
                                    value={formDisplay.sound_pack || 'classic'}
                                    onChange={e => setFormDisplay({ ...formDisplay, sound_pack: e.target.value })}
                                    style={{ ...inputStyle, cursor: 'pointer' }}
                                >
                                    {SOUND_PACKS.map(sp => (
                                        <option key={sp.value} value={sp.value}>{sp.label} — {sp.desc}</option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {[
                                    { key: 'sound_level_change', label: 'Level Change Alert' },
                                    { key: 'sound_break', label: 'Break Start Alert' },
                                    { key: 'sound_final_table', label: 'Final Table Alert' },
                                ].map(({ key, label }) => (
                                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                        <input type="checkbox" checked={formDisplay[key]} onChange={e => setFormDisplay({ ...formDisplay, [key]: e.target.checked })} style={{ accentColor: '#1877F2' }} />
                                        {formDisplay[key] ? <Volume2 size={14} color="#1877F2" /> : <VolumeX size={14} color="#64748B" />}
                                        {label}
                                    </label>
                                ))}
                            </div>

                            <p style={{ ...sectionTitle, marginTop: 16 }}>Display Protection</p>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                <input type="checkbox" checked={formDisplay.burn_in_prevention} onChange={e => setFormDisplay({ ...formDisplay, burn_in_prevention: e.target.checked })} style={{ accentColor: '#1877F2' }} />
                                <MonitorPlay size={14} color={formDisplay.burn_in_prevention ? '#1877F2' : '#64748B'} />
                                Burn-in Prevention (subtle pixel shift for OLED/plasma TVs)
                            </label>
                        </div>

                        {/* Chip Denominations */}
                        <div style={panelStyle}>
                            <p style={sectionTitle}>Chip Denominations</p>
                            <p style={{ fontSize: 11, color: '#64748B', marginBottom: 10 }}>Configure chip values and colors shown on the clock display. Obsolete chips auto-dim based on current blinds.</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {(formDisplay.chip_denominations || DEFAULT_DISPLAY_OPTIONS.chip_denominations).map((chip, idx) => (
                                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                        <input
                                            type="color" value={chip.color || '#333'}
                                            onChange={e => {
                                                const updated = [...(formDisplay.chip_denominations || DEFAULT_DISPLAY_OPTIONS.chip_denominations)];
                                                updated[idx] = { ...updated[idx], color: e.target.value };
                                                setFormDisplay({ ...formDisplay, chip_denominations: updated });
                                            }}
                                            style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid #1E3A5F', cursor: 'pointer', background: 'transparent' }}
                                        />
                                        <input
                                            type="number" value={chip.value}
                                            onChange={e => {
                                                const updated = [...(formDisplay.chip_denominations || DEFAULT_DISPLAY_OPTIONS.chip_denominations)];
                                                const val = parseInt(e.target.value) || 0;
                                                updated[idx] = { ...updated[idx], value: val, label: val.toLocaleString() };
                                                setFormDisplay({ ...formDisplay, chip_denominations: updated });
                                            }}
                                            style={{ ...inputStyle, width: 100, padding: '6px 8px', fontSize: 13 }}
                                            placeholder="Value"
                                        />
                                        <span style={{ fontSize: 12, color: '#94A3B8', flex: 1 }}>{chip.label}</span>
                                        <button
                                            onClick={() => {
                                                const updated = [...(formDisplay.chip_denominations || DEFAULT_DISPLAY_OPTIONS.chip_denominations)];
                                                updated.splice(idx, 1);
                                                setFormDisplay({ ...formDisplay, chip_denominations: updated });
                                            }}
                                            style={{ ...iconBtn, color: '#EF4444' }}
                                            title="Remove"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <button
                                onClick={() => {
                                    const updated = [...(formDisplay.chip_denominations || DEFAULT_DISPLAY_OPTIONS.chip_denominations)];
                                    const maxVal = updated.length > 0 ? Math.max(...updated.map(c => c.value)) : 0;
                                    const newVal = maxVal > 0 ? maxVal * 5 : 100;
                                    updated.push({ value: newVal, color: '#555555', label: newVal.toLocaleString() });
                                    updated.sort((a, b) => a.value - b.value);
                                    setFormDisplay({ ...formDisplay, chip_denominations: updated });
                                }}
                                style={{ ...btnSecondary, marginTop: 8, fontSize: 12, padding: '6px 12px' }}
                            >
                                <Plus size={14} /> Add Chip
                            </button>
                        </div>

                        {/* Custom Branding */}
                        <div style={panelStyle}>
                            <p style={sectionTitle}>Custom Branding</p>
                            <label style={labelStyle}>Logo URL</label>
                            <input type="text" value={formDisplay.logo_url} onChange={e => setFormDisplay({ ...formDisplay, logo_url: e.target.value })} placeholder="https://your-venue.com/logo.png" style={inputStyle} />
                            {formDisplay.logo_url && (
                                <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <img
                                        src={formDisplay.logo_url}
                                        alt="Logo preview"
                                        style={{ height: 36, maxWidth: 200, objectFit: 'contain', borderRadius: 4 }}
                                        onError={e => { e.target.style.display = 'none'; }}
                                        loading="lazy"
                                        decoding="async"
                                    />
                                    <span style={{ fontSize: 11, color: '#64748B' }}>Logo preview</span>
                                </div>
                            )}
                            <label style={{ ...labelStyle, marginTop: 12 }}>Background Image URL</label>
                            <input type="text" value={formDisplay.background_image_url} onChange={e => setFormDisplay({ ...formDisplay, background_image_url: e.target.value })} placeholder="https://your-venue.com/background.jpg" style={inputStyle} />
                        </div>

                    </div>
                </div>
            </CommanderLayout>
        );
    }

    // ======= LIST VIEW =======
    return (
        <CommanderLayout title="Clock Setup | Commander" backHref="/commander/dashboard?card=tournaments">
            <SEOHead title="Commander — Clock Setup" description="Tournament clock display presets" noindex={true} />
            <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: "var(--font-inter), sans-serif" }}>
                <div style={{ maxWidth: 700, margin: '0 auto', padding: '20px 16px' }}>

                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 40, height: 40, background: 'rgba(24,119,242,0.1)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Palette size={20} color="#1877F2" />
                            </div>
                            <div>
                                <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Clock Presets</h1>
                                <p style={{ fontSize: 12, color: '#64748B', margin: 0 }}>Named themes for tournament clock displays</p>
                            </div>
                        </div>
                        <button onClick={() => startNew()} style={btnPrimary}>
                            <Plus size={16} /> New Preset
                        </button>
                    </div>

                    {/* Preset List */}
                    {loading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                            <Loader2 size={24} className="animate-spin" color="#1877F2" />
                        </div>
                    ) : presets.length === 0 ? (
                        <div style={{ ...panelStyle, textAlign: 'center', padding: 40 }}>
                            <Palette size={40} color="#4A5E78" style={{ margin: '0 auto 12px' }} />
                            <p style={{ color: '#64748B', marginBottom: 4 }}>No clock presets yet</p>
                            <p style={{ color: '#4A5E78', fontSize: 12, marginBottom: 16 }}>Create one or start from a template below</p>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                                {STARTER_THEMES.map(st => (
                                    <button key={st.name} onClick={() => startNew(st)} style={{
                                        padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
                                        background: st.theme.background, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{st.name}</button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {presets.map(preset => (
                                <div key={preset.id} style={{
                                    ...panelStyle, padding: 0, overflow: 'hidden',
                                    display: 'flex', alignItems: 'stretch' }}>
                                    {/* Color swatch */}
                                    <div style={{ width: 6, background: preset.theme?.accent || '#1877F2', flexShrink: 0 }} />
                                    <div style={{ flex: 1, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                                        {/* Preview dot */}
                                        <div style={{
                                            width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                                            background: preset.theme?.background || '#0D192E',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            border: `2px solid ${preset.theme?.accent || '#1877F2'}30` }}>
                                            <span style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace', color: preset.theme?.text || '#fff' }}>12</span>
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <p style={{ fontSize: 15, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preset.name}</p>
                                                {preset.is_default && (
                                                    <span style={{ fontSize: 9, fontWeight: 700, color: '#F59E0B', background: 'rgba(245,158,11,0.1)', padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase' }}>Default</span>
                                                )}
                                            </div>
                                            <p style={{ fontSize: 11, color: '#64748B', margin: 0 }}>
                                                {[
                                                    preset.display_options?.show_icm && 'ICM',
                                                    preset.display_options?.show_payouts && 'Payouts',
                                                    preset.display_options?.show_schedule_preview && 'Schedule',
                                                    preset.display_options?.screen_cycle_enabled && 'Cycling',
                                                ].filter(Boolean).join(' • ') || 'Standard display'}
                                            </p>
                                        </div>
                                        <div style={{ display: 'flex', gap: 4 }}>
                                            <button onClick={() => duplicatePreset(preset)} title="Duplicate" style={iconBtn}><Copy size={14} /></button>
                                            <button onClick={() => startEdit(preset)} title="Edit" style={iconBtn}><Palette size={14} /></button>
                                            <button onClick={() => handleDelete(preset.id)} title="Delete" style={{ ...iconBtn, color: '#EF4444' }}><Trash2 size={14} /></button>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* Add from template */}
                            <div style={{ marginTop: 8 }}>
                                <p style={{ fontSize: 10, color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Quick Add From Template</p>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {STARTER_THEMES.map(st => (
                                        <button key={st.name} onClick={() => startNew(st)} style={{
                                            padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)',
                                            background: st.theme.background, color: '#fff', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>{st.name}</button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        
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
    
      <ConfirmDialog />
    </CommanderLayout>
    );
}

// ── Inline Styles ──
const panelStyle = {
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12, padding: 16, marginBottom: 12 };
const labelStyle = { fontSize: 12, fontWeight: 600, color: '#94A3B8', marginBottom: 4, display: 'block' };
const sectionTitle = { fontSize: 11, color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, marginTop: 0 };
const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 8, border: '2px solid #1E3A5F',
    background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: 14, fontFamily: "var(--font-inter), sans-serif",
    outline: 'none', boxSizing: 'border-box' };
const btnPrimary = {
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8,
    border: 'none', background: '#1877F2', color: '#fff', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: "var(--font-inter), sans-serif" };
const btnSecondary = {
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8,
    border: '2px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#94A3B8',
    fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "var(--font-inter), sans-serif" };
const iconBtn = {
    padding: 6, borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)',
    background: 'transparent', color: '#94A3B8', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center' };
