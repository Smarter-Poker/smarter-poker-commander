/**
 * Cashier - Texas Club Style
 * /commander/cashier
 * Simple operations with inline action modals:
 * 1. Scan Player Card (QR code)
 * 2. Add Time (adds minutes directly to player's time balance)
 * 3. Update Membership (changes tier + expiry on player)
 * 4. Tournament Registration (backup for long cage lines)
 * 5. Cash Game Buy-In Receipt
 * Collapsible transaction log at bottom
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { busEmit } from '../../src/engine/EventBus';
import { useRouter } from 'next/router';
import Image from 'next/image';
import SEOHead from '../../src/components/seo/SEOHead';
import { QrCode, CreditCard, Loader2, Search, CheckCircle2, AlertTriangle, ChevronDown, Receipt, Lock, Delete, DollarSign, Banknote, Users, Printer } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import useDebounce from '../../src/hooks/useDebounce';
import { getStaffData } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';
import { useConfirmAction } from "../../src/components/commander/shared/ConfirmModal";

const QUICK_AMOUNTS = [50, 100, 200, 300, 500, 1000];
// Fallback time options - overridden by owner settings from Time Billing page
const DEFAULT_TIME_OPTIONS = [
  { label: '1 Hour', minutes: 60 },
  { label: '2 Hours', minutes: 120 },
  { label: '3 Hours', minutes: 180 },
  { label: '4 Hours', minutes: 240 },
  { label: '5 Hr Pack', minutes: 300 },
  { label: '20 Hr Pack', minutes: 1200 },
];
// Fallback tiers - overridden by owner settings from membership-plans
const DEFAULT_MEMBERSHIP_TIERS = [
  { tier: 'daily', label: 'Daily', color: '#22D3EE', duration: 1 },
  { tier: 'weekly', label: 'Weekly', color: '#31A24C', duration: 7 },
  { tier: 'monthly', label: 'Monthly', color: '#F59E0B', duration: 30 },
  { tier: 'yearly', label: 'Yearly', color: '#8B5CF6', duration: 365 },
];

export default function Cashier() {
  const router = useRouter();

  // ── EventBus: Commander session telemetry ──
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-cashier'); }, []);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [venueId, setVenueId] = useState(null);
  const [message, setMessage] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [successOverlay, setSuccessOverlay] = useState(null); // { title, amount, detail, balance }
  const [showRecentTime, setShowRecentTime] = useState(false);
  const [showRecentMembership, setShowRecentMembership] = useState(false);

  // Scanner
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Scanned player
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  // Player Search
  const [showPlayerSearch, setShowPlayerSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const pendingModalRef = useRef(null); // Track which modal to return to after player search

  // Modals
  const [showBuyIn, setShowBuyIn] = useState(false);
  const [showAddTime, setShowAddTime] = useState(false);
  const [showMembership, setShowMembership] = useState(false);
  const [showPlayerHistory, setShowPlayerHistory] = useState(false);
  const [showPrintCard, setShowPrintCard] = useState(false);
  const [playerHistory, setPlayerHistory] = useState([]);
  const [printCardSearchQuery, setPrintCardSearchQuery] = useState('');
  const [printCardSearchResults, setPrintCardSearchResults] = useState([]);
  const [printCardSearchLoading, setPrintCardSearchLoading] = useState(false);
  const [printCardSelectedPlayer, setPrintCardSelectedPlayer] = useState(null);
  const debouncedPrintCardSearchQuery = useDebounce(printCardSearchQuery, 300);
  const [playerHistoryLoading, setPlayerHistoryLoading] = useState(false);

  // Buy-In form
  const [buyInAmount, setBuyInAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');

  // Add Time form
  const [selectedTime, setSelectedTime] = useState(null);

  const [timePayMethod, setTimePayMethod] = useState('cash');
  const [recentTimeTransactions, setRecentTimeTransactions] = useState([]);

  // Membership form
  const [selectedTier, setSelectedTier] = useState(null);
  const [memberPayMethod, setMemberPayMethod] = useState('cash');
  const [recentMemberTransactions, setRecentMemberTransactions] = useState([]);

  // Dynamic pricing from Time Billing settings
  const [timeBillingRate, setTimeBillingRate] = useState(0); // $/hour
  const [bulkTimePackages, setBulkTimePackages] = useState([]); // [{name, hours, price}]
  const [membershipPlans, setMembershipPlans] = useState([]); // from membership-plans API
  // FIX A: when the membership-plans fetch fails (e.g. floor-role terminal whose
  // GET is rejected), do NOT fall back to $0/"Free" tiers - that would let staff
  // sell memberships at $0. Instead we flag pricing as unavailable and block the
  // membership sell until pricing loads / a manager signs in.
  const [pricingUnavailable, setPricingUnavailable] = useState(false);

  // PIN verification
  const [pinStep, setPinStep] = useState(false);
  const [pinDigits, setPinDigits] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);
  const [verifiedStaff, setVerifiedStaff] = useState(null);
  const [pinCacheExpiry, setPinCacheExpiry] = useState(0);
  const [pendingAction, setPendingAction] = useState(null); // 'buyin' | 'addtime' | 'membership'

  const isPinCached = () => verifiedStaff && Date.now() < pinCacheExpiry;
  const lockPin = () => { setVerifiedStaff(null); setPinCacheExpiry(0); };

  useEffect(() => {
    try {
      const s = getStaffData();
      if (s.venue_id) setVenueId(s.venue_id);
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  }, []);

  const fetchData = useCallback(async () => {

    if (!venueId) return;
    setLoading(true);
    try {
const headers = { };

      const today = new Date().toISOString().split('T')[0];
      const txRes = await commanderFetch(`/api/commander/cashier?venue_id=${venueId}&date=${today}&limit=50`, { headers });
      if (!txRes.ok) throw new Error(`Transactions fetch failed (${txRes.status})`);
      const txJson = await txRes.json();
      setTransactions(txJson.data || []);

      // ═══ CRITICAL: Refresh selectedPlayer with fresh member data ═══
      // When other pages (comps, member detail) modify member data and
      // fire broadcastChange('members'), this cashier tab needs to update
      // its selectedPlayer state with the latest values from the server
      setSelectedPlayer(prev => {
        if (!prev?.id || String(prev.id).startsWith('wl-')) return prev;
        // Fire async refresh for the selected player
        commanderFetch(`/api/commander/members/${prev.id}`, {}).then(r => r.json()).then(json => {
          if (json.success && json.data?.member) {
            const m = json.data.member;
            setSelectedPlayer(p => p?.id === m.id ? {
              ...p,
              time_balance_minutes: m.time_balance_minutes || 0,
              comp_balance: m.comp_balance || 0,
              comp_lifetime_earned: m.comp_lifetime_earned || 0,
              membership_tier: m.membership_tier,
              membership_status: m.membership_status,
              membership_expires: m.membership_expires } : p);
          }
        }).catch(e => { console.warn('[App] Handled promise rejection:', e?.message || e); });
        return prev;
      });
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, [venueId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Commander Data Bus - sync cashier transactions + members across tabs
  useCommanderSync(venueId, fetchData, { entities: ['members', 'tables', 'games'] });

  // ═══ URL PARAM HANDLER - auto-open modal from members page shortcuts ═══
  // Supports: ?action=addtime&member=NAME&member_id=UUID
  //           ?action=membership&member=NAME&member_id=UUID
  useEffect(() => {
    if (!router.isReady || !venueId) return;
    const { action, member, member_id } = router.query;
    if (!action || !member_id) return;

    const loadAndOpen = async () => {
      const controller = new AbortController();
      const { signal } = controller;
      try {
const headers = { };
        const json = await commanderFetchJSON(`/api/commander/members/${member_id}?venue_id=${venueId}`, { headers });
        if (json.success && (json.data?.member || json.data)) {
          const m = json.data?.member || json.data;
          const name = member || `${m.first_name || ''} ${m.last_name || ''}`.trim();
          setSelectedPlayer({
            id: m.id,
            player_name: name,
            user_id: m.user_id || m.id,
            membership_tier: m.membership_tier,
            membership_status: m.membership_status,
            membership_expires: m.membership_expires,
            time_balance_minutes: m.time_balance_minutes || 0,
            comp_balance: m.comp_balance || 0,
            comp_lifetime_earned: m.comp_lifetime_earned || 0,
            member_number: m.member_number,
            phone: m.phone });
          if (action === 'addtime') {
            setShowAddTime(true);
          } else if (action === 'membership') {
            setSelectedTier(m.membership_tier || null);
            setShowMembership(true);
          }
        }
      } catch (err) { console.warn('Auto-load member error:', err); }
      // Clear URL params after handling so refresh doesn't re-trigger
      router.replace('/commander/cashier', undefined, { shallow: true });
    };

    // Small delay to let pricing data load first
    setTimeout(loadAndOpen, 300);
  }, [router.isReady, venueId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch owner-configured pricing from Time Billing settings + membership plans
  useEffect(() => {
    if (!venueId) return;
    const loadPricing = async () => {
      const controller = new AbortController();
      const { signal } = controller;
      try {
const headers = { };

        // Time billing settings
        const settingsRes = await commanderFetch('/api/commander/settings', { headers });
        if (!settingsRes.ok) throw new Error(`Settings fetch failed (${settingsRes.status})`);
        const settingsJson = await settingsRes.json();
        if (settingsJson.success && settingsJson.data) {
          setTimeBillingRate(settingsJson.data.time_billing_rate || 0);
          setBulkTimePackages(settingsJson.data.bulk_time_packages || []);
        }

        // Membership plans - FIX A: track load failure so we never sell at $0
        const plansRes = await commanderFetch(`/api/commander/membership-plans?venue_id=${venueId}`, { headers });
        if (!plansRes.ok) { setPricingUnavailable(true); throw new Error(`Plans fetch failed (${plansRes.status})`); }
        const plansJson = await plansRes.json();
        if (plansJson.success && plansJson.data?.plans) {
          setMembershipPlans(plansJson.data.plans.filter(p => p.is_active !== false));
          setPricingUnavailable(false);
        } else {
          setPricingUnavailable(true);
        }
      } catch (err) { console.warn('Pricing load error:', err); setPricingUnavailable(true); }
    };
    loadPricing();
  }, [venueId]);

  // Build dynamic time options from owner settings
  const TIME_OPTIONS = (() => {
    const hourlyOpt = timeBillingRate > 0
      ? [{ label: '1 Hour', minutes: 60, price: Math.round(timeBillingRate) }]
      : [];
    if (bulkTimePackages.length > 0) {
      const pkgOpts = bulkTimePackages.map(pkg => ({
        label: pkg.name || `${pkg.hours} Hr Pack`,
        minutes: (pkg.hours || 0) * 60,
        price: pkg.price || 0 }));
      return [...hourlyOpt, ...pkgOpts];
    }
    return hourlyOpt.length > 0
      ? [...hourlyOpt, ...DEFAULT_TIME_OPTIONS.slice(1).map(opt => ({
        ...opt, price: Math.round(timeBillingRate * (opt.minutes / 60)) }))]
      : DEFAULT_TIME_OPTIONS.map(opt => ({ ...opt, price: 0 }));
  })();

  // Build dynamic membership tiers from owner settings
  const MEMBERSHIP_TIERS = membershipPlans.length > 0
    ? membershipPlans.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map(plan => {
      const priceField = plan.tier === 'daily' ? 'price_daily' : plan.tier === 'weekly' ? 'price_weekly' : plan.tier === 'monthly' ? 'price_monthly' : 'price_yearly';
      const durationMap = { daily: 1, weekly: 7, monthly: 30, yearly: 365 };
      return {
        tier: plan.tier,
        label: plan.name || plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1),
        color: plan.color || '#1877F2',
        duration: durationMap[plan.tier] || 30,
        price: plan[priceField] || 0,
        planId: plan.id };
    })
    : DEFAULT_MEMBERSHIP_TIERS.map(t => ({ ...t, price: 0 }));

  // QR Scanner
  const startScan = async () => {
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      if ('BarcodeDetector' in window) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const scanLoop = async () => {
          if (!streamRef.current || !videoRef.current) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              handleScanResult(barcodes[0].rawValue);
              return;
            }
          } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
          if (streamRef.current) requestAnimationFrame(scanLoop);
        };
        setTimeout(scanLoop, 500);
      }
    } catch (err) {
      console.warn('Camera Error:', err);
      setMessage({ type: 'error', text: 'Camera Access Denied Or Unavailable' });
      setScanning(false);
    }
  };

  const stopScan = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  const handleScanResult = async (qrData) => {
    stopScan();
    const code = (qrData || '').trim();
    if (!code) return;
    try {
      // FIX B: printed club cards encode a qr_code/UUID payload that the free-text
      // ?search= lookup cannot match. Try the dedicated scan endpoint first (matches
      // on qr_code), then fall back to the legacy text search only if it finds nothing.
      const scanRes = await commanderFetch('/api/commander/members/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_code: code, venue_id: venueId })
      });
      if (scanRes.ok) {
        const scanJson = await scanRes.json();
        if (scanJson.success && scanJson.data?.member) {
          selectMember(scanJson.data.member);
          return;
        }
      }
      // Fallback: legacy name/phone/number search
      const res = await commanderFetch(`/api/commander/members?search=${encodeURIComponent(code)}&venue_id=${venueId}`, { headers: {} });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const json = await res.json();
      const members = json.data?.members || json.data || [];
      if (json.success && members.length > 0) {
        const member = members[0];
        selectMember(member);
      } else {
        setMessage({ type: 'error', text: 'Player Not Found, Try Manual Search' });
        setShowPlayerSearch(true);
      }
    } catch {
      setMessage({ type: 'error', text: 'Error Looking Up Player' });
    }
  };

  // Select a member from search results or scan
  const selectMember = (member) => {
    const name = member.name || `${member.first_name || ''} ${member.last_name || ''}`.trim();
    setMessage({ type: 'success', text: `Found: ${name}` });
    setSelectedPlayer({
      id: member.id,
      player_name: name,
      user_id: member.user_id || member.id,
      membership_tier: member.membership_tier,
      membership_status: member.membership_status,
      membership_expires: member.membership_expires,
      time_balance_minutes: member.time_balance_minutes || 0,
      comp_balance: member.comp_balance || 0,
      comp_lifetime_earned: member.comp_lifetime_earned || 0,
      member_number: member.member_number,
      phone: member.phone });
    setShowPlayerSearch(false);
    setSearchQuery('');
    setSearchResults([]);

    // Re-open the modal that initiated the search
    if (pendingModalRef.current === 'buyin') { setShowBuyIn(true); }
    else if (pendingModalRef.current === 'addtime') { setShowAddTime(true); }
    else if (pendingModalRef.current === 'membership') { setSelectedTier(member.membership_tier || null); setShowMembership(true); }
    pendingModalRef.current = null;
  };

  // Manual player search - supports empty query (returns staff + recent members)
  const executeSearch = useCallback(async (query) => {
    setSearchLoading(true);
    try {
const headers = { };
      const params = query ? `q=${encodeURIComponent(query)}&` : '';
      const json = await commanderFetchJSON(`/api/commander/members/search?${params}venue_id=${venueId}&limit=15`, { headers });
      setSearchResults(json.data || []);
    } catch { setSearchResults([]); }
    finally { setSearchLoading(false); }
  }, [venueId]);

  useEffect(() => {
    if (showPlayerSearch && venueId) {
      executeSearch(debouncedSearchQuery);
    }
  }, [debouncedSearchQuery, showPlayerSearch, venueId, executeSearch]);

  const searchPlayers = (query) => {
    setSearchQuery(query);
  };

  // Auto-load staff + recent members when search modal opens
  useEffect(() => {
    if (showPlayerSearch && venueId && searchResults.length === 0 && !searchQuery) {
      executeSearch('');
    }
  }, [showPlayerSearch, venueId, searchResults.length, searchQuery, executeSearch]);

  // Print Card player search - wired to the debounced query (was previously dead)
  useEffect(() => {
    if (!showPrintCard || !venueId) return;
    if (debouncedPrintCardSearchQuery.trim().length < 2) { setPrintCardSearchResults([]); return; }
    let cancelled = false;
    (async () => {
      setPrintCardSearchLoading(true);
      try {
        const json = await commanderFetchJSON(`/api/commander/members/search?q=${encodeURIComponent(debouncedPrintCardSearchQuery.trim())}&venue_id=${venueId}&limit=15`, {});
        if (!cancelled) setPrintCardSearchResults(json.data || []);
      } catch { if (!cancelled) setPrintCardSearchResults([]); }
      finally { if (!cancelled) setPrintCardSearchLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [debouncedPrintCardSearchQuery, showPrintCard, venueId]);

  // === PIN Logic ===
  const requestPinFor = async (action) => {
    if (isPinCached()) {
      await executeAction(action, verifiedStaff);
      return;
    }
    setPendingAction(action);
    setPinDigits('');
    setPinError('');
    setPinStep(true);
  };

  const handlePinDigit = (d) => {
    const next = pinDigits + d;
    setPinDigits(next);
    setPinError('');
    if (next.length === 4) verifyPinAndExecute(next);
  };

  const verifyPinAndExecute = async (digits) => {
    setPinVerifying(true);
    setPinError('');
    try {
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
      const staff = pinJson.data.staff;
      setVerifiedStaff(staff);
      setPinCacheExpiry(Date.now() + 5 * 60 * 1000);
      setPinStep(false);
      // Execute action - catch errors here so user always sees feedback
      try {
        await executeAction(pendingAction, staff);
      } catch (actionErr) {
        console.warn('Action execution error:', actionErr);
        setMessage({ type: 'error', text: 'Transaction Failed, Please Try Again' });
      }
      setPendingAction(null);
    } catch (err) {
      console.warn('PIN verification error:', err);
      // If PIN keypad is still showing, show error there; otherwise show via message
      if (pinStep) {
        setPinError('Network Error, Check Connection');
      } else {
        setMessage({ type: 'error', text: 'Network Error, Check Connection' });
      }
      setPinDigits('');
    }
    setPinVerifying(false);
  };

  // === Execute Actions ===
  const executeAction = async (action, staff) => {
    if (action === 'buyin') await doBuyIn(staff);
    else if (action === 'addtime') await doAddTime(staff);
    else if (action === 'membership') await doUpdateMembership(staff);
    else if (action?.type === 'void') await executeVoid(action.txId, action.voidType, action.details, action.actionLabel, staff);
  };

  // Buy-In Receipt
  const doBuyIn = async (staff) => {
    if (actionLoading) return; // Double-click protection
    if (!buyInAmount || parseFloat(buyInAmount) <= 0) {
      setMessage({ type: 'error', text: 'Enter A Valid Amount' });
      return;
    }
    setActionLoading(true);
    try {
const res = await commanderFetch('/api/commander/cashier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venueId,
          player_name: selectedPlayer?.player_name || 'Walk-Up',
          type: 'buy_in',
          amount: parseFloat(buyInAmount),
          payment_method: payMethod,
          pin_verified_by: staff?.id || null
        })
      });
      if (res.ok) {
        const json = await res.json(); // Parse JSON only if response is OK
        if (json.success) {
          setMessage({ type: 'success', text: `Buy-In Receipt, $${parseFloat(buyInAmount).toLocaleString()}, ${selectedPlayer?.player_name || 'Walk-Up'}` });
          setShowBuyIn(false);
          printReceipt({
            player_name: selectedPlayer?.player_name || 'Walk-Up',
            amount: parseFloat(buyInAmount),
            payment_method: payMethod,
            created_at: new Date().toISOString(),
            staff_name: staff?.display_name || 'Staff'
          });
          playSuccessSound();
          busEmit.celebration('confetti');
          showSuccessPopup({ title: 'Buy-In Recorded', amount: `$${parseFloat(buyInAmount).toLocaleString()}`, detail: selectedPlayer?.player_name || 'Walk-Up' });
          setBuyInAmount(''); // Reset for next transaction
          fetchData();
          broadcastChange('members');
        } else {
          setMessage({ type: 'error', text: json.error || 'Transaction Failed' });
        }
      } else {
        const json = await res.json(); // Attempt to parse error message from response body
        setMessage({ type: 'error', text: json.error || 'Transaction Failed' });
      }
    } catch (err) { console.warn('Buy-in error:', err); setMessage({ type: 'error', text: 'Buy-In Failed, Please Try Again' }); }
    finally { setActionLoading(false); }
  };

  // Calculate time price
  const getTimePrice = () => {
    if (selectedTime) {
      const opt = TIME_OPTIONS.find(o => o.minutes === selectedTime);
      return opt?.price || 0;
    }
    return 0;
  };

  // Add Time to Player
  const doAddTime = async (staff) => {
    if (actionLoading) return; // Double-click protection
    const mins = selectedTime || 0;
    if (mins <= 0) { setMessage({ type: 'error', text: 'Select A Time Amount' }); return; }
    if (!selectedPlayer?.id) { setMessage({ type: 'error', text: 'Select A Player First' }); return; }
    if (String(selectedPlayer.id).startsWith('wl-')) { setMessage({ type: 'error', text: 'This Player Is On The Waitlist Only, Register Them As A Member First' }); return; }
    const price = getTimePrice();
    const timeOpt = TIME_OPTIONS.find(o => o.minutes === mins);
    const timeLabel2 = timeOpt?.label || `${mins} min`;
    setActionLoading(true);
    try {
const headers = { 'Content-Type': 'application/json' };
      const newBalance = (selectedPlayer.time_balance_minutes || 0) + mins;

      // 1. Update member time balance
      const res = await commanderFetch(`/api/commander/members/${selectedPlayer.id}`, {
        method: 'PUT', headers, body: JSON.stringify({ time_balance_minutes: newBalance })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (!json.success) { setMessage({ type: 'error', text: json.error || 'Failed To Add Time' }); setActionLoading(false); return; }

      // 2. Record transaction (type: time_purchase, NOT buy_in)
      const txRes = await commanderFetch('/api/commander/cashier', {
        method: 'POST', headers,
        body: JSON.stringify({
          venue_id: venueId,
          player_name: selectedPlayer.player_name,
          type: 'time_purchase',
          amount: price,
          payment_method: timePayMethod,
          notes: `Time Purchase: ${mins} minutes (${timeLabel2})`,
          pin_verified_by: staff?.id || null
        })
      });
      if (!txRes.ok) throw new Error('Request failed');
      const txJson = await txRes.json();
      if (!txJson.success) console.warn('Time transaction record failed:', txJson.error);

      const hours = Math.floor(mins / 60);
      if (res.ok) {
        const remainMins = mins % 60;
        const timeLabel = hours > 0 ? `${hours}h ${remainMins > 0 ? remainMins + 'm' : ''}` : `${mins}m`;
        setMessage({ type: txJson.success ? 'success' : 'warning', text: `Added ${timeLabel}, $${price}, ${selectedPlayer.player_name}${!txJson.success ? ' (Receipt Not Saved)' : ''}` });
        setSelectedPlayer(prev => ({ ...prev, time_balance_minutes: newBalance }));
        setShowAddTime(false);
        playSuccessSound();
        busEmit.celebration('confetti');
        const newHrs = Math.floor(newBalance / 60); const newRm = newBalance % 60;
        showSuccessPopup({ title: 'Time Added', amount: `$${price}`, detail: `${timeLabel} → ${selectedPlayer.player_name}`, balance: `New Balance: ${newHrs}h ${newRm > 0 ? newRm + 'm' : ''}` });
        fetchData();
        broadcastChange('members');

        // 3. Auto-print receipt
        printTimeReceipt({
          player_name: selectedPlayer.player_name,
          minutes: mins,
          timeLabel,
          amount: price,
          payment_method: timePayMethod,
          new_balance_minutes: newBalance,
          staff_name: staff?.display_name || 'Staff',
          transaction_id: txJson?.data?.id || null });
      } else {
        setMessage({ type: 'error', text: 'Failed To Update Time Balance' });
      }
    } catch (err) { console.warn('Add time error:', err); setMessage({ type: 'error', text: 'Add Time Failed, Please Try Again' }); }
    finally { setActionLoading(false); }
  };

  // Update Membership
  const doUpdateMembership = async (staff) => {
    if (actionLoading) return; // Double-click protection
    // FIX A: refuse to sell membership when pricing failed to load - otherwise the
    // $0 fallback tiers would let a membership be sold for free.
    if (pricingUnavailable) { setMessage({ type: 'error', text: 'Pricing Unavailable, Manager Sign-In Required' }); return; }
    if (!selectedTier) { setMessage({ type: 'error', text: 'Select A Membership Tier' }); return; }
    if (!selectedPlayer?.id) { setMessage({ type: 'error', text: 'Select A Player First' }); return; }
    if (String(selectedPlayer.id).startsWith('wl-')) { setMessage({ type: 'error', text: 'This Player Is On The Waitlist Only, Register Them As A Member First' }); return; }
    const tierInfo = MEMBERSHIP_TIERS.find(t => t.tier === selectedTier);
    const price = tierInfo?.price || 0;
    setActionLoading(true);
    try {
const headers = { 'Content-Type': 'application/json' };
      const expires = new Date();
      expires.setDate(expires.getDate() + (tierInfo?.duration || 1));

      // 1. Update member tier
      const res = await commanderFetch(`/api/commander/members/${selectedPlayer.id}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ membership_tier: selectedTier, membership_status: 'active', membership_expires: expires.toISOString() })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (!json.success) { setMessage({ type: 'error', text: json.error || 'Failed To Update Membership' }); setActionLoading(false); return; }

      // 2. Record transaction (type: membership, NOT buy_in)
      const txRes = await commanderFetch('/api/commander/cashier', {
        method: 'POST', headers,
        body: JSON.stringify({
          venue_id: venueId,
          player_name: selectedPlayer.player_name,
          type: 'membership',
          amount: price,
          payment_method: memberPayMethod,
          notes: `Membership: ${tierInfo?.label} (Expires ${expires.toLocaleDateString()})`,
          pin_verified_by: staff?.id || null
        })
      });
      if (!txRes.ok) throw new Error('Request failed');
      const txJson = await txRes.json();
      if (!txJson.success) console.warn('Membership transaction record failed:', txJson.error);

      if (res.ok) {
        setMessage({ type: txJson.success ? 'success' : 'warning', text: `${tierInfo?.label} Membership, $${price}, ${selectedPlayer.player_name}${!txJson.success ? ' (Receipt Not Saved)' : ''}` });
        setSelectedPlayer(prev => ({ ...prev, membership_tier: selectedTier, membership_status: 'active', membership_expires: expires.toISOString() }));
        setShowMembership(false);
        playSuccessSound();
        busEmit.celebration('confetti');
        showSuccessPopup({ title: 'Membership Updated', amount: `$${price}`, detail: `${tierInfo?.label} Membership → ${selectedPlayer.player_name}`, balance: `Expires: ${expires.toLocaleDateString()}` });
        fetchData();
        broadcastChange('members');

        // 3. Auto-print receipt
        printMembershipReceipt({
          player_name: selectedPlayer.player_name,
          tier: tierInfo?.label,
          amount: price,
          payment_method: memberPayMethod,
          expires: expires.toLocaleDateString(),
          staff_name: staff?.display_name || 'Staff',
          transaction_id: txJson?.data?.id || null });
      } else {
        setMessage({ type: 'error', text: 'Failed To Update Membership' });
      }
    } catch (err) { console.warn('Membership update error:', err); setMessage({ type: 'error', text: 'Membership Update Failed, Please Try Again' }); }
    finally { setActionLoading(false); }
  };

  // Void or Refund a transaction
  const voidTransaction = async (txId, type, details) => {
    const txTime = details.created_at ? new Date(details.created_at) : new Date();
    const minutesAgo = (Date.now() - txTime.getTime()) / 60000;
    const isVoid = minutesAgo <= 15;
    const actionLabel = isVoid ? 'Void' : 'Refund';

    // Require PIN for all voids/refunds
    if (!isPinCached()) {
      setPendingAction({ type: 'void', txId, voidType: type, details, actionLabel });
      setPinStep(true);
      setPinDigits('');
      setPinError('');
      return;
    }
    await executeVoid(txId, type, details, actionLabel, verifiedStaff);
  };

  const executeVoid = async (txId, type, details, actionLabel, staff) => {
    if (actionLoading) return; // Double-click protection
    if (!confirm(`${actionLabel} This ${type} Transaction For $${details.amount}?`)) return;
    setActionLoading(true);
    try {
const headers = { 'Content-Type': 'application/json' };
      const voidAmount = details.amount || 0;

      // 1. ALWAYS record the void/refund transaction (even for $0 - creates audit trail)
      const voidRes = await commanderFetch('/api/commander/cashier', {
        method: 'POST', headers,
        body: JSON.stringify({
          venue_id: venueId,
          player_name: details.player_name || 'Unknown',
          type: 'void',
          amount: voidAmount,
          payment_method: details.payment_method || 'cash',
          notes: `${actionLabel.toUpperCase()} - TX #${txId}: ${details.notes || type} [By ${staff?.display_name || 'Staff'}]`,
          pin_verified_by: staff?.id || null
        })
      });
      if (!voidRes.ok) throw new Error('Request failed');
      const voidJson = await voidRes.json();
      if (!voidJson.success) console.warn('Void transaction record failed:', voidJson.error);

      // 2. Mark the ORIGINAL transaction as voided (audit trail)
      const patchRes = await commanderFetch('/api/commander/cashier', {
        method: 'PATCH', headers,
        body: JSON.stringify({
          transaction_id: txId,
          voided_by: staff?.id || null,
          void_reason: `${actionLabel} By ${staff?.display_name || 'Staff'} - ${type}`
        })
      });
      const patchJson = await patchRes.json().catch(() => ({}));
      if (!patchRes.ok && patchJson.error !== 'Transaction already voided') throw new Error('Request failed');
      if (!patchJson.success) {
        // Handle already-voided gracefully
        if (patchJson.error === 'Transaction already voided') {
          setMessage({ type: 'error', text: 'Transaction Already Voided, Cannot Void Again' });
          setActionLoading(false);
          fetchData();
          return;
        }
      }

      // 3. Resolve the member to update - use selectedPlayer if name matches, otherwise lookup by name
      let memberId = null;
      let memberBalance = null;
      if (selectedPlayer?.id && selectedPlayer.player_name === details.player_name) {
        memberId = selectedPlayer.id;
        memberBalance = selectedPlayer.time_balance_minutes || 0;
      } else if (details.player_name && details.player_name !== 'Unknown') {
        // Lookup member by name for balance correction
        try {
          const searchRes = await commanderFetch(`/api/commander/members/search?q=${encodeURIComponent(details.player_name)}&venue_id=${venueId}&limit=1`, { headers });
          if (!searchRes.ok) throw new Error(`Request failed (${searchRes.status})`);
          const searchJson = await searchRes.json();
          const match = (searchJson.data || []).find(m => {
            const mName = m.name || `${m.first_name || ''} ${m.last_name || ''}`.trim();
            return mName.toLowerCase() === details.player_name.toLowerCase();
          });
          if (match) {
            memberId = match.id;
            memberBalance = match.time_balance_minutes || 0;
          }
        } catch { /* search failed - still record the void but can't update balance */ }
      }

      if (type === 'time' && memberId && details.minutes) {
        const newBal = Math.max(0, (memberBalance || 0) - details.minutes);
        const tRes = await commanderFetch(`/api/commander/members/${memberId}`, {
          method: 'PUT', headers,
          body: JSON.stringify({ time_balance_minutes: newBal })
        });
        if (tRes.ok && selectedPlayer?.id === memberId) {
          setSelectedPlayer(prev => ({ ...prev, time_balance_minutes: newBal }));
        }
      }

      // 5. If membership void, revert membership to none
      if (type === 'membership' && memberId) {
        const mRes = await commanderFetch(`/api/commander/members/${memberId}`, {
          method: 'PUT', headers,
          body: JSON.stringify({ membership_tier: null, membership_status: 'expired', membership_expires: new Date().toISOString() })
        });
        if (mRes.ok && selectedPlayer?.id === memberId) {
          setSelectedPlayer(prev => ({ ...prev, membership_tier: null, membership_status: 'expired', membership_expires: null }));
        }
      }

      if (patchRes.ok) {
        setMessage({ type: 'success', text: `${actionLabel} Processed, $${details.amount}` });
        playSuccessSound();
        showSuccessPopup({ title: `${actionLabel} Processed`, amount: `$${details.amount}`, detail: details.player_name || 'Unknown' });
        fetchData();
        broadcastChange('members');
      } else {
        setMessage({ type: 'error', text: `${actionLabel} Failed, Server Error` });
      }
    } catch (err) { console.warn('Void error:', err); setMessage({ type: 'error', text: `${actionLabel} Failed, Please Try Again` }); }
    finally { setActionLoading(false); }
  };

  // Ka-ching cash register sound - loud and unmistakable
  const playSuccessSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Tone 1: bright ascending chime
      const o1 = ctx.createOscillator(); const g1 = ctx.createGain();
      o1.type = 'triangle'; o1.connect(g1); g1.connect(ctx.destination);
      o1.frequency.setValueAtTime(1200, ctx.currentTime);
      o1.frequency.setValueAtTime(1600, ctx.currentTime + 0.08);
      g1.gain.setValueAtTime(0.6, ctx.currentTime);
      g1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      o1.start(ctx.currentTime); o1.stop(ctx.currentTime + 0.15);
      // Tone 2: confirmation bell
      const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
      o2.type = 'sine'; o2.connect(g2); g2.connect(ctx.destination);
      o2.frequency.setValueAtTime(1800, ctx.currentTime + 0.12);
      g2.gain.setValueAtTime(0.5, ctx.currentTime + 0.12);
      g2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      o2.start(ctx.currentTime + 0.12); o2.stop(ctx.currentTime + 0.5);
      // Tone 3: resonant finish
      const o3 = ctx.createOscillator(); const g3 = ctx.createGain();
      o3.type = 'sine'; o3.connect(g3); g3.connect(ctx.destination);
      o3.frequency.setValueAtTime(2400, ctx.currentTime + 0.25);
      g3.gain.setValueAtTime(0.4, ctx.currentTime + 0.25);
      g3.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.7);
      o3.start(ctx.currentTime + 0.25); o3.stop(ctx.currentTime + 0.7);
      // Close AudioContext after sounds finish to prevent memory leak
      setTimeout(() => { try { ctx.close(); } catch (e) { console.warn('[App] Handled exception:', e?.message || e); } }, 1000);
    } catch { /* audio not available */ }
  };

  // Show full-screen success overlay
  const showSuccessPopup = ({ title, amount, detail, balance }) => {
    setSuccessOverlay({ title, amount, detail, balance });
    setTimeout(() => {
      setSuccessOverlay(null);
    }, 3500);
  };

  // Load player transaction history
  const loadPlayerHistory = async () => {
    if (!selectedPlayer?.player_name) return;
    setPlayerHistoryLoading(true);
    setShowPlayerHistory(true);
    try {
const headers = { };
      // Use server-side player_name filter for efficiency
      const res = await commanderFetch(`/api/commander/cashier?venue_id=${venueId}&player_name=${encodeURIComponent(selectedPlayer.player_name)}&limit=100`, { headers });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      setPlayerHistory(json.data || []);
    } catch { setPlayerHistory([]); }
    finally { setPlayerHistoryLoading(false); }
  };

  useEffect(() => {
    if (message) { const t = setTimeout(() => setMessage(null), 5000); return () => clearTimeout(t); }
  }, [message]);

  useEffect(() => () => { if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); }, []);

  const printReceipt = (tx) => {
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) return;
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
  <div class="center sm">Cash Game Buy-In Receipt</div>
  <div class="divider"></div>
  <div class="center bold med">BUY-IN</div>
  <div class="divider"></div>
  <div class="row sm"><span>Player:</span><span class="bold">${tx.player_name}</span></div>
  ${tx.staff_name ? `<div class="row sm"><span>Processed By:</span><span class="bold">${tx.staff_name}</span></div>` : ''}
  <div class="divider"></div>
  <div class="center bold big">$${parseFloat(tx.amount).toLocaleString()}</div>
  <div class="center sm">${(tx.payment_method || 'Cash').toUpperCase()}</div>
  <div class="divider"></div>
  <div class="sm center" style="opacity:0.6">${new Date(tx.created_at || Date.now()).toLocaleString()}</div>
  <div class="sm center" style="opacity:0.4;margin-top:1mm">Smarter.Poker</div>
