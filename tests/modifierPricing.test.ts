import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCatalogModifierIdsSurcharge,
  calculateModifierGroupSurcharge,
  calculateSelectedOptionsSurcharge,
  meioAMeioPricingRuleLabel,
} from '../src/domain/modifierPricing';
import { getCardapioCartItemUnitPrice } from '../src/cardapio/cartPricing';
import { pdvCartItemUnitPrice } from '../src/components/caixa/pdv/useCashierPdv';

describe('modifierPricing (Pizza Meio a Meio & regular modifiers)', () => {
  it('applies maior_preco, media (ROUND_HALF_UP cents), and soma on meio_a_meio groups', () => {
    assert.equal(calculateModifierGroupSurcharge([45, 65], 'meio_a_meio', 'maior_preco'), 65);
    assert.equal(calculateModifierGroupSurcharge([45, 65], 'meio_a_meio', 'media'), 55);
    assert.equal(calculateModifierGroupSurcharge([45, 65], 'meio_a_meio', 'soma'), 110);
    // 1 flavor stays identical across all rules
    assert.equal(calculateModifierGroupSurcharge([48.5], 'meio_a_meio', 'maior_preco'), 48.5);
    assert.equal(calculateModifierGroupSurcharge([48.5], 'meio_a_meio', 'media'), 48.5);
    // Odd cent average (10 + 10 + 11) / 3 = 10.333... -> 10.33
    assert.equal(calculateModifierGroupSurcharge([10, 10, 11], 'meio_a_meio', 'media'), 10.33);
    // Regular group always sums
    assert.equal(calculateModifierGroupSurcharge([8, 6], 'opcional', 'maior_preco'), 14);
  });

  it('computes identical unit price in public cart and Cashier PDV when combining sabores + borda', () => {
    const groups = [
      {
        id: 'g-sabores',
        nome: 'Sabores',
        min_selecoes: 1,
        max_selecoes: 2,
        tipo: 'meio_a_meio' as const,
        regra_preco_meio_a_meio: 'maior_preco' as const,
        opcoes: [
          { id: 's-calabresa', grupo_id: 'g-sabores', nome: 'Calabresa', preco_adicional: 42, ativo: true },
          { id: 's-camarao', grupo_id: 'g-sabores', nome: 'Camarão', preco_adicional: 68, ativo: true },
        ],
      },
      {
        id: 'g-borda',
        nome: 'Borda Recheada',
        min_selecoes: 0,
        max_selecoes: 1,
        tipo: 'opcional' as const,
        opcoes: [
          { id: 'b-catupiry', grupo_id: 'g-borda', nome: 'Catupiry', preco_adicional: 12, ativo: true },
        ],
      },
    ];

    const selectedOptions = {
      'g-sabores': [
        { id: 's-calabresa', name: 'Calabresa', extraPrice: 42 },
        { id: 's-camarao', name: 'Camarão', extraPrice: 68 },
      ],
      'g-borda': [
        { id: 'b-catupiry', name: 'Catupiry', extraPrice: 12 },
      ],
    };

    const cardapioUnit = getCardapioCartItemUnitPrice({
      product: {
        id: 'p-grande',
        name: 'Pizza Grande',
        description: '',
        price: 10,
        image: '',
        category: 'Pizzas',
        modifierGroups: [
          {
            id: 'g-sabores',
            name: 'Sabores',
            minSelection: 1,
            maxSelection: 2,
            type: 'meio_a_meio',
            meioAMeioPricingRule: 'maior_preco',
            options: [],
          },
          {
            id: 'g-borda',
            name: 'Borda Recheada',
            minSelection: 0,
            maxSelection: 1,
            type: 'opcional',
            options: [],
          },
        ],
      },
      selectedOptions,
    });

    const pdvUnit = pdvCartItemUnitPrice({
      product: {
        id: 'p-grande',
        nome: 'Pizza Grande',
        preco: 10,
        categoria: 'Pizzas',
        categoria_id: 'c-pizzas',
        grupos_modificadores: groups,
      } as never,
      quantity: 1,
      obs: '',
      client: '',
      modifierIds: ['s-calabresa', 's-camarao', 'b-catupiry'],
      modifiers: [
        { id: 's-calabresa', nome: 'Calabresa', preco: 42 },
        { id: 's-camarao', nome: 'Camarão', preco: 68 },
        { id: 'b-catupiry', nome: 'Catupiry', preco: 12 },
      ],
    });

    // 10 (base) + 68 (maior sabor) + 12 (borda) = 90
    assert.equal(cardapioUnit, 90);
    assert.equal(pdvUnit, 90);
    assert.equal(calculateCatalogModifierIdsSurcharge(groups, ['s-calabresa', 's-camarao', 'b-catupiry']), 80);
    assert.equal(calculateSelectedOptionsSurcharge(selectedOptions, []), 122);
    assert.ok(meioAMeioPricingRuleLabel('media').includes('Média'));
  });
});
