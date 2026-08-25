import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  ChefHat,
  Edit3,
  GlassWater,
  Layers3,
  MoreHorizontal,
  Plus,
  Printer,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { CategoriaModal, DeleteCategoryModal, CategoryData } from './CategoriaModal';
import { KomaEmptyState } from '../shared/KomaEmptyState';
import type { Product } from '../../types';

type DestinationFilter = 'TODOS' | 'COZINHA' | 'BAR' | 'NENHUM';

interface CardapioCategoriasTabProps {
  apiCategorias: CategoryData[];
  apiProdutos: Product[];
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  fetchCategorias: () => Promise<void>;
  showToast?: (message: string, type?: 'success' | 'error') => void;
  onCreateRequest?: number;
}

const destinationMeta = {
  COZINHA: {
    label: 'Cozinha',
    description: 'Imprime na produção da cozinha',
    icon: ChefHat,
    className: 'border-orange-400/15 bg-orange-400/[0.06] text-orange-600 dark:text-orange-300',
  },
  BAR: {
    label: 'Bar',
    description: 'Imprime na produção do bar',
    icon: GlassWater,
    className: 'border-sky-400/15 bg-sky-400/[0.06] text-sky-600 dark:text-sky-300',
  },
  NENHUM: {
    label: 'Não imprimir',
    description: 'Não gera via de preparação',
    icon: Printer,
    className: 'border-zinc-600/30 bg-zinc-800/35 text-koma-subtle',
  },
} as const;

