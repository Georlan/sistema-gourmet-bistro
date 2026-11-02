import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCompactCurrency, formatCurrency } from '../src/components/caixa/cashierPresentation';

test('formata valores monetários e mantém arredondamento e valores ausentes', () => {
  const normal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  for (const value of [0, 1.25, -4.5, 1999.99, Number.NaN]) {
    assert.equal(formatCurrency(value), normal.format(Number(value) || 0));
    assert.equal(formatCompactCurrency(value), compact.format(Number(value) || 0));
  }
});
