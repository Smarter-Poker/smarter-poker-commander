/**
 * Commander Staff Dashboard - 4-Card Main Menu
 * Industrial metal card interface with sub-feature navigation
 * NO EMOJIS - Lucide icons only
 */
import { useState, useEffect, useCallback } from 'react';
import { busEmit } from '../../src/engine/EventBus';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { ArrowLeft, Lock, Crown, StopCircle } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { supabase } from '../../src/lib/supabase';
// Dashboard uses real-time sync primarily to instantly reflect hard stop or setting changes
import { canAccessRoute, getUpgradeTier, getTierConfig } from '../../src/lib/commander/tierConfig';
// 2026-08-14 vendor-drift fix: import via the local override, which re-exports
// canRoleAccessRoute from the shared package. The old "client-safe shared
// module" rationale is obsolete - since the 2026-08-07 session-signing
// hardening the vendor module itself imports node crypto, so both import
// paths pull equivalent module graphs, and the direct vendor import bypassed
// the override (the exact class the CI vendor drift guard now blocks).
import { canRoleAccessRoute } from '../../src/lib/commander/auth';
import { useCommanderSync } from '../../src/lib/commander/useCommanderSync';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';

/* ─────────────────────────────────────────────────
   CARD DEFINITIONS - each card has sub-features
   that link to pages within Club Commander
   ───────────────────────────────────────────────── */
