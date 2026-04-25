/**
 * Floor Calls — Complete Rebuild
 * /commander/floor-calls
 *
 * Floor managers see:
 * - Live queue sorted by priority → time
 * - Category filter pills
 * - One-tap acknowledge → on-my-way → resolve
 * - New Call creation modal
 * - History with response time metrics
 * - Sound/vibration alerts for urgent calls
 *
 * Designed for quick triage on mobile.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { busEmit } from '../../src/engine/EventBus';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';

import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { Check, Clock, Loader2, RefreshCw, Bell, Plus, X, Volume2, VolumeX, Users, Shield, Wrench, DollarSign, Gavel, Coffee, HelpCircle, ArrowRight, CheckCircle2, Timer } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { getToken, getStaffSession, getVenueId } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';

/* ─── Constants ──────────────────────────────────────────────── */

const PRIORITY_CONFIG = {
  urgent: { color: '#EF4444', label: 'URGENT', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)' },
  high: { color: '#F59E0B', label: 'HIGH', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.3)' },
  normal: { color: '#1877F2', label: 'Normal', bg: 'rgba(24,119,242,0.08)', border: 'rgba(24,119,242,0.2)' },
  low: { color: '#8A8D91', label: 'Low', bg: 'rgba(138,141,145,0.08)', border: 'rgba(138,141,145,0.2)' } };

const STATUS_CONFIG = {
  pending: { color: '#EF4444', label: 'Pending', icon: Bell },
  acknowledged: { color: '#F59E0B', label: 'Acknowledged', icon: Check },
  en_route: { color: '#1877F2', label: 'En Route', icon: ArrowRight },
  resolved: { color: '#31A24C', label: 'Resolved', icon: CheckCircle2 },
  cancelled: { color: '#6B7280', label: 'Cancelled', icon: X } };

const REASON_CONFIG = {
  dispute: { icon: Gavel, label: 'Dispute', color: '#EF4444' },
  chip_fill: { icon: DollarSign, label: 'Chip Fill', color: '#F59E0B' },
  buyin: { icon: DollarSign, label: 'Buy-In / Cash', color: '#31A24C' },
  player_issue: { icon: Users, label: 'Player Issue', color: '#E4405F' },
  security: { icon: Shield, label: 'Security', color: '#EF4444' },
  maintenance: { icon: Wrench, label: 'Maintenance', color: '#6B7280' },
  dealer_relief: { icon: Coffee, label: 'Dealer Relief', color: '#8B5CF6' },
  floor_assistance: { icon: Bell, label: 'Floor Assist', color: '#1877F2' },
  other: { icon: HelpCircle, label: 'Other', color: '#B0B3B8' } };

const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };

