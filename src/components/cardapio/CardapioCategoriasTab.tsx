import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  ChefHat,
  Edit3,
  GlassWater,
  Layers3,
  Plus,
  Printer,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { CategoriaModal, DeleteCategoryModal, CategoryData } from './CategoriaModal';
import { KomaEmptyState } from '../shared/KomaEmptyState';
import type { Product } from '../../types';

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
    description: 'Os pedidos desta categoria saem na produção.',
    icon: ChefHat,
    className: 'border-orange-400/15 bg-orange-400/[0.06] text-orange-600 dark:text-orange-300',
  },
  BAR: {
    label: 'Bar',
    description: 'Os pedidos desta categoria saem no bar.',
    icon: GlassWater,
    className: 'border-sky-400/15 bg-sky-400/[0.06] text-sky-600 dark:text-sky-300',
  },
  NENHUM: {
    label: 'Sem impressão',
    description: 'A categoria não gera uma via de preparação.',
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

  React.useEffect(() => {
    if (!onCreateRequest) return;
    setEditingCategory(null);
    setModalOpen(true);
  }, [onCreateRequest]);

  const filteredCategories = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return apiCategorias;
    return apiCategorias.filter((category) => category.nome.toLocaleLowerCase('pt-BR').includes(normalized));
  }, [apiCategorias, search]);

  const destinationSummary = useMemo(() => apiCategorias.reduce(
    (summary, category) => {
      const destination = category.destino_impressao as keyof typeof summary;
      if (destination in summary) summary[destination] += 1;
      return summary;
    },
    { COZINHA: 0, BAR: 0, NENHUM: 0 },
  ), [apiCategorias]);

  const catalogInsights = useMemo(() => {
    const categoryHasProduct = (category: CategoryData) => apiProdutos.some(product => (
      product.categoria_id === category.id
      || product.categoria === category.id
      || product.categoria === category.nome
    ));
    const productHasCategory = (product: Product) => apiCategorias.some(category => (
      product.categoria_id === category.id
      || product.categoria === category.id
      || product.categoria === category.nome
    ));
    const routedCategories = destinationSummary.COZINHA + destinationSummary.BAR;

    return {
      routeCoverage: apiCategorias.length > 0
        ? Math.round((routedCategories / apiCategorias.length) * 100)
        : 0,
      emptyCategories: apiCategorias.filter(category => !categoryHasProduct(category)).length,
      orphanProducts: apiProdutos.filter(product => !productHasCategory(product)).length,
      activeDestinations: Number(destinationSummary.COZINHA > 0) + Number(destinationSummary.BAR > 0),
    };
  }, [apiCategorias, apiProdutos, destinationSummary]);

  const handleOpenCreate = () => {
    setEditingCategory(null);
    setModalOpen(true);
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

      <section className="koma-toolbar">
        <div className="koma-toolbar__search">
          <Search size={14} aria-hidden="true" />
          <input type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar categoria…" aria-label="Buscar categorias" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca"><X size={13} /></button>}
        </div>
        <p className="shrink-0 text-[10px] font-medium text-koma-muted">
          <strong className="font-mono text-koma-foreground">{apiCategorias.length}</strong> categorias · {catalogInsights.emptyCategories} vazias · {catalogInsights.routeCoverage}% com impressão
        </p>
        <div className="koma-toolbar__actions">
          <button type="button" onClick={handleOpenCreate} className="koma-btn-success"><Plus size={14} /> Nova categoria</button>
        </div>
      </section>

      {filteredCategories.length === 0 ? (
        <KomaEmptyState
          icon={Layers3}
          title={apiCategorias.length === 0 ? 'Crie a primeira categoria' : 'Nenhuma categoria encontrada'}
          description={apiCategorias.length === 0 ? 'Categorias agrupam produtos e definem o destino de impressão dos pedidos.' : 'Limpe a busca para voltar a ver todas as categorias.'}
          action={apiCategorias.length === 0 ? { label: 'Nova categoria', onClick: handleOpenCreate, icon: Plus } : { label: 'Limpar busca', onClick: () => setSearch(''), variant: 'secondary' }}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel">
          {filteredCategories.map((category) => {
            const meta = destinationMeta[category.destino_impressao as keyof typeof destinationMeta] || destinationMeta.NENHUM;
            const Icon = meta.icon;
            const productCount = apiProdutos.filter(product => (
              String(product.categoria_id || product.categoria) === String(category.id)
              || product.categoria === category.nome
            )).length;
            return (
              <article key={category.id} className="group grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-koma-border px-3 py-2.5 transition-colors last:border-b-0 hover:bg-koma-raised/50 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_auto] sm:px-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', meta.className)}><Icon size={15} /></span>
                  <div className="min-w-0">
                    <h2 className="truncate text-xs font-bold text-koma-foreground">{category.nome}</h2>
                    <p className="mt-0.5 text-[9px] text-koma-muted">{productCount} {productCount === 1 ? 'produto' : 'produtos'} · <span className="font-mono">{category.id}</span></p>
                  </div>
                </div>
                <span className={clsx('hidden w-fit rounded-full border px-2.5 py-1 text-[9px] font-bold sm:inline-flex sm:items-center sm:gap-1.5', meta.className)}><Icon size={11} /> {meta.label}</span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => { setEditingCategory(category); setModalOpen(true); }} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[9px] font-bold text-koma-subtle transition-colors hover:bg-koma-raised hover:text-koma-foreground cursor-pointer"><Edit3 size={12} /> <span className="hidden sm:inline">Editar</span></button>
                  <button type="button" onClick={() => { setDeletingCategory(category); setDeleteModalOpen(true); }} className="rounded-lg p-1.5 text-koma-muted transition-colors hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-300 cursor-pointer" title="Excluir categoria" aria-label={`Excluir ${category.nome}`}><Trash2 size={13} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <CategoriaModal isOpen={modalOpen} onClose={() => setModalOpen(false)} categoryToEdit={editingCategory} apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} onSuccess={fetchCategorias} showToast={showToast} />
      <DeleteCategoryModal isOpen={deleteModalOpen} categoryName={deletingCategory?.nome || ''} onClose={() => setDeleteModalOpen(false)} onConfirm={handleDeleteConfirm} />
    </div>
  );
}