const CARDS = [
  {
    id: 'waitlist',
    title: 'Waitlist',
    subtitle: 'Players, Memberships, Kiosk',
    image: '/images/commander/card-waitlist.jpg',
    glow: '#22D3EE',
    features: [
      { label: 'Desk View', href: '/commander/waitlist/desk', icon: '/images/commander/icons/wl-desk-view.png' },
      { label: 'Player Maintenance', href: '/commander/members', icon: '/images/commander/icons/wl-player-maintenance.png' },
      { label: 'Player Kiosk', href: '/commander/kiosk', icon: '/images/commander/icons/wl-player-kiosk.png' },
      { label: 'Member Import', href: '/commander/member-import', icon: '/images/commander/icons/wl-member-import.png' },
      { label: 'Membership Plans', href: '/commander/membership-plans', icon: '/images/commander/icons/mg-membership-plans.png' },
      { label: 'Player Display', href: '/commander/displays/waitlist', icon: '/images/commander/icons/wl-player-view.png' },
    ] },
  {
    id: 'tournaments',
    title: 'Tournaments & Events',
    subtitle: 'Tournaments, Leagues & Free Rolls, Clock',
    image: '/images/commander/card-tournaments.jpg',
    glow: '#F59E0B',
    features: [
      { label: 'Tournament Manager', href: '/commander/tournaments', icon: '/images/commander/icons/tn-registration.png' },
      { label: 'Tournament Templates', href: '/commander/tournament-settings', icon: '/images/commander/icons/tn-settings.png?v=3' },
      { label: 'Tournament Clocks', href: '/commander/tournament-clocks', icon: '/images/commander/icons/tn-clock.png' },
      { label: 'Tournament Maintenance', href: '/commander/tournament-maintenance', icon: '/images/commander/icons/tn-maintenance.png' },
      { label: 'Clock Setup', href: '/commander/clock-setup', icon: '/images/commander/icons/tn-clock-setup.png' },
      { label: 'Leagues & Freerolls', href: '/commander/leagues', icon: '/images/commander/icons/tn-leagues-freerolls.png?v=2' },
      { label: 'Tournament Director', href: '/commander/tournament-controls', icon: '/images/commander/icons/tn-controls.png' },
    ] },
  {
    id: 'floor',
    title: 'Tables & Floor',
    subtitle: 'Tables, Dealers, Floor Ops',
    image: '/images/commander/card-floor.jpg?v=4',
    glow: '#10B981',
    features: [
      { label: 'Tables & Floor', href: '/commander/tables', icon: '/images/commander/icons/mg-tables.png' },
      { label: 'Table Assignments', href: '/commander/table-assignments', icon: '/images/commander/icons/mg-table-assignments.png' },
      { label: 'Floor Map', href: '/commander/floor', icon: '/images/commander/icons/mg-floor-map.png' },
      { label: 'Open Cash Game', href: '/commander/open-game', icon: '/images/commander/icons/mg-open-game.png' },
      { label: 'Must-Move Games', href: '/commander/must-move', icon: '/images/commander/icons/mg-must-move.png' },
      { label: 'Floor Calls', href: '/commander/floor-calls', icon: '/images/commander/icons/mg-floor-calls.png' },
      { label: 'Dealer Rotation', href: '/commander/dealer-rotation', icon: '/images/commander/icons/mg-dealer-rotation.png' },
      { label: 'Table Tablets', href: '/commander/table-tablets', icon: '/images/commander/icons/mg-table-tablets.png?v=5' },
    ] },
  {
    id: 'staff',
    title: 'Staff & Operations',
    subtitle: 'Employees, Schedule, Config',
    image: '/images/commander/card-staff.jpg',
    glow: '#EF4444',
    features: [
      { label: 'Cashier', href: '/commander/cashier', icon: '/images/commander/icons/mg-cashier.png' },
      { label: 'Employee Maintenance', href: '/commander/staff', icon: '/images/commander/icons/mg-employee.png' },
      { label: 'Clock In / Out', href: '/commander/time-clock', icon: '/images/commander/icons/mg-time-clock.png' },
      { label: 'Poker Room Functions', href: '/commander/poker-room', icon: '/images/commander/icons/mg-poker-room.png' },
      { label: 'Staff Schedule', href: '/commander/schedule', icon: '/images/commander/icons/mg-staff-schedule.png' },
      { label: 'Shift Handoff', href: '/commander/shift-handoff', icon: '/images/commander/icons/mg-shift-handoff.png' },
      { label: 'Time Billing', href: '/commander/time-billing', icon: '/images/commander/icons/mg-time-billing.png' },
      { label: 'Incidents', href: '/commander/incidents', icon: '/images/commander/icons/mg-incidents.png' },
      { label: 'Daily Presets', href: '/commander/room-presets', icon: '/images/commander/icons/mg-room-presets.png' },
    ] },
  {
    id: 'displays',
    title: 'Promotions & Displays',
    subtitle: 'TV Screens, Streaming, Alerts',
    image: '/images/commander/card-displays.jpg',
    glow: '#22D3EE',
    features: [
      { label: 'TV Displays', href: '/commander/displays', icon: '/images/commander/icons/mg-tv-displays.png' },
      { label: 'Comps', href: '/commander/comps', icon: '/images/commander/icons/mg-comps.png' },
      { label: 'Display: Announcements', href: '/commander/displays/announcements', icon: '/images/commander/icons/mg-display-announcements.png' },
      { label: 'Display: Promotions', href: '/commander/displays/promotions', icon: '/images/commander/icons/mg-display-promotions.png' },
      { label: 'Display: Leaderboard', href: '/commander/displays/leaderboard', icon: '/images/commander/icons/mg-display-leaderboard.png' },
      { label: 'Leaderboard Builder', href: '/commander/leaderboard-builder', icon: '/images/commander/icons/mg-leaderboard-builder.png?v=5' },
      { label: 'Display: Combined', href: '/commander/displays/combined', icon: '/images/commander/icons/mg-display-combined.png' },
      { label: 'Streaming', href: '/commander/streaming', icon: '/images/commander/icons/mg-streaming.png' },
      { label: 'Notifications', href: '/commander/notifications', icon: '/images/commander/icons/mg-notifications.png' },
      { label: 'Promotions', href: '/commander/promotions', icon: '/images/commander/icons/mg-promotions.png' },
      { label: 'Display: Dealers', href: '/commander/displays/dealers', icon: '/images/commander/icons/mg-display-dealers.png' },
      { label: 'High Hands', href: '/commander/high-hands', icon: '/images/commander/icons/mg-high-hands.png' },
    ] },
  {
    id: 'reports',
    title: 'Reports & System',
    subtitle: 'Analytics, Configuration, Data',
    image: '/images/commander/card-reports.jpg',
    glow: '#94A3B8',
    features: [
      { label: 'Reports Hub', href: '/commander/reports', icon: '/images/commander/icons/rp-player.png' },
      { label: 'Tournament Results', href: '/commander/reports/tournament-results', icon: '/images/commander/icons/rp-tournament.png' },
      { label: 'Daily Summary', href: '/commander/reports/daily-summary', icon: '/images/commander/icons/rp-daily-summary.png' },
      { label: 'Revenue Report', href: '/commander/reports/revenue', icon: '/images/commander/icons/rp-revenue.png' },
      { label: 'Staff Activity', href: '/commander/reports/staff-activity', icon: '/images/commander/icons/rp-activity.png' },
      { label: 'Player Activity', href: '/commander/reports/player-activity', icon: '/images/commander/icons/rp-player-activity.png' },
      { label: 'Analytics', href: '/commander/analytics', icon: '/images/commander/icons/rp-custom.png' },
      { label: 'Analytics Daily', href: '/commander/reports/analytics-daily', icon: '/images/commander/icons/rp-analytics-daily.png' },
      { label: 'Table Utilization', href: '/commander/reports/table-utilization', icon: '/images/commander/icons/rp-table-utilization.png' },
      { label: 'Waitlist Metrics', href: '/commander/reports/waitlist-metrics', icon: '/images/commander/icons/rp-waitlist.png' },
      { label: 'Tax / W-2G', href: '/commander/reports/tax-compliance', icon: '/images/commander/icons/rp-tax.png' },
      { label: 'Activity Feed', href: '/commander/activity', icon: '/images/commander/icons/rp-activity-feed.png' },
      { label: 'Churn Prediction', href: '/commander/churn-prediction', icon: '/images/commander/icons/rp-churn-prediction.png' },
      { label: 'Configuration', href: '/commander/settings', icon: '/images/commander/icons/rp-setups.png' },
      { label: 'System Info', href: '/commander/system-info', icon: '/images/commander/icons/rp-system.png' },
      { label: 'Close Day', href: '/commander/close-day', icon: '/images/commander/icons/rp-close-day.png' },
      { label: 'Exports', href: '/commander/exports', icon: '/images/commander/icons/rp-config.png' },
      { label: 'Downloads', href: '/commander/downloads', icon: '/images/commander/icons/rp-downloads.png' },
      { label: 'Responsible Gaming', href: '/commander/responsible-gaming', icon: '/images/commander/icons/rp-responsible-gaming.png' },
      { label: 'Marketplace', href: '/commander/marketplace', icon: '/images/commander/icons/rp-marketplace.png' },
      { label: 'Reputation', href: '/commander/reputation', icon: '/images/commander/icons/rp-reputation.png' },
    ] },
];

