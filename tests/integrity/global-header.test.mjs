import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const appRoot = readFileSync(join(root, 'pages/_app.js'), 'utf8');
const fallbackHeader = readFileSync(
  join(root, 'src/components/commander/shared/StandaloneGlobalHeader.jsx'),
  'utf8'
);
const sharedLayout = readFileSync(
  join(root, 'vendor/commander-shared/src/components/commander/shared/CommanderLayout.jsx'),
  'utf8'
);

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory()
    ? walk(path)
    : /\.(js|jsx|tsx)$/.test(name)
      ? [path]
      : [];
});

const pageRoute = (file) => {
  const route = `/${relative(join(root, 'pages'), file)}`
    .split(sep).join('/')
    .replace(/\.(js|jsx|tsx)$/, '')
    .replace(/\/index$/, '');
  return route || '/';
};

test('all 113 Commander routes own the shared layout or the app-root global header', () => {
  const pages = walk(join(root, 'pages/commander'));
  const fallbackRoutes = new Set(
    [...appRoot.matchAll(/^  '([^']+)',$/gm)].map((match) => match[1])
  );
  const uncovered = pages
    .filter((file) => !/CommanderLayout|CommanderPageShell/.test(readFileSync(file, 'utf8')))
    .map(pageRoute)
    .filter((route) => !fallbackRoutes.has(route));

  assert.equal(pages.length, 113);
  assert.deepEqual(uncovered, []);
});

test('both Commander owners use the approved row, a live avatar, and eight wired controls', () => {
  for (const source of [fallbackHeader, sharedLayout]) {
    assert.match(source, /global-header-desktop\.png/);
    assert.match(source, /aspect-ratio: 1648 \/ 168/);
    assert.match(source, /profileAvatar/);
    assert.match(source, /approved-header__avatar-slot/);
    assert.match(source, /contain: layout paint/);
    assert.match(source, /width: 58%/);
    assert.match(source, /aspect-ratio: \.78/);
    assert.match(source, /profile-updated/);
    assert.match(source, /smarter_poker_avatar_sync/);
    for (const label of [
      'Open Menu',
      'Go back',
      'Go to the Hub',
      'My Profile',
      'Diamond Wallet',
      'VIP',
      'Messages',
      'Notifications',
    ]) {
      assert.match(source, new RegExp(`aria-label="${label}"`));
    }
  }
});
