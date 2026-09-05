import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Order, OrderItem, Table } from '../src/types';
import { getCashierTableOrderPresentation, projectCashierTableSlices } from '../src/domain/cashierOrderProjection';
import { projectCashierSalonTables } from '../src/domain/cashierSalonProjection';
import { CaixaOrdersWorkspace, type CaixaOrdersWorkspaceProps } from '../src/components/caixa/orders/CaixaOrdersWorkspace';
import { CaixaSalonTab, type CaixaSalonTabProps } from '../src/components/caixa/salao/CaixaSalonTab';
import { CashierSalonCard } from '../src/components/caixa/salao/CashierSalonCard';
import { KanbanOrderDetails, type KanbanOrderDetailsProps } from '../src/components/caixa/orders/KanbanOrderDetails';
import type { CashierTableCard, DeliveryOrderView } from '../src/components/caixa/orders/cashierWorkspaceTypes';

const NOW = Date.UTC(2026, 7, 30, 15, 30);
const TABLE: Table = { id: 7, nome: 'Varanda', capacidade: 4 };
const noop = () => {};
const item = (id: string, status: OrderItem['status'], preco: number): OrderItem => ({
  id, produtoId: id, nome: `Item ${id}`, status, preco, observacao: '', clienteNome: 'Consumo Geral',
  lancamentoId: 'launch-24-a',
});
const check = (extra: Partial<Order> = {}): Order => ({
  id: 'check-24', numeroPedido: 24, mesaId: 7, garcomId: 'waiter', garcomNome: 'Ana',
  timestamp: NOW - 120_000, tipo: 'Consumo no Local',
  itens: [item('preparing', 'preparando', 112), item('ready', 'pronto', 48)], ...extra,
});
const digital = (extra: Partial<DeliveryOrderView> = {}): DeliveryOrderView => ({
  id: 'digital-25', numeroPedido: 25, cliente: 'Cliente', telefone: '', itens: '1x Suco', total: 20,
  canal: 'site', origemOperacional: 'cardapio', isQuickSale: false, quantidadeItens: 1,
  modalidade: 'retirada', pago: false, status: 'producao', criadoEm: new Date(NOW - 60_000).toISOString(), ...extra,
});
const card = (order: CashierTableCard['order']): CashierTableCard => ({
  order, presentation: getCashierTableOrderPresentation(order, [TABLE]),
  tableMovement: { mergedMesaIds: [], transferredFromMesaIds: [] }, smartPosState: null,
});
function workspace(orders = [check()]): CaixaOrdersWorkspaceProps {
  const slices = projectCashierTableSlices(orders, [TABLE], NOW);
  return {
    columns: { tableProduction: slices.tableOrdersInProduction.map(card), digitalProduction: [],
      tableClosing: slices.tableOrdersReady.map(card), digitalFinalization: [] },
    pendingCashPayments: [], insights: { oldestOrder: '2 min', openValue: 160,
      actionMetric: { label: 'prontos para concluir', value: 1, needsAttention: true } },
    search: { query: '', onChange: noop },
    acceptance: { orders: [], automatic: false, drawerOpen: false, onAutomaticChange: noop, onDrawerChange: noop },
    navigation: { stage: 'salon', expandedCardIds: {}, onStageChange: noop, onToggleCard: noop },
    actions: { confirmCashPayment: noop, rejectCashPayment: noop, acceptDigitalOrder: noop,
      rejectDigitalOrder: noop, inspectTableOrder: noop, inspectDigitalOrder: noop, printConference: noop,
      markTableItemsReady: noop, advanceDigitalOrder: noop, openTablePayment: noop, finalizeDigitalOrder: noop },
    isLoading: false, now: NOW,
  };
}

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
function find(view: ReactNode, predicate: (element: ViewElement) => boolean): ViewElement {
  const found = elements(view).find(predicate);
  assert.ok(found, 'Expected control to be rendered');
  return found;
}
function button(view: ReactNode, label: string): ViewElement {
  return find(view, element => element.type === 'button'
    && textOf(element).replace(/\s+/g, ' ').trim() === label);
}
function invoke(element: ViewElement, eventName: string, event?: unknown) {
  const handler = element.props[eventName];
  assert.equal(typeof handler, 'function');
  (handler as (event?: unknown) => void)(event);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('workspace consumes frozen projections: 112/48 remain separate; requested bill remains 160', () => {
  const props = freeze(workspace());
  const markup = renderToStaticMarkup(createElement(CaixaOrdersWorkspace, props));
  assert.match(markup, /R\$\s*112,00/);
  assert.match(markup, /R\$\s*48,00/);
  assert.match(markup, /Receber itens prontos/);
  assert.doesNotMatch(markup, /CONTA PEDIDA/);
  assert.deepEqual(props.columns.tableProduction[0].order.itens.map(entry => entry.status), ['preparando']);

  const requested = freeze(workspace([check({ statusComanda: 'aguardando_pagamento' })]));
  const requestedMarkup = renderToStaticMarkup(createElement(CaixaOrdersWorkspace, requested));
  assert.equal(requested.columns.tableProduction.length, 0);
  assert.match(requestedMarkup, /CONTA PEDIDA/);
  assert.match(requestedMarkup, /2 itens no fechamento/);
  assert.doesNotMatch(requestedMarkup, /2 de 3|Valor dos itens prontos|Receber itens prontos/);
  assert.match(requestedMarkup, /R\$\s*160,00/);
  assert.deepEqual(requested.columns.tableClosing[0].order.itens.map(entry => entry.status), ['preparando', 'pronto']);
});

test('workspace preserves card keyboard guards and stops action clicks before delegation', () => {
  const props = workspace();
  const inspected: unknown[] = [];
  const acted: unknown[] = [];
  const view = CaixaOrdersWorkspace({ ...props, actions: { ...props.actions,
    inspectTableOrder: order => inspected.push(order), markTableItemsReady: order => acted.push(order),
    printConference: order => acted.push(order), openTablePayment: order => acted.push(order),
  } });
  const cardElement = find(view, element => element.props.role === 'button'
    && String(element.props.className).includes('orders-card--salon'));
  const target = {};
  let prevented = 0;
  invoke(cardElement, 'onKeyDown', { target: {}, currentTarget: target, key: 'Enter', preventDefault: () => prevented++ });
  assert.equal(inspected.length, 0);
  for (const key of ['Enter', ' ']) {
    invoke(cardElement, 'onKeyDown', { target, currentTarget: target, key, preventDefault: () => prevented++ });
  }
  assert.equal(prevented, 2);
  assert.deepEqual(inspected, [props.columns.tableProduction[0].order, props.columns.tableProduction[0].order]);

  let stopped = 0;
  const click = { stopPropagation: () => stopped++ };
  invoke(button(view, 'Marcar item como pronto'), 'onClick', click);
  invoke(find(view, element => element.props['aria-label'] === 'Imprimir conferência da Varanda'), 'onClick', click);
  invoke(button(view, 'Receber itens prontos'), 'onClick', click);
  assert.equal(stopped, 3);
  assert.deepEqual(acted, [props.columns.tableProduction[0].order, props.columns.tableProduction[0].order,
    props.columns.tableClosing[0].order]);
  assert.equal(inspected.length, 2);
});

test('digital actions and compact expansion are controlled without changing supplied order identity', () => {
  const base = workspace([]);
  const production = digital({ itens: '1x Primeiro + 1x Segundo + 1x Terceiro + 1x Último ingrediente' });
  const closing = digital({ id: 'paid-26', status: 'pronto', pago: true });
  const calls: unknown[] = [];
  const props: CaixaOrdersWorkspaceProps = { ...base,
    columns: { ...base.columns, digitalProduction: [production], digitalFinalization: [closing] },
    actions: { ...base.actions, advanceDigitalOrder: order => calls.push(order), finalizeDigitalOrder: order => calls.push(order) },
    navigation: { ...base.navigation, onToggleCard: id => calls.push(id) },
  };
  const view = CaixaOrdersWorkspace(props);
  let stopped = 0;
  invoke(button(view, 'Pronto para retirada'), 'onClick', { stopPropagation: () => stopped++ });
  invoke(button(view, 'Finalizar pedido'), 'onClick', { stopPropagation: () => stopped++ });
  invoke(button(view, '+ 1 mais itens (expandir)'), 'onClick', { stopPropagation: noop });
  assert.equal(stopped, 2);
  assert.deepEqual(calls, [production, closing, 'sim-prod-digital-25']);
  assert.doesNotMatch(renderToStaticMarkup(createElement(CaixaOrdersWorkspace, props)), /Último ingrediente/);
  const expanded = { ...props, navigation: { ...props.navigation, expandedCardIds: { 'sim-prod-digital-25': true } } };
  assert.match(renderToStaticMarkup(createElement(CaixaOrdersWorkspace, expanded)), /Último ingrediente/);
});

test('search, autoaccept and pending drawer report controlled changes and complete payment actions', () => {
  const base = workspace([]);
  const pending = digital({ status: 'pendente' });
  const payment = { id: 'cash-1', comanda_id: 'check-24', valor: 48, nome_cliente: 'Ana', mesaNum: 7 };
  const calls: unknown[] = [];
  const view = CaixaOrdersWorkspace({ ...base, pendingCashPayments: [payment],
    search: { query: '', onChange: value => calls.push(value) },
    acceptance: { ...base.acceptance, orders: [pending], drawerOpen: true,
      onAutomaticChange: value => calls.push(value), onDrawerChange: value => calls.push(value) },
    actions: { ...base.actions, confirmCashPayment: value => calls.push(value), rejectCashPayment: value => calls.push(value),
      acceptDigitalOrder: value => calls.push(value), rejectDigitalOrder: value => calls.push(value) },
  });
  invoke(find(view, element => element.props.placeholder === 'Buscar mesa, cliente, telefone ou item'), 'onChange', { target: { value: 'Varanda' } });
  invoke(find(view, element => element.props['aria-label'] === 'Aceitar pedidos online automaticamente'), 'onChange', { target: { checked: true } });
  invoke(button(view, 'Confirmar Recebimento'), 'onClick');
  invoke(button(view, 'Rejeitar'), 'onClick');
  invoke(button(view, '✓ Aceitar'), 'onClick');
  invoke(button(view, 'Recusar'), 'onClick');
  assert.deepEqual(calls, ['Varanda', true, payment, payment, pending, pending]);
});

test('Salão renders its current visual priorities and delegates table-scoped actions', () => {
  const orders = [check(), check({ id: 'check-25', mesaId: 8, statusComanda: 'aguardando_pagamento' })];
  const tables = [TABLE, { id: 8, capacidade: 2 }, { id: 9, capacidade: 4 }];
  const cards = projectCashierSalonTables(tables, orders, [], NOW);
  const calls: unknown[] = [];
  const props: CaixaSalonTabProps = freeze({ cards, visibleCards: cards,
    counts: { all: 3, free: 1, occupied: 1, payment: 1 }, insights: { occupancy: 67, openValue: 320, oldestService: '2 min' },
    filter: 'all', onFilterChange: filter => calls.push(filter),
    actions: { inspectTable: rows => calls.push(rows), openTableOrder: id => calls.push(id) },
  });
  const view = CaixaSalonTab(props);
  const markup = renderToStaticMarkup(createElement(CaixaSalonTab, props));
  assert.match(markup, /data-table-status="occupied"/);
  assert.match(markup, /data-table-status="payment"/);
  assert.match(markup, /data-table-status="free"/);
  const cardElements = elements(view).filter(element => element.type === CashierSalonCard);
  assert.equal(cardElements.length, 3);
  const cardViews = cardElements.map(element => CashierSalonCard(element.props as unknown as Parameters<typeof CashierSalonCard>[0]));
  invoke(button(cardViews[0], 'Ver comanda'), 'onClick');
  invoke(button(cardViews[1], 'Ver comanda'), 'onClick');
  invoke(button(cardViews[2], 'Abrir pedido'), 'onClick');
  invoke(button(view, 'Para receber 1'), 'onClick');
  assert.deepEqual(calls, [cards[0].tableOrders, cards[1].tableOrders, 9, 'payment']);
  assert.doesNotMatch(markup, /Contexto da mesa|Atendentes registrados|0 servidos|Transferir…/);
  for (const cardView of cardViews) assert.equal(elements(cardView).filter(element => element.type === 'button').length, 1);
});

test('Salão keeps empty, error and filtered-empty states separate', () => {
  const base: CaixaSalonTabProps = { cards: [], visibleCards: [], counts: { all: 0, free: 0, occupied: 0, payment: 0 },
    insights: { occupancy: 0, openValue: 0, oldestService: '—' }, filter: 'all', onFilterChange: noop,
    actions: { inspectTable: noop, openTableOrder: noop } };
  assert.match(renderToStaticMarkup(createElement(CaixaSalonTab, base)), /Nenhuma mesa cadastrada/);
  assert.match(renderToStaticMarkup(createElement(CaixaSalonTab, { ...base, fetchError: 'Sem conexão' })), /Não foi possível carregar o salão/);
  const cards = projectCashierSalonTables([TABLE], [check()], [], NOW);
  assert.match(renderToStaticMarkup(createElement(CaixaSalonTab, { ...base, cards })), /Nenhuma mesa neste filtro/);
});

test('details groups visible units and delegates print/transfer/cancellation without closing itself', () => {
  const calls: string[] = [];
  const props: KanbanOrderDetailsProps = freeze({
    order: { id: 'launch-24-a', comandaId: 'check-24', mesaId: 7, displayNumber: '24-A', contextoSalao: true,
      total: 20, itens: [{ nome: 'Suco', status: 'pronto', preco_unit: 10 }, { nome: 'Suco', status: 'pronto', preco: 10 },
        { nome: 'Item cancelado', status: 'cancelado', preco: 90 }] },
    transfer: { targetId: '8', isTransferring: false, tables: [TABLE, { id: 8 }], onTargetChange: value => calls.push(value) },
    actions: { close: () => calls.push('close'), advanceDigitalOrder: () => calls.push('advance'),
      reprintProduction: () => calls.push('production'), printFullTable: () => calls.push('full'),
      printTableValues: () => calls.push('values'), transferTable: () => calls.push('transfer'),
      cancelConsumption: () => calls.push('consumption'), cancelOrder: () => calls.push('order') },
  });
  const view = KanbanOrderDetails(props);
  const markup = renderToStaticMarkup(createElement(KanbanOrderDetails, props));
  assert.match(markup, /24-A/);
  assert.match(markup, /2×/);
  assert.doesNotMatch(markup, /Item cancelado/);
  assert.doesNotMatch(markup, /option value="7"/);
  for (const label of ['Reimprimir produção', 'Reimpressão total', 'Fechamento', 'Transferir', 'Cancelar toda a mesa e liberar']) {
    invoke(button(view, label), 'onClick');
  }
  assert.deepEqual(calls, ['production', 'full', 'values', 'transfer', 'consumption']);
  const backdrop = elements(view)[0];
  const target = {};
  invoke(backdrop, 'onClick', { target: {}, currentTarget: target });
  assert.equal(calls.length, 5);
  invoke(backdrop, 'onClick', { target, currentTarget: target });
  assert.equal(calls.at(-1), 'close');
  const salonView = KanbanOrderDetails({ ...props, salonActions: {
    addConsumption: () => calls.push('add'), receive: () => calls.push('receive'), canReceive: true,
  } });
  invoke(button(salonView, 'Adicionar consumo'), 'onClick');
  invoke(button(salonView, 'Receber'), 'onClick');
  assert.deepEqual(calls.slice(-2), ['add', 'receive']);
  const disabledView = KanbanOrderDetails({ ...props, salonActions: {
    addConsumption: noop, receive: noop, canReceive: false,
  } });
  assert.equal(button(disabledView, 'Receber').props.disabled, true);
  const launchMarkup = renderToStaticMarkup(createElement(KanbanOrderDetails, {
    ...props, order: { ...props.order, contextoSalao: false },
    salonActions: { addConsumption: noop, receive: noop, canReceive: true },
  }));
  assert.doesNotMatch(launchMarkup, /Ações da mesa/);
});

test('digital detail uses the same controlled advance and order-only cancellation actions', () => {
  const calls: string[] = [];
  const props: KanbanOrderDetailsProps = {
    order: { id: 'digital-25', mesaId: 0, numeroPedido: 25, modalidade: 'retirada', deliveryStatus: 'producao', itens: [] },
    transfer: { targetId: '', onTargetChange: noop, isTransferring: false, tables: [] },
    actions: { close: noop, advanceDigitalOrder: () => calls.push('advance'), reprintProduction: noop,
      printFullTable: noop, printTableValues: noop, transferTable: noop, cancelConsumption: noop,
      cancelOrder: () => calls.push('order') },
  };
  const view = KanbanOrderDetails(props);
  invoke(button(view, 'Marcar pronto para retirada'), 'onClick');
  invoke(button(view, 'Cancelar pedido'), 'onClick');
  assert.deepEqual(calls, ['advance', 'order']);
  assert.doesNotMatch(renderToStaticMarkup(createElement(KanbanOrderDetails, props)), /Mesa de destino/);
});