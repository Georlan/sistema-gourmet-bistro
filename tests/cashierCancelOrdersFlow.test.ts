import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Order, OrderItem, Table } from '../src/types';
import { isCashierTableOrder, projectCashierTableSlices } from '../src/domain/cashierOrderProjection';
import { CashierCancelConsumptionDialog } from '../src/components/caixa/orders/CashierCancelConsumptionDialog';

const NOW = Date.UTC(2026, 10, 4, 10, 55);
const TABLE_1: Table = { id: 1, nome: 'Mesa 01', capacidade: 4 };

const makeItem = (id: string, status: OrderItem['status'], preco: number, extra: Partial<OrderItem> = {}): OrderItem => ({
  id,
  produtoId: `prod-${id}`,
  nome: `Item ${id}`,
  status,
  preco,
  observacao: '',
  clienteNome: 'Georlan',
  pago: false,
  lancamentoId: 'launch-15-a',
  ...extra,
});

test('regressão específica do Pedido #15 (Mesa 01, 3x D8 Bacon, R$ 89,70) em Prontos e recebimentos classifica como order e não digital', () => {
  const items: OrderItem[] = [
    makeItem('item-15-1', 'pronto', 29.90, { nome: 'D8 Bacon' }),
    makeItem('item-15-2', 'pronto', 29.90, { nome: 'D8 Bacon' }),
    makeItem('item-15-3', 'pronto', 29.90, { nome: 'D8 Bacon' }),
  ];

  const order15: Order = {
    id: 'c-e5e82559',
    numeroPedido: 15,
    mesaId: 1,
    garcomId: 'waiter-1',
    garcomNome: 'Garçom',
    origemOperacional: 'garcom',
    tipo: 'Consumo no Local',
    statusComanda: null,
    deliveryStatus: null,
    valorPago: 0,
    timestamp: NOW,
    created_at: new Date(NOW).toISOString(),
    itens: items,
  };

  assert.equal(isCashierTableOrder(order15), true);

  const slices = projectCashierTableSlices([order15], [TABLE_1], NOW);
  assert.equal(slices.tableOrdersReady.length, 1);
  const readySlice = slices.tableOrdersReady[0];
  assert.equal(readySlice.projectionScope, 'table');
  assert.equal(readySlice.mesaId, 1);
  assert.equal(readySlice.itens.length, 3);

  // Verificando classificação canônica idêntica à do useCashierOrders:
  const mesaId = Number(readySlice.mesaId || 0);
  const hasTable = mesaId > 0;
  const isTraditionalTableOrder = hasTable && isCashierTableOrder({
    ...readySlice,
    tipo: readySlice.tipo || (readySlice as any).modalidade,
  });
  const isDigitalOrder = !isTraditionalTableOrder;

  assert.equal(isTraditionalTableOrder, true);
  assert.equal(isDigitalOrder, false);

  const activeItems = readySlice.itens.filter(
    (item: any) => String(item?.status || '').toLowerCase() !== 'cancelado' && item?.id
  );
  assert.equal(activeItems.length, 3);
  assert.deepEqual(activeItems.map((i: any) => i.id), ['item-15-1', 'item-15-2', 'item-15-3']);

  const total = activeItems.reduce((sum, it: any) => sum + (Number(it.preco_unit || it.preco) || 0), 0);
  assert.equal(Math.round(total * 100) / 100, 89.70);
});

test('pedido de garçom na coluna Salão com fatias de lançamento classifica como order', () => {
  const items: OrderItem[] = [
    makeItem('item-prep-1', 'preparando', 35.00),
    makeItem('item-prep-2', 'preparando', 15.00),
  ];

  const salonOrder: Order = {
    id: 'c-salon-01',
    numeroPedido: 20,
    mesaId: 2,
    garcomId: 'waiter-1',
    garcomNome: 'Garçom',
    origemOperacional: 'garcom',
    tipo: 'Consumo no Local',
    statusComanda: null,
    deliveryStatus: null,
    valorPago: 0,
    timestamp: NOW,
    created_at: new Date(NOW).toISOString(),
    itens: items,
  };

  const slices = projectCashierTableSlices([salonOrder], [{ id: 2, nome: 'Mesa 02', capacidade: 2 }], NOW);
  assert.equal(slices.tableOrdersInProduction.length, 1);
  const prodSlice = slices.tableOrdersInProduction[0];
  assert.equal(prodSlice.projectionScope, 'launch');

  const mesaId = Number(prodSlice.mesaId || 0);
  const isTraditional = mesaId > 0 && isCashierTableOrder({
    ...prodSlice,
    tipo: prodSlice.tipo,
  });
  assert.equal(isTraditional, true);
});

test('comanda com múltiplos lançamentos preserva itens de outros lançamentos', () => {
  const l1Items: OrderItem[] = [
    makeItem('it-l1-1', 'preparando', 25.00, { lancamentoId: 'l1' }),
  ];
  const l2Items: OrderItem[] = [
    makeItem('it-l2-1', 'preparando', 40.00, { lancamentoId: 'l2' }),
  ];

  const multiLaunchOrder: Order = {
    id: 'c-multi',
    numeroPedido: 30,
    mesaId: 3,
    garcomId: 'garcom-1',
    garcomNome: 'Garçom',
    origemOperacional: 'garcom',
    tipo: 'Consumo no Local',
    timestamp: NOW,
    itens: [...l1Items, ...l2Items],
  };

  const slices = projectCashierTableSlices([multiLaunchOrder], [{ id: 3, nome: 'Mesa 03', capacidade: 4 }], NOW);
  assert.equal(slices.tableOrdersInProduction.length, 2);

  const [sliceL1, sliceL2] = slices.tableOrdersInProduction;
  assert.equal(sliceL1.id, 'l1');
  assert.equal(sliceL1.itens.length, 1);
  assert.equal(sliceL1.itens[0].id, 'it-l1-1');

  assert.equal(sliceL2.id, 'l2');
  assert.equal(sliceL2.itens.length, 1);
  assert.equal(sliceL2.itens[0].id, 'it-l2-1');
});

