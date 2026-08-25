import React, { useMemo, useState } from 'react';
import {
  Copy,
  Edit3,
  Eye,
  Image as ImageIcon,
  MoreHorizontal,
  PackageOpen,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { Product } from '../../types';
import type { CatalogCategory } from '../../catalog/catalog';
import { smartSearchMatch } from '../../domain';
import { KomaEmptyState } from '../shared/KomaEmptyState';

type AvailabilityFilter = 'todos' | 'publicados' | 'pausados';

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

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const productCategoryId = (product: Product) => String(product.categoria_id || '');

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
  const [categoryFilter, setCategoryFilter] = useState('todos');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('todos');
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [pendingCategoryId, setPendingCategoryId] = useState<string | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    if (!focusCategoryId) return;
    setSearch('');
    setAvailabilityFilter('todos');
    setCategoryFilter(String(focusCategoryId));
    onFocusCategoryHandled?.();
  }, [focusCategoryId, onFocusCategoryHandled]);

  const categoryById = useMemo(
    () => new Map(categorias.map((category) => [String(category.id), category])),
    [categorias],
  );

  const categoryNameFor = (product: Product) => (
    categoryById.get(String(productCategoryId(product)))?.nome
    || product.categoria
    || 'Sem categoria'
  );

  const filteredProducts = useMemo(() => produtos.filter((product) => {
    if (categoryFilter !== 'todos' && productCategoryId(product) !== categoryFilter) return false;
    if (availabilityFilter === 'publicados' && product.ativo === false) return false;
    if (availabilityFilter === 'pausados' && product.ativo !== false) return false;
    const term = search.trim();
    if (!term) return true;
    return smartSearchMatch(product.nome, term)
      || smartSearchMatch(product.descricao || '', term)
      || smartSearchMatch(product.id, term)
      || smartSearchMatch(categoryNameFor(product), term);
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true, sensitivity: 'base' })), [availabilityFilter, categoryById, categoryFilter, produtos, search]);

  React.useEffect(() => {
    const visibleIds = new Set(filteredProducts.map((product) => product.id));
    setSelectedProductIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filteredProducts]);

  const availabilityCounts = useMemo(() => ({
    todos: produtos.length,
    publicados: produtos.filter((product) => product.ativo !== false).length,
    pausados: produtos.filter((product) => product.ativo === false).length,
  }), [produtos]);

  const selectedCategory = categoryFilter === 'todos' ? null : categoryById.get(categoryFilter) || null;
  const selectedCategoryProducts = useMemo(
    () => categoryFilter === 'todos'
      ? []
      : produtos.filter((product) => productCategoryId(product) === categoryFilter),
    [categoryFilter, produtos],
  );
  const selectedCategoryIsAvailable = selectedCategoryProducts.length > 0
    && selectedCategoryProducts.every((product) => product.ativo !== false);
  const hasActiveFilters = Boolean(search.trim() || categoryFilter !== 'todos' || availabilityFilter !== 'todos');
  const allVisibleSelected = filteredProducts.length > 0
    && filteredProducts.every((product) => selectedProductIds.has(product.id));

  const handleToggle = async (product: Product) => {
    if (pendingProductId) return;
    setPendingProductId(product.id);
    try {
      await onToggleProduct(product, product.ativo === false);
    } finally {
      setPendingProductId(null);
    }
  };

  const handleCategoryAvailability = async () => {
    if (!selectedCategory || pendingCategoryId || selectedCategoryProducts.length === 0) return;
    setPendingCategoryId(selectedCategory.id);
    try {
      await onSetCategoryAvailability(
        selectedCategoryProducts.map((product) => product.id),
        !selectedCategoryIsAvailable,
      );
    } finally {
      setPendingCategoryId(null);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setCategoryFilter('todos');
    setAvailabilityFilter('todos');
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
      if (allVisibleSelected) filteredProducts.forEach((product) => next.delete(product.id));
      else filteredProducts.forEach((product) => next.add(product.id));
      return next;
    });
  };

  const handleSelectedAvailability = async (ativo: boolean) => {
    if (selectedProductIds.size === 0 || pendingCategoryId) return;
    setPendingCategoryId('selected-products');
    try {
      await onSetCategoryAvailability([...selectedProductIds], ativo);
      setSelectedProductIds(new Set());
    } finally {
      setPendingCategoryId(null);
    }
  };

  return (
    <div className="orders-workspace w-full space-y-3.5 pb-8 text-left animate-fade-in" aria-labelledby="catalog-products-heading">
      <h1 id="catalog-products-heading" className="sr-only">Produtos do cardápio</h1>

      <section className="koma-toolbar" aria-label="Ferramentas do catálogo">
        <div className="koma-toolbar__search">
          <Search size={14} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto, categoria ou código…" aria-label="Buscar produtos" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca"><X size={13} /></button>}
        </div>

        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="koma-toolbar__select" aria-label="Filtrar produtos por categoria">
          <option value="todos">Todas as categorias</option>
          {categorias.map((category) => <option key={category.id} value={category.id}>{category.nome}</option>)}
        </select>

        <div className="inline-flex min-h-[2.35rem] max-w-full shrink-0 items-center overflow-x-auto rounded-xl border border-koma-border bg-koma-input p-1" aria-label="Filtrar por disponibilidade">
          {([
            ['todos', 'Todos'],
            ['publicados', 'Disponíveis'],
            ['pausados', 'Pausados'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setAvailabilityFilter(value)}
              aria-pressed={availabilityFilter === value}
              className={clsx(
                'inline-flex min-h-7 items-center gap-1.5 rounded-lg px-2.5 text-[9px] font-bold transition-colors',
                availabilityFilter === value
                  ? 'bg-emerald-500/15 text-emerald-800 shadow-sm ring-1 ring-emerald-500/25 dark:text-emerald-200'
                  : 'text-koma-muted hover:bg-koma-raised hover:text-koma-foreground',
              )}
            >
              {label}
              <span className="font-mono text-[8px] opacity-75">{availabilityCounts[value]}</span>
            </button>
          ))}
        </div>

        <div className="koma-toolbar__actions">
          {previewUrl && <a href={previewUrl} target="_blank" rel="noreferrer" className="koma-btn-secondary"><Eye size={14} /> Ver cardápio</a>}
          <button type="button" onClick={onCreateProduct} className="koma-btn-success"><Plus size={14} /> Novo produto</button>
        </div>
      </section>

      {!catalogReady && produtos.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center rounded-[22px] border border-koma-border bg-koma-panel/60 text-[10px] font-bold uppercase tracking-[0.16em] text-koma-muted">Carregando catálogo…</div>
      ) : filteredProducts.length === 0 ? (
        <KomaEmptyState
          icon={PackageOpen}
          title={produtos.length === 0 ? 'Cadastre o primeiro produto' : 'Nenhum produto encontrado'}
          description={produtos.length === 0 ? 'Produtos cadastrados aqui ficam disponíveis no caixa, atendimento e cardápio online.' : 'Ajuste a busca ou os filtros para ver outros produtos.'}
          action={produtos.length === 0
            ? { label: 'Novo produto', onClick: onCreateProduct, icon: Plus }
            : { label: 'Limpar filtros', onClick: clearFilters, variant: 'secondary' }}
        />
      ) : (
        <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel" aria-label="Catálogo de produtos">
          <header className="flex flex-col gap-2 border-b border-koma-border bg-koma-raised/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="inline-flex cursor-pointer items-center gap-2 text-[10px] font-semibold text-koma-secondary">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="h-3.5 w-3.5 rounded border-koma-border accent-emerald-600" />
                Selecionar exibidos
              </label>
              <span className="h-4 w-px bg-koma-border" aria-hidden="true" />
              <p className="text-[10px] font-medium text-koma-muted">
                <strong className="font-mono text-koma-foreground">{filteredProducts.length}</strong>{hasActiveFilters ? ` de ${produtos.length}` : ''} {filteredProducts.length === 1 ? 'produto' : 'produtos'}
              </p>
            </div>
            {selectedCategory && selectedCategoryProducts.length > 0 && (
              <button
                type="button"
                onClick={() => void handleCategoryAvailability()}
                disabled={Boolean(pendingCategoryId)}
                className={clsx(
                  'inline-flex min-h-8 items-center justify-center self-start rounded-lg border px-2.5 text-[9px] font-bold transition-colors disabled:cursor-wait disabled:opacity-50 sm:self-auto',
                  selectedCategoryIsAvailable ? 'koma-badge-warning' : 'koma-badge-success',
                )}
              >
                {pendingCategoryId ? 'Salvando…' : selectedCategoryIsAvailable ? `Pausar ${selectedCategory.nome}` : `Disponibilizar ${selectedCategory.nome}`}
              </button>
            )}
          </header>

          {selectedProductIds.size > 0 && (
            <div className="flex flex-col gap-2 border-b border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <p className="text-[10px] font-bold text-emerald-800 dark:text-emerald-200">
                {selectedProductIds.size} {selectedProductIds.size === 1 ? 'produto selecionado' : 'produtos selecionados'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void handleSelectedAvailability(true)} disabled={Boolean(pendingCategoryId)} className="koma-btn-success inline-flex min-h-8 items-center gap-1.5 px-3 text-[9px] font-bold disabled:opacity-50"><PlayCircle size={13} /> Disponibilizar</button>
                <button type="button" onClick={() => void handleSelectedAvailability(false)} disabled={Boolean(pendingCategoryId)} className="koma-btn-secondary inline-flex min-h-8 items-center gap-1.5 px-3 text-[9px] font-bold disabled:opacity-50"><PauseCircle size={13} /> Pausar</button>
                <button type="button" onClick={() => setSelectedProductIds(new Set())} className="min-h-8 px-2 text-[9px] font-bold text-koma-muted hover:text-koma-foreground">Limpar seleção</button>
              </div>
            </div>
          )}

          <div className="hidden grid-cols-[1.25rem_minmax(18rem,1fr)_minmax(8rem,0.32fr)_6rem_8rem_9rem] items-center gap-3 border-b border-koma-border bg-koma-raised/20 px-4 py-2 text-[9px] font-extrabold uppercase tracking-[0.08em] text-koma-muted lg:grid">
            <span aria-hidden="true" /><span>Produto</span><span>Categoria</span><span>Preço</span><span>Disponibilidade</span><span className="text-right">Ações</span>
          </div>

          {filteredProducts.map((product) => {
            const isAvailable = product.ativo !== false;
            const isPending = pendingProductId === product.id;
            const categoryName = categoryNameFor(product);
            const normalizedProductName = product.nome.trim().replace(/^#/, '');
            const productNameAlreadyShowsCode = normalizedProductName === product.id
              || normalizedProductName.startsWith(`${product.id} `)
              || normalizedProductName.startsWith(`${product.id}-`);
            return (
              <article
                key={product.id}
                className={clsx(
                  'group grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 border-b border-koma-border px-3 py-3 transition-colors last:border-b-0 hover:bg-koma-raised/50 sm:px-4 lg:grid-cols-[1.25rem_minmax(18rem,1fr)_minmax(8rem,0.32fr)_6rem_8rem_9rem] lg:items-center',
                  !isAvailable && 'bg-koma-canvas/35',
                )}
              >
                <input
                  type="checkbox"
                  checked={selectedProductIds.has(product.id)}
                  onChange={() => toggleProductSelection(product.id)}
                  aria-label={`Selecionar ${product.nome}`}
                  className="mt-3 h-3.5 w-3.5 rounded border-koma-border accent-emerald-600 lg:mt-0"
                />
                <div className="flex min-w-0 items-center gap-3">
                  <div className={clsx('flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-koma-border bg-koma-raised', !isAvailable && 'opacity-60 grayscale')}>
                    {product.imagem ? <img src={product.imagem} alt="" className="h-full w-full object-cover" loading="lazy" /> : <ImageIcon size={17} className="text-koma-muted" aria-hidden="true" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <h2 className={clsx('truncate text-xs font-bold text-koma-foreground', !isAvailable && 'text-koma-muted')}>{product.nome}</h2>
                      {!productNameAlreadyShowsCode && <span className="shrink-0 font-mono text-[9px] text-koma-muted">#{product.id}</span>}
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-koma-muted">{product.descricao || 'Sem descrição'}</p>
                    <p className="mt-1 text-[9px] font-semibold text-koma-subtle lg:hidden">{categoryName} · {currency.format(Number(product.preco) || 0)}</p>
                  </div>
                </div>

                <span className="hidden truncate text-[10px] font-semibold text-koma-secondary lg:block">{categoryName}</span>
                <strong className="hidden font-mono text-xs text-emerald-700 dark:text-emerald-400 lg:block">{currency.format(Number(product.preco) || 0)}</strong>

                <button
                  type="button"
                  onClick={() => void handleToggle(product)}
                  disabled={isPending || Boolean(pendingCategoryId)}
                  aria-pressed={isAvailable}
                  aria-label={`${isAvailable ? 'Pausar' : 'Disponibilizar'} ${product.nome}`}
                  className={clsx(
                    'col-start-2 lg:col-start-auto',
                    'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[9px] font-extrabold uppercase tracking-wide transition-colors disabled:cursor-wait disabled:opacity-50',
                    isAvailable ? 'koma-badge-success' : 'koma-badge-warning',
                  )}
                >
                  <span className={clsx('h-1.5 w-1.5 rounded-full', isAvailable ? 'bg-emerald-600 dark:bg-emerald-300' : 'bg-amber-600 dark:bg-amber-300')} />
                  {isPending ? 'Salvando…' : isAvailable ? 'Disponível' : 'Pausado'}
                </button>

                <div className="col-start-2 flex items-center justify-end gap-1 lg:col-start-auto">
                  <button type="button" onClick={() => onEditProduct(product)} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[9px] font-bold text-koma-secondary transition-colors hover:bg-koma-raised hover:text-koma-foreground" title="Editar produto" aria-label={`Editar ${product.nome}`}><Edit3 size={13} /><span>Editar</span></button>
                  <button type="button" onClick={() => onDuplicateProduct(product)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-koma-muted transition-colors hover:bg-koma-raised hover:text-koma-foreground" title="Duplicar produto" aria-label={`Duplicar ${product.nome}`}><Copy size={13} /></button>
                  <details className="relative">
                    <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-koma-muted transition-colors hover:bg-koma-raised hover:text-koma-foreground" aria-label={`Mais ações para ${product.nome}`}><MoreHorizontal size={15} /></summary>
                    <div className="absolute right-0 z-20 mt-1 min-w-40 overflow-hidden rounded-xl border border-koma-border bg-koma-panel p-1 shadow-xl">
                      <button type="button" onClick={() => void onRemoveProduct(product)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[10px] font-semibold text-rose-700 hover:bg-rose-500/10 dark:text-rose-300"><Trash2 size={13} /> Excluir produto</button>
                    </div>
                  </details>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
