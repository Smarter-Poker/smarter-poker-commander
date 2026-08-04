/**
 * Exports Hub
 * /commander/exports
 * Create CSV/JSON exports: players, sessions, tournaments, analytics, comps, audit logs
 * Hendon Mob tournament export
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Download, FileText, Loader2, RefreshCw, Clock, Users, Trophy, BarChart3, Gift, Shield, X } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../src/engine/EventBus';
import { broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { getStaffData } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';

const EXPORT_TYPES = [
  { value: 'players', label: 'Player Data', icon: Users, desc: 'Member profiles, stats, visit history', color: '#1877F2' },
  { value: 'sessions', label: 'Player Sessions', icon: Clock, desc: 'Check-ins, time played, table assignments', color: '#31A24C' },
  { value: 'tournaments', label: 'Tournaments', icon: Trophy, desc: 'Tournament results, entries, payouts', color: '#F59E0B' },
  { value: 'analytics', label: 'Daily Analytics', icon: BarChart3, desc: 'Daily metrics, revenue, player counts', color: '#A855F7' },
  { value: 'comps', label: 'Comp Transactions', icon: Gift, desc: 'Comp earn/redeem history', color: '#EF4444' },
  { value: 'audit_logs', label: 'Audit Logs', icon: Shield, desc: 'Staff actions, security events', color: '#6B7280' },
];

const STATUS_STYLES = {
  pending: { bg: 'bg-[#F59E0B]/15', text: 'text-[#F59E0B]', label: 'Pending' },
  processing: { bg: 'bg-[#1877F2]/15', text: 'text-[#1877F2]', label: 'Processing' },
  completed: { bg: 'bg-[#31A24C]/15', text: 'text-[#31A24C]', label: 'Ready' },
  failed: { bg: 'bg-[#EF4444]/15', text: 'text-[#EF4444]', label: 'Failed' }
};

export default function ExportsHub() {
  useEffect(() => { busEmit.sessionStart('commander-exports'); }, []);
  const router = useRouter();
  const [exports, setExports] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [message, setMessage] = useState(null);
  const [showOptions, setShowOptions] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [format, setFormat] = useState('csv');

  useEffect(() => {
    try { const s = getStaffData(); if (s.venue_id) setVenueId(s.venue_id); } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  }, []);

  const fetchData = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const [expRes, tRes] = await Promise.all([
        commanderFetch(`/api/commander/exports?venue_id=${venueId}`).catch(() => ({ ok: false })),
        commanderFetch(`/api/commander/tournaments?venue_id=${venueId}&status=completed&limit=20`).catch(() => ({ ok: false })),
      ]);
      const expJson = await expRes.json().catch(() => ({ exports: [] }));
      const tJson = await tRes.json().catch(() => ({ data: { tournaments: [] } }));
      setExports(expJson.exports || []);
      // Tournaments API nests under data.tournaments — data itself is an object
      setTournaments(tJson.data?.tournaments || (Array.isArray(tJson.data) ? tJson.data : []));
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, [venueId]);

  useEffect(() => { const _c = new AbortController(); fetchData(_c.signal); return () => _c.abort(); }, [fetchData]);

  const createExport = async (exportType) => {
    setCreating(exportType);
    try {
const res = await commanderFetch('/api/commander/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venueId,
          export_type: exportType,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          format
        })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (res.ok && json.export) {
        setMessage({ type: 'success', text: 'Export Created!' });
        setShowOptions(null);
        fetchData();
        broadcastChange('exports');
      } else {
        setMessage({ type: 'error', text: json.error || 'Export failed' });
      }
    } catch (err) { setMessage({ type: 'error', text: 'Network Error' }); }
    finally { setCreating(null); }
  };

  const downloadExport = (exp) => {
    if (!exp.file_url) return;
    const a = document.createElement('a');
    a.href = exp.file_url;
    a.download = `${exp.export_type}_${exp.created_at?.split('T')[0] || 'export'}.${exp.format || 'csv'}`;
    a.click();
  };

  const exportHendonMob = async (tournamentId) => {
    setCreating('hendon');
    try {
      const res = await commanderFetch(`/api/commander/exports/hendon-mob?tournament_id=${tournamentId}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hendon_mob_${tournamentId}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setMessage({ type: 'success', text: 'Hendon Mob Export Downloaded!' });
      } else {
        const json = await res.json();
        setMessage({ type: 'error', text: json.error || 'Hendon Mob export failed' });
      }
    } catch (err) { setMessage({ type: 'error', text: 'Network Error' }); }
    finally { setCreating(null); }
  };

  useEffect(() => {
    if (message) { const t = setTimeout(() => setMessage(null), 3000); return () => clearTimeout(t); }
  }, [message]);

  return (
    <CommanderLayout title="Data Exports" backHref="/commander/dashboard">
      <SEOHead
        title="Commander — Data Exports"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-[#B0B3B8]">Download Venue Data As CSV Or JSON</p>
          </div>
          <button onClick={fetchData} className="p-2 rounded-lg active:bg-[#3A3B3C]"><RefreshCw className="w-5 h-5 text-[#B0B3B8]" /></button>
        </div>

        {message && (
          <div className={`mx-4 mt-3 px-4 py-2.5 rounded-xl text-sm font-medium ${message.type === 'success' ? 'bg-[#31A24C]/15 text-[#31A24C]' : 'bg-[#EF4444]/15 text-[#EF4444]'
            }`}>{message.text}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" /></div>
        ) : (
          <div className="px-4 py-4 space-y-4">
            {/* Export Types */}
            <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl p-4">
              <h3 className="text-sm font-bold text-white mb-3">Create Export</h3>
              <div className="grid grid-cols-2 gap-2">
                {EXPORT_TYPES.map(et => (
                  <button key={et.value} onClick={() => setShowOptions(et.value)}
                    className="bg-[#3A3B3C]/30 rounded-xl p-3 text-left active:bg-[#3A3B3C]/60 border border-transparent hover:border-[#4E4F50]">
                    <div className="flex items-center gap-2 mb-1">
                      <et.icon className="w-4 h-4" style={{ color: et.color }} />
                      <span className="text-sm font-medium text-white">{et.label}</span>
                    </div>
                    <p className="text-[10px] text-[#6A6B6D]">{et.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Hendon Mob */}
            {tournaments.length > 0 && (
              <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl p-4">
                <h3 className="text-sm font-bold text-white mb-2">Hendon Mob Export</h3>
                <p className="text-xs text-[#B0B3B8] mb-3">Export Completed Tournament Results In Hendon Mob Format</p>
                <div className="space-y-2">
                  {tournaments.slice(0, 5).map(t => (
                    <div key={t.id} className="flex items-center justify-between px-3 py-2 bg-[#3A3B3C]/30 rounded-lg">
                      <div>
                        <p className="text-sm text-white">{t.name}</p>
                        <p className="text-xs text-[#6A6B6D]">
                          {t.created_at ? new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                        </p>
                      </div>
                      <button onClick={() => exportHendonMob(t.id)} disabled={creating === 'hendon'}
                        className="px-3 py-1.5 rounded-lg bg-[#1877F2] text-white text-xs font-medium active:bg-[#1565D8] disabled:opacity-50 flex items-center gap-1">
                        {creating === 'hendon' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        Export
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Exports */}
            <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#3A3B3C]">
                <h3 className="text-sm font-bold text-white">Recent Exports</h3>
              </div>
              {exports.length > 0 ? (
                <div className="divide-y divide-[#3A3B3C]">
                  {exports.map(exp => {
                    const st = STATUS_STYLES[exp.status] || STATUS_STYLES.pending;
                    return (
                      <div key={exp.id} className="px-4 py-3 flex items-center gap-3">
                        <FileText className="w-5 h-5 text-[#B0B3B8] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white capitalize">{exp.export_type?.replace(/_/g, ' ')}</p>
                          <p className="text-xs text-[#6A6B6D]">
                            {exp.format?.toUpperCase()} • {exp.row_count != null ? `${exp.row_count} rows` : ''}
                            {exp.created_at && ` • ${new Date(exp.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
                          </p>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${st.bg} ${st.text}`}>{st.label}</span>
                        {exp.status === 'completed' && exp.file_url && (
                          <button onClick={() => downloadExport(exp)}
                            className="w-8 h-8 rounded-lg bg-[#31A24C]/10 flex items-center justify-center active:bg-[#31A24C]/20">
                            <Download className="w-4 h-4 text-[#31A24C]" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center text-[#6A6B6D] text-sm">No Exports Yet</div>
              )}
            </div>
          </div>
        )}

        {/* Export Options Modal */}
        {showOptions && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-end">
            <div className="bg-[#242526] w-full rounded-t-3xl">
              <div className="px-4 py-4 border-b border-[#3A3B3C] flex items-center justify-between">
                <h2 className="text-lg font-bold text-white capitalize">Export {showOptions.replace(/_/g, ' ')}</h2>
                <button onClick={() => setShowOptions(null)} className="p-2 rounded-lg active:bg-[#3A3B3C]"><X className="w-5 h-5 text-[#B0B3B8]" /></button>
              </div>
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[#B0B3B8] mb-1.5 block">From Date</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                      className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-xl text-white text-sm focus:border-[#1877F2] focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-[#B0B3B8] mb-1.5 block">To Date</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                      className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-xl text-white text-sm focus:border-[#1877F2] focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[#B0B3B8] mb-1.5 block">Format</label>
                  <div className="flex gap-2">
                    {['csv', 'json'].map(f => (
                      <button key={f} onClick={() => setFormat(f)}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-semibold uppercase ${format === f ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'
                          }`}>{f}</button>
                    ))}
                  </div>
                </div>
                <button onClick={() => createExport(showOptions)} disabled={creating}
                  className="w-full py-4 rounded-xl bg-[#1877F2] text-white font-bold text-base flex items-center justify-center gap-2 active:bg-[#1565D8] disabled:opacity-50">
                  {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                  Create Export
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <style>{`
`}</style>
    </CommanderLayout>
  );
}
