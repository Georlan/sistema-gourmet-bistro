import { expect, test, type Page } from '@playwright/test';
import { mockCashierBackend, cashierConfig } from './fixtures/cashier';
const key = 'koma_drafts_v4:99001:repeat-waiter';
async function open(page: Page, options: { changed?: boolean; editable?: boolean; payment?: boolean } = {}) {
  await mockCashierBackend(page);
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && /\/comandas\//.test(request.url())) writes.push(request.url()); });
  await page.routeWebSocket(/\/ws\//, socket => socket.onMessage(() => {}));
  await page.addInitScript(key => {
    sessionStorage.setItem('koma_waiter_token', 'repeat-fixture');sessionStorage.setItem('koma_waiter_id', 'repeat-waiter');sessionStorage.setItem('koma_waiter_name', 'Teste');sessionStorage.setItem('koma_user_role', 'garcom');sessionStorage.setItem('koma_active_operational_portal', 'garcom');
    sessionStorage.setItem('koma_operator_session_garcom', JSON.stringify({ expiresAt: Date.now() + 86400000, token: 'repeat-fixture', user: { id: 'repeat-waiter', nome: 'Teste', role: 'garcom', restaurante_id: 99001 } }));
    // Authenticate again on reload, but never reseed an existing draft.
    if (localStorage.getItem(key) === null) localStorage.setItem(key, '{}');
  }, key);
  await page.route('**/caixa/configuracoes', route => route.fulfill({ json: { ...cashierConfig, perm_garcom_editar: options.editable !== false } }));
  await page.route('**/produtos/catalogo', route => route.fulfill({ json: {
    categorias: [{ id: 'cat', nome: 'Cozinha', destino_impressao: 'COZINHA' }],
    produtos: [{ id: 'juice', nome: 'Suco de laranja', preco: 12, ativo: true, categoria_id: 'cat' }, { id: 'burger', nome: 'Hambúrguer', preco: 45, ativo: true, categoria_id: 'cat', grupos_modificadores: [{ id: 'extra', nome: 'Adicional', min_selecoes: options.changed ? 1 : 0, max_selecoes: 3, modo_selecao: 'porcoes', tipo: 'opcional', opcoes: [{ id: options.changed ? 'bacon' : 'cheese', grupo_id: 'extra', nome: options.changed ? 'Bacon' : 'Queijo', preco_adicional: options.changed ? 6 : 5, ativo: true }] }] }, { id: 'cake', nome: 'Pudim', preco: 20, ativo: false, categoria_id: 'cat' }],
  } }));
  await page.route('**/comandas/detalhes/todos**', route => route.fulfill({ json: [{ id: 'repeat-check', restaurante_id: 99001, mesa_id: 7, garcom_id: 'repeat-waiter', tipo: 'Consumo no Local', numero_pedido: 71, fechada: false, valor_pago: 0, criado_em: new Date().toISOString(), status_comanda: options.payment ? 'aguardando_pagamento' : null,
    itens: [{ id: 'juice-old', produto_id: 'juice', preco_unit: 9, status: 'entregue', pago: false, cliente_nome: 'Consumo Geral', produto: { id: 'juice', nome: 'Suco de laranja', preco: 9 } }, { id: 'burger-old', produto_id: 'burger', preco_unit: 49, status: 'preparando', pago: false, cliente_nome: 'Ana', observacao: 'Sem cebola', modificadores: [{ id: 'cheese', nome: 'Queijo', preco: 2 }, { id: 'cheese', nome: 'Queijo', preco: 2 }], produto: { id: 'burger', nome: 'Hambúrguer', preco: 45 } }, { id: 'cake-old', produto_id: 'cake', preco_unit: 20, status: 'entregue', pago: false, cliente_nome: 'Consumo Geral', produto: { id: 'cake', nome: 'Pudim', preco: 20 } }],
  }] }));
  await page.goto('/?view=garcom');await page.locator('#mesa-card-7').click();await expect(page.locator('.kw-consumption')).toBeVisible();return writes;
}
const drafts = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}')[7] || [], key);

