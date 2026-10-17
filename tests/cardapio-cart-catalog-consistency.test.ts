import test from 'node:test';
import assert from 'node:assert/strict';
import type { CartItem } from '../src/cardapio/components/CardapioCartDrawer';
import { findOutdatedCartProducts } from '../src/cardapio/cartCatalogConsistency';

const product = { id: 'p1', name: 'Quentinha G', price: 10 };
const chosen = { id: 'option-a', name: 'Frango', extraPrice: 0 };
const draft = () => ([{
  id: 'p1', product, quantity: 2, selectedOptions: { proteins: [chosen, chosen] }, notes: '',
}] as unknown as CartItem[]);
const catalog = () => ({
  produtos: [{
    id: 'p1', nome: 'Quentinha G', preco: 10, ativo: true,
    grupos_modificadores: [{
      id: 'proteins', opcoes: [{ id: 'option-a', ativo: true, preco_adicional: 0 }],
    }],
  }],
});

test('unchanged marmitaria composition (including repeated portions) stays available', () => {
  assert.deepEqual(findOutdatedCartProducts(draft(), catalog()), []);
});

test('daily menu paused modifier is rejected without modifying the draft', () => {
  const cart = draft();
  const before = JSON.stringify(cart);
  const updated = catalog();
  updated.produtos[0].grupos_modificadores[0].opcoes[0].ativo = false;
  assert.deepEqual(findOutdatedCartProducts(cart, updated), ['Quentinha G']);
  assert.equal(JSON.stringify(cart), before);
});

test('removed or wrong-group options require a cart review', () => {
  const removed = catalog();
  removed.produtos[0].grupos_modificadores[0].opcoes = [];
  assert.deepEqual(findOutdatedCartProducts(draft(), removed), ['Quentinha G']);
  const wrongGroup = catalog();
  wrongGroup.produtos[0].grupos_modificadores[0].id = 'other';
  assert.deepEqual(findOutdatedCartProducts(draft(), wrongGroup), ['Quentinha G']);
});

test('server price or product changes are not silently accepted', () => {
  const changed = catalog();
  changed.produtos[0].grupos_modificadores[0].opcoes[0].preco_adicional = 2;
  assert.deepEqual(findOutdatedCartProducts(draft(), changed), ['Quentinha G']);
  changed.produtos[0].grupos_modificadores[0].opcoes[0].preco_adicional = 0;
  changed.produtos[0].preco = 12;
  assert.deepEqual(findOutdatedCartProducts(draft(), changed), ['Quentinha G']);
  assert.deepEqual(findOutdatedCartProducts(draft(), { produtos: [] }), ['Quentinha G']);
});

test('combo parts are independently checked against their own product groups', () => {
  const cart = [{
    ...draft()[0],
    promotionParts: [
      { product, selectedOptions: { proteins: [chosen] }, notes: '' },
      { product: { id: 'p2', name: 'Suco', price: 7 }, selectedOptions: {}, notes: '' },
    ],
  }] as unknown as CartItem[];
  assert.deepEqual(findOutdatedCartProducts(cart, catalog()), ['Suco']);
  assert.deepEqual(findOutdatedCartProducts(cart, {
    ...catalog(),
    produtos_promocionais: [{ id: 'p2', preco: 7, grupos_modificadores: [] }],
  }), []);
});

test('malformed public catalog cannot be treated as valid', () => {
  assert.throws(() => findOutdatedCartProducts(draft(), null), /Resposta inválida/);
  assert.throws(() => findOutdatedCartProducts(draft(), {}), /Resposta inválida/);
});
