import assert from 'node:assert/strict';
import test from 'node:test';
import { projectCashierDeliveryState } from '../src/domain/cashierOrderProjection';

import {
  getKdsDestinationLabel,
  getKdsTicketLabel,
  matchesKdsTicketQuery,
  projectKdsTickets,
  projectKdsDemand,
  getKdsWaitInfo,
  isKdsKitchenOrderEligible,
  type KdsKitchenItem,
} from '../src/components/caixa/kitchen/kdsProjection';

const kitchenItem = (
  id: string,
  status: KdsKitchenItem['status'],
  overrides: Partial<KdsKitchenItem> = {},
): KdsKitchenItem => ({
  id,
  produtoId: `product-${id}`,
  nome: `Item ${id}`,
  preco: 20,
  observacao: '',
  clienteNome: 'Consumo Geral',
  status,
  orderId: 'order-1',
  lancamentoId: 'launch-1',
  mesaId: 7,
  garcomNome: 'Operador',
  timestamp: Date.parse('2026-09-14T15:00:00Z'),
  ...overrides,
});

test('KDS groups items by launch instead of rendering one card per item', () => {
  const projection = projectKdsTickets([
    kitchenItem('burger', 'preparando'),
    kitchenItem('fries', 'pronto'),
    kitchenItem('drink', 'preparando', {
      lancamentoId: 'launch-2',
      timestamp: Date.parse('2026-09-14T15:05:00Z'),
    }),
  ]);

  assert.equal(projection.tickets.length, 2);
  assert.deepEqual(projection.tickets[0].items.map((item) => item.id), ['burger', 'fries']);
  assert.equal(projection.preparingTickets.length, 2);
  assert.equal(projection.readyTickets.length, 0);
  assert.equal(projection.preparingItemCount, 2);
  assert.equal(projection.readyItemCount, 1);
});

test('cashier status changes automatically move the same ticket between KDS lanes', () => {
  const before = projectKdsTickets([
    kitchenItem('burger', 'preparando'),
    kitchenItem('fries', 'pronto'),
  ]);
  assert.equal(before.preparingTickets.length, 1);
  assert.equal(before.readyTickets.length, 0);

  const afterCashierAdvance = projectKdsTickets([
    kitchenItem('burger', 'pronto'),
    kitchenItem('fries', 'pronto'),
  ]);
  assert.equal(afterCashierAdvance.preparingTickets.length, 0);
  assert.equal(afterCashierAdvance.readyTickets.length, 1);
  assert.equal(afterCashierAdvance.readyTickets[0].readyCount, 2);
});

test('tickets remain oldest-first and use operational context labels', () => {
  const projection = projectKdsTickets([
    kitchenItem('later', 'preparando', {
      orderId: 'order-later',
      lancamentoId: 'launch-later',
      timestamp: Date.parse('2026-09-14T15:10:00Z'),
    }),
    kitchenItem('older', 'preparando', {
      orderId: 'order-older',
      lancamentoId: 'launch-older',
      timestamp: Date.parse('2026-09-14T14:50:00Z'),
      mesaId: 0,
      tipo: 'Retirada',
      displayNumber: '041-A',
    }),
  ]);

  assert.equal(projection.tickets[0].orderId, 'order-older');
  assert.equal(getKdsDestinationLabel(projection.tickets[0]), 'Retirada');
  assert.equal(getKdsTicketLabel(projection.tickets[0]), '#041-A');
});

test('KDS distinguishes pickup, delivery and local counter tickets', () => {
  assert.equal(
    getKdsDestinationLabel({ mesaId: 0, tipo: 'Retirada' }),
    'Retirada',
  );
  assert.equal(
    getKdsDestinationLabel({ mesaId: 0, tipo: 'Entrega' }),
    'Delivery',
  );
  assert.equal(
    getKdsDestinationLabel({ mesaId: 0, tipo: undefined }),
    'Balcão',
  );
});

