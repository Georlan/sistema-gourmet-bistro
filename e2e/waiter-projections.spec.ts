import { expect, Page, test } from '@playwright/test';

// Characterization of the existing waiter consumers before the shared
// projections are introduced. One financial check contains two real launches;
// the persisted family snapshot supplies their human identities.
const API_ORIGIN = 'http://127.0.0.1:8000';
const APP_ORIGIN = 'http://127.0.0.1:4173';
const NOW = new Date('2026-08-30T15:00:00.000Z');
const CHECK_ID = 'check-waiter-phase7-24';
const LAUNCH_A = 'launch-waiter-phase7-a';
const LAUNCH_B = 'launch-waiter-phase7-b';
const ITEM_A = 'item-waiter-phase7-a';
const ITEM_B = 'item-waiter-phase7-b';

type ItemStatus = 'preparando' | 'pronto' | 'entregue';
type Write = { method: string; path: string; status: string | null; tableId: string | null };
type WaiterScenario = {
  checkNumber?: number;
  displayNumbers?: [string, string];
  sequences?: [number, number];
  emptySession?: boolean;
  withoutCheck?: boolean;
};

async function openWaiterScenario(
  page: Page,
  statuses: [ItemStatus, ItemStatus] = ['preparando', 'pronto'],
  scenario: WaiterScenario = {},
) {
  const createdAt = new Date(NOW.getTime() - 12 * 60_000).toISOString();
  const checkNumber = scenario.checkNumber ?? 24;
  const displayNumbers = scenario.displayNumbers ?? ['24-A', '24-B'];
  const sequences = scenario.sequences ?? [1, 2];
  const items = (scenario.emptySession ? [] : statuses).map((status, index) => ({
    id: index === 0 ? ITEM_A : ITEM_B,
    lancamento_id: index === 0 ? LAUNCH_A : LAUNCH_B,
    produto_id: `product-waiter-phase7-${index + 1}`,
    preco_unit: index === 0 ? 112 : 48,
    status,
    pago: false,
    cliente_nome: 'Consumo Geral',
    observacao: index === 0 ? 'Sem cebola' : '',
    produto: {
      id: `product-waiter-phase7-${index + 1}`,
      nome: index === 0 ? 'Prato da primeira rodada' : 'Prato da segunda rodada',
      preco: index === 0 ? 112 : 48,
      ativo: true,
    },
  }));
  const check = {
    id: CHECK_ID,
    restaurante_id: 99001,
    mesa_id: 7,
    garcom_id: 'waiter-phase7',
    criada_por: { nome: 'Garçom Fase 7' },
    tipo: 'Consumo no Local',
    numero_pedido: checkNumber,
    fechada: false,
    valor_pago: 0,
    criado_em: createdAt,
    status_comanda: null,
    lancamentos: items.map(item => ({
      id: item.lancamento_id,
      comanda_id: CHECK_ID,
      origem: 'garcom',
      timestamp: createdAt,
    })),
    itens: items,
  };
  const writes: Write[] = [];
  const unexpectedApiRequests: string[] = [];

  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => {
    localStorage.setItem('koma_waiter_token', 'waiter-phase7-fixture-token');
    localStorage.setItem('koma_waiter_id', 'waiter-phase7');
    localStorage.setItem('koma_waiter_name', 'Garçom Fase 7');
    localStorage.setItem('koma_user_role', 'garcom');
  });

  // The operational socket is fully mocked, never connected to a backend.
  // Keeping it open also avoids timing-dependent fallback polling in this UI fixture.
  await page.routeWebSocket(/\/ws\//, socket => {
    socket.onMessage(() => {});
  });

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === APP_ORIGIN) {
      await route.continue();
      return;
    }
    if (url.origin !== API_ORIGIN) {
      // External fonts/assets are irrelevant to the operational contract.
      await route.abort();
      return;
    }

    const path = url.pathname;
    const method = request.method();
    let body: unknown;

    if (method === 'GET' && path === '/mesas/') {
      body = [
        { id: 7, nome: 'Mesa 7', capacidade: 4, status: 'ocupada' },
        { id: 8, nome: 'Mesa 8', capacidade: 4, status: 'livre' },
      ];
    } else if (method === 'GET' && path === '/comandas/detalhes/todos') {
      body = scenario.withoutCheck ? [] : [check];
    } else if (method === 'GET' && path === `/comandas/${CHECK_ID}`) {
      body = check;
    } else if (method === 'GET' && path === '/atendimentos/mesas/7') {
      body = {
        familias: [{
          numero_conta: checkNumber,
          lancamentos: scenario.emptySession ? [] : [
            { lancamento_id: LAUNCH_A, pedido_id: displayNumbers[0], sequencia: sequences[0] },
            { lancamento_id: LAUNCH_B, pedido_id: displayNumbers[1], sequencia: sequences[1] },
          ],
        }],
      };
    } else if (method === 'GET' && path === '/produtos/catalogo') {
      body = {
        categorias: [{ id: 'waiter-meals', nome: 'Pratos', destino_impressao: 'COZINHA' }],
        produtos: items.map(item => ({ ...item.produto, categoria_id: 'waiter-meals' })),
      };
    } else if (method === 'GET' && path === '/caixa/configuracoes') {
      body = {
        taxa_servico_ativa: false,
        taxa_servico_padrao: 0,
        perm_garcom_status: true,
        perm_garcom_print: true,
        perm_garcom_fechar: false,
        perm_garcom_editar: true,
        perm_garcom_cancelar_item: true,
        perm_garcom_transferir_mesa: true,
        perm_garcom_transferir_item: true,
        perm_garcom_delivery: false,
      };
    } else if (method === 'GET' && path === '/caixa/pagamentos/pendentes') {
      body = [];
    } else if (method === 'POST' && [LAUNCH_A, LAUNCH_B].some(id => path === `/comandas/lancamentos/${id}/reimprimir`)) {
      writes.push({ method, path, status: null, tableId: url.searchParams.get('mesa_id') });
      body = { ok: true };
    } else if (method === 'PUT' && path === `/comandas/itens/${ITEM_B}/status` && url.searchParams.get('status') === 'entregue') {
      writes.push({ method, path, status: 'entregue', tableId: null });
      items[1].status = 'entregue';
      body = { ok: true };
    } else {
      unexpectedApiRequests.push(`${method} ${path}${url.search}`);
      await route.fulfill({
        status: 501,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'API request outside the waiter characterization fixture' }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/?view=garcom');
  await expect(page.locator('#mesa-card-7')).toBeVisible();
  if (!scenario.emptySession) await expect(page.locator('#mesa-card-7')).toContainText(/R\$\s*160/);
  return { check, writes, unexpectedApiRequests };
}

test('mapa do Garçom preserva mesa livre, ocupada e pronta nos filtros', async ({ page }) => {
  const state = await openWaiterScenario(page);
  const filters = page.getByRole('group', { name: 'Filtrar mesas por status' });

  await expect(page.locator('#mesa-card-8')).toContainText('Livre');
  await expect(page.locator('#mesa-card-7')).toContainText('12m');
  await filters.getByRole('button', { name: /^Ocupadas/ }).click();
  await expect(page.locator('#mesa-card-7')).toBeVisible();
  await expect(page.locator('#mesa-card-8')).toHaveCount(0);

  // Partial readiness does not remove a table from the occupied projection.
  await filters.getByRole('button', { name: /^Prontas/ }).click();
  await expect(page.locator('#mesa-card-7')).toBeVisible();
  await expect(page.locator('#mesa-card-8')).toHaveCount(0);

  await filters.getByRole('button', { name: /^Livres/ }).click();
  await expect(page.locator('#mesa-card-8')).toBeVisible();
  await expect(page.locator('#mesa-card-7')).toHaveCount(0);
  await page.locator('#mesa-card-8').click();
  await expect(page.getByRole('tab', { name: /Cardápio/ })).toHaveAttribute('aria-selected', 'true');
  await page.locator('#close-mesa-modal-btn').click();
  await expect(page.locator('#modal-outer-overlay')).toHaveCount(0);
  expect(state.writes).toEqual([]);
  expect(state.unexpectedApiRequests).toEqual([]);
});

test('modal mantém 24-A e 24-B na mesma Comanda e reimprime por lançamento técnico', async ({ page }) => {
  const state = await openWaiterScenario(page);
  await page.locator('#mesa-card-7').click();
  await expect(page.getByRole('tab', { name: /Consumo/ })).toHaveAttribute('aria-selected', 'true');

  const lots = page.locator('[id^="placed-order-"]');
  const firstLot = lots.filter({ hasText: 'Prato da primeira rodada' });
  const secondLot = lots.filter({ hasText: 'Prato da segunda rodada' });
  await expect(lots).toHaveCount(2);
  await expect(firstLot).toContainText('24-A');
  await expect(secondLot).toContainText('24-B');
  await expect(firstLot).not.toContainText('Prato da segunda rodada');
  await expect(secondLot).not.toContainText('Prato da primeira rodada');

  await firstLot.getByRole('button', { name: 'Reimprimir', exact: true }).click();
  await page.getByRole('button', { name: 'Imprimir Via Cozinha', exact: true }).click();
  await expect.poll(() => state.writes).toEqual([
    { method: 'POST', path: `/comandas/lancamentos/${LAUNCH_A}/reimprimir`, status: null, tableId: '7' },
  ]);
  await expect(page.getByRole('button', { name: 'Imprimir Via Cozinha', exact: true })).toHaveCount(0);

  await secondLot.getByRole('button', { name: 'Reimprimir', exact: true }).click();
  await page.getByRole('button', { name: 'Imprimir Via Cozinha', exact: true }).click();
  await expect.poll(() => state.writes).toEqual([
    { method: 'POST', path: `/comandas/lancamentos/${LAUNCH_A}/reimprimir`, status: null, tableId: '7' },
    { method: 'POST', path: `/comandas/lancamentos/${LAUNCH_B}/reimprimir`, status: null, tableId: '7' },
  ]);
  expect(state.check.id).toBe(CHECK_ID);
  expect(state.check.status_comanda).toBeNull();
  expect(state.unexpectedApiRequests).toEqual([]);
});

test('servir item usa ID técnico sem alterar o outro pedido ou fechar a conta', async ({ page }) => {
  const state = await openWaiterScenario(page);
  await page.locator('#mesa-card-7').click();
  const firstLot = page.locator('[id^="placed-order-"]').filter({ hasText: 'Prato da primeira rodada' });
  const secondLot = page.locator('[id^="placed-order-"]').filter({ hasText: 'Prato da segunda rodada' });
  await expect(secondLot).toContainText('24-B');
  await secondLot.getByRole('button', { name: 'Servir', exact: true }).click();

  await expect.poll(() => state.writes).toEqual([
    { method: 'PUT', path: `/comandas/itens/${ITEM_B}/status`, status: 'entregue', tableId: null },
  ]);
  await expect(secondLot).toContainText('Servido');
  await expect(secondLot.getByRole('button', { name: 'Servir', exact: true })).toHaveCount(0);
  await expect(firstLot).toContainText('Na Cozinha');
  expect(state.check.status_comanda).toBeNull();
  expect(state.check.fechada).toBe(false);
  expect(state.unexpectedApiRequests).toEqual([]);
});

test('todos os itens prontos continuam servíveis com a conta aberta', async ({ page }) => {
  const state = await openWaiterScenario(page, ['pronto', 'pronto']);
  const table = page.locator('#mesa-card-7');
  await expect(table).not.toContainText(/Aguardando pagamento|Confirmar pagamento|Pronta para pagar/i);
  await page.getByRole('group', { name: 'Filtrar mesas por status' }).getByRole('button', { name: /^Prontas/ }).click();
  await expect(table).toBeVisible();
  await table.click();
  await expect(page.locator('[id^="placed-order-"]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Servir', exact: true })).toHaveCount(2);
  expect(state.check.status_comanda).toBeNull();
  expect(state.check.fechada).toBe(false);
  expect(state.writes).toEqual([]);
  expect(state.unexpectedApiRequests).toEqual([]);
});

