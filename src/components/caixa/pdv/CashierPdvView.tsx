import clsx from 'clsx';
import { Check, ChevronLeft, ChevronRight, Info, Package, Plus, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import { projectCashierSalonTables } from '../../../domain/cashierOrderProjection';
import { getProductPresets } from '../../../domain/catalogPresentation';
import { aplicarMascaraTelefoneInput } from '../../../utils/phonePresentation';
import { OperationalBanner } from '../../shared/OperationalBanner';
import { formatCurrency } from '../cashierPresentation';
import type { useCashierPdv } from './useCashierPdv';
import { usePdvCategoryNavigation } from './usePdvCategoryNavigation';

const splitProductLabel = (label: string) => {
  const match = String(label || '').match(/^(\d{2,4})\s*[-–]\s*(.+)$/);
  return match ? { code: match[1], name: match[2] } : { code: '', name: label };
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
    pdvDeliveryAddress,
    setPdvDeliveryAddress,
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

  return (
    <>
      {activeSubTab === 'balcao' && (
        <div className={clsx('orders-workspace', 'h-full', 'min-h-0', 'flex', 'flex-col', 'gap-3', 'sm:gap-4')}>
          <OperationalBanner
            id="counter-heading"
            eyebrow="VENDA"
            title="Novo pedido"
            accent="rápido e simples"
            description="Clique para adicionar. Passe o mouse ou use o ícone de detalhes para conferir ingredientes."
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
            className={clsx(
              'min-h-0',
              'flex-1',
              'flex',
              'flex-col',
              'xl:flex-row',
              'gap-3',
              'sm:gap-4',
              'overflow-hidden',
              'relative',
            )}
          >
            {/* Mobile sub-tab toggle */}
            <div
              className={clsx(
                'flex',
                'xl:hidden',
                'gap-1',
                'p-1',
                'bg-white/[0.025]',
                'border',
                'border-koma-border',
                'rounded-xl',
                'shrink-0',
              )}
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

            {/* Product grid column */}
            <div
              className={`min-w-0 flex-1 ${balcaoMobileView === 'produtos' ? 'flex' : 'hidden xl:flex'} flex-col gap-3 overflow-hidden w-full`}
            >
              <div
                className={clsx(
                  'shrink-0',
                  'rounded-2xl',
                  'border',
                  'border-koma-border',
                  'bg-koma-panel',
                  'p-2.5',
                  'sm:p-3',
                  'space-y-2.5',
                )}
              >
                <div className="relative">
                  <Search
                    size={15}
                    className={clsx('absolute', 'left-3.5', 'top-1/2', '-translate-y-1/2', 'text-koma-muted')}
                  />
                  <input
                    id="pdv-product-search-input"
                    type="text"
                    placeholder="Buscar item, descrição ou código"
                    value={pdvSearch}
                    onChange={(e) => setPdvSearch(e.target.value)}
                    className={clsx(
                      'w-full',
                      'bg-koma-input',
                      'border',
                      'border-koma-border',
                      'focus:border-emerald-500/60',
                      'text-koma-foreground',
                      'placeholder:text-koma-muted',
                      'rounded-xl',
                      'py-2.5',
                      'pl-10',
                      'pr-8',
                      'text-xs',
                      'outline-none',
                      'transition-all',
                    )}
                  />
                  {pdvSearch && (
                    <button
                      type="button"
                      onClick={() => setPdvSearch('')}
                      className={clsx(
                        'absolute',
                        'right-3',
                        'top-1/2',
                        '-translate-y-1/2',
                        'text-koma-muted',
                        'hover:text-koma-foreground',
                        'p-1',
                        'rounded-lg',
                      )}
                      aria-label="Limpar busca de itens"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                <div className={clsx('flex', 'min-w-0', 'items-center', 'gap-1.5')}>
                  {pdvCategoryScrollState.hasOverflow && (
                    <button
                      type="button"
                      onClick={() => scrollPdvCategories(-1)}
                      disabled={!pdvCategoryScrollState.canScrollLeft}
                      aria-label="Ver categorias anteriores"
                      className={clsx(
                        'hidden',
                        'size-8',
                        'shrink-0',
                        'items-center',
                        'justify-center',
                        'rounded-lg',
                        'border',
                        'border-koma-border',
                        'bg-koma-panel',
                        'text-koma-muted',
                        'hover:text-koma-foreground',
                        'hover:bg-koma-raised',
                        'disabled:cursor-not-allowed',
                        'disabled:opacity-25',
                        'sm:flex',
                      )}
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
                    className={clsx(
                      'flex',
                      'min-w-0',
                      'flex-1',
                      'cursor-grab',
                      'select-none',
                      'items-center',
                      'gap-1.5',
                      'overflow-x-auto',
                      'pb-0.5',
                      'active:cursor-grabbing',
                      '[scrollbar-width:none]',
                      '[&::-webkit-scrollbar]:hidden',
                    )}
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
                      Todos <span className={clsx('ml-1', 'opacity-75')}>{sellableProducts.length}</span>
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
                      className={clsx(
                        'hidden',
                        'size-8',
                        'shrink-0',
                        'items-center',
                        'justify-center',
                        'rounded-lg',
                        'border',
                        'border-koma-border',
                        'bg-koma-panel',
                        'text-koma-muted',
                        'hover:text-koma-foreground',
                        'hover:bg-koma-raised',
                        'disabled:cursor-not-allowed',
                        'disabled:opacity-25',
                        'sm:flex',
                      )}
                    >
                      <ChevronRight size={15} />
                    </button>
                  )}
                </div>
              </div>

              <div className={clsx('flex-1', 'min-h-0', 'overflow-y-auto', 'pr-1', 'overscroll-contain')}>
                {filteredProducts.length > 0 ? (
                  <div
                    className={clsx(
                      'grid',
                      'grid-cols-2',
                      'sm:grid-cols-2',
                      'md:grid-cols-3',
                      '2xl:grid-cols-4',
                      'gap-2',
                      'sm:gap-2.5',
                      'pb-2',
                    )}
                  >
                    {filteredProducts.map((p) => {
                      const productLabel = splitProductLabel(p.nome);
                      const productDetailKey = String(p.id);
                      const hasProductDetails = Boolean(p.descricao || productLabel.code);
                      return (
                        <div
                          key={p.id}
                          className={clsx(
                            'group',
                            'relative',
                            'min-h-[96px]',
                            'sm:min-h-[112px]',
                            'bg-koma-panel',
                            'border',
                            'border-koma-border',
                            'hover:border-emerald-500/60',
                            'rounded-xl',
                            'sm:rounded-2xl',
                            'transition-colors',
                            'shadow-sm',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setPdvProductDetailId(null);
                              handlePdvAddToCart(p);
                            }}
                            className={clsx(
                              'flex',
                              'h-full',
                              'w-full',
                              'flex-col',
                              'justify-between',
                              'gap-2',
                              'sm:gap-3',
                              'p-2.5',
                              'sm:p-3.5',
                              'text-left',
                              'cursor-pointer',
                              'rounded-xl',
                              'sm:rounded-2xl',
                              'focus:outline-none',
                              'focus-visible:ring-2',
                              'focus-visible:ring-emerald-500/40',
                            )}
                            title={
                              hasProductDetails
                                ? `Adicionar ${productLabel.name}. Use detalhes para ver ingredientes.`
                                : `Adicionar ${productLabel.name}`
                            }
                          >
                            {p.imagem && (
                              <img
                                src={p.imagem}
                                alt=""
                                loading="lazy"
                                className={clsx(
                                  'w-full',
                                  'h-16',
                                  'sm:h-20',
                                  'object-cover',
                                  'rounded-lg',
                                  'sm:rounded-xl',
                                )}
                              />
                            )}
                            <div className="min-h-[28px] sm:min-h-[34px] pr-6">
                              <h4
                                className={clsx(
                                  'font-semibold',
                                  'text-koma-foreground',
                                  'text-xs',
                                  'sm:text-[13px]',
                                  'leading-snug',
                                  'line-clamp-2',
                                )}
                              >
                                {productLabel.name}
                              </h4>
                            </div>
                            <div
                              className={clsx(
                                'flex',
                                'justify-between',
                                'items-center',
                                'border-t',
                                'border-koma-border',
                                'pt-2',
                                'sm:pt-2.5',
                              )}
                            >
                              <span
                                className={clsx(
                                  'font-bold',
                                  'text-emerald-700 dark:text-emerald-400',
                                  'font-mono',
                                  'text-xs',
                                )}
                              >
                                R$ {p.preco.toFixed(2).replace('.', ',')}
                              </span>
                              <span
                                className={clsx(
                                  'inline-flex',
                                  'items-center',
                                  'gap-1',
                                  'text-[9px]',
                                  'font-bold',
                                  'text-emerald-700 dark:text-[#4fe0bc]',
                                )}
                              >
                                <Plus size={13} /> <span className="hidden min-[380px]:inline">Adicionar</span>
                              </span>
                            </div>
                          </button>

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
                                className={clsx(
                                  'absolute',
                                  'right-2',
                                  'top-2',
                                  'z-20',
                                  'flex',
                                  'size-7',
                                  'items-center',
                                  'justify-center',
                                  'rounded-lg',
                                  'border',
                                  'border-koma-border',
                                  'bg-koma-card/95',
                                  'text-koma-muted',
                                  'hover:border-emerald-500/40',
                                  'hover:text-emerald-700',
                                  'dark:hover:text-emerald-300',
                                )}
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
                                  className={clsx(
                                    'block',
                                    'text-[8px]',
                                    'font-bold',
                                    'uppercase',
                                    'tracking-wider',
                                    'text-emerald-700 dark:text-emerald-300',
                                  )}
                                >
                                  Ingredientes e detalhes
                                </span>
                                {productLabel.code && (
                                  <span className={clsx('mt-1', 'block', 'font-mono', 'text-[8px]', 'text-koma-muted')}>
                                    Cód. {productLabel.code}
                                  </span>
                                )}
                                <p className={clsx('mt-1', 'text-[10px]', 'leading-relaxed', 'text-koma-secondary')}>
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
                    className={clsx(
                      'h-full',
                      'min-h-52',
                      'rounded-2xl',
                      'border',
                      'border-dashed',
                      'border-koma-border',
                      'bg-white/[0.015]',
                      'flex',
                      'flex-col',
                      'items-center',
                      'justify-center',
                      'text-center',
                      'px-6',
                    )}
                  >
                    <Search size={22} className={clsx('text-koma-muted', 'mb-3')} />
                    <strong className={clsx('text-sm', 'text-koma-secondary')}>
                      {catalogReady ? 'Nenhum item encontrado' : 'Carregando cardápio…'}
                    </strong>
                    <span className={clsx('mt-1', 'text-[10px]', 'text-koma-muted')}>
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

            {/* Shopping cart sidebar */}
            <div
              className={`w-full xl:w-[350px] 2xl:w-[380px] bg-koma-panel border border-koma-border rounded-2xl ${balcaoMobileView === 'carrinho' ? 'flex' : 'hidden xl:flex'} ${pdvCart.length === 0 ? 'xl:self-start' : ''} flex-col overflow-hidden shrink-0 shadow-sm`}
            >
              <div
                className={clsx(
                  'bg-koma-raised',
                  'px-4',
                  'py-3.5',
                  'border-b',
                  'border-koma-border',
                  'flex',
                  'justify-between',
                  'items-center',
                  'shrink-0',
                )}
              >
                <span className={clsx('font-semibold', 'text-koma-foreground', 'flex', 'items-center', 'gap-2')}>
                  <span
                    className={clsx(
                      'w-8',
                      'h-8',
                      'rounded-xl',
                      'bg-emerald-500/15',
                      'border',
                      'border-emerald-500/30',
                      'inline-flex',
                      'items-center',
                      'justify-center',
                    )}
                  >
                    <ShoppingCart size={15} className="text-emerald-700 dark:text-emerald-400" />
                  </span>
                  <span>Pedido atual</span>
                </span>
                <span
                  className={clsx(
                    'bg-emerald-500/15',
                    'border',
                    'border-emerald-500/30',
                    'text-emerald-800 dark:text-emerald-300',
                    'font-bold',
                    'px-2.5',
                    'py-1',
                    'rounded-full',
                    'font-mono',
                    'text-[9px]',
                  )}
                >
                  {pdvCartItemCount} itens
                </span>
              </div>

              <div className={clsx('flex-1', 'overflow-y-auto', 'p-3', 'space-y-2')}>
                {pdvCart.length === 0 ? (
                  <div
                    className={clsx(
                      'h-full',
                      'min-h-44',
                      'flex',
                      'flex-col',
                      'items-center',
                      'justify-center',
                      'text-center',
                      'px-6',
                      'text-koma-muted',
                    )}
                  >
                    <ShoppingCart size={22} className={clsx('mb-3', 'opacity-60')} />
                    <p className={clsx('text-xs', 'font-semibold', 'text-koma-subtle')}>Comece escolhendo um item</p>
                    <p className={clsx('text-[9px]', 'mt-1')}>Selecione um item para montar o pedido.</p>
                  </div>
                ) : (
                  pdvCart.map((item, idx) => (
                    <div
                      key={`${item.product.id}-${idx}`}
                      className={clsx(
                        'bg-white/[0.025]',
                        'p-3',
                        'rounded-xl',
                        'border',
                        'border-koma-border-subtle',
                        'space-y-2.5',
                      )}
                    >
                      <div className={clsx('flex', 'justify-between', 'items-start')}>
                        <div className="space-y-0.5">
                          <strong className={clsx('text-koma-foreground', 'text-xs', 'block', 'truncate', 'max-w-48')}>
                            {item.product.nome}
                          </strong>
                          <span className={clsx('text-[9px]', 'text-[#4fe0bc]', 'font-mono')}>
                            R$ {item.product.preco.toFixed(2).replace('.', ',')} / un.
                          </span>
                        </div>
                        <button
                          onClick={() => handlePdvRemoveCartItem(idx)}
                          className={clsx('text-koma-muted', 'hover:text-rose-500', 'p-0.5', 'cursor-pointer')}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>

                      <div className={clsx('flex', 'justify-between', 'items-center')}>
                        <div
                          className={clsx(
                            'flex',
                            'items-center',
                            'bg-koma-input',
                            'border',
                            'border-koma-border',
                            'rounded-lg',
                            'overflow-hidden',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => handlePdvUpdateCartQty(idx, -1)}
                            className={clsx(
                              'px-2',
                              'py-1',
                              'text-koma-subtle',
                              'hover:text-koma-foreground',
                              'cursor-pointer',
                              'hover:bg-koma-raised',
                            )}
                          >
                            -
                          </button>
                          <span
                            className={clsx('px-2', 'text-[10px]', 'font-bold', 'font-mono', 'text-koma-foreground')}
                          >
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => handlePdvUpdateCartQty(idx, 1)}
                            className={clsx(
                              'px-2',
                              'py-1',
                              'text-koma-subtle',
                              'hover:text-koma-foreground',
                              'cursor-pointer',
                              'hover:bg-koma-raised',
                            )}
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
                            setPdvCart((prev) => {
                              const c = [...prev];
                              c[idx].obs = val;
                              return c;
                            });
                          }}
                          className={clsx(
                            'w-24',
                            'px-1.5',
                            'py-1',
                            'text-[9px]',
                            'bg-koma-input',
                            'border',
                            'border-koma-border',
                            'rounded',
                            'focus:outline-none',
                            'focus:border-[#10b981]',
                            'text-koma-foreground',
                          )}
                        />
                      </div>

                      {/* Presets de Observação Dinâmicos do Terminal Balcão */}
                      {(() => {
                        const presets = getProductPresets(item.product);
                        if (presets.length === 0) return null;
                        const parts = item.obs ? item.obs.split(',').map((p) => p.trim()) : [];
                        return (
                          <div className={clsx('flex', 'flex-wrap', 'gap-1', 'mt-2', 'justify-end')}>
                            {presets.map((preset) => {
                              const isActive = parts.some((p) => p.toLowerCase() === preset.toLowerCase());
                              return (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() => {
                                    const currentParts = item.obs ? item.obs.split(',').map((p) => p.trim()) : [];
                                    const exists = currentParts.some((p) => p.toLowerCase() === preset.toLowerCase());
                                    const updatedParts = exists
                                      ? currentParts.filter((p) => p.toLowerCase() !== preset.toLowerCase() && p !== '')
                                      : [...currentParts.filter((p) => p !== ''), preset];

                                    const updatedObs = updatedParts.join(', ');
                                    setPdvCart((prev) => {
                                      const c = [...prev];
                                      c[idx].obs = updatedObs;
                                      return c;
                                    });
                                  }}
                                  className={`px-1.5 py-0.5 text-[8px] rounded border transition-colors cursor-pointer font-medium ${
                                    isActive
                                      ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
                                      : 'bg-koma-raised hover:bg-emerald-600/25 text-koma-subtle hover:text-white border-koma-border'
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

              {/* Subtotal e formulário de dados do cliente / modalidade */}
              <form
                onSubmit={handlePdvSubmitOrder}
                className={clsx('p-3', 'border-t', 'border-koma-border', 'space-y-3', 'bg-koma-panel/40', 'shrink-0')}
              >
                <div className="space-y-1.5">
                  <label
                    className={clsx(
                      'text-[8px]',
                      'text-koma-subtle',
                      'font-bold',
                      'uppercase',
                      'tracking-wider',
                      'block',
                    )}
                  >
                    Modalidade:
                  </label>
                  <div
                    className={clsx(
                      'grid',
                      'grid-cols-3',
                      'gap-1',
                      'bg-koma-input',
                      'p-1',
                      'rounded-xl',
                      'border',
                      'border-koma-border',
                    )}
                  >
                    {[
                      { id: 'retirada', label: 'Retirada / Viagem' },
                      { id: 'entrega', label: 'Delivery' },
                      { id: 'mesa', label: 'Mesa' },
                    ].map((type) => (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setPdvOrderType(type.id as any)}
                        className={`py-1.5 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer ${
                          pdvOrderType === type.id
                            ? 'bg-[#10b981] text-zinc-950 font-extrabold'
                            : 'text-koma-subtle hover:text-koma-foreground'
                        }`}
                      >
                        {type.id === 'retirada' ? 'Retirada' : type.id === 'entrega' ? 'Delivery' : 'Mesa'}
                      </button>
                    ))}
                  </div>
                  <details className="mt-1 text-left text-[9px] text-koma-muted">
                    <summary className="w-fit cursor-pointer list-none font-semibold hover:text-koma-secondary">
                      Ver atalhos de teclado
                    </summary>
                    <span className="mt-1 block font-mono">F2 Retirada · F3 Mesa · F8 Delivery · F4 Finalizar</span>
                  </details>
                </div>

                {pdvOrderType === 'mesa' && (
                  <div className="space-y-2">
                    <div className={clsx('flex', 'items-center', 'justify-between', 'gap-3')}>
                      <label
                        htmlFor="pdv-target-table"
                        className={clsx(
                          'block',
                          'text-[8px]',
                          'font-bold',
                          'uppercase',
                          'tracking-wider',
                          'text-koma-subtle',
                        )}
                      >
                        Mesa de destino
                      </label>
                      <span className={clsx('text-[8px]', 'text-koma-muted')}>
                        {pdvOccupiedTableCount} em atendimento
                      </span>
                    </div>
                    <select
                      id="pdv-target-table"
                      value={pdvTargetMesaId || ''}
                      onChange={(e) => setPdvTargetMesaId(Number(e.target.value) || 0)}
                      aria-describedby="pdv-table-selection-help"
                      data-table-status={
                        selectedPdvTableOption?.isOccupied ? 'occupied' : selectedPdvTableOption ? 'free' : 'unselected'
                      }
                      className={clsx(
                        'min-h-10 w-full rounded-xl border px-3 text-[10px] font-semibold text-koma-foreground outline-none transition-colors focus:ring-2',
                        selectedPdvTableOption?.isOccupied
                          ? 'border-[#6b2d37] bg-[#1b1013] focus:border-[#8a3d49] focus:ring-[#6b2d37]/20'
                          : 'border-koma-border bg-koma-input focus:border-[#00b894]/70 focus:ring-[#00b894]/10',
                      )}
                      required
                    >
                      <option value="">Selecione uma mesa</option>
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

                    <div
                      id="pdv-table-selection-help"
                      className={clsx(
                        'flex min-h-10 items-center gap-2.5 rounded-xl border px-3 py-2 text-left',
                        selectedPdvTableOption?.isOccupied
                          ? 'border-rose-300 dark:border-[#6b2d37]/80 bg-rose-50/90 dark:bg-[#261317]'
                          : 'border-koma-border bg-koma-input',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={clsx(
                          'h-2 w-2 shrink-0 rounded-full',
                          selectedPdvTableOption?.isOccupied
                            ? 'bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.2)]'
                            : selectedPdvTableOption
                              ? 'bg-emerald-500'
                              : 'bg-koma-muted',
                        )}
                      />
                      <div className="min-w-0">
                        <strong
                          className={clsx(
                            'block text-[9px] font-semibold',
                            selectedPdvTableOption?.isOccupied
                              ? 'text-rose-800 dark:text-[#e4a3ac]'
                              : 'text-koma-foreground',
                          )}
                        >
                          {!selectedPdvTableOption
                            ? 'Escolha onde este pedido será lançado'
                            : selectedPdvTableOption.isOccupied
                              ? `${selectedPdvTableOption.label} já está em atendimento`
                              : `${selectedPdvTableOption.label} está livre`}
                        </strong>
                        <span className={clsx('mt-0.5', 'block', 'text-[8px]', 'leading-relaxed', 'text-koma-muted')}>
                          {selectedPdvTableOption?.isOccupied
                            ? 'Você pode continuar: os novos itens serão adicionados ao atendimento da mesa.'
                            : selectedPdvTableOption
                              ? 'O primeiro lançamento abrirá o atendimento automaticamente.'
                              : 'Mesas ocupadas continuam disponíveis e aparecem identificadas na lista.'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {(pdvOrderType === 'retirada' || pdvOrderType === 'entrega') && (
                  <div className="space-y-2">
                    <div className={clsx('grid', 'grid-cols-2', 'gap-2')}>
                      <div className="space-y-1">
                        <label
                          className={clsx(
                            'text-[8px]',
                            'text-koma-subtle',
                            'font-bold',
                            'uppercase',
                            'tracking-wider',
                            'block',
                          )}
                        >
                          Telefone:
                        </label>
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
                          className={clsx(
                            'w-full',
                            'px-2',
                            'py-1.5',
                            'bg-koma-input',
                            'border',
                            'border-koma-border',
                            'rounded-lg',
                            'focus:outline-none',
                            'text-koma-foreground',
                            'text-[10px]',
                          )}
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          className={clsx(
                            'text-[8px]',
                            'text-koma-subtle',
                            'font-bold',
                            'uppercase',
                            'tracking-wider',
                            'block',
                          )}
                        >
                          Nome Cliente:
                        </label>
                        <input
                          id="pdv-customer-name-input"
                          type="text"
                          autoComplete="name"
                          placeholder="Ex: Maria"
                          required={pdvCart.length > 0}
                          value={pdvCustomerName}
                          onChange={(e) => setPdvCustomerName(e.target.value)}
                          className={clsx(
                            'w-full',
                            'px-2',
                            'py-1.5',
                            'bg-koma-input',
                            'border',
                            'border-koma-border',
                            'rounded-lg',
                            'focus:outline-none',
                            'text-koma-foreground',
                            'text-[10px]',
                          )}
                        />
                      </div>
                    </div>
                    {pdvCustomerLookup !== 'idle' && (
                      <p
                        className={clsx(
                          'text-[8px]',
                          'font-bold',
                          pdvCustomerLookup === 'found' ? 'text-emerald-400' : 'text-koma-muted',
                        )}
                      >
                        {pdvCustomerLookup === 'loading' && 'Buscando cliente...'}
                        {pdvCustomerLookup === 'found' &&
                          'Cliente encontrado — nome e endereço preenchidos automaticamente.'}
                        {pdvCustomerLookup === 'new' && 'Novo número — o cliente será criado ao lançar o pedido.'}
                      </p>
                    )}
                    {pdvOrderType === 'entrega' && (
                      <div className="space-y-1">
                        <label
                          className={clsx(
                            'text-[8px]',
                            'text-koma-subtle',
                            'font-bold',
                            'uppercase',
                            'tracking-wider',
                            'block',
                          )}
                        >
                          Endereço:
                        </label>
                        <input
                          type="text"
                          placeholder="Rua, Número, Bairro"
                          required
                          value={pdvDeliveryAddress}
                          onChange={(e) => setPdvDeliveryAddress(e.target.value)}
                          className={clsx(
                            'w-full',
                            'px-2',
                            'py-1.5',
                            'bg-koma-input',
                            'border',
                            'border-koma-border',
                            'rounded-lg',
                            'focus:outline-none',
                            'text-koma-foreground',
                            'text-[10px]',
                          )}
                        />
                      </div>
                    )}
                  </div>
                )}

                <div
                  className={clsx(
                    'flex',
                    'justify-between',
                    'items-center',
                    'font-mono',
                    'border-t',
                    'border-koma-border',
                    'pt-2',
                    'text-[11px]',
                    'font-bold',
                    'text-koma-foreground',
                  )}
                >
                  <span>Total Pedido:</span>
                  <span className={clsx('text-emerald-700 dark:text-emerald-400', 'text-sm')}>
                    {formatCurrency(pdvCart.reduce((sum, item) => sum + item.product.preco * item.quantity, 0))}
                  </span>
                </div>

                <button
                  id="pdv-submit-btn"
                  type="submit"
                  disabled={pdvCart.length === 0 || isLoading}
                  className={clsx(
                    'w-full',
                    'min-h-11',
                    'py-2',
                    'bg-[#00b894]',
                    'hover:bg-[#13c9a0]',
                    'text-[#06110d]',
                    'rounded-xl',
                    'border',
                    'border-transparent',
                    'font-bold',
                    'text-[10px]',
                    'uppercase',
                    'tracking-wider',
                    'transition-colors',
                    'cursor-pointer',
                    'flex',
                    'flex-col',
                    'items-center',
                    'justify-center',
                    'gap-0.5',
                    'disabled:cursor-not-allowed',
                    'disabled:border-[#272c29]',
                    'disabled:bg-koma-card',
                    'disabled:text-zinc-600',
                  )}
                >
                  <div className={clsx('flex', 'items-center', 'gap-1')}>
                    <Check size={12} />
                    <span>Lançar Pedido</span>
                  </div>
                  <span
                    className={clsx(
                      'text-[7.5px]',
                      'text-emerald-600 dark:text-emerald-300/80',
                      'font-mono',
                      'font-normal',
                    )}
                  >
                    Pressione [F4] para finalizar
                  </span>
                </button>
              </form>
            </div>

            {/* Floating Bottom Bar on Mobile when on Products tab */}
            {pdvCart.length > 0 && balcaoMobileView === 'produtos' && (
              <button
                type="button"
                onClick={() => setBalcaoMobileView('carrinho')}
                className={clsx(
                  'xl:hidden',
                  'fixed',
                  'bottom-4',
                  'left-4',
                  'right-4',
                  'z-40',
                  'py-3',
                  'px-5',
                  'bg-[#00b894]',
                  'hover:bg-[#13c9a0]',
                  'text-[#06110d]',
                  'font-bold',
                  'rounded-2xl',
                  'shadow-2xl',
                  'flex',
                  'items-center',
                  'justify-between',
                  'border',
                  'border-[#4fe0bc]/30',
                  'animate-fade-in',
                  'cursor-pointer',
                )}
              >
                <span className={clsx('text-xs', 'flex', 'items-center', 'gap-2')}>
                  <ShoppingCart size={16} />
                  <span>{pdvCartItemCount} itens no carrinho</span>
                </span>
                <span
                  className={clsx(
                    'text-xs',
                    'font-mono',
                    'font-extrabold',
                    'bg-black/30',
                    'px-3',
                    'py-1',
                    'rounded-xl',
                  )}
                >
                  {formatCurrency(pdvCart.reduce((sum, item) => sum + item.product.preco * item.quantity, 0))} →
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
