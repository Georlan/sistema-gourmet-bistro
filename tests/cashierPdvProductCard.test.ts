import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import type { Product } from '../src/types';
import { CashierPdvProductCard } from '../src/components/caixa/pdv/CashierPdvProductCard';

const product: Product = {
  id: 'item-42',
  nome: '101 - X-Burguer',
  descricao: 'Pão, queijo e hambúrguer',
  preco: 12.5,
  categoria: 'Hambúrgueres',
  ativo: true,
  cardapio_id: null,
  imagem: '/catalog/mock-burger.webp',
  grupos_modificadores: [{ id: 'm1', nome: 'Extras', opcoes: [] }],
} as unknown as Product;

const renderProduct = (detailsOpen: boolean, item: Product = product, cartQuantity = 0) =>
  renderToStaticMarkup(createElement(CashierPdvProductCard, {
    product: item,
    cartQuantity,
    detailsOpen,
    onConfigure: () => {},
    onQuickAdd: () => {},
    onToggleDetails: () => {},
  }));

test('PDV product exposes independent configure, quick-add and information buttons', () => {
  const html = renderProduct(false);
  const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);
  assert.equal(buttons.length, 3);
  assert.ok(buttons.every(button => button.indexOf('<button', 8) === -1));
  assert.match(html, /aria-label="Personalizar X-Burguer"/);
  assert.match(html, /aria-label="Adicionar X-Burguer rapidamente"/);
  assert.match(html, /aria-label="Ver ingredientes e detalhes de X-Burguer"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /decoding="async"/);
  assert.match(html, /R\$\s*12,50/);
});

test('PDV product keeps the detail panel accessible only when requested', () => {
  const html = renderProduct(true);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-hidden="false"/);
  assert.match(html, /Pão, queijo e hambúrguer/);
});

test('PDV product without description or code does not render an irrelevant details button', () => {
  const plain: Product = { ...product, nome: 'Água', descricao: '', grupos_modificadores: [], imagem: '' } as unknown as Product;
  const html = renderProduct(false, plain);
  assert.equal((html.match(/<button\b/g) || []).length, 2);
  assert.doesNotMatch(html, /Ver ingredientes e detalhes/);
});


test('PDV highlights products already in the cart with an accessible quantity marker', () => {
  const fresh = renderProduct(false);
  assert.doesNotMatch(fresh, /cashier-pdv-product-card__quantity/);
  const selected = renderProduct(false, product, 3);
  assert.match(selected, /cashier-pdv-product-card group is-in-cart/);
  assert.match(selected, /aria-label="3 unidades no pedido"/);
  const capped = renderProduct(false, product, 105);
  assert.match(capped, /99\+/);
  assert.match(capped, /aria-label="105 unidades no pedido"/);
});


test('PDV requires visible choices before adding a product with mandatory modifiers', () => {
  const mandatory: Product = {
    ...product,
    id: 'required-plate',
    nome: 'Marmita P',
    grupos_modificadores: [{
      id: 'protein',
      nome: 'Escolha a proteína',
      min_selecoes: 1,
      max_selecoes: 1,
      tipo: 'obrigatorio',
      opcoes: [{ id: 'chicken', grupo_id: 'protein', nome: 'Frango', preco_adicional: 0, ativo: true }],
    }],
  } as unknown as Product;
  const html = renderProduct(false, mandatory);
  assert.match(html, /aria-label="Escolher opções de Marmita P"/);
  assert.match(html, />Escolher opções<\/span>/);
  assert.doesNotMatch(html, /Adicionar Marmita P rapidamente/);

  const optional: Product = {
    ...mandatory,
    grupos_modificadores: [{
      ...(mandatory as Product & { grupos_modificadores: Array<{ min_selecoes: number }> }).grupos_modificadores[0],
      min_selecoes: 0,
    }],
  } as unknown as Product;
  assert.match(renderProduct(false, optional), /Adicionar Marmita P rapidamente/);
});
