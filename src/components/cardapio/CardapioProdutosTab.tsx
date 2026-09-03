import {
  Ban,
  ChefHat,
  Copy,
  Edit3,
  Eye,
  GlassWater,
  ImageIcon,
  Images,
  Info,
  ListChecks,
  MoreHorizontal,
  PackageOpen,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import type { Product } from '../../types';
import type { CatalogCategory } from '../../catalog/catalog';
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
}

type AvailabilityFilter = 'TODOS' | 'DISPONIVEIS' | 'PAUSADOS';
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
}: CardapioProdutosTabProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('TODAS');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('TODOS');
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
          || smartSearchMatch(categoryName, normalizedSearch);
        const matchesCategory = categoryFilter === 'TODAS'
          || String(product.categoria_id) === categoryFilter;
        const isAvailable = product.ativo !== false;
        const matchesAvailability = availabilityFilter === 'TODOS'
          || (availabilityFilter === 'DISPONIVEIS' && isAvailable)
          || (availabilityFilter === 'PAUSADOS' && !isAvailable);
        const mediaCount = productMediaCount(product);
        const matchesMedia = mediaFilter === 'TODAS'
          || (mediaFilter === 'SEM_FOTO' && mediaCount === 0)
          || (mediaFilter === 'UMA_FOTO' && mediaCount === 1)
          || (mediaFilter === 'GALERIA' && mediaCount >= 2);
        return matchesSearch && matchesCategory && matchesAvailability && matchesMedia;
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [availabilityFilter, categorias, categoryFilter, mediaFilter, produtos, search]);

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
      <div className="grid min-h-64 place-items-center rounded-2xl border border-slate-200 bg-white text-xs font-black uppercase tracking-widest text-slate-500 dark:border-white/10 dark:bg-[#111713]">
        Carregando catálogo...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-white/10 dark:bg-[#111713]">
        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:thin]" aria-label="Categorias do cardápio">
          <button
            type="button"
            onClick={() => setCategoryFilter('TODAS')}
            aria-pressed={categoryFilter === 'TODAS'}
            className={clsx(
              'flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-left transition-colors',
              categoryFilter === 'TODAS'
                ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm dark:border-emerald-500/70 dark:bg-emerald-500/20 dark:text-emerald-200'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-emerald-300 dark:border-white/10 dark:bg-black/10 dark:text-slate-300 dark:hover:border-emerald-500/40',
            )}
          >
            <PackageOpen size={16} />
            <span className="font-black">Todos</span>
            <span className="text-xs font-bold opacity-70">{produtos.length}</span>
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
                  'flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-left transition-colors',
                  active
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900 shadow-sm dark:border-emerald-500/60 dark:bg-emerald-500/15 dark:text-emerald-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/50 dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:hover:border-emerald-500/40 dark:hover:bg-emerald-500/5',
                )}
              >
                <span className="max-w-48 truncate font-black">{category.nome}</span>
                <span className="text-xs font-bold opacity-60">{stats.total}</span>
                {stats.paused > 0 && (
                  <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                    {stats.paused} pausado{stats.paused === 1 ? '' : 's'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-[#111713]">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <label className="relative min-w-0 flex-1">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar produto..."
              aria-label="Buscar produtos"
              className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-10 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-white/15 dark:bg-black/20 dark:text-white"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Limpar busca"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <X size={16} />
              </button>
            )}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => (selectionMode ? leaveSelectionMode() : setSelectionMode(true))}
              className={clsx(
                'inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-black transition',
                selectionMode
                  ? 'border-slate-300 bg-slate-100 text-slate-700 dark:border-white/15 dark:bg-white/5 dark:text-slate-200'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/15 dark:text-emerald-300',
              )}
            >
              {selectionMode ? <X size={16} /> : <ListChecks size={16} />}
              {selectionMode ? 'Cancelar seleção' : 'Selecionar produtos'}
            </button>
            {previewUrl && (
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-xs font-black text-slate-800 transition hover:border-emerald-400 hover:text-emerald-700 dark:border-white/15 dark:text-white dark:hover:border-emerald-500/50 dark:hover:text-emerald-300"
              >
                <Eye size={16} /> Ver cardápio
              </a>
            )}
            <button
              type="button"
              onClick={onCreateProduct}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-500 bg-emerald-500 px-4 text-xs font-black text-emerald-950 transition hover:bg-emerald-400"
            >
              <Plus size={17} /> Novo produto
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-white/10">
          <div className="inline-flex rounded-xl border border-slate-300 bg-slate-100 p-1 dark:border-white/15 dark:bg-black/20" aria-label="Filtrar por disponibilidade">
            {availabilityOptions.map((option) => {
              const count = option.value === 'TODOS'
                ? produtos.length
                : option.value === 'DISPONIVEIS'
                  ? activeCount
                  : pausedCount;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAvailabilityFilter(option.value)}
                  aria-pressed={availabilityFilter === option.value}
                  className={clsx(
                    'rounded-lg px-3 py-2 text-xs font-black transition-colors',
                    availabilityFilter === option.value
                      ? 'bg-white text-emerald-700 shadow-sm dark:bg-emerald-500/15 dark:text-emerald-200'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                  )}
                >
                  {option.label} <span className="ml-1 font-mono opacity-60">{count}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowPhotoFilters((current) => !current)}
            title={`${mediaCoverage}% dos produtos têm foto`}
            className={clsx(
              'inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-black transition',
              showPhotoFilters || mediaFilter !== 'TODAS'
                ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
                : 'border-slate-300 text-slate-600 hover:border-slate-400 dark:border-white/15 dark:text-slate-400',
            )}
          >
            <SlidersHorizontal size={14} /> Fotos
            {mediaFilter !== 'TODAS' && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
          </button>
        </div>

        {showPhotoFilters && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-white/10 dark:bg-black/10" aria-label="Filtrar por fotos do produto">
            <span className="px-1 text-[10px] font-black uppercase tracking-wider text-slate-500">Fotos</span>
            {mediaOptions.map((option) => {
              const count = option.value === 'TODAS'
                ? produtos.length
                : option.value === 'SEM_FOTO'
                  ? mediaStats.missing
                  : option.value === 'UMA_FOTO'
                    ? mediaStats.single
                    : mediaStats.gallery;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMediaFilter(option.value)}
                  aria-pressed={mediaFilter === option.value}
                  className={clsx(
                    'rounded-lg px-3 py-2 text-xs font-black transition-colors',
                    mediaFilter === option.value
                      ? 'bg-white text-emerald-700 shadow-sm dark:bg-emerald-500/15 dark:text-emerald-200'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                  )}
                >
                  {option.label} <span className="ml-1 font-mono opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selectedCategory && selectedCategoryStats && selectedRoute && SelectedRouteIcon && (
        <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-white/10 dark:bg-[#111713]">
          <div className="flex min-w-0 items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <SelectedRouteIcon size={14} className="text-emerald-600 dark:text-emerald-300" />
            <strong className="truncate text-slate-900 dark:text-white">{selectedCategory.nome}</strong>
            <span>· {selectedCategoryStats.available} de {selectedCategoryStats.total} à venda · {selectedRoute.label}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedCategoryStats.paused > 0 && (
              <button
                type="button"
                onClick={() => void applyCategoryAvailability(true)}
                disabled={pendingCategoryAction}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 text-[10px] font-black text-emerald-700 disabled:opacity-50 dark:text-emerald-300"
              >
                <PlayCircle size={13} /> Voltar todos
              </button>
            )}
            {selectedCategoryStats.available > 0 && (
              <button
                type="button"
                onClick={() => void applyCategoryAvailability(false)}
                disabled={pendingCategoryAction}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-300 px-3 text-[10px] font-black text-rose-700 disabled:opacity-50 dark:border-rose-500/35 dark:text-rose-300"
              >
                <PauseCircle size={13} /> Pausar categoria
              </button>
            )}
          </div>
        </section>
      )}

      {selectionMode && (
        <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-3 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/[0.08]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-black text-slate-950 dark:text-white">
                {selectedCount > 0
                  ? `${selectedCount} produto${selectedCount === 1 ? '' : 's'} selecionado${selectedCount === 1 ? '' : 's'}`
                  : 'Selecione os produtos que deseja alterar'}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">Marque os cards abaixo. As ações aparecem aqui, sem abrir produto por produto.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleAllVisible}
                disabled={visibleIds.length === 0}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-40 dark:border-white/15 dark:bg-black/15 dark:text-slate-200"
              >
                <ListChecks size={14} /> {allVisibleSelected ? 'Desmarcar exibidos' : `Selecionar ${filteredProducts.length} exibidos`}
              </button>
              <button
                type="button"
                onClick={leaveSelectionMode}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-black text-slate-700 dark:border-white/15 dark:text-slate-300"
              >
                <X size={14} /> Cancelar
              </button>
            </div>
          </div>

          {selectedCount > 0 && (
            <div className="mt-3 grid gap-2 border-t border-emerald-200 pt-3 dark:border-emerald-500/20 xl:grid-cols-[auto_auto_minmax(15rem,1fr)_minmax(15rem,1fr)]">
              <button
                type="button"
                onClick={() => void applyBatchAvailability(false)}
                disabled={pendingBatchAction}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-xs font-black text-rose-700 disabled:opacity-50 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300"
              >
                <PauseCircle size={15} /> Pausar
              </button>
              <button
                type="button"
                onClick={() => void applyBatchAvailability(true)}
                disabled={pendingBatchAction}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-500 bg-emerald-500 px-4 text-xs font-black text-emerald-950 disabled:opacity-50"
              >
                <PlayCircle size={15} /> Voltar a vender
              </button>

              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-white/10 dark:bg-black/15">
                <input
                  type="number"
                  min={-90}
                  max={500}
                  step="0.1"
                  value={batchPriceAdjustment}
                  onChange={(event) => setBatchPriceAdjustment(event.target.value)}
                  placeholder="Reajuste em %"
                  aria-label="Reajuste percentual dos produtos selecionados"
                  className="h-8 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-900 outline-none focus:border-emerald-500 dark:border-white/15 dark:bg-black/20 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => void applyBatchEdit({ reajuste_percentual: parsedBatchPriceAdjustment })}
                  disabled={pendingBatchAction || !batchPriceAdjustmentValid}
                  className="h-8 rounded-lg bg-slate-900 px-3 text-[10px] font-black text-white disabled:opacity-40 dark:bg-white dark:text-slate-950"
                >
                  Ajustar preço
                </button>
              </div>

              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-white/10 dark:bg-black/15">
                <select
                  value={batchCategoryId}
                  onChange={(event) => setBatchCategoryId(event.target.value)}
                  aria-label="Nova categoria dos produtos selecionados"
                  className="h-8 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-900 outline-none focus:border-emerald-500 dark:border-white/15 dark:bg-black/20 dark:text-white"
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
                  className="h-8 rounded-lg bg-slate-900 px-3 text-[10px] font-black text-white disabled:opacity-40 dark:bg-white dark:text-slate-950"
                >
                  Mover
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {filteredProducts.length === 0 ? (
        <section className="grid min-h-72 place-items-center rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-[#111713]">
          <div className="max-w-md">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
              <PackageOpen size={24} />
            </div>
            <h3 className="text-lg font-black text-slate-950 dark:text-white">Nenhum produto encontrado</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Ajuste a busca ou os filtros.</p>
          </div>
        </section>
      ) : (
        <section>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredProducts.map((product) => {
              const isAvailable = product.ativo !== false;
              const isSelected = selectedProductIds.has(product.id);
              const mediaCount = productMediaCount(product);
              const detailKey = String(product.id);
              return (
                <article
                  key={product.id}
                  className={clsx(
                    'group relative flex min-h-40 flex-col rounded-2xl border p-3 shadow-sm transition',
                    isAvailable
                      ? 'border-slate-200 bg-white hover:border-emerald-400 dark:border-white/10 dark:bg-[#141b16] dark:hover:border-emerald-500/35'
                      : 'border-rose-200 bg-rose-50/60 hover:border-rose-400 dark:border-rose-500/25 dark:bg-rose-950/15',
                    isSelected && 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-slate-100 dark:ring-offset-[#090e0b]',
                  )}
                >
                  <div className="flex items-start gap-3">
                    {selectionMode && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleProductSelection(product.id)}
                        aria-label={`Selecionar ${product.nome}`}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-slate-400 accent-emerald-500"
                      />
                    )}
                    <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                      {product.imagem ? (
                        <img src={product.imagem} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon size={19} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pr-16">
                      <h3 className="line-clamp-2 text-sm font-black text-slate-950 dark:text-white">{product.nome}</h3>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {product.categoria && (
                          <span className="max-w-full truncate rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-black text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                            {product.categoria}
                          </span>
                        )}
                        <span className={clsx(
                          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide',
                          isAvailable
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-300'
                            : 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/35 dark:bg-rose-500/10 dark:text-rose-300',
                        )}>
                          <span className={clsx('h-1.5 w-1.5 rounded-full', isAvailable ? 'bg-emerald-500' : 'bg-rose-500')} />
                          {isAvailable ? 'À venda' : 'Pausado'}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setProductDetailId((current) => current === detailKey ? null : detailKey)}
                      aria-expanded={productDetailId === detailKey}
                      aria-controls={`catalog-product-details-${detailKey}`}
                      aria-label={`Ver detalhes de ${product.nome}`}
                      title="Ver detalhes"
                      className="absolute right-11 top-3 z-20 grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white/95 text-slate-500 transition hover:border-emerald-400 hover:text-emerald-700 dark:border-white/10 dark:bg-[#141b16]/95 dark:hover:text-emerald-300"
                    >
                      <Info size={14} />
                    </button>
                    <details className="absolute right-3 top-3 z-30">
                      <summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-lg border border-slate-200 bg-white/95 text-slate-500 transition hover:border-slate-400 hover:text-slate-900 dark:border-white/10 dark:bg-[#141b16]/95 dark:hover:text-white" aria-label={`Mais ações para ${product.nome}`}>
                        <MoreHorizontal size={16} />
                      </summary>
                      <div className="absolute right-0 mt-2 w-40 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-[#17201a]">
                        <button type="button" onClick={() => onDuplicateProduct(product)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5">
                          <Copy size={14} /> Duplicar
                        </button>
                        <button type="button" onClick={() => void onRemoveProduct(product)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10">
                          <Trash2 size={14} /> Excluir
                        </button>
                      </div>
                    </details>
                  </div>

                  <div
                    id={`catalog-product-details-${detailKey}`}
                    role="note"
                    className={clsx(
                      'pointer-events-none absolute inset-x-3 top-14 z-20 rounded-xl border border-slate-200 bg-white/95 p-2.5 text-left shadow-xl backdrop-blur-md transition-all dark:border-white/10 dark:bg-[#17201a]/95',
                      'translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100',
                      productDetailId === detailKey && 'translate-y-0 opacity-100',
                    )}
                  >
                    <span className="block text-[8px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Detalhes do produto</span>
                    <p className="mt-1 text-[10px] leading-relaxed text-slate-600 dark:text-slate-300">
                      {product.descricao || 'Sem descrição cadastrada.'}
                    </p>
                    <span className="mt-1.5 block font-mono text-[8px] text-slate-500">
                      Cód. {product.id} · {mediaCount === 0 ? 'Sem foto' : `${mediaCount} foto${mediaCount === 1 ? '' : 's'}`}
                    </span>
                  </div>

                  <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-slate-200 pt-3 dark:border-white/10">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Preço</p>
                      <p className="font-mono text-base font-black text-emerald-700 dark:text-emerald-300">
                        {Number(product.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </p>
                    </div>
                    {!selectionMode && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onEditProduct(product)}
                          title={mediaCount === 0 ? 'Editar fotos deste produto' : 'Editar produto'}
                          className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-emerald-400 hover:text-emerald-700 dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:hover:border-emerald-500/50 dark:hover:text-emerald-300"
                        >
                          <Edit3 size={14} /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleProductAvailability(product)}
                          disabled={pendingProductId === product.id || pendingBatchAction || pendingCategoryAction}
                          className={clsx(
                            'inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-black transition disabled:opacity-60',
                            isAvailable
                              ? 'border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-500/35 dark:text-rose-300 dark:hover:bg-rose-500/10'
                              : 'border-emerald-500 bg-emerald-500 text-emerald-950 hover:bg-emerald-400',
                          )}
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
