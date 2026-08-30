import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { MesaConsumptionPanel } from '../src/components/mesas/MesaConsumptionPanel';
import { MesaTransferMergePanel } from '../src/components/mesas/MesaTransferMergePanel';
import { MesaPrintDialogs } from '../src/components/mesas/MesaPrintDialogs';
import { getCustomerSubtotals, getTableTotal } from '../src/domain';
import type { Order } from '../src/types';

const NOW = Date.UTC(2026, 7, 30, 15);
const table = { id: 7, nome: 'Mesa 7', capacidade: 4 };
const orders: Order[] = ['124-A', '124-AA'].map((displayNumber, index) => ({
  id: 'technical-check-124',
  checkId: 'technical-check-124',
  lancamentoId: `technical-launch-${index}`,
  displayNumber,
  numeroPedido: 124,
  mesaId: 7,
  garcomId: 'waiter-modal',
  garcomNome: 'Garçom Modal',
  timestamp: NOW - 12 * 60_000,
  statusComanda: null,
  itens: [{
    id: `technical-item-${index}`,
    lancamentoId: `technical-launch-${index}`,
    produtoId: `product-${index}`,
    nome: `Prato ${index}`,
    preco: index === 0 ? 112 : 48,
    observacao: '',
    clienteNome: 'Consumo Geral',
    status: index === 0 ? 'preparando' : 'pronto',
  }],
}));

const consumptionProps = (
  overrides: Partial<ComponentProps<typeof MesaConsumptionPanel>> = {},
): ComponentProps<typeof MesaConsumptionPanel> => ({
  table, orders, currentTime: NOW, activeRole: 'garcom',
  restauranteConfig: { taxa_servico_ativa: false, perm_garcom_fechar: false },
  totalValue: getTableTotal(orders), customerSubtotals: getCustomerSubtotals(orders),
  canTransferTables: true, canTransferItems: true,
  isPrintingDirect: false, directPrintToast: '', confirmClear: false,
  setActiveTab: () => {}, setTransferType: () => {}, setSelectedOrderToPrint: () => {}, setEditingItem: () => {},
  onPrintPreview: () => {}, onPrintValues: () => {}, onCancelItem: () => {}, onDeliverItem: () => {},
  ...overrides,
});

const movementProps = (
  overrides: Partial<ComponentProps<typeof MesaTransferMergePanel>> = {},
): ComponentProps<typeof MesaTransferMergePanel> => ({
  activeTab: 'transferir', table, orders, allOrders: orders,
  salonTables: [table, { id: 8, nome: 'Mesa 8', capacidade: 4 }], originIds: [],
  canTransferTables: true, canTransferItems: true, transferType: 'parcial',
  selectedItemsForTransfer: [], confirmTransferTo: null,
  setTransferType: () => {}, setSelectedItemsForTransfer: () => {}, setConfirmTransferTo: () => {},
  onTransferTable: () => {}, onTransferItems: () => {}, onMergeTables: () => {},
  ...overrides,
});

const printProps = (
  overrides: Partial<ComponentProps<typeof MesaPrintDialogs>> = {},
): ComponentProps<typeof MesaPrintDialogs> => ({
  table, orders, restaurantName: 'Restaurante Modal', activeWaiterNome: 'Garçom Modal',
  restauranteConfig: { taxa_servico_ativa: false },
  showPrintPreview: false, selectedOrderToPrint: null, printSuccess: false,
  setShowPrintPreview: () => {}, setSelectedOrderToPrint: () => {},
  ...overrides,
});

interface InspectableProps {
  title?: string;
  children?: ReactNode;
  id?: string;
  disabled?: boolean;
  onClick?: () => unknown;
}

function elements(node: ReactNode): ReactElement<InspectableProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<InspectableProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return isValidElement<InspectableProps>(node) ? textOf(node.props.children) : '';
}

test('consumo mantém lotes, IDs de DOM, valores e ações técnicas por lançamento', () => {
  const calls: unknown[] = [];
  const props = consumptionProps({
    setSelectedOrderToPrint: order => calls.push(['print', order.id, order.lancamentoId, order.displayNumber]),
    onDeliverItem: (checkId, itemId) => calls.push(['serve', checkId, itemId]),
  });
  const html = renderToStaticMarkup(createElement(MesaConsumptionPanel, props));
  assert.match(html, /id="placed-order-technical-launch-0"/);
  assert.match(html, /id="placed-order-technical-launch-1"/);
  assert.match(html, /124-A/);
  assert.match(html, /124-AA/);
  assert.match(html, /R\$ 160\.00/);
  const nodes = elements(MesaConsumptionPanel(props));
  nodes.filter(node => node.type === 'button' && textOf(node.props.children) === 'Reimprimir')
    .forEach(node => node.props.onClick!());
  nodes.find(node => node.type === 'button' && textOf(node.props.children) === 'Servir')!.props.onClick!();
  assert.deepEqual(calls, [
    ['print', 'technical-check-124', 'technical-launch-0', '124-A'],
    ['print', 'technical-check-124', 'technical-launch-1', '124-AA'],
    ['serve', 'technical-check-124', 'technical-item-1'],
  ]);
});

