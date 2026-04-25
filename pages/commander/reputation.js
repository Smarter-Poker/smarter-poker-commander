/**
 * Player Reputation
 * /commander/reputation
 * Staff view of player reputation scores + submit reviews
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Star, Loader2, ChevronDown, ChevronUp, Plus, X, Send } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../src/engine/EventBus';
import { broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

const RATING_LABELS = {
  reliability: { label: 'Reliability', desc: 'Shows up, stays committed' },
  sportsmanship: { label: 'Sportsmanship', desc: 'Handles wins/losses well' },
  etiquette: { label: 'Etiquette', desc: 'Follows rules, tips dealers' },
  communication: { label: 'Communication', desc: 'Clear, responsive' }
};

export default function PlayerReputation() {

  useEffect(() => { busEmit.sessionStart('commander-reputation'); }, []);
  const router = useRouter();
  const [staff, setStaff] = useState(null);
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedReviews, setExpandedReviews] = useState({});
  const [showReviewForm, setShowReviewForm] = useState(null);
  const [reviewForm, setReviewForm] = useState({ reliability: 3, sportsmanship: 3, etiquette: 3, communication: 3, comment: '', context: 'cash_game' });
  const [submitting, setSubmitting] = useState(false);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const _c = new AbortController();

    const stored = getStaffSession();
    if (!stored) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
    try {
      const s = JSON.parse(stored);
      if (!s.venue_id) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
      setStaff(s);
    } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
    return () => _c.abort();
  }, []);

  useEffect(() => {
    const _c = new AbortController();

    if (staff?.venue_id) fetchScores();
    return () => _c.abort();
  }, [staff]);

  const fetchScores = async (signal) => {
    setLoading(true);
    try {
const json = await commanderFetchJSON(`/api/commander/reputation?venue_id=${staff.venue_id}`, {});
      if (json.success) setScores(json.data.scores || []);
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  };

  const fetchReviews = async (playerId) => {
    try {
const json = await commanderFetchJSON(`/api/commander/reputation?player_id=${playerId}`, {});
      if (json.success) {
        setExpandedReviews(prev => ({ ...prev, [playerId]: json.data.recent_reviews || [] }));
      }
    } catch (err) { console.warn(err); }
  setLoading(false);
  };

  const toggleExpand = (playerId) => {
    if (expandedId === playerId) {
      setExpandedId(null);
    } else {
      setExpandedId(playerId);
      if (!expandedReviews[playerId]) fetchReviews(playerId);
    }
  };

  const submitReview = async () => {
    if (!showReviewForm) return;
    setSubmitting(true);
    try {
const res = await commanderFetch('/api/commander/reputation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_id: showReviewForm,
          reviewer_id: staff.id || staff.user_id,
          reviewer_type: 'staff',
          venue_id: staff.venue_id,
          ...reviewForm
        })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setShowReviewForm(null);
        setReviewForm({ reliability: 3, sportsmanship: 3, etiquette: 3, communication: 3, comment: '', context: 'cash_game' });
        fetchScores();
        if (expandedId) fetchReviews(expandedId);
        broadcastChange('reputation');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
    finally { setSubmitting(false); }
  };

  const scoreColor = (score) => {
    if (score >= 4) return '#10B981';
    if (score >= 3) return '#F59E0B';
    if (score >= 2) return '#EF4444';
    return '#6B7280';
  };

  const StarRow = ({ value, onChange, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: '#65676B', minWidth: 100 }}>{label}</span>
      <div style={{ display: 'flex', gap: 2 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onClick={() => onChange(n)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
            <Star size={18} fill={n <= value ? '#F59E0B' : 'none'} color={n <= value ? '#F59E0B' : '#D1D5DB'} />
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <CommanderLayout title="Player Reputation" backHref="/commander/dashboard?card=reports">
      <SEOHead
        title="Commander — Player Reputation"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div style={{ minHeight: '100vh', background: '#F0F2F5', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ padding: 16, maxWidth: 600, margin: '0 auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={28} color="#1877F2" className="spin" /></div>
          ) : scores.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#65676B', background: 'white', borderRadius: 12 }}>
              No player reputations yet. Use the Players page to add reviews.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {scores.map(s => {
                const isExpanded = expandedId === s.player_id;
                const reviews = expandedReviews[s.player_id] || [];
                return (
                  <div key={s.player_id} style={{ background: 'white', borderRadius: 10, border: '2px solid #E4E6EB', overflow: 'hidden' }}>
                    <button onClick={() => toggleExpand(s.player_id)}
                      style={{ width: '100%', padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
                      {/* Score badge */}
                      <div style={{ width: 42, height: 42, borderRadius: 21, background: `${scoreColor(s.overall_score)}15`, border: `2px solid ${scoreColor(s.overall_score)}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: scoreColor(s.overall_score) }}>{s.overall_score}</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#1C2526' }}>{s.player_name}</div>
                        <div style={{ fontSize: 12, color: '#65676B' }}>{s.total_reviews} reviews</div>
                      </div>
                      {/* Mini stars */}
                      <div style={{ display: 'flex', gap: 1 }}>
                        {[1, 2, 3, 4, 5].map(n => (
                          <Star key={n} size={12} fill={n <= Math.round(s.overall_score) ? '#F59E0B' : 'none'} color={n <= Math.round(s.overall_score) ? '#F59E0B' : '#D1D5DB'} />
                        ))}
                      </div>
                      {isExpanded ? <ChevronUp size={16} color="#65676B" /> : <ChevronDown size={16} color="#65676B" />}
                    </button>

                    {isExpanded && (
                      <div style={{ padding: '0 14px 14px', borderTop: '2px solid #F0F2F5' }}>
                        {/* Breakdown */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginTop: 10, marginBottom: 10 }}>
                          {Object.entries(RATING_LABELS || {}).map(([key, cfg]) => (
                            <div key={key} style={{ padding: 8, background: '#F9FAFB', borderRadius: 8, textAlign: 'center' }}>
                              <div style={{ fontSize: 16, fontWeight: 800, color: scoreColor(s[`${key}_avg`]) }}>{s[`${key}_avg`]}</div>
                              <div style={{ fontSize: 10, color: '#65676B' }}>{cfg.label}</div>
                            </div>
                          ))}
                        </div>

                        {/* Verification badges */}
                        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                          {[
                            { label: 'ID', verified: s.id_verified },
                            { label: 'Phone', verified: s.phone_verified },
                            { label: 'Payment', verified: s.payment_verified },
                          ].map(v => (
                            <span key={v.label} style={{
                              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                              background: v.verified ? '#DCFCE7' : '#F3F4F6',
                              color: v.verified ? '#166534' : '#9CA3AF',
                              border: `2px solid ${v.verified ? '#22C55E' : '#E5E7EB'}`
                            }}>
                              {v.verified ? '✓' : '○'} {v.label}
                            </span>
                          ))}
                        </div>

                        {/* Recent reviews */}
                        {reviews.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#65676B', marginBottom: 4 }}>RECENT REVIEWS</div>
                            {reviews.slice(0, 3).map((r, i) => (
                              <div key={i} style={{ padding: '6px 0', borderBottom: i < 2 ? '2px solid #F0F2F5' : 'none' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#65676B' }}>
                                  <span>{r.reviewer_type} • {r.context || 'general'}</span>
                                  <span>{new Date(r.created_at).toLocaleDateString()}</span>
                                </div>
                                {r.comment && <div style={{ fontSize: 13, color: '#444', marginTop: 2 }}>"{r.comment}"</div>}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Add review button */}
                        {showReviewForm === s.player_id ? (
                          <div style={{ background: '#F9FAFB', borderRadius: 10, padding: 12, border: '2px solid #E4E6EB' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: '#1C2526' }}>Add Review</span>
                              <button onClick={() => setShowReviewForm(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={16} color="#65676B" /></button>
                            </div>
                            <StarRow label="Reliability" value={reviewForm.reliability} onChange={v => setReviewForm(f => ({ ...f, reliability: v }))} />
                            <StarRow label="Sportsmanship" value={reviewForm.sportsmanship} onChange={v => setReviewForm(f => ({ ...f, sportsmanship: v }))} />
                            <StarRow label="Etiquette" value={reviewForm.etiquette} onChange={v => setReviewForm(f => ({ ...f, etiquette: v }))} />
                            <StarRow label="Communication" value={reviewForm.communication} onChange={v => setReviewForm(f => ({ ...f, communication: v }))} />
                            <select value={reviewForm.context} onChange={e => setReviewForm(f => ({ ...f, context: e.target.value }))}
                              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '2px solid #CED0D4', marginBottom: 6, fontSize: 13 }}>
                              <option value="cash_game">Cash Game</option>
                              <option value="tournament">Tournament</option>
                              <option value="home_game">Home Game</option>
                            </select>
                            <textarea value={reviewForm.comment} onChange={e => setReviewForm(f => ({ ...f, comment: e.target.value }))}
                              rows={2} placeholder="Comments (optional)"
                              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '2px solid #CED0D4', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }} />
                            <button onClick={submitReview} disabled={submitting}
                              style={{ width: '100%', background: '#1877F2', color: 'white', border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 14, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                              {submitting ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Submit Review
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setShowReviewForm(s.player_id)}
                            style={{ width: '100%', background: '#EBF5FF', color: '#1877F2', border: '2px solid #1877F2', borderRadius: 8, padding: '8px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <Plus size={14} /> Add Review
                          </button>
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
