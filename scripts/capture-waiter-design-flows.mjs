import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
process.env.KOMA_CAPTURE_LIBRARY = 'true';
const { setupPageRoutes } = await import('./capture-waiter-salon-refinement.mjs');
const origin = process.env.KOMA_FLOW_ORIGIN || 'http://127.0.0.1:4291';
const out = process.env.KOMA_FLOW_OUT || path.resolve('artifacts/waiter-flows');
const baseline = process.env.KOMA_FLOW_BASELINE === 'true';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of baseline ? [390] : [320, 360, 390, 430, 768, 1366]) {
    for (const theme of ['dark', 'light']) {
      for (const textSize of baseline ? ['padrao'] : ['padrao', 'grande', 'gigante']) {
        const context = await browser.newContext({ viewport: { width, height: width >= 768 ? 1000 : 844 }, colorScheme: theme });
        const page = await context.newPage();
        const calls = [];
        page.on('request', request => { if (/^\/(mesas|comandas|produtos|caixa|atendimentos)\//.test(new URL(request.url()).pathname)) calls.push(request.url()); });
        await setupPageRoutes(page, theme, textSize, origin);
        await page.goto(`${origin}/?view=garcom`);
        await page.locator('#mesa-card-1').waitFor();
        const capture = async (screen, modal = false) => {
          if (!baseline) {
            const overflow = await page.evaluate(modal => {
              const root = modal ? document.querySelector('#modal-outer-overlay') : document.documentElement;
              return { page: document.documentElement.scrollWidth > innerWidth + 1, root: root.scrollWidth > root.clientWidth + 1 };
            }, modal);
            assert.equal(overflow.page, false, `${screen}/${width}/${theme}/${textSize}: page overflow`);
            assert.equal(overflow.root, false, `${screen}/${width}/${theme}/${textSize}: container overflow`);
            if (modal) {
              const clippedTabs = await page.locator('.kw-flow-tabs > button').evaluateAll(buttons => buttons.some(button => button.scrollWidth > button.clientWidth + 1));
              assert.equal(clippedTabs, false, `${screen}/${width}/${theme}/${textSize}: tab content clipped`);
            }
          }
          await page.screenshot({ animations: 'disabled', path: path.join(out, `${screen}-${width}-${theme}-${textSize}.png`) });
        };
        await capture('salao');
        await page.locator('#open-sidebar-btn').click();await capture('central');await page.locator('#close-sidebar-btn').click();
        const startCalls = calls.length;
        await page.getByRole('textbox', { name: 'Ir para mesa' }).fill('Varanda');
        await page.locator('#mesa-card-5').waitFor();
        await page.getByRole('button', { name: 'Limpar busca de mesa' }).click();
        assert.equal(calls.length, startCalls, 'Table search must use the loaded snapshot');
        await page.locator('#mesa-card-2').click();await page.locator('#tab-consumo-btn').waitFor();await capture('consumo', true);
        await page.locator('#tab-lancamento-btn').click();await page.locator('#search-products-input').waitFor();await capture('catalogo', true);
        await page.locator('#add-product-btn-prod-1').click();
        await page.locator('#open-draft-cart-btn').click();
        await page.getByRole('heading', { name: /Revisar pedido/ }).waitFor();
        await capture('revisar', true);
        assert.equal(await page.getByRole('button', { name: /Aumentar Hambúrguer Gourmet/ }).count(), 1);
        await page.getByRole('button', { name: /Aumentar Hambúrguer Gourmet/ }).click();
        await page.getByRole('button', { name: /Diminuir Hambúrguer Gourmet/ }).click();
        await page.locator('#close-mesa-modal-btn').click();
        await page.locator('#mesa-card-launch-2').click();
        await page.getByRole('heading', { name: /Revisar pedido/ }).waitFor();
        results.push({ width, theme, textSize, scenarios: 5, snapshotSearch: true, quantityControls: true, draftRetained: true });
        await context.close();
      }
    }
  }
  writeFileSync(path.join(out, 'flow-verification.json'), JSON.stringify(results, null, 2));
  console.log(`${results.length} contexts / ${results.length * 5} captures passed`);
} finally { await browser.close(); }
