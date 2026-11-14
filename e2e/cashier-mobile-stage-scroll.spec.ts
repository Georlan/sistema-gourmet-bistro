import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('seletor de etapas acompanha o topo da rolagem interna de pedidos, sem flutuar sobre cards', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.goto('/?view=caixa');

  const shell = page.locator('.cashier-shell--mobile-orders');
  const content = shell.locator('.cashier-content');
  const stages = content.getByRole('tablist', { name: 'Etapa dos pedidos' });
  await expect(stages).toBeVisible();

  // Simula o perfil Pocket observado no restaurante sem mudar dados do tenant.
  await shell.evaluate(el => el.setAttribute('data-koma-plan', 'pocket'));
  await expect.poll(() => content.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(300);
  await content.evaluate(el => { el.scrollTop = 680; });
  await expect.poll(() => content.evaluate(el => el.scrollTop)).toBeGreaterThan(250);

  // O topo da área de pedidos já fica ABAIXO do cabeçalho e da subnavegação.
  // Um offset adicional de 6.25rem prende a barra no meio da tela e cobre cards.
  const distanceFromScrollerTop = await stages.evaluate(element => {
    const viewport = element.closest('.cashier-content');
    if (!viewport) throw new Error('Área de rolagem dos pedidos não encontrada');
    return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  });
  expect(distanceFromScrollerTop).toBeGreaterThanOrEqual(-2);
  expect(distanceFromScrollerTop).toBeLessThan(24);

  const digital = stages.getByRole('tab', { name: /Digitais/ });
  await digital.click();
  await expect(digital).toHaveAttribute('aria-selected', 'true');
  await expect(content.locator('.orders-column--digital')).toHaveClass(/is-mobile-active/);
  const salon = stages.getByRole('tab', { name: /Salão/ });
  await salon.click();
  await expect(salon).toHaveAttribute('aria-selected', 'true');
});