test('consumo preserva permissões e só encaminha a confirmação de fechamento ao owner', () => {
  let confirmations = 0;
  const props = consumptionProps({ onCloseTable: () => { confirmations += 1; } });
  assert.doesNotMatch(renderToStaticMarkup(createElement(MesaConsumptionPanel, props)), /close-table-btn-consumo/);
  const allowed = { ...props, restauranteConfig: { perm_garcom_fechar: true }, confirmClear: true };
  const node = elements(MesaConsumptionPanel(allowed)).find(entry => entry.props.id === 'close-table-btn-consumo')!;
  assert.equal(textOf(node.props.children), 'Confirmar Fechamento?');
  node.props.onClick!();
  assert.equal(confirmations, 1);
});

test('transferência parcial exige seleção e deixa confirmação/mutação com IDs técnicos no owner', () => {
  const calls: unknown[] = [];
  const props = movementProps({
    setConfirmTransferTo: destination => calls.push(['confirm', destination]),
    setSelectedItemsForTransfer: selection => calls.push(['selection', selection]),
    onTransferItems: (ids, destination) => calls.push(['transfer', ids, destination]),
  });
  const target = (overrides = {}) => elements(MesaTransferMergePanel({ ...props, ...overrides }))
    .find(node => node.props.id === 'transfer-target-mesa-8')!;
  assert.equal(target().props.disabled, true);
  target().props.onClick!();
  assert.deepEqual(calls, []);

  const selection = { selectedItemsForTransfer: ['technical-item-1'] };
  target(selection).props.onClick!();
  assert.deepEqual(calls, [['confirm', 8]]);
  target({ ...selection, confirmTransferTo: 8 }).props.onClick!();
  assert.deepEqual(calls, [
    ['confirm', 8], ['transfer', ['technical-item-1'], 8], ['selection', []], ['confirm', null],
  ]);
});

test('mesclagem preserva origem/destino e bloqueia mesa já mesclada', () => {
  const calls: unknown[] = [];
  const props = movementProps({
    activeTab: 'mesclar', confirmTransferTo: 8,
    onMergeTables: (source, destination) => calls.push([source, destination]),
  });
  elements(MesaTransferMergePanel(props)).find(node => node.props.id === 'merge-target-mesa-free-8')!.props.onClick!();
  assert.deepEqual(calls, [[7, 8]]);
  const blocked = renderToStaticMarkup(createElement(MesaTransferMergePanel, {
    ...props, allOrders: [...orders, { ...orders[0], mesaId: 8, mesaOrigemId: 9 }],
  }));
  assert.match(blocked, /id="merge-target-mesa-8" disabled=""/);
  assert.match(blocked, /Limite Atingido/);
});

test('diálogos não habilitam impressão nem exibem sucesso sem handlers reais', () => {
  const html = renderToStaticMarkup(createElement(MesaPrintDialogs, printProps({
    showPrintPreview: true, selectedOrderToPrint: orders[1],
  })));
  assert.match(html, /id="finalize-physical-print-btn" disabled=""/);
  assert.equal((html.match(/disabled=""/g) || []).length, 3);
  assert.doesNotMatch(html, /enviada com sucesso/);
});

test('diálogos encaminham extrato, valores e lançamento sem confundir identidade humana com técnica', () => {
  const calls: unknown[] = [];
  const props = printProps({
    showPrintPreview: true, selectedOrderToPrint: orders[1],
    onPrintReceipt: valuesOnly => { calls.push(['receipt', valuesOnly]); },
    onPrintKitchenLaunch: launchId => { calls.push(['kitchen', launchId]); },
  });
  const nodes = elements(MesaPrintDialogs(props));
  for (const label of ['Extrato Completo', 'Apenas Valores', 'Imprimir Via Cozinha']) {
    nodes.find(node => node.type === 'button' && textOf(node.props.children) === label)!.props.onClick!();
  }
  assert.deepEqual(calls, [['receipt', false], ['receipt', true], ['kitchen', 'technical-launch-1']]);
  const html = renderToStaticMarkup(createElement(MesaPrintDialogs, props));
  assert.match(html, /<strong>LOTE:<\/strong> #124-AA/);
  assert.doesNotMatch(html, /disabled=""|enviada com sucesso/);
});

test('editor recebe cliente e quantidade válida antes da confirmação', () => {
  const calls: unknown[] = [];
  const view = MesaConsumptionPanel(consumptionProps({ restauranteConfig: { perm_garcom_editar: true },
    setEditingItem: item => calls.push(item) }));
  const edit = elements(view).find(node => node.props.title === 'Editar observação do item')!;
  edit.props.onClick!();
  assert.deepEqual(calls, [{ id: 'technical-item-0', produtoId: 'product-0', nome: 'Prato 0',
    observacao: '', clienteNome: 'Consumo Geral', quantidade: 1, orderId: 'technical-check-124' }]);
});
