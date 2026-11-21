import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('home expõe atalho de Peça novamente apenas para cliente autenticado', () => {
  const v2 = source('../src/cardapio/v2/MenuV2Experience.tsx');
  assert.match(v2, /user && onAuthClick && \(/);
  assert.match(v2, /id="btn-order-again-home"/);
  assert.match(v2, />Peça novamente</);
  assert.match(v2, /onClick=\{onAuthClick\}/);
});

test('atalho da home reaproveita o histórico autenticado em vez de criar fonte paralela', () => {
  const v2 = source('../src/cardapio/v2/MenuV2Experience.tsx');
  const orderAgainStart = v2.indexOf('id="btn-order-again-home"');
  const orderAgainSlice = v2.slice(Math.max(0, orderAgainStart - 120), orderAgainStart + 200);
  assert.doesNotMatch(v2, /cardapio\/clientes\/me\/pedidos/);
  assert.doesNotMatch(orderAgainSlice, /localStorage|sessionStorage/);

  const profile = source('../src/cardapio/components/CardapioUserProfileModal.tsx');
  assert.match(profile, /CardapioCustomerOrderHistory/);
  assert.match(profile, /onRepeatOrder=\{onRepeatOrder\}/);
});
