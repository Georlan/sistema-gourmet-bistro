import clsx from 'clsx';
import { useMemo, useState, type FormEvent } from 'react';
import { PAYMENT_LABELS, type PaymentMethod } from '../../../cardapio/paymentMethods';
import { Check, ChevronLeft, ChevronRight, Edit3, Info, Minus, Package, Plus, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import type { CatalogModifierGroup } from '../../../catalog/catalog';
import { projectCashierSalonTables } from '../../../domain/cashierSalonProjection';
import { getProductPresets } from '../../../domain/catalogPresentation';
import { deliveryAddressDraftToSnapshot, updateDeliveryAddressGeographicField } from '../../../domain/deliveryAddress';
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

const splitProductLabel = (label: string) => {
  const match = String(label || '').match(/^(\d{2,4})\s*[-–]\s*(.+)$/);
  return match ? { code: match[1], name: match[2] } : { code: '', name: label };
};

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

const summarizeModifierSelections = (modifiers: PdvModifierSelection[]) => {
  const summary = new Map<string, { modifier: PdvModifierSelection; quantity: number }>();
  modifiers.forEach((modifier) => {
    const current = summary.get(modifier.id);
    if (current) {
      current.quantity += 1;
      return;
    }
    summary.set(modifier.id, { modifier, quantity: 1 });
  });
  return Array.from(summary.values());
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
  const [deliveryEditorOpen, setDeliveryEditorOpen] = useState(false);

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

  const orderTypeLabel =
    pdvOrderType === 'delivery'
      ? 'Delivery'
      : pdvOrderType === 'dine_in'
        ? 'Consumo no local'
        : 'Retirada';
  const deliverySnapshot =
    pdvOrderType === 'delivery'
      ? deliveryAddressDraftToSnapshot(pdvDeliveryAddressDraft)
      : null;
  const deliveryPhoneDigits = pdvCustomerPhone.replace(/\D/g, '');
  const deliveryReady = Boolean(
    deliverySnapshot
    && deliverySnapshot.bairro.trim()
    && deliverySnapshot.cidade.trim()
    && deliverySnapshot.uf.trim().length === 2
    && pdvCustomerName.trim().length >= 2
    && [10, 11].includes(deliveryPhoneDigits.length),
  );
  const deliveryAddressSummary = deliverySnapshot
    ? [
        `${deliverySnapshot.logradouro}, ${deliverySnapshot.numero}`,
        deliverySnapshot.bairro,
        [deliverySnapshot.cidade, deliverySnapshot.uf].filter(Boolean).join(' - '),
      ].filter(Boolean).join(' · ')
    : 'Endereço não informado';
  const pickupCustomerSummary =
    [pdvCustomerName.trim(), pdvCustomerPhone.trim()].filter(Boolean).join(' · ')
    || 'Sem identificação — lançar direto';

  const handlePanelSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (pdvOrderType === 'delivery' && !deliveryReady) {
      event.preventDefault();
      setDeliveryEditorOpen(true);
      return;
    }
    handlePdvSubmitOrder(event);
  };

  return (
    <>
      {activeSubTab === 'balcao' && (
        <div className={"orders-workspace h-full min-h-0 flex flex-col gap-3 sm:gap-4"}>
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
            <div
              className={"flex xl:hidden gap-1 p-1 bg-white/[0.025] border border-koma-border rounded-xl shrink-0"}
            >
              <button
                type="button"
                onClick={() => setBalcaoMobileView('produtos')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  balcaoMobileView === 'produtos'
                    ? 'bg-emerald-600 text-white'
                    : 'text-koma-muted hover:text-koma-foreground'
                }`}
              >
                <Package size={14} />
                <span>Escolher itens</span>
              </button>
              <button
                type="button"
                onClick={() => setBalcaoMobileView('carrinho')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  balcaoMobileView === 'carrinho'
                    ? 'bg-emerald-600 text-white'
                    : 'text-koma-muted hover:text-koma-foreground'
                }`}
              >
                <ShoppingCart size={14} />
                <span>Carrinho ({pdvCartItemCount})</span>
              </button>
            </div>

            <div
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
                    type="text"
                    placeholder="Buscar item, descrição ou código"
                    value={pdvSearch}
                    onChange={(e) => setPdvSearch(e.target.value)}
                    className={"w-full bg-koma-input border border-koma-border focus:border-emerald-500/60 text-koma-foreground placeholder:text-koma-muted rounded-xl py-2.5 pl-10 pr-8 text-xs outline-none transition-all"}
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
                      onClick={() => {
                        setPdvSelectedCategory('todos');
                        setPdvProductDetailId(null);
                      }}
                      className={`h-8 px-3 text-[10px] font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors border ${
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
                        onClick={() => {
                          setPdvSelectedCategory(catObj.nome);
                          setPdvProductDetailId(null);
                        }}
                        className={`h-8 px-3 text-[10px] font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors border ${
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
                    className={"grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 2xl:grid-cols-4 gap-2 sm:gap-2.5 pb-2"}
                  >
                    {filteredProducts.map((p) => {
                      const productLabel = splitProductLabel(p.nome);
                      const productDetailKey = String(p.id);
                      const hasProductDetails = Boolean(p.descricao || productLabel.code);
                      const groups = modifierGroupsFor(p);
                      const recommendedCount = groups.filter((group) => group.recomendado !== false).length;
                      return (
                        <div
                          key={p.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openConfig(p)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openConfig(p);
                            }
                          }}
                          className={"group relative min-h-[96px] sm:min-h-[112px] bg-koma-panel border border-koma-border hover:border-emerald-500/60 rounded-xl sm:rounded-2xl transition-colors shadow-sm cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"}
                          title="Clique no card para personalizar"
                        >
                          <div className={"flex h-full w-full flex-col justify-between gap-2 sm:gap-3 p-2.5 sm:p-3.5 text-left rounded-xl sm:rounded-2xl"}>
                            {p.imagem && (
                              <img
                                src={p.imagem}
                                alt=""
                                loading="lazy"
                                className={"w-full h-16 sm:h-20 object-cover rounded-lg sm:rounded-xl"}
                              />
                            )}
                            <div className="min-h-[28px] sm:min-h-[34px] pr-6">
                              <h4
                                className={"font-semibold text-koma-foreground text-xs sm:text-[13px] leading-snug line-clamp-2"}
                              >
                                {productLabel.name}
                              </h4>
                              {groups.length > 0 && (
                                <span className="mt-1 inline-flex rounded bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-bold text-emerald-600 dark:text-emerald-300">
                                  Personalizável{recommendedCount > 0 ? ` · ${recommendedCount} recomendados` : ''}
                                </span>
                              )}
                            </div>
                            <div
                              className={"flex justify-between items-center border-t border-koma-border pt-2 sm:pt-2.5 gap-2"}
                            >
                              <span
                                className={"font-bold text-emerald-700 dark:text-emerald-400 font-mono text-xs"}
                              >
                                R$ {p.preco.toFixed(2).replace('.', ',')}
                              </span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPdvProductDetailId(null);
                                  handlePdvAddToCart(p);
                                }}
                                className={"inline-flex min-h-8 items-center gap-1 rounded-lg bg-emerald-500 px-2 text-[9px] font-extrabold text-zinc-950 hover:bg-emerald-400"}
                                aria-label={`Adicionar ${productLabel.name} rapidamente`}
                              >
                                <Plus size={13} /> <span className="hidden min-[380px]:inline">Adicionar</span>
                              </button>
                            </div>
                          </div>

                          {hasProductDetails && (
                            <>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPdvProductDetailId((current) =>
                                    current === productDetailKey ? null : productDetailKey,
                                  );
                                }}
                                aria-expanded={pdvProductDetailId === productDetailKey}
                                aria-controls={`pdv-product-details-${productDetailKey}`}
                                aria-label={`Ver ingredientes e detalhes de ${productLabel.name}`}
                                title="Ver ingredientes e detalhes"
                                className={"absolute right-2 top-2 z-20 flex size-7 items-center justify-center rounded-lg border border-koma-border bg-koma-card/95 text-koma-muted hover:border-emerald-500/40 hover:text-emerald-700 dark:hover:text-emerald-300"}
                              >
                                <Info size={13} />
                              </button>
                              <div
                                id={`pdv-product-details-${productDetailKey}`}
                                role="note"
                                className={clsx(
                                  'pointer-events-none',
                                  'absolute',
                                  'inset-x-2',
                                  'top-10',
                                  'z-10',
                                  'rounded-xl',
                                  'border',
                                  'border-koma-border',
                                  'bg-koma-dialog/95',
                                  'backdrop-blur-md',
                                  'p-2.5',
                                  'text-left',
                                  'shadow-xl',
                                  'translate-y-1',
                                  'opacity-0',
                                  'transition-all',
                                  'group-hover:translate-y-0',
                                  'group-hover:opacity-100',
                                  pdvProductDetailId === productDetailKey && 'translate-y-0 opacity-100',
                                )}
                              >
                                <span
                                  className={"block text-[8px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300"}
                                >
                                  Ingredientes e detalhes
                                </span>
                                {productLabel.code && (
                                  <span className={"mt-1 block font-mono text-[8px] text-koma-muted"}>
                                    Cód. {productLabel.code}
                                  </span>
                                )}
                                <p className={"mt-1 text-[10px] leading-relaxed text-koma-secondary"}>
                                  {p.descricao || 'Sem descrição cadastrada.'}
                                </p>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
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
              </div>
            </div>

            <div
              className={clsx(
                'cashier-pdv-cart w-full xl:w-[360px] 2xl:w-[400px] bg-koma-panel border border-koma-border rounded-2xl',
                balcaoMobileView === 'carrinho' ? 'flex' : 'hidden xl:flex',
                'min-h-0 flex-col overflow-hidden shrink-0 shadow-sm',
              )}
            >
              <div className="shrink-0 border-b border-koma-border bg-koma-raised px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 font-semibold text-koma-foreground">
                    <span className="inline-flex size-8 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15">
                      <ShoppingCart size={15} className="text-emerald-700 dark:text-emerald-400" />
                    </span>
                    <span>Pedido atual</span>
                  </span>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 font-mono text-[9px] font-bold text-emerald-800 dark:text-emerald-300">
                    {pdvCartItemCount} itens
                  </span>
                </div>
              </div>

              <div
                className="cashier-pdv-cart-scroll min-h-0 flex-1 overflow-y-auto p-3 space-y-2"
                data-testid="pdv-cart-items"
              >
                {pdvCart.length === 0 ? (
                  <div className="flex h-full min-h-44 flex-col items-center justify-center px-6 text-center text-koma-muted">
                    <ShoppingCart size={22} className="mb-3 opacity-60" />
                    <p className="text-xs font-semibold text-koma-subtle">Comece escolhendo um item</p>
                    <p className="mt-1 text-[9px]">+ Adicionar é rápido. O card abre a personalização.</p>
                  </div>
                ) : (
                  pdvCart.map((item, idx) => (
                    <div
                      key={`${item.product.id}-${idx}`}
                      className="space-y-2.5 rounded-xl border border-koma-border-subtle bg-white/[0.025] p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <strong className="block max-w-48 truncate text-xs text-koma-foreground">
                            {item.product.nome}
                          </strong>
                          <span className="font-mono text-[9px] text-[#4fe0bc]">
                            {formatCurrency(pdvCartItemUnitPrice(item))} / un.
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openConfig(item.product, idx)}
                            className="cursor-pointer rounded-lg p-1 text-koma-muted hover:bg-koma-raised hover:text-emerald-400"
                            aria-label={`Editar ${item.product.nome}`}
                            title="Editar item e adicionais"
                          >
                            <Edit3 size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePdvRemoveCartItem(idx)}
                            className="cursor-pointer rounded-lg p-1 text-koma-muted hover:text-rose-500"
                            aria-label={`Remover ${item.product.nome}`}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>

                      {(item.modifiers || []).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {summarizeModifierSelections(item.modifiers || []).map(({ modifier, quantity }) => (
                            <span
                              key={modifier.id}
                              className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-semibold text-emerald-400"
                            >
                              + {quantity > 1 ? `${quantity}x ` : ''}{modifier.nome}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center overflow-hidden rounded-lg border border-koma-border bg-koma-input">
                          <button
                            type="button"
                            onClick={() => handlePdvUpdateCartQty(idx, -1)}
                            className="cursor-pointer px-2 py-1 text-koma-subtle hover:bg-koma-raised hover:text-koma-foreground"
                            aria-label={`Diminuir quantidade de ${item.product.nome}`}
                          >
                            -
                          </button>
                          <span className="px-2 font-mono text-[10px] font-bold text-koma-foreground">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => handlePdvUpdateCartQty(idx, 1)}
                            className="cursor-pointer px-2 py-1 text-koma-subtle hover:bg-koma-raised hover:text-koma-foreground"
                            aria-label={`Aumentar quantidade de ${item.product.nome}`}
                          >
                            +
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="Obs..."
                          value={item.obs}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPdvCart((prev) => prev.map((entry, index) =>
                              index === idx ? { ...entry, obs: val } : entry
                            ));
                          }}
                          className="min-w-0 flex-1 rounded border border-koma-border bg-koma-input px-1.5 py-1 text-[9px] text-koma-foreground focus:border-[#10b981] focus:outline-none"
                        />
                      </div>

                      {(() => {
                        const presets = getProductPresets(item.product);
                        if (presets.length === 0) return null;
                        const parts = item.obs ? item.obs.split(',').map((part) => part.trim()) : [];
                        return (
                          <div className="mt-2 flex flex-wrap justify-end gap-1">
                            {presets.map((preset) => {
                              const isActive = parts.some((part) => part.toLowerCase() === preset.toLowerCase());
                              return (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() => {
                                    const currentParts = item.obs
                                      ? item.obs.split(',').map((part) => part.trim())
                                      : [];
                                    const exists = currentParts.some(
                                      (part) => part.toLowerCase() === preset.toLowerCase(),
                                    );
                                    const updatedParts = exists
                                      ? currentParts.filter(
                                          (part) => part.toLowerCase() !== preset.toLowerCase() && part !== '',
                                        )
                                      : [...currentParts.filter((part) => part !== ''), preset];
                                    const updatedObs = updatedParts.join(', ');
                                    setPdvCart((prev) => prev.map((entry, index) =>
                                      index === idx ? { ...entry, obs: updatedObs } : entry
                                    ));
                                  }}
                                  className={`cursor-pointer rounded border px-1.5 py-0.5 text-[8px] font-medium transition-colors ${
                                    isActive
                                      ? 'border-emerald-500/40 bg-emerald-600/20 text-emerald-400'
                                      : 'border-koma-border bg-koma-raised text-koma-subtle hover:bg-emerald-600/25 hover:text-white'
                                  }`}
                                >
                                  {isActive ? preset : `+${preset}`}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={handlePanelSubmit}
                className="flex max-h-[48%] shrink-0 flex-col border-t border-koma-border bg-koma-panel/95"
                data-testid="pdv-checkout-panel"
              >
                <div className="min-h-0 overflow-y-auto p-3 pb-2 space-y-2.5">
                  <div
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl border border-koma-border bg-koma-input px-3 py-2"
                    data-testid="pdv-order-summary"
                  >
                    <div className="min-w-0">
                      <span className="block text-[7px] font-bold uppercase tracking-wider text-koma-muted">
                        Modalidade
                      </span>
                      <strong className="block truncate text-[10px] text-koma-foreground">{orderTypeLabel}</strong>
                    </div>
                    <div className="text-right">
                      <span className="block text-[7px] font-bold uppercase tracking-wider text-koma-muted">Itens</span>
                      <strong className="font-mono text-[10px] text-koma-foreground">{pdvCartItemCount}</strong>
                    </div>
                    <div className="text-right">
                      <span className="block text-[7px] font-bold uppercase tracking-wider text-koma-muted">Total</span>
                      <strong className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(cartTotal)}
                      </strong>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="grid grid-cols-3 gap-1 rounded-xl border border-koma-border bg-koma-input p-1">
                      {([
                        { id: 'pickup', label: 'Retirada' },
                        { id: 'delivery', label: 'Delivery' },
                        { id: 'dine_in', label: 'Consumo local' },
                      ] as const).map((type) => (
                        <button
                          key={type.id}
                          type="button"
                          onClick={() => {
                            setPdvOrderType(type.id);
                            if (type.id !== 'dine_in') setPdvTargetMesaId(0);
                          }}
                          className={`cursor-pointer rounded-lg py-1.5 text-[9px] font-bold uppercase transition-all ${
                            pdvOrderType === type.id
                              ? 'bg-[#10b981] font-extrabold text-zinc-950'
                              : 'text-koma-subtle hover:text-koma-foreground'
                          }`}
                        >
                          {type.label}
                        </button>
                      ))}
                    </div>
                    <details className="text-left text-[9px] text-koma-muted">
                      <summary className="w-fit cursor-pointer list-none font-semibold hover:text-koma-secondary">
                        Ver atalhos de teclado
                      </summary>
                      <span className="mt-1 block font-mono">
                        F2 Retirada · F3 Consumo local · F8 Delivery · F4 Finalizar
                      </span>
                    </details>
                  </div>

                  {pdvOrderType === 'pickup' && (
                    <details
                      className="group rounded-xl border border-koma-border bg-koma-card/40"
                      data-testid="pdv-pickup-customer"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <span className="block text-[8px] font-bold uppercase tracking-wider text-koma-subtle">
                            Cliente (opcional)
                          </span>
                          <span className="block truncate text-[9px] text-koma-muted">{pickupCustomerSummary}</span>
                        </div>
                        <span className="shrink-0 text-[9px] font-semibold text-emerald-600 dark:text-emerald-300">
                          {pdvCustomerName || pdvCustomerPhone ? 'Editar' : 'Adicionar'}
                        </span>
                      </summary>
                      <div className="grid grid-cols-2 gap-2 border-t border-koma-border p-2.5">
                        <label className="space-y-1">
                          <span className="block text-[8px] font-bold uppercase tracking-wider text-koma-subtle">
                            Telefone
                          </span>
                          <input
                            id="pdv-customer-phone-input"
                            type="tel"
                            inputMode="numeric"
                            autoComplete="tel"
                            placeholder="(00) 00000-0000"
                            value={pdvCustomerPhone}
                            onChange={(event) => {
                              setPdvCustomerPhone(aplicarMascaraTelefoneInput(event.target.value));
                              setPdvCustomerId(null);
                            }}
                            className="w-full rounded-lg border border-koma-border bg-koma-input px-2 py-1.5 text-[10px] text-koma-foreground outline-none focus:border-emerald-500"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-[8px] font-bold uppercase tracking-wider text-koma-subtle">
                            Nome
                          </span>
                          <input
                            id="pdv-customer-name-input"
                            type="text"
                            autoComplete="name"
                            placeholder="Ex.: Maria"
                            value={pdvCustomerName}
                            onChange={(event) => setPdvCustomerName(event.target.value)}
                            className="w-full rounded-lg border border-koma-border bg-koma-input px-2 py-1.5 text-[10px] text-koma-foreground outline-none focus:border-emerald-500"
                          />
                        </label>
                        {pdvCustomerLookup !== 'idle' && (
                          <p className={clsx(
                            'col-span-2 text-[8px] font-bold',
                            pdvCustomerLookup === 'found' ? 'text-emerald-400' : 'text-koma-muted',
                          )}>
                            {pdvCustomerLookup === 'loading' && 'Buscando cliente...'}
                            {pdvCustomerLookup === 'found' && 'Cliente encontrado.'}
                            {pdvCustomerLookup === 'new' && 'Novo número — cadastro será criado ao lançar.'}
                          </p>
                        )}
                      </div>
                    </details>
                  )}

                  {pdvOrderType === 'delivery' && (
                    <div
                      className={clsx(
                        'rounded-xl border p-3',
                        deliveryReady
                          ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
                          : 'border-amber-500/25 bg-amber-500/[0.06]',
                      )}
                      data-testid="pdv-delivery-summary"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className={clsx(
                            'block text-[8px] font-bold uppercase tracking-wider',
                            deliveryReady ? 'text-emerald-500' : 'text-amber-400',
                          )}>
                            {deliveryReady ? 'Entrega pronta' : 'Dados de entrega pendentes'}
                          </span>
                          {deliveryReady ? (
                            <>
                              <strong className="mt-0.5 block truncate text-[10px] text-koma-foreground">
                                {pdvCustomerName} · {pdvCustomerPhone}
                              </strong>
                              <span className="mt-0.5 block line-clamp-2 text-[9px] leading-relaxed text-koma-muted">
                                {deliveryAddressSummary}
                              </span>
                            </>
                          ) : (
                            <span className="mt-0.5 block text-[9px] leading-relaxed text-koma-muted">
                              Complete cliente, telefone e endereço sem tirar espaço do carrinho.
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setDeliveryEditorOpen(true)}
                          className="shrink-0 rounded-lg border border-koma-border bg-koma-input px-2.5 py-1.5 text-[9px] font-bold text-koma-foreground hover:border-emerald-500/40"
                        >
                          Editar entrega
                        </button>
                      </div>
                    </div>
                  )}

                  {pdvOrderType === 'dine_in' && (
                    <div className="space-y-1.5" data-testid="pdv-dine-in-table">
                      <div className="flex items-center justify-between gap-3">
                        <label
                          htmlFor="pdv-target-table"
                          className="block text-[8px] font-bold uppercase tracking-wider text-koma-subtle"
                        >
                          Mesa (opcional)
                        </label>
                        <span className="text-[8px] text-koma-muted">{pdvOccupiedTableCount} em atendimento</span>
                      </div>
                      <select
                        id="pdv-target-table"
                        value={pdvTargetMesaId || ''}
                        onChange={(event) => setPdvTargetMesaId(Number(event.target.value) || 0)}
                        aria-describedby={selectedPdvTableOption?.isOccupied ? 'pdv-table-selection-help' : undefined}
                        data-table-status={
                          selectedPdvTableOption?.isOccupied
                            ? 'occupied'
                            : selectedPdvTableOption
                              ? 'free'
                              : 'unselected'
                        }
                        className={clsx(
                          'min-h-10 w-full rounded-xl border px-3 text-[10px] font-semibold text-koma-foreground outline-none transition-colors focus:ring-2',
                          selectedPdvTableOption?.isOccupied
                            ? 'border-[#6b2d37] bg-[#1b1013] focus:border-[#8a3d49] focus:ring-[#6b2d37]/20'
                            : 'border-koma-border bg-koma-input focus:border-[#00b894]/70 focus:ring-[#00b894]/10',
                        )}
                      >
                        <option value="">Sem mesa</option>
                        {pdvTableOptions.map((option) => (
                          <option
                            key={option.table.id}
                            value={option.table.id}
                            data-table-status={option.isOccupied ? 'occupied' : 'free'}
                            style={{
                              backgroundColor: option.isOccupied ? '#1b1013' : '#090d0b',
                              color: option.isOccupied ? '#e4a3ac' : '#d4d4d8',
                            }}
                          >
                            {option.isOccupied ? '●' : '○'} {option.label}
                            {option.table.nome ? ` · Mesa ${option.table.id}` : ''}
                            {option.isOccupied
                              ? ` · em atendimento${option.total > 0 ? ` · R$ ${option.total.toFixed(2).replace('.', ',')}` : ''}`
                              : ' · livre'}
                          </option>
                        ))}
                      </select>
                      {selectedPdvTableOption?.isOccupied && (
                        <div
                          id="pdv-table-selection-help"
                          className="flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50/90 px-3 py-2 text-left dark:border-[#6b2d37]/80 dark:bg-[#261317]"
                        >
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 shrink-0 rounded-full bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.2)]"
                          />
                          <span className="text-[8px] leading-relaxed text-rose-800 dark:text-[#e4a3ac]">
                            {selectedPdvTableOption.label} já está em atendimento; os itens serão adicionados à conta ativa.
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {(pdvOrderType === 'pickup' || pdvOrderType === 'delivery') && (
                    <details
                      className="rounded-xl border border-koma-border bg-koma-card/40"
                      data-testid="pdv-payment-section"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <span className="block text-[8px] font-bold uppercase tracking-wider text-koma-subtle">
                            Pagamento (opcional agora)
                          </span>
                          <span className="block truncate text-[9px] text-koma-muted">
                            {pdvPaymentMethod ? PAYMENT_LABELS[pdvPaymentMethod] : 'Definir depois'}
                          </span>
                        </div>
                        <span className="shrink-0 text-[9px] font-semibold text-emerald-600 dark:text-emerald-300">
                          {pdvPaymentMethod ? 'Editar' : 'Adicionar'}
                        </span>
                      </summary>
                      <div className="grid grid-cols-2 gap-1.5 border-t border-koma-border p-2.5">
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

                <div className="sticky bottom-0 z-10 shrink-0 border-t border-koma-border bg-koma-panel p-3 pt-2">
                  <button
                    id="pdv-submit-btn"
                    type="submit"
                    disabled={pdvCart.length === 0 || isLoading}
                    className="flex min-h-11 w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border border-transparent bg-[#00b894] py-2 text-[10px] font-bold uppercase tracking-wider text-[#06110d] transition-colors hover:bg-[#13c9a0] disabled:cursor-not-allowed disabled:border-[#272c29] disabled:bg-koma-card disabled:text-zinc-600"
                  >
                    <span className="flex items-center gap-1">
                      <Check size={12} />
                      <span>{pdvOrderType === 'delivery' && !deliveryReady ? 'Completar e lançar' : 'Lançar Pedido'}</span>
                    </span>
                    <span className="font-mono text-[7.5px] font-normal text-emerald-600 dark:text-emerald-300/80">
                      Pressione [F4] para finalizar
                    </span>
                  </button>
                </div>
              </form>
            </div>

            {pdvCart.length > 0 && balcaoMobileView === 'produtos' && (
              <button
                type="button"
                onClick={() => setBalcaoMobileView('carrinho')}
                className={"xl:hidden fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-4 left-4 right-4 z-40 min-h-12 py-3 px-5 bg-[#00b894] hover:bg-[#13c9a0] text-[#06110d] font-bold rounded-2xl shadow-2xl flex items-center justify-between border border-[#4fe0bc]/30 animate-fade-in cursor-pointer"}
              >
                <span className={"text-xs flex items-center gap-2"}>
                  <ShoppingCart size={16} />
                  <span>{pdvCartItemCount} itens no carrinho</span>
                </span>
                <span
                  className={"text-xs font-mono font-extrabold bg-black/30 px-3 py-1 rounded-xl"}
                >
                  {formatCurrency(cartTotal)} →
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {deliveryEditorOpen && pdvOrderType === 'delivery' && (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-center bg-koma-overlay p-0 sm:items-center sm:p-4"
          onClick={(event) => event.target === event.currentTarget && setDeliveryEditorOpen(false)}
        >
          <div
            className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-koma-border bg-koma-card p-4 shadow-2xl sm:rounded-3xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pdv-delivery-editor-title"
            data-testid="pdv-delivery-editor"
          >
            <div className="flex items-start justify-between gap-3 border-b border-koma-border pb-3">
              <div className="min-w-0">
                <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">Delivery</span>
                <h3 id="pdv-delivery-editor-title" className="text-lg font-bold text-koma-foreground">
                  Dados da entrega
                </h3>
                <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
                  Preencha o necessário para entregar. O carrinho fica preservado ao fechar esta janela.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeliveryEditorOpen(false)}
                className="rounded-full p-1.5 text-koma-muted hover:text-koma-foreground"
                aria-label="Fechar dados da entrega"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="block text-[9px] font-bold uppercase tracking-wider text-koma-subtle">
                  Telefone
                </span>
                <input
                  id="pdv-customer-phone-input"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="(00) 00000-0000"
                  value={pdvCustomerPhone}
                  onChange={(event) => {
                    setPdvCustomerPhone(aplicarMascaraTelefoneInput(event.target.value));
                    setPdvCustomerId(null);
                  }}
                  className="w-full rounded-xl border border-koma-border bg-koma-input px-3 py-2.5 text-xs text-koma-foreground outline-none focus:border-emerald-500"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[9px] font-bold uppercase tracking-wider text-koma-subtle">
                  Nome do cliente
                </span>
                <input
                  id="pdv-customer-name-input"
                  type="text"
                  autoComplete="name"
                  placeholder="Ex.: Maria"
                  value={pdvCustomerName}
                  onChange={(event) => setPdvCustomerName(event.target.value)}
                  className="w-full rounded-xl border border-koma-border bg-koma-input px-3 py-2.5 text-xs text-koma-foreground outline-none focus:border-emerald-500"
                />
              </label>
            </div>

            {pdvCustomerLookup !== 'idle' && (
              <p className={clsx(
                'mt-2 text-[9px] font-bold',
                pdvCustomerLookup === 'found' ? 'text-emerald-400' : 'text-koma-muted',
              )}>
                {pdvCustomerLookup === 'loading' && 'Buscando cliente...'}
                {pdvCustomerLookup === 'found' && 'Cliente encontrado — confira o endereço desta entrega.'}
                {pdvCustomerLookup === 'new' && 'Novo número — o cliente será criado ao lançar o pedido.'}
              </p>
            )}

            <div className="mt-4 rounded-2xl border border-koma-border bg-koma-panel/60 p-3">
              <DeliveryAddressFields
                value={pdvDeliveryAddressDraft}
                onChange={handlePdvDeliveryAddressChange}
                legacyHint={pdvDeliveryAddressLegacyHint || null}
                compact
                idPrefix="pdv-delivery-address"
              />
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_76px] gap-2">
                <label>
                  <span className="mb-1 block text-[8px] font-bold uppercase tracking-wider text-koma-subtle">
                    Cidade
                  </span>
                  <input
                    id="pdv-delivery-address-cidade"
                    autoComplete="address-level2"
                    placeholder="Ex.: Fortaleza"
                    value={pdvDeliveryAddressDraft.cidade}
                    onChange={(event) => handlePdvDeliveryAddressChange(
                      updateDeliveryAddressGeographicField(pdvDeliveryAddressDraft, 'cidade', event.target.value),
                    )}
                    className="w-full rounded-lg border border-koma-border bg-koma-input px-2 py-1.5 text-[10px] text-koma-foreground outline-none focus:border-emerald-500"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-[8px] font-bold uppercase tracking-wider text-koma-subtle">
                    UF
                  </span>
                  <input
                    id="pdv-delivery-address-uf"
                    autoComplete="address-level1"
                    placeholder="CE"
                    maxLength={2}
                    value={pdvDeliveryAddressDraft.uf}
                    onChange={(event) => handlePdvDeliveryAddressChange(
                      updateDeliveryAddressGeographicField(pdvDeliveryAddressDraft, 'uf', event.target.value),
                    )}
                    className="w-full rounded-lg border border-koma-border bg-koma-input px-2 py-1.5 text-[10px] uppercase text-koma-foreground outline-none focus:border-emerald-500"
                  />
                </label>
              </div>
              <p className="mt-2 text-[8px] leading-relaxed text-koma-muted">
                Bairro, cidade e UF precisam estar preenchidos para lançar o delivery.
              </p>
            </div>

            <div className="mt-4 flex flex-col gap-3 border-t border-koma-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <strong className={clsx(
                  'block text-[10px]',
                  deliveryReady ? 'text-emerald-400' : 'text-amber-300',
                )}>
                  {deliveryReady ? 'Entrega pronta para lançar' : 'Complete nome, telefone e endereço'}
                </strong>
                <span className="mt-0.5 block text-[9px] text-koma-muted">
                  Pagamento pode ser definido agora ou depois.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDeliveryEditorOpen(false)}
                className="min-h-10 shrink-0 rounded-xl bg-emerald-500 px-4 text-xs font-extrabold text-zinc-950 hover:bg-emerald-400"
              >
                Voltar ao pedido
              </button>
            </div>
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
