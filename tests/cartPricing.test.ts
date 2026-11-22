import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Product } from '../src/cardapio/CardapioTypes';
import type { CartItem } from '../src/cardapio/components/CardapioCartDrawer';
import { groupCategoryProductsForDisplay, isGroupedProduct } from '../src/cardapio/catalogGrouping';
import {
  getCardapioCartItemLineTotal,
  getCardapioCartItemUnitPrice,
  getCardapioCartSubtotal,
  getCatalogDisplayEffectivePrice,
} from '../src/cardapio/cartPricing';

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const makeProduct = (overrides: Partial<Product> = {}): Product => ({
  id: 'q-g',
  name: 'Quentinha G',
  description: 'Marmita grande',
  price: 14,
  promotionalPrice: null,
  image: '',
  category: 'Quentinhas',
  isAvailable: true,
  ...overrides,
});

test('cartPricing computes effective unit price, line total, and subtotal for direct promo, campaign, and regular items', () => {
  const directPromoItem: CartItem = {
    id: 'q-g-ovo-',
    product: makeProduct({ id: 'q-g', price: 14, promotionalPrice: 10 }),
    quantity: 2,
    selectedOptions: {
      extras: [{ id: 'ovo', name: 'Ovo frito', extraPrice: 2.5 }],
    },
    notes: '',
  };

  const campaignItem: CartItem = {
    id: 'promotion:bf:1',
    product: makeProduct({
      id: 'promotion:bf',
      name: 'Black Friday Quentinha G',
      price: 10,
      category: 'Promoções',
    }),
    quantity: 1,
    selectedOptions: {
      '0:extras': [{ id: 'bacon', name: 'Bacon', extraPrice: 3 }],
    },
    notes: '',
    promotionId: 'bf',
    promotionParts: [
      {
        product: makeProduct({ id: 'q-g', price: 14 }),
        quantity: 1,
        selectedOptions: { extras: [{ id: 'bacon', name: 'Bacon', extraPrice: 3 }] },
        notes: '',
      },
    ],
  };

  const invalidPromoItem: CartItem = {
    id: 'suco--',
    product: makeProduct({ id: 'suco', name: 'Suco', price: 8, promotionalPrice: 12 }),
    quantity: 3,
    selectedOptions: {},
    notes: '',
  };

  assert.equal(getCardapioCartItemUnitPrice(directPromoItem), 12.5);
  assert.equal(getCardapioCartItemLineTotal(directPromoItem), 25);

  assert.equal(getCardapioCartItemUnitPrice(campaignItem), 13);
  assert.equal(getCardapioCartItemLineTotal(campaignItem), 13);

  assert.equal(getCardapioCartItemUnitPrice(invalidPromoItem), 8);
  assert.equal(getCardapioCartItemLineTotal(invalidPromoItem), 24);

  assert.equal(getCardapioCartSubtotal([directPromoItem, campaignItem, invalidPromoItem]), 62);
});

test('cartPricing falls back to promotionParts options when selectedOptions is empty', () => {
  const campaignWithPartsOnly: CartItem = {
    id: 'promotion:combo:1',
    product: makeProduct({ id: 'promotion:combo', name: 'Combo', price: 22 }),
    quantity: 2,
    selectedOptions: {},
    notes: '',
    promotionId: 'combo',
    promotionParts: [
      {
        product: makeProduct({ id: 'g', price: 14 }),
        quantity: 1,
        selectedOptions: { extras: [{ id: 'queijo', name: 'Queijo', extraPrice: 2 }] },
        notes: '',
      },
    ],
  };

  assert.equal(getCardapioCartItemUnitPrice(campaignWithPartsOnly), 24);
  assert.equal(getCardapioCartItemLineTotal(campaignWithPartsOnly), 48);
});

