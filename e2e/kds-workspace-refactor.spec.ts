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
  await workspace.getByRole('button', { name: 'Mais ferramentas da cozinha' }).click();
  await workspace.getByRole('button', { name: /Produção total/ }).click();
  const demand = workspace.locator('.kds-workspace__demand-row');
  await expect(demand).toHaveCount(2);
  await expect(demand.first()).toContainText('1× Burguer KDS');
  await expect(demand.filter({hasText:'Sem cebola'})).toHaveCount(1);
  await workspace.getByRole('button', { name: 'Prontos 0' }).click();
  await expect(workspace.getByText('Sem pedidos nesta etapa')).toBeVisible();
  await workspace.getByRole('button', { name: 'Todos 1' }).click();
  await expect(workspace.getByText('Pedido #333')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  if (process.env.KOMA_CAPTURE_UI) await page.screenshot({path:testInfo.outputPath('kds-queue-mobile.png')});
});

test('KDS operator can request canonical queue reconciliation without changing any item', async ({page}) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  const statuses = { 'kds-burger-1': 'preparando', 'kds-burger-2': 'preparando' };
  let reads = 0;
  let statusMutations = 0;
  await page.route('**/comandas/detalhes/todos?*', route => {
    reads += 1;
    return route.fulfill({json:[ticketData(statuses)]});
  });
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({json:[ticketData(statuses)]}));
  await page.route('**/comandas/itens/*/status?*', route => {
    statusMutations += 1;
    return route.fulfill({status:500,json:{detail:'Unexpected mutation from refresh'}});
  });
  await page.goto('/?view=caixa');
  await page.getByRole('button', {name:'Cozinha', exact:true}).first().click();
  const workspace = page.locator('.kds-workspace');
  await expect(workspace.getByText('Pedido #333')).toBeVisible();
  await page.waitForTimeout(300);
  const before = reads;
  await workspace.getByRole('button', {name:'Mais ferramentas da cozinha'}).click();
  await workspace.getByRole('button', {name:'Atualizar fila'}).click();
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(workspace.locator('[data-kds-item-status="preparando"]')).toHaveCount(2);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(workspace.getByRole('status')).toContainText('Dispositivo sem internet');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(workspace.getByRole('status')).toHaveCount(0);
  expect(statusMutations).toBe(0);
});

test('cozinha standalone can request the same canonical refresh without access to service actions', async ({page}) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  await page.addInitScript(() => sessionStorage.setItem('koma_caixa_role', 'cozinha'));
  const statuses = { 'kds-burger-1': 'preparando', 'kds-burger-2': 'preparando' };
  let reads = 0;
  await page.route('**/comandas/detalhes/todos?*', route => {
    reads += 1;
    return route.fulfill({json:[ticketData(statuses)]});
  });
  await page.goto('/?view=caixa');
  const kitchen = page.locator('.kds-workspace[data-kitchen-mode="standalone"]');
  await expect(kitchen.getByText('Pedido #333')).toBeVisible();
  const before = reads;
  await kitchen.getByRole('button', {name:'Mais ferramentas da cozinha'}).click();
  await kitchen.getByRole('button', {name:'Atualizar fila'}).click();
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(kitchen.getByRole('button', {name:/Marcar como entregue/i})).toHaveCount(0);
  await expect(kitchen.getByRole('button', {name:/Cancelar pedido/i})).toHaveCount(0);
});

