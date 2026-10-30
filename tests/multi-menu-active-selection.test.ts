import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { getSellableProducts, isProductSellable, normalizeCatalogSnapshot, type CatalogCategory } from '../src/catalog/catalog';
import { planWaiterRepeat } from '../src/domain/waiterRepeatItem';
import { MenuPanel } from '../src/components/MenuPanel';
import { MesaConsumptionPanel } from '../src/components/mesas/MesaConsumptionPanel';
import CashierPdvView from '../src/components/caixa/pdv/CashierPdvView';
import CashierCatalog from '../src/components/caixa/catalog/CashierCatalog';
import type { useCashierPdv, PdvCartItem } from '../src/components/caixa/pdv/useCashierPdv';
import { EMPTY_DELIVERY_ADDRESS } from '../src/domain/deliveryAddress';
import type { AppSettings, CardapioMenu, DraftItem, Order, Product } from '../src/types';
import { getCustomerSubtotals, getTableTotal } from '../src/domain';

const defaultSettings: AppSettings = {
  exibirImagens: false,
  exibirDescricoes: true,
  tamanhoFonte: 'padrao',
};

const createProduct = (overrides: Partial<Product> & { id: string; nome: string }): Product => ({
  preco: 10,
  categoria: 'Comidas',
  descricao: '',
  ativo: true,
  cardapio_id: null,
  ...overrides,
});

const createCategory = (overrides: Partial<CatalogCategory> & { id: string; nome: string }): CatalogCategory => ({
  destino_impressao: 'COZINHA',
  ...overrides,
});

