import React, { useState } from 'react';
import clsx from 'clsx';
import { Plus, ShoppingCart, Trash2, Check } from 'lucide-react';
import { Product, Table, Order, PdvCartItem } from '../types';
import { CATEGORIES } from '../data';
import { getProductPresets } from '../domain';

export interface CaixaBalcaoTabProps {
  products: Product[];
  pdvCart: PdvCartItem[];
  setPdvCart: React.Dispatch<React.SetStateAction<PdvCartItem[]>>;
  pdvSearch: string;
  setPdvSearch: (val: string) => void;
  pdvOrderType: 'balcao' | 'entrega' | 'mesa';
  setPdvOrderType: (val: 'balcao' | 'entrega' | 'mesa') => void;
  pdvCustomerName: string;
  setPdvCustomerName: (val: string) => void;
  pdvCustomerPhone: string;
  setPdvCustomerPhone: (val: string) => void;
  pdvDeliveryAddress: string;
  setPdvDeliveryAddress: (val: string) => void;
  pdvDeliveryTaxa: string;
  setPdvDeliveryTaxa: (val: string) => void;
  pdvTargetMesaId: number;
  setPdvTargetMesaId: (val: number) => void;
  salonTables: Table[];
  orders: Order[];
  modoExclusivoSalao: boolean;
  handlePdvSubmitOrder: (e: React.FormEvent) => Promise<void> | void;
  isLoading: boolean;
}

