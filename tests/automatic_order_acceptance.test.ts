import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CaixaOrdersWorkspaceView,
  type CaixaOrdersWorkspaceProps,
} from '../src/components/caixa/orders/CaixaOrdersWorkspace';
import {
  isPendingDeliveryComanda,
  projectApiComandaToDeliveryView,
} from '../src/components/caixa/orders/deliveryOrderProjection';
import { projectCashierDeliveryState } from '../src/domain/cashierOrderProjection';

const panel = readFileSync('src/components/CaixaPanel.tsx', 'utf8');
const workspace = readFileSync('src/components/caixa/orders/CaixaOrdersWorkspace.tsx', 'utf8');
const policyHook = readFileSync(
  'src/components/caixa/orders/useOnlineOrderAutoAcceptPolicy.ts',
  'utf8',
);
const controlClient = readFileSync(
  'src/components/caixa/online-menu/onlineOrdersControlClient.ts',
  'utf8',
);
const appSource = readFileSync('src/App.tsx', 'utf8');

function createWorkspaceProps(automatic: boolean): CaixaOrdersWorkspaceProps {
  const noop = () => {};
  return {
    columns: {
      tableProduction: [],
      digitalProduction: [],
      tableClosing: [],
      digitalFinalization: [],
    },
    pendingCashPayments: [],
    insights: {
      oldestOrder: '—',
      openValue: 0,
      actionMetric: { label: 'sem pendências', value: 0, needsAttention: false },
    },
    search: { query: '', onChange: noop },
    acceptance: {
      orders: [],
      pendingOrderIds: new Set<string>(),
      automatic,
      drawerOpen: true,
      onAutomaticChange: noop,
      onDrawerChange: noop,
    },
    navigation: {
      stage: 'delivery',
      expandedCardIds: {},
      onStageChange: noop,
      onToggleCard: noop,
    },
    couriers: {
      options: [],
      loadState: 'loaded',
      selectedByOrderId: {},
      onChange: noop,
      onRequestReassignment: noop,
    },
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
    now: Date.UTC(2026, 10, 22, 12, 0),
  };
}

test('autoaceite é uma política persistida no backend, não um executor do navegador', () => {
  assert.match(panel, /useOnlineOrderAutoAcceptPolicy/);
  assert.match(policyHook, /fetchOnlineOrdersControl/);
  assert.match(controlClient, /\/api\/online-orders\/control/);
  assert.match(policyHook, /\/api\/online-orders\/auto-accept/);
  assert.match(policyHook, /payload\?\.auto_accept/);
  assert.equal(workspace.includes('useAutomaticOrderAcceptance'), false);
  assert.equal(workspace.includes('AutomaticOrderAcceptanceEffect'), false);
});

test('useOnlineOrderAutoAcceptPolicy e App sincronizam eventos em tempo real e invalidam caches', () => {
  assert.match(
    policyHook,
    /window\.addEventListener\('koma_online_order_control_updated',\s*handleControlUpdated\)/,
  );
  assert.match(policyHook, /invalidateOnlineOrdersControlCache\(\)/);
  assert.match(
    policyHook,
    /window\.removeEventListener\('koma_online_order_control_updated',\s*handleControlUpdated\)/,
  );

  assert.match(appSource, /invalidateCardapioDigitalConfigCache/);
  assert.match(appSource, /invalidateOnlineOrdersControlCache/);
  assert.match(
    appSource,
    /eventName === "catalog_updated"[\s\S]*?window\.dispatchEvent\(new Event\('koma_catalog_updated'\)\)/,
  );
  assert.match(
    appSource,
    /eventName === "config_updated" \|\| eventName === "CONFIG_UPDATE"[\s\S]*?invalidateCardapioDigitalConfigCache\(\)[\s\S]*?data\.source === "online_order_control"[\s\S]*?invalidateOnlineOrdersControlCache\(\)[\s\S]*?window\.dispatchEvent\(new Event\('koma_online_order_control_updated'\)\)/,
  );
  assert.match(
    appSource,
    /eventName === "tables_updated" \|\| eventName === "TABLE_UPDATED"[\s\S]*?data\.source === "online_order_control"[\s\S]*?invalidateOnlineOrdersControlCache\(\)[\s\S]*?window\.dispatchEvent\(new Event\('koma_online_order_control_updated'\)\)/,
  );
});

