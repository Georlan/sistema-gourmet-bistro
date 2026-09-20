import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaixaOrdersWorkspace, type CaixaOrdersWorkspaceProps } from '../src/components/caixa/orders/CaixaOrdersWorkspace';
import { KanbanOrderDetails, type KanbanOrderDetailsProps } from '../src/components/caixa/orders/KanbanOrderDetails';
import type { DeliveryOrderView } from '../src/components/caixa/orders/cashierWorkspaceTypes';

const noop = () => {};
const NOW = Date.UTC(2026, 8, 15, 16, 30);

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
      openTablePayment: noop,
      finalizeDigitalOrder: noop,
    },
    isLoading: false,
    now: NOW,
  };
}

test('kanban separa preparo, despacho e finalização de delivery', () => {
  const production = delivery({ id: 'delivery-production', status: 'producao' });
  const ready = delivery({ id: 'delivery-ready', status: 'pronto' });
  const transit = delivery({ id: 'delivery-transit', status: 'transito' });
  const calls: string[] = [];
  const base = workspaceProps();
  const view = CaixaOrdersWorkspace({
    ...base,
    columns: {
      ...base.columns,
      digitalProduction: [production],
      digitalFinalization: [ready, transit],
    },
    actions: {
      ...base.actions,
      advanceDigitalOrder: order => calls.push(`advance:${order.id}`),
      inspectDigitalOrder: order => calls.push(`inspect:${order.id}`),
      finalizeDigitalOrder: order => calls.push(`finalize:${order.id}`),
    },
  });

  invoke(button(view, 'Pronto para sair'), 'onClick', { stopPropagation: noop });
  invoke(button(view, 'Saiu para entrega'), 'onClick', { stopPropagation: noop });
  invoke(button(view, 'Receber e finalizar'), 'onClick', { stopPropagation: noop });

  assert.deepEqual(calls, [
    'advance:delivery-production',
    'inspect:delivery-ready',
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
      associateTable: noop,
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
