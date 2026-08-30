import assert from 'node:assert/strict';
import test from 'node:test';

import type { Order, OrderItem } from '../src/types';
import { getTableTotal } from '../src/domain';
import {
  deriveFinancialState,
  deriveOperationalElapsedTime,
  deriveOrderOperationalState,
  deriveProductionState,
  deriveTableOperationalState,
  getFirstOrderTimestamp,
  getOrderItems,
  getOrderOperationalTimestamp,
  isActiveOperationalOrder,
} from '../src/domain/operationalState';
import {
  buildLaunchIdentityMap,
  getOrderCheckId,
  getOrderDisplayNumber,
  type TableFamilySnapshot,
} from '../src/domain/orderIdentity';
import { splitOrdersByLaunch } from '../src/domain/orderLots';

const NOW = Date.UTC(2026, 7, 30, 15, 30);
const TABLE = { id: 7, capacidade: 4 };

const item = (status: OrderItem['status'], overrides: Partial<OrderItem> = {}): OrderItem => ({
  id: `item-${status}`,
  produtoId: 'product-1',
  nome: 'Produto',
  preco: 48,
  observacao: '',
  clienteNome: 'Consumo Geral',
  status,
  lancamentoId: 'launch-a',
  ...overrides,
});

const check = (itens: OrderItem[] = [], overrides: Partial<Order> = {}): Order => ({
  id: 'check-24',
  numeroPedido: 24,
  mesaId: TABLE.id,
  garcomId: 'waiter-1',
  garcomNome: 'Garçom',
  timestamp: NOW - 25 * 60_000,
  tipo: 'Consumo no Local',
  statusComanda: null,
  itens,
  ...overrides,
});

test('mesa livre não possui produção, serviço concluído nem sinal financeiro inferido', () => {
  const state = deriveTableOperationalState({ table: TABLE, orders: [], now: NOW });
  assert.equal(state.occupancy, 'FREE');
  assert.equal(state.production.activeItemCount, 0);
  assert.equal(state.production.allItemsReady, false);
  assert.equal(state.service, 'OPEN');
  assert.equal(state.financial, 'OPEN');
  assert.equal(state.firstOrderTimestamp, undefined);
  assert.equal(state.elapsed, '--');
});

test('ocupação reconhece atendimento vazio e status operacional, sem fabricar itens prontos', () => {
  const emptyCheck = deriveTableOperationalState({ table: TABLE, orders: [check()], now: NOW });
  assert.equal(emptyCheck.occupancy, 'IN_SERVICE');
  assert.equal(emptyCheck.production.activeItemCount, 0);
  assert.equal(emptyCheck.elapsed, '25m');

  for (const status of ['ocupada', 'ocupado', 'pronta', 'pronto', 'aguardando_pagamento', 'para_receber']) {
    const state = deriveTableOperationalState({ table: { ...TABLE, status }, orders: [], now: NOW });
    assert.equal(state.occupancy, 'IN_SERVICE', status);
    assert.equal(state.production.hasReadyItems, false, status);
  }
});

test('produção preserva preparo e pronto simultâneos e exclui apenas cancelados', () => {
  const preparing = item('preparando', { preco: 112, pago: true });
  const ready = item('pronto');
  const cancelled = item('cancelado');
  const production = deriveProductionState([preparing, ready, cancelled]);
  assert.equal(production.activeItemCount, 2);
  assert.equal(production.preparingItemCount, 1);
  assert.equal(production.readyItemCount, 1);
  assert.equal(production.deliveredItemCount, 0);
  assert.equal(production.hasPreparingItems, true);
  assert.equal(production.hasReadyItems, true);
  assert.equal(production.allItemsReady, false);
  assert.deepEqual(production.activeItems, [preparing, ready]);
  assert.deepEqual(production.preparingItems, [preparing]);
  assert.deepEqual(production.readyItems, [ready]);
});

test('todos prontos não significa aguardando pagamento nem serviço concluído', () => {
  const state = deriveOrderOperationalState(check([item('pronto'), item('pronto', { id: 'ready-b' })]), NOW);
  assert.equal(state.production.allItemsReady, true);
  assert.equal(state.production.hasPreparingItems, false);
  assert.equal(state.service, 'OPEN');
  assert.equal(state.financial, 'OPEN');
});

test('pedido de conta não transforma produção em pronto nem apaga preparo', () => {
  const state = deriveTableOperationalState({
    table: TABLE,
    orders: [check([item('preparando')], { statusComanda: 'aguardando_pagamento' })],
    now: NOW,
  });
  assert.equal(state.financial, 'AWAITING_PAYMENT');
  assert.equal(state.hasPaymentRequest, true);
  assert.equal(state.hasPendingConfirmation, false);
  assert.equal(state.production.hasPreparingItems, true);
  assert.equal(state.production.hasReadyItems, false);
  assert.equal(state.service, 'OPEN');
});

