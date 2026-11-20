import {
  Ban,
  ChefHat,
  Copy,
  Edit3,
  Eye,
  GlassWater,
  Gift,
  ImageIcon,
  Images,
  Info,
  ListChecks,
  MoreHorizontal,
  PackageOpen,
  PauseCircle,
  Percent,
  PlayCircle,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import type { Product } from '../../types';
import type { CatalogCategory } from '../../catalog/catalog';
import { getEffectiveProductPrice, getProductBadgeLabel } from '../../domain/productMerchandising';
import { smartSearchMatch } from '../../domain';

interface CardapioProdutosTabProps {
  produtos: Product[];
  categorias: CatalogCategory[];
  catalogReady: boolean;
  previewUrl?: string;
  onCreateProduct: () => void;
  onEditProduct: (product: Product) => void;
  onDuplicateProduct: (product: Product) => void;
  onRemoveProduct: (product: Product) => Promise<void>;
  onToggleProduct: (product: Product, ativo: boolean) => Promise<void>;
  onSetCategoryAvailability: (productIds: string[], ativo: boolean) => Promise<void>;
  onBatchEdit: (
    productIds: string[],
    update: { reajuste_percentual?: number; categoria_id?: string },
  ) => Promise<boolean>;
  focusCategoryId?: string | null;
  onFocusCategoryHandled?: () => void;
  onOpenPromotions?: () => void;
  /** Names returned by the existing /produto-familias API. No SKU name parsing. */
  familyLabels?: Record<string, string>;
}

type AvailabilityFilter = 'TODOS' | 'DISPONIVEIS' | 'PAUSADOS';
type ShowcaseFilter = 'TODOS' | 'DESTAQUES' | 'EM_PROMOCAO';
type MediaFilter = 'TODAS' | 'SEM_FOTO' | 'UMA_FOTO' | 'GALERIA';

const availabilityOptions: { value: AvailabilityFilter; label: string }[] = [
  { value: 'TODOS', label: 'Todos' },
  { value: 'DISPONIVEIS', label: 'Disponíveis' },
  { value: 'PAUSADOS', label: 'Pausados' },
];

const mediaOptions: { value: MediaFilter; label: string }[] = [
  { value: 'TODAS', label: 'Todas' },
  { value: 'SEM_FOTO', label: 'Sem foto' },
  { value: 'UMA_FOTO', label: '1 foto' },
  { value: 'GALERIA', label: '2–3 fotos' },
];

const routeMeta: Record<string, { label: string; icon: typeof ChefHat }> = {
  COZINHA: { label: 'Cozinha', icon: ChefHat },
  BAR: { label: 'Bar', icon: GlassWater },
  NENHUM: { label: 'Sem impressão', icon: Ban },
};

function productMediaCount(product: Product): number {
  const urls = [product.imagem, ...(product.imagens_galeria || [])]
    .map((url) => String(url || '').trim())
    .filter(Boolean);
  return new Set(urls).size;
}

export function CardapioProdutosTab({
  produtos,
  categorias,
  catalogReady,
  previewUrl,
  onCreateProduct,
  onEditProduct,
  onDuplicateProduct,
  onRemoveProduct,
  onToggleProduct,
  onSetCategoryAvailability,
  onBatchEdit,
  focusCategoryId,
  onFocusCategoryHandled,
  onOpenPromotions,
  familyLabels = {},
}: CardapioProdutosTabProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('TODAS');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('TODOS');
  const [showcaseFilter, setShowcaseFilter] = useState<ShowcaseFilter>('TODOS');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('TODAS');
  const [showPhotoFilters, setShowPhotoFilters] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [pendingBatchAction, setPendingBatchAction] = useState(false);
  const [pendingCategoryAction, setPendingCategoryAction] = useState(false);
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [productDetailId, setProductDetailId] = useState<string | null>(null);
  const [batchPriceAdjustment, setBatchPriceAdjustment] = useState('');
  const [batchCategoryId, setBatchCategoryId] = useState('');

  useEffect(() => {
    if (!focusCategoryId) return;
    setSearch('');
    setAvailabilityFilter('TODOS');
    setMediaFilter('TODAS');
    setCategoryFilter(focusCategoryId);
    onFocusCategoryHandled?.();
  }, [focusCategoryId, onFocusCategoryHandled]);

  const categoryStats = useMemo(() => {
    const stats = new Map<string, { total: number; available: number; paused: number }>();
    categorias.forEach((category) => stats.set(category.id, { total: 0, available: 0, paused: 0 }));
    produtos.forEach((product) => {
      const categoryId = String(product.categoria_id || '');
      if (!categoryId) return;
      const current = stats.get(categoryId) ?? { total: 0, available: 0, paused: 0 };
      current.total += 1;
      if (product.ativo !== false) current.available += 1;
      else current.paused += 1;
      stats.set(categoryId, current);
    });
    return stats;
  }, [categorias, produtos]);

  const mediaStats = useMemo(() => {
    return produtos.reduce(
      (stats, product) => {
        const count = productMediaCount(product);
        if (count === 0) stats.missing += 1;
        else if (count === 1) stats.single += 1;
        else stats.gallery += 1;
        return stats;
      },
      { missing: 0, single: 0, gallery: 0 },
    );
  }, [produtos]);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.trim();
    return produtos
      .filter((product) => {
        const categoryName = categorias.find(
          (category) => String(category.id) === String(product.categoria_id),
        )?.nome || product.categoria || '';
        const matchesSearch = !normalizedSearch
          || smartSearchMatch(product.nome, normalizedSearch)
          || smartSearchMatch(product.descricao || '', normalizedSearch)
          || smartSearchMatch(product.id, normalizedSearch)
          || smartSearchMatch(categoryName, normalizedSearch)
          || (product.familia_id != null
            && smartSearchMatch(familyLabels[product.familia_id] || '', normalizedSearch));
        const matchesCategory = categoryFilter === 'TODAS'
          || String(product.categoria_id) === categoryFilter;
        const isAvailable = product.ativo !== false;
        const matchesAvailability = availabilityFilter === 'TODOS'
          || (availabilityFilter === 'DISPONIVEIS' && isAvailable)
          || (availabilityFilter === 'PAUSADOS' && !isAvailable);
        const hasPromoPrice = getEffectiveProductPrice(product.preco, product.preco_promocional).hasDiscount;
        const matchesShowcase = showcaseFilter === 'TODOS'
          || (showcaseFilter === 'DESTAQUES' && product.destaque === true)
          || (showcaseFilter === 'EM_PROMOCAO' && hasPromoPrice);
        const mediaCount = productMediaCount(product);
        const matchesMedia = mediaFilter === 'TODAS'
          || (mediaFilter === 'SEM_FOTO' && mediaCount === 0)
          || (mediaFilter === 'UMA_FOTO' && mediaCount === 1)
          || (mediaFilter === 'GALERIA' && mediaCount >= 2);
        return matchesSearch && matchesCategory && matchesAvailability && matchesShowcase && matchesMedia;
      })
      .sort((a, b) => {
        const orderA = a.ordem_exibicao;
        const orderB = b.ordem_exibicao;
        if (orderA != null && orderB != null) {
          if (orderA !== orderB) return orderA - orderB;
        } else if (orderA != null) {
          return -1;
        } else if (orderB != null) {
          return 1;
        }
        return a.nome.localeCompare(b.nome, 'pt-BR');
      });
  }, [availabilityFilter, categorias, categoryFilter, familyLabels, mediaFilter, produtos, search, showcaseFilter]);

  // In normal editing mode, one family is one commercial card.
  // Selection/batch mode deliberately exposes real SKUs for individual operations.
  const familyMembers = useMemo(() => {
    const result = new Map<string, Product[]>();
    for (const product of produtos) {
      if (!product.familia_id) continue;
      const members = result.get(product.familia_id) || [];
      members.push(product);
      result.set(product.familia_id, members);
    }
    return result;
  }, [produtos]);
  const displayProducts = useMemo(() => {
    if (selectionMode) return filteredProducts;
    const familiesShown = new Set<string>();
    return filteredProducts.filter((product) => {
      if (!product.familia_id) return true;
      if (familiesShown.has(product.familia_id)) return false;
      familiesShown.add(product.familia_id);
      return true;
    });
  }, [filteredProducts, selectionMode]);

  const selectedCategory = categoryFilter === 'TODAS'
    ? null
    : categorias.find((category) => String(category.id) === categoryFilter) ?? null;
  const selectedCategoryStats = selectedCategory
    ? categoryStats.get(String(selectedCategory.id)) ?? { total: 0, available: 0, paused: 0 }
    : null;
  const selectedRoute = selectedCategory
    ? routeMeta[selectedCategory.destino_impressao || 'NENHUM'] ?? routeMeta.NENHUM
    : null;
  const SelectedRouteIcon = selectedRoute?.icon;
  const visibleIds = filteredProducts.map((product) => product.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedProductIds.has(id));
  const selectedCount = selectedProductIds.size;
  const activeCount = produtos.filter((product) => product.ativo !== false).length;
  const pausedCount = produtos.length - activeCount;
  const highlightedCount = produtos.filter((product) => product.destaque === true).length;
  const discountedCount = produtos.filter(
    (product) => getEffectiveProductPrice(product.preco, product.preco_promocional).hasDiscount,
  ).length;
  const productsWithMedia = mediaStats.single + mediaStats.gallery;
  const mediaCoverage = produtos.length > 0 ? Math.round((productsWithMedia / produtos.length) * 100) : 100;
  const parsedBatchPriceAdjustment = Number(batchPriceAdjustment.replace(',', '.'));
  const batchPriceAdjustmentValid = batchPriceAdjustment.trim() !== ''
    && Number.isFinite(parsedBatchPriceAdjustment)
    && parsedBatchPriceAdjustment >= -90
    && parsedBatchPriceAdjustment <= 500;

  useEffect(() => {
    const validProductIds = new Set(produtos.map((product) => String(product.id)));
    setSelectedProductIds((current) => {
      const next = new Set(Array.from(current).filter((id) => validProductIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [produtos]);

  const clearSelection = () => {
    setSelectedProductIds(new Set());
    setBatchPriceAdjustment('');
    setBatchCategoryId('');
  };

  const leaveSelectionMode = () => {
    clearSelection();
    setSelectionMode(false);
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const applyBatchAvailability = async (available: boolean) => {
    if (!selectedCount || pendingBatchAction) return;
    setPendingBatchAction(true);
    try {
      await onSetCategoryAvailability(Array.from(selectedProductIds), available);
      leaveSelectionMode();
    } finally {
      setPendingBatchAction(false);
    }
  };

  const applyBatchEdit = async (update: { reajuste_percentual?: number; categoria_id?: string }) => {
    if (!selectedCount || pendingBatchAction) return;
    setPendingBatchAction(true);
    try {
      const updated = await onBatchEdit(Array.from(selectedProductIds), update);
      if (updated) leaveSelectionMode();
    } finally {
      setPendingBatchAction(false);
    }
  };

  const applyCategoryAvailability = async (available: boolean) => {
    if (!selectedCategory || pendingCategoryAction) return;
    setPendingCategoryAction(true);
    try {
      const productIds = produtos
        .filter((product) => String(product.categoria_id) === String(selectedCategory.id))
        .map((product) => product.id);
      await onSetCategoryAvailability(productIds, available);
    } finally {
      setPendingCategoryAction(false);
    }
  };

  const handleProductAvailability = async (product: Product) => {
    if (pendingProductId) return;
    setPendingProductId(product.id);
    try {
      await onToggleProduct(product, product.ativo === false);
    } finally {
      setPendingProductId(null);
    }
  };

  if (!catalogReady && produtos.length === 0) {
    return (
      <div className="grid min-h-64 place-items-center rounded-2xl border border-koma-border bg-koma-panel text-xs font-bold uppercase tracking-widest text-koma-muted">
        Carregando catálogo...
      </div>
    );
  }

  return (
    <div className="cardapio-products-mobile space-y-3">
      <section className="cardapio-products-categories rounded-2xl border border-koma-border bg-koma-panel p-2">
        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:thin]" aria-label="Categorias do cardápio">
          <button
            type="button"
            onClick={() => setCategoryFilter('TODAS')}
            aria-pressed={categoryFilter === 'TODAS'}
            className={clsx(
              'flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-left text-xs transition-colors',
              categoryFilter === 'TODAS'
                ? 'border-transparent font-bold'
                : 'border-koma-border bg-koma-card text-koma-secondary hover:bg-koma-raised hover:text-koma-foreground',
            )}
            style={
              categoryFilter === 'TODAS'
                ? {
                    background: 'var(--kc-chrome-selected, var(--koma-action-bg))',
                    color: 'var(--kc-chrome-on-selected, var(--koma-action-text))',
                  }
                : undefined
            }
          >
            <PackageOpen size={16} aria-hidden="true" />
            <span className="font-bold">Todos</span>
            <span className="text-xs font-semibold opacity-75 tabular-nums">{produtos.length}</span>
          </button>
          {categorias.map((category) => {
            const stats = categoryStats.get(category.id) ?? { total: 0, available: 0, paused: 0 };
            const active = categoryFilter === String(category.id);
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setCategoryFilter(String(category.id))}
                aria-pressed={active}
                className={clsx(
                  'flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-left text-xs transition-colors',
                  active
                    ? 'border-transparent font-bold'
                    : 'border-koma-border bg-koma-card text-koma-secondary hover:bg-koma-raised hover:text-koma-foreground',
                )}
                style={
                  active
                    ? {
                        background: 'var(--kc-chrome-selected, var(--koma-action-bg))',
                        color: 'var(--kc-chrome-on-selected, var(--koma-action-text))',
                      }
                    : undefined
                }
              >
                <span className="max-w-48 truncate font-bold">{category.nome}</span>
                <span className="text-xs font-semibold opacity-70 tabular-nums">{stats.total}</span>
                {stats.paused > 0 && (
                  <span
                    className="rounded-full border px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                    style={{
                      background: 'var(--koma-danger-bg)',
                      borderColor: 'var(--koma-danger-border)',
                      color: 'var(--koma-danger-text)',
                    }}
                  >
                    {stats.paused} pausado{stats.paused === 1 ? '' : 's'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="cardapio-products-toolbar rounded-2xl border border-koma-border bg-koma-panel p-3">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <label className="relative min-w-0 flex-1">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar produto..."
              aria-label="Buscar produtos"
              className="h-11 w-full rounded-xl border border-koma-border bg-koma-input pl-10 pr-10 text-sm text-koma-foreground placeholder:text-koma-muted outline-none transition focus:border-koma-border-strong"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Limpar busca"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-koma-muted hover:text-koma-foreground"
              >
                <X size={16} />
              </button>
            )}
          </label>
          <div className="cardapio-products-actions flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setProductDetailId(null);
                if (selectionMode) leaveSelectionMode();
                else setSelectionMode(true);
              }}
              className="cardapio-products-select inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-semibold transition"
              style={
                selectionMode
                  ? {
                      background: 'var(--koma-surface-raised)',
                      borderColor: 'var(--koma-border-strong)',
                      color: 'var(--koma-text-primary)',
                    }
                  : {
                      background: 'var(--koma-surface-card)',
                      borderColor: 'var(--koma-border-default)',
                      color: 'var(--koma-text-primary)',
                    }
              }
            >
              {selectionMode ? <X size={16} /> : <ListChecks size={16} />}
              {selectionMode ? 'Cancelar seleção' : 'Selecionar produtos'}
            </button>
            {previewUrl && (
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="cardapio-products-preview inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-card px-4 text-xs font-semibold text-koma-foreground transition hover:bg-koma-raised"
              >
                <Eye size={16} /> Ver cardápio
              </a>
            )}
            <button
              type="button"
              onClick={onCreateProduct}
              className="cardapio-products-create inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold transition"
              style={{
                background: 'var(--koma-action-bg)',
                color: 'var(--koma-action-text)',
              }}
            >
              <Plus size={17} /> Novo produto
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-koma-border pt-3">
          <div className="inline-flex rounded-xl border border-koma-border bg-koma-canvas p-1" aria-label="Filtrar por disponibilidade">
            {availabilityOptions.map((option) => {
              const count = option.value === 'TODOS'
                ? produtos.length
                : option.value === 'DISPONIVEIS'
                  ? activeCount
                  : pausedCount;
              const isActive = availabilityFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAvailabilityFilter(option.value)}
                  aria-pressed={isActive}
                  className={clsx(
                    'min-h-9 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                    isActive
                      ? 'font-bold'
                      : 'text-koma-secondary hover:text-koma-foreground',
                  )}
                  style={
                    isActive
                      ? {
                          background: 'var(--kc-chrome-selected, var(--koma-surface-card))',
                          color: 'var(--kc-chrome-on-selected, var(--koma-text-primary))',
                        }
                      : undefined
                  }
                >
                  {option.label} <span className="ml-1 opacity-70 tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowcaseFilter((current) => (current === 'DESTAQUES' ? 'TODOS' : 'DESTAQUES'))}
            aria-pressed={showcaseFilter === 'DESTAQUES'}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition"
            style={
              showcaseFilter === 'DESTAQUES'
                ? {
                    background: 'var(--koma-info-bg)',
                    borderColor: 'var(--koma-info-border)',
                    color: 'var(--koma-info-text)',
                  }
                : {
                    background: 'var(--koma-surface-card)',
                    borderColor: 'var(--koma-border-default)',
                    color: 'var(--koma-text-secondary)',
                  }
            }
          >
            <Star size={14} aria-hidden="true" />
            <span>Destaques</span>
            <span className="text-[11px] opacity-75 tabular-nums">{highlightedCount}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowcaseFilter((current) => (current === 'EM_PROMOCAO' ? 'TODOS' : 'EM_PROMOCAO'))}
            aria-pressed={showcaseFilter === 'EM_PROMOCAO'}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition"
            style={
              showcaseFilter === 'EM_PROMOCAO'
                ? {
                    background: 'var(--koma-success-bg)',
                    borderColor: 'var(--koma-success-border)',
                    color: 'var(--koma-success-text)',
                  }
                : {
                    background: 'var(--koma-surface-card)',
                    borderColor: 'var(--koma-border-default)',
                    color: 'var(--koma-text-secondary)',
                  }
            }
          >
            <Percent size={14} aria-hidden="true" />
            <span>Em promoção</span>
            <span className="text-[11px] opacity-75 tabular-nums">{discountedCount}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowPhotoFilters((current) => !current)}
            title={`${mediaCoverage}% dos produtos têm foto`}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition"
            style={
              showPhotoFilters || mediaFilter !== 'TODAS'
                ? {
                    background: 'var(--koma-warning-bg)',
                    borderColor: 'var(--koma-warning-border)',
                    color: 'var(--koma-warning-text)',
                  }
                : {
                    background: 'var(--koma-surface-card)',
                    borderColor: 'var(--koma-border-default)',
                    color: 'var(--koma-text-secondary)',
                  }
            }
          >
            <SlidersHorizontal size={14} aria-hidden="true" /> Fotos
            {mediaFilter !== 'TODAS' && (
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--koma-warning-text)' }} />
            )}
          </button>

          {onOpenPromotions && (
            <button
              type="button"
              onClick={onOpenPromotions}
              className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-card px-3 text-xs font-semibold text-koma-foreground transition hover:bg-koma-raised"
            >
              <Gift size={14} aria-hidden="true" />
              <span>Promoções e vitrine</span>
            </button>
          )}
        </div>

        {showPhotoFilters && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-koma-border bg-koma-canvas p-2" aria-label="Filtrar por fotos do produto">
            <span className="px-1 text-[10px] font-bold uppercase tracking-wider text-koma-muted">Fotos</span>
            {mediaOptions.map((option) => {
              const count = option.value === 'TODAS'
                ? produtos.length
                : option.value === 'SEM_FOTO'
                  ? mediaStats.missing
                  : option.value === 'UMA_FOTO'
                    ? mediaStats.single
                    : mediaStats.gallery;
              const isActive = mediaFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMediaFilter(option.value)}
                  aria-pressed={isActive}
                  className={clsx(
                    'min-h-9 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                    isActive ? 'font-bold' : 'text-koma-secondary hover:text-koma-foreground',
                  )}
                  style={
                    isActive
                      ? {
                          background: 'var(--kc-chrome-selected, var(--koma-surface-card))',
                          color: 'var(--kc-chrome-on-selected, var(--koma-text-primary))',
                        }
                      : undefined
                  }
                >
                  {option.label} <span className="ml-1 opacity-70 tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selectedCategory && selectedCategoryStats && selectedRoute && SelectedRouteIcon && (
        <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-koma-border bg-koma-panel px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 text-xs text-koma-muted">
            <SelectedRouteIcon size={14} className="shrink-0" style={{ color: 'var(--koma-success-text)' }} />
            <strong className="truncate text-koma-foreground">{selectedCategory.nome}</strong>
            <span className="tabular-nums">· {selectedCategoryStats.available} de {selectedCategoryStats.total} à venda · {selectedRoute.label}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedCategoryStats.paused > 0 && (
              <button
                type="button"
                onClick={() => void applyCategoryAvailability(true)}
                disabled={pendingCategoryAction}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50"
                style={{
                  background: 'var(--koma-success-bg)',
                  borderColor: 'var(--koma-success-border)',
                  color: 'var(--koma-success-text)',
                }}
              >
                <PlayCircle size={13} /> Voltar todos
              </button>
            )}
            {selectedCategoryStats.available > 0 && (
              <button
                type="button"
                onClick={() => void applyCategoryAvailability(false)}
                disabled={pendingCategoryAction}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50"
                style={{
                  background: 'var(--koma-danger-bg)',
                  borderColor: 'var(--koma-danger-border)',
                  color: 'var(--koma-danger-text)',
                }}
              >
                <PauseCircle size={13} /> Pausar categoria
              </button>
            )}
          </div>
        </section>
      )}

      {selectionMode && (
        <section
          className="rounded-2xl border p-3"
          style={{
            background: 'var(--koma-success-bg)',
            borderColor: 'var(--koma-success-border)',
          }}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p
                className="font-bold text-koma-foreground tabular-nums"
                style={{ fontFamily: 'var(--koma-font-display)' }}
              >
                {selectedCount > 0
                  ? `${selectedCount} produto${selectedCount === 1 ? '' : 's'} selecionado${selectedCount === 1 ? '' : 's'}`
                  : 'Selecione os produtos que deseja alterar'}
              </p>
              <p className="text-xs text-koma-secondary">Marque os cards abaixo. As ações aparecem aqui, sem abrir produto por produto.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleAllVisible}
                disabled={visibleIds.length === 0}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-koma-border bg-koma-card px-3 text-xs font-semibold text-koma-foreground disabled:opacity-40"
              >
                <ListChecks size={14} /> {allVisibleSelected ? 'Desmarcar todos' : `Selecionar todos os ${filteredProducts.length}`}
              </button>
              <button
                type="button"
                onClick={leaveSelectionMode}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-koma-border bg-koma-card px-3 text-xs font-semibold text-koma-secondary hover:text-koma-foreground"
              >
                <X size={14} /> Cancelar
              </button>
            </div>
          </div>

          {selectedCount > 0 && (
            <div className="mt-3 grid gap-2 border-t border-koma-border pt-3 xl:grid-cols-[auto_auto_minmax(15rem,1fr)_minmax(15rem,1fr)]">
              <button
                type="button"
                onClick={() => void applyBatchAvailability(false)}
                disabled={pendingBatchAction}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-semibold disabled:opacity-50"
                style={{
                  background: 'var(--koma-danger-bg)',
                  borderColor: 'var(--koma-danger-border)',
                  color: 'var(--koma-danger-text)',
                }}
              >
                <PauseCircle size={15} /> Pausar
              </button>
              <button
                type="button"
                onClick={() => void applyBatchAvailability(true)}
                disabled={pendingBatchAction}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold disabled:opacity-50"
                style={{
                  background: 'var(--koma-action-bg)',
                  color: 'var(--koma-action-text)',
                }}
              >
                <PlayCircle size={15} /> Voltar a vender
              </button>

              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-koma-border bg-koma-card p-1.5">
                <input
                  type="number"
                  min={-90}
                  max={500}
                  step="0.1"
                  value={batchPriceAdjustment}
                  onChange={(event) => setBatchPriceAdjustment(event.target.value)}
                  placeholder="Reajuste em %"
                  aria-label="Reajuste percentual dos produtos selecionados"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-koma-border bg-koma-input px-3 text-xs font-semibold text-koma-foreground tabular-nums outline-none focus:border-koma-border-strong"
                />
                <button
                  type="button"
                  onClick={() => void applyBatchEdit({ reajuste_percentual: parsedBatchPriceAdjustment })}
                  disabled={pendingBatchAction || !batchPriceAdjustmentValid}
                  className="h-9 rounded-lg px-3 text-xs font-semibold disabled:opacity-40"
                  style={{
                    background: 'var(--koma-action-bg)',
                    color: 'var(--koma-action-text)',
                  }}
                >
                  Ajustar preço
                </button>
              </div>

              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-koma-border bg-koma-card p-1.5">
                <select
                  value={batchCategoryId}
                  onChange={(event) => setBatchCategoryId(event.target.value)}
                  aria-label="Nova categoria dos produtos selecionados"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-koma-border bg-koma-input px-3 text-xs font-semibold text-koma-foreground outline-none focus:border-koma-border-strong"
                >
                  <option value="">Mover para categoria...</option>
                  {categorias.map((category) => (
                    <option key={category.id} value={category.id}>{category.nome}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void applyBatchEdit({ categoria_id: batchCategoryId })}
                  disabled={pendingBatchAction || !batchCategoryId}
                  className="h-9 rounded-lg px-3 text-xs font-semibold disabled:opacity-40"
                  style={{
                    background: 'var(--koma-action-bg)',
                    color: 'var(--koma-action-text)',
                  }}
                >
                  Mover
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {filteredProducts.length === 0 ? (
        <section className="grid min-h-72 place-items-center rounded-2xl border border-koma-border bg-koma-panel p-8 text-center">
          <div className="max-w-md">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-koma-border bg-koma-raised text-koma-muted">
              <PackageOpen size={24} />
            </div>
            <h3
              className="text-lg font-bold text-koma-foreground"
              style={{ fontFamily: 'var(--koma-font-display)' }}
            >
              Nenhum produto encontrado
            </h3>
            <p className="mt-2 text-sm text-koma-muted">Ajuste a busca ou os filtros.</p>
          </div>
        </section>
      ) : (
        <section>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {displayProducts.map((product) => {
              const members = !selectionMode && product.familia_id
                ? familyMembers.get(product.familia_id) || [] : [];
              if (members.length > 0 && product.familia_id) {
                const availableMembers = members.filter((item) => item.ativo !== false);
                const basePrices = (availableMembers.length ? availableMembers : members)
                  .map((item) => Number(item.preco));
                const lowestPrice = Math.min(...basePrices);
                const highestPrice = Math.max(...basePrices);
                const familyName = familyLabels[product.familia_id] || 'Produto com variações';
                return (
                  <article key={`family-${product.familia_id}`}
                    data-family-id={product.familia_id}
                    className="flex min-h-40 flex-col gap-3 rounded-2xl border border-koma-border bg-koma-card p-3">
                    <div className="flex items-start gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-koma-border bg-koma-raised text-koma-muted">
                        {product.imagem ? <img src={product.imagem} alt="" width={44} height={44} className="h-full w-full object-cover" /> : <Images size={18} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3
                          className="text-sm font-bold text-koma-foreground"
                          style={{ fontFamily: 'var(--koma-font-display)' }}
                        >
                          {familyName}
                        </h3>
                        <p className="mt-1 text-[11px] text-koma-muted tabular-nums">
                          {members.length} {members.length === 1 ? 'opção' : 'opções'} · {availableMembers.length} à venda
                        </p>
                      </div>
                      <span
                        className="shrink-0 rounded-lg border px-2 py-1 text-[10px] font-semibold"
                        style={{
                          background: 'var(--koma-success-bg)',
                          borderColor: 'var(--koma-success-border)',
                          color: 'var(--koma-success-text)',
                        }}
                      >
                        Variações
                      </span>
                    </div>
                    <div className="space-y-1 rounded-xl border border-koma-border bg-koma-panel p-2">
                      {members.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className={clsx('min-w-0 truncate', item.ativo === false ? 'text-koma-muted line-through' : 'text-koma-secondary')}>
                            {item.variacao_rotulo || item.nome}
                            {item.ativo === false ? ' · Pausado' : ''}
                          </span>
                          <span className="shrink-0 font-bold text-koma-foreground tabular-nums">
                            {Number(item.preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-koma-border pt-3">
                      <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--koma-success-text)' }}>
                        {highestPrice > lowestPrice ? 'A partir de ' : ''}
                        {lowestPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                      <button type="button" onClick={() => onEditProduct(product)}
                        aria-label={`Editar variações de ${familyName}`}
                        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3 text-xs font-semibold text-koma-foreground transition hover:bg-koma-panel">
                        <Edit3 size={14} /> Editar variações
                      </button>
                    </div>
                  </article>
                );
              }
              const isAvailable = product.ativo !== false;
              const isSelected = selectedProductIds.has(product.id);
              const mediaCount = productMediaCount(product);
              const detailKey = String(product.id);
              const detailOpen = productDetailId === detailKey;
              const badgeLabel = getProductBadgeLabel(product.selo);
              const priceInfo = getEffectiveProductPrice(product.preco, product.preco_promocional);
              return (
                <article
                  key={product.id}
                  className={clsx(
                    'relative flex min-h-40 flex-col rounded-2xl border p-3 transition',
                    isAvailable
                      ? 'border-koma-border bg-koma-card hover:border-koma-border-strong'
                      : 'bg-koma-card',
                    isSelected && 'ring-2 ring-[color:var(--koma-focus-ring)]',
                  )}
                  style={
                    !isAvailable
                      ? {
                          background: 'var(--koma-danger-bg)',
                          borderColor: 'var(--koma-danger-border)',
                        }
                      : undefined
                  }
                >
                  <div className="flex items-start gap-3">
                    {selectionMode && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleProductSelection(product.id)}
                        aria-label={`Selecionar ${product.nome}`}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-koma-border accent-emerald-500"
                      />
                    )}
                    <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-koma-border bg-koma-raised text-koma-muted">
                      {product.imagem ? (
                        <img src={product.imagem} alt="" loading="lazy" decoding="async" width={44} height={44} className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon size={19} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pr-16">
                      <h3
                        className="line-clamp-2 text-sm font-bold text-koma-foreground"
                        style={{ fontFamily: 'var(--koma-font-display)' }}
                      >
                        {product.nome}
                      </h3>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {product.categoria && (
                          <span className="max-w-full truncate rounded-full border border-koma-border bg-koma-raised px-2 py-0.5 text-[10px] font-semibold text-koma-secondary">
                            {product.categoria}
                          </span>
                        )}
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                          style={
                            isAvailable
                              ? {
                                  background: 'var(--koma-success-bg)',
                                  borderColor: 'var(--koma-success-border)',
                                  color: 'var(--koma-success-text)',
                                }
                              : {
                                  background: 'var(--koma-danger-bg)',
                                  borderColor: 'var(--koma-danger-border)',
                                  color: 'var(--koma-danger-text)',
                                }
                          }
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: isAvailable ? 'var(--koma-success-text)' : 'var(--koma-danger-text)' }}
                          />
                          {isAvailable ? (product.somente_promocao ? 'Só em promoções' : 'À venda') : 'Pausado'}
                        </span>
                        {product.destaque && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                            style={{
                              background: 'var(--koma-info-bg)',
                              borderColor: 'var(--koma-info-border)',
                              color: 'var(--koma-info-text)',
                            }}
                          >
                            <Star size={10} aria-hidden="true" /> Destaque
                          </span>
                        )}
                        {badgeLabel && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                            style={{
                              background: 'var(--koma-warning-bg)',
                              borderColor: 'var(--koma-warning-border)',
                              color: 'var(--koma-warning-text)',
                            }}
                          >
                            <Tag size={10} aria-hidden="true" /> {badgeLabel}
                          </span>
                        )}
                      </div>
                    </div>

                    {!selectionMode && (
                      <>
                        <button
                          type="button"
                          onClick={() => setProductDetailId((current) => current === detailKey ? null : detailKey)}
                          aria-expanded={detailOpen}
                          aria-controls={`catalog-product-details-${detailKey}`}
                          aria-label={`${detailOpen ? 'Ocultar' : 'Ver'} detalhes de ${product.nome}`}
                          title={detailOpen ? 'Ocultar detalhes' : 'Ver detalhes'}
                          className="absolute right-11 top-3 z-20 grid h-8 w-8 place-items-center rounded-lg border border-koma-border bg-koma-raised text-koma-muted transition hover:text-koma-foreground"
                        >
                          <Info size={14} />
                        </button>
                        <details className="absolute right-3 top-3 z-30">
                          <summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-lg border border-koma-border bg-koma-raised text-koma-muted transition hover:text-koma-foreground" aria-label={`Mais ações para ${product.nome}`}>
                            <MoreHorizontal size={16} />
                          </summary>
                          <div className="absolute right-0 mt-2 w-40 rounded-xl border border-koma-border bg-koma-dialog p-1.5 shadow-xl">
                            <button type="button" onClick={() => onDuplicateProduct(product)} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-koma-foreground hover:bg-koma-raised">
                              <Copy size={14} /> Duplicar
                            </button>
                            <button
                              type="button"
                              onClick={() => void onRemoveProduct(product)}
                              className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold hover:bg-koma-raised"
                              style={{ color: 'var(--koma-danger-text)' }}
                            >
                              <Trash2 size={14} /> Excluir
                            </button>
                          </div>
                        </details>
                      </>
                    )}
                  </div>

                  {product.descricao && !detailOpen && (
                    <p className="mt-2 line-clamp-1 text-xs leading-4 text-koma-muted">
                      {product.descricao}
                    </p>
                  )}

                  {detailOpen && (
                    <div
                      id={`catalog-product-details-${detailKey}`}
                      role="note"
                      className="mt-3 rounded-xl border border-koma-border bg-koma-panel p-2.5 text-left"
                    >
                      <span
                        className="block text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: 'var(--koma-success-text)' }}
                      >
                        Detalhes do produto
                      </span>
                      <p className="mt-1 text-xs leading-relaxed text-koma-secondary">
                        {product.descricao || 'Sem descrição cadastrada.'}
                      </p>
                      <span className="mt-1.5 block font-mono text-[10px] text-koma-muted">
                        Cód. {product.id} · {mediaCount === 0 ? 'Sem foto' : `${mediaCount} foto${mediaCount === 1 ? '' : 's'}`}
                      </span>
                    </div>
                  )}

                  <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-koma-border pt-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-koma-muted">Preço</p>
                      {priceInfo.hasDiscount && priceInfo.originalPrice != null ? (
                        <div className="flex flex-wrap items-baseline gap-1.5 tabular-nums">
                          <span className="text-xs text-koma-muted line-through">
                            De {priceInfo.originalPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                          <span
                            className="text-base font-bold"
                            style={{ color: 'var(--koma-success-text)' }}
                          >
                            Por {priceInfo.effectivePrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                        </div>
                      ) : (
                        <p className="text-base font-bold text-koma-foreground tabular-nums">
                          {priceInfo.effectivePrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </p>
                      )}
                    </div>
                    {!selectionMode && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onEditProduct(product)}
                          title={mediaCount === 0 ? 'Editar fotos deste produto' : 'Editar produto'}
                          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3 text-xs font-semibold text-koma-foreground transition hover:bg-koma-panel"
                        >
                          <Edit3 size={14} /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleProductAvailability(product)}
                          disabled={pendingProductId === product.id || pendingBatchAction || pendingCategoryAction}
                          className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition disabled:opacity-60"
                          style={
                            isAvailable
                              ? {
                                  background: 'var(--koma-danger-bg)',
                                  borderColor: 'var(--koma-danger-border)',
                                  color: 'var(--koma-danger-text)',
                                }
                              : {
                                  background: 'var(--koma-action-bg)',
                                  borderColor: 'transparent',
                                  color: 'var(--koma-action-text)',
                                }
                          }
                        >
                          {isAvailable ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                          {pendingProductId === product.id ? 'Salvando...' : isAvailable ? 'Pausar venda' : 'Voltar a vender'}
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
