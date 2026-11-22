import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CashierPdvView from '../src/components/caixa/pdv/CashierPdvView';
import {
  allocatePdvOptimisticItemPrices,
  calculatePdvCartPricing,
  extractPdvPromotionOrderFields,
  extractPromotionsPayload,
  filterActivePdvPromotions,
  findConflictingPdvPromotion,
  getNextPdvPromotionTransition,
  isSingleItemSimpleDiscountPromotion,
  removePdvPromotionInstanceAt,
  toCardapioProduct,
  type PdvPromotion,
} from '../src/components/caixa/pdv/pdvPromotions';
import type { PdvCartItem, useCashierPdv } from '../src/components/caixa/pdv/useCashierPdv';
import { EMPTY_DELIVERY_ADDRESS } from '../src/domain/deliveryAddress';
import type { Product } from '../src/types';

test('extractPdvPromotionOrderFields returns undefined when no promotion items exist', () => {
  const result = extractPdvPromotionOrderFields([
    { quantity: 2 },
    { quantity: 1 },
  ]);
  assert.deepEqual(result, {
    promocao_id: undefined,
    promocao_item_indices: undefined,
  });
});

test('extractPdvPromotionOrderFields computes 0-based flattened indices for promotion items', () => {
  const result = extractPdvPromotionOrderFields([
    { quantity: 2 }, // indices 0, 1
    { quantity: 1, promotionId: 'promo-1' }, // index 2
    { quantity: 3, promotionId: 'promo-1' }, // indices 3, 4, 5
    { quantity: 1 }, // index 6
  ]);
  assert.deepEqual(result, {
    promocao_id: 'promo-1',
    promocao_item_indices: [2, 3, 4, 5],
  });
});

test('filterActivePdvPromotions keeps active status or active schedule window', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  const promos: PdvPromotion[] = [
    { id: '1', nome: 'Ativa', preco: 20, componentes: [['p1']], ativo: true, status: 'ativa' },
    { id: '2', nome: 'Pausada', preco: 20, componentes: [['p1']], ativo: false, status: 'pausada' },
    { id: '3', nome: 'Janela valida', preco: 20, componentes: [['p1']], ativo: true, inicio_em: '2026-11-21T10:00:00Z', fim_em: '2026-11-21T14:00:00Z' },
    { id: '4', nome: 'Expirada', preco: 20, componentes: [['p1']], ativo: true, inicio_em: '2026-11-21T08:00:00Z', fim_em: '2026-11-21T11:00:00Z' },
  ];
  const active = filterActivePdvPromotions(promos, now);
  assert.deepEqual(active.map((p) => p.id), ['1', '3']);
});

test('isSingleItemSimpleDiscountPromotion detects 1-item simple discount vs combo or required modifiers', () => {
  const simpleProduct: Product = {
    id: 'p1',
    nome: 'Refrigerante Lata',
    categoria: 'Bebidas',
    descricao: '',
    preco: 8,
    ativo: true,
  };
  const comboPromo: PdvPromotion = {
    id: 'promo-combo',
    nome: 'Combo',
    preco: 30,
    tipo: 'combo',
    componentes: [['p1'], ['p1']],
    ativo: true,
  };
  const simplePromo: PdvPromotion = {
    id: 'promo-simple',
    nome: 'Refri Promo',
    preco: 5,
    tipo: 'desconto_item',
    componentes: [['p1']],
    quantidades: [1],
    ativo: true,
  };

  assert.equal(isSingleItemSimpleDiscountPromotion(comboPromo, [simpleProduct]), null);
  assert.equal(isSingleItemSimpleDiscountPromotion(simplePromo, [simpleProduct])?.id, 'p1');
});

test('extractPromotionsPayload handles backend envelope, legacy array and invalid payloads', () => {
  const realApiEnvelope = {
    perfil_marmitaria: true,
    promocoes: [
      {
        id: 'promo-bf',
        nome: 'Quentinha G · Black Friday',
        preco: 15,
        tipo: 'desconto_item',
        componentes: [['prod-g']],
        quantidades: [1],
        ativo: true,
        status: 'ativa',
      },
      {
        id: 'promo-5x1',
        nome: 'Compre 5 Quentinhas G e ganhe 1 M',
        preco: 100,
        tipo: 'compre_ganhe',
        componentes: [['prod-g'], ['prod-m']],
        quantidades: [5, 1],
        ativo: true,
        status: 'ativa',
      },
    ],
    produtos: [],
    categorias: [],
  };

  const parsedEnvelope = extractPromotionsPayload(realApiEnvelope);
  assert.equal(parsedEnvelope.isValid, true);
  assert.equal(parsedEnvelope.promotions.length, 2);

  const active = filterActivePdvPromotions(parsedEnvelope.promotions);
  assert.deepEqual(
    active.map((p) => p.nome),
    ['Quentinha G · Black Friday', 'Compre 5 Quentinhas G e ganhe 1 M'],
  );

  const parsedLegacy = extractPromotionsPayload(realApiEnvelope.promocoes);
  assert.equal(parsedLegacy.isValid, true);
  assert.equal(parsedLegacy.promotions.length, 2);

  const parsedInvalid = extractPromotionsPayload({ unexpected: true });
  assert.equal(parsedInvalid.isValid, false);
  assert.deepEqual(parsedInvalid.promotions, []);
});

