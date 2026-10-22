import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrandConfig, Product } from '../src/cardapio/CardapioTypes';

register('./helpers/staticAssetsLoader.mjs', import.meta.url);

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { location: { hostname: 'localhost', protocol: 'http:' } },
});

const { default: CardapioCartDrawer } = await import('../src/cardapio/components/CardapioCartDrawer');
const { CardapioArtisticExperience } = await import('../src/cardapio/components/CardapioArtisticExperience');
const {
  KomaPrimaryAction,
  KomaSecondaryAction,
  KomaQuantityControl,
  KomaChoiceCard,
} = await import('../src/cardapio/components/KomaActionPrimitives');

const baseBrand: BrandConfig = {
  id: '999',
  name: 'Bistrô de Teste',
  slogan: 'Alta Gastronomia',
  logo: '',
  bannerImage: '',
  phone: '85999999999',
  address: 'Rua Principal, 100',
  colors: { primary: '#10b981', background: '#0a100d' },
  categories: ['Pratos', 'Bebidas'],
  products: [
    {
      id: 'p-hero',
      name: 'Filé Especial',
      price: 65,
      description: 'Filé mignon ao molho de vinho',
      category: 'Pratos',
      image: '',
      isAvailable: true,
    },
    {
      id: 'p-simple',
      name: 'Água com Gás',
      price: 6,
      description: 'Garrafa 500ml',
      category: 'Bebidas',
      image: '',
      isAvailable: true,
    },
    {
      id: 'p-custom',
      name: 'Hambúrguer Artesanal',
      price: 38,
      description: 'Pão brioche e blend especial',
      category: 'Pratos',
      image: '',
      isAvailable: true,
      modifierGroups: [
        {
          id: 'g-ponto',
          name: 'Ponto da carne',
          type: 'obrigatorio',
          minSelection: 1,
          maxSelection: 1,
          options: [
            { id: 'opt-ao-ponto', name: 'Ao ponto', extraPrice: 0 },
            { id: 'opt-bem-passado', name: 'Bem passado', extraPrice: 0 },
          ],
        },
      ],
    },
    {
      id: 'p-unavailable',
      name: 'Prato Esgotado',
      price: 50,
      description: 'Indisponível hoje',
      category: 'Pratos',
      image: '',
      isAvailable: false,
    },
  ],
  popularProductIds: ['p-hero'],
};

test('1. Sacola vazia: produtos com modificadores acionam seleção e produtos indisponíveis são omitidos', () => {
  const html = renderToStaticMarkup(
    createElement(CardapioCartDrawer, {
      cart: [],
      restaurantId: '999',
      brandConfig: baseBrand,
      allProducts: baseBrand.products,
      user: null,
      onClose() {},
      onUpdateQty() {},
      onRemoveItem() {},
      onPlaceOrder() {},
    })
  );

  // Apenas produtos disponíveis devem estar nos destaques
  assert.match(html, /Filé Especial/);
  assert.match(html, /Água com Gás/);
  assert.match(html, /Hambúrguer Artesanal/);
  assert.doesNotMatch(html, /Prato Esgotado/);

  // Produto com modificador exibe rótulo para montar, enquanto simples exibe adicionar
  assert.match(html, /Montar/);
  assert.match(html, /Adicionar/);
});

test('2. Numeração de etapas na sacola: sem benefícios/cupons segue 1 a 4 sequencial sem pular 3', () => {
  const brandWithoutDiscounts: BrandConfig = {
    ...baseBrand,
    benefits: { coupons: false, cashback: false, loyalty: false },
  };

  const html = renderToStaticMarkup(
    createElement(CardapioCartDrawer, {
      cart: [
        {
          id: 'item-1',
          product: baseBrand.products[0],
          quantity: 1,
          selectedOptions: {},
          notes: '',
        },
      ],
      restaurantId: '999',
      brandConfig: brandWithoutDiscounts,
      user: null,
      onClose() {},
      onUpdateQty() {},
      onRemoveItem() {},
      onPlaceOrder() {},
    })
  );

  // Chips no topo
  assert.match(html, /1\. Itens/);
  assert.match(html, /2\. Receber/);
  assert.match(html, /3\. Pagamento/);
  assert.match(html, /4\. Contato/);
  assert.doesNotMatch(html, /5\. Contato/);
  assert.doesNotMatch(html, /Cupom/);

  // Cabeçalhos das seções sincronizados com a numeração
  assert.match(html, /1\. Seu pedido/);
  assert.match(html, /2\. Como quer receber\?/);
  assert.match(html, /3\. Como quer pagar\?/);
  assert.match(html, /4\. Seu contato/);
});

test('3. Numeração de etapas na sacola: com cupons/benefícios segue 1 a 5 sequencial', () => {
  const brandWithDiscounts: BrandConfig = {
    ...baseBrand,
    benefits: { coupons: true, cashback: true, loyalty: false },
  };

  const html = renderToStaticMarkup(
    createElement(CardapioCartDrawer, {
      cart: [
        {
          id: 'item-1',
          product: baseBrand.products[0],
          quantity: 1,
          selectedOptions: {},
          notes: '',
        },
      ],
      restaurantId: '999',
      brandConfig: brandWithDiscounts,
      user: null,
      onClose() {},
      onUpdateQty() {},
      onRemoveItem() {},
      onPlaceOrder() {},
    })
  );

  // Chips no topo
  assert.match(html, /1\. Itens/);
  assert.match(html, /2\. Receber/);
  assert.match(html, /3\. Descontos/);
  assert.match(html, /4\. Pagamento/);
  assert.match(html, /5\. Contato/);

  // Cabeçalhos das seções sincronizados
  assert.match(html, /1\. Seu pedido/);
  assert.match(html, /2\. Como quer receber\?/);
  assert.match(html, /3\. Descontos &amp; Benefícios/);
  assert.match(html, /4\. Como quer pagar\?/);
  assert.match(html, /5\. Seu contato/);
});

