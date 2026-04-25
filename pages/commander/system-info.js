/**
 * System Information Page
 * /commander/system-info
 * TC equivalent: "System Information" tile — version, diagnostics, support
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Server, Database, Wifi, Shield, Clock, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, Loader2, HelpCircle, Activity,
  Users, Layout, Gamepad2, ExternalLink
} from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

export default function SystemInfoPage() {
  useEffect(() => { busEmit.sessionStart('commander-system-info'); }, []);
  const router = useRouter();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [staff, setStaff] = useState(null);
  const [venueName, setVenueName] = useState('');

  useEffect(() => {
    const stored = getStaffSession();
    if (!stored) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
    try {
      const s = JSON.parse(stored);
      if (!s.venue_id) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
      setStaff(s);
      setVenueName(s.venue_name || '');
    } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
  }, [router]);

  async function fetchInfo(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    try {
const json = await commanderFetchJSON('/api/commander/system-info');
      if (json.success) setInfo(json.data);
    } catch (err) { console.warn(err); }
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { if (staff) { const _c = new AbortController(); fetchInfo(_c.signal); return () => _c.abort(); } }, [staff]);

  function StatusBadge({ status }) {
    if (status === 'healthy') return <span className="flex items-center gap-1.5 text-[#31A24C] text-sm"><CheckCircle className="w-4 h-4" /> Healthy</span>;
    if (status === 'error') return <span className="flex items-center gap-1.5 text-[#EF4444] text-sm"><XCircle className="w-4 h-4" /> Error</span>;
    return <span className="flex items-center gap-1.5 text-[#F59E0B] text-sm"><AlertTriangle className="w-4 h-4" /> Warning</span>;
  }

  return (
    <CommanderLayout title="System Info | {venueName || 'Commander'}" backHref="/commander/dashboard?card=reports">
    <>
      <SEOHead
                title="Commander — System Info"
                description="Club Commander Poker Room Management Tool."
                noindex={true}
            />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">
        <header className="bg-[#242526] border-b border-[#3A3B3C] sticky top-0 z-50">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
<div>
                <h1 className="font-bold text-white text-lg">System Information</h1>
                <p className="text-sm text-[#B0B3B8]">{venueName}</p>
              </div>
            </div>
            <button onClick={() => fetchInfo(true)} disabled={refreshing}
              className="p-2 hover:bg-[#3A3B3C] rounded-lg">
              <RefreshCw className={`w-5 h-5 text-[#B0B3B8] ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          {loading ? (
            <div className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin text-[#1877F2] mx-auto" /></div>
          ) : !info ? (
            <div className="py-16 text-center text-[#B0B3B8]">Failed To Load System Information</div>
          ) : (
            <>
              {/* Version & Platform */}
              <section className="bg-[#242526] rounded-2xl border border-[#3A3B3C] overflow-hidden">
                <div className="p-4 border-b border-[#3A3B3C] flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#1877F2]/10 rounded-lg flex items-center justify-center">
                    <Server className="w-5 h-5 text-[#1877F2]" />
                  </div>
                  <h2 className="font-semibold text-white">Platform</h2>
                </div>
                <div className="divide-y divide-[#3A3B3C]">
                  <InfoRow label="Platform" value={info.platform} />
                  <InfoRow label="Version" value={`v${info.version}`} />
                  <InfoRow label="Build Date" value={info.build_date} />
                  <InfoRow label="Environment" value={info.environment} badge />
                  <InfoRow label="Server Time" value={new Date(info.server_time).toLocaleString()} />
                  <InfoRow label="Availability" value={info.uptime_note} />
                </div>
              </section>

              {/* Venue */}
              {info.venue && (
                <section className="bg-[#242526] rounded-2xl border border-[#3A3B3C] overflow-hidden">
                  <div className="p-4 border-b border-[#3A3B3C] flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#31A24C]/10 rounded-lg flex items-center justify-center">
                      <Layout className="w-5 h-5 text-[#31A24C]" />
                    </div>
                    <h2 className="font-semibold text-white">Venue</h2>
                  </div>
                  <div className="divide-y divide-[#3A3B3C]">
                    <InfoRow label="Name" value={info.venue.name} />
                    <InfoRow label="Venue ID" value={String(info.venue.id)} mono />
                    <InfoRow label="Created" value={new Date(info.venue.created_at).toLocaleDateString()} />
                  </div>
                </section>
              )}

              {/* Health Checks */}
              <section className="bg-[#242526] rounded-2xl border border-[#3A3B3C] overflow-hidden">
                <div className="p-4 border-b border-[#3A3B3C] flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#F59E0B]/10 rounded-lg flex items-center justify-center">
                    <Activity className="w-5 h-5 text-[#F59E0B]" />
                  </div>
                  <h2 className="font-semibold text-white">Health Checks</h2>
                </div>
                <div className="divide-y divide-[#3A3B3C]">
                  {Object.entries(info.health || {}).map(([key, check]) => (
                    <div key={key} className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {key === 'database' && <Database className="w-5 h-5 text-[#B0B3B8]" />}
                        {key === 'api' && <Wifi className="w-5 h-5 text-[#B0B3B8]" />}
                        {!['database', 'api'].includes(key) && <Shield className="w-5 h-5 text-[#B0B3B8]" />}
                        <div>
                          <p className="font-medium text-white capitalize">{key.replace(/_/g, ' ')}</p>
                          {check.latency_ms > 0 && <p className="text-xs text-[#B0B3B8]">{check.latency_ms}ms latency</p>}
                          {check.error && <p className="text-xs text-[#EF4444]">{check.error}</p>}
                        </div>
                      </div>
                      <StatusBadge status={check.status} />
                    </div>
                  ))}
                </div>
              </section>

              {/* Resource Counts */}
              <section className="bg-[#242526] rounded-2xl border border-[#3A3B3C] overflow-hidden">
                <div className="p-4 border-b border-[#3A3B3C] flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#8B5CF6]/10 rounded-lg flex items-center justify-center">
                    <Gamepad2 className="w-5 h-5 text-[#8B5CF6]" />
                  </div>
                  <h2 className="font-semibold text-white">Resources</h2>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-y sm:divide-y-0 divide-[#3A3B3C]">
                  {[
                    { label: 'Tables', value: info.counts.tables, icon: Layout },
                    { label: 'Active Staff', value: info.counts.active_staff, icon: Users },
                    { label: 'Active Games', value: info.counts.active_games, icon: Gamepad2 },
                    { label: 'Members', value: info.counts.total_members, icon: Users },
                  ].map(item => (
                    <div key={item.label} className="p-4 text-center border-r border-[#3A3B3C] last:border-r-0">
                      <p className="text-2xl font-bold text-white">{item.value}</p>
                      <p className="text-xs text-[#B0B3B8] uppercase mt-1">{item.label}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Recent System Log */}
              {info.recent_log && info.recent_log.length > 0 && (
                <section className="bg-[#242526] rounded-2xl border border-[#3A3B3C] overflow-hidden">
                  <div className="p-4 border-b border-[#3A3B3C] flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#EF4444]/10 rounded-lg flex items-center justify-center">
                      <Clock className="w-5 h-5 text-[#EF4444]" />
                    </div>
                    <h2 className="font-semibold text-white">Recent System Log</h2>
                  </div>
                  <div className="divide-y divide-[#3A3B3C] max-h-80 overflow-y-auto">
                    {info.recent_log.map(entry => (
                      <div key={entry.id} className="p-3 px-4">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-white font-medium">{entry.action.replace(/_/g, ' ')}</span>
                          <span className="text-xs text-[#B0B3B8]">
                            {new Date(entry.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </span>
                        </div>
                        {entry.performed_by_name && <p className="text-xs text-[#B0B3B8]">by {entry.performed_by_name}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Support */}
              <section className="bg-[#242526] rounded-2xl border border-[#3A3B3C] overflow-hidden">
                <div className="p-4 border-b border-[#3A3B3C] flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#14B8A6]/10 rounded-lg flex items-center justify-center">
                    <HelpCircle className="w-5 h-5 text-[#14B8A6]" />
                  </div>
                  <h2 className="font-semibold text-white">Support</h2>
                </div>
                <div className="divide-y divide-[#3A3B3C]">
                  <a href="https://smarter.poker/support" target="_blank" rel="noopener noreferrer"
                    className="p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors">
                    <span className="text-sm text-white">Support Center</span>
                    <ExternalLink className="w-4 h-4 text-[#B0B3B8]" />
                  </a>
                  <a href="mailto:support@smarter.poker"
                    className="p-4 flex items-center justify-between hover:bg-[#18191A] transition-colors">
                    <span className="text-sm text-white">Email Support</span>
                    <span className="text-xs text-[#B0B3B8]">support@smarter.poker</span>
                  </a>
                  <div className="p-4 flex items-center justify-between">
                    <span className="text-sm text-white">Staff User</span>
                    <span className="text-xs text-[#B0B3B8]">{staff?.name || 'Unknown'} ({staff?.role || 'staff'})</span>
                  </div>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    <style>{`
`}</style>
    </>
    </CommanderLayout>
  );
}

function InfoRow({ label, value, badge, mono }) {
  return (
    <div className="p-4 flex items-center justify-between">
      <span className="text-sm text-[#B0B3B8]">{label}</span>
      {badge ? (
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[#31A24C]/10 text-[#31A24C] uppercase">{value}</span>
      ) : (
        <span className={`text-sm text-white ${mono ? 'font-mono' : ''}`}>{value}</span>
      )}
    </div>
  );
}
