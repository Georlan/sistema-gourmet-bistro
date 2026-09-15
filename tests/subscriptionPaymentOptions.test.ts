import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SUBSCRIPTION_TRIAL_DAYS,
  getAvailableSubscriptionPaymentOptions,
  getSubscriptionPaymentOption,
  getSubscriptionPaymentOptions,
} from '../src/config/subscriptionPaymentOptions';

const subscriptionControl = readFileSync('src/components/assinatura/SubscriptionControl.tsx', 'utf8');

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
  assert.doesNotMatch(JSON.stringify(pix), /Pix Automático|preapproval/i);
});

test('Pix mensal gera novo QR a cada vencimento e Pix anual quita 12 meses', () => {
  const pix = getSubscriptionPaymentOption('pix');
  assert.match(pix.landingSummary, /mensal gera novo QR a cada vencimento/);
  assert.match(pix.landingSummary, /anual gera um único QR do valor anual/);
  assert.match(pix.previewDescription, /plano mensal gera um novo QR Code\/Pix Copia e Cola a cada vencimento/);
  assert.match(pix.previewDescription, /plano anual, um único Pix do total anual quita os próximos 12 meses/);

  assert.match(subscriptionControl, /billingCycle\?: 'monthly' \| 'annual' \| 'mensal' \| 'anual'/);
  assert.match(subscriptionControl, /No plano anual, um único Pix do valor anual é gerado depois dos 7 dias grátis e quita os próximos 12 meses/);
  assert.match(subscriptionControl, /No plano mensal, cada vencimento gera um novo QR Code\/Pix Copia e Cola/);
  assert.match(subscriptionControl, /Pix da \{pixPeriodLabel\}/);
});

test('anual mantém os mesmos três meios e preserva o trial', () => {
  const options = getSubscriptionPaymentOptions('anual');
  assert.deepEqual(options.map((option) => option.id), ['credit_card', 'pix', 'account_money']);
  assert.deepEqual(getAvailableSubscriptionPaymentOptions('anual').map((option) => option.id), ['credit_card', 'pix', 'account_money']);
  assert.match(getSubscriptionPaymentOption('credit_card').checkoutSummary, /7 dias grátis/);
  assert.match(getSubscriptionPaymentOption('account_money').checkoutSummary, /7 dias grátis/);
  assert.match(getSubscriptionPaymentOption('pix').previewDescription, /7 dias grátis/);
});
