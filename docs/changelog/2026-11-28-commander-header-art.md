# 2026-11-28 - Every Commander staff page gets its own header art

## What changed

Until now the staff registry (`src/components/commander/shared/pageHeaders.js`)
had 28 artwork pairs for 85 pages: 57 pages reused another page's scene and
seal, so whole sections (every report, every tournament page, every table
page) wore one picture. The World Hub library
(`public/images/smarterdesign/headers/` in Smarter-Poker-World-Hub) now holds
about 145 pairs, so every page was remapped after looking at the art:

- 82 distinct pairs for 85 pages. Three pairs are shared, each by the same job
  under two routes: Dealer Rotation (`dealer-rotation`, `td/[id]/dealers`),
  Tournament Settings (`tournament-settings`, `tournaments/[id]/settings`) and
  the Documentation book (`docs`, `docs/troubleshooting`).
- The scene shows what the page does (stopwatch and hourglass for the time
  clock, the host's podium for the waitlist desk, a broadcast seal for floor
  calls, a tablet for table tablets, a download seal for Install, a hammer for
  tournament maintenance, a scales-and-stacks scene for chip color-up). The
  roulette scene (`casino_table`) is gone from a poker room: Dashboard is the
  session-dashboard gauge, Tables is the felt-and-chips pair.
- Cashier stays on the Club Arena vault.
- 57 pairs copied byte-identical from World Hub main. `store-cart` and
  `store-rewards` were refreshed to World Hub's current bytes. Four pairs no
  page shows any more were removed (`casino_table`, `slots`,
  `store-diamonds`, `store-orders`).
- Dashboard section seals: Tables And Floor uses the table seal (was the
  roulette wheel), Staff uses the staff-group seal, Displays uses the
  presentation-screen seal.

## Law

`tests/unit/smarterdesign.law.test.js` now also pins: art reuse is at most 3,
a shared pair is only shared by pages with the same title or the same
section, and every header image in the folder is shown by some page.

## Mapping

