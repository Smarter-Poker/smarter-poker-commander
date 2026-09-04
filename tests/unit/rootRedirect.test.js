/**
 * commander.smarter.poker/ must not be a scaffold stub (2026-09-04).
 * The root redirects to the real landing page; the hub's /commander rewrite
 * targets /commander directly (hub __tests__/poker-near-me-phase-16), so the
 * two cannot chase each other.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

describe('root of the commander origin', () => {
  it('has no scaffold page and redirects / to /commander (temporary, same origin)', async () => {
    expect(existsSync(join(ROOT, 'pages/index.tsx'))).toBe(false);
    expect(existsSync(join(ROOT, 'pages/index.js'))).toBe(false);
    const cfg = (await import(join(ROOT, 'next.config.js'))).default;
    const redirects = await cfg.redirects();
    const root = redirects.find((r) => r.source === '/');
    expect(root).toBeTruthy();
    expect(root.destination).toBe('/commander');
    expect(root.permanent).toBe(false);
    // Never redirect /commander itself: that is the hub rewrite's target.
    expect(redirects.some((r) => r.source === '/commander' || r.source === '/commander/:path*')).toBe(false);
    // The stub's text must not survive anywhere a user could be served it.
    for (const f of ['pages/commander/index.js', 'pages/commander/login.js']) {
      expect(readFileSync(join(ROOT, f), 'utf8')).not.toMatch(/scaffolded, migration in progress/);
    }
  });
});
