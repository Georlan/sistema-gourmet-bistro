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
    className: 'border-orange-400/15 bg-orange-400/[0.06] text-orange-300',
  },
  BAR: {
    label: 'Bar',
    description: 'Os pedidos desta categoria saem no bar.',
    icon: GlassWater,
    className: 'border-sky-400/15 bg-sky-400/[0.06] text-sky-300',
  },
  NENHUM: {
    label: 'Sem impressão',
    description: 'A categoria não gera uma via de preparação.',
    icon: Printer,
    className: 'border-zinc-600/30 bg-zinc-800/35 text-zinc-400',
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
          { label: 'com rota de impressão', value: `${catalogInsights.routeCoverage}%`, valueClassName: catalogInsights.routeCoverage === 100 ? 'text-emerald-300' : 'text-amber-300' },
          { label: 'categorias vazias', value: catalogInsights.emptyCategories, valueClassName: catalogInsights.emptyCategories > 0 ? 'text-amber-300' : 'text-emerald-300' },
          { label: 'produtos sem categoria', value: catalogInsights.orphanProducts, valueClassName: catalogInsights.orphanProducts > 0 ? 'text-amber-300' : 'text-emerald-300' },
          { label: 'destinos ativos', value: catalogInsights.activeDestinations, valueClassName: 'text-sky-300' },
        ]}
      />

      <section className="flex flex-col gap-3 rounded-[22px] border border-white/[0.065] bg-[#101311] p-3.5 sm:flex-row sm:items-center sm:p-4">
        <div className="relative w-full flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600" size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar categoria…" className="h-11 w-full rounded-xl border border-white/[0.07] bg-black/20 pl-10 pr-10 text-[11px] text-white outline-none placeholder:text-zinc-600 focus:border-emerald-400/30" />
          {search && <button type="button" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-zinc-600 hover:text-white" aria-label="Limpar busca"><X size={13} /></button>}
        </div>
        <button type="button" onClick={handleOpenCreate} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3 text-[10px] font-black text-[#07110d] transition-colors hover:bg-emerald-300">
          <Plus size={14} /> Nova categoria
        </button>
      </section>

      {filteredCategories.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-[#101311] px-6 text-center">
          <Layers3 size={28} className="text-zinc-700" />
          <strong className="mt-4 text-sm text-zinc-300">Nenhuma categoria encontrada</strong>
          <p className="mt-1 text-[10px] text-zinc-600">Ajuste a busca ou crie uma nova categoria.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredCategories.map((category) => {
            const meta = destinationMeta[category.destino_impressao as keyof typeof destinationMeta] || destinationMeta.NENHUM;
            const Icon = meta.icon;
            return (
              <article key={category.id} className="group flex min-h-[160px] flex-col justify-between rounded-[22px] border border-white/[0.07] bg-[#101311] p-4 shadow-[0_18px_50px_rgba(0,0,0,.16)] transition-colors hover:border-white/[0.11]">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <span className={clsx('flex h-10 w-10 items-center justify-center rounded-xl border', meta.className)}><Icon size={16} /></span>
                    <span className="max-w-[60%] truncate rounded-full border border-white/[0.07] bg-black/20 px-2 py-1 font-mono text-[8px] text-zinc-600">{category.id}</span>
                  </div>
                  <h2 className="mt-4 text-sm font-bold text-zinc-100">{category.nome}</h2>
                  <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">{meta.description}</p>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-white/[0.055] pt-3">
                  <span className={clsx('text-[9px] font-bold', meta.className.split(' ').at(-1))}>{meta.label}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => { setEditingCategory(category); setModalOpen(true); }} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[9px] font-bold text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-white"><Edit3 size={12} /> Editar</button>
                    <button type="button" onClick={() => { setDeletingCategory(category); setDeleteModalOpen(true); }} className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-rose-500/10 hover:text-rose-300" title="Excluir categoria" aria-label={`Excluir ${category.nome}`}><Trash2 size={13} /></button>
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