for (const scenario of [
  { checkNumber: 124, displayNumbers: ['124-A', '124-B'] as [string, string], sequences: [1, 2] as [number, number] },
  { checkNumber: 24, displayNumbers: ['24-Z', '24-AA'] as [string, string], sequences: [26, 27] as [number, number] },
]) {
  test(`identidades ${scenario.displayNumbers.join(' e ')} permanecem completas com ações técnicas isoladas`, async ({ page }) => {
    const state = await openWaiterScenario(page, ['preparando', 'pronto'], scenario);
    await page.locator('#mesa-card-7').click();
    const lots = page.locator('[id^="placed-order-"]');
    const firstLot = lots.filter({ hasText: 'Prato da primeira rodada' });
    const secondLot = lots.filter({ hasText: 'Prato da segunda rodada' });
    await expect(lots).toHaveCount(2);
    await expect(firstLot).toContainText(scenario.displayNumbers[0]);
    await expect(secondLot).toContainText(scenario.displayNumbers[1]);

    for (const [lot, displayNumber, launchId] of [
      [firstLot, scenario.displayNumbers[0], LAUNCH_A],
      [secondLot, scenario.displayNumbers[1], LAUNCH_B],
    ] as const) {
      await lot.getByRole('button', { name: 'Reimprimir', exact: true }).click();
      await expect(page.getByText(`LOTE: #${displayNumber}`, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Imprimir Via Cozinha', exact: true }).click();
      await expect.poll(() => state.writes.some(write => write.path === `/comandas/lancamentos/${launchId}/reimprimir`)).toBe(true);
      await expect(page.getByRole('button', { name: 'Imprimir Via Cozinha', exact: true })).toHaveCount(0);
    }

    await secondLot.getByRole('button', { name: 'Servir', exact: true }).click();
    await expect.poll(() => state.writes).toEqual([
      { method: 'POST', path: `/comandas/lancamentos/${LAUNCH_A}/reimprimir`, status: null, tableId: '7' },
      { method: 'POST', path: `/comandas/lancamentos/${LAUNCH_B}/reimprimir`, status: null, tableId: '7' },
      { method: 'PUT', path: `/comandas/itens/${ITEM_B}/status`, status: 'entregue', tableId: null },
    ]);
    await expect(firstLot).toContainText('Na Cozinha');
    await expect(secondLot).toContainText('Servido');
    expect(state.check.fechada).toBe(false);
    expect(state.unexpectedApiRequests).toEqual([]);
  });
}

for (const withoutCheck of [false, true]) {
  test(`mesa com sessão vazia permanece ocupada ${withoutCheck ? 'pelo status explícito' : 'antes do primeiro lançamento'}`, async ({ page }) => {
    const state = await openWaiterScenario(page, ['preparando', 'pronto'], { emptySession: true, withoutCheck });
    const filters = page.getByRole('group', { name: 'Filtrar mesas por status' });
    const occupiedTable = page.locator('#mesa-card-7');
    await expect(occupiedTable).not.toContainText('Livre');
    await filters.getByRole('button', { name: /^Ocupadas/ }).click();
    await expect(occupiedTable).toBeVisible();
    await expect(page.locator('#mesa-card-8')).toHaveCount(0);
    await occupiedTable.click();
    await expect(page.getByRole('heading', { name: 'Mesa 7', exact: true }).locator('..').getByText('Ocupada', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Cardápio/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[id^="placed-order-"]')).toHaveCount(0);
    expect(state.writes).toEqual([]);
    expect(state.unexpectedApiRequests).toEqual([]);
  });
}
