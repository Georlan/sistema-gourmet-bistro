import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bucketCourierDeliveryOrders,
  projectDeliveryOrdersFromSharedSnapshot,
} from '../src/components/caixa/orders/deliveryOrderProjection';
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

test('ignora salão e pedidos digitais já encerrados no snapshot inicial', () => {
  const salon = baseOrder({ id: 'table-1', mesaId: 9, tipo: 'Consumo no Local' });
  const finalized = baseOrder({ id: 'delivery-finalized', deliveryStatus: 'finalizado' });
  const rejected = baseOrder({ id: 'delivery-rejected', deliveryStatus: 'recusado' });
  const active = baseOrder({ id: 'delivery-active', deliveryStatus: 'pendente' });

  assert.deepEqual(
    projectDeliveryOrdersFromSharedSnapshot([salon, finalized, rejected, active]).map((order) => order.id),
    ['delivery-active'],
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

test('workspace de entregadores exclui retirada e respeita etapas de despacho', () => {
  const projected = projectDeliveryOrdersFromSharedSnapshot([
    baseOrder({ id: 'delivery-preparing', deliveryStatus: 'producao' }),
    baseOrder({ id: 'delivery-ready', deliveryStatus: 'pronto' }),
    baseOrder({ id: 'delivery-route', deliveryStatus: 'transito' }),
    baseOrder({ id: 'delivery-analysis', deliveryStatus: 'analise' }),
    baseOrder({ id: 'pickup-ready', tipo: 'Retirada', deliveryStatus: 'pronto' }),
  ]);

  const buckets = bucketCourierDeliveryOrders(projected);

  assert.deepEqual(buckets.preparing.map((order) => order.id), [
    'delivery-preparing',
    'delivery-analysis',
  ]);
  assert.deepEqual(buckets.ready.map((order) => order.id), ['delivery-ready']);
  assert.deepEqual(buckets.inTransit.map((order) => order.id), ['delivery-route']);
  assert.equal(
    [...buckets.preparing, ...buckets.ready, ...buckets.inTransit].some((order) => order.id === 'pickup-ready'),
    false,
  );
});
