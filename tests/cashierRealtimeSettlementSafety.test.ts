import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ordersOwner = read('src/components/caixa/orders/useCashierOrders.ts');
const checkoutOwner = read('src/components/caixa/checkout/useCheckoutController.ts');
const paymentBackend = read('backend/app/routes/caixa.py');

test('Caixa moves digital orders optimistically and keeps a visible-state reconciliation fallback', () => {
  assert.match(ordersOwner, /pendingDeliveryMutationRef/);
  assert.match(ordersOwner, /setDeliveryOrders\(\(current\) => optimisticStatus === 'remove'/);
  assert.match(ordersOwner, /await handleUpdateDeliveryStatus\(order\.id, isDeliveryOrder \? 'transito' : 'pronto'\)/);
  assert.match(ordersOwner, /window\.setInterval\([\s\S]*?5000\)/);
  assert.match(ordersOwner, /visibilitychange/);
  assert.match(ordersOwner, /await Promise\.all\(\[fetchDeliveryOrders\(\), onRefreshOrders\(\)\]\)/);
});

test('failed optimistic mutations rollback only the target order and ignore stale responses', () => {
  assert.match(ordersOwner, /deliveryMutationSequenceRef/);
  assert.match(
    ordersOwner,
    /pendingDeliveryMutationRef\.current\[orderId\] = \{ status: optimisticStatus, requestId \}/
  );
  assert.match(
    ordersOwner,
    /pendingDeliveryMutationRef\.current\[orderId\]\?\.requestId !== requestId/
  );
  assert.match(
    ordersOwner,
    /current\.map\(\(order\) => String\(order\.id\) === String\(orderId\) \? previousOrder : order\)/
  );
  assert.doesNotMatch(ordersOwner, /setDeliveryOrders\(previousDeliveryOrders\)/);
});

test('closing a digital order removes its card immediately after server confirmation', () => {
  assert.match(ordersOwner, /const handleFecharDelivery = async \(orderId: string\): Promise<boolean>/);
  assert.match(
    ordersOwner,
    /if \(res\.ok\) \{[\s\S]*?pendingDeliveryMutationRef\.current\[orderId\] = \{ status: 'remove', requestId: removalRequestId \};[\s\S]*?setDeliveryOrders\(\(current\) => current\.filter/
  );
  assert.match(ordersOwner, /return true;/);
  assert.match(ordersOwner, /return false;/);
});

test('checkout never assumes Pix or preselects every ready item', () => {
  assert.match(checkoutOwner, /'' \| 'dinheiro' \| 'pix'/);
  assert.match(checkoutOwner, /setPaymentMetodo\] = useState<[\s\S]*?>\(''\)/);
  assert.match(checkoutOwner, /Escolha a forma de pagamento antes de receber\./);

  const tableOpen = checkoutOwner.slice(
    checkoutOwner.indexOf('const handleOpenTablePayment'),
    checkoutOwner.indexOf('const handleFinalizeDigitalOrder')
  );
  assert.match(tableOpen, /setSelectedItemIds\(\[\]\)/);
  assert.match(tableOpen, /setPaymentMetodo\(''\)/);
  assert.doesNotMatch(tableOpen, /setSelectedItemIds\(readyItemIds\)/);

  const digitalOpen = checkoutOwner.slice(
    checkoutOwner.indexOf('const handleFinalizeDigitalOrder'),
    checkoutOwner.indexOf('const handleReceiveSalonTable')
  );
  assert.match(digitalOpen, /setSelectedItemIds\(\[\]\)/);
  assert.match(digitalOpen, /setPaymentMetodo\(''\)/);
  assert.doesNotMatch(digitalOpen, /activeUnpaidItemIds/);
});

test('full digital settlement removes stale card without issuing a duplicate close request', () => {
  assert.match(checkoutOwner, /const shouldRemoveDigitalOrder = !isMesaPayment/);
  assert.match(checkoutOwner, /removeDeliveryOrderId: selectedOrder\.id/);

  const processing = checkoutOwner.slice(
    checkoutOwner.indexOf('const handleProcessPayment'),
    checkoutOwner.indexOf('const isItemReadyForCheckout')
  );
  assert.doesNotMatch(processing, /handleFecharDelivery\(/);

  assert.match(paymentBackend, /comanda\.fechada = True/);
  assert.match(paymentBackend, /comanda\.delivery_status = "finalizado"/);
});
