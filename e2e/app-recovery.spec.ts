import { expect, test } from '@playwright/test';

test('preload recovery reloads once and never resolves a failed import as undefined', async ({ page }) => {
  await page.goto('/?view=caixa');
  await expect(page.getByLabel('E-MAIL')).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('recovery-draft', 'pedido-pendente');
    sessionStorage.removeItem('koma_chunk_recovery_build_v2');
    window.addEventListener('vite:preloadError', (event) => {
      sessionStorage.setItem('preload-default-prevented', String(event.defaultPrevented));
    });
    const failedImport = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown };
    failedImport.payload = new TypeError('Failed to fetch dynamically imported module: /assets/CaixaPanel-old.js');
    window.dispatchEvent(failedImport);
  });
  await expect(page).toHaveURL(/__koma_refresh=/);
  await expect(page.getByLabel('E-MAIL')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('preload-default-prevented'))).toBe('false');
  expect(await page.evaluate(() => localStorage.getItem('recovery-draft'))).toBe('pedido-pendente');
  const url = page.url();
  const cancelled = await page.evaluate(() => {
    const event = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown };
    event.payload = new TypeError('Failed to fetch dynamically imported module: /assets/CaixaPanel-old.js');
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(cancelled).toBe(false);
  expect(page.url()).toBe(url);
});

test('interacting with the operational login prevents a destructive reload on stale chunks', async ({ page }) => {
  await page.goto('/?view=caixa');
  const email = page.getByLabel('E-MAIL');
  await expect(email).toBeVisible();
  await email.fill('teste@example.com');
  const before = page.url();
  await page.evaluate(() => {
    const event = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown };
    event.payload = new TypeError('Failed to fetch dynamically imported module: /assets/CaixaPanel-old.js');
    window.dispatchEvent(event);
  });
  await page.waitForTimeout(250);
  expect(page.url()).toBe(before);
  await expect(email).toHaveValue('teste@example.com');
});

test('entrada recupera arquivo indisponível sem apagar dados locais ou recarregar em ciclo', async ({ page }) => {
  let documentLoads = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.isNavigationRequest()) documentLoads += 1; });
  await page.addInitScript(() => {
    if (!localStorage.getItem('recovery-draft')) localStorage.setItem('recovery-draft', 'pedido-pendente');
  });
  const chunk = /\/(?:src\/App\.tsx|assets\/App-[^/]+\.js)(?:\?.*)?$/;
  await page.route(chunk, route => route.abort('failed'));
  await page.goto('/?view=caixa');
  await expect(page.getByRole('heading', { name: 'Vamos reabrir o Kôma' })).toBeVisible();
  expect(documentLoads).toBe(2); // one automatic recovery, then the boundary
  expect(errors.some(error => error.includes("reading 'default'"))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('recovery-draft'))).toBe('pedido-pendente');
  await page.unroute(chunk);
  await page.getByRole('button', { name: 'Reabrir Kôma', exact: true }).click();
  await expect(page.getByLabel('E-MAIL')).toBeVisible();
  expect(documentLoads).toBe(3);
  expect(await page.evaluate(() => localStorage.getItem('recovery-draft'))).toBe('pedido-pendente');
});
