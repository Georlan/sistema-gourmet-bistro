import assert from 'node:assert/strict';
import test from 'node:test';
import type { Order, OrderItem, Table } from '../src/types';
import { deriveFinancialState, deriveProductionState } from '../src/domain/operationalState';
import {
  formatCashierOldestAge,
  getCashierHumanOrderNumber,
  getCashierOrderSlaData,
  getCashierTableOrderPresentation,
  isCashierTableOrder,
  projectCashierDeliveryState,
  projectCashierTableSlices,
} from '../src/domain/cashierOrderProjection';
import { projectCashierSalonTables } from '../src/domain/cashierSalonProjection';

const NOW = Date.UTC(2026, 7, 30, 15, 30);
const TABLE: Table = { id: 7, capacidade: 4, nome: 'Varanda' };
const item = (id: string, status: OrderItem['status'], preco: number, extra: Partial<OrderItem> = {}): OrderItem => ({
  id, produtoId: `product-${id}`, nome: `Item ${id}`, preco,
  observacao: '', clienteNome: 'Consumo Geral', status, pago: false,
  lancamentoId: 'launch-24-a', ...extra,
});
const check = (itens: OrderItem[], extra: Partial<Order> = {}): Order => ({
  id: 'check-24', numeroPedido: 24, mesaId: 7, garcomId: 'waiter',
  garcomNome: 'Garçom', timestamp: NOW - 60_000, tipo: 'Consumo no Local',
  statusComanda: null, valorPago: 0, itens, ...extra,
});
const total = (order: Order) => order.itens.reduce((sum, entry) => sum + entry.preco, 0);
const slices = (orders: Order[]) => projectCashierTableSlices(orders, [TABLE], NOW);

test('fatias conservam R$112 em preparo + R$48 pronto sem inferir pedido de conta', () => {
  const order = check([
    item('a1', 'preparando', 64), item('a2', 'preparando', 48),
    item('b1', 'pronto', 48, { lancamentoId: 'launch-24-b' }),
  ]);
  const result = slices([order]);
  assert.deepEqual(result.tableOrdersInProduction.map(total), [112]);
  assert.deepEqual(result.tableOrdersReady.map(total), [48]);
  assert.equal(result.tableOrdersReady[0].contaPedida, false);
  assert.equal(result.tableOrdersReady[0].itensEmPreparoCount, 2);
  assert.equal(deriveFinancialState([order]), 'OPEN');
  assert.equal(result.tableOrdersInProduction[0].id, 'launch-24-a');
  assert.equal(result.tableOrdersInProduction[0].comandaId, 'check-24');
  assert.equal(result.tableOrdersInProduction[0].projectionScope, 'launch');
  assert.equal(result.tableOrdersReady[0].projectionScope, 'table');
});

test('conta pedida desloca R$160 integral sem apagar o preparo nem alterar items', () => {
  const order = check([item('a', 'preparando', 112), item('b', 'pronto', 48)], {
    statusComanda: 'aguardando_pagamento',
  });
  const result = slices([order]);
  assert.equal(result.tableOrdersInProduction.length, 0);
  assert.equal(total(result.tableOrdersReady[0]), 160);
  assert.equal(result.tableOrdersReady[0].contaPedida, true);
  assert.deepEqual(result.tableOrdersReady[0].itens.map(entry => entry.status), ['preparando', 'pronto']);
  assert.equal(deriveProductionState(result.tableOrdersReady[0].itens).preparingItemCount, 1);
  assert.equal(result.tableOrdersReady[0].itensEmPreparoCount, 1);
  assert.equal(deriveFinancialState([order]), 'AWAITING_PAYMENT');
});

test('todos prontos ainda OPEN; entregues sem conta pedida não criam fatia de fechamento', () => {
  const ready = check([item('a', 'pronto', 48), item('b', 'pronto', 112)]);
  const readyResult = slices([ready]);
  assert.equal(readyResult.tableOrdersInProduction.length, 0);
  assert.equal(total(readyResult.tableOrdersReady[0]), 160);
  assert.equal(readyResult.tableOrdersReady[0].contaPedida, false);
  const served = check([item('served', 'entregue', 160)]);
  assert.deepEqual(slices([served]), { tableOrdersInProduction: [], tableOrdersReady: [] });
  assert.equal(deriveFinancialState([served]), 'OPEN');
});

test('preparando pago permanece em produção; pago/cancelado não entra no fechamento', () => {
  const order = check([
    item('paid-preparing', 'preparando', 112, { pago: true }),
    item('unpaid-ready', 'pronto', 48),
    item('paid-ready', 'pronto', 200, { pago: true }),
    item('cancelled', 'cancelado', 300),
  ], { valorPago: 112 });
  const result = slices([order]);
  assert.deepEqual(result.tableOrdersInProduction[0].itens.map(entry => entry.id), ['paid-preparing']);
  assert.equal(total(result.tableOrdersInProduction[0]), 112);
  assert.equal(total(result.tableOrdersReady[0]), 48);
  assert.equal(result.tableOrdersReady[0].itensEmPreparoCount, 0);
  assert.equal(deriveFinancialState([order]), 'OPEN');
  const requested = slices([{ ...order, statusComanda: 'aguardando_pagamento' }]);
  assert.equal(total(requested.tableOrdersReady[0]), 48);
  assert.deepEqual(slices([check([item('cancelled', 'cancelado', 300)])]), {
    tableOrdersInProduction: [], tableOrdersReady: [],
  });
});

