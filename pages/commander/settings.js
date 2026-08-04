/**
 * Commander Settings Page - Venue and staff settings
 * Dark industrial sci-fi gaming theme
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Bell, Clock, Users, Save, Loader2, ChevronRight, DollarSign, Package, Image, Upload, X as XIcon, Shield } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { broadcastChange, useCommanderSync } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

export default function CommanderSettingsPage() {
  const router = useRouter();
  useEffect(() => { busEmit.sessionStart('commander-settings'); }, []);

  const [staff, setStaff] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [venue, setVenue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Settings state
  const [settings, setSettings] = useState({
    auto_refresh_interval: 30,
    default_wait_time_per_player: 15,
    sms_notifications_enabled: true,
    push_notifications_enabled: true,
    max_waitlist_size: 50,
    call_timeout_minutes: 5,
    show_player_names_on_display: false,
    venue_type: 'texas',
    time_billing_rate: 12,
    auto_comp_rate: 1,
    bulk_time_packages: [],
    security_gate_enabled: true });

  // Check staff session
  useEffect(() => {
    const storedStaff = getStaffSession();
    if (!storedStaff) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
      return;
    }

    try {
      const staffData = JSON.parse(storedStaff);
      if (!staffData.venue_id) {
        router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
        return;
      }
      setStaff(staffData);
      setVenueId(staffData.venue_id);
      if (staffData.venue_name) {
        setVenue({ id: staffData.venue_id, name: staffData.venue_name });
      }
      setLoading(false);
    } catch (err) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    }
  }, [router]);

  // Load venue settings
  useEffect(() => {
    if (!venueId) return;
    const storedStaffData = getStaffSession();
    if (!storedStaffData) return;
    const controller = new AbortController();
    try {
      commanderFetch('/api/commander/settings', {
        headers: { 'x-staff-session': storedStaffData },
        signal: controller.signal,
      })
        .then(r => r.json())
        .then(data => {
          if (data?.data) {
            setSettings(prev => ({
              ...prev,
              auto_refresh_interval: data.data.auto_refresh_interval ?? prev.auto_refresh_interval,
              show_player_names_on_display: data.data.show_player_names_on_display ?? prev.show_player_names_on_display,
              sms_notifications_enabled: data.data.sms_notifications_enabled ?? prev.sms_notifications_enabled,
              push_notifications_enabled: data.data.push_notifications_enabled ?? prev.push_notifications_enabled,
              max_waitlist_size: data.data.max_waitlist_size ?? prev.max_waitlist_size,
              call_timeout_minutes: data.data.call_timeout_minutes ?? prev.call_timeout_minutes,
              default_wait_time_per_player: data.data.default_wait_time_per_player ?? prev.default_wait_time_per_player,
              venue_type: data.data.venue_type ?? prev.venue_type,
              time_billing_rate: data.data.time_billing_rate ?? prev.time_billing_rate,
              auto_comp_rate: data.data.auto_comp_rate ?? prev.auto_comp_rate,
              bulk_time_packages: data.data.bulk_time_packages ?? prev.bulk_time_packages,
              security_gate_enabled: data.data.security_gate_enabled ?? true }));
            // Persist security gate state to localStorage for CommanderLayout
            localStorage.setItem('commander_security_gate', data.data.security_gate_enabled === false ? 'off' : 'on');
            // Load logo URL
            if (data.data.club_logo_url !== undefined) {
              setLogoUrl(data.data.club_logo_url || null);
            }
          }
        })
        .catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    return () => controller.abort();
  }, [venueId]);

  // Cross-tab + cross-device real-time sync — reload settings when changed from other pages
  const syncSettings = useCallback(() => {
    if (!venueId) return;
    const storedStaffData = getStaffSession();
    if (!storedStaffData) return;
    commanderFetch('/api/commander/settings', { headers: { 'x-staff-session': storedStaffData } })
      .then(r => r.json())
      .then(data => {
        if (data?.data) {
          setSettings(prev => ({
            ...prev,
            auto_refresh_interval: data.data.auto_refresh_interval ?? prev.auto_refresh_interval,
            show_player_names_on_display: data.data.show_player_names_on_display ?? prev.show_player_names_on_display,
            sms_notifications_enabled: data.data.sms_notifications_enabled ?? prev.sms_notifications_enabled,
            push_notifications_enabled: data.data.push_notifications_enabled ?? prev.push_notifications_enabled,
            max_waitlist_size: data.data.max_waitlist_size ?? prev.max_waitlist_size,
            call_timeout_minutes: data.data.call_timeout_minutes ?? prev.call_timeout_minutes,
            default_wait_time_per_player: data.data.default_wait_time_per_player ?? prev.default_wait_time_per_player,
            venue_type: data.data.venue_type ?? prev.venue_type,
            time_billing_rate: data.data.time_billing_rate ?? prev.time_billing_rate,
            auto_comp_rate: data.data.auto_comp_rate ?? prev.auto_comp_rate,
            bulk_time_packages: data.data.bulk_time_packages ?? prev.bulk_time_packages,
            security_gate_enabled: data.data.security_gate_enabled ?? true }));
          localStorage.setItem('commander_security_gate', data.data.security_gate_enabled === false ? 'off' : 'on');
          if (data.data.club_logo_url !== undefined) setLogoUrl(data.data.club_logo_url || null);
        }
      })
      .catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
  }, [venueId]);

  useCommanderSync(venueId, syncSettings, { entities: ['settings'] });

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const staffSession = getStaffSession() || '';

      if (!staffSession) {
        setError('Authentication required. Please log in again.');
        setSaving(false);
        return;
      }

      // Save display/waitlist settings via PUT (upserts to commander_venue_settings)
      // Note: hard_stop settings managed from Room Presets page
      const res = await commanderFetch('/api/commander/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_refresh_interval: settings.auto_refresh_interval,
          show_player_names_on_display: settings.show_player_names_on_display,
          sms_notifications_enabled: settings.sms_notifications_enabled,
          push_notifications_enabled: settings.push_notifications_enabled,
          max_waitlist_size: settings.max_waitlist_size,
          call_timeout_minutes: settings.call_timeout_minutes,
          default_wait_time_per_player: settings.default_wait_time_per_player,
          venue_type: settings.venue_type,
          time_billing_rate: settings.time_billing_rate,
          auto_comp_rate: settings.auto_comp_rate,
          bulk_time_packages: settings.bulk_time_packages,
          security_gate_enabled: settings.security_gate_enabled
        })
      });
      if (!res.ok) throw new Error('Request failed');

      const data = await res.json();
      if (data.success) {
        broadcastChange('settings');
        busEmit.celebration('confetti');
        // Store security gate state for CommanderLayout to read
        localStorage.setItem('commander_security_gate', settings.security_gate_enabled === false ? 'off' : 'on');
        setSuccess('Settings saved successfully');
        setIsDirty(false);
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(typeof data.error === 'string' ? data.error : (data.error?.message || 'Failed to save settings'));
      }
    } catch (err) {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(key) {
    const newValue = !settings[key];
    setSettings(prev => ({ ...prev, [key]: newValue }));

    // Auto-save toggle instantly
    try {
      const staffSession = getStaffSession();
      const res = await commanderFetch('/api/commander/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: newValue })
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      if (data.success) {
        broadcastChange('settings');
        if (key === 'security_gate_enabled') {
          localStorage.setItem('commander_security_gate', newValue === false ? 'off' : 'on');
        }
      } else {
        // Rollback on server error
        setSettings(prev => ({ ...prev, [key]: !newValue }));
        setError(typeof data.error === 'string' ? data.error : 'Failed to save toggle');
        setTimeout(() => setError(null), 3000);
      }
    } catch (err) {
      console.warn('Failed to auto-save toggle', err);
      // Rollback on network error
      setSettings(prev => ({ ...prev, [key]: !newValue }));
      setError('Network error saving toggle');
      setTimeout(() => setError(null), 3000);
    }
  }

  function handleChange(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }

  if (!staff || loading) {
    return (
      <div className="cmd-page flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
      </div>
    );
  }

  // Check if user has settings permission
  const canManageSettings = staff.permissions?.manage_settings !== false;

  return (
    <CommanderLayout title={`Settings | ${venue?.name || 'Commander'}`} backHref="/commander/dashboard?card=reports">
      <>
        <SEOHead
          title="Commander — Settings"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />

        <div className="cmd-page">
          {/* Main Content */}
          <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
            {/* Floating Save Bar — only shows when dirty */}
            {canManageSettings && isDirty && (
              <div style={{
                position: 'sticky', top: 56, zIndex: 40,
                background: 'linear-gradient(135deg, #1877F2 0%, #166FE5 100%)',
                borderRadius: 12, padding: '12px 20px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                boxShadow: '0 4px 20px rgba(24,119,242,0.4)',
                animation: 'slideDown 0.2s ease-out' }}>
                <p style={{ color: '#fff', fontSize: 14, fontWeight: 600, margin: 0 }}>You have unsaved changes</p>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 20px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.2)', color: '#fff',
                    border: '1px solid rgba(255,255,255,0.3)',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            )}

            {/* Alerts */}
            {success && (
              <div className="p-4 bg-[#31A24C]/10 rounded-xl">
                <p className="text-sm text-[#31A24C] font-medium">{success}</p>
              </div>
            )}
            {error && (
              <div className="p-4 bg-[#EF4444]/10 rounded-xl">
                <p className="text-sm text-[#EF4444]">{error}</p>
              </div>
            )}

            {!canManageSettings && (
              <div className="p-4 bg-[#F59E0B]/10 rounded-xl">
                <p className="text-sm text-[#F59E0B]">
                  You don't have permission to modify settings. Contact a manager.
                </p>
              </div>
            )}

            {/* ── Security Gate Toggle (OWNER ONLY) ── */}
            {staff.role === 'owner' && (
              <section className="cmd-panel">
                <div className="p-4 border-b border-[#3A3B3C]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#EF4444]/10 rounded-lg flex items-center justify-center">
                      <Shield className="w-5 h-5 text-[#EF4444]" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-white">Security Gate</h2>
                      <p className="text-xs text-[#B0B3B8]">PIN verification for restricted pages (Owner Only)</p>
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-[#3A3B3C]">
                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-white">Require PIN For Sensitive Pages</p>
                      <p className="text-sm text-[#B0B3B8]">Staff, Settings, Analytics, Reports, Close Day, Exports</p>
                    </div>
                    <button
                      onClick={() => handleToggle('security_gate_enabled')}
                      className={`w-12 h-7 rounded-full transition-colors relative ${settings.security_gate_enabled ? 'bg-[#31A24C]' : 'bg-[#3A3B3C]'
                        }`}
                    >
                      <span
                        className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.security_gate_enabled ? 'right-1' : 'left-1'
                          }`}
                      />
                    </button>
                  </div>
                  {!settings.security_gate_enabled && (
                    <div className="px-4 py-3 bg-[#F59E0B]/5">
                      <p className="text-xs text-[#F59E0B] flex items-center gap-1.5">
                        Security gate is OFF — restricted pages are accessible without PIN verification
                      </p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* ── Club Branding (Logo Upload) ── */}
            <section className="cmd-panel">
              <div className="p-4 border-b border-[#3A3B3C]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#8B5CF6]/10 rounded-lg flex items-center justify-center">
                    <Image className="w-5 h-5 text-[#8B5CF6]" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-white">Club Branding</h2>
                    <p className="text-xs text-[#B0B3B8]">Logo appears on all TV displays and menus</p>
                  </div>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-6">
                  {/* Logo Preview */}
                  <div style={{
                    width: 80, height: 80, borderRadius: 16, overflow: 'hidden',
                    background: '#242526', border: '2px solid #3A3B3C',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0 }}>
                    {logoUrl ? (
                      <img src={logoUrl} alt="Club Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                    ) : (
                      <span style={{
                        fontSize: 36, fontWeight: 900, color: '#4A5E78',
                        fontFamily: "var(--font-orbitron), sans-serif", textTransform: 'uppercase' }}>
                        {(venue?.name || 'P').charAt(0)}
                      </span>
                    )}
                  </div>

                  {/* Upload / Remove */}
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <label className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors
                        ${canManageSettings ? 'bg-[#1877F2] text-white hover:bg-[#166FE5]' : 'bg-[#3A3B3C] text-[#B0B3B8] cursor-not-allowed'}`}>
                        {logoUploading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4" />
                        )}
                        {logoUploading ? 'Uploading...' : 'Upload Logo'}
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                          className="hidden" disabled={!canManageSettings || logoUploading}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 5 * 1024 * 1024) {
                              setError('File too large. Maximum 5MB.');
                              return;
                            }
                            setLogoUploading(true);
                            setError(null);
                            try {
                              const staffSession = getStaffSession() || '';
                              // Read file as base64
                              const base64 = await new Promise((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onload = () => resolve(reader.result.split(',')[1]);
                                reader.onerror = reject;
                                reader.readAsDataURL(file);
                              });
                              const res = await commanderFetch('/api/commander/settings/logo', {
                                method: 'POST',
                                headers: {
                                  'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                  data: base64,
                                  filename: file.name,
                                  contentType: file.type
                                })
                              });
                              if (!res.ok) throw new Error(`Request failed (${res.status})`);
                              const json = await res.json();
                              if (json.success) {
                                setLogoUrl(json.data.club_logo_url);
                                localStorage.removeItem('commander_branding');
                                broadcastChange('settings');
                                setSuccess('Logo uploaded successfully!');
                                setTimeout(() => setSuccess(null), 3000);
                              } else {
                                const errMsg = typeof json.error === 'string' ? json.error : (json.error?.message || 'Upload failed');
                                setError(errMsg);
                              }
                            } catch (err) { setError('Upload failed: ' + (err.message || 'Network error')); }
                            setLogoUploading(false);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {logoUrl && canManageSettings && (
                        <button onClick={async () => {
                          try {
                            const staffSession = getStaffSession() || '';
                            const json = await commanderFetchJSON('/api/commander/settings/logo', {
                              method: 'DELETE'});
                            if (json.success) {
                              setLogoUrl(null);
                              localStorage.removeItem('commander_branding');
                              broadcastChange('settings');
                              setSuccess('Logo removed');
                              setTimeout(() => setSuccess(null), 3000);
                            }
                          } catch { setError('Failed to remove logo'); }
                        }}
                          className="flex items-center gap-1 px-3 py-2.5 rounded-lg text-sm font-medium text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors"
                        >
                          <XIcon className="w-4 h-4" />
                          Remove
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-[#64748B]">PNG, JPG, WebP, or SVG. Max 5MB. Recommended: 200×200px square.</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Notifications */}
            <section className="cmd-panel">
              <div className="p-4 border-b border-[#3A3B3C]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#1877F2]/10 rounded-lg flex items-center justify-center">
                    <Bell className="w-5 h-5 text-[#1877F2]" />
                  </div>
                  <h2 className="font-semibold text-white">Notifications</h2>
                </div>
              </div>
              <div className="divide-y divide-[#3A3B3C]">
                <SettingToggle
                  label="SMS Notifications"
                  description="Send Text Messages When Calling Players"
                  enabled={settings.sms_notifications_enabled}
                  onChange={() => handleToggle('sms_notifications_enabled')}
                  disabled={!canManageSettings}
                />
                <SettingToggle
                  label="Push Notifications"
                  description="Send App Notifications To Players"
                  enabled={settings.push_notifications_enabled}
                  onChange={() => handleToggle('push_notifications_enabled')}
                  disabled={!canManageSettings}
                />
              </div>
            </section>

            {/* Waitlist */}
            <section className="cmd-panel">
              <div className="p-4 border-b border-[#3A3B3C]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#F59E0B]/10 rounded-lg flex items-center justify-center">
                    <Clock className="w-5 h-5 text-[#F59E0B]" />
                  </div>
                  <h2 className="font-semibold text-white">Waitlist</h2>
                </div>
              </div>
              <div className="divide-y divide-[#3A3B3C]">
                <SettingNumber
                  label="Call Timeout (minutes)"
                  description="Time Player Has To Respond After Being Called"
                  value={settings.call_timeout_minutes}
                  onChange={(v) => handleChange('call_timeout_minutes', v)}
                  min={1}
                  max={15}
                  disabled={!canManageSettings}
                />
                <SettingNumber
                  label="Max Waitlist Size"
                  description="Maximum Players Per Waitlist"
                  value={settings.max_waitlist_size}
                  onChange={(v) => handleChange('max_waitlist_size', v)}
                  min={10}
                  max={100}
                  disabled={!canManageSettings}
                />
                <SettingNumber
                  label="Est. Wait Per Player (min)"
                  description="Used To Calculate Wait Times"
                  value={settings.default_wait_time_per_player}
                  onChange={(v) => handleChange('default_wait_time_per_player', v)}
                  min={5}
                  max={60}
                  disabled={!canManageSettings}
                />
              </div>
            </section>

            {/* Display */}
            <section className="cmd-panel">
              <div className="p-4 border-b border-[#3A3B3C]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#31A24C]/10 rounded-lg flex items-center justify-center">
                    <Users className="w-5 h-5 text-[#31A24C]" />
                  </div>
                  <h2 className="font-semibold text-white">Display</h2>
                </div>
              </div>
              <div className="divide-y divide-[#3A3B3C]">
                <SettingToggle
                  label="Show Player Names"
                  description="Display Full Names On Public Screens"
                  enabled={settings.show_player_names_on_display}
                  onChange={() => handleToggle('show_player_names_on_display')}
                  disabled={!canManageSettings}
                />
                <SettingNumber
                  label="Auto-Refresh Interval (sec)"
                  description="How Often To Refresh Data"
                  value={settings.auto_refresh_interval}
                  onChange={(v) => handleChange('auto_refresh_interval', v)}
                  min={10}
                  max={120}
                  disabled={!canManageSettings}
                />
              </div>
            </section>

            {/* Time Billing */}
            <section className="cmd-panel">
              <div className="p-4 border-b border-[#3A3B3C]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#1877F2]/10 rounded-lg flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-[#1877F2]" />
                  </div>
                  <h2 className="font-semibold text-white">Time Billing</h2>
                </div>
              </div>
              <div className="divide-y divide-[#3A3B3C]">
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-white">Venue Type</p>
                    <p className="text-sm text-[#B0B3B8]">Texas = Prepaid Time, Charity = No Time Billing</p>
                  </div>
                  <div className="flex rounded-lg overflow-hidden border border-[#3A3B3C]">
                    {['texas', 'charity'].map(t => (
                      <button key={t} onClick={() => handleChange('venue_type', t)}
                        disabled={!canManageSettings}
                        className={`px-4 py-2 text-sm font-medium capitalize ${settings.venue_type === t ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'} disabled:opacity-50`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <SettingNumber
                  label="Time Rate ($/hour)"
                  description="Hourly Rate Charged For Table Time"
                  value={settings.time_billing_rate}
                  onChange={(v) => handleChange('time_billing_rate', v)}
                  min={1}
                  max={100}
                  disabled={!canManageSettings || settings.venue_type !== 'texas'}
                />
                <SettingNumber
                  label="Auto-Comp Rate ($/hour)"
                  description="Comps Earned Per Hour Of Play"
                  value={settings.auto_comp_rate}
                  onChange={(v) => handleChange('auto_comp_rate', v)}
                  min={0}
                  max={25}
                  step={0.25}
                  disabled={!canManageSettings}
                />
              </div>
            </section>

            {/* Bulk Time Packages */}
            <section className="cmd-panel">
              <div className="p-4 border-b border-[#3A3B3C]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#F59E0B]/10 rounded-lg flex items-center justify-center">
                    <Package className="w-5 h-5 text-[#F59E0B]" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-semibold text-white">Bulk Time Packages</h2>
                    <p className="text-xs text-[#B0B3B8]">Deals for players who buy time in bulk</p>
                  </div>
                  {canManageSettings && (
                    <button onClick={() => {
                      const pkgs = [...(settings.bulk_time_packages || [])];
                      pkgs.push({ name: '', hours: 5, price: 50, active: true });
                      handleChange('bulk_time_packages', pkgs);
                    }} className="px-3 py-1.5 rounded-lg bg-[#1877F2] text-white text-xs font-medium">
                      + Add Package
                    </button>
                  )}
                </div>
              </div>
              <div className="divide-y divide-[#3A3B3C]">
                {(!settings.bulk_time_packages || settings.bulk_time_packages.length === 0) ? (
                  <div className="p-6 text-center">
                    <p className="text-sm text-[#B0B3B8]">No bulk packages configured</p>
                    <p className="text-xs text-[#64748B] mt-1">Add packages for discounted bulk time purchases</p>
                  </div>
                ) : (
                  settings.bulk_time_packages.map((pkg, idx) => (
                    <div key={idx} className="p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <input type="text" value={pkg.name} placeholder={`Package ${idx + 1}`}
                          onChange={e => {
                            const pkgs = [...settings.bulk_time_packages];
                            pkgs[idx] = { ...pkgs[idx], name: e.target.value };
                            handleChange('bulk_time_packages', pkgs);
                          }}
                          disabled={!canManageSettings}
                          className="flex-1 px-3 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-white text-sm focus:outline-none focus:border-[#1877F2] disabled:opacity-50" />
                        <button onClick={() => {
                          const pkgs = settings.bulk_time_packages.filter((_, i) => i !== idx);
                          handleChange('bulk_time_packages', pkgs);
                        }} disabled={!canManageSettings}
                          className="p-2 text-[#EF4444] hover:bg-[#EF4444]/10 rounded-lg text-xs font-bold disabled:opacity-50">X</button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-[#B0B3B8] block mb-1">Hours</label>
                          <input type="number" value={pkg.hours} min={1} max={100}
                            onChange={e => {
                              const pkgs = [...settings.bulk_time_packages];
                              pkgs[idx] = { ...pkgs[idx], hours: parseInt(e.target.value) || 1 };
                              handleChange('bulk_time_packages', pkgs);
                            }}
                            disabled={!canManageSettings}
                            className="w-full px-2 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-white text-sm text-center focus:outline-none focus:border-[#1877F2] disabled:opacity-50" />
                        </div>
                        <div>
                          <label className="text-[10px] text-[#B0B3B8] block mb-1">Price ($)</label>
                          <input type="number" value={pkg.price} min={0} step={0.01}
                            onChange={e => {
                              const pkgs = [...settings.bulk_time_packages];
                              pkgs[idx] = { ...pkgs[idx], price: parseFloat(e.target.value) || 0 };
                              handleChange('bulk_time_packages', pkgs);
                            }}
                            disabled={!canManageSettings}
                            className="w-full px-2 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-white text-sm text-center focus:outline-none focus:border-[#1877F2] disabled:opacity-50" />
                        </div>
                        <div>
                          <label className="text-[10px] text-[#B0B3B8] block mb-1">Per Hr</label>
                          <div className="px-2 py-2 bg-[#242526] border border-[#3A3B3C] rounded-lg text-sm text-center font-mono">
                            <span className={pkg.hours > 0 && (pkg.price / pkg.hours) < settings.time_billing_rate ? 'text-[#31A24C]' : 'text-[#B0B3B8]'}>
                              ${pkg.hours > 0 ? (pkg.price / pkg.hours).toFixed(2) : '0.00'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="cmd-panel divide-y divide-[#3A3B3C]">
              {staff?.role === 'owner' && (
                <button 
                  onClick={async (e) => {
                    const btn = e.currentTarget;
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                    try {
                      const staffSession = getStaffSession() || '';
                      const res = await commanderFetch('/api/commander/manage-subscription', {
                        method: 'POST',
                        body: JSON.stringify({ returnUrl: window.location.href })
                      });
                      const json = await res.json();
                      if (json.url) {
                        window.location.href = json.url;
                      } else {
                        setError(json.error || 'Failed to open billing portal');
                        setTimeout(() => setError(null), 3000);
                        btn.disabled = false;
                        btn.style.opacity = '1';
                      }
                    } catch (err) {
                      setError('Network error opening billing portal');
                      setTimeout(() => setError(null), 3000);
                      btn.disabled = false;
                      btn.style.opacity = '1';
                    }
                  }}
                  className="w-full p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors relative overflow-hidden group text-left">
                  <div className="absolute inset-0 bg-gradient-to-r from-[#1877F2]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <div className="relative">
                    <span className="font-bold text-[#1877F2]">Manage Subscription & Billing</span>
                    <p className="text-xs text-[#B0B3B8]">View invoices, update card, cancel, or manage Commander tier</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-[#1877F2] relative" />
                </button>
              )}
              <button onClick={() => router.push('/commander/membership-plans')}
                className="w-full p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors text-left">
                <div>
                  <span className="font-medium text-white">Membership Plans</span>
                  <p className="text-xs text-[#B0B3B8]">Set Daily/Weekly/Monthly/Yearly Pricing Per Tier</p>
                </div>
                <ChevronRight className="w-5 h-5 text-[#3A3B3C]" />
              </button>
              <button onClick={() => router.push('/commander/game-types')}
                className="w-full p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors text-left">
                <div>
                  <span className="font-medium text-white">Game Types</span>
                  <p className="text-xs text-[#B0B3B8]">Configure Games, Stakes, Buy-Ins, Rake</p>
                </div>
                <ChevronRight className="w-5 h-5 text-[#3A3B3C]" />
              </button>
              <button onClick={() => router.push('/commander/room-presets')}
                className="w-full p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors text-left">
                <div>
                  <span className="font-medium text-white">Room Presets</span>
                  <p className="text-xs text-[#B0B3B8]">Saved Room Configurations For Quick Setup</p>
                </div>
                <ChevronRight className="w-5 h-5 text-[#3A3B3C]" />
              </button>
              <button onClick={() => router.push('/commander/tables')}
                className="w-full p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors text-left">
                <span className="font-medium text-white">Manage Tables</span>
                <ChevronRight className="w-5 h-5 text-[#3A3B3C]" />
              </button>
              <button onClick={() => router.push('/commander/staff')}
                className="w-full p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors text-left">
                <span className="font-medium text-white">Manage Staff</span>
                <ChevronRight className="w-5 h-5 text-[#3A3B3C]" />
              </button>
              <button onClick={() => router.push('/commander/dealers')}
                className="w-full p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors text-left">
                <span className="font-medium text-white">Manage Dealers</span>
                <ChevronRight className="w-5 h-5 text-[#3A3B3C]" />
              </button>
              <button onClick={() => router.push('/commander/members')}
                className="w-full p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors text-left">
                <span className="font-medium text-white">Members</span>
                <ChevronRight className="w-5 h-5 text-[#3A3B3C]" />
              </button>
              <button onClick={() => router.push('/commander/promotions')}
                className="w-full p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors text-left">
                <span className="font-medium text-white">Promotions</span>
                <ChevronRight className="w-5 h-5 text-[#3A3B3C]" />
              </button>
              <button onClick={() => router.push('/commander/displays')}
                className="w-full p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors text-left">
                <span className="font-medium text-white">TV Displays</span>
                <ChevronRight className="w-5 h-5 text-[#3A3B3C]" />
              </button>
              <button onClick={() => router.push('/commander/reports')}
                className="w-full p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors text-left">
                <span className="font-medium text-white">Reports</span>
                <ChevronRight className="w-5 h-5 text-[#3A3B3C]" />
              </button>
              <button onClick={() => router.push('/commander/time-billing')}
                className="w-full p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors text-left">
                <span className="font-medium text-white">Time Billing</span>
                <ChevronRight className="w-5 h-5 text-[#3A3B3C]" />
              </button>
              <button onClick={() => router.push('/commander/system-info')}
                className="w-full p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors text-left">
                <div>
                  <span className="font-medium text-white">System Information</span>
                  <p className="text-xs text-[#B0B3B8]">Version, Diagnostics, Health Checks</p>
                </div>
                <ChevronRight className="w-5 h-5 text-[#3A3B3C]" />
              </button>
            </section>
          </main>
        </div>
        <style>{`
          @keyframes slideDown {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </>
    </CommanderLayout>
  );
}

function SettingToggle({ label, description, enabled, onChange, disabled }) {
  return (
    <div className="p-4 flex items-center justify-between">
      <div>
        <p className="font-medium text-white">{label}</p>
        <p className="text-sm text-[#B0B3B8]">{description}</p>
      </div>
      <button
        onClick={onChange}
        disabled={disabled}
        className={`w-12 h-7 rounded-full transition-colors relative ${enabled ? 'bg-[#1877F2]' : 'bg-[#3A3B3C]'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span
          className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'right-1' : 'left-1'
            }`}
        />
      </button>
    </div>
  );
}

function SettingNumber({ label, description, value, onChange, min, max, step, disabled }) {
  return (
    <div className="p-4 flex items-center justify-between">
      <div>
        <p className="font-medium text-white">{label}</p>
        <p className="text-sm text-[#B0B3B8]">{description}</p>
      </div>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(step && step < 1 ? (parseFloat(e.target.value) || min) : (parseInt(e.target.value) || min))}
        min={min}
        max={max}
        step={step || 1}
        disabled={disabled}
        className="w-20 h-10 px-3 cmd-input text-center disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  );
}
