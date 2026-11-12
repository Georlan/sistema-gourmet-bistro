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

const renderProduct = (detailsOpen: boolean, item: Product = product) =>
  renderToStaticMarkup(createElement(CashierPdvProductCard, {
    product: item,
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
