import assert from 'node:assert/strict';
import test from 'node:test';

import { pdvCartItemUnitPrice, type PdvCartItem } from '../src/components/caixa/pdv/useCashierPdv';

test('PDV soma cada unidade repetida do mesmo adicional no preço unitário', () => {
  const item: PdvCartItem = {
    product: {
      id: 'burger',
      nome: 'Hambúrguer',
      preco: 19,
    } as PdvCartItem['product'],
    quantity: 1,
    obs: '',
    client: 'Balcão',
    modifierIds: ['egg', 'egg', 'cheddar'],
    modifiers: [
      { id: 'egg', nome: 'Ovo', preco: 2 },
      { id: 'egg', nome: 'Ovo', preco: 2 },
      { id: 'cheddar', nome: 'Cheddar', preco: 3 },
    ],
  };

  assert.equal(pdvCartItemUnitPrice(item), 26);
  assert.deepEqual(item.modifierIds, ['egg', 'egg', 'cheddar']);
});
