import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('cardapio captures first-touch UTM and coarse in-app source without raw IP', () => {
  const attribution = source('../src/cardapio/acquisitionAttribution.ts');
  assert.match(attribution, /utm_source/);
  assert.match(attribution, /utm_medium/);
  assert.match(attribution, /utm_campaign/);
  assert.match(attribution, /instagram_in_app/);
  assert.match(attribution, /sessionStorage/);
  assert.match(attribution, /url\.origin/);
  assert.match(attribution, /url\.pathname/);
  assert.doesNotMatch(attribution, /ip_address|client_ip|srcIp/i);
});

test('acquisition metadata is attached after order fingerprint so it cannot change idempotency', () => {
  const checkout = source('../src/cardapio/components/CardapioDigital.tsx');
  const fingerprint = checkout.indexOf('buildOrderSubmissionFingerprint(orderRequest)');
  const acquisition = checkout.indexOf('acquisition: getCardapioAcquisition()');
  assert.ok(fingerprint > 0);
  assert.ok(acquisition > fingerprint);
});

test('restaurant UI does not expose acquisition while SuperAdmin 360 does', () => {
  const superAdmin = source('../src/super-admin/SuperAdminRestaurant360.tsx');
  const cardapio = source('../src/cardapio/components/CardapioDigital.tsx');
  assert.match(superAdmin, /Aquisição do Cardápio Online/);
  assert.match(superAdmin, /Visível somente no SuperAdmin/);
  assert.doesNotMatch(cardapio, /Aquisição do Cardápio Online/);
});
