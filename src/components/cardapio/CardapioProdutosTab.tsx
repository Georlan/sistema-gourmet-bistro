import React, { useMemo, useState } from 'react';
import {
  Copy,
  Edit3,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers3,
  PackageOpen,
  Plus,
  Search,
  Trash2,
  Utensils,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { Product } from '../../types';
import type { CatalogCategory } from '../../catalog/catalog';
import { smartSearchMatch } from '../../domain';
import { OperationalBanner } from '../shared/OperationalBanner';

type AvailabilityFilter = 'todos' | 'publicados' | 'pausados';

interface CardapioProdutosTabProps {
  produtos: Product[];
  categorias: CatalogCategory[];
  catalogReady: boolean;
  previewUrl?: string;
  onCreateProduct: () => void;
  onCreateCategory: () => void;
  onEditProduct: (product: Product) => void;
  onDuplicateProduct: (product: Product) => void;
  onRemoveProduct: (product: Product) => Promise<void>;
  onToggleProduct: (product: Product, ativo: boolean) => Promise<void>;
  onSetCategoryAvailability: (productIds: string[], ativo: boolean) => Promise<void>;
}

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const productCategoryId = (product: Product) => product.categoria_id || '';

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
  onSetCategoryAvailability,
}: CardapioProdutosTabProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('todos');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('todos');
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [pendingCategoryId, setPendingCategoryId] = useState<string | null>(null);

  const summary = useMemo(() => {
    const published = produtos.filter((product) => product.ativo !== false).length;
    const withoutImage = produtos.filter((product) => (
      !product.imagem && !product.imagens_galeria?.some(Boolean)
    )).length;
    const categoryHasProduct = (category: CatalogCategory) => produtos.some(product => (
      productCategoryId(product) === category.id
      || product.categoria === category.nome
    ));
    return {
      paused: produtos.length - published,
      publicationRate: produtos.length > 0 ? Math.round((published / produtos.length) * 100) : 0,
      withoutImage,
      emptyCategories: categorias.filter(category => !categoryHasProduct(category)).length,
    };
  }, [categorias, produtos]);

  const filteredProducts = useMemo(() => produtos.filter((product) => {
    if (categoryFilter !== 'todos' && productCategoryId(product) !== categoryFilter) return false;
    if (availabilityFilter === 'publicados' && product.ativo === false) return false;
    if (availabilityFilter === 'pausados' && product.ativo !== false) return false;
    const term = search.trim();
    if (!term) return true;
    return smartSearchMatch(product.nome, term)
      || smartSearchMatch(product.descricao || '', term)
      || smartSearchMatch(product.id, term);
  }), [availabilityFilter, categoryFilter, produtos, search]);

  const groups = useMemo(() => categorias.map((category) => ({
    category,
    products: filteredProducts
      .filter((product) => productCategoryId(product) === category.id)
      .sort((a, b) => String(a.id).localeCompare(String(b.id), 'pt-BR', {
        numeric: true,
        sensitivity: 'base',
      })),
  })).filter((group) => group.products.length > 0), [categorias, filteredProducts]);

  const orphanProducts = useMemo(
    () => filteredProducts.filter((product) => !categorias.some((category) => category.id === productCategoryId(product))),
    [categorias, filteredProducts],
  );

  const handleToggle = async (product: Product) => {
    if (pendingProductId) return;
    setPendingProductId(product.id);
    try {
      await onToggleProduct(product, product.ativo === false);
    } finally {
      setPendingProductId(null);
    }
  };

  const handleCategoryAvailability = async (
    categoryId: string,
    productIds: string[],
    ativo: boolean,
  ) => {
    if (pendingCategoryId || productIds.length === 0) return;
    setPendingCategoryId(categoryId);
    try {
      await onSetCategoryAvailability(productIds, ativo);
    } finally {
      setPendingCategoryId(null);
    }
  };

  const renderProduct = (product: Product) => {
    const isPublished = product.ativo !== false;
    const isPending = pendingProductId === product.id;
    return (
      <article
        key={product.id}
        className={clsx(
          'group grid gap-3 border-b border-koma-border px-3 py-3.5 transition-colors last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4',
          'hover:bg-white/[0.025]',
          !isPublished && 'bg-black/10',
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className={clsx(
            'relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-koma-border bg-koma-card',
            !isPublished && 'opacity-60 grayscale',
          )}>
            {product.imagem ? (
              <img src={product.imagem} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <ImageIcon size={18} className="text-koma-muted" aria-hidden="true" />
            )}
            <span className="absolute bottom-1 left-1 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[8px] font-bold text-koma-secondary backdrop-blur-sm">
              #{product.id}
            </span>
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className={clsx('truncate text-[13px] font-bold text-zinc-100', !isPublished && 'text-koma-muted')}>
                {product.nome}
              </h3>
              <span className={clsx(
                'rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em]',
                isPublished
                  ? 'border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300'
                  : 'border-amber-400/15 bg-amber-400/[0.07] text-amber-300',
              )}>
                {isPublished ? 'Publicado' : 'Pausado'}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 max-w-3xl text-[10px] leading-relaxed text-koma-subtle">
              {product.descricao || 'Sem descrição. Adicione detalhes para facilitar a escolha do cliente.'}
            </p>
            <strong className="mt-1.5 block font-mono text-xs text-emerald-300">
              {currency.format(Number(product.preco) || 0)}
            </strong>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pl-[4.25rem] sm:justify-end sm:pl-0">
          <button
            type="button"
            onClick={() => void handleToggle(product)}
            disabled={isPending || Boolean(pendingCategoryId)}
            aria-pressed={isPublished}
            aria-label={`${isPublished ? 'Pausar' : 'Publicar'} ${product.nome}`}
            className={clsx(
              'inline-flex min-w-[112px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold transition-all disabled:cursor-wait disabled:opacity-50 cursor-pointer',
              isPublished
                ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300 hover:bg-emerald-400/[0.14]'
                : 'border-koma-border bg-koma-card text-koma-secondary hover:border-emerald-400/25 hover:text-emerald-300',
            )}
          >
            <span className={clsx('h-2 w-2 rounded-full', isPublished ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.65)]' : 'bg-zinc-600')} />
            {isPending ? 'Salvando…' : isPublished ? 'Disponível' : 'Publicar'}
          </button>

          <div className="flex items-center rounded-xl border border-koma-border bg-koma-input p-1">
            <button type="button" onClick={() => onDuplicateProduct(product)} className="rounded-lg p-2 text-koma-subtle transition-colors hover:bg-white/[0.05] hover:text-emerald-300 cursor-pointer" title="Duplicar produto" aria-label={`Duplicar ${product.nome}`}>
              <Copy size={14} />
            </button>
            <button type="button" onClick={() => onEditProduct(product)} className="rounded-lg p-2 text-koma-subtle transition-colors hover:bg-white/[0.05] hover:text-koma-foreground cursor-pointer" title="Editar produto" aria-label={`Editar ${product.nome}`}>
              <Edit3 size={14} />
            </button>
            <button type="button" onClick={() => void onRemoveProduct(product)} className="rounded-lg p-2 text-koma-subtle transition-colors hover:bg-rose-500/10 hover:text-rose-300 cursor-pointer" title="Remover do cardápio" aria-label={`Remover ${product.nome} do cardápio`}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </article>
    );
  };

  const renderGroup = (category: CatalogCategory, products: Product[]) => {
    const publishedCount = products.filter((product) => product.ativo !== false).length;
    const allPublished = publishedCount === products.length;
    return (
      <section key={category.id} className="overflow-hidden rounded-[22px] border border-koma-border bg-koma-panel/60 shadow-[0_18px_50px_rgba(0,0,0,.18)]">
        <header className="flex flex-col gap-3 border-b border-koma-border bg-white/[0.018] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300">
              <Utensils size={15} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-xs font-bold text-zinc-100">{category.nome}</h2>
              <p className="mt-0.5 text-[9px] text-koma-subtle">
                {products.length} {products.length === 1 ? 'produto' : 'produtos'} · {publishedCount} disponíveis
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleCategoryAvailability(category.id, products.map((product) => product.id), !allPublished)}
            disabled={Boolean(pendingCategoryId)}
            className={clsx(
              'inline-flex items-center justify-center gap-1.5 self-start rounded-xl border px-3 py-2 text-[9px] font-bold transition-colors disabled:cursor-wait disabled:opacity-50 sm:self-auto cursor-pointer',
              allPublished
                ? 'border-amber-400/15 bg-amber-400/[0.06] text-amber-300 hover:bg-amber-400/[0.11]'
                : 'border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300 hover:bg-emerald-400/[0.12]',
            )}
          >
            {allPublished ? <EyeOff size={13} /> : <Eye size={13} />}
            {pendingCategoryId === category.id ? 'Salvando…' : allPublished ? 'Pausar categoria' : 'Publicar categoria'}
          </button>
        </header>
        <div>{products.map(renderProduct)}</div>
      </section>
    );
  };

  return (
    <div className="orders-workspace w-full space-y-4 pb-8 text-left animate-fade-in">
      <OperationalBanner
        id="catalog-products-heading"
        eyebrow="CATÁLOGO CENTRAL"
        title="Cardápio"
        accent="organizado para vender"
        description="Produtos, preços e disponibilidade sincronizados entre caixa, atendimento e cardápio digital."
        metrics={[
          { label: 'publicação', value: `${summary.publicationRate}%`, valueClassName: 'text-emerald-300' },
          { label: 'itens pausados', value: summary.paused, valueClassName: summary.paused > 0 ? 'text-amber-300' : 'text-emerald-300' },
          { label: 'sem imagem', value: summary.withoutImage, valueClassName: summary.withoutImage > 0 ? 'text-amber-300' : 'text-emerald-300' },
          { label: 'categorias vazias', value: summary.emptyCategories, valueClassName: summary.emptyCategories > 0 ? 'text-amber-300' : 'text-emerald-300' },
        ]}
      />

      <section className="space-y-3 rounded-[22px] border border-koma-border bg-koma-panel/60 p-3.5 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-koma-muted" size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, descrição ou código…" className="h-11 w-full rounded-xl border border-koma-border bg-koma-input pl-10 pr-10 text-[11px] text-koma-foreground outline-none transition-colors placeholder:text-zinc-500 focus:border-emerald-400/30" />
            {search && <button type="button" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-koma-muted hover:text-koma-foreground cursor-pointer" aria-label="Limpar busca"><X size={13} /></button>}
          </div>
          <div className="grid grid-cols-3 rounded-xl border border-koma-border bg-koma-input p-1 lg:w-auto">
            {([
              ['todos', 'Todos'],
              ['publicados', 'Disponíveis'],
              ['pausados', 'Pausados'],
            ] as Array<[AvailabilityFilter, string]>).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setAvailabilityFilter(value)} className={clsx('rounded-lg px-3 py-2 text-[9px] font-bold transition-colors cursor-pointer', availabilityFilter === value ? 'bg-koma-card text-koma-foreground' : 'text-koma-subtle hover:text-zinc-200')}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {previewUrl && (
              <a href={previewUrl} target="_blank" rel="noreferrer" className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-card px-3 py-2.5 text-[9px] font-bold text-zinc-200 transition-colors hover:bg-zinc-700 sm:flex-none">
                <Eye size={13} /> Ver cardápio
              </a>
            )}
            <button type="button" onClick={onCreateCategory} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-2.5 text-[9px] font-bold text-emerald-200 transition-colors hover:bg-emerald-300/[0.11] sm:flex-none cursor-pointer">
              <Layers3 size={13} /> Nova categoria
            </button>
            <button type="button" onClick={onCreateProduct} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2.5 text-[9px] font-black text-zinc-950 transition-colors hover:bg-emerald-400 sm:flex-none cursor-pointer shadow-sm">
              <Plus size={13} /> Novo produto
            </button>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button type="button" onClick={() => setCategoryFilter('todos')} className={clsx('shrink-0 rounded-full border px-3 py-1.5 text-[9px] font-bold transition-colors cursor-pointer', categoryFilter === 'todos' ? 'border-emerald-300/25 bg-emerald-300/[0.09] text-emerald-200' : 'border-koma-border text-koma-subtle hover:text-zinc-200')}>Todas as categorias</button>
          {categorias.map((category) => (
            <button key={category.id} type="button" onClick={() => setCategoryFilter(category.id)} className={clsx('shrink-0 rounded-full border px-3 py-1.5 text-[9px] font-bold transition-colors cursor-pointer', categoryFilter === category.id ? 'border-emerald-300/25 bg-emerald-300/[0.09] text-emerald-200' : 'border-koma-border text-koma-subtle hover:text-zinc-200')}>
              {category.nome}
            </button>
          ))}
        </div>
      </section>

      {!catalogReady && produtos.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center rounded-[22px] border border-koma-border bg-koma-panel/60 text-[10px] font-bold uppercase tracking-[0.16em] text-koma-muted">Carregando catálogo…</div>
      ) : filteredProducts.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-[22px] border border-dashed border-koma-border bg-koma-panel/60 px-6 text-center">
          <PackageOpen size={28} className="text-koma-muted" />
          <strong className="mt-4 text-sm text-koma-secondary">Nenhum produto encontrado</strong>
          <p className="mt-1 max-w-sm text-[10px] leading-relaxed text-koma-muted">Ajuste os filtros ou cadastre o primeiro produto desta categoria.</p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {groups.map(({ category, products }) => renderGroup(category, products))}
          {orphanProducts.length > 0 && renderGroup({ id: 'sem-categoria', nome: 'Sem categoria', destino_impressao: 'NENHUM' }, orphanProducts)}
        </div>
      )}
    </div>
  );
}
