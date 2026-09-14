import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getKdsDestinationLabel,
  getKdsTicketLabel,
  matchesKdsTicketQuery,
  projectKdsTickets,
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
