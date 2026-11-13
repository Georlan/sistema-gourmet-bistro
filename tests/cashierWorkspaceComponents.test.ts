import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Order, OrderItem, Table } from '../src/types';
import { getCashierTableOrderPresentation, projectCashierTableSlices } from '../src/domain/cashierOrderProjection';
import { projectCashierSalonTables } from '../src/domain/cashierSalonProjection';
import { CaixaOrdersWorkspaceView as CaixaOrdersWorkspace, type CaixaOrdersWorkspaceProps } from '../src/components/caixa/orders/CaixaOrdersWorkspace';
import { CaixaSalonTab, type CaixaSalonTabProps } from '../src/components/caixa/salao/CaixaSalonTab';
import { CashierSalonCard } from '../src/components/caixa/salao/CashierSalonCard';
import { useCashierSalonProjection } from '../src/components/caixa/salao/useCashierSalonProjection';
import { CashierTableDestinations } from '../src/components/caixa/orders/CashierTableDestinations';
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
    acceptance: { orders: [], pendingOrderIds: new Set<string>(), automatic: false, drawerOpen: false, onAutomaticChange: noop, onDrawerChange: noop },
    navigation: { stage: 'salon', expandedCardIds: {}, onStageChange: noop, onToggleCard: noop },
    couriers: { options: [], loadState: 'loaded', selectedByOrderId: {}, onChange: noop, onRequestReassignment: noop },
    actions: { confirmCashPayment: noop, rejectCashPayment: noop, acceptDigitalOrder: noop,
      rejectDigitalOrder: noop, inspectTableOrder: noop, inspectDigitalOrder: noop, printConference: noop,
      markTableItemsReady: noop, advanceDigitalOrder: noop, dispatchDelivery: noop,
      openTablePayment: noop, finalizeDigitalOrder: noop },
    isLoading: false, now: NOW,
  };
}

test('fila de aceite usa status confirmado e bloqueia ações durante a transição', () => {
  const pending = digital({ id: 'online-69', status: 'pendente' });
  const base = workspace();
  const props: CaixaOrdersWorkspaceProps = {
    ...base,
    acceptance: { ...base.acceptance, drawerOpen: true, orders: [pending], pendingOrderIds: new Set(['online-69']) },
  };
  const pendingMarkup = renderToStaticMarkup(createElement(CaixaOrdersWorkspace, props));
  assert.match(pendingMarkup, /orders-pending-card/);
  assert.equal(button(CaixaOrdersWorkspace(props), 'Aceitar').props.disabled, true);
  assert.equal(button(CaixaOrdersWorkspace(props), 'Recusar').props.disabled, true);

  const acceptedMarkup = renderToStaticMarkup(createElement(CaixaOrdersWorkspace, {
    ...props,
    acceptance: { ...props.acceptance, orders: [], pendingOrderIds: new Set<string>() },
  }));
  assert.doesNotMatch(acceptedMarkup, /orders-pending-card p-4/);
});

test('aceite reaproveita composição persistida e preserva personalizações diferentes', () => {
  const base = workspace([]);
  const pending = digital({ status: 'pendente', itens: '2x Quentinha G', detailItems: [
    { nome: 'Quentinha G', observacao: 'Sem cebola - Opções: 2x Bisteca, Baião, Salada verde' },
    { nome: 'Quentinha G', observacao: 'Opções: Frango, Costela, Arroz, Vinagrete' },
    { nome: 'Cancelado', status: 'cancelado', observacao: 'Não produzir' },
  ] });
  const html = renderToStaticMarkup(createElement(CaixaOrdersWorkspace, {
    ...base, acceptance: { ...base.acceptance, drawerOpen: true, orders: [pending] },
  }));
  assert.match(html, /Sem cebola - Opções: 2x Bisteca, Baião, Salada verde/);
  assert.match(html, /Opções: Frango, Costela, Arroz, Vinagrete/);
  assert.doesNotMatch(html, /Não produzir|Cancelado/);
});

