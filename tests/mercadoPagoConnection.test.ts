import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const card = source('../src/components/caixa/online-menu/MercadoPagoConnectionCard.tsx');
const onlineMenu = source('../src/components/caixa/online-menu/CashierOnlineMenu.tsx');

test('Mercado Pago connection card uses authenticated backend endpoints', () => {
  assert.match(card, /\/payments\/mercado-pago\/status/);
  assert.match(card, /\/payments\/mercado-pago\/connect/);
  assert.match(card, /headers:\s*authHeaders/);
  assert.match(card, /cache:\s*'no-store'/);
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

test('online menu composes the Mercado Pago card before settings', () => {
  assert.match(onlineMenu, /import \{ MercadoPagoConnectionCard \}/);
  const paymentCard = onlineMenu.indexOf('<MercadoPagoConnectionCard');
  const settingsPanel = onlineMenu.indexOf('<CardapioDigitalSettingsPanel');
  assert.ok(paymentCard > -1);
  assert.ok(settingsPanel > paymentCard);
});
