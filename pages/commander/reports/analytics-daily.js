/**
 * Analytics Daily Report
 * /commander/reports/analytics-daily
 * View aggregated daily analytics from cron + manual refresh
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import { BarChart3, Users, DollarSign, Clock, TrendingUp, Loader2, RefreshCw, Trophy, CreditCard, AlertTriangle, ArrowLeft } from 'lucide-react';
import { busEmit } from '../../../src/engine/EventBus';
import { getStaffSession } from '../../../src/lib/commander/clientAuth';
import { commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';

export default function AnalyticsDailyReport() {
  useEffect(() => { busEmit.sessionStart('commander-reports-analytics-daily'); }, []);
  const router = useRouter();
  const [staff, setStaff] = useState(null);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState(14);
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {    const _c = new AbortController();

    const stored = getStaffSession();
    if (!stored) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
    try {
      const s = JSON.parse(stored);
      if (!s.venue_id) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
      setStaff(s);
    } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
    return () => _c.abort();
  }, []);

  useEffect(() => {    const _c = new AbortController();

    if (staff?.venue_id) fetchAnalytics();
    return () => _c.abort();
  }, [staff, range]);

  const fetchAnalytics = async(signal) => {
    setLoading(true);
    try {
const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - range * 86400000).toISOString().split('T')[0];
      const json = await commanderFetchJSON(`/api/commander/analytics/daily?venue_id=${staff.venue_id}&start_date=${startDate}&end_date=${endDate}&days=${range}`, {});
      if (json.analytics) {
        setData(Array.isArray(json.analytics) ? json.analytics : [json.analytics]);
      } else if (json.data) {
        setData(Array.isArray(json.data) ? json.data : [json.data]);
      } else {
        setData([]);
      }
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
// Trigger cron for yesterday
      // Manual aggregate trigger removed 2026-04-27 (Phase 2B.3 cleanup).
      // Aggregation now runs automatically every day at 03:00 UTC via Open Claw
      // → workers VM (10.0.0.3:8081/cron/commander-daily-aggregate). Manual
      // refresh just re-fetches current data; if yesterday's aggregate hasn't
      // run yet, it'll appear after the next scheduled fire.
      setToast({ type: 'info', msg: 'Aggregation runs automatically daily at 03:00 UTC. Re-fetching current data…' });
      fetchAnalytics();
    } catch (err) {
      setLoading(false);
      setToast({ type: 'error', msg: 'Network error' });
    }
    finally { setRefreshing(false); setTimeout(() => setToast(null), 3000); }
  };

  // Calculate totals/averages across the date range
  const totals = data.reduce((acc, d) => ({
    sessions: acc.sessions + (d.total_sessions || 0),
    players: acc.players + (d.unique_players || 0),
    playHours: acc.playHours + parseFloat(d.total_play_hours || 0),
    tableHours: acc.tableHours + parseFloat(d.table_hours || 0),
    timeRevenue: acc.timeRevenue + parseFloat(d.time_revenue || 0),
    tournamentFees: acc.tournamentFees + parseFloat(d.tournament_fees || 0),
    cashIn: acc.cashIn + parseFloat(d.cash_in || 0),
    cashOut: acc.cashOut + parseFloat(d.cash_out || 0),
    netDrop: acc.netDrop + parseFloat(d.net_drop || 0),
    waitlistEntries: acc.waitlistEntries + (d.waitlist_entries || 0),
    waitlistSeated: acc.waitlistSeated + (d.waitlist_seated || 0),
    noShows: acc.noShows + (d.waitlist_no_shows || 0),
    incidents: acc.incidents + (d.incidents_count || 0),
    promoValue: acc.promoValue + parseFloat(d.promotion_value_awarded || 0),
    days: acc.days + 1
  }), { sessions: 0, players: 0, playHours: 0, tableHours: 0, timeRevenue: 0, tournamentFees: 0, cashIn: 0, cashOut: 0, netDrop: 0, waitlistEntries: 0, waitlistSeated: 0, noShows: 0, incidents: 0, promoValue: 0, days: 0 });

  const avg = (v) => totals.days > 0 ? (v / totals.days).toFixed(1) : '0';
  const fmt = (v) => `$${parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  // Find max values for chart scaling
  const maxSessions = Math.max(...data.map(d => d.total_sessions || 0), 1);
  const maxRevenue = Math.max(...data.map(d => parseFloat(d.time_revenue || 0) + parseFloat(d.tournament_fees || 0)), 1);

  return (
    <>
      <SEOHead
        title="Commander — Analytics Daily"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div style={{ minHeight: '100vh', background: '#F0F2F5', fontFamily: 'Inter, system-ui, sans-serif' }}>
        {/* Header */}
        <div style={{ background: '#1877F2', color: 'white', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/commander/reports')} style={{ background: 'white', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}>
            <ArrowLeft size={20} color="#1877F2" />
          </button>
          <BarChart3 size={22} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Analytics Daily</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Aggregated Daily Metrics (auto-runs At 4 AM)</div>
          </div>
          <button onClick={handleManualRefresh} disabled={refreshing}
            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 8, padding: '6px 12px', color: 'white', cursor: refreshing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> Refresh
          </button>
        </div>

        {toast && (
          <div style={{ margin: 12, padding: '10px 14px', borderRadius: 8, background: toast.type === 'success' ? '#DEF7EC' : '#FEE2E2', color: toast.type === 'success' ? '#03543F' : '#991B1B', fontSize: 14, fontWeight: 600 }}>
            {toast.msg}
          </div>
        )}

        <div style={{ padding: 16, maxWidth: 700, margin: '0 auto' }}>
          {/* Range Selector */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {[{ v: 7, l: '7 Days' }, { v: 14, l: '14 Days' }, { v: 30, l: '30 Days' }, { v: 90, l: '90 Days' }].map(r => (
              <button key={r.v} onClick={() => setRange(r.v)}
                style={{ flex: 1, padding: '8px 0', border: '2px solid', borderColor: range === r.v ? '#1877F2' : '#CED0D4', borderRadius: 8, background: range === r.v ? '#EBF5FF' : 'white', color: range === r.v ? '#1877F2' : '#65676B', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {r.l}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={28} color="#1877F2" className="spin" /></div>
          ) : data.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#65676B', background: 'white', borderRadius: 12 }}>
              <div style={{ marginBottom: 10 }}>No Analytics Data For This Period</div>
              <button onClick={handleManualRefresh} style={{ background: '#1877F2', color: 'white', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Run Analytics Now
              </button>
            </div>
          ) : (
            <>
              {/* Period Summary */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Total Sessions', val: totals.sessions, avg: avg(totals.sessions) + '/day', icon: Users, color: '#1877F2' },
                  { label: 'Unique Players', val: totals.players, avg: avg(totals.players) + '/day', icon: Users, color: '#31A24C' },
                  { label: 'Table Hours', val: totals.tableHours.toFixed(0), avg: avg(totals.tableHours) + '/day', icon: Clock, color: '#F59E0B' },
                  { label: 'Time Revenue', val: fmt(totals.timeRevenue), avg: fmt(totals.timeRevenue / Math.max(totals.days, 1)) + '/day', icon: DollarSign, color: '#31A24C' },
                  { label: 'Tournament Fees', val: fmt(totals.tournamentFees), avg: '', icon: Trophy, color: '#9333EA' },
                  { label: 'Net Drop', val: fmt(totals.netDrop), avg: '', icon: CreditCard, color: totals.netDrop >= 0 ? '#31A24C' : '#EF4444' },
                  { label: 'Waitlist Seated', val: `${totals.waitlistSeated}/${totals.waitlistEntries}`, avg: totals.waitlistEntries > 0 ? `${Math.round(totals.waitlistSeated / totals.waitlistEntries * 100)}% conv` : '', icon: TrendingUp, color: '#1877F2' },
                  { label: 'Incidents', val: totals.incidents, avg: '', icon: AlertTriangle, color: '#EF4444' },
                ].map(c => (
                  <div key={c.label} style={{ background: 'white', borderRadius: 10, padding: 14, border: '2px solid #E4E6EB' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <c.icon size={14} color={c.color} />
                      <span style={{ fontSize: 12, color: '#65676B', fontWeight: 600 }}>{c.label}</span>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#1C2526' }}>{c.val}</div>
                    {c.avg && <div style={{ fontSize: 11, color: '#65676B', marginTop: 2 }}>{c.avg}</div>}
                  </div>
                ))}
              </div>

              {/* Sessions Trend Chart */}
              <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '2px solid #E4E6EB', marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#1C2526', marginBottom: 12 }}>Sessions Per Day</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[...data].sort((a, b) => a.date > b.date ? 1 : -1).slice(-14).map(d => {
                    const pct = ((d.total_sessions || 0) / maxSessions) * 100;
                    const dateLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    return (
                      <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 11, color: '#65676B', minWidth: 50, textAlign: 'right' }}>{dateLabel}</div>
                        <div style={{ flex: 1, height: 20, background: '#F0F2F5', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.max(pct, 2)}%`, background: '#1877F2', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6 }}>
                            {pct > 15 && <span style={{ fontSize: 10, color: 'white', fontWeight: 700 }}>{d.total_sessions}</span>}
                          </div>
                        </div>
                        {pct <= 15 && <span style={{ fontSize: 11, fontWeight: 600, color: '#444', minWidth: 20 }}>{d.total_sessions || 0}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Revenue Trend */}
              <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '2px solid #E4E6EB', marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#1C2526', marginBottom: 12 }}>Revenue Per Day</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[...data].sort((a, b) => a.date > b.date ? 1 : -1).slice(-14).map(d => {
                    const rev = parseFloat(d.time_revenue || 0) + parseFloat(d.tournament_fees || 0);
                    const pct = (rev / maxRevenue) * 100;
                    const dateLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    return (
                      <>
                        <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontSize: 11, color: '#65676B', minWidth: 50, textAlign: 'right' }}>{dateLabel}</div>
                          <div style={{ flex: 1, height: 20, background: '#F0F2F5', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.max(pct, 2)}%`, background: '#31A24C', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6 }}>
                              {pct > 20 && <span style={{ fontSize: 10, color: 'white', fontWeight: 700 }}>{fmt(rev)}</span>}
                            </div>
                          </div>
                          {pct <= 20 && <span style={{ fontSize: 11, fontWeight: 600, color: '#444', minWidth: 30 }}>{fmt(rev)}</span>}
                        </div>
                      </>
                    );
                  })}
                </div>
              </div>

              {/* Day-by-Day Detail */}
              <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '2px solid #E4E6EB' }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#1C2526', marginBottom: 12 }}>Day-by-Day Detail</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#F9FAFB' }}>
                        {['Date', 'Sessions', 'Players', 'Table Hrs', 'Revenue', 'WL Seated', 'No-Show'].map(h => (
                          <th key={h} style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: '#65676B', borderBottom: '2px solid #E4E6EB', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...data].sort((a, b) => a.date > b.date ? -1 : 1).map(d => (
                        <tr key={d.date} style={{ borderBottom: '2px solid #F0F2F5' }}>
                          <td style={{ padding: '8px 6px', fontWeight: 600, color: '#1C2526', whiteSpace: 'nowrap' }}>
                            {new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>{d.total_sessions || 0}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>{d.unique_players || 0}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>{parseFloat(d.table_hours || 0).toFixed(1)}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600, color: '#31A24C' }}>
                            {fmt(parseFloat(d.time_revenue || 0) + parseFloat(d.tournament_fees || 0))}
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>{d.waitlist_seated || 0}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: (d.waitlist_no_shows || 0) > 0 ? '#EF4444' : '#65676B' }}>{d.waitlist_no_shows || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <style>{`
.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
