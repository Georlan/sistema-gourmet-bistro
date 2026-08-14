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
import { OperationalBanner } from '../shared/OperationalBanner';
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
    <div className="orders-workspace w-full space-y-4 pb-8 text-left animate-fade-in">
      <OperationalBanner
        id="catalog-categories-heading"
        eyebrow="ORGANIZAÇÃO DO CARDÁPIO"
        title="Categorias"
        accent="prontas para produzir"
        description="Organize os produtos e defina para onde cada pedido será enviado na operação."
        metrics={[
          { label: 'Com rota de impressão', value: `${Math.round((apiCategorias.filter((c) => c.destino_impressao !== 'NENHUM').length / (apiCategorias.length || 1)) * 100)}%` },
          { label: 'Categorias vazias', value: apiCategorias.filter((c) => !apiProdutos.some((p) => String(p.categoria_id) === String(c.id))).length },
          { label: 'Produtos sem categoria', value: apiProdutos.filter((p) => !p.categoria_id).length },
          { label: 'Destinos ativos', value: new Set(apiCategorias.map((c) => c.destino_impressao)).size },
        ]}
      />

      <section className="flex flex-col gap-3 rounded-[22px] border border-koma-border bg-koma-panel p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-koma-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar categoria..."
            className="w-full rounded-xl border border-koma-border bg-koma-input py-2 pl-9 pr-3 text-xs text-koma-foreground placeholder:text-koma-muted focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <button type="button" onClick={handleOpenCreate} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-[10px] font-black text-zinc-950 transition-colors hover:bg-emerald-400 cursor-pointer shadow-sm">
          <Plus size={14} /> Nova categoria
        </button>
      </section>

      {filteredCategories.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-[22px] border border-dashed border-koma-border bg-koma-panel px-6 text-center">
          <Layers3 size={28} className="text-koma-muted" />
          <strong className="mt-4 text-sm text-koma-secondary">Nenhuma categoria encontrada</strong>
          <p className="mt-1 text-[10px] text-koma-muted">Ajuste a busca ou crie uma nova categoria.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredCategories.map((category) => {
            const meta = destinationMeta[category.destino_impressao as keyof typeof destinationMeta] || destinationMeta.NENHUM;
            const Icon = meta.icon;
            return (
              <article key={category.id} className="group flex min-h-[160px] flex-col justify-between rounded-[22px] border border-koma-border bg-koma-card p-4 shadow-sm transition-colors hover:border-koma-border-strong">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <span className={clsx('flex h-10 w-10 items-center justify-center rounded-xl border', meta.className)}><Icon size={16} /></span>
                    <span className="max-w-[60%] truncate rounded-full border border-koma-border bg-koma-input px-2 py-1 font-mono text-[8px] text-koma-muted">{category.id}</span>
                  </div>
                  <h2 className="mt-4 text-sm font-bold text-koma-foreground">{category.nome}</h2>
                  <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">{meta.description}</p>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-koma-border pt-3">
                  <span className={clsx('text-[9px] font-bold', meta.className.split(' ').at(-1))}>{meta.label}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => { setEditingCategory(category); setModalOpen(true); }} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[9px] font-bold text-koma-subtle transition-colors hover:bg-white/[0.05] hover:text-koma-foreground cursor-pointer"><Edit3 size={12} /> Editar</button>
                    <button type="button" onClick={() => { setDeletingCategory(category); setDeleteModalOpen(true); }} className="rounded-lg p-2 text-koma-muted transition-colors hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-300 cursor-pointer" title="Excluir categoria" aria-label={`Excluir ${category.nome}`}><Trash2 size={13} /></button>
                  </div>
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
