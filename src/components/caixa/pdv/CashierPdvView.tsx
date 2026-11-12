import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PAYMENT_LABELS, type PaymentMethod } from '../../../cardapio/paymentMethods';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Minus, Package, Plus, Search, ShoppingCart, X } from 'lucide-react';
import type { CatalogModifierGroup } from '../../../catalog/catalog';
import { projectCashierSalonTables } from '../../../domain/cashierSalonProjection';
import {
  changeModifierQuantitySelection,
  modifierGroupSelectionValid,
} from '../../../domain/modifierQuantity';
import type { Product } from '../../../types';
import { aplicarMascaraTelefoneInput } from '../../../utils/phonePresentation';
import DeliveryAddressFields from '../../shared/DeliveryAddressFields';
import ModifierPicker from '../../shared/ModifierPicker';
import { OperationalBanner } from '../../shared/OperationalBanner';
import { formatCurrency } from '../cashierPresentation';
import { pdvCartItemUnitPrice, type PdvModifierSelection, type useCashierPdv } from './useCashierPdv';
import { usePdvCategoryNavigation } from './usePdvCategoryNavigation';
import { CashierPdvProductCard } from './CashierPdvProductCard';
import { CashierPdvCartLine } from './CashierPdvCartLine';

type ProductWithModifiers = Product & { grupos_modificadores?: CatalogModifierGroup[] };

const modifierGroupsFor = (product: Product | null) =>
  product ? ((product as ProductWithModifiers).grupos_modificadores || []) : [];

const modifierSelectionsFor = (groups: CatalogModifierGroup[], selectedIds: string[]): PdvModifierSelection[] => {
  const optionsById = new Map(
    groups
      .flatMap((group) => group.opcoes)
      .filter((option) => option.ativo !== false)
      .map((option) => [option.id, option] as const),
  );

  return selectedIds.flatMap((id) => {
    const option = optionsById.get(id);
    if (!option) return [];
    return [{
      id: option.id,
      nome: option.nome,
      preco: Number(option.preco_adicional || 0),
    }];
  });
};

interface Props {
  activeSubTab: string;
  catalogReady: boolean;
  isLoading: boolean;
  pdvTableOptions: Array<ReturnType<typeof projectCashierSalonTables>[number] & { label: string }>;
  pdv: ReturnType<typeof useCashierPdv>;
}