test('KDS search finds tickets by mesa, item, customer and observation without changing state', () => {
  const projection = projectKdsTickets([
    kitchenItem('burger', 'preparando', {
      mesaId: 4,
      nome: 'Duplo Burguer',
      observacao: 'Sem cebola',
      clienteNome: 'Geórgia',
    }),
    kitchenItem('drink', 'pronto', {
      lancamentoId: 'launch-2',
      mesaId: 9,
      nome: 'Suco de Caju',
    }),
  ]);

  const firstTicket = projection.tickets[0];
  assert.equal(matchesKdsTicketQuery(firstTicket, 'mesa 4'), true);
  assert.equal(matchesKdsTicketQuery(firstTicket, 'duplo'), true);
  assert.equal(matchesKdsTicketQuery(firstTicket, 'georgia'), true);
  assert.equal(matchesKdsTicketQuery(firstTicket, 'sem cebola'), true);
  assert.equal(matchesKdsTicketQuery(firstTicket, 'suco'), false);
  assert.equal(firstTicket.preparingCount, 1);
});

test('KDS identifica pedido aceito aguardando início sem o confundir com preparo', () => {
  const projection = projectKdsTickets([
    kitchenItem('accepted', 'preparando', { deliveryStatus: 'aceito' }),
  ]);
  assert.equal(projection.tickets[0].deliveryStatus, 'aceito');
});


test('All day never aggregates substitutions, observations or ready items', () => {
  const result = projectKdsDemand([
    kitchenItem('one', 'preparando', { produtoId: 'burger', nome: 'Burger' }),
    kitchenItem('two', 'preparando', { produtoId: 'burger', nome: 'Burger' }),
    kitchenItem('custom', 'preparando', { produtoId: 'burger', nome: 'Burger', observacao: 'Sem cebola' }),
    kitchenItem('ready', 'pronto', { produtoId: 'burger', nome: 'Burger' }),
  ]);
  assert.deepEqual(result.map(row => [row.count, row.name, row.details]), [
    [2, 'Burger', []], [1, 'Burger', ['Sem cebola']],
  ]);
});

test('elapsed time is launch wait only and handles missing clocks or time in the future', () => {
  const at = Date.parse('2026-11-13T20:00:00Z');
  assert.deepEqual(getKdsWaitInfo(undefined, at), { minutes: null, label: 'Horário indisponível', level: 'unknown' });
  assert.equal(getKdsWaitInfo(at - 9*60000, at).level, 'normal');
  assert.equal(getKdsWaitInfo(at - 10*60000, at).level, 'attention');
  assert.equal(getKdsWaitInfo(at - 15*60000, at).level, 'late');
  assert.equal(getKdsWaitInfo(at + 60000, at).minutes, 0);
});

test('items preserve their incoming cook order while ready items follow unfinished ones', () => {
  const ticket = projectKdsTickets([
    kitchenItem('z', 'preparando'),
    kitchenItem('a', 'preparando'),
    kitchenItem('r', 'pronto'),
  ]).tickets[0];
  assert.deepEqual(ticket.items.map(i => i.id), ['z', 'a', 'r']);
});


test('kanban projects order ready independently of kitchen item completion, with no implicit service', () => {
  const preparing = projectKdsTickets([kitchenItem('one', 'preparando', { deliveryStatus: 'aceito' })]);
  const ready = projectKdsTickets([kitchenItem('one', 'pronto', { deliveryStatus: 'pronto' })]);
  assert.equal(preparing.preparingTickets.length, 1);
  assert.equal(ready.readyTickets.length, 1);
  assert.equal(ready.readyTickets[0].items[0].status, 'pronto');
  assert.equal(projectCashierDeliveryState('aceito', 'pickup').inProduction, true);
  assert.equal(projectCashierDeliveryState('pronto', 'pickup').inFinalization, true);
  assert.equal(projectCashierDeliveryState('pronto', 'pickup').label, 'Pronto para retirada');
});


test('KDS excludes pending/declined/dispatched/finished orders but retains accepted and table launches', () => {
  for (const status of ['pendente', 'analise', 'recusado', 'transito', 'finalizado']) assert.equal(isKdsKitchenOrderEligible(status), false);
  for (const status of ['aceito', 'producao', 'pronto', null, undefined]) assert.equal(isKdsKitchenOrderEligible(status), true);
});

test('KDS never substitutes the technical id for an absent persisted order display number', () => {
  assert.equal(getKdsTicketLabel({ orderId: 'technical-id-123' }), 'sem número');
  assert.equal(getKdsTicketLabel({ orderId: 'technical-id-123', numeroPedido: 0 }), 'sem número');
  assert.equal(getKdsDestinationLabel({ mesaId: 7, tipo: 'Consumo no Local' }), 'Mesa 07');
  assert.equal(getKdsDestinationLabel({ mesaId: 7, tipo: 'Entrega' }), 'Delivery');
});