test('pedidos digitais de Delivery e Retirada são classificados como digital mesmo se associados à mesa', () => {
  const deliveryOrder: Order = {
    id: 'c-del-1',
    numeroPedido: 40,
    mesaId: 0,
    garcomId: 'garcom-1',
    garcomNome: 'Garçom',
    origemOperacional: 'cardapio',
    tipo: 'Entrega',
    deliveryStatus: 'producao',
    timestamp: NOW,
    itens: [makeItem('it-del-1', 'preparando', 50)],
  };
  assert.equal(isCashierTableOrder(deliveryOrder), false);

  const associatedDeliveryOrder: Order = {
    ...deliveryOrder,
    mesaId: 5,
  };
  assert.equal(isCashierTableOrder(associatedDeliveryOrder), false);

  const pickupOrder: Order = {
    id: 'c-ret-1',
    numeroPedido: 41,
    mesaId: 6,
    garcomId: 'garcom-1',
    garcomNome: 'Garçom',
    origemOperacional: 'caixa',
    tipo: 'Retirada',
    deliveryStatus: 'pronto',
    timestamp: NOW,
    itens: [makeItem('it-ret-1', 'pronto', 30)],
  };
  assert.equal(isCashierTableOrder(pickupOrder), false);

  const onlineDineInOrder: Order = {
    id: 'c-cardapio-mesa',
    numeroPedido: 42,
    mesaId: 7,
    garcomId: 'garcom-1',
    garcomNome: 'Garçom',
    origemOperacional: 'cardapio',
    tipo: 'Consumo no Local',
    deliveryStatus: 'producao',
    timestamp: NOW,
    itens: [makeItem('it-online-1', 'preparando', 45)],
  };
  assert.equal(isCashierTableOrder(onlineDineInOrder), false);
});

test('CashierCancelConsumptionDialog exibe mensagens canônicas para escopos order, table e digital', () => {
  const orderMarkup = renderToStaticMarkup(createElement(CashierCancelConsumptionDialog, {
    cancelConsumptionTarget: {
      scope: 'order',
      mesaId: 1,
      comandas: 1,
      itens: 3,
      total: 89.70,
      itemIds: ['item-1', 'item-2', 'item-3'],
    },
    setCancelConsumptionTarget: () => {},
    isCancellingTable: false,
    cancelTableReason: '',
    setCancelTableReason: () => {},
    handleCancelTableConsumption: async () => {},
  }));
  assert.match(orderMarkup, /Cancelar somente este pedido\?/);
  assert.match(orderMarkup, /Somente os itens deste pedido serão cancelados; os demais pedidos da mesa serão preservados\./);
  assert.match(orderMarkup, /3/);
  assert.match(orderMarkup, /R\$\s*89,70/);

  const tableMarkup = renderToStaticMarkup(createElement(CashierCancelConsumptionDialog, {
    cancelConsumptionTarget: {
      scope: 'table',
      mesaId: 1,
      comandas: 2,
      itens: 5,
      total: 150.00,
      itemIds: ['item-1', 'item-2'],
    },
    setCancelConsumptionTarget: () => {},
    isCancellingTable: false,
    cancelTableReason: '',
    setCancelTableReason: () => {},
    handleCancelTableConsumption: async () => {},
  }));
  assert.match(tableMarkup, /Cancelar consumo e liberar Mesa 1\?/);
  assert.match(tableMarkup, /Todos os pedidos da mesa serão cancelados/);

  const digitalMarkup = renderToStaticMarkup(createElement(CashierCancelConsumptionDialog, {
    cancelConsumptionTarget: {
      scope: 'digital',
      intent: 'cancel',
      mesaId: 0,
      orderId: 'c-del-1',
      comandas: 1,
      itens: 1,
      total: 45.00,
      itemIds: ['item-1'],
    },
    setCancelConsumptionTarget: () => {},
    isCancellingTable: false,
    cancelTableReason: '',
    setCancelTableReason: () => {},
    handleCancelTableConsumption: async () => {},
  }));
  assert.match(digitalMarkup, /Cancelar este pedido\?/);
  assert.match(digitalMarkup, /O pedido sairá da operação ativa\./);

  const rejectMarkup = renderToStaticMarkup(createElement(CashierCancelConsumptionDialog, {
    cancelConsumptionTarget: {
      scope: 'digital',
      intent: 'reject',
      mesaId: 0,
      orderId: 'c-pend-1',
      comandas: 1,
      itens: 2,
      total: 60.00,
      itemIds: ['item-1', 'item-2'],
    },
    setCancelConsumptionTarget: () => {},
    isCancellingTable: false,
    cancelTableReason: '',
    setCancelTableReason: () => {},
    handleCancelTableConsumption: async () => {},
  }));
  assert.match(rejectMarkup, /Recusar este pedido\?/);
  assert.match(rejectMarkup, /O pedido não entrará em produção e o cliente receberá o motivo informado abaixo\./);
  assert.match(rejectMarkup, /Bloquear novos pedidos deste cliente/);
});
