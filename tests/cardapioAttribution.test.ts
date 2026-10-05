import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const digital = fs.readFileSync(new URL('../src/cardapio/components/CardapioDigital.tsx', import.meta.url), 'utf8');
const attribution = fs.readFileSync(new URL('../src/cardapio/orderAttribution.ts', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../src/super-admin/SuperAdminAcquisitionTab.tsx', import.meta.url), 'utf8');

test('checkout envia atribuição sem usar IP bruto', () => {
  assert.match(digital, /attribution: orderAttribution/);
  assert.match(attribution, /utm_source/);
  assert.match(attribution, /referrer_host/);
  assert.doesNotMatch(attribution, /ip_address|client_ip/i);
});

test('atribuição é privada do SuperAdmin', () => {
  assert.match(admin, /\/api\/super-admin\/order-attribution/);
  assert.match(admin, /Não aparece para o restaurante/);
});
