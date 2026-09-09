/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Edit3,
  FileText,
  Minus,
  Plus,
  Search,
  Settings2,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';

import type { CatalogCategory, CatalogModifierGroup } from '../catalog/catalog';
import { getProductPresets, obterNomeCategoria, smartSearchMatch } from '../domain';
import type { AppSettings, DraftItem, Order, Product } from '../types';

interface MenuPanelProps {
  tableId: number;
  draftItems: DraftItem[];
  existingOrders: Order[];
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  onAddToDraft: (product: Product, quantity?: number, observacao?: string, clienteNome?: string) => void;
  onRemoveFromDraft: (draftItemId: string) => void;
  onUpdateDraftItem: (draftItemId: string, fields: Partial<DraftItem>) => void;
  onEditDraftItems: (
    draftItemIds: string[],
    fields: Pick<DraftItem, 'quantidade' | 'observacao' | 'clienteNome'>,
  ) => void;
  onSubmitDraft: (orderType: 'Consumo no Local' | 'Retirada' | 'Entrega') => void;
  historicClients?: string[];
  liveProdutos?: Product[];
  liveCategorias?: CatalogCategory[];
  catalogReady?: boolean;
  isSubmitting?: boolean;
  allowExternalOrders?: boolean;
}

type ModifierSelection = {
  id: string;
  nome: string;
  preco: number;
};

type DraftWithModifiers = DraftItem & {
  modificadorIds?: string[];
  modificadoresSelecionados?: ModifierSelection[];
  precoBase?: number;
};

type ProductWithModifiers = Product & {
  ativo?: boolean;
  categoria_id?: string;
  grupos_modificadores?: CatalogModifierGroup[];
  __selectedModifierIds?: string[];
  __selectedModifiers?: ModifierSelection[];
  __selectedModifierTotal?: number;
};

const productModifierGroups = (product: Product | null): CatalogModifierGroup[] => {
  if (!product) return [];
  return (product as ProductWithModifiers).grupos_modificadores || [];
};

const modifierSelectionsFor = (
  groups: CatalogModifierGroup[],
  selectedIds: string[],
): ModifierSelection[] => {
  const selected = new Set(selectedIds);
  return groups.flatMap((group) => group.opcoes)
    .filter((option) => option.ativo !== false && selected.has(option.id))
    .map((option) => ({
      id: option.id,
      nome: option.nome,
      preco: Number(option.preco_adicional || 0),
    }));
};

