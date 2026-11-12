import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PdvCartItem } from '../src/components/caixa/pdv/useCashierPdv';
import { CashierPdvCartLine } from '../src/components/caixa/pdv/CashierPdvCartLine';

const sample: PdvCartItem = {
  product: { id: 'test-burger', nome: 'X-Burguer', preco: 10 } as PdvCartItem['product'],
  quantity: 2,
  obs: 'sem molho',
  client: 'Balcão',
  modifierIds: ['extra-cheese'],
  modifiers: [{ id: 'extra-cheese', nome: 'Queijo', preco: 2 }],
};

const render = (item = sample, unavailable = false) => renderToStaticMarkup(
  createElement(CashierPdvCartLine, {
    item,
    index: 0,
    availability: { unavailable, reason: unavailable ? 'paused' : undefined },
    onEdit: () => {},
    onRemove: () => {},
    onChangeQuantity: () => {},
    onChangeObservation: () => {},
  }),
);

test('PDV cart line uses canonical unit price and quantity without duplicate pricing state', () => {
  const html = render();
  assert.match(html, /X-Burguer/);
  assert.match(html, /R\$\s*12,00/);
  assert.match(html, /R\$\s*24,00/);
  assert.match(html, /Queijo/);
  assert.match(html, /aria-label="Aumentar quantidade de X-Burguer"/);
  assert.match(html, /aria-label="Diminuir quantidade de X-Burguer"/);
});

test('PDV cart line puts preparation notes behind native disclosure', () => {
  const html = render();
  assert.match(html, /<details/);
  assert.match(html, /<summary/);
  assert.match(html, /Preparo: sem molho/);
  assert.match(html, /aria-label="Observação de X-Burguer"/);
  assert.match(html, /value="sem molho"/);
  assert.match(html, /aria-label="Remover X-Burguer"/);
});

test('PDV cart line distinguishes unavailable products without changing the item', () => {
  assert.match(render(sample, true), /Produto pausado/);
  assert.doesNotMatch(render(), /Produto pausado/);
  assert.equal(sample.quantity, 2);
  assert.equal(sample.obs, 'sem molho');
});