| Route | Title | Art |
|---|---|---|
| `/commander/dashboard` | Dashboard | `training-session-dashboard` |
| `/commander/activity` | Activity | `training-training-feed` |
| `/commander/admin` | Admin Dashboard | `training-skill-tree` |
| `/commander/admin/leads` | Leads | `training-study-group-finder` |
| `/commander/admin/pilots` | Pilots | `pnm-locations` |
| `/commander/analytics` | Analytics | `jarvis` |
| `/commander/announcements` | Announcements | `news` |
| `/commander/notifications` | Notifications | `pnm-alerts` |
| `/commander/arena-ledger` | Arena Ledger | `bankroll` |
| `/commander/cashier` | Cashier | `cashier` |
| `/commander/close-day` | Close Day | `training-daily-challenge` |
| `/commander/time-billing` | Time Billing | `toke-shift` |
| `/commander/churn-prediction` | Churn Prediction | `goals` |
| `/commander/reputation` | Player Reputation | `staking-profile` |
| `/commander/responsible-gaming` | Responsible Gaming | `training-tilt-guard` |
| `/commander/clock-setup` | Clock Setup | `training-goals` |
| `/commander/comps` | Comps | `store-rewards` |
| `/commander/promotions` | Promotions | `store-wishlist` |
| `/commander/high-hands` | High Hands | `preflop-achievements` |
| `/commander/leagues` | Leagues And Freerolls | `series` |
| `/commander/leaderboard-builder` | Leaderboard Builder | `preflop-leaderboard` |
| `/commander/tournament-leaderboards` | Tournament Leaderboards | `training-community-leaderboard` |
| `/commander/dealers` | Dealers | `toke-home` |
| `/commander/dealer-rotation` | Dealer Rotation | `training-category-spins` |
| `/commander/staff` | Staff | `pnm-more` |
| `/commander/schedule` | Staff Schedule | `training-training-calendar` |
| `/commander/time-clock` | Time Clock | `training-focus-timer` |
| `/commander/shift-handoff` | Shift Handoff | `training-session-notes` |
| `/commander/displays` | Displays | `training-scenario-demo` |
| `/commander/streaming` | Streaming | `sports` |
| `/commander/docs` | Documentation | `rules` |
| `/commander/docs/manager-guide` | Manager Guide | `training-glossary` |
| `/commander/docs/staff-guide` | Staff Guide | `training-my-playbook` |
| `/commander/docs/troubleshooting` | Troubleshooting | `rules` |
| `/commander/incidents` | Incidents | `training-blind-defense` |
| `/commander/downloads` | Downloads | `export` |
| `/commander/install` | Install On Tablet | `training-gto-preloader` |
| `/commander/exports` | Data Exports | `toke-vault` |
| `/commander/member-import` | Import Members | `training-hand-history-upload` |
| `/commander/floor` | Floor Map | `pnm-map` |
| `/commander/floor-calls` | Floor Calls | `training-live-hud-sync` |
| `/commander/tables` | Tables | `pnm-live` |
| `/commander/table-assignments` | Table Assignments | `training-position-mastery` |
| `/commander/table-tablets` | Table Tablets | `store-order-detail` |
| `/commander/table-vibes` | Table Vibes | `training-study-group` |
| `/commander/game-types` | Game Types | `training-table-wizard` |
| `/commander/open-game` | Open Cash Game | `poker_cash` |
| `/commander/must-move` | Must-Move Games | `training-multi-table` |
| `/commander/waitlist/desk` | Waitlist Desk | `toke-venues` |
| `/commander/members` | Members | `players` |
| `/commander/members/[id]` | Member | `training-player-profiles` |
| `/commander/membership-plans` | Membership Plans | `vip` |
| `/commander/marketplace` | Marketplace | `store-cart` |
| `/commander/poker-room` | Poker Room | `pnm-venues` |
| `/commander/room-presets` | Daily Presets | `pnm-calendar` |
| `/commander/settings` | Settings | `settings` |
| `/commander/system-info` | System Info | `training-custom-solve` |
| `/commander/print-station` | Print Station | `receipts` |
| `/commander/qr-code` | Check-In QR Code | `training-weakness-scanner` |
| `/commander/reports` | Reports | `reports` |
| `/commander/reports/analytics-daily` | Daily Analytics | `toke-analytics` |
| `/commander/reports/daily-summary` | Daily Summary | `training-daily-goals` |
| `/commander/reports/player-activity` | Player Activity | `preflop-stats` |
| `/commander/reports/revenue` | Revenue | `staking` |
| `/commander/reports/staff-activity` | Staff Activity | `training-streaks` |
| `/commander/reports/table-utilization` | Table Utilization | `training-aggregate` |
| `/commander/reports/tax-compliance` | Tax Compliance | `tax` |
| `/commander/reports/tournament-results` | Tournament Results | `training-famous-finals` |
| `/commander/reports/waitlist-metrics` | Waitlist Metrics | `training-progress` |
| `/commander/tournaments` | Tournaments | `poker_mtt` |
| `/commander/tournaments/[id]/settings` | Tournament Settings | `training-tournament-prep` |
| `/commander/tournament-controls` | Tournament Director | `training-tournaments` |
| `/commander/tournament-maintenance` | Tournament Maintenance | `training-drill-builder` |
| `/commander/tournament-settings` | Tournament Settings | `training-tournament-prep` |
| `/commander/td/[tournamentId]` | Control Center | `training-lobby` |
| `/commander/td/[tournamentId]/chips` | Chip Counts | `training-equity-calculator` |
| `/commander/td/[tournamentId]/clock` | Clock | `tournament-calendar` |
| `/commander/td/[tournamentId]/color-up` | Color Up | `icm` |
| `/commander/td/[tournamentId]/dealers` | Dealer Rotation | `training-category-spins` |
| `/commander/td/[tournamentId]/payouts` | Payouts | `training-rake-solutions` |
| `/commander/td/[tournamentId]/players` | Players | `training-multiway-preflop` |
| `/commander/td/[tournamentId]/register` | Register Player | `preflop-tutorial` |
| `/commander/td/[tournamentId]/reports` | Reports | `training-icm-simulator` |
| `/commander/td/[tournamentId]/results` | Final Results | `pnm-series` |
| `/commander/td/[tournamentId]/tables` | Tables | `training-final-table-sim` |
