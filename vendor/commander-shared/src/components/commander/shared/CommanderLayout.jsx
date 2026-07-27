/**
 * Commander Layout — Global Header Component
 * Provides the consistent Club Commander top bar across ALL pages:
 *   [☰ Hamburger] [← Back] .............. [CLUB COMMANDER / Venue Name]
 * 
 * Tier-gated sidebar: items show 🔒 when locked for current tier.
 * 
 * Props:
 *   title       — page title for <Head> tag
 *   backHref    — where Back button navigates (default: /commander/dashboard)
 *   hideBack    — set true on dashboard to hide the back button
 *   children    — page content
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { X, Users, Clock, Layout, Map, Bell, Trophy,
  Monitor, DollarSign, Gift, Calendar, Tv, Activity, BarChart3,
  AlertTriangle, PlusCircle, Lock, Upload, QrCode, Settings, LogOut, Globe, Crown, FileText, Shield, AlertCircle
} from 'lucide-react';
import CommanderErrorBoundary from './CommanderErrorBoundary';
import FloorCallAlert from './FloorCallAlert';
import { canAccessRoute, getUpgradeTier, getTierConfig } from '../../../lib/commander/tierConfig';
import { canRoleAccessRoute, isSensitiveRoute } from '../../../lib/commander/auth';
import useClubBranding from '../../../lib/commander/useClubBranding';
import { supabase } from '../../../lib/supabase';
import CommanderEffectsProvider from './CommanderEffectsProvider';
import PushNotificationProvider from './PushNotificationProvider';
import useBusBridge from '../../../lib/commander/useBusBridge';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/commander/dashboard', icon: Layout },
  { divider: true },
  { label: 'Waitlist Desk', href: '/commander/waitlist/desk', icon: Clock },
  { label: 'Members', href: '/commander/members', icon: Users },
  { label: 'Tables', href: '/commander/tables', icon: Layout },
  { label: 'Floor Map', href: '/commander/floor', icon: Map },
  { label: 'Floor Calls', href: '/commander/floor-calls', icon: Bell },
  { divider: true },
  { label: 'Tournaments', href: '/commander/tournaments', icon: Trophy },
  { label: 'Dealers', href: '/commander/dealers', icon: Users },
  { label: 'Kiosk', href: '/commander/kiosk', icon: Monitor },
  { divider: true },
  { label: 'Comps', href: '/commander/comps', icon: DollarSign },
  { label: 'Promotions', href: '/commander/promotions', icon: Gift },
  { label: 'Staff Schedule', href: '/commander/schedule', icon: Calendar },
  { label: 'TV Displays', href: '/commander/displays', icon: Tv },
  { label: 'Activity Feed', href: '/commander/activity', icon: Activity },
  { label: 'Reports', href: '/commander/reports', icon: BarChart3 },
  { label: 'Incidents', href: '/commander/incidents', icon: AlertTriangle },
  { divider: true },
  { label: 'Open Cash Game', href: '/commander/open-game', icon: PlusCircle },
  { label: 'Close Day', href: '/commander/close-day', icon: Lock },
  { label: 'Live Arena Ledger', href: '/commander/arena-ledger', icon: Shield },
  { label: 'Member Import', href: '/commander/member-import', icon: Upload },
  { label: 'Membership Plans', href: '/commander/membership-plans', icon: Crown },
  { label: 'QR Code', href: '/commander/qr-code', icon: QrCode },
  { label: 'Settings', href: '/commander/settings', icon: Settings },
];

export default function CommanderLayout({ children, title, backHref = '/commander/dashboard', hideBack }) {
  // ── Cross-tab EventBus bridge ──
  useBusBridge();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [staff, setStaff] = useState(null);
  const [showClubPagePopup, setShowClubPagePopup] = useState(false);
  const [clubPageId, setClubPageId] = useState(null); // Set when venue has an existing club page
  const [showUpgradeModal, setShowUpgradeModal] = useState(null); // null or { label, requiredTier }
  const [currentTier, setCurrentTier] = useState('home_game');

  // ── PIN SECURITY GATE STATE ──
  const [routeBlocked, setRouteBlocked] = useState(true); // Default BLOCKED until verified
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [gateGranted, setGateGranted] = useState(false);
  const [pinAttempts, setPinAttempts] = useState(0);
  const [pinLockout, setPinLockout] = useState(false);

  // Session expiry warning
  const [sessionExpiring, setSessionExpiring] = useState(null); // null or { minutesLeft }
  useEffect(() => {
    const handler = (e) => {
      setSessionExpiring(e.detail);
      // Auto-logout when session has already expired (0 min left)
      if (e.detail?.minutesLeft <= 0 && typeof window !== 'undefined') {
        try { sessionStorage.setItem('commander_return_url', window.location.pathname); } catch (e) { console.warn('[App] Handled exception:', e); }
        window.location.href = '/commander/login?expired=1';
      }
    };
    window.addEventListener('commander:session-expiring', handler);
    return () => window.removeEventListener('commander:session-expiring', handler);
  }, []);

  // ── OFFLINE DETECTION ──
  const [isOffline, setIsOffline] = useState(false);
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    // Check initial state
    if (typeof navigator !== 'undefined' && !navigator.onLine) setIsOffline(true);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('commander_staff');
      if (stored) setStaff(JSON.parse(stored));
    } catch (e) { console.warn('[App] Handled exception:', e); }
    try {
      const sub = JSON.parse(localStorage.getItem('commander_subscription') || '{}');
      if (sub.tier) setCurrentTier(sub.tier);
    } catch (e) { console.warn('[App] Handled exception:', e); }
    setStaffLoaded(true);

    // Track Commander navigation history in sessionStorage
    try {
      const path = window.location.pathname;
      if (path.startsWith('/commander')) {
        const hist = JSON.parse(sessionStorage.getItem('commander_nav_history') || '[]');
        // Only add if different from the last entry
        if (hist[hist.length - 1] !== path) {
          hist.push(path);
          // Keep only last 20 entries
          if (hist.length > 20) hist.shift();
          sessionStorage.setItem('commander_nav_history', JSON.stringify(hist));
        }
      }
    } catch (e) { console.warn('[App] Handled exception:', e); }
  }, []);

  // ── ROUTE GUARD: Check if staff role can access this page ──
  useEffect(() => {
    if (!staffLoaded) return; // Wait until localStorage read completes
    const path = router.asPath.split('?')[0]; // Strip query params
    // Skip guard for dashboard, login, index
    if (path === '/commander/dashboard' || path === '/commander/login' || path === '/commander') {
      setRouteBlocked(false);
      return;
    }
    // If no staff session exists, block and require PIN
    if (!staff || !staff.role) {
      setRouteBlocked(true);
      setPinInput('');
      setPinError('');
      return;
    }
    const role = staff.role;
    const hasAccess = canRoleAccessRoute(role, path);
    const unlocked = sessionStorage.getItem(`pin_unlock_${path}`);
    const sensitive = isSensitiveRoute(path);

    // Check if security gate is enabled (defaults to ON if not set)
    const securityGateSetting = localStorage.getItem('commander_security_gate');
    const securityGateOn = securityGateSetting !== 'off';

    // For SENSITIVE routes: require PIN unlock only if security gate is ON.
    // When gate is OFF (owner disabled it), fall through to standard role check.
    if (sensitive && securityGateOn) {
      if (unlocked === 'true') {
        setRouteBlocked(false);
        setGateGranted(true);
      } else {
        setRouteBlocked(true);
        setGateGranted(false);
        setPinInput('');
        setPinError('');
      }
      return;
    }

    // For NON-sensitive routes: standard role-based check
    if (hasAccess || unlocked === 'true') {
      setRouteBlocked(false);
      setGateGranted(true);
    } else {
      setRouteBlocked(true);
      setGateGranted(false);
      setPinInput('');
      setPinError('');
    }
  }, [staff, staffLoaded, router.asPath]);

  // Club Page creation reminder popup
  useEffect(() => {
    if (!staff || !staff.venue_id) return;

    const checkClubPageReminder = async () => {
      try {
        // Check if already dismissed today
        const dismissKey = 'club_page_popup_dismissed';
        const lastDismissed = localStorage.getItem(dismissKey);
        if (lastDismissed) {
          const dismissDate = new Date(lastDismissed);
          const now = new Date();
          // If dismissed today, skip
          if (dismissDate.toDateString() === now.toDateString()) return;
        }

        // Check if account is at least 1 hour old (use subscription created_at if available)
        try {
          const sub = JSON.parse(localStorage.getItem('commander_subscription') || '{}');
          if (sub.created_at) {
            const createdAt = new Date(sub.created_at);
            const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
            if (createdAt > hourAgo) return; // Less than 1 hour old, skip
          }
        } catch (e) { console.warn('[App] Handled exception:', e); }

        // Check if user already has a club page
        const res = await fetch(`/api/social/pages?linked_venue_id=${staff.venue_id}`);
        const json = await res.json();
        if (json.success && json.data && json.data.length > 0) {
          // Already has a page, no need to remind — store the page ID for hamburger link
          setClubPageId(json.data[0].id);
          return;
        }

        // Show the popup
        setShowClubPagePopup(true);
      } catch (e) {
        console.warn('[Commander] Club page popup check error:', e);
      }
    };

    // Delay check to not interfere with page load
    const timer = setTimeout(checkClubPageReminder, 2000);
    return () => clearTimeout(timer);
  }, [staff]);

  const dismissClubPagePopup = () => {
    setShowClubPagePopup(false);
    localStorage.setItem('club_page_popup_dismissed', new Date().toISOString());
  };

  const handleLogout = async () => {
    // HARDENED: Sign out of Supabase first to kill the auth session cookie
    try { await supabase.auth.signOut(); } catch { /* non-critical */ }
    // Clear ALL commander-related localStorage keys
    localStorage.removeItem('commander_staff');
    localStorage.removeItem('commander_venue');
    localStorage.removeItem('commander_subscription');
    localStorage.removeItem('commander_remember');
    localStorage.removeItem('commander_security_gate');
    localStorage.removeItem('commander_login_origin');
    localStorage.removeItem('commander_branding');
    // Clear all PIN unlock grants from this session
    try {
      Object.keys(sessionStorage || {}).forEach(k => {
        if (k.startsWith('pin_unlock_')) sessionStorage.removeItem(k);
      });
    } catch (e) { console.warn('[App] Handled exception:', e); }
    // Bulletproof redirect
    window.location.href = '/commander/login';
  };

  // ── PIN GATE VERIFICATION ──
  const handlePinSubmit = async () => {
    if (pinLockout) {
      setPinError('Too many attempts — wait 30 seconds');
      return;
    }
    if (!pinInput || pinInput.length < 4) {
      setPinError('Enter at least 4 digits');
      return;
    }
    // Get venue_id from staff session or localStorage fallback
    let venueId = staff?.venue_id;
    if (!venueId) {
      try {
        const stored = JSON.parse(localStorage.getItem('commander_staff') || '{}');
        venueId = stored.venue_id;
      } catch (e) { console.warn('[App] Handled exception:', e); }
    }
    if (!venueId) {
      setPinError('No venue session — please log in first');
      return;
    }
    setPinLoading(true);
    setPinError('');
    try {
      const res = await fetch('/api/commander/staff/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venueId, pin_code: pinInput }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      if (!res.ok || !data.data?.staff) {
        const nextAttempts = pinAttempts + 1;
        setPinAttempts(nextAttempts);
        if (nextAttempts >= 5) {
          setPinLockout(true);
          setPinError('Too many failed attempts — locked for 30 seconds');
          setTimeout(() => { setPinLockout(false); setPinAttempts(0); setPinError(''); }, 30000);
        } else {
          setPinError(data.error || `Invalid PIN (${5 - nextAttempts} attempts remaining)`);
        }
        setPinLoading(false);
        return;
      }
      // Reset attempts on success
      setPinAttempts(0);
      const verifiedRole = data.data.staff.role;
      const path = router.asPath.split('?')[0];
      if (canRoleAccessRoute(verifiedRole, path)) {
        // Grant access for this session
        sessionStorage.setItem(`pin_unlock_${path}`, 'true');
        setRouteBlocked(false);
        setGateGranted(true);
        setPinInput('');
      } else {
        setPinError(`Access denied — ${verifiedRole} role does not have permission for this page`);
      }
    } catch (e) {
      setPinError('Verification failed — try again');
    } finally {
      setPinLoading(false);
    }
  };

  const handleNavClick = (item) => {
    const allowed = canAccessRoute(currentTier, item.href);
    if (allowed) {
      setMenuOpen(false);
      router.push(item.href);
    } else {
      const upgradeTo = getUpgradeTier(currentTier);
      const upgradeConfig = upgradeTo ? getTierConfig(upgradeTo) : null;
      setShowUpgradeModal({
        label: item.label,
        upgradeTierName: upgradeConfig?.name || 'a higher tier',
        upgradePrice: upgradeConfig?.price || '',
      });
    }
  };

  const venueName = staff?.venue_name || 'Poker Room';
  const currentTierConfig = getTierConfig(currentTier);
  const currentTierLabel = currentTierConfig?.name || 'Home Game';
  const { logoUrl: clubLogoUrl } = useClubBranding();

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        {title && <title>{title} | Club Commander</title>}
      </Head>

      <style>{`
        /* Fonts self-hosted via next/font CSS vars: --font-orbitron, --font-inter */

        /* ── GLOBAL COMMANDER HEADER ── */
        .cmd-global-header {
          display: flex;
          align-items: center;
          padding: 10px 16px;
          background: linear-gradient(180deg, #1a1a1a 0%, #0f0f0f 100%);
          border-bottom: 2px solid #333;
          position: sticky;
          top: 0;
          z-index: 50;
          gap: 10px;
        }
        .cmd-global-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .cmd-global-center {
          flex: 1;
          text-align: center;
          min-width: 0;
        }
        .cmd-global-page-title {
          font-family: 'Orbitron', sans-serif;
          font-size: 11px;
          font-weight: 700;
          color: #FFFFFF;
          letter-spacing: 1.5px;
          text-transform: capitalize;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @media (min-width: 640px) {
          .cmd-global-page-title { font-size: 13px; }
        }
        .cmd-global-right {
          text-align: right;
          flex-shrink: 0;
        }
        .cmd-global-title {
          font-family: 'Orbitron', sans-serif;
          font-size: 14px;
          font-weight: 700;
          color: #fff;
          letter-spacing: 2px;
          text-transform: uppercase;
        }
        @media (min-width: 640px) {
          .cmd-global-title { font-size: 16px; }
        }
        .cmd-global-venue {
          font-size: 28px;
          color: #888;
          margin-top: 2px;
        }

        /* ── HAMBURGER BUTTON ── */
        .cmd-hamburger {
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        .cmd-hamburger:hover {
          transform: scale(1.1);
          filter: brightness(1.2);
        }
        .cmd-hamburger img {
          height: 32px;
          width: auto;
          display: block;
        }

        /* ── BACK IMAGE BUTTON ── */
        .cmd-back-img-btn {
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          display: flex;
          align-items: center;
          transition: all 0.2s;
        }
        .cmd-back-img-btn:hover {
          transform: scale(1.08);
          filter: brightness(1.3);
        }
        .cmd-back-img-btn img {
          height: 32px;
          width: auto;
          display: block;
        }

        /* ── SLIDE-OUT MENU ── */
        .cmd-menu-overlay {
          position: fixed;
          inset: 0;
          z-index: 200;
          background: rgba(0,0,0,0.5);
          animation: cmdMenuFade 0.15s ease;
        }
        @keyframes cmdMenuFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .cmd-menu-panel {
          position: fixed;
          top: 0;
          right: 0;
          z-index: 201;
          width: 280px;
          max-height: 100vh;
          overflow-y: auto;
          background: linear-gradient(180deg, #1a1a1a 0%, #111 100%);
          border-left: 2px solid #444;
          padding: 16px 0;
          animation: cmdMenuSlide 0.2s ease;
        }
        @keyframes cmdMenuSlide {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .cmd-menu-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px 12px;
          border-bottom: 2px solid #333;
          margin-bottom: 8px;
        }
        .cmd-menu-header-text {
          font-family: 'Orbitron', sans-serif;
          font-size: 13px;
          font-weight: 700;
          color: #fff;
          letter-spacing: 1.5px;
          text-transform: uppercase;
        }
        .cmd-menu-close {
          background: none;
          border: none;
          color: #666;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.2s;
        }
        .cmd-menu-close:hover {
          color: #fff;
        }
        .cmd-menu-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 16px;
          background: none;
          border: none;
          color: #ccc;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s;
          text-align: left;
        }
        .cmd-menu-item:hover {
          background: rgba(255,255,255,0.05);
          color: #fff;
        }
        .cmd-menu-item.active {
          color: #22D3EE;
          background: rgba(34,211,238,0.05);
        }
        .cmd-menu-item.locked {
          color: #555;
        }
        .cmd-menu-item.locked:hover {
          color: #777;
          background: rgba(255,255,255,0.02);
        }
        .cmd-menu-item.danger {
          color: #EF4444;
        }
        .cmd-menu-item.danger:hover {
          background: rgba(239,68,68,0.1);
        }
        .cmd-menu-divider {
          height: 2px;
          background: #333;
          margin: 8px 16px;
        }
        .cmd-menu-lock-badge {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          color: #F59E0B;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .cmd-menu-tier-badge {
          padding: 4px 10px 6px;
          margin: 4px 16px 8px;
          border-radius: 8px;
          font-size: 11px;
          font-weight: 600;
          color: #22D3EE;
          background: rgba(34,211,238,0.08);
          border: 2px solid rgba(34,211,238,0.2);
          text-align: center;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }

        /* ── HUB BUTTON (dashboard only) ── */
        .cmd-hub-btn {
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          display: flex;
          align-items: center;
          transition: all 0.2s;
        }
        .cmd-hub-btn:hover {
          transform: scale(1.08);
          filter: brightness(1.2);
        }
        .cmd-hub-btn img {
          height: 32px;
          width: auto;
          display: block;
        }

        /* ── PIN GATE MODAL ── */
        .cmd-pin-gate-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(8px);
        }
        .cmd-pin-gate-modal {
          position: relative;
          background: linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 100%);
          border-radius: 16px;
          width: 90%;
          max-width: 380px;
          padding: 32px 28px;
          box-shadow: 0 12px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1);
          border: 2px solid rgba(239,68,68,0.3);
          text-align: center;
        }
        .cmd-pin-gate-icon {
          width: 64px;
          height: 64px;
          border-radius: 16px;
          background: linear-gradient(135deg, #EF4444, #DC2626);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 16px;
        }
        .cmd-pin-gate-title {
          font-family: 'Orbitron', sans-serif;
          font-size: 18px;
          font-weight: 700;
          color: #fff;
          margin: 0 0 6px;
          letter-spacing: 1px;
        }
        .cmd-pin-gate-subtitle {
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          color: #888;
          margin: 0 0 20px;
          line-height: 1.4;
        }
        .cmd-pin-gate-input {
          width: 100%;
          padding: 14px 16px;
          border-radius: 10px;
          border: 2px solid rgba(255,255,255,0.15);
          background: rgba(0,0,0,0.4);
          color: #fff;
          font-size: 24px;
          font-weight: 700;
          text-align: center;
          letter-spacing: 12px;
          font-family: 'Orbitron', sans-serif;
          outline: none;
          transition: border-color 0.2s;
        }
        .cmd-pin-gate-input:focus {
          border-color: #22D3EE;
        }
        .cmd-pin-gate-input::placeholder {
          color: #444;
          font-size: 14px;
          letter-spacing: 2px;
        }
        .cmd-pin-gate-error {
          color: #EF4444;
          font-size: 12px;
          margin-top: 8px;
          font-family: 'Inter', sans-serif;
        }
        .cmd-pin-gate-btn {
          width: 100%;
          margin-top: 16px;
          padding: 12px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(135deg, #22D3EE, #06B6D4);
          color: #000;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          font-family: 'Inter', sans-serif;
          transition: all 0.2s;
        }
        .cmd-pin-gate-btn:hover {
          filter: brightness(1.1);
          transform: scale(1.02);
        }
        .cmd-pin-gate-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .cmd-pin-gate-back {
          margin-top: 12px;
          padding: 10px;
          border-radius: 10px;
          border: 2px solid rgba(255,255,255,0.12);
          background: transparent;
          color: #888;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          font-family: 'Inter', sans-serif;
          width: 100%;
        }
        .cmd-pin-gate-back:hover {
          color: #ccc;
          border-color: rgba(255,255,255,0.25);
        }
      `}</style>

      <CommanderErrorBoundary>
        {/* ── GLOBAL HEADER BAR ── */}
        <div className="cmd-global-header">
          <div className="cmd-global-left">
            <button className="cmd-hamburger" onClick={() => setMenuOpen(true)}>
              <img src="/images/commander/btn-hamburger.png" alt="Menu" />
            </button>
            {hideBack ? (
              /* Dashboard: show HUB button */
              <button
                className="cmd-hub-btn"
                onClick={() => router.push('/hub')}
                title="Back To Smarter.Poker Hub"
              >
                <img src="/images/btn-hub.png" alt="Hub" />
              </button>
            ) : (
              /* All other pages: show metallic BACK image */
              <button
                className="cmd-back-img-btn"
                onClick={() => router.back()}
                title="Go Back"
              >
                <img src="/images/commander/btn-back.png" alt="Back" />
              </button>
            )}
          </div>
          <div className="cmd-global-center">
            {title && !hideBack && (
              <div className="cmd-global-page-title">
                {title.replace(/\s*\|.*$/, '').replace(/^Commander\s*—\s*/, '')}
              </div>
            )}
          </div>
          <div className="cmd-global-right">
            <div>
              <div className="cmd-global-title">Club Commander</div>
              <div className="cmd-global-venue">{venueName}</div>
            </div>
          </div>
        </div>

        {/* ── OFFLINE DETECTION BANNER ── */}
        {isOffline && (
          <div style={{
            background: 'linear-gradient(90deg, #EF444422, #DC262622)',
            borderBottom: '1px solid #EF444444',
            padding: '8px 16px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <AlertCircle size={16} color="#EF4444" />
            <span style={{ fontSize: 12, color: '#EF4444', fontWeight: 600 }}>
              You are offline — changes will not save until reconnected
            </span>
          </div>
        )}

        {/* ── SESSION EXPIRY WARNING BANNER ── */}
        {sessionExpiring && !isOffline && (
          <div style={{
            background: 'linear-gradient(90deg, #F59E0B22, #EF444422)',
            borderBottom: '1px solid #F59E0B44',
            padding: '8px 16px',
            display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={16} color="#F59E0B" />
              <span style={{ fontSize: 12, color: '#F59E0B', fontWeight: 600 }}>
                Session expires in ~{sessionExpiring.minutesLeft} min — save your work
              </span>
            </div>
            <button onClick={() => setSessionExpiring(null)} style={{
              background: 'none', border: 'none', color: '#F59E0B', cursor: 'pointer', padding: 4,
              fontSize: 16, lineHeight: 1,
            }}>×</button>
          </div>
        )}

        {/* ── HAMBURGER SLIDE-OUT MENU ── */}
        {menuOpen && (
          <>
            <div className="cmd-menu-overlay" onClick={() => setMenuOpen(false)} />
            <div className="cmd-menu-panel">
              <div className="cmd-menu-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {clubLogoUrl ? (
                    <div style={{
                      width: 28, height: 28, borderRadius: 6, overflow: 'hidden',
                      border: '1px solid rgba(255,255,255,0.15)', flexShrink: 0,
                    }}>
                      <img src={clubLogoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  ) : null}
                  <span className="cmd-menu-header-text">{venueName}</span>
                </div>
                <button className="cmd-menu-close" onClick={() => setMenuOpen(false)}>
                  <X size={18} />
                </button>
              </div>
              {/* Tier badge */}
              <div className="cmd-menu-tier-badge">
                {currentTierLabel} Plan
              </div>
              <button
                className="cmd-menu-item"
                style={{ color: '#22D3EE', fontWeight: 600 }}
                onClick={() => { setMenuOpen(false); router.push('/hub'); }}
              >
                <Globe size={18} /> Back To Hub
              </button>
              <div className="cmd-menu-divider" />
              {NAV_ITEMS.map((item, idx) => {
                if (item.divider) return <div key={`d-${idx}`} className="cmd-menu-divider" />;
                const Icon = item.icon;
                const isActive = router.asPath === item.href;
                const isLocked = !canAccessRoute(currentTier, item.href);
                // Role-based filtering: hide items the current role can't access
                const staffRole = staff?.role || 'dealer';
                const isRoleBlocked = !canRoleAccessRoute(staffRole, item.href);
                if (isRoleBlocked) return null; // Don't show in menu at all
                return (
                  <button
                    key={item.href}
                    className={`cmd-menu-item ${isActive ? 'active' : ''} ${isLocked ? 'locked' : ''}`}
                    onClick={() => handleNavClick(item)}
                  >
                    <Icon size={18} /> {item.label}
                    {isLocked && (
                      <span className="cmd-menu-lock-badge">
                        <Lock size={12} /> Upgrade
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="cmd-menu-divider" />
              {/* Dynamic Club Page Link */}
              <button
                className="cmd-menu-item"
                style={{ color: clubPageId ? '#1877F2' : '#31A24C', fontWeight: 600 }}
                onClick={() => {
                  setMenuOpen(false);
                  if (clubPageId) {
                    window.location.href = `/hub/social-media?viewPage=${clubPageId}`;
                  } else {
                    window.location.href = '/hub/social-media?createPage=true';
                  }
                }}
              >
                {clubPageId ? <Globe size={18} /> : <FileText size={18} />}
                {clubPageId ? 'My Club Page' : 'Create Club Page'}
              </button>
              <button className="cmd-menu-item danger" onClick={handleLogout}>
                <LogOut size={18} /> Sign Out
              </button>
            </div>
          </>
        )}

        {/* ── UPGRADE MODAL ── */}
        {showUpgradeModal && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={() => setShowUpgradeModal(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)' }} />
            <div style={{
              position: 'relative', background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 100%)',
              borderRadius: 16, width: '90%', maxWidth: 400, padding: 28,
              boxShadow: '0 12px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
              border: '2px solid rgba(255,255,255,0.12)'
            }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg, #F59E0B, #EF4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Crown size={28} color="#fff" />
              </div>
              <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800, color: '#fff', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
                Upgrade Required
              </h2>
              <p style={{ margin: '0 0 20px', fontSize: 14, color: '#999', textAlign: 'center', lineHeight: 1.5, fontFamily: 'Inter, sans-serif' }}>
                <strong style={{ color: '#F59E0B' }}>{showUpgradeModal.label}</strong> requires the{' '}
                <strong style={{ color: '#22D3EE' }}>{showUpgradeModal.upgradeTierName}</strong> plan
                {showUpgradeModal.upgradePrice && <> (${showUpgradeModal.upgradePrice}/mo)</>}.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  onClick={() => {
                    setShowUpgradeModal(null);
                    setMenuOpen(false);
                    router.push('/commander/settings?tab=subscription');
                  }}
                  style={{
                    padding: '12px 24px', borderRadius: 10, border: 'none',
                    background: 'linear-gradient(135deg, #F59E0B, #EF4444)', color: '#fff',
                    fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                    boxShadow: '0 4px 16px rgba(245,158,11,0.4)'
                  }}
                >
                  Upgrade Plan
                </button>
                <button
                  onClick={() => setShowUpgradeModal(null)}
                  style={{
                    padding: '10px 20px', borderRadius: 10, border: '2px solid rgba(255,255,255,0.15)',
                    background: 'transparent', color: '#888',
                    fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'Inter, sans-serif'
                  }}
                >
                  Maybe Later
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── CLUB PAGE CREATION POPUP ── */}
        {showClubPagePopup && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={dismissClubPagePopup} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)' }} />
            <div style={{
              position: 'relative', background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 100%)',
              borderRadius: 16, width: '90%', maxWidth: 440, padding: 28,
              boxShadow: '0 12px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
              border: '2px solid rgba(255,255,255,0.12)'
            }}>
              {/* Header icon */}
              <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg, #1877F2, #42B72A)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="18" rx="2" />
                  <path d="M8 21V3" />
                  <path d="M16 3v18" />
                </svg>
              </div>
              <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, color: '#fff', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>Create Your Club Page</h2>
              <p style={{ margin: '0 0 20px', fontSize: 14, color: '#999', textAlign: 'center', lineHeight: 1.5, fontFamily: 'Inter, sans-serif' }}>
                Set up a public page for <strong style={{ color: '#ddd' }}>{venueName}</strong> on Smarter.Poker Social. Attract new players and keep your regulars updated.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button onClick={() => { dismissClubPagePopup(); window.location.href = '/hub/social-media?createPage=true'; }} style={{
                  padding: '12px 24px', borderRadius: 10, border: 'none',
                  background: 'linear-gradient(135deg, #1877F2, #166FE5)', color: '#fff',
                  fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                  boxShadow: '0 4px 16px rgba(24,119,242,0.4)'
                }}>Create Club Page</button>
                <button onClick={dismissClubPagePopup} style={{
                  padding: '10px 20px', borderRadius: 10, border: '2px solid rgba(255,255,255,0.15)',
                  background: 'transparent', color: '#888',
                  fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'Inter, sans-serif'
                }}>Remind Me Later</button>
              </div>
            </div>
          </div>
        )}

        {/* ── PIN SECURITY GATE ── */}
        {routeBlocked && (
          <div className="cmd-pin-gate-overlay">
            <div className="cmd-pin-gate-modal">
              <div className="cmd-pin-gate-icon">
                <Lock size={32} color="#fff" />
              </div>
              <h2 className="cmd-pin-gate-title">ACCESS RESTRICTED</h2>
              <p className="cmd-pin-gate-subtitle">
                This page requires elevated permissions.<br />
                Enter an authorized PIN to continue.
              </p>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                className="cmd-pin-gate-input"
                placeholder="• • • •"
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value.replace(/\D/g, ''));
                  setPinError('');
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handlePinSubmit(); }}
                autoFocus
              />
              {pinError && <div className="cmd-pin-gate-error">{pinError}</div>}
              <button
                className="cmd-pin-gate-btn"
                onClick={handlePinSubmit}
                disabled={pinLoading || pinInput.length < 4}
              >
                {pinLoading ? 'Verifying...' : 'Unlock'}
              </button>
              <button
                className="cmd-pin-gate-back"
                onClick={() => router.push('/commander/dashboard')}
              >
                ← Back to Dashboard
              </button>
            </div>
          </div>
        )}

        {/* ── FLOOR CALL REAL-TIME ALERT ── */}
        {staff?.venue_id && <FloorCallAlert venueId={staff.venue_id} />}

        {/* ── PAGE CONTENT (hidden when route is blocked) ── */}
        {routeBlocked ? null : (
          <PushNotificationProvider>
            <CommanderEffectsProvider>
              {children}
            </CommanderEffectsProvider>
          </PushNotificationProvider>
        )}
      </CommanderErrorBoundary>
    </>
  );
}