export default function CashierPdvView({ activeSubTab, catalogReady, isLoading, pdvTableOptions, pdv }: Props) {
  const {
    balcaoMobileView,
    setBalcaoMobileView,
    pdvProductDetailId,
    setPdvProductDetailId,
    pdvOccupiedTableCount,
    pdvSearch,
    setPdvSearch,
    pdvSelectedCategory,
    setPdvSelectedCategory,
    pdvCart,
    setPdvCart,
    pdvCustomerName,
    setPdvCustomerName,
    pdvCustomerPhone,
    setPdvCustomerPhone,
    setPdvCustomerId,
    pdvCustomerLookup,
    pdvOrderType,
    setPdvOrderType,
    allowedPdvOrderTypes,
    pdvPaymentMethod,
    setPdvPaymentMethod,
    pdvDeliveryAddressDraft,
    pdvDeliveryAddressLegacyHint,
    handlePdvDeliveryAddressChange,
    pdvTargetMesaId,
    setPdvTargetMesaId,
    selectedPdvTableOption,
    pdvCartItemCount,
    handlePdvAddToCart,
    handlePdvUpdateCartQty,
    handlePdvRemoveCartItem,
    handlePdvSubmitOrder,
    sellableProducts,
    pdvCategories,
    pdvMenuInsights,
    filteredProducts,
    cartHasUnavailableItems,
    cartUnavailableItemNames,
    checkCartItemAvailability,
    unavailableSearchMatches,
  } = pdv;
  const {
    pdvCategoryScrollRef,
    pdvCategorySuppressClickRef,
    pdvCategoryScrollState,
    updatePdvCategoryScrollState,
    scrollPdvCategories,
    handlePdvCategoryWheel,
    handlePdvCategoryPointerDown,
    handlePdvCategoryPointerMove,
    finishPdvCategoryDrag,
  } = usePdvCategoryNavigation({ activeSubTab, balcaoMobileView, pdvCategories });

  const [configProduct, setConfigProduct] = useState<Product | null>(null);
  const [configCartIndex, setConfigCartIndex] = useState<number | null>(null);
  const [configQty, setConfigQty] = useState(1);
  const [configObs, setConfigObs] = useState('');
  const [configModifierIds, setConfigModifierIds] = useState<string[]>([]);
  // Presentation-only step. Never clone the cart, modality or customer state.
  const [checkoutStage, setCheckoutStage] = useState<'cart' | 'review'>('cart');
  const reviewHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const previousCountRef = useRef(pdvCart.length);

  useEffect(() => {
    if (previousCountRef.current > 0 && pdvCart.length === 0) setCheckoutStage('cart');
    previousCountRef.current = pdvCart.length;
  }, [pdvCart.length]);

  useEffect(() => {
    if (checkoutStage === 'review' && balcaoMobileView === 'carrinho') reviewHeadingRef.current?.focus();
  }, [checkoutStage, balcaoMobileView]);

  useEffect(() => {
    if (activeSubTab !== 'balcao') return;
    const handleShortcutCapture = (event: KeyboardEvent) => {
      if (configProduct || event.repeat || !['F2', 'F3', 'F8'].includes(event.key)) return;
      // Modality shortcuts reveal the review fields before the canonical
      // hook changes the selected destination and focuses the corresponding input.
      setCheckoutStage('review');
      setBalcaoMobileView('carrinho');
    };
    window.addEventListener('keydown', handleShortcutCapture, true);
    return () => window.removeEventListener('keydown', handleShortcutCapture, true);
  }, [activeSubTab, configProduct, setBalcaoMobileView]);

  const configGroups = modifierGroupsFor(configProduct);
  const configModifiers = useMemo(
    () => modifierSelectionsFor(configGroups, configModifierIds),
    [configGroups, configModifierIds],
  );
  const configModifierTotal = configModifiers.reduce((sum, modifier) => sum + Number(modifier.preco || 0), 0);
  const configUnitTotal = Number(configProduct?.preco || 0) + configModifierTotal;
  const configValid = configGroups.every((group) => modifierGroupSelectionValid(group, configModifierIds));

  const closeConfig = () => {
    setConfigProduct(null);
    setConfigCartIndex(null);
    setConfigModifierIds([]);
  };

  const openConfig = (product: Product, cartIndex: number | null = null) => {
    const item = cartIndex === null ? null : pdvCart[cartIndex];
    setConfigProduct(product);
    setConfigCartIndex(cartIndex);
    setConfigQty(item?.quantity || 1);
    setConfigObs(item?.obs || '');
    setConfigModifierIds([...(item?.modifierIds || [])]);
    setPdvProductDetailId(null);
  };

  const handleQuickAddProduct = (product: Product) => {
    setPdvProductDetailId(null);
    handlePdvAddToCart(product);
  };

  const toggleProductDetails = (productId: string) => {
    setPdvProductDetailId((current) => current === productId ? null : productId);
  };

  const changeConfigModifierQuantity = (
    group: CatalogModifierGroup,
    optionId: string,
    delta: -1 | 1,
  ) => {
    setConfigModifierIds((current) => changeModifierQuantitySelection(group, current, optionId, delta));
  };

  const saveConfiguredItem = () => {
    if (!configProduct || !configValid) return;
    const nextItem = {
      product: configProduct,
      quantity: configQty,
      obs: configObs.trim(),
      client: configCartIndex === null ? 'Balcão' : pdvCart[configCartIndex]?.client || 'Balcão',
      modifierIds: [...configModifierIds],
      modifiers: configModifiers,
    };

    setPdvCart((current) => {
      if (configCartIndex !== null) {
        return current.map((item, index) => index === configCartIndex ? nextItem : item);
      }
      if (!nextItem.obs && nextItem.modifierIds.length === 0) {
        const cleanIndex = current.findIndex((item) =>
          item.product.id === configProduct.id
          && !item.obs
          && (item.modifierIds || []).length === 0
          && item.client === 'Balcão',
        );
        if (cleanIndex >= 0) {
          return current.map((item, index) => index === cleanIndex
            ? { ...item, quantity: item.quantity + configQty }
            : item);
        }
      }
      return [...current, nextItem];
    });
    closeConfig();
  };

  const cartTotal = pdvCart.reduce((sum, item) => sum + pdvCartItemUnitPrice(item) * item.quantity, 0);
  const currentModalityLabel = pdvOrderType === 'pickup' ? 'Retirada'
    : pdvOrderType === 'delivery' ? 'Delivery' : 'Consumo local';
  const changeCartObservation = (index: number, observation: string) => {
    setPdvCart((current) => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, obs: observation } : item));
  };
  const showOrderItems = () => setCheckoutStage('cart');
  const showOrderReview = () => { setCheckoutStage('review'); setBalcaoMobileView('carrinho'); };
  // Aggregate once per cart update, rather than scanning every cart line for each visible product.
  const cartQuantitiesByProduct = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const item of pdvCart) {
      const id = String(item.product.id);
      quantities.set(id, (quantities.get(id) ?? 0) + item.quantity);
    }
    return quantities;
  }, [pdvCart]);
  const deliveryAddressSummary = [
    pdvDeliveryAddressDraft.logradouro,
    pdvDeliveryAddressDraft.numero,
    pdvDeliveryAddressDraft.bairro,
  ].filter(Boolean).join(', ');
  const modalityOptions = ([
    { id: 'pickup', label: 'Retirada' },
    { id: 'delivery', label: 'Delivery' },
    { id: 'dine_in', label: 'Consumo local' },
  ] as const).filter((type) => allowedPdvOrderTypes.includes(type.id));
  const shortcutLabels = [
    allowedPdvOrderTypes.includes('pickup') ? 'F2 Retirada' : null,
    allowedPdvOrderTypes.includes('dine_in') ? 'F3 Consumo local' : null,
    allowedPdvOrderTypes.includes('delivery') ? 'F8 Delivery' : null,
    'F4 Finalizar',
  ].filter(Boolean).join(' · ');

  return (
    <>
      {activeSubTab === 'balcao' && (
        <div className={clsx("orders-workspace cashier-pdv-view h-full min-h-0 flex flex-col gap-3 sm:gap-4", balcaoMobileView === "produtos" && pdvCartItemCount > 0 && "has-mobile-cart-cta")}>
          <OperationalBanner
            id="counter-heading"
            eyebrow="VENDA"
            title="Novo pedido"
            accent="rápido e simples"
            description="+ Adicionar lança rápido. Clique no card para personalizar; no pedido, use o lápis para editar."
            metrics={
              pdvMenuInsights.pausedCount > 0
                ? [
                    { label: 'destino', value: pdvMenuInsights.destination },
                    { label: 'itens', value: pdvMenuInsights.itemCount },
                    { label: 'total', value: pdvMenuInsights.total },
                    {
                      label: pdvMenuInsights.pausedCount === 1 ? 'pausado' : 'pausados',
                      value: pdvMenuInsights.pausedCount,
                      valueClassName: 'text-amber-600 dark:text-amber-300',
                    },
                  ]
                : [
                    { label: 'destino', value: pdvMenuInsights.destination },
                    { label: 'itens', value: pdvMenuInsights.itemCount },
                    { label: 'total', value: pdvMenuInsights.total },
                  ]
            }
          />

          <div
            className={"cashier-pdv-layout min-h-0 flex-1 flex flex-col xl:flex-row gap-3 sm:gap-4 overflow-hidden relative"}
          >
            <div className="cashier-pdv-mobile-switch xl:hidden" role="group" aria-label="Visualização do novo pedido">
              <button
                type="button"
                onClick={() => { setBalcaoMobileView('produtos'); showOrderItems(); }}
                aria-current={balcaoMobileView === 'produtos' ? 'page' : undefined}
                aria-controls="pdv-products-panel"
                className={clsx('cashier-pdv-mobile-switch__button', balcaoMobileView === 'produtos' && 'is-active')}
              >
                <Package size={14} />
                <span>Escolher itens</span>
              </button>
              <button
                type="button"
                onClick={() => { setBalcaoMobileView('carrinho'); showOrderItems(); }}
                aria-current={balcaoMobileView === 'carrinho' ? 'page' : undefined}
                aria-controls="pdv-order-panel"
                className={clsx('cashier-pdv-mobile-switch__button', balcaoMobileView === 'carrinho' && 'is-active')}
              >
                <ShoppingCart size={14} />
                <span>Carrinho ({pdvCartItemCount})</span>
              </button>
            </div>

            <div
              id="pdv-products-panel"
              className={`cashier-pdv-catalog min-w-0 flex-1 ${balcaoMobileView === 'produtos' ? 'flex' : 'hidden xl:flex'} flex-col gap-3 overflow-hidden w-full`}
            >
              <div
                className={"shrink-0 rounded-2xl border border-koma-border bg-koma-panel p-2.5 sm:p-3 space-y-2.5"}
              >
                <div className="relative">
                  <Search
                    size={15}
                    className={"absolute left-3.5 top-1/2 -translate-y-1/2 text-koma-muted"}
                  />
                  <input
                    id="pdv-product-search-input"
                    type="search"
                    autoComplete="off"
                    aria-label="Buscar produtos do cardápio"
                    placeholder="Buscar item, descrição ou código"
                    value={pdvSearch}
                    onChange={(e) => setPdvSearch(e.target.value)}
                    className="cashier-pdv-search-input w-full bg-koma-input border border-koma-border text-koma-foreground placeholder:text-koma-muted rounded-xl py-2.5 pl-10 pr-8 text-xs outline-none transition-colors"
                  />
                  {pdvSearch && (
                    <button
                      type="button"
                      onClick={() => setPdvSearch('')}
                      className={"absolute right-3 top-1/2 -translate-y-1/2 text-koma-muted hover:text-koma-foreground p-1 rounded-lg"}
                      aria-label="Limpar busca de itens"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                <div className={"flex min-w-0 items-center gap-1.5"}>
                  {pdvCategoryScrollState.hasOverflow && (
                    <button
                      type="button"
                      onClick={() => scrollPdvCategories(-1)}
                      disabled={!pdvCategoryScrollState.canScrollLeft}
                      aria-label="Ver categorias anteriores"
                      className={"hidden size-8 shrink-0 items-center justify-center rounded-lg border border-koma-border bg-koma-panel text-koma-muted hover:text-koma-foreground hover:bg-koma-raised disabled:cursor-not-allowed disabled:opacity-25 sm:flex"}
                    >
                      <ChevronLeft size={15} />
                    </button>
                  )}
                  <div
                    ref={pdvCategoryScrollRef}
                    onScroll={updatePdvCategoryScrollState}
                    onWheel={handlePdvCategoryWheel}
                    onPointerDown={handlePdvCategoryPointerDown}
                    onPointerMove={handlePdvCategoryPointerMove}
                    onPointerUp={finishPdvCategoryDrag}
                    onPointerCancel={finishPdvCategoryDrag}
                    onClickCapture={(event) => {
                      if (!pdvCategorySuppressClickRef.current) return;
                      event.preventDefault();
                      event.stopPropagation();
                      pdvCategorySuppressClickRef.current = false;
                    }}
                    className={"flex min-w-0 flex-1 cursor-grab select-none items-center gap-1.5 overflow-x-auto pb-0.5 active:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"}
                    aria-label="Filtrar por categoria"
                  >
                    <button
                      type="button"
                      aria-pressed={pdvSelectedCategory === 'todos'}
                      onClick={() => {
                        setPdvSelectedCategory('todos');
                        setPdvProductDetailId(null);
                      }}
                      className={`cashier-pdv-category h-8 px-3 text-[10px] font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors border ${
                        pdvSelectedCategory === 'todos'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'bg-transparent border-koma-border text-koma-muted hover:text-koma-foreground hover:bg-koma-raised'
                      }`}
                    >
                      Todos <span className={"ml-1 opacity-75"}>{sellableProducts.length}</span>
                    </button>
                    {pdvCategories.map((catObj) => (
                      <button
                        key={catObj.id || catObj.nome}
                        type="button"
                        aria-pressed={pdvSelectedCategory === catObj.nome}
                        onClick={() => {
                          setPdvSelectedCategory(catObj.nome);
                          setPdvProductDetailId(null);
                        }}
                        className={`cashier-pdv-category h-8 px-3 text-[10px] font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors border ${
                          pdvSelectedCategory === catObj.nome
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                            : 'bg-transparent border-koma-border text-koma-muted hover:text-koma-foreground hover:bg-koma-raised'
                        }`}
                      >
                        {catObj.nome}
                      </button>
                    ))}
                  </div>
                  {pdvCategoryScrollState.hasOverflow && (
                    <button
                      type="button"
                      onClick={() => scrollPdvCategories(1)}
                      disabled={!pdvCategoryScrollState.canScrollRight}
                      aria-label="Ver próximas categorias"
                      className={"hidden size-8 shrink-0 items-center justify-center rounded-lg border border-koma-border bg-koma-panel text-koma-muted hover:text-koma-foreground hover:bg-koma-raised disabled:cursor-not-allowed disabled:opacity-25 sm:flex"}
                    >
                      <ChevronRight size={15} />
                    </button>
                  )}
                </div>
              </div>

              <div className={"cashier-pdv-product-scroll flex-1 min-h-0 overflow-y-auto pr-1 overscroll-contain"}>
                {filteredProducts.length > 0 ? (
                  <div
                    className="cashier-pdv-product-grid"
                  >
                    {filteredProducts.map((product) => (
                      <CashierPdvProductCard
                        key={product.id}
                        product={product}
                        cartQuantity={cartQuantitiesByProduct.get(String(product.id)) ?? 0}
                        detailsOpen={pdvProductDetailId === String(product.id)}
                        onConfigure={openConfig}
                        onQuickAdd={handleQuickAddProduct}
                        onToggleDetails={toggleProductDetails}
                      />
                    ))}
                  </div>
                ) : (
                  <div
                    className={"h-full min-h-52 rounded-2xl border border-dashed border-koma-border bg-white/[0.015] flex flex-col items-center justify-center text-center px-6"}
                  >
                    <Search size={22} className={"text-koma-muted mb-3"} />
                    <strong className={"text-sm text-koma-secondary"}>
                      {catalogReady ? 'Nenhum item encontrado' : 'Carregando cardápio…'}
                    </strong>
                    <span className={"mt-1 text-[10px] text-koma-muted"}>
                      {catalogReady && pdvSearch
                        ? 'Tente buscar por outro nome ou escolha outra categoria.'
                        : catalogReady
                          ? 'Cadastre ou ative itens na área Cardápio.'
                          : 'Os itens aparecerão aqui em instantes.'}
                    </span>
                  </div>
                )}

                {unavailableSearchMatches.length > 0 && (
                  <section
                    id="pdv-unavailable-search-results"
                    data-testid="pdv-unavailable-search-results"
                    className="mt-4 pt-3 border-t border-koma-border/60 space-y-2 pb-4"
                  >
                    <div className="flex items-center justify-between gap-3 pb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-koma-muted" />
                        <h4 className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">
                          Itens indisponíveis na operação atual ({unavailableSearchMatches.length})
                        </h4>
                      </div>
                      <span className="text-[9px] text-koma-muted">somente consulta</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 2xl:grid-cols-4 gap-2 sm:gap-2.5">
                      {unavailableSearchMatches.map((p) => {
                        const isPaused = p.ativo === false;
                        return (
                          <article
                            key={p.id}
                            id={`pdv-unavailable-product-${p.id}`}
                            data-testid={`pdv-unavailable-product-${p.id}`}
                            aria-disabled="true"
                            className="flex flex-col justify-between rounded-xl sm:rounded-2xl border border-dashed border-koma-border bg-koma-card/40 p-2.5 sm:p-3 opacity-70 cursor-not-allowed text-left"
                          >
                            <div className="space-y-1">
                              <div className="flex items-start justify-between gap-1.5">
                                <h4 className="font-bold text-xs text-koma-secondary truncate">{p.nome}</h4>
                                <span className="whitespace-nowrap font-mono text-[10px] text-koma-muted">
                                  {formatCurrency(Number(p.preco) || 0)}
                                </span>
                              </div>
                              <span className="inline-flex rounded-md border border-rose-500/25 bg-rose-500/10 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wider text-rose-400">
                                {isPaused ? 'Pausado' : 'Cardápio inativo'}
                              </span>
                              {p.descricao && (
                                <p className="line-clamp-1 text-[9px] text-koma-muted">{p.descricao}</p>
                              )}
                            </div>
                            <p className="mt-2 border-t border-koma-border/60 pt-1 text-[9px] font-semibold text-koma-muted">
                              Indisponível no momento
                            </p>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>
            </div>

            <div
              id="pdv-order-panel"
              className={`cashier-pdv-cart w-full xl:w-[350px] 2xl:w-[380px] bg-koma-panel border border-koma-border rounded-2xl ${balcaoMobileView === 'carrinho' ? 'flex' : 'hidden xl:flex'} ${pdvCart.length === 0 ? 'xl:self-start' : ''} flex-col overflow-hidden shrink-0 shadow-sm`}
            >
              <div className="cashier-pdv-cart__header">
                {checkoutStage === 'review' ? (
                  <div className="cashier-pdv-cart__review-heading">
                    <button type="button" aria-label="Voltar aos itens do pedido" onClick={showOrderItems} className="cashier-pdv-cart__back">
                      <ChevronLeft size={20} aria-hidden="true" />
                    </button>
                    <div>
                      <span className="cashier-pdv-cart__eyebrow">Etapa 2 de 2</span>
                      <h3 ref={reviewHeadingRef} tabIndex={-1}>Finalizar pedido</h3>
                    </div>
                  </div>
                ) : (
                  <div className="cashier-pdv-cart__cart-heading">
                    <div className="cashier-pdv-cart__heading-icon" aria-hidden="true"><ShoppingCart size={20} /></div>
                    <div className="cashier-pdv-cart__heading-text">
                      <span className="cashier-pdv-cart__eyebrow">Etapa 1 de 2</span>
                      <h3>Itens do pedido</h3>
                    </div>
                    <span className="cashier-pdv-cart__count">{pdvCartItemCount} {pdvCartItemCount === 1 ? 'item' : 'itens'}</span>
                  </div>
                )}
              </div>

              {checkoutStage === 'cart' && (
              <div className="cashier-pdv-cart-scroll">
                {pdvCart.length === 0 ? (
                  <div className="cashier-pdv-cart__empty h-full flex flex-col items-center justify-center text-center px-5">
                    <img src="/brand/cashier/pdv-empty-cart-v1.svg" alt="" width="100" height="80" loading="lazy" />
                    <strong>Comece escolhendo um item</strong>
                    <p>+ Adicionar é rápido. Toque no produto para personalizar.</p>
                  </div>
                ) : (
                  pdvCart.map((item, idx) => (
                    <CashierPdvCartLine
                      key={`${item.product.id}-${idx}`}
                      item={item}
                      index={idx}
                      availability={checkCartItemAvailability(item)}
                      onEdit={(index) => openConfig(pdvCart[index].product, index)}
                      onRemove={handlePdvRemoveCartItem}
                      onChangeQuantity={handlePdvUpdateCartQty}
                      onChangeObservation={changeCartObservation}
                    />
                  ))
                )}
              </div>
              )}

              {checkoutStage === 'cart' && (
                <div className="cashier-pdv-cart__cart-footer">
                  <div className="cashier-pdv-cart__context">
                    <div><span>Atendimento</span><strong>{currentModalityLabel}</strong></div>
                    <button type="button" onClick={showOrderReview}>Alterar</button>
                  </div>
                  <div className="cashier-pdv-cart__cart-total">
                    <span>Subtotal dos itens</span><strong>{formatCurrency(cartTotal)}</strong>
                  </div>
                  {cartHasUnavailableItems && (
                    <p id="pdv-cart-unavailable-warning" data-testid="pdv-cart-unavailable-warning" className="cashier-pdv-cart__unavailable" role="alert">Há itens indisponíveis no carrinho. Remova-os para continuar.</p>
                  )}
                  <button
                    type="button"
                    id="pdv-review-btn"
                    className="cashier-pdv-cart__next"
                    disabled={pdvCart.length === 0 || isLoading || cartHasUnavailableItems}
                    onClick={showOrderReview}
                  >
                    <span>Continuar para finalizar</span>
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
              )}

              {checkoutStage === 'review' && (
              <form
                onSubmit={handlePdvSubmitOrder}
                noValidate
                aria-label="Finalização do pedido"
                className="cashier-pdv-cart__form"
              >
                <div className="cashier-pdv-cart__review-fields">
                  <div className="cashier-pdv-cart__review-intro">
                    <strong>Como o pedido será atendido?</strong>
                    <p>Escolha a modalidade e informe somente os dados necessários.</p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <label className={"text-[8px] text-koma-subtle font-bold uppercase tracking-wider block"}>
                        Modalidade
                      </label>
                      <details className="cashier-pdv-cart__shortcut-hints text-left text-[9px] text-koma-muted">
                        <summary className="cursor-pointer list-none font-semibold hover:text-koma-secondary">
                          Atalhos
                        </summary>
                        <span className="mt-1 block font-mono">{shortcutLabels}</span>
                      </details>
                    </div>
                    <div className={clsx(
                      'cashier-pdv-cart__modality-options grid gap-1 bg-koma-input p-1 rounded-xl border border-koma-border',
                      modalityOptions.length === 2 ? 'grid-cols-2' : 'grid-cols-3',
                    )}>
                      {modalityOptions.map((type) => (
                        <button
                          key={type.id}
                          type="button"
                          aria-pressed={pdvOrderType === type.id}
                          onClick={() => {
                            setPdvOrderType(type.id);
                            if (type.id === 'delivery') setPdvTargetMesaId(0);
                          }}
                          className={clsx('cashier-pdv-cart__modality-option', pdvOrderType === type.id && 'is-active')}
                        >
                          {type.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {pdvOrderType === 'dine_in' && (
                    <div className="space-y-2">
                      <div className={"flex items-center justify-between gap-3"}>
                        <label htmlFor="pdv-target-table" className={"block text-[8px] font-bold uppercase tracking-wider text-koma-subtle"}>
                          Mesa
                        </label>
                        <span className={"text-[8px] text-koma-muted"}>{pdvOccupiedTableCount} em atendimento</span>
                      </div>
                      <select
                        id="pdv-target-table"
                        value={pdvTargetMesaId || ''}
                        onChange={(e) => setPdvTargetMesaId(Number(e.target.value) || 0)}
                        data-table-status={
                          selectedPdvTableOption?.isOccupied ? 'occupied' : selectedPdvTableOption ? 'free' : 'unselected'
                        }
                        className="cashier-pdv-cart__table-select w-full rounded-xl border px-3 text-koma-foreground"
                      >
                        <option value="">Sem mesa</option>
                        {pdvTableOptions.map((option) => (
                          <option
                            key={option.table.id}
                            value={option.table.id}
                            data-table-status={option.isOccupied ? 'occupied' : 'free'}
                          >
                            {option.isOccupied ? '●' : '○'} {option.label}
                            {option.table.nome ? ` · Mesa ${option.table.id}` : ''}
                            {option.isOccupied
                              ? ` · em atendimento${option.total > 0 ? ` · R$ ${option.total.toFixed(2).replace('.', ',')}` : ''}`
                              : ' · livre'}
                          </option>
                        ))}
                      </select>
                      <p className="text-[8px] leading-relaxed text-koma-muted">
                        {selectedPdvTableOption
                          ? selectedPdvTableOption.isOccupied
                            ? 'Os itens serão adicionados ao atendimento existente.'
                            : 'O primeiro lançamento abrirá o atendimento da mesa.'
                          : 'Sem mesa também é permitido; você pode associar depois.'}
                      </p>
                    </div>
                  )}

                  {pdvOrderType === 'pickup' && (
                    <details className="group rounded-xl border border-koma-border bg-koma-card/40">
                      <summary className="cursor-pointer list-none px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <strong className="block text-[9px] text-koma-foreground">Identificação do cliente</strong>
                            <span className="text-[8px] text-koma-muted">Opcional para retirada rápida</span>
                          </div>
                          <span className="text-[8px] font-bold text-emerald-600 dark:text-emerald-300">
                            <span className="group-open:hidden">
                              {pdvCustomerName || pdvCustomerPhone ? 'Preenchido' : 'Adicionar'}
                            </span>
                            <span className="hidden group-open:inline">Fechar</span>
                          </span>
                        </div>
                      </summary>
                      <div className="grid grid-cols-2 gap-2 border-t border-koma-border p-3">
                        <div className="space-y-1">
                          <label htmlFor="pdv-customer-phone-input" className="text-[8px] font-bold uppercase tracking-wider text-koma-subtle">Telefone</label>
                          <input
                            id="pdv-customer-phone-input"
                            type="tel"
                            inputMode="numeric"
                            autoComplete="tel"
                            placeholder="(00) 00000-0000"
                            value={pdvCustomerPhone}
                            onChange={(e) => {
                              setPdvCustomerPhone(aplicarMascaraTelefoneInput(e.target.value));
                              setPdvCustomerId(null);
                            }}
                            className="w-full rounded-lg border border-koma-border bg-koma-input px-2 py-1.5 text-[10px] text-koma-foreground focus:outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="pdv-customer-name-input" className="text-[8px] font-bold uppercase tracking-wider text-koma-subtle">Nome</label>
                          <input
                            id="pdv-customer-name-input"
                            type="text"
                            autoComplete="name"
                            placeholder="Ex: Maria"
                            value={pdvCustomerName}
                            onChange={(e) => setPdvCustomerName(e.target.value)}
                            className="w-full rounded-lg border border-koma-border bg-koma-input px-2 py-1.5 text-[10px] text-koma-foreground focus:outline-none"
                          />
                        </div>
                        {pdvCustomerLookup !== 'idle' && (
                          <p className={clsx('col-span-2 text-[8px] font-bold', pdvCustomerLookup === 'found' ? 'text-emerald-400' : 'text-koma-muted')}>
                            {pdvCustomerLookup === 'loading' && 'Buscando cliente...'}
                            {pdvCustomerLookup === 'found' && 'Cliente encontrado.'}
                            {pdvCustomerLookup === 'new' && 'Novo número — o cliente será criado ao lançar o pedido.'}
                          </p>
                        )}
                      </div>
                    </details>
                  )}

                  {pdvOrderType === 'delivery' && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label htmlFor="pdv-customer-phone-input" className="text-[8px] font-bold uppercase tracking-wider text-koma-subtle">Telefone</label>
                          <input
                            id="pdv-customer-phone-input"
                            type="tel"
                            inputMode="numeric"
                            autoComplete="tel"
                            placeholder="(00) 00000-0000"
                            required={pdvCart.length > 0}
                            value={pdvCustomerPhone}
                            onChange={(e) => {
                              setPdvCustomerPhone(aplicarMascaraTelefoneInput(e.target.value));
                              setPdvCustomerId(null);
                            }}
                            className="w-full rounded-lg border border-koma-border bg-koma-input px-2 py-1.5 text-[10px] text-koma-foreground focus:outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="pdv-customer-name-input" className="text-[8px] font-bold uppercase tracking-wider text-koma-subtle">Nome</label>
                          <input
                            id="pdv-customer-name-input"
                            type="text"
                            autoComplete="name"
                            placeholder="Ex: Maria"
                            required={pdvCart.length > 0}
                            value={pdvCustomerName}
                            onChange={(e) => setPdvCustomerName(e.target.value)}
                            className="w-full rounded-lg border border-koma-border bg-koma-input px-2 py-1.5 text-[10px] text-koma-foreground focus:outline-none"
                          />
                        </div>
                      </div>
                      {pdvCustomerLookup !== 'idle' && (
                        <p className={clsx('text-[8px] font-bold', pdvCustomerLookup === 'found' ? 'text-emerald-400' : 'text-koma-muted')}>
                          {pdvCustomerLookup === 'loading' && 'Buscando cliente...'}
                          {pdvCustomerLookup === 'found' && 'Cliente encontrado — confira a entrega.'}
                          {pdvCustomerLookup === 'new' && 'Novo número — o cliente será criado ao lançar o pedido.'}
                        </p>
                      )}
                      <details className="group rounded-xl border border-koma-border bg-koma-card/40">
                        <summary className="cursor-pointer list-none px-3 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <strong className="block text-[9px] text-koma-foreground">Entrega</strong>
                              <span className="block truncate text-[8px] text-koma-muted">
                                {deliveryAddressSummary || pdvDeliveryAddressLegacyHint || 'Endereço ainda não informado'}
                              </span>
                            </div>
                            <span className="shrink-0 text-[8px] font-bold text-emerald-600 dark:text-emerald-300">
                              <span className="group-open:hidden">Editar entrega</span>
                              <span className="hidden group-open:inline">Fechar</span>
                            </span>
                          </div>
                        </summary>
                        <div className="border-t border-koma-border p-2">
                          <DeliveryAddressFields
                            value={pdvDeliveryAddressDraft}
                            onChange={handlePdvDeliveryAddressChange}
                            legacyHint={pdvDeliveryAddressLegacyHint || null}
                            compact
                            idPrefix="pdv-delivery-address"
                          />
                        </div>
                      </details>
                    </div>
                  )}

                  {(pdvOrderType === 'pickup' || pdvOrderType === 'delivery') && (
                    <details className="group rounded-xl border border-koma-border bg-koma-card/40">
                      <summary className="cursor-pointer list-none px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <strong className="block text-[9px] text-koma-foreground">Pagamento <span className="font-normal text-koma-muted">(opcional agora)</span></strong>
                            <span className="text-[8px] text-koma-muted">Pode ser informado no fechamento.</span>
                          </div>
                          <span className="text-[8px] font-bold text-emerald-600 dark:text-emerald-300">
                            <span className="group-open:hidden">
                              {pdvPaymentMethod ? PAYMENT_LABELS[pdvPaymentMethod] : 'Adicionar'}
                            </span>
                            <span className="hidden group-open:inline">Fechar</span>
                          </span>
                        </div>
                      </summary>
                      <div className="grid grid-cols-2 gap-1.5 border-t border-koma-border p-3">
                        {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((method) => (
                          <button
                            key={method}
                            type="button"
                            onClick={() => setPdvPaymentMethod(pdvPaymentMethod === method ? null : method)}
                            aria-pressed={pdvPaymentMethod === method}
                            className={clsx(
                              'min-h-9 rounded-lg border px-2 py-1.5 text-[9px] font-bold transition-colors',
                              pdvPaymentMethod === method
                                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'border-koma-border bg-koma-input text-koma-muted hover:border-emerald-500/30 hover:text-koma-foreground',
                            )}
                          >
                            {PAYMENT_LABELS[method]}
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </div>

                <div className="cashier-pdv-cart__footer shrink-0 border-t border-koma-border bg-koma-panel p-3 shadow-[0_-10px_24px_rgba(0,0,0,0.12)]">
                  <div className="cashier-pdv-cart__total mb-2 flex items-center justify-between font-mono text-[11px] font-bold text-koma-foreground">
                    <span>Total pedido</span>
                    <span className="text-sm text-emerald-700 dark:text-emerald-400">{formatCurrency(cartTotal)}</span>
                  </div>
                  {cartHasUnavailableItems && (
                    <div
                      id="pdv-cart-unavailable-warning"
                      data-testid="pdv-cart-unavailable-warning"
                      className="p-2 mb-2 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-400 text-[10px] font-semibold text-center"
                    >
                      Há itens indisponíveis no carrinho. Remova-os para continuar.
                    </div>
                  )}
                  <button
                    id="pdv-submit-btn"
                    type="submit"
                    disabled={pdvCart.length === 0 || isLoading || cartHasUnavailableItems}
                    title={cartHasUnavailableItems ? 'Remova os itens indisponíveis antes de lançar o pedido' : undefined}
                    aria-label={cartHasUnavailableItems ? 'Remova os itens indisponíveis para lançar' : undefined}
                    className="w-full min-h-11 py-2 bg-[#00b894] hover:bg-[#13c9a0] text-[#06110d] rounded-xl border border-transparent font-bold text-[10px] uppercase tracking-wider transition-colors cursor-pointer flex flex-col items-center justify-center gap-0.5 disabled:cursor-not-allowed disabled:border-[#272c29] disabled:bg-koma-card disabled:text-zinc-600"
                  >
                    <div className="flex items-center gap-1">
                      <Check size={12} />
                      <span>Lançar Pedido</span>
                    </div>
                    <span className="text-[7.5px] text-emerald-600 dark:text-emerald-300/80 font-mono font-normal">
                      F4 para finalizar
                    </span>
                  </button>
                </div>
              </form>
              )}
            </div>

            {pdvCart.length > 0 && balcaoMobileView === 'produtos' && (
              <button
                type="button"
                onClick={() => { setBalcaoMobileView('carrinho'); showOrderItems(); }}
                aria-label={`Ver pedido com ${pdvCartItemCount} ${pdvCartItemCount === 1 ? 'item' : 'itens'}, total ${formatCurrency(cartTotal)}`}
                className="cashier-pdv-mobile-cart-cta xl:hidden"
              >
                <span className="cashier-pdv-mobile-cart-cta__label">
                  <ShoppingCart size={16} />
                  <span>{pdvCartItemCount} itens no carrinho</span>
                </span>
                <span
                  className="cashier-pdv-mobile-cart-cta__total"
                >
                  {formatCurrency(cartTotal)} →
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {configProduct && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-koma-overlay p-0 sm:items-center sm:p-4"
          onClick={(event) => event.target === event.currentTarget && closeConfig()}
        >
          <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-koma-border bg-koma-card p-4 shadow-2xl sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-3 border-b border-koma-border pb-3">
              <div className="min-w-0">
                <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                  {configCartIndex === null ? 'Personalizar item' : 'Editar item do pedido'}
                </span>
                <h3 className="truncate text-lg font-bold text-koma-foreground">{configProduct.nome}</h3>
              </div>
              <button type="button" onClick={closeConfig} className="rounded-full p-1.5 text-koma-muted hover:text-koma-foreground" aria-label="Fechar personalização">
                <X size={18} />
              </button>
            </div>

            {configProduct.descricao && (
              <p className="mt-3 rounded-xl border border-koma-border bg-koma-raised p-3 text-[11px] leading-relaxed text-koma-subtle">
                {configProduct.descricao}
              </p>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <div>
                <span className="mb-1 block text-[9px] font-bold uppercase text-koma-muted">Quantidade</span>
                <div className="flex items-center rounded-xl border border-koma-border bg-koma-input p-1">
                  <button type="button" onClick={() => setConfigQty((value) => Math.max(1, value - 1))} className="p-2 text-koma-muted hover:text-rose-400">
                    <Minus size={14} />
                  </button>
                  <span className="px-4 font-mono text-sm font-bold text-koma-foreground">{configQty}</span>
                  <button type="button" onClick={() => setConfigQty((value) => value + 1)} className="p-2 text-koma-muted hover:text-emerald-400">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <div className="text-right">
                <span className="block text-[9px] font-bold uppercase text-koma-muted">Total configurado</span>
                <span className="font-mono text-lg font-bold text-emerald-400">{formatCurrency(configUnitTotal * configQty)}</span>
              </div>
            </div>

            {configGroups.length > 0 && (
              <div className="mt-4 space-y-3 border-t border-koma-border pt-4">
                <div>
                  <h4 className="text-xs font-bold text-koma-foreground">Complementos</h4>
                  <p className="text-[10px] text-koma-muted">Recomendados primeiro. Use a busca para qualquer adicional do restaurante.</p>
                </div>
                <ModifierPicker
                  key={`${configProduct.id}-${configCartIndex ?? 'new'}`}
                  groups={configGroups}
                  selectedIds={configModifierIds}
                  onQuantityChange={changeConfigModifierQuantity}
                  compact
                />
              </div>
            )}

            <div className="mt-4 space-y-2 border-t border-koma-border pt-4">
              <label htmlFor="pdv-config-obs" className="text-[9px] font-bold uppercase text-koma-muted">Observação de preparo</label>
              <input
                id="pdv-config-obs"
                value={configObs}
                onChange={(event) => setConfigObs(event.target.value)}
                placeholder="Ex: sem cebola, bem passado, molho à parte..."
                className="w-full rounded-xl border border-koma-border bg-koma-input px-3 py-2 text-xs text-koma-foreground outline-none focus:border-emerald-500"
              />
            </div>

            <div className="mt-4 flex items-center gap-3 border-t border-koma-border pt-4">
              <button type="button" onClick={closeConfig} className="flex-1 rounded-xl border border-koma-border py-2.5 text-xs font-bold text-koma-muted hover:text-koma-foreground">
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveConfiguredItem}
                disabled={!configValid}
                className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-xs font-extrabold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {!configValid ? 'Complete as escolhas' : configCartIndex === null ? 'Adicionar ao pedido' : 'Salvar alterações'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
