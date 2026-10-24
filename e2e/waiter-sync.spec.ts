import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { mockCashierBackend, cashierConfig } from './fixtures/cashier';
const draftKey = 'koma_drafts_v4:99001:sync-waiter';
const deferred = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };
const makeState = () => ({ config: { ...cashierConfig }, configReads: 0, tablesGate: null as ReturnType<typeof deferred> | null, ordersGate: null as ReturnType<typeof deferred> | null, configGate: null as ReturnType<typeof deferred> | null, itemStatus: 'pronto', failDelivery: false, deliveryWrites: 0, withOtherItem: false, sockets: [] as WebSocketRoute[] });
async function setup(page: Page, role = 'garcom', state = makeState()) {
  await mockCashierBackend(page);
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/ws\//, socket => { sockets.push(socket); state.sockets.push(socket); socket.onMessage(() => {}); });
  await page.addInitScript(role => {
    if (role === 'admin') {
      sessionStorage.setItem('koma_caixa_token', 'cashier-fixture');sessionStorage.setItem('koma_caixa_id', 'sync-cashier');sessionStorage.setItem('koma_caixa_name', 'Caixa');sessionStorage.setItem('koma_caixa_role', 'admin');sessionStorage.setItem('koma_active_operational_portal', 'caixa');sessionStorage.setItem('koma_operator_session_caixa', JSON.stringify({token:'cashier-fixture',expiresAt:Date.now()+86400000,user:{id:'sync-cashier',nome:'Caixa',role:'admin',restaurante_id:99001}}));return;
    }
    sessionStorage.setItem('koma_waiter_token', 'sync-fixture');sessionStorage.setItem('koma_waiter_id', 'sync-waiter');sessionStorage.setItem('koma_waiter_name', 'Ana');sessionStorage.setItem('koma_user_role', 'garcom');sessionStorage.setItem('koma_active_operational_portal', 'garcom');
    sessionStorage.setItem('koma_operator_session_garcom', JSON.stringify({ token: 'sync-fixture', expiresAt: Date.now()+86400000, user: { id: 'sync-waiter', nome: 'Ana', role: 'garcom', restaurante_id: 99001 } }));
  }, role);
  await page.route('**/mesas/', async route => { await state.tablesGate?.promise; await route.fulfill({ json: [{ id: 7, nome: 'Varanda', capacidade: 4, status: 'ocupada' }, { id: 8, nome: 'Mesa 8', capacidade: 4, status: 'livre' }] }); });
  await page.route('**/comandas/detalhes/todos**', async route => { await state.ordersGate?.promise; await route.fulfill({ json: [{ id: 'sync-check', restaurante_id: 99001, mesa_id: 7, garcom_id: 'sync-waiter', tipo: 'Consumo no Local', numero_pedido: 7, fechada: false, valor_pago: 0, criado_em: new Date().toISOString(), itens: [{ id: 'sync-item', produto_id: '101', preco_unit: 42, status: state.itemStatus, pago: false, produto: { id: '101', nome: 'Risoto da casa', preco: 42 } }, ...(state.withOtherItem ? [{id:'sync-preparing',produto_id:'102',preco_unit:10,status:'preparando',pago:false,produto:{id:'102',nome:'Batata',preco:10}}] : [])] }] }); });
  await page.route('**/caixa/configuracoes', async route => { if (route.request().method() === 'PUT') { state.config = { ...state.config, ...route.request().postDataJSON() }; await route.fulfill({ json: state.config }); state.sockets.forEach(socket => socket.send(JSON.stringify({event:'config_updated'}))); return; } state.configReads++; const snapshot = { ...state.config }; await state.configGate?.promise; await route.fulfill({ json: snapshot }); });
  await page.route('**/comandas/itens/sync-item/status**', async route => {
    state.deliveryWrites++;
    if (state.failDelivery) { await route.fulfill({ status: 500, json: { detail: 'Fixture failure' } }); return; }
    state.itemStatus = 'entregue';await route.fulfill({ json: { ok: true } });
    state.sockets.forEach(socket => socket.send(JSON.stringify({ event: 'tables_updated' })));
  });
  return { state, sockets, send: (event: string) => sockets.at(-1)!.send(JSON.stringify({ event })) };
}

