/**
 * #SMARTERDESIGN page image headers - one entry per Club Commander staff page
 * (Dan, 2026-11-27: "CLUB COMMANDER NEEDS THE SAME #SMARTERDESIGN UPGRADE TO
 * EVERY SINGLE PAGE, SUBPAGE, BUTTON AND EVERYTHING ELSE, EXACTLY LIKE WE'VE
 * DONE FOR EVERY OTHER WORLD HUB PAGE").
 *
 * Each route names its page title and the artwork pair in
 * public/images/smarterdesign/headers/<art>-seal.webp / -scene.webp (the same
 * library World Hub uses; `cashier` is Club Arena's Cashier vault, the
 * reference header). Every page gets the pair that depicts what the page
 * does (2026-11-28: 82 distinct pairs for 85 pages, chosen by looking at
 * the art). A pair is shared only inside one section and only where the
 * pages are the same job under two routes (Dealer Rotation, Tournament
 * Settings, the Documentation pages); sections never share each other's.
 * `tests/unit/smarterdesign.law.test.js` caps the reuse count.
 *
 * Routes with NO entry get no image header on purpose: TV displays, kiosks,
 * table tablets, the public check-in and tournament screens, and the sign-in
 * and onboarding flows. They still get the #SMARTERDESIGN palette and rims.
 */