export const MenuPanel: React.FC<MenuPanelProps> = ({
  tableId,
  draftItems,
  existingOrders,
  settings,
  onUpdateSettings,
  onAddToDraft,
  onRemoveFromDraft,
  onUpdateDraftItem,
  onEditDraftItems,
  onSubmitDraft,
  historicClients = [],
  liveProdutos = [],
  liveCategorias = [],
  catalogReady = false,
  isSubmitting = false,
  allowExternalOrders = true,
}) => {
  const [view, setView] = useState<'cart' | 'menu'>(() => draftItems.length > 0 ? 'cart' : 'menu');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [orderType, setOrderType] = useState<'Consumo no Local' | 'Retirada'>('Consumo no Local');

  const [selectedProductToConfigure, setSelectedProductToConfigure] = useState<Product | null>(null);
  const [editingDraftItemId, setEditingDraftItemId] = useState<string | null>(null);
  const [configQty, setConfigQty] = useState(1);
  const [configObs, setConfigObs] = useState('');
  const [configClient, setConfigClient] = useState('');
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);

  React.useEffect(() => {
    if (!allowExternalOrders && orderType !== 'Consumo no Local') {
      setOrderType('Consumo no Local');
    }
  }, [allowExternalOrders, orderType]);

  const activeProducts = useMemo(
    () => liveProdutos.filter((product) => (product as ProductWithModifiers).ativo !== false),
    [liveProdutos],
  );

  const categoriesList = useMemo(() => {
    const activeCategoryIds = new Set(
      activeProducts
        .map((product) => (product as ProductWithModifiers).categoria_id)
        .filter((id): id is string => Boolean(id)),
    );
    return liveCategorias.filter((category) => activeCategoryIds.has(category.id));
  }, [activeProducts, liveCategorias]);

  React.useEffect(() => {
    if (categoriesList.length === 0) {
      setSelectedCategory('');
      return;
    }
    if (!categoriesList.some((category) => category.nome === selectedCategory)) {
      setSelectedCategory(categoriesList[0].nome);
    }
  }, [categoriesList, selectedCategory]);

  const combinedSuggestions = useMemo(() => {
    const names = new Map<string, string>();
    const pushName = (rawName?: string) => {
      const name = (rawName || '').trim();
      if (!name) return;
      const key = name.toLocaleLowerCase('pt-BR');
      if (!names.has(key)) names.set(key, name);
    };
    historicClients.forEach(pushName);
    existingOrders.forEach((order) => order.itens.forEach((item) => pushName(item.clienteNome)));
    draftItems.forEach((item) => pushName(item.clienteNome));
    return Array.from(names.values());
  }, [draftItems, existingOrders, historicClients]);

  const totalDraftQty = draftItems.reduce((sum, item) => sum + (item.quantidade || 1), 0);
  const draftTotal = draftItems.reduce(
    (sum, item) => sum + Number(item.preco || 0) * (item.quantidade || 1),
    0,
  );

  const currentGroups = productModifierGroups(selectedProductToConfigure);
  const selectedModifierOptions = useMemo(
    () => modifierSelectionsFor(currentGroups, selectedModifierIds),
    [currentGroups, selectedModifierIds],
  );
  const modifierTotal = selectedModifierOptions.reduce((sum, option) => sum + option.preco, 0);
  const configUnitTotal = Number(selectedProductToConfigure?.preco || 0) + modifierTotal;

  const modifierSelectionValid = currentGroups.every((group) => {
    const optionIds = new Set(group.opcoes.filter((option) => option.ativo !== false).map((option) => option.id));
    const count = selectedModifierIds.filter((id) => optionIds.has(id)).length;
    return count >= Number(group.min_selecoes || 0) && count <= Number(group.max_selecoes || 1);
  });

  const scrollPanelToTop = () => {
    requestAnimationFrame(() => {
      document.getElementById('mesa-details-scroll-body')?.scrollTo({ top: 0, behavior: 'auto' });
    });
  };

  const openMenu = () => {
    setView('menu');
    scrollPanelToTop();
  };

  const openCart = () => {
    setView('cart');
    scrollPanelToTop();
  };

  const closeProductConfig = () => {
    setSelectedProductToConfigure(null);
    setEditingDraftItemId(null);
    setSelectedModifierIds([]);
  };

  const handleOpenConfig = (product: Product, draftItem?: DraftItem) => {
    const draft = draftItem as DraftWithModifiers | undefined;
    setSelectedProductToConfigure(product);
    setEditingDraftItemId(draft?.id || null);
    setConfigQty(draft?.quantidade || 1);
    setConfigObs(draft?.observacao || '');
    setConfigClient(
      draft?.clienteNome
        || (draftItems.length > 0 ? draftItems[0].clienteNome || '' : ''),
    );
    setSelectedModifierIds([...(draft?.modificadorIds || [])]);
  };

  const toggleModifier = (group: CatalogModifierGroup, optionId: string) => {
    setSelectedModifierIds((current) => {
      const groupOptionIds = new Set(group.opcoes.map((option) => option.id));
      const isSelected = current.includes(optionId);
      if (isSelected) {
        return current.filter((id) => id !== optionId);
      }

      const selectedInGroup = current.filter((id) => groupOptionIds.has(id));
      const max = Math.max(1, Number(group.max_selecoes || 1));
      if (max === 1) {
        return [...current.filter((id) => !groupOptionIds.has(id)), optionId];
      }
      if (selectedInGroup.length >= max) return current;
      return [...current, optionId];
    });
  };

  const handleConfirmAdd = () => {
    if (!selectedProductToConfigure || !modifierSelectionValid) return;

    const modifierMeta = {
      modificadorIds: [...selectedModifierIds],
      modificadoresSelecionados: selectedModifierOptions,
      precoBase: Number(selectedProductToConfigure.preco),
    };

    if (editingDraftItemId) {
      onEditDraftItems(
        [editingDraftItemId],
        {
          quantidade: configQty,
          observacao: configObs,
          clienteNome: configClient,
          ...modifierMeta,
        } as any,
      );
    } else {
      const decoratedProduct = {
        ...selectedProductToConfigure,
        __selectedModifierIds: modifierMeta.modificadorIds,
        __selectedModifiers: modifierMeta.modificadoresSelecionados,
        __selectedModifierTotal: modifierTotal,
      } as ProductWithModifiers;
      onAddToDraft(decoratedProduct as Product, configQty, configObs, configClient);
    }

    closeProductConfig();
    openCart();
  };

  const handleQuickAdd = (product: Product, event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (productModifierGroups(product).length > 0) {
      handleOpenConfig(product);
      return;
    }

    const defaultClient = draftItems.length > 0 ? draftItems[0].clienteNome || '' : '';
    const compatibleDraft = draftItems.find((item) => {
      const decorated = item as DraftWithModifiers;
      return item.produtoId === product.id
        && !item.observacao
        && (item.clienteNome || '') === defaultClient
        && (decorated.modificadorIds || []).length === 0;
    });
    if (compatibleDraft) {
      onUpdateDraftItem(compatibleDraft.id, {
        quantidade: (compatibleDraft.quantidade || 1) + 1,
      });
      return;
    }
    onAddToDraft(product, 1, '', defaultClient);
  };

  const handleQuickSubtract = (product: Product, event?: React.MouseEvent) => {
    event?.stopPropagation();
    const matching = draftItems.filter((item) => item.produtoId === product.id);
    if (matching.length === 0) return;
    const item = matching[matching.length - 1];
    if ((item.quantidade || 1) > 1) {
      onUpdateDraftItem(item.id, { quantidade: (item.quantidade || 1) - 1 });
    } else {
      onRemoveFromDraft(item.id);
    }
  };

  return (
    <div className="relative sm:h-full">
      {view === 'cart' && (
        <div className="bg-koma-panel sm:border sm:border-koma-border sm:rounded-2xl p-3 sm:p-5 pb-24 sm:pb-5 flex flex-col sm:h-full max-w-2xl mx-auto">
          <div className="flex items-center justify-between gap-3 border-b border-koma-border pb-3">
            <div className="flex items-center gap-2 min-w-0">
              <ShoppingCart size={16} className="text-emerald-400 shrink-0" />
              <h3 className="font-serif font-bold text-sm sm:text-base text-koma-foreground">Revisar Pedido</h3>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-400">
                {totalDraftQty} {totalDraftQty === 1 ? 'item' : 'itens'}
              </span>
            </div>
            <button
              type="button"
              onClick={openMenu}
              className="min-h-9 px-3 rounded-xl bg-emerald-500 text-zinc-950 text-xs font-bold inline-flex items-center gap-1"
            >
              <Plus size={13} /> Adicionar
            </button>
          </div>

          {draftItems.length === 0 ? (
            <div className="py-12 text-center flex-1 flex flex-col items-center justify-center gap-3">
              <p className="text-sm font-semibold text-koma-foreground">Nenhum item no pedido</p>
              <p className="text-xs text-koma-muted">Escolha os produtos da Mesa {tableId}.</p>
              <button type="button" onClick={openMenu} className="koma-btn-primary px-5 py-2.5 rounded-xl text-xs font-bold">
                Abrir cardápio
              </button>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col gap-4 pt-4">
              <div className="bg-koma-raised border border-koma-border p-3 rounded-xl space-y-2">
                <label htmlFor="overall-client-name" className="text-[10px] font-bold text-koma-muted uppercase tracking-wider">
                  Cliente do pedido <span className="normal-case font-normal">(opcional)</span>
                </label>
                <input
                  id="overall-client-name"
                  value={draftItems[0]?.clienteNome || ''}
                  onChange={(event) => draftItems.forEach((item) => onUpdateDraftItem(item.id, { clienteNome: event.target.value }))}
                  placeholder="Ex: Pedro, Cláudia, Família..."
                  className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500"
                />
                {combinedSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {combinedSuggestions.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => draftItems.forEach((item) => onUpdateDraftItem(item.id, { clienteNome: name }))}
                        className="px-2 py-1 text-[9px] rounded-lg border border-koma-border bg-koma-card text-koma-muted hover:text-koma-foreground"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2 sm:max-h-[42vh] sm:overflow-y-auto sm:pr-1">
                {draftItems.map((item, index) => {
                  const decorated = item as DraftWithModifiers;
                  const product = liveProdutos.find((candidate) => candidate.id === item.produtoId);
                  return (
                    <div key={item.id} id={`draft-item-${item.id}`} className="p-3 bg-koma-card border border-koma-border rounded-xl space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full border border-koma-border text-[10px] font-mono flex items-center justify-center text-koma-subtle">{index + 1}</span>
                            <span className="text-xs font-bold text-koma-foreground">{item.nome}</span>
                          </div>
                          {decorated.modificadoresSelecionados && decorated.modificadoresSelecionados.length > 0 && (
                            <div className="mt-1 ml-7 flex flex-wrap gap-1">
                              {decorated.modificadoresSelecionados.map((option) => (
                                <span key={option.id} className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-[9px] text-emerald-400 border border-emerald-500/20">
                                  + {option.nome}
                                </span>
                              ))}
                            </div>
                          )}
                          {item.clienteNome && (
                            <span className="ml-7 text-[9px] uppercase font-bold text-emerald-400">Para: {item.clienteNome}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-xs font-mono font-bold text-emerald-400">
                            R$ {(Number(item.preco) * (item.quantidade || 1)).toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() => product && handleOpenConfig(product, item)}
                            className="p-1.5 rounded-lg text-koma-muted hover:text-emerald-400 hover:bg-koma-raised"
                            title="Editar item e complementos"
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            id={`remove-draft-item-${item.id}`}
                            type="button"
                            onClick={() => onRemoveFromDraft(item.id)}
                            className="p-1.5 rounded-lg text-koma-muted hover:text-rose-400 hover:bg-rose-500/10"
                            title="Remover item"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 border-t border-koma-border pt-2">
                        <div className="flex items-center gap-1 bg-koma-raised border border-koma-border rounded-lg p-0.5">
                          <button
                            type="button"
                            onClick={() => (item.quantidade || 1) > 1
                              ? onUpdateDraftItem(item.id, { quantidade: (item.quantidade || 1) - 1 })
                              : onRemoveFromDraft(item.id)}
                            className="p-1.5 text-koma-muted hover:text-rose-400"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="px-2 text-xs font-mono font-bold text-koma-foreground">{item.quantidade || 1}</span>
                          <button
                            type="button"
                            onClick={() => onUpdateDraftItem(item.id, { quantidade: (item.quantidade || 1) + 1 })}
                            className="p-1.5 text-koma-muted hover:text-emerald-400"
                          >
                            <Plus size={12} />
                          </button>
                        </div>

                        <div className="flex-1 relative">
                          <FileText size={11} className="absolute left-2.5 top-2.5 text-koma-subtle" />
                          <input
                            value={item.observacao}
                            onChange={(event) => onUpdateDraftItem(item.id, { observacao: event.target.value })}
                            placeholder="Observação de preparo..."
                            className="w-full pl-7 pr-2 py-2 bg-koma-input border border-koma-border rounded-lg text-[11px] text-koma-foreground focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-auto border-t border-koma-border pt-4 space-y-3">
                <div className={`${allowExternalOrders ? 'grid-cols-2' : 'grid-cols-1'} grid gap-1 bg-koma-card border border-koma-border rounded-xl p-1`}>
                  <button
                    type="button"
                    onClick={() => setOrderType('Consumo no Local')}
                    className={`py-2 text-xs font-bold rounded-lg ${orderType === 'Consumo no Local' ? 'bg-emerald-500/20 text-emerald-400' : 'text-koma-muted'}`}
                  >
                    Consumo no Local
                  </button>
                  {allowExternalOrders && (
                    <button
                      type="button"
                      onClick={() => setOrderType('Retirada')}
                      className={`py-2 text-xs font-bold rounded-lg ${orderType === 'Retirada' ? 'bg-emerald-500/20 text-emerald-400' : 'text-koma-muted'}`}
                    >
                      Retirada (Balcão)
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-koma-muted">Subtotal</span>
                  <span className="text-xl font-mono font-bold text-emerald-400">R$ {draftTotal.toFixed(2)}</span>
                </div>

                <button
                  id="submit-draft-order-btn"
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => onSubmitDraft(orderType)}
                  className="hidden sm:flex w-full min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-zinc-950 text-sm font-extrabold disabled:opacity-50"
                >
                  {isSubmitting ? 'Lançando...' : 'Lançar Pedido'} <ArrowRight size={15} />
                </button>
              </div>

              <div className="sm:hidden fixed inset-x-0 bottom-0 z-[80] border-t border-emerald-500/20 bg-koma-card/95 px-3 pt-2 pb-[calc(0.65rem+env(safe-area-inset-bottom))] backdrop-blur-xl">
                <div className="mx-auto flex max-w-2xl items-center gap-3">
                  <div className="min-w-[100px]">
                    <span className="block text-[9px] uppercase font-bold text-koma-muted">Total</span>
                    <span className="font-mono text-lg font-bold text-emerald-400">R$ {draftTotal.toFixed(2)}</span>
                  </div>
                  <button
                    id="submit-draft-order-btn-mobile"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => onSubmitDraft(orderType)}
                    className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-black text-sm font-bold disabled:opacity-50"
                  >
                    {isSubmitting ? 'Lançando...' : 'Lançar pedido'} <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'menu' && (
        <div className="max-w-4xl mx-auto bg-koma-panel sm:border sm:border-koma-border sm:rounded-3xl overflow-hidden">
          <div className="sticky top-0 z-30 bg-koma-panel px-3 sm:px-5 py-2.5 border-b border-koma-border space-y-2 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-2.5 text-koma-subtle" />
                <input
                  id="search-products-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Buscar no cardápio..."
                  className="w-full pl-9 pr-8 py-2 bg-koma-input border border-koma-border rounded-xl text-xs sm:text-sm text-koma-foreground focus:outline-none focus:border-emerald-500"
                />
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2.5 text-koma-muted">
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="relative">
                <button
                  id="toggle-menu-settings"
                  type="button"
                  onClick={() => setShowSettings((current) => !current)}
                  className="p-2 rounded-xl bg-koma-card border border-koma-border text-koma-muted hover:text-koma-foreground"
                  title="Ajustar visualização"
                >
                  <Settings2 size={15} />
                </button>
                {showSettings && (
                  <div className="absolute right-0 top-full mt-2 z-50 w-52 bg-koma-dialog border border-koma-border rounded-xl p-3 shadow-2xl space-y-2">
                    <label className="flex items-center justify-between gap-3 text-xs text-koma-muted">
                      <span>Exibir imagens</span>
                      <input
                        type="checkbox"
                        checked={settings.exibirImagens}
                        onChange={(event) => onUpdateSettings({ ...settings, exibirImagens: event.target.checked })}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 text-xs text-koma-muted">
                      <span>Exibir descrições</span>
                      <input
                        type="checkbox"
                        checked={settings.exibirDescricoes}
                        onChange={(event) => onUpdateSettings({ ...settings, exibirDescricoes: event.target.checked })}
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-1.5 overflow-x-auto scrollbar-none no-scrollbar">
              {categoriesList.map((category) => (
                <button
                  key={category.id}
                  id={`cat-btn-${category.nome.toLowerCase().replace(/\s+/g, '-')}`}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(category.nome);
                    setSearchQuery('');
                    setTimeout(() => document.getElementById(`category-sec-${category.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 40);
                  }}
                  className={`px-3 py-1.5 text-xs font-bold rounded-xl whitespace-nowrap ${selectedCategory === category.nome ? 'bg-emerald-500 text-zinc-950' : 'bg-koma-card border border-koma-border text-koma-muted'}`}
                >
                  {category.nome}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 sm:p-5 pb-28 sm:pb-8 space-y-6 sm:max-h-[58vh] sm:overflow-y-auto">
            {categoriesList.map((category) => {
              const products = activeProducts.filter((product) => {
                const decorated = product as ProductWithModifiers;
                const matchesCategory = decorated.categoria_id === category.id
                  || obterNomeCategoria(product.categoria) === category.nome;
                const matchesSearch = !searchQuery
                  || smartSearchMatch(`${product.nome} ${product.descricao || ''}`, searchQuery);
                return matchesCategory && matchesSearch;
              });
              if (products.length === 0) return null;

              return (
                <section key={category.id} id={`category-sec-${category.id}`} className="space-y-2.5 scroll-mt-24">
                  <div className="flex items-center gap-2 border-b border-koma-border pb-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <h4 className="font-serif text-xs font-bold text-emerald-400 uppercase tracking-wider">{category.nome}</h4>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-4">
                    {products.map((product) => {
                      const groups = productModifierGroups(product);
                      const currentCount = draftItems
                        .filter((item) => item.produtoId === product.id)
                        .reduce((sum, item) => sum + (item.quantidade || 1), 0);
                      return (
                        <article
                          key={product.id}
                          id={`product-card-${product.id}`}
                          onClick={() => handleOpenConfig(product)}
                          className={`border rounded-2xl p-3 sm:p-4 flex flex-col justify-between cursor-pointer transition ${currentCount > 0 ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-koma-card border-koma-border hover:border-emerald-500/30'}`}
                        >
                          <div className="space-y-2">
                            {settings.exibirImagens && product.imagem && (
                              <div className="w-full h-32 rounded-xl overflow-hidden border border-koma-border bg-koma-raised">
                                <img src={product.imagem} alt={product.nome} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              </div>
                            )}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h4 className="font-serif font-bold text-sm text-koma-foreground">{product.nome}</h4>
                                {groups.length > 0 && (
                                  <span className="mt-1 inline-flex px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-bold text-emerald-400">
                                    Personalizável · {groups.length} {groups.length === 1 ? 'grupo' : 'grupos'}
                                  </span>
                                )}
                              </div>
                              <span className="font-mono text-xs font-bold text-emerald-400 whitespace-nowrap">R$ {Number(product.preco).toFixed(2)}</span>
                            </div>
                            {settings.exibirDescricoes && product.descricao && (
                              <p className="text-[11px] text-koma-subtle leading-relaxed line-clamp-2">{product.descricao}</p>
                            )}
                          </div>

                          <div className="mt-3 pt-2 border-t border-koma-border/60 flex items-center gap-1.5">
                            {currentCount > 0 && (
                              <div className="flex items-center gap-1 bg-koma-input rounded-xl border border-emerald-500/30 p-0.5">
                                <button type="button" onClick={(event) => handleQuickSubtract(product, event)} className="p-1.5 text-koma-muted hover:text-rose-400">
                                  <Minus size={13} />
                                </button>
                                <span className="font-mono text-xs font-bold text-emerald-400 px-2">{currentCount}</span>
                              </div>
                            )}
                            <button
                              id={`add-product-btn-${product.id}`}
                              type="button"
                              onClick={(event) => handleQuickAdd(product, event)}
                              className="flex-1 min-h-10 rounded-xl bg-emerald-500 text-zinc-950 text-xs font-bold inline-flex items-center justify-center gap-1"
                            >
                              <Plus size={14} /> {groups.length > 0 ? 'Personalizar' : 'Adicionar'}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {catalogReady && activeProducts.length === 0 && (
              <div className="py-12 text-center text-sm text-koma-muted">Nenhum item disponível no cardápio.</div>
            )}
            {!catalogReady && (
              <div className="py-12 text-center text-sm text-koma-muted">Carregando o cardápio…</div>
            )}
          </div>

          {totalDraftQty > 0 && (
            <div className="sticky bottom-0 z-40 p-3 bg-koma-panel/95 border-t border-koma-border backdrop-blur-md flex items-center justify-between gap-3">
              <div>
                <span className="block text-[10px] text-koma-muted">{totalDraftQty} {totalDraftQty === 1 ? 'item' : 'itens'}</span>
                <span className="font-mono text-sm font-bold text-emerald-400">R$ {draftTotal.toFixed(2)}</span>
              </div>
              <button type="button" onClick={openCart} className="min-h-10 px-4 rounded-xl bg-emerald-500 text-zinc-950 text-xs font-bold inline-flex items-center gap-2">
                Revisar Pedido <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {selectedProductToConfigure && (
        <div
          className="fixed inset-0 z-50 bg-koma-overlay flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={(event) => event.target === event.currentTarget && closeProductConfig()}
        >
          <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto bg-koma-card border border-koma-border rounded-t-3xl sm:rounded-3xl p-4 sm:p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-koma-border pb-3">
              <div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-400">{obterNomeCategoria(selectedProductToConfigure.categoria)}</span>
                <h4 className="font-serif font-bold text-lg text-koma-foreground">{selectedProductToConfigure.nome}</h4>
                {editingDraftItemId && <span className="text-[9px] uppercase font-bold text-amber-400">Editando item do pedido</span>}
              </div>
              <button type="button" onClick={closeProductConfig} className="p-1.5 rounded-full text-koma-muted hover:text-koma-foreground">
                <X size={18} />
              </button>
            </div>

            {selectedProductToConfigure.descricao && (
              <p className="text-[11px] leading-relaxed text-koma-subtle bg-koma-raised border border-koma-border rounded-xl p-3">
                {selectedProductToConfigure.descricao}
              </p>
            )}

            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="block text-[10px] uppercase font-bold text-koma-muted mb-1">Quantidade</span>
                <div className="flex items-center bg-koma-input border border-koma-border rounded-xl p-1">
                  <button type="button" onClick={() => setConfigQty((value) => Math.max(1, value - 1))} className="p-2 text-koma-muted hover:text-rose-400">
                    <Minus size={14} />
                  </button>
                  <span className="px-4 font-mono text-sm font-bold text-koma-foreground">{configQty}</span>
                  <button type="button" onClick={() => setConfigQty((value) => value + 1)} className="p-2 text-koma-muted hover:text-emerald-400">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <div className="text-right">
                <span className="block text-[10px] uppercase font-bold text-koma-muted">Total configurado</span>
                <span className="font-mono text-lg font-bold text-emerald-400">R$ {(configUnitTotal * configQty).toFixed(2)}</span>
                {modifierTotal > 0 && (
                  <span className="block text-[9px] text-koma-subtle">+ R$ {modifierTotal.toFixed(2)} por unidade</span>
                )}
              </div>
            </div>

            {currentGroups.length > 0 && (
              <div className="space-y-3 border-t border-koma-border pt-4">
                <div>
                  <h5 className="text-xs font-bold text-koma-foreground">Complementos</h5>
                  <p className="text-[10px] text-koma-muted">As opções abaixo vêm do mesmo catálogo usado no caixa, garçom e cardápio online.</p>
                </div>
                {currentGroups.map((group) => {
                  const activeOptions = group.opcoes.filter((option) => option.ativo !== false);
                  const optionIds = new Set(activeOptions.map((option) => option.id));
                  const selectedCount = selectedModifierIds.filter((id) => optionIds.has(id)).length;
                  const min = Number(group.min_selecoes || 0);
                  const max = Math.max(1, Number(group.max_selecoes || 1));
                  const groupValid = selectedCount >= min && selectedCount <= max;
                  return (
                    <div key={group.id} className={`border rounded-xl p-3 space-y-2 ${groupValid ? 'border-koma-border bg-koma-raised/40' : 'border-amber-500/40 bg-amber-500/5'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="text-xs font-bold text-koma-foreground">{group.nome}</span>
                          <span className="block text-[9px] text-koma-muted">
                            {min > 0 ? `Escolha de ${min} a ${max}` : `Escolha até ${max}`}
                          </span>
                        </div>
                        <span className={`text-[9px] font-bold ${groupValid ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {selectedCount}/{max}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {activeOptions.map((option) => {
                          const selected = selectedModifierIds.includes(option.id);
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => toggleModifier(group, option.id)}
                              className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-left transition ${selected ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-koma-card border-koma-border hover:border-emerald-500/25'}`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <span className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${selected ? 'bg-emerald-500 border-emerald-500 text-black' : 'border-koma-border'}`}>
                                  {selected && <Check size={11} strokeWidth={3} />}
                                </span>
                                <span className="text-xs font-medium text-koma-foreground truncate">{option.nome}</span>
                              </span>
                              <span className="text-[11px] font-mono font-bold text-emerald-400 whitespace-nowrap">
                                {Number(option.preco_adicional || 0) > 0 ? `+ R$ ${Number(option.preco_adicional).toFixed(2)}` : 'Grátis'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-2 border-t border-koma-border pt-4">
              <label htmlFor="config-item-obs" className="text-[10px] uppercase font-bold text-koma-muted">Observação de preparo</label>
              <input
                id="config-item-obs"
                value={configObs}
                onChange={(event) => setConfigObs(event.target.value)}
                placeholder="Ex: sem cebola, mal passado, molho à parte..."
                className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500"
              />
              <div className="flex flex-wrap gap-1">
                {getProductPresets(selectedProductToConfigure).map((preset) => {
                  const parts = configObs ? configObs.split(',').map((part) => part.trim()).filter(Boolean) : [];
                  const active = parts.some((part) => part.toLocaleLowerCase('pt-BR') === preset.toLocaleLowerCase('pt-BR'));
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        const next = active
                          ? parts.filter((part) => part.toLocaleLowerCase('pt-BR') !== preset.toLocaleLowerCase('pt-BR'))
                          : [...parts, preset];
                        setConfigObs(next.join(', '));
                      }}
                      className={`px-2 py-1 text-[9px] rounded-lg border ${active ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-koma-raised border-koma-border text-koma-muted'}`}
                    >
                      {active ? preset : `+${preset}`}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="config-client-name" className="text-[10px] uppercase font-bold text-koma-muted">Identificar Cliente (Opcional)</label>
              <input
                id="config-client-name"
                value={configClient}
                onChange={(event) => setConfigClient(event.target.value)}
                placeholder="Ex: Pedro, Cláudia, Mesa Direita..."
                className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500"
              />
              {combinedSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {combinedSuggestions.map((name) => (
                    <button key={name} type="button" onClick={() => setConfigClient(name)} className="px-2 py-1 text-[9px] rounded-lg border border-koma-border bg-koma-raised text-koma-muted">
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 border-t border-koma-border pt-4">
              <button type="button" onClick={closeProductConfig} className="flex-1 py-2.5 rounded-xl border border-koma-border text-xs font-bold text-koma-muted hover:text-koma-foreground">
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmAdd}
                disabled={!modifierSelectionValid}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-zinc-950 text-xs font-extrabold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {!modifierSelectionValid
                  ? 'Complete as escolhas'
                  : editingDraftItemId ? 'Salvar alterações' : 'Adicionar ao Pedido'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
