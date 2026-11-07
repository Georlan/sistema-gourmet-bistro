import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  shouldExpandModifierByDefault,
  isAddonsOrExtrasGroup,
} from '../src/cardapio/modifierExpansion';
import type { ProductModifier } from '../src/cardapio/CardapioTypes';

test('isAddonsOrExtrasGroup identifica variacoes de nomes de adicionais e extras', () => {
  assert.equal(isAddonsOrExtrasGroup('Adicionais'), true);
  assert.equal(isAddonsOrExtrasGroup('Adicionais pagos'), true);
  assert.equal(isAddonsOrExtrasGroup('Extras'), true);
  assert.equal(isAddonsOrExtrasGroup('Acréscimos'), true);
  assert.equal(isAddonsOrExtrasGroup('Escolha seu adicional'), true);
  assert.equal(isAddonsOrExtrasGroup('Proteínas'), false);
  assert.equal(isAddonsOrExtrasGroup('Guarnições'), false);
  assert.equal(isAddonsOrExtrasGroup('Saladas'), false);
});

test('shouldExpandModifierByDefault: adicionais pagos comecam expandidos em todos os restaurantes (incluindo Marmitaria e ID 6)', () => {
  // 1. Restaurante convencional (hambúrguer/lanche)
  const burgerAddons: ProductModifier = {
    id: 'grp-addons',
    title: 'Adicionais',
    required: false,
    maxSelection: 4,
    options: [
      { id: 'bacon', name: 'Bacon', extraPrice: 2 },
      { id: 'queijo', name: 'Queijo', extraPrice: 2 },
    ],
  };
  assert.equal(shouldExpandModifierByDefault(burgerAddons, 2), true);

  // 2. Marmitaria / ID 6: grupo de adicionais pagos tambem comeca expandido
  const marmitariaExtras: ProductModifier = {
    id: 'grp-marmitaria-extras',
    title: 'Adicionais pagos',
    required: false,
    maxSelection: 20,
    options: [
      { id: 'frango-extra', name: 'Frango adicional', extraPrice: 5 },
      { id: 'ovo-extra', name: 'Ovo adicional', extraPrice: 2 },
    ],
  };
  assert.equal(shouldExpandModifierByDefault(marmitariaExtras, 3), true);
});

test('shouldExpandModifierByDefault: preserva complementos gratuitos e escolhas obrigatorias sempre abertos', () => {
  // 1. Escolha obrigatoria de montagem (Proteinas da marmitaria ou ponto da carne)
  const requiredProteins: ProductModifier = {
    id: 'grp-proteins',
    title: 'Proteínas',
    required: true,
    maxSelection: 2,
    options: [
      { id: 'frango', name: 'Frango', extraPrice: 0 },
      { id: 'carne', name: 'Carne', extraPrice: 0 },
    ],
  };
  assert.equal(shouldExpandModifierByDefault(requiredProteins, 3), true);

  // 2. Guarnicoes gratuitas da marmitaria
  const freeGarnishes: ProductModifier = {
    id: 'grp-guarnicoes',
    title: 'Guarnições',
    required: false,
    maxSelection: 20,
    options: [
      { id: 'arroz', name: 'Arroz branco', extraPrice: 0 },
      { id: 'feijao', name: 'Feijão carioca', extraPrice: 0 },
    ],
  };
  assert.equal(shouldExpandModifierByDefault(freeGarnishes, 3), true);

  // 3. Salada gratuita da marmitaria
  const freeSalad: ProductModifier = {
    id: 'grp-salada',
    title: 'Saladas',
    required: false,
    maxSelection: 1,
    options: [
      { id: 'alface-tomate', name: 'Alface e tomate', extraPrice: 0 },
      { id: 'legumes', name: 'Legumes cozidos', extraPrice: 0 },
    ],
  };
  assert.equal(shouldExpandModifierByDefault(freeSalad, 3), true);
});

test('CardapioProductModal: integridade estrutural de adicionais e selecao automatica nula', () => {
  const modalSource = readFileSync(
    new URL('../src/cardapio/components/CardapioProductModal.tsx', import.meta.url),
    'utf8',
  );

  // 1. Checkboxes vazios por padrão (nenhum adicional pré-selecionado automaticamente)
  assert.match(
    modalSource,
    /const initial: Record<string, ProductOption\[\]> = \{\};/,
    'Rascunho inicial de modificadores deve comecar vazio sem selecao automatica',
  );

  // 2. Adicionais comecam expandidos por padrao
  assert.match(
    modalSource,
    /if \(shouldExpandModifierByDefault\(m, allModifiers\.length\)\) \{/,
    'Deve utilizar shouldExpandModifierByDefault para definir os grupos inicialmente abertos',
  );

  // 3. Suporte a recolhimento manual pelo consumidor
  assert.match(
    modalSource,
    /onClick: \(\) => setExpandedExtras\(\(current\) => \(\{ \.\.\.current, \[modifier\.id\]: !expanded \}\)\)/,
    'Deve permitir ao cliente alternar e recolher o accordion manualmente',
  );
});
