import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getDigitalOrderPaymentSummary } from '../src/components/caixa/orders/digitalOrderPresentation';

const pickup = readFileSync(new URL('../src/components/caixa/orders/CashierPickups.tsx', import.meta.url), 'utf8');
const couriers = readFileSync(new URL('../src/components/caixa/orders/CashierCouriers.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8');
const orders = readFileSync(new URL('../src/components/caixa/orders/useCashierOrders.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../backend/app/routes/orders_core.py', import.meta.url), 'utf8');

test('payment summary deixa cobrança e troco explícitos no card operacional', () => {
  assert.equal(
    getDigitalOrderPaymentSummary({
      pago: false,
      amountDue: 48,
      paymentMethod: 'dinheiro',
      changeFor: 100,
    }),
    'A cobrar R$ 48,00 · Dinheiro · Troco para R$ 100,00',
  );
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
