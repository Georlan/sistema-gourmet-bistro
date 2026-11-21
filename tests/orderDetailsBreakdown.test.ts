import assert from 'node:assert/strict';
import test from 'node:test';
import { computeOrderPriceBreakdown } from '../src/components/caixa/orders/KanbanOrderDetails';
import {
  projectApiComandaToDeliveryView,
  projectDeliveryOrdersFromSharedSnapshot,
} from '../src/components/caixa/orders/deliveryOrderProjection';

test('projectApiComandaToDeliveryView preserves subtotal, deliveryFee, discountAmount and per-item prices', () => {
  const projected = projectApiComandaToDeliveryView({
    id: 'order-167',
    numero_pedido: 167,
    identificador: 'Georlan',
    tipo: 'Delivery',
    delivery_status: 'pronto',
    delivery_endereco: 'Rua Teste, 22, Centro - Maragogi/AL',
    delivery_forma_pagamento: 'dinheiro',
    delivery_taxa: 2,
    valor_desconto_cupom: 0,
    valor_desconto_cashback: 0,
    valor_pago: 0,
    itens: [
      {
        id: 'item-1',
        nome: 'Quentinha P',
        preco_unit: 12,
        status: 'pronto',
        pago: false,
      },
      {
        id: 'item-2',
        nome: 'Quentinha M',
        preco_unit: 13,
        status: 'pronto',
        pago: false,
      },
    ],
  });

  assert.ok(projected);
  assert.equal(projected.subtotal, 25);
  assert.equal(projected.deliveryFee, 2);
  assert.equal(projected.discountAmount, 0);
  assert.equal(projected.total, 27);
  assert.equal(projected.detailItems?.length, 2);
  assert.equal(projected.detailItems?.[0]?.preco_unit, 12);
  assert.equal(projected.detailItems?.[1]?.preco_unit, 13);
});

test('computeOrderPriceBreakdown explains total from items subtotal, delivery fee and discount', () => {
  const breakdown = computeOrderPriceBreakdown(
    {
      id: 'order-167',
      mesaId: 0,
      modalidade: 'delivery',
      total: 27,
      subtotal: 25,
      deliveryFee: 2,
      discountAmount: 0,
      itens: [
        { id: 'item-1', nome: 'Quentinha P', preco_unit: 12, status: 'pronto' },
        { id: 'item-2', nome: 'Quentinha M', preco_unit: 13, status: 'pronto' },
      ],
    },
    true,
  );

  assert.deepEqual(breakdown, {
    totalUnits: 2,
    itemsSubtotal: 25,
    inferredDeliveryFee: 2,
    discountAmount: 0,
    total: 27,
  });
});

test('computeOrderPriceBreakdown infers delivery fee and discount when only items and total are present', () => {
  const inferredDelivery = computeOrderPriceBreakdown(
    {
      id: 'order-168',
      mesaId: 0,
      modalidade: 'delivery',
      total: 27,
      itens: [
        { id: 'item-1', nome: 'Quentinha P', preco: 12, status: 'preparando' },
        { id: 'item-2', nome: 'Quentinha M', preco: 13, status: 'preparando' },
      ],
    },
    true,
  );

  assert.equal(inferredDelivery.itemsSubtotal, 25);
  assert.equal(inferredDelivery.inferredDeliveryFee, 2);
  assert.equal(inferredDelivery.discountAmount, 0);
  assert.equal(inferredDelivery.total, 27);

  const withDiscount = computeOrderPriceBreakdown(
    {
      id: 'order-169',
      mesaId: 0,
      modalidade: 'delivery',
      total: 24,
      deliveryFee: 5,
      discountAmount: 6,
      itens: [
        { id: 'item-1', nome: 'Quentinha P', preco_unit: 12, status: 'preparando' },
        { id: 'item-2', nome: 'Quentinha M', preco_unit: 13, status: 'preparando' },
      ],
    },
    true,
  );

  assert.equal(withDiscount.itemsSubtotal, 25);
  assert.equal(withDiscount.inferredDeliveryFee, 5);
  assert.equal(withDiscount.discountAmount, 6);
  assert.equal(withDiscount.total, 24);
});

test('projectDeliveryOrdersFromSharedSnapshot propagates subtotal, deliveryFee and discountAmount', () => {
  const views = projectDeliveryOrdersFromSharedSnapshot([
    {
      id: 'shared-1',
      mesaId: 0,
      tipo: 'delivery',
      deliveryStatus: 'producao',
      deliveryAddress: 'Rua B, 10',
      deliveryTax: 4,
      discountTotal: 2,
      payableTotal: 27,
      identificador: 'Maria',
      itens: [
        { id: 'i1', nome: 'Quentinha P', preco: 12, status: 'preparando' } as any,
        { id: 'i2', nome: 'Quentinha M', preco: 13, status: 'preparando' } as any,
      ],
    } as any,
  ]);

  assert.equal(views.length, 1);
  assert.equal(views[0].subtotal, 25);
  assert.equal(views[0].deliveryFee, 4);
  assert.equal(views[0].discountAmount, 2);
  assert.equal(views[0].total, 27);
});
