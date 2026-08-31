import { expect, test } from '@playwright/test';
import { openOperationalScenario } from './fixtures/operational';

test('30 mesas mantêm cards compactos e livres não esticam; detalhes cabem na tela', async ({ page }, testInfo) => {
  await openOperationalScenario(page, { subtab: 'mesas', canonicalIdentity: true, secondCheck: true, tableCount: 30 });
  const cards = page.locator('article[data-density="compact"]');
  await expect(cards).toHaveCount(30);
  const occupied = page.locator('article[data-table-status="occupied"]');
  const free = page.locator('article[data-table-status="free"]').first();
  const occupiedBox = (await occupied.boundingBox())!;
  const freeBox = (await free.boundingBox())!;
  expect(occupiedBox.height).toBeLessThanOrEqual(220);
  expect(freeBox.height).toBeLessThanOrEqual(190);
  expect(freeBox.height).toBeLessThan(occupiedBox.height);
  expect((await occupied.getByRole('button').boundingBox())!.height).toBeGreaterThanOrEqual(40);
  await expect(occupied).not.toContainText('Atendentes registrados');
  await expect(occupied).not.toContainText('0 servidos');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(element => element.clientWidth));
  const visibleTables = await cards.evaluateAll(elements => elements.filter(element => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  }).length);
  if (page.viewportSize()!.width >= 1024) expect(visibleTables).toBeGreaterThanOrEqual(6);
  await testInfo.attach('salon-layout.json', { body: JSON.stringify({ viewport: page.viewportSize(), occupiedBox, freeBox, visibleTables }), contentType: 'application/json' });
  if (process.env.KOMA_CAPTURE_UI) {
    console.info('salon-layout', JSON.stringify({ viewport: page.viewportSize(), occupiedHeight: occupiedBox.height, freeHeight: freeBox.height, visibleTables }));
    await page.screenshot({ path: testInfo.outputPath('compact-salon.png') });
  }
  await occupied.getByRole('button', { name: 'Ver comanda', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Mesa 7', exact: true });
  const box = (await details.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await expect(details.getByRole('button', { name: 'Adicionar consumo', exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Receber', exact: true })).toBeVisible();
  await details.getByRole('combobox', { name: 'Mesa de destino' }).scrollIntoViewIfNeeded();
  await expect(details.getByRole('combobox', { name: 'Mesa de destino' })).toBeInViewport();
  await details.getByRole('button', { name: 'Fechar detalhes' }).scrollIntoViewIfNeeded();
  if (process.env.KOMA_CAPTURE_UI) await page.screenshot({ path: testInfo.outputPath('compact-salon-details.png') });
  await details.getByRole('button', { name: 'Fechar detalhes' }).click();
  await expect(details).toBeHidden();
});

test('cédulas só aparecem em Dinheiro e trocar método não altera valor nem registra pagamento', async ({ page }) => {
  const state = await openOperationalScenario(page, { subtab: 'mesas' });
  await page.locator('article[data-table-status="occupied"]').getByRole('button', { name: 'Ver comanda', exact: true }).click();
  await page.getByRole('dialog', { name: 'Mesa 7', exact: true }).getByRole('button', { name: 'Receber', exact: true }).click();
  const form = page.locator('form').filter({ hasText: 'Receber Pagamento' });
  const shortcuts = form.getByRole('group', { name: 'Atalhos de cédulas' });
  const value = form.getByRole('textbox', { name: 'Digite qualquer valor para abater do saldo.' });
  await expect(value).toHaveValue('160,00');
  for (const method of ['Pix', 'C. Débito', 'C. Crédito']) {
    await form.getByRole('button', { name: method, exact: true }).click();
    await expect(shortcuts).toHaveCount(0);
    await expect(value).toHaveValue('160,00');
  }
  await form.getByRole('button', { name: 'Dinheiro', exact: true }).click();
  await expect(shortcuts).toBeVisible();
  await shortcuts.getByRole('button', { name: 'R$ 50', exact: true }).click();
  await expect(value).toHaveValue('50,00');
  await form.getByRole('button', { name: 'Pix', exact: true }).click();
  await expect(shortcuts).toHaveCount(0);
  await expect(value).toHaveValue('50,00');
  expect(state.actions.filter(action => /pagar|pagamento|status|transferir/.test(action.path))).toEqual([]);
});
