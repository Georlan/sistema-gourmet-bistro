import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

test('KDS avança pedido aceito quando o último item fica pronto', async ({ page }) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  let status = 'aceito';
  let itemStatus = 'preparando';
  let readyWasOptIn = false;
  const check = () => ({ id:'kds-flow', restaurante_id:99001, numero_pedido:333, tipo:'Retirada', identificador:'Teste KDS', fechada:false,
    garcom_id:'caixa-e2e', valor_pago:0, delivery_status:status, delivery_telefone:'85999990000', criado_em:new Date().toISOString(),
    lancamentos:[{id:'kds-launch',origem:'cardapio',status}], itens:[{id:'kds-item',produto_id:'101',preco_unit:15,status:itemStatus,pago:false,lancamento_id:'kds-launch',produto:{id:'101',nome:'Suco KDS',preco:15}}] });
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({json:[check()]}));
  await page.route('**/comandas/detalhes/todos?*', route => route.fulfill({json:[check()]}));
  await page.route('**/comandas/kds-flow/delivery/status?*', async route => { status = new URL(route.request().url()).searchParams.get('status_novo')!; await route.fulfill({json:check()}); });
  await page.route('**/comandas/itens/kds-item/status?*', async route => { const url = new URL(route.request().url()); readyWasOptIn = url.searchParams.get('avancar_pedido') === 'true'; itemStatus='pronto'; if (readyWasOptIn) status='pronto'; await route.fulfill({json:{id:'kds-item',status:'pronto'}}); });
  await page.goto('/?view=caixa');
  await page.getByRole('button', {name:'Cozinha', exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Iniciar preparo'})).toHaveCount(0);
  await page.getByRole('button',{name:'Marcar como pronto: Suco KDS'}).click();
  await expect.poll(() => status).toBe('pronto');
  expect(readyWasOptIn).toBe(true);
  await expect(page.getByRole('button', { name: 'Prontos 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Prontos 1' }).click();
  await expect(page.locator('[data-stage="pronto"]')).toContainText('Para expedição');
  await expect(page.getByRole('button', { name: /marcar como entregue/i })).toHaveCount(0);
});
