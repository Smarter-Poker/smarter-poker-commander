/**
 * Texas Time Billing
 * /commander/time-billing
 * Session-based time charges for cash games (Texas cardroom model)
 * - Start/stop player sessions with seat assignment
 * - Auto-calculate charges based on game rate and duration
 * - Track payments, comps, adjustments
 * - Session history and reporting
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { DollarSign, Clock, Loader2, Package, Trash2, Save, RefreshCw } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession, getVenueId } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

function formatDuration(startTime) {
  if (!startTime) return '0:00';
  const mins = Math.floor((Date.now() - new Date(startTime).getTime()) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatMoney(n) { return '$' + (n || 0).toFixed(2); }

function calculateCharge(startTime, ratePerHour) {
  if (!startTime || !ratePerHour) return 0;
  const hours = (Date.now() - new Date(startTime).getTime()) / 3600000;
  const halfHours = Math.ceil(hours * 2);
  return (halfHours / 2) * ratePerHour;
}

export default function TimeBilling() {

  useEffect(() => { busEmit.sessionStart('commander-time-billing'); }, []);
  const router = useRouter();
  const [sessions, setSessions] = useState([]);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(null);
  const [payModal, setPayModal] = useState(null);
  const [payAmount, setPayAmount] = useState('');

  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState('active');
  const [pricingSaving, setPricingSaving] = useState(false);
  const [pricingDirty, setPricingDirty] = useState(false);
  const [pricing, setPricing] = useState({
    time_billing_rate: 0,
    auto_comp_rate: 0,
    bulk_time_packages: []
  });

  // Membership plans state
  const [memberPlans, setMemberPlans] = useState([]);
  const [memberSaving, setMemberSaving] = useState(null);
  const [memberDirty, setMemberDirty] = useState({});

  // PIN verification state
  const [pinStep, setPinStep] = useState(false);
  const [pinDigits, setPinDigits] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);
  const [verifiedStaff, setVerifiedStaff] = useState(null);
  const [pendingAction, setPendingAction] = useState(null); // { type: 'payment'|'stop', session }
  const [pinCacheExpiry, setPinCacheExpiry] = useState(0);

  // Check if PIN is still cached
  const isPinCached = () => verifiedStaff && Date.now() < pinCacheExpiry;

  // Clear PIN cache
  const lockPin = () => { setVerifiedStaff(null); setPinCacheExpiry(0); };

  const fetchData = useCallback(async () => {
    const controller = new AbortController();
    const { signal } = controller;
    try {
const venueId = getVenueId();
const headers = { };

      // Fetch tables to know which are active
      const tabRes = await commanderFetch(`/api/commander/tables?venue_id=${venueId}`, { headers });
      if (!tabRes.ok) throw new Error(`Tables fetch failed (${tabRes.status})`);
      const tabJson = await tabRes.json();
      const tablesArr = tabJson.success
        ? (Array.isArray(tabJson.data) ? tabJson.data : tabJson.data?.tables || [])
        : [];
      setTables(tablesArr);

      // Fetch active sessions from ALL tables (unified commander_table_sessions)
      const activeTables = tablesArr.filter(t => t.status === 'in_use');
      const allSessions = [];

      await Promise.all(activeTables.map(async (t) => {
        const tNum = t.table_number || t.number;
        try {
          const sRes = await commanderFetch(`/api/commander/dealer/sessions?table=${tNum}`, { headers });
          if (!sRes.ok) throw new Error(`Sessions fetch failed (${sRes.status})`);
          const sJson = await sRes.json();
          if (sJson.success && sJson.data) {
            sJson.data.forEach(s => allSessions.push({
              ...s,
              id: s.session_id,
              status: s.is_expired ? 'expired' : 'active',
              started_at: s.started_at,
              rate_per_hour: t.rate_per_hour || pricing.time_billing_rate || 0 }));
          }
        } catch { /* non-fatal */ }
      }));

      // Also fetch completed/ended sessions for history view
      if (filter === 'completed') {
        try {
          const histRes = await commanderFetch(`/api/commander/time-billing/sessions?venue_id=${venueId}`, { headers });
          if (!histRes.ok) throw new Error(`History fetch failed (${histRes.status})`);
          const histJson = await histRes.json();
          if (histJson.success) {
            const completed = (histJson.data || []).filter(s => s.status === 'completed');
            setSessions([...allSessions, ...completed]);
            return;
          }
        } catch { /* fall through */ }
      }

      setSessions(allSessions);
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, [filter, pricing.time_billing_rate]);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 30000); return () => clearInterval(i); }, [fetchData]); // fallback — real-time sync handles instant updates

  // Memoized venueId for Supabase sync (avoid function call per render)
  const [syncVenueId] = useState(() => getVenueId());

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Cross-tab + cross-device real-time sync
  useCommanderSync(syncVenueId, fetchData, { entities: ['tables', 'settings'] });
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i); }, []);

  // Load pricing settings
  useEffect(() => {
    const loadPricing = async () => {
      const controller = new AbortController();
      const { signal } = controller;
      try {
const json = await commanderFetchJSON('/api/commander/settings', {});
        if (json.success && json.data) {
          setPricing(prev => ({
            time_billing_rate: json.data.time_billing_rate ?? prev.time_billing_rate,
            auto_comp_rate: json.data.auto_comp_rate ?? prev.auto_comp_rate,
            bulk_time_packages: json.data.bulk_time_packages ?? prev.bulk_time_packages
          }));
        }
      } catch { /* non-fatal */ }
    };
    loadPricing();
    // Load membership plans
    const loadMemberPlans = async () => {
      try {
const venueId = getVenueId();
        const json = await commanderFetchJSON(`/api/commander/membership-plans?venue_id=${venueId}&include_inactive=true`, {});
        if (json.success) setMemberPlans(json.data.plans || []);
      } catch { /* non-fatal */ }
    };
    loadMemberPlans();
  }, []);

  // Save pricing settings
  const savePricing = async () => {
    setPricingSaving(true);
    try {
const res = await commanderFetch('/api/commander/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          time_billing_rate: pricing.time_billing_rate,
          auto_comp_rate: pricing.auto_comp_rate,
          bulk_time_packages: pricing.bulk_time_packages
        })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setPricingDirty(false);
        broadcastChange('settings');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
    finally { setPricingSaving(false); }
  };

  // PIN gate: request PIN before a financial action
  const requestPinFor = (type, session = null) => {
    if (type === 'payment' && (!payAmount || parseFloat(payAmount) <= 0)) return;
    // If PIN is cached, skip keypad
    if (isPinCached()) {
      setPendingAction({ type, session });
      if (type === 'payment') {
        doRecordPayment(verifiedStaff);
      } else if (type === 'stop') {
        doStopSession(session?.id, verifiedStaff);
      }
      return;
    }
    setPinDigits('');
    setPinError('');
    setPendingAction({ type, session });
    setPinStep(true);
  };

  // PIN gate: verify then execute the pending action
  const verifyPinAndExecute = async (digits) => {
    if (digits.length !== 4) return;
    setPinVerifying(true);
    setPinError('');
    try {
      const venueId = getVenueId();
      const pinRes = await commanderFetch('/api/commander/staff/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' || '' },
        body: JSON.stringify({ venue_id: venueId, pin_code: digits })
      });
      if (!pinRes.ok) throw new Error('Request failed');
      const pinJson = await pinRes.json();
      if (!pinJson.success || !pinJson.data?.valid) {
        setPinError(pinJson.error?.message || 'Invalid PIN');
        setPinDigits('');
        setPinVerifying(false);
        return;
      }
      setVerifiedStaff(pinJson.data.staff);
      // Cache PIN for 5 minutes
      setPinCacheExpiry(Date.now() + 5 * 60 * 1000);
      setPinStep(false); // Close PIN modal

      // Execute the pending action
      if (pendingAction?.type === 'payment') {
        await doRecordPayment(pinJson.data.staff);
      } else if (pendingAction?.type === 'stop') {
        await doStopSession(pendingAction.session?.id, pinJson.data.staff);
      }
      setPendingAction(null); // Clear pending action
    } catch (err) {
      setPinError('Network Error');
      setPinDigits('');
    } finally {
      setPinVerifying(false);
    }
  };

  const handlePinDigit = (d) => {
    const next = pinDigits + d;
    setPinDigits(next);
    setPinError('');
    if (next.length === 4) verifyPinAndExecute(next);
  };

  const doStopSession = async (sessionId, staff) => {
    setStopping(sessionId);
    try {
const res = await commanderFetch(`/api/commander/dealer/sessions/${sessionId}/end`, {
        method: 'POST'});
      if (res.ok) {
        const json = await res.json();
        // Print time billing receipt
        if (json.success && json.data) {
          const session = sessions.find(s => s.id === sessionId || s.session_id === sessionId);
          if (session) {
            printTimeBillingReceipt({
              ...session,
              duration_minutes: json.data.elapsed_minutes,
              total_charge: calculateCharge(session.started_at, session.rate_per_hour || pricing.time_billing_rate || 0),
              staff_name: staff?.display_name || 'Staff' });

            const venueId = getVenueId();
            const res = await commanderFetch(`/api/commander/cashier`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                venue_id: venueId,
                player_id: session.player_id,
                transaction_type: 'time_charge',
                amount: -calculateCharge(session.started_at, session.rate_per_hour || pricing.time_billing_rate || 0),
                payment_method: 'system',
                created_at: new Date().toISOString(),
                description: `Auto-charge: Time Billing session stopped (${json.data.elapsed_minutes}m)`,
                duration_minutes: json.data.elapsed_minutes,
                total_charge: calculateCharge(session.started_at, session.rate_per_hour || pricing.time_billing_rate || 0),
                staff_name: staff?.display_name || 'Staff' })
            });
            if (res.ok) {
              await fetchData();
              broadcastChange('tables');
            }
          }
        }
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
    finally { setStopping(null); }
  };

  const printTimeBillingReceipt = (session) => {
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) return;
    const hours = session.duration_minutes ? (session.duration_minutes / 60).toFixed(1) : '0';
    const charge = parseFloat(session.total_charge || 0);
    const html = `<!DOCTYPE html><html><head><title>Receipt</title>
<style>
  @page { margin: 0; size: 80mm auto; }
  body { font-family: 'Courier New', monospace; margin: 0; padding: 0; }
  .receipt { width: 72mm; padding: 4mm; margin: 0 auto; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .big { font-size: 24px; }
  .med { font-size: 14px; }
  .sm { font-size: 11px; }
  .divider { border-top: 1px dashed #000; margin: 3mm 0; }
  .row { display: flex; justify-content: space-between; }
</style></head><body>
<div class="receipt">
  <div class="center bold med">SMARTER.POKER</div>
  <div class="center sm">Time Billing Receipt</div>
  <div class="divider"></div>
  <div class="row sm"><span>Player:</span><span class="bold">${session.player_name}</span></div>
  <div class="row sm"><span>Table/Seat:</span><span class="bold">T${session.table_number || '-'} S${session.seat_number || '-'}</span></div>
  <div class="divider"></div>
  <div class="row sm"><span>Duration:</span><span class="bold">${hours} hrs</span></div>
  <div class="row sm"><span>Rate:</span><span>$${parseFloat(session.rate_per_hour || pricing.time_billing_rate || 0).toFixed(2)}/hr</span></div>
  <div class="divider"></div>
  <div class="center bold big">$${charge.toFixed(2)}</div>
  <div class="center sm">AMOUNT DUE</div>
  ${session.staff_name ? `<div class="divider"></div><div class="row sm"><span>Processed by:</span><span class="bold">${session.staff_name}</span></div>` : ''}
  <div class="divider"></div>
  <div class="sm center" style="opacity:0.6">${new Date().toLocaleString()}</div>
  <div class="sm center" style="opacity:0.4;margin-top:1mm">Smarter.Poker</div>
</div></body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
  };

  const doRecordPayment = async (staff) => {
    if (!payModal || !payAmount) return;
    try {
const res = await commanderFetch(`/api/commander/time-billing/sessions/${payModal.id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseFloat(payAmount), staff_name: staff?.display_name })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          // Auto-print receipt
          printTimeBillingReceipt({
            player_name: payModal.player_name,
            table_number: payModal.table_number,
            seat_number: payModal.seat_number,
            total_charge: parseFloat(payAmount), // Use payAmount as total_charge for receipt
            type: 'time_payment',
            staff_name: staff?.display_name || 'Staff'
          });

          setPayModal(null); setPayAmount('');
          await fetchData();
          broadcastChange('tables');
        }
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
  };

  const activeSessions = sessions.filter(s => s.status === 'active');
  const completedSessions = sessions.filter(s => s.status === 'completed');
  const displaySessions = filter === 'active' ? activeSessions : completedSessions;
  const filtered = displaySessions;

  const totalActive = activeSessions.reduce((sum, s) =>
    sum + calculateCharge(s.started_at, s.rate_per_hour), 0);
  const totalCollected = sessions.reduce((sum, s) => sum + (s.amount_paid || 0), 0);

  // Save a membership plan price
  const saveMemberPrice = async (plan, field, value) => {
    setMemberSaving(plan.id);
    try {
const venueId = getVenueId();
const res = await commanderFetch(`/api/commander/membership-plans?venue_id=${venueId}&id=${plan.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: parseFloat(value) || 0 })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setMemberPlans(prev => prev.map(p => p.id === plan.id ? { ...p, [field]: parseFloat(value) || 0 } : p));
        setMemberDirty(prev => ({ ...prev, [plan.id]: false }));
        broadcastChange('settings');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
    finally { setMemberSaving(null); }
  };

  if (loading) return <div className="min-h-screen bg-[#18191A] flex items-center justify-center"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" /></div>;

  return (
    <CommanderLayout title="Time Billing" backHref="/commander/dashboard">
      <SEOHead
        title="Commander — Time Billing"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">

        {/* Sub-header with stats and actions */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-[#B0B3B8]">{activeSessions.length} active sessions</p>
          </div>
          <button onClick={fetchData} className="p-2 rounded-lg active:bg-[#3A3B3C]">
            <RefreshCw className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        {/* Pricing & Packages */}
        <div className="px-4 py-3 space-y-3">
          {/* Hourly Rate + Auto-Comp */}
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="w-5 h-5 text-[#1877F2]" />
              <h3 className="text-sm font-bold text-white">Pricing</h3>
              <div className="flex-1" />
              {pricingDirty && (
                <button onClick={savePricing} disabled={pricingSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1877F2] text-white text-xs font-medium disabled:opacity-50">
                  {pricingSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Save
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-[#B0B3B8] block mb-1">Time Rate ($/hour)</label>
                <input type="number" value={pricing.time_billing_rate} min={1} max={100}
                  onChange={e => { setPricing(p => ({ ...p, time_billing_rate: parseInt(e.target.value) || 1 })); setPricingDirty(true); }}
                  className="w-full px-3 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-white text-lg font-mono text-center focus:outline-none focus:border-[#1877F2]" />
              </div>
              <div>
                <label className="text-[10px] text-[#B0B3B8] block mb-1">Auto-Comp ($/hour played)</label>
                <input type="number" value={pricing.auto_comp_rate} min={0} max={25}
                  onChange={e => { setPricing(p => ({ ...p, auto_comp_rate: parseFloat(e.target.value) || 0 })); setPricingDirty(true); }}
                  className="w-full px-3 py-2 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-white text-lg font-mono text-center focus:outline-none focus:border-[#1877F2]" />
              </div>
            </div>
          </div>

          {/* Bulk Time Packages */}
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Package className="w-5 h-5 text-[#F59E0B]" />
              <h3 className="text-sm font-bold text-white">Bulk Time Packages</h3>
              <p className="text-[10px] text-[#B0B3B8]">(deals for bulk purchases)</p>
              <div className="flex-1" />
              {pricingDirty && (
                <button onClick={savePricing} disabled={pricingSaving}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1877F2] text-white text-xs font-medium disabled:opacity-50 mr-1">
                  {pricingSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Save
                </button>
              )}
              <button onClick={() => {
                setPricing(p => ({
                  ...p,
                  bulk_time_packages: [...(p.bulk_time_packages || []), { name: '', hours: 5, price: 50 }]
                }));
                setPricingDirty(true);
              }} className="px-2.5 py-1 rounded-lg bg-[#3A3B3C] text-[#1877F2] text-xs font-medium">
                + Add
              </button>
            </div>

            {(!pricing.bulk_time_packages || pricing.bulk_time_packages.length === 0) ? (
              <p className="text-xs text-[#64748B] text-center py-3">No bulk packages — click + Add to create a deal</p>
            ) : (
              <div className="space-y-3">
                {pricing.bulk_time_packages.map((pkg, idx) => {
                  const perHr = pkg.hours > 0 ? (pkg.price / pkg.hours) : 0;
                  const isDiscount = perHr > 0 && perHr < pricing.time_billing_rate;
                  return (
                    <div key={idx} className="bg-[#18191A] rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <input type="text" value={pkg.name} placeholder={`e.g. ${pkg.hours || 5}-Hour Deal`}
                          onChange={e => {
                            const pkgs = [...pricing.bulk_time_packages];
                            pkgs[idx] = { ...pkgs[idx], name: e.target.value };
                            setPricing(p => ({ ...p, bulk_time_packages: pkgs }));
                            setPricingDirty(true);
                          }}
                          className="flex-1 px-2 py-1.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded text-white text-sm focus:outline-none focus:border-[#1877F2]" />
                        <button onClick={() => {
                          setPricing(p => ({
                            ...p,
                            bulk_time_packages: p.bulk_time_packages.filter((_, i) => i !== idx)
                          }));
                          setPricingDirty(true);
                        }} className="p-1.5 text-[#EF4444] hover:bg-[#EF4444]/10 rounded">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[9px] text-[#64748B] block mb-0.5">Hours</label>
                          <input type="number" value={pkg.hours} min={1} max={100}
                            onChange={e => {
                              const pkgs = [...pricing.bulk_time_packages];
                              pkgs[idx] = { ...pkgs[idx], hours: parseInt(e.target.value) || 1 };
                              setPricing(p => ({ ...p, bulk_time_packages: pkgs }));
                              setPricingDirty(true);
                            }}
                            className="w-full px-2 py-1.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded text-white text-sm text-center focus:outline-none focus:border-[#1877F2]" />
                        </div>
                        <div>
                          <label className="text-[9px] text-[#64748B] block mb-0.5">Price ($)</label>
                          <input type="number" value={pkg.price} min={0} step={0.01}
                            onChange={e => {
                              const pkgs = [...pricing.bulk_time_packages];
                              pkgs[idx] = { ...pkgs[idx], price: parseFloat(e.target.value) || 0 };
                              setPricing(p => ({ ...p, bulk_time_packages: pkgs }));
                              setPricingDirty(true);
                            }}
                            className="w-full px-2 py-1.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded text-white text-sm text-center focus:outline-none focus:border-[#1877F2]" />
                        </div>
                        <div>
                          <label className="text-[9px] text-[#64748B] block mb-0.5">Eff. Rate</label>
                          <div className={`px-2 py-1.5 rounded text-sm text-center font-mono ${isDiscount ? 'bg-[#31A24C]/10 text-[#31A24C] font-bold' : 'bg-[#3A3B3C] text-[#B0B3B8]'}`}>
                            ${perHr.toFixed(2)}/hr
                          </div>
                        </div>
                      </div>
                      {isDiscount && (
                        <p className="text-[10px] text-[#31A24C] mt-1.5">
                          Save ${((pricing.time_billing_rate - perHr) * pkg.hours).toFixed(2)} vs standard rate
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Membership Pricing Section */}
        <div className="px-4 py-3">
          <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-[#8B5CF6]" />
              <h3 className="text-sm font-bold text-white">Membership Pricing</h3>
              <p className="text-[10px] text-[#B0B3B8]">(saved to venue settings)</p>
            </div>
            {memberPlans.length === 0 ? (
              <p className="text-xs text-[#64748B] text-center py-3">No membership plans configured</p>
            ) : (
              <div className="space-y-3">
                {memberPlans.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map(plan => {
                  const tierLabels = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
                  const tierColors = { daily: '#22D3EE', weekly: '#31A24C', monthly: '#F59E0B', yearly: '#8B5CF6' };
                  const priceField = plan.tier === 'daily' ? 'price_daily' : plan.tier === 'weekly' ? 'price_weekly' : plan.tier === 'monthly' ? 'price_monthly' : 'price_yearly';
                  const price = plan[priceField];
                  const isDirty = memberDirty[plan.id];
                  return (
                    <div key={plan.id} className="bg-[#18191A] rounded-lg p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full" style={{ background: tierColors[plan.tier] || '#1877F2' }} />
                        <span className="text-sm font-bold text-white flex-1">{tierLabels[plan.tier] || plan.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[#B0B3B8]">$</span>
                          <input type="number" step="0.01" min="0"
                            value={price != null ? price : ''}
                            onChange={e => {
                              const v = e.target.value;
                              setMemberPlans(prev => prev.map(p => p.id === plan.id ? { ...p, [priceField]: v === '' ? null : parseFloat(v) } : p));
                              setMemberDirty(prev => ({ ...prev, [plan.id]: true }));
                            }}
                            className="w-24 px-2 py-1.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded text-white text-lg font-mono text-center focus:outline-none focus:border-[#1877F2]" />
                          {isDirty && (
                            <button onClick={() => saveMemberPrice(plan, priceField, plan[priceField])}
                              disabled={memberSaving === plan.id}
                              className="px-3 py-1.5 rounded-lg bg-[#1877F2] text-white text-xs font-medium disabled:opacity-50 flex items-center gap-1">
                              {memberSaving === plan.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              Save
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