test('CashierPdvView renders Ofertas filter and both promotion cards from backend envelope', () => {
  const prodG: Product = {
    id: 'prod-g',
    nome: 'Quentinha G',
    categoria: 'Marmitas',
    descricao: '',
    preco: 20,
    ativo: true,
  };
  const prodM: Product = {
    id: 'prod-m',
    nome: 'Quentinha M',
    categoria: 'Marmitas',
    descricao: '',
    preco: 18,
    ativo: true,
  };

  const apiResponse = {
    perfil_marmitaria: true,
    promocoes: [
      {
        id: 'promo-bf',
        nome: 'Quentinha G · Black Friday',
        preco: 15,
        tipo: 'desconto_item' as const,
        componentes: [['prod-g']],
        quantidades: [1],
        ativo: true,
        status: 'ativa' as const,
      },
      {
        id: 'promo-5x1',
        nome: 'Compre 5 Quentinhas G e ganhe 1 M',
        preco: 100,
        tipo: 'compre_ganhe' as const,
        componentes: [['prod-g'], ['prod-m']],
        quantidades: [5, 1],
        ativo: true,
        status: 'ativa' as const,
      },
    ],
    produtos: [prodG, prodM],
    categorias: [{ id: 'cat-1', nome: 'Marmitas' }],
  };

  const { promotions } = extractPromotionsPayload(apiResponse);
  const activePromotions = filterActivePdvPromotions(promotions);

  const mockPdv: ReturnType<typeof useCashierPdv> = {
    activePromotions,
    configuringPromotion: null,
    setConfiguringPromotion: () => {},
    loadPromotions: async () => {},
    addPromotionToCart: () => {},
    cartTotal: 0,
    pdvItemsSubtotal: 0,
    pdvDeliveryFee: 0,
    pdvNeighborhoodOptions: [],
    changeFor: '',
    setChangeFor: () => {},
    openCounter: () => {},
    balcaoMobileView: 'produtos',
    setBalcaoMobileView: () => {},
    pdvProductDetailId: null,
    setPdvProductDetailId: () => {},
    pdvOccupiedTableCount: 0,
    pdvSearch: '',
    setPdvSearch: () => {},
    pdvSelectedCategory: 'todos',
    setPdvSelectedCategory: () => {},
    pdvCart: [],
    setPdvCart: () => {},
    pdvCustomerName: '',
    setPdvCustomerName: () => {},
    pdvCustomerPhone: '',
    setPdvCustomerPhone: () => {},
    setPdvCustomerId: () => {},
    pdvCustomerLookup: 'idle',
    pdvOrderType: 'pickup',
    setPdvOrderType: () => {},
    allowedPdvOrderTypes: ['pickup', 'delivery', 'dine_in'],
    pdvPaymentMethod: null,
    setPdvPaymentMethod: () => {},
    pdvDeliveryAddress: '',
    pdvDeliveryAddressDraft: EMPTY_DELIVERY_ADDRESS,
    pdvDeliveryAddressLegacyHint: '',
    handlePdvDeliveryAddressChange: () => {},
    pdvTargetMesaId: 0,
    setPdvTargetMesaId: () => {},
    selectedPdvTableOption: undefined,
    pdvCartItemCount: 0,
    handlePdvAddToCart: () => {},
    handlePdvUpdateCartQty: () => {},
    handlePdvRemoveCartItem: () => {},
    handlePdvSubmitOrder: async () => {},
    sellableProducts: [prodG, prodM],
    pdvCategories: [{ id: 'cat-1', nome: 'Marmitas', destino_impressao: 'COZINHA' }],
    pdvMenuInsights: { destination: 'Retirada', itemCount: 0, total: 'R$ 0,00', pausedCount: 0 },
    filteredProducts: [prodG, prodM],
    cartHasUnavailableItems: false,
    cartUnavailableItemNames: [],
    checkCartItemAvailability: () => ({ unavailable: false, reason: null }),
    unavailableSearchMatches: [],
  };

  const html = renderToStaticMarkup(
    createElement(CashierPdvView, {
      activeSubTab: 'balcao',
      catalogReady: true,
      isLoading: false,
      pdvTableOptions: [],
      pdv: mockPdv,
    }),
  );

  assert.match(html, /Ofertas[\s\S]*?<span[^>]*>2<\/span>/);
  assert.match(html, /data-testid="pdv-active-offers"/);
  assert.match(html, /Quentinha G · Black Friday/);
  assert.match(html, /Compre 5 Quentinhas G e ganhe 1 M/);
});