export const PAGE_HEADERS = {
  '/commander/dashboard': { title: 'Dashboard', art: 'training-session-dashboard' },
  '/commander/activity': { title: 'Activity', art: 'training-training-feed' },
  '/commander/admin': { title: 'Admin Dashboard', art: 'training-skill-tree' },
  '/commander/admin/leads': { title: 'Leads', art: 'training-study-group-finder', parent: 'Admin' },
  '/commander/admin/pilots': { title: 'Pilots', art: 'pnm-locations', parent: 'Admin' },
  '/commander/analytics': { title: 'Analytics', art: 'jarvis' },
  '/commander/announcements': { title: 'Announcements', art: 'news' },
  '/commander/notifications': { title: 'Notifications', art: 'pnm-alerts' },
  '/commander/arena-ledger': { title: 'Arena Ledger', art: 'bankroll' },
  '/commander/cashier': { title: 'Cashier', art: 'cashier' },
  '/commander/close-day': { title: 'Close Day', art: 'training-daily-challenge' },
  '/commander/time-billing': { title: 'Time Billing', art: 'toke-shift' },
  '/commander/churn-prediction': { title: 'Churn Prediction', art: 'goals' },
  '/commander/reputation': { title: 'Player Reputation', art: 'staking-profile' },
  '/commander/responsible-gaming': { title: 'Responsible Gaming', art: 'training-tilt-guard' },
  '/commander/clock-setup': { title: 'Clock Setup', art: 'training-goals' },
  '/commander/comps': { title: 'Comps', art: 'store-rewards' },
  '/commander/promotions': { title: 'Promotions', art: 'store-wishlist' },
  '/commander/high-hands': { title: 'High Hands', art: 'preflop-achievements' },
  '/commander/leagues': { title: 'Leagues And Freerolls', art: 'series' },
  '/commander/leaderboard-builder': { title: 'Leaderboard Builder', art: 'preflop-leaderboard' },
  '/commander/tournament-leaderboards': { title: 'Tournament Leaderboards', art: 'training-community-leaderboard' },
  '/commander/dealers': { title: 'Dealers', art: 'toke-home' },
  '/commander/dealer-rotation': { title: 'Dealer Rotation', art: 'training-category-spins' },
  '/commander/staff': { title: 'Staff', art: 'pnm-more' },
  '/commander/schedule': { title: 'Staff Schedule', art: 'training-training-calendar' },
  '/commander/time-clock': { title: 'Time Clock', art: 'training-focus-timer' },
  '/commander/shift-handoff': { title: 'Shift Handoff', art: 'training-session-notes' },
  '/commander/displays': { title: 'Displays', art: 'training-scenario-demo' },
  '/commander/streaming': { title: 'Streaming', art: 'sports' },
  '/commander/docs': { title: 'Documentation', art: 'rules' },
  '/commander/docs/manager-guide': { title: 'Manager Guide', art: 'training-glossary', parent: 'Documentation' },
  '/commander/docs/staff-guide': { title: 'Staff Guide', art: 'training-my-playbook', parent: 'Documentation' },
  '/commander/docs/troubleshooting': { title: 'Troubleshooting', art: 'rules', parent: 'Documentation' },
  '/commander/incidents': { title: 'Incidents', art: 'training-blind-defense' },
  '/commander/downloads': { title: 'Downloads', art: 'export' },
  '/commander/install': { title: 'Install On Tablet', art: 'training-gto-preloader' },
  '/commander/exports': { title: 'Data Exports', art: 'toke-vault' },
  '/commander/member-import': { title: 'Import Members', art: 'training-hand-history-upload' },
  '/commander/floor': { title: 'Floor Map', art: 'pnm-map' },
  '/commander/floor-calls': { title: 'Floor Calls', art: 'training-live-hud-sync' },
  '/commander/tables': { title: 'Tables', art: 'pnm-live' },
  '/commander/table-assignments': { title: 'Table Assignments', art: 'training-position-mastery' },
  '/commander/table-tablets': { title: 'Table Tablets', art: 'store-order-detail' },
  '/commander/table-vibes': { title: 'Table Vibes', art: 'training-study-group' },
  '/commander/game-types': { title: 'Game Types', art: 'training-table-wizard' },
  '/commander/open-game': { title: 'Open Cash Game', art: 'poker_cash' },
  '/commander/must-move': { title: 'Must-Move Games', art: 'training-multi-table' },
  '/commander/waitlist/desk': { title: 'Waitlist Desk', art: 'toke-venues' },
  '/commander/members': { title: 'Members', art: 'players' },
  '/commander/members/[id]': { title: 'Member', art: 'training-player-profiles', parent: 'Members', useLayoutTitle: true },
  '/commander/membership-plans': { title: 'Membership Plans', art: 'vip' },
  '/commander/marketplace': { title: 'Marketplace', art: 'store-cart' },
  '/commander/poker-room': { title: 'Poker Room', art: 'pnm-venues' },
  '/commander/room-presets': { title: 'Daily Presets', art: 'pnm-calendar' },
  '/commander/settings': { title: 'Settings', art: 'settings' },
  '/commander/system-info': { title: 'System Info', art: 'training-custom-solve' },
  '/commander/print-station': { title: 'Print Station', art: 'receipts' },
  '/commander/qr-code': { title: 'Check-In QR Code', art: 'training-weakness-scanner' },
  '/commander/reports': { title: 'Reports', art: 'reports' },
  '/commander/reports/analytics-daily': { title: 'Daily Analytics', art: 'toke-analytics', parent: 'Reports' },
  '/commander/reports/daily-summary': { title: 'Daily Summary', art: 'training-daily-goals', parent: 'Reports' },
  '/commander/reports/player-activity': { title: 'Player Activity', art: 'preflop-stats', parent: 'Reports' },
  '/commander/reports/revenue': { title: 'Revenue', art: 'staking', parent: 'Reports' },
  '/commander/reports/staff-activity': { title: 'Staff Activity', art: 'training-streaks', parent: 'Reports' },
  '/commander/reports/table-utilization': { title: 'Table Utilization', art: 'training-aggregate', parent: 'Reports' },
  '/commander/reports/tax-compliance': { title: 'Tax Compliance', art: 'tax', parent: 'Reports' },
  '/commander/reports/tournament-results': { title: 'Tournament Results', art: 'training-famous-finals', parent: 'Reports' },
  '/commander/reports/waitlist-metrics': { title: 'Waitlist Metrics', art: 'training-progress', parent: 'Reports' },
  '/commander/tournaments': { title: 'Tournaments', art: 'poker_mtt' },
  '/commander/tournaments/[id]/settings': { title: 'Tournament Settings', art: 'training-tournament-prep', parent: 'Tournament' },
  '/commander/tournament-controls': { title: 'Tournament Director', art: 'training-tournaments' },
  '/commander/tournament-maintenance': { title: 'Tournament Maintenance', art: 'training-drill-builder' },
  '/commander/tournament-settings': { title: 'Tournament Settings', art: 'training-tournament-prep' },
  '/commander/td/[tournamentId]': { title: 'Control Center', art: 'training-lobby', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/chips': { title: 'Chip Counts', art: 'training-equity-calculator', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/clock': { title: 'Clock', art: 'tournament-calendar', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/color-up': { title: 'Color Up', art: 'icm', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/dealers': { title: 'Dealer Rotation', art: 'training-category-spins', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/payouts': { title: 'Payouts', art: 'training-rake-solutions', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/players': { title: 'Players', art: 'training-multiway-preflop', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/register': { title: 'Register Player', art: 'preflop-tutorial', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/reports': { title: 'Reports', art: 'training-icm-simulator', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/results': { title: 'Final Results', art: 'pnm-series', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/tables': { title: 'Tables', art: 'training-final-table-sim', parent: 'Tournament Director' },
};

/** Normalise a Next route (`router.pathname`) to its registry key. */
export function pageHeaderFor(pathname) {
  if (!pathname) return null;
  const key = pathname.replace(/\/index$/, '').replace(/\/$/, '') || pathname;
  return PAGE_HEADERS[key] || null;
}

/** "Members | Commander" -> "Members"; "Commander - Clock" -> "Clock". */
export function cleanLayoutTitle(title) {
  if (typeof title !== 'string') return '';
  return title
    .replace(/\s*\|\s*(Club\s+)?Commander\s*$/i, '')
    .replace(/^(Club\s+)?Commander\s*[-|]\s*/i, '')
    .trim();
}
