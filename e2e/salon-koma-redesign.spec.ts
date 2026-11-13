import { expect, test } from '@playwright/test';
import { openOperationalScenario } from './fixtures/operational';

test('Salão do Caixa mantém busca, filtros e grade legíveis no celular', async ({ page }) => {
  await openOperationalScenario(page, { subtab: 'mesas', tableCount: 18 });
  const cards = page.locator('.koma-salon-card');
  await expect(cards).toHaveCount(18);
  await expect(page.locator('.koma-salon__summary, .koma-salon__heading, .koma-salon__workspace')).toHaveCount(0);
  await expect(page.locator('.koma-salon-card__tap')).toHaveCount(18);
  await expect(page.locator('.koma-salon-card__tap').first()).toHaveAttribute('aria-label', /Mesa 07/);
  await expect(page.getByRole('group', { name: 'Filtrar mesas por situação' })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1366) >= 360 && (page.viewportSize()?.width ?? 1366) < 640) {
    const columns = await page.locator('.koma-salon__grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(3);
  }
  const search = page.getByRole('searchbox', { name: 'Buscar mesa no salão' });
  await search.fill('07');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('07');
  await search.fill('número inexistente');
  await expect(page.getByText('Nenhuma mesa encontrada')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar busca de mesas' }).click();
  await expect(cards).toHaveCount(18);
  await page.locator('.koma-salon__filter').filter({ hasText: 'Livres' }).click();
  await expect(page.locator('.koma-salon-card[data-table-status="occupied"]')).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1366) < 768) {
    const sizes = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      body: document.body.scrollWidth,
    }));
    expect(sizes.body).toBeLessThanOrEqual(sizes.viewport + 1);
  }
});

test('abrir pedido na mesa evidencia destino; seletor KÔMA permite buscar, trocar e remover mesa sem enviar venda', async ({ page }) => {
  const state = await openOperationalScenario(page, { subtab: 'mesas' });
  await page.locator('.koma-salon-card[data-table-status="free"]').getByRole('button', { name: 'Abrir pedido' }).click();
  const destination = page.getByTestId('pdv-selected-table-context');
  await expect(destination).toContainText('Mesa 08');
  await expect(page.getByPlaceholder('Buscar item, descrição ou código')).toBeVisible();

  await destination.getByRole('button', { name: 'Trocar mesa' }).click();
  const dialog = page.getByRole('dialog', { name: 'Escolher mesa' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Buscar número ou nome da mesa' }).fill('07');
  await expect(dialog.locator('.koma-table-picker__tile')).toHaveCount(1);
  await dialog.getByRole('button', { name: /^Mesa 07 · Em atendimento/ }).click();
  await expect(dialog).toBeHidden();
  await expect(destination).toContainText('Mesa 07');

  const showCart = page.getByRole('button', { name: /^Carrinho \(/ });
  if (await showCart.isVisible()) await showCart.click();
  const trigger = page.locator('#pdv-target-table');
  await expect(trigger).toHaveAttribute('data-table-id', '7');
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByRole('button', { name: 'Sem mesa' }).click();
  await expect(trigger).toHaveAttribute('data-table-id', '0');
  await expect(destination).toHaveCount(0);
  expect(state.actions.filter(action => /lancamentos|pagar|transferir/.test(action.path))).toEqual([]);
});

test('Salão permanece navegável em 320px sem rolagem horizontal de página', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openOperationalScenario(page, { subtab: 'mesas', tableCount: 18 });
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(sizes.documentWidth).toBeLessThanOrEqual(sizes.viewport + 1);
  expect(sizes.bodyWidth).toBeLessThanOrEqual(sizes.viewport + 1);
  await expect(page.locator('.koma-salon-card')).toHaveCount(18);
  await expect(page.locator('.koma-salon-card[data-table-status="free"]').first().getByRole('button', { name: 'Abrir pedido' })).toBeVisible();
});

test('Salão claro mantém identidade KÔMA e texto gigante reorganiza cards em 390px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await openOperationalScenario(page, { subtab: 'mesas', tableCount: 8 });
  await page.evaluate(() => {
    document.documentElement.dataset.komaTheme = 'light';
    document.documentElement.dataset.komaTextSize = 'normal';
  });
  const grid = page.locator('.koma-salon__grid');
  const columnCount = () => grid.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
  expect(await columnCount()).toBe(3);
  await expect(page.locator('.koma-salon__summary, .koma-salon__heading')).toHaveCount(0);
  if (process.env.KOMA_CAPTURE_UI) await page.screenshot({ path: testInfo.outputPath('salon-light-390.png') });
  await page.evaluate(() => { document.documentElement.dataset.komaTextSize = 'gigante'; });
  expect(await columnCount()).toBe(2);
  await expect(page.locator('.koma-salon-card')).toHaveCount(8);
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(391);
});

test('tocar no número da mesa usa todo o card e mantém destino no PDV', async ({ page }) => {
  await openOperationalScenario(page, { subtab: 'mesas' });
  const mesa = page.locator('.koma-salon-card[data-table-status="free"]').first();
  await mesa.locator('.koma-salon-card__number').click();
  await expect(page.getByTestId('pdv-selected-table-context')).toContainText('Mesa 08');
});
