import {expect, test, type Page} from '@playwright/test';

const status = {
  paused: false, pause_reason: null, pause_until: null,
  max_active_orders: null, auto_pause: false,
  counts: {analise: 0, pendente: 0, producao: 0, pronto: 0, active: 0},
  capacity_ratio: null, level: 'normal',
};

async function mount(page: Page) {
  await page.clock.install({time: new Date('2026-10-03T04:00:00Z')});
  await page.goto('/e2e/fixtures/online-control.html');
}

async function minute(page: Page) {
  for (let tick = 0; tick < 12; tick += 1) {
    await page.clock.runFor(5_000);
    await page.waitForTimeout(40);
  }
}

test('one visible owner uses events with realtime and resumes polling when disconnected', async ({page}) => {
  let requests = 0;
  await page.route('**/api/online-orders/control', route => {
    requests += 1;
    return route.fulfill({json: status});
  });
  await mount(page);
  await expect.poll(() => requests).toBe(1);
  await minute(page);
  expect(requests).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('koma_online_order_control_updated')));
  await page.clock.runFor(100);
  await expect.poll(() => requests).toBe(2);
  await page.getByRole('button', {name: 'Toggle realtime'}).click();
  await minute(page);
  await expect.poll(() => requests).toBe(4);
  await page.getByRole('button', {name: 'Toggle realtime'}).click();
  await minute(page);
  expect(requests).toBe(4);
});

test('timed pause is reconciled at its deadline even with healthy realtime', async ({page}) => {
  let requests = 0;
  await page.route('**/api/online-orders/control', route => {
    requests += 1;
    return route.fulfill({json: requests === 1
      ? {...status, paused: true, level: 'paused', pause_until: '2026-10-03T04:00:45Z'}
      : status});
  });
  await mount(page);
  await expect.poll(() => requests).toBe(1);
  await minute(page);
  await expect.poll(() => requests).toBe(2);
  await minute(page);
  expect(requests).toBe(2);
});

test('bootstrap failure keeps fallback recovery available with a connected socket', async ({page}) => {
  let requests = 0;
  await page.route('**/api/online-orders/control', route => {
    requests += 1;
    return route.fulfill(requests === 1 ? {status: 503, json: {}} : {json: status});
  });
  await mount(page);
  await expect.poll(() => requests).toBe(1);
  await minute(page);
  await expect.poll(() => requests).toBe(2);
  await minute(page);
  expect(requests).toBe(2);
});
