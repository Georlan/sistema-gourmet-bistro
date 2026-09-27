import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

const status = (paused: boolean) => ({
  paused,
  pause_reason: paused ? 'Cozinha lotada' : null,
  pause_until: null,
  max_active_orders: null,
  auto_pause: false,
  counts: { analise: 0, pendente: 0, producao: 0, pronto: 0, active: 0 },
  capacity_ratio: null,
  level: paused ? 'paused' : 'normal',
});

async function setup(page: Page, onSocket?: (socket: WebSocketRoute) => void) {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, socket => {
    socket.onMessage(() => {});
    onSocket?.(socket);
  });
}

test('avisos próximos produzem uma consulta e aba oculta não consulta controle online', async ({ page }) => {
  await setup(page);
  let reads = 0;
  await page.route('**/api/online-orders/control', route => {
    reads++;
    return route.fulfill({ json: status(false) });
  });
  await page.goto('/?view=caixa');
  await expect(page.locator('#online-orders-emergency-trigger:visible')).toContainText('Pausar cardápio online');
  const beforeBurst = reads;
  await page.evaluate(() => {
    for (let index = 0; index < 4; index++) window.dispatchEvent(new Event('koma_orders_updated'));
  });
  await expect.poll(() => reads).toBe(beforeBurst + 1);
  await page.waitForTimeout(200);
  expect(reads).toBe(beforeBurst + 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(200);
  expect(reads).toBe(beforeBurst + 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('koma_online_order_control_updated'));
  });
  await expect.poll(() => reads).toBe(beforeBurst + 2);
});

test('outro terminal pausa o cardápio e o Caixa reconcilia após WebSocket', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    const cashier = await contextA.newPage();
    const peer = await contextB.newPage();
    let cashierSocket: WebSocketRoute | undefined;
    let paused = false;
    let cashierReads = 0;
    await setup(cashier, socket => { cashierSocket = socket; });
    await setup(peer);
    for (const [page, isCashier] of [[cashier, true], [peer, false]] as const) {
      await page.route('**/api/online-orders/control', route => {
        if (isCashier) cashierReads++;
        return route.fulfill({ json: status(paused) });
      });
      await page.route('**/api/online-orders/pause', route => {
        paused = true;
        return route.fulfill({ json: status(paused) });
      });
      await page.goto('/?view=caixa');
      await expect(page.locator('#online-orders-emergency-trigger:visible')).toContainText('Pausar cardápio online');
    }
    await expect.poll(() => Boolean(cashierSocket)).toBe(true);
    const before = cashierReads;
    await peer.locator('#online-orders-emergency-trigger:visible').click();
    await peer.getByRole('button', { name: 'Pausar cardápio online', exact: true }).last().click();
    await expect(peer.locator('#online-orders-emergency-trigger:visible')).toContainText('Cardápio online pausado');
    cashierSocket!.send(JSON.stringify({ event: 'config_updated', source: 'online_order_control' }));
    await expect(cashier.locator('#online-orders-emergency-trigger:visible')).toContainText('Cardápio online pausado');
    expect(cashierReads).toBe(before + 1);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
