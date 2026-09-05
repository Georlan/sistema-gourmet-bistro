import { expect, test } from '@playwright/test';

test('entrada recupera arquivo indisponível sem apagar dados locais ou recarregar em ciclo', async ({ page }) => {
  let documentLoads = 0;
  page.on('request', request => { if (request.isNavigationRequest()) documentLoads += 1; });
  await page.addInitScript(() => {
    if (!localStorage.getItem('recovery-draft')) localStorage.setItem('recovery-draft', 'pedido-pendente');
  });
  const chunk = /\/(?:src\/App\.tsx|assets\/App-[^/]+\.js)(?:\?.*)?$/;
  await page.route(chunk, route => route.abort('failed'));
  await page.goto('/?view=caixa');
  await expect(page.getByRole('heading', { name: 'Vamos reabrir o Kôma' })).toBeVisible();
  expect(documentLoads).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('recovery-draft'))).toBe('pedido-pendente');
  await page.unroute(chunk);
  await page.getByRole('button', { name: 'Reabrir Kôma', exact: true }).click();
  await expect(page.getByLabel('E-MAIL')).toBeVisible();
  expect(documentLoads).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('recovery-draft'))).toBe('pedido-pendente');
});
