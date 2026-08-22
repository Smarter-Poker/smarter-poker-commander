# PokerAtlas TableCaptain — Master Feature Inventory & Club Commander Parity Audit

Date: 2026-08-04
Method: 5-agent web research sweep (official product pages, PokerAtlas consumer site/apps, Zendesk help center via API, USPTO trademark filing, press, app-store listings/reviews, player forums, competitor material) cross-checked against the complete Club Commander live schema-validated sweep performed 2026-07-29 → 2026-08-04.
Sources: ~50 URLs, listed at the end of each part.

---

# PART 1 — TABLECAPTAIN / POKERATLAS MASTER INVENTORY

## 1.1 Product & company identity

| Fact | Detail |
|---|---|
| Product | TableCaptain (current gen: "TableCaptain 2", cloud-based) — "Poker Room Marketing & Management System" |
| Maker | PokerAtlas, brand of **Overlay Gaming Corporation** (founded 2011, Las Vegas; AllVegasPoker → PokerAtlas rebrand 2014) |
| CEO | Jon Friedberg (WSOP bracelet winner) |
| Launched | April 7, 2015; early installs CA / NV / FL |
| Scale claims | 180+ casinos & card rooms on TableCaptain; 300+ properties on software/media services; 6M annual player audience; 50,000+ tournament/game listings |
| Marquee rooms | Wynn Las Vegas (switched from Bravo May 15, 2024), Resorts World LV, Westgate, Sahara (closed 2024), Thunder Valley (CA), Texas Card House (all locations), Club One Casino (Fresno), bestbet, Bay 101, The Lodge |
| Trademark (USPTO 90609282) | "monitoring and managing poker room and table game operations… real-time wait times, seating notifications, tournament broadcasts, promotions… interactive kiosk systems for player check-in… loyalty program tracking across multiple casinos" |
| Deployment | Cloud (TC2); originally single on-prem workstation (2015). No published OS/server requirements |
| Pricing | Quote-only ("variable based on specific room requirements"); Typeform intake; quote in ≤48 business hours; asks table count + WiFi/ethernet per table |
| Support | Sales (702) 910-2300 / support 702-745-2929; help center is a thin 15-article marketing shell — no public manual |
| Security/compliance | **Nothing published.** No certifications, PCI statements, encryption claims, or regulator integrations documented anywhere public |
| Main competitor | Bravo Poker Live (Genesis Gaming) — incumbent at MGM/Caesars/Venetian/WSOP; card-swipe patron integration, Poker Watch floor monitoring, Tournament Watch, Bravo Pit ratings |

## 1.2 Venue-side modules (the 12 official modules + confirmed mechanics)

1. **Game & Waitlist Management** — core brush console: open/close/modify cash games, manage per-game waitlists, table oversight; whole room manageable from a single console. Training video: "Game Creation and Modification."
2. **Online Waitlist Registration** — players join a live cash-game waitlist remotely from the PokerAtlas app/site *before arrival*. Opt-in per venue ("certain properties"). At Wynn it fully replaced phone-in lists. Players see live queue position after joining. Arrival is confirmed with a geolocation-gated "I have arrived" tap in the app.
3. **Tournament Management** — scheduling (incl. "Copy Days" recurring-day templates), registration, live updates. Training videos: "Scheduling Tournaments Using Copy Days."
4. **Tournament blind structures / level management** — full blind/level structure builder driving the clock. Training video: "Creating a Tournament Blind Structure."
5. **Live Tournament Info** — real-time clock/level/status broadcast to displays + PokerAtlas app ("Live Tournament Clocks"). Four consumer tabs per event: **Clock / Structure / Chips / Payout** (login-gated on PokerAtlas).
6. **Tournament Chip Counts** — continuous chip-count entry (via per-table tablets) broadcast live; PokerAtlas Tour publishes counts for EVERY player start-to-finish; "Playback" chip-graph visualization built from this data.
7. **Payouts Management** — tournament payout calculation ("fast and accurate"); Wynn cites "faster tournament payouts"; digital redraws cited at Wynn.
8. **Patron Management** — player database/profiles; multi-casino loyalty tracking (per trademark).
9. **Digital Player Cards** — digital player ID replacing plastic loyalty cards.
10. **Promotions Management** — configure/target promotions; broadcast to displays + PokerAtlas. Training video: **"Virtual Drawings"** (randomized promotional drawings module).
11. **Reporting & Analytics** — business analytics, "actionable insights" (no public field-level detail).
12. **Patron & POS Integration** — ties into casino patron/POS systems; Wynn converts poker comp balances into property-wide **COMPDOLLARS**; Sahara paid $2/hr comps for app usage.

