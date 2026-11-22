import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrandConfig, Product } from '../src/cardapio/CardapioTypes';

register('./helpers/staticAssetsLoader.mjs', import.meta.url);

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    location: { hostname: 'localhost', protocol: 'http:' },
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  },
});

const { default: CardapioCartDrawer } = await import('../src/cardapio/components/CardapioCartDrawer');
const { default: MenuV2Experience } = await import('../src/cardapio/v2/MenuV2Experience');
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

test('4. Dock da vitrine V2: permanece montado com dockHidden={false} nas 4 abas e oculta com dockHidden={true}', () => {
  // Cenário sem overlay: dock deve estar presente com o total formatado
  const htmlWithoutOverlay = renderToStaticMarkup(
    createElement(MenuV2Experience, {
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
      dockHidden: false,
    })
  );

  assert.match(htmlWithoutOverlay, /id="koma-art-dock"/);
  assert.match(htmlWithoutOverlay, /Ver sacola[\s\S]*R\$\s*103,00|R\$\s*103,00/);

  // Cenário com aba aberta (hasOpenOverlay: true, dockHidden: false): dock permanece montado, FAB oculto
  for (const activeDockTab of ['home', 'orders', 'bag', 'account'] as const) {
    const htmlWithTabSheet = renderToStaticMarkup(
      createElement(MenuV2Experience, {
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
        hasOpenOverlay: activeDockTab !== 'home',
        dockHidden: false,
        activeDockTab,
      })
    );

    assert.match(htmlWithTabSheet, /id="koma-art-dock"/);
  }

  // Cenário com modal bloqueante aberto (dockHidden: true): dock DEVE ser ocultado
  const htmlWithBlockingModal = renderToStaticMarkup(
    createElement(MenuV2Experience, {
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
      dockHidden: true,
    })
  );

  assert.doesNotMatch(htmlWithBlockingModal, /id="koma-art-dock"/);

  // Retrocompatibilidade: quando dockHidden é omitido, hasOpenOverlay: true oculta o dock
  const htmlLegacyOverlay = renderToStaticMarkup(
    createElement(MenuV2Experience, {
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

  assert.doesNotMatch(htmlLegacyOverlay, /id="koma-art-dock"/);
});

test('5. Hero da vitrine V2: exibe Nº 1 mais pedido apenas se validado por ranking real', () => {
  // Com ranking validado (popularProductIds[0] === hero.id)
  const htmlVerified = renderToStaticMarkup(
    createElement(MenuV2Experience, {
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

  assert.match(htmlVerified, /id="koma-art-hero-showcase"/);
  assert.match(htmlVerified, /Nº 1 mais pedido/);

  // Sem ranking validado (destaque manual não alega ser o mais pedido)
  const htmlUnverified = renderToStaticMarkup(
    createElement(MenuV2Experience, {
      activeBrand: { ...baseBrand, popularProductIds: [], manualHighlightProductId: 'p-hero' },
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

  assert.match(htmlUnverified, /Destaque da casa/);
  assert.doesNotMatch(htmlUnverified, /Nº 1 mais pedido/);
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

test('7. Sacola: alternar de entrega para retirada zera a taxa de entrega imediatamente e respeita safe-area', () => {
  const brandWithDeliveryFee: BrandConfig = {
    ...baseBrand,
    deliveryEnabled: true,
    taxaEntregaPadrao: 12,
    activeOrderTypes: ['delivery', 'retirada'],
  };

  const cartItems = [
    {
      id: 'item-1',
      product: baseBrand.products[0], // R$ 65,00
      quantity: 1,
      selectedOptions: {},
      notes: '',
    },
  ];

  const deliveryHtml = renderToStaticMarkup(
    createElement(CardapioCartDrawer, {
      cart: cartItems,
      restaurantId: '999',
      brandConfig: brandWithDeliveryFee,
      initialFulfillment: 'delivery',
      user: null,
      onClose() {},
      onUpdateQty() {},
      onRemoveItem() {},
      onPlaceOrder() {},
    })
  );

  assert.doesNotMatch(deliveryHtml, /pb-\[86px\]/);
  assert.match(deliveryHtml, /pb-\[calc\(86px\+env\(safe-area-inset-bottom,0px\)\)\]/);
  assert.match(deliveryHtml, /md:pb-5/);
  assert.match(deliveryHtml, /Taxa de entrega/);
  assert.match(deliveryHtml, /R\$\s*12,00/);
  assert.match(deliveryHtml, /Total estimado[\s\S]*R\$\s*77,00/);

  const pickupHtml = renderToStaticMarkup(
    createElement(CardapioCartDrawer, {
      cart: cartItems,
      restaurantId: '999',
      brandConfig: brandWithDeliveryFee,
      initialFulfillment: 'pickup',
      user: null,
      onClose() {},
      onUpdateQty() {},
      onRemoveItem() {},
      onPlaceOrder() {},
    })
  );

  assert.doesNotMatch(pickupHtml, /Taxa de entrega/);
  assert.match(pickupHtml, /Total estimado[\s\S]*R\$\s*65,00/);
});

test('8. MenuV2Experience conecta MenuActiveOrderCard e MenuPromotionsShowcase preservando contratos', async () => {
  const { fallbackOrderState } = await import('../src/cardapio/orderTracking');
  const acceptedState = fallbackOrderState('aceito', 'Delivery');
  const activeOrder = {
    id: 'ord-accepted-1',
    numero_pedido: 77,
    timestamp: Date.now(),
    restaurante_id: 999,
    tipo: 'Delivery',
    total: 65,
    idempotency_key: '',
    status: 'aceito',
    state: acceptedState,
    delivery_receipt_code: '4821',
  };

  const brandWithOnePromo: BrandConfig = {
    ...baseBrand,
    promotions: [
      {
        id: 'promo-1',
        nome: 'Combo Especial',
        descricao: 'Filé com bebida',
        preco: 59,
        componentes: [['p-hero'], ['p-simple']],
      },
    ],
  };

  const html = renderToStaticMarkup(
    createElement(MenuV2Experience, {
      activeBrand: brandWithOnePromo,
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
      dockHidden: false,
      activeOrder,
      activeState: acceptedState,
      storedOrders: [activeOrder],
    })
  );

  assert.match(html, /id="active-order-banner"/);
  assert.match(html, /Aceito · aguardando preparo/);
  assert.match(html, /Aceito pela loja · próximo: preparo/);
  assert.match(html, /data-progress-current="1"/);
  assert.match(html, /4821/);
  assert.match(html, /id="cardapio-promotions-home"/);
  assert.match(html, /data-promo-layout="single"/);
  assert.match(html, /1 oferta/);
});

test('9. Hero usa MenuTopWaveBackdrop temático quando não há banner customizado (mesmo com placeholder)', async () => {
  const { LOCAL_BANNER_PLACEHOLDER } = await import('../src/cardapio/CardapioTypes');

  const htmlWithoutCustomBanner = renderToStaticMarkup(
    createElement(MenuV2Experience, {
      activeBrand: {
        ...baseBrand,
        bannerImage: LOCAL_BANNER_PLACEHOLDER,
        hasCustomBanner: false,
      },
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

  assert.match(htmlWithoutCustomBanner, /km-hero-wave-svg/);
  assert.doesNotMatch(htmlWithoutCustomBanner, /id="brand-banner-hero"/);
  assert.doesNotMatch(htmlWithoutCustomBanner, /km-hero-banner-bg/);

  const htmlWithCustomBanner = renderToStaticMarkup(
    createElement(MenuV2Experience, {
      activeBrand: {
        ...baseBrand,
        bannerImage: 'https://cdn.example.com/banner.jpg',
        hasCustomBanner: true,
      },
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

  assert.match(htmlWithCustomBanner, /id="brand-banner-hero"/);
  assert.match(htmlWithCustomBanner, /km-hero-banner-bg/);
  assert.doesNotMatch(htmlWithCustomBanner, /km-hero-wave-svg/);
});
