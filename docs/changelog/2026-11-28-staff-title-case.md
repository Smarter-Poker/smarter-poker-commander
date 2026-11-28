# Title Case on every Commander UI string (2026-11-28)

Dan's binding house style: every word of a UI label is capitalised
("Back To Dashboard", "Connection Error. Please Try Again."), acronyms keep
their case (RSVP, QR, PIN, ID, W-2G, TV) and every part of a hyphenated word
is capitalised ("Check-In", "Buy-In").

## What changed (2,983 strings)

| Area | Strings |
|---|---|
| `pages/commander` staff + player pages (toasts, errors, confirms, empty states, placeholders, aria-labels, titles, labels, table headers, statuses, TV display text) | 551 |
| `pages/commander/docs/*` (headings, step titles, list labels, callouts, short UI sentences up to 12 words) | 523 |
| `pages/api/**` `error` / `message` values the UI shows verbatim in toasts | 1,693 |
| `src/` (shared libs and components) | 42 |
| `vendor/commander-shared/src` (upstream first: commander-shared PR #94) | 174 |

Value-led labels are included: `{n} Players`, `Page {n} Of {total}`,
`{n} Days Left`.

## How

`scripts/title-case-scan.mjs` parses every file with espree (JSX on), so it
knows where a string sits, and rewrites only text in UI positions (`--fix`).
It never rewrites a text that is also used in a compared or stored position
anywhere in the scanned files. The law `tests/unit/titleCase.law.test.js`
runs it over `pages`, `src` and the vendored package on every `npm test` and
fails on any new sentence-case UI string; a fixture proves it tells UI text
from machine text.

## Deliberately left, and why

- Stored or compared values (`scripts/ci/title-case-allowlist.json`, 11
  entries, each with its reason): hand names "Four of a Kind" / "Three of a
  Kind" (saved `hand_type`, rank-map keys), comp ledger defaults "Manual comp
  issued" / "Manual adjustment" (written to transactions, same as the server
  default), "Twilio not configured" / "OneSignal not configured" (also the
  helpers' machine `reason`), and three payout messages whose lowercase words
  are literal request/response field names (`force`, `skipped`).
- Every machine string: comparisons, `case` labels, object keys, `value=`,
  `className=`, reason/notes/type/status/code properties, query builder and
  storage arguments, event names, URLs, regex, CSS, SQL.
- Console/logger text and errors thrown inside API routes (logs).
- Search-engine metadata (`<SEOHead description>`), not on screen.
- Prose over 12 words: 7 multi-sentence help paragraphs in the docs guides
  (e.g. troubleshooting `details` and staff-guide `note` text) stay written as
  sentences; every heading, step and label around them is Title Case.
- SMS and push message bodies (vendor `lib/commander/{twilio,notifications,
  pushNotifications}.js`): messages to a player's phone, not app labels.
- Files with no UI text: `src/lib/supabaseKeys.js` (console), `src/lib/probe/*`
  (probe step names in `cron_execution_log`), vendor `agentExecution.mjs`
  (CI tooling), `src/lib/commander/desktopReleaseSource.js` (diagnostics the
  Downloads page never shows).

## Robustness fixes made on the way

- `pages/commander/cashier.js` compared `patchJson.error` with the server's
  "Transaction already voided"; both sides now read "Transaction Already
  Voided".
- `pages/commander/member-import.js` skipped duplicates by substring-matching
  lowercase error text; it now reads the route's `duplicate` flag and matches
  case-insensitively.

## Tests updated

`tests/unit/homeGamesMembersRoute.test.js`, `tests/unit/homeGamesPublicBoundary.test.js`,
`tests/integrity/api-error-handler.test.mjs`, `tests/integrity/global-header.test.mjs`
(header aria-labels "Go Back", "Go To The Hub"). Vendor baseline shrank by two
(AddBuyinModal.jsx, PayoutModal.jsx are byte-identical with upstream again).
