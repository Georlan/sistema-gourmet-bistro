import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('home expõe atalho de Peça novamente apenas para cliente autenticado', () => {
  const header = source('../src/cardapio/components/CardapioHeader.tsx');
  assert.match(header, /user && \(/);
  assert.match(header, /id="btn-order-again-home"/);
  assert.match(header, />Peça novamente</);
  assert.match(header, /onClick=\{onAuthClick\}/);
});

test('atalho da home reaproveita o histórico autenticado em vez de criar fonte paralela', () => {
  const header = source('../src/cardapio/components/CardapioHeader.tsx');
  assert.doesNotMatch(header, /cardapio\/clientes\/me\/pedidos/);
  assert.doesNotMatch(header, /localStorage|sessionStorage/);

  const profile = source('../src/cardapio/components/CardapioUserProfileModal.tsx');
  assert.match(profile, /CardapioCustomerOrderHistory/);
  assert.match(profile, /onRepeatOrder=\{onRepeatOrder\}/);
});
