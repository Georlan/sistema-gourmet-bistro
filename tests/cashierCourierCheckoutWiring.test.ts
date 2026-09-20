import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(new URL('../src/components/CaixaPanel.tsx', import.meta.url), 'utf8');
const couriers = readFileSync(
  new URL('../src/components/caixa/orders/CashierCouriers.tsx', import.meta.url),
  'utf8',
);
const checkoutController = readFileSync(
  new URL('../src/components/caixa/checkout/useCheckoutController.ts', import.meta.url),
  'utf8',
);

function functionSlice(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('courier delivered action routes the delivery through the canonical checkout flow', () => {
  const courierBridge = functionSlice(
    panel,
    'const handleFinalizeCourierOrder',
    'const [autoAccept, setAutoAccept]',
  );

  assert.match(couriers, /runOrderAction\(order\.id, \(\) => handleFinalizarPedido\(order\.id\)\)/);
  assert.match(couriers, /pendingIdsRef\.current\.has\(orderId\)/);
  assert.match(panel, /handleFinalizarPedido=\{handleFinalizeCourierOrder\}/);
  assert.match(courierBridge, /deliveryOrders\.find\(\(order\) => order\.id === orderId\)/);
  assert.match(courierBridge, /await handleFinalizeDigitalOrder\(deliveryOrder\);/);
  assert.doesNotMatch(courierBridge, /handleFecharDelivery\(/);
});

test('canonical digital finalization opens checkout when unpaid and only closes directly when already paid', () => {
  const finalizeDigitalOrder = functionSlice(
    checkoutController,
    'const handleFinalizeDigitalOrder',
    'const handleReceiveSalonTable',
  );

  assert.match(finalizeDigitalOrder, /if \(order\.pago\) \{[\s\S]*?await handleFecharDelivery\(order\.id\);[\s\S]*?return;/);
  assert.match(finalizeDigitalOrder, /setSelectedOrder\(mappedOrder\);/);
  assert.match(finalizeDigitalOrder, /setShowCheckoutModal\(true\);/);
  assert.match(finalizeDigitalOrder, /setCheckoutServiceTax\(false\);/);
  assert.match(finalizeDigitalOrder, /setSelectedItemIds\(activeUnpaidItemIds\);/);
  assert.match(finalizeDigitalOrder, /dados financeiros deste pedido ainda estão sincronizando/);
  assert.match(finalizeDigitalOrder, /await onRefreshOrders\(\);/);
  assert.doesNotMatch(finalizeDigitalOrder, /handleFinalizarPedido\(order\.id\)/);
});
