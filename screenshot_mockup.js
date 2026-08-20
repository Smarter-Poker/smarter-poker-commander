const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  
  const artifactDir = '/Users/smarter.poker/.gemini/antigravity/brain/d91b8ea2-567b-4029-afb9-0acac78ea587/';
  
  // Go to local file
  await page.goto('file:///Users/smarter.poker/Documents/smarter-poker-commander/mockup.html');
  await page.waitForTimeout(1000);

  await page.screenshot({ path: path.join(artifactDir, 'modal_mockup_v5.png') });

  await browser.close();
})();
