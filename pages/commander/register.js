import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import Image from 'next/image';
import Head from 'next/head';
import Link from 'next/link';
import {
  COMMANDER_FREE_MODE,
  COMMANDER_FREE_TAGLINE,
  COMMANDER_FREE_SUBTEXT,
  displayTierPrice,
  displayTierPeriod,
  displayTierTrialTagline,
} from '../../src/lib/commander/tierConfig';

// Wizard tier cards. `price` is the canonical number for when pricing
// goes live; `displayTierPrice(tier)` / `displayTierPeriod(tier)` are
// used everywhere in the UI so that flipping COMMANDER_FREE_MODE in
// tierConfig.js renders every card as "Free" without touching this file.
const TIERS = {
  home_game: {
    name: 'Home Game',
    price: 99,
    tables: 5,
    staff: 3,
    sms: 100,
    features: ['Waitlist Management', 'Tournament Management', 'Free Member Cards', 'Basic Analytics', 'Social Hub Page']
  },
  charity: {
    name: 'Charity',
    price: 199,
    tables: 15,
    staff: 10,
    sms: 500,
    features: ['Everything in Home Game', 'Floor View & Map', 'Dealer Rotation', 'Player Kiosk & Displays', 'Staff Accounts & Scheduling', 'Promotions Engine', 'Advanced Analytics & Reports'],
    popular: true
  },
  club: {
    name: 'Club',
    price: 399,
    tables: 'Unlimited',
    staff: 'Unlimited',
    sms: 'Unlimited',
    features: ['Everything in Charity', 'Paid Memberships (Fees)', 'Time-Based Seat Billing', 'Unlimited SMS', 'Priority Support']
  }
};

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

/**
 * Only permit return URLs that start with an internal /hub/commander path.
 * This prevents open-redirect issues when callers pass ?return=https://attacker.com/.
 */
function sanitizeReturnPath(raw) {
  if (typeof raw !== 'string') return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (!/^\/hub\/commander(\/|$|\?)/.test(raw)) return null;
  return raw;
}

