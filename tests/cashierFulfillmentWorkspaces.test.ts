import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CashierCouriers } from '../src/components/caixa/orders/CashierCouriers';
import { CashierPickups } from '../src/components/caixa/orders/CashierPickups';
import { getDigitalOrderPaymentSummary } from '../src/components/caixa/orders/digitalOrderPresentation';

const pickup = readFileSync(new URL('../src/components/caixa/orders/CashierPickups.tsx', import.meta.url), 'utf8');
const couriers = readFileSync(new URL('../src/components/caixa/orders/CashierCouriers.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8');
const orders = readFileSync(new URL('../src/components/caixa/orders/useCashierOrders.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../backend/app/routes/orders_core.py', import.meta.url), 'utf8');

test('payment summary deixa cobrança e troco explícitos no card operacional', () => {
  const pending = getDigitalOrderPaymentSummary({
    pago: false,
    amountDue: 48,
    paymentMethod: 'dinheiro',
    changeFor: 100,
  });
  assert.match(pending, /A cobrar R\$\s*48,00/);
  assert.match(pending, /Dinheiro/);
  assert.match(pending, /Troco para R\$\s*100,00/);

  assert.equal(
    getDigitalOrderPaymentSummary({
      pago: true,
      amountDue: 0,
      paymentMethod: 'pix',
      changeFor: null,
    }),
    'Pago · Pix',
  );
});

test('Retiradas resolve o ciclo normal sem criar endpoints próprios', () => {
  assert.match(pickup, /handleAcceptPendingDeliveryOrder/);
  assert.match(pickup, /handleRejectPendingDeliveryOrder/);
  assert.match(pickup, /handleAdvanceDigitalOrder/);
  assert.match(pickup, /handleFinalizeDigitalOrder/);
  assert.match(pickup, /Aceitar pedido/);
  assert.match(pickup, /Marcar pronto para retirada/);
  assert.match(pickup, /Receber e concluir retirada/);
  assert.match(pickup, /Confirmar retirada/);
  assert.match(pickup, /getDigitalOrderPaymentSummary\(order\)/);
  assert.match(pickup, /pendingIdsRef\.current\.has\(order\.id\)/);
  assert.doesNotMatch(pickup, /delivery\/status\?status_novo/);
  assert.doesNotMatch(pickup, /\/comandas\/\$\{[^}]+\}\/fechar/);
});

test('Entregas resolve aceite, preparo, logística, cobrança e conclusão com ações canônicas', () => {
  assert.match(couriers, /handleAcceptPendingDeliveryOrder/);
  assert.match(couriers, /handleRejectPendingDeliveryOrder/);
  assert.match(couriers, /handleAdvanceDigitalOrder/);
  assert.match(couriers, /handleDespacharKanban/);
  assert.match(couriers, /handleFinalizarPedido/);
  assert.match(couriers, /Pré-atribuir entregador/);
  assert.match(couriers, /Marcar pronto para sair/);
  assert.match(couriers, /Saiu para entrega/);
  assert.match(couriers, /Receber e marcar entregue/);
  assert.match(couriers, /Marcar entregue/);
  assert.match(couriers, /getDigitalOrderPaymentSummary\(order\)/);
  assert.match(couriers, /pendingIdsRef\.current\.has\(orderId\)/);
  assert.match(couriers, /Gerenciar entregadores/);
  assert.match(couriers, /Entregas concluídas hoje/);
  assert.doesNotMatch(couriers, /delivery\/status\?status_novo/);
  assert.doesNotMatch(couriers, /\/comandas\/\$\{[^}]+\}\/fechar/);
});

test('workspaces recebem as mesmas ações do controller e expõem falha de sincronização sem zerar snapshot', () => {
  assert.match(panel, /deliveryOrdersLoadState=\{deliveryOrdersLoadState\}/);
  assert.match(panel, /handleAcceptPendingDeliveryOrder=\{handleAcceptPendingDeliveryOrder\}/);
  assert.match(panel, /handleRejectPendingDeliveryOrder=\{handleRejectPendingDeliveryOrder\}/);
  assert.match(panel, /handleAdvanceDigitalOrder=\{handleAdvanceDigitalOrder\}/);
  assert.match(panel, /openDeliveryOrderDetails=\{openDeliveryOrderDetails\}/);
  assert.match(orders, /setDeliveryOrdersLoadState\('error'\)/);
  assert.match(orders, /setDeliveryOrdersLoadState\('loaded'\)/);
  assert.match(pickup, /Mostrando o último estado conhecido/);
  assert.match(couriers, /Mostrando o último estado conhecido/);
});

