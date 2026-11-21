import { expect, test } from '@playwright/test';
import { openOperationalScenario } from './fixtures/operational';

for (const theme of ['dark', 'light']) {
  test(`orders reserve mobile space for cards with pending Pix in ${theme}`, async ({ page }) => {
    test.skip((test.info().project.use.viewport?.width ?? 1366) >= 768);
    await page.addInitScript(theme => localStorage.setItem('@koma:theme', theme), theme);
    await openOperationalScenario(page);
    const toolbar = page.locator('.orders-toolbar');
    const firstCard = page.locator('.orders-card:visible').first();
    await expect(firstCard).toBeVisible();
    expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(54);
    expect((await firstCard.boundingBox())!.y).toBeLessThan(200);
    await page.route('**/payments/direct-pix/pending', route => route.fulfill({ json: [
      { id: 'pix-header', order_number: '24', customer: 'Cliente teste', amount: '112.00' },
    ] }));
    await page.reload();
    const pix = toolbar.getByRole('button', { name: /Conferir Pix/ });
    await expect(pix).toBeVisible();
    await expect(page.locator('.cashier-subnav--sales')).toBeVisible();
    expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(54);
    const actions = toolbar.locator('.orders-toolbar__actions');
    expect((await actions.boundingBox())!.height).toBeLessThanOrEqual(48);
    await expect(firstCard).toBeVisible();
    expect((await firstCard.boundingBox())!.y).toBeLessThan(200);
    for (const control of [pix, toolbar.getByRole('button', { name: /Novos pedidos/ }), toolbar.locator('.orders-auto-accept')]) {
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(36);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    await page.screenshot({ path: test.info().outputPath(`header-${theme}.png`) });
    await toolbar.getByRole('button', { name: /Novos pedidos/ }).click();
    await expect(page.getByRole('dialog', { name: 'Novos pedidos', exact: true })).toBeVisible();
    await page.getByRole('dialog', { name: 'Novos pedidos', exact: true }).getByRole('button', { name: /Fechar/ }).click();
    const search = toolbar.getByRole('searchbox', { name: 'Buscar pedidos' });
    await search.fill('Prato');
    await expect(search).toHaveValue('Prato');
    await expect(firstCard).toBeVisible();
    await toolbar.getByRole('button', { name: 'Limpar busca' }).click();
    await pix.click();
    await expect(page.getByRole('dialog', { name: /Pix manual/ })).toBeVisible();
  });
}
