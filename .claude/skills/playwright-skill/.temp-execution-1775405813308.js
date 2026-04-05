
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });
  
  // Go to workspace first
  await page.goto('http://localhost:5173/#/workspace', { timeout: 15000 });
  await page.waitForTimeout(2000);
  
  // Click on the first document to enter agent view
  const docs = await page.locator('.doc-item, .workspace-item, [class*=doc]').first();
  if (await docs.count() > 0) {
    console.log('Found doc item, clicking...');
    await docs.click();
    await page.waitForTimeout(3000);
  }
  
  console.log('Current URL after click:', page.url());
  
  // Now look for the conversation sidebar toggle
  const toggle = await page.locator('.conversation-sidebar-rail-toggle').first();
  const exists = await toggle.count();
  console.log('Toggle exists:', exists > 0);
  
  if (exists > 0) {
    const box = await toggle.boundingBox();
    console.log('Toggle bounding box:', JSON.stringify(box));
    
    // Get some properties
    const props = await toggle.evaluate(el => {
      const s = window.getComputedStyle(el);
      return {
        zIndex: s.zIndex,
        pointerEvents: s.pointerEvents,
        position: s.position,
        left: s.left,
        right: s.right,
        top: s.top,
        display: s.display,
        visibility: s.visibility,
        opacity: s.opacity
      };
    });
    console.log('Toggle computed styles:', JSON.stringify(props));
    
    // Try to click
    try {
      await toggle.click({ timeout: 3000 });
      console.log('✅ Toggle clicked successfully');
    } catch (e) {
      console.log('❌ Toggle click failed:', e.message);
      // Check if there's an overlay covering it
      await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
      const elementAtPoint = await page.evaluate(({x, y}) => {
        const el = document.elementFromPoint(x, y);
        return el ? { tag: el.tagName, class: el.className, id: el.id } : null;
      }, { x: box.x + box.width/2, y: box.y + box.height/2 });
      console.log('Element at toggle center:', JSON.stringify(elementAtPoint));
    }
  } else {
    console.log('Looking for any sidebar toggle...');
    const anyToggle = await page.locator('[class*=sidebar-toggle], [class*=rail-toggle]').all();
    console.log('Found toggles:', anyToggle.length);
  }
  
  await page.screenshot({ path: '/tmp/agent-view.png' });
  console.log('Screenshot saved');
  
  await browser.close();
})();
