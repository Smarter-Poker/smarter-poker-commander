/**
 * Player Churn Prediction
 * /commander/churn-prediction
 * AI-powered view of players at risk of not returning
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import {
  Brain, AlertTriangle, Users, TrendingDown,
  Loader2, ChevronDown, ChevronUp, Clock, Calendar
} from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

export default function ChurnPrediction() {
  useEffect(() => { busEmit.sessionStart('commander-churn-prediction'); }, []);
  const router = useRouter();
  const [staff, setStaff] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | high | medium
  const [expandedId, setExpandedId] = useState(null);

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

    if (staff?.venue_id) fetchPredictions();
    return () => _c.abort();
  }, [staff]);

  const fetchPredictions = async(signal) => {
    setLoading(true);
    try {
      const json = await commanderFetchJSON(`/api/commander/ai/churn-prediction?venue_id=${staff.venue_id}&limit=100`, signal ? { signal } : {});
      if (json.success) {
        setPredictions(json.data.predictions);
        setSummary(json.data.summary);
      }
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  };

  // Commander Data Bus - sync when members change
  useCommanderSync(staff?.venue_id || '', fetchPredictions, { entities: ['members'] });

  const filtered = predictions.filter(p => {
    if (filter === 'high') return p.risk === 'high';
    if (filter === 'medium') return p.risk === 'medium';
    return true;
  });

  const riskColor = (risk) => {
    if (risk === 'high') return { bg: '#FEF2F2', text: '#991B1B', bar: '#EF4444' };
    if (risk === 'medium') return { bg: '#FEF3C7', text: '#92400E', bar: '#F59E0B' };
    return { bg: '#ECFDF5', text: '#065F46', bar: '#10B981' };
  };

  return (
    <CommanderLayout title="Churn Prediction" backHref="/commander/dashboard?card=reports">
      <SEOHead
        title="Commander - Churn Prediction"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div style={{ minHeight: '100vh', background: '#F0F2F5', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ background: '#1877F2', color: 'white', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Brain size={22} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Player Churn Prediction</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>AI Analysis Of At-Risk Players</div>
          </div>
        </div>

        <div style={{ padding: 16, maxWidth: 600, margin: '0 auto' }}>
          {/* Summary */}
          {summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
              {[
                { label: 'Analyzed', val: summary.total_players_analyzed, color: '#1877F2', icon: Users },
                { label: 'High Risk', val: summary.high_risk, color: '#EF4444', icon: AlertTriangle },
                { label: 'Medium', val: summary.medium_risk, color: '#F59E0B', icon: TrendingDown },
                { label: 'Low Risk', val: summary.low_risk, color: '#10B981', icon: Users },
              ].map(c => (
                <div key={c.label} style={{ background: 'white', borderRadius: 10, padding: 10, border: '2px solid #E4E6EB', textAlign: 'center' }}>
                  <c.icon size={16} color={c.color} style={{ margin: '0 auto 4px' }} />
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#1C2526' }}>{c.val}</div>
                  <div style={{ fontSize: 10, color: '#65676B' }}>{c.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Filter */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {[
              { v: 'all', l: 'All Players' },
              { v: 'high', l: 'High Risk' },
              { v: 'medium', l: 'Medium Risk' }
            ].map(f => (
              <button key={f.v} onClick={() => setFilter(f.v)}
                style={{ flex: 1, padding: '8px 0', border: '2px solid', borderColor: filter === f.v ? '#1877F2' : '#CED0D4', borderRadius: 8, background: filter === f.v ? '#EBF5FF' : 'white', color: filter === f.v ? '#1877F2' : '#65676B', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {f.l}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={28} color="#1877F2" className="spin" /></div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#65676B', background: 'white', borderRadius: 12 }}>
              {filter === 'all' ? 'No Player Data To Analyze. Need At Least 2 Sessions Per Player' : `No ${filter} Risk Players`}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map(p => {
                const rc = riskColor(p.risk);
                const isExpanded = expandedId === p.player_id;
                return (
                  <div key={p.player_id} style={{ background: 'white', borderRadius: 10, border: `2px solid ${p.risk === 'high' ? '#FCA5A5' : '#E4E6EB'}`, overflow: 'hidden' }}>
                    <button onClick={() => setExpandedId(isExpanded ? null : p.player_id)}
                      style={{ width: '100%', padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
                      {/* Risk gauge */}
                      <div style={{ width: 40, height: 40, borderRadius: 20, background: rc.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: rc.text }}>{p.risk_score}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#1C2526' }}>{p.player_name}</div>
                        <div style={{ fontSize: 12, color: '#65676B', display: 'flex', gap: 8 }}>
                          <span>{p.days_since_visit}d Ago</span>
                          <span>{p.visits_last_30} Visits/30d</span>
                        </div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: rc.bg, color: rc.text, textTransform: 'uppercase' }}>
                        {p.risk}
                      </span>
                      {isExpanded ? <ChevronUp size={16} color="#65676B" /> : <ChevronDown size={16} color="#65676B" />}
                    </button>

                    {isExpanded && (
                      <div style={{ padding: '0 14px 14px', borderTop: '2px solid #F0F2F5' }}>
                        {/* Risk bar */}
                        <div style={{ marginTop: 10, marginBottom: 10 }}>
                          <div style={{ height: 8, background: '#F0F2F5', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${p.risk_score}%`, background: rc.bar, borderRadius: 4 }} />
                          </div>
                        </div>

                        {/* Stats */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 10 }}>
                          {[
                            { label: 'Last Visit', val: `${p.days_since_visit}d Ago`, icon: Calendar },
                            { label: 'Avg Gap', val: `${p.avg_gap_days}d`, icon: Clock },
                            { label: '90d Sessions', val: p.total_sessions_90d, icon: Users },
                          ].map(s => (
                            <div key={s.label} style={{ textAlign: 'center', padding: 8, background: '#F9FAFB', borderRadius: 8 }}>
                              <s.icon size={12} color="#65676B" style={{ margin: '0 auto 2px' }} />
                              <div style={{ fontSize: 14, fontWeight: 700, color: '#1C2526' }}>{s.val}</div>
                              <div style={{ fontSize: 10, color: '#65676B' }}>{s.label}</div>
                            </div>
                          ))}
                        </div>

                        {/* Visit trend */}
                        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                          <div style={{ flex: 1, padding: 8, background: p.visits_last_30 < p.visits_prev_30 ? '#FEF2F2' : '#ECFDF5', borderRadius: 8, textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: '#65676B' }}>Last 30d</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: p.visits_last_30 < p.visits_prev_30 ? '#EF4444' : '#10B981' }}>{p.visits_last_30}</div>
                          </div>
                          <div style={{ flex: 1, padding: 8, background: '#F9FAFB', borderRadius: 8, textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: '#65676B' }}>Prev 30d</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: '#1C2526' }}>{p.visits_prev_30}</div>
                          </div>
                          <div style={{ flex: 1, padding: 8, background: '#F9FAFB', borderRadius: 8, textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: '#65676B' }}>Avg Session</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: '#1C2526' }}>{p.avg_session_minutes}m</div>
                          </div>
                        </div>

                        {/* Risk factors */}
                        {p.factors.length > 0 && (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#65676B', marginBottom: 4 }}>Risk Factors</div>
                            {p.factors.map((f, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', fontSize: 13 }}>
                                <AlertTriangle size={12} color={rc.bar} />
                                <span style={{ color: '#444' }}>{f}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <style>{`
.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </CommanderLayout>
  );
}
