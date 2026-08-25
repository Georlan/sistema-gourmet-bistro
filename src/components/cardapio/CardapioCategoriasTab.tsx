import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  Ban,
  ChefHat,
  Edit3,
  GlassWater,
  Layers3,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { CategoriaModal, DeleteCategoryModal, CategoryData } from './CategoriaModal';
import { KomaEmptyState } from '../shared/KomaEmptyState';
import type { Product } from '../../types';

type DestinationFilter = 'TODOS' | 'COZINHA' | 'BAR' | 'NENHUM';
type PrintDestination = Exclude<DestinationFilter, 'TODOS'>;

interface CardapioCategoriasTabProps {
  apiCategorias: CategoryData[];
  apiProdutos: Product[];
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  fetchCategorias: () => Promise<void>;
  showToast?: (message: string, type?: 'success' | 'error') => void;
  onCreateRequest?: number;
  onManageProducts?: (categoryId: string) => void;
}

const destinationMeta: Record<PrintDestination, {
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof ChefHat;
}> = {
  COZINHA: {
    label: 'Imprimir na cozinha',
    shortLabel: 'Cozinha',
    description: 'Gera uma via para a equipe de preparo.',
    icon: ChefHat,
  },
  BAR: {
    label: 'Imprimir no bar',
    shortLabel: 'Bar',
    description: 'Separa as bebidas em uma via própria.',
    icon: GlassWater,
  },
  NENHUM: {
    label: 'Não imprimir',
    shortLabel: 'Sem impressão',
    description: 'Entrega direta, sem via de preparo.',
    icon: Ban,
  },
};

const normalizeDestination = (value: string): PrintDestination => (
  value === 'COZINHA' || value === 'BAR' ? value : 'NENHUM'
);

