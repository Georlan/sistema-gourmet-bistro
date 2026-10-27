import { expect, Page, test, type WebSocketRoute } from '@playwright/test';

// Characterization of the existing waiter consumers before the shared
// projections are introduced. One financial check contains two real launches;
// the persisted family snapshot supplies their human identities.
const API_ORIGIN = 'http://127.0.0.1:8000';
const APP_ORIGIN = `http://127.0.0.1:${process.env.KOMA_E2E_PORT || 4173}`;
const NOW = new Date('2026-08-30T15:00:00.000Z');
const CHECK_ID = 'check-waiter-phase7-24';
const LAUNCH_A = 'launch-waiter-phase7-a';
const LAUNCH_B = 'launch-waiter-phase7-b';
const ITEM_A = 'item-waiter-phase7-a';
const ITEM_B = 'item-waiter-phase7-b';

type ItemStatus = 'preparando' | 'pronto' | 'entregue';
type Write = {
  method: string;
  path: string;
  status: string | null;
  tableId: string | null;
  sourceTableId?: string | null;
  valuesOnly?: string | null;
  payload?: unknown;
};
type WaiterScenario = {
  checkNumber?: number;
  displayNumbers?: [string, string];
  sequences?: [number, number];
  emptySession?: boolean;
  singleItem?: boolean;
  occupancyTargets?: boolean;
  withoutCheck?: boolean;
  withoutLaunchIdentity?: boolean;
  canCloseTable?: boolean;
  canCancelItems?: boolean;
  canTransferTables?: boolean;
  canTransferItems?: boolean;
  printingEntitled?: boolean;
  deferPrinting?: boolean;
  printFails?: boolean;
  deferCancel?: boolean;
  cancelFails?: boolean;
  deferBatchTransfer?: boolean;
  batchTransferFails?: boolean | number | 'network';
  deferEdit?: boolean;
  editFails?: boolean | number | 'network';
  identity?: { id: string; name: string };
  socketHandler?: (socket: WebSocketRoute) => void;
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
  const baseStatuses = scenario.emptySession ? [] : scenario.singleItem ? [statuses[0]] : statuses;
  const items = baseStatuses.map((status, index) => ({
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
  const checks = scenario.withoutCheck ? [] : [check];
  const tables = [
    { id: 7, nome: 'Mesa 7', capacidade: 4, status: 'ocupada' },
    { id: 8, nome: 'Mesa 8', capacidade: 4, status: 'livre' },
  ];
  if (scenario.occupancyTargets) {
    tables.push(
      { id: 9, nome: 'Varanda', capacidade: 4, status: 'ocupada' },
      { id: 10, nome: 'Mesa 10', capacidade: 4, status: 'livre' },
      { id: 11, nome: 'Mesa 11', capacidade: 4, status: 'aguardando_pagamento' },
    );
    checks.push({ ...check, id: 'empty-target-check', mesa_id: 10, itens: [], lancamentos: [] });
  }
  const writes: Write[] = [];
  const unexpectedApiRequests: string[] = [];
  let releasePrint: () => void = () => {};
  const printResponse = scenario.deferPrinting
    ? new Promise<void>(resolve => { releasePrint = resolve; })
    : Promise.resolve();
  let releaseCancel: () => void = () => {};
  const cancelResponse = scenario.deferCancel
    ? new Promise<void>(resolve => { releaseCancel = resolve; })
    : Promise.resolve();
  let releaseBatchTransfer: () => void = () => {};
  const batchTransferResponse = scenario.deferBatchTransfer
    ? new Promise<void>(resolve => { releaseBatchTransfer = resolve; })
    : Promise.resolve();
  let releaseEdit: () => void = () => {};
  const editResponse = scenario.deferEdit
    ? new Promise<void>(resolve => { releaseEdit = resolve; })
    : Promise.resolve();
  const mutableScenario = { ...scenario };

  await page.clock.setFixedTime(NOW);
  await page.addInitScript((identity) => {
    sessionStorage.setItem('koma_waiter_token', 'waiter-phase7-fixture-token');
    sessionStorage.setItem('koma_active_operational_portal', 'garcom');
    sessionStorage.setItem('koma_waiter_id', identity.id);
    sessionStorage.setItem('koma_waiter_name', identity.name);
    sessionStorage.setItem('koma_user_role', 'garcom');
  }, scenario.identity ?? { id: 'waiter-phase7', name: 'Garçom Fase 7' });

  // The operational socket is fully mocked, never connected to a backend.
  // Keeping it open also avoids timing-dependent fallback polling in this UI fixture.
  await page.routeWebSocket(/\/ws\//, socket => {
    if (scenario.socketHandler) scenario.socketHandler(socket);
    else socket.onMessage(() => {});
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
    let responseStatus = 200;
    let body: unknown;

    if (method === 'GET' && path === '/mesas/') {
      body = tables;
    } else if (method === 'GET' && path === '/comandas/detalhes/todos') {
      body = checks;
    } else if (method === 'GET' && path === `/comandas/${CHECK_ID}`) {
      body = check;
    } else if (method === 'GET' && path === '/atendimentos/mesas/7') {
      body = {
        familias: [{
          numero_conta: checkNumber,
          lancamentos: scenario.emptySession || scenario.withoutLaunchIdentity ? [] : (
            scenario.singleItem
              ? [{ lancamento_id: LAUNCH_A, pedido_id: displayNumbers[0], sequencia: sequences[0] }]
              : [
                  { lancamento_id: LAUNCH_A, pedido_id: displayNumbers[0], sequencia: sequences[0] },
                  { lancamento_id: LAUNCH_B, pedido_id: displayNumbers[1], sequencia: sequences[1] },
                ]
          ),
        }],
      };
    } else if (method === 'GET' && (path === '/produtos/catalogo' || path === '/produtos/categorias')) {
      body = path === '/produtos/categorias'
        ? [{ id: 'waiter-meals', nome: 'Pratos', destino_impressao: 'COZINHA' }]
        : {
            categorias: [{ id: 'waiter-meals', nome: 'Pratos', destino_impressao: 'COZINHA' }],
            produtos: items.map(item => ({ ...item.produto, categoria_id: 'waiter-meals' })),
          };
    } else if (method === 'GET' && path === '/caixa/configuracoes') {
      body = {
        restaurante_id: 99001,
        taxa_servico_ativa: false,
        taxa_servico_padrao: 0,
        entitlements: { printing: scenario.printingEntitled ?? true },
        perm_garcom_status: true,
        perm_garcom_print: true,
        perm_garcom_fechar: scenario.canCloseTable ?? false,
        perm_garcom_editar: true,
        perm_garcom_cancelar: scenario.canCancelItems ?? true,
        perm_garcom_cancelar_item: scenario.canCancelItems ?? true,
        perm_garcom_transferir_mesa: scenario.canTransferTables ?? true,
        perm_garcom_transferir_item: scenario.canTransferItems ?? true,
        perm_garcom_delivery: false,
      };
    } else if (method === 'GET' && path === '/caixa/pagamentos/pendentes') {
      body = [];
    } else if (method === 'POST' && [LAUNCH_A, LAUNCH_B].some(id => path === `/comandas/lancamentos/${id}/reimprimir`)) {
      writes.push({ method, path, status: null, tableId: url.searchParams.get('mesa_id') });
      await printResponse;
      responseStatus = scenario.printFails ? 503 : 200;
      body = scenario.printFails ? { detail: 'Impressora indisponível na fixture' } : { ok: true };
    } else if (method === 'POST' && path === '/mesas/7/imprimir-recibo') {
      writes.push({ method, path, status: null, tableId: '7', valuesOnly: url.searchParams.get('apenas_valores') });
      await printResponse;
      responseStatus = scenario.printFails ? 503 : 200;
      body = scenario.printFails ? { detail: 'Impressora indisponível na fixture' } : { ok: true };
    } else if (method === 'POST' && path === '/comandas/itens/transferir-lote/8') {
      const payload = request.postDataJSON() as { item_ids: string[] };
      writes.push({ method, path, status: null, tableId: '8', payload });
      await batchTransferResponse;
      if (mutableScenario.batchTransferFails === 'network') {
        await route.abort('failed');
        return;
      }
      if (mutableScenario.batchTransferFails) {
        responseStatus = typeof mutableScenario.batchTransferFails === 'number' ? mutableScenario.batchTransferFails : 409;
        body = { detail: 'Itens pagos não podem ser transferidos.' };
      } else {
        const movedItems = check.itens.filter(item => payload.item_ids.includes(item.id));
        check.itens = check.itens.filter(item => !payload.item_ids.includes(item.id));
        checks.push({ ...check, id: 'check-waiter-phase7-destination', mesa_id: 8, itens: movedItems });
        tables[1].status = 'ocupada';
        body = movedItems;
      }
    } else if (method === 'POST' && [ITEM_A, ITEM_B].some(id => path === `/comandas/itens/${id}/transferir/8`)) {
      writes.push({ method, path, status: null, tableId: '8' });
      body = { ok: true };
    } else if (method === 'POST' && path === `/comandas/${CHECK_ID}/transferir/8`) {
      writes.push({ method, path, status: null, tableId: '8' });
      check.mesa_id = 8;
      tables[0].status = 'livre';
      tables[1].status = 'ocupada';
      body = { ok: true };
    } else if (method === 'POST' && path === '/comandas/mesclar') {
      writes.push({ method, path, status: null, tableId: url.searchParams.get('mesa_destino_id'), sourceTableId: url.searchParams.get('mesa_origem_id') });
      check.mesa_id = 8;
      tables[0].status = 'livre';
      tables[1].status = 'ocupada';
      body = { ok: true };
    } else if (method === 'PUT' && [ITEM_A, ITEM_B].some(id => path === `/comandas/itens/${id}`)) {
      const targetId = path.includes(ITEM_A) ? ITEM_A : ITEM_B;
      const payload = request.postDataJSON() as { observacao?: string; cliente_nome?: string; quantidade_adicional?: number };
      writes.push({ method, path, status: null, tableId: null, payload });
      await editResponse;
      if (mutableScenario.editFails === 'network') {
        await route.abort('failed');
        return;
      }
      if (mutableScenario.editFails) {
        responseStatus = typeof mutableScenario.editFails === 'number' ? mutableScenario.editFails : 409;
        body = { detail: 'Não foi possível salvar a edição deste item.' };
      } else {
        const targetItem = check.itens.find(item => item.id === targetId);
        if (targetItem) {
          if (payload.observacao !== undefined) targetItem.observacao = payload.observacao;
          if (payload.cliente_nome !== undefined) targetItem.cliente_nome = payload.cliente_nome;
        }
        body = targetItem ?? { ok: true };
      }
    } else if (method === 'PUT' && path === `/comandas/itens/${ITEM_B}/status` && url.searchParams.get('status') === 'entregue') {
      writes.push({ method, path, status: 'entregue', tableId: null });
      items[1].status = 'entregue';
      body = { ok: true };
    } else if (method === 'PUT' && [ITEM_A, ITEM_B].some(id => path === `/comandas/itens/${id}/cancelar`)) {
      const targetId = path.includes(ITEM_A) ? ITEM_A : ITEM_B;
      writes.push({ method, path, status: 'cancelado', tableId: null });
      await cancelResponse;
      if (scenario.cancelFails) {
        responseStatus = 400;
        body = { detail: 'O garçom não pode cancelar o único item ativo restante da comanda.' };
      } else {
        check.itens = check.itens.filter(item => item.id !== targetId);
        body = { id: targetId, status: 'cancelado' };
      }
    } else {
      unexpectedApiRequests.push(`${method} ${path}${url.search}`);
      await route.fulfill({
        status: 501,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'API request outside the waiter characterization fixture' }),
      });
      return;
    }

    await route.fulfill({ status: responseStatus, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/?view=garcom');
  await expect(page.locator('#mesa-card-7')).toBeVisible();
  if (!scenario.emptySession) {
    await expect(page.locator('#mesa-card-7')).toContainText(scenario.singleItem ? /R\$\s*112/ : /R\$\s*160/);
  }
  return {
    check,
    writes,
    unexpectedApiRequests,
    releasePrint,
    releaseCancel,
    releaseBatchTransfer,
    releaseEdit,
    mutableScenario,
  };
}

test('mapa do Garçom preserva mesa livre, ocupada e pronta nos filtros', async ({ page }) => {
  const state = await openWaiterScenario(page);
  const filters = page.getByRole('group', { name: 'Filtrar mesas por status' });

  await expect(page.locator('#mesa-card-8')).toHaveAccessibleName(/Mesa 8: Livre/);
  await expect(page.locator('#mesa-card-8')).not.toContainText('Livre');
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

  await expect(page.getByRole('button', { name: 'Transferir', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mesclar', exact: true })).toHaveCount(0);
  await expect(page.locator('#tab-transferir-btn')).toBeVisible();
  await expect(page.locator('#tab-mesclar-btn')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reimpressão', exact: true })).toBeVisible();

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

test('consumo sem identidade humana não mostra sufixo técnico e valores usam reais brasileiros', async ({ page }) => {
  const state = await openWaiterScenario(page, ['preparando', 'pronto'], { withoutLaunchIdentity: true });
  await page.locator('#mesa-card-7').click();
  const lots = page.locator('[id^="placed-order-"]');
  await expect(lots).toHaveCount(2);
  await expect(lots.first()).toContainText('Pedido sem número');
  await expect(lots.last()).toContainText('Pedido sem número');
  await expect(lots.first()).toContainText('R$ 112,00');
  await expect(page.locator('.kw-consumption-total')).toContainText('R$ 160,00');
  await expect(lots.first()).not.toContainText(LAUNCH_A.slice(-4));
  expect(state.writes).toEqual([]);
  expect(state.unexpectedApiRequests).toEqual([]);
});

test('Pocket oculta toda impressão sem alterar o restante do App do Garçom', async ({ page }) => {
  const state = await openWaiterScenario(page, ['preparando', 'pronto'], { printingEntitled: false });
  await page.locator('#mesa-card-7').click();

  await expect(page.locator('#quick-print-values-btn')).toHaveCount(0);
  await expect(page.locator('#print-invoice-preview-btn')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reimprimir', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Imprimir Via Cozinha', exact: true })).toHaveCount(0);

  await expect(page.getByRole('tab', { name: /Cardápio/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Servir', exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
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
    await expect(occupiedTable).toHaveAccessibleName(/Mesa 7: Em atendimento/);
    await filters.getByRole('button', { name: /^Ocupadas/ }).click();
    await expect(occupiedTable).toBeVisible();
    await expect(page.locator('#mesa-card-8')).toHaveCount(0);
    await occupiedTable.click();
    // The modal intentionally omits the redundant occupied badge (f6c32ea).
    const tableHeading = page.getByRole('heading', { name: 'Mesa 7', exact: true });
    await expect(tableHeading).toBeVisible();
    await expect(tableHeading.locator('..').getByText('Livre', { exact: true })).toHaveCount(0);
    // Occupied card body opens consumption even before the first launch.
    await expect(page.getByRole('tab', { name: 'Consumo', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[id^="placed-order-"]')).toHaveCount(0);
    await page.locator('#close-mesa-modal-btn').click();
    await page.locator('#mesa-card-launch-7').click();
    await expect(page.getByRole('tab', { name: /Cardápio/ })).toHaveAttribute('aria-selected', 'true');
    expect(state.writes).toEqual([]);
    expect(state.unexpectedApiRequests).toEqual([]);
  });
}

test('transferência parcial conserva seleção entre abas e exige confirmação antes da transação', async ({ page }) => {
  const state = await openWaiterScenario(page);
  await page.locator('#mesa-card-7').click();
  await page.locator('#tab-transferir-btn').click();
  await page.getByRole('button', { name: 'Selecionar Itens', exact: true }).click();
  const target = page.locator('#transfer-target-mesa-8');
  await expect(target).toBeDisabled();
  const selectedItem = page.getByRole('checkbox', { name: /Prato da primeira rodada/ });
  await selectedItem.check();

  // Panel remounts must not discard selection owned by the modal.
  await page.locator('#tab-consumo-btn').click();
  await page.locator('#tab-transferir-btn').click();
  await page.getByRole('button', { name: 'Selecionar Itens', exact: true }).click();
  await expect(selectedItem).toBeChecked();
  await target.click();
  await expect(target).toContainText('Confirmar?');
  expect(state.writes).toEqual([]);

  await target.click();
  await expect.poll(() => state.writes).toEqual([
    { method: 'POST', path: '/comandas/itens/transferir-lote/8', status: null, tableId: '8', payload: { item_ids: [ITEM_A] } },
  ]);
  await expect(target).toBeDisabled();
  await page.locator('#tab-consumo-btn').click();
  await expect(page.locator('[id^="placed-order-"]')).toHaveCount(1);
  await expect(page.locator('[id^="placed-order-"]')).toContainText('Prato da segunda rodada');
  expect(state.check.itens.map(item => item.id)).toEqual([ITEM_B]);
  expect(state.check.fechada).toBe(false);
  expect(state.unexpectedApiRequests).toEqual([]);
});

for (const movement of ['transferir', 'mesclar'] as const) {
  test(`${movement} mesa inteira confirma uma vez e usa IDs técnicos de mesa ou Comanda`, async ({ page }) => {
    const state = await openWaiterScenario(page);
    await page.locator('#mesa-card-7').click();
    await page.locator(`#tab-${movement}-btn`).click();
    const target = page.locator(movement === 'transferir' ? '#transfer-target-mesa-8' : '#merge-target-mesa-free-8');
    await target.click();
    await expect(target).toContainText('Confirmar?');
    expect(state.writes).toEqual([]);
    await target.click();

    await expect.poll(() => state.writes).toEqual(movement === 'transferir' ? [
      { method: 'POST', path: `/comandas/${CHECK_ID}/transferir/8`, status: null, tableId: '8' },
    ] : [
      { method: 'POST', path: '/comandas/mesclar', status: null, tableId: '8', sourceTableId: '7' },
    ]);
    await expect(page.locator('#modal-outer-overlay')).toHaveCount(0);
    await expect(page.locator('#mesa-card-8')).toContainText(/R\$\s*160/);
    expect(state.check.id).toBe(CHECK_ID);
    expect(state.check.mesa_id).toBe(8);
    expect(state.check.fechada).toBe(false);
    expect(state.unexpectedApiRequests).toEqual([]);
  });
}

test('fechamento imprime direto, mantém estado entre abas e só confirma após resposta do servidor', async ({ page }) => {
  const state = await openWaiterScenario(page, ['preparando', 'pronto'], { deferPrinting: true });
  await page.locator('#mesa-card-7').click();
  const printButton = page.locator('#quick-print-values-btn');
  await expect(printButton).toContainText('Conta da Mesa');
  await expect(printButton).not.toHaveClass(/bg-emerald-500/);
  await printButton.click();
  await expect.poll(() => state.writes).toEqual([
    { method: 'POST', path: '/mesas/7/imprimir-recibo', status: null, tableId: '7', valuesOnly: 'true' },
  ]);
  await expect(printButton).toBeDisabled();
  await expect(page.getByText('Impressão enviada com sucesso.', { exact: true })).toHaveCount(0);
  await page.locator('#tab-transferir-btn').click();
  await page.locator('#tab-consumo-btn').click();
  await expect(printButton).toBeDisabled();

  state.releasePrint();
  await expect(page.getByText('Impressão enviada com sucesso.', { exact: true })).toBeVisible();
  await expect(printButton).toBeEnabled();
  expect(state.check.status_comanda).toBeNull();
  expect(state.check.fechada).toBe(false);
  expect(state.unexpectedApiRequests).toEqual([]);
});

test('extrato completo imprime direto sem abrir modal intermediário', async ({ page }) => {
  const state = await openWaiterScenario(page, ['preparando', 'pronto'], { deferPrinting: true });
  await page.locator('#mesa-card-7').click();
  const printButton = page.locator('#print-invoice-preview-btn');
  await printButton.click();
  await expect(page.getByText('Extrato de Mesa', { exact: true })).toHaveCount(0);
  await expect(page.locator('#finalize-physical-print-btn')).toHaveCount(0);
  await expect.poll(() => state.writes).toEqual([
    { method: 'POST', path: '/mesas/7/imprimir-recibo', status: null, tableId: '7', valuesOnly: 'false' },
  ]);
  await expect(printButton).toBeDisabled();
  await expect(page.getByText('Impressão enviada com sucesso.', { exact: true })).toHaveCount(0);
  state.releasePrint();
  await expect(page.getByText('Impressão enviada com sucesso.', { exact: true })).toBeVisible();
  await expect(printButton).toBeEnabled();
  await expect(page.getByText('Extrato de Mesa', { exact: true })).toHaveCount(0);
  await expect(page.locator('#modal-outer-overlay')).toBeVisible();
  expect(state.check.fechada).toBe(false);
  expect(state.unexpectedApiRequests).toEqual([]);
});

for (const printKind of ['direta', 'extrato', 'cozinha'] as const) {
  test(`falha de impressão ${printKind} não gera sucesso nem fecha o diálogo ou a conta`, async ({ page }) => {
    const state = await openWaiterScenario(page, ['preparando', 'pronto'], { deferPrinting: true, printFails: true });
    const alerts: string[] = [];
    page.on('dialog', async dialog => {
      alerts.push(dialog.message());
      await dialog.accept();
    });
    await page.locator('#mesa-card-7').click();
    if (printKind === 'cozinha') {
      await page.locator('[id^="placed-order-"]').filter({ hasText: 'Prato da segunda rodada' })
        .getByRole('button', { name: 'Reimprimir', exact: true }).click();
      await expect(page.getByText('LOTE: #24-B', { exact: true })).toBeVisible();
    }
    const printButton = printKind === 'direta' ? page.locator('#quick-print-values-btn')
      : printKind === 'extrato' ? page.locator('#print-invoice-preview-btn')
        : page.getByRole('button', { name: 'Imprimir Via Cozinha', exact: true });
    await printButton.click();
    if (printKind === 'extrato') {
      await expect(page.getByText('Extrato de Mesa', { exact: true })).toHaveCount(0);
    }
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0]).toEqual(printKind === 'cozinha'
      ? { method: 'POST', path: `/comandas/lancamentos/${LAUNCH_B}/reimprimir`, status: null, tableId: '7' }
      : { method: 'POST', path: '/mesas/7/imprimir-recibo', status: null, tableId: '7', valuesOnly: String(printKind === 'direta') });
    await expect(page.getByText(/enviada com sucesso/)).toHaveCount(0);
    state.releasePrint();
    await expect.poll(() => alerts).toEqual([printKind === 'direta' ? 'Erro ao enviar impressão de fechamento'
      : printKind === 'extrato' ? 'Erro ao enviar reimpressão da mesa'
        : 'Erro ao enviar reimpressão para a cozinha']);
    await expect(printButton).toBeVisible();
    await expect(printButton).toBeEnabled();
    await expect(page.getByText(/enviada com sucesso/)).toHaveCount(0);
    expect(state.check.fechada).toBe(false);
    expect(state.unexpectedApiRequests).toEqual([]);
  });
}

test('permissões ocultam fechamento e movimentação sem alterar ações de consumo', async ({ page }) => {
  const state = await openWaiterScenario(page, ['preparando', 'pronto'], {
    canCloseTable: false, canTransferTables: false, canTransferItems: false,
  });
  await page.locator('#mesa-card-7').click();
  await expect(page.locator('#close-table-btn-consumo')).toHaveCount(0);
  await expect(page.locator('#tab-transferir-btn')).toHaveCount(0);
  await expect(page.locator('#tab-mesclar-btn')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Transferir', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mesclar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Servir', exact: true })).toBeVisible();
  await expect(page.locator('#quick-print-values-btn')).toBeEnabled();
  expect(state.writes).toEqual([]);
  expect(state.unexpectedApiRequests).toEqual([]);
});

test('confirmação de fechamento permanece no owner ao alternar painéis sem fechar no primeiro clique', async ({ page }) => {
  const state = await openWaiterScenario(page, ['preparando', 'pronto'], { canCloseTable: true });
  await page.locator('#mesa-card-7').click();
  const closeButton = page.locator('#close-table-btn-consumo');
  await closeButton.click();
  await expect(closeButton).toContainText('Confirmar encerramento?');
  expect(state.writes).toEqual([]);
  await page.locator('#tab-transferir-btn').click();
  await page.locator('#tab-consumo-btn').click();
  await expect(closeButton).toContainText('Confirmar encerramento?');
  expect(state.check.fechada).toBe(false);
  expect(state.writes).toEqual([]);
  expect(state.unexpectedApiRequests).toEqual([]);
});


test('dois garçons recebem presença na mesma mesa sem bloquear ações, inclusive entrada tardia', async ({ page, context }) => {
  const sockets = new Map<string, WebSocketRoute>();
  const register = (id: string, name: string) => (socket: WebSocketRoute) => {
    sockets.set(id, socket);
    socket.onMessage(raw => {
      const data = JSON.parse(String(raw));
      if (data.action === 'draft_status') {
        for (const peer of sockets.values()) peer.send(JSON.stringify({ ...data, event: 'draft_status', garcom_id: id, garcom_nome: name }));
      }
    });
    for (const peer of sockets.values()) peer.send(JSON.stringify({ event: 'waiter_connected', garcom_id: id }));
  };
  const first = await openWaiterScenario(page, ['preparando', 'pronto'], {
    identity: { id: 'gloria', name: 'Glória' }, socketHandler: register('gloria', 'Glória'),
  });
  await page.locator('#mesa-card-7').getByRole('button').click();
  const secondPage = await context.newPage();
  const second = await openWaiterScenario(secondPage, ['preparando', 'pronto'], {
    identity: { id: 'georlan', name: 'Georlan' }, socketHandler: register('georlan', 'Georlan'),
  });
  await expect(secondPage.locator('#mesa-card-7')).toContainText('Glória também está nesta mesa');
  if (process.env.PRESENCE_SCREENSHOTS) await secondPage.screenshot({ path: `${process.env.PRESENCE_SCREENSHOTS}/mapa-${test.info().project.name}.png` });
  await secondPage.locator('#mesa-card-7').getByRole('button').click();
  await expect(secondPage.getByRole('status').filter({ hasText: 'Glória também' }).last()).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Georlan também' }).last()).toBeVisible();
  for (const current of [page, secondPage]) {
    await current.getByRole('tab', { name: /Pedido/ }).click();
    await expect(current.getByRole('button', { name: /Adicionar/ }).first()).toBeEnabled();
    const notice = current.getByRole('status').filter({ hasText: 'combinem os lançamentos' });
    const tabs = current.getByRole('tablist', { name: 'Ações da mesa' });
    const [noticeBox, tabsBox] = await Promise.all([notice.boundingBox(), tabs.boundingBox()]);
    expect(noticeBox!.y + noticeBox!.height).toBeLessThanOrEqual(tabsBox!.y);
    expect(await current.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  if (process.env.PRESENCE_SCREENSHOTS) await secondPage.screenshot({ path: `${process.env.PRESENCE_SCREENSHOTS}/mesa-${test.info().project.name}.png` });
  // A missed departure must not survive reconnect; live peers replay their presence.
  const oldSocket = sockets.get('georlan')!;
  oldSocket.send(JSON.stringify({ event: 'draft_status', mesa_id: 7, garcom_id: 'departed', garcom_nome: 'Já saiu', ativo: true }));
  await expect(secondPage.getByRole('status').filter({ hasText: 'Já saiu' }).last()).toBeVisible();
  oldSocket.close({ code: 1012, reason: 'simulated reconnect' });
  await expect.poll(() => sockets.get('georlan') !== oldSocket).toBe(true);
  await expect(secondPage.getByRole('status').filter({ hasText: 'Já saiu' })).toHaveCount(0);
  await expect(secondPage.getByRole('status').filter({ hasText: 'Glória também' }).last()).toBeVisible();
  await expect(secondPage.getByRole('button', { name: /Adicionar/ }).first()).toBeEnabled();
  // Closing an empty draft releases presence in the other session immediately.
  await secondPage.getByRole('button', { name: /Fechar/i }).first().click();
  await expect(page.getByRole('status').filter({ hasText: 'Georlan também' })).toHaveCount(0);
  expect(first.unexpectedApiRequests).toEqual([]);
  expect(second.unexpectedApiRequests).toEqual([]);
  expect(first.writes).toEqual([]);
  expect(second.writes).toEqual([]);
});

for (const movement of ['total', 'parcial', 'mesclar'] as const) {
  test(`destinos de ${movement} indicam ocupação inclusive atendimento sem itens`, async ({ page }) => {
    const state = await openWaiterScenario(page, ['preparando', 'pronto'], { occupancyTargets: true });
    await page.locator('#mesa-card-7').click();
    await page.locator(`#tab-${movement === 'mesclar' ? 'mesclar' : 'transferir'}-btn`).click();
    if (movement === 'parcial') {
      await page.getByRole('button', { name: 'Selecionar Itens', exact: true }).click();
      await expect(page.locator('#transfer-target-mesa-9')).toContainText('Ocupada');
      await expect(page.locator('#transfer-target-mesa-9')).toBeDisabled();
      await page.getByRole('checkbox').first().check();
    }
    const free = page.locator(movement === 'mesclar' ? '#merge-target-mesa-free-8' : '#transfer-target-mesa-8');
    await expect(free).toContainText('Livre');
    for (const id of [9, 10, 11]) {
      const target = page.locator(movement === 'mesclar' ? `#merge-target-mesa-${id}` : `#transfer-target-mesa-${id}`);
      await expect(target).toContainText('Ocupada');
      await expect(target).toBeEnabled();
    }
    const occupied = page.locator(movement === 'mesclar' ? '#merge-target-mesa-9' : '#transfer-target-mesa-9');
    await occupied.click();
    await expect(occupied).toContainText('Confirmar?');
    await expect(occupied).toContainText('Ocupada');
    expect(state.writes).toEqual([]);
    expect(state.unexpectedApiRequests).toEqual([]);
  });
}


test('conta e reimpressão permanecem numa barra fora da rolagem do consumo', async ({ page }) => {
  await openWaiterScenario(page);
  await page.locator('#mesa-card-7').click();
  const rail = page.getByRole('toolbar', { name: 'Ações da mesa' });
  await expect(rail.locator('#quick-print-values-btn')).toBeVisible();
  await expect(rail.locator('#print-invoice-preview-btn')).toBeVisible();
  await expect(page.locator('.kw-flow-body #quick-print-values-btn')).toHaveCount(0);
  await page.locator('.kw-flow-overlay').evaluate(async node => {
    await Promise.all(node.getAnimations({ subtree: true }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
  const before = await rail.boundingBox();
  await page.locator('.kw-flow-body').evaluate(node => { node.scrollTop = node.scrollHeight; });
  const after = await rail.boundingBox();
  expect(after!.y).toBeCloseTo(before!.y, 1);
  const modal = await page.locator('.kw-flow').boundingBox();
  expect(after!.y + after!.height).toBeLessThanOrEqual(modal!.y + modal!.height + 1);
  expect(after!.y + after!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  await expect(rail.locator('#quick-print-values-btn')).toBeInViewport();
});


test('111-A e 111-B reimprimem só seu lançamento; barra inferior imprime a mesa completa', async ({ page }) => {
  const state = await openWaiterScenario(page, ['preparando', 'pronto'], { checkNumber: 111, displayNumbers: ['111-A', '111-B'] });
  await page.locator('#mesa-card-7').click();
  for (const [number, id] of [['111-A', LAUNCH_A], ['111-B', LAUNCH_B]]) {
    await page.locator('[id^="placed-order-"]').filter({ hasText: `Pedido ${number}` }).getByRole('button', { name: 'Reimprimir', exact: true }).click();
    await page.getByRole('button', { name: 'Imprimir Via Cozinha', exact: true }).click();
    await expect.poll(() => state.writes.at(-1)?.path).toBe(`/comandas/lancamentos/${id}/reimprimir`);
  }
  await page.getByRole('toolbar', { name: 'Ações da mesa' }).getByRole('button', { name: 'Reimpressão', exact: true }).click();
  await expect.poll(() => state.writes).toEqual([
    { method: 'POST', path: `/comandas/lancamentos/${LAUNCH_A}/reimprimir`, status: null, tableId: '7' },
    { method: 'POST', path: `/comandas/lancamentos/${LAUNCH_B}/reimprimir`, status: null, tableId: '7' },
    { method: 'POST', path: '/mesas/7/imprimir-recibo', status: null, tableId: '7', valuesOnly: 'false' },
  ]);
  expect(state.check.fechada).toBe(false);
});

test('incidente D8 Burger: único item ativo da comanda exibe lixeira desabilitada com orientação ao Caixa sem requisição fadada a 400', async ({ page }) => {
  const state = await openWaiterScenario(page, ['preparando', 'pronto'], {
    singleItem: true,
    checkNumber: 122,
    displayNumbers: ['122-A', '122-B'],
  });
  await page.locator('#mesa-card-7').click();
  const cancelBtn = page.locator(`#cancel-item-btn-${ITEM_A}`);
  await expect(cancelBtn).toBeVisible();
  await expect(cancelBtn).toBeDisabled();
  await expect(cancelBtn).toHaveAttribute(
    'title',
    /Último item ativo da comanda — solicite o cancelamento do pedido ou liberação da mesa no Caixa/,
  );
  await expect(page.locator(`#cancel-restriction-note-${ITEM_A}`)).toContainText(
    'Último item ativo da comanda: solicite o cancelamento do pedido no Caixa.',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(state.writes).toEqual([]);
  expect(state.unexpectedApiRequests).toEqual([]);
});

test('cancelamento de 1 entre vários itens aguarda confirmação do backend antes de remover o item e protege o último item restante', async ({ page }) => {
  const state = await openWaiterScenario(page, ['preparando', 'pronto'], { deferCancel: true });
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#mesa-card-7').click();

  const cancelBtnA = page.locator(`#cancel-item-btn-${ITEM_A}`);
  const cancelBtnB = page.locator(`#cancel-item-btn-${ITEM_B}`);
  await expect(cancelBtnA).toBeEnabled();
  await expect(cancelBtnB).toBeEnabled();
  await expect(page.locator(`#cancel-restriction-note-${ITEM_B}`)).toHaveCount(0);

  await cancelBtnA.click();
  await expect.poll(() => state.writes).toEqual([
    { method: 'PUT', path: `/comandas/itens/${ITEM_A}/cancelar`, status: 'cancelado', tableId: null },
  ]);

  // Enquanto o backend não responde, o item não desaparece prematuramente nem exibe sucesso falso.
  await expect(page.getByText('Prato da primeira rodada', { exact: true })).toBeVisible();
  await expect(page.getByTestId('operational-toast-success')).toHaveCount(0);

  state.releaseCancel();
  await expect(page.getByTestId('operational-toast-success')).toContainText('Item cancelado.');
  await expect(page.getByText('Prato da primeira rodada', { exact: true })).toHaveCount(0);

  // O item B agora passou a ser o único item ativo restante da comanda e sua lixeira fica bloqueada com aviso visível no mobile.
  await expect(cancelBtnB).toBeDisabled();
  await expect(page.locator(`#cancel-restriction-note-${ITEM_B}`)).toContainText(
    'Último item ativo da comanda: solicite o cancelamento do pedido no Caixa.',
  );
  expect(state.unexpectedApiRequests).toEqual([]);
});

test('erro do backend no cancelamento preserva o item visível e exibe toast de erro no App do Garçom', async ({ page }) => {
  const state = await openWaiterScenario(page, ['preparando', 'pronto'], { cancelFails: true });
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#mesa-card-7').click();

  await page.locator(`#cancel-item-btn-${ITEM_A}`).click();
  await expect.poll(() => state.writes).toEqual([
    { method: 'PUT', path: `/comandas/itens/${ITEM_A}/cancelar`, status: 'cancelado', tableId: null },
  ]);
  await expect(page.getByTestId('operational-toast-error')).toContainText(
    'O garçom não pode cancelar o único item ativo restante da comanda.',
  );
  await expect(page.getByText('Prato da primeira rodada', { exact: true })).toBeVisible();
  expect(state.unexpectedApiRequests).toEqual([]);
});

test('modal de edição de item permanece aberto e preserva valores digitados em falhas HTTP/rede, fechando apenas após sucesso', async ({ page }) => {
  const state = await openWaiterScenario(page, ['preparando', 'pronto'], {
    deferEdit: true,
    editFails: 409,
  });
  await page.locator('#mesa-card-7').click();

  const firstLot = page.locator('[id^="placed-order-"]').filter({ hasText: 'Prato da primeira rodada' });
  await firstLot.getByTitle('Editar observação do item').click();

  const editOverlay = page.locator('#edit-item-modal-overlay');
  const obsInput = page.locator('#edit-item-observacao-input');
  const clientInput = page.locator('#edit-item-cliente-input');
  const confirmBtn = page.locator('#confirm-edit-item-btn');

  await expect(editOverlay).toBeVisible();
  await expect(obsInput).toBeEnabled();
  await obsInput.fill('Sem cebola, ponto médio');
  await clientInput.fill('Georlan');

  await confirmBtn.click();
  await expect(confirmBtn).toContainText('Salvando...');
  await expect(confirmBtn).toBeDisabled();
  await expect.poll(() => state.writes).toEqual([
    {
      method: 'PUT',
      path: `/comandas/itens/${ITEM_A}`,
      status: null,
      tableId: null,
      payload: {
        cliente_nome: 'Georlan',
        observacao: 'Sem cebola, ponto médio',
        quantidade_adicional: 1,
      },
    },
  ]);

  // Libera resposta com erro HTTP 409: modal NÃO deve fechar e valores digitados devem permanecer
  state.releaseEdit();
  await expect(page.getByTestId('operational-toast-error')).toContainText(
    'Não foi possível salvar a edição deste item.',
  );
  await expect(editOverlay).toBeVisible();
  await expect(obsInput).toHaveValue('Sem cebola, ponto médio');
  await expect(clientInput).toHaveValue('Georlan');
  await expect(confirmBtn).toBeEnabled();
  await expect(confirmBtn).toContainText('Confirmar Alterações');

  // Nova tentativa com falha de rede: modal continua aberto e valores intactos
  state.mutableScenario.editFails = 'network';
  await confirmBtn.click();
  await expect.poll(() => state.writes.length).toBe(2);
  await expect(page.getByTestId('operational-toast-error').last()).toContainText(
    'Erro de conexão ao atualizar item.',
  );
  await expect(editOverlay).toBeVisible();
  await expect(obsInput).toHaveValue('Sem cebola, ponto médio');
  await expect(clientInput).toHaveValue('Georlan');

  // Nova tentativa com sucesso (200 OK): modal fecha e item exibe os dados confirmados pelo servidor
  state.mutableScenario.editFails = false;
  await confirmBtn.click();
  await expect.poll(() => state.writes.length).toBe(3);
  await expect(editOverlay).toHaveCount(0);
  await expect(page.getByTestId('operational-toast-success')).toContainText('Item atualizado.');
  await expect(firstLot).toContainText('Sem cebola, ponto médio');
  await expect(firstLot).toContainText('Georlan');
  expect(state.unexpectedApiRequests).toEqual([]);
});

test('transferência parcial executa comando único em lote, preserva seleção durante envio e falha, e só limpa após confirmação do servidor', async ({ page }) => {
  const state = await openWaiterScenario(page, ['preparando', 'pronto'], {
    deferBatchTransfer: true,
    batchTransferFails: 409,
  });
  await page.locator('#mesa-card-7').click();
  await page.locator('#tab-transferir-btn').click();
  await page.getByRole('button', { name: 'Selecionar Itens', exact: true }).click();

  const itemACheckbox = page.getByRole('checkbox', { name: /Prato da primeira rodada/ });
  const itemBCheckbox = page.getByRole('checkbox', { name: /Prato da segunda rodada/ });
  await itemACheckbox.check();
  await itemBCheckbox.check();

  const target = page.locator('#transfer-target-mesa-8');
  await target.click();
  await expect(target).toContainText('Confirmar?');

  // Confirma envio: seleção é mantida enquanto aguarda resposta e o botão indica processamento
  await target.click();
  await expect(target).toContainText('Transferindo...');
  await expect(target).toBeDisabled();
  await expect(itemACheckbox).toBeChecked();
  await expect(itemBCheckbox).toBeChecked();
  await expect.poll(() => state.writes).toEqual([
    {
      method: 'POST',
      path: '/comandas/itens/transferir-lote/8',
      status: null,
      tableId: '8',
      payload: { item_ids: [ITEM_A, ITEM_B] },
    },
  ]);

  // Libera resposta com erro HTTP 409: seleção de ambos os itens é preservada para permitir nova tentativa segura
  state.releaseBatchTransfer();
  await expect(page.getByTestId('operational-toast-error')).toContainText(
    'Itens pagos não podem ser transferidos.',
  );
  await expect(itemACheckbox).toBeChecked();
  await expect(itemBCheckbox).toBeChecked();
  await expect(target).toBeEnabled();

  // Desmarca o item B e reenvia apenas o item A com sucesso (200 OK)
  await itemBCheckbox.uncheck();
  state.mutableScenario.batchTransferFails = false;
  await target.click();
  await expect(target).toContainText('Confirmar?');
  await target.click();

  await expect.poll(() => state.writes.length).toBe(2);
  expect(state.writes[1]).toEqual({
    method: 'POST',
    path: '/comandas/itens/transferir-lote/8',
    status: null,
    tableId: '8',
    payload: { item_ids: [ITEM_A] },
  });
  await expect(page.getByTestId('operational-toast-success')).toContainText(
    '1 item transferido para a Mesa 8.',
  );
  await expect(target).toBeDisabled();
  expect(state.check.itens.map(it => it.id)).toEqual([ITEM_B]);
  expect(state.unexpectedApiRequests).toEqual([]);
});


