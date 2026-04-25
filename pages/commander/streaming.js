/**
 * Staff Streaming Management Page
 * Configure and control table streams
 * Dark industrial sci-fi gaming theme
 * Per API_REFERENCE.md: /streaming endpoints
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { Video, Play, Square, Settings, Loader2, Clock, Wifi, Youtube, Twitch, Facebook, X } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../src/engine/EventBus';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';

const PLATFORMS = [
  { id: 'youtube', label: 'YouTube', icon: Youtube, color: '#FF0000' },
  { id: 'twitch', label: 'Twitch', icon: Twitch, color: '#9146FF' },
  { id: 'facebook', label: 'Facebook', icon: Facebook, color: '#1877F2' }
];

function StreamCard({ stream, onStart, onStop, onConfigure }) {
  const isLive = stream.status === 'live';

  return (
    <div className="cmd-panel overflow-hidden">
      {/* Preview Area */}
      <div className={`h-40 flex items-center justify-center ${isLive ? 'bg-[#1F2937]' : 'bg-[#3A3B3C]'}`}>
        {isLive ? (
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 text-[#EF4444] mb-2">
              <span className="w-3 h-3 bg-[#EF4444] rounded-full animate-pulse" />
              LIVE
            </div>
            <p className="text-white text-sm">{stream.viewer_count || 0} viewers</p>
          </div>
        ) : (
          <Video className="w-12 h-12 text-[#3A3B3C]" />
        )}
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-white">Table {stream.table_number}</h3>
            <p className="text-sm text-[#B0B3B8]">{stream.game_info || 'No game'}</p>
          </div>
          {isLive && (
            <span className="px-2 py-1 bg-[#EF4444]/10 text-[#EF4444] text-xs font-medium rounded flex items-center gap-1">
              <Wifi className="w-3 h-3" />
              Live
            </span>
          )}
        </div>

        {/* Active Platforms */}
        {stream.platforms?.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            {stream.platforms.map(platformId => {
              const platform = PLATFORMS.find(p => p.id === platformId);
              if (!platform) return null;
              const Icon = platform.icon;
              return (
                <span
                  key={platformId}
                  className="p-1.5 rounded"
                  style={{ backgroundColor: `${platform.color}15` }}
                >
                  <Icon className="w-4 h-4" style={{ color: platform.color }} />
                </span>
              );
            })}
            {stream.delay_minutes > 0 && (
              <span className="text-xs text-[#B0B3B8] flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {stream.delay_minutes}m delay
              </span>
            )}
          </div>
        )}

        {/* Duration */}
        {isLive && stream.started_at && (
          <p className="text-sm text-[#B0B3B8] mb-3">
            Streaming for {Math.round((Date.now() - new Date(stream.started_at).getTime()) / 60000)} minutes
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {isLive ? (
            <button
              onClick={() => onStop(stream.table_id)}
              className="flex-1 py-2 bg-[#EF4444] text-white text-sm font-medium rounded-lg hover:bg-[#DC2626] transition-colors flex items-center justify-center gap-1"
            >
              <Square className="w-4 h-4" />
              Stop Stream
            </button>
          ) : (
            <button
              onClick={() => onStart(stream.table_id)}
              className="flex-1 py-2 bg-[#31A24C] text-white text-sm font-medium rounded-lg hover:bg-[#059669] transition-colors flex items-center justify-center gap-1"
            >
              <Play className="w-4 h-4" />
              Start Stream
            </button>
          )}
          <button
            onClick={() => onConfigure(stream)}
            className="cmd-btn cmd-btn-secondary px-4 py-2"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigureModal({ stream, onSave, onClose }) {
  const [config, setConfig] = useState({
    platforms: stream.platforms || [],
    delay_minutes: stream.delay_minutes || 15,
    overlay_config: stream.overlay_config || {
      showPotSize: true,
      showPlayerNames: true,
      showChipCounts: true
    }
  });
  const [loading, setLoading] = useState(false);

  function togglePlatform(platformId) {
    setConfig(prev => ({
      ...prev,
      platforms: prev.platforms.includes(platformId)
        ? prev.platforms.filter(p => p !== platformId)
        : [...prev.platforms, platformId]
    }));
  }

  async function handleSave() {
    setLoading(true);
    await onSave(stream.table_id, config);
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-md cmd-panel cmd-corner-lights p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Stream Settings</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#3A3B3C] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        <div className="space-y-6">
          {/* Platforms */}
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Stream To
            </label>
            <div className="flex gap-2">
              {PLATFORMS.map(platform => {
                const Icon = platform.icon;
                const isSelected = config.platforms.includes(platform.id);
                return (
                  <button
                    key={platform.id}
                    onClick={() => togglePlatform(platform.id)}
                    className={`flex-1 py-3 rounded-lg border flex flex-col items-center gap-1 transition-colors ${isSelected
                      ? 'border-2'
                      : 'border-[#3A3B3C]'
                      }`}
                    style={{
                      borderColor: isSelected ? platform.color : undefined,
                      backgroundColor: isSelected ? `${platform.color}10` : undefined
                    }}
                  >
                    <Icon className="w-5 h-5" style={{ color: isSelected ? platform.color : '#B0B3B8' }} />
                    <span className="text-xs" style={{ color: isSelected ? platform.color : '#B0B3B8' }}>
                      {platform.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Delay */}
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Stream Delay (minutes)
            </label>
            <div className="flex gap-2">
              {[5, 10, 15, 30].map(mins => (
                <button
                  key={mins}
                  onClick={() => setConfig(prev => ({ ...prev, delay_minutes: mins }))}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${config.delay_minutes === mins
                    ? 'border-[#1877F2] bg-[#1877F2]/5 text-[#1877F2]'
                    : 'border-[#3A3B3C] text-[#B0B3B8]'
                    }`}
                >
                  {mins}m
                </button>
              ))}
            </div>
          </div>

          {/* Overlay Options */}
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Overlay Options
            </label>
            <div className="space-y-2">
              {[
                { key: 'showPotSize', label: 'Show Pot Size' },
                { key: 'showPlayerNames', label: 'Show Player Names' },
                { key: 'showChipCounts', label: 'Show Chip Counts' }
              ].map(option => (
                <label key={option.key} className="flex items-center justify-between p-3 bg-[#18191A] rounded-lg">
                  <span className="text-white">{option.label}</span>
                  <input
                    type="checkbox"
                    checked={config.overlay_config[option.key]}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      overlay_config: {
                        ...prev.overlay_config,
                        [option.key]: e.target.checked
                      }
                    }))}
                    className="w-5 h-5 rounded border-[#3A3B3C] text-[#1877F2] focus:ring-[#1877F2]"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="cmd-btn cmd-btn-secondary flex-1 h-12"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="cmd-btn cmd-btn-primary flex-1 h-12 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StreamingPage() {

  useEffect(() => { busEmit.sessionStart('commander-streaming'); }, []);
  const router = useRouter();

  const [staff, setStaff] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [streams, setStreams] = useState([]);
  const [configuring, setConfiguring] = useState(null);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

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
    } catch {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    }
  }, [router]);

  // fetchStreams declared first — must precede useEffect/useCommanderSync that reference it
  const fetchStreams = useCallback(async (signal) => {
    setLoading(true);
    try {
const res = await commanderFetch(`/api/commander/streaming?venue_id=${venueId}`, { ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      if (data.success) {
        setStreams(data.data?.streams || []);
      }
    } catch (err) {
      console.warn('Fetch streams failed:', err);
      setStreams([]);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (venueId) {
      const ctrl = new AbortController();
      fetchStreams(ctrl.signal);
      return () => ctrl.abort();
    }
  }, [venueId, fetchStreams]);

  // Commander Data Bus — both BroadcastChannel (instant) + Supabase Realtime (cross-device)
  useCommanderSync(venueId || '', fetchStreams, { entities: ['streaming'] });

  async function handleStartStream(tableId) {
    try {
const res = await commanderFetch(`/api/commander/streaming/${tableId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venueId })
      });
      if (res.ok) {
        fetchStreams();
        broadcastChange('streaming');
      }
    } catch (err) {
      setLoading(false);
      console.warn('Start stream failed:', err);
      setToast({ type: 'error', text: 'Failed to start stream. Please try again.' });
    }
  }

  async function handleStopStream(tableId) {
    try {
const res = await commanderFetch(`/api/commander/streaming/${tableId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venueId })
      });
      if (res.ok) {
        fetchStreams();
        broadcastChange('streaming');
      }
    } catch (err) {
      console.warn('Stop stream failed:', err);
      setToast({ type: 'error', text: 'Failed to stop stream. Please try again.' });
    }
  }

  async function handleSaveConfig(tableId, config) {
    try {
const res = await commanderFetch(`/api/commander/streaming/${tableId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venueId, ...config })
      });
      if (res.ok) {
        setConfiguring(null);
        fetchStreams();
        broadcastChange('streaming');
      }
    } catch (err) {
      console.warn('Save config failed:', err);
      setToast({ type: 'error', text: 'Failed to save streaming config. Please try again.' });
    }
  }

  const liveStreams = streams.filter(s => s.status === 'live');
  const offlineStreams = streams.filter(s => s.status !== 'live');

  if (!staff) {
    return (
      <div className="cmd-page flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
      </div>
    );
  }

  return (
    <CommanderLayout title="Streaming" backHref="/commander/dashboard">
      <div className="cmd-page">

        <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
            </div>
          ) : (
            <>
              {/* Live Streams */}
              {liveStreams.length > 0 && (
                <section>
                  <h2 className="font-semibold text-white mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 bg-[#EF4444] rounded-full animate-pulse" />
                    Live Now
                  </h2>
                  <div className="grid md:grid-cols-2 gap-4">
                    {liveStreams.map(stream => (
                      <StreamCard
                        key={stream.table_id}
                        stream={stream}
                        onStart={handleStartStream}
                        onStop={handleStopStream}
                        onConfigure={setConfiguring}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Available Tables */}
              {offlineStreams.length > 0 && (
                <section>
                  <h2 className="font-semibold text-white mb-3">Available Tables</h2>
                  <div className="grid md:grid-cols-2 gap-4">
                    {offlineStreams.map(stream => (
                      <StreamCard
                        key={stream.table_id}
                        stream={stream}
                        onStart={handleStartStream}
                        onStop={handleStopStream}
                        onConfigure={setConfiguring}
                      />
                    ))}
                  </div>
                </section>
              )}

              {streams.length === 0 && (
                <div className="cmd-panel p-8 text-center">
                  <Video className="w-12 h-12 text-[#3A3B3C] mx-auto mb-3" />
                  <p className="text-[#B0B3B8]">No Tables Configured For Streaming</p>
                </div>
              )}
            </>
          )}
        </main>

        {/* Configure Modal */}
        {configuring && (
          <ConfigureModal
            stream={configuring}
            onSave={handleSaveConfig}
            onClose={() => setConfiguring(null)}
          />
        )}
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
    </CommanderLayout>
  );
}