test('reload espera mesas, comandas e configuração sem mostrar cards livres provisórios', async ({ page }) => {
  const { state } = await setup(page);
  for (const reload of [false, true]) {
    state.tablesGate = deferred();state.ordersGate = deferred();state.configGate = deferred();
    if (reload) await page.reload(); else await page.goto('/?view=garcom');
    await expect(page.getByTestId('operational-snapshot-loading')).toBeVisible();
    await expect(page.locator('[id^="mesa-card-"]')).toHaveCount(0);
    state.tablesGate.release();state.ordersGate.release();
    await expect(page.getByTestId('operational-snapshot-loading')).toBeVisible();
    await expect(page.locator('#mesa-card-7')).toHaveCount(0);
    state.configGate.release();
    await expect(page.locator('#mesa-card-7')).toBeVisible();
    await expect(page.locator('#mesa-card-7')).toContainText('42,00');
  }
});

test('config_updated retira edição, cancelamento e transferência durante o uso sem perder rascunho', async ({ page }) => {
  const { state, send } = await setup(page);await page.goto('/?view=garcom');
  await page.locator('#mesa-card-7').click();
  await expect(page.getByRole('button', { name: 'Cancelar Risoto da casa' })).toBeVisible();
  await page.locator('#tab-lancamento-btn').click();await page.locator('#add-product-btn-101').click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)||'{}')[7]?.length, draftKey)).toBe(1);
  state.config = { ...state.config, perm_garcom_editar: false, perm_garcom_cancelar: false, perm_garcom_transferir_mesa: false, perm_garcom_transferir_item: false, perm_garcom_fechar: false };
  send('config_updated');
  await expect(page.locator('#tab-lancamento-btn')).toHaveCount(0);
  await expect(page.locator('.kw-consumption')).toBeVisible();
  await expect(page.locator('#tab-transferir-btn')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancelar Risoto da casa' })).toHaveCount(0);
  await expect(page.getByText('Adicionar Itens', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!)[7].length, draftKey)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('retirar status no Caixa remove acesso a Prontas e recompõe o salão sem tela vazia', async ({ page }) => {
  const { state, send } = await setup(page);await page.goto('/?view=garcom');
  await page.locator('#waiter-filter-prontas').click();await expect(page.locator('#mesa-card-8')).toHaveCount(0);
  state.config = { ...state.config, perm_garcom_status: false };send('config_updated');
  await expect(page.locator('#waiter-filter-prontas')).toHaveCount(0);
  await expect(page.locator('#mesa-card-8')).toBeVisible();
  const geometry = await page.locator('.kw-filters').evaluate(element => { const bounds=element.getBoundingClientRect();const buttons=[...element.querySelectorAll('button')];return { width:bounds.width, used:buttons.at(-1)!.getBoundingClientRect().right-buttons[0].getBoundingClientRect().left }; });
  expect(geometry.width-geometry.used).toBeLessThan(10);
  await page.locator('#open-sidebar-btn').click();await expect(page.locator('#drawer-show-ready-tables')).toHaveCount(0);
});

test('evento durante leitura de configuração exige uma releitura e não perde a revogação', async ({ page }) => {
  const { state, send } = await setup(page);await page.goto('/?view=garcom');await page.locator('#mesa-card-7').click();
  const initialReads = state.configReads;
  const gate = deferred();state.configGate = gate;send('config_updated');
  await expect.poll(() => state.configReads).toBe(initialReads + 1);
  state.config = { ...state.config, perm_garcom_editar: false };
  send('config_updated');
  // Let the coalesced websocket invalidation reach the in-flight owner.
  await page.waitForTimeout(150);
  state.configGate = null;gate.release();
  await expect(page.locator('#tab-lancamento-btn')).toHaveCount(0);
  expect(state.configReads).toBe(initialReads + 2);
});

test('reconectar relê permissões alteradas enquanto o socket estava fora', async ({ page }) => {
  const { state, sockets } = await setup(page);await page.goto('/?view=garcom');await page.locator('#mesa-card-7').click();
  state.config = { ...state.config, perm_garcom_editar: false };
  sockets.at(-1)!.close();
  await expect.poll(() => sockets.length).toBe(2);
  await expect(page.locator('#tab-lancamento-btn')).toHaveCount(0);
});


test('entrada por Prontas acompanha atualização websocket sem mudar o consumo completo', async ({ page }) => {
  const { state, send } = await setup(page);state.withOtherItem = true;
  await page.goto('/?view=garcom');await page.locator('#waiter-filter-prontas').click();await page.locator('#mesa-card-7').click();
  await expect(page.locator('#toggle-ready-consumption')).toHaveText('Ver todos');
  await expect(page.getByText('Batata', { exact: true })).toHaveCount(0);
  await expect(page.locator('.kw-consumption-tools')).toHaveCount(0);
  await expect(page.locator('.kw-consumption-summary')).toHaveCount(0);
  await page.locator('#toggle-ready-consumption').click();await expect(page.getByText('Batata', { exact: true })).toBeVisible();
  await page.locator('#toggle-ready-consumption').click();
  state.itemStatus = 'entregue';send('tables_updated');
  await expect(page.locator('#deliver-item-btn-sync-item')).toHaveCount(0);
  await expect(page.getByText('Nenhum item pronto no momento.', { exact: true })).toBeVisible();
  await page.locator('#toggle-ready-consumption').click();await expect(page.getByText('Batata', { exact: true })).toBeVisible();
  expect(state.deliveryWrites).toBe(0);
});

test('falha ao servir recupera imediatamente o item pronto sem aguardar o overlay expirar', async ({ page }) => {
  const { state } = await setup(page);state.failDelivery = true;
  await page.goto('/?view=garcom');await page.locator('#waiter-filter-prontas').click();await page.locator('#mesa-card-7').click();
  await page.locator('#deliver-item-btn-sync-item').click();
  await expect.poll(() => state.deliveryWrites).toBe(1);
  await expect(page.locator('#deliver-item-btn-sync-item')).toBeVisible({ timeout: 2500 });
  state.failDelivery = false;await page.locator('#deliver-item-btn-sync-item').click();
  await expect(page.getByText('Nenhum item pronto no momento.', { exact: true })).toBeVisible();
  expect(state.deliveryWrites).toBe(2);
});

test('Caixa e Garçom em sessões distintas convergem pela notificação de configuração', async ({ page, context }) => {
  const { state } = await setup(page);await page.goto('/?view=garcom');await page.locator('#mesa-card-7').click();
  const cashier = await context.newPage();await setup(cashier, 'admin', state);await cashier.goto('/?view=caixa');
  await expect.poll(() => state.sockets.length).toBe(2);
  const status = await cashier.evaluate(async () => (await fetch('http://127.0.0.1:8000/caixa/configuracoes', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer cashier-fixture' }, body: JSON.stringify({ perm_garcom_editar: false, perm_garcom_cancelar: false }) })).status);
  expect(status).toBe(200);
  await expect(page.locator('#tab-lancamento-btn')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancelar Risoto da casa' })).toHaveCount(0);
});


test('retirar transferência com painel aberto e retirar destino externo recompõe a tela', async ({ page }) => {
  const { state, send } = await setup(page);await page.goto('/?view=garcom');await page.locator('#mesa-card-7').click();
  await page.locator('#tab-transferir-btn').click();
  state.config = { ...state.config, perm_garcom_transferir_mesa: false, perm_garcom_transferir_item: false };
  send('config_updated');await expect(page.locator('#tab-transferir-btn')).toHaveCount(0);await expect(page.locator('.kw-consumption')).toBeVisible();
  await page.locator('#tab-lancamento-btn').click();await page.locator('#add-product-btn-101').click();await page.locator('#open-draft-cart-btn').click();
  await expect(page.getByRole('button', { name: 'Retirada no balcão', exact: true })).toBeVisible();
  state.config = { ...state.config, perm_garcom_delivery: false };send('config_updated');
  await expect(page.getByRole('button', { name: 'Retirada no balcão', exact: true })).toHaveCount(0);
  await expect(page.locator('.kw-order-review')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth>innerWidth)).toBe(false);
});


test('permissão de impressão retirada no Caixa remove botões e recompõe consumo', async ({ page }) => {
  const { state, send } = await setup(page);await page.goto('/?view=garcom');await page.locator('#mesa-card-7').click();
  await expect(page.locator('#quick-print-values-btn')).toBeVisible();
  state.config = { ...state.config, perm_garcom_print: false };send('config_updated');
  await expect(page.locator('#quick-print-values-btn')).toHaveCount(0);
  await expect(page.locator('#print-invoice-preview-btn')).toHaveCount(0);
  await expect(page.locator('.kw-consumption')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
