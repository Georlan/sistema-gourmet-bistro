import { expect, test } from '@playwright/test';

test('real histories and monitor: idle savings, event bursts, offline and cleanup', async ({ page }) => {
  const calls = { pickup: 0, courier: 0, monitor: 0 };
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/mock/**', async route => {
    const url = route.request().url();
    if (url.includes('retiradas')) calls.pickup++;
    else if (url.includes('entregas')) calls.courier++;
    else if (url.includes('/monitor')) calls.monitor++;
    await route.fulfill({json: url.includes('/monitor') ? {agents: [], jobs: [], summary: {}} : []});
  });
  await page.route(/http:\/\/127\.0\.0\.1:176\d+\/.*/, route => route.abort());
  await page.clock.install();
  await page.goto('/e2e/fixtures/idle-reconciliation.html');
  await expect.poll(() => calls).toEqual({pickup:1,courier:1,monitor:1});
  await page.clock.runFor(60_000);
  expect(calls.pickup).toBe(1); expect(calls.courier).toBe(1);
  expect(calls.monitor).toBeGreaterThanOrEqual(2);
  const monitorBaseline = calls.monitor;
  await page.evaluate(() => { for(let i=0;i<1000;i++) {
    window.dispatchEvent(new Event('koma_orders_updated'));
    window.dispatchEvent(new Event('koma_print_monitor_refresh'));
  }});
  await page.clock.runFor(250);
  await expect.poll(() => calls).toEqual({pickup:2,courier:2,monitor:monitorBaseline+1});
  await page.getByRole('button', {name:'Toggle realtime'}).click();
  await page.clock.runFor(250);
  await expect.poll(() => calls).toEqual({pickup:3,courier:3,monitor:monitorBaseline+2});
  await page.clock.runFor(30_000);
  await expect.poll(() => calls).toEqual({pickup:4,courier:4,monitor:monitorBaseline+3});
  await page.getByRole('button', {name:'Toggle realtime'}).click();
  await page.clock.runFor(250);
  await expect.poll(() => calls).toEqual({pickup:5,courier:5,monitor:monitorBaseline+4});
  await page.clock.runFor(30_000);
  await expect.poll(() => calls).toEqual({pickup:5,courier:5,monitor:monitorBaseline+5});
  await page.getByRole('button', {name:'Unmount'}).click();
  await page.clock.runFor(600_000); expect(calls).toEqual({pickup:5,courier:5,monitor:monitorBaseline+5});
  expect(errors).toEqual([]);
});
