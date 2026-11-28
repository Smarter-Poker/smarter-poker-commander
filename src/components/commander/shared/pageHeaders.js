/**
 * #SMARTERDESIGN page image headers - one entry per Club Commander staff page
 * (Dan, 2026-11-27: "CLUB COMMANDER NEEDS THE SAME #SMARTERDESIGN UPGRADE TO
 * EVERY SINGLE PAGE, SUBPAGE, BUTTON AND EVERYTHING ELSE, EXACTLY LIKE WE'VE
 * DONE FOR EVERY OTHER WORLD HUB PAGE").
 *
 * Each route names its page title and the artwork pair in
 * public/images/smarterdesign/headers/<art>-seal.webp / -scene.webp (the same
 * library World Hub uses; `cashier` is Club Arena's Cashier vault, the
 * reference header). Subpages share their section's art so a section reads
 * as one place; sections never share each other's.
 *
 * Routes with NO entry get no image header on purpose: TV displays, kiosks,
 * table tablets, the public check-in and tournament screens, and the sign-in
 * and onboarding flows. They still get the #SMARTERDESIGN palette and rims.
 */
export const PAGE_HEADERS = {
  '/commander/dashboard': { title: 'Dashboard', art: 'casino_table' },
  '/commander/activity': { title: 'Activity', art: 'news' },
  '/commander/admin': { title: 'Admin Dashboard', art: 'vip' },
  '/commander/admin/leads': { title: 'Leads', art: 'vip', parent: 'Admin' },
  '/commander/admin/pilots': { title: 'Pilots', art: 'vip', parent: 'Admin' },
  '/commander/analytics': { title: 'Analytics', art: 'jarvis' },
  '/commander/announcements': { title: 'Announcements', art: 'news' },
  '/commander/notifications': { title: 'Notifications', art: 'news' },
  '/commander/arena-ledger': { title: 'Arena Ledger', art: 'bankroll' },
  '/commander/cashier': { title: 'Cashier', art: 'cashier' },
  '/commander/close-day': { title: 'Close Day', art: 'receipts' },
  '/commander/time-billing': { title: 'Time Billing', art: 'toke-shift' },
  '/commander/churn-prediction': { title: 'Churn Prediction', art: 'goals' },
  '/commander/reputation': { title: 'Player Reputation', art: 'staking-profile' },
  '/commander/responsible-gaming': { title: 'Responsible Gaming', art: 'rules' },
  '/commander/clock-setup': { title: 'Clock Setup', art: 'tournament-calendar' },
  '/commander/comps': { title: 'Comps', art: 'store-rewards' },
  '/commander/promotions': { title: 'Promotions', art: 'store-diamonds' },
  '/commander/high-hands': { title: 'High Hands', art: 'poker_cash' },
  '/commander/leagues': { title: 'Leagues And Freerolls', art: 'series' },
  '/commander/leaderboard-builder': { title: 'Leaderboard Builder', art: 'series' },
  '/commander/tournament-leaderboards': { title: 'Tournament Leaderboards', art: 'series' },
  '/commander/dealers': { title: 'Dealers', art: 'toke-home' },
  '/commander/dealer-rotation': { title: 'Dealer Rotation', art: 'toke-home' },
  '/commander/staff': { title: 'Staff', art: 'staking-profile' },
  '/commander/schedule': { title: 'Staff Schedule', art: 'tournament-calendar' },
  '/commander/time-clock': { title: 'Time Clock', art: 'toke-shift' },
  '/commander/shift-handoff': { title: 'Shift Handoff', art: 'players' },
  '/commander/displays': { title: 'Displays', art: 'sports' },
  '/commander/streaming': { title: 'Streaming', art: 'sports' },
  '/commander/docs': { title: 'Documentation', art: 'rules' },
  '/commander/docs/manager-guide': { title: 'Manager Guide', art: 'rules', parent: 'Documentation' },
  '/commander/docs/staff-guide': { title: 'Staff Guide', art: 'rules', parent: 'Documentation' },
  '/commander/docs/troubleshooting': { title: 'Troubleshooting', art: 'rules', parent: 'Documentation' },
  '/commander/incidents': { title: 'Incidents', art: 'rules' },
  '/commander/downloads': { title: 'Downloads', art: 'export' },
  '/commander/install': { title: 'Install On Tablet', art: 'export' },
  '/commander/exports': { title: 'Data Exports', art: 'export' },
  '/commander/member-import': { title: 'Import Members', art: 'export' },
  '/commander/floor': { title: 'Floor Map', art: 'toke-venues' },
  '/commander/floor-calls': { title: 'Floor Calls', art: 'toke-venues' },
  '/commander/tables': { title: 'Tables', art: 'casino_table' },
  '/commander/table-assignments': { title: 'Table Assignments', art: 'casino_table' },
  '/commander/table-tablets': { title: 'Table Tablets', art: 'casino_table' },
  '/commander/table-vibes': { title: 'Table Vibes', art: 'slots' },
  '/commander/game-types': { title: 'Game Types', art: 'poker_cash' },
  '/commander/open-game': { title: 'Open Cash Game', art: 'poker_cash' },
  '/commander/must-move': { title: 'Must-Move Games', art: 'poker_cash' },
  '/commander/waitlist/desk': { title: 'Waitlist Desk', art: 'players' },
  '/commander/members': { title: 'Members', art: 'players' },
  '/commander/members/[id]': { title: 'Member', art: 'players', parent: 'Members', useLayoutTitle: true },
  '/commander/membership-plans': { title: 'Membership Plans', art: 'vip' },
  '/commander/marketplace': { title: 'Marketplace', art: 'store-cart' },
  '/commander/poker-room': { title: 'Poker Room', art: 'settings' },
  '/commander/room-presets': { title: 'Daily Presets', art: 'settings' },
  '/commander/settings': { title: 'Settings', art: 'settings' },
  '/commander/system-info': { title: 'System Info', art: 'settings' },
  '/commander/print-station': { title: 'Print Station', art: 'receipts' },
  '/commander/qr-code': { title: 'Check-In QR Code', art: 'store-orders' },
  '/commander/reports': { title: 'Reports', art: 'reports' },
  '/commander/reports/analytics-daily': { title: 'Daily Analytics', art: 'reports', parent: 'Reports' },
  '/commander/reports/daily-summary': { title: 'Daily Summary', art: 'reports', parent: 'Reports' },
  '/commander/reports/player-activity': { title: 'Player Activity', art: 'reports', parent: 'Reports' },
  '/commander/reports/revenue': { title: 'Revenue', art: 'reports', parent: 'Reports' },
  '/commander/reports/staff-activity': { title: 'Staff Activity', art: 'reports', parent: 'Reports' },
  '/commander/reports/table-utilization': { title: 'Table Utilization', art: 'reports', parent: 'Reports' },
  '/commander/reports/tax-compliance': { title: 'Tax Compliance', art: 'tax', parent: 'Reports' },
  '/commander/reports/tournament-results': { title: 'Tournament Results', art: 'reports', parent: 'Reports' },
  '/commander/reports/waitlist-metrics': { title: 'Waitlist Metrics', art: 'reports', parent: 'Reports' },
  '/commander/tournaments': { title: 'Tournaments', art: 'poker_mtt' },
  '/commander/tournaments/[id]/settings': { title: 'Tournament Settings', art: 'poker_mtt', parent: 'Tournament' },
  '/commander/tournament-controls': { title: 'Tournament Director', art: 'poker_mtt' },
  '/commander/tournament-maintenance': { title: 'Tournament Maintenance', art: 'poker_mtt' },
  '/commander/tournament-settings': { title: 'Tournament Settings', art: 'poker_mtt' },
  '/commander/td/[tournamentId]': { title: 'Control Center', art: 'poker_mtt', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/chips': { title: 'Chip Counts', art: 'bankroll', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/clock': { title: 'Clock', art: 'tournament-calendar', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/color-up': { title: 'Color Up', art: 'bankroll', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/dealers': { title: 'Dealer Rotation', art: 'toke-home', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/payouts': { title: 'Payouts', art: 'store-rewards', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/players': { title: 'Players', art: 'players', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/register': { title: 'Register Player', art: 'players', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/reports': { title: 'Reports', art: 'reports', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/results': { title: 'Final Results', art: 'store-rewards', parent: 'Tournament Director' },
  '/commander/td/[tournamentId]/tables': { title: 'Tables', art: 'casino_table', parent: 'Tournament Director' },
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