</div></body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
  };

  // Print Time Purchase Receipt
  const printTimeReceipt = (tx) => {
    const w = window.open('', '_blank', 'width=400,height=600');
    if (!w) return;
    const balH = Math.floor((tx.new_balance_minutes || 0) / 60);
    const balM = (tx.new_balance_minutes || 0) % 60;
    w.document.write(`<!DOCTYPE html><html><head><title>Time Receipt</title>
<style>@page{margin:0;size:80mm auto}body{font-family:'Courier New',monospace;margin:0;padding:0}.r{width:72mm;padding:4mm;margin:0 auto}.c{text-align:center}.b{font-weight:bold}.big{font-size:24px}.med{font-size:14px}.sm{font-size:11px}.d{border-top:1px dashed #000;margin:3mm 0}.row{display:flex;justify-content:space-between}</style></head><body>
<div class="r">
  <div class="c b med">SMARTER.POKER</div>
  <div class="c sm">Time Purchase Receipt</div>
  <div class="d"></div>
  <div class="c b med">TIME ADDED</div>
  <div class="d"></div>
  <div class="row sm"><span>Player:</span><span class="b">${tx.player_name}</span></div>
  <div class="row sm"><span>Time Added:</span><span class="b">${tx.timeLabel}</span></div>
  <div class="row sm"><span>New Balance:</span><span class="b">${balH}h ${balM}m</span></div>
  ${tx.staff_name ? `<div class="row sm"><span>Processed By:</span><span class="b">${tx.staff_name}</span></div>` : ''}
  <div class="d"></div>
  <div class="c b big">$${tx.amount.toLocaleString()}</div>
  <div class="c sm">${(tx.payment_method || 'Cash').toUpperCase()}</div>
  <div class="d"></div>
  <div class="sm c" style="opacity:0.6">${new Date().toLocaleString()}</div>
  <div class="sm c" style="opacity:0.4;margin-top:1mm">Smarter.Poker</div>
</div></body></html>`);
    w.document.close();
    setTimeout(() => { w.print(); w.close(); }, 500);
  };

  // Print Membership Receipt
  const printMembershipReceipt = (tx) => {
    const w = window.open('', '_blank', 'width=400,height=600');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>Membership Receipt</title>
<style>@page{margin:0;size:80mm auto}body{font-family:'Courier New',monospace;margin:0;padding:0}.r{width:72mm;padding:4mm;margin:0 auto}.c{text-align:center}.b{font-weight:bold}.big{font-size:24px}.med{font-size:14px}.sm{font-size:11px}.d{border-top:1px dashed #000;margin:3mm 0}.row{display:flex;justify-content:space-between}</style></head><body>
<div class="r">
  <div class="c b med">SMARTER.POKER</div>
  <div class="c sm">Membership Receipt</div>
  <div class="d"></div>
  <div class="c b med">MEMBERSHIP</div>
  <div class="d"></div>
  <div class="row sm"><span>Player:</span><span class="b">${tx.player_name}</span></div>
  <div class="row sm"><span>Tier:</span><span class="b">${tx.tier}</span></div>
  <div class="row sm"><span>Expires:</span><span class="b">${tx.expires}</span></div>
  ${tx.staff_name ? `<div class="row sm"><span>Processed By:</span><span class="b">${tx.staff_name}</span></div>` : ''}
  <div class="d"></div>
  <div class="c b big">$${tx.amount.toLocaleString()}</div>
  <div class="c sm">${(tx.payment_method || 'Cash').toUpperCase()}</div>
  <div class="d"></div>
  <div class="sm c" style="opacity:0.6">${new Date().toLocaleString()}</div>
  <div class="sm c" style="opacity:0.4;margin-top:1mm">Smarter.Poker</div>
</div></body></html>`);
    w.document.close();
    setTimeout(() => { w.print(); w.close(); }, 500);
  };

  // PIN Keypad Component
  const PinKeypad = () => (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center" onClick={() => setPinStep(false)}>
      <div className="bg-[#242526] w-full max-w-xs rounded-2xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 justify-center mb-3">
          <Lock className="w-4 h-4 text-[#F59E0B]" />
          <span className="text-sm font-bold text-white">Enter Employee PIN</span>
        </div>
        <div className="flex justify-center gap-3 mb-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`w-4 h-4 rounded-full border-2 ${i < pinDigits.length ? 'bg-[#1877F2] border-[#1877F2]' : 'border-[#4A4B4C]'}`} />
          ))}
        </div>
        {pinError && <p className="text-xs text-[#EF4444] text-center mb-2">{pinError}</p>}
        {pinVerifying ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 text-[#1877F2] animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
              <button key={d} onClick={() => handlePinDigit(String(d))}
                className="py-3 rounded-xl bg-[#3A3B3C] text-white text-lg font-bold active:bg-[#4A4B4C]">{d}</button>
            ))}
            <button onClick={() => setPinStep(false)}
              className="py-3 rounded-xl bg-[#EF4444]/10 text-[#EF4444] text-xs font-bold">Cancel</button>
            <button onClick={() => handlePinDigit('0')}
              className="py-3 rounded-xl bg-[#3A3B3C] text-white text-lg font-bold active:bg-[#4A4B4C]">0</button>
            <button onClick={() => { setPinDigits(pinDigits.slice(0, -1)); setPinError(''); }}
              className="py-3 rounded-xl bg-[#3A3B3C] text-[#B0B3B8] flex items-center justify-center active:bg-[#4A4B4C]">
              <Delete className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // PIN-gated submit button
  const PinSubmitButton = ({ action, label, color = '#31A24C', disabled = false }) => (
    <>
      {isPinCached() && (
        <div className="flex items-center justify-between p-2 rounded-lg bg-[#31A24C]/10 mb-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#31A24C]" />
            <span className="text-xs text-[#31A24C] font-medium">Verified As {verifiedStaff?.display_name}</span>
          </div>
          <button onClick={lockPin} className="text-xs text-[#B0B3B8] flex items-center gap-1">
            <Lock className="w-3 h-3" /> Lock
          </button>
        </div>
      )}
      <button onClick={() => requestPinFor(action)} disabled={actionLoading || disabled}
        className="w-full py-3.5 rounded-xl text-base font-bold flex items-center justify-center gap-2 text-white active:opacity-80 disabled:opacity-50"
        style={{ backgroundColor: color }}>
        {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
          !isPinCached() && <Lock className="w-4 h-4 mr-1" />
        )}
        {label}
      </button>
    </>
  );

  return (
    <CommanderLayout title="Cashier" backHref="/commander/dashboard">
      <SEOHead title="Commander - Cashier" description="Club Commander Poker Room Management Tool." noindex={true} />
      <div className="min-h-screen bg-black text-[#E4E6EB] font-['Inter']">

        {/* === SUCCESS OVERLAY - fullscreen popup === */}
        {successOverlay && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90" style={{ animation: 'fadeIn 0.2s ease-out' }}>
            <div className="bg-[#242526] rounded-2xl px-10 py-8 text-center border border-[#3A3B3C] shadow-2xl" style={{ animation: 'scaleIn 0.3s ease-out', minWidth: '320px' }}>
              <div className="w-24 h-24 rounded-full bg-[#31A24C]/20 flex items-center justify-center mx-auto mb-5" style={{ animation: 'pulse 1s ease-in-out infinite' }}>
                <CheckCircle2 className="w-14 h-14 text-[#31A24C]" />
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
        <style>{`
          @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes scaleIn { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        `}</style>

        {/* Message Toast */}
        {message && (
          <div className={`mx-4 mt-3 px-4 py-3 rounded-xl flex items-center gap-2 text-sm font-medium ${message.type === 'success' ? 'bg-[#31A24C]/15 text-[#31A24C]' : 'bg-[#EF4444]/15 text-[#EF4444]'}`}>
            {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            {message.text}
          </div>
        )}

        {/* Player info is shown inside each modal - no top-of-page banner */}

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" /></div>
        ) : (
          <div className="px-2 py-2">

            {/* Camera view - shown above panel when scanning */}
            {scanning && (
              <div className="mx-2 mb-2 rounded-2xl overflow-hidden border-2 border-[#3A3B3C] bg-black relative">
                <video ref={videoRef} className="w-full aspect-[4/3] object-cover" playsInline muted />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-48 border-2 border-white/30 rounded-2xl" />
                </div>
                <button onClick={stopScan}
                  className="absolute top-3 right-3 bg-[#EF4444] text-white px-4 py-2 rounded-xl text-sm font-bold z-10">
                  Stop Scanning
                </button>
              </div>
            )}

            {/* ═══ PLAYER SEARCH / SCAN MODAL ═══ */}
            {showPlayerSearch && (
              <div className="fixed inset-0 bg-black/90 z-50 flex flex-col" onClick={() => { setShowPlayerSearch(false); setSearchQuery(''); setSearchResults([]); }}>
                <div className="bg-[#242526] w-full h-full overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">Find Player</h3>
                    <button onClick={() => { setShowPlayerSearch(false); setSearchQuery(''); setSearchResults([]); }} className="text-[#B0B3B8] text-2xl leading-none">&times;</button>
                  </div>

                  {/* Scan Button */}
                  <button
                    onClick={() => { setShowPlayerSearch(false); startScan(); }}
                    className="w-full bg-[#1877F2] text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 mb-4"
                  >
                    <QrCode className="w-5 h-5" /> Scan Player Card (QR Code)
                  </button>

                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex-1 h-px bg-[#3A3B3C]" />
                    <span className="text-xs text-[#B0B3B8] font-medium">OR SEARCH MANUALLY</span>
                    <div className="flex-1 h-px bg-[#3A3B3C]" />
                  </div>

                  {/* Search Input */}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#B0B3B8]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => searchPlayers(e.target.value)}
                      placeholder="Search By Name Or Phone..."
                      autoFocus
                      className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl pl-10 pr-4 py-3 text-white text-base font-medium outline-none focus:border-[#1877F2] placeholder:text-[#666]"
                    />
                    {searchLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1877F2] animate-spin" />}
                  </div>

                  {/* Search Results */}
                  {searchResults.length > 0 && (
                    <div className="space-y-2">
                      {searchResults.map(m => {
                        const name = m.name || `${m.first_name || ''} ${m.last_name || ''}`.trim();
                        return (
                          <button key={m.id} onClick={() => selectMember(m)}
                            className="w-full bg-[#3A3B3C]/50 border border-[#4A4B4C] rounded-xl p-3 flex items-center gap-3 text-left active:bg-[#4A4B4C]">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${m._is_staff ? 'bg-[#F59E0B]/20' : 'bg-[#1877F2]/20'}`}>
                              <span className={`text-sm font-bold ${m._is_staff ? 'text-[#F59E0B]' : 'text-[#1877F2]'}`}>{(name[0] || '?').toUpperCase()}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-white truncate">{name || 'Unknown'}</p>
                              <p className="text-[10px] text-[#B0B3B8]">
                                {m._is_staff && <span className="text-[#F59E0B] font-semibold">{(m._staff_role || 'staff').toUpperCase()} • </span>}
                                {m.phone || 'No Phone'}
                                {m.membership_tier && ` • ${m.membership_tier.charAt(0).toUpperCase() + m.membership_tier.slice(1)} Member`}
                              </p>
                            </div>
                            <ChevronDown className="w-4 h-4 text-[#B0B3B8] -rotate-90 shrink-0" />
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {searchQuery.length >= 2 && searchResults.length === 0 && !searchLoading && (
                    <div className="text-center py-6">
                      <p className="text-sm text-[#B0B3B8]">No Players Found For &quot;{searchQuery}&quot;</p>
                    </div>
                  )}

                  {searchResults.length === 0 && !searchQuery && !searchLoading && (
                    <div className="text-center py-6">
                      <Loader2 className="w-5 h-5 text-[#1877F2] animate-spin mx-auto mb-2" />
                      <p className="text-sm text-[#B0B3B8]">Loading...</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ═══ METAL PANEL IMAGE WITH CLICKABLE HOTSPOTS ═══ */}
            <div style={{ position: 'relative', width: '100%', margin: '0 auto' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <Image src="/images/commander/cashier-panel.jpg" alt="Cashier Panel" width={1040} height={992} style={{ width: '100%', height: 'auto', display: 'block', userSelect: 'none', pointerEvents: 'none' }} />

              {/* Hotspot 1: Scan Player Card / Search */}
              <button
                onClick={() => {
                  if (scanning) { stopScan(); } else { setShowPlayerSearch(true); }
                }}
                style={{
                  position: 'absolute', top: '12%', left: '8%', width: '84%', height: '12.5%',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  borderRadius: 8 }}
                aria-label="Scan Player Card"
              />

              {/* Hotspot 2: Add Time To Player's Balance */}
              <button
                onClick={() => {
                  setSelectedTime(null); setShowAddTime(true);
                }}
                style={{
                  position: 'absolute', top: '26%', left: '8%', width: '84%', height: '12.5%',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  borderRadius: 8 }}
                aria-label="Add Time To Player Balance"
              />

              {/* Hotspot 3: Update Membership */}
              <button
                onClick={() => {
                  setSelectedTier(selectedPlayer?.membership_tier || null); setShowMembership(true);
                }}
                style={{
                  position: 'absolute', top: '40%', left: '8%', width: '84%', height: '12.5%',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  borderRadius: 8 }}
                aria-label="Update Membership"
              />

              {/* Hotspot 4: Tournament Registration */}
              <button
                onClick={() => router.push('/commander/tournament-registration')}
                style={{
                  position: 'absolute', top: '54%', left: '8%', width: '84%', height: '12.5%',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  borderRadius: 8 }}
                aria-label="Tournament Registration"
              />

              {/* Hotspot 5: Cash Game Buy-In Receipt */}
              <button
                onClick={() => { setBuyInAmount(''); setPayMethod('cash'); setShowBuyIn(true); }}
                style={{
                  position: 'absolute', top: '68%', left: '8%', width: '84%', height: '12.5%',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  borderRadius: 8 }}
                aria-label="Cash Game Buy-In Receipt"
              />

              {/* Hotspot 6: Transaction Log */}
              <button
                onClick={() => setShowLog(!showLog)}
                style={{
                  position: 'absolute', top: '82%', left: '8%', width: '84%', height: '12%',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  borderRadius: 8 }}
                aria-label="Transaction Log"
              />
            </div>

            {/* Transaction Log - rendered below metal panel */}
            {showLog && (
              <div className="mx-2 mt-2">
                {transactions.length > 0 && (
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-[#B0B3B8] font-semibold">{transactions.length} Transactions Today</p>
                    <button onClick={() => {
                      if (transactions.length > 0) printReceipt(transactions[0]);
                    }} className="text-[10px] text-[#1877F2] font-semibold px-2 py-1 rounded-lg bg-[#1877F2]/15 flex items-center gap-1">
                      <Receipt className="w-3 h-3" /> Print Last
                    </button>
                  </div>
                )}
                {transactions.length > 0 ? (
                  <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl overflow-hidden max-h-72 overflow-y-auto divide-y divide-[#3A3B3C]">
                    {transactions.slice(0, 50).map(tx => {
                      const txTime = new Date(tx.created_at);
                      const minsAgo = (Date.now() - txTime.getTime()) / 60000;
                      const isVoidable = minsAgo <= 15;
                      const isVoidTx = !!tx.voided_at || tx.type === 'void' || (tx.notes || '').includes('VOID') || (tx.notes || '').includes('REFUND');
                      return (
                        <div key={tx.id} className="px-4 py-2.5 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center ${isVoidTx ? 'bg-[#EF4444]/15' : 'bg-[#31A24C]/15'}`}>
                              <DollarSign className={`w-3.5 h-3.5 ${isVoidTx ? 'text-[#EF4444]' : 'text-[#31A24C]'}`} />
                            </div>
                            <div>
                              <p className="text-xs font-medium text-white">{tx.player_name}</p>
                              <p className="text-[10px] text-[#B0B3B8]">
                                {tx.notes || 'Buy-In'} • {tx.payment_method || 'Cash'} • {txTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={`text-sm font-bold ${isVoidTx ? 'text-[#EF4444]' : 'text-[#31A24C]'}`}>
                              {isVoidTx ? '-' : ''}${parseFloat(tx.amount).toLocaleString()}
                            </span>
                            <button onClick={() => printReceipt(tx)} className="w-7 h-7 rounded-lg bg-[#3A3B3C] flex items-center justify-center active:bg-[#4A4B4C]">
                              <Receipt className="w-3.5 h-3.5 text-[#B0B3B8]" />
                            </button>
                            {!isVoidTx && (
                              <button onClick={() => {
                                const txType = tx.type === 'time_purchase' ? 'time' : tx.type === 'membership' ? 'membership' : 'buyin';
                                // Reliably extract minutes from structured notes: "Time Purchase: 300 minutes (5 Hr Pack)"
                                const minsMatch = (tx.notes || '').match(/Time Purchase:\s*(\d+)\s*minutes/);
                                const mins = minsMatch ? parseInt(minsMatch[1]) : 0;
                                voidTransaction(tx.id, txType, {
                                  player_name: tx.player_name, amount: parseFloat(tx.amount), payment_method: tx.payment_method,
                                  notes: tx.notes, minutes: mins, created_at: tx.created_at
                                });
                              }}
                                className={`px-1.5 py-1 rounded-lg text-[9px] font-bold ${isVoidable ? 'bg-[#F02849]/15 text-[#F02849]' : 'bg-[#F59E0B]/15 text-[#F59E0B]'}`}>
                                {isVoidable ? 'VOID' : 'REFUND'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-6 text-center">
                    <p className="text-sm text-[#B0B3B8]">No Transactions Today</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* === BUY-IN RECEIPT MODAL === */}
        {showBuyIn && (
          <div className="fixed inset-0 bg-black/90 z-50 flex flex-col" onClick={() => setShowBuyIn(false)}>
            <div className="bg-[#242526] w-full h-full overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">Cash Game Buy-In</h3>
                <button onClick={() => setShowBuyIn(false)} className="text-[#B0B3B8] text-2xl leading-none">&times;</button>
              </div>
              <div className="bg-[#3A3B3C]/30 rounded-xl p-3 mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#B0B3B8]" />
                <span className="text-sm text-white font-medium">{selectedPlayer?.player_name || 'Walk-Up Player'}</span>
                {!selectedPlayer && (
                  <button onClick={() => { setShowBuyIn(false); pendingModalRef.current = 'buyin'; setShowPlayerSearch(true); }}
                    className="text-xs text-[#1877F2] ml-auto font-semibold">Find Player</button>
                )}
              </div>
              <p className="text-xs font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">Select Amount</p>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {QUICK_AMOUNTS.map(qa => (
                  <button key={qa} onClick={() => setBuyInAmount(String(qa))}
                    className={`py-3 rounded-xl text-sm font-bold ${buyInAmount === String(qa) ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#E4E6EB] active:bg-[#4A4B4C]'}`}>${qa}</button>
                ))}
              </div>
              <div className="relative mb-4">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#B0B3B8]" />
                <input type="number" value={buyInAmount} onChange={e => setBuyInAmount(e.target.value)} placeholder="Custom Amount"
                  className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl pl-10 pr-4 py-3 text-white text-lg font-bold outline-none focus:border-[#1877F2]" />
              </div>
              <p className="text-xs font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">Payment Method</p>
              <div className="flex gap-2 mb-4">
                <button onClick={() => setPayMethod('cash')}
                  className={`flex-1 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 ${payMethod === 'cash' ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'}`}>
                  <Banknote className="w-4 h-4" /> Cash
                </button>
                <button onClick={() => setPayMethod('card')}
                  className={`flex-1 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 ${payMethod === 'card' ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'}`}>
                  <CreditCard className="w-4 h-4" /> Card
                </button>
              </div>
              <PinSubmitButton action="buyin" label={`Print Buy-In Receipt${buyInAmount ? ` - $${parseFloat(buyInAmount).toLocaleString()}` : ''}`} disabled={!buyInAmount} />
            </div>
          </div>
        )
        }

        {/* === ADD TIME MODAL === */}
        {
          showAddTime && (
            <div className="fixed inset-0 bg-black/90 z-50 flex flex-col" onClick={() => setShowAddTime(false)}>
              <div className="bg-[#242526] w-full h-full overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-white">Add Time</h3>
                  <button onClick={() => setShowAddTime(false)} className="text-[#B0B3B8] text-2xl leading-none">&times;</button>
                </div>
                {selectedPlayer ? (
                  <div className="bg-[#1877F2]/10 border border-[#1877F2]/30 rounded-xl p-3 mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-[#1877F2]" />
                      <span className="text-sm text-white font-medium">{selectedPlayer.player_name}</span>
                    </div>
                    <span className="text-xs text-[#1877F2] font-medium">
                      Balance: {Math.floor((selectedPlayer.time_balance_minutes || 0) / 60)}h {(selectedPlayer.time_balance_minutes || 0) % 60}m
                    </span>
                  </div>
                ) : (
                  <div className="mb-4">
                    <p className="text-xs text-[#EF4444] font-semibold mb-2">Select A Player First</p>
                    <button onClick={() => { setShowAddTime(false); pendingModalRef.current = 'addtime'; setShowPlayerSearch(true); }}
                      className="w-full bg-[#1877F2] text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
                      <Search className="w-4 h-4" /> Scan Or Search For Player
                    </button>
                  </div>
                )}
                <p className="text-xs font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">Select Time Package</p>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {TIME_OPTIONS.map(opt => (
                    <button key={opt.minutes} onClick={() => { setSelectedTime(opt.minutes); }}
                      className={`py-3 px-2 rounded-xl text-left ${selectedTime === opt.minutes ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#E4E6EB] active:bg-[#4A4B4C]'}`}>
                      <span className="text-sm font-bold block">{opt.label}</span>
                      <span className={`text-xs font-semibold ${selectedTime === opt.minutes ? 'text-white/80' : 'text-[#31A24C]'}`}>
                        {opt.price > 0 ? `$${opt.price}` : 'Free'}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Total Due */}
                {selectedTime && (
                  <div className="bg-[#1877F2]/10 border border-[#1877F2]/30 rounded-xl p-4 mb-4 flex items-center justify-between">
                    <span className="text-sm font-semibold text-[#1877F2]">Total Due</span>
                    <span className="text-2xl font-black text-white">${getTimePrice()}</span>
                  </div>
                )}

                {/* Payment Method */}
                <p className="text-xs font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">Payment Method</p>
                <div className="flex gap-2 mb-4">
                  <button onClick={() => setTimePayMethod('cash')}
                    className={`flex-1 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 ${timePayMethod === 'cash' ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'}`}>
                    <Banknote className="w-4 h-4" /> Cash
                  </button>
                  <button onClick={() => setTimePayMethod('card')}
                    className={`flex-1 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 ${timePayMethod === 'card' ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'}`}>
                    <CreditCard className="w-4 h-4" /> Card
                  </button>
                </div>

                <PinSubmitButton action="addtime" color="#1877F2"
                  label={`Collect $${getTimePrice()} - ${selectedTime ? TIME_OPTIONS.find(o => o.minutes === selectedTime)?.label : 'Time'}`}
                  disabled={!selectedTime || !selectedPlayer?.id} />
                {(!selectedPlayer?.id || !selectedTime) && (
                  <p className="text-xs text-center text-[#B0B3B8] mt-2">
                    {!selectedPlayer?.id ? '↑ Select A Player Above To Continue' : '↑ Choose A Time Package Above'}
                  </p>
                )}

                {/* Recent Time Transactions - Collapsed */}
                {transactions.filter(tx => (tx.type === 'time_purchase' || tx.notes?.includes('Time Purchase')) && !tx.voided_at && tx.type !== 'void').length > 0 && (
                  <div className="mt-4">
                    <button onClick={() => setShowRecentTime(!showRecentTime)}
                      className="w-full flex items-center justify-between py-2 px-3 rounded-lg bg-[#3A3B3C]/30 text-[#B0B3B8] text-xs font-semibold uppercase tracking-wider">
                      <span>Recent Time Sales (Void If Mistake)</span>
                      <ChevronDown className={`w-4 h-4 transition-transform ${showRecentTime ? 'rotate-180' : ''}`} />
                    </button>
                    {showRecentTime && (
                      <div className="space-y-1 mt-2">
                        {transactions.filter(tx => (tx.type === 'time_purchase' || tx.notes?.includes('Time Purchase')) && !tx.voided_at && tx.type !== 'void').slice(0, 5).map(tx => {
                          const minsMatch = (tx.notes || '').match(/Time Purchase:\s*(\d+)\s*minutes/);
                          const mins = minsMatch ? parseInt(minsMatch[1]) : 0;
                          return (
                            <div key={tx.id} className="bg-[#18191A] rounded-lg p-2.5 flex items-center justify-between">
                              <div>
                                <p className="text-xs font-semibold text-white">{tx.player_name}</p>
                                <p className="text-[10px] text-[#B0B3B8]">{tx.notes} • ${parseFloat(tx.amount)} • {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                              </div>
                              <button onClick={() => voidTransaction(tx.id, 'time', { player_name: tx.player_name, amount: parseFloat(tx.amount), payment_method: tx.payment_method, notes: tx.notes, minutes: mins, created_at: tx.created_at })}
                                className="px-2 py-1 rounded-lg bg-[#F02849]/15 text-[#F02849] text-[10px] font-bold">
                                VOID
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        }

        {/* === UPDATE MEMBERSHIP MODAL === */}
        {
          showMembership && (
            <div className="fixed inset-0 bg-black/90 z-50 flex flex-col" onClick={() => setShowMembership(false)}>
              <div className="bg-[#18191A] w-full h-full overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#3A3B3C]">
                  <h3 className="text-lg font-bold text-white">Update Membership</h3>
                  <button onClick={() => setShowMembership(false)} className="text-[#B0B3B8] text-2xl leading-none">&times;</button>
                </div>
                {selectedPlayer ? (
                  <div className="bg-[#3A3B3C]/30 rounded-xl p-3 mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-[#B0B3B8]" />
                      <span className="text-sm text-white font-medium">{selectedPlayer.player_name}</span>
                      {/* FIX C: entry point for the (previously unreachable) Transaction History modal */}
                      <button onClick={loadPlayerHistory} className="text-xs text-[#1877F2] font-semibold underline">History</button>
                    </div>
                    <span className="text-xs text-[#B0B3B8]">
                      Current: {selectedPlayer.membership_tier ? selectedPlayer.membership_tier.charAt(0).toUpperCase() + selectedPlayer.membership_tier.slice(1) : 'None'}
                    </span>
                  </div>
                ) : (
                  <div className="mb-4">
                    <p className="text-xs text-[#1877F2] font-semibold mb-2">Select A Player First:</p>
                    <button onClick={() => { setShowMembership(false); pendingModalRef.current = 'membership'; setShowPlayerSearch(true); }}
                      className="w-full bg-[#1877F2]/15 border border-[#1877F2]/30 text-[#1877F2] py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
                      <Search className="w-4 h-4" /> Scan Or Search For Player
                    </button>
                  </div>
                )}
                <p className="text-xs font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">Select Membership Tier</p>
                <div className="space-y-2 mb-4">
                  {MEMBERSHIP_TIERS.map(t => {
                    const expires = new Date();
                    expires.setDate(expires.getDate() + t.duration);
                    return (
                      <button key={t.tier} onClick={() => setSelectedTier(t.tier)}
                        className={`w-full rounded-xl p-3 flex items-center gap-3 text-left border-2 ${selectedTier === t.tier ? 'border-[#1877F2] bg-[#1877F2]/10' : 'border-[#3A3B3C] bg-[#3A3B3C]/30'
                          }`}>
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: t.color }} />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-bold text-white">{t.label}</p>
                            <span className={`text-sm font-bold ${selectedTier === t.tier ? 'text-[#1877F2]' : 'text-[#B0B3B8]'}`}>{t.price > 0 ? `$${t.price}` : 'Free'}</span>
                          </div>
                          <p className="text-[10px] text-[#B0B3B8]">Expires {expires.toLocaleDateString()}</p>
                        </div>
                        {selectedTier === t.tier && <CheckCircle2 className="w-5 h-5 text-[#1877F2]" />}
                      </button>
                    );
                  })}
                </div>

                {/* Total Due */}
                {selectedTier && (() => {
                  const tierInfo = MEMBERSHIP_TIERS.find(t => t.tier === selectedTier);
                  return tierInfo?.price > 0 ? (
                    <div className="rounded-xl p-4 mb-4 flex items-center justify-between bg-[#1877F2]/10 border border-[#1877F2]/30">
                      <span className="text-sm font-semibold text-[#1877F2]">Total Due</span>
                      <span className="text-2xl font-black text-[#1877F2]">${tierInfo.price}</span>
                    </div>
                  ) : null;
                })()}

                {/* Payment Method */}
                <p className="text-xs font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">Payment Method</p>
                <div className="flex gap-2 mb-4">
                  <button onClick={() => setMemberPayMethod('cash')}
                    className={`flex-1 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 ${memberPayMethod === 'cash' ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'}`}>
                    <Banknote className="w-4 h-4" /> Cash
                  </button>
                  <button onClick={() => setMemberPayMethod('card')}
                    className={`flex-1 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 ${memberPayMethod === 'card' ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'}`}>
                    <CreditCard className="w-4 h-4" /> Card
                  </button>
                </div>

                {pricingUnavailable && (
                  <div className="mb-3 px-4 py-3 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/30 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#EF4444] shrink-0" />
                    <span className="text-xs text-[#EF4444] font-semibold">Pricing Unavailable, Manager Sign-In Required</span>
                  </div>
                )}
                <PinSubmitButton action="membership" color="#1877F2"
                  label={pricingUnavailable ? 'Pricing Unavailable' : `Collect $${selectedTier ? MEMBERSHIP_TIERS.find(t => t.tier === selectedTier)?.price || 0 : 0} - ${selectedTier ? MEMBERSHIP_TIERS.find(t => t.tier === selectedTier)?.label : '...'}`}
                  disabled={pricingUnavailable || !selectedTier || !selectedPlayer?.id} />

                {/* Recent Membership Transactions - Collapsed */}
                {transactions.filter(tx => (tx.type === 'membership' || tx.notes?.includes('Membership')) && !tx.voided_at && tx.type !== 'void').length > 0 && (
                  <div className="mt-4">
                    <button onClick={() => setShowRecentMembership(!showRecentMembership)}
                      className="w-full flex items-center justify-between py-2 px-3 rounded-lg bg-[#3A3B3C]/30 text-[#B0B3B8] text-xs font-semibold uppercase tracking-wider">
                      <span>Recent Membership Sales (Void If Mistake)</span>
                      <ChevronDown className={`w-4 h-4 transition-transform ${showRecentMembership ? 'rotate-180' : ''}`} />
                    </button>
                    {showRecentMembership && (
                      <div className="space-y-1 mt-2">
                        {transactions.filter(tx => (tx.type === 'membership' || tx.notes?.includes('Membership')) && !tx.voided_at && tx.type !== 'void').slice(0, 5).map(tx => (
                          <div key={tx.id} className="bg-[#242526] rounded-lg p-2.5 flex items-center justify-between">
                            <div>
                              <p className="text-xs font-semibold text-white">{tx.player_name}</p>
                              <p className="text-[10px] text-[#B0B3B8]">{tx.notes} • ${parseFloat(tx.amount)} • {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                            <button onClick={() => voidTransaction(tx.id, 'membership', { player_name: tx.player_name, amount: parseFloat(tx.amount), payment_method: tx.payment_method, notes: tx.notes, created_at: tx.created_at })}
                              className="px-2 py-1 rounded-lg bg-[#F02849]/15 text-[#F02849] text-[10px] font-bold">
                              VOID
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ═══ PRINT NEW CARD ─ Bottom of Update Membership ═══ */}
                <div className="mt-6 pt-4 border-t border-[#3A3B3C]">
                  <button
                    onClick={() => {
                      setPrintCardSearchQuery('');
                      setPrintCardSearchResults([]);
                      setPrintCardSelectedPlayer(null);
                      setShowMembership(false);
                      setShowPrintCard(true);
                    }}
                    className="w-full flex justify-center"
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                    aria-label="Print New Card"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <Image src="/images/commander/print-new-card.png" alt="Print New Card" width={640} height={640} style={{ width: '480px', height: 'auto', display: 'block', userSelect: 'none' }} />
                  </button>
                </div>
              </div>
            </div>
          )
        }

        {/* === PLAYER TRANSACTION HISTORY MODAL === */}
        {showPlayerHistory && (
          <div className="fixed inset-0 bg-black/90 z-50 flex flex-col" onClick={() => setShowPlayerHistory(false)}>
            <div className="bg-[#242526] w-full h-full overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">Transaction History</h3>
                <button onClick={() => setShowPlayerHistory(false)} className="text-[#B0B3B8] text-2xl leading-none">&times;</button>
              </div>
              <div className="bg-[#3A3B3C]/30 rounded-xl p-3 mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#1877F2]" />
                <span className="text-sm text-white font-medium">{selectedPlayer?.player_name}</span>
              </div>
              {playerHistoryLoading ? (
                <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 text-[#1877F2] animate-spin" /></div>
              ) : playerHistory.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-[#31A24C]/10 border border-[#31A24C]/20 rounded-lg px-3 py-2 text-center">
                      <p className="text-[10px] text-[#31A24C] font-semibold uppercase">Total Spent</p>
                      <p className="text-lg font-black text-[#31A24C]">
                        ${playerHistory.filter(tx => !tx.voided_at && tx.type !== 'void').reduce((s, tx) => s + parseFloat(tx.amount), 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="bg-[#1877F2]/10 border border-[#1877F2]/20 rounded-lg px-3 py-2 text-center">
                      <p className="text-[10px] text-[#1877F2] font-semibold uppercase">Transactions</p>
                      <p className="text-lg font-black text-[#1877F2]">{playerHistory.length}</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {playerHistory.map(tx => {
                      const isVoidTx = !!tx.voided_at || tx.type === 'void';
                      return (
                        <div key={tx.id} className="bg-[#18191A] rounded-lg p-3 flex items-center justify-between">
                          <div>
                            <p className="text-xs font-semibold text-white">{tx.notes || 'Buy-In'}</p>
                            <p className="text-[10px] text-[#B0B3B8]">
                              {tx.payment_method || 'Cash'} • {new Date(tx.created_at).toLocaleDateString()} {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                          <span className={`text-sm font-bold ${isVoidTx ? 'text-[#EF4444]' : 'text-[#31A24C]'}`}>
                            {isVoidTx ? '-' : ''}${parseFloat(tx.amount).toLocaleString()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="bg-[#18191A] rounded-xl p-8 text-center">
                  <p className="text-sm text-[#B0B3B8]">No Transactions Found</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ PRINT NEW CARD BUTTON ═══ */}
        <div className="px-4 py-4 flex justify-center">
          <button
            onClick={() => {
              setPrintCardSearchQuery('');
              setPrintCardSearchResults([]);
              setPrintCardSelectedPlayer(null);
              setShowPrintCard(true);
            }}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            aria-label="Print New Card"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <Image src="/images/commander/print-new-card.png" alt="Print New Card" width={640} height={640} style={{ width: '680px', height: 'auto', display: 'block', userSelect: 'none' }} />
          </button>
        </div>

        {/* ═══ PRINT CARD MODAL ═══ */}
        {showPrintCard && (
          <div className="fixed inset-0 bg-black/90 z-50 flex flex-col" onClick={() => setShowPrintCard(false)}>
            <div className="bg-[#242526] w-full h-full overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Printer className="w-5 h-5 text-[#00d4ff]" /> Print New Card
                </h3>
                <button onClick={() => setShowPrintCard(false)} className="text-[#B0B3B8] text-2xl leading-none">&times;</button>
              </div>

              {!printCardSelectedPlayer ? (
                <>
                  <p className="text-xs font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">Search For Player</p>
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#B0B3B8]" />
                    <input
                      type="text"
                      value={printCardSearchQuery}
                      onChange={e => {
                        setPrintCardSearchQuery(e.target.value);
                      }}
                      placeholder="Search By Name Or Phone..."
                      autoFocus
                      className="w-full bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl pl-10 pr-4 py-3 text-white text-base font-medium outline-none focus:border-[#1877F2] placeholder:text-[#666]"
                    />
                    {printCardSearchLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1877F2] animate-spin" />}
                  </div>

                  {printCardSearchResults.length > 0 && (
                    <div className="space-y-2">
                      {printCardSearchResults.map(m => {
                        const name = m.name || `${m.first_name || ''} ${m.last_name || ''}`.trim();
                        return (
                          <button key={m.id} onClick={() => setPrintCardSelectedPlayer(m)}
                            className="w-full bg-[#3A3B3C]/50 border border-[#4A4B4C] rounded-xl p-3 flex items-center gap-3 text-left active:bg-[#4A4B4C]">
                            <div className="w-10 h-10 rounded-full bg-[#1877F2]/20 flex items-center justify-center shrink-0">
                              <span className="text-sm font-bold text-[#1877F2]">{(name[0] || '?').toUpperCase()}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-white truncate">{name || 'Unknown'}</p>
                              <p className="text-[10px] text-[#B0B3B8]">
                                {m.phone || 'No Phone'}
                                {m.membership_tier && ` • ${m.membership_tier.charAt(0).toUpperCase() + m.membership_tier.slice(1)} Member`}
                              </p>
                            </div>
                            <Printer className="w-4 h-4 text-[#00d4ff] shrink-0" />
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {printCardSearchQuery.length >= 2 && printCardSearchResults.length === 0 && !printCardSearchLoading && (
                    <div className="text-center py-6">
                      <p className="text-sm text-[#B0B3B8]">No Players Found For &quot;{printCardSearchQuery}&quot;</p>
                    </div>
                  )}

                  {printCardSearchQuery.length < 2 && (
                    <div className="text-center py-6">
                      <Printer className="w-8 h-8 text-[#3A3B3C] mx-auto mb-2" />
                      <p className="text-sm text-[#B0B3B8]">Type A Name Or Phone Number To Find Player</p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Selected player card preview */}
                  <div className="bg-[#1877F2]/10 border border-[#1877F2]/30 rounded-xl p-4 mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-[#1877F2]/20 flex items-center justify-center">
                          <Users className="w-6 h-6 text-[#1877F2]" />
                        </div>
                        <div>
                          <p className="text-base font-bold text-white">
                            {printCardSelectedPlayer.name || `${printCardSelectedPlayer.first_name || ''} ${printCardSelectedPlayer.last_name || ''}`.trim()}
                          </p>
                          <p className="text-xs text-[#B0B3B8]">
                            {printCardSelectedPlayer.phone || 'No Phone'}
                            {printCardSelectedPlayer.membership_tier && ` • ${printCardSelectedPlayer.membership_tier.charAt(0).toUpperCase() + printCardSelectedPlayer.membership_tier.slice(1)}`}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => setPrintCardSelectedPlayer(null)}
                        className="text-xs text-[#B0B3B8] px-2 py-1 rounded-lg active:bg-[#3A3B3C]">Change</button>
                    </div>
                    {printCardSelectedPlayer.member_number && (
                      <p className="text-xs text-[#B0B3B8]">Member #: <span className="text-white font-medium">{printCardSelectedPlayer.member_number}</span></p>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      const m = printCardSelectedPlayer;
                      const name = m.name || `${m.first_name || ''} ${m.last_name || ''}`.trim();
                      const memberId = m.member_number || m.id;
                      const tier = m.membership_tier ? m.membership_tier.charAt(0).toUpperCase() + m.membership_tier.slice(1) : 'Standard';
                      const qrData = encodeURIComponent(m.id);

                      const w = window.open('', '_blank', 'width=500,height=400');
                      if (!w) { setMessage({ type: 'error', text: 'Pop-Up Blocked, Allow Pop-Ups To Print' }); return; }
                      w.document.write(`<!DOCTYPE html><html><head><title>Member Card</title>
<style>
  @page { margin: 0; size: 86mm 54mm; }
  body { margin: 0; padding: 0; font-family: 'Inter', 'Segoe UI', Arial, sans-serif; }
  .card { width: 86mm; height: 54mm; background: linear-gradient(135deg, #0a0e27, #1a1a3e, #0d1b2a); color: white; position: relative; overflow: hidden; box-sizing: border-box; padding: 4mm; display: flex; flex-direction: column; justify-content: space-between; }
  .card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, #00d4ff, transparent); }
  .card::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, #00d4ff, transparent); }
  .logo { font-size: 13px; font-weight: 800; letter-spacing: 0.1em; color: #00d4ff; }
  .name { font-size: 16px; font-weight: 700; margin: 2mm 0 1mm; }
  .tier { font-size: 10px; font-weight: 600; color: #aaa; text-transform: uppercase; letter-spacing: 0.15em; }
  .id { font-size: 9px; color: #666; margin-top: 1mm; }
  .qr { position: absolute; right: 4mm; top: 50%; transform: translateY(-50%); }
  .qr img { width: 22mm; height: 22mm; border-radius: 2px; background: white; padding: 1mm; }
</style></head><body>
<div class="card">
  <div class="logo">SMARTER.POKER</div>
  <div>
    <div class="name">${name}</div>
    <div class="tier">${tier} Member</div>
    <div class="id">ID: ${memberId}</div>
  </div>
  <div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${qrData}" alt="QR" /></div>
</div>
</body></html>`);
                      w.document.close();
                      setTimeout(() => { w.print(); }, 1000);
                    }}
                    className="w-full py-4 rounded-xl text-base font-bold flex items-center justify-center gap-2 text-white active:opacity-80"
                    style={{ background: 'linear-gradient(135deg, #0f3460 0%, #1877F2 100%)' }}
                  >
                    <Printer className="w-5 h-5" /> Print Member Card
                  </button>

                  <button onClick={() => setPrintCardSelectedPlayer(null)}
                    className="w-full mt-2 py-3 rounded-xl bg-[#3A3B3C] text-[#B0B3B8] text-sm font-medium active:bg-[#4A4B4C]">
                    Search Another Player
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* PIN Keypad Overlay */}
        {pinStep && <PinKeypad />}
      <ConfirmDialog />
      </div >
    </CommanderLayout >
  );
}
