/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Search, Plus, Minus, Trash2, SlidersHorizontal, ArrowRight, FileText, Info, ShoppingCart, X } from 'lucide-react';
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

  // Total draft count and price
  const totalDraftQty = draftItems.reduce((sum, item) => sum + (item.quantidade || 1), 0);
  const draftTotal = draftItems.reduce((sum, item) => sum + (item.preco * (item.quantidade || 1)), 0);

  return (
    <div className="relative sm:h-full">
      {/* 1. VIEW: CART (CARRINHO DE COMPRAS) */}
      {view === 'cart' && (
        <div className="bg-[#121214] sm:border sm:border-[#27272A] sm:rounded-3xl p-3 pb-28 sm:p-5 flex flex-col sm:h-full max-w-2xl mx-auto border-0 rounded-none overflow-visible sm:overflow-hidden min-h-0">
          <div className="flex flex-col sm:h-full justify-between min-h-0">
            
            {/* Cart Header */}
            <div className="sticky top-0 z-40 -mx-3 -mt-3 mb-3 flex shrink-0 items-center justify-between gap-3 border-b border-[#27272A] bg-[#121214] px-3 pb-3 pt-3 shadow-[0_8px_18px_rgba(0,0,0,0.28)] sm:static sm:mx-0 sm:mt-0 sm:bg-transparent sm:px-0 sm:pt-0 sm:shadow-none">
              <div className="flex items-center gap-1.5 text-white">
                <ShoppingCart size={18} className="text-[#10b981]" />
                <div>
                  <h3 className="font-serif font-bold text-base leading-tight">Revisar pedido</h3>
                  <p className="text-[10px] text-gray-400 mt-0.5">Mesa {tableId}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openMenu}
                  className="min-h-10 px-3 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-1 border border-emerald-400 shadow-sm"
                >
                  <Plus size={13} />
                  <span>Adicionar</span>
                </button>
                <span className="px-2.5 py-0.5 text-xs font-bold font-mono bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full">
                  {totalDraftQty} {totalDraftQty === 1 ? 'item' : 'itens'}
                </span>
              </div>
            </div>

            {/* Cart Body */}
            {draftItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center space-y-3 flex-1">
                <div className="text-sm text-white font-semibold font-sans">Nenhum item no pedido</div>
                <p className="text-xs text-gray-400 max-w-[260px] leading-relaxed">Escolha os produtos da Mesa {tableId}.</p>
                <button
                  type="button"
                  onClick={openMenu}
                  className="min-h-11 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 border border-emerald-400 text-black rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  Abrir cardápio
                </button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-between min-h-0 overflow-hidden">
                <div className="flex-1 overflow-visible sm:overflow-y-auto min-h-0 sm:pr-1 space-y-3">
                {/* Global table client name config */}
                <div className="bg-[#1C1C1F] border border-[#27272A] p-3 rounded-xl space-y-2 shadow-sm">
                  <label htmlFor="overall-client-name" className="text-[10px] font-sans font-bold text-gray-300 uppercase tracking-wider block">
                    Cliente do pedido <span className="normal-case text-gray-500">(opcional)</span>
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
                      className="w-full px-3 py-2 bg-[#121214] text-white border border-[#27272A] rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500/50 transition-all"
                    />
                  </div>

                  {combinedSuggestions.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[9px] text-gray-400 font-sans block">Clientes atendidos nesta mesa (toque p/ preencher):</span>
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
                            className="px-2 py-0.5 text-[9px] bg-[#27272A] hover:bg-[#10b981]/15 text-gray-300 hover:text-white border border-[#27272A] rounded transition-colors font-medium cursor-pointer"
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
                      className="p-3 bg-[#1C1C1F] border border-[#27272A] rounded-xl space-y-2.5 shadow-sm group"
                    >
                      {/* Item Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-1.5 min-w-0">
                          <span className="text-[10px] font-bold font-mono bg-[#121214] text-gray-400 h-5 w-5 rounded-full flex items-center justify-center border border-[#27272A]">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-white block leading-snug">{item.nome}</span>
                            {item.clienteNome && (
                              <span className="text-[9px] font-bold text-[#10b981] uppercase block">Para: {item.clienteNome}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-xs font-mono font-bold text-[#10b981] mr-1">
                            R$ {(item.preco * (item.quantidade || 1)).toFixed(2)}
                          </span>
                          
                          {/* Qty Selector */}
                          <div className="flex items-center gap-1 bg-[#121214] rounded-lg border border-[#27272A] p-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                if (item.quantidade > 1) {
                                  onUpdateDraftItem(item.id, { quantidade: item.quantidade - 1 });
                                } else {
                                  onRemoveFromDraft(item.id);
                                }
                              }}
                              className="p-1 hover:bg-[#27272A] text-gray-400 hover:text-rose-500 rounded transition-colors cursor-pointer"
                              title="Reduzir quantidade"
                            >
                              <Minus size={11} />
                            </button>
                            <span className="font-mono text-xs font-bold text-white px-1">{item.quantidade || 1}</span>
                            <button
                              type="button"
                              onClick={() => {
                                onUpdateDraftItem(item.id, { quantidade: (item.quantidade || 1) + 1 });
                              }}
                              className="p-1 hover:bg-[#27272A] text-gray-400 hover:text-emerald-500 rounded transition-colors cursor-pointer"
                              title="Aumentar quantidade"
                            >
                              <Plus size={11} />
                            </button>
                          </div>

                          <button
                            id={`remove-draft-item-${item.id}`}
                            onClick={() => onRemoveFromDraft(item.id)}
                            className="text-gray-400 hover:text-rose-500 transition-colors p-1.5 rounded hover:bg-[#121214] cursor-pointer"
                            title="Remover item"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Observations */}
                      <div className="space-y-1.5 pt-1.5 border-t border-[#27272A]">
                        <div className="flex items-center justify-between text-[10px] text-gray-300 font-sans font-medium">
                          <div className="flex items-center gap-1">
                            <FileText size={10} className="text-[#10b981]" />
                            <span>Observação de Preparo:</span>
                          </div>
                          {item.observacao && (
                            <button
                              onClick={() => onUpdateDraftItem(item.id, { observacao: '' })}
                              className="text-[9px] text-[#10b981] hover:underline"
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
                          className="w-full px-2.5 py-1.5 text-xs bg-[#121214] border border-[#27272A] rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500/50 text-white"
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
                                      ? 'bg-[#10b981]/20 border-[#10b981]/40 text-[#10b981]'
                                      : 'bg-[#27272A] hover:bg-[#10b981]/15 text-gray-300 hover:text-white border-[#27272A]'
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
                <div className="mt-4 pt-4 border-t border-[#27272A] space-y-3.5 shrink-0">
                  
                  {/* Order Type Toggle Selector */}
                  <div className="space-y-1.5 font-sans">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Tipo do Pedido:</span>
                    <div className={`${allowExternalOrders ? 'grid-cols-2' : 'grid-cols-1'} grid bg-[#121214] border border-[#27272A] rounded-xl p-1`}>
                      <button
                        type="button"
                        onClick={() => setOrderType('Consumo no Local')}
                        className={`py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                          orderType === 'Consumo no Local'
                            ? 'bg-emerald-600/25 border border-emerald-500/30 text-emerald-400 shadow-sm font-bold'
                            : 'text-gray-400 hover:text-white'
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
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        Retirada (Balcão)
                      </button>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-baseline font-sans pt-1">
                    <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">Subtotal Rascunho:</span>
                    <span className="text-2xl font-bold font-mono text-[#10b981]">
                      R$ {draftTotal.toFixed(2)}
                    </span>
                  </div>

                  <div className="bg-[#1C1C1F] border border-[#27272A] rounded-xl px-3 py-2 flex items-start gap-2">
                    <Info size={14} className="text-[#10b981] shrink-0 mt-0.5" />
                    <p className="text-[10px] text-gray-300 leading-normal font-sans">
                      Ao lançar, os itens entram na conta da mesa e seguem para a cozinha.
                    </p>
                  </div>

                  <button
                    id="submit-draft-order-btn"
                    disabled={isSubmitting}
                    onClick={() => onSubmitDraft(orderType)}
                    className="hidden sm:flex w-full min-h-12 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/10 transition-colors cursor-pointer uppercase tracking-wider font-sans border border-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span>{isSubmitting ? 'Lançando...' : 'Lançar Pedido'}</span>
                    <ArrowRight size={14} />
                  </button>
                </div>

                {/* No celular, total e ação permanecem ao alcance do polegar. */}
                <div className="sm:hidden fixed inset-x-0 bottom-0 z-[80] border-t border-emerald-500/20 bg-[#121214]/95 px-3 pt-2 pb-[calc(0.65rem+env(safe-area-inset-bottom))] shadow-[0_-12px_30px_rgba(0,0,0,0.55)] backdrop-blur-xl">
                  <div className="mx-auto flex max-w-2xl items-center gap-3">
                    <div className="min-w-[92px]">
                      <span className="block text-[9px] font-bold uppercase tracking-wider text-gray-400">Total</span>
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
        <div className="lg:col-span-12 flex flex-col justify-between max-w-4xl mx-auto bg-[#121214] sm:border sm:border-[#27272A] sm:rounded-3xl p-3 sm:p-5 sm:min-h-[450px] border-0 rounded-none">
          <div className="space-y-3 sm:space-y-4">
            
            {/* Header: Title and Back button */}
            <div className="sticky top-0 z-40 -mx-3 -mt-3 flex items-center justify-between gap-3 border-b border-[#27272A] bg-[#121214] px-3 pb-3 pt-3 shadow-[0_8px_18px_rgba(0,0,0,0.28)] sm:static sm:mx-0 sm:mt-0 sm:bg-transparent sm:px-0 sm:pt-0 sm:shadow-none">
              <div className="min-w-0">
                <div>
                  <h3 className="font-serif text-lg sm:text-xl font-bold text-white tracking-tight">Adicionar itens</h3>
                  <p className="text-[11px] sm:text-xs text-[#A1A1AA] font-sans">Pedido da Mesa {tableId}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={openCartReview}
                  className={`min-h-10 px-3 py-2 text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm border ${
                    totalDraftQty > 0
                      ? 'bg-emerald-500 text-black border-emerald-400 hover:bg-emerald-400'
                      : 'bg-[#1C1C1F] text-white border-[#27272A] hover:bg-[#27272A]'
                  }`}
                >
                  <ShoppingCart size={14} />
                  <span>Revisar</span>
                  <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-0.5 ${
                    totalDraftQty > 0 ? 'bg-black/15 text-black' : 'bg-[#121214] text-gray-300'
                  }`}>
                    {totalDraftQty}
                  </span>
                </button>
                
                {/* Settings Toggle */}
                <div className="relative">
                  <button
                    id="toggle-menu-settings"
                    onClick={() => setShowSettings(!showSettings)}
                    className="min-h-10 p-2.5 text-gray-400 hover:text-white bg-[#1C1C1F] hover:bg-[#27272A] rounded-xl transition-colors cursor-pointer border border-[#27272A]"
                    title="Ajustar visualização"
                    aria-label="Ajustar visualização"
                  >
                    <SlidersHorizontal size={15} />
                  </button>

                  {showSettings && (
                    <div className="absolute right-0 top-full mt-2 w-56 bg-[#1C1C1F] border border-[#27272A] shadow-xl rounded-xl p-3.5 z-30 space-y-2.5">
                      <span className="block text-[10px] font-sans font-bold text-[#A1A1AA] mb-1 uppercase tracking-wider">Ajustes da Tela</span>
                      <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer p-1.5 rounded hover:bg-[#27272A]">
                        <span>Exibir imagens</span>
                        <input
                          id="toggle-images-setting"
                          type="checkbox"
                          checked={settings.exibirImagens}
                          onChange={(e) => onUpdateSettings({ ...settings, exibirImagens: e.target.checked })}
                          className="rounded border-[#27272A] text-rose-400 focus:ring-[#f43f5e] h-4 w-4 bg-[#121214]"
                        />
                      </label>
                      <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer p-1.5 rounded hover:bg-[#27272A]">
                        <span>Exibir descrições</span>
                        <input
                          id="toggle-desc-setting"
                          type="checkbox"
                          checked={settings.exibirDescricoes}
                          onChange={(e) => onUpdateSettings({ ...settings, exibirDescricoes: e.target.checked })}
                          className="rounded border-[#27272A] text-rose-400 focus:ring-[#f43f5e] h-4 w-4 bg-[#121214]"
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Search & Categories */}
            <div className="bg-[#121214] pt-1 pb-1.5 space-y-2.5">
              <div className="relative">
                <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-gray-400" />
                <input
                  id="search-products-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar no cardápio..."
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-[#121214] border border-[#27272A] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#10b981]/20 focus:border-[#10b981] transition-all text-white placeholder:text-gray-500"
                />
              </div>

              {/* No celular, o seletor evita uma faixa horizontal difícil de
                  controlar. Os chips permanecem disponíveis em telas maiores. */}
              <label className="block sm:hidden">
                <span className="sr-only">Categoria</span>
                <select
                  id="mobile-category-select"
                  value={selectedCategory}
                  onChange={(event) => {
                    setSelectedCategory(event.target.value);
                    setSearchQuery('');
                    const element = document.getElementById(`category-sec-${event.target.value.toLowerCase().replace(/\s+/g, '-')}`);
                    element?.scrollIntoView({ block: 'start' });
                  }}
                  className="w-full min-h-11 px-3 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-sm font-semibold text-white focus:outline-none focus:border-[#10b981]"
                >
                  {categoriesList.map((category) => (
                    <option key={category.id} value={category.nome}>{category.nome}</option>
                  ))}
                </select>
              </label>

              <div className="hidden sm:flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                {categoriesList.map((catObj) => (
                  <button
                    key={catObj.id}
                    id={`cat-btn-${catObj.nome.toLowerCase().replace(/\s+/g, '-')}`}
                    onClick={() => {
                      setSelectedCategory(catObj.nome);
                      setSearchQuery('');
                      setTimeout(() => {
                        const element = document.getElementById(`category-sec-${catObj.nome.toLowerCase().replace(/\s+/g, '-')}`);
                        element?.scrollIntoView({ block: 'start' });
                      }, 50);
                    }}
                    className={`px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                      selectedCategory === catObj.nome
                        ? 'bg-rose-900/40 border border-rose-800/50 text-white shadow-md'
                        : 'bg-[#1C1C1F] hover:bg-[#27272A] text-gray-300 hover:text-white border border-[#27272A]'
                    }`}
                  >
                    {catObj.nome}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Products List grouped by Categories */}
            <div className="flex flex-col gap-4 sm:gap-6 sm:max-h-[50vh] sm:overflow-y-auto max-h-none overflow-y-visible sm:pr-1">
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
                      <h4 className="font-serif text-xs font-bold text-[#10b981] uppercase tracking-wider border-b border-[#27272A] pb-1.5 pt-1">
                        {catObj.nome}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-4">
                        {categoryProducts.map((product) => {
                          return (
                          <div
                            key={product.id}
                            id={`product-card-${product.id}`}
                            className="bg-[#161619] border border-[#27272A] hover:border-[#10b981]/30 rounded-xl sm:rounded-2xl p-3 sm:p-4 flex flex-col justify-between group cursor-pointer"
                            onClick={() => handleOpenConfig(product)}
                          >
                            <div className="space-y-2 sm:space-y-3">
                              {/* Product Image */}
                              {settings.exibirImagens && product.imagem && (
                                <div 
                                  className="w-full h-32 rounded-lg overflow-hidden relative bg-[#1C1C1F] border border-[#27272A]"
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
                                    className="font-serif font-bold leading-tight text-sm text-white group-hover:text-[#10b981] transition-colors"
                                  >
                                    {product.nome}
                                  </h4>
                                  <div className="flex flex-col items-end gap-1 shrink-0">
                                    <span className="font-mono text-xs font-bold text-[#10b981] whitespace-nowrap">
                                      R$ {product.preco.toFixed(2)}
                                    </span>
                                  </div>
                                </div>
                                
                                {settings.exibirDescricoes && (
                                  <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed line-clamp-2 sm:line-clamp-none">
                                    {product.descricao}
                                  </p>
                                )}
                              </div>
                            </div>

                            <button
                              id={`add-product-btn-${product.id}`}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenConfig(product);
                              }}
                              className="mt-2.5 sm:mt-4 w-full min-h-10 flex items-center justify-center gap-1 py-2 text-xs font-bold rounded-xl transition-colors border bg-[#1C1C1F] hover:bg-[#10b981]/20 text-[#10b981] cursor-pointer border-[#27272A]"
                            >
                              <Plus size={13} /><span>Adicionar</span>
                            </button>
                          </div>
                        );})}
                      </div>
                    </div>
                  );
                });

                if (totalRendered === 0) {
                  return (
                    <div className="py-12 text-center text-gray-400 text-sm italic font-serif">
                      {catalogReady
                        ? 'Nenhum item disponível no cardápio.'
                        : 'Carregando o cardápio…'}
                    </div>
                  );
                }

                return renderedSections;
              })()}
            </div>

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
          className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in cursor-pointer"
        >
          <div className="bg-[#1C1C1F] border border-[#27272A] rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[92dvh] overflow-y-auto p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 sm:space-y-4 shadow-2xl animate-scale-in">
            
            {/* Modal Header */}
            <div className="flex justify-between items-start border-b border-[#27272A] pb-3">
              <div>
                <span className="text-[10px] font-bold text-[#10b981] uppercase tracking-wider">{obterNomeCategoria(selectedProductToConfigure.categoria)}</span>
                <h4 className="font-serif font-bold text-base sm:text-lg text-white mt-0.5">{selectedProductToConfigure.nome}</h4>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProductToConfigure(null)}
                className="p-1 hover:bg-[#27272A] rounded-full text-gray-400 hover:text-white transition-colors cursor-pointer border border-transparent"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="space-y-3 sm:space-y-4 font-sans text-xs">
              
              {/* Product description / image preview */}
              {selectedProductToConfigure.descricao && (
                <p className="text-gray-400 leading-relaxed text-[11px] bg-[#121214] px-3 py-2.5 rounded-xl border border-[#27272A]">
                  {selectedProductToConfigure.descricao}
                </p>
              )}

              {/* Quantity selector */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wider block">Quantidade:</span>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center bg-[#121214] rounded-xl border border-[#27272A] p-1">
                    <button
                      type="button"
                      onClick={() => setConfigQty(prev => Math.max(1, prev - 1))}
                      className="p-2 hover:bg-[#27272A] text-gray-300 hover:text-rose-500 rounded-lg transition-colors cursor-pointer"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="font-mono text-sm font-bold text-white px-4 min-w-[3rem] text-center">{configQty}</span>
                    <button
                      type="button"
                      onClick={() => setConfigQty(prev => prev + 1)}
                      className="p-2 hover:bg-[#27272A] text-gray-300 hover:text-emerald-500 rounded-lg transition-colors cursor-pointer"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <span className="font-mono text-sm font-bold text-[#10b981] text-right">
                    R$ {(selectedProductToConfigure.preco * configQty).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Observations */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-bold text-gray-300 uppercase tracking-wider block font-sans">
                  <span>Observações de preparo (Cozinha):</span>
                  {configObs && (
                    <button
                      type="button"
                      onClick={() => setConfigObs('')}
                      className="text-[9px] text-[#10b981] hover:underline"
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
                  className="w-full px-3 py-2 bg-[#121214] text-white border border-[#27272A] rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500/50 transition-all"
                />

                {/* Preset shortcuts */}
                <div className="space-y-1 pt-0.5">
                  <span className="text-[9px] text-gray-500 block">Atalhos rápidos de observação:</span>
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
                              ? 'bg-[#10b981]/20 border-[#10b981]/40 text-[#10b981]'
                              : 'bg-[#27272A] hover:bg-[#10b981]/25 text-gray-300 hover:text-white border-[#27272A]'
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
                <label htmlFor="config-client-name" className="text-[10px] font-bold text-gray-300 uppercase tracking-wider block font-sans">
                  Identificar Cliente (Opcional):
                </label>
                <input
                  id="config-client-name"
                  type="text"
                  value={configClient}
                  onChange={(e) => setConfigClient(e.target.value)}
                  placeholder="Ex: Pedro, Cláudia, Mesa Direita..."
                  className="w-full px-3 py-2 bg-[#121214] text-white border border-[#27272A] rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500/50 transition-all"
                />

                {combinedSuggestions.length > 0 && (
                  <div className="space-y-1 pt-0.5">
                    <span className="text-[9px] text-gray-500 block">Escolher do atendimento atual:</span>
                    <div className="flex flex-wrap gap-1">
                      {combinedSuggestions.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setConfigClient(name)}
                          className={`px-2 py-0.5 text-[9px] border rounded transition-colors font-medium cursor-pointer ${
                            configClient === name
                              ? 'bg-[#10b981]/20 text-[#10b981] border-[#10b981]/40'
                              : 'bg-[#27272A] hover:bg-[#10b981]/15 text-gray-300 hover:text-white border-[#27272A]'
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
            <div className="flex items-center gap-3 pt-3 border-t border-[#27272A]">
              <button
                type="button"
                onClick={() => setSelectedProductToConfigure(null)}
                className="flex-1 py-2.5 border border-[#27272A] hover:bg-[#27272A] text-gray-300 hover:text-white text-xs font-bold rounded-xl transition-all cursor-pointer text-center"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmAdd}
                className="flex-1 py-2.5 bg-rose-900/40 border border-rose-800/50 hover:bg-[#601823] text-white text-xs font-bold rounded-xl transition-all cursor-pointer text-center shadow-lg shadow-[#f43f5e]/10"
              >
                Confirmar
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
