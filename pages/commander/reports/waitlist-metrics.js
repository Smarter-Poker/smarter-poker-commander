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
        title="Commander — Waitlist Metrics"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/commander/reports')} className="p-2 rounded-lg flex-shrink-0" style={{ background: '#3A3B3C', border: '1px solid #4A4B4C' }}><ArrowLeft className="w-5 h-5 text-white" /></button>
          <div className="flex-1"><h1 className="text-lg font-bold text-white">Waitlist Metrics</h1><p className="text-xs text-[#B0B3B8]">{RANGES.find(r => r.value === range)?.label}</p></div>
          <button onClick={fetchData} className="p-2 rounded-lg active:bg-[#3A3B3C]"><RefreshCw className="w-5 h-5 text-[#B0B3B8]" /></button>
        </div>

        <div className="px-4 py-3 flex gap-2">
          {RANGES.map(r => (
            <button key={r.value} onClick={() => setRange(r.value)}
              className={`flex-1 py-2.5 rounded-xl text-xs font-semibold ${range === r.value ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8] active:bg-[#4A4B4C]'}`}>{r.label}</button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" /></div>
        ) : (
          <div className="px-4 pb-6 space-y-4">
            {/* Wait time hero */}
            <div className="bg-gradient-to-br from-[#1877F2]/20 to-[#A855F7]/10 border border-[#1877F2]/30 rounded-2xl p-5 text-center">
              <p className="text-xs text-[#B0B3B8] uppercase tracking-wider mb-1">Average Wait Time</p>
              <p className="text-4xl font-bold text-white">{wt.average_minutes || 0}<span className="text-lg text-[#B0B3B8] ml-1">Min</span></p>
              <p className="text-sm text-[#B0B3B8] mt-1">Median {wt.median_minutes || 0}m — Max {wt.max_minutes || 0}m</p>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Total Entries', value: s.total_entries || 0, icon: Users, color: '#1877F2' },
                { label: 'Seated', value: `${s.seated || 0} (${s.call_to_seat_rate || 0}%)`, icon: CheckCircle2, color: '#31A24C' },
                { label: 'No-Shows', value: `${s.no_shows || 0} (${s.no_show_rate || 0}%)`, icon: AlertTriangle, color: '#EF4444' },
                { label: 'Phone Coverage', value: `${s.phone_coverage || 0}%`, icon: Phone, color: '#A855F7' },
              ].map((c, i) => (
                <div key={i} className="bg-[#242526] border border-[#3A3B3C] rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: c.color + '15' }}>
                      <c.icon className="w-4 h-4" style={{ color: c.color }} />
                    </div>
                    <span className="text-xs text-[#B0B3B8]">{c.label}</span>
                  </div>
                  <p className="text-xl font-bold text-white">{c.value}</p>
                </div>
              ))}
            </div>

            {/* Game breakdown */}
            {(data?.game_breakdown || []).length > 0 && (
              <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl p-4">
                <h3 className="text-sm font-bold text-white mb-3">By Game Type</h3>
                <div className="space-y-3">
                  {data.game_breakdown.map((g, i) => (
                    <div key={i} className="bg-[#3A3B3C]/30 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-semibold text-white">{g.game}</p>
                        <span className="text-xs text-[#B0B3B8]">{g.total} entries</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div><p className="text-sm font-bold text-[#31A24C]">{g.conversion_rate}%</p><p className="text-[10px] text-[#6A6B6D]">Seated</p></div>
                        <div><p className="text-sm font-bold text-[#EF4444]">{g.no_show}</p><p className="text-[10px] text-[#6A6B6D]">No-show</p></div>
                        <div><p className="text-sm font-bold text-white">{g.avg_wait}m</p><p className="text-[10px] text-[#6A6B6D]">Avg Wait</p></div>
                        <div><p className="text-sm font-bold text-white">{g.seated}</p><p className="text-[10px] text-[#6A6B6D]">Seated</p></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Hourly demand */}
            {(data?.hourly_demand || []).some(v => v > 0) && (
              <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl p-4">
                <h3 className="text-sm font-bold text-white mb-3">Peak Demand Hours</h3>
                <div className="flex items-end gap-1" style={{ height: 120 }}>
                  {(data?.hourly_demand || []).slice(8, 24).map((v, i) => {
                    const hour = i + 8;
                    const pct = (v / maxHourly) * 100;
                    const isTop = v === maxHourly && v > 0;
                    return (
                      <>
                        <div key={hour} className="flex-1 flex flex-col items-center justify-end h-full">
                          {v > 0 && <span className="text-[8px] text-[#B0B3B8] mb-0.5">{v}</span>}
                          <div className="w-full rounded-t" style={{
                            height: `${Math.max(pct, v > 0 ? 4 : 0)}%`,
                            background: isTop ? '#1877F2' : v > 0 ? '#1877F2' + '80' : '#3A3B3C30',
                            minHeight: v > 0 ? 4 : 0
                          }} />
                          <span className="text-[7px] text-[#6A6B6D] mt-1">{fmtHour(hour)}</span>
                        </div>
                      </>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Currently waiting */}
            {s.currently_waiting > 0 && (
              <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-2xl p-4 text-center">
                <p className="text-sm text-[#F59E0B] font-medium">{s.currently_waiting} player{s.currently_waiting !== 1 ? 's' : ''} currently waiting</p>
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
