import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('latest tag follows the newest launch on an old table and reserves its own space', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, ws => ws.onMessage(() => {}));
  const now = Date.now();
  const check = {
    id: 'old-check', restaurante_id: 99001, mesa_id: 1, garcom_id: 'caixa-e2e',
    tipo: 'Consumo no Local', numero_pedido: 700, fechada: false, valor_pago: 0,
    criado_em: new Date(now - 3 * 3600_000).toISOString(),
    lancamentos: [
      { id: 'old-launch', display_number: '700-A' },
      { id: 'new-launch', display_number: '700-B' },
    ],
    itens: ['old-launch', 'new-launch'].map((id, index) => ({
      id: `item-${id}`, produto_id: '101', preco_unit: 42,
      produto: { id: '101', nome: 'Risoto da casa' }, observacao: '', cliente_nome: 'Consumo Geral',
      status: 'preparando', pago: false, lancamento_id: id,
      lancamento_timestamp: new Date(now - (index === 0 ? 3 * 3600_000 : 1000)).toISOString(),
    })),
  };
  await page.route('**/comandas/detalhes/todos*', route => route.fulfill({ json: [check] }));
  await page.goto('/?view=caixa');
  const tag = page.locator('[data-order-recency="latest"]');
  await expect(tag).toHaveCount(1);
  await expect(tag).toBeVisible();
  const card = page.locator('.orders-card').filter({ has: tag });
  await expect(card).toContainText('700-B');
  const badgeBox = await tag.boundingBox();
  const identityBox = await card.locator('.orders-card__identity').boundingBox();
  expect(badgeBox).not.toBeNull();
  expect(identityBox).not.toBeNull();
  expect(badgeBox!.y + badgeBox!.height).toBeLessThanOrEqual(identityBox!.y);
  const cardBox = await card.boundingBox();
  expect(badgeBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
  expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
  await page.reload();
  await expect(tag).toHaveCount(1);
  await expect(page.locator('.orders-card').filter({ has: tag })).toContainText('700-B');
});

test('digital recency preserves the date and seconds instead of the displayed clock', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.routeWebSocket(/\/ws\//, ws => ws.onMessage(() => {}));
  const orders = [
    ['yesterday', '2026-10-08T23:59:00-03:00'],
    ['today-a', '2026-10-09T10:00:01-03:00'],
    ['today-z', '2026-10-09T10:00:59-03:00'],
  ].map(([id, timestamp], index) => ({
    id, restaurante_id: 99001, numero_pedido: 810 + index, garcom_id: 'caixa-e2e',
    tipo: 'Delivery', identificador: id, fechada: false, valor_pago: 0, delivery_status: 'producao',
    delivery_taxa: 0, delivery_endereco: 'Rua teste', criado_em: timestamp,
    lancamentos: [{ id: `launch-${id}`, origem: 'cardapio', status: 'producao' }],
    itens: [{ id: `item-${id}`, produto_id: '101', produto: { nome: 'Risoto da casa' }, preco_unit: 42,
      status: 'preparando', pago: false, lancamento_id: `launch-${id}` }],
  }));
  await page.route('**/comandas/detalhes/todos*', route => route.fulfill({ json: [] }));
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({ json: orders }));
  await page.goto('/?view=caixa');
  const digitalTab = page.getByRole('tab', { name: /^Digital/ });
  if (await digitalTab.isVisible()) await digitalTab.click();
  const tag = page.locator('[data-order-recency="latest"]');
  await expect(tag).toHaveCount(1);
  await expect(page.locator('.orders-card').filter({ has: tag })).toContainText('today-z');
});
