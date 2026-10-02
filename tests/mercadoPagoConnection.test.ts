import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const card = source('../src/components/caixa/online-menu/MercadoPagoConnectionCard.tsx');
const onlineMenu = source('../src/components/caixa/online-menu/CashierOnlineMenu.tsx');
const integrations = source('../src/components/caixa/settings/CashierIntegrationsSettings.tsx');
const komaPayments = source('../src/components/caixa/settings/KomaPaymentsSettings.tsx');
const onboarding = source('../src/components/onboarding/FirstAccessOnboarding.tsx');
const settings = source('../src/components/caixa/settings/CashierSettings.tsx');
const navigation = source('../src/components/caixa/navigation/cashierNavigation.ts');

test('Mercado Pago connection card uses authenticated backend endpoints', () => {
  assert.match(card, /\/payments\/mercado-pago\/status/);
  assert.match(card, /\/payments\/mercado-pago\/connect/);
  assert.match(card, /headers:\s*authHeaders/);
  assert.match(card, /cache:\s*'no-store'/);
  assert.match(card, /authFetch/);
  assert.match(card, /authRequestErrorMessage/);
  assert.doesNotMatch(card, /text:\s*error instanceof Error \? error\.message/);
});

test('OAuth redirect is restricted to Mercado Pago HTTPS authorization host', () => {
  assert.match(card, /authorizationUrl\.protocol !== 'https:'/);
  assert.match(card, /authorizationUrl\.hostname !== 'auth\.mercadopago\.com'/);
  assert.match(card, /window\.location\.assign\(authorizationUrl\.toString\(\)\)/);
});

test('frontend does not handle provider secrets', () => {
  for (const forbidden of ['client_secret', 'refresh_token', 'access_token', 'webhook_secret', 'code_verifier']) {
    assert.equal(card.includes(forbidden), false, `frontend must not contain ${forbidden}`);
  }
});

test('Sistema > Configurações owns KÔMA Pagamentos and the Mercado Pago connection', () => {
  assert.doesNotMatch(onlineMenu, /MercadoPagoConnectionCard/);
  assert.match(integrations, /KomaPaymentsSettings/);
  assert.match(komaPayments, /MercadoPagoConnectionCard/);
  assert.match(komaPayments, /KÔMA Pagamentos/);
  assert.match(komaPayments, /C6 Bank/);
  assert.match(komaPayments, /0,99%/);
  assert.match(komaPayments, /0,49%/);
  assert.match(komaPayments, /0% divulgado/);
  assert.match(settings, /activeSubTab === 'integracoes'/);
  assert.match(settings, /CashierIntegrationsSettings/);
  assert.match(navigation, /config_integracoes/);
  assert.match(navigation, /label: 'Integrações'/);
  assert.match(navigation, /subTab: 'integracoes'/);
});


test('first access sends provider setup to the canonical integrations screen', () => {
  assert.match(onboarding, /openCashierAt\('impressao_salao', 'integracoes', true\)/);
  assert.match(onboarding, /Escolher provedor quando quiser/);
  assert.match(onboarding, /C6 Bank está em homologação/);
});