test('drawer Novos pedidos exibe aviso claro quando aceite automático está ativo e remove backdrop-blur', () => {
  assert.doesNotMatch(workspace, /backdrop-blur/);

  const autoMarkup = renderToStaticMarkup(
    createElement(CaixaOrdersWorkspaceView, createWorkspaceProps(true)),
  );
  assert.match(autoMarkup, /Aceite automático ativo/);
  assert.match(autoMarkup, /Entregas, Retiradas ou Mesas/);
  assert.doesNotMatch(autoMarkup, /Nenhum pedido pendente/);
  assert.doesNotMatch(autoMarkup, /backdrop-blur/);

  const manualMarkup = renderToStaticMarkup(
    createElement(CaixaOrdersWorkspaceView, createWorkspaceProps(false)),
  );
  assert.match(manualMarkup, /Nenhum pedido pendente/);
  assert.doesNotMatch(manualMarkup, /pedidos online confirmados entram diretamente/i);
});

test('projeção preserva pedidos manuais, autoaceitos, agendados, consumo local e Pix pendente ou aprovado', () => {
  const baseComanda = {
    restaurante_id: 6,
    fechada: false,
    valor_pago: 0,
    delivery_taxa: 2,
    delivery_endereco: 'Rua Central, 10 - Bom Nome',
    delivery_telefone: '88999990000',
    criado_em: '2026-11-22T14:00:00Z',
    lancamentos: [{ id: 'l-1', origem: 'cardapio', status: 'pendente' }],
    itens: [
      {
        id: 'it-1',
        produto_id: 'qg',
        produto: { nome: 'Quentinha G' },
        preco_unit: 14,
        pago: false,
        status: 'preparando',
      },
    ],
  };

  const manualDelivery = { ...baseComanda, id: 'ord-manual', tipo: 'Delivery', delivery_status: 'pendente' };
  const autoDelivery = {
    ...baseComanda,
    id: 'ord-auto-del',
    tipo: 'Delivery',
    delivery_status: 'aceito',
    delivery_forma_pagamento: 'pix',
    online_payment_status: 'approved',
  };
  const autoPickupScheduled = {
    ...baseComanda,
    id: 'ord-auto-ret',
    tipo: 'Retirada',
    delivery_status: 'aceito',
    delivery_taxa: 0,
    scheduled_for: '2026-11-22T18:30:00Z',
  };
  const autoDineInPixReleased = {
    ...baseComanda,
    id: 'ord-auto-dine',
    tipo: 'Consumo no Local',
    delivery_status: 'producao',
    delivery_taxa: 0,
    delivery_forma_pagamento: 'pix',
    online_payment_status: 'pending_released',
  };

  assert.equal(isPendingDeliveryComanda(manualDelivery), true);
  assert.equal(isPendingDeliveryComanda(autoDelivery), false);

  const projectedAutoDelivery = projectApiComandaToDeliveryView(autoDelivery);
  assert.ok(projectedAutoDelivery);
  assert.equal(projectedAutoDelivery.modalidade, 'delivery');
  assert.equal(projectedAutoDelivery.pago, true);
  assert.equal(projectedAutoDelivery.amountDue, 0);
  assert.equal(projectCashierDeliveryState(projectedAutoDelivery.status, projectedAutoDelivery.modalidade).inProduction, true);

  const projectedPickup = projectApiComandaToDeliveryView(autoPickupScheduled);
  assert.ok(projectedPickup);
  assert.equal(projectedPickup.modalidade, 'retirada');
  assert.equal(projectedPickup.scheduledFor, '2026-11-22T18:30:00Z');
  assert.equal(projectCashierDeliveryState(projectedPickup.status, projectedPickup.modalidade).inProduction, true);

  const projectedDineIn = projectApiComandaToDeliveryView(autoDineInPixReleased);
  assert.ok(projectedDineIn);
  assert.equal(projectedDineIn.modalidade, 'dine_in');
  assert.equal(projectedDineIn.pago, false);
  assert.equal(projectedDineIn.amountDue, 14);
  assert.equal(projectedDineIn.onlinePaymentStatus, 'pending_released');
  assert.equal(projectCashierDeliveryState(projectedDineIn.status, projectedDineIn.modalidade).inProduction, true);
});