test('getCatalogDisplayEffectivePrice resolves single products and grouped families accurately', () => {
  const discounted = makeProduct({ id: 'q-g', price: 14, promotionalPrice: 10 });
  assert.deepEqual(getCatalogDisplayEffectivePrice(discounted), {
    effectivePrice: 10,
    originalPrice: 14,
    discountPercent: 29,
    hasDiscount: true,
    isFromPrice: false,
  });

  const regular = makeProduct({ id: 'q-m', price: 12, promotionalPrice: null });
  assert.deepEqual(getCatalogDisplayEffectivePrice(regular), {
    effectivePrice: 12,
    originalPrice: null,
    discountPercent: null,
    hasDiscount: false,
    isFromPrice: false,
  });

  const familyProducts = [
    makeProduct({
      id: 'q-p',
      name: 'Quentinha P',
      price: 11,
      familia_id: 'fam-q',
      familia_nome: 'Quentinhas',
      familia_eixo: 'tamanho',
      variacao_rotulo: 'P',
    }),
    makeProduct({
      id: 'q-g',
      name: 'Quentinha G',
      price: 14,
      promotionalPrice: 10,
      familia_id: 'fam-q',
      familia_nome: 'Quentinhas',
      familia_eixo: 'tamanho',
      variacao_rotulo: 'G',
    }),
  ];
  const [grouped] = groupCategoryProductsForDisplay('Quentinhas', familyProducts, '6');
  assert.ok(isGroupedProduct(grouped));
  assert.deepEqual(getCatalogDisplayEffectivePrice(grouped), {
    effectivePrice: 10,
    originalPrice: null,
    discountPercent: null,
    hasDiscount: false,
    isFromPrice: true,
  });

  const uniformDiscountFamily = [
    makeProduct({
      id: 'p-1',
      name: 'Pastel Carne',
      price: 14,
      promotionalPrice: 10,
      familia_id: 'fam-pastel',
      familia_nome: 'Pastéis',
      familia_eixo: 'sabor',
      variacao_rotulo: 'Carne',
      modifierGroups: [
        {
          id: 'massa',
          name: 'Massa',
          minSelection: 1,
          maxSelection: 1,
          type: 'obrigatorio',
          options: [{ id: 'm1', name: 'Especial', extraPrice: 2, active: true }],
        },
      ],
    }),
  ];
  const [uniformGrouped] = groupCategoryProductsForDisplay('Pastéis', uniformDiscountFamily, '6');
  assert.ok(isGroupedProduct(uniformGrouped));
  assert.deepEqual(getCatalogDisplayEffectivePrice(uniformGrouped), {
    effectivePrice: 12,
    originalPrice: 16,
    discountPercent: 25,
    hasDiscount: true,
    isFromPrice: false,
  });
});

test('Cardapio V2 Hero, CartDrawer, Checkout, Page, and ProductModal wire canonical pricing and zero-PII telemetry', () => {
  const heroV2 = source('../src/cardapio/v2/MenuV2Experience.tsx');
  const digitalCheckout = source('../src/cardapio/components/CardapioDigital.tsx');
  const cartDrawer = source('../src/cardapio/components/CardapioCartDrawer.tsx');
  const cardapioPage = source('../src/cardapio/CardapioPage.tsx');
  const productModal = source('../src/cardapio/components/CardapioProductModal.tsx');

  assert.match(heroV2, /getCatalogDisplayEffectivePrice\(heroProduct\)/);
  assert.match(heroV2, /A partir de /);
  assert.match(heroV2, /className="km-price--strike"/);
  assert.doesNotMatch(heroV2, /formatMenuPrice\(heroProduct\.price\)/);

  assert.match(digitalCheckout, /getCardapioCartSubtotal\(cart\)/);
  assert.match(digitalCheckout, /getCardapioCartItemLineTotal\(item\)/);
  assert.doesNotMatch(digitalCheckout, /let unitPrice = item\.product\.price/);

  assert.match(cartDrawer, /getCardapioCartSubtotal\(cart\)/);
  assert.match(cartDrawer, /getCatalogDisplayEffectivePrice\(prod\)/);
  assert.doesNotMatch(cartDrawer, /\bitem\.product\.price\b|\bprod\.price\b/);

  assert.match(cardapioPage, /getCardapioCartSubtotal\(cart\)/);
  assert.doesNotMatch(cardapioPage, /React\.lazy\(/);
  assert.match(cardapioPage, /pricing_mode:\s*priceInfo\.hasDiscount\s*\?\s*'direct_promo'\s*:\s*'regular'/);
  assert.match(cardapioPage, /pricing_mode:\s*'campaign'/);
  assert.match(cardapioPage, /parts_count:\s*parts\.length/);

  assert.match(digitalCheckout, /promotion_id:\s*orderRequest\.promocao_id \|\| null/);
  assert.match(digitalCheckout, /promotion_item_count:/);
  assert.match(digitalCheckout, /has_direct_promo_item:/);
  assert.match(digitalCheckout, /displayed_subtotal:/);
  assert.match(digitalCheckout, /expected_total:/);
  assert.match(digitalCheckout, /authoritative_total:/);
  assert.match(digitalCheckout, /price_divergence_cents:/);

  assert.match(productModal, /getEffectiveProductPrice\(\s*effectiveProduct\.price,\s*effectiveProduct\.promotionalPrice,?\s*\)\.effectivePrice/);
  assert.match(productModal, /effectivePriceInfo\.originalPrice \+ extrasPerUnit/);
  assert.match(productModal, /variantPriceInfo\.originalPrice \+ mandatoryExtraOffset/);
});
