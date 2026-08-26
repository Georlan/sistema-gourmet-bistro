import assert from 'node:assert/strict';
import test from 'node:test';

import { toSafeCategoryDomId } from '../src/cardapio/categoryDomId';

test('cardápio gera ids CSS-safe para categorias com símbolos e acentos', () => {
  assert.equal(toSafeCategoryDomId('Bebidas & Vinhos'), 'bebidas-vinhos');
  assert.equal(toSafeCategoryDomId('Pizzas Especiais'), 'pizzas-especiais');
  assert.equal(toSafeCategoryDomId('Cafés & Chás'), 'cafes-chas');
  assert.equal(toSafeCategoryDomId('  Sobremesas / Doces  '), 'sobremesas-doces');
});

test('id de categoria nunca preserva operadores de seletor CSS', () => {
  const id = toSafeCategoryDomId('A&B > C#D.E [F]');
  assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(id, 'a-b-c-d-e-f');
});
