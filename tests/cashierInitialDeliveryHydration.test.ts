import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bucketCourierDeliveryOrders,
  bucketPickupOrders,
  projectDeliveryOrdersFromSharedSnapshot,
  reconcileDeliveryOrderAfterStatus,
} from '../src/components/caixa/orders/deliveryOrderProjection';
import { isCashierTableOrder } from '../src/domain/cashierOrderProjection';
import type { Order } from '../src/types';

const baseOrder = (overrides: Partial<Order> = {}): Order => ({
  id: 'delivery-1',
  mesaId: 0,
  garcomId: 'cashier-1',
  garcomNome: 'Caixa',
  timestamp: Date.parse('2026-09-14T11:40:00Z'),
  created_at: '2026-09-14T11:40:00Z',
  tipo: 'Entrega',
  identificador: 'Georlan',
  clientePhone: '88999616937',
  origemOperacional: 'cardapio',
  deliveryStatus: 'producao',
  deliveryTax: 5,
  deliveryAddress: 'Rua de Teste, 100',
  numeroPedido: 90,
  itens: [
    {
      id: 'item-1',
      produtoId: 'refrigerante',
      nome: 'Refrigerante 600mL',
      preco: 8,
      observacao: '',
      clienteNome: 'Georlan',
      status: 'preparando',
      pago: true,
    },
  ],
  ...overrides,
});

test('hidrata pedidos digitais do snapshot compartilhado sem esperar a leitura dedicada', () => {
  const [projected] = projectDeliveryOrdersFromSharedSnapshot([baseOrder()]);

  assert.ok(projected);
  assert.equal(projected.id, 'delivery-1');
  assert.equal(projected.status, 'producao');
  assert.equal(projected.total, 13);
  assert.equal(projected.telefone, '88999616937');
  assert.equal(projected.endereco, 'Rua de Teste, 100');
  assert.equal(projected.itens, '1x Refrigerante 600mL');
  assert.equal(projected.pago, true);
  assert.equal(projected.numeroPedido, 90);
});

test('resposta curta de aceite preserva itens e total até a reconciliação completa', () => {
  const [previous] = projectDeliveryOrdersFromSharedSnapshot([baseOrder({ deliveryStatus: 'pendente' })]);
  const [compact] = projectDeliveryOrdersFromSharedSnapshot([
    baseOrder({
      deliveryStatus: 'producao',
      itens: [],
      deliveryTax: 0,
    }),
  ]);

  const reconciled = reconcileDeliveryOrderAfterStatus(previous, compact);

  assert.equal(reconciled.status, 'producao');
  assert.equal(reconciled.itens, '1x Refrigerante 600mL');
  assert.equal(reconciled.quantidadeItens, 1);
  assert.equal(reconciled.total, 13);
  assert.equal(reconciled.cliente, 'Georlan');
});

test('ignora salão e pedidos digitais já encerrados no snapshot inicial', () => {
  const salon = baseOrder({ id: 'table-1', mesaId: 9, tipo: 'Consumo no Local', deliveryStatus: null });
  const finalized = baseOrder({ id: 'delivery-finalized', deliveryStatus: 'finalizado' });
  const rejected = baseOrder({ id: 'delivery-rejected', deliveryStatus: 'recusado' });
  const active = baseOrder({ id: 'delivery-active', deliveryStatus: 'pendente' });

  assert.deepEqual(
    projectDeliveryOrdersFromSharedSnapshot([salon, finalized, rejected, active]).map((order) => order.id),
    ['delivery-active'],
  );
});

test('projeta consumo no local digital e mantém salão tradicional fora do fluxo digital', () => {
  const [digitalDineIn] = projectDeliveryOrdersFromSharedSnapshot([
    baseOrder({
      id: 'dine-in-digital',
      tipo: 'Consumo no Local',
      mesaId: 0,
      deliveryStatus: 'pendente',
      deliveryAddress: '',
      deliveryTax: 0,
    }),
  ]);

  assert.ok(digitalDineIn);
  assert.equal(digitalDineIn.modalidade, 'dine_in');
  assert.equal(digitalDineIn.status, 'pendente');
  assert.equal(digitalDineIn.endereco, '');

  const [associated] = projectDeliveryOrdersFromSharedSnapshot([
    baseOrder({
      id: 'dine-in-associated',
      tipo: 'Consumo no Local',
      mesaId: 7,
      deliveryStatus: 'producao',
      deliveryAddress: '',
      deliveryTax: 0,
    }),
  ]);

  assert.ok(associated);
  assert.equal(associated.modalidade, 'dine_in');
  assert.equal(associated.mesaId, 7);

  assert.equal(
    isCashierTableOrder(baseOrder({
      id: 'dine-in-associated',
      tipo: 'Consumo no Local',
      mesaId: 7,
      deliveryStatus: 'producao',
    })),
    false,
  );
  assert.equal(
    isCashierTableOrder(baseOrder({
      id: 'salon-traditional',
      tipo: 'Consumo no Local',
      mesaId: 7,
      deliveryStatus: null,
    })),
    true,
  );
});

test('não inventa pendente quando o snapshot não trouxe um estado digital autoritativo', () => {
  const missingStatus = baseOrder({ id: 'delivery-no-status', deliveryStatus: null });
  const unknownStatus = baseOrder({ id: 'delivery-unknown', deliveryStatus: 'legacy' as Order['deliveryStatus'] });

  assert.deepEqual(projectDeliveryOrdersFromSharedSnapshot([missingStatus, unknownStatus]), []);
});

