import { expect, test } from '@playwright/test';

const widths = [320, 360, 390, 430, 699, 700, 768, 1024] as const;
test('landing V2 stays readable and interactive across mobile and breakpoint widths', async ({ page }) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Pedidos, cozinha e caixa\. Um só fluxo/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Um pedido. Menos etapas para conferir.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Veja a operação nas telas.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Escolha o plano para a sua operação.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Antes de começar.' })).toBeVisible();
    await expect(page.getByText('VENDA MAIS', { exact: true })).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    const important = await page.getByRole('heading', { name: /Um pedido\. Menos etapas/ }).boundingBox();
    expect(important?.width).toBeGreaterThan(200);
    if (width < 700) {
      await page.getByRole('button', { name: 'Abrir menu' }).click();
      await expect(page.getByRole('navigation', { name: 'Menu mobile' }).getByRole('link', { name: 'Produto' })).toBeVisible();
      await page.getByRole('navigation', { name: 'Menu mobile' }).getByRole('link', { name: 'Produto' }).click();
      await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeVisible();
    }
  }
});

test('tabs, annual billing, comparison, FAQ, anchors and demo work at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Cozinha' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('KDS dedicado e impressão automática no Pro e Premium.');
  await expect(page.getByRole('tabpanel').locator('img')).toHaveAttribute('src', /cozinha.webp/);
  await page.getByRole('tab', { name: 'Cardápio' }).click();
  await expect(page.getByRole('tabpanel').locator('img')).toHaveAttribute('src', /cardapio.webp/);
  await page.getByRole('group', { name: 'Período de cobrança' }).getByRole('button', { name: /^Anual/ }).click();
  await expect(page.locator('.v2-plan-card').first()).toContainText('421,20');
  await expect(page.locator('.v2-plan-card').first().getByRole('link', { name: /Contratar Pocket/ })).toHaveAttribute('href', /cobranca=anual/);
  await page.locator('.v2-plan-details summary').click();
  await expect(page.locator('.v2-plan-details table')).toBeVisible();
  await page.getByText('Preciso comprar uma impressora?').click();
  await expect(page.getByText('Não para acompanhar a fila de preparo na tela.')).toBeVisible();
  await page.getByRole('button', { name: 'Pedir demonstração' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').locator('input')).toHaveCount(2);
  await page.getByRole('button', { name: 'Fechar demonstração' }).click();
  await page.getByRole('link', { name: 'Ver planos' }).last().click();
  await expect(page).toHaveURL(/#planos$/);
  await expect(page.getByRole('group', { name: 'Período de cobrança' }).getByRole('button', { name: /^Anual/ })).toHaveAttribute('aria-pressed', 'true');
});

test('landscape and reduced motion keep content available without operational loading', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByText('Preparando Kôma…')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Pedidos, cozinha e caixa/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('tab', { name: 'Pedidos' })).toBeVisible();
});
