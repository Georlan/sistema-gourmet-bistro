import assert from 'node:assert/strict';
import test from 'node:test';

import type { CatalogModifierGroup } from '../src/catalog/catalog';
import {
  canIncrementModifierQuantity,
  canIncrementSelectionQuantity,
  changeModifierQuantitySelection,
  changeSelectionQuantity,
  modifierGroupSelectionValid,
  modifierTypeCount,
  selectionTypeCount,
  selectionWithinRules,
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

test('contrato genérico usado pelo cardápio público replica a mesma semântica do PDV', () => {
  const rules = {
    optionIds: ['catupiry', 'bacon', 'cheddar', 'cebola'],
    minSelection: 0,
    maxSelection: 3,
  };
  let selected: string[] = [];

  selected = changeSelectionQuantity(rules, selected, 'catupiry', 1);
  selected = changeSelectionQuantity(rules, selected, 'catupiry', 1);
  selected = changeSelectionQuantity(rules, selected, 'catupiry', 1);
  selected = changeSelectionQuantity(rules, selected, 'bacon', 1);

  assert.deepEqual(selected, ['catupiry', 'catupiry', 'catupiry', 'bacon']);
  assert.equal(selectionTypeCount(rules, selected), 2);
  assert.equal(selectionWithinRules(rules, selected), true);
  assert.equal(canIncrementSelectionQuantity(rules, selected, 'cheddar'), true);

  selected = changeSelectionQuantity(rules, selected, 'cheddar', 1);
  assert.equal(selectionTypeCount(rules, selected), 3);
  assert.equal(canIncrementSelectionQuantity(rules, selected, 'cebola'), false);
  assert.equal(canIncrementSelectionQuantity(rules, selected, 'catupiry'), true);
});

test('marmitaria por porções permite repetir e limita o total', () => {
  const rules = { optionIds: ['chicken', 'beef', 'fish'], minSelection: 2, maxSelection: 2, selectionMode: 'porcoes' as const };
  assert.equal(selectionWithinRules(rules, ['chicken']), false);
  assert.equal(selectionWithinRules(rules, ['chicken', 'chicken']), true);
  assert.equal(selectionWithinRules(rules, ['chicken', 'beef']), true);
  assert.equal(selectionWithinRules(rules, ['chicken', 'chicken', 'beef']), false);
  assert.equal(canIncrementSelectionQuantity(rules, ['chicken', 'chicken'], 'beef'), false);
  assert.deepEqual(changeSelectionQuantity(rules, ['chicken', 'chicken'], 'chicken', 1), ['chicken', 'chicken']);
});

test('marmitaria por tipos exige opções diferentes sem repetição', () => {
  const rules = { optionIds: ['chicken', 'beef', 'fish'], minSelection: 2, maxSelection: 2, selectionMode: 'tipos' as const };
  assert.equal(selectionWithinRules(rules, ['chicken', 'chicken']), false);
  assert.equal(selectionWithinRules(rules, ['chicken', 'beef']), true);
  assert.equal(canIncrementSelectionQuantity(rules, ['chicken'], 'chicken'), false);
  assert.equal(canIncrementSelectionQuantity(rules, ['chicken', 'beef'], 'fish'), false);
  assert.deepEqual(changeSelectionQuantity(rules, ['chicken'], 'chicken', 1), ['chicken']);
});

test('marmitaria com min=0 permite 0 escolhas, repetição no modo porcoes e respeita o máximo', () => {
  // Proteínas: min 0, max 2, modo porções (Quentinha G)
  const proteinas = { optionIds: ['frango', 'carne', 'ovo'], minSelection: 0, maxSelection: 2, selectionMode: 'porcoes' as const };
  assert.equal(selectionWithinRules(proteinas, []), true, '0 proteínas deve ser válido');
  assert.equal(selectionWithinRules(proteinas, ['frango']), true, '1 proteína deve ser válida');
  assert.equal(selectionWithinRules(proteinas, ['ovo', 'ovo']), true, '2 ovos repetidos devem ser válidos');
  assert.equal(selectionWithinRules(proteinas, ['ovo', 'ovo', 'frango']), false, '3 proteínas devem ser bloqueadas');
  assert.equal(canIncrementSelectionQuantity(proteinas, ['ovo', 'ovo'], 'carne'), false, 'Não deve permitir 3ª proteína');

  // Guarnições livres / adicionais pagos com teto operacional amplo (ex: 20)
  const guarnicoes = { optionIds: ['arroz', 'feijao', 'macarrao'], minSelection: 0, maxSelection: 20, selectionMode: 'porcoes' as const };
  assert.equal(selectionWithinRules(guarnicoes, []), true, '0 guarnições deve ser válido');
  assert.equal(canIncrementSelectionQuantity(guarnicoes, [], 'arroz'), true);
  const selectedGuar = changeSelectionQuantity(guarnicoes, [], 'arroz', 1);
  assert.deepEqual(selectedGuar, ['arroz']);
  assert.equal(canIncrementSelectionQuantity(guarnicoes, selectedGuar, 'feijao'), true);
});