export function CardapioCategoriasTab({
  apiCategorias,
  apiProdutos,
  apiBaseUrl,
  authHeaders,
  fetchCategorias,
  showToast,
  onCreateRequest,
}: CardapioCategoriasTabProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryData | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<CategoryData | null>(null);
  const [search, setSearch] = useState('');
  const [destinationFilter, setDestinationFilter] = useState<DestinationFilter>('TODOS');

  React.useEffect(() => {
    if (!onCreateRequest) return;
    setEditingCategory(null);
    setModalOpen(true);
  }, [onCreateRequest]);

  const productCountByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    apiCategorias.forEach((category) => counts.set(String(category.id), 0));
    apiProdutos.forEach((product) => {
      const matchingCategory = apiCategorias.find((category) => (
        String(product.categoria_id || product.categoria) === String(category.id)
        || product.categoria === category.nome
      ));
      if (matchingCategory) {
        const categoryId = String(matchingCategory.id);
        counts.set(categoryId, (counts.get(categoryId) || 0) + 1);
      }
    });
    return counts;
  }, [apiCategorias, apiProdutos]);

  const orphanProducts = useMemo(() => apiProdutos.filter((product) => !apiCategorias.some((category) => (
    String(product.categoria_id || product.categoria) === String(category.id)
    || product.categoria === category.nome
  ))).length, [apiCategorias, apiProdutos]);

  const emptyCategories = useMemo(
    () => apiCategorias.filter((category) => (productCountByCategory.get(String(category.id)) || 0) === 0).length,
    [apiCategorias, productCountByCategory],
  );

  const filteredCategories = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('pt-BR');
    return apiCategorias.filter((category) => {
      if (destinationFilter !== 'TODOS' && category.destino_impressao !== destinationFilter) return false;
      if (!normalized) return true;
      return category.nome.toLocaleLowerCase('pt-BR').includes(normalized);
    }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
  }, [apiCategorias, destinationFilter, search]);
  const hasActiveFilters = Boolean(search.trim() || destinationFilter !== 'TODOS');

  const handleOpenCreate = () => {
    setEditingCategory(null);
    setModalOpen(true);
  };

  const clearFilters = () => {
    setSearch('');
    setDestinationFilter('TODOS');
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

  return (
    <div className="orders-workspace w-full space-y-3.5 pb-8 text-left animate-fade-in" aria-labelledby="catalog-categories-heading">
      <h1 id="catalog-categories-heading" className="sr-only">Categorias do cardápio</h1>

      <section className="koma-toolbar" aria-label="Ferramentas de categorias">
        <div className="koma-toolbar__search">
          <Search size={14} aria-hidden="true" />
          <input type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar categoria…" aria-label="Buscar categorias" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca"><X size={13} /></button>}
        </div>

        <select value={destinationFilter} onChange={(event) => setDestinationFilter(event.target.value as DestinationFilter)} className="koma-toolbar__select" aria-label="Filtrar categorias por destino">
          <option value="TODOS">Todos os destinos</option>
          <option value="COZINHA">Cozinha</option>
          <option value="BAR">Bar</option>
          <option value="NENHUM">Não imprimir</option>
        </select>

        <div className="koma-toolbar__actions">
          <button type="button" onClick={handleOpenCreate} className="koma-btn-success"><Plus size={14} /> Nova categoria</button>
        </div>
      </section>

      {filteredCategories.length === 0 ? (
        <KomaEmptyState
          icon={Layers3}
          title={apiCategorias.length === 0 ? 'Crie a primeira categoria' : 'Nenhuma categoria encontrada'}
          description={apiCategorias.length === 0 ? 'Categorias agrupam produtos e definem o destino de impressão dos pedidos.' : 'Ajuste a busca ou o destino para ver outras categorias.'}
          action={apiCategorias.length === 0
            ? { label: 'Nova categoria', onClick: handleOpenCreate, icon: Plus }
            : { label: 'Limpar filtros', onClick: clearFilters, variant: 'secondary' }}
        />
      ) : (
        <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel" aria-label="Lista de categorias">
          {(hasActiveFilters || emptyCategories > 0 || orphanProducts > 0) && <header className="flex flex-col gap-1.5 border-b border-koma-border bg-koma-raised/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <p className="text-[10px] font-medium text-koma-muted">
              <strong className="font-mono text-koma-foreground">{filteredCategories.length}</strong> de {apiCategorias.length} categorias
              {emptyCategories > 0 && <> · <span className="text-amber-700 dark:text-amber-300">{emptyCategories} vazias</span></>}
            </p>
            {orphanProducts > 0 && <p className="text-[9px] font-bold text-amber-700 dark:text-amber-300">{orphanProducts} {orphanProducts === 1 ? 'produto precisa' : 'produtos precisam'} de categoria</p>}
          </header>}

          <div className="hidden grid-cols-[minmax(14rem,1fr)_7rem_11rem_7rem] items-center gap-3 border-b border-koma-border bg-koma-raised/20 px-4 py-2 text-[9px] font-extrabold uppercase tracking-[0.08em] text-koma-muted sm:grid">
            <span>Categoria</span><span>Produtos</span><span>Destino do pedido</span><span className="text-right">Ações</span>
          </div>

          {filteredCategories.map((category) => {
            const meta = destinationMeta[category.destino_impressao as keyof typeof destinationMeta] || destinationMeta.NENHUM;
            const DestinationIcon = meta.icon;
            const productCount = productCountByCategory.get(String(category.id)) || 0;
            return (
              <article key={category.id} className="group grid gap-3 border-b border-koma-border px-3 py-3 transition-colors last:border-b-0 hover:bg-koma-raised/50 sm:grid-cols-[minmax(14rem,1fr)_7rem_11rem_7rem] sm:items-center sm:px-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/15 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-300"><Layers3 size={15} /></span>
                  <div className="min-w-0">
                    <h2 className="truncate text-xs font-bold text-koma-foreground">{category.nome}</h2>
                    <p className="mt-0.5 text-[9px] text-koma-muted sm:hidden">{productCount} {productCount === 1 ? 'produto' : 'produtos'} · {meta.label}</p>
                  </div>
                </div>

                <div className="hidden sm:block">
                  <strong className="font-mono text-xs text-koma-foreground">{productCount}</strong>
                  {productCount === 0 && <span className="ml-1.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-bold text-amber-700 dark:text-amber-300">Vazia</span>}
                </div>

                <span className={clsx('hidden w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold sm:inline-flex', meta.className)} title={meta.description}><DestinationIcon size={11} /> {meta.label}</span>

                <div className="flex items-center justify-end gap-0.5">
                  <button type="button" onClick={() => { setEditingCategory(category); setModalOpen(true); }} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[9px] font-bold text-koma-secondary transition-colors hover:bg-koma-raised hover:text-koma-foreground"><Edit3 size={13} /> <span>Editar</span></button>
                  <details className="relative">
                    <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-koma-muted transition-colors hover:bg-koma-raised hover:text-koma-foreground" aria-label={`Mais ações para ${category.nome}`}><MoreHorizontal size={15} /></summary>
                    <div className="absolute right-0 z-20 mt-1 min-w-40 overflow-hidden rounded-xl border border-koma-border bg-koma-panel p-1 shadow-xl">
                      <button type="button" onClick={() => { setDeletingCategory(category); setDeleteModalOpen(true); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[10px] font-semibold text-rose-700 hover:bg-rose-500/10 dark:text-rose-300"><Trash2 size={13} /> Excluir categoria</button>
                    </div>
                  </details>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <CategoriaModal isOpen={modalOpen} onClose={() => setModalOpen(false)} categoryToEdit={editingCategory} apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} onSuccess={fetchCategorias} showToast={showToast} />
      <DeleteCategoryModal isOpen={deleteModalOpen} categoryName={deletingCategory?.nome || ''} onClose={() => setDeleteModalOpen(false)} onConfirm={handleDeleteConfirm} />
    </div>
  );
}