test('Marmitaria sem consumo local tem duas etapas e inicia no preparo no mobile', () => {
  const base = workspace([]);
  const html = renderToStaticMarkup(createElement(CaixaOrdersWorkspace, {
    ...base, restaurantConfig: { operation_profile: 'marmitaria', tipos_pedido_ativos: ['delivery'] },
  }));
  assert.doesNotMatch(html, /orders-column--salon|Mesas em Atendimento/);
  assert.match(html, /orders-board--marmitaria/);
  assert.match(html, /orders-column--digital[^"<]*is-mobile-active/);
  assert.match(html, /Entrega e recebimento/);
  assert.match(html, /grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/);
});

test('busca sem resultados não esconde um atendimento local ainda ativo', () => {
  const base = workspace([]);
  const html = renderToStaticMarkup(createElement(CaixaOrdersWorkspace, {
    ...base, hasLocalServiceWork: true, search: { query: 'inexistente', onChange: noop },
    restaurantConfig: { operation_profile: 'marmitaria', tipos_pedido_ativos: ['delivery'] },
  }));
  assert.match(html, /orders-column--salon/);
});

test('outros perfis e Marmitaria com consumo local ou mesas ativas preservam o salão', () => {
  const cases = [
    { base: workspace([]), config: { operation_profile: 'pizzaria', tipos_pedido_ativos: ['delivery'] } },
    { base: workspace([]), config: { operation_profile: 'generic', tipos_pedido_ativos: ['delivery'] } },
    { base: workspace([]), config: { operation_profile: 'marmitaria', tipos_pedido_ativos: ['delivery', 'consumo_local'] } },
    { base: workspace(), config: { operation_profile: 'marmitaria', tipos_pedido_ativos: ['delivery'] } },
    { base: workspace([]), config: { operation_profile: 'marmitaria' } },
  ];
  for (const { base, config } of cases) {
    const html = renderToStaticMarkup(createElement(CaixaOrdersWorkspace, { ...base, restaurantConfig: config }));
    assert.match(html, /orders-column--salon/);
    assert.doesNotMatch(html, /orders-board--marmitaria/);
  }
});

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
  assert.doesNotMatch(markup, /Conta pedida/);
  assert.deepEqual(props.columns.tableProduction[0].order.itens.map(entry => entry.status), ['preparando']);

  const requested = freeze(workspace([check({ statusComanda: 'aguardando_pagamento' })]));
  const requestedMarkup = renderToStaticMarkup(createElement(CaixaOrdersWorkspace, requested));
  assert.equal(requested.columns.tableProduction.length, 0);
  assert.match(requestedMarkup, /Conta pedida/);
  assert.match(requestedMarkup, /Item preparing/);
  assert.match(requestedMarkup, /Item ready/);
  assert.doesNotMatch(requestedMarkup, /itens no fechamento/);
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
  invoke(find(view, element => element.props['aria-label'] === 'Reimprimir Pedido #24'), 'onClick', click);
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

test('digital cards show choices per item without kitchen counters', () => {
  const base = workspace([]);
  const partial = digital({
    id: 'digital-kitchen-partial',
    numeroPedido: 31,
    detailItems: [
      { id: 'item-1', nome: 'Quentinha G', observacao: 'Opções: Bisteca, Baião', status: 'pronto' },
      { id: 'item-2', nome: 'Quentinha G', observacao: 'Opções: Frango, Arroz', status: 'preparando' },
    ],
  });
  const complete = digital({
    id: 'digital-kitchen-complete',
    numeroPedido: 32,
    detailItems: [
      { id: 'item-3', nome: 'Burger', status: 'pronto' },
      { id: 'item-4', nome: 'Batata', status: 'entregue' },
    ],
  });
  const props: CaixaOrdersWorkspaceProps = {
    ...base,
    columns: {
      ...base.columns,
      digitalProduction: [partial, complete],
    },
  };

  const markup = renderToStaticMarkup(createElement(CaixaOrdersWorkspace, props));
  assert.doesNotMatch(markup, /Cozinha|Aguarda avanço|data-kitchen-progress/);
  assert.match(markup, /1x<\/strong> Quentinha G<\/span><span[^>]*>Opções: Bisteca, Baião/);
  assert.match(markup, /1x<\/strong> Quentinha G<\/span><span[^>]*>Opções: Frango, Arroz/);
  const view = CaixaOrdersWorkspace(props);
  const readyButtons = elements(view).filter(
    element => element.type === 'button'
      && textOf(element).replace(/\s+/g, ' ').trim() === 'Pronto para retirada',
  );
  assert.equal(readyButtons.length, 2);
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
  invoke(button(view, 'Aceitar'), 'onClick');
  invoke(button(view, 'Recusar'), 'onClick');
  assert.deepEqual(calls, ['Varanda', true, payment, payment, pending, pending]);
});

test('Salão renders its current visual priorities and delegates table-scoped actions', () => {
  const orders = [check(), check({ id: 'check-25', mesaId: 8, statusComanda: 'aguardando_pagamento' })];
  const tables = [TABLE, { id: 8, capacidade: 2 }, { id: 9, capacidade: 4 }];
  const cards = projectCashierSalonTables(tables, orders, [], NOW);
  const calls: unknown[] = [];
  const props: CaixaSalonTabProps = freeze({ cards, visibleCards: cards,
    counts: { all: 3, free: 1, occupied: 1, payment: 1 },
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
  const cardButton = (cardView: ReactNode, action: string) => find(cardView, element =>
    element.type === 'button' && String(element.props['aria-label'] || '').startsWith(action));
  invoke(cardButton(cardViews[0], 'Ver comanda'), 'onClick');
  invoke(cardButton(cardViews[1], 'Ver comanda'), 'onClick');
  invoke(cardButton(cardViews[2], 'Abrir pedido'), 'onClick');
  invoke(button(view, 'Receber1'), 'onClick');
  assert.deepEqual(calls, [cards[0].tableOrders, cards[1].tableOrders, 9, 'payment']);
  assert.doesNotMatch(markup, /Contexto da mesa|Atendentes registrados|0 servidos|Transferir…|Consumo registrado|ATENDIMENTO NO LOCAL|koma-salon__summary/);
  for (const cardView of cardViews) assert.equal(elements(cardView).filter(element => element.type === 'button').length, 1);
  assert.match(markup, /aria-label="Ver comanda · Mesa 07, Varanda · Tem item pronto"/);
  assert.match(markup, /aria-label="Abrir pedido · Mesa 09 · Livre"/);
});

test('Salão directs a merged table to its real destination, without creating a second action', () => {
  const mergedOrder = check({ id: 'joined-check', mesaId: 7, mesaOrigemId: 8 });
  const projected = projectCashierSalonTables([TABLE, { id: 8, capacidade: 4 }], [mergedOrder], [], NOW);
  const source = projected.find(card => card.table.id === 8);
  assert.ok(source);
  assert.equal(source.isMerged, true);
  assert.equal(source.displayMesaId, 7);
  const inspected: unknown[] = [];
  const view = CashierSalonCard({ card: source, actions: {
    inspectTable: rows => inspected.push(rows),
    openTableOrder: id => inspected.push(id),
  } });
  const markup = renderToStaticMarkup(view);
  assert.match(markup, /Ver mesa 07/);
  assert.match(markup, /Atendimento na mesa 07/);
  assert.match(markup, /data-table-status="merged"/);
  assert.equal(elements(view).filter(element => element.type === 'button').length, 1);
  invoke(find(view, element => element.type === 'button'), 'onClick');
  assert.deepEqual(inspected, [source.tableOrders]);
});

test('Salão counts merged origins only in total, never duplicates their financial destination', () => {
  let counts: ReturnType<typeof useCashierSalonProjection>['tableStatusCounts'] | undefined;
  function Probe() {
    const state = useCashierSalonProjection({
      salonTables: [TABLE, { id: 8, capacidade: 2 }],
      orders: [check({ mesaId: 7, mesaOrigemId: 8, statusComanda: 'aguardando_pagamento' })],
      pagamentosPendentes: [], nowTimestamp: NOW,
    });
    counts = state.tableStatusCounts;
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  assert.deepEqual(counts, { all: 2, free: 0, occupied: 0, payment: 1 });
});

test('Salão keeps empty, error and filtered-empty states separate', () => {
  const base: CaixaSalonTabProps = { cards: [], visibleCards: [], counts: { all: 0, free: 0, occupied: 0, payment: 0 },
    filter: 'all', onFilterChange: noop,
    actions: { inspectTable: noop, openTableOrder: noop } };
  assert.match(renderToStaticMarkup(createElement(CaixaSalonTab, base)), /Nenhuma mesa cadastrada/);
  assert.match(renderToStaticMarkup(createElement(CaixaSalonTab, { ...base, fetchError: 'Sem conexão' })), /Não foi possível carregar as mesas/);
  const cards = projectCashierSalonTables([TABLE], [check()], [], NOW);
  assert.match(renderToStaticMarkup(createElement(CaixaSalonTab, { ...base, cards })), /Nenhuma mesa nesta situação/);
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
      printTableValues: () => calls.push('values'), transferTable: () => calls.push('transfer'), associateTable: noop, convertDeliveryToPickup: noop,
      cancelConsumption: () => calls.push('consumption'), cancelOrder: () => calls.push('order') },
  });
  const view = KanbanOrderDetails(props);
  const markup = renderToStaticMarkup(createElement(KanbanOrderDetails, props));
  assert.match(markup, /24-A/);
  assert.match(markup, /2×/);
  assert.doesNotMatch(markup, /Item cancelado/);
  assert.doesNotMatch(markup, /option value="7"/);
  for (const label of ['Reimprimir Total', 'Conta Total', 'Cancelar toda a mesa e liberar']) {
    invoke(button(view, label), 'onClick');
  }
  assert.deepEqual(calls, ['full', 'values', 'consumption']);
  const picker = elements(view).find(element => element.type === CashierTableDestinations)!;
  assert.equal(picker.props.transfer, props.transfer);
  assert.equal((picker.props.actions as KanbanOrderDetailsProps['actions']).transferTable, props.actions.transferTable);
  // DOM backdrop hit-testing and keyboard return are covered in the browser suite.
  const frame = elements(view)[0];

  invoke(frame, 'close');
  assert.equal(calls.at(-1), 'close');
  const salonView = KanbanOrderDetails({ ...props, salonActions: {
    addConsumption: () => calls.push('add'), receive: () => calls.push('receive'), canReceive: true,
  } });
  invoke(button(salonView, 'Adicionar itens'), 'onClick');
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
  assert.match(launchMarkup, /Ações da mesa/);
  assert.match(launchMarkup, /Cancelar somente este pedido/);
});

test('digital detail uses the same controlled advance and order-only cancellation actions', () => {
  const calls: string[] = [];
  const props: KanbanOrderDetailsProps = {
    order: { id: 'digital-25', mesaId: 0, numeroPedido: 25, modalidade: 'retirada', deliveryStatus: 'producao', itens: [] },
    transfer: { targetId: '', onTargetChange: noop, isTransferring: false, tables: [] },
    actions: { close: noop, advanceDigitalOrder: () => calls.push('advance'), reprintProduction: noop,
      printFullTable: noop, printTableValues: noop, transferTable: noop, associateTable: noop, convertDeliveryToPickup: noop, cancelConsumption: noop,
      cancelOrder: () => calls.push('order') },
  };
  const view = KanbanOrderDetails(props);
  assert.doesNotMatch(renderToStaticMarkup(createElement(KanbanOrderDetails, props)), /Marcar pronto para retirada/);
  invoke(button(view, 'Cancelar pedido'), 'onClick');
  assert.deepEqual(calls, ['order']);
  assert.doesNotMatch(renderToStaticMarkup(createElement(KanbanOrderDetails, props)), /Mesa de destino/);
});

test('digital dine-in keeps digital identity before and after table association', () => {
  const calls: string[] = [];
  const baseProps: KanbanOrderDetailsProps = {
    order: {
      id: 'digital-dine-in-1',
      mesaId: 0,
      numeroPedido: 51,
      modalidade: 'dine_in',
      deliveryStatus: 'producao',
      identificador: 'Cliente Local',
      itens: [],
    },
    transfer: {
      targetId: '7',
      onTargetChange: noop,
      isTransferring: false,
      tables: [{ id: 7 }],
    },
    actions: {
      close: noop,
      advanceDigitalOrder: () => calls.push('advance'),
      reprintProduction: noop,
      printFullTable: noop,
      printTableValues: noop,
      transferTable: noop,
      associateTable: () => calls.push('associate'),
      convertDeliveryToPickup: noop,
      cancelConsumption: noop,
      cancelOrder: noop,
    },
  };

  const unlinkedView = KanbanOrderDetails(baseProps);
  const unlinkedMarkup = renderToStaticMarkup(createElement(KanbanOrderDetails, baseProps));
  assert.match(unlinkedMarkup, /Consumo/);
  assert.doesNotMatch(unlinkedMarkup, /Marcar pronto para servir/);
  const picker = elements(unlinkedView).find(element => element.type === CashierTableDestinations)!;
  assert.equal(picker.props.association, true);
  (picker.props.actions as KanbanOrderDetailsProps['actions']).associateTable();
  assert.deepEqual(calls, ['associate']);

  const associatedProps: KanbanOrderDetailsProps = {
    ...baseProps,
    order: { ...baseProps.order, mesaId: 7 },
  };
  const associatedMarkup = renderToStaticMarkup(createElement(KanbanOrderDetails, associatedProps));
  assert.match(associatedMarkup, /Consumo/);
  assert.match(associatedMarkup, /Mesa 07/);
  assert.doesNotMatch(associatedMarkup, /Atendimento do salão/);
  assert.doesNotMatch(associatedMarkup, /Conta da Mesa|Reimpressão total/);
});

test('digital detail shows the payment method and requested cash change', () => {
  const props: KanbanOrderDetailsProps = {
    order: { id: 'digital-cash', mesaId: 0, numeroPedido: 49, modalidade: 'retirada', deliveryStatus: 'producao',
      paymentMethod: 'dinheiro', changeFor: 100, itens: [] },
    transfer: { targetId: '', onTargetChange: noop, isTransferring: false, tables: [] },
    actions: { close: noop, advanceDigitalOrder: noop, reprintProduction: noop, printFullTable: noop,
      printTableValues: noop, transferTable: noop, associateTable: noop, convertDeliveryToPickup: noop, cancelConsumption: noop, cancelOrder: noop },
  };

  const markup = renderToStaticMarkup(createElement(KanbanOrderDetails, props));
  assert.match(markup, /Pagamento no atendimento/);
  assert.match(markup, /dinheiro/i);
  assert.match(markup, /Troco para R\$\s*100,00/);
  const pixMarkup = renderToStaticMarkup(createElement(KanbanOrderDetails, {
    ...props, order: { ...props.order, paymentMethod: 'pix' },
  }));
  assert.doesNotMatch(pixMarkup, /Troco para/);
});


test('hamburgueria Pocket sem consumo local inicia no preparo e preserva salão ativo', () => {
  for (const active of [false, true]) {
    const html = renderToStaticMarkup(createElement(CaixaOrdersWorkspace, {
      ...workspace([]), hasPrinting: false, hasLocalServiceWork: active,
      restaurantConfig: { operation_profile: 'hamburgueria', tipos_pedido_ativos: ['delivery', 'retirada'] },
    }));
    if (active) assert.match(html, /orders-column--salon/);
    else {
      assert.doesNotMatch(html, /orders-column--salon/);
      assert.match(html, /orders-column--digital[^"<]*is-mobile-active/);
    }
  }
});


test('fila sem impressão mostra todos os itens e observações sem botão de recolher', () => {
  const base = workspace([]);
  const order = digital({ detailItems: [
    { nome: 'Hambúrguer', observacao: 'Sem cebola' },
    { nome: 'Batata', observacao: 'Bem passada' },
    { nome: 'Suco', observacao: 'Sem gelo' },
    { nome: 'Sobremesa', observacao: 'Separar embalagem' },
  ] });
  const html = renderToStaticMarkup(createElement(CaixaOrdersWorkspace, {
    ...base, hasPrinting: false, columns: { ...base.columns, digitalProduction: [order] },
  }));
  assert.match(html, /Sobremesa/);
  assert.match(html, /Separar embalagem/);
  assert.doesNotMatch(html, /mais itens \(expandir\)|Recolher itens/);
});

test('order details distinguish paid, online confirmation, and remaining balance', () => {
  const props: KanbanOrderDetailsProps = {
    order: { id: 'payment-detail', mesaId: 0, numeroPedido: 100, modalidade: 'delivery', deliveryStatus: 'producao', total: 40, itens: [] },
    transfer: { targetId: '', onTargetChange: noop, isTransferring: false, tables: [] },
    actions: { close: noop, advanceDigitalOrder: noop, reprintProduction: noop, printFullTable: noop,
      printTableValues: noop, transferTable: noop, associateTable: noop, convertDeliveryToPickup: noop, cancelConsumption: noop, cancelOrder: noop },
  };
  const render = (order: Partial<KanbanOrderDetailsProps['order']>) => renderToStaticMarkup(createElement(KanbanOrderDetails, { ...props, order: { ...props.order, ...order } }));
  const paidAtCounter = render({ amountPaid: 40, amountDue: 0, paymentMethod: 'dinheiro' });
  assert.match(paidAtCounter, /Não cobrar/);
  assert.doesNotMatch(paidAtCounter, /Pagamento online aprovado/);
  const approvedPartial = render({ onlinePaymentStatus: 'approved', amountPaid: 20, amountDue: 20, paymentMethod: 'cartao_credito' });
  assert.match(approvedPartial, /Cobrar na entrega/);
  assert.match(approvedPartial, /20,00/);
  assert.doesNotMatch(approvedPartial, /Não cobrar/);
  const paidWithoutMethod = render({ amountPaid: 40, amountDue: 0 });
  assert.match(paidWithoutMethod, /Não cobrar/);
  const approvedUnknown = render({ onlinePaymentStatus: 'approved' });
  assert.match(approvedUnknown, /Conferir pagamento/);
  assert.doesNotMatch(approvedUnknown, /Não cobrar/);
});
