import {
  Ban,
  Check,
  ChefHat,
  Copy,
  Edit3,
  Eye,
  GlassWater,
  Gift,
  ImageIcon,
  Images,
  LayoutGrid,
  List,
  ListChecks,
  PackageOpen,
  PauseCircle,
  Pencil,
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
  onCreateCategory?: () => void;
  onEditProduct: (product: Product) => void;
  onDuplicateProduct: (product: Product) => void;
  onRemoveProduct: (product: Product) => Promise<void>;
  onToggleProduct: (product: Product, ativo: boolean) => Promise<void>;
  onToggleHighlight?: (product: Product, destaque: boolean) => Promise<void>;
  onQuickPriceUpdate?: (product: Product, novoPreco: number) => Promise<boolean>;
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

type StatusFilter = 'TODOS' | 'ATIVOS' | 'PAUSADOS' | 'DESTAQUES' | 'EM_PROMOCAO';
type MediaFilter = 'TODAS' | 'SEM_FOTO' | 'UMA_FOTO' | 'GALERIA';
type ViewMode = 'cards' | 'list';

const VIEW_MODE_STORAGE_KEY = 'koma_catalog_view_mode';

const statusFilterOptions: { value: StatusFilter; label: string }[] = [
  { value: 'TODOS', label: 'Todos' },
  { value: 'ATIVOS', label: 'Ativos' },
  { value: 'PAUSADOS', label: 'Pausados' },
  { value: 'DESTAQUES', label: 'Destaques' },
  { value: 'EM_PROMOCAO', label: 'Em promoção' },
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

function readStoredViewMode(): ViewMode {
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return raw === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parsePriceInput(raw: string): number | null {
  const normalized = raw.trim().replace(/\s+/g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

export function CardapioProdutosTab({
  produtos,
  categorias,
  catalogReady,
  previewUrl,
  onCreateProduct,
  onCreateCategory,
  onEditProduct,
  onDuplicateProduct,
  onRemoveProduct,
  onToggleProduct,
  onToggleHighlight,
  onQuickPriceUpdate,
  onSetCategoryAvailability,
  onBatchEdit,
  focusCategoryId,
  onFocusCategoryHandled,
  onOpenPromotions,
  familyLabels = {},
}: CardapioProdutosTabProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('TODAS');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('TODOS');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('TODAS');
  const [showPhotoFilters, setShowPhotoFilters] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [pendingBatchAction, setPendingBatchAction] = useState(false);
  const [pendingCategoryAction, setPendingCategoryAction] = useState(false);
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [pendingHighlightId, setPendingHighlightId] = useState<string | null>(null);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState('');
  const [savingPriceId, setSavingPriceId] = useState<string | null>(null);
  const [batchPriceAdjustment, setBatchPriceAdjustment] = useState('');
  const [batchCategoryId, setBatchCategoryId] = useState('');

  const handleViewModeChange = (next: ViewMode) => {
    setViewMode(next);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures in restricted contexts.
    }
  };

  useEffect(() => {
    if (!focusCategoryId) return;
    setSearch('');
    setStatusFilter('TODOS');
    setMediaFilter('TODAS');
    setCategoryFilter(focusCategoryId);
    onFocusCategoryHandled?.();
  }, [focusCategoryId, onFocusCategoryHandled]);

  const categoryStats = useMemo(() => {
    const stats = new Map<string, { total: number; available: number; paused: number }>();
    categorias.forEach((category) => stats.set(String(category.id), { total: 0, available: 0, paused: 0 }));
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

  const categoryScopedProducts = useMemo(() => {
    if (categoryFilter === 'TODAS') return produtos;
    return produtos.filter((product) => String(product.categoria_id) === categoryFilter);
  }, [categoryFilter, produtos]);

  const statusCounts = useMemo(() => {
    let active = 0;
    let paused = 0;
    let highlighted = 0;
    let discounted = 0;
    for (const product of categoryScopedProducts) {
      if (product.ativo !== false) active += 1;
      else paused += 1;
      if (product.destaque === true) highlighted += 1;
      if (getEffectiveProductPrice(product.preco, product.preco_promocional).hasDiscount) {
        discounted += 1;
      }
    }
    return {
      total: categoryScopedProducts.length,
      active,
      paused,
      highlighted,
      discounted,
    };
  }, [categoryScopedProducts]);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.trim();
    return categoryScopedProducts
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
        const isAvailable = product.ativo !== false;
        const hasPromoPrice = getEffectiveProductPrice(product.preco, product.preco_promocional).hasDiscount;
        const matchesStatus = statusFilter === 'TODOS'
          || (statusFilter === 'ATIVOS' && isAvailable)
          || (statusFilter === 'PAUSADOS' && !isAvailable)
          || (statusFilter === 'DESTAQUES' && product.destaque === true)
          || (statusFilter === 'EM_PROMOCAO' && hasPromoPrice);
        const mediaCount = productMediaCount(product);
        const matchesMedia = mediaFilter === 'TODAS'
          || (mediaFilter === 'SEM_FOTO' && mediaCount === 0)
          || (mediaFilter === 'UMA_FOTO' && mediaCount === 1)
          || (mediaFilter === 'GALERIA' && mediaCount >= 2);
        return matchesSearch && matchesStatus && matchesMedia;
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
  }, [categorias, categoryScopedProducts, familyLabels, mediaFilter, search, statusFilter]);

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

  const handleProductHighlight = async (product: Product) => {
    if (!onToggleHighlight || pendingHighlightId) return;
    setPendingHighlightId(product.id);
    try {
      await onToggleHighlight(product, product.destaque !== true);
    } finally {
      setPendingHighlightId(null);
    }
  };

  const startInlinePriceEdit = (product: Product) => {
    if (!onQuickPriceUpdate || selectionMode) return;
    setEditingPriceId(product.id);
    setEditingPriceValue(Number(product.preco || 0).toFixed(2).replace('.', ','));
  };

  const cancelInlinePriceEdit = () => {
    setEditingPriceId(null);
    setEditingPriceValue('');
  };

  const commitInlinePriceEdit = async (product: Product) => {
    if (!onQuickPriceUpdate || savingPriceId) return;
    const parsed = parsePriceInput(editingPriceValue);
    if (parsed === null) return;
    if (Math.abs(parsed - Number(product.preco || 0)) < 0.001) {
      cancelInlinePriceEdit();
      return;
    }
    setSavingPriceId(product.id);
    try {
      const saved = await onQuickPriceUpdate(product, parsed);
      if (saved) cancelInlinePriceEdit();
    } finally {
      setSavingPriceId(null);
    }
  };

  const renderInlinePrice = (product: Product) => {
    const priceInfo = getEffectiveProductPrice(product.preco, product.preco_promocional);
    const isEditing = editingPriceId === product.id;
    const isSaving = savingPriceId === product.id;
    const parsedDraft = parsePriceInput(editingPriceValue);

    if (isEditing && onQuickPriceUpdate) {
      return (
        <div className="flex items-center gap-1.5">
          <div className="relative w-28">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-koma-muted">
              R$
            </span>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={editingPriceValue}
              disabled={isSaving}
              aria-label={`Novo preço de ${product.nome}`}
              onChange={(event) => setEditingPriceValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void commitInlinePriceEdit(product);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelInlinePriceEdit();
                }
              }}
              className="min-h-11 w-full rounded-xl border border-koma-border-strong bg-koma-input pl-8 pr-2 text-sm font-bold text-koma-foreground tabular-nums outline-none"
            />
          </div>
          <button
            type="button"
            disabled={isSaving || parsedDraft === null}
            onClick={() => void commitInlinePriceEdit(product)}
            aria-label={`Salvar preço de ${product.nome}`}
            className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl transition disabled:opacity-40"
            style={{
              background: 'var(--koma-action-bg)',
              color: 'var(--koma-action-text)',
            }}
          >
            <Check size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={cancelInlinePriceEdit}
            aria-label="Cancelar edição de preço"
            className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-koma-secondary transition hover:text-koma-foreground disabled:opacity-40"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      );
    }

    const priceContent = priceInfo.hasDiscount && priceInfo.originalPrice != null ? (
      <span className="flex flex-wrap items-baseline gap-1.5 tabular-nums">
        <span className="text-xs text-koma-muted line-through">
          De {formatBRL(priceInfo.originalPrice)}
        </span>
        <span className="text-sm font-bold" style={{ color: 'var(--koma-success-text)' }}>
          Por {formatBRL(priceInfo.effectivePrice)}
        </span>
      </span>
    ) : (
      <span className="text-sm font-bold text-koma-foreground tabular-nums">
        {formatBRL(priceInfo.effectivePrice)}
      </span>
    );

    if (!onQuickPriceUpdate || selectionMode) {
      return <div className="inline-flex min-h-11 items-center">{priceContent}</div>;
    }

    return (
      <button
        type="button"
        onClick={() => startInlinePriceEdit(product)}
        title="Clique para editar o preço rapidamente"
        aria-label={`Editar preço de ${product.nome}: ${formatBRL(priceInfo.effectivePrice)}`}
        className="group inline-flex min-h-11 items-center gap-2 rounded-xl border border-transparent px-2 -ml-2 text-left transition hover:border-koma-border hover:bg-koma-raised"
      >
        {priceContent}
        <Pencil size={13} className="shrink-0 text-koma-muted opacity-60 transition group-hover:opacity-100" aria-hidden="true" />
      </button>
    );
  };

  const renderAvailabilitySwitch = (product: Product) => {
    const isAvailable = product.ativo !== false;
    const isBusy = pendingProductId === product.id || pendingBatchAction || pendingCategoryAction;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={isAvailable}
        aria-label={`${isAvailable ? 'Pausar' : 'Ativar'} ${product.nome}`}
        title={isAvailable ? 'Pausar venda' : 'Voltar a vender'}
        disabled={isBusy}
        onClick={() => void handleProductAvailability(product)}
        className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-koma-border bg-koma-panel px-2.5 text-xs font-semibold text-koma-foreground transition hover:border-koma-border-strong disabled:opacity-50"
      >
        <span
          className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors"
          style={
            isAvailable
              ? { background: 'var(--koma-action-bg)', borderColor: 'var(--koma-action-bg)' }
              : { background: 'var(--koma-surface-raised)', borderColor: 'var(--koma-border-strong)' }
          }
          aria-hidden="true"
        >
          <span
            className={clsx(
              'inline-block h-3.5 w-3.5 rounded-full transition-transform',
              isAvailable ? 'translate-x-4' : 'translate-x-0.5',
            )}
            style={{ background: 'var(--koma-surface-card)' }}
          />
        </span>
        <span
          className="text-xs font-semibold"
          style={{ color: isAvailable ? 'var(--koma-success-text)' : 'var(--koma-danger-text)' }}
        >
          {pendingProductId === product.id ? 'Salvando...' : isAvailable ? 'Ativo' : 'Pausado'}
        </span>
      </button>
    );
  };

  const renderHighlightButton = (product: Product) => {
    if (!onToggleHighlight) return null;
    const isHighlighted = product.destaque === true;
    const isBusy = pendingHighlightId === product.id;
    return (
      <button
        type="button"
        aria-pressed={isHighlighted}
        aria-label={isHighlighted ? `Remover destaque de ${product.nome}` : `Destacar ${product.nome}`}
        title={isHighlighted ? 'Remover destaque' : 'Marcar como destaque'}
        disabled={isBusy}
        onClick={() => void handleProductHighlight(product)}
        className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl border transition disabled:opacity-50"
        style={
          isHighlighted
            ? {
                background: 'var(--koma-warning-bg)',
                borderColor: 'var(--koma-warning-border)',
                color: 'var(--koma-warning-text)',
              }
            : {
                background: 'var(--koma-surface-raised)',
                borderColor: 'var(--koma-border-default)',
                color: 'var(--koma-text-muted)',
              }
        }
      >
        <Star size={16} fill={isHighlighted ? 'currentColor' : 'none'} aria-hidden="true" />
      </button>
    );
  };

  const renderProductBadges = (product: Product) => {
    const badgeLabel = getProductBadgeLabel(product.selo);
    const priceInfo = getEffectiveProductPrice(product.preco, product.preco_promocional);
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {product.somente_promocao && (
          <span
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold"
            style={{
              background: 'var(--koma-info-bg)',
              borderColor: 'var(--koma-info-border)',
              color: 'var(--koma-info-text)',
            }}
          >
            Só em promoções
          </span>
        )}
        {product.destaque && (
          <span
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold"
            style={{
              background: 'var(--koma-warning-bg)',
              borderColor: 'var(--koma-warning-border)',
              color: 'var(--koma-warning-text)',
            }}
          >
            <Star size={12} fill="currentColor" aria-hidden="true" /> Destaque
          </span>
        )}
        {badgeLabel && (
          <span
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold"
            style={{
              background: 'var(--koma-surface-raised)',
              borderColor: 'var(--koma-border-strong)',
              color: 'var(--koma-text-primary)',
            }}
          >
            <Tag size={12} aria-hidden="true" /> {badgeLabel}
          </span>
        )}
        {priceInfo.hasDiscount && priceInfo.discountPercent != null && (
          <span
            className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums"
            style={{
              background: 'var(--koma-success-bg)',
              borderColor: 'var(--koma-success-border)',
              color: 'var(--koma-success-text)',
            }}
          >
            -{priceInfo.discountPercent}%
          </span>
        )}
      </div>
    );
  };

  if (!catalogReady && produtos.length === 0) {
    return (
      <div className="grid min-h-64 place-items-center rounded-2xl border border-koma-border bg-koma-panel text-xs font-bold uppercase tracking-widest text-koma-muted">
        Carregando catálogo...
      </div>
    );
  }

  return (
    <div className="cardapio-products-mobile grid grid-cols-1 gap-4 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:items-start">
      <aside className="cardapio-products-categories rounded-2xl border border-koma-border bg-koma-panel p-2.5 lg:sticky lg:top-4">
        <div className="mb-2 hidden items-center justify-between px-1.5 lg:flex">
          <h2
            className="text-xs font-bold uppercase tracking-wider text-koma-muted"
            style={{ fontFamily: 'var(--koma-font-display)' }}
          >
            Categorias
          </h2>
          <span className="text-xs font-semibold text-koma-muted tabular-nums">
            {categorias.length}
          </span>
        </div>

        <div
          className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin] lg:max-h-[calc(100dvh-14rem)] lg:flex-col lg:items-stretch lg:overflow-x-visible lg:overflow-y-auto lg:pb-0"
          aria-label="Categorias do cardápio"
        >
          <button
            type="button"
            onClick={() => setCategoryFilter('TODAS')}
            aria-pressed={categoryFilter === 'TODAS'}
            className={clsx(
              'flex min-h-11 shrink-0 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors lg:w-full',
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
            <span className="flex min-w-0 items-center gap-2">
              <PackageOpen size={15} className="shrink-0" aria-hidden="true" />
              <span className="truncate font-bold">Todos</span>
            </span>
            <span className="shrink-0 text-xs font-semibold opacity-80 tabular-nums">
              {produtos.length}
            </span>
          </button>

          {categorias.map((category) => {
            const stats = categoryStats.get(String(category.id)) ?? { total: 0, available: 0, paused: 0 };
            const active = categoryFilter === String(category.id);
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setCategoryFilter(String(category.id))}
                aria-pressed={active}
                className={clsx(
                  'flex min-h-11 shrink-0 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors lg:w-full',
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
                <span className="min-w-0 max-w-40 truncate font-semibold lg:max-w-none">
                  {category.nome}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {stats.paused > 0 && (
                    <span
                      title={`${stats.paused} pausado${stats.paused === 1 ? '' : 's'}`}
                      className="inline-flex h-2 w-2 rounded-full"
                      style={{ background: 'var(--koma-danger-text)' }}
                    />
                  )}
                  <span className="text-xs font-semibold opacity-75 tabular-nums">
                    {stats.total}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {onCreateCategory && (
          <div className="mt-2 border-t border-koma-border pt-2">
            <button
              type="button"
              onClick={onCreateCategory}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-koma-border bg-koma-card px-3 text-xs font-semibold text-koma-secondary transition hover:border-koma-border-strong hover:bg-koma-raised hover:text-koma-foreground"
            >
              <Plus size={15} aria-hidden="true" />
              <span>Nova categoria</span>
            </button>
          </div>
        )}
      </aside>

      <div className="min-w-0 space-y-3">
        <section className="cardapio-products-toolbar rounded-2xl border border-koma-border bg-koma-panel p-3 space-y-3">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
            <label className="relative min-w-0 flex-1">
              <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar produto por nome, código ou descrição..."
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
              <div
                role="group"
                aria-label="Modo de visualização"
                className="inline-flex min-h-11 items-center rounded-xl border border-koma-border bg-koma-canvas p-1"
              >
                <button
                  type="button"
                  onClick={() => handleViewModeChange('cards')}
                  aria-pressed={viewMode === 'cards'}
                  className={clsx(
                    'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors',
                    viewMode === 'cards' ? 'font-bold' : 'text-koma-secondary hover:text-koma-foreground',
                  )}
                  style={
                    viewMode === 'cards'
                      ? {
                          background: 'var(--kc-chrome-selected, var(--koma-surface-card))',
                          color: 'var(--kc-chrome-on-selected, var(--koma-text-primary))',
                        }
                      : undefined
                  }
                >
                  <LayoutGrid size={14} aria-hidden="true" />
                  <span>Cards</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewModeChange('list')}
                  aria-pressed={viewMode === 'list'}
                  className={clsx(
                    'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors',
                    viewMode === 'list' ? 'font-bold' : 'text-koma-secondary hover:text-koma-foreground',
                  )}
                  style={
                    viewMode === 'list'
                      ? {
                          background: 'var(--kc-chrome-selected, var(--koma-surface-card))',
                          color: 'var(--kc-chrome-on-selected, var(--koma-text-primary))',
                        }
                      : undefined
                  }
                >
                  <List size={14} aria-hidden="true" />
                  <span>Lista</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  cancelInlinePriceEdit();
                  if (selectionMode) leaveSelectionMode();
                  else setSelectionMode(true);
                }}
                className="cardapio-products-select inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition"
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
                {selectionMode ? <X size={15} /> : <ListChecks size={15} />}
                {selectionMode ? 'Cancelar seleção' : 'Selecionar produtos'}
              </button>

              {previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="cardapio-products-preview inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-card px-3.5 text-xs font-semibold text-koma-foreground transition hover:bg-koma-raised"
                >
                  <Eye size={15} /> Ver cardápio
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
                <Plus size={16} /> Novo produto
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-koma-border pt-3">
            <div
              className="flex flex-wrap items-center gap-1 rounded-xl border border-koma-border bg-koma-canvas p-1"
              role="group"
              aria-label="Filtrar por disponibilidade"
            >
              {statusFilterOptions.map((option) => {
                const count = option.value === 'TODOS'
                  ? statusCounts.total
                  : option.value === 'ATIVOS'
                    ? statusCounts.active
                    : option.value === 'PAUSADOS'
                      ? statusCounts.paused
                      : option.value === 'DESTAQUES'
                        ? statusCounts.highlighted
                        : statusCounts.discounted;
                const isActive = statusFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatusFilter(option.value)}
                    aria-pressed={isActive}
                    className={clsx(
                      'min-h-9 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors',
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
                    {option.label}{' '}
                    <span className="ml-0.5 opacity-75 tabular-nums">{count}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setShowPhotoFilters((current) => !current)}
              title={`${mediaCoverage}% dos produtos têm foto`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition"
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
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span>Fotos</span>
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
            <div
              className="flex flex-wrap items-center gap-2 rounded-xl border border-koma-border bg-koma-canvas p-2"
              aria-label="Filtrar por fotos do produto"
            >
              <span className="px-1 text-xs font-bold text-koma-muted">Fotos:</span>
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
                    {option.label} <span className="ml-1 opacity-75 tabular-nums">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {selectedCategory && selectedCategoryStats && selectedRoute && SelectedRouteIcon && (
          <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-koma-border bg-koma-panel px-3 py-2">
            <div className="flex min-w-0 items-center gap-2 text-xs text-koma-muted">
              <SelectedRouteIcon size={15} className="shrink-0" style={{ color: 'var(--koma-success-text)' }} />
              <strong
                className="truncate text-sm text-koma-foreground"
                style={{ fontFamily: 'var(--koma-font-display)' }}
              >
                {selectedCategory.nome}
              </strong>
              <span className="tabular-nums">
                · {selectedCategoryStats.available} de {selectedCategoryStats.total} ativos · {selectedRoute.label}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedCategoryStats.paused > 0 && (
                <button
                  type="button"
                  onClick={() => void applyCategoryAvailability(true)}
                  disabled={pendingCategoryAction}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold disabled:opacity-50"
                  style={{
                    background: 'var(--koma-success-bg)',
                    borderColor: 'var(--koma-success-border)',
                    color: 'var(--koma-success-text)',
                  }}
                >
                  <PlayCircle size={14} /> Voltar todos
                </button>
              )}
              {selectedCategoryStats.available > 0 && (
                <button
                  type="button"
                  onClick={() => void applyCategoryAvailability(false)}
                  disabled={pendingCategoryAction}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold disabled:opacity-50"
                  style={{
                    background: 'var(--koma-danger-bg)',
                    borderColor: 'var(--koma-danger-border)',
                    color: 'var(--koma-danger-text)',
                  }}
                >
                  <PauseCircle size={14} /> Pausar categoria
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
                  className="text-sm font-bold text-koma-foreground tabular-nums"
                  style={{ fontFamily: 'var(--koma-font-display)' }}
                >
                  {selectedCount > 0
                    ? `${selectedCount} produto${selectedCount === 1 ? '' : 's'} selecionado${selectedCount === 1 ? '' : 's'}`
                    : 'Selecione os produtos que deseja alterar'}
                </p>
                <p className="text-xs text-koma-secondary">
                  Marque os itens abaixo para pausar, reajustar preço ou mover de categoria em lote.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={toggleAllVisible}
                  disabled={visibleIds.length === 0}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-koma-border bg-koma-card px-3 text-xs font-semibold text-koma-foreground disabled:opacity-40"
                >
                  <ListChecks size={14} />{' '}
                  {allVisibleSelected ? 'Desmarcar todos' : `Selecionar todos os ${filteredProducts.length}`}
                </button>
                <button
                  type="button"
                  onClick={leaveSelectionMode}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-koma-border bg-koma-card px-3 text-xs font-semibold text-koma-secondary hover:text-koma-foreground"
                >
                  <X size={14} /> Cancelar
                </button>
              </div>
            </div>

            {selectedCount > 0 && (
              <div className="mt-3 grid gap-2 border-t border-koma-border pt-3 xl:grid-cols-[auto_auto_minmax(14rem,1fr)_minmax(14rem,1fr)]">
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
            <div className="max-w-md space-y-2">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-koma-border bg-koma-raised text-koma-muted">
                <PackageOpen size={24} />
              </div>
              <h3
                className="text-base font-bold text-koma-foreground"
                style={{ fontFamily: 'var(--koma-font-display)' }}
              >
                Nenhum produto encontrado
              </h3>
              <p className="text-sm text-koma-muted">
                Ajuste a busca, troque a categoria ou limpe os filtros para ver o catálogo.
              </p>
            </div>
          </section>
        ) : (
          <section aria-label="Lista de produtos">
            <div
              className={
                viewMode === 'list'
                  ? 'flex flex-col gap-2'
                  : 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
              }
            >
              {displayProducts.map((product) => {
                const members = !selectionMode && product.familia_id
                  ? familyMembers.get(product.familia_id) || []
                  : [];

                if (members.length > 0 && product.familia_id) {
                  const availableMembers = members.filter((item) => item.ativo !== false);
                  const basePrices = (availableMembers.length ? availableMembers : members)
                    .map((item) => Number(item.preco));
                  const lowestPrice = Math.min(...basePrices);
                  const highestPrice = Math.max(...basePrices);
                  const familyName = familyLabels[product.familia_id] || 'Produto com variações';
                  return (
                    <article
                      key={`family-${product.familia_id}`}
                      data-family-id={product.familia_id}
                      className="flex flex-col gap-3 rounded-2xl border border-koma-border bg-koma-card p-3.5 transition hover:border-koma-border-strong"
                    >
                      <div className="flex items-start gap-3">
                        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-koma-border bg-koma-raised text-koma-muted">
                          {product.imagem ? (
                            <img src={product.imagem} alt="" width={48} height={48} className="h-full w-full object-cover" />
                          ) : (
                            <Images size={18} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3
                            className="text-sm font-bold text-koma-foreground"
                            style={{ fontFamily: 'var(--koma-font-display)' }}
                          >
                            {familyName}
                          </h3>
                          <p className="mt-0.5 text-xs text-koma-muted tabular-nums">
                            {members.length} {members.length === 1 ? 'opção' : 'opções'} · {availableMembers.length} à venda
                          </p>
                        </div>
                        <span
                          className="shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                          style={{
                            background: 'var(--koma-success-bg)',
                            borderColor: 'var(--koma-success-border)',
                            color: 'var(--koma-success-text)',
                          }}
                        >
                          Variações
                        </span>
                      </div>

                      <div className="space-y-1.5 rounded-xl border border-koma-border bg-koma-panel p-2.5">
                        {members.map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                            <span
                              className={clsx(
                                'min-w-0 truncate',
                                item.ativo === false ? 'text-koma-muted line-through' : 'text-koma-secondary',
                              )}
                            >
                              {item.variacao_rotulo || item.nome}
                              {item.ativo === false ? ' · Pausado' : ''}
                            </span>
                            <span className="shrink-0 font-bold text-koma-foreground tabular-nums">
                              {formatBRL(Number(item.preco))}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-koma-border pt-3">
                        <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--koma-success-text)' }}>
                          {highestPrice > lowestPrice ? 'A partir de ' : ''}
                          {formatBRL(lowestPrice)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onEditProduct(product)}
                          aria-label={`Editar variações de ${familyName}`}
                          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3.5 text-xs font-semibold text-koma-foreground transition hover:bg-koma-panel"
                        >
                          <Edit3 size={14} /> Editar variações
                        </button>
                      </div>
                    </article>
                  );
                }

                const isAvailable = product.ativo !== false;
                const isSelected = selectedProductIds.has(product.id);
                const categoryName = categorias.find(
                  (category) => String(category.id) === String(product.categoria_id),
                )?.nome || product.categoria;

                if (viewMode === 'list') {
                  return (
                    <article
                      key={product.id}
                      className={clsx(
                        'flex flex-col gap-3 rounded-2xl border p-3 transition md:flex-row md:items-center md:justify-between',
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
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        {selectionMode && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleProductSelection(product.id)}
                            aria-label={`Selecionar ${product.nome}`}
                            className="h-5 w-5 shrink-0 rounded border-koma-border accent-[var(--koma-action-bg)]"
                          />
                        )}
                        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-koma-border bg-koma-raised text-koma-muted">
                          {product.imagem ? (
                            <img
                              src={product.imagem}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              width={48}
                              height={48}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <ImageIcon size={18} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3
                              className="truncate text-sm font-bold text-koma-foreground"
                              style={{ fontFamily: 'var(--koma-font-display)' }}
                            >
                              {product.nome}
                            </h3>
                            {categoryFilter === 'TODAS' && categoryName && (
                              <span className="truncate rounded-full border border-koma-border bg-koma-raised px-2 py-0.5 text-xs text-koma-secondary">
                                {categoryName}
                              </span>
                            )}
                          </div>
                          {product.descricao && (
                            <p className="line-clamp-1 text-xs text-koma-muted">{product.descricao}</p>
                          )}
                          {renderProductBadges(product)}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-koma-border pt-2.5 md:justify-end md:border-t-0 md:pt-0">
                        <div className="shrink-0">{renderInlinePrice(product)}</div>
                        {!selectionMode && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {renderHighlightButton(product)}
                            {renderAvailabilitySwitch(product)}
                            <button
                              type="button"
                              onClick={() => onEditProduct(product)}
                              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3 text-xs font-semibold text-koma-foreground transition hover:bg-koma-panel"
                            >
                              <Edit3 size={14} /> Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => onDuplicateProduct(product)}
                              aria-label={`Duplicar ${product.nome}`}
                              title="Duplicar"
                              className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-koma-border bg-koma-raised text-koma-secondary transition hover:bg-koma-panel hover:text-koma-foreground"
                            >
                              <Copy size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void onRemoveProduct(product)}
                              aria-label={`Excluir ${product.nome}`}
                              title="Excluir"
                              className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-koma-border bg-koma-raised transition hover:bg-koma-panel"
                              style={{ color: 'var(--koma-danger-text)' }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                }

                return (
                  <article
                    key={product.id}
                    className={clsx(
                      'flex flex-col gap-3 rounded-2xl border p-3.5 transition',
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
                          className="mt-1 h-5 w-5 shrink-0 rounded border-koma-border accent-[var(--koma-action-bg)]"
                        />
                      )}
                      <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-koma-border bg-koma-raised text-koma-muted">
                        {product.imagem ? (
                          <img
                            src={product.imagem}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            width={56}
                            height={56}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <ImageIcon size={20} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <h3
                          className="line-clamp-2 text-sm font-bold leading-snug text-koma-foreground"
                          style={{ fontFamily: 'var(--koma-font-display)' }}
                        >
                          {product.nome}
                        </h3>
                        {categoryFilter === 'TODAS' && categoryName && (
                          <p className="truncate text-xs text-koma-muted">{categoryName}</p>
                        )}
                      </div>
                      {!selectionMode && renderHighlightButton(product)}
                    </div>

                    {product.descricao && (
                      <p className="line-clamp-2 text-xs leading-relaxed text-koma-secondary">
                        {product.descricao}
                      </p>
                    )}

                    {renderProductBadges(product)}

                    <div className="mt-auto space-y-2.5 border-t border-koma-border pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {renderInlinePrice(product)}
                        {!selectionMode && renderAvailabilitySwitch(product)}
                      </div>

                      {!selectionMode && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onEditProduct(product)}
                            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3 text-xs font-semibold text-koma-foreground transition hover:bg-koma-panel"
                          >
                            <Edit3 size={14} /> Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => onDuplicateProduct(product)}
                            aria-label={`Duplicar ${product.nome}`}
                            title="Duplicar"
                            className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-koma-secondary transition hover:bg-koma-panel hover:text-koma-foreground"
                          >
                            <Copy size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onRemoveProduct(product)}
                            aria-label={`Excluir ${product.nome}`}
                            title="Excluir"
                            className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised transition hover:bg-koma-panel"
                            style={{ color: 'var(--koma-danger-text)' }}
                          >
                            <Trash2 size={15} />
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
    </div>
  );
}
