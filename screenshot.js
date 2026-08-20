const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  
  const artifactDir = '/Users/smarter.poker/.gemini/antigravity/brain/d91b8ea2-567b-4029-afb9-0acac78ea587/';
  
  // Set local storage
  await page.goto('http://localhost:3001/commander/login');
  await page.evaluate(() => {
    localStorage.setItem('commander_staff', JSON.stringify({ user_id: '123', email: 'test@example.com', role: 'owner', session_ts: Date.now() }));
    localStorage.setItem('commander_venue', 'venue-1');
    localStorage.setItem('commander_subscription', JSON.stringify({ tier: 'home_game' }));
    sessionStorage.setItem('commander_accounts_v2_cache', JSON.stringify([
      { venue_id: 'venue-1', venue_name: 'Club JAQK', role: 'owner' }
    ]));
  });

  // Go to dashboard
  await page.goto('http://localhost:3001/commander/dashboard');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(artifactDir, 'dashboard_debug.png') });

  // Take Home Game screenshot
  await page.evaluate(() => { window.showUpgrade({ label: 'Member Import', upgradeTierName: 'Home Game', upgradePrice: 99 }); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(artifactDir, 'popup_home_game.png') });

  // Take Charity screenshot
  await page.evaluate(() => { window.showUpgrade({ label: 'Member Import', upgradeTierName: 'Charity', upgradePrice: 199 }); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(artifactDir, 'popup_charity.png') });

  // Take Club screenshot
  await page.evaluate(() => { window.showUpgrade({ label: 'Member Import', upgradeTierName: 'Club', upgradePrice: 399 }); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(artifactDir, 'popup_club.png') });

  await browser.close();
})();
