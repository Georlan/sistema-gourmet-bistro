import { expect, test } from '@playwright/test';

test.describe('landing comercial do Kôma', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/landing');
    await expect(page.getByRole('heading', { level: 1, name: /Seu restaurante inteiro/i })).toBeVisible();
  });

  test('mantém a página sem overflow horizontal e abre uma única conversão', async ({ page }) => {
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);

    await page.getByRole('button', { name: 'Agendar demonstração' }).first().click();
    const dialog = page.getByRole('dialog', { name: /Veja o Kôma na sua rotina/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('SEU NOME')).toBeVisible();
    await expect(dialog.getByLabel('NOME DO ESTABELECIMENTO')).toBeVisible();
    await expect(dialog.getByLabel('SEU WHATSAPP')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Continuar pelo WhatsApp/i })).toBeVisible();
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    await expect(dialog).toBeHidden();
  });

  test('troca as áreas do produto sem recarregar a página', async ({ page }) => {
    await page.getByRole('tab', { name: 'Cozinha' }).click();
    await expect(page.getByRole('heading', { name: /A cozinha recebe o pedido/i })).toBeVisible();
    await expect(page.getByText('Fila da cozinha')).toBeVisible();

    await page.getByRole('tab', { name: 'Cardápio digital' }).click();
    await expect(page.getByRole('heading', { name: /O cliente pede pelo celular/i })).toBeVisible();
    await expect(page.getByText('Kôma Smash Bacon')).toBeVisible();
  });

  test('oferece navegação e CTA persistente em telas móveis', async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 640, 'Fluxo exclusivo de celular');

    const quickConversion = page.locator('.koma-mobile-conversion');
    await expect(quickConversion).not.toHaveClass(/is-visible/);
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect(quickConversion).toHaveClass(/is-visible/);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Menu mobile' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Menu mobile' }).getByText('Planos')).toBeVisible();
  });
});