test('operational catalog sells only active products from either selected menu', () => {
  const catalog = normalizeCatalogSnapshot({
    categorias: [{ id: 'c', nome: 'Comidas' }],
    cardapio_ativo_id: 'manha',
    cardapios_ativos_ids: ['manha', 'almoco'],
    produtos: [
      { id: 'a', nome: 'Bolo', categoria_id: 'c', preco: 5, ativo: true, cardapio_id: 'manha' },
      { id: 'b', nome: 'Almoço', categoria_id: 'c', preco: 10, ativo: true, cardapio_id: 'almoco' },
      { id: 'c', nome: 'Pausado', categoria_id: 'c', preco: 10, ativo: false, cardapio_id: 'almoco' },
      { id: 'd', nome: 'Outro', categoria_id: 'c', preco: 10, ativo: true, cardapio_id: 'noite' },
    ],
  });
  assert.deepEqual(
    getSellableProducts(catalog.produtos, catalog.cardapio_ativo_id, catalog.cardapios_ativos_ids).map(p => p.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    getSellableProducts(catalog.produtos, catalog.cardapio_ativo_id).map(p => p.id),
    ['a'],
  );
});

test('isProductSellable enforces single menu, multi-menu and legacy compatibility rules', () => {
  const activeMorning = createProduct({ id: 'p1', nome: 'Café', categoria: 'Bebidas', preco: 5, cardapio_id: 'manha' });
  const activeLunch = createProduct({ id: 'p2', nome: 'Prato Feito', categoria: 'Comidas', preco: 25, cardapio_id: 'almoco' });
  const pausedLunch = createProduct({ id: 'p3', nome: 'Salada', categoria: 'Comidas', preco: 15, ativo: false, cardapio_id: 'almoco' });
  const inactiveDinner = createProduct({ id: 'p4', nome: 'Sopa', categoria: 'Comidas', preco: 20, cardapio_id: 'jantar' });
  const noMenuProduct = createProduct({ id: 'p5', nome: 'Água', categoria: 'Bebidas', preco: 4, cardapio_id: null });

  // 1. Um único cardápio ativo: somente produtos dele são selecionáveis
  assert.equal(isProductSellable(activeMorning, 'manha', ['manha']), true);
  assert.equal(isProductSellable(activeLunch, 'manha', ['manha']), false);
  assert.equal(isProductSellable(inactiveDinner, 'manha', ['manha']), false);

  // 2. Dois ou mais cardápios ativos: produtos de ambos são selecionáveis
  assert.equal(isProductSellable(activeMorning, 'manha', ['manha', 'almoco']), true);
  assert.equal(isProductSellable(activeLunch, 'manha', ['manha', 'almoco']), true);
  assert.equal(isProductSellable(inactiveDinner, 'manha', ['manha', 'almoco']), false);

  // 3. Produto pausado: continua indisponível mesmo com seu cardápio ativo
  assert.equal(isProductSellable(pausedLunch, 'almoco', ['almoco']), false);

  // 4. Produto sem cardapio_id: nunca contorna configuração multi-cardápio ativa
  assert.equal(isProductSellable(noMenuProduct, 'manha', ['manha']), false);
  assert.equal(isProductSellable(noMenuProduct, 'manha', ['manha', 'almoco']), false);

  // 5. Sem nenhum cardápio ativo configurado (legado): produtos ativos continuam disponíveis
  assert.equal(isProductSellable(noMenuProduct, null, []), true);
  assert.equal(isProductSellable(activeMorning, null, []), true);
  assert.equal(isProductSellable(pausedLunch, null, []), false); // pausado continua false
});

test('planWaiterRepeat blocks re-ordering historical items when menu is inactive', () => {
  const item = {
    id: 'item-1',
    produtoId: 'p-dinner',
    nome: 'Prato Noturno',
    preco: 45,
    observacao: '',
    clienteNome: 'Mesa',
    status: 'pronto' as const,
  };
  const dinnerProduct = createProduct({
    id: 'p-dinner',
    nome: 'Prato Noturno',
    preco: 45,
    categoria: 'Jantar',
    cardapio_id: 'jantar',
  });

  // Se o cardápio 'jantar' não está ativo no conjunto operacional:
  const blockedPlan = planWaiterRepeat(item, dinnerProduct, 'almoco', ['almoco']);
  assert.equal(blockedPlan.kind, 'unavailable');
  if (blockedPlan.kind === 'unavailable') {
    assert.equal(blockedPlan.reason, 'Cardápio indisponível');
  }

  // Se o cardápio 'jantar' estiver ativo (simultâneo com almoço):
  const allowedPlan = planWaiterRepeat(item, dinnerProduct, 'almoco', ['almoco', 'jantar']);
  assert.equal(allowedPlan.kind, 'quick');

  // Se o produto estiver pausado:
  const pausedPlan = planWaiterRepeat(item, { ...dinnerProduct, ativo: false }, 'jantar', ['jantar']);
  assert.equal(pausedPlan.kind, 'unavailable');
  if (pausedPlan.kind === 'unavailable') {
    assert.equal(pausedPlan.reason, 'Produto indisponível');
  }
});

test('MenuPanel blocks submitting draft if an item belongs to a deactivated menu without deleting it', () => {
  const productA = createProduct({ id: 'p-a', nome: 'Item Almoço', preco: 30, categoria_id: 'cat-1', cardapio_id: 'almoco' });
  const productB = createProduct({ id: 'p-b', nome: 'Item Noite', preco: 40, categoria_id: 'cat-1', cardapio_id: 'jantar' });

  const draftItems: DraftItem[] = [
    { id: 'draft-1', produtoId: 'p-a', nome: 'Item Almoço', preco: 30, quantidade: 1, observacao: '', clienteNome: 'Consumo Geral' },
    { id: 'draft-2', produtoId: 'p-b', nome: 'Item Noite', preco: 40, quantidade: 1, observacao: '', clienteNome: 'Consumo Geral' },
  ];

  // Ativos apenas 'almoco': 'p-b' é do cardápio 'jantar' (inativo)
  const html = renderToStaticMarkup(
    createElement(MenuPanel, {
      tableId: 10,
      draftItems,
      existingOrders: [],
      settings: defaultSettings,
      onUpdateSettings: () => {},
      onAddToDraft: () => {},
      onRemoveFromDraft: () => {},
      onUpdateDraftItem: () => {},
      onEditDraftItems: () => {},
      onSubmitDraft: () => {},
      liveProdutos: [productA, productB],
      liveCategorias: [createCategory({ id: 'cat-1', nome: 'Comidas' })],
      cardapio_ativo_id: 'almoco',
      cardapios_ativos_ids: ['almoco'],
      catalogReady: true,
      standardQuickEntry: true,
    }),
  );

  // 1. O item inválido NÃO é apagado silenciosamente do rascunho
  assert.match(html, /id="draft-item-draft-2"/);
  assert.match(html, /Item Noite/);

  // 2. O item inválido recebe o aviso explícito de indisponibilidade
  assert.match(html, /id="draft-item-unavailable-draft-2"/);
  assert.match(html, /Item indisponível no cardápio ativo/);

  // 3. O alerta geral de bloqueio do rascunho é renderizado
  assert.match(html, /id="draft-unavailable-warning"/);
  assert.match(html, /Há itens indisponíveis no rascunho\. Remova-os antes de enviar o pedido\./);

  // 4. O botão de enviar o rascunho está disabled
  assert.match(html, /id="submit-draft-order-btn"[^>]*disabled/);
  assert.match(html, /id="submit-draft-order-btn-mobile"[^>]*disabled/);

  // 5. O botão de remoção manual pelo garçom continua presente para o item indisponível
  assert.match(html, /id="remove-draft-item-draft-2"/);
});

test('MenuPanel shows only sellable products from active menus and filters inactive ones to search', () => {
  const morningProduct = createProduct({ id: 'p-manha', nome: 'Café da Manhã', preco: 10, categoria_id: 'cat-1', cardapio_id: 'manha' });
  const lunchProduct = createProduct({ id: 'p-almoco', nome: 'Feijoada', preco: 35, categoria_id: 'cat-1', cardapio_id: 'almoco' });
  const nightProduct = createProduct({ id: 'p-noite', nome: 'Pizza Noturna', preco: 50, categoria_id: 'cat-1', cardapio_id: 'noite' });

  // Apenas 'manha' e 'almoco' ativos
  const html = renderToStaticMarkup(
    createElement(MenuPanel, {
      tableId: 10,
      draftItems: [],
      existingOrders: [],
      settings: defaultSettings,
      onUpdateSettings: () => {},
      onAddToDraft: () => {},
      onRemoveFromDraft: () => {},
      onUpdateDraftItem: () => {},
      onEditDraftItems: () => {},
      onSubmitDraft: () => {},
      liveProdutos: [morningProduct, lunchProduct, nightProduct],
      liveCategorias: [createCategory({ id: 'cat-1', nome: 'Comidas' })],
      cardapio_ativo_id: 'manha',
      cardapios_ativos_ids: ['manha', 'almoco'],
      catalogReady: true,
      standardQuickEntry: true,
    }),
  );

  // Produtos dos cardápios ativos devem aparecer nos cards normais
  assert.match(html, /id="product-card-p-manha"/);
  assert.match(html, /id="product-card-p-almoco"/);

  // Produto do cardápio inativo NÃO deve aparecer como opção selecionável
  assert.doesNotMatch(html, /id="product-card-p-noite"/);
});

test('MesaConsumptionPanel preserves historical items and disables repeat for inactive menu items', () => {
  const table = { id: 5, nome: 'Mesa 5', capacidade: 4 };
  const orders: Order[] = [{
    id: 'check-1',
    checkId: 'check-1',
    displayNumber: '5-A',
    numeroPedido: 5,
    mesaId: 5,
    garcomId: 'waiter-1',
    garcomNome: 'Garçom Teste',
    timestamp: Date.now() - 30 * 60_000,
    statusComanda: null,
    itens: [
      {
        id: 'item-active',
        produtoId: 'prod-almoco',
        nome: 'Prato do Dia',
        preco: 28,
        observacao: '',
        clienteNome: 'Consumo Geral',
        status: 'entregue',
      },
      {
        id: 'item-inactive',
        produtoId: 'prod-noite',
        nome: 'Caldo Noturno',
        preco: 22,
        observacao: '',
        clienteNome: 'Consumo Geral',
        status: 'entregue',
      },
    ],
  }];

  const products: Product[] = [
    createProduct({ id: 'prod-almoco', nome: 'Prato do Dia', preco: 28, categoria: 'Almoço', cardapio_id: 'almoco' }),
    createProduct({ id: 'prod-noite', nome: 'Caldo Noturno', preco: 22, categoria: 'Noite', cardapio_id: 'noite' }),
  ];

  const html = renderToStaticMarkup(
    createElement(MesaConsumptionPanel, {
      table,
      orders,
      currentTime: Date.now(),
      activeRole: 'garcom',
      totalValue: getTableTotal(orders),
      customerSubtotals: getCustomerSubtotals(orders),
      canTransferTables: true,
      canTransferItems: true,
      isPrintingDirect: false,
      directPrintToast: '',
      confirmClear: false,
      setActiveTab: () => {},
      setTransferType: () => {},
      setSelectedOrderToPrint: () => {},
      setEditingItem: () => {},
      onPrintPreview: () => {},
      onPrintValues: () => {},
      onCancelItem: () => {},
      onRepeatItem: () => {},
      repeatProducts: products,
      repeatCatalogReady: true,
      cardapio_ativo_id: 'almoco',
      cardapios_ativos_ids: ['almoco'],
    }),
  );

  // 1. Preservação do histórico e de itens já lançados: ambos aparecem no consumo
  assert.match(html, /Prato do Dia/);
  assert.match(html, /Caldo Noturno/);
  assert.match(html, /Servido/);

  // 2. O item cujo cardápio permanece ativo pode ser repetido
  assert.match(html, /id="repeat-item-btn-item-active"/);
  assert.doesNotMatch(html, /id="repeat-item-btn-item-active"[^>]*disabled/);

  // 3. O item cujo cardápio agora está inativo tem o botão desabilitado com o título correspondente
  assert.match(html, /id="repeat-item-btn-item-inactive"[^>]*disabled/);
  assert.match(html, /title="Cardápio indisponível"/);
});

const createMockPdv = (overrides: Partial<ReturnType<typeof useCashierPdv>> = {}): ReturnType<typeof useCashierPdv> => ({
  openCounter: () => {},
  balcaoMobileView: 'carrinho',
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
  setPdvCustomerId: null,
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
  selectedPdvTableOption: null,
  pdvCartItemCount: 0,
  handlePdvAddToCart: () => {},
  handlePdvUpdateCartQty: () => {},
  handlePdvRemoveCartItem: () => {},
  handlePdvSubmitOrder: async () => {},
  sellableProducts: [],
  pdvCategories: [],
  pdvMenuInsights: { destination: 'Retirada', itemCount: 0, total: 'R$ 0,00', pausedCount: 0 },
  filteredProducts: [],
  cartHasUnavailableItems: false,
  cartUnavailableItemNames: [],
  checkCartItemAvailability: () => ({ unavailable: false, reason: null }),
  unavailableSearchMatches: [],
  ...overrides,
});

test('CashierPdvView blocks submitting order when cart has items from an inactive menu or paused items', () => {
  const activeProduct = createProduct({ id: 'p-almoco', nome: 'Feijoada', preco: 35, categoria: 'Comidas', cardapio_id: 'almoco' });
  const inactiveMenuProduct = createProduct({ id: 'p-noite', nome: 'Sopa Noturna', preco: 25, categoria: 'Comidas', cardapio_id: 'noite' });

  const pdvCart: PdvCartItem[] = [
    { product: activeProduct, quantity: 1, obs: '', client: 'Balcão' },
    { product: inactiveMenuProduct, quantity: 1, obs: '', client: 'Balcão' },
  ];

  const mockPdv = createMockPdv({
    pdvCart,
    pdvCartItemCount: 2,
    cartHasUnavailableItems: true,
    cartUnavailableItemNames: ['Sopa Noturna'],
    checkCartItemAvailability: (item) => {
      if (item.product.id === 'p-noite') return { unavailable: true, reason: 'menu_inactive' };
      return { unavailable: false, reason: null };
    },
  });

  const html = renderToStaticMarkup(
    createElement(CashierPdvView, {
      activeSubTab: 'balcao',
      catalogReady: true,
      isLoading: false,
      pdvTableOptions: [],
      pdv: mockPdv,
    }),
  );

  // 1. O item do cardápio inativo exibe o indicador no carrinho
  assert.match(html, /id="pdv-cart-item-unavailable-1"/);
  assert.match(html, /Indisponível no cardápio ativo/);

  // 2. O alerta geral de bloqueio do carrinho do PDV é exibido
  assert.match(html, /id="pdv-cart-unavailable-warning"/);
  assert.match(html, /Há itens indisponíveis no carrinho\. Remova-os para continuar\./);

  // 3. O botão de lançar pedido do PDV fica desabilitado
  assert.match(html, /id="pdv-submit-btn"[^>]*disabled/);
  assert.match(html, /title="Remova os itens indisponíveis antes de lançar o pedido"/);
});

test('CashierPdvView renders unavailable search matches with active menu status during search', () => {
  const pausedProduct = createProduct({ id: 'p-pausado', nome: 'Bolo Pausado', preco: 12, categoria: 'Doces', ativo: false, cardapio_id: 'almoco' });
  const inactiveMenuProduct = createProduct({ id: 'p-manha', nome: 'Bolo de Milho Manhã', preco: 10, categoria: 'Doces', ativo: true, cardapio_id: 'manha' });

  const mockPdv = createMockPdv({
    pdvSearch: 'Bolo',
    unavailableSearchMatches: [pausedProduct, inactiveMenuProduct],
  });

  const html = renderToStaticMarkup(
    createElement(CashierPdvView, {
      activeSubTab: 'balcao',
      catalogReady: true,
      isLoading: false,
      pdvTableOptions: [],
      pdv: mockPdv,
    }),
  );

  // 1. Renderiza a seção de itens indisponíveis na busca
  assert.match(html, /id="pdv-unavailable-search-results"/);
  assert.match(html, /Itens indisponíveis na operação atual/);

  // 2. Exibe o produto pausado com o badge "Pausado"
  assert.match(html, /id="pdv-unavailable-product-p-pausado"/);
  assert.match(html, /Bolo Pausado/);
  assert.match(html, /Pausado/);

  // 3. Exibe o produto do cardápio inativo com o badge "Cardápio inativo"
  assert.match(html, /id="pdv-unavailable-product-p-manha"/);
  assert.match(html, /Bolo de Milho Manhã/);
  assert.match(html, /Cardápio inativo/);
});

test('CashierCatalog marks all active simultaneous menus with indicator in cardapio tabs', () => {
  const menus: CardapioMenu[] = [
    { id: 'menu-manha', nome: 'Manhã', identificador: 'manha', ordem_exibicao: 1 },
    { id: 'menu-almoco', nome: 'Meio-Dia', identificador: 'almoco', ordem_exibicao: 2 },
    { id: 'menu-noite', nome: 'Noite', identificador: 'noite', ordem_exibicao: 3 },
  ];

  const html = renderToStaticMarkup(
    createElement(CashierCatalog, {
      apiBaseUrl: '',
      authHeaders: {},
      activeTab: 'cardapio',
      activeSubTab: 'produtos',
      setActiveSubTab: () => {},
      showToast: () => {},
      apiProdutos: [],
      apiCategorias: [],
      suggestedProductCode: '001',
      hasOnlineMenu: true,
      hasPrinting: true,
      fetchProdutos: async () => {},
      fetchCategorias: async () => {},
      catalogReady: true,
      restauranteConfig: {},
      onRefreshCategorias: async () => {},
      cardapios: menus,
      cardapioAtivoId: 'menu-manha',
      cardapiosAtivosIds: ['menu-manha', 'menu-almoco'],
      cardapioAtivoNome: 'Manhã',
    }),
  );

  // 1. Ambos os cardápios operacionais ativos (Manhã e Meio-Dia) exibem o indicador visual de ativo
  assert.match(html, /<span>Manhã<\/span>[^<]*<span[^>]*>[^<]*<\/span>[^<]*<span[^>]*title="Cardápio ativo no momento"/);
  assert.match(html, /<span>Meio-Dia<\/span>[^<]*<span[^>]*>[^<]*<\/span>[^<]*<span[^>]*title="Cardápio ativo no momento"/);

  // 2. O cardápio 'Noite' (inativo) não tem o indicador visual de ativo
  assert.doesNotMatch(html, /<span>Noite<\/span>[^<]*<span[^>]*>[^<]*<\/span>[^<]*<span[^>]*title="Cardápio ativo no momento"/);

  // 3. O botão de gestão de cardápios adicionais ativos reflete o estado
  assert.match(html, /Retirar Manhã dos ativos/);
});
