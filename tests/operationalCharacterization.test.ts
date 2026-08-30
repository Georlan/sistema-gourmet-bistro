import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { MesaCard } from '../src/components/MesaCard';
import { formatElapsedTime, getTableTotal, normalizeOperationalTimestamp } from '../src/domain';
import { splitOrdersByLaunch } from '../src/domain/orderLots';
import { isTerminalStatus, orderStatusLabel } from '../src/cardapio/orderTracking';
import type { Order, OrderItem } from '../src/types';

// Baseline captured before migrating the consumers. These assertions preserve
// operational facts, identities, time and amounts, not known misleading labels
// such as treating a served item as proof that its check awaits payment.
const NOW = Date.UTC(2026, 7, 30, 15, 30);
const TABLE = { id: 7, capacidade: 4, nome: 'Mesa 7' };

function item(id: string, status: OrderItem['status'], preco = 48, overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id,
    produtoId: `product-${id}`,
    nome: `Produto ${id}`,
    preco,
    observacao: '',
    clienteNome: 'Consumo Geral',
    status,
    pago: false,
    lancamentoId: 'launch-24-a',
    ...overrides,
  };
}

function check(itens: OrderItem[], overrides: Partial<Order> = {}): Order {
  return {
    id: 'check-24',
    numeroPedido: 24,
    mesaId: 7,
    garcomId: 'waiter-1',
    garcomNome: 'Garçom',
    timestamp: NOW - 25 * 60_000,
    tipo: 'Consumo no Local',
    statusComanda: null,
    valorPago: 0,
    itens,
    ...overrides,
  };
}

function renderCard(orders: Order[], overrides: Partial<ComponentProps<typeof MesaCard>> = {}): string {
  return renderToStaticMarkup(createElement(MesaCard, {
    table: TABLE,
    orders,
    draftCount: 0,
    currentTime: NOW,
    activeWaiterId: 'waiter-1',
    onClick: () => {},
    ...overrides,
  }));
}

test('1. mesa livre não tem consumo nem tempo de atendimento', () => {
  const html = renderCard([]);
  assert.match(html, /Mesa 7: Livre/);
  assert.doesNotMatch(html, /25m|R\$ 48/);
  assert.equal(getTableTotal([]), 0);
});

test('2. comanda aberta, mesmo sem itens, mantém a mesa em atendimento', () => {
  const html = renderCard([check([])]);
  assert.doesNotMatch(html, /Mesa 7: Livre/);
  assert.match(html, /25m/);
  assert.equal(getTableTotal([check([])]), 0);
});

test('3. pedido em preparo conserva consumo, contagem e tempo', () => {
  const html = renderCard([check([item('preparing', 'preparando', 112)])]);
  assert.match(html, /Em preparo/);
  assert.match(html, /1 item/);
  assert.match(html, /25m/);
  assert.match(html, /R\$ 112/);
});

test('4. algum item pronto é visível sem apagar o consumo ainda em preparo', () => {
  const orders = [check([item('preparing', 'preparando', 112), item('ready', 'pronto', 48)])];
  const html = renderCard(orders);
  assert.match(html, /Tem item pronto/);
  assert.match(html, /2 itens/);
  assert.match(html, /R\$ 160/);
  assert.equal(getTableTotal(orders), 160);
});

test('5. todos os itens prontos não inferem solicitação de conta', () => {
  const html = renderCard([check([item('ready-a', 'pronto'), item('ready-b', 'pronto')])]);
  assert.match(html, /pronto/i);
  assert.match(html, /2 itens/);
  assert.match(html, /R\$ 96/);
  assert.doesNotMatch(html, /Confirmar pagamento|Aguardando pagamento|Pronta para pagar|Para receber/);
});

test('6. pedido pronto e conta aberta continuam sendo fatos independentes', () => {
  const order = check([item('ready', 'pronto')], { statusComanda: null, valorPago: 0 });
  const html = renderCard([order], { hasPendingPayment: false });
  assert.match(html, /pronto/i);
  assert.doesNotMatch(html, /Confirmar pagamento|Aguardando pagamento|Pronta para pagar|Para receber/);
  assert.equal(getTableTotal([order]), 48);
  assert.equal(order.statusComanda, null);
});

test('7. evidência explícita de pagamento pode coexistir com itens em preparo', () => {
  const order = check([item('preparing', 'preparando')], { statusComanda: 'aguardando_pagamento' });
  const html = renderCard([order], { hasPendingPayment: true });
  // The shared vocabulary may converge; the existing explicit financial signal
  // must remain visible and must not change the item or the consumption amount.
  assert.match(html, /Confirmar pagamento|Aguardando pagamento|Para receber/);
  assert.equal(order.itens[0].status, 'preparando');
  assert.equal(getTableTotal([order]), 48);
});

