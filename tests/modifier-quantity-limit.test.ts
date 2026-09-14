import assert from 'node:assert/strict';
import test from 'node:test';

import type { CatalogModifierGroup } from '../src/catalog/catalog';
import {
  canIncrementModifierQuantity,
  changeModifierQuantitySelection,
  modifierGroupSelectionValid,
  modifierTypeCount,
} from '../src/domain/modifierQuantity';

const group = (max: number): CatalogModifierGroup => ({
  id: `extras-${max}`,
  nome: 'Adicionais',
  min_selecoes: 0,
  max_selecoes: max,
  tipo: 'opcional',
  recomendado: true,
  opcoes: [
    { id: 'egg', nome: 'Ovo', preco_adicional: 2, ativo: true },
    { id: 'bacon', nome: 'Bacon', preco_adicional: 4, ativo: true },
    { id: 'cheddar', nome: 'Cheddar', preco_adicional: 3, ativo: true },
    { id: 'onion', nome: 'Cebola', preco_adicional: 1, ativo: true },
    { id: 'pickle', nome: 'Picles', preco_adicional: 1, ativo: true },
  ],
} as CatalogModifierGroup);

test('repetir o mesmo adicional não consome novas vagas da categoria', () => {
  const extras = group(4);
  let selected: string[] = [];

  selected = changeModifierQuantitySelection(extras, selected, 'egg', 1);
  selected = changeModifierQuantitySelection(extras, selected, 'egg', 1);
  selected = changeModifierQuantitySelection(extras, selected, 'egg', 1);
  selected = changeModifierQuantitySelection(extras, selected, 'egg', 1);

  assert.deepEqual(selected, ['egg', 'egg', 'egg', 'egg']);
  assert.equal(modifierTypeCount(extras, selected), 1);
  assert.equal(canIncrementModifierQuantity(extras, selected, 'bacon'), true);
  assert.equal(modifierGroupSelectionValid(extras, selected), true);

  selected = changeModifierQuantitySelection(extras, selected, 'bacon', 1);
  assert.deepEqual(selected, ['egg', 'egg', 'egg', 'egg', 'bacon']);
  assert.equal(modifierTypeCount(extras, selected), 2);
});

test('limite do grupo vale para tipos diferentes, não para quantidade do tipo já escolhido', () => {
  const extras = group(4);
  let selected = ['egg', 'bacon', 'cheddar', 'onion'];

  assert.equal(canIncrementModifierQuantity(extras, selected, 'pickle'), false);
  assert.equal(canIncrementModifierQuantity(extras, selected, 'egg'), true);

  selected = changeModifierQuantitySelection(extras, selected, 'pickle', 1);
  assert.deepEqual(selected, ['egg', 'bacon', 'cheddar', 'onion']);

  selected = changeModifierQuantitySelection(extras, selected, 'egg', 1);
  assert.deepEqual(selected, ['egg', 'bacon', 'cheddar', 'onion', 'egg']);
  assert.equal(modifierGroupSelectionValid(extras, selected), true);
});

test('grupo de escolha única continua exclusivo', () => {
  const single = group(1);
  let selected = changeModifierQuantitySelection(single, [], 'egg', 1);

  assert.deepEqual(selected, ['egg']);
  assert.equal(canIncrementModifierQuantity(single, selected, 'egg'), false);

  selected = changeModifierQuantitySelection(single, selected, 'bacon', 1);
  assert.deepEqual(selected, ['bacon']);
});
