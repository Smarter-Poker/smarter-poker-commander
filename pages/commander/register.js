import { useState, useEffect, useMemo } from 'react';
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
  const [selectedTier, setSelectedTier] = useState(lockedTier || 'charity');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

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
    } catch { /* corrupted blob — treat as signed-out */ }

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
    // send them straight through — no need to re-register.
    let cancelled = false;
    const finish = () => { if (!cancelled) setPreCheckDone(true); };

    fetch('/api/commander/check-access', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'include',
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`)))
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
      .catch(e => { console.warn('[App] Handled promise rejection:', e?.message || e); });

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

      const res = await fetch('/api/commander/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      if (!res.ok) throw new Error('Request failed');
      clearTimeout(fetchTimeout);
      const data = await res.json();
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

  return (
    <div className="min-h-screen bg-[#18191A]">
      <Head><title>{headerTitle}</title></Head>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Logo */}
        <div className="text-center mb-6">
          <Image src="/images/club-commander-logo.jpg" alt="Club Commander" width={1584} height={656} className="w-full max-w-md mx-auto rounded-lg" />
          <p className="text-[#B0B3B8] mt-4">{headerSubtitle}</p>
          {/* Entry-port indicator — same signup screen is reached from
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
