/**
 * Table Utilization Report
 * /commander/reports/table-utilization
 * Per-table hours, uptime %, avg players, peak hours, hourly heatmap
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import { LayoutGrid, Loader2, RefreshCw, Clock, Users, TrendingUp, ArrowLeft } from 'lucide-react';
import { busEmit } from '../../../src/engine/EventBus';
import { getStaffData } from '../../../src/lib/commander/clientAuth';
import { commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';
import PageBar from '../../../src/components/commander/shared/PageBar';

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: '7 Days' },
  { value: 'month', label: '30 Days' },
];

export default function TableUtilization() {
  useEffect(() => { busEmit.sessionStart('commander-reports-table-utilization'); }, []);
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('week');
  const [venueId, setVenueId] = useState(null);

  useEffect(() => {
    try { const s = getStaffData(); if (s.venue_id) setVenueId(s.venue_id); } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  }, []);

  const fetchData = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
const json = await commanderFetchJSON(`/api/commander/reports/table-utilization?venue_id=${venueId}&range=${range}`, {});
      if (json.success) setData(json.data);
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, [venueId, range]);

  useEffect(() => { const _c = new AbortController(); fetchData(_c.signal); return () => _c.abort(); }, [fetchData]);

  const s = data?.summary || {};
  const maxHeat = Math.max(...(data?.hourly_heatmap || [1]), 1);
  const fmtHour = h => h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;

  return (
    <>
      <SEOHead
        title="Commander - Table Utilization"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#040D18] text-[#F2F7FF] font-['Inter']">
        <PageBar
          title="Table Utilization"
          summary="How Hard Your Tables Are Working: Total Table Hours, Average Uptime, Active Tables And Per Table Usage For The Selected Range. Pick A Range Below To Change The Period."
          className="bg-[#0A1829] border-b border-[#445E77] px-4 py-1.5"
        >
          <button onClick={() => router.push('/commander/reports')} aria-label="Back To Reports" className="w-11 h-11 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: '#2A4560', border: '1px solid #3A5873' }}><ArrowLeft className="w-5 h-5 text-white" /></button>
          <span className="text-xs font-semibold text-[#BDD0E2] flex-1" role="status">{RANGES.find(r => r.value === range)?.label}</span>
          <button onClick={fetchData} className="w-11 h-11 rounded-lg flex items-center justify-center active:bg-[#132A42]" aria-label="Refresh"><RefreshCw className="w-5 h-5 text-[#BDD0E2]" /></button>
        </PageBar>

        <div className="px-4 py-3 flex gap-2">
          {RANGES.map(r => (
            <button key={r.value} onClick={() => setRange(r.value)}
              className={`flex-1 py-2.5 rounded-xl text-xs font-semibold ${range === r.value ? 'bg-[#0C55C0] text-white' : 'bg-[#132A42] text-[#BDD0E2] active:bg-[#1B3753]'}`}>{r.label}</button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-[#86DAFF] animate-spin" /></div>
        ) : (
          <div className="px-4 pb-6 space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Total Table Hours', value: s.total_table_hours || 0, icon: Clock, color: '#1981EC' },
                { label: 'Avg Uptime', value: `${s.avg_uptime_percent || 0}%`, icon: TrendingUp, color: '#31A24C' },
                { label: 'Active Tables', value: `${s.active_tables || 0}/${s.total_tables || 0}`, icon: LayoutGrid, color: '#22D3EE' },
                { label: 'Total Sessions', value: s.total_sessions || 0, icon: Users, color: '#5AA9FF' },
              ].map((c, i) => (
                <div key={i} className="bg-[#0A1829] border border-[#445E77] rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: c.color + '15' }}>
                      <c.icon className="w-4 h-4" style={{ color: c.color }} />
                    </div>
                    <span className="text-xs text-[#BDD0E2]">{c.label}</span>
                  </div>
                  <p className="text-2xl font-bold text-white">{c.value}</p>
                </div>
              ))}
            </div>

            {/* Per-table breakdown */}
            <div className="bg-[#0A1829] border border-[#445E77] rounded-2xl p-4">
              <h3 className="text-sm font-bold text-white mb-3">Per Table</h3>
              <div className="space-y-3">
                {(data?.tables || []).sort((a, b) => b.total_hours - a.total_hours).map(t => {
                  const uptimeColor = t.uptime_percent >= 60 ? '#31A24C' : t.uptime_percent >= 30 ? '#22D3EE' : '#EF4444';
                  return (
                    <div key={t.table_number} className="bg-[#132A42]/30 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-10 h-10 rounded-full bg-[#0C55C0]/15 flex items-center justify-center">
                            <span className="text-sm font-bold text-[#86DAFF]">T{t.table_number}</span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">{t.table_name || `Table ${t.table_number}`}</p>
                            <p className="text-xs text-[#BDD0E2]">{t.max_seats} Seats, {t.current_mode}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold" style={{ color: uptimeColor }}>{t.uptime_percent}%</p>
                          <p className="text-xs text-[#BDD0E2]">Uptime</p>
                        </div>
                      </div>
                      {/* Uptime bar */}
                      <div className="h-2 bg-[#040D18] rounded-full overflow-hidden mb-2">
                        <div className="h-full rounded-full" style={{ width: `${t.uptime_percent}%`, background: uptimeColor }} />
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div><p className="text-sm font-bold text-white">{t.total_hours}h</p><p className="text-[10px] text-[#93A9C0]">Total</p></div>
                        <div><p className="text-sm font-bold text-white">{t.hours_per_day}h</p><p className="text-[10px] text-[#93A9C0]">Per Day</p></div>
                        <div><p className="text-sm font-bold text-white">{t.session_count}</p><p className="text-[10px] text-[#93A9C0]">Sessions</p></div>
                        <div><p className="text-sm font-bold text-white">{fmtHour(t.peak_hour)}</p><p className="text-[10px] text-[#93A9C0]">Peak</p></div>
                      </div>
                    </div>
                  );
                })}
                {(data?.tables || []).length === 0 && <p className="text-sm text-[#93A9C0] text-center py-4">No Table Data For This Period</p>}
              </div>
            </div>

            {/* Hourly Heatmap */}
            {(data?.hourly_heatmap || []).some(v => v > 0) && (
              <div className="bg-[#0A1829] border border-[#445E77] rounded-2xl p-4">
                <h3 className="text-sm font-bold text-white mb-3">Hourly Activity</h3>
                <div className="grid grid-cols-12 gap-1">
                  {(data?.hourly_heatmap || []).slice(8, 24).map((v, i) => {
                    const hour = i + 8;
                    const intensity = v / maxHeat;
                    const bg = v === 0 ? '#2A456030' : `rgba(25, 129, 236, ${0.15 + intensity * 0.85})`;
                    return (
                      <div key={hour} className="flex flex-col items-center gap-1">
                        <div className="w-full aspect-square rounded-md flex items-center justify-center" style={{ background: bg }}>
                          <span className="text-[9px] font-bold text-white">{v || ''}</span>
                        </div>
                        <span className="text-[8px] text-[#93A9C0]">{fmtHour(hour)}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-[#93A9C0] text-center mt-2">Sessions Started Per Hour (8AM-12AM)</p>
              </div>
            )}
          </div>
        )}
      </div>
      <style>{`
`}</style>
    </>
  );
}
