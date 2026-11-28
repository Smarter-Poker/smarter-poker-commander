/**
 * Commander Staff Dashboard - /commander/dashboard
 *
 * #SMARTERDESIGN (Dan, 2026-11-27): six steel-rimmed section panels, each
 * with its seal, a live title and its feature buttons, all on one screen.
 * Replaces the six painted console cards (baked lettering, orange/red/green
 * neon) and their drill-in screen of painted icon tiles. Same links, role
 * filtering, tier locks, Hard Stop banner and upgrade flow.
 * NO EMOJIS - Lucide icons only
 */
import { useState, useEffect, useCallback } from 'react';
import { busEmit } from '../../src/engine/EventBus';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Lock, StopCircle, Activity, Award, BadgeCheck, BarChart3, Bell, BellRing, Building2, CalendarClock, CalendarDays, ClipboardList, Clock, DollarSign, Download, FileBarChart, FileText, Gauge, Gavel, Gift, HardDriveDownload, HeartHandshake, Hourglass, Info, Landmark, LayoutDashboard, LayoutGrid, LayoutTemplate, LineChart, ListOrdered, Map, Medal, Megaphone, Monitor, Moon, MoveRight, PieChart, PlusCircle, Receipt, Repeat, RotateCw, Rss, Settings, ShieldAlert, Shuffle, SlidersHorizontal, Spade, Sparkles, Star, Store, Tablet, Tag, Ticket, Timer, TrendingDown, Trophy, Tv, Upload, UserCheck, UserCog, UserSquare, Users, Video, Wrench } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { supabase } from '../../src/lib/supabase';
// Dashboard uses real-time sync primarily to instantly reflect hard stop or setting changes
import { canAccessRoute, getUpgradeTier, getTierConfig } from '../../src/lib/commander/tierConfig';
// Role access comes from the client-safe module (2026-11-28): importing it
// from lib/commander/auth pulled node crypto and the server Supabase helpers
// into this page's bundle.
import { canRoleAccessRoute } from '../../src/lib/commander/roleAccess';
import { useCommanderSync } from '../../src/lib/commander/useCommanderSync';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';
import InlineStyle from '../../src/components/commander/shared/InlineStyle';
import { apiData } from '../../src/lib/commander/apiShape';

/* ─────────────────────────────────────────────────
   CARD DEFINITIONS - each card has sub-features
   that link to pages within Club Commander
   ───────────────────────────────────────────────── */
