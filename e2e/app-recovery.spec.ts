import { expect, test } from '@playwright/test';

test('preload recovery reloads once and never resolves a failed import as undefined', async ({ page }) => {
  await page.goto('/?view=caixa');
  await expect(page.getByLabel('E-MAIL')).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('recovery-draft', 'pedido-pendente');
    sessionStorage.removeItem('koma_chunk_reload_attempt');
    window.addEventListener('vite:preloadError', (event) => {
      sessionStorage.setItem('preload-default-prevented', String(event.defaultPrevented));
    });
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
  });
  await expect(page).toHaveURL(/__koma_refresh=/);
  await expect(page.getByLabel('E-MAIL')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('preload-default-prevented'))).toBe('false');
  expect(await page.evaluate(() => localStorage.getItem('recovery-draft'))).toBe('pedido-pendente');
  const url = page.url();
  const cancelled = await page.evaluate(() => {
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(cancelled).toBe(false);
  expect(page.url()).toBe(url);
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