test('duas comandas e múltiplos lançamentos preservam IDs técnicos e agregado da mesa', () => {
  const result = slices([
    check([
      item('a', 'preparando', 64),
      item('b', 'preparando', 48, { lancamentoId: 'launch-24-b' }),
      item('ready-24', 'pronto', 20),
    ]),
    check([item('ready-25', 'pronto', 28)], {
      id: 'check-25', numeroPedido: 25, timestamp: NOW - 90 * 60_000,
    }),
  ]);
  assert.deepEqual(result.tableOrdersInProduction.map(order => order.id), ['launch-24-a', 'launch-24-b']);
  assert.deepEqual(result.tableOrdersInProduction.map(order => order.numeroPedido), [24, 24]);
  const closing = result.tableOrdersReady[0];
  assert.equal(result.tableOrdersReady.length, 1);
  assert.equal(closing.id, 'check-24');
  assert.deepEqual(closing.comandaIds, ['check-24', 'check-25']);
  assert.deepEqual(closing.numeroPedidos, [24, 25]);
  assert.deepEqual(closing.itens.map(entry => entry.comandaId), ['check-24', 'check-25']);
  assert.equal(closing.aberta_em, NOW - 90 * 60_000);
  assert.equal(total(closing), 48);
});

test('legado usa check.id sem fabricar lançamento/identidade e aceita alias items', () => {
  const legacy = check([item('legacy', 'preparando', 48, { lancamentoId: undefined })]);
  const result = slices([legacy]);
  assert.equal(result.tableOrdersInProduction[0].id, legacy.id);
  assert.equal(result.tableOrdersInProduction[0].lancamentoId, undefined);
  assert.equal(result.tableOrdersInProduction[0].displayNumber, undefined);
  const alias = { ...legacy, itens: undefined, items: legacy.itens } as unknown as Order;
  assert.deepEqual(slices([alias]), result);
  assert.deepEqual(slices([check([])]), { tableOrdersInProduction: [], tableOrdersReady: [] });
});

test('displayNumber só acompanha lançamento comprovado; agregado não assume primeiro pedido', () => {
  const order = check([
    item('a', 'preparando', 64),
    item('b', 'preparando', 48, { lancamentoId: 'launch-24-b' }),
    item('ready', 'pronto', 48),
  ], { lancamentoId: 'launch-24-a', displayNumber: '24-A' });
  const result = slices([order]);
  assert.deepEqual(result.tableOrdersInProduction.map(entry => entry.displayNumber), ['24-A', undefined]);
  assert.equal(getCashierHumanOrderNumber(result.tableOrdersInProduction[0]), '24-A');
  assert.match(getCashierTableOrderPresentation(result.tableOrdersInProduction[0], [TABLE]).subtitle, /Pedido 24-A/);
  assert.equal(result.tableOrdersReady[0].displayNumber, undefined);
  assert.equal(getCashierHumanOrderNumber({ ...result.tableOrdersReady[0], displayNumber: '24-A' }), '24');
  // Adding lancamentoId here would change the existing modal reprint route.
  assert.equal(result.tableOrdersInProduction[0].lancamentoId, undefined);
  assert.equal(getCashierHumanOrderNumber({ id: 'temp-order', displayNumber: '24-A' }), '…');
});

test('fatias mantêm precondição snapshot ativo; filtro terminal pertence ao Salão', () => {
  for (const status of ['fechada', 'fechado', 'cancelada', 'cancelado', 'finalizada', 'finalizado']) {
    const order = check([item('a', 'preparando', 48)], { status });
    assert.equal(slices([order]).tableOrdersInProduction.length, 1);
    const salon = projectCashierSalonTables([TABLE], [order], [], NOW)[0];
    assert.equal(salon.tableOrders.length, 0);
    assert.equal(salon.isOccupied, false);
  }
});

test('Salão conserva livre/ocupada/mesclada e consumo próprio, separado do financeiro', () => {
  assert.equal(projectCashierSalonTables([TABLE], [], [], NOW)[0].isOccupied, false);
  assert.equal(projectCashierSalonTables([TABLE], [check([])], [], NOW)[0].isOccupied, true);
  const ready = check([item('ready', 'pronto', 48), item('paid', 'entregue', 112, { pago: true })]);
  const salon = projectCashierSalonTables([TABLE], [ready], [], NOW)[0];
  assert.equal(salon.total, 160);
  assert.equal(salon.hasPendingPayment, false);
  assert.equal(salon.operational.production.hasReadyItems, true);
  assert.equal(salon.operational.financial, 'OPEN');
  assert.equal(projectCashierSalonTables([TABLE], [ready], [{ comanda_id: 'check-24' }], NOW)[0].hasPendingPayment, true);
  assert.equal(projectCashierSalonTables([{ ...TABLE, status: 'aguardando_pagamento' }], [], [], NOW)[0].hasPendingPayment, true);
  const merged = projectCashierSalonTables([{ id: 8, capacidade: 4 }], [check([], { mesaOrigemId: 8 })], [], NOW)[0];
  assert.equal(merged.isMerged, true);
  assert.equal(merged.displayMesaId, 7);
});

