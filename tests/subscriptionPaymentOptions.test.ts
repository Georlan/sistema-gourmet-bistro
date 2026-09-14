import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBSCRIPTION_TRIAL_DAYS,
  getAvailableSubscriptionPaymentOptions,
  getSubscriptionPaymentOption,
  getSubscriptionPaymentOptions,
} from '../src/config/subscriptionPaymentOptions';

test('mensal mantém cartão disponível e demais meios sob validação segura', () => {
  const options = getSubscriptionPaymentOptions('mensal');
  assert.deepEqual(options.map((option) => option.id), [
    'credit_card',
    'pix_automatic',
    'nupay',
    'mercado_pago',
  ]);
  assert.deepEqual(getAvailableSubscriptionPaymentOptions('mensal').map((option) => option.id), ['credit_card']);
  assert.equal(SUBSCRIPTION_TRIAL_DAYS, 7);
  assert.equal(getSubscriptionPaymentOption('credit_card').status, 'available');
  assert.equal(getSubscriptionPaymentOption('credit_card').selectable, true);
  assert.equal(getSubscriptionPaymentOption('pix_automatic').status, 'validating');
  assert.match(getSubscriptionPaymentOption('pix_automatic').checkoutSummary, /7 dias grátis/);
});

test('anual oferece cartão recorrente e preserva os 7 dias para depois do setup', () => {
  const options = getSubscriptionPaymentOptions('anual');
  assert.deepEqual(options.map((option) => option.id), [
    'credit_card',
    'pix_automatic',
    'nupay',
    'mercado_pago',
    'annual_installments',
  ]);
  assert.deepEqual(getAvailableSubscriptionPaymentOptions('anual').map((option) => option.id), ['credit_card']);
  assert.equal(getSubscriptionPaymentOption('annual_installments').status, 'study');
  assert.match(getSubscriptionPaymentOption('annual_installments').previewDescription, /7 dias grátis completos/);
  assert.match(getSubscriptionPaymentOption('annual_installments').previewDescription, /depois do setup essencial/);
  assert.doesNotMatch(JSON.stringify(options), /pix_annual|12 meses \+ 7 dias|dias adicionais de bônus/);
});

test('somente opções explicitamente disponíveis podem ser selecionadas', () => {
  for (const cycle of ['mensal', 'anual'] as const) {
    const options = getSubscriptionPaymentOptions(cycle);
    for (const option of options) {
      assert.equal(option.selectable, option.status === 'available');
    }
  }
});

test('métodos futuros só podem entrar se preservarem autorização, implantação e trial', () => {
  const nupay = getSubscriptionPaymentOption('nupay');
  const wallet = getSubscriptionPaymentOption('mercado_pago');
  const installments = getSubscriptionPaymentOption('annual_installments');
  assert.match(nupay.previewDescription, /R\$ 0 de mensalidade fixa hoje/);
  assert.match(nupay.previewDescription, /implantação sem consumir trial/);
  assert.match(wallet.previewDescription, /autorização sem cobrança, implantação sem consumir trial e 7 dias grátis completos/);
  assert.match(installments.previewDescription, /não exibirá pagamento antecipado disfarçado de trial/);
});