const CARDS = [
  {
    id: 'waitlist',
    title: 'Waitlist',
    subtitle: 'Players, Memberships, Kiosk',
    seal: '/images/smarterdesign/headers/players-seal.webp',
    features: [
      { label: 'Desk View', href: '/commander/waitlist/desk', Icon: ClipboardList },
      { label: 'Player Maintenance', href: '/commander/members', Icon: UserCog },
      { label: 'Player Kiosk', href: '/commander/kiosk', Icon: Tablet },
      { label: 'Member Import', href: '/commander/member-import', Icon: Upload },
      { label: 'Membership Plans', href: '/commander/membership-plans', Icon: BadgeCheck },
      { label: 'Player Display', href: '/commander/displays/waitlist', Icon: Monitor },
    ] },
  {
    id: 'tournaments',
    title: 'Tournaments & Events',
    subtitle: 'Tournaments, Leagues & Free Rolls, Clock',
    seal: '/images/smarterdesign/headers/poker_mtt-seal.webp',
    features: [
      // 2026-08-20 consolidation. Two labels here were flatly wrong and sent
      // staff to the opposite screen from the one they read:
      //   "Tournament Clock" pointed at the retired multi-clock hub, not the
      //   clock. It now points at Display Management, which launches every TV
      //   board including the clock.
      //   "Tournament Controls" pointed at the month calendar. It is now
      //   labelled Tournament Calendar, which is what that page is.
      { label: 'Tournament Manager', href: '/commander/tournaments', Icon: Trophy },
      { label: 'Tournament Templates', href: '/commander/tournament-settings', Icon: LayoutTemplate },
      { label: 'TV Displays', href: '/commander/displays', Icon: Tv },
      { label: 'Leagues', href: '/commander/leagues', Icon: Medal },
      { label: 'Clock Setup', href: '/commander/clock-setup', Icon: Timer },
      { label: 'Free Rolls', href: '/commander/leagues', Icon: Ticket },
      { label: 'Tournament Calendar', href: '/commander/tournament-maintenance', Icon: CalendarDays },
      { label: 'Tournament Director', href: '/commander/tournament-controls', Icon: Gavel },
    ] },
  {
    id: 'floor',
    title: 'Tables & Floor',
    subtitle: 'Tables, Dealers, Floor Ops',
    seal: '/images/smarterdesign/headers/pnm-live-seal.webp',
    features: [
      { label: 'Tables & Floor', href: '/commander/tables', Icon: LayoutGrid },
      { label: 'Table Assignments', href: '/commander/table-assignments', Icon: Shuffle },
      { label: 'Floor Map', href: '/commander/floor', Icon: Map },
      { label: 'Open Cash Game', href: '/commander/open-game', Icon: PlusCircle },
      { label: 'Must-Move Games', href: '/commander/must-move', Icon: MoveRight },
      { label: 'Floor Calls', href: '/commander/floor-calls', Icon: BellRing },
      { label: 'Dealer Rotation', href: '/commander/dealer-rotation', Icon: RotateCw },
      { label: 'Table Tablets', href: '/commander/table-tablets', Icon: Tablet },
    ] },
  {
    id: 'staff',
    title: 'Staff & Operations',
    subtitle: 'Employees, Schedule, Config',
    seal: '/images/smarterdesign/headers/pnm-more-seal.webp',
    features: [
      { label: 'Cashier', href: '/commander/cashier', Icon: Landmark },
      { label: 'Employee Maintenance', href: '/commander/staff', Icon: Users },
      { label: 'Clock In / Out', href: '/commander/time-clock', Icon: Clock },
      { label: 'Poker Room Functions', href: '/commander/poker-room', Icon: Building2 },
      { label: 'Staff Schedule', href: '/commander/schedule', Icon: CalendarClock },
      { label: 'Shift Handoff', href: '/commander/shift-handoff', Icon: Repeat },
      { label: 'Time Billing', href: '/commander/time-billing', Icon: Hourglass },
      { label: 'Incidents', href: '/commander/incidents', Icon: ShieldAlert },
      { label: 'Daily Presets', href: '/commander/room-presets', Icon: SlidersHorizontal },
    ] },
  {
    id: 'displays',
    title: 'Promotions & Displays',
    subtitle: 'TV Screens, Streaming, Alerts',
    seal: '/images/smarterdesign/headers/training-scenario-demo-seal.webp',
    features: [
      { label: 'TV Displays', href: '/commander/displays', Icon: Tv },
      { label: 'Comps', href: '/commander/comps', Icon: Gift },
      { label: 'Display: Announcements', href: '/commander/displays/announcements', Icon: Megaphone },
      { label: 'Display: Promotions', href: '/commander/displays/promotions', Icon: Sparkles },
      { label: 'Display: Leaderboard', href: '/commander/displays/leaderboard', Icon: ListOrdered },
      { label: 'Leaderboard Builder', href: '/commander/leaderboard-builder', Icon: Wrench },
      { label: 'Display: Combined', href: '/commander/displays/combined', Icon: LayoutDashboard },
      { label: 'Streaming', href: '/commander/streaming', Icon: Video },
      { label: 'Notifications', href: '/commander/notifications', Icon: Bell },
      { label: 'Promotions', href: '/commander/promotions', Icon: Tag },
      { label: 'Display: Dealers', href: '/commander/displays/dealers', Icon: UserSquare },
      { label: 'High Hands', href: '/commander/high-hands', Icon: Spade },
    ] },
  {
    id: 'reports',
    title: 'Reports & System',
    subtitle: 'Analytics, Configuration, Data',
    seal: '/images/smarterdesign/headers/reports-seal.webp',
    features: [
      { label: 'Reports Hub', href: '/commander/reports', Icon: FileBarChart },
      { label: 'Tournament Results', href: '/commander/reports/tournament-results', Icon: Award },
      { label: 'Daily Summary', href: '/commander/reports/daily-summary', Icon: FileText },
      { label: 'Revenue Report', href: '/commander/reports/revenue', Icon: DollarSign },
      { label: 'Staff Activity', href: '/commander/reports/staff-activity', Icon: UserCheck },
      { label: 'Player Activity', href: '/commander/reports/player-activity', Icon: Activity },
      { label: 'Analytics', href: '/commander/analytics', Icon: BarChart3 },
      { label: 'Analytics Daily', href: '/commander/reports/analytics-daily', Icon: LineChart },
      { label: 'Table Utilization', href: '/commander/reports/table-utilization', Icon: PieChart },
      { label: 'Waitlist Metrics', href: '/commander/reports/waitlist-metrics', Icon: Gauge },
      { label: 'Tax / W-2G', href: '/commander/reports/tax-compliance', Icon: Receipt },
      { label: 'Activity Feed', href: '/commander/activity', Icon: Rss },
      { label: 'Churn Prediction', href: '/commander/churn-prediction', Icon: TrendingDown },
      { label: 'Configuration', href: '/commander/settings', Icon: Settings },
      { label: 'System Info', href: '/commander/system-info', Icon: Info },
      { label: 'Close Day', href: '/commander/close-day', Icon: Moon },
      { label: 'Exports', href: '/commander/exports', Icon: Download },
      { label: 'Downloads', href: '/commander/downloads', Icon: HardDriveDownload },
      { label: 'Responsible Gaming', href: '/commander/responsible-gaming', Icon: HeartHandshake },
      { label: 'Marketplace', href: '/commander/marketplace', Icon: Store },
      { label: 'Reputation', href: '/commander/reputation', Icon: Star },
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

  // Old ?card=<id> links (and bookmarks) land on that section.
  useEffect(() => {
    if (!activeCard || !staff) return;
    const el = document.getElementById(`dashboard-${activeCard}`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  }, [activeCard, staff]);

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
          if (data?.data?.hard_stop_enabled && apiData(data).hard_stop_time) {
            const [h, m] = apiData(data).hard_stop_time.split(':').map(Number);
            const now = new Date();
            const stopDate = new Date(now);
            stopDate.setHours(h, m, 0, 0);
            // If stop time already passed today, it's for tomorrow
            if (stopDate <= now) stopDate.setDate(stopDate.getDate() + 1);
            const diff = Math.round((stopDate - now) / 60000);
            setHardStop({
              enabled: true,
              time: apiData(data).hard_stop_time,
              minutesLeft: diff,
              timeFormatted: stopDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
            });
          } else {
            setHardStop(null);
          }
          // Bootstrap security gate state for CommanderLayout
          if (data?.data?.security_gate_enabled !== undefined) {
            localStorage.setItem('commander_security_gate', apiData(data).security_gate_enabled === false ? 'off' : 'on');
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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#BDD0E2', fontSize: 14 }} role="status">Loading...</div>
    </div>
  );

  // ── Role-based filtering ──
  const staffRole = staff?.role || 'dealer';
  const filteredCards = CARDS.map(card => ({
    ...card,
    features: card.features.filter(f => canRoleAccessRoute(staffRole, f.href)) })).filter(card => card.features.length > 0);

  return (
    <CommanderLayout title="Club Commander | Dashboard" backHref="/commander/dashboard" hideBack={true}>
      <SEOHead
        title="Commander Dashboard - Room Overview"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="cmd-dashboard">
        {/* Hard Stop Countdown Banner */}
        {hardStop && hardStop.minutesLeft <= 30 && (
          <div className={`cmd-hardstop ${hardStop.minutesLeft <= 15 ? 'is-urgent' : ''} ${hardStop.minutesLeft <= 5 ? 'is-pulsing' : ''}`} role="status">
            <StopCircle size={16} aria-hidden="true" />
            <span>Hard Stop In {hardStop.minutesLeft} Min. All Games Close At {hardStop.timeFormatted}</span>
          </div>
        )}

        <div className="cmd-sections">
          {filteredCards.map((card) => (
            <section
              key={card.id}
              id={`dashboard-${card.id}`}
              className={`sd-panel cmd-section ${activeCard === card.id ? 'is-target' : ''}`}
              aria-labelledby={`dashboard-${card.id}-title`}
            >
              <div className="cmd-section__head">
                <span className="cmd-section__seal" aria-hidden="true"><img src={card.seal} alt="" width="176" height="176" loading="lazy" decoding="async" /></span>
                <div className="cmd-section__copy">
                  <h2 id={`dashboard-${card.id}-title`} className="sd-section-title cmd-section__title">{card.title}</h2>
                  <p className="cmd-section__sub">{card.subtitle}</p>
                </div>
              </div>
              <div className="cmd-section__grid">
                {card.features.map((feat) => {
                  const isLocked = !canAccessRoute(currentTier, feat.href);
                  const { Icon } = feat;
                  return (
                    <button
                      key={`${feat.label}-${feat.href}`}
                      type="button"
                      className={`sd-button cmd-feature ${isLocked ? 'is-locked' : ''}`}
                      onClick={() => handleFeatureClick(feat)}
                      aria-label={isLocked ? `${feat.label} (Upgrade Required)` : feat.label}
                    >
                      <span className="cmd-feature__icon" aria-hidden="true"><Icon size={20} /></span>
                      <span className="cmd-feature__label">{feat.label}</span>
                      {isLocked ? <span className="cmd-feature__lock"><Lock size={12} aria-hidden="true" /> Upgrade</span> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* ── UPGRADE DIALOG (was a painted image with invisible buttons) ── */}
        {showUpgradeModal && (
          <div className="cmd-upgrade" role="presentation">
            <div className="cmd-upgrade__scrim" onClick={() => setShowUpgradeModal(null)} />
            <div className="sd-panel cmd-upgrade__card" role="dialog" aria-modal="true" aria-labelledby="cmd-upgrade-title">
              <h2 id="cmd-upgrade-title" className="sd-section-title">Upgrade Required</h2>
              <p className="cmd-upgrade__body">
                {showUpgradeModal.label} Requires The <strong>{showUpgradeModal.upgradeTierName}</strong> Plan
                {showUpgradeModal.upgradePrice ? <> At ${showUpgradeModal.upgradePrice} Per Month</> : null}.
              </p>
              <div className="cmd-upgrade__actions">
                <button type="button" className="sd-button" onClick={() => setShowUpgradeModal(null)}>Maybe Later</button>
                <button type="button" className="sd-button sd-primary" autoFocus onClick={() => { setShowUpgradeModal(null); router.push('/commander/settings?tab=subscription'); }}>View Plans</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <InlineStyle css={`
        .cmd-dashboard { max-width: 1600px; margin: 0 auto; padding: 0 clamp(8px, 2vw, 24px) 96px; }
        .cmd-hardstop { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 0 0 10px; padding: 10px 16px; border: 1px solid #22D3EE55; border-radius: 10px; background: #22D3EE14; color: #86DAFF; font-weight: 700; font-size: 13px; }
        .cmd-hardstop.is-urgent { border-color: #EF444466; background: #EF44441a; color: #FCA5A5; }
        .cmd-hardstop.is-pulsing { animation: cmdPulse 2s infinite; }
        @keyframes cmdPulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
        .cmd-sections { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 460px), 1fr)); gap: clamp(10px, 1.6vw, 18px); }
        .cmd-section { display: grid; align-content: start; gap: 12px; scroll-margin-top: 90px; }
        .cmd-section.is-target { box-shadow: 0 0 0 2px #86DAFF66; }
        .cmd-section__head { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: center; gap: 12px; }
        .cmd-section__seal { display: grid; place-items: center; width: 52px; height: 52px; padding: 3px; box-sizing: border-box; border-radius: 50%; background: conic-gradient(from 25deg, #6d94b1, #d8e7f3 12%, #3c5369 23%, #0d263b 35%, #a6c8e0 50%, #465d72 64%, #f4f9ff 78%, #234968 90%, #6d94b1); box-shadow: 0 0 0 1px #09121c, 0 0 0 2px #92aac0; }
        .cmd-section__seal img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; background: #06101b; }
        .cmd-section__title.sd-section-title { margin: 0; }
        .cmd-section__sub { margin: 2px 0 0; color: #BDD0E2; font-size: .82rem; }
        .cmd-section__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
        .cmd-feature.sd-button { position: relative; display: grid; grid-template-columns: 34px minmax(0, 1fr); align-items: center; gap: 8px; min-height: 52px; padding: 6px 10px; text-align: left; font-size: .98rem; }
        .cmd-feature__icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; color: #E9F6FF; background: radial-gradient(circle at 35% 30%, #2e5a85, #0b2238 70%); box-shadow: 0 0 0 1px #09121c, 0 0 0 1.5px #7f9bb4; }
        .cmd-feature__label { min-width: 0; overflow-wrap: anywhere; }
        .cmd-feature.is-locked { opacity: .62; }
        .cmd-feature__lock { grid-column: 1 / -1; display: inline-flex; align-items: center; gap: 4px; justify-self: start; padding: 1px 7px; border: 1px solid #22D3EE66; border-radius: 999px; color: #86DAFF; font-size: .7rem; letter-spacing: .04em; }
        .cmd-upgrade { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; padding: 16px; }
        .cmd-upgrade__scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, .7); }
        .cmd-upgrade__card { position: relative; width: min(100%, 460px); display: grid; gap: 12px; }
        .cmd-upgrade__body { margin: 0; color: #BDD0E2; line-height: 1.55; }
        .cmd-upgrade__body strong { color: #86DAFF; }
        .cmd-upgrade__actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        @media (prefers-reduced-motion: reduce) { .cmd-hardstop.is-pulsing { animation: none; } }
      `} />
    </CommanderLayout>
  );
}
