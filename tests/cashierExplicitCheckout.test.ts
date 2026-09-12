import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controller = readFileSync(
  new URL('../src/components/caixa/checkout/useCheckoutController.ts', import.meta.url),
  'utf8',
);

function functionSlice(startMarker: string, endMarker: string): string {
  const start = controller.indexOf(startMarker);
  const end = controller.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return controller.slice(start, end);
}

test('checkout does not assume a payment method', () => {
  assert.match(
    controller,
    /const \[paymentMetodo, setPaymentMetodo\] = useState<[\s\S]*?'' \| 'dinheiro' \| 'pix'[\s\S]*?>\(''\);/,
  );
  assert.match(controller, /setPaymentMetodo\(''\);[\s\S]*?\}, \[selectedOrder\]\);/);

  const submit = functionSlice('const handleProcessPayment', 'const isItemReadyForCheckout');
  const missingMethodGuard = submit.indexOf("if (!paymentMetodo)");
  const processingLock = submit.indexOf('isProcessingPaymentRef.current = true');
  const firstRequest = submit.indexOf('operationalFetch(');

  assert.ok(missingMethodGuard >= 0, 'payment method must be validated explicitly');
  assert.ok(processingLock > missingMethodGuard, 'validation must happen before locking the submit flow');
  assert.ok(firstRequest > missingMethodGuard, 'validation must happen before any payment request');
  assert.match(submit, /Escolha a forma de pagamento antes de receber\./);
});

test('opening a table payment starts without hidden item selection or amount', () => {
  const openTable = functionSlice('const handleOpenTablePayment', 'const handleFinalizeDigitalOrder');

  assert.match(openTable, /setSelectedItemIds\(\[\]\);/);
  assert.match(openTable, /setPaymentMetodo\(''\);/);
  assert.match(openTable, /setPaymentValor\(''\);/);
  assert.doesNotMatch(openTable, /readyItemIds/);
});

test('generic salon receive also requires an explicit payment method', () => {
  const salonReceive = functionSlice('const handleReceiveSalonTable', 'const printCheckoutReceipt');
  assert.match(salonReceive, /setSelectedItemIds\(\[\]\);/);
  assert.match(salonReceive, /setPaymentMetodo\(''\);/);
});
