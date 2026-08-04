/**
 * Admin Dashboard - Multi-venue management
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6
 * /commander/admin - Admin dashboard for managers
 * Dark industrial sci-fi gaming theme
 */
import React, { useState, useEffect } from 'react';
import SEOHead from '../../../src/components/seo/SEOHead';
import { useRouter } from 'next/router';
import { Building2, Settings, Download, Shield, Key, X, Plus, Trash2, Copy, Eye, EyeOff, Loader2, Check } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import MultiVenueDashboard from '../../../src/components/commander/admin/MultiVenueDashboard';
import AuditLogViewer from '../../../src/components/commander/admin/AuditLogViewer';
import ExportManager from '../../../src/components/commander/admin/ExportManager';
import { getToken } from '../../../src/lib/commander/clientAuth';
import { busEmit } from '../../../src/engine/EventBus';
import { broadcastChange } from '../../../src/lib/commander/useCommanderSync';
import { commanderFetch, commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';
import { useConfirmAction } from "../../../src/components/commander/shared/ConfirmModal";

// API Keys Modal
function ApiKeysModal({ isOpen, onClose, venueId, onSuccess }) {
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [showKey, setShowKey] = useState({});
  const [copiedKey, setCopiedKey] = useState(null);
  const [error, setError] = useState(null);
  // The full key is only returned once at creation (the API stores a hash and
  // lists only key_prefix afterwards) — hold it here for a one-time display.
  const [newFullKey, setNewFullKey] = useState(null);


  useEffect(() => {
    if (isOpen && venueId) loadApiKeys();
  }, [isOpen, venueId]);

  async function loadApiKeys() {
    if (!venueId) return;
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const data = await commanderFetchJSON(`/api/commander/admin/api-keys?venue_id=${venueId}`, {
        
      });
      if (data.success) {
        setApiKeys(data.data?.keys || []);
      } else {
        setError(data.error?.message || 'Failed to load API keys');
      }
    } catch (err) {
      console.warn('Load API keys error:', err);
      setError('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateKey() {
    if (!newKeyName.trim() || !venueId) return;
    setCreating(true);
    setError(null);
    try {
      const token = getToken();
      const res = await commanderFetch('/api/commander/admin/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json' || ''
        },
        body: JSON.stringify({ name: newKeyName, venue_id: venueId })
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      if (data.success) {
        const created = data.data?.key || {};
        setApiKeys([created, ...apiKeys]);
        setNewKeyName('');
        // Capture the one-time full key from whichever field the API returns it in
        const fullKey = created.api_key || data.data?.api_key || data.data?.full_key || created.full_key || null;
        if (fullKey) {
          setNewFullKey({ id: created.id, key: fullKey });
          setShowKey({ [created.id]: true });
        }
        onSuccess?.();
      } else {
        setError(data.error?.message || 'Failed to create API key');
      }
    } catch (err) {
      setLoading(false);
      console.warn('Create API key error:', err);
      setError('Failed to create API key');
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteKey(keyId) {
    if (!confirm('Are you sure you want to delete this API key?')) return;
    setError(null);
    try {
      const token = getToken();
      const data = await commanderFetchJSON(`/api/commander/admin/api-keys/${keyId}?venue_id=${venueId}`, {
        method: 'DELETE',
        
      });
      if (data.success) {
        setApiKeys(apiKeys.filter(k => k.id !== keyId));
        onSuccess?.();
      } else {
        setError(data.error?.message || 'Failed to delete API key');
      }
    } catch (err) {
      console.warn('Delete API key error:', err);
      setError('Failed to delete API key');
    }
  }

  // Full key is only available on legacy rows (api_key still returned) or for
  // the key just created in this session (newFullKey).
  function getFullKey(key) {
    if (key.api_key) return key.api_key;
    if (newFullKey && newFullKey.id === key.id) return newFullKey.key;
    return null;
  }

  function keyDisplay(key) {
    const full = getFullKey(key);
    if (showKey[key.id] && full) return full;
    if (key.key_prefix) return `${key.key_prefix}...`;
    if (full) return `${full.substring(0, 8)}...`;
    return '········...';
  }

  function handleCopyKey(key) {
    const full = getFullKey(key);
    if (!full) return;
    navigator.clipboard.writeText(full);
    setCopiedKey(key.id);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="cmd-panel cmd-corner-lights w-full max-w-lg">
        <div className="flex items-center justify-between p-4 border-b border-[#3A3B3C]">
          <h3 className="text-lg font-semibold text-white">API Keys</h3>
          <button onClick={onClose} className="p-2 hover:bg-[#3A3B3C] rounded-lg">
            <X className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        <div className="p-4">
          {error && (
            <div className="mb-4 p-3 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg text-[#EF4444] text-sm">
              {error}
            </div>
          )}
          <p className="text-sm text-[#B0B3B8] mb-4">
            API keys allow external systems to access Commander data. Keep your keys secure.
          </p>

          {newFullKey && (
            <div className="mb-4 p-3 bg-[#31A24C]/10 border border-[#31A24C]/20 rounded-lg">
              <p className="text-sm text-[#31A24C] font-medium mb-1">
                Copy your new API key now — it will not be shown again.
              </p>
              <code className="text-xs text-white font-mono break-all">{newFullKey.key}</code>
            </div>
          )}

          {/* Create New Key */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key Name (e.g., POS System)"
              className="cmd-input flex-1"
            />
            <button
              onClick={handleCreateKey}
              disabled={!newKeyName.trim() || creating}
              className="cmd-btn cmd-btn-primary px-4 py-2 flex items-center gap-2"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create
            </button>
          </div>

          {/* Keys List */}
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-[#B0B3B8]" />
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="text-center py-8 text-[#B0B3B8]">
              <Key className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No API Keys Yet</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {apiKeys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between p-3 bg-[#3A3B3C] rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{key.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs text-[#B0B3B8] font-mono">
                        {keyDisplay(key)}
                      </code>
                      {getFullKey(key) && (
                        <button
                          onClick={() => setShowKey(prev => ({ ...prev, [key.id]: !prev[key.id] }))}
                          className="text-[#B0B3B8] hover:text-white"
                        >
                          {showKey[key.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    {getFullKey(key) && (
                      <button
                        onClick={() => handleCopyKey(key)}
                        className="p-2 text-[#B0B3B8] hover:text-white hover:bg-[#3A3B3C] rounded"
                      >
                        {copiedKey === key.id ? <Check className="w-4 h-4 text-[#31A24C]" /> : <Copy className="w-4 h-4" />}
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteKey(key.id)}
                      className="p-2 text-[#B0B3B8] hover:text-[#EF4444] hover:bg-[#3A3B3C] rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Venue Settings Modal
function VenueSettingsModal({ isOpen, onClose, venue, onSave, onSuccess }) {
  const [settings, setSettings] = useState({
    comp_rate: 1.0,
    auto_text_enabled: true,
    waitlist_settings: {
      max_call_count: 3,
      call_timeout_minutes: 5,
      allow_remote_checkin: true
    },
    display_settings: {
      show_waitlist_count: true,
      show_game_stakes: true,
      show_player_names: false
    }
  });
  const [saving, setSaving] = useState(false);
  // 2026-07-25 audit fix: error state was referenced by handleSave but never declared
  const [error, setError] = useState(null);

  useEffect(() => {
    if (venue) {
      setSettings({
        comp_rate: venue.comp_rate || 1.0,
        auto_text_enabled: venue.auto_text_enabled ?? true,
        waitlist_settings: venue.waitlist_settings || settings.waitlist_settings,
        display_settings: venue.display_settings || settings.display_settings
      });
    }
  }, [venue]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      // 2026-07-25 audit fix: the settings API accepts PATCH (PUT returned 405)
      // and responds with { success, data: { settings } }
      const res = await commanderFetch(`/api/commander/admin/venues/${venue.id}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json' || ''
        },
        body: JSON.stringify(settings)
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      if (data.success) {
        onSave?.({ ...venue, ...(data.data?.settings || settings) });
        onSuccess?.();
        onClose();
      } else {
        setError(data.error?.message || data.error || 'Failed to save venue settings. Please try again.');
      }
    } catch (err) {
      console.warn('Save venue settings error:', err);
      setError('Failed to save venue settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen || !venue) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="cmd-panel cmd-corner-lights w-full max-w-lg">
        <div className="flex items-center justify-between p-4 border-b border-[#3A3B3C]">
          <h3 className="text-lg font-semibold text-white">{venue.name} Settings</h3>
          <button onClick={onClose} className="p-2 hover:bg-[#3A3B3C] rounded-lg">
            <X className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* 2026-07-25 audit fix: render save errors */}
          {error && (
            <div className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg text-[#EF4444] text-sm">
              {error}
            </div>
          )}
          {/* Comp Rate */}
          <div>
            <label className="block text-sm font-medium text-[#94A3B8] mb-2">Comp Rate ($/hr)</label>
            <input
              type="number"
              step="0.25"
              value={settings.comp_rate}
              onChange={(e) => setSettings(prev => ({ ...prev, comp_rate: parseFloat(e.target.value) || 0 }))}
              className="cmd-input w-full"
            />
          </div>

          {/* Auto Text */}
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-white">Auto Text Notifications</p>
              <p className="text-sm text-[#B0B3B8]">Send Automatic SMS To Players When Called</p>
            </div>
            <label className="relative inline-flex cursor-pointer">
              <input
                type="checkbox"
                checked={settings.auto_text_enabled}
                onChange={(e) => setSettings(prev => ({ ...prev, auto_text_enabled: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[#3A3B3C] peer-focus:ring-2 peer-focus:ring-[#1877F2] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#1877F2]"></div>
            </label>
          </div>

          {/* Waitlist Settings */}
          <div className="pt-3 border-t border-[#3A3B3C]">
            <p className="font-medium text-white mb-3">Waitlist Settings</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#B0B3B8]">Max Call Attempts</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={settings.waitlist_settings?.max_call_count || 3}
                  onChange={(e) => setSettings(prev => ({
                    ...prev,
                    waitlist_settings: { ...prev.waitlist_settings, max_call_count: parseInt(e.target.value) || 3 }
                  }))}
                  className="cmd-input w-20 h-8 px-3 text-sm"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#B0B3B8]">Call Timeout (minutes)</span>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={settings.waitlist_settings?.call_timeout_minutes || 5}
                  onChange={(e) => setSettings(prev => ({
                    ...prev,
                    waitlist_settings: { ...prev.waitlist_settings, call_timeout_minutes: parseInt(e.target.value) || 5 }
                  }))}
                  className="cmd-input w-20 h-8 px-3 text-sm"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#B0B3B8]">Allow Remote Check-In</span>
                <label className="relative inline-flex cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.waitlist_settings?.allow_remote_checkin ?? true}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      waitlist_settings: { ...prev.waitlist_settings, allow_remote_checkin: e.target.checked }
                    }))}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#3A3B3C] peer-focus:ring-2 peer-focus:ring-[#1877F2] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#1877F2]"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Display Settings */}
          <div className="pt-3 border-t border-[#3A3B3C]">
            <p className="font-medium text-white mb-3">Display Settings</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#B0B3B8]">Show Waitlist Count Publicly</span>
                <label className="relative inline-flex cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.display_settings?.show_waitlist_count ?? true}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      display_settings: { ...prev.display_settings, show_waitlist_count: e.target.checked }
                    }))}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#3A3B3C] peer-focus:ring-2 peer-focus:ring-[#1877F2] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#1877F2]"></div>
                </label>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#B0B3B8]">Show Game Stakes</span>
                <label className="relative inline-flex cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.display_settings?.show_game_stakes ?? true}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      display_settings: { ...prev.display_settings, show_game_stakes: e.target.checked }
                    }))}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#3A3B3C] peer-focus:ring-2 peer-focus:ring-[#1877F2] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#1877F2]"></div>
                </label>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#B0B3B8]">Show Player Names On Display</span>
                <label className="relative inline-flex cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.display_settings?.show_player_names ?? false}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      display_settings: { ...prev.display_settings, show_player_names: e.target.checked }
                    }))}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#3A3B3C] peer-focus:ring-2 peer-focus:ring-[#1877F2] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#1877F2]"></div>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-[#3A3B3C]">
          <button
            onClick={handleSave}
            disabled={saving}
            className="cmd-btn cmd-btn-primary w-full h-11 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: Building2 },
  { id: 'exports', label: 'Data Exports', icon: Download },
  { id: 'audit', label: 'Audit Logs', icon: Shield },
  { id: 'settings', label: 'Settings', icon: Settings }
];

export default function AdminDashboard() {
  const { requestConfirm, ConfirmDialog } = useConfirmAction();
  useEffect(() => { busEmit.sessionStart('commander-admin-index'); }, []);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('overview');
  const [venues, setVenues] = useState([]);
  const [summary, setSummary] = useState({});
  const [exports, setExports] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  // 2026-07-25 audit fix: audit-log total from the API + error state that
  // handleCreateExport referenced but never declared
  const [auditTotal, setAuditTotal] = useState(0);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [showApiKeysModal, setShowApiKeysModal] = useState(false);
  const [showVenueSettingsModal, setShowVenueSettingsModal] = useState(false);
  const [settingsVenue, setSettingsVenue] = useState(null);

  useEffect(() => {
    const ctrl = new AbortController();
    loadAdminData(ctrl.signal);
    return () => ctrl.abort();
  }, []);

  const loadAdminData = async (signal) => {
    setIsLoading(true);
    try {
      const token = getToken();
      if (!token) {
        // 2026-07-25 audit fix: commander login lives at /commander/login
        router.push('/commander/login');
        return;
      }

      // Load venues with summary
      const fetchOpts = () => signal ? { signal } : {};
      const venuesRes = await commanderFetch('/api/commander/admin/venues?summary=true', fetchOpts());
      if (!venuesRes.ok) throw new Error(`Request failed (${venuesRes.status})`);
      const venuesData = await venuesRes.json();
      // 2026-07-25 audit fix: the API nests under data — read data.venues/data.summary
      if (venuesData.success && venuesData.data?.venues) {
        setVenues(venuesData.data.venues);
        setSummary(venuesData.data.summary || {});
      }

      // Load exports
      const exportsRes = await commanderFetch('/api/commander/exports', fetchOpts());
      if (!exportsRes.ok) throw new Error(`Request failed (${exportsRes.status})`);
      const exportsData = await exportsRes.json();
      if (exportsData.exports) {
        setExports(exportsData.exports);
      }

    } catch (err) {
      console.warn('Load error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadAuditLogs = async (filters = {}) => {
    try {
      const token = getToken();
      // 2026-07-25 audit fix: the API requires venue_id (default to the first
      // venue), only reads venue_id/page/limit/action/staff_id, and nests the
      // payload under data (data.logs / data.total).
      const venueId = selectedVenue?.id || venues[0]?.id;
      if (!venueId) return;

      const params = new URLSearchParams();
      params.set('venue_id', venueId);
      if (filters.page) params.set('page', filters.page);
      if (filters.limit) params.set('limit', filters.limit);
      if (filters.action) params.set('action', filters.action);
      if (filters.staff_id) params.set('staff_id', filters.staff_id);

      const body = await commanderFetchJSON(`/api/commander/admin/audit-logs?${params}`, {

      });
      if (body.success && body.data) {
        setAuditLogs(body.data.logs || []);
        setAuditTotal(body.data.total || 0);
      }
    } catch (err) {
      setIsLoading(false);
      console.warn('Audit logs error:', err);
    }
  };

  const handleCreateExport = async (formData) => {
    try {
      const venueId = selectedVenue?.id || venues[0]?.id;
      if (!venueId) return;

      const res = await commanderFetch('/api/commander/exports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json' || ''
        },
        body: JSON.stringify({
          venue_id: venueId,
          ...formData
        })
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      if (res.ok && data.export) {
        setExports([data.export, ...exports]);
        broadcastChange('exports');
      }
    } catch (err) {
      console.warn('Create export error:', err);
      setError('Failed to create export. Please try again.');
    }
  };

  const handleDownloadExport = (exportJob) => {
    if (exportJob.file_url) {
      // For data URLs, create download link
      const link = document.createElement('a');
      link.href = exportJob.file_url;
      link.download = `${exportJob.export_type}_export.${exportJob.format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleVenueSelect = (venue) => {
    setSelectedVenue(venue);
    if (activeTab === 'audit') {
      loadAuditLogs();
    }
  };

  useEffect(() => {
    if (activeTab === 'audit') {
      loadAuditLogs();
    }
  }, [activeTab, selectedVenue]);

  const handleConfigureVenue = (venue) => {
    setSettingsVenue(venue);
    setShowVenueSettingsModal(true);
  };

  const handleVenueSettingsSaved = (updatedVenue) => {
    setVenues(venues.map(v => v.id === updatedVenue.id ? { ...v, ...updatedVenue } : v));
  };

  return (
    <CommanderLayout title="Admin Dashboard | Commander" backHref="/commander/dashboard">
      <SEOHead
        title="Commander — Admin"
        description="Club Commander Admin Dashboard."
        noindex={true}
      >

      </SEOHead>

      <div className="cmd-page" style={{ fontFamily: 'Inter, sans-serif' }}>

        {/* Tabs */}
        <div className="border-b border-[#3A3B3C] bg-[#0F1D32]">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex gap-1">
              {TABS.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${isActive
                      ? 'border-[#1877F2] text-[#1877F2]'
                      : 'border-transparent text-[#B0B3B8] hover:text-white'
                      }`}
                  >
                    <Icon size={18} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-7xl mx-auto px-4 py-6">
          {/* 2026-07-25 audit fix: render dashboard-level errors */}
          {error && (
            <div className="mb-4 p-3 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg text-[#EF4444] text-sm flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-[#EF4444] hover:underline text-xs ml-3">Dismiss</button>
            </div>
          )}
          {activeTab === 'overview' && (
            <MultiVenueDashboard
              venues={venues}
              summary={summary}
              isLoading={isLoading}
              onVenueSelect={handleVenueSelect}
            />
          )}

          {activeTab === 'exports' && (
            <ExportManager
              exports={exports}
              isLoading={isLoading}
              onCreateExport={handleCreateExport}
              onDownload={handleDownloadExport}
            />
          )}

          {activeTab === 'audit' && (
            <div>
              {venues.length > 1 && (
                <div className="mb-4">
                  <label className="block text-sm text-[#B0B3B8] mb-2">Select Venue</label>
                  <select
                    value={selectedVenue?.id || ''}
                    onChange={(e) => {
                      const v = venues.find(v => v.id === parseInt(e.target.value));
                      setSelectedVenue(v);
                    }}
                    className="cmd-input"
                  >
                    <option value="">All Venues</option>
                    {venues.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <AuditLogViewer
                logs={auditLogs}
                total={auditTotal || auditLogs.length}
                isLoading={isLoading}
                onFilterChange={loadAuditLogs}
              />
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-6">
              <div className="cmd-panel p-6">
                <h3 className="text-lg font-semibold text-white mb-4">API Keys</h3>
                <p className="text-[#B0B3B8] mb-4">
                  Create API keys for external integrations like POS systems, player tracking software, or custom displays.
                </p>
                <button
                  onClick={() => setShowApiKeysModal(true)}
                  className="cmd-btn cmd-btn-primary flex items-center gap-2"
                >
                  <Key size={16} />
                  Manage API Keys
                </button>
              </div>

              <div className="cmd-panel p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Venue Settings</h3>
                <p className="text-[#B0B3B8] mb-4">
                  Configure venue-specific settings like comp rates, notification preferences, and display options.
                </p>
                <div className="space-y-3">
                  {venues.map(venue => (
                    <div
                      key={venue.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-[#3A3B3C]"
                    >
                      <div className="flex items-center gap-3">
                        <Building2 size={20} className="text-[#B0B3B8]" />
                        <span className="text-white">{venue.name}</span>
                      </div>
                      <button
                        onClick={() => handleConfigureVenue(venue)}
                        className="text-[#1877F2] text-sm hover:underline"
                      >
                        Configure
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <ApiKeysModal
        isOpen={showApiKeysModal}
        onClose={() => setShowApiKeysModal(false)}
        venueId={selectedVenue?.id || venues[0]?.id}
        onSuccess={() => broadcastChange('admin')}
      />

      <VenueSettingsModal
        isOpen={showVenueSettingsModal}
        onClose={() => {
          setShowVenueSettingsModal(false);
          setSettingsVenue(null);
        }}
        venue={settingsVenue}
        onSave={handleVenueSettingsSaved}
        onSuccess={() => broadcastChange('venues')}
      />
    
      <ConfirmDialog />
    </CommanderLayout>
  );
}