test('histórico de entregas é leitura curta, tenant-scoped e não redefine transições', () => {
  assert.match(routes, /@router\.get\("\/delivery\/entregas\/concluidas-recentes"/);
  assert.match(routes, /Comanda\.restaurante_id == require_tenant_id\(\)/);
  assert.match(routes, /Comanda\.tipo\.in_\(\["Delivery", "Entrega"\]\)/);
  assert.match(routes, /Comanda\.fechada\.is_\(True\)/);
  assert.match(routes, /datetime\.timedelta\(hours=36\)/);
  assert.match(routes, /\.limit\(100\)/);
});


test('loading e erro mantêm feedback explícito sem exigir conhecimento do Kanban', () => {
  const pickupMarkup = renderToStaticMarkup(createElement(CashierPickups, {
    activeSubTab: 'retiradas',
    deliveryOrders: [],
    deliveryOrdersLoadState: 'loading',
    apiBaseUrl: 'http://example.test',
    authHeaders: {},
    now: Date.UTC(2026, 8, 20, 12),
    handleAcceptPendingDeliveryOrder: async () => {},
    handleRejectPendingDeliveryOrder: () => {},
    handleAdvanceDigitalOrder: async () => {},
    handleFinalizeDigitalOrder: async () => {},
    openDeliveryOrderDetails: () => {},
  }));
  assert.match(pickupMarkup, /Sincronizando retiradas/);
  assert.doesNotMatch(pickupMarkup, /Aceite no Kanban/);

  const courierMarkup = renderToStaticMarkup(createElement(CashierCouriers, {
    activeSubTab: 'entregadores',
    deliveryOrders: [],
    deliveryOrdersLoadState: 'error',
    selectedMotoboys: {},
    setSelectedMotoboys: () => {},
    motoboys: [],
    motoboysLoadState: 'loaded',
    hasCourierApp: false,
    handleDespacharKanban: async () => {},
    handleRevogarAcessoMotoboy: async () => {},
    handleFinalizarPedido: async () => true,
    handleAddMotoboy: async () => {},
    novoMotoboyNome: '',
    novoMotoboyTelefone: '',
    setNewMotoboyNome: () => {},
    setNewMotoboyTelefone: () => {},
    handleAcceptPendingDeliveryOrder: async () => {},
    handleRejectPendingDeliveryOrder: () => {},
    handleAdvanceDigitalOrder: async () => {},
    openDeliveryOrderDetails: () => {},
    onRequestCourierReassignment: () => {},
    apiBaseUrl: 'http://example.test',
    authHeaders: {},
    now: Date.UTC(2026, 8, 20, 12),
  } as any));
  assert.match(courierMarkup, /Mostrando o último estado conhecido/);
  assert.match(courierMarkup, /Gerenciar entregadores/);
});


test('controles do PWA do entregador falham fechados fora de courier_app sem bloquear delivery operacional', () => {
  const baseProps = {
    activeSubTab: 'entregadores',
    deliveryOrders: [],
    deliveryOrdersLoadState: 'loaded',
    selectedMotoboys: {},
    setSelectedMotoboys: () => {},
    motoboys: [{ id: 77, nome: 'Entregador Teste', telefone: '81999990000', ativo: true }],
    motoboysLoadState: 'loaded',
    handleDespacharKanban: async () => {},
    handleRevogarAcessoMotoboy: async () => {},
    handleFinalizarPedido: async () => true,
    handleAddMotoboy: async () => {},
    novoMotoboyNome: '',
    novoMotoboyTelefone: '',
    setNewMotoboyNome: () => {},
    setNewMotoboyTelefone: () => {},
    handleAcceptPendingDeliveryOrder: async () => {},
    handleRejectPendingDeliveryOrder: () => {},
    handleAdvanceDigitalOrder: async () => {},
    openDeliveryOrderDetails: () => {},
    onRequestCourierReassignment: () => {},
    apiBaseUrl: 'http://example.test',
    authHeaders: {},
    now: Date.UTC(2026, 8, 24, 12),
  } as any;

  const pocketMarkup = renderToStaticMarkup(createElement(CashierCouriers, {
    ...baseProps,
    hasCourierApp: false,
  }));
  assert.match(pocketMarkup, /Gerenciar entregadores/);
  assert.match(pocketMarkup, /Novo entregador/);
  assert.match(pocketMarkup, /atribuição e despacho continuam disponíveis sem o App do Entregador/);
  assert.doesNotMatch(pocketMarkup, /Revogar acesso/);

  const premiumMarkup = renderToStaticMarkup(createElement(CashierCouriers, {
    ...baseProps,
    hasCourierApp: true,
  }));
  assert.match(premiumMarkup, /Revogar acesso/);
  assert.match(premiumMarkup, /acesso ao App do Entregador/);
});

test('Caixa só libera controles do PWA com entitlement courier_app explicitamente true', () => {
  assert.match(panel, /const hasCourierApp = operationalEntitlementEnabled\(planEntitlements, 'courier_app'\);/);
  assert.match(panel, /hasCourierApp=\{hasCourierApp\}/);
  assert.match(couriers, /hasCourierApp && motoboy\.ativo/);
});

test('Caixa só monta estoque e relatórios quando o backend confirmou as capabilities', () => {
  assert.match(panel, /const hasInventory = operationalEntitlementEnabled\(planEntitlements, 'inventory'\);/);
  assert.match(panel, /const hasAdvancedReports = operationalEntitlementEnabled\(planEntitlements, 'advanced_reports'\);/);
  assert.match(panel, /active=\{hasInventory && activeTab === 'estoque'\}/);
  assert.match(panel, /active=\{hasAdvancedReports && \(activeTab === 'relatorios'/);
});
