/**
 * Shift Handoff
 * /commander/shift-handoff
 * Outgoing floor passes context to incoming shift
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import {
  ArrowRightLeft, CheckCircle2, Clock, Users, AlertTriangle,
  Loader2, Send, FileText, Star, ListChecks, MessageSquare, LayoutGrid,
  ChevronDown, ChevronUp, ArrowLeft
} from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';

export default function ShiftHandoff() {
  const router = useRouter();
  useEffect(() => { busEmit.sessionStart('commander-shift-handoff'); }, []);
  const [staff, setStaff] = useState(null);
  const [mode, setMode] = useState('menu'); // menu | create | history
  const [handoffs, setHandoffs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const [expandedId, setExpandedId] = useState(null);

  // Form state
  const [notes, setNotes] = useState('');
  const [issues, setIssues] = useState('');
  const [vipAlerts, setVipAlerts] = useState('');
  const [pendingActions, setPendingActions] = useState('');
  const [incomingName, setIncomingName] = useState('');

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

  // fetchHandoffs declared FIRST — must precede useEffect/useCommanderSync that reference it
  const fetchHandoffs = async (signal) => {
    setLoading(true);
    try {
const res = await commanderFetch(`/api/commander/shift-handoff?venue_id=${staff.venue_id}&limit=30`, { ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) setHandoffs(json.data.handoffs);
    } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const _c = new AbortController();

    if (staff?.venue_id) fetchHandoffs(_c.signal);
    return () => _c.abort();
  }, [staff]);

  // Commander Data Bus — sync handoffs across tabs
  useCommanderSync(staff?.venue_id || '', fetchHandoffs, { entities: ['staff'] });

  const handleSubmit = async () => {
    if (!notes.trim() && !issues.trim()) {
      setToast({ type: 'error', msg: 'Add notes or issues before submitting' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setSubmitting(true);
    try {
const res = await commanderFetch('/api/commander/shift-handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: staff.venue_id,
          staff_name: staff.name || staff.display_name || 'Floor Staff',
          notes: notes.trim() || null,
          issues: issues.trim() || null,
          vip_alerts: vipAlerts.trim() || null,
          pending_actions: pendingActions.trim() || null,
          incoming_staff_name: incomingName.trim() || null
        })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setToast({ type: 'success', msg: 'Shift handoff submitted' });
        setNotes(''); setIssues(''); setVipAlerts(''); setPendingActions(''); setIncomingName('');
        setMode('history');
        fetchHandoffs();
        broadcastChange('staff');
        busEmit.sessionEnd('commander-shift-handoff');
      } else {
        setToast({ type: 'error', msg: json.error?.message || 'Failed to submit' });
      }
    } catch (err) {
      setToast({ type: 'error', msg: 'Network error' });
    }
    finally { setSubmitting(false); setTimeout(() => setToast(null), 3000); }
  };

  const handleAcknowledge = async (handoffId) => {
    try {
const res = await commanderFetch('/api/commander/shift-handoff', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handoff_id: handoffId,
          staff_name: staff.name || staff.display_name || 'Floor Staff'
        })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setToast({ type: 'success', msg: 'Handoff acknowledged' });
        fetchHandoffs();
        broadcastChange('staff');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', msg: 'Action failed. Please check your connection and try again.' }); }
    finally { setTimeout(() => setToast(null), 3000); }
  };

  const pendingHandoffs = handoffs.filter(h => h.status === 'pending');

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };

  return (
    <CommanderLayout title="Shift Handoff" backHref="/commander/dashboard?card=staff">
      <SEOHead
        title="Commander — Shift Handoff"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        {/* Header */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1877F2]/15 flex items-center justify-center">
            <ArrowRightLeft size={20} className="text-[#1877F2]" />
          </div>
          <div className="flex-1">
            <div className="text-white font-bold text-base">Shift Handoff</div>
            <div className="text-[#B0B3B8] text-xs">Pass Floor Context To Incoming Shift</div>
          </div>
          {pendingHandoffs.length > 0 && (
            <div className="bg-[#EF4444] text-white rounded-full px-3 py-0.5 text-xs font-bold animate-pulse">
              {pendingHandoffs.length} Pending
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className={`mx-4 mt-3 px-4 py-2.5 rounded-lg text-sm font-semibold ${toast.type === 'success' ? 'bg-[#31A24C]/15 text-[#31A24C] border border-[#31A24C]/30' : 'bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30'}`}>
            {toast.msg}
          </div>
        )}

        <div className="p-4 max-w-xl mx-auto">
          {/* Back to Menu button in create/history modes */}
          {mode !== 'menu' && (
            <button onClick={() => setMode('menu')}
              className="flex items-center gap-2 text-[#B0B3B8] hover:text-white text-sm font-medium mb-4 transition-colors">
              <ArrowLeft size={16} /> Back to Menu
            </button>
          )}

          {/* Menu Mode */}
          {mode === 'menu' && (
            <div className="flex flex-col gap-3">
              {/* Pending alert */}
              {pendingHandoffs.length > 0 && (
                <div className="bg-[#F59E0B]/10 border-2 border-[#F59E0B]/40 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={18} className="text-[#F59E0B]" />
                    <span className="text-[#F59E0B] font-bold text-sm">Incoming Handoff Waiting</span>
                  </div>
                  {pendingHandoffs.map(h => (
                    <div key={h.id} className="bg-[#242526] rounded-lg p-3 mt-2 border border-[#3A3B3C]">
                      <div className="text-white font-semibold text-sm">From: {h.outgoing_staff_name}</div>
                      <div className="text-[#B0B3B8] text-xs">{formatTime(h.handoff_time || h.created_at)}</div>
                      <div className="text-[#B0B3B8] text-xs mt-1">
                        {h.open_tables_count} tables, {h.active_players_count} players, {h.waitlist_count} waiting
                      </div>
                      <button onClick={() => { setExpandedId(h.id); setMode('history'); }}
                        className="mt-3 w-full bg-[#1877F2] text-white rounded-lg py-2 text-sm font-bold">
                        Review & Acknowledge
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setMode('create')}
                className="bg-[#242526] border-2 border-[#1877F2]/40 rounded-xl p-5 flex items-center gap-4 text-left hover:border-[#1877F2] transition-colors">
                <div className="w-12 h-12 rounded-xl bg-[#1877F2]/15 flex items-center justify-center flex-shrink-0">
                  <Send size={22} className="text-[#1877F2]" />
                </div>
                <div>
                  <div className="text-white font-bold text-base">Create Handoff</div>
                  <div className="text-[#B0B3B8] text-sm">Document Floor State And Pass To Next Shift</div>
                </div>
              </button>

              <button onClick={() => setMode('history')}
                className="bg-[#242526] border-2 border-[#3A3B3C] rounded-xl p-5 flex items-center gap-4 text-left hover:border-[#4A4B4C] transition-colors">
                <div className="w-12 h-12 rounded-xl bg-[#3A3B3C] flex items-center justify-center flex-shrink-0">
                  <FileText size={22} className="text-[#B0B3B8]" />
                </div>
                <div>
                  <div className="text-white font-bold text-base">Handoff History</div>
                  <div className="text-[#B0B3B8] text-sm">View Past Shift Handoffs And Notes</div>
                </div>
              </button>
            </div>
          )}

          {/* Create Mode */}
          {mode === 'create' && (
            <div className="flex flex-col gap-3">
              <div className="bg-[#242526] rounded-xl p-4 border border-[#3A3B3C]">
                <div className="text-white font-bold text-sm">Outgoing Floor: {staff?.name || staff?.display_name || 'Staff'}</div>
                <div className="text-[#B0B3B8] text-xs mt-1">{new Date().toLocaleString()}</div>
              </div>

              {/* Incoming staff (optional) */}
              <div className="bg-[#242526] rounded-xl p-4 border border-[#3A3B3C]">
                <label className="text-[#B0B3B8] font-semibold text-xs flex items-center gap-1.5 mb-2">
                  <Users size={14} /> Incoming Staff Name (optional)
                </label>
                <input value={incomingName} onChange={e => setIncomingName(e.target.value)}
                  placeholder="Who's Taking Over?"
                  className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-white text-sm focus:outline-none focus:border-[#1877F2] placeholder-[#65676B]" />
              </div>

              {/* General notes */}
              <div className="bg-[#242526] rounded-xl p-4 border border-[#3A3B3C]">
                <label className="text-[#B0B3B8] font-semibold text-xs flex items-center gap-1.5 mb-2">
                  <MessageSquare size={14} /> Floor Notes *
                </label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
                  placeholder="General Floor State — How The Room Is Running, Player Mood, Game Quality, Upcoming Events..."
                  className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-white text-sm resize-y focus:outline-none focus:border-[#1877F2] placeholder-[#65676B]" style={{ fontFamily: 'inherit' }} />
              </div>

              {/* Active issues */}
              <div className="bg-[#242526] rounded-xl p-4 border border-[#3A3B3C]">
                <label className="text-[#EF4444] font-semibold text-xs flex items-center gap-1.5 mb-2">
                  <AlertTriangle size={14} /> Active Issues
                </label>
                <textarea value={issues} onChange={e => setIssues(e.target.value)} rows={3}
                  placeholder="Player Disputes, Equipment Problems, Short-staffed, Anything Needing Attention..."
                  className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-white text-sm resize-y focus:outline-none focus:border-[#EF4444]/50 placeholder-[#65676B]" style={{ fontFamily: 'inherit' }} />
              </div>

              {/* VIP alerts */}
              <div className="bg-[#242526] rounded-xl p-4 border border-[#3A3B3C]">
                <label className="text-[#F59E0B] font-semibold text-xs flex items-center gap-1.5 mb-2">
                  <Star size={14} /> VIP / Player Alerts
                </label>
                <textarea value={vipAlerts} onChange={e => setVipAlerts(e.target.value)} rows={2}
                  placeholder="VIPs In The Room, Player To Watch, High Rollers Expected..."
                  className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-white text-sm resize-y focus:outline-none focus:border-[#F59E0B]/50 placeholder-[#65676B]" style={{ fontFamily: 'inherit' }} />
              </div>

              {/* Pending actions */}
              <div className="bg-[#242526] rounded-xl p-4 border border-[#3A3B3C]">
                <label className="text-[#1877F2] font-semibold text-xs flex items-center gap-1.5 mb-2">
                  <ListChecks size={14} /> Pending Actions
                </label>
                <textarea value={pendingActions} onChange={e => setPendingActions(e.target.value)} rows={2}
                  placeholder="Table Changes Planned, Games To Open/close, Promotions To Run..."
                  className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-white text-sm resize-y focus:outline-none focus:border-[#1877F2]/50 placeholder-[#65676B]" style={{ fontFamily: 'inherit' }} />
              </div>

              <button onClick={handleSubmit} disabled={submitting}
                className="w-full bg-[#1877F2] text-white rounded-xl py-3.5 text-base font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                Submit Handoff
              </button>

              <div className="text-[#65676B] text-xs text-center">
                Floor snapshot (tables, players, waitlist) is captured automatically
              </div>
            </div>
          )}

          {/* History Mode */}
          {mode === 'history' && (
            <div className="flex flex-col gap-3">
              {loading ? (
                <div className="text-center py-12"><Loader2 size={28} className="text-[#1877F2] animate-spin mx-auto" /></div>
              ) : handoffs.length === 0 ? (
                <div className="text-center py-12">
                  <FileText size={32} className="text-[#3A3B3C] mx-auto mb-2" />
                  <p className="text-[#65676B]">No Handoffs Recorded Yet</p>
                </div>
              ) : handoffs.map(h => {
                const isExpanded = expandedId === h.id;
                const tables = h.table_snapshot || [];
                return (
                  <div key={h.id} className={`bg-[#242526] rounded-xl border-2 overflow-hidden ${h.status === 'pending' ? 'border-[#F59E0B]/40' : 'border-[#3A3B3C]'}`}>
                    {/* Header */}
                    <button onClick={() => setExpandedId(isExpanded ? null : h.id)}
                      className="w-full px-4 py-3 flex items-center gap-3 text-left bg-transparent border-none cursor-pointer">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${h.status === 'acknowledged' ? 'bg-[#31A24C]/15' : 'bg-[#F59E0B]/15'}`}>
                        {h.status === 'acknowledged' ? <CheckCircle2 size={18} className="text-[#31A24C]" /> : <Clock size={18} className="text-[#F59E0B]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-bold text-sm truncate">
                          {h.outgoing_staff_name} {h.incoming_staff_name ? ` → ${h.incoming_staff_name}` : ''}
                        </div>
                        <div className="text-[#B0B3B8] text-xs">{formatTime(h.handoff_time || h.created_at)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${h.status === 'acknowledged' ? 'bg-[#31A24C]/15 text-[#31A24C]' : 'bg-[#F59E0B]/15 text-[#F59E0B]'}`}>
                          {h.status === 'acknowledged' ? 'ACK' : 'PENDING'}
                        </span>
                        {isExpanded ? <ChevronUp size={16} className="text-[#65676B]" /> : <ChevronDown size={16} className="text-[#65676B]" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-[#3A3B3C]">
                        {/* Floor snapshot */}
                        <div className="grid grid-cols-4 gap-2 mt-3">
                          {[
                            { label: 'Tables', val: h.open_tables_count, icon: LayoutGrid, color: '#1877F2' },
                            { label: 'Players', val: h.active_players_count, icon: Users, color: '#31A24C' },
                            { label: 'Waiting', val: h.waitlist_count, icon: Clock, color: '#F59E0B' },
                            { label: 'Incidents', val: h.open_incidents_count, icon: AlertTriangle, color: '#EF4444' },
                          ].map(s => (
                            <div key={s.label} className="text-center py-2 px-1 bg-[#18191A] rounded-lg">
                              <s.icon size={14} color={s.color} style={{ margin: '0 auto 2px' }} />
                              <div className="text-white text-lg font-extrabold">{s.val}</div>
                              <div className="text-[#65676B] text-[10px]">{s.label}</div>
                            </div>
                          ))}
                        </div>

                        {/* Table detail */}
                        {tables.length > 0 && (
                          <div className="mt-3">
                            <div className="text-[#65676B] text-[10px] font-bold mb-2 tracking-wider">TABLE SNAPSHOT</div>
                            <div className="flex flex-col gap-1">
                              {tables.map((t, i) => (
                                <div key={i} className="flex items-center gap-2 px-3 py-2 bg-[#18191A] rounded-lg text-xs">
                                  <span className="text-[#1877F2] font-bold min-w-[24px]">T{t.table_number}</span>
                                  <span className="flex-1 text-[#B0B3B8]">{t.game}</span>
                                  <span className={`font-bold ${t.players >= t.max_seats ? 'text-[#EF4444]' : 'text-[#31A24C]'}`}>
                                    {t.players}/{t.max_seats}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Notes sections */}
                        {h.notes && (
                          <div className="mt-3">
                            <div className="text-[#65676B] text-[10px] font-bold mb-1 tracking-wider">FLOOR NOTES</div>
                            <div className="text-[#E4E6EB] text-sm whitespace-pre-wrap leading-relaxed">{h.notes}</div>
                          </div>
                        )}
                        {h.issues && (
                          <div className="mt-3">
                            <div className="text-[#EF4444] text-[10px] font-bold mb-1 tracking-wider">ACTIVE ISSUES</div>
                            <div className="text-[#E4E6EB] text-sm whitespace-pre-wrap leading-relaxed bg-[#EF4444]/10 p-3 rounded-lg border border-[#EF4444]/20">{h.issues}</div>
                          </div>
                        )}
                        {h.vip_alerts && (
                          <div className="mt-3">
                            <div className="text-[#F59E0B] text-[10px] font-bold mb-1 tracking-wider">VIP / PLAYER ALERTS</div>
                            <div className="text-[#E4E6EB] text-sm whitespace-pre-wrap leading-relaxed">{h.vip_alerts}</div>
                          </div>
                        )}
                        {h.pending_actions && (
                          <div className="mt-3">
                            <div className="text-[#1877F2] text-[10px] font-bold mb-1 tracking-wider">PENDING ACTIONS</div>
                            <div className="text-[#E4E6EB] text-sm whitespace-pre-wrap leading-relaxed">{h.pending_actions}</div>
                          </div>
                        )}

                        {/* Acknowledge button */}
                        {h.status === 'pending' && (
                          <button onClick={() => handleAcknowledge(h.id)}
                            className="mt-4 w-full bg-[#31A24C] text-white rounded-lg py-3 text-sm font-bold flex items-center justify-center gap-2 active:bg-[#2a8f42]">
                            <CheckCircle2 size={18} /> Acknowledge Handoff
                          </button>
                        )}

                        {h.acknowledged_at && (
                          <div className="mt-3 text-xs text-[#31A24C] font-semibold text-center">
                            Acknowledged by {h.incoming_staff_name} at {formatTime(h.acknowledged_at)}
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
    </CommanderLayout>
  );
}