export const CaixaBalcaoTab: React.FC<CaixaBalcaoTabProps> = ({
  products,
  pdvCart,
  setPdvCart,
  pdvSearch,
  setPdvSearch,
  pdvOrderType,
  setPdvOrderType,
  pdvCustomerName,
  setPdvCustomerName,
  pdvCustomerPhone,
  setPdvCustomerPhone,
  pdvDeliveryAddress,
  setPdvDeliveryAddress,
  pdvDeliveryTaxa,
  setPdvDeliveryTaxa,
  pdvTargetMesaId,
  setPdvTargetMesaId,
  salonTables,
  orders,
  modoExclusivoSalao,
  handlePdvSubmitOrder,
  isLoading,
}) => {
  const [pdvSelectedCategory, setPdvSelectedCategory] = useState<string>('todos');

  // Filtered menu list for PDV
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.nome.toLowerCase().includes(pdvSearch.toLowerCase()) ||
                          p.descricao.toLowerCase().includes(pdvSearch.toLowerCase());
    const matchesCategory = pdvSelectedCategory === 'todos' || p.categoria === pdvSelectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Handle local PDV cart item additions
  const handlePdvAddToCart = (product: Product) => {
    setPdvCart(prev => {
      const idx = prev.findIndex(item => item.product.id === product.id && item.client === 'Balcão');
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [...prev, { product, quantity: 1, obs: '', client: 'Balcão' }];
    });
  };

  const handlePdvUpdateCartQty = (idx: number, delta: number) => {
    setPdvCart(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], quantity: Math.max(1, copy[idx].quantity + delta) };
      return copy;
    });
  };

  const handlePdvRemoveCartItem = (idx: number) => {
    setPdvCart(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className={clsx('h-full', 'flex', 'gap-5', 'overflow-hidden')}>
      {/* Product grid column */}
      <div className={clsx('flex-1', 'flex', 'flex-col', 'space-y-4', 'overflow-hidden')}>
        <div className={clsx('space-y-3', 'shrink-0')}>
          <div className={clsx('flex', 'gap-2')}>
            <div className="flex-1">
              <input
                id="pdv-search-input"
                type="text"
                placeholder="Pesquisar prato no menu..."
                value={pdvSearch}
                onChange={(e) => setPdvSearch(e.target.value)}
                className={clsx('w-full', 'px-4', 'py-2', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-xl', 'focus:outline-none', 'focus:border-[#10b981]', 'text-white')}
              />
              <span className={clsx('text-[8px]', 'text-gray-500', 'font-mono', 'block', 'mt-1', 'text-left')}>Atalho: Pressione [F1] para pesquisar</span>
            </div>
            {pdvSearch && (
              <button
                onClick={() => setPdvSearch('')}
                className={clsx('px-3', 'bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-gray-400', 'hover:text-white', 'cursor-pointer')}
              >
                Limpar
              </button>
            )}
          </div>

          <div className={clsx('flex', 'gap-1.5', 'overflow-x-auto', 'pb-1.5', 'scrollbar-thin')}>
            <button
              type="button"
              onClick={() => setPdvSelectedCategory('todos')}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-lg cursor-pointer whitespace-nowrap transition-all border ${pdvSelectedCategory === 'todos'
                ? 'bg-emerald-600 text-white border-transparent'
                : 'bg-[#121214] border-[#27272A] text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                }`}
            >
              Todos
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setPdvSelectedCategory(cat)}
                className={`px-3 py-1.5 text-[10px] font-bold rounded-lg cursor-pointer whitespace-nowrap transition-all border ${pdvSelectedCategory === cat
                  ? 'bg-emerald-600 text-white border-transparent'
                  : 'bg-[#121214] border-[#27272A] text-gray-400 hover:text-white hover:bg-[#1C1C1F]'
                  }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className={clsx('flex-1', 'overflow-y-auto', 'pr-1')}>
          <div className={clsx('grid', 'grid-cols-2', 'sm:grid-cols-3', 'xl:grid-cols-4', 'gap-3')}>
            {filteredProducts.map(p => (
              <div
                key={p.id}
                onClick={() => handlePdvAddToCart(p)}
                className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'hover:border-[#10b981]/30', 'p-3', 'rounded-xl', 'flex', 'flex-col', 'justify-between', 'gap-3', 'cursor-pointer', 'group', 'hover:shadow-md', 'transition-all', 'text-left')}
              >
                <div>
                  <h4 className={clsx('font-serif', 'font-bold', 'text-white', 'group-hover:text-[#10b981]', 'transition-colors')}>{p.nome}</h4>
                  <p className={clsx('text-[9px]', 'text-gray-500', 'mt-1', 'line-clamp-2')}>{p.descricao}</p>
                </div>
                <div className={clsx('flex', 'justify-between', 'items-center')}>
                  <span className={clsx('font-bold', 'text-white', 'font-mono')}>R$ {p.preco.toFixed(2)}</span>
                  <span className={clsx('p-1', 'bg-[#1C1C1F]', 'group-hover:bg-[#10b981]', 'text-gray-400', 'group-hover:text-[#121214]', 'rounded-lg', 'transition-colors', 'border', 'border-[#27272A]/50')}>
                    <Plus size={12} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Shopping cart sidebar */}
      <div className={clsx('w-80', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-2xl', 'flex', 'flex-col', 'overflow-hidden', 'shrink-0')}>
        <div className={clsx('bg-[#18181B]', 'px-4', 'py-3', 'border-b', 'border-[#27272A]', 'flex', 'justify-between', 'items-center', 'shrink-0')}>
          <span className={clsx('font-bold', 'text-white', 'font-serif', 'flex', 'items-center', 'gap-1.5')}>
            <ShoppingCart size={14} className="text-[#10b981]" />
            <span>Carrinho de Vendas</span>
          </span>
          <span className={clsx('bg-[#10b981]/10', 'text-[#10b981]', 'font-bold', 'px-2', 'py-0.5', 'rounded-full', 'font-mono', 'text-[9px]')}>
            {pdvCart.reduce((sum, item) => sum + item.quantity, 0)} itens
          </span>
        </div>

        <div className={clsx('flex-1', 'overflow-y-auto', 'p-3', 'space-y-2')}>
          {pdvCart.length === 0 ? (
            <div className={clsx('py-24', 'text-center', 'space-y-2', 'text-gray-500', 'italic')}>
              <p>Carrinho Vazio</p>
              <p className={clsx('text-[9px]', 'text-gray-600')}>Clique nos produtos ao lado para lançar</p>
            </div>
          ) : (
            pdvCart.map((item, idx) => (
              <div key={`${item.product.id}-${idx}`} className={clsx('bg-[#1C1C1F]', 'p-2.5', 'rounded-xl', 'border', 'border-[#27272A]', 'space-y-2')}>
                <div className={clsx('flex', 'justify-between', 'items-start')}>
                  <div className="space-y-0.5">
                    <strong className={clsx('text-white', 'block', 'truncate', 'w-40')}>{item.product.nome}</strong>
                    <span className={clsx('text-[9px]', 'text-[#10b981]', 'font-mono')}>R$ {item.product.preco.toFixed(2)} / un</span>
                  </div>
                  <button
                    onClick={() => handlePdvRemoveCartItem(idx)}
                    className={clsx('text-gray-500', 'hover:text-rose-500', 'p-0.5', 'cursor-pointer')}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                <div className={clsx('flex', 'justify-between', 'items-center')}>
                  <div className={clsx('flex', 'items-center', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'overflow-hidden')}>
                    <button
                      type="button"
                      onClick={() => handlePdvUpdateCartQty(idx, -1)}
                      className={clsx('px-2', 'py-1', 'text-gray-400', 'hover:text-white', 'cursor-pointer', 'hover:bg-[#1C1C1F]')}
                    >
                      -
                    </button>
                    <span className={clsx('px-2', 'text-[10px]', 'font-bold', 'font-mono', 'text-white')}>{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => handlePdvUpdateCartQty(idx, 1)}
                      className={clsx('px-2', 'py-1', 'text-gray-400', 'hover:text-white', 'cursor-pointer', 'hover:bg-[#1C1C1F]')}
                    >
                      +
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Obs..."
                    value={item.obs}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPdvCart(prev => {
                        const c = [...prev];
                        c[idx].obs = val;
                        return c;
                      });
                    }}
                    className={clsx('w-24', 'px-1.5', 'py-1', 'text-[9px]', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded', 'focus:outline-none', 'focus:border-[#10b981]', 'text-white')}
                  />
                </div>

                {/* Presets de Observação Dinâmicos do Terminal Balcão */}
                {(() => {
                  const presets = getProductPresets(item.product);
                  if (presets.length === 0) return null;
                  const parts = item.obs ? item.obs.split(',').map(p => p.trim()) : [];
                  return (
                    <div className="flex flex-wrap gap-1 mt-2 justify-end">
                      {presets.map(preset => {
                        const isActive = parts.some(p => p.toLowerCase() === preset.toLowerCase());
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => {
                              const currentParts = item.obs ? item.obs.split(',').map(p => p.trim()) : [];
                              const exists = currentParts.some(p => p.toLowerCase() === preset.toLowerCase());
                              const updatedParts = exists
                                ? currentParts.filter(p => p.toLowerCase() !== preset.toLowerCase() && p !== '')
                                : [...currentParts.filter(p => p !== ''), preset];

                              const updatedObs = updatedParts.join(', ');
                              setPdvCart(prev => {
                                const c = [...prev];
                                c[idx].obs = updatedObs;
                                return c;
                              });
                            }}
                            className={`px-1.5 py-0.5 text-[8px] rounded border transition-colors cursor-pointer font-medium ${
                              isActive
                                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
                                : 'bg-[#27272A] hover:bg-emerald-600/25 text-gray-400 hover:text-white border-[#27272A]'
                            }`}
                          >
                            {isActive ? preset : `+${preset}`}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            ))
          )}
        </div>

        <form onSubmit={handlePdvSubmitOrder} className={clsx('bg-[#18181B]', 'p-3', 'border-t', 'border-[#27272A]', 'space-y-3', 'shrink-0')}>
          {!modoExclusivoSalao && (
            <div className="space-y-1">
              <div className={clsx('flex', 'gap-1', 'p-0.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'shrink-0')}>
                <button
                  type="button"
                  onClick={() => setPdvOrderType('balcao')}
                  className={`flex-1 py-1 text-[8.5px] font-bold rounded transition-all cursor-pointer ${pdvOrderType === 'balcao' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                    }`}
                >
                  Balcão
                </button>
                <button
                  type="button"
                  onClick={() => setPdvOrderType('entrega')}
                  className={`flex-1 py-1 text-[8.5px] font-bold rounded transition-all cursor-pointer ${pdvOrderType === 'entrega' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                    }`}
                >
                  Delivery
                </button>
                <button
                  type="button"
                  onClick={() => setPdvOrderType('mesa')}
                  className={`flex-1 py-1 text-[8.5px] font-bold rounded transition-all cursor-pointer ${pdvOrderType === 'mesa' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                    }`}
                >
                  Mesa
                </button>
              </div>
              <span className={clsx('text-[7.5px]', 'text-gray-500', 'font-mono', 'block', 'text-left')}>Atalhos de Tipo: [F2] Balcão • [F3] Mesa • [F8] Delivery</span>
            </div>
          )}

          {pdvOrderType === 'mesa' && (
            <div className="space-y-1">
              <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Mesa Destino:</label>
              <select
                id="pdv-mesa-select"
                value={pdvTargetMesaId}
                onChange={(e) => setPdvTargetMesaId(parseInt(e.target.value))}
                className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'focus:border-[#10b981]', 'text-white', 'text-[10px]')}
              >
                <option value={0}>Selecione uma mesa...</option>
                {salonTables.map(t => {
                  const mergedIntoMesaId = orders.find(o => o.mesaOrigemId === t.id)?.mesaId || null;
                  const isMerged = mergedIntoMesaId !== null;
                  const displayMesaId = isMerged ? mergedIntoMesaId : t.id;
                  const tableOrders = orders.filter(o => o.mesaId === displayMesaId);
                  const isOcupada = tableOrders.length > 0;

                  let label = `🟢 Mesa ${t.id} (Livre)`;
                  if (isMerged) {
                    label = `🟡 Mesa ${t.id} (Unificada na Mesa ${mergedIntoMesaId})`;
                  } else if (isOcupada) {
                    label = `🔴 Mesa ${t.id} (Ocupada)`;
                  }

                  return (
                    <option key={t.id} value={t.id}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {(pdvOrderType === 'balcao' || pdvOrderType === 'entrega') && (
            <div className={clsx('grid', 'grid-cols-2', 'gap-1.5')}>
              <div className="space-y-1">
                <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Nome Cliente:</label>
                <input
                  id="pdv-customer-name-input"
                  type="text"
                  placeholder="Ex: Maria"
                  required={pdvCart.length > 0}
                  value={pdvCustomerName}
                  onChange={(e) => setPdvCustomerName(e.target.value)}
                  className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'text-white', 'text-[10px]')}
                />
              </div>
              <div className="space-y-1">
                <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Telefone:</label>
                <input
                  type="text"
                  placeholder="(81) 9..."
                  value={pdvCustomerPhone}
                  onChange={(e) => setPdvCustomerPhone(e.target.value)}
                  className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'text-white', 'text-[10px]')}
                />
              </div>
            </div>
          )}

          {pdvOrderType === 'entrega' && (
            <div className="space-y-2.5">
              <div className="space-y-1">
                <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Endereço de Entrega:</label>
                <input
                  type="text"
                  placeholder="Rua, Número, Bairro, Complemento"
                  required={pdvCart.length > 0}
                  value={pdvDeliveryAddress}
                  onChange={(e) => setPdvDeliveryAddress(e.target.value)}
                  className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'text-white', 'text-[10px]')}
                />
              </div>
              <div className="space-y-1">
                <label className={clsx('text-[8px]', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider', 'block')}>Taxa de Entrega (R$):</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="5.00"
                  value={pdvDeliveryTaxa}
                  onChange={(e) => setPdvDeliveryTaxa(e.target.value)}
                  className={clsx('w-full', 'px-2', 'py-1.5', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-lg', 'focus:outline-none', 'text-white', 'text-[10px]')}
                />
              </div>
            </div>
          )}

          <div className={clsx('flex', 'justify-between', 'items-center', 'font-mono', 'border-t', 'border-[#27272A]', 'pt-2', 'text-[11px]', 'font-bold', 'text-white')}>
            <span>Total Pedido:</span>
            <span className={clsx('text-[#10b981]', 'text-sm')}>
              R$ {(
                pdvCart.reduce((sum, item) => sum + (item.product.preco * item.quantity), 0) +
                (pdvOrderType === 'entrega' ? parseFloat(pdvDeliveryTaxa) || 0 : 0)
              ).toFixed(2)}
            </span>
          </div>

          {modoExclusivoSalao && (pdvOrderType !== 'mesa' || !pdvTargetMesaId || pdvTargetMesaId === 0) && (
            <div className={clsx('text-[9.5px]', 'text-amber-500', 'border', 'border-amber-500/20', 'bg-amber-500/5', 'px-2.5', 'py-1.5', 'rounded-lg', 'text-left', 'leading-relaxed')}>
              Durante o modo de testes de salão, todos os pedidos de venda devem ser vinculados a uma Mesa física ativa.
            </div>
          )}

          <button
            id="pdv-submit-btn"
            type="submit"
            disabled={modoExclusivoSalao && (pdvOrderType !== 'mesa' || !pdvTargetMesaId || pdvTargetMesaId === 0)}
            className={clsx('w-full', 'py-2', 'bg-emerald-600', 'hover:bg-emerald-700', 'disabled:bg-zinc-800', 'disabled:text-zinc-500', 'disabled:border-zinc-800', 'disabled:cursor-not-allowed', 'text-white', 'rounded-lg', 'font-bold', 'text-[9px]', 'uppercase', 'tracking-wider', 'transition-all', 'cursor-pointer', 'flex', 'flex-col', 'items-center', 'justify-center', 'gap-0.5', 'shadow')}
          >
            <div className={clsx('flex', 'items-center', 'gap-1')}>
              <Check size={12} />
              <span>Lançar Pedido</span>
            </div>
            <span className={clsx('text-[7.5px]', 'text-emerald-200/80', 'font-mono', 'font-normal')}>Pressione [F4] para finalizar</span>
          </button>
        </form>
      </div>
    </div>
  );
};
