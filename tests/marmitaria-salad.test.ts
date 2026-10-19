import assert from 'node:assert/strict';
import test from 'node:test';
import { isMarmitariaSaladGroup } from '../src/domain/marmitariaSalad';
import { selectionWithinRules } from '../src/domain/modifierQuantity';

test('saladas/verduras são identificadas pelo nome, não pelo tenant ou ordem do grupo', () => {
  for (const name of ['Salada', 'Saladas', 'SALADAS / VERDURAS', 'Verduras']) {
    assert.equal(isMarmitariaSaladGroup(name), true, name);
  }
  for (const name of ['Proteínas', 'Guarnições', 'Adicionais pagos', 'Ensaladas', 'Sobremesas']) {
    assert.equal(isMarmitariaSaladGroup(name), false, name);
  }
});

test('marmitaria sem salada é seleção vazia válida só quando o mínimo do tamanho é zero', () => {
  const rules = { optionIds: ['vinagrete', 'alface', 'tomate'], minSelection: 0, maxSelection: 3, selectionMode: 'tipos' as const };
  assert.equal(selectionWithinRules(rules, []), true);
  assert.equal(selectionWithinRules(rules, ['alface', 'tomate']), true);
  assert.equal(selectionWithinRules(rules, ['alface', 'tomate', 'vinagrete', 'alface']), false);
  assert.equal(selectionWithinRules({ ...rules, minSelection: 1 }, []), false);
});
