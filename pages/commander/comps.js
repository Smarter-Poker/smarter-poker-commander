/**
 * Comp System - Enhanced
 * /commander/comps
 * 
 * Two pillars:
 * 1. Auto Rake-Back - comps earned per hour of play (configured in Settings)
 * 2. Manual Comp Issuance - categorized comps, PIN-gated, fully documented
 * 
 * All comp issuance requires staff PIN verification. No exceptions.
 * 
 * Tabs: Dashboard | Issue Comp | Comp Log | Rates
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Gift, DollarSign, Users, Clock, Search, TrendingUp, Loader2, RefreshCw, Check, Shield, X, UtensilsCrossed, Ticket, Coins, Timer, CreditCard, ShoppingBag, FileText, Award, BarChart3 } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import useDebounce from '../../src/hooks/useDebounce';
import { getToken, getStaffSession, getVenueId } from '../../src/lib/commander/clientAuth'
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

// ─── Comp Categories ─────────────────────────────────────────
const COMP_CATEGORIES = [
  { key: 'free_time', label: 'Free Time', icon: Timer, color: '#3B82F6', desc: 'Comp Table Time' },
  { key: 'free_membership', label: 'Free Membership', icon: CreditCard, color: '#8B5CF6', desc: 'Comp Membership Period' },
  { key: 'free_chips', label: 'Free Chips', icon: Coins, color: '#F59E0B', desc: 'Bonus Chips' },
  { key: 'free_food', label: 'Food & Beverage', icon: UtensilsCrossed, color: '#EF4444', desc: 'Meals, Drinks, Snacks' },
  { key: 'cash_bonus', label: 'Cash Bonus', icon: DollarSign, color: '#31A24C', desc: 'Straight Cash Comp' },
  { key: 'tournament_entry', label: 'Tournament Entry', icon: Ticket, color: '#EC4899', desc: 'Free Tournament Seat' },
  { key: 'merchandise', label: 'Merchandise', icon: ShoppingBag, color: '#06B6D4', desc: 'Club Store Items' },
  { key: 'other', label: 'Other', icon: FileText, color: '#6B7280', desc: 'Custom Comp' },
];

const QUICK_AMOUNTS = [5, 10, 15, 20, 25, 50, 75, 100];
const MEMBERSHIP_DURATIONS = [
  { key: '1', label: '1 Day', days: 1, priceField: 'price_daily', multiplier: 1 },
  { key: '7', label: '1 Week', days: 7, priceField: 'price_weekly', multiplier: 1 },
  { key: '30', label: '1 Month', days: 30, priceField: 'price_monthly', multiplier: 1 },
  { key: '90', label: '3 Months', days: 90, priceField: 'price_monthly', multiplier: 3 },
  { key: '180', label: '6 Months', days: 180, priceField: 'price_monthly', multiplier: 6 },
  { key: '365', label: '1 Year', days: 365, priceField: 'price_yearly', multiplier: 1 },
];
const TIME_QUICKPICKS = [
  { key: '30', label: '30 Min', minutes: 30 },
  { key: '60', label: '1 Hour', minutes: 60 },
  { key: '120', label: '2 Hours', minutes: 120 },
  { key: '180', label: '3 Hours', minutes: 180 },
  { key: '240', label: '4 Hours', minutes: 240 },
  { key: '300', label: '5 Hours', minutes: 300 },
];

export default function CompSystem() {
  const router = useRouter();

  useEffect(() => { busEmit.sessionStart('commander-comps'); }, []);
  const [tab, setTab] = useState('dashboard');
  const [loading, setLoading] = useState(false);

  // ─── Dashboard state ───
  const [stats, setStats] = useState({ today: 0, week: 0, allTime: 0, count: 0 });
  const [topEarners, setTopEarners] = useState([]);

  // ─── Issue Comp state ───
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [compAmount, setCompAmount] = useState('');
  const [membershipCost, setMembershipCost] = useState('');
  const [compLocation, setCompLocation] = useState('');
  const [compNotes, setCompNotes] = useState('');
  const [awarding, setAwarding] = useState(false);
  const [awarded, setAwarded] = useState(false);
  const [awardError, setAwardError] = useState('');
  const [lastAwardData, setLastAwardData] = useState(null);
  const [successOverlay, setSuccessOverlay] = useState(null);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // ─── PIN auth state ───
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinCode, setPinCode] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifying, setVerifying] = useState(false);

  // ─── Comp Log state ───
  const [compLog, setCompLog] = useState([]);
  const [logFilter, setLogFilter] = useState('all');

  // ─── Void comp state ───
  const [voidPinModal, setVoidPinModal] = useState(null);
  const [voidPinCode, setVoidPinCode] = useState('');
  const [voidPinError, setVoidPinError] = useState('');
  const [voidLoading, setVoidLoading] = useState(false);
  const [timeMinutes, setTimeMinutes] = useState('');

  // ─── Settings state ───
  const [autoCompRate, setAutoCompRate] = useState(1);
  const [membershipPlans, setMembershipPlans] = useState([]);
  // 2026-08-06 fix: the Rates tab showed fabricated per-game multipliers -
  // back it with real commander_comp_rates rows scoped to the venue.
  const [compRates, setCompRates] = useState([]);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ─── Auth helpers ───
  const getHeaders = () => {
    const token = getToken();
    const staffSession = getStaffSession();
    const headers = { };
    if (staffSession) headers['x-staff-session'] = staffSession;
    return headers;
  };

  // ─── Load settings (auto comp rate) ───
  useEffect(() => {
    const staffSession = getStaffSession();
    if (!staffSession) return;
    commanderFetch('/api/commander/settings', { headers: getHeaders() })
      .then(r => r.json())
      .then(data => {
        if (data?.data?.auto_comp_rate !== undefined) {
          setAutoCompRate(data.data.auto_comp_rate);
        }
      })
      .catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));

    // Fetch membership plans for auto-populating comp costs
    const venueId = getVenueId();
    if (venueId) {
      commanderFetch(`/api/commander/membership-plans?venue_id=${venueId}`, { headers: getHeaders() })
        .then(r => r.json())
        .then(data => {
          if (data?.success && data.data?.plans) {
            setMembershipPlans(data.data.plans);
          }
        })
        .catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));

      // 2026-08-06 fix: load real comp rates for the Rates tab
      commanderFetch(`/api/commander/comps/rates?venue_id=${venueId}`, { headers: getHeaders() })
        .then(r => r.json())
        .then(data => {
          if (data?.success && Array.isArray(data.data?.rates)) {
            setCompRates(data.data.rates);
          }
        })
        .catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    }
  }, []);

  // ─── Fetch tab data ───
  const fetchData = useCallback(async () => {
    const controller = new AbortController();
    const { signal } = controller;

    setLoading(true);
    try {
      const venueId = getVenueId();
      const headers = getHeaders();

      if (tab === 'dashboard') {
        const [membersRes, logRes] = await Promise.all([
          commanderFetch(`/api/commander/members?venue_id=${venueId}&has_comps=true&limit=100`, { headers }).catch(() => ({ ok: false })),
          commanderFetch(`/api/commander/comps/balances?venue_id=${venueId}&history=true`, { headers }).catch(() => ({ ok: false }))
        ]);
        if (!membersRes || typeof membersRes.json !== 'function') throw new Error('Members fetch failed (network error)');
        if (!membersRes.ok) throw new Error(`Request failed (${membersRes.status})`);
        const membersJson = await membersRes.json();
        if (!logRes || typeof logRes.json !== 'function') throw new Error('Comp log fetch failed (network error)');
        if (!logRes.ok) throw new Error(`Request failed (${logRes.status})`);
        const logJson = await logRes.json();

        const members = membersJson.data?.members || membersJson.data || [];
        const withComps = members
          .filter(m => (m.comp_balance || 0) > 0)
          .sort((a, b) => (b.comp_balance || 0) - (a.comp_balance || 0))
          .slice(0, 5);
        setTopEarners(withComps);

        const txns = logJson.data?.transactions || [];
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);

        let today = 0, week = 0, allTime = 0, count = 0;
        txns.forEach(t => {
          if (t.type === 'void') return; // Don't count voids in totals
          const amt = Math.abs(t.amount || 0);
          allTime += amt;
          count++;
          const d = new Date(t.created_at);
          if (d >= todayStart) today += amt;
          if (d >= weekStart) week += amt;
        });
        setStats({ today, week, allTime, count });

      } else if (tab === 'log') {
        const json = await commanderFetchJSON(`/api/commander/comps/balances?venue_id=${venueId}&history=true`, { headers });
        setCompLog(json.data?.transactions || []);
      }
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useCommanderSync(getVenueId(), fetchData, { entities: ['members'] });

  // ─── Member search ───
  const searchMembers = async (query) => {
    const q = query !== undefined ? query : searchQuery;
    if (!q || q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const venueId = getVenueId();
      const headers = {};
      const staffSession = getStaffSession();
      if (staffSession) headers['x-staff-session'] = staffSession;
      const res = await commanderFetch(`/api/commander/members/search?q=${encodeURIComponent(q)}&limit=10${venueId ? `&venue_id=${venueId}` : ''}`, { headers });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) setSearchResults(json.data || []);
    } catch (err) { console.warn(err); }
    finally { setSearching(false); }
  };

  // Auto-search with debounce as user types
  useEffect(() => {
    if (!debouncedSearchQuery || debouncedSearchQuery.length < 2) { setSearchResults([]); return; }
    searchMembers(debouncedSearchQuery);
  }, [debouncedSearchQuery]);

  // ─── Step 1: Click Issue Comp → show PIN modal ───
  const requestComp = () => {
    if (!selectedMember || !compAmount || !selectedCategory) return;
    setPinCode('');
    setPinError('');
    setShowPinModal(true);
  };

  // ─── Step 2: Verify PIN → award comp ───
  const verifyPinAndAward = async () => {
    if (!pinCode || pinCode.length !== 4) {
      setPinError('Enter Your 4-Digit Staff PIN');
      return;
    }
    setVerifying(true);
    setPinError('');
    try {
      const venueId = getVenueId();
      const pinRes = await commanderFetch('/api/commander/staff/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venueId, pin_code: pinCode })
      });
      if (!pinRes.ok) throw new Error(`Request failed (${pinRes.status})`);
      const pinData = await pinRes.json();

      // Check both HTTP status and the 'valid' field from the API
      if (!pinRes.ok || !pinData.success || !pinData.data?.valid) {
        setPinError(pinData.error?.message || 'Invalid PIN, Please Try Again');
        setVerifying(false);
        return;
      }

      const authorizer = pinData.data?.staff;
      const authorizerName = authorizer?.display_name || 'Staff';

      // ── ROLE CHECK: Only owner, manager, dualrate can issue comps ──
      const compRoles = ['owner', 'manager', 'dualrate'];
      if (!authorizer?.role || !compRoles.includes(authorizer.role)) {
        setPinError(`Insufficient Permissions, ${authorizer?.role || 'unknown'} Role Cannot Issue Comps. Requires Owner, Manager, Or Dual Rate.`);
        setVerifying(false);
        return;
      }

      setShowPinModal(false);
      setAwarding(true);
      setAwardError('');
      const token = getToken();
      const staffSession = getStaffSession();
      const headers = { 'Content-Type': 'application/json' };
      if (staffSession) headers['x-staff-session'] = staffSession;

      const catLabel = COMP_CATEGORIES.find(c => c.key === selectedCategory)?.label || selectedCategory;
      const isMembership = selectedCategory === 'free_membership';
      const durationLabel = isMembership
        ? (MEMBERSHIP_DURATIONS.find(d => d.key === compAmount)?.label || `${compAmount} Days`)
        : null;

      const body = {
        member_id: selectedMember.id,
        amount: isMembership ? (parseFloat(membershipCost) || 0) : parseFloat(compAmount),
        reason: isMembership
          ? `Free Membership - ${durationLabel}${compNotes ? ' - ' + compNotes : ''}`
          : selectedCategory === 'free_food' && compLocation
            ? `${catLabel} @ ${compLocation}${compNotes ? ' - ' + compNotes : ''}`
            : `${catLabel}${compNotes ? ' - ' + compNotes : ''}`,
        type: 'award',
        comp_category: selectedCategory,
        notes: selectedCategory === 'free_food' && compLocation
          ? `Location: ${compLocation}${compNotes ? ' - ' + compNotes : ''}`
          : (compNotes || ''),
        authorized_by: authorizerName,
        authorized_pin: true };
      if (isMembership) {
        body.membership_days = parseInt(compAmount);
      }
      if (selectedCategory === 'free_time' && timeMinutes) {
        body.time_minutes = parseInt(timeMinutes);
      }

      const res = await commanderFetch('/api/commander/comps/balances', {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        broadcastChange('members');
        busEmit.celebration('confetti');
        const receiptData = {
          memberName: `${selectedMember.first_name} ${selectedMember.last_name}`,
          amount: isMembership ? (parseFloat(membershipCost) || 0) : parseFloat(compAmount),
          category: catLabel,
          durationLabel: durationLabel,
          isMembership: isMembership,
          notes: compNotes,
          authorizedBy: authorizerName,
          newBalance: json.data?.new_balance,
          newExpires: json.data?.membership_expires,
          timestamp: new Date().toLocaleString()
        };
        setLastAwardData(receiptData);
        setAwarded(true);

        // Play ka-ching and show full-screen success overlay
        playSuccessSound();
        showSuccessPopup({
          title: 'Comp Issued',
          amount: isMembership ? receiptData.durationLabel : selectedCategory === 'free_time' ? `${(() => { const m = parseInt(timeMinutes || 0); const h = Math.floor(m / 60); const mins = m % 60; return h > 0 ? `${h}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`; })()} ($${receiptData.amount.toFixed(2)})` : `$${receiptData.amount.toFixed(2)}`,
          detail: `${catLabel} > ${receiptData.memberName}`,
          balance: isMembership && json.data?.membership_expires
            ? `Active Through ${new Date(json.data.membership_expires).toLocaleDateString()}`
            : `Comp Balance: $${(json.data?.new_balance || 0).toFixed(2)}`
        });

        // Auto-print receipt
        printCompReceipt(receiptData);

        setTimeout(() => {
          setAwarded(false);
          setSelectedMember(null);
          setSelectedCategory(null);
          setCompAmount('');
          setMembershipCost('');
          setCompNotes('');
          setCompLocation('');
          setTimeMinutes('');
          setSearchQuery('');
          setSearchResults([]);
          setLastAwardData(null);
        }, 4000);
      } else {
        setAwardError(json.error || 'Failed To Issue Comp, Please Try Again');
      }
    } catch (err) {
      console.warn(err);
      setAwardError('Network Error, Please Try Again');
    }
    finally { setAwarding(false); setVerifying(false); }
  };

  // ─── Auto-print receipt on comp completion ───
  const printCompReceipt = (data) => {
    try {
      const receiptWindow = window.open('', '_blank', 'width=400,height=600');
      if (!receiptWindow) return; // popup blocked
      const amountLine = data.isMembership
        ? `<div class="amount" style="color:#8B5CF6">${data.durationLabel}</div>
           <div style="text-align:center;font-size:18px;font-weight:bold;color:#31A24C;margin:-8px 0 4px">$${(data.amount || 0).toFixed(2)} Club Expense</div>`
        : `<div class="amount">$${data.amount.toFixed(2)}</div>`;
      const balanceLine = data.isMembership && data.newExpires
        ? `<div class="row"><span>Active Through:</span><span class="bold">${new Date(data.newExpires).toLocaleDateString()}</span></div>`
        : `<div class="row"><span>New Balance:</span><span class="bold">$${(data.newBalance || 0).toFixed(2)}</span></div>`;
      receiptWindow.document.write(`
        <html>
        <head><title>Comp Receipt</title>
        <style>
          body { font-family: 'Courier New', monospace; width: 280px; margin: 0 auto; padding: 20px 0; color: #000; }
          .center { text-align: center; }
          .divider { border-top: 1px dashed #000; margin: 8px 0; }
          .bold { font-weight: bold; }
          .row { display: flex; justify-content: space-between; margin: 4px 0; font-size: 13px; }
          h2 { margin: 0 0 4px; font-size: 16px; }
          .amount { font-size: 28px; font-weight: bold; text-align: center; margin: 12px 0; }
          .footer { font-size: 10px; text-align: center; margin-top: 16px; color: #666; }
          .stamp { border: 2px solid #000; padding: 4px 12px; display: inline-block; font-weight: bold; font-size: 11px; margin-top: 8px; letter-spacing: 1px; }
        </style>
        </head>
        <body>
          <div class="center">
            <h2>COMP RECEIPT</h2>
            <p style="font-size:11px;margin:0;">Club Commander</p>
          </div>
          <div class="divider"></div>
          <div class="row"><span>Date:</span><span>${data.timestamp}</span></div>
          <div class="row"><span>Member:</span><span class="bold">${data.memberName}</span></div>
          <div class="row"><span>Category:</span><span>${data.category}</span></div>
          ${data.notes ? `<div class="row"><span>Notes:</span><span>${data.notes}</span></div>` : ''}
          <div class="divider"></div>
          ${amountLine}
          <div class="divider"></div>
          ${balanceLine}
          <div class="row"><span>Authorized By:</span><span>${data.authorizedBy}</span></div>
          <div class="center" style="margin-top:12px;">
            <span class="stamp">STAFF PIN VERIFIED</span>
          </div>
          <div class="footer">
            <p>This comp has been logged and documented.</p>
            <p>Thank you for playing!</p>
          </div>
        </body>
        </html>
      `);
      receiptWindow.document.close();
      setTimeout(() => { receiptWindow.print(); }, 300);
    } catch (e) { console.warn('Receipt print failed:', e); }
  };

  const resetIssueFlow = () => {
    setSelectedMember(null);
    setSelectedCategory(null);
    setCompAmount('');
    setMembershipCost('');
    setCompNotes('');
    setCompLocation('');
    setTimeMinutes('');
    setSearchQuery('');
    setSearchResults([]);
    setAwarded(false);
    setAwardError('');
  };

  // ─── Void/Revoke comp ───
  var voidCompEntry = function (logEntry) {
    var minutesAgo = (Date.now() - new Date(logEntry.created_at).getTime()) / 60000;
    var actionLabel = minutesAgo <= 15 ? 'Void' : 'Revoke';
    setVoidPinModal({ logEntry: logEntry, actionLabel: actionLabel });
    setVoidPinCode('');
    setVoidPinError('');
  };

  var executeVoidComp = function () {
    if (!voidPinCode || voidPinCode.length !== 4) {
      setVoidPinError('Enter Your 4-Digit Staff PIN');
      return;
    }
    setVoidLoading(true);
    setVoidPinError('');
    var venueId = getVenueId();
    commanderFetch('/api/commander/staff/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue_id: venueId, pin_code: voidPinCode })
    }).then(r => { if (!r.ok) throw new Error('fail'); return r; })
      .then(function (r) { return r.json(); })
      .then(function (pinData) {
        if (!pinData.success || !pinData.data || !pinData.data.valid) {
          setVoidPinError(pinData.error && pinData.error.message ? pinData.error.message : 'Invalid PIN');
          setVoidLoading(false);
          return;
        }
        var staff = pinData.data.staff;
        // ── ROLE CHECK: Only owner, manager, dualrate can void comps ──
        var voidRoles = ['owner', 'manager', 'dualrate'];
        if (!staff || !staff.role || voidRoles.indexOf(staff.role) === -1) {
          setVoidPinError('Insufficient Permissions, ' + (staff && staff.role || 'unknown') + ' Role Cannot Void Comps. Requires Owner, Manager, Or Dual Rate.');
          setVoidLoading(false);
          return;
        }
        var entry = voidPinModal.logEntry;
        var token = getToken();
        var staffSession = getStaffSession();
        var headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
        if (staffSession) headers['x-staff-session'] = staffSession;
        // Record void transaction via PATCH (voidComp handler)
        return commanderFetch('/api/commander/comps/balances', {
          method: 'PATCH',
          headers: headers,
          body: JSON.stringify({
            comp_log_id: entry.id,
            authorized_by: (staff && staff.display_name) || 'Staff',
            authorized_pin: true,
            void_reason: voidPinModal.actionLabel + ' By ' + ((staff && staff.display_name) || 'Staff')
          })
        }).then(r => { if (!r.ok) throw new Error('fail'); return r; })
          .then(function (r) { return r.json(); })
          .then(function (json) {
            if (json.success) {
              playSuccessSound();
              showSuccessPopup({
                title: voidPinModal.actionLabel + ' Processed',
                amount: '$' + Math.abs(entry.amount || 0).toFixed(2),
                detail: (entry.member_name || 'Member') + ' - Comp Reversed',
                balance: 'New Balance: $' + (json.data && json.data.new_balance !== undefined ? json.data.new_balance.toFixed(2) : '0.00')
              });
              broadcastChange('members');
              fetchData();
            } else {
              setVoidPinError(json.error || 'Void Failed');
            }
            setVoidPinModal(null);
            setVoidPinCode('');
            setVoidLoading(false);
          });
      })
      .catch(function (err) {
        console.warn(err);
        setToast({ type: 'error', text: 'Action Failed. Please Check Your Connection And Try Again.' });
        setVoidPinError('Network Error');
        setVoidLoading(false);
      });
  };

  // Ka-ching cash register sound - loud and unmistakable
  const playSuccessSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o1 = ctx.createOscillator(); const g1 = ctx.createGain();
      o1.type = 'triangle'; o1.connect(g1); g1.connect(ctx.destination);
      o1.frequency.setValueAtTime(1200, ctx.currentTime);
      o1.frequency.setValueAtTime(1600, ctx.currentTime + 0.08);
      g1.gain.setValueAtTime(0.6, ctx.currentTime);
      g1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      o1.start(ctx.currentTime); o1.stop(ctx.currentTime + 0.15);
      const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
      o2.type = 'sine'; o2.connect(g2); g2.connect(ctx.destination);
      o2.frequency.setValueAtTime(1800, ctx.currentTime + 0.12);
      g2.gain.setValueAtTime(0.5, ctx.currentTime + 0.12);
      g2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      o2.start(ctx.currentTime + 0.12); o2.stop(ctx.currentTime + 0.5);
      const o3 = ctx.createOscillator(); const g3 = ctx.createGain();
      o3.type = 'sine'; o3.connect(g3); g3.connect(ctx.destination);
      o3.frequency.setValueAtTime(2400, ctx.currentTime + 0.25);
      g3.gain.setValueAtTime(0.4, ctx.currentTime + 0.25);
      g3.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.7);
      o3.start(ctx.currentTime + 0.25); o3.stop(ctx.currentTime + 0.7);
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  };

  // Show full-screen success overlay
  const showSuccessPopup = ({ title, amount, detail, balance }) => {
    setSuccessOverlay({ title, amount, detail, balance });
    setTimeout(() => { setSuccessOverlay(null); }, 3500);
  };

  const TABS = [
    { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { key: 'issue', label: 'Issue Comp', icon: Gift },
    { key: 'log', label: 'Comp Log', icon: FileText },
    { key: 'rates', label: 'Rates', icon: TrendingUp },
  ];

  const filteredLog = logFilter === 'all'
    ? compLog
    : compLog.filter(t => (t.comp_category || 'cash_bonus') === logFilter);

  return (
    <CommanderLayout title="Comp System" backHref="/commander/dashboard?card=displays">
      <>
        <SEOHead
          title="Commander - Comps & Rewards"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />
        <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">

          {successOverlay && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80">
              <div className="text-center">
                <div className="w-24 h-24 rounded-full bg-[#31A24C]/20 flex items-center justify-center mx-auto mb-5">
                  <Check className="w-14 h-14 text-[#31A24C]" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">{successOverlay.title}</h2>
                <p className="text-4xl font-black text-[#31A24C] mb-3">{successOverlay.amount}</p>
                <p className="text-base text-[#B0B3B8] mb-1">{successOverlay.detail}</p>
                {successOverlay.balance && (
                  <p className="text-sm font-semibold text-[#1877F2] mt-2 bg-[#1877F2]/10 px-4 py-2 rounded-xl inline-block">{successOverlay.balance}</p>
                )}
              </div>
            </div>
          )}

          {/* ═══ PIN Authorization Modal ═══ */}
          {showPinModal && (
            <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
              <div className="bg-[#242526] rounded-2xl w-full max-w-sm border border-[#3A3B3C] shadow-2xl">
                <div className="p-5 text-center border-b border-[#3A3B3C]">
                  <div className="w-14 h-14 rounded-full bg-[#F59E0B]/10 flex items-center justify-center mx-auto mb-3">
                    <Shield className="w-7 h-7 text-[#F59E0B]" />
                  </div>
                  <h3 className="text-lg font-bold text-white">Staff PIN Required</h3>
                  <p className="text-sm text-[#B0B3B8] mt-1">
                    Authorize{' '}
                    {selectedCategory === 'free_membership'
                      ? <><span className="text-[#8B5CF6] font-bold">{MEMBERSHIP_DURATIONS.find(d => d.key === compAmount)?.label || 'Membership'}</span>{' '}<span className="text-[#31A24C] font-bold">(${membershipCost || '0'})</span></>
                      : <span className="text-[#31A24C] font-bold">${compAmount}</span>
                    }{' '}
                    <span className="text-white font-medium">
                      {COMP_CATEGORIES.find(c => c.key === selectedCategory)?.label}
                    </span>{' '}
                    To <span className="text-white font-medium">{selectedMember?.first_name} {selectedMember?.last_name}</span>
                  </p>
                </div>
                <div className="p-5 space-y-4">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pinCode}
                    onChange={e => { setPinCode(e.target.value.replace(/\D/g, '')); setPinError(''); }}
                    onKeyDown={e => e.key === 'Enter' && verifyPinAndAward()}
                    placeholder="Enter 4-Digit PIN"
                    autoFocus
                    className="w-full px-4 py-4 bg-[#18191A] border border-[#4A4B4C] rounded-xl text-white text-center text-2xl tracking-[0.5em] placeholder:text-[#6A6B6D] placeholder:tracking-normal placeholder:text-base focus:outline-none focus:border-[#1877F2]"
                  />
                  {pinError && (
                    <p className="text-sm text-[#EF4444] text-center">{pinError}</p>
                  )}
                  <div className="flex gap-3">
                    <button onClick={() => { setShowPinModal(false); setPinCode(''); setPinError(''); }}
                      className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-white font-medium active:bg-[#4A4B4C]">
                      Cancel
                    </button>
                    <button onClick={verifyPinAndAward} disabled={verifying || pinCode.length !== 4}
                      className="flex-1 py-3 rounded-xl bg-[#31A24C] text-white font-medium flex items-center justify-center gap-2 disabled:opacity-50 active:bg-[#28883F]">
                      {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                      {verifying ? 'Verifying...' : 'Authorize'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ Void PIN Modal ═══ */}
          {voidPinModal && (
            <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
              <div className="bg-[#242526] rounded-2xl w-full max-w-sm border border-[#3A3B3C] shadow-2xl">
                <div className="p-5 text-center border-b border-[#3A3B3C]">
                  <div className="w-14 h-14 rounded-full bg-[#EF4444]/10 flex items-center justify-center mx-auto mb-3">
                    <X className="w-7 h-7 text-[#EF4444]" />
                  </div>
                  <h3 className="text-lg font-bold text-white">{voidPinModal.actionLabel} Comp</h3>
                  <p className="text-sm text-[#B0B3B8] mt-1">
                    Reverse <span className="text-[#EF4444] font-bold">${Math.abs(voidPinModal.logEntry.amount || 0).toFixed(2)}</span>
                    {' '}<span className="text-white">{(COMP_CATEGORIES.find(c => c.key === voidPinModal.logEntry.comp_category)?.label) || 'Comp'}</span>
                    {' '}From <span className="text-white font-medium">{voidPinModal.logEntry.member_name || 'Member'}</span>
                  </p>
                </div>
                <div className="p-5 space-y-4">
                  <input
                    type="password" inputMode="numeric" maxLength={4}
                    value={voidPinCode}
                    onChange={e => { setVoidPinCode(e.target.value.replace(/\D/g, '')); setVoidPinError(''); }}
                    onKeyDown={e => e.key === 'Enter' && executeVoidComp()}
                    placeholder="Enter 4-Digit PIN"
                    autoFocus
                    className="w-full px-4 py-4 bg-[#18191A] border border-[#4A4B4C] rounded-xl text-white text-center text-2xl tracking-[0.5em] placeholder:text-[#6A6B6D] placeholder:tracking-normal placeholder:text-base focus:outline-none focus:border-[#EF4444]"
                  />
                  {voidPinError && <p className="text-sm text-[#EF4444] text-center">{voidPinError}</p>}
                  <div className="flex gap-3">
                    <button onClick={() => { setVoidPinModal(null); setVoidPinCode(''); setVoidPinError(''); }}
                      className="flex-1 py-3 rounded-xl bg-[#3A3B3C] text-white font-medium active:bg-[#4A4B4C]">Cancel</button>
                    <button onClick={executeVoidComp} disabled={voidLoading || voidPinCode.length !== 4}
                      className="flex-1 py-3 rounded-xl bg-[#EF4444] text-white font-medium flex items-center justify-center gap-2 disabled:opacity-50 active:bg-[#DC2626]">
                      {voidLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                      {voidLoading ? 'Processing...' : voidPinModal.actionLabel}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ Header ═══ */}
          <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold text-white">Comp System</h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#31A24C]/20 text-[#31A24C] font-medium">
                ${autoCompRate}/hr Rake-Back
              </span>
            </div>
            <button onClick={fetchData} className="p-2 rounded-lg active:bg-[#3A3B3C]">
              <RefreshCw className="w-5 h-5 text-[#B0B3B8]" />
            </button>
          </div>

          {/* ═══ Tabs ═══ */}
          <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 flex gap-1 overflow-x-auto">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-3 py-3 text-sm font-medium flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap ${tab === t.key ? 'text-[#1877F2] border-[#1877F2]' : 'text-[#B0B3B8] border-transparent'
                  }`}>
                <t.icon className="w-4 h-4" /> {t.label}
              </button>
            ))}
          </div>

          <div className="p-4 max-w-lg mx-auto">

            {/* ═══════════ DASHBOARD TAB ═══════════ */}
            {tab === 'dashboard' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Today" value={`$${stats.today.toFixed(2)}`} icon={Clock} color="#1877F2" />
                  <StatCard label="This Week" value={`$${stats.week.toFixed(2)}`} icon={TrendingUp} color="#31A24C" />
                  <StatCard label="All Time" value={`$${stats.allTime.toFixed(2)}`} icon={Award} color="#F59E0B" />
                  <StatCard label="Total Comps" value={stats.count} icon={Gift} color="#8B5CF6" />
                </div>

                <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-lg bg-[#31A24C]/10 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-[#31A24C]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Auto Rake-Back Rate</p>
                      <p className="text-xs text-[#B0B3B8]">Players Earn Comps Per Hour Of Play</p>
                    </div>
                  </div>
                  <div className="text-3xl font-bold text-[#31A24C] text-center py-2">
                    ${autoCompRate.toFixed(2)}<span className="text-base text-[#B0B3B8] font-normal">/hour</span>
                  </div>
                  <p className="text-xs text-[#6A6B6D] text-center">Configured In Settings</p>
                </div>

                <div>
                  <p className="text-xs text-[#B0B3B8] uppercase tracking-wider mb-2">Top Comp Balances</p>
                  {loading ? (
                    <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 text-[#1877F2] animate-spin" /></div>
                  ) : topEarners.length === 0 ? (
                    <p className="py-6 text-center text-sm text-[#B0B3B8]">No Comp Balances Yet</p>
                  ) : (
                    <div className="space-y-1">
                      {topEarners.map((m, i) => (
                        <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 bg-[#242526] border border-[#3A3B3C] rounded-xl">
                          <span className="text-xs text-[#6A6B6D] w-5 font-bold">#{i + 1}</span>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-white">{m.first_name} {m.last_name}</p>
                          </div>
                          <span className="text-base font-bold text-[#31A24C]">${(m.comp_balance || 0).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ═══════════ ISSUE COMP TAB ═══════════ */}
            {tab === 'issue' && (
              <div className="space-y-4">
                {/* Error Banner */}
                {awardError && (
                  <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl p-3 flex items-center gap-2">
                    <X className="w-5 h-5 text-[#EF4444] shrink-0" />
                    <p className="text-sm text-[#EF4444] flex-1">{awardError}</p>
                    <button onClick={() => setAwardError('')} className="text-[#EF4444] text-xs underline">Dismiss</button>
                  </div>
                )}

                {awarded ? (
                  <div className="py-12 text-center">
                    <div className="w-20 h-20 rounded-full bg-[#31A24C]/20 flex items-center justify-center mx-auto mb-4">
                      <Check className="w-10 h-10 text-[#31A24C]" />
                    </div>
                    <h2 className="text-2xl font-bold text-white">Comp Issued</h2>
                    <p className="text-[#B0B3B8] mt-2">
                      {lastAwardData?.isMembership
                        ? `${lastAwardData.durationLabel} Free Membership ($${(lastAwardData.amount || 0).toFixed(2)}) To ${selectedMember?.first_name} ${selectedMember?.last_name}`
                        : `$${compAmount} ${COMP_CATEGORIES.find(c => c.key === selectedCategory)?.label} To ${selectedMember?.first_name} ${selectedMember?.last_name}`
                      }
                    </p>
                    {lastAwardData?.newExpires && (
                      <p className="text-xs text-[#8B5CF6] mt-1">Membership Active Through {new Date(lastAwardData.newExpires).toLocaleDateString()}</p>
                    )}
                    <p className="text-xs text-[#31A24C] mt-1">PIN Verified And Documented</p>
                    {lastAwardData && (
                      <p className="text-xs text-[#B0B3B8] mt-1">Authorized By: {lastAwardData.authorizedBy}</p>
                    )}
                    {lastAwardData && (
                      <button onClick={() => printCompReceipt(lastAwardData)}
                        className="mt-4 px-6 py-2 rounded-xl bg-[#3A3B3C] text-white text-sm font-medium active:bg-[#4A4B4C]">
                        Print Receipt Again
                      </button>
                    )}
                  </div>

                ) : !selectedMember ? (
                  <>
                    <p className="text-xs text-[#B0B3B8] uppercase tracking-wider">Step 1: Select Member</p>
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0B3B8]" />
                        <input type="text" value={searchQuery}
                          onChange={e => setSearchQuery(e.target.value)}
                          placeholder="Search By Name Or Phone..."
                          autoFocus
                          className="w-full pl-10 pr-4 py-3 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-[#E4E6EB] placeholder-[#6A6B6D] focus:outline-none focus:border-[#1877F2]" />
                        {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1877F2] animate-spin" />}
                      </div>
                    </div>

                    {searchResults.length > 0 && (
                      <div className="space-y-1">
                        {searchResults.map(m => (
                          <button key={m.id} onClick={() => setSelectedMember(m)}
                            className="w-full px-4 py-3 bg-[#242526] border border-[#3A3B3C] rounded-xl text-left flex items-center gap-3 active:bg-[#2D2E2F]">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${m._is_staff ? 'bg-[#F59E0B]/20' : 'bg-[#1877F2]/20'}`}>
                              <Users className={`w-5 h-5 ${m._is_staff ? 'text-[#F59E0B]' : 'text-[#1877F2]'}`} />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-white">
                                {m._is_staff && <span className="text-[#F59E0B] font-semibold">{(m._staff_role || 'STAFF').toUpperCase()} · </span>}
                                {m.first_name} {m.last_name}
                              </p>
                              <p className="text-xs text-[#B0B3B8]">{m.phone || m.email || m.member_number || ''}</p>
                            </div>
                            <span className="text-sm font-bold text-[#31A24C]">${(m.comp_balance || 0).toFixed(2)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>

                ) : (
                  <>
                    <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4 flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center ${selectedMember._is_staff ? 'bg-[#F59E0B]/20' : 'bg-[#1877F2]/20'}`}>
                        <Users className={`w-6 h-6 ${selectedMember._is_staff ? 'text-[#F59E0B]' : 'text-[#1877F2]'}`} />
                      </div>
                      <div className="flex-1">
                        <p className="text-lg font-bold text-white">
                          {selectedMember.first_name} {selectedMember.last_name}
                          {selectedMember._is_staff && (
                            <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-[#F59E0B]/20 text-[#F59E0B] font-semibold align-middle">
                              {(selectedMember._staff_role || 'STAFF').toUpperCase()}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-[#B0B3B8]">
                          Balance: <span className="text-[#31A24C] font-bold">${(selectedMember.comp_balance || 0).toFixed(2)}</span>
                        </p>
                      </div>
                      <button onClick={resetIssueFlow}
                        className="text-xs text-[#B0B3B8] px-2 py-1 rounded-lg active:bg-[#3A3B3C]">Change</button>
                    </div>

                    {!selectedCategory ? (
                      <>
                        <p className="text-xs text-[#B0B3B8] uppercase tracking-wider">Step 2: Comp Type</p>
                        <div className="grid grid-cols-2 gap-2">
                          {COMP_CATEGORIES.map(cat => {
                            const Icon = cat.icon;
                            return (
                              <button key={cat.key} onClick={() => setSelectedCategory(cat.key)}
                                className="p-4 bg-[#242526] border border-[#3A3B3C] rounded-xl text-left flex flex-col gap-2 active:border-[#1877F2] hover:border-[#4A4B4C] transition-colors">
                                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: cat.color + '20' }}>
                                  <Icon className="w-5 h-5" style={{ color: cat.color }} />
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-white">{cat.label}</p>
                                  <p className="text-[10px] text-[#6A6B6D]">{cat.desc}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-[#B0B3B8] uppercase tracking-wider">
                            {selectedCategory === 'free_membership' ? 'Step 3: Duration' : selectedCategory === 'free_time' ? 'Step 3: Time' : 'Step 3: Amount'}
                          </p>
                          <button onClick={() => { setSelectedCategory(null); setCompAmount(''); setMembershipCost(''); setTimeMinutes(''); }}
                            className="ml-auto text-xs px-2 py-1 rounded-lg flex items-center gap-1 active:bg-[#3A3B3C]"
                            style={{ color: COMP_CATEGORIES.find(c => c.key === selectedCategory)?.color }}>
                            {(() => { const Cat = COMP_CATEGORIES.find(c => c.key === selectedCategory); const Icon = Cat?.icon; return Icon ? <Icon className="w-3 h-3" /> : null; })()}
                            {COMP_CATEGORIES.find(c => c.key === selectedCategory)?.label}
                            <X className="w-3 h-3 ml-1 text-[#6A6B6D]" />
                          </button>
                        </div>

                        {selectedCategory === 'free_membership' ? (
                          /* ── Membership Duration + Cost ── */
                          <>
                            <div className="grid grid-cols-3 gap-2">
                              {MEMBERSHIP_DURATIONS.map(dur => (
                                <button key={dur.key}
                                  onClick={() => {
                                    setCompAmount(dur.key);
                                    // Search ALL plans to find the one with the matching price field
                                    let cost = 0;
                                    for (const plan of membershipPlans) {
                                      const basePrice = parseFloat(plan[dur.priceField]) || 0;
                                      if (basePrice > 0) {
                                        cost = basePrice * dur.multiplier;
                                        break;
                                      }
                                    }
                                    setMembershipCost(cost > 0 ? String(cost.toFixed(2)) : '0.00');
                                  }}
                                  className={`py-3 rounded-xl text-sm font-semibold ${compAmount === dur.key ? 'bg-[#8B5CF6] text-white' : 'bg-[#3A3B3C] text-[#E4E6EB]'}`}>
                                  {dur.label}
                                </button>
                              ))}
                            </div>
                            {compAmount && (
                              <div>
                                <p className="text-xs text-[#B0B3B8] mb-1">Membership Value (Club Expense)</p>
                                <div className="w-full px-4 py-3 bg-[#2D2E2F] border border-[#4A4B4C] rounded-xl text-center">
                                  <span className="text-2xl font-bold text-[#31A24C]">${membershipCost || '0.00'}</span>
                                </div>
                                <p className="text-[10px] text-[#6A6B6D] mt-1 flex items-center justify-center gap-1">
                                  <Shield className="w-3 h-3 text-[#F59E0B]" /> Locked, Pulled From Membership Plan Pricing
                                </p>
                              </div>
                            )}
                          </>
                        ) : selectedCategory === 'free_time' ? (
                          /* ── Time Picker for Free Time ── */
                          <>
                            <div className="grid grid-cols-3 gap-2">
                              {TIME_QUICKPICKS.map(tp => (
                                <button key={tp.key}
                                  onClick={() => {
                                    setTimeMinutes(String(tp.minutes));
                                    const dollarVal = (tp.minutes / 60) * autoCompRate;
                                    setCompAmount(String(dollarVal.toFixed(2)));
                                  }}
                                  className={`py-3 rounded-xl text-sm font-semibold ${timeMinutes === String(tp.minutes) ? 'bg-[#3B82F6] text-white' : 'bg-[#3A3B3C] text-[#E4E6EB]'}`}>
                                  {tp.label}
                                </button>
                              ))}
                            </div>
                            {timeMinutes && (
                              <div>
                                <p className="text-xs text-[#B0B3B8] mb-1">Comp Value (Auto-Calculated)</p>
                                <div className="w-full px-4 py-3 bg-[#2D2E2F] border border-[#4A4B4C] rounded-xl text-center">
                                  <span className="text-2xl font-bold text-[#31A24C]">${compAmount || '0.00'}</span>
                                  <span className="text-sm text-[#6A6B6D] ml-2">({Math.floor(parseInt(timeMinutes) / 60)}h{parseInt(timeMinutes) % 60 > 0 ? ` ${parseInt(timeMinutes) % 60}m` : ''} × ${autoCompRate}/hr)</span>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          /* ── Dollar Amount Picker ── */
                          <>
                            <div className="grid grid-cols-4 gap-2">
                              {QUICK_AMOUNTS.map(amt => (
                                <button key={amt}
                                  onClick={() => setCompAmount(String(amt))}
                                  className={`py-2.5 rounded-xl text-sm font-semibold ${compAmount === String(amt) ? 'bg-[#31A24C] text-white' : 'bg-[#3A3B3C] text-[#E4E6EB]'
                                    }`}>${amt}</button>
                              ))}
                            </div>
                            <input type="number" value={compAmount}
                              onChange={e => setCompAmount(e.target.value)}
                              placeholder="Custom Amount"
                              className="w-full px-4 py-3 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-[#E4E6EB] placeholder-[#6A6B6D] focus:outline-none focus:border-[#1877F2] text-center text-lg" />
                          </>
                        )}

                        {/* Location field - required for Food & Beverage */}
                        {selectedCategory === 'free_food' && (
                          <div>
                            <p className="text-xs text-[#EF4444] mb-1 font-semibold">Location (Required)</p>
                            <input type="text" value={compLocation}
                              onChange={e => setCompLocation(e.target.value)}
                              placeholder="E.g., The Bistro, Main Bar, VIP Lounge..."
                              className="w-full px-4 py-2.5 bg-[#3A3B3C] border border-[#EF4444] rounded-xl text-[#E4E6EB] placeholder-[#6A6B6D] text-sm focus:outline-none focus:border-[#1877F2]" />
                          </div>
                        )}

                        <div>
                          <p className="text-xs text-[#B0B3B8] mb-1">Notes (Optional)</p>
                          <input type="text" value={compNotes}
                            onChange={e => setCompNotes(e.target.value)}
                            placeholder="E.g., Birthday Bonus, 2 Hours Free Table Time..."
                            className="w-full px-4 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-[#E4E6EB] placeholder-[#6A6B6D] text-sm focus:outline-none focus:border-[#1877F2]" />
                        </div>

                        <button onClick={requestComp} disabled={awarding || !compAmount || (selectedCategory === 'free_membership' ? (!membershipCost || parseFloat(membershipCost) <= 0) : selectedCategory === 'free_time' ? !timeMinutes : selectedCategory === 'free_food' ? (!compLocation || !compLocation.trim()) : parseFloat(compAmount) <= 0)}
                          className="w-full py-4 rounded-xl bg-[#31A24C] text-white text-lg font-semibold flex items-center justify-center gap-2 active:bg-[#28883F] disabled:opacity-50">
                          {awarding ? <Loader2 className="w-5 h-5 animate-spin" /> : <Shield className="w-5 h-5" />}
                          {selectedCategory === 'free_membership'
                            ? `Issue ${MEMBERSHIP_DURATIONS.find(d => d.key === compAmount)?.label || 'Membership'} ($${membershipCost || '0'}) - Requires PIN`
                            : selectedCategory === 'free_time'
                              ? `Issue ${(() => { const m = parseInt(timeMinutes || 0); const h = Math.floor(m / 60); const mins = m % 60; return h > 0 ? `${h}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`; })()} ($${compAmount || '0'}) - Requires PIN`
                              : `Issue $${compAmount || '0'} - Requires PIN`}
                        </button>
                        <p className="text-[10px] text-[#6A6B6D] text-center">
                          All Comps Require Staff PIN Verification And Are Fully Documented
                        </p>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ═══════════ COMP LOG TAB ═══════════ */}
            {tab === 'log' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  <button onClick={() => setLogFilter('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${logFilter === 'all' ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'}`}>
                    All
                  </button>
                  {COMP_CATEGORIES.map(cat => (
                    <button key={cat.key} onClick={() => setLogFilter(cat.key)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex items-center gap-1 ${logFilter === cat.key ? 'text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'}`}
                      style={logFilter === cat.key ? { backgroundColor: cat.color } : {}}>
                      {cat.label}
                    </button>
                  ))}
                </div>

                <p className="text-xs text-[#6A6B6D]">{filteredLog.length} Comp Transaction{filteredLog.length !== 1 ? 's' : ''}</p>

                {loading ? (
                  <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 text-[#1877F2] animate-spin" /></div>
                ) : filteredLog.length === 0 ? (
                  <p className="py-10 text-center text-[#B0B3B8]">No Comp Transactions Yet</p>
                ) : (
                  <div className="space-y-1">
                    {filteredLog.slice(0, 50).map((t, i) => {
                      const cat = COMP_CATEGORIES.find(c => c.key === (t.comp_category || 'cash_bonus')) || COMP_CATEGORIES[4];
                      const CatIcon = cat.icon;
                      const isVoidEntry = t.type === 'void';
                      const isVoided = isVoidEntry || compLog.some(v => v.type === 'void' && (v.notes || '').startsWith(`VOID-REF:${t.id} `));
                      const txTime = t.created_at ? new Date(t.created_at) : new Date();
                      const minutesAgo = (Date.now() - txTime.getTime()) / 60000;
                      const voidLabel = minutesAgo <= 15 ? 'Void' : 'Revoke';
                      return (
                        <div key={t.id || i} className={`flex items-center gap-3 px-4 py-3 bg-[#242526] border rounded-xl ${isVoided ? 'border-[#EF4444]/30 opacity-50' : 'border-[#3A3B3C]'}`}>
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: isVoidEntry ? '#EF444420' : cat.color + '20' }}>
                            {isVoidEntry ? <X className="w-4 h-4 text-[#EF4444]" /> : <CatIcon className="w-4 h-4" style={{ color: cat.color }} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${isVoided ? 'text-[#6A6B6D] line-through' : 'text-white'}`}>{t.member_name || 'Member'}</p>
                            <p className="text-[10px] text-[#6A6B6D] truncate">
                              {isVoidEntry ? <span className="text-[#EF4444] font-semibold">VOID - </span> : null}
                              {t.reason || cat.label}
                              {t.authorized_pin && <span className="text-[#31A24C] ml-1">[PIN]</span>}
                            </p>
                            {t.authorized_by && (
                              <p className="text-[10px] text-[#4A4B4C]">By: {t.authorized_by}</p>
                            )}
                            {isVoided && !isVoidEntry && (
                              <p className="text-[10px] text-[#EF4444] font-semibold">VOIDED</p>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            {t.comp_category === 'free_membership' && !isVoidEntry ? (
                              <>
                                <p className={`text-sm font-bold ${isVoided ? 'text-[#6A6B6D] line-through' : 'text-[#8B5CF6]'}`}>
                                  {(t.reason || '').replace(/^Free Membership [\u2014-]\s*/, '').split(/\s[\u2014-]\s/)[0] || 'Membership'}
                                </p>
                                {(t.amount || 0) > 0 && (
                                  <p className={`text-[10px] font-medium ${isVoided ? 'text-[#6A6B6D] line-through' : 'text-[#31A24C]'}`}>${(t.amount || 0).toFixed(2)}</p>
                                )}
                              </>
                            ) : (
                              <p className={`text-sm font-bold ${isVoidEntry ? 'text-[#EF4444]' : (t.amount || 0) > 0 ? (isVoided ? 'text-[#6A6B6D] line-through' : 'text-[#31A24C]') : 'text-[#EF4444]'}`}>
                                {isVoidEntry ? '−' : (t.amount || 0) > 0 ? '+' : ''}${Math.abs(t.amount || 0).toFixed(2)}
                              </p>
                            )}
                            <p className="text-[10px] text-[#6A6B6D]">
                              {t.created_at ? new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                            </p>
                            {!isVoided && !isVoidEntry && (
                              <button onClick={() => voidCompEntry(t)}
                                className={`mt-1 text-[10px] px-2 py-0.5 rounded font-medium ${minutesAgo <= 15 ? 'bg-[#EF4444]/10 text-[#EF4444]' : 'bg-[#F59E0B]/10 text-[#F59E0B]'}`}>
                                {voidLabel}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ═══════════ RATES TAB ═══════════ */}
            {tab === 'rates' && (
              <div className="space-y-4">
                <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-[#31A24C]/10 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-[#31A24C]" />
                    </div>
                    <div>
                      <p className="text-base font-bold text-white">Auto Rake-Back</p>
                      <p className="text-xs text-[#B0B3B8]">Comps Earned Automatically Per Hour Of Play</p>
                    </div>
                  </div>
                  <div className="text-4xl font-bold text-[#31A24C] text-center py-3">
                    ${autoCompRate.toFixed(2)}<span className="text-lg text-[#B0B3B8] font-normal">/hour</span>
                  </div>
                  <p className="text-xs text-[#6A6B6D] text-center mb-3">Applied To All Seated Players. Configure In Settings.</p>
                  <button onClick={() => router.push('/commander/settings')}
                    className="w-full py-2.5 rounded-xl bg-[#3A3B3C] text-white text-sm font-medium active:bg-[#4A4B4C]">
                    Edit Rate In Settings
                  </button>
                </div>

                <div>
                  <p className="text-xs text-[#B0B3B8] uppercase tracking-wider mb-2">Configured Comp Rates</p>
                  {compRates.length > 0 ? (
                    <div className="space-y-2">
                      {compRates.map((r) => (
                        <div key={r.id} className="flex items-center justify-between px-4 py-3 bg-[#242526] border border-[#3A3B3C] rounded-xl">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">{r.name}</p>
                            {Array.isArray(r.game_types) && r.game_types.length > 0 && (
                              <p className="text-[10px] text-[#6A6B6D] truncate">{r.game_types.join(', ')}</p>
                            )}
                          </div>
                          <span className="text-base font-bold text-[#1877F2] whitespace-nowrap">${Number(r.comp_value || 0).toFixed(2)}{r.unit_label ? `/${r.unit_label}` : '/hr'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-6 bg-[#242526] border border-[#3A3B3C] rounded-xl text-center">
                      <p className="text-xs text-[#6A6B6D]">No Custom Comp Rates Configured. The Auto Rake-Back Rate Of ${autoCompRate.toFixed(2)}/hr Applies To All Seated Players.</p>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs text-[#B0B3B8] uppercase tracking-wider mb-2">Manual Comp Categories</p>
                  <div className="space-y-1">
                    {COMP_CATEGORIES.map(cat => {
                      const Icon = cat.icon;
                      return (
                        <div key={cat.key} className="flex items-center gap-3 px-4 py-2.5 bg-[#242526] border border-[#3A3B3C] rounded-xl">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: cat.color + '20' }}>
                            <Icon className="w-4 h-4" style={{ color: cat.color }} />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-white">{cat.label}</p>
                            <p className="text-[10px] text-[#6A6B6D]">{cat.desc}</p>
                          </div>
                          <Shield className="w-3 h-3 text-[#F59E0B]" />
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-[#6A6B6D] text-center mt-2 flex items-center justify-center gap-1">
                    <Shield className="w-3 h-3 text-[#F59E0B]" /> All Manual Comps Require Staff PIN Verification
                  </p>
                </div>
              </div>
            )}

          </div>
        </div>
      </>
    
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

function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" style={{ color }} />
        <span className="text-xs text-[#B0B3B8]">{label}</span>
      </div>
      <p className="text-xl font-bold text-white">{value}</p>
    </div>
  );
}
