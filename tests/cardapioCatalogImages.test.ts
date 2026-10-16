import { register } from 'node:module';
register('./helpers/staticAssetsLoader.mjs', import.meta.url);
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const { default: CatalogProductImage } = await import('../src/cardapio/components/CatalogProductImage');
const { CardapioRecommendations } = await import('../src/cardapio/components/CardapioRecommendations');
const { CardapioHighlights } = await import('../src/cardapio/components/CardapioHighlights');
const { default: CardapioPromotions } = await import('../src/cardapio/components/CardapioPromotions');
import type { BrandConfig } from '../src/cardapio/CardapioTypes';
const { LOCAL_PRODUCT_PLACEHOLDER } = await import('../src/cardapio/CardapioTypes');

const image = 'https://images.example.com/canonical.png';
const brand = { products: [{ id: 'g', name: 'Prato', category: 'Especiais', price: 14,
  description: '', image }], promotionProducts: [], promotions: [{ id: 'offer', nome: 'Conjunto',
  preco: 16, componentes: [['g'], ['drink']] }] } as unknown as BrandConfig;

test('recomendações, destaques e ofertas renderizam a imagem canônica do catálogo', () => {
  for (const component of [React.createElement(CardapioRecommendations, { brand }),
    React.createElement(CardapioHighlights, { brand }),
    React.createElement(CardapioPromotions, { brand, onSelect() {} })]) {
    assert.match(renderToStaticMarkup(component), /src="https:\/\/images.example.com\/canonical.png"/);
  }
});

test('imagem ausente usa fallback local; falha de carregamento recupera sem repetir indefinidamente', () => {
  const element = CatalogProductImage({});
  assert.equal(element.props.src, LOCAL_PRODUCT_PLACEHOLDER);
  const target = { src: image };
  element.props.onError({ currentTarget: target } as any);
  assert.equal(target.src, LOCAL_PRODUCT_PLACEHOLDER);
  element.props.onError({ currentTarget: target } as any);
  assert.equal(target.src, LOCAL_PRODUCT_PLACEHOLDER);
});
