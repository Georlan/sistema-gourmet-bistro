import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Check,
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
  hasPrinting?: boolean;
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
  hasPrinting = true,
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
  const [reorderingId, setReorderingId] = useState<string | null>(null);

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
    });
  }, [apiCategorias, destinationFilter, search]);

  const handleMoveCategory = async (categoryId: string | number, direction: 'up' | 'down') => {
    const idStr = String(categoryId);
    const currentFilteredIndex = filteredCategories.findIndex((c) => String(c.id) === idStr);
    if (currentFilteredIndex < 0) return;
    const targetFilteredIndex = direction === 'up' ? currentFilteredIndex - 1 : currentFilteredIndex + 1;
    if (targetFilteredIndex < 0 || targetFilteredIndex >= filteredCategories.length) return;

    const targetCategory = filteredCategories[targetFilteredIndex];
    const currentGlobalIndex = apiCategorias.findIndex((c) => String(c.id) === idStr);
    const targetGlobalIndex = apiCategorias.findIndex((c) => String(c.id) === String(targetCategory.id));
    if (currentGlobalIndex < 0 || targetGlobalIndex < 0) return;

    const newCategories = [...apiCategorias];
    const [moved] = newCategories.splice(currentGlobalIndex, 1);
    newCategories.splice(targetGlobalIndex, 0, moved);

    const categoria_ids = newCategories.map((c) => String(c.id));
    setReorderingId(idStr);
    try {
      const response = await fetch(`${apiBaseUrl}/produtos/categorias/reordenar`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoria_ids }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        showToast?.(payload.detail || 'Não foi possível reordenar categorias.', 'error');
        return;
      }
      showToast?.('Ordem das categorias atualizada.', 'success');
      await fetchCategorias();
    } catch (error) {
      console.error(error);
      showToast?.('Erro de conexão ao reordenar categorias.', 'error');
    } finally {
      setReorderingId(null);
    }
  };

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
      label: value === 'NENHUM' && !hasPrinting ? 'Sem preparo' : destinationMeta[value].shortLabel,
      description: destinationMeta[value].description,
      icon: destinationMeta[value].icon,
    })),
  ];

  return (
    <div className="w-full space-y-4 pb-8 text-left animate-fade-in" aria-labelledby="catalog-categories-heading">
      <h1 id="catalog-categories-heading" className="sr-only">{hasPrinting ? 'Preparo e impressão do cardápio' : 'Preparo do cardápio'}</h1>

      <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4" aria-label={hasPrinting ? 'Rotas de impressão' : 'Rotas de preparo'}>
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
                'flex min-h-24 items-start gap-3 rounded-2xl border p-4 text-left transition',
                active
                  ? 'border-transparent'
                  : 'border-koma-border bg-koma-card hover:border-koma-border-strong hover:bg-koma-raised',
              )}
              style={
                active
                  ? {
                      background: 'var(--koma-success-bg)',
                      borderColor: 'var(--koma-success-border)',
                    }
                  : undefined
              }
            >
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border"
                style={
                  active
                    ? {
                        background: 'var(--koma-surface-card)',
                        borderColor: 'var(--koma-success-border)',
                        color: 'var(--koma-success-text)',
                      }
                    : {
                        background: 'var(--koma-surface-raised)',
                        borderColor: 'var(--koma-border-default)',
                        color: 'var(--koma-text-secondary)',
                      }
                }
              >
                <Icon size={18} />
              </span>
              <span className="min-w-0">
                <span
                  className="block text-sm font-bold text-koma-foreground"
                  style={{ fontFamily: 'var(--koma-font-display)' }}
                >
                  {card.label}
                </span>
                <span className="mt-1 block text-xs leading-4 text-koma-secondary">{card.description}</span>
                <span
                  className="mt-2 block text-xs font-bold tabular-nums"
                  style={{ color: 'var(--koma-success-text)' }}
                >
                  {stats.categories} categoria{stats.categories === 1 ? '' : 's'} · {stats.products} produto{stats.products === 1 ? '' : 's'}
                </span>
              </span>
            </button>
          );
        })}
      </section>

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-3" aria-label="Ferramentas de impressão">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative min-w-0 flex-1">
            <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar categoria..."
              aria-label="Buscar categorias"
              className="h-11 w-full rounded-xl border border-koma-border bg-koma-input pl-10 pr-10 text-sm text-koma-foreground placeholder:text-koma-muted outline-none transition focus:border-koma-border-strong"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca" className="absolute right-3 top-1/2 -translate-y-1/2 text-koma-muted hover:text-koma-foreground">
                <X size={15} />
              </button>
            )}
          </label>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold transition"
            style={{
              background: 'var(--koma-action-bg)',
              color: 'var(--koma-action-text)',
            }}
          >
            <Plus size={16} /> Nova categoria
          </button>
        </div>
      </section>

      {orphanProducts > 0 && (
        <section
          className="rounded-2xl border px-4 py-3 text-sm"
          style={{
            background: 'var(--koma-danger-bg)',
            borderColor: 'var(--koma-danger-border)',
            color: 'var(--koma-danger-text)',
          }}
        >
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
            <p className="text-xs font-bold text-koma-secondary tabular-nums">
              {filteredCategories.length} de {apiCategorias.length} categorias
            </p>
            <p className="text-xs text-koma-muted">Troque a impressão diretamente em cada cartão.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3" aria-label="Categorias e impressão">
            {filteredCategories.map((category, index) => {
              const destination = normalizeDestination(category.destino_impressao);
              const meta = destinationMeta[destination];
              const DestinationIcon = meta.icon;
              const productCount = productCountByCategory.get(String(category.id)) || 0;
              const pending = pendingRouteCategoryId === String(category.id);
              return (
                <article key={category.id} className="rounded-2xl border border-koma-border bg-koma-card p-4 transition hover:border-koma-border-strong">
                  <div className="flex items-start gap-3">
                    <span
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border"
                      style={{
                        background: 'var(--koma-success-bg)',
                        borderColor: 'var(--koma-success-border)',
                        color: 'var(--koma-success-text)',
                      }}
                    >
                      <DestinationIcon size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="inline-block rounded-md border border-koma-border bg-koma-raised px-1.5 py-0.5 text-xs font-bold text-koma-secondary tabular-nums"
                          title={`Posição #${index + 1}${category.ordem_exibicao != null ? ` (ordem: ${category.ordem_exibicao})` : ''}`}
                        >
                          #{index + 1}
                        </span>
                        <h2
                          className="truncate text-sm font-bold text-koma-foreground"
                          style={{ fontFamily: 'var(--koma-font-display)' }}
                        >
                          {category.nome}
                        </h2>
                      </div>
                      {productCount > 0 && onManageProducts ? (
                        <button
                          type="button"
                          onClick={() => onManageProducts(String(category.id))}
                          className="mt-1 text-xs font-bold hover:underline tabular-nums"
                          style={{ color: 'var(--koma-success-text)' }}
                        >
                          Ver {productCount} {productCount === 1 ? 'produto' : 'produtos'}
                        </button>
                      ) : (
                        <p className="mt-1 text-xs font-semibold text-koma-muted">Categoria vazia</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleMoveCategory(category.id, 'up')}
                        disabled={index === 0 || reorderingId !== null}
                        aria-label={`Mover ${category.nome} para cima`}
                        title="Mover para cima"
                        className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-koma-border bg-koma-panel text-koma-secondary transition hover:border-koma-border-strong hover:text-koma-foreground disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMoveCategory(category.id, 'down')}
                        disabled={index === filteredCategories.length - 1 || reorderingId !== null}
                        aria-label={`Mover ${category.nome} para baixo`}
                        title="Mover para baixo"
                        className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-koma-border bg-koma-panel text-koma-secondary transition hover:border-koma-border-strong hover:text-koma-foreground disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ArrowDown size={15} />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setEditingCategory(category); setModalOpen(true); }}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3 text-xs font-bold text-koma-foreground transition hover:bg-koma-panel"
                    >
                      <Edit3 size={14} /> Editar
                    </button>
                    <details className="relative shrink-0">
                      <summary className="grid min-h-11 min-w-11 cursor-pointer list-none place-items-center rounded-xl border border-koma-border bg-koma-panel text-koma-muted hover:border-koma-border-strong hover:text-koma-foreground" aria-label={`Mais ações para ${category.nome}`}>
                        <MoreHorizontal size={16} />
                      </summary>
                      <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-koma-border bg-koma-dialog p-1.5 shadow-xl">
                        <button
                          type="button"
                          onClick={() => { setDeletingCategory(category); setDeleteModalOpen(true); }}
                          className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold hover:bg-koma-raised"
                          style={{ color: 'var(--koma-danger-text)' }}
                        >
                          <Trash2 size={14} /> Excluir categoria
                        </button>
                      </div>
                    </details>
                  </div>

                  <div className="mt-4 border-t border-koma-border pt-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-koma-muted">
                      Onde imprimir este grupo?
                    </p>
                    <div
                      className="mt-2 grid grid-cols-3 gap-2"
                      role="group"
                      aria-label={`Escolher impressão para ${category.nome}`}
                      aria-busy={pending}
                    >
                      {(['COZINHA', 'BAR', 'NENHUM'] as const).map((route) => {
                        const routeMeta = destinationMeta[route];
                        const RouteIcon = routeMeta.icon;
                        const selected = destination === route;
                        return (
                          <button
                            key={route}
                            type="button"
                            onClick={() => void handleRouteChange(category, route)}
                            disabled={pendingRouteCategoryId !== null}
                            aria-pressed={selected}
                            aria-label={`${route === 'NENHUM' && !hasPrinting ? 'Sem preparo' : routeMeta.label} para ${category.nome}`}
                            title={routeMeta.description}
                            className={clsx(
                              'relative flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-center text-xs font-bold leading-tight outline-none transition disabled:cursor-wait disabled:opacity-55',
                              selected
                                ? 'border-transparent'
                                : 'border-koma-border bg-koma-panel text-koma-secondary hover:border-koma-border-strong hover:bg-koma-raised hover:text-koma-foreground',
                            )}
                            style={
                              selected
                                ? {
                                    background: 'var(--kc-chrome-selected, var(--koma-action-bg))',
                                    color: 'var(--kc-chrome-on-selected, var(--koma-action-text))',
                                  }
                                : undefined
                            }
                          >
                            {selected && (
                              <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full" aria-hidden="true">
                                <Check size={12} strokeWidth={3} />
                              </span>
                            )}
                            <RouteIcon size={17} aria-hidden="true" />
                            <span>{route === 'NENHUM' ? (hasPrinting ? 'Não imprimir' : 'Sem preparo') : routeMeta.shortLabel}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 min-h-4 text-xs text-koma-muted" aria-live="polite">
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
