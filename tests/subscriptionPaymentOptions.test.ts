import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBSCRIPTION_TRIAL_DAYS,
  getAvailableSubscriptionPaymentOptions,
  getSubscriptionPaymentOption,
  getSubscriptionPaymentOptions,
} from '../src/config/subscriptionPaymentOptions';

test('checkout mensal expõe exatamente cartão Pix Automático e Saldo Mercado Pago', () => {
  const options = getSubscriptionPaymentOptions('mensal');
  assert.deepEqual(options.map((option) => option.id), ['credit_card', 'pix_automatic', 'account_money']);
  assert.deepEqual(getAvailableSubscriptionPaymentOptions('mensal').map((option) => option.id), ['credit_card', 'pix_automatic', 'account_money']);
  assert.equal(SUBSCRIPTION_TRIAL_DAYS, 7);
  assert.equal(getSubscriptionPaymentOption('credit_card').automaticRenewal, true);
  assert.equal(getSubscriptionPaymentOption('pix_automatic').automaticRenewal, true);
  assert.equal(getSubscriptionPaymentOption('account_money').automaticRenewal, true);
});

test('Pix Automático é recorrente e preserva R$ 0 hoje', () => {
  const pix = getSubscriptionPaymentOption('pix_automatic');
  assert.equal(pix.selectable, true);
  assert.match(pix.checkoutSummary, /Pix Automático/);
  assert.match(pix.checkoutSummary, /sem cobrança/);
  assert.match(pix.previewDescription, /autorização da recorrência/);
  assert.match(pix.previewDescription, /Mercado Pago/);
});

test('anual mantém os mesmos três meios e preserva o trial', () => {
  const options = getSubscriptionPaymentOptions('anual');
  assert.deepEqual(options.map((option) => option.id), ['credit_card', 'pix_automatic', 'account_money']);
  assert.deepEqual(getAvailableSubscriptionPaymentOptions('anual').map((option) => option.id), ['credit_card', 'pix_automatic', 'account_money']);
  assert.match(getSubscriptionPaymentOption('credit_card').checkoutSummary, /7 dias grátis/);
  assert.match(getSubscriptionPaymentOption('account_money').checkoutSummary, /7 dias grátis/);
  assert.match(getSubscriptionPaymentOption('pix_automatic').previewDescription, /7 dias grátis/);
});
