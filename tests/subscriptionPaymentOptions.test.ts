import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAvailableSubscriptionPaymentOptions,
  getSubscriptionPaymentOption,
  getSubscriptionPaymentOptions,
} from '../src/config/subscriptionPaymentOptions';

test('mensal expõe cartão disponível e próximos meios sem torná-los selecionáveis', () => {
  const options = getSubscriptionPaymentOptions('mensal');
  assert.deepEqual(options.map((option) => option.id), [
    'credit_card',
    'pix_automatic',
    'nupay',
    'mercado_pago',
  ]);
  assert.deepEqual(getAvailableSubscriptionPaymentOptions('mensal').map((option) => option.id), ['credit_card']);
  assert.equal(getSubscriptionPaymentOption('pix_automatic').status, 'coming_soon');
});

test('anual expõe pix, nupay, mercado pago e parcelamento sem boleto', () => {
  const options = getSubscriptionPaymentOptions('anual');
  assert.deepEqual(options.map((option) => option.id), [
    'credit_card',
    'pix_annual',
    'nupay',
    'mercado_pago',
    'annual_installments',
  ]);
  assert.deepEqual(getAvailableSubscriptionPaymentOptions('anual').map((option) => option.id), ['credit_card']);
  assert.equal(getSubscriptionPaymentOption('pix_annual').status, 'validating');
  assert.equal(getSubscriptionPaymentOption('pix_annual').label, 'Pix');
  assert.equal(getSubscriptionPaymentOption('annual_installments').status, 'study');
});

test('somente opções explicitamente disponíveis podem ser selecionadas', () => {
  for (const cycle of ['mensal', 'anual'] as const) {
    const options = getSubscriptionPaymentOptions(cycle);
    for (const option of options) {
      assert.equal(option.selectable, option.status === 'available');
    }
  }
});

test('roadmap não promete liquidação NuPay no Mercado Pago nem subsídio de juros', () => {
  const nupay = getSubscriptionPaymentOption('nupay');
  const installments = getSubscriptionPaymentOption('annual_installments');
  assert.match(nupay.previewDescription, /integração própria/);
  assert.match(nupay.previewDescription, /Não vamos assumir que o valor liquida na conta Mercado Pago/);
  assert.match(installments.previewDescription, /sem o KÔMA bancar os juros/);
});
