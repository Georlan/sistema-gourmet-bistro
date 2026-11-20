import test from 'node:test';
import assert from 'node:assert/strict';
import type { Product } from '../src/cardapio/CardapioTypes';
import type { CartItem } from '../src/cardapio/components/CardapioCartDrawer';
import {
  findOutdatedCartProducts,
  inspectCartAgainstLiveCatalog,
} from '../src/cardapio/cartCatalogConsistency';

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

test('newly added required modifier group or tighter max/min rules require cart review', () => {
  const withNewRequired = {
    produtos: [{
      id: 'p1', nome: 'Quentinha G', preco: 10, ativo: true,
      grupos_modificadores: [
        { id: 'proteins', min_selecoes: 1, max_selecoes: 2, modo_selecao: 'porcoes', opcoes: [{ id: 'option-a', ativo: true, preco_adicional: 0 }] },
        { id: 'sauce', tipo: 'obrigatorio', min_selecoes: 1, max_selecoes: 1, opcoes: [{ id: 'mayo', ativo: true, preco_adicional: 0 }] },
      ],
    }],
  };
  assert.deepEqual(findOutdatedCartProducts(draft(), withNewRequired), ['Quentinha G']);

  const withLowerMax = {
    produtos: [{
      id: 'p1', nome: 'Quentinha G', preco: 10, ativo: true,
      grupos_modificadores: [
        { id: 'proteins', min_selecoes: 1, max_selecoes: 1, modo_selecao: 'porcoes', opcoes: [{ id: 'option-a', ativo: true, preco_adicional: 0 }] },
      ],
    }],
  };
  assert.deepEqual(findOutdatedCartProducts(draft(), withLowerMax), ['Quentinha G']);
});

test('expired or repriced promotion is flagged before checkout submission', () => {
  const promoCart = [{
    id: 'promotion:combo-1',
    product: { id: 'promotion:combo-1', name: 'Combo Almoço', price: 25 },
    quantity: 1,
    selectedOptions: {},
    notes: '',
    promotionId: 'combo-1',
    promotionParts: [
      { product, selectedOptions: { proteins: [chosen] }, notes: '' },
    ],
  }] as unknown as CartItem[];

  const now = Date.parse('2026-11-19T15:00:00Z');
  assert.deepEqual(findOutdatedCartProducts(promoCart, {
    ...catalog(),
    promocoes: [{ id: 'combo-1', preco: 25, fim_em: '2026-11-19T16:00:00Z' }],
  }, now), []);

  assert.deepEqual(findOutdatedCartProducts(promoCart, {
    ...catalog(),
    promocoes: [{ id: 'combo-1', preco: 29, fim_em: '2026-11-19T16:00:00Z' }],
  }, now), ['Combo Almoço']);

  assert.deepEqual(findOutdatedCartProducts(promoCart, {
    ...catalog(),
    promocoes: [{ id: 'combo-1', preco: 25, fim_em: '2026-11-19T14:59:00Z' }],
  }, now), ['Combo Almoço']);
});

test('inspectCartAgainstLiveCatalog distinguishes price change, rule change, and unavailable product', () => {
  const cart = [
    { id: 'c1', product: { id: 'p1', name: 'Burger', price: 28 }, quantity: 1, selectedOptions: {}, notes: '' },
    { id: 'c2', product: { id: 'p2', name: 'Suco', price: 8 }, quantity: 1, selectedOptions: {}, notes: '' },
  ] as unknown as CartItem[];

  const liveProducts = [
    { id: 'p1', name: 'Burger', price: 35, description: '', category: 'Burgers', image: '', isAvailable: true, modifierGroups: [] },
  ] as unknown as Product[];

  const drifts = inspectCartAgainstLiveCatalog(cart, liveProducts);
  assert.equal(drifts.get('c1')?.reason, 'price_changed');
  assert.equal(drifts.get('c1')?.canEdit, true);
  assert.match(drifts.get('c1')?.message || '', /35,00/);

  assert.equal(drifts.get('c2')?.reason, 'unavailable');
  assert.equal(drifts.get('c2')?.canEdit, false);
});
