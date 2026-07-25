/**
 * End of Day Close
 * /commander/close-day
 * 
 * Shift closing procedures for floor managers:
 * 1. Review open tables — confirm all are closed
 * 2. Review active sessions — ensure all players checked out
 * 3. Cash drop / reconciliation summary
 * 4. Staff sign-off with PIN
 * 5. Generate end-of-day report
 */
import { useState, useEffect, useCallback } from 'react';
import { busEmit } from '../../src/engine/EventBus';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Lock, FileText, ChevronRight } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { getStaffSession, getVenueId } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';

export default function CloseDay() {
  const router = useRouter();

  useEffect(() => { busEmit.sessionStart('commander-close-day'); }, []);
  const [step, setStep] = useState(1); // 1: review, 2: reconcile, 3: sign-off, 4: done
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [waitlistCount, setWaitlistCount] = useState(0);
  const [dayStats, setDayStats] = useState({});
  const [pin, setPin] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [notes, setNotes] = useState('');
  const [closing, setClosing] = useState(false);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchStatus(ctrl.signal);
    return () => ctrl.abort();
  }, []);

  // fetchStatus declared first — must precede useEffect/useCommanderSync that reference it
  const fetchStatus = useCallback(async (signal) => {
    setLoading(true);
    try {
const venueId = getVenueId();
const headers = { };
      const fetchOpts = signal ? { headers, signal } : { headers };
      // 2026-07-25 audit fix: also fetch today's revenue report so the Day Summary
      // shows real time/tournament/comp figures instead of always-zero placeholders.
      const [tablesRes, waitlistRes, sessionsRes, reportRes, revenueRes] = await Promise.all([
        commanderFetch(`/api/commander/tables?venue_id=${venueId}`, fetchOpts).then(r => r.json()).catch(() => ({ data: [] })),
        commanderFetch(`/api/commander/waitlist?venue_id=${venueId}`, fetchOpts).then(r => r.json()).catch(() => ({ data: [] })),
        commanderFetch(`/api/commander/time-billing/sessions?status=active&venue_id=${venueId}`, fetchOpts).then(r => r.json()).catch(() => ({ data: [] })),
        commanderFetch(`/api/commander/reports/daily?venue_id=${venueId}`, fetchOpts).then(r => r.json()).catch(() => ({ data: {} })),
        commanderFetch(`/api/commander/reports/revenue?venue_id=${venueId}&range=today`, fetchOpts).then(r => r.json()).catch(() => null)
      ]);

      // Tables: data may be {tables: []} or array directly
      const tablesArr = Array.isArray(tablesRes.data) ? tablesRes.data
        : Array.isArray(tablesRes.data?.tables) ? tablesRes.data.tables : [];
      setTables(tablesArr);
      // Waitlist
      const waitlistArr = Array.isArray(waitlistRes.data) ? waitlistRes.data : [];
      setWaitlistCount(waitlistArr.filter(w => w.status === 'waiting').length);
      // Sessions
      const sessionsArr = Array.isArray(sessionsRes.data) ? sessionsRes.data : [];
      setActiveSessions(sessionsArr.filter(s => s.status === 'active'));
      // 2026-07-25 audit fix: the daily report returns {data:{report:{summary:{...}}}},
      // not a flat object — map its real fields into dayStats. Revenue/comp figures
      // come from the revenue report (range=today); they stay null when unavailable
      // so the UI can drop those tiles instead of presenting fake zeros.
      const summary = reportRes?.data?.report?.summary || {};
      const revTotals = revenueRes?.data?.totals || null;
      setDayStats({
        total_sessions: summary.total_sessions ?? 0,
        unique_players: summary.total_players ?? 0,
        total_hours: summary.total_hours ?? 0,
        peak_tables: summary.peak_tables ?? 0,
        tournaments_run: summary.tournaments_run ?? 0,
        time_revenue: revTotals ? (revTotals.time_revenue ?? 0) : null,
        tournament_revenue: revTotals ? (revTotals.tournament_fees ?? 0) : null,
        comps_awarded: revTotals ? (revTotals.comps_issued ?? 0) : null,
      });
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, []);

  // Commander Data Bus — both BroadcastChannel (instant) + Supabase Realtime (cross-device)
  useCommanderSync(getVenueId(), fetchStatus, { entities: ['tables', 'games'] });

  const openTables = tables.filter(t => t.status === 'active' || t.status === 'open');
  const allClear = openTables.length === 0 && activeSessions.length === 0 && waitlistCount === 0;

  const forceCloseAll = async () => {
    setClosing(true);
    try {
const headers = { 'Content-Type': 'application/json' };

      // Close all open tables
      let successCount = 0;
      for (const table of openTables) {
        const res = await commanderFetch(`/api/commander/tables/${table.id}`, {
          method: 'PUT', headers,
          body: JSON.stringify({ status: 'closed' })
        });
        if (res.ok) successCount++;
      }

      // End all active sessions
      for (const session of activeSessions) {
        const res = await commanderFetch(`/api/commander/dealer/sessions/${session.id}/end`, {
          method: 'POST', headers,
          body: JSON.stringify({ reason: 'end_of_day' })
        });
        if (res.ok) successCount++;
      }

      // Broadcast to all other tabs only if actual changes happened
      if (successCount > 0) {
        broadcastChange('tables');
        broadcastChange('games');
      }
      await fetchStatus();
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
    finally { setClosing(false); }
  };

  const submitClose = async () => {
    setVerifying(true);
    try {
const venueId = getVenueId();
      const res = await commanderFetch('/api/commander/staff/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin_code: pin, venue_id: venueId })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success && json.data?.valid && json.data?.staff) {
        // Generate daily report
        setStep(4);
        busEmit.sessionEnd('commander-close-day');
        busEmit.celebration('confetti');
      } else {
        setPin('');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
    finally { setVerifying(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#18191A] flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
    </div>
  );

  return (
    <CommanderLayout title="Close Day" backHref="/commander/dashboard">
      <SEOHead
        title="Commander — Close Day"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">

        {/* Progress dots */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center justify-between">
          <p className="text-xs text-[#B0B3B8]">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4].map(s => (
              <div key={s} className={`w-2.5 h-2.5 rounded-full ${s <= step ? 'bg-[#1877F2]' : 'bg-[#3A3B3C]'}`} />
            ))}
          </div>
        </div>

        <div className="p-4 max-w-lg mx-auto space-y-4">

          {/* STEP 1: Review Status */}
          {step === 1 && (
            <>
              <h2 className="text-xl font-bold text-white">Room Status Check</h2>

              {/* Checklist */}
              <div className="space-y-2">
                <CheckItem
                  label="All Tables Closed"
                  detail={openTables.length === 0 ? 'All tables are closed' : `${openTables.length} table(s) still open`}
                  ok={openTables.length === 0}
                />
                <CheckItem
                  label="All Players Checked Out"
                  detail={activeSessions.length === 0 ? 'No active sessions' : `${activeSessions.length} session(s) still active`}
                  ok={activeSessions.length === 0}
                />
                <CheckItem
                  label="Waitlist Cleared"
                  detail={waitlistCount === 0 ? 'Waitlist is empty' : `${waitlistCount} player(s) still waiting`}
                  ok={waitlistCount === 0}
                />
              </div>

              {!allClear && (
                <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-5 h-5 text-[#F59E0B]" />
                    <p className="text-sm font-semibold text-[#F59E0B]">Items Need Attention</p>
                  </div>
                  <p className="text-xs text-[#B0B3B8] mb-3">Close All Open Tables And End Active Sessions Before Closing The Day.</p>
                  <button onClick={forceCloseAll} disabled={closing}
                    className="w-full py-3 rounded-xl bg-[#F59E0B] text-white text-sm font-semibold flex items-center justify-center gap-2 active:bg-[#D97706] disabled:opacity-50">
                    {closing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                    Force Close All
                  </button>
                </div>
              )}

              <button onClick={() => setStep(2)}
                disabled={!allClear}
                className="w-full py-4 rounded-xl bg-[#1877F2] text-white text-lg font-semibold flex items-center justify-center gap-2 active:bg-[#1565D8] disabled:opacity-30">
                Next: Day Summary <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          {/* STEP 2: Day Summary */}
          {step === 2 && (
            <>
              <h2 className="text-xl font-bold text-white">Day Summary</h2>

              {/* 2026-07-25 audit fix: tiles now read the daily report's real summary
                  fields; revenue/comp tiles render only when backed by real data
                  (dropped the Incidents tile — no endpoint feeds it). */}
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Sessions Today" value={dayStats.total_sessions || 0} color="#1877F2" />
                <StatCard label="Unique Players" value={dayStats.unique_players || 0} color="#31A24C" />
                <StatCard label="Player Hours" value={`${dayStats.total_hours || 0}h`} color="#F59E0B" />
                <StatCard label="Peak Tables" value={dayStats.peak_tables || openTables.length || 0} color="#A855F7" />
              </div>

              {(dayStats.time_revenue != null || dayStats.tournament_revenue != null || dayStats.comps_awarded != null) && (
                <div className="grid grid-cols-2 gap-3">
                  {dayStats.time_revenue != null && (
                    <StatCard label="Time Revenue" value={`$${dayStats.time_revenue.toLocaleString()}`} color="#31A24C" />
                  )}
                  {dayStats.tournament_revenue != null && (
                    <StatCard label="Tournament Fees" value={`$${dayStats.tournament_revenue.toLocaleString()}`} color="#F59E0B" />
                  )}
                  {dayStats.comps_awarded != null && (
                    <StatCard label="Comps Awarded" value={`$${dayStats.comps_awarded.toFixed(0)}`} color="#EF4444" />
                  )}
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="text-xs text-[#B0B3B8] uppercase tracking-wider block mb-1">Shift Notes (optional)</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  rows={3} placeholder="Any Notes About The Shift..."
                  className="w-full px-4 py-3 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-[#E4E6EB] placeholder-[#6A6B6D] focus:outline-none focus:border-[#1877F2] resize-none" />
              </div>

              <button onClick={() => setStep(3)}
                className="w-full py-4 rounded-xl bg-[#1877F2] text-white text-lg font-semibold flex items-center justify-center gap-2 active:bg-[#1565D8]">
                Next: Manager Sign-Off <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          {/* STEP 3: PIN Sign-off */}
          {step === 3 && (
            <>
              <h2 className="text-xl font-bold text-white text-center">Manager Sign-Off</h2>
              <p className="text-sm text-[#B0B3B8] text-center">Enter Your 4-Digit PIN To Confirm Close</p>

              <div className="flex justify-center gap-3 my-6">
                {[0, 1, 2, 3].map(i => (
                  <div key={i}
                    className={`w-14 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-bold ${pin.length > i ? 'border-[#1877F2] bg-[#1877F2]/10 text-white' : 'border-[#3A3B3C] bg-[#242526] text-[#3A3B3C]'
                      }`}>
                    {pin[i] ? '*' : ''}
                  </div>
                ))}
              </div>

              {/* PIN pad */}
              <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'].map((key, i) => {
                  if (key === null) return <div key={i} />;
                  return (
                    <button key={i}
                      onClick={() => {
                        if (key === 'del') setPin(pin.slice(0, -1));
                        else if (pin.length < 4) setPin(pin + key);
                      }}
                      className="py-4 rounded-xl bg-[#3A3B3C] text-white text-xl font-semibold active:bg-[#4A4B4C]">
                      {key === 'del' ? 'DEL' : key}
                    </button>
                  );
                })}
              </div>

              <button onClick={submitClose}
                disabled={pin.length !== 4 || verifying}
                className="w-full mt-4 py-4 rounded-xl bg-[#31A24C] text-white text-lg font-semibold flex items-center justify-center gap-2 active:bg-[#28883F] disabled:opacity-30">
                {verifying ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
                Confirm Close
              </button>
            </>
          )}

          {/* STEP 4: Done */}
          {step === 4 && (
            <div className="py-12 text-center">
              <div className="w-24 h-24 rounded-full bg-[#31A24C]/20 flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-12 h-12 text-[#31A24C]" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Day Closed</h2>
              <p className="text-[#B0B3B8] mb-8">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} has been closed successfully.
              </p>

              <div className="space-y-3">
                <button onClick={() => router.push('/commander/reports/daily-summary')}
                  className="w-full py-4 rounded-xl bg-[#1877F2] text-white text-lg font-semibold flex items-center justify-center gap-2 active:bg-[#1565D8]">
                  <FileText className="w-5 h-5" /> View Daily Report
                </button>
                <button onClick={() => router.back()}
                  className="w-full py-4 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-lg font-semibold active:bg-[#4A4B4C]">
                  Go Back
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`
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

function CheckItem({ label, detail, ok }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${ok ? 'bg-[#31A24C]/10 border-[#31A24C]/30' : 'bg-[#EF4444]/10 border-[#EF4444]/30'
      }`}>
      {ok
        ? <CheckCircle2 className="w-6 h-6 text-[#31A24C] flex-shrink-0" />
        : <XCircle className="w-6 h-6 text-[#EF4444] flex-shrink-0" />}
      <div>
        <p className={`text-sm font-medium ${ok ? 'text-[#31A24C]' : 'text-[#EF4444]'}`}>{label}</p>
        <p className="text-xs text-[#B0B3B8]">{detail}</p>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-3 text-center">
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
      <p className="text-[10px] text-[#B0B3B8]">{label}</p>
    </div>
  );
}