test('pronto e aguardando pagamento coexistem sem competir por uma mega-enum', () => {
  const state = deriveTableOperationalState({
    table: TABLE,
    orders: [check([item('pronto')], { statusComanda: 'aguardando_pagamento' })],
    now: NOW,
  });
  assert.equal(state.production.allItemsReady, true);
  assert.equal(state.financial, 'AWAITING_PAYMENT');
  assert.equal(state.service, 'OPEN');
});

test('pagamento pendente é sinal explícito e fica distinto da solicitação de conta', () => {
  const orders = [check([item('pronto')])];
  const state = deriveTableOperationalState({
    table: TABLE,
    orders,
    pendingPayments: [{ comanda_id: 'check-24' }],
    now: NOW,
  });
  assert.equal(state.financial, 'AWAITING_PAYMENT');
  assert.equal(state.hasPendingConfirmation, true);
  assert.equal(state.hasPaymentRequest, false);
  assert.equal(state.hasPendingPayment, true);
  assert.equal(state.production.hasReadyItems, true);

  const unrelated = deriveTableOperationalState({
    table: TABLE,
    orders,
    pendingPayments: [{ comanda_id: 'another-check' }],
    now: NOW,
  });
  assert.equal(unrelated.financial, 'OPEN');
  assert.equal(unrelated.hasPendingConfirmation, false);
});

test('serviço entregue continua independente do financeiro e dos flags históricos pago/fechada', () => {
  const order = check([item('entregue', { pago: true })], {
    status: 'finalizado',
    deliveryStatus: 'finalizado',
    valorPago: 48,
  });
  Object.assign(order, { fechada: true });
  const state = deriveOrderOperationalState(order, NOW);
  assert.equal(state.service, 'SERVED');
  assert.equal(state.production.deliveredItemCount, 1);
  assert.equal(state.production.hasReadyItems, false);
  assert.equal(state.production.allItemsReady, false);
  assert.equal(state.financial, 'OPEN');
  assert.equal(state.deliveryStatus, 'finalizado');

  const cancelledOnly = deriveOrderOperationalState(check([item('cancelado')]), NOW);
  assert.equal(cancelledOnly.service, 'OPEN');
  assert.equal(cancelledOnly.production.allItemsReady, false);
});

test('financial interpreta somente sinais realmente disponíveis no contrato atual', () => {
  assert.equal(deriveFinancialState([{}]), 'OPEN');
  assert.equal(deriveFinancialState([{}], { tableStatus: ' pronto ' }), 'OPEN');
  assert.equal(deriveFinancialState([{}], { tableStatus: 'para_receber' }), 'AWAITING_PAYMENT');
  assert.equal(deriveFinancialState([{}], { hasPendingPayment: true }), 'AWAITING_PAYMENT');
  assert.equal(deriveFinancialState([{ statusComanda: 'aguardando_pagamento' }]), 'AWAITING_PAYMENT');
});

test('tempo compartilha relógio explícito e prioridades de abertura/criação, nunca updated_at', () => {
  const createdAt = new Date(NOW - 85 * 60_000).toISOString();
  const order = check([item('preparando')], { created_at: createdAt, timestamp: NOW - 60_000 });
  Object.assign(order, { updated_at: new Date(NOW).toISOString() });
  assert.equal(getOrderOperationalTimestamp(order, NOW), NOW - 85 * 60_000);
  assert.equal(getFirstOrderTimestamp([check(), order], NOW), NOW - 85 * 60_000);
  assert.equal(deriveOrderOperationalState(order, NOW).elapsed, '1h 25m');
  assert.equal(deriveTableOperationalState({ table: TABLE, orders: [check(), order], now: NOW }).elapsed, '1h 25m');
  assert.equal(getOrderOperationalTimestamp({ ...order, aberta_em: NOW - 100 * 60_000 }, NOW), NOW - 100 * 60_000);
  assert.deepEqual(deriveOperationalElapsedTime('invalid', NOW), { timestamp: null, minutes: null, formatted: '--' });
  assert.equal(deriveOperationalElapsedTime(NOW + 60_000, NOW).minutes, 0);
  assert.equal(deriveOperationalElapsedTime('2026-08-30T15:00:00', NOW).minutes, 30);
});

test('projeções são puras, reutilizam objetos de item e não consultam Date.now', context => {
  const entries = [item('preparando'), item('pronto', { id: 'ready' })];
  entries.forEach(Object.freeze);
  Object.freeze(entries);
  const order = check(entries);
  Object.freeze(order);
  const orders = [order];
  Object.freeze(orders);
  context.mock.method(Date, 'now', () => { throw new Error('Implicit clock is forbidden in projections'); });

  const first = deriveTableOperationalState({ table: TABLE, orders, now: NOW });
  const second = deriveTableOperationalState({ table: TABLE, orders, now: NOW });
  assert.deepEqual(first, second);
  assert.notEqual(first.production.activeItems, entries);
  assert.equal(first.production.preparingItems[0], entries[0]);
  assert.equal(first.production.readyItems[0], entries[1]);
  assert.equal(deriveOrderOperationalState(order, NOW).elapsed, '25m');
});