export default function RegisterPage() {
  const router = useRouter();

  // ─── Query-param-driven customization ───────────────────────────
  // ?tier=home_game           → lock tier, skip tier-pick step
  // ?return=/hub/commander/.. → route here on completion; also auto-redirect
  //                              already-activated users straight through
  // ?existing=1               → pre-set "I already have a Smarter.Poker account"
  const queryTier = typeof router.query.tier === 'string' ? router.query.tier : null;
  const queryReturn = useMemo(
    () => sanitizeReturnPath(router.query.return),
    [router.query.return]
  );
  const queryExisting = router.query.existing === '1' || router.query.existing === 'true';
  const lockedTier = queryTier && TIERS[queryTier] ? queryTier : null;
  const isHomeGameFlow = lockedTier === 'home_game';

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [registrationResult, setRegistrationResult] = useState(null);
  const [preCheckDone, setPreCheckDone] = useState(false);

  // ─── Step 1: Account fields ─────────────────────────────────────
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [existingAccount, setExistingAccount] = useState(false);

  // Promo code
  const [promoCode, setPromoCode] = useState('');
  const [promoStatus, setPromoStatus] = useState(null); // null | 'checking' | 'valid' | 'invalid'
  const [promoMessage, setPromoMessage] = useState('');
  const [promoData, setPromoData] = useState(null);

  // ─── Step 2: Venue fields ───────────────────────────────────────
  const [clubInfo, setClubInfo] = useState({
    name: '', address: '', city: '', state: '', zip: '',
    phone: '', website: '', tables: '', gamesOffered: []
  });

  // ─── Step 3: Plan ───────────────────────────────────────────────
  const [selectedTier, setSelectedTier] = useState(lockedTier || 'home_game');
const [agreedToTerms, setAgreedToTerms] = useState(false);

  // --- UI CALIBRATION SYSTEM ---
  const [calib, setCalib] = useState({
    'NLH': { l: 15.4, w: 7.1, t: 78.8, h: 3 },
    'PLO': { l: 23.6, w: 7, t: 78.9, h: 3 },
    'PLO8': { l: 31.7, w: 7.6, t: 78.9, h: 2.9 },
    'LIMIT HE': { l: 40.2, w: 9.9, t: 78.8, h: 3 },
    'STUD': { l: 51, w: 7.6, t: 78.8, h: 3 },
    'MIXED': { l: 59.6, w: 8.4, t: 78.8, h: 3 },
    'TOURNAMENTS': { l: 68.8, w: 14.6, t: 78.8, h: 2.9 },
    'plan_home': { l: 14.8, t: 40.4, w: 70.4, h: 7.8 },
    'plan_charity': { l: 14.8, t: 49, w: 70.3, h: 7.8 },
    'plan_club': { l: 14.78, t: 57.88, w: 70.4, h: 7.7 },
    'dot_home': { l: 3.8, t: 48.2, w: 2.6, h: 21.6 },
    'dot_charity': { l: 4, t: 49, w: 2.4, h: 21.2 },
    'dot_club': { l: 3.9, t: 47.4, w: 2.6, h: 21.3 },
    'checkbox_agree': { l: 14.9, t: 75.2, w: 2.5, h: 2.5 },
    'checkmark': { l: 14.66, t: 75.28, w: 3.1, h: 2.6 }
  });
  const [activeCalib, setActiveCalib] = useState('NLH');
  const [showCalib, setShowCalib] = useState(false);
  const liveCalib = useRef(calib);
  useEffect(() => { liveCalib.current = calib; }, [calib]); // Sync initial mount

  const getDraggableProps = (idKey) => {
    if (!showCalib) return {};
    
    return {
      style: { cursor: 'move', outline: (idKey.startsWith('dot_') || idKey.startsWith('check')) ? 'none' : (activeCalib === idKey ? '2px dashed #1877F2' : '2px dotted rgba(255,255,255,0.5)') },
      onPointerDown: (e) => {
        e.preventDefault();
        e.stopPropagation();
        setActiveCalib(idKey);
        
        const el = document.getElementById('calib-' + idKey);
        if (!el) return;
        const parentRect = el.parentElement.getBoundingClientRect();
        
        const startX = e.clientX;
        const startY = e.clientY;
        const startLeft = parseFloat(el.style.left) || 0;
        const startTop = parseFloat(el.style.top) || 0;

        const onMove = (moveEvent) => {
          const deltaX = moveEvent.clientX - startX;
          const deltaY = moveEvent.clientY - startY;
          const newLeft = startLeft + (deltaX / parentRect.width) * 100;
          const newTop = startTop + (deltaY / parentRect.height) * 100;
          
          el.style.left = `${newLeft.toFixed(2)}%`;
          el.style.top = `${newTop.toFixed(2)}%`;
          if (idKey === 'checkmark') {
            const vis = document.getElementById('calib-checkmark_visual');
            if (vis) {
              vis.style.left = `${newLeft.toFixed(2)}%`;
              vis.style.top = `${newTop.toFixed(2)}%`;
            }
          }
          
          liveCalib.current = {
            ...liveCalib.current,
            [idKey]: {
              ...liveCalib.current[idKey],
              l: parseFloat(newLeft.toFixed(2)),
              t: parseFloat(newTop.toFixed(2))
            }
          };
          
          const labelL = document.getElementById('label-l');
          const labelT = document.getElementById('label-t');
          if (labelL) labelL.innerText = newLeft.toFixed(2) + '%';
          if (labelT) labelT.innerText = newTop.toFixed(2) + '%';
        };

        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }
    };
  };

  useEffect(() => {
    if (router.isReady && router.query.calibrate === 'true') {
      setShowCalib(true);
    }
    const handleKeyDown = (e) => {
      if (e.key === 'c' && e.shiftKey && e.altKey) {
        setShowCalib(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router.isReady, router.query.calibrate]);
  // ------------------------------

  // Address is required only for the club tier. Home games + charity: optional.
  const isAddressRequired = selectedTier === 'club';

  // Apply ?existing=1 once router.query is ready.
  useEffect(() => {
    if (!router.isReady) return;
    if (queryExisting) setExistingAccount(true);
  }, [router.isReady, queryExisting]);

  // Lock selectedTier whenever a valid tier query param is supplied.
  useEffect(() => {
    if (lockedTier) setSelectedTier(lockedTier);
  }, [lockedTier]);

  // ─── Pre-check: if user is already signed in, prefill step 1 fields.
  //     If they already have Commander access and a ?return= URL was
  //     provided, bypass the wizard entirely and redirect to the target.
  //     Otherwise (signed in, no commander access): jump straight to
  //     step 2 so they don't have to re-enter data they already gave us.
  useEffect(() => {
    if (!router.isReady) return;
    if (typeof window === 'undefined') return;

    let authBlob = {};
    try {
      authBlob = JSON.parse(window.localStorage.getItem('smarter-poker-auth') || '{}');
    } catch { /* corrupted blob - treat as signed-out */ }

    const user = authBlob?.user || null;
    const accessToken =
      authBlob?.session?.access_token ||
      authBlob?.access_token ||
      authBlob?.currentSession?.access_token ||
      null;

    if (!user || !accessToken) {
      setPreCheckDone(true);
      return;
    }

    // Prefill step 1 from the existing account metadata.
    const fullName = user.user_metadata?.full_name || user.user_metadata?.name || '';
    const phone = user.user_metadata?.phone || user.phone || '';
    if (fullName) setOwnerName(fullName);
    if (user.email) setOwnerEmail(user.email);
    if (phone) setOwnerPhone(phone);
    setExistingAccount(true);

    // Probe commander access. If already activated and we have a return path,
    // send them straight through - no need to re-register.
    let cancelled = false;
    const finish = () => { if (!cancelled) setPreCheckDone(true); };

    // Hard 8-second timeout - if the API is down or slow, we MUST unblock the UI.
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('check-access timeout')), 8000)
    );

    Promise.race([
      fetch('/api/commander/check-access', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      }).then(r => r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))),
      timeoutPromise,
    ])
      .then(data => {
        if (cancelled) return;
        if (data?.hasAccess && queryReturn) {
          // Already activated → bypass wizard entirely.
          router.replace(queryReturn);
          return;
        }
        // Signed in but not activated: skip step 1, the user has already
        // provided these details when they signed up for Smarter.Poker.
        setStep(2);
        finish();
      })
      .catch(e => {
        console.warn('[Commander] check-access failed, unblocking UI:', e?.message || e);
        finish();
      });

    return () => { cancelled = true; };
  }, [router.isReady, queryReturn]); // eslint-disable-line react-hooks/exhaustive-deps

  const validatePromoCode = async (code) => {
    if (!code.trim()) {
      setPromoStatus(null);
      setPromoMessage('');
      setPromoData(null);
      return;
    }
    setPromoStatus('checking');
    try {
      const res = await fetch('/api/promo/validate-promo-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      if (res.ok && data.valid) {
        setPromoStatus('valid');
        setPromoMessage(data.description || 'Promo code accepted!');
        setPromoData(data);
      } else {
        setPromoStatus('invalid');
        setPromoMessage(data.error || 'Invalid promo code');
        setPromoData(null);
      }
    } catch {
      setPromoStatus('invalid');
      setPromoMessage('Could not validate code');
      setPromoData(null);
    }
  };

  const handleClubInfoChange = (e) => {
    setClubInfo(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleGameToggle = (game) => {
    setClubInfo(prev => ({
      ...prev,
      gamesOffered: prev.gamesOffered.includes(game)
        ? prev.gamesOffered.filter(g => g !== game)
        : [...prev.gamesOffered, game]
    }));
  };

  const validateStep = (stepNum) => {
    setError('');
    // Step 1: Account
    if (stepNum === 1) {
      if (!ownerName.trim()) {
        setError('Please Enter Your Full Name');
        return false;
      }
      if (!ownerEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
        setError('Please Enter A Valid Email Address');
        return false;
      }
      if (!existingAccount) {
        if (!password) {
          setError('Please Create A Password For Your Account');
          return false;
        }
        if (password !== confirmPassword) {
          setError('Passwords Do Not Match');
          return false;
        }
        if (password.length < 8) {
          setError('Password Must Be At Least 8 Characters');
          return false;
        }
      }
    }

    // Step 2: Venue Details
    if (stepNum === 2) {
      if (!clubInfo.name.trim()) {
        setError(isHomeGameFlow ? 'Please Enter A Name For Your Home Game' : 'Please Enter Your Venue/Club Name');
        return false;
      }
      // For home-game flow, we still want at least city+state so the listing geocodes.
      if (isHomeGameFlow) {
        if (!clubInfo.city.trim() || !clubInfo.state.trim()) {
          setError('Please Enter City And State So Players Can Find Your Home Game');
          return false;
        }
      }
      // Club tier requires the full address.
      if (isAddressRequired) {
        if (!clubInfo.address || !clubInfo.city || !clubInfo.state || !clubInfo.zip) {
          setError('Please Fill In The Full Address For Your Club');
          return false;
        }
      }
    }

    // Step 3: Plan
    if (stepNum === 3 && !agreedToTerms) {
      setError('Please Agree To Terms And Conditions');
      return false;
    }

    return true;
  };

  const nextStep = () => {
    if (!validateStep(step)) return;

    // When tier is locked via ?tier= query param, there is no "Select Plan"
    // step. Step 2's "Continue" button submits directly.
    if (lockedTier && step === 2) {
      if (!agreedToTerms) {
        setError('Please Agree To Terms And Conditions');
        return;
      }
      handleSubmit();
      return;
    }

    setStep(s => Math.min(s + 1, 4));
  };

  const prevStep = () => setStep(s => Math.max(s - 1, 1));

  const handleSubmit = async () => {
    // When tier is locked, step 3 is skipped; validate step 2 instead.
    if (lockedTier) {
      if (!validateStep(2)) return;
      if (!agreedToTerms) {
        setError('Please Agree To Terms And Conditions');
        return;
      }
    } else if (!validateStep(3)) {
      return;
    }

    setLoading(true);
    setError('');
    try {
      // HARDENED: 30-second timeout (registration does a lot of server-side work)
      const abortController = new AbortController();
      const fetchTimeout = setTimeout(() => abortController.abort(), 30000);

      // 2026-07-25 audit fix: the existing-account path now REQUIRES the
      // caller's Supabase session (server verifies the signed-in user matches
      // the email) - attach the token whenever we have one.
      let sessionToken = null;
      try {
        const blob = JSON.parse(window.localStorage.getItem('smarter-poker-auth') || '{}');
        sessionToken = blob?.session?.access_token || blob?.access_token || blob?.currentSession?.access_token || null;
      } catch { /* no session */ }

      if (existingAccount && !sessionToken) {
        clearTimeout(fetchTimeout);
        setError('Please sign in to your Smarter.Poker account first, then return here to finish registration.');
        setLoading(false);
        return;
      }

      const res = await fetch('/api/commander/create-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          clubInfo: {
            ...clubInfo,
            email: ownerEmail, // Use account email for venue
            phone: clubInfo.phone || ownerPhone, // Fall back to owner phone
          },
          ownerInfo: {
            name: ownerName,
            email: ownerEmail,
            phone: ownerPhone,
            password: existingAccount ? null : password,
          },
          selectedTier,
          existingAccount,
          skipPayment: true,
        }),
        signal: abortController.signal,
      });
      clearTimeout(fetchTimeout);
      // 2026-07-25 audit fix: parse the body BEFORE throwing so the server's
      // descriptive errors (duplicate account, address in use, sign-in
      // required) reach the user instead of a generic "Request failed".
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Registration failed');

      // Redeem promo code if one was validated
      if (promoCode.trim() && promoStatus === 'valid' && data.userId) {
        try {
          const promoRes = await fetch('/api/promo/redeem-promo-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: promoCode.trim(), userId: data.userId })
          });
          if (!promoRes.ok) console.warn('Promo payload failed');
        } catch (e) {
          console.warn('Promo redemption error:', e);
        }
      }

      // New venue exists now — drop the hamburger switcher's cached club
      // list so the new club appears immediately, not after the 5-min TTL
      try { sessionStorage.removeItem('commander_accounts_cache'); } catch { /* ignore */ }

      setRegistrationResult(data);
      setStep(4);
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Registration Timed Out. Please Check Your Connection And Try Again.');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCompletionCta = () => {
    if (queryReturn) {
      router.push(queryReturn);
      return;
    }
    window.location.href = '/commander/login';
  };

  const inputClass = "w-full px-4 py-3 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] placeholder-[#8A8D91] focus:border-[#1877F2] focus:ring-2 focus:ring-[#1877F2]/20 focus:outline-none";

  // Progress bar steps. When tier is locked we skip the "Select Plan" step
  // and show 3 circles instead of 4. Internal step state stays 1/2/4 so the
  // existing Complete (step === 4) branch still renders; we just label it "3".
  const steps = lockedTier
    ? ['Your Account', isHomeGameFlow ? 'Home Game Details' : 'Details', 'Complete']
    : ['Create Account', 'Venue Details', 'Select Plan', 'Complete'];
  const displayStep = lockedTier ? (step === 4 ? 3 : step) : step;

  const headerTitle = isHomeGameFlow
    ? 'List Your Home Game - Club Commander'
    : 'Register Your Club - Club Commander';
  const headerSubtitle = COMMANDER_FREE_MODE
    ? (isHomeGameFlow
        ? `Host Your Own Poker Home Game - ${COMMANDER_FREE_TAGLINE}`
        : `Set Up Your Poker Room In Minutes - ${COMMANDER_FREE_TAGLINE}`)
    : (isHomeGameFlow
        ? 'Host Your Own Poker Home Game - 100% Free To Start'
        : 'Set Up Your Poker Room In Minutes - 14-Day Free Trial');

  // While the pre-check is running we render a minimal placeholder so the
  // wizard doesn't flash before we know whether to redirect.
  if (!preCheckDone) {
    return (
      <div className="min-h-screen bg-[#18191A] flex items-center justify-center">
        <Head><title>{headerTitle}</title></Head>
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#3A3B3C] border-t-[#1877F2] rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#8A8D91] text-sm">Checking Your Commander Access...</p>
        </div>
      </div>
    );
  }