**Staff/security model (confirmed):** per-employee User IDs + PINs created by admin (training video: "Creating Employees with User Id and PINs") → role-based, PIN-gated staff actions. Permission tiers/audit logs not publicly documented.

**Hardware layer:** in-table touchscreens ("Elite" tables, built with partners like 916 Poker Depot and Gorilla Gaming); interactive self-check-in kiosks; operator workstation; big-board/TV waitlist + clock displays. Dealer-side tablet buttons for **chip fills, beverage service, food menus** (observed at Resorts World).

## 1.3 Consumer platform (pokeratlas.com + iOS/Android apps)

**Directory layer (not TableCaptain-dependent):**
- Venue profiles: photos, star rating + review count, address/directions, phone, website, table count, per-day hours + "Open Now", minimum age, ~20 boolean amenities (auto shufflers, phone-in list, food tableside, massage, USB chargers, WiFi, non-smoking, valet, check cashing, jackpots, comps offered…), venue type, rewards program, **comp rate ($/hr)**, editorial description, nearby rooms.
- Cash-game database: per game — stakes, game type, min–max buy-in, "Runs" frequency, blinds/straddle rules, **house rake detail** (e.g. "staggered up to $5 10/20/50/90"), comp rate.
- Tournament database: every event — date/time, buy-in (entry/admin fee split), starting chips, guarantees, late-reg cutoff, **full blind-structure sheets** (level/length/SB/BB/ante/breaks).
- Series/festival coverage: every US/CA series, filterable, with full schedules per event.
- Reviews (1–5 stars + text), TableTalk forum (venue-taggable), check-ins, favorites, user profiles, Recent Action activity feed, room-published Announcements, news.