export function CardapioCategoriasTab({
  apiCategorias,
  apiProdutos,
  apiBaseUrl,
  authHeaders,
  fetchCategorias,
  showToast,
  onCreateRequest,
  onManageProducts,
}: CardapioCategoriasTabProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryData | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<CategoryData | null>(null);
  const [search, setSearch] = useState('');
  const [destinationFilter, setDestinationFilter] = useState<DestinationFilter>('TODOS');
  const [pendingRouteCategoryId, setPendingRouteCategoryId] = useState<string | null>(null);

  React.useEffect(() => {
    if (!onCreateRequest) return;
    setEditingCategory(null);
    setModalOpen(true);
  }, [onCreateRequest]);

  const categoryLookup = useMemo(() => {
    const byId = new Map(apiCategorias.map((category) => [String(category.id), category]));
    const byName = new Map(apiCategorias.map((category) => [category.nome, category]));
    return { byId, byName };
  }, [apiCategorias]);

  const productCountByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    apiCategorias.forEach((category) => counts.set(String(category.id), 0));
    apiProdutos.forEach((product) => {
      const category = categoryLookup.byId.get(String(product.categoria_id || product.categoria))
        ?? categoryLookup.byName.get(product.categoria);
      if (category) counts.set(String(category.id), (counts.get(String(category.id)) || 0) + 1);
    });
    return counts;
  }, [apiCategorias, apiProdutos, categoryLookup]);

  const orphanProducts = useMemo(() => apiProdutos.filter((product) => (
    !categoryLookup.byId.has(String(product.categoria_id || product.categoria))
    && !categoryLookup.byName.has(product.categoria)
  )).length, [apiProdutos, categoryLookup]);

  const routeStats = useMemo(() => {
    const stats: Record<DestinationFilter, { categories: number; products: number }> = {
      TODOS: { categories: apiCategorias.length, products: apiProdutos.length - orphanProducts },
      COZINHA: { categories: 0, products: 0 },
      BAR: { categories: 0, products: 0 },
      NENHUM: { categories: 0, products: 0 },
    };
    apiCategorias.forEach((category) => {
      const destination = normalizeDestination(category.destino_impressao);
      stats[destination].categories += 1;
      stats[destination].products += productCountByCategory.get(String(category.id)) || 0;
    });
    return stats;
  }, [apiCategorias, apiProdutos.length, orphanProducts, productCountByCategory]);

  const filteredCategories = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('pt-BR');
    return apiCategorias.filter((category) => {
      if (destinationFilter !== 'TODOS' && normalizeDestination(category.destino_impressao) !== destinationFilter) return false;
      return !normalized || category.nome.toLocaleLowerCase('pt-BR').includes(normalized);
    }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
  }, [apiCategorias, destinationFilter, search]);

  const handleOpenCreate = () => {
    setEditingCategory(null);
    setModalOpen(true);
  };

  const clearFilters = () => {
    setSearch('');
    setDestinationFilter('TODOS');
  };

  const handleRouteChange = async (category: CategoryData, destination: PrintDestination) => {
    if (normalizeDestination(category.destino_impressao) === destination || pendingRouteCategoryId) return;
    setPendingRouteCategoryId(String(category.id));
    try {
      const response = await fetch(`${apiBaseUrl}/produtos/categorias/${category.id}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ destino_impressao: destination }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        showToast?.(payload.detail || 'Não foi possível alterar a impressão.', 'error');
        return;
      }
      showToast?.(`“${category.nome}” agora está em ${destinationMeta[destination].shortLabel.toLowerCase()}.`, 'success');
      await fetchCategorias();
    } catch (error) {
      console.error(error);
      showToast?.('Erro de conexão ao alterar a impressão.', 'error');
    } finally {
      setPendingRouteCategoryId(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingCategory) return;
    try {
      const response = await fetch(`${apiBaseUrl}/produtos/categorias/${deletingCategory.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        showToast?.(payload.detail || 'Não foi possível excluir a categoria.', 'error');
        return;
      }
      showToast?.('Categoria excluída.', 'success');
      await fetchCategorias();
    } catch (error) {
      console.error(error);
      showToast?.('Erro de conexão ao excluir categoria.', 'error');
    }
  };

  const filterCards: Array<{
    value: DestinationFilter;
    label: string;
    description: string;
    icon: typeof Layers3;
  }> = [
    { value: 'TODOS', label: 'Todas as categorias', description: 'Visão completa das rotas', icon: Layers3 },
    ...(['COZINHA', 'BAR', 'NENHUM'] as const).map((value) => ({
      value,
      label: destinationMeta[value].shortLabel,
      description: destinationMeta[value].description,
      icon: destinationMeta[value].icon,
    })),
  ];

  return (
    <div className="w-full space-y-4 pb-8 text-left animate-fade-in" aria-labelledby="catalog-categories-heading">
      <h1 id="catalog-categories-heading" className="sr-only">Preparo e impressão do cardápio</h1>

      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Rotas de impressão">
        {filterCards.map((card) => {
          const Icon = card.icon;
          const active = destinationFilter === card.value;
          const stats = routeStats[card.value];
          return (
            <button
              key={card.value}
              type="button"
              onClick={() => setDestinationFilter(card.value)}
              aria-pressed={active}
              className={clsx(
                'flex min-h-24 items-start gap-3 rounded-2xl border p-4 text-left shadow-sm transition',
                active
                  ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500/20 dark:border-emerald-500/45 dark:bg-emerald-500/10'
                  : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40 dark:border-white/10 dark:bg-[#111713] dark:hover:border-emerald-500/30 dark:hover:bg-emerald-500/5',
              )}
            >
              <span className={clsx(
                'grid h-10 w-10 shrink-0 place-items-center rounded-xl border',
                active
                  ? 'border-emerald-300 bg-white text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                  : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400',
              )}>
                <Icon size={18} />
              </span>
              <span className="min-w-0">
                <span className="block font-black text-slate-950 dark:text-white">{card.label}</span>
                <span className="mt-1 block text-xs leading-4 text-slate-600 dark:text-slate-400">{card.description}</span>
                <span className="mt-2 block font-mono text-[10px] font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  {stats.categories} categoria{stats.categories === 1 ? '' : 's'} · {stats.products} produto{stats.products === 1 ? '' : 's'}
                </span>
              </span>
            </button>
          );
        })}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-[#111713]" aria-label="Ferramentas de impressão">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative min-w-0 flex-1">
            <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar categoria..."
              aria-label="Buscar categorias"
              className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-10 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-white/15 dark:bg-black/20 dark:text-white"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-950 dark:hover:text-white">
                <X size={15} />
              </button>
            )}
          </label>
          <button type="button" onClick={handleOpenCreate} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-500 bg-emerald-500 px-4 text-xs font-black text-emerald-950 transition hover:bg-emerald-400">
            <Plus size={16} /> Nova categoria
          </button>
        </div>
      </section>

      {orphanProducts > 0 && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/25 dark:bg-rose-950/20 dark:text-rose-300">
          <strong>{orphanProducts} {orphanProducts === 1 ? 'produto está' : 'produtos estão'} sem categoria.</strong>{' '}
          Organize {orphanProducts === 1 ? 'esse item' : 'esses itens'} para garantir a impressão correta.
        </section>
      )}

      {filteredCategories.length === 0 ? (
        <KomaEmptyState
          icon={Layers3}
          title={apiCategorias.length === 0 ? 'Crie a primeira categoria' : 'Nenhuma categoria encontrada'}
          description={apiCategorias.length === 0 ? 'Categorias agrupam os produtos e definem onde cada pedido será impresso.' : 'Ajuste a busca ou escolha outra rota de impressão.'}
          action={apiCategorias.length === 0
            ? { label: 'Nova categoria', onClick: handleOpenCreate, icon: Plus }
            : { label: 'Limpar filtros', onClick: clearFilters, variant: 'secondary' }}
        />
      ) : (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-xs font-bold text-slate-600 dark:text-slate-400">
              {filteredCategories.length} de {apiCategorias.length} categorias
            </p>
            <p className="text-xs text-slate-500">Troque a impressão diretamente em cada cartão.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3" aria-label="Categorias e impressão">
            {filteredCategories.map((category) => {
              const destination = normalizeDestination(category.destino_impressao);
              const meta = destinationMeta[destination];
              const DestinationIcon = meta.icon;
              const productCount = productCountByCategory.get(String(category.id)) || 0;
              const pending = pendingRouteCategoryId === String(category.id);
              return (
                <article key={category.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-300 dark:border-white/10 dark:bg-[#111713] dark:hover:border-emerald-500/30">
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">
                      <DestinationIcon size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-black text-slate-950 dark:text-white">{category.nome}</h2>
                      {productCount > 0 && onManageProducts ? (
                        <button type="button" onClick={() => onManageProducts(String(category.id))} className="mt-1 text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-300">
                          Ver {productCount} {productCount === 1 ? 'produto' : 'produtos'}
                        </button>
                      ) : (
                        <p className="mt-1 text-xs font-bold text-slate-500">Categoria vazia</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setEditingCategory(category); setModalOpen(true); }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-black text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700 dark:border-white/10 dark:text-slate-300 dark:hover:border-emerald-500/40 dark:hover:text-emerald-300"
                    >
                      <Edit3 size={14} /> Editar
                    </button>
                    <details className="relative shrink-0">
                      <summary className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-lg border border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-950 dark:border-white/10 dark:hover:text-white" aria-label={`Mais ações para ${category.nome}`}>
                        <MoreHorizontal size={15} />
                      </summary>
                      <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-[#17201a]">
                        <button type="button" onClick={() => { setDeletingCategory(category); setDeleteModalOpen(true); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10">
                          <Trash2 size={14} /> Excluir categoria
                        </button>
                      </div>
                    </details>
                  </div>

                  <div className="mt-4 border-t border-slate-200 pt-3 dark:border-white/10">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500" htmlFor={`route-${category.id}`}>
                      Impressão do pedido
                    </label>
                    <select
                      id={`route-${category.id}`}
                      value={destination}
                      onChange={(event) => void handleRouteChange(category, event.target.value as PrintDestination)}
                      disabled={pendingRouteCategoryId !== null}
                      aria-label={`Escolher impressão para ${category.nome}`}
                      className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-black text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-wait disabled:opacity-60 dark:border-white/15 dark:bg-black/20 dark:text-white"
                    >
                      <option value="COZINHA">Imprimir na cozinha</option>
                      <option value="BAR">Imprimir no bar</option>
                      <option value="NENHUM">Não imprimir</option>
                    </select>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-500">
                      {pending ? 'Salvando alteração...' : meta.description}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <CategoriaModal isOpen={modalOpen} onClose={() => setModalOpen(false)} categoryToEdit={editingCategory} apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} onSuccess={fetchCategorias} showToast={showToast} />
      <DeleteCategoryModal isOpen={deleteModalOpen} categoryName={deletingCategory?.nome || ''} onClose={() => setDeleteModalOpen(false)} onConfirm={handleDeleteConfirm} />
    </div>
  );
}
