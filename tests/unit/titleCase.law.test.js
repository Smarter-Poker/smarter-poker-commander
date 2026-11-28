/**
 * TITLE CASE LAW FOR CLUB COMMANDER UI TEXT (2026-11-28)
 *
 * Dan's binding house style: every word of a UI label is capitalised
 * ("Back To Dashboard", "Connection Error. Please Try Again."), acronyms keep
 * their case (RSVP, QR, PIN, ID, W-2G, TV) and every part of a hyphenated word
 * is capitalised ("Check-In"). On 2026-11-28 about 2,700 sentence-case strings
 * were converted across pages/, src/ and the vendored commander-shared.
 *
 * The scanner (scripts/title-case-scan.mjs) parses every file and looks only
 * at text in UI positions: JSX text, UI attributes (aria-label, placeholder,
 * title, alt, label, ...), UI properties (label, title, message, error, ...),
 * calls that show text (toast, alert, confirm, setError, ...), and in
 * pages/api only the `error` / `message` values routes return for toasts.
 *
 * It does not touch, by design:
 *  - compared or stored values (===, case, .includes, object keys, value=,
 *    className=, reason/notes/type/status/code properties, query builders);
 *    a text that is ALSO used in such a position anywhere is never rewritten;
 *  - console/logger text and errors thrown inside API routes;
 *  - search-engine metadata (<SEOHead description>, <meta content>);
 *  - prose longer than 12 words (the help paragraphs in
 *    pages/commander/docs/*); their headings, steps and labels are covered;
 *  - files with no UI text (NOT_UI_FILES in the scanner).
 * scripts/ci/title-case-allowlist.json names each remaining stored value that
 * reads like a label, with the reason. It is not a place for real labels.
 */
import { describe, it, expect } from 'vitest';
import { scan, toHouseTitleCase, loadAllowlist, DEFAULT_PATHS } from '../../scripts/title-case-scan.mjs';

describe('house Title Case', () => {
  it('capitalises every word, keeps acronyms, capitalises hyphen parts', () => {
    expect(toHouseTitleCase('Back to dashboard')).toBe('Back To Dashboard');
    expect(toHouseTitleCase('Connection error. Please try again.')).toBe('Connection Error. Please Try Again.');
    expect(toHouseTitleCase('Join a waitlist to receive updates')).toBe('Join A Waitlist To Receive Updates');
    expect(toHouseTitleCase('Scan the QR code to check-in')).toBe('Scan The QR Code To Check-In');
    expect(toHouseTitleCase('Print W-2G for this payout')).toBe('Print W-2G For This Payout');
    expect(toHouseTitleCase('Notes (optional)')).toBe('Notes (Optional)');
    expect(toHouseTitleCase("Player's seat isn't ready")).toBe("Player's Seat Isn't Ready");
  });

  it('leaves urls, paths, emails and brand casing alone', () => {
    expect(toHouseTitleCase('Navigate to /commander/login')).toBe('Navigate To /commander/login');
    expect(toHouseTitleCase('Email support@smarter.poker for help')).toBe('Email support@smarter.poker For Help');
    expect(toHouseTitleCase('Open on your iPad')).toBe('Open On Your iPad');
  });
});

describe('the scanner tells UI text from machine text', () => {
  const { findings } = scan(['tests/unit/fixtures/title-case']);
  const texts = findings.map((f) => f.text);

  it('flags UI positions', () => {
    for (const t of [
      'Failed to save', 'Search players by name', 'Close menu', 'No tables yet',
      'Delete this table?', 'Player name required', 'Seat player', 'Total buy-ins',
    ]) expect(texts, t).toContain(t);
  });

  it('ignores compared, stored, logged and metadata text', () => {
    for (const t of [
      'Cash game', 'Manual adjustment', 'Loaded the tables', 'Staff page for venues',
      'Seat available', 'Tournament day',
    ]) expect(texts, t).not.toContain(t);
  });
});

describe('every UI string in Commander is Title Case', () => {
  const { findings } = scan(DEFAULT_PATHS);

  it('no sentence-case UI text outside the allowlist', () => {
    const open = findings.filter((f) => !f.allowed)
      .map((f) => `${f.file}:${f.line} ${JSON.stringify(f.text)} -> ${JSON.stringify(f.fixed)}`);
    expect(open, `Convert these to Title Case (node scripts/title-case-scan.mjs --fix):\n${open.join('\n')}`).toEqual([]);
  });

  it('every allowlist entry still exists and carries a reason', () => {
    const allow = loadAllowlist();
    expect(allow.entries.length).toBeLessThanOrEqual(11);
    for (const e of allow.entries) {
      expect(e.reason, e.text).toMatch(/.{20,}/);
      expect(findings.some((f) => f.file === e.file && f.text === e.text), `stale allowlist entry ${e.file} ${e.text}`).toBe(true);
    }
  });
});