test('preserva retirada e venda rápida do snapshot compartilhado', () => {
  const [projected] = projectDeliveryOrdersFromSharedSnapshot([
    baseOrder({
      id: 'pickup-1',
      tipo: 'Retirada',
      identificador: 'Balcão',
      clientePhone: '',
      deliveryAddress: 'Retirada no balcão',
      origemOperacional: 'caixa',
      deliveryTax: 0,
    }),
  ]);

  assert.equal(projected.modalidade, 'retirada');
  assert.equal(projected.endereco, '');
  assert.equal(projected.isQuickSale, true);
});

test('preserva a mesa de origem da retirada lançada pelo garçom', () => {
  const [projected] = projectDeliveryOrdersFromSharedSnapshot([
    baseOrder({
      id: 'pickup-waiter-1',
      tipo: 'Retirada',
      mesaId: 6,
      identificador: 'Mesa 06',
      garcomNome: 'Garçom Demo',
      origemOperacional: 'garcom',
      deliveryAddress: 'Retirada no balcão',
      deliveryTax: 0,
    }),
  ]);

  assert.equal(projected.modalidade, 'retirada');
  assert.equal(projected.mesaId, 6);
  assert.equal(projected.garcomNome, 'Garçom Demo');
  assert.equal(projected.isQuickSale, false);
});

test('workspace de entregadores exclui retirada e respeita etapas de despacho', () => {
  const projected = projectDeliveryOrdersFromSharedSnapshot([
    baseOrder({ id: 'delivery-preparing', deliveryStatus: 'producao' }),
    baseOrder({ id: 'delivery-ready', deliveryStatus: 'pronto' }),
    baseOrder({ id: 'delivery-route', deliveryStatus: 'transito' }),
    baseOrder({ id: 'delivery-pending', deliveryStatus: 'pendente' }),
    baseOrder({ id: 'pickup-ready', tipo: 'Retirada', deliveryStatus: 'pronto' }),
  ]);

  const buckets = bucketCourierDeliveryOrders(projected);

  assert.deepEqual(buckets.preparing.map((order) => order.id), [
    'delivery-preparing',
    'delivery-pending',
  ]);
  assert.deepEqual(buckets.ready.map((order) => order.id), ['delivery-ready']);
  assert.deepEqual(buckets.inTransit.map((order) => order.id), ['delivery-route']);
  assert.equal(
    [...buckets.preparing, ...buckets.ready, ...buckets.inTransit].some((order) => order.id === 'pickup-ready'),
    false,
  );
});


test('workspace de retiradas deriva pendentes, prontas e atrasadas do fluxo canônico', () => {
  const now = Date.parse('2026-09-14T12:20:00Z');
  const projected = projectDeliveryOrdersFromSharedSnapshot([
    baseOrder({
      id: 'pickup-pending',
      tipo: 'Retirada',
      identificador: 'Cliente pendente',
      origemOperacional: 'cardapio',
      deliveryStatus: 'pendente',
      created_at: '2026-09-14T12:10:00Z',
      timestamp: Date.parse('2026-09-14T12:10:00Z'),
    }),
    baseOrder({
      id: 'pickup-preparing-late',
      tipo: 'Retirada',
      identificador: 'Cliente atrasado',
      origemOperacional: 'cardapio',
      deliveryStatus: 'producao',
      created_at: '2026-09-14T11:40:00Z',
      timestamp: Date.parse('2026-09-14T11:40:00Z'),
    }),
    baseOrder({
      id: 'pickup-ready',
      tipo: 'Retirada',
      identificador: 'Cliente pronto',
      origemOperacional: 'cardapio',
      deliveryStatus: 'pronto',
      created_at: '2026-09-14T12:05:00Z',
      timestamp: Date.parse('2026-09-14T12:05:00Z'),
    }),
    baseOrder({
      id: 'pickup-quick-sale',
      tipo: 'Retirada',
      identificador: 'Balcão',
      clientePhone: '',
      origemOperacional: 'caixa',
      deliveryStatus: 'pronto',
      created_at: '2026-09-14T12:00:00Z',
      timestamp: Date.parse('2026-09-14T12:00:00Z'),
    }),
    baseOrder({
      id: 'delivery-ready',
      tipo: 'Entrega',
      deliveryStatus: 'pronto',
      created_at: '2026-09-14T11:30:00Z',
      timestamp: Date.parse('2026-09-14T11:30:00Z'),
    }),
  ]);

  const buckets = bucketPickupOrders(projected, now);

  assert.deepEqual(buckets.awaitingAcceptance.map((order) => order.id), ['pickup-pending']);
  assert.deepEqual(buckets.preparing.map((order) => order.id), ['pickup-preparing-late']);
  assert.deepEqual(buckets.ready.map((order) => order.id), ['pickup-ready']);
  assert.deepEqual(buckets.late.map((order) => order.id), ['pickup-preparing-late']);
  assert.equal(
    [...buckets.awaitingAcceptance, ...buckets.preparing, ...buckets.ready]
      .some((order) => order.id === 'pickup-quick-sale' || order.id === 'delivery-ready'),
    false,
  );
});
