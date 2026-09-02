import {
  Ban,
  ChefHat,
  Copy,
  Edit3,
  Eye,
  GlassWater,
  ImageIcon,
  Images,
  MoreHorizontal,
  PackageOpen,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
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
  COZINHA: { label: 'Imprime na cozinha', icon: ChefHat },
  BAR: { label: 'Imprime no bar', icon: GlassWater },
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
  focusCategoryId,
  onFocusCategoryHandled,
}: CardapioProdutosTabProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('TODAS');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('TODOS');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('TODAS');
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [pendingBatchAction, setPendingBatchAction] = useState(false);
  const [pendingCategoryAction, setPendingCategoryAction] = useState(false);
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);

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
      .sort((a, b) => {
        if (mediaFilter !== 'TODAS') {
          const mediaDifference = productMediaCount(a) - productMediaCount(b);
          if (mediaDifference !== 0) return mediaDifference;
        }
        return a.nome.localeCompare(b.nome, 'pt-BR');
      });
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

  useEffect(() => {
    const validProductIds = new Set(produtos.map((product) => String(product.id)));
    setSelectedProductIds((current) => {
      const next = new Set(Array.from(current).filter((id) => validProductIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [produtos]);

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
      setSelectedProductIds(new Set());
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
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-white/10 dark:bg-[#111713]">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]" aria-label="Categorias do cardápio">
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
            <span className={clsx('text-xs font-bold', categoryFilter === 'TODAS' ? 'text-white/80 dark:text-emerald-100/70' : 'text-slate-500 dark:text-slate-500')}>
              {produtos.length}
            </span>
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
                <span className="text-xs font-bold text-slate-500 dark:text-slate-500">{stats.total}</span>
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
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <label className="relative min-w-0 flex-1">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar produto, descrição ou código..."
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

        <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-white/10 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Venda</span>
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
                    {option.label} <span className="ml-1 font-mono opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
              <Images size={13} /> Fotos
            </span>
            <div className="inline-flex max-w-full overflow-x-auto rounded-xl border border-slate-300 bg-slate-100 p-1 dark:border-white/15 dark:bg-black/20" aria-label="Filtrar por fotos do produto">
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
                      'shrink-0 rounded-lg px-3 py-2 text-xs font-black transition-colors',
                      mediaFilter === option.value
                        ? option.value === 'SEM_FOTO' && mediaStats.missing > 0
                          ? 'bg-amber-100 text-amber-900 shadow-sm dark:bg-amber-500/15 dark:text-amber-200'
                          : 'bg-white text-emerald-700 shadow-sm dark:bg-emerald-500/15 dark:text-emerald-200'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                    )}
                  >
                    {option.label} <span className="ml-1 font-mono opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
            <span className={clsx(
              'rounded-full border px-2.5 py-1 text-[10px] font-black',
              mediaStats.missing > 0
                ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
                : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
            )}>
              {mediaCoverage}% com foto
            </span>
          </div>
        </div>
      </section>

      {selectedCategory && selectedCategoryStats && selectedRoute && SelectedRouteIcon && (
        <section className="flex flex-col gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/[0.07] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-emerald-300 bg-white text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
              <SelectedRouteIcon size={19} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-black text-slate-950 dark:text-white">{selectedCategory.nome}</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {selectedCategoryStats.available} de {selectedCategoryStats.total} à venda · {selectedRoute.label}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedCategoryStats.paused > 0 && (
              <button
                type="button"
                onClick={() => void applyCategoryAvailability(true)}
                disabled={pendingCategoryAction}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-500 bg-emerald-500 px-4 text-xs font-black text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
              >
                <PlayCircle size={16} /> Disponibilizar todos
              </button>
            )}
            {selectedCategoryStats.available > 0 && (
              <button
                type="button"
                onClick={() => void applyCategoryAvailability(false)}
                disabled={pendingCategoryAction}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15"
              >
                <PauseCircle size={16} /> Pausar categoria
              </button>
            )}
          </div>
        </section>
      )}

      {selectedCount > 0 && (
        <section className="flex flex-col gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-3 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/[0.08] md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-black text-slate-950 dark:text-white">
              {selectedCount} produto{selectedCount === 1 ? '' : 's'} selecionado{selectedCount === 1 ? '' : 's'}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">A alteração será aplicada de uma vez.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void applyBatchAvailability(true)}
              disabled={pendingBatchAction}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-500 bg-emerald-500 px-4 text-xs font-black text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
            >
              <PlayCircle size={16} /> Voltar a vender
            </button>
            <button
              type="button"
              onClick={() => void applyBatchAvailability(false)}
              disabled={pendingBatchAction}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300"
            >
              <PauseCircle size={16} /> Pausar venda
            </button>
            <button
              type="button"
              onClick={() => setSelectedProductIds(new Set())}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 px-4 text-xs font-black text-slate-700 dark:border-white/15 dark:text-slate-300"
            >
              <X size={15} /> Limpar
            </button>
          </div>
        </section>
      )}

      {filteredProducts.length === 0 ? (
        <section className="grid min-h-72 place-items-center rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-[#111713]">
          <div className="max-w-md">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
              <PackageOpen size={24} />
            </div>
            <h3 className="text-lg font-black text-slate-950 dark:text-white">Nenhum produto encontrado</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Ajuste a busca, a categoria, a disponibilidade ou o filtro de fotos.
            </p>
          </div>
        </section>
      ) : (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
            <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                className="h-4 w-4 rounded border-slate-400 accent-emerald-500"
              />
              Selecionar os {filteredProducts.length} exibidos
            </label>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-500">
              {mediaFilter === 'SEM_FOTO'
                ? 'Edite um produto para adicionar até três fotos; a primeira vira a capa.'
                : 'Disponibilidade e fotos ficam no mesmo cadastro, sem telas duplicadas.'}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredProducts.map((product) => {
              const isAvailable = product.ativo !== false;
              const isSelected = selectedProductIds.has(product.id);
              const mediaCount = productMediaCount(product);
              return (
                <article
                  key={product.id}
                  className={clsx(
                    'relative flex min-h-52 flex-col rounded-2xl border p-4 shadow-sm transition',
                    isAvailable
                      ? 'border-emerald-200 bg-emerald-50/70 hover:border-emerald-400 dark:border-white/10 dark:bg-[#141b16] dark:hover:border-emerald-500/35'
                      : 'border-rose-200 bg-rose-50 hover:border-rose-400 dark:border-rose-500/25 dark:bg-rose-950/20 dark:hover:border-rose-500/45',
                    isSelected && 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-slate-100 dark:ring-offset-[#090e0b]',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleProductSelection(product.id)}
                      aria-label={`Selecionar ${product.nome}`}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-400 accent-emerald-500"
                    />
                    <div className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                      {product.imagem ? (
                        <img src={product.imagem} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon size={19} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="line-clamp-2 text-sm font-black text-slate-950 dark:text-white">{product.nome}</h3>
                      <p className="mt-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-slate-500">#{product.id}</p>
                    </div>
                    <details className="relative shrink-0">
                      <summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-slate-400 hover:text-slate-900 dark:border-white/10 dark:hover:text-white" aria-label={`Mais ações para ${product.nome}`}>
                        <MoreHorizontal size={16} />
                      </summary>
                      <div className="absolute right-0 z-20 mt-2 w-40 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-[#17201a]">
                        <button type="button" onClick={() => onDuplicateProduct(product)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5">
                          <Copy size={14} /> Duplicar
                        </button>
                        <button type="button" onClick={() => void onRemoveProduct(product)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10">
                          <Trash2 size={14} /> Excluir
                        </button>
                      </div>
                    </details>
                  </div>

                  <p className="mt-3 line-clamp-2 min-h-10 text-xs leading-5 text-slate-600 dark:text-slate-400">
                    {product.descricao || 'Sem descrição cadastrada.'}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {categoryFilter === 'TODAS' && product.categoria && (
                      <button
                        type="button"
                        onClick={() => product.categoria_id && setCategoryFilter(String(product.categoria_id))}
                        className="max-w-full truncate rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-600 hover:border-emerald-300 hover:text-emerald-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:text-emerald-300"
                      >
                        {product.categoria}
                      </button>
                    )}
                    <span className={clsx(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide',
                      isAvailable
                        ? 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-300'
                        : 'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-500/35 dark:bg-rose-500/10 dark:text-rose-300',
                    )}>
                      <span className={clsx('h-1.5 w-1.5 rounded-full', isAvailable ? 'bg-emerald-500' : 'bg-rose-500')} />
                      {isAvailable ? 'À venda' : 'Pausado'}
                    </span>
                    <button
                      type="button"
                      onClick={() => onEditProduct(product)}
                      className={clsx(
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black transition-colors',
                        mediaCount === 0
                          ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-200'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:text-emerald-300',
                      )}
                      title="Editar fotos deste produto"
                    >
                      <Images size={12} />
                      {mediaCount === 0 ? 'Sem foto' : `${mediaCount} foto${mediaCount === 1 ? '' : 's'}`}
                    </button>
                  </div>

                  <div className="mt-auto pt-4">
                    <div className="mb-3 flex items-end justify-between gap-3 border-t border-slate-200 pt-3 dark:border-white/10">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Preço</p>
                        <p className="font-mono text-base font-black text-emerald-700 dark:text-emerald-300">
                          {Number(product.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onEditProduct(product)}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-emerald-400 hover:text-emerald-700 dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:hover:border-emerald-500/50 dark:hover:text-emerald-300"
                      >
                        <Edit3 size={14} /> Editar
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleProductAvailability(product)}
                      disabled={pendingProductId === product.id || pendingBatchAction || pendingCategoryAction}
                      className={clsx(
                        'inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border text-xs font-black transition',
                        isAvailable
                          ? 'border-rose-300 bg-white text-rose-700 hover:bg-rose-100 dark:border-rose-500/35 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15'
                          : 'border-emerald-500 bg-emerald-500 text-emerald-950 hover:bg-emerald-400',
                        'disabled:cursor-wait disabled:opacity-60',
                      )}
                    >
                      {isAvailable ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                      {pendingProductId === product.id ? 'Salvando...' : isAvailable ? 'Pausar venda' : 'Voltar a vender'}
                    </button>
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
