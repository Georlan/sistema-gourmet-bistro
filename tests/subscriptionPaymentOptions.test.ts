import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBSCRIPTION_TRIAL_DAYS,
  getAvailableSubscriptionPaymentOptions,
  getSubscriptionPaymentOption,
  getSubscriptionPaymentOptions,
} from '../src/config/subscriptionPaymentOptions';

test('checkout mensal expõe exatamente cartão Pix e Saldo Mercado Pago', () => {
  const options = getSubscriptionPaymentOptions('mensal');
  assert.deepEqual(options.map((option) => option.id), ['credit_card', 'pix', 'account_money']);
  assert.deepEqual(getAvailableSubscriptionPaymentOptions('mensal').map((option) => option.id), ['credit_card', 'pix', 'account_money']);
  assert.equal(SUBSCRIPTION_TRIAL_DAYS, 7);
  assert.equal(getSubscriptionPaymentOption('credit_card').automaticRenewal, true);
  assert.equal(getSubscriptionPaymentOption('pix').automaticRenewal, false);
  assert.equal(getSubscriptionPaymentOption('account_money').automaticRenewal, true);
});

test('Pix é universal e não se apresenta como Pix Automático', () => {
  const pix = getSubscriptionPaymentOption('pix');
  assert.equal(pix.selectable, true);
  assert.match(pix.checkoutSummary, /QR Code e Copia e Cola/);
  assert.match(pix.checkoutSummary, /qualquer banco\/PSP Pix/);
  assert.match(pix.previewDescription, /próprio KÔMA/);
  assert.doesNotMatch(JSON.stringify(pix), /Pix Automático|preapproval/i);
});

test('anual mantém os mesmos três meios e preserva o trial', () => {
  const options = getSubscriptionPaymentOptions('anual');
  assert.deepEqual(options.map((option) => option.id), ['credit_card', 'pix', 'account_money']);
  assert.deepEqual(getAvailableSubscriptionPaymentOptions('anual').map((option) => option.id), ['credit_card', 'pix', 'account_money']);
  assert.match(getSubscriptionPaymentOption('credit_card').checkoutSummary, /7 dias grátis/);
  assert.match(getSubscriptionPaymentOption('account_money').checkoutSummary, /7 dias grátis/);
  assert.match(getSubscriptionPaymentOption('pix').previewDescription, /7 dias grátis/);
});