test('repete uma unidade no consumo, combina toques e preserva cliente, composição e valor histórico', async ({ page }) => {
  const writes = await open(page);
  const consumption = await page.locator('.kw-consumption-total').innerText();
  await page.locator('#repeat-item-btn-burger-old').dblclick();
  await expect.poll(async () => (await drafts(page))[0]?.quantidade).toBe(2);
  await page.locator('#repeat-item-btn-juice-old').dblclick();
  await expect.poll(async () => (await drafts(page)).length).toBe(2);
  await expect.poll(async () => (await drafts(page)).find((item: any) => item.produtoId === 'juice')?.quantidade).toBe(2);
  const rows = await drafts(page);
  expect(rows[0]).toMatchObject({ clienteNome: 'Ana', observacao: 'Sem cebola', preco: 55, modificadorIds: ['cheese', 'cheese'], quantidade: 2 });
  expect(rows[1]).toMatchObject({ clienteNome: 'Consumo Geral', preco: 12, quantidade: 2 });
  expect(await page.locator('.kw-consumption-total').innerText()).toBe(consumption);
  await expect(page.locator('#menu-panel-root')).toHaveCount(0);
  await expect(page.locator('#tab-lancamento-btn')).toContainText('Revisar');
  await expect(page.locator('#tab-lancamento-btn [aria-live]')).toHaveText('4');
  expect(writes).toEqual([]);
  await page.locator('#tab-lancamento-btn').click();await expect(page.locator('.kw-order-review')).toBeVisible();expect(writes).toEqual([]);
});

test('produto pausado fica bloqueado sem adicionar ou enviar pedido', async ({ page }) => {
  const writes = await open(page);await expect(page.locator('#repeat-item-btn-cake-old')).toBeDisabled();expect(await drafts(page)).toEqual([]);expect(writes).toEqual([]);
});

test('opções alteradas abrem configuração existente e preservam cliente e observação sem envio automático', async ({ page }) => {
  const writes = await open(page, { changed: true });await page.locator('#repeat-item-btn-burger-old').click();
  const config = page.getByTestId('waiter-product-config');await expect(config).toBeVisible();
  await expect(page.locator('#config-client-name')).toHaveValue('Ana');await expect(page.locator('#config-item-obs')).toHaveValue('Sem cebola');
  await expect(config.getByRole('button', { name: 'Complete as escolhas', exact: true })).toBeDisabled();expect(await drafts(page)).toEqual([]);
  await config.getByRole('button', { name: 'Adicionar uma unidade de Bacon', exact: true }).click();await config.getByRole('button', { name: 'Adicionar ao pedido', exact: true }).click();
  await expect.poll(async () => (await drafts(page))[0]?.modificadorIds).toEqual(['bacon']);
  expect((await drafts(page))[0]).toMatchObject({ clienteNome: 'Ana', observacao: 'Sem cebola', preco: 51, quantidade: 1 });expect(writes).toEqual([]);
});

for (const options of [{ editable: false }, { payment: true }]) test(`repetição respeita bloqueio operacional ${JSON.stringify(options)}`, async ({ page }) => {
  await open(page, options);await expect(page.locator('[id^="repeat-item-btn-"]')).toHaveCount(0);expect(await drafts(page)).toEqual([]);
});


test('rascunho sobrevive ao retorno ao salão, recarregamento e reabertura da aba sem reenviar consumo', async ({ page, context }) => {
  const writes = await open(page);
  await context.setOffline(true);
  await page.locator('#repeat-item-btn-burger-old').dblclick();
  await page.locator('#repeat-item-btn-juice-old').click();
  await expect.poll(async () => (await drafts(page)).length).toBe(2);
  const saved = await drafts(page);
  expect(saved[0]).toMatchObject({ quantidade: 2, clienteNome: 'Ana', observacao: 'Sem cebola', modificadorIds: ['cheese', 'cheese'] });
  await context.setOffline(false);
  await page.locator('#close-mesa-modal-btn').click();
  await page.locator('#mesa-card-7').click();
  await expect(page.locator('.kw-consumption')).toBeVisible();
  await page.reload();
  await expect(page.locator('.kw-consumption')).toBeVisible();
  expect(await drafts(page)).toEqual(saved);
  await page.locator('#tab-lancamento-btn').click();
  await expect(page.locator('.kw-order-review')).toBeVisible();
  expect(writes).toEqual([]);
  await page.close();
  const reopened = await context.newPage();
  const reopenedWrites = await open(reopened);
  expect(await drafts(reopened)).toEqual(saved);
  await reopened.locator('#tab-lancamento-btn').click();
  await expect(reopened.locator('.kw-order-review')).toBeVisible();
  expect(reopenedWrites).toEqual([]);
});

test('voltar da revisão preserva busca e posição no catálogo', async ({ page }) => {
  await open(page);
  await page.route('**/produtos/catalogo', route => route.fulfill({ json: {
    categorias: [{ id: 'cat', nome: 'Cozinha', destino_impressao: 'COZINHA' }],
    produtos: Array.from({ length: 40 }, (_, i) => ({ id: `long-${i}`, nome: `Suco ${i}`, preco: 12, ativo: true, categoria_id: 'cat' })),
  } }));
  await page.reload();
  await expect(page.locator('.kw-consumption')).toBeVisible();
  await page.locator('#tab-lancamento-btn').click();
  await page.locator('#search-products-input').fill('Suco');
  await page.locator('#add-product-btn-long-0').click();
  const scroller = page.locator('.kw-flow-body');
  await scroller.evaluate(element => { element.scrollTop = 450; });
  const before = await scroller.evaluate(element => element.scrollTop);
  expect(before).toBeGreaterThan(200);
  await page.locator('#open-draft-cart-btn').click();
  await expect(page.locator('.kw-order-review')).toBeVisible();
  await page.getByRole('button', { name: 'Mais itens', exact: true }).click();
  await expect(page.locator('#search-products-input')).toHaveValue('Suco');
  await expect.poll(async () => scroller.evaluate(element => element.scrollTop)).toBe(before);
});