export default function CommanderDashboard() {
  const router = useRouter();

  // ── EventBus: Commander session telemetry ──
  useEffect(() => { busEmit.sessionStart('commander-dashboard'); }, []);
  const [staff, setStaff] = useState(null);
  const [activeCard, setActiveCard] = useState(null); // which card is "opened"
  const [currentTier, setCurrentTier] = useState('home_game');
  const [showUpgradeModal, setShowUpgradeModal] = useState(null);
  const [hardStop, setHardStop] = useState(null); // { enabled, time, minutesLeft }

  // Auto-open card from ?card= query param (for back navigation)
  useEffect(() => {
    if (router.isReady && router.query.card) {
      const cardId = router.query.card;
      if (CARDS.find(c => c.id === cardId)) {
        setActiveCard(cardId);
      }
    }
  }, [router.isReady, router.query.card]);

  // Auth guard - validate localStorage AND Supabase session
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function validateSession() {
      const stored = getStaffSession();
      if (!stored) {
        if (router.asPath !== '/commander/login') router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
        return;
      }
      try {
        const data = JSON.parse(stored);
        // Require at minimum an id or user_id - venue_id can be null for new owners without a venue
        if (!data.id && !data.user_id) {
          if (router.asPath !== '/commander/login') router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
          return;
        }
        setStaff(data);
      } catch {
        if (router.asPath !== '/commander/login') router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
        return;
      }

      // Validate Supabase session is alive - refresh if expired
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          // Try to refresh
          const { data: { session: refreshed } } = await supabase.auth.refreshSession();
          if (!refreshed) {
            // Session truly expired - clear session-specific data and redirect to login
            localStorage.removeItem('commander_venue');
            localStorage.removeItem('commander_subscription');
            const remembered = localStorage.getItem('commander_remember');
            if (!remembered) {
              // Not remembered - clear everything
              localStorage.removeItem('commander_staff');
              if (router.asPath !== '/commander/login') router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
            } else {
              // Remembered - keep staff email for pre-fill, redirect with expired flag
              if (router.asPath !== '/commander/login') router.push('/commander/login?expired=1').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
            }
          }
        }
      } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

      try {
        const sub = JSON.parse(localStorage.getItem('commander_subscription') || '{}');
        if (sub.tier) setCurrentTier(sub.tier);
      } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    }
    validateSession();
    return () => controller.abort();
  }, [router]);

  // Hard Stop countdown logic
  const fetchHardStop = useCallback(() => {
    if (!staff) return;
    try {
const venueId = staff?.venue_id;
      if (!venueId) return;
      commanderFetch(`/api/commander/settings?venue_id=${venueId}`)
        .then(r => r.json())
        .then(data => {
          if (data?.data?.hard_stop_enabled && data.data.hard_stop_time) {
            const [h, m] = data.data.hard_stop_time.split(':').map(Number);
            const now = new Date();
            const stopDate = new Date(now);
            stopDate.setHours(h, m, 0, 0);
            // If stop time already passed today, it's for tomorrow
            if (stopDate <= now) stopDate.setDate(stopDate.getDate() + 1);
            const diff = Math.round((stopDate - now) / 60000);
            setHardStop({
              enabled: true,
              time: data.data.hard_stop_time,
              minutesLeft: diff,
              timeFormatted: stopDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
            });
          } else {
            setHardStop(null);
          }
          // Bootstrap security gate state for CommanderLayout
          if (data?.data?.security_gate_enabled !== undefined) {
            localStorage.setItem('commander_security_gate', data.data.security_gate_enabled === false ? 'off' : 'on');
          }
        })
        .catch(e => console.warn('[App] Handled promise rejection:', e?.message || e))
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  }, [staff]);

  useEffect(() => {
    fetchHardStop();
    const interval = setInterval(fetchHardStop, 60000); // refresh every minute (fallback)
    return () => clearInterval(interval);
  }, [fetchHardStop]);

  // Unified Real-Time Sync via Singleton WebSocket
  useCommanderSync(staff?.venue_id || null, fetchHardStop, { entities: ['settings'] });

  const handleLogout = async () => {
    try { await supabase.auth.signOut(); } catch { /* non-critical */ }
    localStorage.removeItem('commander_staff');
    localStorage.removeItem('commander_venue');
    localStorage.removeItem('commander_subscription');
    localStorage.removeItem('commander_remember');
    if (router.asPath !== '/commander/login') router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
  };

  const handleFeatureClick = (feat) => {
    const allowed = canAccessRoute(currentTier, feat.href);
    if (allowed) {
      router.push(feat.href);
    } else {
      const upgradeTo = getUpgradeTier(currentTier);
      const upgradeConfig = upgradeTo ? getTierConfig(upgradeTo) : null;
      setShowUpgradeModal({
        label: feat.label,
        upgradeTierName: upgradeConfig?.name || 'A Higher Tier',
        upgradePrice: upgradeConfig?.price || '' });
    }
  };

  if (!staff) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#666', fontSize: 14 }}>Loading...</div>
    </div>
  );

  const openCard = CARDS.find(c => c.id === activeCard);

  // ── Role-based filtering ──
  const staffRole = staff?.role || 'dealer';
  const filteredCards = CARDS.map(card => ({
    ...card,
    features: card.features.filter(f => canRoleAccessRoute(staffRole, f.href)) })).filter(card => card.features.length > 0);

  return (
    <CommanderLayout title="Club Commander | Dashboard" backHref="/commander/dashboard" hideBack={true}>
      <>
        <SEOHead
          title="Commander Dashboard - Room Overview"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />

        <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Inter:wght@400;500;600;700&display=swap');

        .cmd-dashboard {
          min-height: 100vh;
          background: #0a0a0a;
          font-family: 'Inter', sans-serif;
        }

        /* ── TOP BAR ── */
        .cmd-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 20px;
          background: linear-gradient(180deg, #1a1a1a 0%, #0f0f0f 100%);
          border-bottom: 2px solid #333;
        }
        .cmd-topbar-title {
          font-family: 'Orbitron', sans-serif;
          font-size: 16px;
          font-weight: 700;
          color: #fff;
          letter-spacing: 2px;
          text-transform: uppercase;
        }
        .cmd-topbar-venue {
          font-size: 11px;
          color: #888;
          margin-top: 2px;
        }

        /* ── 6-CARD GRID ── */
        .cmd-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
          padding: 20px;
          max-width: 1100px;
          margin: 0 auto;
          height: calc(100vh - 65px);
          grid-template-rows: 1fr 1fr 1fr;
        }
        @media (max-width: 640px) {
          .cmd-grid {
            grid-template-columns: 1fr;
            grid-template-rows: repeat(6, minmax(160px, 1fr));
            gap: 14px;
            padding: 14px;
            height: auto;
            min-height: calc(100vh - 65px);
          }
        }

        /* ── CARD ── */
        .cmd-card {
          position: relative;
          border-radius: 16px;
          overflow: hidden;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.3s;
          border: 3px solid #3A3B3C;
          background: #0a0a0a;
          padding: 6px;
        }
        .cmd-card:hover {
          transform: scale(1.02);
        }
        .cmd-card img {
          width: 100%;
          height: 100%;
          object-fit: fill;
          display: block;
          border-radius: 10px;
          background: #0a0a0a;
        }
        .cmd-card-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.6) 100%);
          pointer-events: none;
        }

        /* ── OPENED CARD VIEW ── */
        .cmd-open {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: #0a0a0a;
          display: flex;
          flex-direction: column;
          animation: cmdFadeIn 0.3s ease;
        }
        @keyframes cmdFadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes cmdPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .cmd-open-header {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 16px 20px;
          border-bottom: 2px solid #333;
          background: linear-gradient(180deg, #1a1a1a 0%, #0f0f0f 100%);
          flex-shrink: 0;
        }
        .cmd-open-back {
          background: none;
          border: 2px solid #555;
          border-radius: 10px;
          padding: 8px 14px;
          color: #ccc;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 600;
          transition: all 0.2s;
        }
        .cmd-open-back:hover {
          border-color: #777;
          color: #fff;
        }
        .cmd-open-title {
          font-family: 'Orbitron', sans-serif;
          font-size: 22px;
          font-weight: 900;
          color: #fff;
          text-transform: capitalize;
          letter-spacing: 3px;
        }

        /* ── SUB-FEATURE BUTTONS ── */
        .cmd-features {
          flex: 1;
          overflow-y: auto;
          padding: 24px 20px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          align-content: start;
          max-width: 700px;
          margin: 0 auto;
          width: 100%;
        }
        /* 3-column grid for cards with 7-12 features */
        .cmd-features-3col {
          grid-template-columns: 1fr 1fr 1fr !important;
          max-width: 900px !important;
          gap: 12px !important;
        }
        /* 4-column grid for cards with 13+ features */
        .cmd-features-4col {
          grid-template-columns: 1fr 1fr 1fr 1fr !important;
          max-width: 1050px !important;
          gap: 10px !important;
        }
        @media (max-width: 900px) {
          .cmd-features-3col {
            grid-template-columns: 1fr 1fr !important;
          }
          .cmd-features-4col {
            grid-template-columns: 1fr 1fr 1fr !important;
          }
        }
        @media (max-width: 640px) {
          .cmd-features-3col {
            grid-template-columns: 1fr 1fr !important;
            gap: 10px !important;
          }
          .cmd-features-4col {
            grid-template-columns: 1fr 1fr !important;
            gap: 8px !important;
          }
        }
        @media (max-width: 480px) {
          .cmd-features {
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            padding: 16px;
          }
          .cmd-features-3col,
          .cmd-features-4col {
            grid-template-columns: 1fr 1fr !important;
          }
        }
        .cmd-features-stacked {
          grid-template-columns: 1fr !important;
          max-width: 90% !important;
          gap: 24px !important;
          justify-items: center;
        }
        .cmd-features-stacked .cmd-feature-btn {
          width: 100%;
          max-width: 600px;
          min-height: 200px;
        }
        .cmd-features-stacked .cmd-feature-btn img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .cmd-feature-btn {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 0;
          border-radius: 14px;
          cursor: pointer;
          transition: all 0.25s;
          border: none;
          overflow: hidden;
          background: transparent;
        }
        .cmd-feature-btn img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
        }
        .cmd-feature-btn:hover {
          transform: translateY(-3px) scale(1.03);
          filter: brightness(1.1);
        }
        .cmd-feature-btn:active {
          transform: translateY(0) scale(1);
        }
      `}</style>

        <div className="cmd-dashboard">
          {/* Hard Stop Countdown Banner */}
          {hardStop && hardStop.minutesLeft <= 30 && !activeCard && (
            <div style={{
              padding: '10px 20px',
              background: hardStop.minutesLeft <= 15
                ? 'linear-gradient(90deg, rgba(239,68,68,0.2), rgba(239,68,68,0.1))'
                : 'linear-gradient(90deg, rgba(245,158,11,0.2), rgba(245,158,11,0.1))',
              borderBottom: `2px solid ${hardStop.minutesLeft <= 15 ? '#EF444440' : '#F59E0B40'}`,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              justifyContent: 'center',
              animation: hardStop.minutesLeft <= 5 ? 'cmdPulse 2s infinite' : 'none'
            }}>
              <StopCircle size={16} color={hardStop.minutesLeft <= 15 ? '#EF4444' : '#F59E0B'} />
              <span style={{
                color: hardStop.minutesLeft <= 15 ? '#EF4444' : '#F59E0B',
                fontWeight: 700,
                fontSize: 13,
                fontFamily: 'Inter, sans-serif'
              }}>
                Hard Stop In {hardStop.minutesLeft} Min. All Games Close At {hardStop.timeFormatted}
              </span>
            </div>
          )}

          {/* ── MAIN: 4-CARD GRID ── */}
          {!activeCard && (
            <div className="cmd-grid">
              {filteredCards.map(card => (
                <div
                  key={card.id}
                  className="cmd-card"
                  style={{ boxShadow: `0 0 20px ${card.glow}30, inset 0 0 1px ${card.glow}40` }}
                  onClick={() => { setActiveCard(card.id); router.push(`/commander/dashboard?card=${card.id}`, undefined, { shallow: true }); }}
                >
                  <img src={card.image} alt={card.title} loading="lazy" decoding="async" />
                  <div className="cmd-card-overlay" />
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    padding: '20px 16px 14px',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)',
                    zIndex: 2 }}>
                    <div style={{
                      color: card.glow, fontSize: 18, fontWeight: 800,
                      textTransform: 'uppercase', letterSpacing: 1.5,
                      textShadow: `0 0 20px ${card.glow}60, 0 2px 4px rgba(0,0,0,0.8)` }}>{card.title}</div>
                    <div style={{
                      color: '#94A3B8', fontSize: 11, marginTop: 2,
                      fontWeight: 500, letterSpacing: 0.5 }}>{card.subtitle}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── OPENED CARD: sub-features ── */}
          {openCard && (() => {
            const filtered = openCard.features.filter(f => canRoleAccessRoute(staffRole, f.href));
            if (filtered.length === 0) return null;
            return (
              <div className="cmd-open">
                <div className="cmd-open-header">
                  <button className="cmd-open-back" onClick={() => { setActiveCard(null); router.replace('/commander/dashboard', undefined, { shallow: true }); }}>
                    <ArrowLeft size={16} /> Back
                  </button>
                  <div className="cmd-open-title" style={{ color: openCard.glow }}>
                    {openCard.headerTitle || openCard.title}
                  </div>
                </div>
                <div className={`cmd-features ${filtered.length > 12 ? 'cmd-features-4col' : filtered.length > 6 ? 'cmd-features-3col' : ''}`}>
                  {filtered.map((feat, i) => {
                    const isLocked = !canAccessRoute(currentTier, feat.href);
                    return (
                      <button
                        key={i}
                        className="cmd-feature-btn"
                        style={{
                          '--glow': openCard.glow,
                          '--glow-dim': `${openCard.glow}30`,
                          opacity: isLocked ? 0.4 : 1,
                          filter: isLocked ? 'grayscale(0.6)' : 'none' }}
                        onClick={() => handleFeatureClick(feat)}
                      >
                        <img src={feat.icon} alt={feat.label} loading="lazy" decoding="async" />
                        {isLocked && (
                          <div style={{
                            position: 'absolute', inset: 0, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(0,0,0,0.55)', borderRadius: 14 }}>
                            <div style={{
                              background: 'rgba(0,0,0,0.7)', borderRadius: 8,
                              padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 5,
                              border: '2px solid rgba(245,158,11,0.3)' }}>
                              <Lock size={14} color="#F59E0B" />
                              <span style={{ color: '#F59E0B', fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>UPGRADE</span>
                            </div>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

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
                  <strong style={{ color: '#F59E0B' }}>{showUpgradeModal.label}</strong> Requires The{' '}
                  <strong style={{ color: '#22D3EE' }}>{showUpgradeModal.upgradeTierName}</strong> Plan
                  {showUpgradeModal.upgradePrice && <> (${showUpgradeModal.upgradePrice}/mo)</>}.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    onClick={() => { setShowUpgradeModal(null); router.push('/commander/settings?tab=subscription'); }}
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
        </div>
      </>
    </CommanderLayout>
  );
}
