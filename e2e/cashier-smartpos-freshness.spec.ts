import { expect, test } from '@playwright/test';
import { API_ORIGIN, openOperationalScenario, showStage } from './fixtures/operational';

test('atualização independente da maquininha altera a ação do card sem nova lista de pedidos', async ({ page }) => {
  await openOperationalScenario(page, { statuses: ['pronto', 'pronto'] });
  await showStage(page, 'Concluir');
  const card = page.locator('.orders-card--closing');
  await expect(card.getByRole('button', { name: 'Abrir pagamento' })).toBeVisible();
  await page.route(`${API_ORIGIN}/auth/smartpos/caixa/operacao`, route => route.fulfill({
    json: [{ mesa_id: 7, estado_operacional: 'pagamento_processando', pagamento: { intent_id: 'intent-owned-7', status: 'PENDING' } }],
  }));
  await page.evaluate(() => window.dispatchEvent(new Event('koma_smartpos_updated')));
  await expect(card.getByRole('button', { name: 'Acompanhar pagamento' })).toBeVisible();
});
