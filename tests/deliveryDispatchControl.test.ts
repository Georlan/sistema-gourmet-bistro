import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaixaOrdersWorkspace, type CaixaOrdersWorkspaceProps } from '../src/components/caixa/orders/CaixaOrdersWorkspace';
import { KanbanOrderDetails, type KanbanOrderDetailsProps } from '../src/components/caixa/orders/KanbanOrderDetails';
import type { DeliveryOrderView } from '../src/components/caixa/orders/cashierWorkspaceTypes';
import { projectApiComandaToDeliveryView } from '../src/components/caixa/orders/deliveryOrderProjection';

const noop = () => {};
const NOW = Date.UTC(2026, 8, 15, 16, 30);
const ordersRouteSource = readFileSync(new URL('../backend/app/routes/orders.py', import.meta.url), 'utf8');
const ordersCoreSource = readFileSync(new URL('../backend/app/routes/orders_core.py', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const cashierOrdersSource = readFileSync(new URL('../src/components/caixa/orders/useCashierOrders.ts', import.meta.url), 'utf8');
const cashierPanelSource = readFileSync(new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8');

type ViewElement = React.ReactElement<Record<string, unknown>>;
function elements(node: ReactNode): ViewElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return React.isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : '';
}
function button(view: ReactNode, label: string): ViewElement {
  const found = elements(view).find(element => element.type === 'button'
    && textOf(element).replace(/\s+/g, ' ').trim() === label);
  assert.ok(found, `Expected button ${label}`);
  return found;
}
function invoke(element: ViewElement, eventName: string, event?: unknown) {
  const handler = element.props[eventName];
  assert.equal(typeof handler, 'function');
  (handler as (event?: unknown) => void)(event);
}

const delivery = (extra: Partial<DeliveryOrderView> = {}): DeliveryOrderView => ({
  id: 'delivery-27',
  numeroPedido: 27,
  cliente: 'geo',
  telefone: '88999616937',
  itens: '1x Hambúrguer Bovino',
  total: 33,
  canal: 'site',
  origemOperacional: 'cardapio',
  isQuickSale: false,
  quantidadeItens: 1,
  modalidade: 'delivery',
  pago: false,
  status: 'producao',
  endereco: 'Rua de teste, 123',
  criadoEm: new Date(NOW - 60_000).toISOString(),
  ...extra,
});

function workspaceProps(): CaixaOrdersWorkspaceProps {
  return {
    columns: { tableProduction: [], digitalProduction: [], tableClosing: [], digitalFinalization: [] },
    pendingCashPayments: [],
    insights: { oldestOrder: '1 min', openValue: 33, actionMetric: { label: 'sem pendências', value: 0, needsAttention: false } },
    search: { query: '', onChange: noop },
    acceptance: { orders: [], automatic: false, drawerOpen: false, onAutomaticChange: noop, onDrawerChange: noop },
    navigation: { stage: 'digital', expandedCardIds: {}, onStageChange: noop, onToggleCard: noop },
    couriers: { options: [], loadState: 'loaded', selectedByOrderId: {}, onChange: noop, onRequestReassignment: noop },
    actions: {
      confirmCashPayment: noop,
      rejectCashPayment: noop,
      acceptDigitalOrder: noop,
      rejectDigitalOrder: noop,
      inspectTableOrder: noop,
      inspectDigitalOrder: noop,
      printConference: noop,
      markTableItemsReady: noop,
      advanceDigitalOrder: noop,
      dispatchDelivery: noop,
      openTablePayment: noop,
      finalizeDigitalOrder: noop,
    },
    isLoading: false,
    now: NOW,
  };
}



test('projeção digital canônica acompanha fulfillment atual sem acoplar pagamento ou histórico logístico', () => {
  const projected = projectApiComandaToDeliveryView({
    id: 'converted-1',
    numero_pedido: 91,
    tipo: 'Retirada',
    identificador: 'Cliente convertido',
    delivery_status: 'producao',
    delivery_endereco: 'Rua histórica, 10',
    delivery_telefone: '85999999999',
    delivery_taxa: 0,
    delivery_forma_pagamento: 'dinheiro',
    delivery_troco_para: 100,
    motoboy_id: null,
    valor_pago: 0,
    criado_em: '2026-09-25T18:00:00Z',
    lancamentos: [{ origem: 'cardapio' }],
    itens: [{
      id: 'item-1',
      status: 'preparando',
      pago: false,
      preco_unit: 33,
      produto: { nome: 'Hambúrguer' },
    }],
  });

  assert.ok(projected);
  assert.equal(projected.modalidade, 'retirada');
  assert.equal(projected.status, 'producao');
  assert.equal(projected.paymentMethod, 'dinheiro');
  assert.equal(projected.changeFor, 100);
  assert.equal(projected.motoboyId, null);
  assert.equal(projected.endereco, '');
  assert.equal(projected.total, 33);
  assert.equal(projected.amountDue, 33);
});

test('useCashierOrders delega a leitura de comanda para a projeção compartilhada', () => {
  assert.match(cashierOrdersSource, /const mapComandaToDeliveryView = projectApiComandaToDeliveryView;/);
  assert.doesNotMatch(cashierOrdersSource, /const mapComandaToDeliveryView = \(c: any\)/);
});

test('kanban separa preparo, despacho e finalização de delivery', () => {
  const production = delivery({ id: 'delivery-production', status: 'producao' });
  const ready = delivery({ id: 'delivery-ready', status: 'pronto' });
  const transit = delivery({ id: 'delivery-transit', status: 'transito', motoboyId: 7 });
  const calls: string[] = [];
  const base = workspaceProps();
  const view = CaixaOrdersWorkspace({
    ...base,
    columns: {
      ...base.columns,
      digitalProduction: [production],
      digitalFinalization: [ready, transit],
    },
    couriers: {
      options: [{ id: 7, nome: 'Pedro Silva', ativo: true }],
      loadState: 'loaded',
      selectedByOrderId: { 'delivery-ready': '7' },
      onChange: noop,
      onRequestReassignment: order => calls.push(`reassign:${order.id}`),
    },
    actions: {
      ...base.actions,
      advanceDigitalOrder: order => calls.push(`advance:${order.id}`),
      dispatchDelivery: (orderId, courierId) => calls.push(`dispatch:${orderId}:${courierId}`),
      finalizeDigitalOrder: order => calls.push(`finalize:${order.id}`),
    },
  });

  invoke(button(view, 'Pronto para sair'), 'onClick', { stopPropagation: noop });
  invoke(button(view, 'Saiu para entrega'), 'onClick', { stopPropagation: noop });
  invoke(button(view, 'Trocar entregador'), 'onClick', { stopPropagation: noop });
  invoke(button(view, 'Receber e finalizar'), 'onClick', { stopPropagation: noop });

  assert.deepEqual(calls, [
    'advance:delivery-production',
    'dispatch:delivery-ready:7',
    'reassign:delivery-transit',
    'finalize:delivery-transit',
  ]);
});

test('modal de despacho exige entregador e confirma saída com a atribuição selecionada', () => {
  const calls: string[] = [];
  const onChange = (value: string) => calls.push(`courier:${value}`);
  const baseProps: KanbanOrderDetailsProps = {
    order: {
      id: 'delivery-ready',
      mesaId: 0,
      numeroPedido: 27,
      modalidade: 'delivery',
      deliveryStatus: 'pronto',
      identificador: 'geo',
      telefone: '88999616937',
      total: 33,
      itens: [{ nome: 'Hambúrguer Bovino', status: 'pronto' }],
      courierAssignment: {
        value: null,
        options: [{ id: 7, nome: 'Pedro Silva' }],
        loading: false,
        onChange,
      },
    },
    transfer: { targetId: '', onTargetChange: noop, isTransferring: false, tables: [] },
    actions: {
      close: noop,
      advanceDigitalOrder: courierId => calls.push(`dispatch:${courierId || ''}`),
      reprintProduction: noop,
      printFullTable: noop,
      printTableValues: noop,
      transferTable: noop,
      associateTable: noop, convertDeliveryToPickup: noop,
      cancelConsumption: noop,
      cancelOrder: noop,
    },
  };

  const emptyView = KanbanOrderDetails(baseProps);
  const select = elements(emptyView).find(element => element.type === 'select'
    && element.props['aria-label'] === 'Entregador do pedido');
  assert.ok(select);
  invoke(select, 'onChange', { target: { value: '7' } });
  assert.equal(button(emptyView, 'Saiu para entrega').props.disabled, true);

  const selectedProps: KanbanOrderDetailsProps = {
    ...baseProps,
    order: {
      ...baseProps.order,
      courierAssignment: { ...baseProps.order.courierAssignment!, value: 7 },
    },
  };
  const selectedView = KanbanOrderDetails(selectedProps);
  assert.equal(button(selectedView, 'Saiu para entrega').props.disabled, false);
  invoke(button(selectedView, 'Saiu para entrega'), 'onClick');

  assert.deepEqual(calls, ['courier:7', 'dispatch:7']);
  assert.match(renderToStaticMarkup(createElement(KanbanOrderDetails, selectedProps)), /Pedro Silva/);
});



test('delivery pode virar retirada antes da rota e mantém exceção fora do fluxo normal', () => {
  const calls: string[] = [];
  const props: KanbanOrderDetailsProps = {
    order: {
      id: 'delivery-convert',
      mesaId: 0,
      numeroPedido: 44,
      modalidade: 'delivery',
      deliveryStatus: 'producao',
      identificador: 'Cliente mudou de ideia',
      total: 40,
      itens: [{ nome: 'Pizza', status: 'preparando' }],
      courierAssignment: {
        value: 7,
        options: [{ id: 7, nome: 'Pedro Silva' }],
        loading: false,
        onChange: noop,
      },
    },
    transfer: { targetId: '', onTargetChange: noop, isTransferring: false, tables: [] },
    actions: {
      close: noop,
      advanceDigitalOrder: noop,
      reprintProduction: noop,
      printFullTable: noop,
      printTableValues: noop,
      transferTable: noop,
      associateTable: noop,
      convertDeliveryToPickup: () => calls.push('convert'),
      cancelConsumption: noop,
      cancelOrder: noop,
    },
  };

  const preparingView = KanbanOrderDetails(props);
  invoke(button(preparingView, 'Alterar para retirada'), 'onClick');
  assert.deepEqual(calls, ['convert']);

  const transitView = KanbanOrderDetails({
    ...props,
    order: { ...props.order, deliveryStatus: 'transito' },
  });
  assert.equal(
    elements(transitView).filter(element => element.type === 'button'
      && textOf(element).replace(/\s+/g, ' ').trim() === 'Alterar para retirada').length,
    0,
  );

  const conversionRoute = ordersCoreSource
    .split('@router.post("/{comanda_id}/delivery/converter-retirada"', 2)[1]
    .split('@router.get("/delivery/retiradas/concluidas-recentes"', 1)[0];
  assert.match(conversionRoute, /comanda\.tipo = "Retirada"/);
  assert.match(conversionRoute, /comanda\.motoboy_id = None/);
  assert.match(conversionRoute, /comanda\.delivery_taxa = 0\.0/);
  assert.match(conversionRoute, /action="CONVERT_FULFILLMENT"/);
  assert.match(conversionRoute, /"type": "fulfillment_changed"/);
  assert.doesNotMatch(conversionRoute, /_agendar_notificacao_whatsapp_status/);
});


test('atribuição de entregador invalida Pedidos e Entregas em outros dispositivos pelo bridge realtime canônico', () => {
  const assignmentRoute = ordersRouteSource
    .split('@router.put("/{comanda_id}/delivery/entregador"', 2)[1]
    .split('@router.post("/{comanda_id}/delivery/despachar"', 1)[0];

  assert.match(assignmentRoute, /manager\.broadcast/);
  assert.match(assignmentRoute, /"event": "tables_updated"/);
  assert.match(appSource, /eventName === "tables_updated"/);
  assert.match(appSource, /window\.dispatchEvent\(new Event\('koma_orders_updated'\)\)/);
  assert.match(cashierOrdersSource, /window\.addEventListener\('koma_orders_updated', handleDeliveryUpdate\)/);
  assert.match(cashierOrdersSource, /void fetchDeliveryOrders\(\)/);
  assert.match(cashierPanelSource, /selectedByOrderId: selectedMotoboys/);
  assert.match(cashierPanelSource, /selectedMotoboys=\{selectedMotoboys\}/);
});

test('reconexão de WebSocket dispara reconciliação autoritativa de pedidos sem refresh manual', () => {
  const onopenSlice = appSource
    .split('socket.onopen = () => {', 2)[1]
    .split('socket.onmessage =', 1)[0];

  assert.match(onopenSlice, /const isReconnect = hasOpenedOnce;/);
  assert.match(onopenSlice, /if \(isReconnect\) \{/);
  assert.match(onopenSlice, /fetchOrdersFromAPI\(\);/);
  assert.match(onopenSlice, /window\.dispatchEvent\(new Event\('koma_orders_updated'\)\);/);
});

test('concorrência de atribuição: sincronização autoritativa elimina seleção fantasma no frontend', () => {
  const syncSlice = cashierOrdersSource
    .split('const syncSelectedMotoboysFromServer =', 2)[1]
    .split('const fetchDeliveryOrders =', 1)[0];

  assert.match(syncSlice, /order\.motoboyId \? String\(order\.motoboyId\) : ''/);
  assert.match(syncSlice, /applySelectedMotoboysState\(next\);/);
});

