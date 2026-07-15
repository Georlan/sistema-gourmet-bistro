/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Search, Plus, Minus, Trash2, SlidersHorizontal, ArrowRight, FileText, Info, ArrowLeft, ShoppingCart, X } from 'lucide-react';
import { Product, DraftItem, AppSettings, Order } from '../types';
import { CATEGORIES, PRODUCTS } from '../data';
import { getProductPresets } from '../domain';

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
  isSubmitting?: boolean;
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
  isSubmitting = false,
}) => {
  // Build availability map: productId -> boolean (true = available)
  // If liveProdutos is empty (not yet loaded), default all to available
  const ativoMap = React.useMemo(() => {
    if (liveProdutos.length === 0) return null; // null = no data, treat all as available
    const map: Record<string | number, boolean> = {};
    liveProdutos.forEach((p: any) => {
      map[p.id] = p.ativo !== false;
      // Also index by nome for static PRODUCTS fallback
      map[p.nome] = p.ativo !== false;
    });
    return map;
  }, [liveProdutos]);

  const isProductAvailable = (product: Product): boolean => {
    if (!ativoMap) return true;
    // Try ID first, then name
    if (ativoMap[product.id] !== undefined) return ativoMap[product.id];
    if (ativoMap[product.nome] !== undefined) return ativoMap[product.nome];
    return true;
  };
  // Navigation state: starts showing the Cart (carrinho) by default
  const [view, setView] = useState<'cart' | 'menu'>('cart');
  const [selectedCategory, setSelectedCategory] = useState<string>('Hambúrgueres Bovinos');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [expandedDraftObs, setExpandedDraftObs] = useState<string | null>(null);

  // Selected product to configure
  const [selectedProductToConfigure, setSelectedProductToConfigure] = useState<Product | null>(null);
  
  // Product configuration modal inputs
  const [configQty, setConfigQty] = useState<number>(1);
  const [configObs, setConfigObs] = useState<string>('');
  const [configClient, setConfigClient] = useState<string>('');
  const [orderType, setOrderType] = useState<'Consumo no Local' | 'Retirada'>('Consumo no Local');



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
    return Array.from(new Set([
      ...historicClients,
      ...suggestedClientNames
    ])).filter(name => name.trim() !== '');
  }, [historicClients, suggestedClientNames]);

  // Open configuration modal
  const handleOpenConfig = (product: Product) => {
    setSelectedProductToConfigure(product);
    setConfigQty(1);
    setConfigObs('');
    // Pre-fill with the first client name if there is already a name in the cart
    setConfigClient(draftItems.length > 0 ? draftItems[0].clienteNome : '');
  };

  // Add configured item to draft and return to cart view
  const handleConfirmAdd = () => {
    if (!selectedProductToConfigure) return;
    onAddToDraft(selectedProductToConfigure, configQty, configObs, configClient);
    setSelectedProductToConfigure(null);
    setView('cart'); // Go back to cart view immediately to show the item
  };

  // Total draft count and price
  const totalDraftQty = draftItems.reduce((sum, item) => sum + (item.quantidade || 1), 0);
  const draftTotal = draftItems.reduce((sum, item) => sum + (item.preco * (item.quantidade || 1)), 0);

  return (
    <div className="relative h-full">
      {/* 1. VIEW: CART (CARRINHO DE COMPRAS) */}
      {view === 'cart' && (
        <div className="bg-[#121214] sm:border sm:border-[#27272A] sm:rounded-3xl p-3 sm:p-5 flex flex-col justify-between h-full sm:min-h-[450px] max-w-2xl mx-auto border-0 rounded-none">
          <div className="flex flex-col h-full justify-between space-y-4">
            
            {/* Cart Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-[#27272A]">
              <div className="flex items-center gap-1.5 text-white">
                <ShoppingCart size={18} className="text-[#10b981]" />
                <h3 className="font-serif font-bold text-base">Carrinho de Lançamento</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setView('menu')}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1 border border-slate-700/50 shadow-sm"
                >
                  <Plus size={13} />
                  <span>Adicionar Itens</span>
                </button>
                <span className="px-2.5 py-0.5 text-xs font-bold font-mono bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full">
                  {totalDraftQty} {totalDraftQty === 1 ? 'item' : 'itens'}
                </span>
              </div>
            </div>

            {/* Cart Body */}
            {draftItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center space-y-4 flex-1">
                <div className="p-4 bg-[#1C1C1F] rounded-full text-[#10b981]/50 border border-[#27272A]">
                  <ShoppingCart size={32} />
                </div>
                <div className="text-sm text-white font-semibold font-sans uppercase tracking-wider">Carrinho Vazio</div>
                <p className="text-xs text-gray-400 max-w-[240px] leading-relaxed">
                  Não há itens no rascunho. Clique no botão abaixo para abrir o cardápio e selecionar os pratos da Mesa {tableId}.
                </p>
                <button
                  type="button"
                  onClick={() => setView('menu')}
                  className="px-5 py-2.5 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-white rounded-xl text-xs font-bold tracking-wider uppercase transition-colors cursor-pointer"
                >
                  Ver Cardápio
                </button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-between space-y-4">
                {/* Global table client name config */}
                <div className="bg-[#1C1C1F] border border-[#27272A] p-4 rounded-2xl space-y-2.5 shadow-sm">
                  <label htmlFor="overall-client-name" className="text-[10px] font-sans font-bold text-gray-300 uppercase tracking-wider block">
                    Identificar Cliente (Opcional - Para todo o carrinho)
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
                <div className="space-y-3 sm:max-h-[40vh] sm:overflow-y-auto max-h-none overflow-y-visible pr-1 scrollbar-thin flex-1">
                  {draftItems.map((item, index) => (
                    <div
                      key={item.id}
                      id={`draft-item-${item.id}`}
                      className="p-4 bg-[#1C1C1F] border border-[#27272A] rounded-2xl space-y-3 shadow-sm group"
                    >
                      {/* Item Header */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold font-mono bg-[#121214] text-gray-400 h-5 w-5 rounded-full flex items-center justify-center border border-[#27272A]">
                            {index + 1}
                          </span>
                          <div>
                            <span className="text-xs font-bold text-white block">{item.nome}</span>
                            {item.clienteNome && (
                              <span className="text-[9px] font-bold text-[#10b981] uppercase block">Para: {item.clienteNome}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
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
                            const product = PRODUCTS.find(p => p.id === item.produtoId);
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

                {/* Submit Actions */}
                <div className="mt-4 pt-4 border-t border-[#27272A] space-y-3.5 shrink-0">
                  
                  {/* Order Type Toggle Selector */}
                  <div className="space-y-1.5 font-sans">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Tipo do Pedido:</span>
                    <div className="grid grid-cols-2 bg-[#121214] border border-[#27272A] rounded-xl p-1">
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
                    </div>
                  </div>

                  <div className="flex justify-between items-baseline font-sans pt-1">
                    <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">Subtotal Rascunho:</span>
                    <span className="text-2xl font-bold font-mono text-[#10b981]">
                      R$ {draftTotal.toFixed(2)}
                    </span>
                  </div>

                  <div className="bg-[#1C1C1F] border border-[#27272A] rounded-xl p-3 flex items-start gap-2">
                    <Info size={14} className="text-[#10b981] shrink-0 mt-0.5" />
                    <p className="text-[10px] text-gray-300 leading-normal font-sans">
                      Esses rascunhos são <strong>individuais e persistentes</strong>. Ao clicar em <strong>Lançar Pedido</strong>, eles serão consolidados na conta e encaminhados imediatamente para a cozinha.
                    </p>
                  </div>

                  <button
                    id="submit-draft-order-btn"
                    disabled={isSubmitting}
                    onClick={() => onSubmitDraft(orderType)}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/10 transition-all hover:translate-y-[-1px] cursor-pointer uppercase tracking-wider font-sans border border-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span>{isSubmitting ? 'Lançando...' : 'Lançar Pedido'}</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. VIEW: MENU (CARDÁPIO DE PRODUTOS) */}
      {view === 'menu' && (
        <div className="lg:col-span-12 flex flex-col justify-between max-w-4xl mx-auto bg-[#121214] sm:border sm:border-[#27272A] sm:rounded-3xl p-3 sm:p-5 sm:min-h-[450px] border-0 rounded-none">
          <div className="space-y-4">
            
            {/* Header: Title and Back button */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#27272A]">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setView('cart')}
                  className="p-2 hover:bg-[#27272A] rounded-xl text-gray-400 hover:text-white transition-colors cursor-pointer border border-[#27272A]"
                  title="Voltar ao carrinho"
                >
                  <ArrowLeft size={16} />
                </button>
                <div>
                  <h3 className="font-serif text-xl font-bold text-white tracking-tight">Cardápio de Iguarias</h3>
                  <p className="text-xs text-[#A1A1AA] font-sans">Selecione produtos para adicionar ao carrinho da Mesa {tableId}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setView('cart')}
                  className="px-3.5 py-2 bg-[#1C1C1F] hover:bg-[#27272A] text-white border border-[#27272A] text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                >
                  <ShoppingCart size={13} className="text-[#10b981]" />
                  <span>Ver Carrinho</span>
                  <span className="bg-rose-900/40 border border-rose-800/50 text-white font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-rose-900/50/30 ml-0.5">
                    {totalDraftQty}
                  </span>
                </button>
                
                {/* Settings Toggle */}
                <div className="relative">
                  <button
                    id="toggle-menu-settings"
                    onClick={() => setShowSettings(!showSettings)}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs text-gray-400 hover:text-white bg-[#1C1C1F] hover:bg-[#27272A] rounded-xl transition-colors cursor-pointer border border-[#27272A]"
                  >
                    <SlidersHorizontal size={13} />
                    <span>Visualização</span>
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
            <div className="space-y-3">
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

              {/* Category selector */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    id={`cat-btn-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                    onClick={() => {
                      setSelectedCategory(cat);
                      setSearchQuery('');
                      setTimeout(() => {
                        const element = document.getElementById(`category-sec-${cat.toLowerCase().replace(/\s+/g, '-')}`);
                        if (element) {
                          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                      }, 50);
                    }}
                    className={`px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                      selectedCategory === cat
                        ? 'bg-rose-900/40 border border-rose-800/50 text-white shadow-md'
                        : 'bg-[#1C1C1F] hover:bg-[#27272A] text-gray-300 hover:text-white border border-[#27272A]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Products List grouped by Categories */}
            <div className="flex flex-col gap-6 sm:max-h-[50vh] sm:overflow-y-auto max-h-none overflow-y-visible pr-1 scroll-smooth">
              {(() => {
                let totalRendered = 0;
                const renderedSections = CATEGORIES.map((cat) => {
                  const categoryProducts = PRODUCTS.filter((product) => {
                    const matchesCategory = product.categoria === cat;
                    const matchesSearch = !searchQuery ||
                                          product.nome.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                          product.descricao.toLowerCase().includes(searchQuery.toLowerCase());
                    return matchesCategory && matchesSearch;
                  });

                  if (categoryProducts.length === 0) return null;
                  totalRendered += categoryProducts.length;

                  return (
                    <div 
                      key={cat} 
                      id={`category-sec-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                      className="space-y-3 scroll-mt-2 pt-2"
                    >
                      <h4 className="font-serif text-xs font-bold text-[#10b981] uppercase tracking-wider border-b border-[#27272A] pb-1.5 pt-1">
                        {cat}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        {categoryProducts.map((product) => {
                          const available = isProductAvailable(product);
                          return (
                          <div
                            key={product.id}
                            id={`product-card-${product.id}`}
                            className={`bg-[#121214]/60 border rounded-2xl p-4 flex flex-col justify-between ${
                              available
                                ? 'border-[#27272A] hover:border-[#10b981]/30 group cursor-pointer'
                                : 'border-red-900/30 opacity-60 cursor-not-allowed'
                            }`}
                            onClick={() => available && handleOpenConfig(product)}
                          >
                            <div className="space-y-3">
                              {/* Product Image */}
                              {settings.exibirImagens && product.imagem && (
                                <div 
                                  className="w-full h-32 rounded-lg overflow-hidden relative bg-[#1C1C1F] border border-[#27272A]"
                                >
                                  <img
                                    src={product.imagem}
                                    alt={product.nome}
                                    referrerPolicy="no-referrer"
                                    className={`w-full h-full object-cover ${available ? '' : 'grayscale'}`}
                                  />
                                </div>
                              )}

                              <div>
                                <div className="flex justify-between items-start gap-2">
                                  <h4 
                                    className={`font-serif font-bold leading-tight text-sm transition-colors ${
                                      available ? 'text-white group-hover:text-[#10b981]' : 'text-gray-500 line-through'
                                    }`}
                                  >
                                    {product.nome}
                                  </h4>
                                  <div className="flex flex-col items-end gap-1 shrink-0">
                                    <span className="font-mono text-xs font-bold text-[#10b981] whitespace-nowrap">
                                      R$ {product.preco.toFixed(2)}
                                    </span>
                                    {!available && (
                                      <span className="text-[8px] font-bold px-1.5 py-0.5 bg-red-900/30 text-red-400 rounded-full border border-red-800/30">
                                        ESGOTADO
                                      </span>
                                    )}
                                  </div>
                                </div>
                                
                                {settings.exibirDescricoes && (
                                  <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                                    {product.descricao}
                                  </p>
                                )}
                              </div>
                            </div>

                            <button
                              id={`add-product-btn-${product.id}`}
                              type="button"
                              disabled={!available}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (available) handleOpenConfig(product);
                              }}
                              className={`mt-4 w-full flex items-center justify-center gap-1 py-2 text-xs font-bold rounded-xl transition-all border ${
                                available
                                  ? 'bg-[#1C1C1F] hover:bg-[#10b981]/20 text-[#10b981] cursor-pointer border-[#27272A]'
                                  : 'bg-red-900/10 text-red-500/50 cursor-not-allowed border-red-900/20'
                              }`}
                            >
                              {available ? (
                                <><Plus size={13} /><span>Configurar e Adicionar</span></>
                              ) : (
                                <span>Indisponível</span>
                              )}
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
                      Nenhum item culinário encontrado.
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
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-[#1C1C1F] border border-[#27272A] rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl animate-scale-in">
            
            {/* Modal Header */}
            <div className="flex justify-between items-start border-b border-[#27272A] pb-3">
              <div>
                <span className="text-[10px] font-bold text-[#10b981] uppercase tracking-wider">{selectedProductToConfigure.categoria}</span>
                <h4 className="font-serif font-bold text-lg text-white mt-0.5">{selectedProductToConfigure.nome}</h4>
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
            <div className="space-y-4 font-sans text-xs">
              
              {/* Product description / image preview */}
              {selectedProductToConfigure.descricao && (
                <p className="text-gray-400 leading-relaxed text-[11px] bg-[#121214] p-3 rounded-xl border border-[#27272A]">
                  {selectedProductToConfigure.descricao}
                </p>
              )}

              {/* Quantity selector */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wider block">Quantidade:</span>
                <div className="flex items-center gap-3">
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
                  <span className="font-mono text-sm font-bold text-[#10b981] ml-2">
                    Valor total: R$ {(selectedProductToConfigure.preco * configQty).toFixed(2)}
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