**Live layer (TableCaptain-dependent, login-gated = account funnel):**
- "Games in Progress" per venue: real-time games running, tables per game, waitlist (names/aliases + count).
- Live waitlist join (remote registration) at opted-in venues.
- Live Tournament Clocks area page (all clocks running now) + per-event Clock/Structure/Chips/Payout tabs.
- Venue-embeddable auto-refreshing waitlist widget (e.g., The Lodge's site).

**Apps (iOS 4.8★/10k ratings; Android 4.4★/100k+ downloads):** GPS room finder, all of the above, push notifications for tournaments, waitlist seat-available alerts, check-ins, list/map views. Collects background location (aggressively — a top complaint).

**PokerAtlas PRO subscription ($7.99/mo, $69.99/yr):** favorites/filters, live game & tournament COUNTS, calendar sync, reminders, priority features, Valuetown partner deals ($ off entries, F&B vouchers, match-play), **personalized waitlist alias**, gold avatar identity.

**Monetization stack:** TableCaptain SaaS (quote-based) + advertising network (display, takeovers, email, socials, sponsorships) + PRO subscriptions + Valuetown deals + online-poker affiliate listings + PokerAtlas Tour events business.

## 1.4 Real-world behaviors & known weaknesses (attack surface for "better")

- **Geolocation check-in fails constantly** — players standing IN the room get "not close enough" (~90% per one complaint, unanswered by support); app demands always-on background location or errors.
- **Punitive position holds** — e.g., Encore Boston: dropped from list after 1 hour even mid-wait; rejoin = back of the line.
- **No numbered waitlist positions** shown next to names in-app (repeated player request, unaddressed).
- **Custom alias is a PAID (PRO) feature**; users can't figure out how to change aliases; support threads unanswered since 2018.
- **App instability**: crashes after updates, login failures, dark-mode unreadable text, missing tournament days; one PRO buyer reported features breaking after paying with no reachable support.
- **Ads in the app** cause accidental taps.
- **Closed system**: no public API, no self-serve pricing, dormant help center (15 marketing articles, newest Nov 2024), no published security posture.
- **No poker-specific SMS mechanics documented**; notification granularity thin.
- vs Bravo: lacks card-swipe deep patron integration and pit-side ratings product.

---

# PART 2 — CLUB COMMANDER PARITY MATRIX

Legend: ✅ built & working (verified in the 2026-07-29→08-04 live sweep) · 🟡 built but partial/needs work · ❌ missing · 🐞 known bug/flagged decision.

## 2.1 Venue-side (staff console) parity

| TableCaptain capability | Commander status | Detail / gap |
|---|---|---|
| Cash game create/modify/close | ✅ | games API + open-game.js, game-types (toggle/delete fixed) |
| Waitlist management (per-game lists, call-ins) | ✅ / 🟡 | waitlist APIs + pages work; **no distinct phone-in vs online vs walk-in list classes**; no per-venue list-priority rules |
| Single-console floor overview | ✅ | floor.js, tables.js, dashboard.js |
| Table/seat management, transfers, seat locks | ✅ | tables, table-assignments, session-action move (venue-scoped, fixed) |
| Must-move / feeder games | 🟡 | must-move.js page exists — needs E2E validation pass; TableCaptain's exact logic unpublished (opportunity to out-spec them) |
| Tournament scheduling | ✅ | tournaments/index + schedule.js |
| Recurring schedule via "Copy Days" templates | 🟡 | Commander has DB templates (save/load, just built) — **no copy-day/recurring calendar generator** |
| Blind structure builder | ✅ | BlindStructureEditor + reorder (just shipped) |
| Tournament clock (live) | ✅ | clock.js API + tournament-clocks.js + displays/combined |
| Registration / buy-ins / re-entry | ✅ | tournament-registration.js (crash fixed), add-player/re-entry page (just built) |
| Rebuys / add-ons / bounties | ✅ | entries endpoints + bounty capture (just built) |
| Chip counts per player | ✅ / 🟡 | tablet chip-update works; **no continuous every-player published counts, no chip-graph "Playback" equivalent** |
| Payout calculation | ✅ | payout.js (fixed) + payouts editor (just built) |
| Digital redraws | 🟡 | break-table/move logic exists; **no dedicated redraw ceremony UI/publication** |
| Multi-day / flights | ✅ | is_multi_day, flight_label, parent_tournament_id in schema |
| Patron management (profiles) | ✅ | members.js + profiles + member-import |
| Digital player cards | ✅ / 🟡 | member QR + qr-code.js + player-scan-in (staff-gated); **no wallet-pass (Apple/Google) card** |
| Multi-venue loyalty | ✅ (better) | smarter.poker global profiles span venues natively — TableCaptain only claims this in a trademark |
| Promotions management | ✅ | promotions.js (75KB console) + awards |
| Virtual drawings / raffles | ❌ | **no drawings module** (random-winner promos) — TableCaptain has a dedicated one |
| High hands / jackpots | ✅ / 🐞 | high-hands works (player_name col added); TV high-hand/jackpot panel still needs redesign (flagged) |
| Reporting & analytics | ✅ | reports/* (daily, revenue, utilization, waitlist-metrics), analytics.js, exports (incl. Hendon Mob) |
| Patron/POS integration | ❌ | **no external POS / patron-system / comp-dollar bridge** (Commander comps are internal only) |
| Staff IDs + PINs, roles | ✅ | commander_staff + PIN verify + guardStaff/guardWriteStaff (hardened in sweep) |
| Audit logs | ✅ | admin/audit-logs.js |
| In-table touchscreens | ✅ | table-tablets console + tablet/[n] kiosk + player/[n] displays (realtime, pause-billing, add-time — all just shipped) |
| Dealer service buttons (chips/F&B) | ✅ | services API (player in-seat request bug flagged → fix in 2.3) |
| Self-check-in kiosks | ✅ | kiosk.js (49KB) + checkin APIs |
| TV big boards (waitlist/clock/promos) | ✅ | displays/* suite (promos panel fixed) |
| SMS/text seat notifications | ❌ | **no SMS layer** (Twilio webhook stub exists for status only) — trademark-level feature for TC |
| Time-based session billing | ✅ (unique) | time-billing suite — TableCaptain has nothing public here |

## 2.2 Consumer-network parity (their real moat)

| PokerAtlas capability | smarter.poker status | Gap |
|---|---|---|
| Public venue directory w/ amenities, hours, rake, comp rate | 🟡 | poker_venues + venue pages exist in World Hub; **no structured amenities checklist, rake/straddle/buy-in DB, comp-rate field, "Open Now" logic** |
| Venue reviews + ratings | ✅ / 🐞 | venues/[id]/reviews works; review_count aggregate bug flagged |
| Cash-game database ("runs" frequency, stakes detail) | ❌ | no public per-game static DB with rake/straddle/frequency |
| Tournament schedule DB + full structure sheets public | 🟡 | sync-tournament-to-club exists; poker-near-me lists series; **no public per-event structure sheet pages** |
| Series/festival coverage | ✅ | poker series DB + scrapers (separate audit) |
| **Live "Games in Progress" per venue (public)** | ❌ | Commander has the data; **not published to World Hub venue pages** |
| **Remote waitlist join from consumer app** | 🟡 | waitlist public-join API exists (game-type bug fixed) — **not surfaced in player-facing hub UI with live position tracking** |
| Geolocated "I have arrived" check-in | ❌ | no arrival-confirmation flow (opportunity: do it better — QR at podium OR geofence, no always-on tracking) |
| Seat-ready push alerts | 🟡 | push-subscription schema fixed & live; **no waitlist-position notification pipeline wired** |
| Live tournament clocks public | ❌ | clocks exist; **no public live-clock page per venue/event on smarter.poker** |
| Live chip counts / payouts public | ❌ | data exists; not published |
| Waitlist aliases | ❌ | trivial to add (free — undercut their paid PRO perk) |
| Favorites / reminders / calendar sync | 🟡 | hub follows exist; no tournament reminders/calendar-sync |
| PRO-style subscription | ✅ (different) | smarter.poker already has subscriptions/diamonds; Valuetown-style venue deals ❌ |
| Announcements room→players | ✅ | announcements API + social feed (bigger than PA's) |
| Community/forum | ✅ (better) | full social network vs TableTalk forum |

## 2.3 Known Commander bugs/stubs still open (from the sweep — must-fix for "1:1 but better")

1. 🐞 admin/api-keys.js stores/returns raw key vs table's key_hash design (security decision needed).
2. 🐞 services/request.js (player in-seat) inserts nonexistent table_id/metadata → fold into details jsonb.
3. 🐞 venues/[id]/reviews.js updates nonexistent review_count → venue rating never refreshes.
4. 🐞 home-games/events/[id]/reviews.js: ambiguous profiles embed + comment/is_anonymous mapping.
5. 🐞 home-games/groups/[id]/members.js: invited_by embed has no FK.
6. 🐞 displays content: high-hand + progressive-jackpot panels select nonexistent columns (needs profiles-join redesign).
7. 🐞 seat_preferences venue_id type mismatch.
8. 🐞 floor-call.js tablet status 'active' vs queue-status mismatch (secondary).
9. ⏳ PR #24 (time-billing rate/total/duration + W-2G tax columns) — decision: add columns vs amount_paid model.
10. ⏳ PR #25 (shift_handoffs.venue_id uuid→int) — blocked on remapping 10 legacy rows.
11. 🟡 rotations.js one leftover `.eq('table_id', parseInt(...))` in end-assignment (verify shipped in #20 follow-up).
12. 🟡 must-move.js and td/* display pages never got the deep E2E pass the APIs got.

## 2.4 Missing-feature build list (priority-ordered for 1:1-but-better)

**P0 — closes their moat (the consumer live layer):**
1. Publish Commander live data to smarter.poker venue pages: games running, tables per game, waitlist counts + aliases, live tournament clocks with Clock/Structure/Chips/Payout tabs. (All data already exists in Supabase — this is a read-path + UI project.)
2. Player-facing remote waitlist join in the hub (pages/hub/commander): join, see live numbered position (they don't show numbers — we will), leave, rejoin with position-grace.
3. Arrival check-in flow: podium QR scan OR geofence tap — with venue-configurable hold windows and a non-punitive grace policy (auto-hold, not delete; rejoin keeps credit).
4. Seat-ready + position-change push notifications (web push infra now live) + optional SMS via Twilio.
5. Public live-clock pages + every-player chip counts + a chip-history "Playback" graph (differentiator parity with their Tour tech).

**P1 — venue-side parity gaps:**
6. Virtual drawings/raffles module under promotions (drawing pool from checked-in/session players, animated winner reveal on TV displays, audit trail).
7. Copy-days recurring tournament scheduler (generate a week/month from day templates).
8. Waitlist classes & priority rules: phone-in vs online vs walk-in, per-venue hold times, call-in expiry — venue-configurable.
9. Dedicated redraw ceremony (final-table/TV-ready seat draw publication).
10. Digital player card → Apple/Google Wallet pass with QR.
11. SMS notification channel (seat ready, tournament starting, promo won).

**P2 — structured directory data (their static moat):**
12. Venue amenities checklist (~20 booleans), rake structure, comp rate, straddle rules, per-game "runs" frequency on World Hub venue pages; "Open Now" hours logic.
13. Public tournament structure sheets per event (data already in blind_structure jsonb).
14. Valuetown-style venue deals marketplace (tie into diamonds/subscriptions).
15. Calendar sync + reminders for tournaments; favorites → alerts.

**P3 — integrations & enterprise:**
16. POS/patron-system integration layer (comp-balance export, generic webhook + CSV first, then vendors).
17. Public read API (they have none — a developer API is a differentiator).
18. Published security posture (RLS docs, role model, audit-log guarantees) — they publish nothing; we can.

**Already better than TableCaptain (protect these):** time-billing engine, escrow'd home games, AI churn/wait-time/table-balance, streaming module, leagues/squads, full social network, responsible gaming, dealer rotation + shift-handoff ops, incidents, reputation, GTO training ecosystem, marketplace, global multi-venue profiles, free aliases, no forced background location, no in-app ads.

---

# PART 3 — SOURCES

Official: getpokeratlas.com; pokeratlas.com/info/table-captain; pokeratlas.com/info/about-us; pokeratlas.zendesk.com (15 articles via API); apps.apple.com id438847152; play.google.com com.overlay.pokeratlasmobile; youtube.com/@PokerAtlasTableCaptain (training videos: Employees/PINs, Game Creation, Copy Days, Blind Structure, Virtual Drawings, Elite table); USPTO trademark 90609282 (justia); fliphtml5 2015 brochure; casinovendors.com vendor page.
Press/third-party: pokernews.com (Wynn switch 2024); poker.org (Resorts World review, PokerAtlas Tour, Playback); pokertube.com (2015 launch); pokerfuse.com; pgt.com; sportskeeda.com; vegasadvantage.com (Wynn/Sahara); thundervalleyresort.com; texascardhouse.com; thelodgepokerclub.com/austin/waitlist; rwlasvegas.com; upswingpoker.com + en.wikipedia.org/wiki/Bravo_(application) + genesisgaming.com (competitor); cardplayerlifestyle.com + uspoker.com (Bravo outages); tablesready.com; justuseapp.com + mypokercoaching.com (app reviews); pokeratlas.com Table Talk threads (check-in failures, alias, Encore 1-hour drop); nj.gov DGE ruling; advertise-with-us.com (ad network); pokeratlastour.com.
Commander state: live schema-validated sweep of smarter-poker-commander (all pages/api + pages/commander), 2026-07-29 → 2026-08-04, this session.
