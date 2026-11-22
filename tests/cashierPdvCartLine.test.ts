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

test('PDV cart line indicates offer membership without displaying misleading standalone unit price', () => {
  const promoLine: PdvCartItem = {
    product: { id: 'q-g', nome: 'Quentinha G', preco: 14 } as PdvCartItem['product'],
    quantity: 1,
    obs: '',
    client: 'Balcão',
    promotionId: 'promo-bf',
    promotionInstanceId: 'inst-1',
    promotionName: 'Black Friday G',
    promotionPrice: 10,
    modifiers: [{ id: 'ovo', nome: 'Ovo', preco: 2 }],
  };

  const withExtra = render(promoLine);
  assert.match(withExtra, /Quentinha G/);
  assert.match(withExtra, /Oferta: Black Friday G/);
  assert.match(withExtra, /\+ R\$\s*2,00 adic\./);
  assert.doesNotMatch(withExtra, /14,00 \/ un\./);
  assert.doesNotMatch(withExtra, /16,00/);

  const noExtra = render({ ...promoLine, modifiers: [] });
  assert.match(noExtra, /Oferta: Black Friday G/);
  assert.match(noExtra, /Incluso na oferta/);
  assert.doesNotMatch(noExtra, /14,00/);
});
