import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Product } from '../src/cardapio/CardapioTypes';
import {
  isValidPromotionParts,
  selectedPromotionExtras,
  type PromotionCompositionStep,
  type PromotionPartSelection,
} from '../src/cardapio/promotionComposition';

const product = (id: string, available = true): Product => ({
  id, name: id, description: '', price: 10, image: '',
  category: 'Quentinhas', isAvailable: available,
});

const steps: PromotionCompositionStep[] = [
  { product: product('g'), label: 'Quentinha G' },
  { product: product('m'), label: 'Quentinha M' },
];

const completed = (step: PromotionCompositionStep, notes: string, surcharge = 0): PromotionPartSelection => ({
  product: step.product,
  quantity: 1,
  selectedOptions: surcharge ? {
    adicionais: [{ id: `extra-${notes}`, name: 'Proteína extra', extraPrice: surcharge }],
  } : {},
  notes,
});

test('promoção G+M só fica pronta quando as duas quentinhas têm montagem independente', () => {
  const g = completed(steps[0], 'G sem cebola', 5);
  const m = completed(steps[1], 'M com salada', 2);
  assert.equal(isValidPromotionParts(steps, [g]), false);
  assert.equal(isValidPromotionParts(steps, [g, null]), false);
  assert.equal(isValidPromotionParts(steps, [m, g]), false);
  assert.equal(isValidPromotionParts(steps, [g, m]), true);
  assert.notEqual(g.selectedOptions, m.selectedOptions);
  assert.notEqual(g.notes, m.notes);
  assert.equal(selectedPromotionExtras([g, m]), 7);
});

test('produto pausado ou dados de outro produto impedem confirmação', () => {
  const paused = [{ product: product('g', false), label: 'G' }, steps[1]];
  assert.equal(isValidPromotionParts(paused, [completed(paused[0], ''), completed(steps[1], '')]), false);
  assert.equal(isValidPromotionParts(steps, [
    completed(steps[0], ''), completed({ product: product('bebida'), label: 'Pitulinha' }, ''),
  ]), false);
  assert.equal(isValidPromotionParts([], []), false);
});

test('G+Pitulinha aceita a bebida como segundo produto independente', () => {
  const beverage = { product: product('pitulinha'), label: 'Escolha sua Pitulinha' };
  const combo = [steps[0], beverage];
  assert.equal(isValidPromotionParts(combo, [completed(combo[0], 'Arroz e carne'), completed(beverage, '')]), true);
});

test('assistente reaproveita modal de montagem, não grava itens separados durante as etapas', () => {
  const wizard = readFileSync(new URL('../src/cardapio/components/CardapioPromotionWizard.tsx', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../src/cardapio/components/CardapioProductModal.tsx', import.meta.url), 'utf8');
  assert.match(wizard, /<CardapioProductModal/);
  assert.match(wizard, /Revisar promoção/);
  assert.match(wizard, /setStepIndex\(stepIndex \+ 1\)/);
  assert.match(wizard, /onConfirm\(parts\)/);
  assert.match(modal, /if \(!compositionStep\) onClose\(\)/);
  assert.match(modal, /selectionWithinRules/);
  assert.doesNotMatch(wizard, /fetch\(|API_BASE_URL|localStorage/);
});