test('8. pedidos 24-A e 24-B da mesma comanda mantêm ids de lançamento distintos', () => {
  // These labels are a fixture of GET /atendimentos/mesas/7, not a frontend
  // sequence algorithm. The current split utility must preserve its lookup key.
  const labelsFromBackend: Record<string, string> = {
    'launch-24-a': '24-A',
    'launch-24-b': '24-B',
  };
  const order = check([
    item('a1', 'preparando', 64),
    item('b1', 'pronto', 48, { lancamentoId: 'launch-24-b' }),
    item('a2', 'preparando', 48),
  ]);
  const lots = splitOrdersByLaunch([order]);

  assert.deepEqual(lots.map(lot => lot.lancamentoId), ['launch-24-a', 'launch-24-b']);
  assert.deepEqual(lots.map(lot => labelsFromBackend[lot.lancamentoId!]), ['24-A', '24-B']);
  assert.deepEqual(lots.map(lot => lot.itens.map(entry => entry.id)), [['a1', 'a2'], ['b1']]);
  assert.deepEqual(lots.map(lot => lot.numeroPedido), [24, 24]);
  assert.deepEqual(lots.map(lot => lot.id), ['check-24', 'check-24']);
  assert.equal(lots[0].items, lots[0].itens);
  assert.equal(lots[1].items, lots[1].itens);
});

test('9. totalização de fatias conserva R$112 em preparo + R$48 pronto = R$160', () => {
  const lots = splitOrdersByLaunch([check([
    item('a1', 'preparando', 64),
    item('a2', 'preparando', 48),
    item('b1', 'pronto', 48, { lancamentoId: 'launch-24-b' }),
  ])]);
  const subtotals = lots.map(lot => getTableTotal([lot]));
  assert.deepEqual(subtotals, [112, 48]);
  assert.equal(subtotals.reduce((sum, subtotal) => sum + subtotal, 0), 160);
  assert.equal(getTableTotal(lots), 160);
});

test('10. delivery distingue preparo, pronto, trânsito e serviço concluído', () => {
  assert.equal(orderStatusLabel('producao'), 'Em preparo');
  assert.equal(orderStatusLabel('pronto'), 'Pronto');
  assert.equal(orderStatusLabel('transito'), 'Saiu para entrega');
  assert.equal(orderStatusLabel('entregue'), 'Concluído');
  assert.equal(isTerminalStatus('pronto'), false);
  assert.equal(isTerminalStatus('transito'), false);
  assert.equal(isTerminalStatus('entregue'), true);

  const served = check([item('served', 'entregue')]);
  assert.equal(getTableTotal([served]), 48);
  assert.equal(served.statusComanda, null);
  // Do not freeze the legacy "Pronta para pagar" label for an open served check.
});

test('cancelados e pagos não entram no getTableTotal legado; preço persistido é preservado', () => {
  const orders = [check([
    item('active', 'preparando', 12.75),
    item('served', 'entregue', 35.25),
    item('paid', 'pronto', 100, { pago: true }),
    item('cancelled', 'cancelado', 200),
  ])];
  assert.equal(getTableTotal(orders), 48);
  // This is the existing presentation subtotal, not proof that a whole check is
  // financially paid and not an alternative pricing/settlement calculation.
  assert.equal(orders[0].statusComanda, null);
});

test('tempo operacional usa o mais antigo, com precedência created_at e relógio explícito', () => {
  const orders = [
    check([item('later', 'preparando')], { timestamp: NOW - 2 * 60_000 }),
    check([item('earlier', 'preparando')], {
      id: 'check-25',
      numeroPedido: 25,
      timestamp: NOW - 60_000,
      created_at: new Date(NOW - 85 * 60_000).toISOString(),
    }),
  ];
  assert.match(renderCard(orders), /1h 25m/);
  assert.equal(normalizeOperationalTimestamp('not-a-date', NOW), null);
  assert.equal(formatElapsedTime(undefined, NOW), '--');
  assert.equal(formatElapsedTime(NOW + 60_000, NOW), '0m');
});

test('split e totais são puros e não inventam identidade para itens legados', () => {
  const legacyItem = Object.freeze(item('legacy', 'preparando', 48, { lancamentoId: undefined }));
  const order = check([legacyItem]);
  Object.freeze(order.itens);
  Object.freeze(order);
  const orders = [order];
  Object.freeze(orders);

  const lots = splitOrdersByLaunch(orders);
  assert.equal(lots.length, 1);
  assert.equal(lots[0].lancamentoId, undefined);
  assert.equal(lots[0].id, 'check-24');
  assert.equal(lots[0].itens[0], legacyItem);
  assert.equal(getTableTotal(lots), 48);
  assert.equal(order.itens[0].lancamentoId, undefined);
});
