import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CashierPdvView from '../src/components/caixa/pdv/CashierPdvView';
import {
  extractPdvPromotionOrderFields,
  extractPromotionsPayload,
  filterActivePdvPromotions,
  isSingleItemSimpleDiscountPromotion,
  type PdvPromotion,
} from '../src/components/caixa/pdv/pdvPromotions';
import type { useCashierPdv } from '../src/components/caixa/pdv/useCashierPdv';
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
