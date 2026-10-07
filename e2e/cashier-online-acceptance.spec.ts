import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

async function setup(page: Page, options: { count?: number; payment?: string; change?: number | null; fail?: boolean; hold?: boolean; pickup?: boolean } = {}) {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  let socket: WebSocketRoute;
  await page.routeWebSocket(/\/ws\//, ws => { socket = ws; ws.onMessage(() => {}); });
  const statuses = new Map(Array.from({ length: options.count ?? 1 }, (_, i) => [`online-${i + 1}`, 'pendente']));
  const check = (id: string) => ({
    id, restaurante_id: 99001, numero_pedido: Number(id.split('-')[1]) + 100,
    tipo: options.pickup ? 'Retirada' : 'Delivery', identificador: `Cliente ${id}`, fechada: false,
    garcom_id: 'caixa-e2e', valor_pago: 0, delivery_status: statuses.get(id),
    delivery_taxa: 5, delivery_endereco: 'Rua de teste, 123', delivery_telefone: '85999999999',
    delivery_forma_pagamento: options.payment ?? 'dinheiro', delivery_troco_para: options.change === undefined ? 50 : options.change,
    criado_em: new Date().toISOString(),
    lancamentos: [{ id: `launch-${id}`, origem: 'cardapio', status: statuses.get(id) }],
    itens: [{ id: `item-${id}`, produto_id: '101', produto: { nome: 'Prato de teste' },
      preco_unit: 42, pago: false, status: 'preparando', lancamento_id: `launch-${id}` }],
  });
  const all = () => [...statuses.keys()].map(check);
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({ json: all() }));
  await page.route('**/comandas/delivery/pendentes', route => route.fulfill({ json: all().filter(c => c.delivery_status === 'pendente') }));
  await page.route('**/comandas/detalhes/todos?*', route => route.fulfill({ json: all() }));
  let release = () => {};
  const gate = options.hold ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
  let requested = false;
  await page.route('**/comandas/online-*/delivery/status?*', async route => {
    requested = true;
    await gate;
    const id = new URL(route.request().url()).pathname.split('/')[2];
    if (options.fail) await route.fulfill({ status: 503, json: { detail: 'Falha de teste no aceite' } });
    else { statuses.set(id, new URL(route.request().url()).searchParams.get('status_novo')!); await route.fulfill({ json: check(id) }); }
  });
  await page.goto('/?view=caixa');
  await page.getByRole('button', { name: /Aguardando aceite/ }).click();
  await expect(page.locator('.orders-pending-card')).toHaveCount(options.count ?? 1);
  return { release, requested: () => requested, arrive: () => {
    statuses.set('online-2', 'pendente');
    socket!.send(JSON.stringify({ event: 'tables_updated' }));
  } };
}

for (const payment of ['dinheiro', 'pix']) {
  test(`card mostra pagamento ${payment} e troco somente em dinheiro`, async ({ page }) => {
    await setup(page, { payment });
    const card = page.locator('.orders-pending-card');
    await expect(card).toContainText(`Pagamento: ${payment}`);
    await expect(card).toContainText('Rua de teste, 123');
    if (payment === 'dinheiro') await expect(card).toContainText('Troco para R$ 50,00');
    else await expect(card).not.toContainText('Troco para');
    await expect(card.getByRole('button', { name: '✓ Aceitar' })).toBeEnabled();
  });
}

test('dinheiro sem solicitação não inventa troco', async ({ page }) => {
  await setup(page, { change: null });
  await expect(page.locator('.orders-pending-card')).not.toContainText('Troco para');
});

test('aceita dois pedidos e fecha painel apenas após confirmação do último', async ({ page }) => {
  await setup(page, { count: 2 });
  await page.locator('.orders-pending-card').first().getByRole('button', { name: '✓ Aceitar' }).click();
  await expect(page.getByRole('heading', { name: 'Pedidos aguardando aceite' })).toBeVisible();
  await expect(page.locator('.orders-pending-card')).toHaveCount(1);
  await page.locator('.orders-pending-card').getByRole('button', { name: '✓ Aceitar' }).click();
  await expect(page.getByRole('heading', { name: 'Pedidos aguardando aceite' })).toHaveCount(0);
  await expect(page.locator('.orders-card--digital')).toHaveCount(2);
});

test('aguarda confirmação antes de fechar e mantém painel em falha', async ({ page }) => {
  const state = await setup(page, { fail: true, hold: true });
  await page.getByRole('button', { name: '✓ Aceitar' }).click();
  await expect.poll(state.requested).toBe(true);
  await expect(page.getByRole('heading', { name: 'Pedidos aguardando aceite' })).toBeVisible();
  state.release();
  await expect(page.locator('.orders-pending-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Pedidos aguardando aceite' })).toBeVisible();
  await expect(page.getByRole('button', { name: '✓ Aceitar' })).toBeEnabled();
});

test('pedido novo durante aceite mantém painel aberto', async ({ page }) => {
  const state = await setup(page, { hold: true });
  await page.getByRole('button', { name: '✓ Aceitar' }).click();
  await expect.poll(state.requested).toBe(true);
  state.arrive();
  await expect(page.locator('.orders-pending-card')).toContainText('Cliente online-2');
  state.release();
  await expect(page.getByRole('heading', { name: 'Pedidos aguardando aceite' })).toBeVisible();
  await expect(page.locator('.orders-pending-card')).toHaveCount(1);
});


test('última retirada exibe troco e volta ao Kanban somente depois do aceite confirmado', async ({ page }) => {
  const state = await setup(page, { pickup: true, hold: true });
  await expect(page.locator('.orders-pending-card')).toContainText('Troco para R$ 50,00');
  if (process.env.ACCEPTANCE_SCREENSHOT) await page.screenshot({ path: process.env.ACCEPTANCE_SCREENSHOT });
  await page.getByRole('button', { name: '✓ Aceitar' }).click();
  await expect.poll(state.requested).toBe(true);
  await expect(page.getByRole('heading', { name: 'Pedidos aguardando aceite' })).toBeVisible();
  state.release();
  await expect(page.getByRole('heading', { name: 'Pedidos aguardando aceite' })).toHaveCount(0);
  await expect(page.locator('.orders-card--digital')).toContainText('Cliente online-1');
});