/* ─── Helpers ────────────────────────────────────────────────── */

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 0) return 'now';
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function FloorCalls() {
  const router = useRouter();

  // ── EventBus: Commander session telemetry ──

  useEffect(() => { busEmit.sessionStart('commander-floor-calls'); }, []);
  const [calls, setCalls] = useState([]);
  const [resolved, setResolved] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('active'); // active | history
  const [now, setNow] = useState(Date.now());
  const [reasonFilter, setReasonFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [soundOn, setSoundOn] = useState(true);
  const [showNewCall, setShowNewCall] = useState(false);
  const [resolveModal, setResolveModal] = useState(null);
  const [resolveNote, setResolveNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const prevPendingRef = useRef(0);
  const audioRef = useRef(null);

  // New call form state
  const [newTable, setNewTable] = useState('');
  const [newReason, setNewReason] = useState('dispute');
  const [newPriority, setNewPriority] = useState('normal');
  const [newDesc, setNewDesc] = useState('');

  // Auth
  const getAuth = () => {
    const token = typeof window !== 'undefined'
      ? getToken() : null;
    const staffSession = typeof window !== 'undefined'
      ? getStaffSession() || '' : '';
    let venueId = '';
    try { venueId = JSON.parse(staffSession).venue_id || ''; } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    return { token, staffSession, venueId };
  };

  const [venueId] = useState(() => {
    return getVenueId();
  });

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ─── API ──────────────────────────────────────────────────── */

  const fetchCalls = useCallback(async () => {
    try {
      const { token, staffSession, venueId: vid } = getAuth();
      const headers = { };

      const [activeRes, resolvedRes] = await Promise.all([
        commanderFetch(`/api/commander/floor-calls?status=pending,acknowledged,en_route&venue_id=${vid}`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
        commanderFetch(`/api/commander/floor-calls?status=resolved&venue_id=${vid}&limit=30`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
      ]);

      const allActive = (activeRes.data || []).sort((a, b) => {
        const pA = PRIORITY_ORDER[a.priority] ?? 2;
        const pB = PRIORITY_ORDER[b.priority] ?? 2;
        if (pA !== pB) return pA - pB;
        return new Date(a.created_at) - new Date(b.created_at);
      });

      setCalls(allActive);
      setResolved(resolvedRes.data || []);
    } catch (err) { console.warn('Floor calls fetch error:', err); }
    finally { setLoading(false); }
  }, []);

  // Commander Data Bus — both BroadcastChannel (instant) + Supabase Realtime (cross-device)
  useCommanderSync(venueId, fetchCalls, { entities: ['floor_calls', 'tables'] });

  // Polling + clock
  useEffect(() => {
    const _c = new AbortController(); fetchCalls(_c.signal);
    const poll = setInterval(() => fetchCalls(_c.signal), 30000); // fallback — real-time sync handles instant updates
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [fetchCalls]);

  // Sound alert when new pending calls arrive
  useEffect(() => {
    const pendingCount = calls.filter(c => c.status === 'pending').length;
    if (pendingCount > prevPendingRef.current && soundOn) {
      playAlert();
      busEmit.screenShake('medium');
    }
    prevPendingRef.current = pendingCount;
  }, [calls, soundOn]);

  const playAlert = () => {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAAD+/wIA+/8EAPz/AwD+/wEA//8BAAAA//8AAAEA//8BAAAA/v8CAAEA/v8DAAEA/f8EAAIA/P8GAAQA+v8IAAgA9/8MAA4A8/8SABgA7f8bACMA5f8nADEA2v81AEEA0P9GAE8Axf9eAGMAuf92AHsAr/+SAJEAo/+sAKoAmf/EAMMAlP/dAN0AkP/2APYA');
      }
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  };

  const updateCall = async (id, status, resolution) => {
    try {
      const { token, staffSession } = getAuth();
      let respondedBy = '';
      try { const s = JSON.parse(staffSession); respondedBy = s.name || s.id || ''; } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

      const res = await commanderFetch(`/api/commander/floor-calls/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, responded_by: respondedBy, resolution })
      });
      if (res.ok) {
        fetchCalls(); // Changed from fetchData() to fetchCalls() to match existing function name
        broadcastChange('floor_calls');
      }
      if (status === 'resolved') busEmit.celebration('confetti');
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
  };

  const createCall = async () => {
    if (!newTable) return;
    setSubmitting(true);
    try {
      const { token, staffSession, venueId: vid } = getAuth();
      const res = await commanderFetch('/api/commander/floor-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: vid,
          table_number: parseInt(newTable),
          reason: newReason,
          priority: newPriority,
          description: newDesc,
          called_by: 'staff'
        })
      });
      if (res.ok) {
        setShowNewCall(false);
        setNewTable(''); setNewReason('dispute'); setNewPriority('normal'); setNewDesc('');
        fetchCalls();
        broadcastChange('floor_calls');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
    finally { setSubmitting(false); }
  };

  const handleResolve = async () => {
    if (!resolveModal) return;
    setSubmitting(true);
    await updateCall(resolveModal.id, 'resolved', resolveNote || 'Resolved');
    setResolveModal(null);
    setResolveNote('');
    setSubmitting(false);
  };

  /* ─── Filtered data ────────────────────────────────────────── */

  const filtered = calls.filter(c => {
    if (reasonFilter !== 'all' && c.reason !== reasonFilter) return false;
    if (priorityFilter !== 'all' && c.priority !== priorityFilter) return false;
    return true;
  });

  const pendingCount = calls.filter(c => c.status === 'pending').length;
  const urgentCount = calls.filter(c => c.priority === 'urgent' && c.status === 'pending').length;

  // Stats for history
  const avgResponse = resolved.length > 0
    ? Math.round(resolved.reduce((s, c) => s + (c.response_time_seconds || 0), 0) / resolved.length)
    : 0;

  /* ─── Render ───────────────────────────────────────────────── */

  return (
    <CommanderLayout title={`Floor Calls${pendingCount > 0 ? ` (${pendingCount})` : ''}`} backHref="/commander/dashboard?card=floor">
      <SEOHead title="Commander — Floor Calls" description="Club Commander Floor Call Management." noindex={true} />
      <div style={{ minHeight: '100vh', background: '#0D0E10', color: '#E4E6EB', fontFamily: 'Inter, sans-serif' }}>

        {/* ── Header ───────────────────────────────── */}
        <div style={{ background: '#18191A', borderBottom: '1px solid #2A2B2D', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={18} color={pendingCount > 0 ? '#EF4444' : '#B0B3B8'} />
              Floor Calls
              {pendingCount > 0 && (
                <span style={{ fontSize: 13, fontWeight: 700, background: '#EF4444', color: '#fff', borderRadius: 12, padding: '2px 8px', minWidth: 22, textAlign: 'center' }}>{pendingCount}</span>
              )}
            </h1>
            {urgentCount > 0 && (
              <p style={{ fontSize: 11, color: '#EF4444', fontWeight: 600, margin: '2px 0 0', animation: 'pulse-text 1.5s ease-in-out infinite' }}>
                ⚠ {urgentCount} URGENT {urgentCount === 1 ? 'call' : 'calls'} waiting
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setSoundOn(!soundOn)} style={iconBtnStyle} title={soundOn ? 'Mute alerts' : 'Unmute alerts'}>
              {soundOn ? <Volume2 size={16} color="#31A24C" /> : <VolumeX size={16} color="#6B7280" />}
            </button>
            <button onClick={fetchCalls} style={iconBtnStyle}>
              <RefreshCw size={16} color="#B0B3B8" />
            </button>
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────── */}
        <div style={{ display: 'flex', background: '#18191A', borderBottom: '1px solid #2A2B2D' }}>
          {[
            { key: 'active', label: `Live Queue (${calls.length})`, color: '#EF4444' },
            { key: 'history', label: `History (${resolved.length})`, color: '#31A24C' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                flex: 1, padding: '12px 0', fontSize: 13, fontWeight: 600, textAlign: 'center',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: tab === t.key ? t.color : '#6B7280',
                borderBottom: tab === t.key ? `2px solid ${t.color}` : '2px solid transparent',
                marginBottom: -1 }}>{t.label}</button>
          ))}
        </div>

        {/* ── Filters (active tab only) ─────────────── */}
        {tab === 'active' && (
          <div style={{ padding: '10px 16px 6px', display: 'flex', gap: 6, overflowX: 'auto', flexWrap: 'nowrap' }}>
            {[
              { key: 'all', label: 'All' },
              ...Object.entries(REASON_CONFIG || {}).map(([k, v]) => ({ key: k, label: v.label }))
            ].map(f => (
              <button key={f.key} onClick={() => setReasonFilter(f.key)}
                style={{
                  padding: '6px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  background: reasonFilter === f.key ? '#1877F2' : '#242526',
                  color: reasonFilter === f.key ? '#fff' : '#B0B3B8',
                  border: `1px solid ${reasonFilter === f.key ? '#1877F2' : '#3A3B3C'}`,
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>{f.label}</button>
            ))}
          </div>
        )}

        {/* ── Content ───────────────────────────────── */}
        {loading ? (
          <div style={{ padding: '80px 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Loader2 size={32} color="#1877F2" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : (
          <div style={{ padding: '8px 16px 100px' }}>

            {/* ━━━ ACTIVE TAB ━━━ */}
            {tab === 'active' && (
              filtered.length === 0 ? (
                <div style={{ padding: '60px 0', textAlign: 'center' }}>
                  <div style={{ width: 64, height: 64, borderRadius: 32, background: 'rgba(49,162,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                    <Check size={28} color="#31A24C" />
                  </div>
                  <p style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>All Clear</p>
                  <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>No pending floor calls</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {filtered.map(call => {
                    const pCfg = PRIORITY_CONFIG[call.priority] || PRIORITY_CONFIG.normal;
                    const sCfg = STATUS_CONFIG[call.status] || STATUS_CONFIG.pending;
                    const rCfg = REASON_CONFIG[call.reason] || REASON_CONFIG.other;
                    const StatusIcon = sCfg.icon;
                    const ReasonIcon = rCfg.icon;
                    const isUrgent = call.priority === 'urgent' && call.status === 'pending';

                    return (
                      <div key={call.id} style={{
                        background: '#1A1B1D', borderRadius: 14, overflow: 'hidden',
                        border: `1px solid ${isUrgent ? 'rgba(239,68,68,0.5)' : '#2A2B2D'}`,
                        animation: isUrgent ? 'urgent-pulse 2s ease-in-out infinite' : 'none' }}>
                        {/* Card body */}
                        <div style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>Table {call.table_number}</span>
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                                background: pCfg.bg, color: pCfg.color, border: `1px solid ${pCfg.border}` }}>{pCfg.label}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Clock size={12} color="#6B7280" />
                              <span style={{ fontSize: 12, color: '#8A8D91', fontWeight: 600 }}>{timeAgo(call.created_at)}</span>
                            </div>
                          </div>

                          {/* Reason + description */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <div style={{
                              width: 28, height: 28, borderRadius: 8,
                              background: `${rCfg.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <ReasonIcon size={14} color={rCfg.color} />
                            </div>
                            <span style={{ fontSize: 14, fontWeight: 600, color: '#E4E6EB', textTransform: 'capitalize' }}>
                              {rCfg.label}
                            </span>
                          </div>
                          {call.description && (
                            <p style={{ fontSize: 12, color: '#8A8D91', margin: '0 0 6px', lineHeight: 1.4 }}>{call.description}</p>
                          )}

                          {/* Status + caller */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <StatusIcon size={12} color={sCfg.color} />
                              <span style={{ fontSize: 11, color: sCfg.color, fontWeight: 600 }}>{sCfg.label}</span>
                            </div>
                            {call.called_by && (
                              <span style={{ fontSize: 10, color: '#6B7280' }}>by {call.called_by}</span>
                            )}
                            {call.responded_by && (
                              <span style={{ fontSize: 10, color: '#1877F2' }}>→ {call.responded_by}</span>
                            )}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: 'flex', borderTop: '1px solid #2A2B2D' }}>
                          {call.status === 'pending' && (
                            <>
                              <button onClick={() => updateCall(call.id, 'acknowledged')}
                                style={{ ...actionBtnStyle, color: '#F59E0B', borderRight: '1px solid #2A2B2D' }}>
                                <Check size={14} /> Acknowledge
                              </button>
                              <button onClick={() => updateCall(call.id, 'en_route')}
                                style={{ ...actionBtnStyle, color: '#1877F2' }}>
                                <ArrowRight size={14} /> On My Way
                              </button>
                            </>
                          )}
                          {call.status === 'acknowledged' && (
                            <>
                              <button onClick={() => updateCall(call.id, 'en_route')}
                                style={{ ...actionBtnStyle, color: '#1877F2', borderRight: '1px solid #2A2B2D' }}>
                                <ArrowRight size={14} /> On My Way
                              </button>
                              <button onClick={() => { setResolveModal(call); setResolveNote(''); }}
                                style={{ ...actionBtnStyle, color: '#31A24C' }}>
                                <CheckCircle2 size={14} /> Resolve
                              </button>
                            </>
                          )}
                          {call.status === 'en_route' && (
                            <button onClick={() => { setResolveModal(call); setResolveNote(''); }}
                              style={{ ...actionBtnStyle, color: '#31A24C' }}>
                              <CheckCircle2 size={14} /> Mark Resolved
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {/* ━━━ HISTORY TAB ━━━ */}
            {tab === 'history' && (
              <>
                {/* Stats bar */}
                {resolved.length > 0 && (
                  <div style={{ display: 'flex', gap: 12, marginBottom: 12, overflowX: 'auto' }}>
                    <StatCard label="Total Resolved" value={resolved.length} color="#31A24C" />
                    <StatCard label="Avg Response" value={formatDuration(avgResponse)} color="#1877F2" />
                  </div>
                )}

                {resolved.length === 0 ? (
                  <p style={{ padding: '40px 0', textAlign: 'center', color: '#6B7280', fontSize: 14 }}>No resolved calls today</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {resolved.map(call => {
                      const rCfg = REASON_CONFIG[call.reason] || REASON_CONFIG.other;
                      const ReasonIcon = rCfg.icon;
                      return (
                        <div key={call.id} style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                          background: '#1A1B1D', border: '1px solid #2A2B2D', borderRadius: 12, opacity: 0.85 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 8,
                            background: 'rgba(49,162,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0 }}>
                            <CheckCircle2 size={16} color="#31A24C" />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: '#E4E6EB' }}>Table {call.table_number}</span>
                              <ReasonIcon size={12} color={rCfg.color} />
                              <span style={{ fontSize: 11, color: rCfg.color }}>{rCfg.label}</span>
                            </div>
                            {call.resolution && (
                              <p style={{ fontSize: 11, color: '#6B7280', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{call.resolution}</p>
                            )}
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            {call.response_time_seconds > 0 && (
                              <span style={{ fontSize: 11, fontWeight: 600, color: '#1877F2', display: 'flex', alignItems: 'center', gap: 3 }}>
                                <Timer size={10} /> {formatDuration(call.response_time_seconds)}
                              </span>
                            )}
                            <span style={{ fontSize: 10, color: '#6B7280' }}>{timeAgo(call.resolved_at || call.created_at)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── FAB: New Call ────────────────────────── */}
        {tab === 'active' && (
          <button onClick={() => setShowNewCall(true)}
            style={{
              position: 'fixed', bottom: 24, right: 20, width: 56, height: 56, borderRadius: 28,
              background: 'linear-gradient(135deg, #1877F2, #1565D8)', color: '#fff',
              border: 'none', cursor: 'pointer', boxShadow: '0 4px 20px rgba(24,119,242,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30 }}>
            <Plus size={24} />
          </button>
        )}

        {/* ── New Call Modal ──────────────────────── */}
        {showNewCall && (
          <div style={overlayStyle} onClick={() => setShowNewCall(false)}>
            <div style={modalStyle} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: 0 }}>New Floor Call</h3>
                <button onClick={() => setShowNewCall(false)} style={iconBtnStyle}><X size={18} color="#B0B3B8" /></button>
              </div>

              {/* Table number */}
              <label style={labelStyle}>Table Number</label>
              <input type="number" value={newTable} onChange={e => setNewTable(e.target.value)}
                placeholder="e.g. 5" style={inputStyle} autoFocus />

              {/* Reason */}
              <label style={{ ...labelStyle, marginTop: 14 }}>Reason</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
                {Object.entries(REASON_CONFIG || {}).map(([key, cfg]) => {
                  const Icon = cfg.icon;
                  return (
                    <button key={key} onClick={() => setNewReason(key)}
                      style={{
                        padding: '10px 6px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: newReason === key ? `${cfg.color}20` : '#242526',
                        color: newReason === key ? cfg.color : '#8A8D91',
                        border: `1px solid ${newReason === key ? `${cfg.color}50` : '#3A3B3C'}`,
                        cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <Icon size={16} />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>

              {/* Priority */}
              <label style={{ ...labelStyle, marginTop: 8 }}>Priority</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {Object.entries(PRIORITY_CONFIG || {}).map(([key, cfg]) => (
                  <button key={key} onClick={() => setNewPriority(key)}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      background: newPriority === key ? cfg.bg : '#242526',
                      color: newPriority === key ? cfg.color : '#6B7280',
                      border: `1px solid ${newPriority === key ? cfg.border : '#3A3B3C'}`,
                      cursor: 'pointer' }}>{cfg.label}</button>
                ))}
              </div>

              {/* Description */}
              <label style={{ ...labelStyle, marginTop: 8 }}>Notes (optional)</label>
              <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)}
                placeholder="Additional details..." rows={2}
                style={{ ...inputStyle, resize: 'none', fontFamily: 'Inter, sans-serif' }} />

              {/* Submit */}
              <button onClick={createCall} disabled={!newTable || submitting}
                style={{
                  width: '100%', padding: '14px 0', borderRadius: 12, fontSize: 15, fontWeight: 700,
                  background: newTable ? 'linear-gradient(135deg, #1877F2, #1565D8)' : '#3A3B3C',
                  color: newTable ? '#fff' : '#6B7280',
                  border: 'none', cursor: newTable ? 'pointer' : 'default', marginTop: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {submitting ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Bell size={18} />}
                {submitting ? 'Creating...' : 'Create Floor Call'}
              </button>
            </div>
          </div>
        )}

        {/* ── Resolve Modal ──────────────────────── */}
        {resolveModal && (
          <div style={overlayStyle} onClick={() => setResolveModal(null)}>
            <div style={modalStyle} onClick={e => e.stopPropagation()}>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: '0 0 4px' }}>Resolve Call</h3>
              <p style={{ fontSize: 13, color: '#8A8D91', margin: '0 0 16px' }}>
                Table {resolveModal.table_number} — {(REASON_CONFIG[resolveModal.reason] || REASON_CONFIG.other).label}
              </p>

              <label style={labelStyle}>Resolution Notes</label>
              <textarea value={resolveNote} onChange={e => setResolveNote(e.target.value)}
                placeholder="How was it resolved?" rows={3} autoFocus
                style={{ ...inputStyle, resize: 'none', fontFamily: 'Inter, sans-serif' }} />

              {/* Quick resolution buttons */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 16px' }}>
                {['Ruling made', 'Chips delivered', 'Player warned', 'Issue resolved', 'Dealer relieved'].map(q => (
                  <button key={q} onClick={() => setResolveNote(q)}
                    style={{
                      padding: '6px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: resolveNote === q ? '#31A24C' : '#242526',
                      color: resolveNote === q ? '#fff' : '#B0B3B8',
                      border: `1px solid ${resolveNote === q ? '#31A24C' : '#3A3B3C'}`,
                      cursor: 'pointer' }}>{q}</button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setResolveModal(null)}
                  style={{ flex: 1, padding: '12px 0', borderRadius: 10, background: '#242526', color: '#B0B3B8', fontSize: 14, fontWeight: 600, border: '1px solid #3A3B3C', cursor: 'pointer' }}>Cancel</button>
                <button onClick={handleResolve} disabled={submitting}
                  style={{ flex: 1, padding: '12px 0', borderRadius: 10, background: '#31A24C', color: '#fff', fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  {submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={16} />}
                  Resolve
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes urgent-pulse {
          0%, 100% { border-color: rgba(239,68,68,0.5); box-shadow: 0 0 0 0 rgba(239,68,68,0); }
          50% { border-color: rgba(239,68,68,0.8); box-shadow: 0 0 20px 0 rgba(239,68,68,0.15); }
        }
        @keyframes pulse-text { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    
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

/* ─── Sub-components ─────────────────────────────────────────── */

function StatCard({ label, value, color }) {
  return (
    <div style={{
      background: '#1A1B1D', border: '1px solid #2A2B2D', borderRadius: 12,
      padding: '10px 16px', minWidth: 120, flexShrink: 0 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    </div>
  );
}

/* ─── Shared styles ──────────────────────────────────────────── */

const iconBtnStyle = {
  width: 36, height: 36, borderRadius: 10,
  background: '#242526', border: '1px solid #3A3B3C',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', flexShrink: 0 };

const actionBtnStyle = {
  flex: 1, padding: '12px 0', fontSize: 12, fontWeight: 600,
  background: 'transparent', border: 'none', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 };

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 50,
  background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center' };

const modalStyle = {
  background: '#1A1B1D', borderRadius: '20px 20px 0 0',
  width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto',
  padding: '20px 20px 28px', border: '1px solid #2A2B2D' };

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#8A8D91',
  textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 };

const inputStyle = {
  width: '100%', padding: '12px 14px', borderRadius: 10, fontSize: 14,
  background: '#242526', color: '#E4E6EB', border: '1px solid #3A3B3C',
  outline: 'none', boxSizing: 'border-box' };