test('desfazer recupera várias remoções completas, na ordem original, e persiste após atualizar', async ({ page }) => {
  const writes = await open(page);
  await page.locator('#repeat-item-btn-burger-old').dblclick();
  await page.locator('#repeat-item-btn-juice-old').click();
  await expect.poll(async () => (await drafts(page)).length).toBe(2);
  const saved = await drafts(page);
  await page.locator('#tab-lancamento-btn').click();
  await page.locator(`#remove-draft-item-${saved[0].id}`).click();
  await page.locator(`#remove-draft-item-${saved[1].id}`).click();
  await expect.poll(() => drafts(page)).toEqual([]);
  await expect(page.locator('#undo-draft-removal')).toBeVisible();
  await page.locator('#undo-draft-removal').click();
  await page.locator('#undo-draft-removal').click();
  await expect.poll(() => drafts(page)).toEqual(saved);
  await expect(page.locator('#undo-draft-removal')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.kw-consumption')).toBeVisible();
  expect(await drafts(page)).toEqual(saved);
  expect(writes).toEqual([]);
});

test('remoção permanece salva e desfazer não reaparece em outra mesa ou após recarregar', async ({ page }) => {
  await open(page);
  await page.locator('#repeat-item-btn-burger-old').click();
  await page.locator('#repeat-item-btn-juice-old').click();
  await expect.poll(async () => (await drafts(page)).length).toBe(2);
  const saved = await drafts(page);
  await page.locator('#tab-lancamento-btn').click();
  await page.locator(`#remove-draft-item-${saved[0].id}`).click();
  await expect(page.locator('#undo-draft-removal')).toBeVisible();
  await expect.poll(() => drafts(page)).toEqual([saved[1]]);
  await page.locator('#close-mesa-modal-btn').click();
  await page.locator('#mesa-card-10').click();
  await expect(page.locator('#undo-draft-removal')).toHaveCount(0);
  await page.locator('#close-mesa-modal-btn').click();
  await page.locator('#mesa-card-7').click();
  await page.reload();
  await expect(page.locator('.kw-consumption')).toBeVisible();
  await page.locator('#tab-lancamento-btn').click();
  await expect(page.locator('.kw-order-review')).toBeVisible();
  await expect(page.locator('#undo-draft-removal')).toHaveCount(0);
  expect(await drafts(page)).toEqual([saved[1]]);
});

test('uma ação antiga de desfazer não restaura dados sob outro operador', async ({ page }) => {
  await open(page);
  await page.locator('#repeat-item-btn-burger-old').click();
  await expect.poll(async () => (await drafts(page)).length).toBe(1);
  const saved = await drafts(page);
  await page.locator('#tab-lancamento-btn').click();
  await page.locator(`#remove-draft-item-${saved[0].id}`).click();
  await expect.poll(() => drafts(page)).toEqual([]);
  await page.evaluate(() => {
    const session = JSON.parse(sessionStorage.getItem('koma_operator_session_garcom')!);
    session.user.id = 'another-waiter';
    sessionStorage.setItem('koma_operator_session_garcom', JSON.stringify(session));
  });
  await page.locator('#undo-draft-removal').click();
  expect(await drafts(page)).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('koma_drafts_v4:99001:another-waiter'))).toBeNull();
});


test('desfazer continua alcançável após remover um item no fim de um rascunho longo', async ({ page }) => {
  await open(page);
  await page.locator('#repeat-item-btn-juice-old').click();
  await expect.poll(async () => (await drafts(page)).length).toBe(1);
  await page.evaluate(key => {
    const current = JSON.parse(localStorage.getItem(key)!);
    current[7] = Array.from({ length: 12 }, (_, index) => ({ ...current[7][0], id: `long-draft-${index}`, observacao: `Preparo ${index}` }));
    localStorage.setItem(key, JSON.stringify(current));
  }, key);
  await page.reload();
  await expect(page.locator('.kw-consumption')).toBeVisible();
  await page.locator('#tab-lancamento-btn').click();
  await page.locator('#remove-draft-item-long-draft-11').click();
  const undo = page.locator('#undo-draft-removal');
  await expect(undo).toBeInViewport();
  const box = await undo.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await undo.click();
  await expect.poll(async () => (await drafts(page)).length).toBe(12);
});