test('modalidade digital não entra nas fatias físicas, inclusive com mesaId positivo', () => {
  for (const tipo of ['Retirada', 'Entrega', 'delivery']) {
    const order = check([item('a', 'preparando', 48)], { tipo: tipo as Order['tipo'] });
    assert.equal(isCashierTableOrder(order), false);
    assert.equal(slices([order]).tableOrdersInProduction.length, 0);
  }
  assert.equal(isCashierTableOrder(check([], { mesaId: 0 })), false);
  assert.equal(slices([check([item('invalid-table', 'preparando', 48)], { mesaId: Number.NaN })]).tableOrdersInProduction.length, 0);
});

test('delivery mantém colunas, labels e alias legado sem inferir financeiro', () => {
  assert.equal(projectCashierDeliveryState('pendente').awaitingAcceptance, true);
  assert.equal(projectCashierDeliveryState('analise').awaitingAcceptance, true);
  assert.equal(projectCashierDeliveryState('producao').inProduction, true);
  assert.equal(projectCashierDeliveryState('pronto', 'retirada').label, 'Pronto para retirada');
  assert.equal(projectCashierDeliveryState('pronto', 'delivery').label, 'Pronto para envio');
  assert.equal(projectCashierDeliveryState('transito', 'delivery').label, 'Em rota');
  assert.equal(projectCashierDeliveryState('transito', 'retirada').label, 'Aguardando retirada');
  assert.equal(projectCashierDeliveryState('saiu_para_entrega').inFinalization, true);
  assert.equal(projectCashierDeliveryState('saiu_para_entrega').active, false);
  assert.equal(projectCashierDeliveryState('finalizado').active, false);
  assert.equal('financial' in projectCashierDeliveryState('pronto'), false);
});

test('SLA usa relógio explícito e preserva limiares, formatos e precedência de mesa', () => {
  for (const [minutes, tone] of [[14, 'is-normal'], [15, 'is-attention'], [25, 'is-attention'], [26, 'is-late']] as const) {
    const sla = getCashierOrderSlaData({ timestamp: NOW - minutes * 60_000 }, NOW);
    assert.equal(sla.minutes, minutes);
    assert.equal(sla.borderTopClass, tone);
    assert.equal(sla.label, `${minutes} MIN`);
  }
  assert.equal(getCashierOrderSlaData({ timestamp: NOW }, NOW).label, 'AGORA');
  assert.equal(getCashierOrderSlaData({ timestamp: NOW + 60_000 }, NOW).minutes, 0);
  assert.equal(getCashierOrderSlaData({ created_at: 'invalid' }, NOW).label, 'AGORA');
  const tableFirst = getCashierOrderSlaData({
    timestamp: NOW - 60_000, mesa: { aberta_em: NOW - 65 * 60_000 },
  }, NOW);
  assert.equal(tableFirst.label, '1h 5m');
  assert.equal(tableFirst.minutes, 65);
  assert.equal(getCashierOrderSlaData({ timestamp: NOW - 3000 * 60_000 }, NOW).label, '2d 2h');
  assert.equal(formatCashierOldestAge(['invalid', NOW - 61 * 60_000, NOW - 60_000], NOW), '1h 1min');
  assert.equal(formatCashierOldestAge([Date.UTC(2019, 0, 1)], NOW), '—');
  assert.equal(formatCashierOldestAge([NOW], NOW), 'Agora');
});

test('projections não mutam entrada e relógio supre timestamp ausente de forma determinística', () => {
  const entry = Object.freeze(item('a', 'preparando', 48));
  const order = check([entry]);
  Object.freeze(order.itens);
  Object.freeze(order);
  const input = [order];
  Object.freeze(input);
  const first = slices(input);
  assert.deepEqual(slices(input), first);
  assert.equal(first.tableOrdersInProduction[0].itens[0], entry);
  const missingTime = { ...order, timestamp: undefined } as unknown as Order;
  assert.equal(slices([missingTime]).tableOrdersInProduction[0].timestamp, NOW);
});

test('relógio global não é consultado por projections; fallback capturado continua envelhecendo', () => {
  const originalNow = Date.now;
  Date.now = () => { throw new Error('Projection must use its explicit clock'); };
  try {
    const order = { ...check([item('a', 'preparando', 48)]), timestamp: undefined } as unknown as Order;
    const card = slices([order]).tableOrdersInProduction[0];
    assert.equal(getCashierOrderSlaData(card, NOW + 60_000).label, '1 MIN');
    assert.equal(projectCashierSalonTables([TABLE], [order], [], NOW)[0].isOccupied, true);
    assert.equal(formatCashierOldestAge([NOW - 60_000], NOW), '1 min');
  } finally {
    Date.now = originalNow;
  }
});
