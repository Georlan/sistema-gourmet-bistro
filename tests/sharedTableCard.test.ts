import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MesaCard } from '../src/components/MesaCard';
import { CaixaSalonTab } from '../src/components/caixa/salao/CaixaSalonTab';
import { tableCardPresentation } from '../src/components/shared/SharedTableCard';
import { deriveTableOperationalState } from '../src/domain/operationalState';
import { projectCashierSalonTables, projectCashierTableSlices } from '../src/domain/cashierOrderProjection';
import { readCheckLaunchIdentities } from '../src/domain/orderIdentity';
import { splitOrdersByLaunch } from '../src/domain/orderLots';
import type { Order, OrderItem } from '../src/types';

const now = Date.UTC(2026, 7, 30, 15);
const table = { id: 7, capacidade: 4, nome: 'Varanda' };
const makeItem = (id: string, status: OrderItem['status'], preco: number): OrderItem => ({
  id, lancamentoId: id, produtoId: id, nome: id, preco, status, observacao: '', clienteNome: 'Ana',
});
const makeCheck = (itens: OrderItem[], extra: Partial<Order> = {}): Order => ({
  id: 'check-24', numeroPedido: 24, mesaId: 7, garcomId: 'waiter', garcomNome: 'Ana',
  timestamp: now - 12 * 60000, itens, ...extra,
});
const scenarios: { label: string; orders: Order[]; pending?: boolean }[] = [
  { label: 'Livre', orders: [] },
  { label: 'Em atendimento', orders: [makeCheck([])] },
  { label: 'Em preparo', orders: [makeCheck([makeItem('A', 'preparando', 112)])] },
  { label: 'Tem item pronto', orders: [makeCheck([makeItem('A', 'preparando', 112), makeItem('B', 'pronto', 48)])] },
  { label: 'Itens servidos', orders: [makeCheck([makeItem('A', 'entregue', 112)])] },
  { label: 'Aguardando pagamento', orders: [makeCheck([makeItem('A', 'preparando', 112)], { statusComanda: 'aguardando_pagamento' })] },
  { label: 'Confirmar pagamento', orders: [makeCheck([makeItem('A', 'pronto', 112)])], pending: true },
];

for (const scenario of scenarios) {
  test(`casca compartilhada: ${scenario.label} tem mesma apresentação nos dois contextos`, () => {
    const pendingPayments = scenario.pending ? [{ comanda_id: 'check-24' }] : [];
    const cards = projectCashierSalonTables([table], scenario.orders, pendingPayments, now);
    const waiter = renderToStaticMarkup(React.createElement(MesaCard, {
      table, orders: scenario.orders, currentTime: now, activeWaiterId: 'waiter',
      draftCount: 0, hasPendingPayment: scenario.pending, onClick() {},
    }));
    const cashier = renderToStaticMarkup(React.createElement(CaixaSalonTab, {
      cards, visibleCards: cards, counts: { all: 1, free: 0, occupied: 1, payment: 0 },
      insights: { occupancy: 100, openValue: 112, oldestService: '12m' }, filter: 'all',
      onFilterChange() {}, actions: { receiveTable() {}, inspectTable() {}, prepareTransfer() {}, openTableOrder() {} },
    }));
    const presentation = tableCardPresentation(cards[0].operational);
    assert.equal(presentation.label, scenario.label);
    for (const html of [waiter, cashier]) {
      assert.ok(html.includes(scenario.label));
      assert.ok(html.includes(`data-operational-state="${presentation.key}"`));
      if (scenario.orders.length) assert.match(html, /12m/);
    }
    assert.doesNotMatch(waiter, />Receber<|>Ver comanda</);
    if (scenario.pending || scenario.orders.some(order => order.statusComanda)) assert.match(cashier, /Receber/);
  });
}

test('produção oculta respeita permissão sem inventar estado financeiro e merge preserva destino', () => {
  const state = deriveTableOperationalState({ table, orders: [makeCheck([makeItem('A', 'pronto', 48)])], now });
  assert.equal(tableCardPresentation(state, false).label, 'Em atendimento');
  assert.equal(state.financial, 'OPEN');
  assert.equal(tableCardPresentation({ ...state, mergedIntoMesaId: 8 }).label, 'Junto com mesa 8');
});

test('identidades dos DTOs chegam aos lotes e fatias sem rotular a conta agregada', () => {
  const launchIdentities = readCheckLaunchIdentities({
    lancamentos: [{ id: 'A', display_number: '24-A' }, { id: 'B', display_number: '24-AA' }],
    itens: [{ lancamento_id: 'moved', lancamento_display_number: '19-Z' }],
  });
  const check = makeCheck([makeItem('A', 'preparando', 112), makeItem('B', 'pronto', 48)], { launchIdentities });
  const slices = projectCashierTableSlices([check], [table], now);
  assert.equal(slices.tableOrdersInProduction[0].displayNumber, '24-A');
  assert.equal(slices.tableOrdersReady[0].displayNumber, undefined);
  assert.deepEqual(splitOrdersByLaunch([check]).map(order => order.displayNumber), ['24-A', '24-AA']);
  assert.equal(splitOrdersByLaunch([makeCheck([makeItem('moved', 'preparando', 48)], { launchIdentities })])[0].displayNumber, '19-Z');
  assert.equal(splitOrdersByLaunch([makeCheck([makeItem('legacy', 'preparando', 48)], { launchIdentities })])[0].displayNumber, undefined);
  assert.equal(Object.keys(readCheckLaunchIdentities({ lancamentos: [{ id: 'A', display_number: null }] })).length, 0);
  assert.equal(check.displayNumber, undefined);
  assert.equal(slices.tableOrdersInProduction[0].itens.reduce((sum, item) => sum + item.preco, 0), 112);
  assert.equal(slices.tableOrdersReady[0].itens.reduce((sum, item) => sum + item.preco, 0), 48);
});
