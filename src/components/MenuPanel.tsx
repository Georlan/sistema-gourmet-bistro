import type { RepeatConfiguration } from '../domain/waiterRepeatItem';
import { getTableQuickClients, projectStandardQuickDrafts } from '../domain/waiterQuickEntry';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Edit3,
  FileText,
  Minus,
  Plus,
  Search,
  Settings2,
  ShoppingCart,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';

import { type CatalogCategory, type CatalogModifierGroup, getSellableProducts, isProductSellable } from '../catalog/catalog';
import { getProductPresets, obterNomeCategoria, smartSearchMatch } from '../domain';
import {
  changeModifierQuantitySelection,
  modifierGroupSelectionValid,
} from '../domain/modifierQuantity';
import type { AppSettings, DraftItem, Order, Product } from '../types';
import ModifierPicker from './shared/ModifierPicker';

interface MenuPanelProps {
  tableId: number;
  draftItems: DraftItem[];
  existingOrders: Order[];
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  onAddToDraft: (product: Product, quantity?: number, observacao?: string, clienteNome?: string) => void;
  onRemoveFromDraft: (draftItemId: string) => void;
  onRestoreDraftItem?: (item: DraftItem, index: number) => boolean;
  onUpdateDraftItem: (draftItemId: string, fields: Partial<DraftItem>) => void;
  onEditDraftItems: (
    draftItemIds: string[],
    fields: Pick<DraftItem, 'quantidade' | 'observacao' | 'clienteNome'>,
  ) => void;
  onSubmitDraft: (orderType: 'Consumo no Local' | 'Retirada' | 'Entrega') => void;
  historicClients?: string[];
  liveProdutos?: Product[];
  liveCategorias?: CatalogCategory[];
  cardapio_ativo_id?: string | null;
  cardapios_ativos_ids?: string[];
  catalogReady?: boolean;
  isSubmitting?: boolean;
  allowExternalOrders?: boolean;
  standardQuickEntry?: boolean;
  initialConfiguration?: RepeatConfiguration | null;
  onInitialConfigurationConsumed?: () => void;
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

export const productRequiresConfiguration = (product: Product): boolean =>
  productModifierGroups(product).some((group) => Number(group.min_selecoes || 0) > 0);

const modifierSelectionsFor = (
  groups: CatalogModifierGroup[],
  selectedIds: string[],
): ModifierSelection[] => {
  const optionsById = new Map(
    groups
      .flatMap((group) => group.opcoes)
      .filter((option) => option.ativo !== false)
      .map((option) => [option.id, option] as const),
  );

  return selectedIds.flatMap((id) => {
    const option = optionsById.get(id);
    if (!option) return [];
    return [{
      id: option.id,
      nome: option.nome,
      preco: Number(option.preco_adicional || 0),
    }];
  });
};

const summarizeModifierSelections = (modifiers: ModifierSelection[]) => {
  const summary = new Map<string, { modifier: ModifierSelection; quantity: number }>();
  modifiers.forEach((modifier) => {
    const current = summary.get(modifier.id);
    if (current) {
      current.quantity += 1;
      return;
    }
    summary.set(modifier.id, { modifier, quantity: 1 });
  });
  return Array.from(summary.values());
};

const money = (value: number) => value.toLocaleString('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const MenuPanel: React.FC<MenuPanelProps> = ({
  tableId,
  draftItems,
  existingOrders,
  settings,
  onUpdateSettings,
  onAddToDraft,
  onRemoveFromDraft,
  onRestoreDraftItem,
  onUpdateDraftItem,
  onEditDraftItems,
  onSubmitDraft,
  historicClients = [],
  liveProdutos = [],
  liveCategorias = [],
  cardapio_ativo_id,
  cardapios_ativos_ids,
  catalogReady = false,
  isSubmitting = false,
  allowExternalOrders = true,
  standardQuickEntry = false,
  initialConfiguration,
  onInitialConfigurationConsumed,
}) => {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const menuScrollPosition = React.useRef<number | null>(null);
  const removedDraftsRef = React.useRef<Array<{ item: DraftItem; index: number }>>([]);
  const [removedDrafts, setRemovedDrafts] = useState(removedDraftsRef.current);
  const removeDraftItem = (item: DraftItem) => {
    if (isSubmitting) return;
    if (standardQuickEntry && onRestoreDraftItem) {
      const index = draftItems.findIndex((candidate) => candidate.id === item.id);
      if (index < 0) return;
      removedDraftsRef.current = [...removedDraftsRef.current.filter((entry) => entry.item.id !== item.id), { item, index }];
      setRemovedDrafts(removedDraftsRef.current);
    }
    onRemoveFromDraft(item.id);
  };
  const undoDraftRemoval = () => {
    if (isSubmitting) return;
    const entry = removedDraftsRef.current.at(-1);
    if (!entry || !onRestoreDraftItem?.(entry.item, entry.index)) return;
    removedDraftsRef.current = removedDraftsRef.current.slice(0, -1);
    setRemovedDrafts(removedDraftsRef.current);
  };

  const unavailableDraftItemIds = useMemo(() => {
    const productMap = new Map(liveProdutos.map((p) => [p.id, p]));
    const set = new Set<string>();
    draftItems.forEach((item) => {
      const prod = productMap.get(item.produtoId);
      if (!isProductSellable(prod, cardapio_ativo_id, cardapios_ativos_ids)) {
        set.add(item.id);
      }
    });
    return set;
  }, [draftItems, liveProdutos, cardapio_ativo_id, cardapios_ativos_ids]);

  const hasUnavailableDraftItems = unavailableDraftItemIds.size > 0;

  const submitDraft = () => {
    if (isSubmitting || hasUnavailableDraftItems) return;
    removedDraftsRef.current = [];
    setRemovedDrafts([]);
    onSubmitDraft(orderType);
  };
  const [quickClient, setQuickClient] = useState('');
  const tableQuickClients = useMemo(() => getTableQuickClients(draftItems, existingOrders, tableId), [draftItems, existingOrders, tableId]);
  const quickEntryClient = standardQuickEntry && !tableQuickClients.includes(quickClient) ? '' : quickClient;
  const standardQuickDrafts = useMemo(() => projectStandardQuickDrafts(draftItems, quickEntryClient), [draftItems, quickEntryClient]);
  const quickClientLabel = quickEntryClient || 'a mesa';
  React.useEffect(() => {
    if (standardQuickEntry && quickClient && !tableQuickClients.includes(quickClient)) setQuickClient('');
  }, [standardQuickEntry, quickClient, tableQuickClients]);
  const [view, setView] = useState<'cart' | 'menu'>(() => initialConfiguration ? 'menu' : draftItems.length > 0 ? 'cart' : 'menu');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [orderType, setOrderType] = useState<'Consumo no Local' | 'Retirada'>('Consumo no Local');
  const [selectedProductToConfigure, setSelectedProductToConfigure] = useState<Product | null>(() => {
    if (!initialConfiguration) return null;
    const candidate = liveProdutos.find(product => product.id === initialConfiguration.productId);
    return candidate && isProductSellable(candidate, cardapio_ativo_id, cardapios_ativos_ids) ? candidate : null;
  });
  const [editingDraftItemId, setEditingDraftItemId] = useState<string | null>(null);
  const [configQty, setConfigQty] = useState(1);
  const [configObs, setConfigObs] = useState(initialConfiguration?.observacao || '');
  const [configClient, setConfigClient] = useState(initialConfiguration?.clienteNome || '');
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>(() => [...(initialConfiguration?.modifierIds || [])]);
  React.useEffect(() => {
    if (initialConfiguration) onInitialConfigurationConsumed?.();
  }, [initialConfiguration, onInitialConfigurationConsumed]);

  React.useEffect(() => {
    if (selectedProductToConfigure && !isProductSellable(selectedProductToConfigure, cardapio_ativo_id, cardapios_ativos_ids)) {
      setSelectedProductToConfigure(null);
    }
  }, [selectedProductToConfigure, cardapio_ativo_id, cardapios_ativos_ids]);

  React.useEffect(() => {
    if (!allowExternalOrders && orderType !== 'Consumo no Local') {
      setOrderType('Consumo no Local');
    }
  }, [allowExternalOrders, orderType]);

  const activeProducts = useMemo(
    () => getSellableProducts(liveProdutos, cardapio_ativo_id, cardapios_ativos_ids).filter((product) => (product as ProductWithModifiers).ativo !== false),
    [liveProdutos, cardapio_ativo_id, cardapios_ativos_ids],
  );

  const unavailableSearchMatches = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) return [];
    return liveProdutos.filter((product) => {
      const decorated = product as ProductWithModifiers;
      const isUnavailable = decorated.ativo === false || !isProductSellable(product, cardapio_ativo_id, cardapios_ativos_ids);
      return isUnavailable && smartSearchMatch(`${product.nome} ${product.descricao || ''}`, query);
    });
  }, [liveProdutos, cardapio_ativo_id, cardapios_ativos_ids, searchQuery]);

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
    if (standardQuickEntry) return tableQuickClients;
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
  }, [draftItems, existingOrders, historicClients, standardQuickEntry, tableQuickClients]);

  const reviewClient = (
    <div className={standardQuickEntry ? "kw-review-client kw-review-client--compact space-y-2" : "kw-review-client p-3 space-y-2"}>
      <label htmlFor="overall-client-name" className={standardQuickEntry ? "sr-only" : "text-[10px] font-bold text-koma-muted uppercase tracking-wider"}>
        Cliente do pedido <span className="normal-case font-normal">(opcional)</span>
      </label>
      <input
        id="overall-client-name"
        value={standardQuickEntry && (draftItems[0]?.clienteNome || '').trim().toLocaleLowerCase('pt-BR') === 'consumo geral' ? '' : draftItems[0]?.clienteNome || ''}
        disabled={isSubmitting}
        onChange={(event) => { setQuickClient(event.target.value); draftItems.forEach((item) => onUpdateDraftItem(item.id, { clienteNome: event.target.value })); }}
        placeholder={standardQuickEntry ? "Cliente (opcional)" : "Ex: Pedro, Cláudia, Família..."}
        className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500 disabled:opacity-50"
      />
      {combinedSuggestions.length > 0 && (
        <div className={standardQuickEntry ? "kw-review-client-suggestions" : "flex flex-wrap gap-1"}>
          {combinedSuggestions.map((name) => (
            <button
              key={name}
              type="button"
              disabled={isSubmitting}
              onClick={() => { setQuickClient(name); draftItems.forEach((item) => onUpdateDraftItem(item.id, { clienteNome: name })); }}
              className="px-2 py-1 text-[9px] rounded-lg border border-koma-border bg-koma-card text-koma-muted hover:text-koma-foreground disabled:opacity-50"
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const totalDraftQty = draftItems.reduce((sum, item) => sum + (item.quantidade || 1), 0);
  const draftTotal = draftItems.reduce(
    (sum, item) => sum + Number(item.preco || 0) * (item.quantidade || 1),
    0,
  );
  const itemWord = totalDraftQty === 1 ? 'item' : 'itens';
  const reviewCta = `Revisar ${totalDraftQty} ${itemWord} · R$ ${money(draftTotal)}`;
  const submitCta = `Lançar ${totalDraftQty} ${itemWord} · R$ ${money(draftTotal)}`;

  // Preserve the saved order within each priority tier, but display mandatory
  // choices first so operators can finish required selections without scrolling
  // past optional extras. Do not mutate the catalog's canonical group order.
  const currentGroups = useMemo(
    () => [...productModifierGroups(selectedProductToConfigure)].sort(
      (a, b) => Number(Number(b.min_selecoes || 0) > 0) - Number(Number(a.min_selecoes || 0) > 0),
    ),
    [selectedProductToConfigure],
  );
  const selectedModifierOptions = useMemo(
    () => modifierSelectionsFor(currentGroups, selectedModifierIds),
    [currentGroups, selectedModifierIds],
  );
  const modifierTotal = selectedModifierOptions.reduce((sum, option) => sum + option.preco, 0);
  const configUnitTotal = Number(selectedProductToConfigure?.preco || 0) + modifierTotal;
  const modifierSelectionValid = currentGroups.every((group) =>
    modifierGroupSelectionValid(group, selectedModifierIds));

  const scrollPanelToTop = () => {
    requestAnimationFrame(() => {
      document.getElementById('menu-panel-root')?.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
  };

  const scrollCategories = (direction: -1 | 1) => {
    document.getElementById('menu-category-strip')?.scrollBy({
      left: direction * 260,
      behavior: 'smooth',
    });
  };

  const openMenu = () => {
    if (isSubmitting) return;
    setView('menu');
    if (standardQuickEntry && menuScrollPosition.current !== null) {
      requestAnimationFrame(() => {
        const scroller = panelRef.current?.closest<HTMLElement>('.kw-flow-body');
        if (scroller) scroller.scrollTop = menuScrollPosition.current ?? 0;
      });
    } else {
      scrollPanelToTop();
    }
  };

  const openCart = () => {
    if (isSubmitting) return;
    if (standardQuickEntry) {
      menuScrollPosition.current = panelRef.current?.closest<HTMLElement>('.kw-flow-body')?.scrollTop ?? null;
    }
    setView('cart');
    scrollPanelToTop();
  };

  const closeProductConfig = () => {
    if (isSubmitting) return;
    setSelectedProductToConfigure(null);
    setEditingDraftItemId(null);
    setSelectedModifierIds([]);
  };

  const handleOpenConfig = (product: Product, draftItem?: DraftItem) => {
    if (isSubmitting) return;
    const draft = draftItem as DraftWithModifiers | undefined;
    setSelectedProductToConfigure(product);
    setEditingDraftItemId(draft?.id || null);
    setConfigQty(draft?.quantidade || 1);
    setConfigObs(draft?.observacao || '');
    setConfigClient(draft ? (draft.clienteNome || '') : (standardQuickEntry ? quickEntryClient : (draftItems[0]?.clienteNome || '')));
    setSelectedModifierIds([...(draft?.modificadorIds || [])]);
  };

  const changeModifierQuantity = (
    group: CatalogModifierGroup,
    optionId: string,
    delta: -1 | 1,
  ) => {
    if (isSubmitting) return;
    setSelectedModifierIds((current) =>
      changeModifierQuantitySelection(group, current, optionId, delta));
  };

  const handleConfirmAdd = () => {
    if (isSubmitting || !selectedProductToConfigure || !modifierSelectionValid) return;
    const modifierMeta = {
      modificadorIds: [...selectedModifierIds],
      modificadoresSelecionados: selectedModifierOptions,
      precoBase: Number(selectedProductToConfigure.preco),
    };

    if (editingDraftItemId) {
      onEditDraftItems([editingDraftItemId], {
        quantidade: configQty,
        observacao: configObs,
        clienteNome: configClient,
        ...modifierMeta,
      } as any);
    } else {
      const decoratedProduct = {
        ...selectedProductToConfigure,
        __selectedModifierIds: modifierMeta.modificadorIds,
        __selectedModifiers: modifierMeta.modificadoresSelecionados,
        __selectedModifierTotal: modifierTotal,
      } as ProductWithModifiers;
      onAddToDraft(decoratedProduct as Product, configQty, configObs, standardQuickEntry ? (configClient.trim() || 'Consumo Geral') : configClient);
    }
    closeProductConfig();
  };

  const findQuickDraftItem = (product: Product) => {
    if (standardQuickEntry) return productRequiresConfiguration(product) ? null : standardQuickDrafts.get(product.id)?.item || null;
    const matching = draftItems.filter((item) => item.produtoId === product.id);
    if (matching.length === 0) return null;
    const cleanItem = [...matching].reverse().find((item) => {
      const decorated = item as DraftWithModifiers;
      return !item.observacao && (decorated.modificadorIds || []).length === 0;
    });
    return cleanItem || matching[matching.length - 1];
  };

  const handleQuickAdd = (product: Product) => {
    if (isSubmitting) return;
    if (productRequiresConfiguration(product)) {
      handleOpenConfig(product);
      return;
    }

    const defaultClient = standardQuickEntry ? (quickEntryClient || 'Consumo Geral') : (draftItems[0]?.clienteNome || '');
    const compatibleDraft = standardQuickEntry ? standardQuickDrafts.get(product.id)?.item : draftItems.find((item) => {
      const decorated = item as DraftWithModifiers;
      return item.produtoId === product.id
        && !item.observacao
        && (item.clienteNome || '') === defaultClient
        && (decorated.modificadorIds || []).length === 0;
    });
    if (compatibleDraft) {
      onUpdateDraftItem(compatibleDraft.id, { quantidade: (compatibleDraft.quantidade || 1) + 1 });
      return;
    }
    onAddToDraft(product, 1, '', defaultClient);
  };

  const handleQuickIncrement = (product: Product) => {
    if (isSubmitting) return;
    const item = findQuickDraftItem(product);
    if (!item) {
      handleQuickAdd(product);
      return;
    }
    onUpdateDraftItem(item.id, { quantidade: (item.quantidade || 1) + 1 });
  };

  const handleQuickSubtract = (product: Product) => {
    if (isSubmitting) return;
    const item = findQuickDraftItem(product);
    if (!item) return;
    if ((item.quantidade || 1) > 1) {
      onUpdateDraftItem(item.id, { quantidade: (item.quantidade || 1) - 1 });
    } else {
      onRemoveFromDraft(item.id);
    }
  };

  return (
    <div ref={panelRef} id="menu-panel-root" data-menu-view={view} className="relative" aria-busy={isSubmitting}>
      {view === 'cart' && (
        <div className="kw-order-review p-3 sm:p-5 pb-24 sm:pb-5 flex flex-col max-w-2xl mx-auto">
          <div className="kw-review-heading flex items-center justify-between gap-3 pb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ShoppingCart size={16} className="text-emerald-400 shrink-0" />
                <h3 className="font-serif font-bold text-sm sm:text-base text-koma-foreground">Revisar pedido</h3>
              </div>
              {totalDraftQty > 0 && (
                <p className="mt-1 text-[10px] text-koma-muted">Itens prontos para lançar na mesa.</p>
              )}
            </div>
            <button
              type="button"
              onClick={openMenu}
              disabled={isSubmitting}
              className="min-h-9 px-3 rounded-xl bg-koma-raised border border-koma-border text-koma-foreground text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"
            >
              <Plus size={13} /> Mais itens
            </button>
          </div>

          {standardQuickEntry && onRestoreDraftItem && removedDrafts.length > 0 && (
            <div className="kw-draft-recovery flex min-h-11 items-center justify-between gap-3 border-b border-koma-border text-xs">
              <span role="status" aria-live="polite" className="text-koma-muted">Item removido</span>
              <button id="undo-draft-removal" type="button" disabled={isSubmitting} onClick={undoDraftRemoval}
                aria-label={`Desfazer remoção de ${removedDrafts.at(-1)?.item.nome}`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 font-semibold text-koma-foreground hover:bg-koma-raised disabled:opacity-40">
                <Undo2 size={15} aria-hidden="true" /> Desfazer
              </button>
            </div>
          )}
          {draftItems.length === 0 ? (
            <div className="py-12 text-center flex-1 flex flex-col items-center justify-center gap-3">
              <p className="text-sm font-semibold text-koma-foreground">Nenhum item no pedido</p>
              <p className="text-xs text-koma-muted">Escolha os produtos da Mesa {tableId}.</p>
              <button type="button" onClick={openMenu} disabled={isSubmitting} className="koma-btn-primary px-5 py-2.5 rounded-xl text-xs font-bold disabled:opacity-50">
                Abrir cardápio
              </button>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col gap-4 pt-4">
              {!standardQuickEntry && reviewClient}

              <div className="space-y-2">
                {draftItems.map((item, index) => {
                  const decorated = item as DraftWithModifiers;
                  const product = liveProdutos.find((candidate) => candidate.id === item.produtoId);
                  const modifierSummary = summarizeModifierSelections(decorated.modificadoresSelecionados || []);
                  return (
                    <div key={item.id} id={`draft-item-${item.id}`} className="kw-draft-row p-3 space-y-2.5">
                      <div className="kw-draft-heading flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="kw-draft-index w-5 h-5 rounded-full border border-koma-border text-[10px] font-mono flex items-center justify-center text-koma-subtle">{index + 1}</span>
                            <span className="text-xs font-bold text-koma-foreground">{item.nome}</span>
                          </div>
                          {modifierSummary.length > 0 && (
                            <div className="mt-1 ml-7 flex flex-wrap gap-1">
                              {modifierSummary.map(({ modifier, quantity }) => (
                                <span key={modifier.id} className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-[9px] text-emerald-400 border border-emerald-500/20">
                                  + {quantity > 1 ? `${quantity}x ` : ''}{modifier.nome}
                                </span>
                              ))}
                            </div>
                          )}
                          {item.clienteNome && (!standardQuickEntry || item.clienteNome.trim().toLocaleLowerCase('pt-BR') !== 'consumo geral') && <span className="ml-7 text-[9px] uppercase font-bold text-emerald-400">Para: {item.clienteNome}</span>}
                          {unavailableDraftItemIds.has(item.id) && (
                            <div
                              id={`draft-item-unavailable-${item.id}`}
                              data-testid={`draft-item-unavailable-${item.id}`}
                              className="mt-1 ml-7 inline-flex items-center gap-1.5 text-[10px] font-bold text-rose-400 bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 rounded-md"
                            >
                              <span>Item indisponível no cardápio ativo</span>
                            </div>
                          )}
                        </div>
                        <div className="kw-draft-actions flex items-center gap-1.5 shrink-0">
                          <span className="kw-draft-amount text-xs font-mono font-bold text-emerald-400">R$ {money(Number(item.preco) * (item.quantidade || 1))}</span>
                          <button
                            type="button"
                            disabled={isSubmitting || !product || unavailableDraftItemIds.has(item.id)}
                            onClick={() => product && handleOpenConfig(product, item)}
                            className="p-1.5 rounded-lg text-koma-muted hover:text-emerald-400 hover:bg-koma-raised disabled:opacity-40"
                            title={unavailableDraftItemIds.has(item.id) ? 'Item indisponível no cardápio ativo' : 'Editar item e complementos'}
                            aria-label={`Editar ${item.nome}`}
                          >
                            <Edit3 size={13} />
                          </button>
                          <button id={`remove-draft-item-${item.id}`} type="button" disabled={isSubmitting} onClick={() => removeDraftItem(item)} className="p-1.5 rounded-lg text-koma-muted hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40" title="Remover item" aria-label={`Remover ${item.nome}`}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      <div className="kw-draft-controls flex items-center justify-between gap-2 border-t border-koma-border pt-2">
                        <div className="kw-draft-quantity flex items-center gap-1 bg-koma-raised border border-koma-border rounded-lg p-0.5">
                          <button type="button" disabled={isSubmitting} onClick={() => (item.quantidade || 1) > 1 ? onUpdateDraftItem(item.id, { quantidade: (item.quantidade || 1) - 1 }) : removeDraftItem(item)} className="p-1.5 text-koma-muted hover:text-rose-400 disabled:opacity-40" aria-label={`Diminuir ${item.nome}`}><Minus size={12} /></button>
                          <span className="px-2 text-xs font-mono font-bold text-koma-foreground">{item.quantidade || 1}</span>
                          <button type="button" disabled={isSubmitting} onClick={() => onUpdateDraftItem(item.id, { quantidade: (item.quantidade || 1) + 1 })} className="p-1.5 text-koma-muted hover:text-emerald-400 disabled:opacity-40" aria-label={`Aumentar ${item.nome}`}><Plus size={12} /></button>
                        </div>
                        <div className="flex-1 relative">
                          <FileText size={11} className="absolute left-2.5 top-2.5 text-koma-subtle" />
                          <input value={item.observacao} disabled={isSubmitting} onChange={(event) => onUpdateDraftItem(item.id, { observacao: event.target.value })} placeholder="Observação de preparo..." aria-label={`Observação de ${item.nome}`} className="w-full pl-7 pr-2 py-2 bg-koma-input border border-koma-border rounded-lg text-[11px] text-koma-foreground focus:outline-none focus:border-emerald-500 disabled:opacity-50" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="kw-review-total mt-auto pt-4 space-y-3">
                {standardQuickEntry && reviewClient}
                {allowExternalOrders && (
                  <div>
                    <span className="mb-1.5 block text-[9px] font-bold uppercase tracking-wider text-koma-muted">Destino</span>
                    <div className="grid grid-cols-2 gap-1 bg-koma-card border border-koma-border rounded-xl p-1">
                      <button type="button" disabled={isSubmitting} onClick={() => setOrderType('Consumo no Local')} className={`py-2 text-xs font-bold rounded-lg disabled:opacity-50 ${orderType === 'Consumo no Local' ? 'bg-emerald-500/20 text-emerald-400' : 'text-koma-muted'}`}>Mesa {tableId}</button>
                      <button type="button" disabled={isSubmitting} onClick={() => setOrderType('Retirada')} className={`py-2 text-xs font-bold rounded-lg disabled:opacity-50 ${orderType === 'Retirada' ? 'bg-emerald-500/20 text-emerald-400' : 'text-koma-muted'}`}>Retirada no balcão</button>
                    </div>
                  </div>
                )}

                <div className="kw-review-total__summary flex items-center justify-between" role="group" aria-label="Total deste lançamento">
                  <span className="kw-review-total__label text-[10px] uppercase font-bold text-koma-muted">{standardQuickEntry ? 'Total do pedido' : 'Total deste lançamento'}</span>
                  <span className="kw-review-total__amount text-xl font-mono font-bold text-emerald-400">R$ {money(draftTotal)}</span>
                </div>

                {hasUnavailableDraftItems && (
                  <div
                    id="draft-unavailable-warning"
                    data-testid="draft-unavailable-warning"
                    className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-400 text-xs font-semibold text-center"
                  >
                    Há itens indisponíveis no rascunho. Remova-os antes de enviar o pedido.
                  </div>
                )}

                <button
                  id="submit-draft-order-btn"
                  type="button"
                  disabled={isSubmitting || hasUnavailableDraftItems}
                  onClick={submitDraft}
                  className="hidden sm:flex w-full min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-zinc-950 text-sm font-extrabold disabled:opacity-50"
                  aria-label={
                    isSubmitting
                      ? 'Enviando pedido'
                      : hasUnavailableDraftItems
                        ? 'Remova os itens indisponíveis para enviar'
                        : `${submitCta} para a Mesa ${tableId}`
                  }
                  title={hasUnavailableDraftItems ? 'Remova os itens indisponíveis antes de enviar' : undefined}
                >
                  {isSubmitting ? 'Enviando pedido…' : submitCta} <ArrowRight size={15} />
                </button>
              </div>

              <div className="kw-order-mobile-footer sm:hidden fixed inset-x-0 bottom-0 z-[80] border-t border-emerald-500/20 bg-koma-card/95 px-3 pt-2 pb-[calc(0.65rem+env(safe-area-inset-bottom))] backdrop-blur-xl">
                <button
                  id="submit-draft-order-btn-mobile"
                  type="button"
                  disabled={isSubmitting || hasUnavailableDraftItems}
                  onClick={submitDraft}
                  className="mx-auto flex min-h-12 w-full max-w-2xl items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-black text-sm font-bold disabled:opacity-50"
                  aria-label={
                    isSubmitting
                      ? 'Enviando pedido'
                      : hasUnavailableDraftItems
                        ? 'Remova os itens indisponíveis para enviar'
                        : `${submitCta} para a Mesa ${tableId}`
                  }
                  title={hasUnavailableDraftItems ? 'Remova os itens indisponíveis antes de enviar' : undefined}
                >
                  {isSubmitting ? 'Enviando pedido…' : submitCta} <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'menu' && (
        <div className="kw-catalog relative max-w-4xl mx-auto">
          <div className="kw-catalog-tools sticky top-0 z-30 px-3 sm:px-5 py-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-2.5 text-koma-subtle" />
                <input id="search-products-input" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={`Buscar produto para a Mesa ${tableId}...`} className="w-full pl-9 pr-8 py-2 bg-koma-input border border-koma-border rounded-xl text-xs sm:text-sm text-koma-foreground focus:outline-none focus:border-emerald-500" />
                {searchQuery && <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2.5 text-koma-muted" aria-label="Limpar busca"><X size={14} /></button>}
              </div>
              <div className="relative">
                <button id="toggle-menu-settings" type="button" onClick={() => setShowSettings((current) => !current)} className="p-2 rounded-xl bg-koma-card border border-koma-border text-koma-muted hover:text-koma-foreground" title="Ajustar visualização" aria-label="Ajustar visualização do cardápio"><Settings2 size={15} /></button>
                {showSettings && (
                  <div className="absolute right-0 top-full mt-2 z-50 w-52 bg-koma-dialog border border-koma-border rounded-xl p-3 shadow-2xl space-y-2">
                    <label className="flex items-center justify-between gap-3 text-xs text-koma-muted"><span>Exibir imagens</span><input type="checkbox" checked={settings.exibirImagens} onChange={(event) => onUpdateSettings({ ...settings, exibirImagens: event.target.checked })} /></label>
                    <label className="flex items-center justify-between gap-3 text-xs text-koma-muted"><span>Exibir descrições</span><input type="checkbox" checked={settings.exibirDescricoes} onChange={(event) => onUpdateSettings({ ...settings, exibirDescricoes: event.target.checked })} /></label>
                  </div>
                )}
              </div>
            </div>

            {standardQuickEntry && tableQuickClients.length > 0 && (
              <div id="quick-entry-clients" className="kw-entry-clients" role="group" aria-label="Cliente dos próximos itens">
                <span className="kw-entry-clients__label">Para</span>
                {['', ...tableQuickClients].map(name => (
                  <button key={name} type="button" disabled={isSubmitting}
                    aria-pressed={quickEntryClient === name} title={name || 'Mesa'}
                    onClick={() => setQuickClient(name)}>{name || 'Mesa'}</button>
                ))}
              </div>
            )}

            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => scrollCategories(-1)}
                className="hidden size-8 shrink-0 place-items-center rounded-lg border border-koma-border bg-koma-card text-koma-muted hover:text-koma-foreground sm:grid"
                aria-label="Ver categorias anteriores"
                title="Categorias anteriores"
              >
                <ChevronLeft size={14} />
              </button>
              <div id="menu-category-strip" className="flex min-w-0 flex-1 snap-x snap-proximity gap-1.5 overflow-x-auto scroll-px-2 overscroll-x-contain scrollbar-none no-scrollbar" aria-label="Categorias do cardápio">
                {categoriesList.map((category) => (
                  <button key={category.id} id={`cat-btn-${category.nome.toLowerCase().replace(/\s+/g, '-')}`} type="button" onClick={() => { setSelectedCategory(category.nome); setSearchQuery(''); setTimeout(() => document.getElementById(`category-sec-${category.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 40); }} className={`snap-start px-3 py-1.5 text-xs font-bold rounded-xl whitespace-nowrap ${selectedCategory === category.nome ? 'bg-emerald-500 text-zinc-950' : 'bg-koma-card border border-koma-border text-koma-muted'}`}>{category.nome}</button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => scrollCategories(1)}
                className="hidden size-8 shrink-0 place-items-center rounded-lg border border-koma-border bg-koma-card text-koma-muted hover:text-koma-foreground sm:grid"
                aria-label="Ver próximas categorias"
                title="Próximas categorias"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="p-3 sm:p-5 pb-6 space-y-6">
            {unavailableSearchMatches.length > 0 && (
              <section id="unavailable-search-results" className="space-y-2.5">
                <div className="flex items-center justify-between gap-3 border-b border-koma-border pb-1">
                  <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-koma-muted" /><h4 className="font-serif text-xs font-bold uppercase tracking-wider text-koma-muted">Indisponíveis encontrados</h4></div>
                  <span className="text-[9px] text-koma-muted">somente consulta</span>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 sm:gap-4">
                  {unavailableSearchMatches.map((product) => (
                    <article key={product.id} id={`unavailable-product-${product.id}`} aria-disabled="true" className="flex flex-col justify-between rounded-2xl border border-dashed border-koma-border bg-koma-card/50 p-3 opacity-80 sm:p-4">
                      <div className="space-y-2"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h4 className="font-serif text-sm font-bold text-koma-secondary">{product.nome}</h4><span className="mt-1 inline-flex rounded-md border border-rose-500/25 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-rose-400">{(product as ProductWithModifiers).ativo === false ? 'Esgotado' : 'Cardápio inativo'}</span></div><span className="whitespace-nowrap font-mono text-xs font-bold text-koma-muted">R$ {money(Number(product.preco))}</span></div>{product.descricao && <p className="line-clamp-2 text-[11px] leading-relaxed text-koma-muted">{product.descricao}</p>}</div>
                      <p className="mt-3 border-t border-koma-border/60 pt-2 text-[10px] font-semibold text-koma-muted">Indisponível para lançamento</p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {categoriesList.map((category) => {
              const products = activeProducts.filter((product) => {
                const decorated = product as ProductWithModifiers;
                const matchesCategory = decorated.categoria_id === category.id || obterNomeCategoria(product.categoria) === category.nome;
                const matchesSearch = !searchQuery || smartSearchMatch(`${product.nome} ${product.descricao || ''}`, searchQuery);
                return matchesCategory && matchesSearch;
              });
              if (products.length === 0) return null;

              return (
                <section key={category.id} id={`category-sec-${category.id}`} className="space-y-2.5 scroll-mt-24">
                  <div className="flex items-center gap-2 border-b border-koma-border pb-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /><h4 className="font-serif text-xs font-bold text-emerald-400 uppercase tracking-wider">{category.nome}</h4></div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-4">
                    {products.map((product) => {
                      const groups = productModifierGroups(product);
                      const requiredConfig = productRequiresConfiguration(product);
                      const recommendedCount = groups.filter((group) => group.recomendado !== false).length;
                      const quickCount = requiredConfig ? 0 : standardQuickDrafts.get(product.id)?.quantity || 0;
                      const allProductCount = draftItems.filter((item) => item.produtoId === product.id).reduce((sum, item) => sum + (item.quantidade || 1), 0);
                      const currentCount = standardQuickEntry ? quickCount : allProductCount;
                      return (
                        <article
                          key={product.id}
                          id={`product-card-${product.id}`}
                          data-in-draft={allProductCount > 0} className={`kw-product overflow-hidden rounded-2xl border transition ${allProductCount > 0 ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-koma-card border-koma-border hover:border-emerald-500/30'}`}
                        >
                          <button
                            id={`customize-product-btn-${product.id}`}
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => handleOpenConfig(product)}
                            className="group flex w-full flex-1 flex-col p-3 text-left outline-none transition hover:bg-white/[0.02] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-60 sm:p-4"
                            title="Clique para personalizar quantidade, adicionais e observações"
                            aria-label={`Personalizar ${product.nome}`}
                          >
                            <div className="space-y-2">
                              {settings.exibirImagens && product.imagem && <div className="w-full h-32 rounded-xl overflow-hidden border border-koma-border bg-koma-raised"><img src={product.imagem} alt={product.nome} className="w-full h-full object-cover" referrerPolicy="no-referrer" /></div>}
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0"><h4 className="font-serif font-bold text-sm text-koma-foreground">{product.nome}</h4>{groups.length > 0 && <span className={`mt-1 inline-flex px-1.5 py-0.5 rounded border text-[9px] font-bold ${requiredConfig ? 'bg-cyan-500/10 border-cyan-500/25 text-cyan-300' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>{requiredConfig ? 'Escolhas obrigatórias' : `Personalizável${recommendedCount > 0 ? ` · ${recommendedCount} recomendados` : ''}`}</span>}</div>
                                <span className="font-mono text-xs font-bold text-emerald-400 whitespace-nowrap">R$ {money(Number(product.preco))}</span>
                              </div>
                              {settings.exibirDescricoes && product.descricao && <p className="text-[11px] text-koma-subtle leading-relaxed line-clamp-2">{product.descricao}</p>}
                              <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-koma-muted transition group-hover:text-emerald-400">
                                <Settings2 size={11} /> Personalizar item
                              </span>
                            </div>
                          </button>

                          <div className="border-t border-koma-border/60 p-2.5 sm:p-3">
                            {currentCount > 0 ? (
                              <div
                                id={`product-quick-stepper-${product.id}`}
                                className="grid min-h-10 grid-cols-[42px_1fr_42px] overflow-hidden rounded-xl border border-emerald-500/30 bg-koma-input"
                                aria-label={standardQuickEntry ? `Quantidade padrão de ${product.nome} para ${quickClientLabel}` : `Quantidade de ${product.nome} no pedido`}
                              >
                                <button
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() => handleQuickSubtract(product)}
                                  className="grid min-h-10 place-items-center border-r border-koma-border text-koma-muted transition hover:bg-rose-500/10 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
                                  aria-label={`Diminuir ${product.nome}`}
                                  title="Diminuir uma unidade"
                                >
                                  <Minus size={15} />
                                </button>
                                <div className="pointer-events-none flex min-w-0 items-center justify-center gap-2 px-2 text-center" aria-live="polite">
                                  <span className="font-mono text-sm font-extrabold text-emerald-400">{currentCount}</span>
                                  <span className="text-[9px] font-semibold uppercase tracking-wide text-koma-muted">{standardQuickEntry ? 'padrão' : 'no pedido'}</span>
                                </div>
                                <button
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() => handleQuickIncrement(product)}
                                  className="grid min-h-10 place-items-center border-l border-koma-border text-koma-muted transition hover:bg-emerald-500/10 hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                                  aria-label={`Aumentar ${product.nome}`}
                                  title={standardQuickEntry ? `Adicionar uma unidade padrão para ${quickClientLabel}` : 'Adicionar mais uma unidade com a configuração atual'}
                                >
                                  <Plus size={15} />
                                </button>
                              </div>
                            ) : (
                              <button
                                id={`add-product-btn-${product.id}`}
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => requiredConfig ? handleOpenConfig(product) : handleQuickAdd(product)}
                                className={`inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition shadow-xs active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
                                  requiredConfig
                                    ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50 hover:border-emerald-500/60'
                                    : 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-extrabold'
                                }`}
                                aria-label={requiredConfig ? `Configurar ${product.nome}` : `Adicionar ${product.nome}`}
                              >
                                {requiredConfig ? <Settings2 size={14} /> : <Plus size={14} />}
                                {requiredConfig ? 'Configurar' : 'Adicionar'}
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {catalogReady && activeProducts.length === 0 && unavailableSearchMatches.length === 0 && <div className="py-12 text-center text-sm text-koma-muted">Nenhum item disponível no cardápio.</div>}
            {!catalogReady && <div className="py-12 text-center text-sm text-koma-muted">Carregando o cardápio…</div>}
          </div>

          {totalDraftQty > 0 && (
            <div className="sticky bottom-0 z-40 border-t border-emerald-500/20 bg-koma-panel/95 px-3 pt-2 pb-[calc(0.65rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:p-3 sm:pb-3 sm:rounded-b-3xl">
              <button id="open-draft-cart-btn" type="button" disabled={isSubmitting} onClick={openCart} className="mx-auto flex min-h-11 w-full max-w-xl items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-extrabold text-zinc-950 disabled:opacity-50" aria-label={reviewCta}>
                <ShoppingCart size={14} /> {reviewCta} <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {selectedProductToConfigure && (
        <div className="fixed inset-0 z-[80] bg-koma-overlay flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={(event) => event.target === event.currentTarget && closeProductConfig()}>
          <div data-testid="waiter-product-config" role="dialog" aria-modal="true" aria-label={`Configurar ${selectedProductToConfigure.nome}`} className="flex w-full max-w-lg max-h-[92dvh] flex-col overflow-hidden bg-koma-card border border-koma-border rounded-t-3xl sm:rounded-3xl shadow-2xl">
            <div className="shrink-0 flex items-start justify-between gap-3 border-b border-koma-border p-4 sm:px-6"><div><span className="text-[10px] uppercase tracking-wider font-bold text-emerald-400">{obterNomeCategoria(selectedProductToConfigure.categoria)}</span><h4 className="font-serif font-bold text-lg text-koma-foreground">{selectedProductToConfigure.nome}</h4>{editingDraftItemId && <span className="text-[9px] uppercase font-bold text-cyan-400">Editando item do pedido</span>}</div><button type="button" disabled={isSubmitting} onClick={closeProductConfig} className="p-1.5 rounded-full text-koma-muted hover:text-koma-foreground disabled:opacity-50" aria-label="Fechar configuração"><X size={18} /></button></div>
            <div data-testid="waiter-product-config-body" className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-4">
            {selectedProductToConfigure.descricao && <p className="text-[11px] leading-relaxed text-koma-subtle bg-koma-raised border border-koma-border rounded-xl p-3">{selectedProductToConfigure.descricao}</p>}

            <div className="flex items-center justify-between gap-3">
              <div><span className="block text-[10px] uppercase font-bold text-koma-muted mb-1">Quantidade</span><div className="flex items-center bg-koma-input border border-koma-border rounded-xl p-1"><button type="button" disabled={isSubmitting} onClick={() => setConfigQty((value) => Math.max(1, value - 1))} className="p-2 text-koma-muted hover:text-rose-400 disabled:opacity-40"><Minus size={14} /></button><span className="px-4 font-mono text-sm font-bold text-koma-foreground">{configQty}</span><button type="button" disabled={isSubmitting} onClick={() => setConfigQty((value) => value + 1)} className="p-2 text-koma-muted hover:text-emerald-400 disabled:opacity-40"><Plus size={14} /></button></div></div>
              <div className="text-right"><span className="block text-[10px] uppercase font-bold text-koma-muted">Total configurado</span><span className="font-mono text-lg font-bold text-emerald-400">R$ {money(configUnitTotal * configQty)}</span>{modifierTotal > 0 && <span className="block text-[9px] text-koma-subtle">+ R$ {money(modifierTotal)} por unidade</span>}</div>
            </div>

            {currentGroups.length > 0 && <div className="space-y-3 border-t border-koma-border pt-4"><div><h5 className="text-xs font-bold text-koma-foreground">Complementos</h5><p className="text-[10px] text-koma-muted">{currentGroups.some(group => group.modo_selecao) ? 'Siga os limites de porções ou tipos definidos para cada grupo.' : 'Ajuste quantidades; o limite do grupo conta tipos diferentes.'}</p></div><ModifierPicker key={`${selectedProductToConfigure.id}-${editingDraftItemId || 'new'}`} groups={currentGroups} selectedIds={selectedModifierIds} onQuantityChange={changeModifierQuantity} /></div>}

            <div className="space-y-2 border-t border-koma-border pt-4">
              <label htmlFor="config-item-obs" className="text-[10px] uppercase font-bold text-koma-muted">Observação de preparo</label>
              <input id="config-item-obs" value={configObs} disabled={isSubmitting} onChange={(event) => setConfigObs(event.target.value)} placeholder="Ex: sem cebola, mal passado, molho à parte..." className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500 disabled:opacity-50" />
              <div className="flex flex-wrap gap-1">
                {getProductPresets(selectedProductToConfigure).map((preset) => {
                  const parts = configObs ? configObs.split(',').map((part) => part.trim()).filter(Boolean) : [];
                  const active = parts.some((part) => part.toLocaleLowerCase('pt-BR') === preset.toLocaleLowerCase('pt-BR'));
                  return <button key={preset} type="button" disabled={isSubmitting} onClick={() => { const next = active ? parts.filter((part) => part.toLocaleLowerCase('pt-BR') !== preset.toLocaleLowerCase('pt-BR')) : [...parts, preset]; setConfigObs(next.join(', ')); }} className={`px-2 py-1 text-[9px] rounded-lg border disabled:opacity-40 ${active ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-koma-raised border-koma-border text-koma-muted'}`}>{active ? preset : `+${preset}`}</button>;
                })}
              </div>
            </div>

            <div className="space-y-2"><label htmlFor="config-client-name" className="text-[10px] uppercase font-bold text-koma-muted">Identificar cliente (opcional)</label><input id="config-client-name" value={standardQuickEntry && configClient.trim().toLocaleLowerCase('pt-BR') === 'consumo geral' ? '' : configClient} disabled={isSubmitting} onChange={(event) => setConfigClient(event.target.value)} placeholder="Ex: Pedro, Cláudia, Mesa Direita..." className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-xs text-koma-foreground focus:outline-none focus:border-emerald-500 disabled:opacity-50" />{combinedSuggestions.length > 0 && <div className="flex flex-wrap gap-1">{combinedSuggestions.map((name) => <button key={name} type="button" disabled={isSubmitting} onClick={() => setConfigClient(name)} className="px-2 py-1 text-[9px] rounded-lg border border-koma-border bg-koma-raised text-koma-muted disabled:opacity-40">{name}</button>)}</div>}</div>

            </div>
            <div data-testid="waiter-product-config-footer" className="shrink-0 px-4 sm:px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-koma-card border-t border-koma-border flex items-center gap-3">
              <button type="button" disabled={isSubmitting} onClick={closeProductConfig} className="flex-1 py-2.5 rounded-xl border border-koma-border text-xs font-bold text-koma-muted hover:text-koma-foreground disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={handleConfirmAdd} disabled={isSubmitting || !modifierSelectionValid} className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-zinc-950 text-xs font-extrabold disabled:opacity-40 disabled:cursor-not-allowed">{isSubmitting ? 'Aguarde…' : !modifierSelectionValid ? 'Complete as escolhas' : editingDraftItemId ? 'Salvar alterações' : 'Adicionar ao pedido'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};