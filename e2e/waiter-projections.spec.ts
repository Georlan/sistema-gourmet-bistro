import { expect, Page, test } from '@playwright/test';

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
  payload?: { item_ids: string[] };
};
type WaiterScenario = {
  checkNumber?: number;
  displayNumbers?: [string, string];
  sequences?: [number, number];
  emptySession?: boolean;
  withoutCheck?: boolean;
  canCloseTable?: boolean;
  canTransferTables?: boolean;
  canTransferItems?: boolean;
  deferPrinting?: boolean;
  printFails?: boolean;
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
  const checks = scenario.withoutCheck ? [] : [check];
  const tables = [
    { id: 7, nome: 'Mesa 7', capacidade: 4, status: 'ocupada' },
    { id: 8, nome: 'Mesa 8', capacidade: 4, status: 'livre' },
  ];
  const writes: Write[] = [];
  const unexpectedApiRequests: string[] = [];
  let releasePrint: () => void = () => {};
  const printResponse = scenario.deferPrinting
    ? new Promise<void>(resolve => { releasePrint = resolve; })
    : Promise.resolve();

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
        perm_garcom_fechar: scenario.canCloseTable ?? false,
        perm_garcom_editar: true,
        perm_garcom_cancelar_item: true,
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
      const movedItems = check.itens.filter(item => payload.item_ids.includes(item.id));
      check.itens = check.itens.filter(item => !payload.item_ids.includes(item.id));
      checks.push({ ...check, id: 'check-waiter-phase7-destination', mesa_id: 8, itens: movedItems });
      tables[1].status = 'ocupada';
      body = { ok: true };
    } else if (method === 'POST' && [ITEM_A, ITEM_B].some(id => path === `/comandas/itens/${id}/transferir/8`)) {
      // The adapter invokes these legacy idempotent callbacks only after the batch succeeds.
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

    await route.fulfill({ status: responseStatus, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/?view=garcom');
  await expect(page.locator('#mesa-card-7')).toBeVisible();
  if (!scenario.emptySession) await expect(page.locator('#mesa-card-7')).toContainText(/R\$\s*160/);
  return { check, writes, unexpectedApiRequests, releasePrint };
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
    { method: 'POST', path: `/comandas/itens/${ITEM_A}/transferir/8`, status: null, tableId: '8' },
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

test('impressão direta mantém estado entre abas e só confirma após resposta do servidor', async ({ page }) => {
  const state = await openWaiterScenario(page, ['preparando', 'pronto'], { deferPrinting: true });
  await page.locator('#mesa-card-7').click();
  const printButton = page.locator('#quick-print-values-btn');
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

test('extrato completo preserva prévia, mesa e confirmação de impressão do servidor', async ({ page }) => {
  const state = await openWaiterScenario(page, ['preparando', 'pronto'], { deferPrinting: true });
  await page.locator('#mesa-card-7').click();
  await page.locator('#print-invoice-preview-btn').click();
  const printButton = page.locator('#finalize-physical-print-btn');
  await expect(page.getByText('Extrato de Mesa', { exact: true })).toBeVisible();
  await printButton.click();
  await expect.poll(() => state.writes).toEqual([
    { method: 'POST', path: '/mesas/7/imprimir-recibo', status: null, tableId: '7', valuesOnly: 'false' },
  ]);
  await expect(page.getByText('Impressão enviada com sucesso.', { exact: true })).toHaveCount(0);
  state.releasePrint();
  await expect(page.getByText('Impressão enviada com sucesso.', { exact: true })).toBeVisible();
  await expect(printButton).toHaveCount(0);
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
    if (printKind === 'extrato') await page.locator('#print-invoice-preview-btn').click();
    if (printKind === 'cozinha') {
      await page.locator('[id^="placed-order-"]').filter({ hasText: 'Prato da segunda rodada' })
        .getByRole('button', { name: 'Reimprimir', exact: true }).click();
      await expect(page.getByText('LOTE: #24-B', { exact: true })).toBeVisible();
    }
    const printButton = printKind === 'direta' ? page.locator('#quick-print-values-btn')
      : printKind === 'extrato' ? page.locator('#finalize-physical-print-btn')
        : page.getByRole('button', { name: 'Imprimir Via Cozinha', exact: true });
    await printButton.click();
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0]).toEqual(printKind === 'cozinha'
      ? { method: 'POST', path: `/comandas/lancamentos/${LAUNCH_B}/reimprimir`, status: null, tableId: '7' }
      : { method: 'POST', path: '/mesas/7/imprimir-recibo', status: null, tableId: '7', valuesOnly: String(printKind === 'direta') });
    await expect(page.getByText(/enviada com sucesso/)).toHaveCount(0);
    state.releasePrint();
    await expect.poll(() => alerts).toEqual([printKind === 'direta' ? 'Erro ao enviar impressão de fechamento'
      : printKind === 'extrato' ? 'Erro ao enviar impressão do recibo completo'
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
  await expect(closeButton).toContainText('Confirmar Fechamento?');
  expect(state.writes).toEqual([]);
  await page.locator('#tab-transferir-btn').click();
  await page.locator('#tab-consumo-btn').click();
  await expect(closeButton).toContainText('Confirmar Fechamento?');
  expect(state.check.fechada).toBe(false);
  expect(state.writes).toEqual([]);
  expect(state.unexpectedApiRequests).toEqual([]);
});
