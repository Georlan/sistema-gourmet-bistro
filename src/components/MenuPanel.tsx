/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Search, Plus, Minus, Trash2, SlidersHorizontal, ArrowRight, FileText, Info, ShoppingCart, X, Edit3, Check } from 'lucide-react';
import { Product, DraftItem, AppSettings, Order } from '../types';
import { getProductPresets, obterNomeCategoria, smartSearchMatch } from '../domain';
import type { CatalogCategory } from '../catalog/catalog';

interface MenuPanelProps {
  tableId: number;
  draftItems: DraftItem[];
  existingOrders: Order[];
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  onAddToDraft: (product: Product, quantity?: number, observacao?: string, clienteNome?: string) => void;
  onRemoveFromDraft: (draftItemId: string) => void;
  onUpdateDraftItem: (draftItemId: string, fields: Partial<DraftItem>) => void;
  onSubmitDraft: (orderType: 'Consumo no Local' | 'Retirada' | 'Entrega') => void;
  historicClients?: string[];
  liveProdutos?: Product[];
  liveCategorias?: CatalogCategory[];
  catalogReady?: boolean;
  isSubmitting?: boolean;
  allowExternalOrders?: boolean;
}

export const MenuPanel: React.FC<MenuPanelProps> = ({
  tableId,
  draftItems,
  existingOrders,
  settings,
  onUpdateSettings,
  onAddToDraft,
  onRemoveFromDraft,
  onUpdateDraftItem,
  onSubmitDraft,
  historicClients = [],
  liveProdutos = [],
  liveCategorias = [],
  catalogReady = false,
  isSubmitting = false,
  allowExternalOrders = true,
}) => {
  // Uma mesa sem rascunho abre direto no cardápio. Quando já existem itens,
  // preserva a revisão do carrinho como primeira tela.
  const [view, setView] = useState<'cart' | 'menu'>(() => draftItems.length > 0 ? 'cart' : 'menu');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [expandedDraftObs, setExpandedDraftObs] = useState<string | null>(null);

  const scrollPanelToTop = () => {
    requestAnimationFrame(() => {
      document.getElementById('mesa-details-scroll-body')?.scrollTo({ top: 0, behavior: 'auto' });
    });
  };

  const openCartReview = () => {
    setView('cart');
    scrollPanelToTop();
  };

  const openMenu = () => {
    setView('menu');
    scrollPanelToTop();
  };

  const categoriesList = React.useMemo(() => {
    const activeCategoryIds = new Set(
      liveProdutos
        .filter((product) => product.ativo !== false)
        .map((product) => product.categoria_id)
        .filter(Boolean)
    );
    return liveCategorias.filter((category) => activeCategoryIds.has(category.id));
  }, [liveCategorias, liveProdutos]);

  React.useEffect(() => {
    if (categoriesList.length === 0) {
      setSelectedCategory('');
      return;
    }
    if (!categoriesList.some((category) => category.nome === selectedCategory)) {
      setSelectedCategory(categoriesList[0].nome);
    }
  }, [categoriesList, selectedCategory]);

  // Selected product to configure
  const [selectedProductToConfigure, setSelectedProductToConfigure] = useState<Product | null>(null);
  
  // Product configuration modal inputs
  const [configQty, setConfigQty] = useState<number>(1);
  const [configObs, setConfigObs] = useState<string>('');
  const [configClient, setConfigClient] = useState<string>('');
  const [orderType, setOrderType] = useState<'Consumo no Local' | 'Retirada'>('Consumo no Local');

  React.useEffect(() => {
    if (!allowExternalOrders && orderType !== 'Consumo no Local') {
      setOrderType('Consumo no Local');
    }
  }, [allowExternalOrders, orderType]);



  // Extract already registered client names on this table to offer as quick auto-suggestions
  const suggestedClientNames = React.useMemo(() => {
    const namesSet = new Set<string>();
    existingOrders.forEach(order => {
      order.itens.forEach(item => {
        if (item.clienteNome && item.clienteNome.trim() !== '') {
          namesSet.add(item.clienteNome.trim());
        }
      });
    });
    return Array.from(namesSet);
  }, [existingOrders]);

  // Combined suggestions
  const combinedSuggestions = React.useMemo(() => {
    const availableNames = [
      ...historicClients,
      ...suggestedClientNames,
      ...draftItems.map(item => item.clienteNome)
    ];
    const uniqueNames = new Map<string, string>();

    availableNames.forEach(rawName => {
      const name = (rawName || '').trim();
      if (!name) return;
      const normalizedName = name.toLocaleLowerCase('pt-BR');
      if (!uniqueNames.has(normalizedName)) {
        uniqueNames.set(normalizedName, name);
      }
    });

    return Array.from(uniqueNames.values());
  }, [historicClients, suggestedClientNames, draftItems]);

  // Open configuration modal
  const handleOpenConfig = (product: Product) => {
    setSelectedProductToConfigure(product);
    setConfigQty(1);
    setConfigObs('');
    // Pre-fill with the first client name if there is already a name in the cart
    setConfigClient(draftItems.length > 0 ? draftItems[0].clienteNome : '');
  };

  // Adiciona ao mesmo rascunho persistente. Permanecer no cardápio evita que
  // o garçom precise reabrir a lista a cada novo item.
  const handleConfirmAdd = () => {
    if (!selectedProductToConfigure) return;
    onAddToDraft(selectedProductToConfigure, configQty, configObs, configClient);
    setSelectedProductToConfigure(null);
    openCartReview();
  };

  // Adição rápida com 1 toque direto no card
  const handleQuickAdd = (product: Product, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const defaultClient = draftItems.length > 0 ? (draftItems[0].clienteNome || '') : '';
    onAddToDraft(product, 1, '', defaultClient);
  };

  // Redução rápida de quantidade direto no card
  const handleQuickSubtract = (product: Product, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const matching = draftItems.filter(item => item.produtoId === product.id);
    if (matching.length === 0) return;
    const lastItem = matching[matching.length - 1];
    if ((lastItem.quantidade || 1) > 1) {
      onUpdateDraftItem(lastItem.id, { quantidade: (lastItem.quantidade || 1) - 1 });
    } else {
      onRemoveFromDraft(lastItem.id);
    }
  };

  // Total draft count and price
  const totalDraftQty = draftItems.reduce((sum, item) => sum + (item.quantidade || 1), 0);
  const draftTotal = draftItems.reduce((sum, item) => sum + (item.preco * (item.quantidade || 1)), 0);

  return (
    <div className="relative sm:h-full">
      {/* 1. VIEW: CART (CARRINHO DE COMPRAS) */}
      {view === 'cart' && (
        <div className="bg-koma-panel sm:border sm:border-koma-border sm:rounded-2xl p-3 sm:p-5 pb-20 sm:pb-5 flex flex-col sm:h-full max-w-2xl mx-auto border-0 rounded-none">
          <div className="flex flex-col sm:h-full justify-between min-h-0 space-y-3">
            
            {/* Cart Header */}
            <div className="flex items-center justify-between gap-2 border-b border-koma-border pb-2.5 shrink-0">
              <div className="flex items-center gap-2 text-koma-foreground min-w-0">
                <ShoppingCart size={16} className="text-emerald-400 shrink-0" />
                <h3 className="font-serif font-bold text-sm sm:text-base leading-tight truncate">Revisar Pedido</h3>
                <span className="px-2 py-0.5 text-[10px] font-bold font-mono bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full shrink-0">
                  {totalDraftQty} {totalDraftQty === 1 ? 'item' : 'itens'}
                </span>
              </div>
              <button
                type="button"
                onClick={openMenu}
                className="min-h-8 px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-1 shrink-0 shadow-sm"
              >
                <Plus size={13} />
                <span>+ Adicionar</span>
              </button>
            </div>

            {/* Cart Body */}
            {draftItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center space-y-3 flex-1">
                <div className="text-sm text-koma-foreground font-semibold font-sans">Nenhum item no pedido</div>
                <p className="text-xs text-koma-subtle max-w-[260px] leading-relaxed">Escolha os produtos da Mesa {tableId}.</p>
                <button
                  type="button"
                  onClick={openMenu}
                  className="min-h-11 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 border border-emerald-400 text-zinc-950 rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-sm"
                >
                  Abrir cardápio
                </button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-between min-h-0 overflow-hidden">
                <div className="flex-1 overflow-visible sm:overflow-y-auto min-h-0 sm:pr-1 space-y-3">
                {/* Global table client name config */}
                <div className="bg-koma-raised border border-koma-border p-3 rounded-xl space-y-2 shadow-sm">
                  <label htmlFor="overall-client-name" className="text-[10px] font-sans font-bold text-koma-muted uppercase tracking-wider block">
                    Cliente do pedido <span className="normal-case text-koma-subtle">(opcional)</span>
                  </label>
                  <div className="relative">
                    <input
                      id="overall-client-name"
                      type="text"
                      value={draftItems[0]?.clienteNome || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        draftItems.forEach(item => {
                          onUpdateDraftItem(item.id, { clienteNome: val });
                        });
                      }}
                      placeholder="Ex: Pedro, Cláudia, Família..."
                      className="w-full px-3 py-2 bg-koma-input text-koma-foreground border border-koma-border rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500/50 transition-all"
                    />
                  </div>

                  {combinedSuggestions.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[9px] text-koma-subtle font-sans block">Clientes atendidos nesta mesa (toque p/ preencher):</span>
                      <div className="flex flex-wrap gap-1">
                        {combinedSuggestions.map((name) => (
                          <button
                            key={name}
                            id={`suggest-overall-${name.toLowerCase().replace(/\s+/g, '-')}`}
                            onClick={() => {
                              draftItems.forEach(item => {
                                onUpdateDraftItem(item.id, { clienteNome: name });
                              });
                            }}
                            className="px-2 py-0.5 text-[9px] bg-koma-card hover:bg-emerald-500/15 text-koma-muted hover:text-koma-foreground border border-koma-border rounded transition-colors font-medium cursor-pointer"
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Draft items list */}
                <div className="space-y-2 sm:max-h-[40vh] sm:overflow-y-auto max-h-none overflow-y-visible sm:pr-1 scrollbar-thin flex-1">
                  {draftItems.map((item, index) => (
                    <div
                      key={item.id}
                      id={`draft-item-${item.id}`}
                      className="p-3 bg-koma-card border border-koma-border rounded-xl space-y-2.5 shadow-sm group"
                    >
                      {/* Item Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-1.5 min-w-0">
                          <span className="text-[10px] font-bold font-mono bg-koma-card text-koma-subtle h-5 w-5 rounded-full flex items-center justify-center border border-koma-border">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-koma-foreground block leading-snug">{item.nome}</span>
                            {item.clienteNome && (
                              <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-400 uppercase block">Para: {item.clienteNome}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400 mr-1">
                            R$ {(item.preco * (item.quantidade || 1)).toFixed(2)}
                          </span>
                          
                          {/* Qty Selector */}
                          <div className="flex items-center gap-1 bg-koma-card rounded-lg border border-koma-border p-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                if (item.quantidade > 1) {
                                  onUpdateDraftItem(item.id, { quantidade: item.quantidade - 1 });
                                } else {
                                  onRemoveFromDraft(item.id);
                                }
                              }}
                              className="p-1 hover:bg-koma-raised text-koma-subtle hover:text-rose-500 rounded transition-colors cursor-pointer"
                              title="Reduzir quantidade"
                            >
                              <Minus size={11} />
                            </button>
                            <span className="font-mono text-xs font-bold text-koma-foreground px-1">{item.quantidade || 1}</span>
                            <button
                              type="button"
                              onClick={() => {
                                onUpdateDraftItem(item.id, { quantidade: (item.quantidade || 1) + 1 });
                              }}
                              className="p-1 hover:bg-koma-raised text-koma-subtle hover:text-emerald-500 rounded transition-colors cursor-pointer"
                              title="Aumentar quantidade"
                            >
                              <Plus size={11} />
                            </button>
                          </div>

                          <button
                            id={`remove-draft-item-${item.id}`}
                            onClick={() => onRemoveFromDraft(item.id)}
                            className="text-koma-subtle hover:text-rose-500 transition-colors p-1.5 rounded hover:bg-koma-card cursor-pointer"
                            title="Remover item"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Observations */}
                      <div className="space-y-1.5 pt-1.5 border-t border-koma-border">
                        <div className="flex items-center justify-between text-[10px] text-koma-muted font-sans font-medium">
                          <div className="flex items-center gap-1">
                            <FileText size={10} className="text-emerald-700 dark:text-emerald-400" />
                            <span>Observação de Preparo:</span>
                          </div>
                          {item.observacao && (
                            <button
                              onClick={() => onUpdateDraftItem(item.id, { observacao: '' })}
                              className="text-[9px] text-emerald-700 dark:text-emerald-400 hover:underline"
                            >
                              Limpar
                            </button>
                          )}
                        </div>
                        
                        <input
                          id={`draft-item-obs-${item.id}`}
                          type="text"
                          value={item.observacao}
                          onChange={(e) => onUpdateDraftItem(item.id, { observacao: e.target.value })}
                          placeholder="Ex: sem cebola, molho à parte..."
                          className="w-full px-2.5 py-1.5 text-xs bg-koma-card border border-koma-border rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500/50 text-koma-foreground"
                        />

                        {/* Presets */}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(() => {
                            const product = liveProdutos.find(p => p.id === item.produtoId);
                            const presets = product ? getProductPresets(product) : ['VIAGEM', 'PRA MESA'];
                            return presets.map((preset) => {
                              const parts = item.observacao ? item.observacao.split(',').map(p => p.trim()) : [];
                              const isActive = parts.some(p => p.toLowerCase() === preset.toLowerCase());
                              return (
                                <button
                                  key={preset}
                                  onClick={() => {
                                    const currentParts = item.observacao ? item.observacao.split(',').map(p => p.trim()) : [];
                                    const exists = currentParts.some(p => p.toLowerCase() === preset.toLowerCase());
                                    const updatedParts = exists 
                                      ? currentParts.filter(p => p.toLowerCase() !== preset.toLowerCase() && p !== '')
                                      : [...currentParts.filter(p => p !== ''), preset];
                                    onUpdateDraftItem(item.id, { observacao: updatedParts.join(', ') });
                                  }}
                                  className={`px-2 py-0.5 text-[9px] rounded border transition-colors font-medium cursor-pointer ${
                                    isActive 
                                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 font-bold'
                                      : 'bg-koma-raised hover:bg-emerald-500/15 text-koma-muted hover:text-koma-foreground border-koma-border'
                                  }`}
                                >
                                  {isActive ? preset : `+${preset}`}
                                </button>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submit Actions (Fixado no rodapé) */}
                <div className="mt-4 pt-4 border-t border-koma-border space-y-3.5 shrink-0">
                  
                  {/* Order Type Toggle Selector */}
                  <div className="space-y-1.5 font-sans">
                    <span className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">Tipo do Pedido:</span>
                    <div className={`${allowExternalOrders ? 'grid-cols-2' : 'grid-cols-1'} grid bg-koma-card border border-koma-border rounded-xl p-1`}>
                      <button
                        type="button"
                        onClick={() => setOrderType('Consumo no Local')}
                        className={`py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                          orderType === 'Consumo no Local'
                            ? 'bg-emerald-600/25 border border-emerald-500/30 text-emerald-400 shadow-sm font-bold'
                            : 'text-koma-subtle hover:text-koma-foreground'
                        }`}
                      >
                        Consumo no Local
                      </button>
                      {allowExternalOrders && (
                      <button
                        type="button"
                        onClick={() => setOrderType('Retirada')}
                        className={`py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                          orderType === 'Retirada'
                            ? 'bg-emerald-600/25 border border-emerald-500/30 text-emerald-400 shadow-sm font-bold'
                            : 'text-koma-subtle hover:text-koma-foreground'
                        }`}
                      >
                        Retirada (Balcão)
                      </button>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-baseline font-sans pt-1">
                    <span className="text-xs text-koma-subtle font-bold uppercase tracking-wider">Subtotal Rascunho:</span>
                    <span className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400">
                      R$ {draftTotal.toFixed(2)}
                    </span>
                  </div>

                  <div className="bg-koma-card border border-koma-border rounded-xl px-3 py-2 flex items-start gap-2">
                    <Info size={14} className="text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-koma-muted leading-normal font-sans">
                      Ao lançar, os itens entram na conta da mesa e seguem para a cozinha.
                    </p>
                  </div>

                  <button
                    id="submit-draft-order-btn"
                    disabled={isSubmitting}
                    onClick={() => onSubmitDraft(orderType)}
                    className="hidden sm:flex w-full min-h-12 py-3 bg-emerald-600 hover:bg-emerald-500 text-koma-foreground rounded-xl font-bold text-sm items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/10 transition-colors cursor-pointer uppercase tracking-wider font-sans border border-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span>{isSubmitting ? 'Lançando...' : 'Lançar Pedido'}</span>
                    <ArrowRight size={14} />
                  </button>
                </div>

                {/* No celular, total e ação permanecem ao alcance do polegar. */}
                <div className="sm:hidden fixed inset-x-0 bottom-0 z-[80] border-t border-emerald-500/20 bg-koma-card/95 px-3 pt-2 pb-[calc(0.65rem+env(safe-area-inset-bottom))] shadow-[0_-12px_30px_rgba(0,0,0,0.55)] backdrop-blur-xl">
                  <div className="mx-auto flex max-w-2xl items-center gap-3">
                    <div className="min-w-[92px]">
                      <span className="block text-[9px] font-bold uppercase tracking-wider text-koma-subtle">Total</span>
                      <span className="block font-mono text-lg font-bold leading-tight text-emerald-400">
                        R$ {draftTotal.toFixed(2)}
                      </span>
                    </div>
                    <button
                      id="submit-draft-order-btn-mobile"
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => onSubmitDraft(orderType)}
                      className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500 px-4 py-3 text-sm font-bold uppercase tracking-wide text-black shadow-lg shadow-emerald-500/10 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>{isSubmitting ? 'Lançando...' : 'Lançar pedido'}</span>
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. VIEW: MENU (CARDÁPIO DE PRODUTOS) */}
      {view === 'menu' && (
        <div className="flex flex-col justify-between max-w-4xl mx-auto bg-koma-panel sm:border sm:border-koma-border sm:rounded-3xl p-0 border-0 rounded-none">
          <div>
            
            {/* Sticky Search & Direct 1-Touch Categories Bar (FLUSH TOP ZERO GAP) */}
            <div className="sticky top-0 z-30 bg-koma-panel px-3 sm:px-5 pt-2.5 pb-2 border-b border-koma-border space-y-2 shadow-sm">
              {/* Search Bar + Settings View Toggle */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-koma-subtle" />
                  <input
                    id="search-products-input"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar no cardápio..."
                    className="w-full pl-9 pr-7 py-2 text-xs sm:text-sm bg-koma-input border border-koma-border rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-koma-foreground placeholder:text-zinc-500"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2.5 text-koma-subtle hover:text-koma-foreground cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Settings Toggle */}
                <div className="relative shrink-0">
                  <button
                    id="toggle-menu-settings"
                    onClick={() => setShowSettings(!showSettings)}
                    className="min-h-9 p-2 text-koma-subtle hover:text-koma-foreground bg-koma-card hover:bg-koma-raised rounded-xl transition-colors cursor-pointer border border-koma-border"
                    title="Ajustar visualização"
                    aria-label="Ajustar visualização"
                  >
                    <SlidersHorizontal size={15} />
                  </button>

                  {showSettings && (
                    <div className="absolute right-0 top-full mt-2 w-52 bg-koma-dialog border border-koma-border shadow-2xl rounded-2xl p-3 z-50 space-y-2">
                      <span className="block text-[10px] font-sans font-bold text-koma-subtle uppercase tracking-wider">Ajustes da Tela</span>
                      <label className="flex items-center justify-between text-xs text-koma-muted cursor-pointer p-1.5 rounded-lg hover:bg-koma-raised">
                        <span>Exibir imagens</span>
                        <input
                          id="toggle-images-setting"
                          type="checkbox"
                          checked={settings.exibirImagens}
                          onChange={(e) => onUpdateSettings({ ...settings, exibirImagens: e.target.checked })}
                          className="rounded border-koma-border text-emerald-400 focus:ring-emerald-500 h-4 w-4 bg-koma-input"
                        />
                      </label>
                      <label className="flex items-center justify-between text-xs text-koma-muted cursor-pointer p-1.5 rounded-lg hover:bg-koma-raised">
                        <span>Exibir descrições</span>
                        <input
                          id="toggle-desc-setting"
                          type="checkbox"
                          checked={settings.exibirDescricoes}
                          onChange={(e) => onUpdateSettings({ ...settings, exibirDescricoes: e.target.checked })}
                          className="rounded border-koma-border text-emerald-400 focus:ring-emerald-500 h-4 w-4 bg-koma-input"
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>

              {/* Direct 1-Touch Horizontal Category Chips Carousel (Mobile & Desktop) */}
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none no-scrollbar -mx-0.5 px-0.5">
                {categoriesList.map((catObj) => (
                  <button
                    key={catObj.id}
                    id={`cat-btn-${catObj.nome.toLowerCase().replace(/\s+/g, '-')}`}
                    onClick={() => {
                      setSelectedCategory(catObj.nome);
                      setSearchQuery('');
                      setTimeout(() => {
                        const element = document.getElementById(`category-sec-${catObj.nome.toLowerCase().replace(/\s+/g, '-')}`);
                        element?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                      }, 50);
                    }}
                    className={`px-3 py-1.5 text-xs font-bold rounded-xl whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                      selectedCategory === catObj.nome
                        ? 'bg-emerald-500 text-zinc-950 shadow-md font-extrabold'
                        : 'bg-koma-card hover:bg-koma-raised text-koma-muted hover:text-koma-foreground border border-koma-border'
                    }`}
                  >
                    {catObj.nome}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Products List grouped by Categories */}
            <div className="p-3 sm:p-5 flex flex-col gap-4 sm:gap-6 sm:max-h-[50vh] sm:overflow-y-auto max-h-none overflow-y-visible sm:pr-1">
              {(() => {
                let totalRendered = 0;
                const productsList = liveProdutos.filter((product) => product.ativo !== false);

                const renderedSections = categoriesList.map((catObj) => {
                  const categoryProducts = productsList.filter((product) => {
                    const prodCatName = obterNomeCategoria(product.categoria);
                    const matchesCategory = product.categoria_id === catObj.id || prodCatName === catObj.nome;
                    const fullProductText = `${product.nome} ${product.descricao || ''}`;
                    const matchesSearch = !searchQuery || smartSearchMatch(fullProductText, searchQuery);
                    return matchesCategory && matchesSearch;
                  });

                  if (categoryProducts.length === 0) return null;
                  totalRendered += categoryProducts.length;

                  return (
                    <div 
                      key={catObj.id} 
                      id={`category-sec-${catObj.nome.toLowerCase().replace(/\s+/g, '-')}`}
                      className={`space-y-2 sm:space-y-3 scroll-mt-2 pt-1 sm:pt-2 ${
                        !searchQuery && selectedCategory !== catObj.nome ? 'hidden sm:block' : ''
                      }`}
                    >
                      <h4 className="font-serif text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider border-b border-koma-border pb-1.5 pt-1">
                        {catObj.nome}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-4 pb-28 sm:pb-6">
                        {categoryProducts.map((product) => {
                          const matchingDraftItems = draftItems.filter((it) => it.produtoId === product.id);
                          const currentCountInDraft = matchingDraftItems.reduce((acc, it) => acc + (it.quantidade || 1), 0);

                          return (
                          <div
                            key={product.id}
                            id={`product-card-${product.id}`}
                            className={`border rounded-xl sm:rounded-2xl p-3 sm:p-4 flex flex-col justify-between group cursor-pointer transition-all ${
                              currentCountInDraft > 0
                                ? 'bg-emerald-500/10 border-emerald-500/40 shadow-sm'
                                : 'bg-koma-card border-koma-border hover:border-emerald-500/30'
                            }`}
                            onClick={() => handleOpenConfig(product)}
                          >
                            <div className="space-y-2 sm:space-y-3">
                              {/* Product Image */}
                              {settings.exibirImagens && product.imagem && (
                                <div 
                                  className="w-full h-32 rounded-lg overflow-hidden relative bg-koma-card border border-koma-border"
                                >
                                  <img
                                    src={product.imagem}
                                    alt={product.nome}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              )}

                              <div>
                                <div className="flex justify-between items-start gap-2">
                                  <h4 
                                    className="font-serif font-bold leading-tight text-sm text-koma-foreground group-hover:text-emerald-700 dark:text-emerald-400 transition-colors"
                                  >
                                    {product.nome}
                                  </h4>
                                  <div className="flex flex-col items-end gap-1 shrink-0">
                                    <span className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                                      R$ {product.preco.toFixed(2)}
                                    </span>
                                  </div>
                                </div>
                                
                                {settings.exibirDescricoes && (
                                  <p className="text-[11px] text-koma-subtle mt-1.5 leading-relaxed line-clamp-2 sm:line-clamp-none">
                                    {product.descricao}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Controles de Adição Rápida e Personalização */}
                            <div className="mt-2.5 sm:mt-4 pt-2 border-t border-koma-border/60">
                              {currentCountInDraft > 0 ? (
                                <div className="flex items-center justify-between gap-1.5">
                                  <div className="flex items-center gap-1 bg-koma-input rounded-xl border border-emerald-500/30 p-0.5 shadow-sm">
                                    <button
                                      type="button"
                                      onClick={(e) => handleQuickSubtract(product, e)}
                                      className="p-1.5 hover:bg-koma-raised text-koma-secondary hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                                      title="Diminuir quantidade"
                                    >
                                      <Minus size={13} />
                                    </button>
                                    <span className="font-mono text-xs font-extrabold text-emerald-700 dark:text-emerald-400 px-2 min-w-[1.75rem] text-center">
                                      {currentCountInDraft}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => handleQuickAdd(product, e)}
                                      className="p-1.5 hover:bg-koma-raised text-koma-secondary hover:text-emerald-400 rounded-lg transition-colors cursor-pointer"
                                      title="Adicionar mais um"
                                    >
                                      <Plus size={13} />
                                    </button>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenConfig(product);
                                    }}
                                    className="min-h-9 px-2.5 py-1.5 flex items-center gap-1 bg-koma-raised hover:bg-emerald-500/15 border border-koma-border hover:border-emerald-500/30 text-koma-muted hover:text-koma-foreground text-[11px] font-bold rounded-xl transition-all cursor-pointer"
                                    title="Personalizar (Obs de cozinha / Cliente)"
                                  >
                                    <Edit3 size={12} className="text-amber-400" />
                                    <span>Obs</span>
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    id={`add-product-btn-${product.id}`}
                                    type="button"
                                    onClick={(e) => handleQuickAdd(product, e)}
                                    className="flex-1 min-h-10 flex items-center justify-center gap-1 py-2 text-xs font-bold rounded-xl transition-all border bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-sm border-emerald-400 cursor-pointer active:scale-95"
                                  >
                                    <Plus size={14} />
                                    <span>Adicionar</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenConfig(product);
                                    }}
                                    className="min-h-10 px-3 flex items-center justify-center bg-koma-raised hover:bg-koma-card border border-koma-border text-koma-subtle hover:text-koma-foreground rounded-xl transition-all cursor-pointer"
                                    title="Personalizar (Obs / Cliente)"
                                  >
                                    <Edit3 size={14} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );})}
                      </div>
                    </div>
                  );
                });

                if (totalRendered === 0) {
                  return (
                    <div className="py-12 text-center text-koma-subtle text-sm italic font-serif">
                      {catalogReady
                        ? 'Nenhum item disponível no cardápio.'
                        : 'Carregando o cardápio…'}
                    </div>
                  );
                }

                return renderedSections;
              })()}
            </div>

            {/* STICKY BOTTOM CART BAR (MOBILE & SALÃO) */}
            {view === 'menu' && totalDraftQty > 0 && (
              <div className="sticky bottom-0 left-0 right-0 z-40 -mx-3 -mb-3 sm:-mx-5 sm:-mb-5 p-2.5 sm:p-3 bg-koma-panel/95 backdrop-blur-md border-t border-koma-border shadow-[0_-8px_24px_rgba(0,0,0,0.35)] animate-slide-up">
                <div className="flex items-center justify-between gap-2 sm:gap-3 max-w-2xl mx-auto">
                  <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
                    <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-extrabold shrink-0 font-mono text-xs sm:text-sm shadow-sm">
                      {totalDraftQty}
                    </div>
                    <div className="min-w-0">
                      <span className="text-[11px] sm:text-xs font-bold text-koma-foreground block truncate leading-tight">
                        {totalDraftQty === 1 ? '1 item' : `${totalDraftQty} itens`}
                      </span>
                      <span className="text-xs sm:text-sm font-bold font-mono text-emerald-400 block leading-tight">
                        R$ {draftTotal.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={openCartReview}
                    className="min-h-10 sm:min-h-11 px-3.5 sm:px-5 py-2 sm:py-2.5 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-zinc-950 text-xs font-extrabold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 sm:gap-2 shadow-lg shadow-emerald-900/30 border border-emerald-400 shrink-0"
                  >
                    <span>Revisar Pedido</span>
                    <ArrowRight size={14} className="shrink-0" />
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* 3. PRODUCT CONFIGURATION OVERLAY MODAL */}
      {selectedProductToConfigure && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedProductToConfigure(null);
            }
          }}
          className="fixed inset-0 bg-koma-overlay z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in cursor-pointer"
        >
          <div className="bg-koma-card border border-koma-border rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[92dvh] overflow-y-auto p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 sm:space-y-4 shadow-2xl animate-scale-in">
            
            {/* Modal Header */}
            <div className="flex justify-between items-start border-b border-koma-border pb-3">
              <div>
                <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">{obterNomeCategoria(selectedProductToConfigure.categoria)}</span>
                <h4 className="font-serif font-bold text-base sm:text-lg text-koma-foreground mt-0.5">{selectedProductToConfigure.nome}</h4>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProductToConfigure(null)}
                className="p-1 hover:bg-koma-raised rounded-full text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-transparent"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="space-y-3 sm:space-y-4 font-sans text-xs">
              
              {/* Product description / image preview */}
              {selectedProductToConfigure.descricao && (
                <p className="text-koma-subtle leading-relaxed text-[11px] bg-koma-card px-3 py-2.5 rounded-xl border border-koma-border">
                  {selectedProductToConfigure.descricao}
                </p>
              )}

              {/* Quantity selector */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-koma-secondary uppercase tracking-wider block">Quantidade:</span>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center bg-koma-input rounded-xl border border-koma-border p-1">
                    <button
                      type="button"
                      onClick={() => setConfigQty(prev => Math.max(1, prev - 1))}
                      className="p-2 hover:bg-koma-raised text-koma-secondary hover:text-rose-500 rounded-lg transition-colors cursor-pointer"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="font-mono text-sm font-bold text-koma-foreground px-4 min-w-[3rem] text-center">{configQty}</span>
                    <button
                      type="button"
                      onClick={() => setConfigQty(prev => prev + 1)}
                      className="p-2 hover:bg-koma-raised text-koma-secondary hover:text-emerald-500 rounded-lg transition-colors cursor-pointer"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <span className="font-mono text-sm font-bold text-emerald-400 text-right">
                    R$ {(selectedProductToConfigure.preco * configQty).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Observations */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-bold text-koma-secondary uppercase tracking-wider block font-sans">
                  <span>Observações de preparo (Cozinha):</span>
                  {configObs && (
                    <button
                      type="button"
                      onClick={() => setConfigObs('')}
                      className="text-[9px] text-emerald-400 hover:underline cursor-pointer"
                    >
                      Limpar
                    </button>
                  )}
                </div>
                <input
                  id="config-item-obs"
                  type="text"
                  value={configObs}
                  onChange={(e) => setConfigObs(e.target.value)}
                  placeholder="Ex: sem cheddar, mal passado, sem cebola..."
                  className="w-full px-3 py-2 bg-koma-input text-koma-foreground border border-koma-border rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500/50 transition-all"
                />

                {/* Preset shortcuts */}
                <div className="space-y-1 pt-0.5">
                  <span className="text-[9px] text-koma-muted block">Atalhos rápidos de observação:</span>
                  <div className="flex flex-wrap gap-1">
                    {(selectedProductToConfigure ? getProductPresets(selectedProductToConfigure) : ['VIAGEM', 'PRA MESA']).map((preset) => {
                      const parts = configObs ? configObs.split(',').map(p => p.trim()) : [];
                      const isActive = parts.some(p => p.toLowerCase() === preset.toLowerCase());
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            const currentParts = configObs ? configObs.split(',').map(p => p.trim()) : [];
                            const exists = currentParts.some(p => p.toLowerCase() === preset.toLowerCase());
                            const updatedParts = exists
                              ? currentParts.filter(p => p.toLowerCase() !== preset.toLowerCase() && p !== '')
                              : [...currentParts.filter(p => p !== ''), preset];
                            setConfigObs(updatedParts.join(', '));
                          }}
                          className={`px-2.5 py-1 text-[9px] rounded-lg border transition-colors font-medium cursor-pointer ${
                            isActive
                              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
                              : 'bg-koma-raised hover:bg-emerald-500/25 text-koma-secondary hover:text-koma-foreground border-koma-border'
                          }`}
                        >
                          {isActive ? preset : `+${preset}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Client Identifier */}
              <div className="space-y-1.5">
                <label htmlFor="config-client-name" className="text-[10px] font-bold text-koma-secondary uppercase tracking-wider block font-sans">
                  Identificar Cliente (Opcional):
                </label>
                <input
                  id="config-client-name"
                  type="text"
                  value={configClient}
                  onChange={(e) => setConfigClient(e.target.value)}
                  placeholder="Ex: Pedro, Cláudia, Mesa Direita..."
                  className="w-full px-3 py-2 bg-koma-input text-koma-foreground border border-koma-border rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500/50 transition-all"
                />

                {combinedSuggestions.length > 0 && (
                  <div className="space-y-1 pt-0.5">
                    <span className="text-[9px] text-koma-subtle block">Escolher do atendimento atual:</span>
                    <div className="flex flex-wrap gap-1">
                      {combinedSuggestions.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setConfigClient(name)}
                          className={`px-2 py-0.5 text-[9px] border rounded transition-colors font-medium cursor-pointer ${
                            configClient === name
                              ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/40 font-bold'
                              : 'bg-koma-raised hover:bg-emerald-500/15 text-koma-muted hover:text-koma-foreground border-koma-border'
                          }`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* Modal Actions */}
            <div className="flex items-center gap-3 pt-3 border-t border-koma-border">
              <button
                type="button"
                onClick={() => setSelectedProductToConfigure(null)}
                className="flex-1 py-2.5 border border-koma-border hover:bg-koma-raised text-koma-muted hover:text-koma-foreground text-xs font-bold rounded-xl transition-all cursor-pointer text-center"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmAdd}
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 border border-emerald-400 text-zinc-950 text-xs font-extrabold rounded-xl transition-all cursor-pointer text-center shadow-md shadow-emerald-900/30 active:scale-95"
              >
                Adicionar ao Pedido
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
