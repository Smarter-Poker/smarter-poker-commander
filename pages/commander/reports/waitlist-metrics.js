/**
 * Waitlist Metrics Report
 * /commander/reports/waitlist-metrics
 * Avg wait time, conversion rate, no-show rate, game breakdown, hourly demand
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import { Users, Phone, Loader2, RefreshCw, AlertTriangle, CheckCircle2, ArrowLeft } from 'lucide-react';
import { busEmit } from '../../../src/engine/EventBus';
import { getStaffData } from '../../../src/lib/commander/clientAuth';
import { commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';
import PageBar from '../../../src/components/commander/shared/PageBar';
import InlineStyle from '../../../src/components/commander/shared/InlineStyle';

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: '7 Days' },
  { value: 'month', label: '30 Days' },
];

export default function WaitlistMetrics() {
  useEffect(() => { busEmit.sessionStart('commander-reports-waitlist-metrics'); }, []);
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
const json = await commanderFetchJSON(`/api/commander/reports/waitlist-metrics?venue_id=${venueId}&range=${range}`, {});
      if (json.success) setData(json.data);
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, [venueId, range]);

  useEffect(() => { const _c = new AbortController(); fetchData(_c.signal); return () => _c.abort(); }, [fetchData]);

  const s = data?.summary || {};
  const wt = data?.wait_times || {};
  const maxHourly = Math.max(...(data?.hourly_demand || [1]), 1);
  const fmtHour = h => h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;

  return (
    <>
      <SEOHead
        title="Commander - Waitlist Metrics"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#040D18] text-[#F2F7FF] font-['Inter']">
        <PageBar
          title="Waitlist Metrics"
          summary="How Long Players Wait To Be Seated: Average, Median And Longest Wait, And How Many Waitlist Entries Get Seated, For The Selected Range. Pick A Range Below To Change The Period."
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
            {/* Wait time hero */}
            <div className="bg-gradient-to-br from-[#0C55C0]/20 to-[#5AA9FF]/10 border border-[#1981EC]/30 rounded-2xl p-5 text-center">
              <p className="text-xs text-[#BDD0E2] uppercase tracking-wider mb-1">Average Wait Time</p>
              <p className="text-4xl font-bold text-white">{wt.average_minutes || 0}<span className="text-lg text-[#BDD0E2] ml-1">Min</span></p>
              <p className="text-sm text-[#BDD0E2] mt-1">Median {wt.median_minutes || 0}m, Max {wt.max_minutes || 0}m</p>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Total Entries', value: s.total_entries || 0, icon: Users, color: '#1981EC' },
                { label: 'Seated', value: `${s.seated || 0} (${s.call_to_seat_rate || 0}%)`, icon: CheckCircle2, color: '#31A24C' },
                { label: 'No-Shows', value: `${s.no_shows || 0} (${s.no_show_rate || 0}%)`, icon: AlertTriangle, color: '#EF4444' },
                { label: 'Phone Coverage', value: `${s.phone_coverage || 0}%`, icon: Phone, color: '#5AA9FF' },
              ].map((c, i) => (
                <div key={i} className="bg-[#0A1829] border border-[#445E77] rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: c.color + '15' }}>
                      <c.icon className="w-4 h-4" style={{ color: c.color }} />
                    </div>
                    <span className="text-xs text-[#BDD0E2]">{c.label}</span>
                  </div>
                  <p className="text-xl font-bold text-white">{c.value}</p>
                </div>
              ))}
            </div>

            {/* Game breakdown */}
            {(data?.game_breakdown || []).length > 0 && (
              <div className="bg-[#0A1829] border border-[#445E77] rounded-2xl p-4">
                <h3 className="text-sm font-bold text-white mb-3">By Game Type</h3>
                <div className="space-y-3">
                  {data.game_breakdown.map((g, i) => (
                    <div key={i} className="bg-[#132A42]/30 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-semibold text-white">{g.game}</p>
                        <span className="text-xs text-[#BDD0E2]">{g.total} Entries</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div><p className="text-sm font-bold text-[#31A24C]">{g.conversion_rate}%</p><p className="text-[10px] text-[#93A9C0]">Seated</p></div>
                        <div><p className="text-sm font-bold text-[#EF4444]">{g.no_show}</p><p className="text-[10px] text-[#93A9C0]">No-Show</p></div>
                        <div><p className="text-sm font-bold text-white">{g.avg_wait}m</p><p className="text-[10px] text-[#93A9C0]">Avg Wait</p></div>
                        <div><p className="text-sm font-bold text-white">{g.seated}</p><p className="text-[10px] text-[#93A9C0]">Seated</p></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Hourly demand */}
            {(data?.hourly_demand || []).some(v => v > 0) && (
              <div className="bg-[#0A1829] border border-[#445E77] rounded-2xl p-4">
                <h3 className="text-sm font-bold text-white mb-3">Peak Demand Hours</h3>
                <div className="flex items-end gap-1" style={{ height: 120 }}>
                  {(data?.hourly_demand || []).slice(8, 24).map((v, i) => {
                    const hour = i + 8;
                    const pct = (v / maxHourly) * 100;
                    const isTop = v === maxHourly && v > 0;
                    return (
                      <>
                        <div key={hour} className="flex-1 flex flex-col items-center justify-end h-full">
                          {v > 0 && <span className="text-[8px] text-[#BDD0E2] mb-0.5">{v}</span>}
                          <div className="w-full rounded-t" style={{
                            height: `${Math.max(pct, v > 0 ? 4 : 0)}%`,
                            background: isTop ? '#1981EC' : v > 0 ? '#1981EC' + '80' : '#2A456030',
                            minHeight: v > 0 ? 4 : 0
                          }} />
                          <span className="text-[7px] text-[#93A9C0] mt-1">{fmtHour(hour)}</span>
                        </div>
                      </>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Currently waiting */}
            {s.currently_waiting > 0 && (
              <div className="bg-[#22D3EE]/10 border border-[#22D3EE]/30 rounded-2xl p-4 text-center">
                <p className="text-sm text-[#22D3EE] font-medium">{s.currently_waiting} Player{s.currently_waiting !== 1 ? 's' : ''} Currently Waiting</p>
              </div>
            )}
          </div>
        )}
      </div>
      <InlineStyle css={`
`} />
    </>
  );
}
