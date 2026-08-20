const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  // Simulate mobile or narrow desktop viewport
  const page = await browser.newPage({ viewport: { width: 500, height: 800 } });
  
  const artifactDir = '/Users/smarter.poker/.gemini/antigravity/brain/d91b8ea2-567b-4029-afb9-0acac78ea587/';
  
  await page.goto('file:///Users/smarter.poker/Documents/smarter-poker-commander/calibrate.html');
  await page.waitForTimeout(1000);

  await page.screenshot({ path: path.join(artifactDir, 'calibrate.png') });

  await browser.close();
})();