test('KDS bulk marks all items atomically in one HTTP call and never falsely confirms failed batches', async ({page}) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  const statuses = { 'kds-burger-1': 'preparando', 'kds-burger-2': 'preparando' };
  const requests: string[][] = [];
  let rejectBatch = true;
  await page.route('**/comandas/detalhes/todos?*', route => route.fulfill({json:[ticketData(statuses)]}));
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({json:[ticketData(statuses)]}));
  await page.route('**/comandas/itens/*/status?*', route => route.fulfill({status: 500, json:{detail:'Unexpected per-item PUT'}}));
  await page.route('**/comandas/kds/itens/prontos', async route => {
    expect(route.request().method()).toBe('PUT');
    const ids = route.request().postDataJSON().item_ids as string[];
    requests.push(ids);
    if (rejectBatch) await route.fulfill({status:503,json:{detail:'Atomic rollback'}});
    else {
      for (const id of ids) statuses[id as keyof typeof statuses] = 'pronto';
      await route.fulfill({json:{confirmed_ids:ids,already_ready_ids:[],delivery_status:'pronto'}});
    }
  });
  await page.goto('/?view=caixa');
  await page.getByRole('button', {name:'Cozinha', exact:true}).first().click();
  const workspace = page.locator('.kds-workspace');
  await workspace.getByRole('button',{name:'Concluir 2 itens do pedido #333'}).click();
  await expect(workspace.locator('.kds-workspace__error')).toContainText('Não foi possível confirmar o preparo');
  expect(requests).toEqual([['kds-burger-1','kds-burger-2']]);
  await expect(workspace.locator('[data-kds-item-status="preparando"]')).toHaveCount(2);
  rejectBatch = false;
  await workspace.getByRole('button',{name:'Concluir 2 itens do pedido #333'}).click();
  await expect(workspace.getByRole('button',{name:'Prontos 1'})).toBeVisible();
  expect(requests).toEqual([['kds-burger-1','kds-burger-2'],['kds-burger-1','kds-burger-2']]);
  await workspace.getByRole('button',{name:'Prontos 1'}).click();
  await expect(workspace.locator('[data-stage="pronto"]')).toContainText('Para expedição');
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


test('one item ACK frees the next action without awaiting a delayed full-order GET', async ({page}) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  const statuses = {'kds-burger-1':'preparando','kds-burger-2':'preparando'};
  let confirmed = 0;
  const requests: string[] = [];
  await page.route('**/comandas/detalhes/todos?*', async route => {
    if (confirmed > 0) await new Promise(resolve => setTimeout(resolve, 3000));
    await route.fulfill({json:[ticketData(statuses)]});
  });
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({json:[ticketData(statuses)]}));
  await page.route('**/comandas/itens/*/status?*', async route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    requests.push(id);
    await new Promise(resolve => setTimeout(resolve, id === 'kds-burger-1' ? 400 : 20));
    statuses[id as keyof typeof statuses] = 'pronto';
    confirmed += 1;
    await route.fulfill({json:{id,status:'pronto'}});
  });
  await page.goto('/?view=caixa');
  await page.getByRole('button', {name:'Cozinha',exact:true}).first().click();
  const workspace = page.locator('.kds-workspace');
  const first = workspace.locator('#kitchen-finish-btn-kds-burger-1');
  const second = workspace.locator('#kitchen-finish-btn-kds-burger-2');
  await first.click();
  await expect(first).toBeDisabled();
  await expect(second).toBeEnabled();
  await second.click();
  const started = Date.now();
  await expect(workspace.getByRole('button',{name:'Prontos 1'})).toBeVisible({timeout: 2000});
  expect(Date.now() - started).toBeLessThan(2200);
  expect(requests.sort()).toEqual(['kds-burger-1','kds-burger-2']);
});

test('focus mode hides non-kitchen navigation and always provides an exit', async ({page},testInfo) => {
  await mockCashierBackend(page);
  await seedCashierSession(page);
  const statuses = {'kds-burger-1':'preparando','kds-burger-2':'preparando'};
  await page.route('**/comandas/detalhes/todos?*', route => route.fulfill({json:[ticketData(statuses)]}));
  await page.route('**/comandas/delivery/ativos', route => route.fulfill({json:[ticketData(statuses)]}));
  await page.goto('/?view=caixa');
  await page.getByRole('button',{name:'Cozinha',exact:true}).first().click();
  const workspace = page.locator('.kds-workspace');
  await workspace.getByRole('button',{name:'Mais ferramentas da cozinha'}).click();
  await workspace.getByRole('button',{name:'Modo foco'}).click();
  await expect(workspace).toHaveAttribute('data-focus','true');
  await expect(page.locator('.cashier-topbar')).toBeHidden();
  await expect(page.locator('.cashier-mobile-bottom-bar')).toBeHidden();
  await expect(workspace.getByRole('button',{name:'Sair do modo foco'})).toBeVisible();
  if (process.env.KOMA_CAPTURE_UI) await page.screenshot({path:testInfo.outputPath('kds-fullscreen.png')});
  await workspace.getByRole('button',{name:'Sair do modo foco'}).click();
  await expect(page.locator('.cashier-topbar')).toBeVisible();
});