test('identidade canônica do snapshot não é truncada nem recalculada após transferência', () => {
  const snapshot: TableFamilySnapshot = {
    familias: [{
      numero_conta: 99,
      lancamentos: [
        { lancamento_id: 'launch-a', pedido_id: '124-A', sequencia: 1 },
        { lancamento_id: 'launch-aa', pedido_id: '124-AA', sequencia: 27 },
        { lancamento_id: 'missing', pedido_id: null, sequencia: null, identity_status: 'missing' },
      ],
    }],
  };
  const identities = buildLaunchIdentityMap(snapshot);
  assert.equal(identities['launch-a'].displayNumber, '124-A');
  assert.equal(identities['launch-aa'].displayNumber, '124-AA');
  assert.equal(identities['launch-aa'].sequence, 27);
  assert.equal(identities.missing, undefined);
  const lots = splitOrdersByLaunch([check([
    item('preparando'),
    item('pronto', { id: 'second', lancamentoId: 'launch-aa' }),
  ], { id: 'destination-check-99', numeroPedido: 99 })], identities);
  assert.deepEqual(lots.map(lot => getOrderDisplayNumber(lot)), ['124-A', '124-AA']);
  assert.deepEqual(lots.map(lot => lot.id), ['destination-check-99', 'destination-check-99']);
  assert.deepEqual(lots.map(lot => lot.checkId), ['destination-check-99', 'destination-check-99']);
  assert.deepEqual(lots.map(lot => lot.lancamentoId), ['launch-a', 'launch-aa']);
});

test('identidade de um pedido não vaza para outro lançamento da mesma conta', () => {
  const lots = splitOrdersByLaunch([check([
    item('preparando'),
    item('pronto', { id: 'second', lancamentoId: 'launch-b' }),
  ], { displayNumber: '24-A', lancamentoId: 'launch-a' })]);
  assert.equal(lots[0].displayNumber, '24-A');
  assert.equal(lots[1].displayNumber, undefined);
  assert.equal(getOrderDisplayNumber(check()), undefined);
  assert.equal(getOrderDisplayNumber({ displayNumber: '  ' }), undefined);
});

test('projeção de pedido conserva identidade técnica da conta separada de lançamento/display', () => {
  const order = check([item('preparando')], {
    id: 'launch-a',
    checkId: 'check-24',
    lancamentoId: 'launch-a',
    displayNumber: '24-A',
  });
  const state = deriveOrderOperationalState(order, NOW);
  assert.equal(state.checkId, 'check-24');
  assert.equal(state.lancamentoId, 'launch-a');
  assert.equal(state.displayNumber, '24-A');
  assert.equal(state.checkNumber, 24);
  assert.equal(getOrderCheckId({ id: 'launch-a', comandaId: 'check-24' }), 'check-24');
});

test('seleção de produção não muda preços persistidos nem introduz cálculo de pricing', () => {
  const order = check([item('preparando', { preco: 112 }), item('pronto', { preco: 48 })]);
  const projection = deriveOrderOperationalState(order, NOW);
  assert.equal(getTableTotal([{ ...order, itens: projection.production.preparingItems }]), 112);
  assert.equal(getTableTotal([{ ...order, itens: projection.production.readyItems }]), 48);
  assert.equal(getTableTotal([order]), 160);
  assert.equal(Object.hasOwn(projection, 'total'), false);
});

test('delivery é conservado literalmente e não transforma item nem financeiro', () => {
  for (const deliveryStatus of ['pendente', 'producao', 'pronto', 'transito', 'finalizado', 'recusado'] as const) {
    const state = deriveOrderOperationalState(check([item('preparando')], { tipo: 'Entrega', deliveryStatus }), NOW);
    assert.equal(state.deliveryStatus, deliveryStatus);
    assert.equal(state.production.hasPreparingItems, true);
    assert.equal(state.financial, 'OPEN');
  }
});

test('alias de itens e filtro terminal mantêm a fronteira legada sem afirmar estado financeiro', () => {
  const items = [item('pronto')];
  assert.equal(getOrderItems({ itens: undefined, items }), items);
  assert.deepEqual(getOrderItems({ itens: [], items }), []);
  for (const status of ['fechada', 'fechado', 'cancelada', 'cancelado', 'finalizada', 'finalizado']) {
    assert.equal(isActiveOperationalOrder({ status }), false);
  }
  assert.equal(isActiveOperationalOrder({ status: 'entregue' }), true);
  assert.equal(isActiveOperationalOrder({}), true);
});
