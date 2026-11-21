import { register } from 'node:module';
register('./helpers/staticAssetsLoader.mjs', import.meta.url);
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const { default: CatalogProductImage } = await import('../src/cardapio/components/CatalogProductImage');
const { default: MenuProductCard } = await import('../src/cardapio/v2/MenuProductCard');
const { default: MenuV2Experience } = await import('../src/cardapio/v2/MenuV2Experience');
import type { BrandConfig, Product } from '../src/cardapio/CardapioTypes';
const { LOCAL_PRODUCT_PLACEHOLDER } = await import('../src/cardapio/CardapioTypes');

const image = 'https://images.example.com/canonical.png';
const product: Product = {
  id: 'g',
  name: 'Prato',
  category: 'Especiais',
  price: 14,
  description: '',
  image,
  isAvailable: true,
};
const brand = {
  id: '2',
  slug: 'teste',
  name: 'Restaurante Teste',
  categories: ['Especiais'],
  products: [product],
  promotionProducts: [],
  promotions: [{ id: 'offer', nome: 'Conjunto', preco: 16, componentes: [['g'], ['drink']] }],
  popularProductIds: [],
  colors: { primary: '#00b894', background: '#090a0f' },
} as unknown as BrandConfig;

test('cards V2, destaques e ofertas renderizam a imagem canônica do catálogo', () => {
  const noop = () => {};
  const htmls = [
    renderToStaticMarkup(
      React.createElement(MenuProductCard, {
        product,
        variant: 'row',
        cartQuantity: 0,
        onSelectProduct: noop,
        onFastAdd: noop,
        onFastRemove: noop,
      }),
    ),
    renderToStaticMarkup(
      React.createElement(MenuProductCard, {
        product,
        variant: 'highlight',
        cartQuantity: 0,
        onSelectProduct: noop,
        onFastAdd: noop,
        onFastRemove: noop,
      }),
    ),
    renderToStaticMarkup(
      React.createElement(MenuV2Experience, {
        activeBrand: brand,
        searchQuery: '',
        setSearchQuery: noop,
        selectedCategory: 'Especiais',
        onSelectCategory: noop,
        onSelectProduct: noop,
        onFastAdd: noop,
        onFastRemove: noop,
        getProductCartQuantity: () => 0,
        onCartToggle: noop,
        cartCount: 0,
        cartTotal: 0,
        onStoreInfoClick: noop,
        onOrdersClick: noop,
        activeOrdersCount: 0,
        onPromotionSelect: noop,
        user: null,
        onAuthClick: noop,
        activeDockTab: 'home',
        onDockNavigate: noop,
      }),
    ),
  ];

  for (const html of htmls) {
    assert.match(html, /src="https:\/\/images\.example\.com\/canonical\.png"/);
  }
});

test('imagem ausente usa fallback local; falha de carregamento recupera sem repetir indefinidamente', () => {
  const element = CatalogProductImage({});
  assert.equal(element.props.src, LOCAL_PRODUCT_PLACEHOLDER);
  assert.equal(element.props.loading, 'lazy');
  assert.equal(element.props.decoding, 'async');
  assert.equal(element.props.fetchPriority, undefined);
  const target = { src: image };
  element.props.onError({ currentTarget: target } as any);
  assert.equal(target.src, LOCAL_PRODUCT_PLACEHOLDER);
  element.props.onError({ currentTarget: target } as any);
  assert.equal(target.src, LOCAL_PRODUCT_PLACEHOLDER);
});

test('CatalogProductImage prioriza carregamento somente quando solicitado para imagem crítica', () => {
  const hero = CatalogProductImage({ image, priority: true, width: 640, height: 480 });
  assert.equal(hero.props.loading, 'eager');
  assert.equal(hero.props.fetchPriority, 'high');
  assert.equal(hero.props.width, 640);
  assert.equal(hero.props.height, 480);
});
