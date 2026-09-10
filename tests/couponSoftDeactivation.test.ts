import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/components/clientes/CuponsTab.tsx', import.meta.url),
  'utf8',
);

test('coupon removal is presented as reversible deactivation', () => {
  assert.match(source, /handleDeactivateCupom/);
  assert.match(source, /Desativar este cupom\?/);
  assert.match(source, /histórico e os usos serão preservados/);
  assert.match(source, /Cupom desativado\. Histórico preservado\./);
  assert.doesNotMatch(source, /setCupons\(prev => prev\.filter\(c => c\.id !== id\)\)/);
});

test('inactive coupons stay visible and can be edited/reactivated', () => {
  assert.match(source, /Desativado — histórico preservado/);
  assert.match(source, /\{cupom\.ativo && \(/);
  assert.match(source, /handleOpenModal\(cupom\)/);
  assert.match(source, /checked=\{ativo\}/);
  assert.match(source, /Cupom ativo para uso/);
});