test('calculatePdvCartPricing charges campaign price once per instance plus paid modifiers and allocates optimistic prices exactly', () => {
  const prodG: Product = {
    id: 'prod-g',
    nome: 'Quentinha G',
    categoria: 'Marmitas',
    descricao: '',
    preco: 14,
    ativo: true,
  };
  const prodM: Product = {
    id: 'prod-m',
    nome: 'Quentinha M',
    categoria: 'Marmitas',
    descricao: '',
    preco: 10,
    ativo: true,
  };
  const prodSuco: Product = {
    id: 'prod-suco',
    nome: 'Suco',
    categoria: 'Bebidas',
    descricao: '',
    preco: 8,
    preco_promocional: 6,
    ativo: true,
  };
  const activePromos: PdvPromotion[] = [
    {
      id: 'promo-bf',
      nome: 'Black Friday G',
      preco: 10,
      tipo: 'desconto_item',
      componentes: [['prod-g']],
      quantidades: [1],
      ativo: true,
      status: 'ativa',
    },
    {
      id: 'promo-combo',
      nome: 'Combo 2G + 1M',
      preco: 25,
      tipo: 'combo',
      componentes: [['prod-g'], ['prod-m']],
      quantidades: [2, 1],
      ativo: true,
      status: 'ativa',
    },
  ];

  // Instance 1 + Instance 2 of Black Friday G (one with paid modifier), plus direct promo Suco
  const bfItems: PdvCartItem[] = [
    {
      product: prodG,
      quantity: 1,
      obs: '',
      client: 'Balcão',
      modifiers: [{ id: 'ovo', nome: 'Ovo', preco: 2 }],
      promotionId: 'promo-bf',
      promotionInstanceId: 'inst-1',
      promotionName: 'Black Friday G',
      promotionPrice: 10,
    },
    {
      product: prodG,
      quantity: 1,
      obs: '',
      client: 'Balcão',
      modifiers: [],
      promotionId: 'promo-bf',
      promotionInstanceId: 'inst-2',
      promotionName: 'Black Friday G',
      promotionPrice: 10,
    },
    {
      product: prodSuco,
      quantity: 2,
      obs: '',
      client: 'Balcão',
      modifiers: [],
    },
  ];

  const pricing = calculatePdvCartPricing(bfItems, activePromos);
  assert.deepEqual(pricing, {
    itemsSubtotal: 34, // (10 + 2) + 10 + 2*6
    regularSubtotal: 12,
    promotionsSubtotal: 22,
    promotionInstanceCount: 2,
  });

  const allocated = allocatePdvOptimisticItemPrices(bfItems, activePromos);
  assert.deepEqual(allocated, [12, 10, 6, 6]);
  assert.equal(allocated.reduce((a, b) => a + b, 0), pricing.itemsSubtotal);

  const fields = extractPdvPromotionOrderFields(bfItems, activePromos);
  assert.deepEqual(fields, {
    promocao_id: 'promo-bf',
    promocao_item_indices: [0, 1],
    promocao_preco_esperado: 10, // unitary price of 1 instance for backend validation
  });

  // 3-part combo with odd division (R$ 10,00 across 3 parts -> 3.34 + 3.33 + 3.33)
  const oddPromo: PdvPromotion = {
    id: 'promo-odd',
    nome: 'Trio 10',
    preco: 10,
    componentes: [['prod-g'], ['prod-g'], ['prod-m']],
    ativo: true,
    status: 'ativa',
  };
  const oddComboItems: PdvCartItem[] = [
    { product: prodG, quantity: 1, obs: '', client: 'Balcão', promotionId: 'promo-odd', promotionInstanceId: 'o1', promotionPrice: 10 },
    { product: prodG, quantity: 1, obs: '', client: 'Balcão', promotionId: 'promo-odd', promotionInstanceId: 'o1', promotionPrice: 10 },
    { product: prodM, quantity: 1, obs: '', client: 'Balcão', promotionId: 'promo-odd', promotionInstanceId: 'o1', promotionPrice: 10 },
  ];
  const oddAllocated = allocatePdvOptimisticItemPrices(oddComboItems, [oddPromo]);
  assert.equal(Math.round(oddAllocated.reduce((a, b) => a + b, 0) * 100), 1000);
});

