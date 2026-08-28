import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

describe('ClubButtons Commander migration', () => {
  it('loads the shared system and all production shell families', () => {
    expect(read('pages/_app.js')).toContain('vendor/commander-shared/src/components/club-buttons/club-buttons.css');
    for (const asset of ['action-primary-shell.webp', 'club-utility-shell.webp', 'club-nav-shell.webp', 'wallet-row-shell.webp']) {
      expect(existsSync(resolve(root, 'public/assets/club-buttons', asset))).toBe(true);
    }
  });

  it('wires real Commander navigation into shared semantic controls', () => {
    const layout = read('vendor/commander-shared/src/components/commander/shared/CommanderLayout.jsx');
    expect(layout).toContain('ClubButtonsSurface');
    expect(layout).toContain('ClubIconButton');
    expect(layout).toContain('ClubNavItem');
    expect(layout).toContain('ClubButton');
    expect(layout).toContain('handleNavClick(item)');
    expect(layout).toContain('canRoleAccessRoute(staffRole, item.href)');
    expect(layout).toContain('handlePinSubmit');
    expect(layout).toContain('handleLogout');
    expect(layout).toContain("href: '/commander/print-station'");
    expect(layout).toContain("window.addEventListener('commander:unauthorized'");
  });

  it('keeps PIN, offline, and account-switching state intact', () => {
    const layout = read('vendor/commander-shared/src/components/commander/shared/CommanderLayout.jsx');
    expect(layout).toContain("window.addEventListener('offline', goOffline)");
    expect(layout).toContain('pin_unlock_${path}');
    expect(layout).toContain('switchAccount(acc)');
    expect(layout).toContain('supabase.auth.signOut()');
    expect(layout).toContain('Your Session Is Not Valid For This Data');
  });
});
