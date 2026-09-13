import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBSCRIPTION_TRIAL_DAYS,
  getAvailableSubscriptionPaymentOptions,
  getSubscriptionPaymentOption,
  getSubscriptionPaymentOptions,
} from '../src/config/subscriptionPaymentOptions';

test('mensal expõe cartão e Pix Automático sob a mesma política de trial', () => {
  const options = getSubscriptionPaymentOptions('mensal');
  assert.deepEqual(options.map((option) => option.id), [
    'credit_card',
    'pix_automatic',
    'nupay',
    'mercado_pago',
  ]);
  assert.deepEqual(getAvailableSubscriptionPaymentOptions('mensal').map((option) => option.id), []);
  assert.equal(SUBSCRIPTION_TRIAL_DAYS, 7);
  assert.equal(getSubscriptionPaymentOption('credit_card').status, 'validating');
  assert.equal(getSubscriptionPaymentOption('pix_automatic').status, 'validating');
  assert.match(getSubscriptionPaymentOption('pix_automatic').checkoutSummary, /7 dias grátis/);
});

test('anual não oferece Pix antecipado e mantém a cobrança recorrente depois do trial', () => {
  const options = getSubscriptionPaymentOptions('anual');
  assert.deepEqual(options.map((option) => option.id), [
    'credit_card',
    'pix_automatic',
    'nupay',
    'mercado_pago',
    'annual_installments',
  ]);
  assert.deepEqual(getAvailableSubscriptionPaymentOptions('anual').map((option) => option.id), []);
  assert.equal(getSubscriptionPaymentOption('annual_installments').status, 'study');
  assert.match(getSubscriptionPaymentOption('annual_installments').previewDescription, /7 dias grátis/);
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

test('métodos futuros só podem entrar se cumprirem autorização recorrente e trial', () => {
  const nupay = getSubscriptionPaymentOption('nupay');
  const wallet = getSubscriptionPaymentOption('mercado_pago');
  const installments = getSubscriptionPaymentOption('annual_installments');
  assert.match(nupay.previewDescription, /R\$ 0 de mensalidade fixa hoje/);
  assert.match(wallet.previewDescription, /autorização hoje, 7 dias grátis e primeira cobrança automática depois/);
  assert.match(installments.previewDescription, /não exibirá pagamento antecipado disfarçado de trial/);
});
