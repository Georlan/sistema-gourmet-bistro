import { expect, test } from '@playwright/test';
import { mockCashierBackend, seedCashierSession } from './fixtures/cashier';

const ticketData = (statuses: Record<string, string>) => ({
  id: 'kds-unified-fixture', restaurante_id: 99001, numero_pedido: 333, tipo: 'Retirada',
  identificador: 'Cozinha teste', fechada: false, garcom_id: 'caixa-e2e',
  delivery_status: 'producao', criado_em: new Date(Date.now() - 12 * 60000).toISOString(),
  lancamentos: [{id:'launch-kds',display_number:'333',origem:'caixa',status:'producao'}],
  itens: [
    {id:'kds-burger-1',produto_id:'101',produto:{id:'101',nome:'Burguer KDS',preco:22},
      preco_unit:22,status:statuses['kds-burger-1'],pago:false,lancamento_id:'launch-kds',observacao:''},
    {id:'kds-burger-2',produto_id:'101',produto:{id:'101',nome:'Burguer KDS',preco:22},
      preco_unit:22,status:statuses['kds-burger-2'],pago:false,lancamento_id:'launch-kds',observacao:'Sem cebola'},
  ],
});

test('KDS uses one responsive production queue, filters and All Day respecting substitutions', async ({page}, testInfo) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  const statuses = { 'kds-burger-1': 'preparando', 'kds-burger-2': 'preparando' };
  await page.route('**/comandas/detalhes/todos?*', route => route.fulfill({json:[ticketData(statuses)]}));
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({json:[ticketData(statuses)]}));
  await page.goto('/?view=caixa');
  await page.getByRole('button', {name:'Cozinha', exact:true}).first().click();
  const workspace = page.locator('.kds-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace.getByText('Pedido #333')).toBeVisible();
  await expect(workspace.getByText('12 min')).toBeVisible();
  await expect(workspace.locator('.kds-ticket__item')).toHaveCount(2);
  await expect(workspace.getByRole('button', {name:/marcar como entregue/i})).toHaveCount(0);
  await workspace.getByText('Produção total').click();
  const demand = workspace.locator('.kds-workspace__demand-row');
  await expect(demand).toHaveCount(2);
  await expect(demand.first()).toContainText('1× Burguer KDS');
  await expect(demand.filter({hasText:'Sem cebola'})).toHaveCount(1);
  await workspace.getByRole('button', { name: 'Prontos 0' }).click();
  await expect(workspace.getByText('Nenhum pedido neste filtro')).toBeVisible();
  await workspace.getByRole('button', { name: 'Todos 1' }).click();
  await expect(workspace.getByText('Pedido #333')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  if (process.env.KOMA_CAPTURE_UI) await page.screenshot({path:testInfo.outputPath('kds-queue-mobile.png')});
});

test('KDS bulk update stops at first failure, reports partial success, never delivers', async ({page}) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  const statuses = { 'kds-burger-1': 'preparando', 'kds-burger-2': 'preparando' };
  const requests: string[] = [];
  await page.route('**/comandas/detalhes/todos?*', route => route.fulfill({json:[ticketData(statuses)]}));
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({json:[ticketData(statuses)]}));
  await page.route('**/comandas/itens/*/status?*', async route => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/').at(-2)!;
    requests.push(id);
    expect(url.searchParams.get('status')).toBe('pronto');
    expect(url.searchParams.get('avancar_pedido')).toBe('true');
    if (id === 'kds-burger-2') await route.fulfill({status:503,json:{detail:'Simulação de falha'}});
    else { statuses['kds-burger-1'] = 'pronto'; await route.fulfill({json:{id,status:'pronto'}}); }
  });
  await page.goto('/?view=caixa');
  await page.getByRole('button', {name:'Cozinha', exact:true}).first().click();
  const workspace = page.locator('.kds-workspace');
  await workspace.getByRole('button',{name:'Concluir 2 itens'}).click();
  await expect(workspace.locator('.kds-workspace__error')).toContainText('1 de 2 itens confirmados');
  expect(requests).toEqual(['kds-burger-1','kds-burger-2']);
  await expect(workspace.locator('[data-kds-item-status="preparando"]')).toHaveCount(1);
  await expect(workspace.getByRole('button', { name: /marcar como entregue/i })).toHaveCount(0);
});


test('KDS uses readable actions and controlled width on narrow phones and desktop, in both themes', async ({page},testInfo) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  const statuses = { 'kds-burger-1': 'preparando', 'kds-burger-2': 'preparando' };
  await page.route('**/comandas/detalhes/todos?*', route => route.fulfill({json:[ticketData(statuses)]}));
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({json:[ticketData(statuses)]}));
  await page.goto('/?view=caixa');
  await page.getByRole('button', {name:'Cozinha',exact:true}).first().click();
  for (const [width,height,theme] of [[320,620,'dark'],[360,700,'light'],[430,800,'dark'],[768,800,'light']] as const) {
    await page.setViewportSize({width,height});
    await page.evaluate(theme => { document.documentElement.dataset.komaTheme = theme; }, theme);
    const workspace = page.locator('.kds-workspace');
    await expect(workspace.locator('.kds-ticket')).toHaveCount(1);
    await expect(workspace.getByRole('button',{name:'Marcar como pronto: Burguer KDS'})).toHaveCount(2);
    for (const button of await workspace.locator('.kds-ticket__item-action, .kds-workspace__filter').all()) {
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if (process.env.KOMA_CAPTURE_UI) await page.screenshot({path:testInfo.outputPath(`kds-${width}-${theme}.png`)});
  }
});
