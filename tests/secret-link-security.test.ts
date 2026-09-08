import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const motoboy = source('../src/components/MotoboyPwaPage.tsx');
const activation = source('../src/components/CaixaAtivarPage.tsx');
const orders = source('../backend/app/routes/orders.py');
const notifications = source('../backend/app/services/notificacoes.py');
const contracts = source('../backend/app/services/contract_notifications.py');
const main = source('../backend/app/main.py');

test('motoboy browser secret is bootstrapped then removed from the URL', () => {
  assert.match(motoboy, /window\.location\.hash/);
  assert.match(motoboy, /history\.replaceState/);
  assert.match(motoboy, /sessionStorage/);
  assert.doesNotMatch(motoboy, /localStorage/);
  assert.match(motoboy, /X-Koma-Delivery-Token/);
  assert.doesNotMatch(motoboy, /painel-entregador\?token=/);
  assert.doesNotMatch(motoboy, /confirmar-entrega\?token=/);
});

test('delivery API authenticates with a dedicated header instead of query token', () => {
  assert.match(orders, /alias="X-Koma-Delivery-Token"/);
  assert.match(main, /"X-Koma-Delivery-Token"/);
});

test('new activation and courier links place secrets in URL fragments', () => {
  assert.match(notifications, /\/ativar#token=/);
  assert.doesNotMatch(notifications, /\/ativar\?token=/);
  assert.match(contracts, /\/ativar#token=/);
  assert.doesNotMatch(contracts, /\/ativar\?token=/);
  assert.match(orders, /\/entregador#token=/);
  assert.doesNotMatch(orders, /\/entregador\?token=/);
});

test('activation page consumes fragment and strips legacy links immediately', () => {
  assert.match(activation, /window\.location\.hash/);
  assert.match(activation, /history\.replaceState/);
  assert.match(activation, /query\.delete\('token'\)/);
});
