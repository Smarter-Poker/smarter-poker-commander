/**
 * PAGE HELP LAW (Dan, 2026-10-17)
 *
 * "PAGES DON'T NEED TITLES LIKE THIS... REMOVE ALL DESCRIPTIONS THAT EXIST
 * LIKE THIS ON ANY AND ALL PAGES. ADD A ? MARK ICON INSTEAD IN THE UPPER
 * RIGHT CORNER OF THE PAGES THAT CAN EXPLAIN ANYTHING AND ALSO LAUNCH A
 * TUTORIAL AT THE BOTTOM WHEN CLICKED."
 *
 * Pins three things:
 *   1. The shared PageHelp / PageBar contract (accessible "?" button, bottom
 *      docked non-modal dialog, Escape, focus return, route-change close,
 *      Got It / Start Tutorial / Back / Next / Done, the final step copy, the
 *      tutorial focus outline).
 *   2. Every simplified page carries the "?" and keeps its title only as a
 *      visually hidden heading.
 *   3. The description sentences that used to sit under the titles stay gone.
 *
 * The excluded surfaces (public marketing, docs, PIN gate, TV/kiosk/player
 * screens) are deliberately not listed: they keep their words.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const help = read('src/components/commander/shared/PageHelp.jsx');
const bar = read('src/components/commander/shared/PageBar.jsx');
const css = read('styles/globals.css');

const SIMPLIFIED_PAGES = [
  'leagues.js', 'tournament-controls.js', 'tournament-maintenance.js', 'tournament-settings.js',
  'leaderboard-builder.js', 'table-assignments.js', 'tournament-leaderboards.js', 'activity.js',
  'responsible-gaming.js', 'clock-setup.js', 'incidents.js', 'shift-handoff.js', 'churn-prediction.js',
  'reports/analytics-daily.js', 'displays/index.js', 'exports.js', 'admin/pilots.js',
  'tables.js', 'game-types.js', 'members.js', 'members/[id].js', 'must-move.js', 'floor.js',
  'floor-calls.js', 'promotions.js', 'schedule.js', 'tournaments/index.js', 'table-tablets.js',
  'comps.js', 'print-station.js', 'qr-code.js', 'system-info.js', 'time-clock.js', 'member-import.js',
  'table/[id].js', 'dealer/[tableNumber].js', 'reports/revenue.js', 'reports/table-utilization.js',
  'reports/waitlist-metrics.js', 'tournaments/[id]/settings.js',
  'td/[tournamentId]/index.js', 'td/[tournamentId]/clock.js', 'td/[tournamentId]/players.js',
  'td/[tournamentId]/tables.js', 'td/[tournamentId]/chips.js', 'td/[tournamentId]/dealers.js',
  'td/[tournamentId]/payouts.js', 'td/[tournamentId]/results.js', 'td/[tournamentId]/register.js',
  'td/[tournamentId]/color-up.js', 'td/[tournamentId]/reports.js',
  'admin/leads.js', 'reports/tournament-results.js', 'reports/staff-activity.js',
  'reports/player-activity.js', 'reports/daily-summary.js', 'reports/tax-compliance.js',
  'dealers.js', 'staff.js', 'high-hands.js', 'time-billing.js', 'arena-ledger.js',
];

// The sentences that used to sit under page titles. Each now lives only in
// the page's help summary, so it may appear inside summary="..." but never as
// visible JSX text.
const REMOVED_DESCRIPTIONS = {
  'leagues.js': 'Manage Leagues, Seasons, And Freeroll Qualification',
  'tournament-controls.js': 'Manage Live Tournaments, Controls, Clock Display, And Settings',
  'tournament-maintenance.js': 'View Schedule And Make Corrections To Tournaments',
  'leaderboard-builder.js': 'Create And Manage Custom Leaderboards For The TV Display',
  'table-assignments.js': 'Assign Tables To Cash Games Or Tournaments',
  'activity.js': 'Real-Time Room Events',
  'responsible-gaming.js': 'Player Protection & Compliance',
  'clock-setup.js': 'Named Themes For Tournament Clock Displays',
  'incidents.js': 'Track Disputes, Violations, And Safety Issues',
  'shift-handoff.js': 'Pass Floor Context To Incoming Shift',
  'churn-prediction.js': 'AI Analysis Of At-Risk Players',
  'reports/analytics-daily.js': 'Aggregated Daily Metrics (Auto-Runs At 4 AM)',
  'displays/index.js': 'Configure TV Displays For Wireless HDMI',
  'exports.js': 'Download Venue Data As CSV Or JSON',
  'admin/pilots.js': 'Phase 6 - Pilot Expansion',
  'table-tablets.js': 'Tap to expand',
  'td/[tournamentId]/payouts.js': 'Auto-Calculate Or Override For Deals',
  'td/[tournamentId]/color-up.js': 'Floor Helper Only',
  'reports/tax-compliance.js': 'Tournament Wins Reporting And Withholding',
};

/** Source with every summary="..." attribute and comment removed. */
function visibleSource(src) {
  return src
    .replace(/summary="[^"]*"/g, '')
    .replace(/summary=\{'[^']*'\}/g, '')
    .replace(/summary=\{`[^`]*`\}/g, '')
    .replace(/^const [A-Z_]+_SUMMARY =[\s\S]*?;$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('PageHelp contract', () => {
  it('is an accessible 44px "?" button that opens a bottom docked non-modal panel', () => {
    expect(help).toMatch(/aria-label="Page Help"/);
    expect(help).toMatch(/w-11 h-11 rounded-full/);
    expect(help).toMatch(/border-\[#1877F2\]/);
    expect(help).toMatch(/role="dialog"/);
    expect(help).toMatch(/aria-modal="false"/);
    expect(help).toMatch(/bottom: 'max\(12px, env\(safe-area-inset-bottom\)\)'/);
    expect(help).toMatch(/max-w-\[560px\]/);
    expect(help).toMatch(/createPortal\(/);
  });

  it('closes on Escape and on route change, and returns focus to the button', () => {
    expect(help).toMatch(/event\.key === 'Escape'/);
    expect(help).toMatch(/routeChangeStart/);
    expect(help).toMatch(/buttonRef\.current\.focus\(/);
    expect(help).toMatch(/panelRef\.current\.focus\(/);
  });

  it('walks About This Page, the tutorial and the closing step', () => {
    for (const label of ['About This Page', 'Got It', 'Start Tutorial', 'Back', 'Next', 'Done', 'Close Help']) {
      expect(help).toContain(label);
    }
    expect(help).toMatch(/Step \$\{index\} Of \$\{tour\.length - 1\}/);
    expect(help).toContain('You Are All Set');
    expect(help).toContain('Tap The Question Mark In The Top Right Any Time To See This Again.');
  });

  it('lights the step target, honours reduced motion and always clears the light', () => {
    expect(help).toMatch(/data-tutorial-focus/);
    expect(help).toMatch(/prefers-reduced-motion: reduce/);
    expect(help).toMatch(/block: 'center'/);
    expect(help).toMatch(/useEffect\(\(\) => clearTutorialFocus, \[\]\)/);
    expect(css).toMatch(/\[data-tutorial-focus\]\s*\{\s*outline: 2px solid #1877F2 !important;/);
  });

  it('builds a tour from the page when no steps are passed, skipping row and dialog headings', () => {
    expect(help).toMatch(/querySelectorAll\('h2, h3'\)/);
    expect(help).toMatch(/MAX_SECTION_STEPS = 6/);
    expect(help).toMatch(/'li, \[role="dialog"\]/);
  });

  it('PageBar hides the title, keeps live children and pins the help top right', () => {
    expect(bar).toMatch(/<Heading className="sr-only">\{title\}<\/Heading>/);
    expect(bar).toMatch(/<PageHelp title=\{title\} summary=\{summary\} steps=\{steps\} className="order-last" \/>/);
    expect(bar).toMatch(/flex-wrap/);
  });

  it('has no em dash and no emoji in the new components', () => {
    for (const src of [help, bar]) {
      expect(src).not.toMatch(/\u2014/);
      expect(src).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('every simplified page', () => {
  for (const page of SIMPLIFIED_PAGES) {
    it(`${page} carries the "?" and no visible page title`, () => {
      const src = read(`pages/commander/${page}`);
      expect(src).toMatch(/<PageBar\b|<PageHelp\b|help=\{<PageHelp/);
      const h1s = [...src.matchAll(/<h1\b[^>]*>/g)].map((m) => m[0]);
      // Print templates (HTML strings for window.print) use a bare <h1>; JSX
      // headings must be visually hidden.
      for (const tag of h1s) {
        if (tag === '<h1>') continue;
        // qr-code.js: the fullscreen view is the player-facing check-in
        // screen shown on a TV or tablet, an excluded display surface.
        if (page === 'qr-code.js' && /text-4xl/.test(tag)) continue;
        expect(tag).toMatch(/className="sr-only"/);
      }
    });
  }

  for (const [page, sentence] of Object.entries(REMOVED_DESCRIPTIONS)) {
    it(`${page} no longer prints "${sentence}"`, () => {
      expect(visibleSource(read(`pages/commander/${page}`))).not.toContain(sentence);
    });
  }
});
