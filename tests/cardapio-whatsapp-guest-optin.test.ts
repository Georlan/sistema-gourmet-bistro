import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const checkout = readFileSync(
  new URL('../src/cardapio/components/CardapioDigital.tsx', import.meta.url),
  'utf8',
);
const page = readFileSync(
  new URL('../src/cardapio/CardapioPage.tsx', import.meta.url),
  'utf8',
);

test('WhatsApp checkbox is optional, unchecked initially and behind a default-off rollout flag', () => {
  assert.match(checkout, /activeBrand.customerWhatsAppStatusEnabled === true/);
  assert.match(checkout, /useState\(false\)/);
  assert.match(checkout, /checked=\{whatsappStatusOptIn\}/);
  assert.match(checkout, /type="checkbox"/);
  assert.match(checkout, /id="checkout-whatsapp-status-opt-in"/);
  assert.match(checkout, /deliveryMethod !== "dine_in"/);
  assert.doesNotMatch(checkout, /required=\{true\}/);
});

test('customer consent is recorded only for the same checkout without adding auth steps', () => {
  assert.match(checkout, /whatsapp_status_opt_in: customerWhatsAppStatusEnabled && deliveryMethod !== "dine_in" && whatsappStatusOptIn/);
  assert.match(checkout, /body: JSON\.stringify\(\{\s*\.\.\.orderRequest,/);
  assert.match(checkout, /whatsapp_status_opt_in: undefined/);
  assert.match(checkout, /customerToken\) headers\["X-Koma-Customer-Token"\]/);
  assert.doesNotMatch(checkout, /requestOtp|verifyOtp|sendVerificationCode/);
});

test('existing realtime tracking remains mounted independent of checkout WhatsApp opt-in', () => {
  assert.match(page, /<CardapioDigital/);
  assert.match(page, /<CardapioOrdersDrawer/);
  assert.match(page, /handleRealtimeOrderStatus/);
  assert.match(checkout, /Acompanhar pedido ao vivo/);
});

test('checkout opt-in has a prominent accessible area without implied consent', () => {
  assert.match(checkout, /min-h-24/);
  assert.match(checkout, /focus-within:ring-2/);
  assert.match(checkout, /Receba atualizações deste pedido pelo WhatsApp/);
  assert.match(checkout, /É grátis e opcional, sem promoções/);
  assert.match(checkout, /whatsappStatusOptIn \?/);
});

test('integration settings separate operator number from independent customer permission', () => {
  const settings = readFileSync(
    new URL('../src/components/caixa/settings/CashierIntegrationsSettings.tsx', import.meta.url), 'utf8',
  );
  const control = readFileSync(
    new URL('../src/components/caixa/settings/CashierCustomerWhatsAppSettings.tsx', import.meta.url), 'utf8',
  );
  assert.match(settings, /role="tablist"/);
  assert.match(settings, /Pagamentos/);
  assert.match(settings, /WhatsApp/);
  assert.match(settings, /CashierCustomerWhatsAppSettings/);
  assert.match(control, /customer-notices/);
  assert.match(control, /não o telefone do restaurante/);
});
