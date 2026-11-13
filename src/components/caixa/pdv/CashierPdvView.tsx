import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PAYMENT_LABELS, type PaymentMethod } from '../../../cardapio/paymentMethods';
import { Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CreditCard, MapPin, Package, Search, ShoppingCart, Truck, UserRound, UtensilsCrossed, X } from 'lucide-react';
import type { CatalogModifierGroup } from '../../../catalog/catalog';
import { projectCashierSalonTables } from '../../../domain/cashierSalonProjection';
import {
  changeModifierQuantitySelection,
  modifierGroupSelectionValid,
} from '../../../domain/modifierQuantity';
import type { Product } from '../../../types';
import { aplicarMascaraTelefoneInput } from '../../../utils/phonePresentation';
import DeliveryAddressFields from '../../shared/DeliveryAddressFields';
import { OperationalBanner } from '../../shared/OperationalBanner';
import { formatCurrency } from '../cashierPresentation';
import { pdvCartItemUnitPrice, type PdvModifierSelection, type PdvOrderType, type useCashierPdv } from './useCashierPdv';
import { usePdvCategoryNavigation } from './usePdvCategoryNavigation';
import { CashierPdvProductCard } from './CashierPdvProductCard';
import { pdvProductNeedsRequiredChoices } from './pdvProductChoices';
import { CashierPdvCartLine } from './CashierPdvCartLine';
import { CashierPdvConfigurator } from './CashierPdvConfigurator';
import { CashierPdvCustomerFields } from './CashierPdvCustomerFields';
import { CashierPdvTablePicker, formatPdvTableLabel } from './CashierPdvTablePicker';

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

  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [configProduct, setConfigProduct] = useState<Product | null>(null);
  const [configCartIndex, setConfigCartIndex] = useState<number | null>(null);
  const [configQty, setConfigQty] = useState(1);
  const [configObs, setConfigObs] = useState('');
  const [configModifierIds, setConfigModifierIds] = useState<string[]>([]);
  const [addedNotice, setAddedNotice] = useState<{ productId: string; name: string; token: number; edited: boolean } | null>(null);
  const addNoticeSequence = useRef(0);

  useEffect(() => {
    if (!addedNotice) return;
    const timeout = window.setTimeout(() => setAddedNotice(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [addedNotice]);

  const deliveryAddressDisclosureRef = useRef<HTMLDetailsElement | null>(null);
  const mobileTaskRef = useRef<HTMLDivElement | null>(null);

  // Reveal a missing delivery address when that modality is selected, but
  // allow operators to collapse the native disclosure afterward.
  useEffect(() => {
    if (pdvOrderType !== 'delivery') return;
    if (!pdvDeliveryAddressDraft.logradouro || !pdvDeliveryAddressDraft.numero) {
      if (deliveryAddressDisclosureRef.current) deliveryAddressDisclosureRef.current.open = true;
    }
  }, [pdvOrderType, pdvDeliveryAddressDraft.logradouro, pdvDeliveryAddressDraft.numero]);

  // Destination shortcuts open the same order surface; no duplicated
  // cart, checkout or fulfillment state is needed.
  useEffect(() => {
    if (activeSubTab !== 'balcao') return;
    const revealDestination = (event: KeyboardEvent) => {
      if (configProduct || event.repeat || !['F2', 'F3', 'F8'].includes(event.key)) return;
      setBalcaoMobileView('carrinho');
    };
    window.addEventListener('keydown', revealDestination, true);
    return () => window.removeEventListener('keydown', revealDestination, true);
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

  // New-product configuration does not depend on cart edits. Keep this stable
  // so an existing cart change does not rerender all catalogue cards.
  const openNewProductConfig = useCallback((product: Product) => {
    setConfigProduct(product);
    setConfigCartIndex(null);
    setConfigQty(1);
    setConfigObs('');
    setConfigModifierIds([]);
    setPdvProductDetailId(null);
  }, [setPdvProductDetailId]);

  const reportCartChange = useCallback((product: Product, edited = false) => {
    addNoticeSequence.current += 1;
    setAddedNotice({
      productId: String(product.id),
      name: product.nome,
      token: addNoticeSequence.current,
      edited,
    });
  }, []);

  const handleQuickAddProduct = useCallback((product: Product) => {
    // Products with mandatory groups must never enter an incomplete cart.
    // Optional modifiers retain one-tap quick add.
    if (pdvProductNeedsRequiredChoices(product)) {
      openNewProductConfig(product);
      return;
    }
    setPdvProductDetailId(null);
    handlePdvAddToCart(product);
    reportCartChange(product);
  }, [handlePdvAddToCart, openNewProductConfig, reportCartChange, setPdvProductDetailId]);

  const toggleProductDetails = useCallback((productId: string) => {
    setPdvProductDetailId((current) => current === productId ? null : productId);
  }, [setPdvProductDetailId]);

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
    reportCartChange(configProduct, configCartIndex !== null);
    closeConfig();
  };

  const cartTotal = useMemo(() => pdvCart.reduce(
    (sum, item) => sum + pdvCartItemUnitPrice(item) * item.quantity, 0,
  ), [pdvCart]);
  const currentModalityLabel = pdvOrderType === 'pickup' ? 'Retirada'
    : pdvOrderType === 'delivery' ? 'Delivery' : 'Consumo local';
  const switchMobileTask = useCallback((next: 'produtos' | 'carrinho') => {
    if (next === balcaoMobileView) return;
    setBalcaoMobileView(next);
    // A task change must never leave the operator looking at the bottom of the old pane.
    // Keep catalog/category selection untouched; this only reveals the active task header.
    window.requestAnimationFrame(() => {
      mobileTaskRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }, [balcaoMobileView, setBalcaoMobileView]);
  const changeCartObservation = (index: number, observation: string) => {
    setPdvCart((current) => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, obs: observation } : item));
  };
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
  const changeServiceType = (next: PdvOrderType) => {
    setTablePickerOpen(false);
    setPdvOrderType(next);
    if (next === 'delivery') setPdvTargetMesaId(0);
  };
  const changeCustomerPhone = (phone: string) => {
    setPdvCustomerPhone(aplicarMascaraTelefoneInput(phone));
    setPdvCustomerId(null);
  };
  const shortcutLabels = [
    allowedPdvOrderTypes.includes('pickup') ? 'F2 Retirada' : null,
    allowedPdvOrderTypes.includes('dine_in') ? 'F3 Consumo local' : null,
    allowedPdvOrderTypes.includes('delivery') ? 'F8 Delivery' : null,
    'F4 Finalizar',
  ].filter(Boolean).join(' · ');

  return (
    <>
      {activeSubTab === 'balcao' && (
        <div className={clsx("orders-workspace cashier-pdv-view h-full min-h-0 flex flex-col gap-3 sm:gap-4", balcaoMobileView === "produtos" && "has-mobile-cart-cta")}>
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

          {pdvOrderType === 'dine_in' && selectedPdvTableOption && (
            <div className="cashier-pdv-table-context" role="status" data-testid="pdv-selected-table-context">
              <div className="cashier-pdv-table-context__text">
                <MapPin size={21} aria-hidden="true" />
                <span>Pedido para <strong>{formatPdvTableLabel(selectedPdvTableOption.table)}</strong></span>
              </div>
              <button type="button" onClick={() => setTablePickerOpen(true)}>Trocar mesa</button>
            </div>
          )}

          <div
            className={"cashier-pdv-layout min-h-0 flex-1 flex flex-col xl:flex-row gap-3 sm:gap-4 overflow-hidden relative"}
          >
            <div ref={mobileTaskRef} className="cashier-pdv-mobile-switch xl:hidden" role="group" aria-label="Navegação e atendimento do novo pedido">
              <button
                type="button"
                aria-label="Escolher itens"
                onClick={() => switchMobileTask('produtos')}
                aria-current={balcaoMobileView === 'produtos' ? 'page' : undefined}
                aria-controls="pdv-products-panel"
                className={clsx('cashier-pdv-mobile-switch__button', balcaoMobileView === 'produtos' && 'is-active')}
              >
                <Package size={16} aria-hidden="true" />
                <span>Itens</span>
              </button>
              <button
                type="button"
                aria-label={`Carrinho (${pdvCartItemCount})`}
                onClick={() => switchMobileTask('carrinho')}
                aria-current={balcaoMobileView === 'carrinho' ? 'page' : undefined}
                aria-controls="pdv-order-panel"
                className={clsx('cashier-pdv-mobile-switch__button', balcaoMobileView === 'carrinho' && 'is-active')}
              >
                <ShoppingCart size={16} aria-hidden="true" />
                <span>Pedido</span>
                {pdvCartItemCount > 0 && <span key={addedNotice?.token ?? 0} className={clsx('cashier-pdv-mobile-switch__count', addedNotice && 'is-bumped')}>{pdvCartItemCount > 99 ? '99+' : pdvCartItemCount}</span>}
              </button>
              <div className="cashier-pdv-mobile-service">
                <label htmlFor="pdv-mobile-service-type" className="sr-only">Tipo de atendimento</label>
                <select
                  id="pdv-mobile-service-type"
                  aria-label="Tipo de atendimento"
                  value={pdvOrderType}
                  onChange={(event) => changeServiceType(event.target.value as PdvOrderType)}
                >
                  {modalityOptions.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.id === 'delivery' ? 'Entrega' : type.id === 'dine_in' ? 'No local' : 'Retirada'}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </div>
            </div>

            {/* Adding already animates the card and cart counter; only edits need text feedback. */}
            {addedNotice?.edited && (
              <div
                key={addedNotice.token}
                className="cashier-pdv-feedback"
                role="status"
                aria-live="polite"
                data-testid="pdv-added-feedback"
              >
                <CheckCircle2 size={17} aria-hidden="true" />
                <span>{addedNotice.edited ? 'Item atualizado' : 'Item adicionado'} · {addedNotice.name}</span>
              </div>
            )}

            <div
              id="pdv-products-panel"
              className={`cashier-pdv-catalog min-w-0 flex-1 ${balcaoMobileView === 'produtos' ? 'flex' : 'hidden xl:flex'} flex-col gap-3 overflow-hidden w-full`}
            >
              <div
                className="cashier-pdv-catalog-controls shrink-0 rounded-2xl border border-koma-border bg-koma-panel p-2.5 sm:p-3 space-y-2.5"
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
                        recentlyAdded={addedNotice?.productId === String(product.id)}
                        detailsOpen={pdvProductDetailId === String(product.id)}
                        onConfigure={openNewProductConfig}
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
              className={`cashier-pdv-cart w-full xl:w-[350px] 2xl:w-[380px] bg-koma-panel border border-koma-border rounded-2xl ${balcaoMobileView === 'carrinho' ? 'flex' : 'hidden xl:flex'} ${pdvCart.length === 0 ? 'xl:self-start' : ''} ${pdvCart.length === 0 && pdvOrderType === 'pickup' ? 'is-empty-pickup' : ''} flex-col overflow-hidden shrink-0 shadow-sm`}
            >
              <div className="cashier-pdv-cart__header">
                <div className="cashier-pdv-cart__cart-heading">
                  <div className="cashier-pdv-cart__heading-icon" aria-hidden="true"><ShoppingCart size={20} /></div>
                  <div className="cashier-pdv-cart__heading-text">
                    <h3>Pedido atual</h3>
                    <span className="cashier-pdv-cart__eyebrow">{currentModalityLabel}</span>
                  </div>
                  <span className="cashier-pdv-cart__count">{pdvCartItemCount} {pdvCartItemCount === 1 ? 'item' : 'itens'}</span>
                </div>
              </div>
              <form
                onSubmit={handlePdvSubmitOrder}
                noValidate
                aria-label="Finalização do pedido"
                className="cashier-pdv-cart__form cashier-pdv-cart__form--unified"
              >
                <div className="cashier-pdv-cart__body">
              <div className="cashier-pdv-cart-scroll">
                {pdvCart.length === 0 ? (
                  <div className="cashier-pdv-cart__empty flex flex-col items-center justify-center text-center px-5">
                    <ShoppingCart size={28} aria-hidden="true" />
                    <strong>Carrinho vazio</strong>
                    <p>Escolha os itens para começar seu pedido.</p>
                    <button type="button" className="cashier-pdv-cart__empty-action xl:hidden" onClick={() => switchMobileTask('produtos')}>Escolher itens</button>
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
                <div className="cashier-pdv-cart__review-fields">
                  <div className="cashier-pdv-cart__modality-section space-y-1.5">
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
                            changeServiceType(type.id);
                          }}
                          className={clsx('cashier-pdv-cart__modality-option', pdvOrderType === type.id && 'is-active')}
                        >
                          {type.id === 'pickup' && <Package size={15} aria-hidden="true" />}
                          {type.id === 'delivery' && <Truck size={15} aria-hidden="true" />}
                          {type.id === 'dine_in' && <UtensilsCrossed size={15} aria-hidden="true" />}
                          <span>{type.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {pdvOrderType === 'dine_in' && (
                    <div className="cashier-pdv-cart__table-section">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="text-xs font-semibold text-koma-secondary">Mesa do pedido</span>
                        <span className="text-xs text-koma-muted">{pdvOccupiedTableCount} em atendimento</span>
                      </div>
                      <button
                        id="pdv-target-table"
                        type="button"
                        className="cashier-pdv-table-trigger"
                        data-table-id={pdvTargetMesaId || 0}
                        data-table-status={selectedPdvTableOption?.isOccupied ? 'occupied' : selectedPdvTableOption ? 'free' : 'unselected'}
                        aria-haspopup="dialog"
                        aria-expanded={tablePickerOpen}
                        aria-controls="pdv-table-picker"
                        onClick={() => setTablePickerOpen(true)}
                      >
                        <span className="cashier-pdv-table-trigger__details">
                          <strong>{selectedPdvTableOption ? formatPdvTableLabel(selectedPdvTableOption.table) : 'Escolher mesa'}</strong>
                          <small>{selectedPdvTableOption ? selectedPdvTableOption.isOccupied ? 'Em atendimento' : 'Livre' : 'Ainda sem mesa'}</small>
                        </span>
                        <span className="cashier-pdv-table-trigger__change">Alterar <ChevronDown size={17} aria-hidden="true" /></span>
                      </button>
                      <p className="cashier-pdv-table-note">
                        {selectedPdvTableOption
                          ? selectedPdvTableOption.isOccupied
                            ? 'Este pedido será adicionado ao atendimento da mesa.'
                            : 'O lançamento abrirá o atendimento desta mesa.'
                          : 'Também é possível lançar sem mesa e vincular depois.'}
                      </p>
                    </div>
                  )}

                  {pdvOrderType === 'pickup' && (
                    <details className="cashier-pdv-service-detail">
                      <summary className="cashier-pdv-service-detail__summary">
                        <span className="cashier-pdv-service-detail__label">
                          <UserRound size={18} aria-hidden="true" />
                          <span>
                            <strong>Identificação do cliente</strong>
                            <small>Opcional na retirada</small>
                          </span>
                        </span>
                        <span className="cashier-pdv-service-detail__status">
                          {pdvCustomerName || pdvCustomerPhone ? 'Preenchido' : 'Adicionar'}
                          <ChevronDown size={16} aria-hidden="true" />
                        </span>
                      </summary>
                      <div className="cashier-pdv-service-detail__content">
                        <CashierPdvCustomerFields
                          name={pdvCustomerName}
                          phone={pdvCustomerPhone}
                          required={false}
                          lookupStatus={pdvCustomerLookup}
                          onNameChange={setPdvCustomerName}
                          onPhoneChange={changeCustomerPhone}
                        />
                      </div>
                    </details>
                  )}

                  {pdvOrderType === 'delivery' && (
                    <div className="cashier-pdv-service-detail cashier-pdv-service-detail--required">
                      <div className="cashier-pdv-service-detail__summary cashier-pdv-service-detail__summary--static">
                        <span className="cashier-pdv-service-detail__label">
                          <UserRound size={18} aria-hidden="true" />
                          <span><strong>Cliente da entrega</strong><small>Nome e telefone obrigatórios</small></span>
                        </span>
                      </div>
                      <div className="cashier-pdv-service-detail__content">
                        <CashierPdvCustomerFields
                          name={pdvCustomerName}
                          phone={pdvCustomerPhone}
                          required={pdvCart.length > 0}
                          lookupStatus={pdvCustomerLookup}
                          onNameChange={setPdvCustomerName}
                          onPhoneChange={changeCustomerPhone}
                        />
                      </div>
                      <details className="cashier-pdv-service-detail__delivery" ref={deliveryAddressDisclosureRef}>
                        <summary className="cashier-pdv-service-detail__summary">
                          <span className="cashier-pdv-service-detail__label">
                            <MapPin size={18} aria-hidden="true" />
                            <span>
                              <strong>Endereço de entrega</strong>
                              <small>{deliveryAddressSummary || pdvDeliveryAddressLegacyHint || 'Informe o endereço completo'}</small>
                            </span>
                          </span>
                          <ChevronDown size={16} aria-hidden="true" />
                        </summary>
                        <div className="cashier-pdv-service-detail__content">
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
                    <details className="cashier-pdv-service-detail">
                      <summary className="cashier-pdv-service-detail__summary">
                        <span className="cashier-pdv-service-detail__label">
                          <CreditCard size={18} aria-hidden="true" />
                          <span>
                            <strong>Pagamento <small>(opcional agora)</small></strong>
                            <small>Pode ser informado no fechamento</small>
                          </span>
                        </span>
                        <span className="cashier-pdv-service-detail__status">
                          {pdvPaymentMethod ? PAYMENT_LABELS[pdvPaymentMethod] : 'Definir'}
                          <ChevronDown size={16} aria-hidden="true" />
                        </span>
                      </summary>
                      <div className="cashier-pdv-service-detail__content">
                        <div className="cashier-pdv-payment-options" role="group" aria-label="Forma de pagamento">
                          {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((method) => (
                            <button
                              key={method}
                              type="button"
                              aria-pressed={pdvPaymentMethod === method}
                              onClick={() => setPdvPaymentMethod(pdvPaymentMethod === method ? null : method)}
                              className={clsx('cashier-pdv-payment-option', pdvPaymentMethod === method && 'is-selected')}
                            >
                              <span className="cashier-pdv-payment-option__dot" aria-hidden="true">
                                {pdvPaymentMethod === method && <Check size={12} strokeWidth={3} />}
                              </span>
                              {PAYMENT_LABELS[method]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </details>
                  )}
                </div>
                </div>

                <div className="cashier-pdv-cart__footer shrink-0 border-t border-koma-border bg-koma-panel p-3 shadow-[0_-10px_24px_rgba(0,0,0,0.12)]">
                  <div className="cashier-pdv-cart__total mb-2 flex items-center justify-between font-bold text-koma-foreground">
                    <span className="cashier-pdv-cart__footer-left">
                      <button type="button" className="cashier-pdv-cart__back xl:hidden" onClick={() => switchMobileTask('produtos')} aria-label="Voltar aos itens">
                        <ChevronLeft size={17} aria-hidden="true" /> Itens
                      </button>
                      <span>Total do pedido</span>
                    </span>
                    <span className="cashier-pdv-cart__total-value text-emerald-700 dark:text-emerald-400"><small className="xl:hidden">Total</small><strong>{formatCurrency(cartTotal)}</strong></span>
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
                    className="cashier-pdv-cart__submit w-full min-h-11 rounded-xl border font-bold cursor-pointer flex flex-col items-center justify-center gap-0.5"
                  >
                    <div className="flex items-center gap-2">
                      <Check size={16} aria-hidden="true" />
                      <span>Lançar Pedido</span>
                    </div>
                  </button>
                </div>
              </form>
            </div>

            {balcaoMobileView === 'produtos' && (
              <button
                type="button"
                onClick={() => switchMobileTask('carrinho')}
                aria-label={`Ver pedido com ${pdvCartItemCount} ${pdvCartItemCount === 1 ? 'item' : 'itens'}, total ${formatCurrency(cartTotal)}`}
                id="pdv-review-btn"
                className="cashier-pdv-mobile-cart-cta xl:hidden"
              >
                <span className="cashier-pdv-mobile-cart-cta__label">
                  <ShoppingCart size={16} />
                  <span>Ver pedido · {pdvCartItemCount} {pdvCartItemCount === 1 ? 'item' : 'itens'}</span>
                </span>
                <span
                  className="cashier-pdv-mobile-cart-cta__total"
                >
                  {formatCurrency(cartTotal)}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      <CashierPdvTablePicker
        options={pdvTableOptions}
        selectedId={pdvTargetMesaId}
        open={activeSubTab === 'balcao' && pdvOrderType === 'dine_in' && tablePickerOpen}
        onOpenChange={setTablePickerOpen}
        onSelect={setPdvTargetMesaId}
      />

      {configProduct && (
        <CashierPdvConfigurator
          key={String(configProduct.id) + ':' + String(configCartIndex ?? 'new')}
          product={configProduct}
          isEditing={configCartIndex !== null}
          quantity={configQty}
          onQuantityChange={setConfigQty}
          observation={configObs}
          onObservationChange={setConfigObs}
          groups={configGroups}
          selectedIds={configModifierIds}
          onModifierChange={changeConfigModifierQuantity}
          total={configUnitTotal * configQty}
          valid={configValid}
          onSave={saveConfiguredItem}
          onClose={closeConfig}
        />
      )}
    </>
  );
}