const CalibrationPanel = () => {
    if (!showCalib) return null;

    // Use a ref to store live values without triggering re-renders


    const handleSlide = (prop, e) => {
      const val = parseFloat(e.target.value);
      
      // Update DOM immediately
      const el = document.getElementById('calib-' + activeCalib);
      if (el) {
        if (prop === 'l') el.style.left = val + '%';
        if (prop === 't') el.style.top = val + '%';
        if (prop === 'w') el.style.width = val + '%';
        if (prop === 'h') el.style.height = val + '%';
      }
      
      // Update ref silently
      liveCalib.current = {
        ...liveCalib.current,
        [activeCalib]: {
          ...liveCalib.current[activeCalib],
          [prop]: val
        }
      };
      
      // Update the little text label next to the slider manually
      const labelEl = document.getElementById(`label-${prop}`);
      if (labelEl) labelEl.innerText = val + '%';
    };

    return (
      <div style={{position: 'fixed', top: 10, right: 10, background: 'rgba(0,0,0,0.9)', padding: 20, zIndex: 9999, color: 'white', border: '1px solid #1877F2', borderRadius: 8, width: 300}}>
        <div style={{marginBottom: 10}}><b>UI Calibrator</b></div>
        <select value={activeCalib} onChange={e => { setActiveCalib(e.target.value); setCalib(liveCalib.current); }} style={{color:'black', marginBottom:10, width: '100%', padding: 4}}>
          {Object.keys(calib).map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        
        <div style={{marginBottom: 8}}>
          Left: <span id="label-l">{liveCalib.current[activeCalib]?.l}%</span>
          <input type="range" min="0" max="100" step="0.1" defaultValue={liveCalib.current[activeCalib]?.l || 0} onChange={e => handleSlide('l', e)} style={{width:'100%'}} key={`l-${activeCalib}`} />
        </div>
        <div style={{marginBottom: 8}}>
          Top: <span id="label-t">{liveCalib.current[activeCalib]?.t}%</span>
          <input type="range" min="0" max="100" step="0.1" defaultValue={liveCalib.current[activeCalib]?.t || 0} onChange={e => handleSlide('t', e)} style={{width:'100%'}} key={`t-${activeCalib}`} />
        </div>
        {liveCalib.current[activeCalib]?.w !== undefined && (
          <div style={{marginBottom: 8}}>
            Width: <span id="label-w">{liveCalib.current[activeCalib]?.w}%</span>
            <input type="range" min="0" max="100" step="0.1" defaultValue={liveCalib.current[activeCalib]?.w || 0} onChange={e => handleSlide('w', e)} style={{width:'100%'}} key={`w-${activeCalib}`} />
          </div>
        )}
        {liveCalib.current[activeCalib]?.h !== undefined && (
          <div style={{marginBottom: 8}}>
            Height: <span id="label-h">{liveCalib.current[activeCalib]?.h}%</span>
            <input type="range" min="0" max="100" step="0.1" defaultValue={liveCalib.current[activeCalib]?.h || 0} onChange={e => handleSlide('h', e)} style={{width:'100%'}} key={`h-${activeCalib}`} />
          </div>
        )}
        
        <button 
          onClick={() => {
            setCalib(liveCalib.current);
            navigator.clipboard.writeText(JSON.stringify(liveCalib.current, null, 2));
            alert("Settings copied to clipboard! Paste them to the AI.");
          }}
          style={{marginTop: 10, width: '100%', padding: '10px', background: '#1877F2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'}}
        >
          Save & Copy Settings
        </button>
      </div>
    );
  };
  // ------------------------------

  if (step === 1) {
    const autofillCss = `
      input:-webkit-autofill,
      input:-webkit-autofill:hover, 
      input:-webkit-autofill:focus, 
      input:-webkit-autofill:active {
          transition: background-color 9999s ease-in-out 0s;
          -webkit-text-fill-color: white !important;
      }
    `;

    return (
      <>
        <style dangerouslySetInnerHTML={{__html: autofillCss}} />
        <CalibrationPanel />
        <div className="w-screen h-screen relative overflow-hidden font-rajdhani bg-black">
          <Head>
            <title>Club Commander - Register</title>
            <meta name="description" content="Club Commander Poker Room Management Tool." />
            <meta name="robots" content="noindex" />
          </Head>

          <div className="relative w-full h-full z-10">
            {/* Stretch the image to fill the screen */}
            <img 
              src="/images/commander/register-bg-v1.jpg" 
              className="absolute inset-0 w-full h-full object-fill pointer-events-none" 
              alt="Register Background" 
            />

            <form style={{ display: 'contents' }} onSubmit={(e) => { e.preventDefault(); nextStep(); }}>
              {/* Name Input */}
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                required
                style={{
                  position: 'absolute',
                  top: '45.5%',
                  left: '19%',
                  width: '62%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  fontSize: 'min(17px, 3vw)',
                  zIndex: 10,
                  fontFamily: 'Inter, sans-serif'
                }}
              />

              {/* Email Input */}
              <input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                required
                style={{
                  position: 'absolute',
                  top: '53.2%',
                  left: '19%',
                  width: '62%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  fontSize: 'min(17px, 3vw)',
                  zIndex: 10,
                  fontFamily: 'Inter, sans-serif'
                }}
              />

              {/* Phone Input */}
              <input
                type="tel"
                value={ownerPhone}
                onChange={(e) => setOwnerPhone(e.target.value)}
                style={{
                  position: 'absolute',
                  top: '60.9%',
                  left: '19%',
                  width: '62%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  fontSize: 'min(17px, 3vw)',
                  zIndex: 10,
                  fontFamily: 'Inter, sans-serif'
                }}
              />

              {/* Existing Account Checkbox */}
              <input
                type="checkbox"
                checked={existingAccount}
                onChange={(e) => setExistingAccount(e.target.checked)}
                style={{
                  position: 'absolute',
                  top: '66.9%',
                  left: '19.1%',
                  width: '2%',
                  height: '1.8%',
                  cursor: 'pointer',
                  opacity: 0.01,
                  zIndex: 10
                }}
                title="I Already Have A Smarter.Poker Account"
              />
              {existingAccount && (
                <div style={{
                  position: 'absolute',
                  top: '66.9%',
                  left: '19.1%',
                  width: '1.2%',
                  height: '1.8%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: showCalib ? 'auto' : 'none',
                  zIndex: 9
                }}>
                  <span className="text-[#1877F2] font-bold">✓</span>
                </div>
              )}

              {/* Password Input */}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!existingAccount}
                style={{
                  position: 'absolute',
                  top: '73.5%',
                  left: '19%',
                  width: '31%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  fontSize: 'min(17px, 3vw)',
                  zIndex: 10,
                  fontFamily: 'Inter, sans-serif'
                }}
              />

              {/* Confirm Password Input */}
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required={!existingAccount}
                style={{
                  position: 'absolute',
                  top: '73.5%',
                  left: '52%',
                  width: '31%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  fontSize: 'min(17px, 3vw)',
                  zIndex: 10,
                  fontFamily: 'Inter, sans-serif'
                }}
              />

              {/* Promo Code Input */}
              <input
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                style={{
                  position: 'absolute',
                  top: '83.3%',
                  left: '19%',
                  width: '52%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  fontSize: 'min(17px, 3vw)',
                  zIndex: 10,
                  fontFamily: 'Inter, sans-serif'
                }}
              />

              {/* Apply Promo Button */}
              <button
                type="button"
                
                style={{
                  position: 'absolute',
                  top: '83.3%',
                  left: '73%',
                  width: '9%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  zIndex: 10
                }}
                title="Apply Promo"
              />

              {/* Error Message */}
              {error && (
                <div style={{
                  position: 'absolute',
                  top: '88%',
                  left: '18%',
                  width: '64%',
                  textAlign: 'center',
                  color: '#F02849',
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  padding: '4px',
                  borderRadius: '4px',
                  fontSize: '14px',
                  zIndex: 10
                }}>
                  {error}
                </div>
              )}

              {/* Continue to Venue Details Button */}
              <button
                type="submit"
                style={{
                  position: 'absolute',
                  top: '90%',
                  left: '51%',
                  width: '31%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  zIndex: 10
                }}
                title="Continue to Venue Details"
              />
            </form>
          </div>
        </div>
      </>
    );
  }


  if (step === 2) {
    const autofillCss = `
      input:-webkit-autofill,
      input:-webkit-autofill:hover, 
      input:-webkit-autofill:focus, 
      input:-webkit-autofill:active {
          transition: background-color 9999s ease-in-out 0s;
          -webkit-text-fill-color: white !important;
      }
    `;

    return (
      <>
        <style dangerouslySetInnerHTML={{__html: autofillCss}} />
        <CalibrationPanel />
        <div className="w-screen h-screen relative overflow-hidden font-rajdhani bg-black">
          <Head>
            <title>Club Commander - Register Step 2</title>
            <meta name="robots" content="noindex" />
          </Head>

          <div className="relative w-full h-full z-10">
            {/* Stretch the image to fill the screen */}
            <img 
              src="/images/commander/register-step2-bg.jpg" 
              className="absolute inset-0 w-full h-full object-fill pointer-events-none" 
              alt="Register Step 2 Background" 
            />

            <form style={{ display: 'contents' }} onSubmit={(e) => { e.preventDefault(); nextStep(); }}>
              {/* Venue Name Input */}
              <input
                type="text"
                value={clubInfo.name}
                onChange={e => setClubInfo({ ...clubInfo, name: e.target.value })}
                required
                style={{
                  position: 'absolute',
                  top: '42.2%',
                  left: '18%',
                  width: '63%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  fontSize: 'min(17px, 3vw)',
                  zIndex: 10,
                  fontFamily: 'Inter, sans-serif'
                }}
              />

              {/* Address Input */}
              <input
                type="text"
                value={clubInfo.address}
                onChange={e => setClubInfo({ ...clubInfo, address: e.target.value })}
                required={isAddressRequired}
                style={{
                  position: 'absolute',
                  top: '49.3%',
                  left: '18%',
                  width: '63%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  fontSize: 'min(17px, 3vw)',
                  zIndex: 10,
                  fontFamily: 'Inter, sans-serif'
                }}
              />

              {/* City Input */}
              <input
                type="text"
                value={clubInfo.city}
                onChange={e => setClubInfo({ ...clubInfo, city: e.target.value })}
                required={isAddressRequired}
                style={{
                  position: 'absolute',
                  top: '56.4%',
                  left: '18%',
                  width: '21%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  fontSize: 'min(17px, 3vw)',
                  zIndex: 10,
                  fontFamily: 'Inter, sans-serif'
                }}
              />

              {/* State Select */}
              <select
                value={clubInfo.state}
                onChange={e => setClubInfo({ ...clubInfo, state: e.target.value })}
                required={isAddressRequired}
                style={{
                  position: 'absolute',
                  top: '56.4%',
                  left: '45.2%',
                  width: '15%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  fontSize: 'min(17px, 3vw)',
                  zIndex: 10,
                  fontFamily: 'Inter, sans-serif',
                  appearance: 'none',
                  WebkitAppearance: 'none'
                }}
              >
                <option value="" className="text-black">Select State</option>
                {US_STATES.map(st => <option key={st} value={st} className="text-black">{st}</option>)}
              </select>

              {/* Zip Input */}
              <input
                type="text"
                value={clubInfo.zip}
                onChange={e => setClubInfo({ ...clubInfo, zip: e.target.value })}
                required={isAddressRequired}
                style={{
                  position: 'absolute',
                  top: '56.4%',
                  left: '66.8%',
                  width: '17%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  fontSize: 'min(17px, 3vw)',
                  zIndex: 10,
                  fontFamily: 'Inter, sans-serif'
                }}
              />

              {/* Phone Input */}
              <input
                type="tel"
                value={clubInfo.phone}
                onChange={e => setClubInfo({ ...clubInfo, phone: e.target.value })}
                style={{
                  position: 'absolute',
                  top: '63.5%',
                  left: '18%',
                  width: '29%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  fontSize: 'min(17px, 3vw)',
                  zIndex: 10,
                  fontFamily: 'Inter, sans-serif'
                }}
              />

              {/* Web Input */}
              <input
                type="url"
                value={clubInfo.website}
                onChange={e => setClubInfo({ ...clubInfo, website: e.target.value })}
                style={{
                  position: 'absolute',
                  top: '63.5%',
                  left: '52.5%',
                  width: '29%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  fontSize: 'min(17px, 3vw)',
                  zIndex: 10,
                  fontFamily: 'Inter, sans-serif'
                }}
              />

              {/* Tables Input */}
              <input
                type="number"
                min="1"
                value={clubInfo.tables}
                onChange={e => setClubInfo({ ...clubInfo, tables: e.target.value })}
                required
                style={{
                  position: 'absolute',
                  top: '70.7%',
                  left: '18%',
                  width: '63%',
                  height: '4.2%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'white',
                  fontSize: 'min(17px, 3vw)',
                  zIndex: 10,
                  fontFamily: 'Inter, sans-serif'
                }}
              />

              {/* Games Offered Toggles */}
              {['NLH', 'PLO', 'PLO8', 'LIMIT HE', 'STUD', 'MIXED', 'TOURNAMENTS'].map(label => {
                const c = calib[label] || { l: 0, w: 0, t: 0, h: 0 };
                const l = c.l;
                const w = c.w;
                return (
                <button
                  id={`calib-${label}`}
                  {...getDraggableProps(label)}
                  key={label}
                  type="button"
                  onClick={() => {
                    // Match the original logic which uses 'Limit HE', 'Stud', 'Mixed', 'Tournaments' etc.
                    // But in our label map above, they are uppercase.
                    // Let's map them to the original strings so the database stays consistent!
                    const gameMap = {
                      'NLH': 'NLH',
                      'PLO': 'PLO',
                      'PLO8': 'PLO8',
                      'LIMIT HE': 'Limit HE',
                      'STUD': 'Stud',
                      'MIXED': 'Mixed',
                      'TOURNAMENTS': 'Tournaments'
                    };
                    const gameName = gameMap[label];
                    const active = clubInfo.gamesOffered.includes(gameName);
                    setClubInfo({
                      ...clubInfo,
                      gamesOffered: active 
                        ? clubInfo.gamesOffered.filter(g => g !== gameName)
                        : [...clubInfo.gamesOffered, gameName]
                    });
                  }}
                  style={{
                    position: 'absolute',
                    top: `${c.t}%`,
                    left: `${l}%`,
                    width: `${w}%`,
                    height: `${c.h}%`,
                    // Using a subtle 15% opacity white background for selected state per user feedback to have NO OVERLAYS.
                    // Or maybe no background at all, just a border? Wait, if I use NO overlay, how do they know?
                    // I will use a very subtle white background
                    background: 'transparent',
                    border: clubInfo.gamesOffered.includes({'NLH': 'NLH', 'PLO': 'PLO', 'PLO8': 'PLO8', 'LIMIT HE': 'Limit HE', 'STUD': 'Stud', 'MIXED': 'Mixed', 'TOURNAMENTS': 'Tournaments'}[label]) ? '2px solid #1877F2' : 'none',
                    boxShadow: clubInfo.gamesOffered.includes({'NLH': 'NLH', 'PLO': 'PLO', 'PLO8': 'PLO8', 'LIMIT HE': 'Limit HE', 'STUD': 'Stud', 'MIXED': 'Mixed', 'TOURNAMENTS': 'Tournaments'}[label]) ? '0 0 10px #1877F2, inset 0 0 10px rgba(24,119,242,0.5)' : 'none',
                    borderRadius: '20px',
                    cursor: 'pointer',
                    zIndex: 10
                  }}
                  title={label}
                />
              );
            })}

              {/* Back Button */}
              <button
                type="button"
                onClick={prevStep}
                style={{
                  position: 'absolute',
                  top: '84.8%',
                  left: '17%',
                  width: '10%',
                  height: '4%',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  zIndex: 10
                }}
                title="Back"
              />

              {/* Continue Button */}
              <button
                type="submit"
                disabled={loading || (lockedTier && !agreedToTerms)}
                style={{
                  position: 'absolute',
                  top: '84.8%',
                  left: '51%',
                  width: '31%',
                  height: '4%',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  zIndex: 10
                }}
                title="Continue"
              />
              
              {/* Sign In Link Bottom */}
              <Link href="/commander/login" style={{
                  position: 'absolute',
                  top: '90.5%',
                  left: '25%',
                  width: '50%',
                  height: '5%',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  zIndex: 10
              }} title="Sign In" />
            </form>
          </div>
          <CalibrationPanel />
        </div>
      </>
    );
  }


  if (step === 3 && !lockedTier) {
    return (
      <>
      <CalibrationPanel />
      <div className="w-screen h-screen relative overflow-hidden font-rajdhani bg-black">
        <Head>
          <title>Club Commander - Select Plan</title>
          <meta name="robots" content="noindex" />
        </Head>

        <div className="relative w-full h-full z-10">
          {/* Stretch the image to fill the screen */}
          {/* Note: Change to register-step3-bg-paid.jpg when out of beta */}
          <img 
            src="/images/commander/register-step3-bg-beta.jpg" 
            className="absolute inset-0 w-full h-full object-fill pointer-events-none" 
            alt="Register Step 3 Background" 
          />

          {/* Plan 1: Home Games */}
          <button
            id="calib-plan_home"
            {...getDraggableProps('plan_home')}
            type="button"
            onClick={() => setSelectedTier('home_game')}
            style={{
              position: 'absolute',
              top: `${calib.plan_home.t}%`,
              left: `${calib.plan_home.l}%`,
              width: `${calib.plan_home.w}%`,
              height: `${calib.plan_home.h}%`,
              ...(showCalib ? getDraggableProps('plan_home').style : {}),
              background: 'transparent',
              border: selectedTier === 'home_game' ? '2px solid #1877F2' : 'none',
              borderRadius: '8px',
              boxShadow: selectedTier === 'home_game' ? 'inset 0 0 15px rgba(24, 119, 242, 0.4), 0 0 10px rgba(24, 119, 242, 0.4)' : 'none',
              cursor: 'pointer',
              zIndex: 10
            }}
            title="Home Games"
          >
             {/* Optional circle fill */}
             {selectedTier === 'home_game' && (
               <div id="calib-dot_home" {...getDraggableProps('dot_home')} style={{
                 position: 'absolute',
                 top: `${calib.dot_home.t}%`,
                 left: `${calib.dot_home.l}%`,
                 ...(showCalib ? getDraggableProps('dot_home').style : {}),
                 transform: 'translateY(-50%)',
                 width: `${calib.dot_home.w}%`,
                 height: `${calib.dot_home.h}%`,
                 backgroundColor: '#1877F2',
                 borderRadius: '50%',
                 pointerEvents: showCalib ? 'auto' : 'none'
               }} />
             )}
          </button>

          {/* Plan 2: Charity */}
          <button
            id="calib-plan_charity"
            {...getDraggableProps('plan_charity')}
            type="button"
            onClick={() => setSelectedTier('charity')}
            style={{
              position: 'absolute',
              top: `${calib.plan_charity.t}%`,
              left: `${calib.plan_charity.l}%`,
              width: `${calib.plan_charity.w}%`,
              height: `${calib.plan_charity.h}%`,
              ...(showCalib ? getDraggableProps('plan_charity').style : {}),
              background: 'transparent',
              border: selectedTier === 'charity' ? '2px solid #1877F2' : 'none',
              borderRadius: '8px',
              boxShadow: selectedTier === 'charity' ? 'inset 0 0 15px rgba(24, 119, 242, 0.4), 0 0 10px rgba(24, 119, 242, 0.4)' : 'none',
              cursor: 'pointer',
              zIndex: 10
            }}
            title="Charity"
          >
             {selectedTier === 'charity' && (
               <div id="calib-dot_charity" {...getDraggableProps('dot_charity')} style={{
                 position: 'absolute',
                 top: `${calib.dot_charity.t}%`,
                 left: `${calib.dot_charity.l}%`,
                 ...(showCalib ? getDraggableProps('dot_charity').style : {}),
                 transform: 'translateY(-50%)',
                 width: `${calib.dot_charity.w}%`,
                 height: `${calib.dot_charity.h}%`,
                 backgroundColor: '#1877F2',
                 borderRadius: '50%',
                 pointerEvents: showCalib ? 'auto' : 'none'
               }} />
             )}
          </button>

          {/* Plan 3: Clubs */}
          <button
            id="calib-plan_club"
            {...getDraggableProps('plan_club')}
            type="button"
            onClick={() => setSelectedTier('club')}
            style={{
              position: 'absolute',
              top: `${calib.plan_club.t}%`,
              left: `${calib.plan_club.l}%`,
              width: `${calib.plan_club.w}%`,
              height: `${calib.plan_club.h}%`,
              ...(showCalib ? getDraggableProps('plan_club').style : {}),
              background: 'transparent',
              border: selectedTier === 'club' ? '2px solid #1877F2' : 'none',
              borderRadius: '8px',
              boxShadow: selectedTier === 'club' ? 'inset 0 0 15px rgba(24, 119, 242, 0.4), 0 0 10px rgba(24, 119, 242, 0.4)' : 'none',
              cursor: 'pointer',
              zIndex: 10
            }}
            title="Clubs"
          >
             {selectedTier === 'club' && (
               <div id="calib-dot_club" {...getDraggableProps('dot_club')} style={{
                 position: 'absolute',
                 top: `${calib.dot_club.t}%`,
                 left: `${calib.dot_club.l}%`,
                 ...(showCalib ? getDraggableProps('dot_club').style : {}),
                 transform: 'translateY(-50%)',
                 width: `${calib.dot_club.w}%`,
                 height: `${calib.dot_club.h}%`,
                 backgroundColor: '#1877F2',
                 borderRadius: '50%',
                 pointerEvents: showCalib ? 'auto' : 'none'
               }} />
             )}
          </button>

          {/* Terms Checkbox */}
          <input
            id="calib-checkmark"
            {...getDraggableProps('checkmark')}
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            style={{
              position: 'absolute',
              top: `${calib.checkmark.t}%`,
              left: `${calib.checkmark.l}%`,
              width: `${calib.checkbox_agree.w}%`,
              height: `${calib.checkbox_agree.h}%`,
              ...(showCalib ? getDraggableProps('checkmark').style : {}),
              cursor: 'pointer',
              opacity: showCalib ? 0.3 : 0.01,
              zIndex: 10
            }}
            title="I Agree To The Terms And Privacy Policy"
          />
          {agreedToTerms && (
            <div id="calib-checkmark_visual" style={{
              position: 'absolute',
              top: `${calib.checkmark.t}%`,
              left: `${calib.checkmark.l}%`,
              width: `${calib.checkmark.w}%`,
              height: `${calib.checkmark.h}%`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: showCalib ? 'auto' : 'none',
              zIndex: 9
            }}>
              <span className="text-[#1877F2] font-bold" style={{ fontSize: `${calib.checkmark.w}vw` }}>✓</span>
            </div>
          )}

          {/* Back Button */}
          <button
            type="button"
            onClick={prevStep}
            style={{
              position: 'absolute',
              top: '80.5%',
              left: '14.8%',
              width: '15.2%',
              height: '4.8%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              zIndex: 10
            }}
            title="Back"
          />

          {/* Sign In Link Bottom */}
          <Link href="/commander/login" style={{
              position: 'absolute',
              top: '90.5%',
              left: '25%',
              width: '50%',
              height: '5%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              zIndex: 10
          }} title="Sign In" />

          {/* Create Free Account Button */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !agreedToTerms}
            style={{
              position: 'absolute',
              top: '80.5%',
              left: '55.7%',
              width: '29.3%',
              height: '4.8%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              zIndex: 10
            }}
            title="Create Free Account"
          />

          {/* Error Message */}
          {error && (
            <div style={{
              position: 'absolute',
              top: '87%',
              left: '18%',
              width: '64%',
              textAlign: 'center',
              color: '#F02849',
              backgroundColor: 'rgba(0,0,0,0.8)',
              padding: '4px',
              borderRadius: '4px',
              fontSize: '14px',
              zIndex: 10
            }}>
              {error}
            </div>
          )}

        </div>
      </div>
      </>
    );
  }


  if (step === 4) {
    const displayPlan = selectedTier === 'home_game' ? 'Home Games' : 
                        selectedTier === 'charity' ? 'Charity' : 'Clubs';

    return (
      <div className="w-screen h-screen relative overflow-hidden font-rajdhani bg-black">
        <Head>
          <title>Club Commander - Registration Complete</title>
          <meta name="robots" content="noindex" />
        </Head>

        <div className="relative w-full h-full z-10">
          {/* Stretch the image to fill the screen */}
          <img 
            src="/images/commander/register-step4-bg.jpg" 
            className="absolute inset-0 w-full h-full object-fill pointer-events-none" 
            alt="Registration Complete Background" 
          />

          {/* Login Email Data */}
          <div style={{
            position: 'absolute',
            top: '57.8%',
            left: '28%',
            color: '#E4E6EB',
            fontSize: 'min(17px, 3vw)',
            fontFamily: 'Inter, sans-serif',
            zIndex: 10
          }}>
            {ownerEmail}
          </div>

          {/* Venue ID Data */}
          <div style={{
            position: 'absolute',
            top: '69.5%',
            left: '28%',
            color: '#E4E6EB',
            fontSize: 'min(17px, 3vw)',
            fontFamily: 'Inter, sans-serif',
            zIndex: 10
          }}>
            {registrationResult?.venueId || 'N/A'}
          </div>

          {/* Plan Data */}
          <div style={{
            position: 'absolute',
            top: '73%',
            left: '28%',
            color: '#E4E6EB',
            fontSize: 'min(17px, 3vw)',
            fontFamily: 'Inter, sans-serif',
            zIndex: 10
          }}>
            {displayPlan} {COMMANDER_FREE_MODE ? `(${COMMANDER_FREE_TAGLINE})` : '(14-day trial)'}
          </div>

          {/* Sign In Button */}
          <Link href="/commander/login" style={{
              position: 'absolute',
              top: '78.5%',
              left: '14%',
              width: '72%',
              height: '6.5%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              zIndex: 10
          }} title="Sign In To Dashboard" />

          {/* Sign In Link Bottom */}
          <Link href="/commander/login" style={{
              position: 'absolute',
              top: '90.5%',
              left: '25%',
              width: '50%',
              height: '5%',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              zIndex: 10
          }} title="Sign In" />
        </div>
      </div>
    );
  }

  // Original return for steps 3-4


  return (
    <div className="min-h-screen bg-[#18191A]">
      <Head><title>{headerTitle}</title></Head>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Logo */}
        <div className="text-center mb-6">
          <Image src="/images/club-commander-logo.jpg" alt="Club Commander" width={1584} height={656} className="w-full max-w-md mx-auto rounded-lg" />
          <p className="text-[#B0B3B8] mt-4">{headerSubtitle}</p>
          {/* Entry-port indicator - same signup screen is reached from
              Social Pages, Poker Near Me, and Club Commander. Surface the
              `from` query so users see continuity across surfaces. */}
          {isHomeGameFlow && router?.query?.from && (() => {
            const from = router.query.from;
            const label = from === 'social_pages'  ? 'Continuing from Social Pages'
                        : from === 'poker_near_me' ? 'Continuing from Poker Near Me'
                        : from === 'club_commander'? 'Continuing from Club Commander'
                        : null;
            if (!label) return null;
            return (
              <div className="inline-flex items-center gap-2 mt-3 px-3 py-1 rounded-full bg-[#1877F2]/10 border border-[#1877F2]/30">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1877F2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                <span className="text-xs font-semibold text-[#1877F2] uppercase tracking-wide">{label}</span>
              </div>
            );
          })()}
        </div>

        {/* Progress Steps */}
        <div className="flex justify-between items-center mb-8 relative">
          <div className="absolute top-5 left-0 right-0 h-0.5 bg-[#3A3B3C]">
            <div className="h-full bg-[#1877F2] transition-all" style={{ width: `${((displayStep - 1) / (steps.length - 1)) * 100}%` }} />
          </div>
          {steps.map((label, idx) => (
            <div key={label} className="relative z-10 flex flex-col items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${displayStep > idx + 1 ? 'bg-[#31A24C] text-white' : displayStep === idx + 1 ? 'bg-[#1877F2] text-white ring-4 ring-[#1877F2]/30' : 'bg-[#3A3B3C] text-[#8A8D91]'}`}>{idx + 1}</div>
              <span className={`text-xs mt-2 ${displayStep === idx + 1 ? 'text-[#E4E6EB]' : 'text-[#8A8D91]'}`}>{label}</span>
            </div>
          ))}
        </div>

        {/* Form Card */}
        <div className="bg-[#242526] rounded-xl p-8 border border-[#3A3B3C]">
          {error && <div className="mb-6 p-4 bg-[#F02849]/10 border border-[#F02849]/30 rounded-lg text-[#F02849]">{error}</div>}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* Step 1: Create Account                                     */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-[#E4E6EB] mb-6">Create Your Account</h2>
              <p className="text-sm text-[#8A8D91] mb-4">
                {isHomeGameFlow
                  ? 'First, Set Up Your Login. Next You’ll Add Your Home Game Details.'
                  : 'First, Set Up Your Login Credentials. You Can Add Venue Details Next.'}
              </p>

              <div><label className="block text-sm text-[#B0B3B8] mb-1.5">Your Full Name *</label><input type="text" value={ownerName} onChange={e => setOwnerName(e.target.value)} className={inputClass} placeholder={isHomeGameFlow ? 'Host Name' : 'Owner Or Manager Name'} /></div>
              <div><label className="block text-sm text-[#B0B3B8] mb-1.5">Email Address *</label><input type="email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} className={inputClass} placeholder="This Will Be Your Login Email" /></div>
              <div><label className="block text-sm text-[#B0B3B8] mb-1.5">Phone Number</label><input type="tel" value={ownerPhone} onChange={e => setOwnerPhone(e.target.value)} className={inputClass} placeholder="Optional" /></div>

              {/* Existing account toggle */}
              <div className="flex items-center gap-3 p-4 bg-[#3A3B3C]/40 rounded-lg">
                <input type="checkbox" id="existingAccount" checked={existingAccount} onChange={e => setExistingAccount(e.target.checked)} className="w-4 h-4 rounded" />
                <label htmlFor="existingAccount" className="text-sm text-[#B0B3B8]">I Already Have A Smarter.Poker Account With This Email</label>
              </div>

              {!existingAccount && (
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm text-[#B0B3B8] mb-1.5">Create Password *</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} className={inputClass} placeholder="Min 8 Characters" /></div>
                  <div><label className="block text-sm text-[#B0B3B8] mb-1.5">Confirm Password *</label><input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={inputClass} /></div>
                </div>
              )}

              {/* Promo Code */}
              <div className="border-t border-[#3A3B3C] pt-6 mt-6">
                <label className="block text-sm text-[#B0B3B8] mb-1.5">Promo Code (Optional)</label>
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={promoCode}
                      onChange={e => { setPromoCode(e.target.value); setPromoStatus(null); setPromoMessage(''); }}
                      className={inputClass}
                      placeholder="Enter Promo Code"
                    />
                    {promoStatus === 'valid' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#31A24C] text-lg">✓</span>}
                    {promoStatus === 'invalid' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#F02849] text-lg">✗</span>}
                    {promoStatus === 'checking' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A8D91] text-sm">...</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => validatePromoCode(promoCode)}
                    disabled={!promoCode.trim() || promoStatus === 'checking'}
                    className="px-5 py-3 bg-[#1877F2] hover:bg-[#1664d9] text-white rounded-lg font-semibold text-sm disabled:opacity-40"
                  >
                    Apply
                  </button>
                </div>
                {promoMessage && (
                  <p className={`text-sm mt-2 ${promoStatus === 'valid' ? 'text-[#31A24C]' : 'text-[#F02849]'}`}>
                    {promoMessage}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* Step 2: Venue / Home Game Details                          */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-[#E4E6EB] mb-6">
                {isHomeGameFlow ? 'Home Game Details' : 'Venue Details'}
              </h2>
              <p className="text-sm text-[#8A8D91] mb-4">
                {isHomeGameFlow
                  ? 'Tell Us About Your Home Game. Only Name, City, And State Are Required - You Can Add More Details After Setup.'
                  : 'Tell Us About Your Poker Room. Address Is Optional For Home Games And Charity Events.'}
              </p>

              <div>
                <label className="block text-sm text-[#B0B3B8] mb-1.5">
                  {isHomeGameFlow ? 'Home Game Name *' : 'Club/Venue Name *'}
                </label>
                <input type="text" name="name" value={clubInfo.name} onChange={handleClubInfoChange} className={inputClass} placeholder={isHomeGameFlow ? 'e.g. Saturday Night Hold’em' : 'Enter Your Venue Name'} />
              </div>

              {!isHomeGameFlow && (
                <div>
                  <label className="block text-sm text-[#B0B3B8] mb-1.5">Street Address{isAddressRequired ? ' *' : ' (Optional)'}</label>
                  <input type="text" name="address" value={clubInfo.address} onChange={handleClubInfoChange} className={inputClass} placeholder={isAddressRequired ? 'Required For Club Tier' : 'Optional For Home Games & Charity'} />
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-[#B0B3B8] mb-1.5">City{(isAddressRequired || isHomeGameFlow) ? ' *' : ''}</label>
                  <input type="text" name="city" value={clubInfo.city} onChange={handleClubInfoChange} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm text-[#B0B3B8] mb-1.5">State{(isAddressRequired || isHomeGameFlow) ? ' *' : ''}</label>
                  <select name="state" value={clubInfo.state} onChange={handleClubInfoChange} className={inputClass}>
                    <option value="">Select</option>
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-[#B0B3B8] mb-1.5">ZIP{isAddressRequired ? ' *' : ''}</label>
                  <input type="text" name="zip" value={clubInfo.zip} onChange={handleClubInfoChange} className={inputClass} />
                </div>
              </div>

              {!isHomeGameFlow && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm text-[#B0B3B8] mb-1.5">Venue Phone</label><input type="tel" name="phone" value={clubInfo.phone} onChange={handleClubInfoChange} className={inputClass} placeholder="If Different From Your Phone" /></div>
                    <div><label className="block text-sm text-[#B0B3B8] mb-1.5">Website</label><input type="url" name="website" value={clubInfo.website} onChange={handleClubInfoChange} className={inputClass} /></div>
                  </div>
                  <div><label className="block text-sm text-[#B0B3B8] mb-1.5">Number Of Tables</label><input type="number" name="tables" value={clubInfo.tables} onChange={handleClubInfoChange} className={inputClass} /></div>
                </>
              )}

              <div>
                <label className="block text-sm text-[#B0B3B8] mb-2">Games Offered</label>
                <div className="flex flex-wrap gap-2">
                  {['NLH', 'PLO', 'PLO8', 'Limit HE', 'Stud', 'Mixed', 'Tournaments'].map(game => (
                    <button key={game} type="button" onClick={() => handleGameToggle(game)} className={`px-4 py-2 rounded-full text-sm ${clubInfo.gamesOffered.includes(game) ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'}`}>{game}</button>
                  ))}
                </div>
              </div>

              {/* Inline terms + plan summary when tier is locked (step 3 is skipped) */}
              {lockedTier && (
                <div className="border-t border-[#3A3B3C] pt-5 mt-5 space-y-4">
                  <div className="p-4 bg-[#31A24C]/10 border border-[#31A24C]/30 rounded-xl text-[#E4E6EB] text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold mb-1">
                          {TIERS[lockedTier].name} Tier - {COMMANDER_FREE_MODE ? COMMANDER_FREE_TAGLINE : '100% Free To Start'}
                        </div>
                        <div className="text-[#B0B3B8] text-xs">
                          {COMMANDER_FREE_MODE
                            ? 'All Commander features are free while in beta. No credit card required.'
                            : 'No credit card required. You can upgrade anytime.'}
                        </div>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <span className="text-2xl font-bold">{displayTierPrice(lockedTier)}</span>
                        {!COMMANDER_FREE_MODE && (
                          <span className="text-[#8A8D91]">/mo after trial</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" id="terms-inline" checked={agreedToTerms} onChange={e => setAgreedToTerms(e.target.checked)} className="mt-1 w-4 h-4 rounded" />
                    <label htmlFor="terms-inline" className="text-sm text-[#B0B3B8]">
                      I Agree To The <Link href="/terms" className="text-[#1877F2]">Terms</Link> And <Link href="/terms" className="text-[#1877F2]">Privacy Policy</Link>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* Step 3: Select Plan  (skipped when ?tier= locks the plan)  */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {step === 3 && !lockedTier && (
            <div className="space-y-6">
              <h2 className="text-xl font-bold text-[#E4E6EB] mb-6">Select Your Plan</h2>
              <div className="grid gap-4">
                {Object.entries(TIERS || {}).map(([key, tier]) => (
                  <div key={key} onClick={() => setSelectedTier(key)} className={`relative p-5 rounded-xl border-2 cursor-pointer ${selectedTier === key ? 'border-[#1877F2] bg-[#1877F2]/10' : 'border-[#3A3B3C] bg-[#3A3B3C]/30'}`}>
                    {tier.popular && <span className="absolute -top-3 left-4 px-3 py-1 bg-[#1877F2] text-white text-xs rounded-full">Most Popular</span>}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selectedTier === key ? 'border-[#1877F2] bg-[#1877F2]' : 'border-[#8A8D91]'}`}>{selectedTier === key && <span className="text-white text-xs">✓</span>}</div>
                        <div><div className="font-semibold text-[#E4E6EB]">{tier.name}</div><div className="text-sm text-[#B0B3B8]">{tier.tables} tables, {tier.staff} staff</div></div>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-bold text-[#E4E6EB]">{displayTierPrice(key)}</span>
                        <span className="text-[#8A8D91]">{displayTierPeriod(key)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-4 bg-[#31A24C]/10 border border-[#31A24C]/30 rounded-xl text-center text-[#E4E6EB]">
                <span className="font-semibold">{displayTierTrialTagline()}</span> - {COMMANDER_FREE_SUBTEXT}
              </div>
              <div className="flex items-start gap-3"><input type="checkbox" id="terms" checked={agreedToTerms} onChange={e => setAgreedToTerms(e.target.checked)} className="mt-1 w-4 h-4 rounded" /><label htmlFor="terms" className="text-sm text-[#B0B3B8]">I Agree To The <Link href="/terms" className="text-[#1877F2]">Terms</Link> And <Link href="/terms" className="text-[#1877F2]">Privacy Policy</Link></label></div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* Step 4: Complete                                            */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {step === 4 && (
            <div className="text-center space-y-6">
              <div className="w-20 h-20 bg-[#31A24C] rounded-full flex items-center justify-center mx-auto text-4xl text-white">✓</div>
              <h2 className="text-2xl font-bold text-[#E4E6EB]">
                {isHomeGameFlow ? 'You’re All Set!' : 'Welcome To Club Commander!'}
              </h2>
              <p className="text-[#B0B3B8]">
                {isHomeGameFlow
                  ? 'Your Home Games Host Account Is Active. Let’s Create Your First Home Game.'
                  : (COMMANDER_FREE_MODE
                      ? `Your Account Has Been Created. ${COMMANDER_FREE_TAGLINE} - All Features Unlocked.`
                      : 'Your Account Has Been Created. Your 14-day Trial Starts Now.')}
              </p>
              <div className="bg-[#1877F2]/10 border border-[#1877F2]/30 rounded-xl p-4 text-left">
                <p className="text-sm text-[#B0B3B8] mb-1">Login Email:</p>
                <p className="text-[#E4E6EB] font-semibold">{ownerEmail}</p>
                <p className="text-xs text-[#8A8D91] mt-2">
                  {existingAccount
                    ? 'Sign in using Google or your existing Smarter.Poker password.'
                    : 'Use this email and your password to sign in at the login page.'}
                </p>
              </div>
              {registrationResult && !isHomeGameFlow && (
                <div className="bg-[#3A3B3C] rounded-xl p-5 text-left">
                  <div className="flex justify-between mb-2">
                    <span className="text-[#8A8D91]">Venue ID:</span>
                    <span className="text-[#E4E6EB] font-mono">{registrationResult.venueId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8A8D91]">Plan:</span>
                    <span className="text-[#E4E6EB]">
                      {selectedTier}{COMMANDER_FREE_MODE ? ` (${COMMANDER_FREE_TAGLINE})` : ' (14-day trial)'}
                    </span>
                  </div>
                </div>
              )}
              <button
                onClick={handleCompletionCta}
                className="w-full py-4 bg-[#1877F2] hover:bg-[#1664d9] text-white rounded-xl font-semibold text-lg"
              >
                {queryReturn
                  ? (isHomeGameFlow ? 'Continue To Create Your Home Game' : 'Continue')
                  : 'Sign In To Dashboard'}
              </button>
            </div>
          )}

          {/* Navigation Buttons */}
          {step === 1 && (
            <div className="flex justify-end mt-8">
              <button onClick={nextStep} className="px-8 py-3 bg-[#1877F2] hover:bg-[#1664d9] text-white rounded-lg font-semibold">
                {isHomeGameFlow ? 'Continue To Home Game Details' : 'Continue To Venue Details'}
              </button>
            </div>
          )}
          {step === 2 && (
            <div className="flex justify-between mt-8">
              <button onClick={prevStep} className="px-6 py-3 rounded-lg bg-[#3A3B3C] text-[#E4E6EB] hover:bg-[#4E4F50]">Back</button>
              <button
                onClick={nextStep}
                disabled={loading || (lockedTier && !agreedToTerms)}
                className="px-8 py-3 bg-[#1877F2] hover:bg-[#1664d9] text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {lockedTier
                  ? (loading ? 'Creating...' : (isHomeGameFlow ? 'Create My Home Games Host Account' : 'Create Account'))
                  : 'Continue To Plan Selection'}
              </button>
            </div>
          )}
          {step === 3 && !lockedTier && (
            <div className="flex justify-between mt-8">
              <button onClick={prevStep} className="px-6 py-3 rounded-lg bg-[#3A3B3C] text-[#E4E6EB] hover:bg-[#4E4F50]">Back</button>
              <button onClick={handleSubmit} disabled={loading || !agreedToTerms} className="px-8 py-3 bg-[#1877F2] hover:bg-[#1664d9] text-white rounded-lg font-semibold disabled:opacity-50">
                {loading
                  ? 'Creating...'
                  : (COMMANDER_FREE_MODE ? 'Create Free Account' : 'Start Free Trial')}
              </button>
            </div>
          )}
        </div>

        {/* Already have account link */}
        <div className="text-center mt-6">
          <Link href="/commander/login" className="text-[#B0B3B8] hover:text-[#E4E6EB]">
            Already Have A Club Commander Account? <span className="text-[#1877F2]">Sign In</span>
          </Link>
        </div>

        <p className="text-center text-[#65676B] text-xs mt-6">Powered By SMARTER.POKER</p>
      </div>
    </div>
  );
}
