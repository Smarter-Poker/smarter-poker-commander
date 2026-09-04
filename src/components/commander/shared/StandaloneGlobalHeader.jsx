import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../../lib/supabase';
import { commanderSignOut } from '../../../lib/commanderLogout';

const MENU_ITEMS = [
  ['Dashboard', '/commander/dashboard'],
  ['Waitlist Desk', '/commander/waitlist/desk'],
  ['Members', '/commander/members'],
  ['Tables', '/commander/tables'],
  ['Tournaments', '/commander/tournaments'],
  ['Reports', '/commander/reports'],
  ['Settings', '/commander/settings'],
];

export default function StandaloneGlobalHeader() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileAvatar, setProfileAvatar] = useState('/default-avatar.png');
  const signingOutRef = useRef(false);

  /**
   * /hub/* belongs to the World Hub, not to this Next build. router.push()
   * cannot resolve it, so Next logged a console.error on every one of these
   * clicks before falling back to a hard navigation. Go there directly.
   */
  const goHub = (href) => { window.location.assign(href); };

  /**
   * This header is mounted by pages/_app.js on the 29 routes that do not render
   * CommanderLayout — the waitlist desk, the kiosk, the lobby, every report.
   * Until 2026-09-04 it had no Sign Out at all, so an operator on any of them
   * could not sign out without navigating somewhere else first.
   */
  const handleSignOut = async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setMenuOpen(false);
    await commanderSignOut(supabase);
  };

  useEffect(() => {
    const refreshProfileAvatar = (event) => {
      try {
        const staff = JSON.parse(localStorage.getItem('commander_staff') || '{}');
        const cachedHeader = JSON.parse(localStorage.getItem('sp-cached-header-user') || '{}');
        const cachedAuth = JSON.parse(localStorage.getItem('smarter-poker-auth') || '{}');
        const nextAvatar =
          event?.detail?.avatar_url ||
          staff?.avatar_url ||
          staff?.avatar ||
          cachedHeader?.avatar_url ||
          cachedHeader?.avatar ||
          cachedAuth?.user?.user_metadata?.avatar_url ||
          '/default-avatar.png';
        setProfileAvatar(nextAvatar);
      } catch (_) {
        setProfileAvatar('/default-avatar.png');
      }
    };
    const handleStorage = (event) => {
      if (['commander_staff', 'sp-cached-header-user', 'smarter-poker-auth'].includes(event.key)) {
        refreshProfileAvatar();
      }
    };

    let avatarChannel = null;
    try {
      avatarChannel = new BroadcastChannel('smarter_poker_avatar_sync');
      avatarChannel.onmessage = refreshProfileAvatar;
    } catch (_) {
      // BroadcastChannel is optional; storage + same-tab events remain active.
    }

    refreshProfileAvatar();
    window.addEventListener('profile-updated', refreshProfileAvatar);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('profile-updated', refreshProfileAvatar);
      window.removeEventListener('storage', handleStorage);
      try { avatarChannel?.close(); } catch (_) { /* noop */ }
    };
  }, []);

  const go = (path) => {
    setMenuOpen(false);
    router.push(path);
  };

  return (
    <>
      <style jsx global>{`
        .standalone-approved-header {
          position: sticky;
          top: 0;
          z-index: 1000;
          width: 100%;
          box-sizing: border-box;
          padding-top: env(safe-area-inset-top, 0px);
          overflow: hidden;
          background: #000;
          line-height: 0;
          isolation: isolate;
        }
        .standalone-approved-header__art {
          display: block;
          width: calc(100% - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px));
          height: auto;
          margin-inline: env(safe-area-inset-left, 0px) env(safe-area-inset-right, 0px);
          aspect-ratio: 1648 / 168;
          object-fit: contain;
          object-position: center;
          user-select: none;
          pointer-events: none;
        }
        .standalone-approved-header__controls {
          position: absolute;
          top: env(safe-area-inset-top, 0px);
          right: env(safe-area-inset-right, 0px);
          left: env(safe-area-inset-left, 0px);
          aspect-ratio: 1648 / 168;
        }
        .standalone-approved-header__button {
          position: absolute;
          top: 13%;
          height: 74%;
          margin: 0;
          padding: 0;
          appearance: none;
          border: 0;
          border-radius: 8px;
          background: transparent;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }
        .standalone-approved-header__button:focus-visible {
          outline: 3px solid #20a9ff;
          outline-offset: -3px;
          box-shadow: 0 0 0 2px #000;
        }
        .standalone-approved-header__menu { left: 1.7%; width: 7%; }
        .standalone-approved-header__back { left: 8%; width: 12%; }
        .standalone-approved-header__hub { left: 19.1%; width: 12.9%; }
        .standalone-approved-header__profile {
          left: 66.5%;
          width: 7.5%;
          position: absolute !important;
          overflow: hidden;
          contain: layout paint;
          isolation: isolate;
        }
        .standalone-approved-header__wallet { left: 73.2%; width: 7.1%; }
        .standalone-approved-header__vip { left: 79.9%; width: 6.5%; }
        .standalone-approved-header__messenger { left: 86%; width: 6.9%; }
        .standalone-approved-header__notifications { left: 92.3%; width: 6.2%; }
        .standalone-approved-header__avatar-slot {
          position: absolute !important;
          top: 50% !important;
          left: 50% !important;
          z-index: 1;
          display: block;
          width: 58%;
          height: auto;
          aspect-ratio: .78;
          transform: translate(-50%, -50%) !important;
          overflow: hidden;
          border-radius: 50%;
          background: #020305;
          pointer-events: none;
        }
        .standalone-approved-header__avatar-slot > .standalone-approved-header__avatar {
          position: absolute !important;
          inset: 0 !important;
          display: block !important;
          width: 100% !important;
          height: 100% !important;
          max-width: none !important;
          aspect-ratio: auto !important;
          transform: none !important;
          border-radius: inherit !important;
          background: #020305;
          object-fit: cover !important;
          object-position: center !important;
          opacity: 1 !important;
          pointer-events: none;
        }
        .standalone-approved-menu-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1090;
          border: 0;
          background: rgba(0,0,0,.62);
        }
        .standalone-approved-menu {
          position: fixed;
          top: 0;
          bottom: 0;
          left: 0;
          z-index: 1100;
          width: min(320px, 88vw);
          box-sizing: border-box;
          padding: max(18px, env(safe-area-inset-top, 0px)) 12px 18px;
          overflow-y: auto;
          border-right: 1px solid #a9afb5;
          background: linear-gradient(145deg, #22282e, #050607 10% 90%, #171b20);
          box-shadow: 16px 0 38px rgba(0,0,0,.7);
        }
        .standalone-approved-menu__close,
        .standalone-approved-menu__item {
          width: 100%;
          min-height: 48px;
          margin: 3px 0;
          border: 1px solid rgba(215,219,223,.32);
          background: linear-gradient(180deg, #181c21, #07090c);
          color: #eef2f5;
          font: 700 14px/1.2 system-ui, sans-serif;
          text-align: left;
          cursor: pointer;
        }
        .standalone-approved-menu__close { padding: 0 16px; color: #56bdff; }
        .standalone-approved-menu__item { padding: 0 18px; }
        .standalone-approved-menu__signout { color: #ff8a8a; border-color: rgba(255,138,138,.42); }
        @media (display-mode: standalone), (display-mode: fullscreen) {
          .standalone-approved-header { padding-top: max(env(safe-area-inset-top, 0px), 24px); }
          .standalone-approved-header__controls { top: max(env(safe-area-inset-top, 0px), 24px); }
        }
      `}</style>

      <header className="standalone-approved-header" data-artwork="approved-global-header">
        <img src="/images/global-header/global-header-desktop.png" alt="" width="1648" height="168" className="standalone-approved-header__art" aria-hidden="true" fetchpriority="high" decoding="sync" />
        <div className="standalone-approved-header__controls">
          <button type="button" className="standalone-approved-header__button standalone-approved-header__menu" onClick={() => setMenuOpen(true)} aria-label="Open Menu" />
          <button type="button" className="standalone-approved-header__button standalone-approved-header__back" onClick={() => router.back()} aria-label="Go back" />
          <button type="button" className="standalone-approved-header__button standalone-approved-header__hub" onClick={() => goHub('/hub')} aria-label="Go to the Hub" />
          <button type="button" className="standalone-approved-header__button standalone-approved-header__profile" onClick={() => goHub('/hub/profile')} aria-label="My Profile">
            <span className="standalone-approved-header__avatar-slot" aria-hidden="true">
              <img src={profileAvatar} alt="" className="standalone-approved-header__avatar" onError={(event) => { event.currentTarget.src = '/default-avatar.png'; }} />
            </span>
          </button>
          <button type="button" className="standalone-approved-header__button standalone-approved-header__wallet" onClick={() => goHub('/hub/diamond-store')} aria-label="Diamond Wallet" />
          <button type="button" className="standalone-approved-header__button standalone-approved-header__vip" onClick={() => goHub('/hub/vip-membership')} aria-label="VIP" />
          <button type="button" className="standalone-approved-header__button standalone-approved-header__messenger" onClick={() => goHub('/hub/messenger')} aria-label="Messages" />
          <button type="button" className="standalone-approved-header__button standalone-approved-header__notifications" onClick={() => goHub('/hub/notifications')} aria-label="Notifications" />
        </div>
      </header>

      {menuOpen && (
        <>
          <button type="button" className="standalone-approved-menu-backdrop" onClick={() => setMenuOpen(false)} aria-label="Close Menu" />
          <nav className="standalone-approved-menu" aria-label="Commander Menu">
            <button type="button" className="standalone-approved-menu__close" onClick={() => setMenuOpen(false)}>Close Menu</button>
            {MENU_ITEMS.map(([label, href]) => (
              <button type="button" className="standalone-approved-menu__item" key={href} onClick={() => go(href)}>{label}</button>
            ))}
            <button type="button" className="standalone-approved-menu__item standalone-approved-menu__signout" onClick={handleSignOut}>Sign Out</button>
          </nav>
        </>
      )}
    </>
  );
}