test('PDV promotion guards block second distinct campaign and remove promotion instances atomically', () => {
  const prodG: Product = { id: 'g', nome: 'Quentinha G', categoria: 'M', descricao: '', preco: 14, ativo: true };
  const prodM: Product = { id: 'm', nome: 'Quentinha M', categoria: 'M', descricao: '', preco: 10, ativo: true };

  const cart: PdvCartItem[] = [
    { product: prodG, quantity: 1, obs: '', client: 'Balcão', promotionId: 'combo-1', promotionInstanceId: 'i1', promotionName: 'Combo 1', promotionPrice: 20 },
    { product: prodM, quantity: 1, obs: '', client: 'Balcão', promotionId: 'combo-1', promotionInstanceId: 'i1', promotionName: 'Combo 1', promotionPrice: 20 },
    { product: prodG, quantity: 1, obs: '', client: 'Balcão', promotionId: 'combo-1', promotionInstanceId: 'i2', promotionName: 'Combo 1', promotionPrice: 20 },
    { product: prodM, quantity: 1, obs: '', client: 'Balcão', promotionId: 'combo-1', promotionInstanceId: 'i2', promotionName: 'Combo 1', promotionPrice: 20 },
    { product: prodM, quantity: 2, obs: '', client: 'Balcão' },
  ];

  assert.equal(findConflictingPdvPromotion(cart, 'combo-1'), null);
  assert.deepEqual(findConflictingPdvPromotion(cart, 'combo-2'), {
    promotionId: 'combo-1',
    promotionName: 'Combo 1',
  });

  const removed = removePdvPromotionInstanceAt(cart, 1);
  assert.equal(removed.removedPromoName, 'Combo 1');
  assert.equal(removed.nextCart.length, 3);
  assert.deepEqual(removed.nextCart.map((i) => i.promotionInstanceId || 'regular'), ['i2', 'i2', 'regular']);
});

test('filterActivePdvPromotions and transition helper enforce inicio_em/fim_em boundaries even with status', () => {
  const start = '2026-11-22T12:00:00Z';
  const end = '2026-11-22T14:00:00Z';
  const promos: PdvPromotion[] = [
    { id: 'sched', nome: 'Agendada', preco: 10, componentes: [['g']], ativo: true, status: 'agendada', inicio_em: start, fim_em: end },
    { id: 'exp', nome: 'Expirando', preco: 12, componentes: [['g']], ativo: true, status: 'ativa', fim_em: '2026-11-22T11:30:00Z' },
  ];

  const t1 = Date.parse('2026-11-22T11:00:00Z');
  assert.deepEqual(filterActivePdvPromotions(promos, t1).map((p) => p.id), ['exp']);
  assert.deepEqual(getNextPdvPromotionTransition(promos, t1), {
    nextAtMs: Date.parse('2026-11-22T11:30:00Z'),
    isStartBoundary: false,
  });

  const t2 = Date.parse('2026-11-22T12:00:00Z');
  assert.deepEqual(filterActivePdvPromotions(promos, t2).map((p) => p.id), ['sched']);

  const t3 = Date.parse('2026-11-22T14:00:00Z');
  assert.deepEqual(filterActivePdvPromotions(promos, t3), []);
});

test('toCardapioProduct preserves modifierGroups minSelection, selectionMode, and effective price; PDV hook wires sync events', () => {
  const mapped = toCardapioProduct({
    id: 'g',
    nome: 'Quentinha G',
    categoria: 'Marmitas',
    descricao: '',
    preco: 14,
    preco_promocional: 10,
    ativo: true,
    grupos_modificadores: [
      {
        id: 'prot',
        nome: 'Proteínas',
        min_selecoes: 2,
        max_selecoes: 2,
        modo_selecao: 'porcoes',
        tipo: 'obrigatorio',
        opcoes: [
          { id: 'o1', grupo_id: 'prot', nome: 'Frango', preco_adicional: 0, ativo: true },
          { id: 'o2', grupo_id: 'prot', nome: 'Pausado', preco_adicional: 0, ativo: false },
        ],
      },
    ],
  } as Product & { grupos_modificadores: any[] });

  assert.equal(mapped.price, 10);
  assert.equal(mapped.modifierGroups?.[0]?.minSelection, 2);
  assert.equal(mapped.modifierGroups?.[0]?.selectionMode, 'porcoes');
  assert.equal(mapped.modifierGroups?.[0]?.options[1]?.active, false);

  const pdvHook = readFileSync(new URL('../src/components/caixa/pdv/useCashierPdv.ts', import.meta.url), 'utf8');
  const pdvView = readFileSync(new URL('../src/components/caixa/pdv/CashierPdvView.tsx', import.meta.url), 'utf8');
  assert.match(pdvHook, /koma_cardapio_config_updated/);
  assert.match(pdvHook, /koma_catalog_updated/);
  assert.match(pdvHook, /force,/);
  assert.match(pdvHook, /getNextPdvPromotionTransition/);
  assert.match(pdvView, /getEffectiveProductPrice/);
  assert.match(pdvView, /!item\.promotionId/);
});