test('4. Dock artístico: rotula explicitamente Subtotal e oculta quando hasOpenOverlay é true', () => {
  // Cenário sem overlay: dock deve estar presente com rótulo "Subtotal:"
  const htmlWithoutOverlay = renderToStaticMarkup(
    createElement(CardapioArtisticExperience, {
      activeBrand: baseBrand,
      searchQuery: '',
      setSearchQuery() {},
      selectedCategory: '',
      onSelectCategory() {},
      onSelectProduct() {},
      onFastAdd() {},
      onFastRemove() {},
      getProductCartQuantity: () => 0,
      onCartToggle() {},
      cartCount: 2,
      cartTotal: 103,
      onStoreInfoClick() {},
      hasOpenOverlay: false,
    })
  );

  assert.match(htmlWithoutOverlay, /id="koma-art-dock"/);
  assert.match(htmlWithoutOverlay, /Subtotal:\s*R\$\s*103,00/);

  // Cenário com overlay aberto (modal, drawer, sacola aberta): dock DEVE ser ocultado
  const htmlWithOverlay = renderToStaticMarkup(
    createElement(CardapioArtisticExperience, {
      activeBrand: baseBrand,
      searchQuery: '',
      setSearchQuery() {},
      selectedCategory: '',
      onSelectCategory() {},
      onSelectProduct() {},
      onFastAdd() {},
      onFastRemove() {},
      getProductCartQuantity: () => 0,
      onCartToggle() {},
      cartCount: 2,
      cartTotal: 103,
      onStoreInfoClick() {},
      hasOpenOverlay: true,
    })
  );

  assert.doesNotMatch(htmlWithOverlay, /id="koma-art-dock"/);
});

test('5. Hero da vitrine artística: exibe Nº 1 MAIS PEDIDO apenas se validado por ranking real', () => {
  // Com ranking validado (popularProductIds[0] === hero.id)
  const htmlVerified = renderToStaticMarkup(
    createElement(CardapioArtisticExperience, {
      activeBrand: { ...baseBrand, popularProductIds: ['p-hero'] },
      searchQuery: '',
      setSearchQuery() {},
      selectedCategory: '',
      onSelectCategory() {},
      onSelectProduct() {},
      onFastAdd() {},
      onFastRemove() {},
      getProductCartQuantity: () => 0,
      onCartToggle() {},
      cartCount: 0,
      onStoreInfoClick() {},
      hasOpenOverlay: false,
    })
  );

  assert.match(htmlVerified, /Nº 1 MAIS PEDIDO/);
  assert.match(htmlVerified, /★ ITEM MAIS PEDIDO/);

  // Sem ranking validado (popularProductIds vazio ou com outro id)
  const htmlUnverified = renderToStaticMarkup(
    createElement(CardapioArtisticExperience, {
      activeBrand: { ...baseBrand, popularProductIds: [] },
      searchQuery: '',
      setSearchQuery() {},
      selectedCategory: '',
      onSelectCategory() {},
      onSelectProduct() {},
      onFastAdd() {},
      onFastRemove() {},
      getProductCartQuantity: () => 0,
      onCartToggle() {},
      cartCount: 0,
      onStoreInfoClick() {},
      hasOpenOverlay: false,
    })
  );

  assert.match(htmlUnverified, /DESTAQUE DO CARDÁPIO/);
  assert.match(htmlUnverified, /★ DESTAQUE DA CASA/);
  assert.doesNotMatch(htmlUnverified, /Nº 1 MAIS PEDIDO/);
});

test('6. Primitivas KomaActionPrimitives: KomaPrimaryAction, KomaQuantityControl e KomaChoiceCard', () => {
  // Primary action renderiza botão com preço formatado e classe koma-action-primary
  const primaryHtml = renderToStaticMarkup(
    createElement(
      KomaPrimaryAction,
      { price: 42.5, id: 'test-primary' },
      'Confirmar'
    )
  );
  assert.match(primaryHtml, /koma-action-primary/);
  assert.match(primaryHtml, /Confirmar/);
  assert.match(primaryHtml, /R\$\s*42,50/);

  // Quantity control tem botões com alvos táteis e valor numérico
  const qtyHtml = renderToStaticMarkup(
    createElement(KomaQuantityControl, {
      quantity: 3,
      onIncrement() {},
      onDecrement() {},
      itemName: 'Hambúrguer',
      idMinus: 'minus-btn',
      idPlus: 'plus-btn',
    })
  );
  assert.match(qtyHtml, /id="minus-btn"/);
  assert.match(qtyHtml, /id="plus-btn"/);
  assert.match(qtyHtml, /koma-art-stepper-val/);
  assert.match(qtyHtml, />3</);

  // Choice card em modo rádio tem role="radio" e aparência de círculo
  const radioHtml = renderToStaticMarkup(
    createElement(KomaChoiceCard, {
      type: 'radio',
      selected: true,
      title: 'Opção Ao Ponto',
    })
  );
  assert.match(radioHtml, /role="radio"/);
  assert.match(radioHtml, /aria-checked="true"/);
  assert.match(radioHtml, /is-selected/);
});
