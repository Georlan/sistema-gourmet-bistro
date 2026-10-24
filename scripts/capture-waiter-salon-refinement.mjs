import { chromium } from 'playwright';
import path from 'path';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const OUT_DIR = process.env.KOMA_CAPTURE_OUT_DIR || path.resolve('artifacts/waiter-salon-refinement');
const APP_URL = `${process.env.KOMA_CAPTURE_ORIGIN || 'http://127.0.0.1:4291'}/?view=garcom`;
const APP_ORIGIN = new URL(APP_URL).origin;
import { NOW, mockTables, mockOrders } from './fixtures/waiterSalonPreview.mjs';

export async function setupPageRoutes(page, theme = 'dark', textSize = 'padrao', appOrigin = APP_ORIGIN) {
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[Browser ERROR] ${msg.text()}`);
  });
  page.on('pageerror', err => console.log(`[Page ERROR] ${err.message}`));

  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ theme, textSize }) => {
    sessionStorage.setItem('koma_waiter_token', 'waiter-wave1-test-token');
    sessionStorage.setItem('koma_active_operational_portal', 'garcom');
    sessionStorage.setItem('koma_waiter_id', 'waiter-phase7');
    sessionStorage.setItem('koma_waiter_name', 'Garçom KÔMA');
    sessionStorage.setItem('koma_user_role', 'garcom');
    sessionStorage.setItem('koma_restaurante_id', '99001');
    localStorage.setItem('@koma:theme', theme);
    localStorage.setItem('koma_font_size', textSize);
    sessionStorage.setItem('koma_operator_session_garcom', JSON.stringify({ expiresAt: new Date('2026-12-31').getTime(), token: 'waiter-wave1-test-token', user: { id: 'waiter-phase7', nome: 'Garçom KÔMA', role: 'garcom', restaurante_id: 99001 } }));
    localStorage.setItem('koma_drafts_v4:99001:waiter-phase7', JSON.stringify({ 1: [{ id: 'draft-local-1', observacao: '', clienteNome: 'Consumo Geral', produtoId: 'prod-1', nome: 'Hambúrguer Gourmet', preco: 45, quantidade: 1 }] }));
  }, { theme, textSize });

  await page.routeWebSocket(/\/ws\//, socket => {
    socket.onMessage(() => {});
  });

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === appOrigin && (url.pathname.startsWith('/src') || url.pathname.startsWith('/@') || url.pathname.startsWith('/node_modules') || url.pathname === '/' || url.pathname === '/favicon.ico' || url.pathname.includes('.'))) {
      await route.continue();
      return;
    }

    const pathname = url.pathname;
    const method = request.method();

    if (method === 'GET' && pathname === '/mesas/') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockTables) });
    } else if (method === 'GET' && pathname === '/comandas/detalhes/todos') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockOrders) });
    } else if (method === 'GET' && pathname.startsWith('/comandas/check-')) {
      const order = mockOrders.find(o => o.id === pathname.split('/')[2]);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order || mockOrders[0]) });
    } else if (method === 'GET' && pathname.startsWith('/atendimentos/mesas/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ familias: [] }) });
    } else if (method === 'GET' && (pathname === '/produtos/catalogo' || pathname === '/produtos/categorias')) {
      if (pathname === '/produtos/categorias') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'cat-1', nome: 'Geral', destino_impressao: 'COZINHA' }]) });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            categorias: [{ id: 'cat-1', nome: 'Geral', destino_impressao: 'COZINHA' }],
            produtos: [
              { id: 'prod-1', nome: 'Hambúrguer Gourmet', preco: 45, ativo: true, categoria_id: 'cat-1' },
              { id: 'prod-2', nome: 'Porção Batata Frita', preco: 30, ativo: true, categoria_id: 'cat-1' },
              { id: 'prod-3', nome: 'Sobremesa Pudim', preco: 25, ativo: true, categoria_id: 'cat-1' },
            ],
          }),
        });
      }
    } else if (method === 'GET' && pathname === '/caixa/configuracoes') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          taxa_servico_ativa: false,
          taxa_servico_padrao: 0,
          perm_garcom_status: true,
          perm_garcom_print: true,
          perm_garcom_fechar: false,
          perm_garcom_editar: true,
          perm_garcom_cancelar_item: true,
          perm_garcom_transferir_mesa: true,
          perm_garcom_transferir_item: true,
          perm_garcom_delivery: false,
        }),
      });
    } else if (method === 'GET' && pathname === '/caixa/pagamentos/pendentes') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    } else if (url.origin === appOrigin) {
      await route.continue();
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const evidence = [];
  try {
    for (const width of [320, 360, 390, 414, 430, 768, 1366]) {
      for (const theme of ['dark', 'light']) {
        for (const textSize of ['padrao', 'grande', 'gigante']) {
          const context = await browser.newContext({ viewport: { width, height: width === 320 ? 568 : width === 360 ? 780 : width === 414 ? 896 : width === 1366 ? 900 : 844 }, deviceScaleFactor: 1, colorScheme: theme });
          const page = await context.newPage();
          await setupPageRoutes(page, theme, textSize);
          await page.goto(APP_URL);
          await page.locator('#mesa-card-1').waitFor();
          await page.screenshot({ path: path.join(OUT_DIR, `waiter-${width}-${theme}-${textSize}.png`), fullPage: true });
          const layout = await page.evaluate(() => {
            const cards = [...document.querySelectorAll('[id^="mesa-card-"]')].filter(el => el.id.match(/^mesa-card-\d+$/));
            const overflow = cards.flatMap(card => [...card.querySelectorAll('strong, span, button')].filter(el => el.getClientRects().length > 0 && (el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > card.getBoundingClientRect().right + 1)).map(el => ({ table: card.id, text: el.textContent })));
            const track = document.querySelector('[aria-label="Filtrar mesas por status"]');
            return { overflow, filterOverflow: track.scrollWidth > track.clientWidth + 1, pageOverflow: document.documentElement.scrollWidth > innerWidth, cardHeights: cards.map(el => Math.round(el.getBoundingClientRect().height)) };
          });
          assert.deepEqual(layout.overflow, [], `Content overflow ${width}/${theme}/${textSize}`);
          assert.equal(layout.pageOverflow, false);
          assert.equal(layout.filterOverflow, false);
          assert.equal(await page.getByText(/\d+ lugares/).count(), 0);
          assert.equal(await page.locator('#mesa-card-1').getByText('1 rascunho').count(), 1);
          const search = page.getByRole('textbox', { name: 'Ir para mesa' });
          await search.fill('Varanda');
          assert.equal(await page.locator('[id^="mesa-card-"]').count(), 1);
          await page.getByRole('button', { name: 'Limpar busca de mesa' }).click();
          await page.locator('#mesa-card-launch-2').click();
          await page.locator('#search-products-input').waitFor({ timeout: 10000 });
          const catalogFont = await page.locator('#search-products-input').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
          await page.locator('#close-mesa-modal-btn').click();
          await page.locator('#open-sidebar-btn').click();
          await page.locator('.kw-preferences > summary').click();
          const drawerFont = await page.locator('.kw-operator strong').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
          const numberFont = await page.locator('.kw-table__number').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
          assert.equal(Math.round(drawerFont * 100), Math.round(16 * ({ padrao: 1, grande: 1.2, gigante: 1.4 }[textSize]) * 100));
          await page.screenshot({ path: path.join(OUT_DIR, `drawer-${width}-${theme}-${textSize}.png`), fullPage: true });
          await page.locator('#close-sidebar-btn').click();
          evidence.push({ width, theme, textSize, catalogFont, drawerFont, numberFont, ...layout });
          await context.close();
        }
      }
    }
    for (const count of [30, 50, 80]) {
      mockTables.splice(6, mockTables.length, ...Array.from({ length: count - 6 }, (_, i) => ({ id: i + 7, nome: i === 0 ? 'Varanda externa fundos' : `Mesa ${i + 7}`, capacidade: 4, status: 'livre' })));
      if (count === 80) mockOrders[0].itens[0].preco_unit = 123456.78;
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await setupPageRoutes(page);
      await page.goto(APP_URL);
      await page.locator(`#mesa-card-${count}`).waitFor();
      assert.equal(await page.locator('#mesa-card-2 strong').last().evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      await page.screenshot({ path: path.join(OUT_DIR, `waiter-${count}-tables-overview.png`) });
      await page.getByRole('textbox', { name: 'Ir para mesa' }).fill(`Mesa ${count}`);
      assert.equal(await page.locator(`#mesa-card-${count}`).count(), 1);
      await page.screenshot({ path: path.join(OUT_DIR, `waiter-${count}-tables-search.png`) });
      evidence.push({ tables: count, searchTargetFound: true });
      await context.close();
    }
    writeFileSync(path.join(OUT_DIR, 'visual-verification.json'), JSON.stringify(evidence, null, 2));
    console.log(`${evidence.length} capture scenarios passed`);
  } finally { await browser.close(); }
}
if (!process.env.KOMA_CAPTURE_LIBRARY) main().catch(error => { console.error(error); process.exitCode = 1; });
