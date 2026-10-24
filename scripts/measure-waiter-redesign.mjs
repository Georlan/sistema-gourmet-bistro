/** Compare two already-built local frontends with identical isolated fixtures. */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
process.env.KOMA_CAPTURE_LIBRARY = 'true';
const { setupPageRoutes } = await import('./capture-waiter-salon-refinement.mjs');
const browser = await chromium.launch();
const runs = [];
try {
  for (let repeat = 0; repeat < 5; repeat++) {
    for (const [version, origin] of [['before', 'http://127.0.0.1:4296'], ['after', 'http://127.0.0.1:4297']]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const requests = [];
      page.on('request', request => requests.push(request.url()));
      await setupPageRoutes(page, 'dark', 'padrao', origin);
      const start = performance.now();
      await page.goto(`${origin}/?view=garcom`);
      await page.locator('#mesa-card-1').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const readyMs = performance.now() - start;
      if (repeat === 0 && version === 'before' && process.env.KOMA_BEFORE_DRAWER_OUT) {
        await page.locator('#open-sidebar-btn').click();
        await page.screenshot({ path: process.env.KOMA_BEFORE_DRAWER_OUT });
        await page.locator('#close-sidebar-btn').click();
      }
      runs.push({ version, readyMs: Math.round(readyMs), requests: requests.length,
        apiRequests: requests.filter(url => /^(\/mesas\/|\/comandas\/|\/caixa\/|\/produtos\/|\/atendimentos\/)/.test(new URL(url).pathname)).length,
        externalFontRequests: requests.filter(url => new URL(url).hostname === 'fonts.googleapis.com').length,
        resourceBytes: await page.evaluate(() => performance.getEntriesByType('resource').reduce((sum, entry) => sum + entry.encodedBodySize, 0)) });
      await context.close();
    }
  }
} finally { await browser.close(); }
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = Object.fromEntries(['before', 'after'].map(version => {
  const group = runs.filter(run => run.version === version);
  return [version, Object.fromEntries(['readyMs', 'requests', 'apiRequests', 'externalFontRequests', 'resourceBytes'].map(metric => [metric, median(group.map(run => run[metric]))]))];
}));
for (const values of Object.values(summary)) if (values.resourceBytes === 0) values.resourceBytes = null;
const result = { sizeNote: 'Browser did not expose encodedBodySize under interception; null is unavailable, not zero bytes.', method: '5 cold browser contexts per local production build, alternating versions, identical fixture and viewport 390x844. Local measurements; not field Web Vitals.', summary, runs };
writeFileSync(process.env.KOMA_PERF_OUT || 'artifacts/waiter-performance.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(summary));
