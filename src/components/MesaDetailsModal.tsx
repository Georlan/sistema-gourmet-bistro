/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Clock, Receipt, PlusCircle, Move, ShoppingBag, Printer, Trash2, ArrowLeft, Edit2 } from 'lucide-react';
import { Table, Order, DraftItem, AppSettings, Product, AppRole, OrderItem } from '../types';
import { getTableTotal, getCustomerSubtotals, formatElapsedTime } from '../domain';
import { MenuPanel } from './MenuPanel';
import { TABLES, RESTAURANT_CONFIG } from '../data';

interface MesaDetailsModalProps {
  table: Table;
  orders: Order[];
  allOrders?: Order[]; // The full list of active orders across all tables to identify empty tables
  draftItems: DraftItem[];
  settings: AppSettings;
  activeRole: AppRole;
  activeWaiterId: string;
  activeWaiterNome: string;
  currentTime: number;
  onClose: () => void;
  onUpdateSettings: (settings: AppSettings) => void;
  onAddToDraft: (product: Product, quantity?: number, observacao?: string, clienteNome?: string) => void;
  onRemoveFromDraft: (draftItemId: string) => void;
  onUpdateDraftItem: (draftItemId: string, fields: Partial<DraftItem>) => void;
  onSubmitDraft: (orderType: 'Consumo no Local' | 'Retirada' | 'Entrega') => void;
  otherWaitersServing?: string[];
  onTransferTable: (targetTableId: number) => void;
  onTransferItem: (itemId: string, targetTableId: number) => void;
  onTransferItems: (itemIds: string[], targetTableId: number) => void;
  onCancelItem: (itemId: string) => void;
  onCloseTable: () => void;
  onSettleCustomer: (customerName: string) => void;
  onDeliverItem: (orderId: string, itemId: string) => void;
  historicClients?: string[];
  restaurantName?: string;
  onClearTableOrders?: () => void;
  onPrintReceipt?: () => Promise<void>;
  onPrintKitchenLaunch?: (lancamentoId: string) => Promise<void>;
  salonTables?: Table[];
  liveProdutos?: Product[];
  restauranteConfig?: any;
  onUpdateItemDetails?: (itemId: string, observacao: string, clienteNome: string, quantidadeAdicional?: number) => Promise<void>;
  isSubmitting?: boolean;
}

export const MesaDetailsModal: React.FC<MesaDetailsModalProps> = ({
  table,
  orders,
  allOrders = [],
  draftItems,
  isSubmitting = false,
  settings,
  activeRole,
  activeWaiterId,
  activeWaiterNome,
  currentTime,
  onClose,
  onUpdateSettings,
  onAddToDraft,
  onRemoveFromDraft,
  onUpdateDraftItem,
  onSubmitDraft,
  otherWaitersServing = [],
  onTransferTable,
  onTransferItem,
  onTransferItems,
  onCancelItem,
  onCloseTable,
  onSettleCustomer,
  onDeliverItem,
  historicClients = [],
  restaurantName = RESTAURANT_CONFIG.nomePadrao,
  onClearTableOrders,
  onPrintReceipt,
  onPrintKitchenLaunch,
  salonTables,
  liveProdutos = [],
  restauranteConfig,
  onUpdateItemDetails,
}) => {
  // Dynamic default tab based on whether table is active or empty
  const [activeTab, setActiveTab] = useState<'consumo' | 'lancamento' | 'transferir'>(
    orders.length === 0 ? 'lancamento' : 'consumo'
  );
  const [showPrintPreview, setShowPrintPreview] = useState<boolean>(false);
  const [selectedOrderToPrint, setSelectedOrderToPrint] = useState<Order | null>(null);
  const [confirmTransferTo, setConfirmTransferTo] = useState<number | null>(null);
  const [selectedItemsForTransfer, setSelectedItemsForTransfer] = useState<string[]>([]);
  const [transferType, setTransferType] = useState<'total' | 'parcial'>('total');
  const [printSuccess, setPrintSuccess] = useState<boolean>(false);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<any>(null);

  // Lock background scroll when modal is active
  React.useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const totalValue = getTableTotal(orders);
  const customerSubtotals = getCustomerSubtotals(orders);

  // Find oldest order timestamp
  const firstTimestamp = orders.length > 0 ? Math.min(...orders.map(o => o.timestamp)) : undefined;
  const permanenceTime = formatElapsedTime(firstTimestamp, currentTime);

  // Get other tables that are available for transfer (any table except the original one)
  const tablesList = salonTables || TABLES;
  const availableTablesForTransfer = tablesList.filter(t => t.id !== table.id);

  // Print invoice helper
  const handlePrintPreview = () => {
    setShowPrintPreview(true);
  };

  return (
    <div 
      id="modal-outer-overlay"
      onClick={(e) => {
        if ((e.target as HTMLElement).id === 'modal-outer-overlay') {
          onClose();
        }
      }}
      className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-0 sm:p-4 z-40 animate-fade-in overflow-y-auto"
    >
      <div className="bg-[#0D0D10]/95 backdrop-blur-xl rounded-none sm:rounded-3xl border-0 sm:border border-[#10b981]/15 shadow-2xl w-full max-w-5xl overflow-hidden h-full sm:h-auto max-h-full sm:max-h-[90vh] flex flex-col">
        
        {/* MODAL HEADER */}
        <div className="bg-[#18181B] text-white p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0 border-b border-[#27272A]">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 sm:hidden hover:bg-[#27272A] rounded-xl text-gray-400 hover:text-white transition-colors cursor-pointer border border-[#27272A]"
                title="Voltar ao mapa"
              >
                <ArrowLeft size={16} />
              </button>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-white">Mesa {table.id}</h2>
              <span className={`px-3 py-1 text-[10px] font-sans font-bold tracking-wider uppercase rounded-full border ${
                orders.length === 0 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : orders.some(o => o.itens.some(i => i.status === 'pronto'))
                    ? 'bg-[#10b981]/15 text-[#10b981] border-[#10b981]/30 animate-pulse-subtle'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}>
                {orders.length === 0 ? 'Livre' : orders.some(o => o.itens.some(i => i.status === 'pronto')) ? 'Pronto p/ Servir' : 'Ocupada'}
              </span>
            </div>
            
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#A1A1AA] font-sans">
              {orders.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <Clock size={12} className="text-[#10b981]" />
                  Permanência: <strong className="text-white font-medium font-mono">{permanenceTime}</strong>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-end sm:self-center">
            <span className="text-[10px] uppercase tracking-wider bg-[#27272A] px-3.5 py-2 rounded-xl border border-[#10b981]/10 font-sans text-[#10b981] font-bold">
              Atendimento: <strong className="text-white">{activeWaiterNome}</strong>
            </span>
            <button
              id="close-mesa-modal-btn"
              onClick={onClose}
              className="p-2 rounded-full hover:bg-white/5 text-gray-400 hover:text-white transition-colors cursor-pointer border border-transparent hover:border-[#27272A]"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* MODAL TABS */}
        <div className="bg-[#121214] border-b border-[#27272A] px-6 py-2.5 flex gap-2 shrink-0 overflow-x-auto">
          <button
            id="tab-consumo-btn"
            onClick={() => setActiveTab('consumo')}
            className={`px-4.5 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer uppercase tracking-wider font-sans border ${
              activeTab === 'consumo' 
                ? 'bg-[#1C1C1F] text-[#10b981] shadow-sm border-[#27272A]' 
                : 'text-gray-400 hover:text-white border-transparent'
            }`}
          >
            <Receipt size={14} className="text-[#10b981]" />
            <span>Consumo Ativo</span>
          </button>

          <button
            id="tab-lancamento-btn"
            onClick={() => setActiveTab('lancamento')}
            className={`px-4.5 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer uppercase tracking-wider font-sans border ${
              activeTab === 'lancamento' 
                ? 'bg-[#1C1C1F] text-[#10b981] shadow-sm border-[#27272A]' 
                : 'text-gray-400 hover:text-white border-transparent'
            }`}
          >
            <PlusCircle size={14} className="text-[#10b981]" />
            <span>La Carte (Lançar)</span>
            {draftItems.length > 0 && (
              <span className="h-2 w-2 rounded-full bg-rose-900/40 border border-rose-800/50 animate-ping"></span>
            )}
          </button>

          {orders.length > 0 && (
            <button
              id="tab-transferir-btn"
              onClick={() => setActiveTab('transferir')}
              className={`px-4.5 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer uppercase tracking-wider font-sans border ${
                activeTab === 'transferir' 
                  ? 'bg-[#1C1C1F] text-[#10b981] shadow-sm border-[#27272A]' 
                  : 'text-gray-400 hover:text-white border-transparent'
              }`}
            >
              <Move size={14} className="text-[#10b981]" />
              <span>Transferência</span>
            </button>
          )}
        </div>

        {/* MODAL BODY */}
        <div className="p-6 overflow-y-auto flex-1 bg-[#18181B] space-y-4">
          
          {/* Concurrency Alert Banner */}
          {otherWaitersServing.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/35 text-amber-400 p-3.5 rounded-2xl flex items-start gap-2 text-xs font-sans shadow-sm leading-relaxed animate-pulse">
              <span className="text-sm shrink-0">⚠️</span>
              <div>
                <strong className="text-white block font-semibold mb-0.5">Aviso de Concorrência</strong>
                O(s) garçom(garçons) <strong className="text-white">{otherWaitersServing.join(', ')}</strong> também está(ão) editando um rascunho ativo para esta mesa no momento. Cuidado para não duplicar pratos!
              </div>
            </div>
          )}
          
          {/* TAB 1: CONSUMO ATIVO */}
          {activeTab === 'consumo' && (
            <div className="space-y-6">
              {orders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                  <div className="p-4 bg-[#121214] text-[#10b981] rounded-full border border-[#27272A]">
                    <ShoppingBag size={32} />
                  </div>
                  <h3 className="font-serif text-xl font-bold text-white">Mesa sem consumo ativo</h3>
                  <p className="text-xs text-gray-400 max-w-sm leading-relaxed">
                    Nenhum pedido ativo foi lançado nesta mesa ainda. Use a aba de <strong>La Carte (Lançar)</strong> para preparar e confirmar o primeiro rascunho de pedido.
                  </p>
                  <button
                    id="go-to-billing-tab-btn"
                    onClick={() => setActiveTab('lancamento')}
                    className="mt-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold tracking-wider uppercase transition-colors cursor-pointer border border-emerald-500/20 shadow-md shadow-emerald-500/5"
                  >
                    Lançar Pedidos
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                  
                  {/* Itemized Order History (Col-7) */}
                  <div className="lg:col-span-7 space-y-4">
                    <div className="flex items-center justify-between border-b border-[#27272A] pb-3">
                      <h3 className="font-serif font-bold text-white text-base">Comanda de Pedidos</h3>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider font-sans">Lotes Consolidados: {orders.length}</span>
                    </div>

                    <div className="space-y-4 max-h-[45vh] overflow-y-auto pr-1 scrollbar-thin">
                      {orders.map((order) => (
                        <div
                          key={order.id}
                          id={`placed-order-${order.id}`}
                          className="border border-[#27272A] rounded-2xl overflow-hidden bg-[#121214]/40"
                        >
                          {/* Order Header */}
                          <div className="bg-[#1C1C1F] px-4 py-2.5 flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-[#27272A] gap-2 w-full">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white font-sans">Lote #{order.id.slice(-4)}</span>
                              <span className="text-[10px] bg-[#121214] text-gray-300 px-2 py-0.5 rounded font-bold font-sans">
                                Garçom: {order.garcomNome}
                              </span>
                              {order.tipo && (
                                <span className={`text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                                  order.tipo === 'Retirada'
                                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                    : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                }`}>
                                  {order.tipo}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] text-gray-400 font-mono font-bold">
                                {new Date(order.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <button
                                type="button"
                                onClick={() => setSelectedOrderToPrint(order)}
                                className="px-2.5 py-1 bg-[#27272A] hover:bg-[#10b981]/20 text-gray-300 hover:text-white border border-[#27272A] hover:border-[#10b981]/30 rounded-lg text-[10px] font-sans font-semibold transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                                title="Reimprimir este lote de pedidos"
                              >
                                <Printer size={11} className="text-[#10b981]" />
                                <span>Reimprimir</span>
                              </button>
                            </div>
                          </div>

                          {/* Order Items */}
                          <div className="p-4 divide-y divide-[#27272A]">
                            {order.itens.map((item) => (
                              <div
                                key={item.id}
                                id={`placed-item-${item.id}`}
                                className="py-3 flex justify-between items-start gap-4 text-xs first:pt-0 last:pb-0 font-sans"
                              >
                                <div className="space-y-1 flex-1">
                                  <div className="flex flex-wrap items-baseline gap-2">
                                    <span className="font-bold text-white">{item.nome}</span>
                                    {item.clienteNome && (
                                      <span className="text-[9px] font-bold text-[#10b981] bg-[#10b981]/10 px-2 py-0.5 rounded border border-[#10b981]/20 uppercase tracking-wider">
                                        Para: {item.clienteNome}
                                      </span>
                                    )}
                                  </div>

                                  {/* Item Unit Observation */}
                                  {item.observacao ? (
                                    <p className="text-[11px] text-gray-400 italic bg-[#1C1C1F] px-2.5 py-1 rounded border border-dashed border-[#27272A] inline-block">
                                      Obs: "{item.observacao}"
                                    </p>
                                  ) : null}
                                </div>

                                {/* Status Badge & Waiter Delivery Control */}
                                <div className="flex items-center gap-3">
                                  <span className="font-mono font-bold text-white text-sm">R$ {item.preco.toFixed(2)}</span>
                                  
                                  {item.status === 'preparando' && (
                                    <span className="px-2.5 py-1 text-[10px] font-bold bg-rose-900/40 border border-rose-800/50/20 text-rose-400 rounded-md border border-rose-900/50/30 animate-pulse-subtle uppercase tracking-wider">
                                      Na Cozinha
                                    </span>
                                  )}

                                  {item.status === 'pronto' && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="px-2.5 py-1 text-[10px] font-bold bg-[#10b981]/15 text-[#10b981] rounded-md border border-[#10b981]/30 animate-pulse uppercase tracking-wider">
                                        Pronto!
                                      </span>
                                      <button
                                        id={`deliver-item-btn-${item.id}`}
                                        onClick={() => onDeliverItem(order.id, item.id)}
                                        className="px-2.5 py-1 bg-[#4E6E58] hover:bg-[#5E836A] text-white rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer border border-[#4E6E58]/10"
                                        title="Marcar como entregue à mesa"
                                      >
                                        Servir
                                      </button>
                                    </div>
                                  )}

                                  {item.status === 'entregue' && (
                                    <span className="px-2.5 py-1 text-[10px] font-bold bg-[#4E6E58]/10 text-[#4E6E58] rounded-md border border-[#4E6E58]/20 flex items-center gap-1 uppercase tracking-wider">
                                      <span className="h-1.5 w-1.5 rounded-full bg-[#4E6E58]"></span>
                                      Servido
                                    </span>
                                  )}

                                  {/* Ações de Cancelamento e Transferência Individual de Item */}
                                  <div className="flex items-center gap-1.5 border-l border-[#27272A] pl-2 ml-1">
                                    {((activeRole !== 'garcom' || restauranteConfig?.perm_garcom_editar)) && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingItem({
                                            id: item.id,
                                            produtoId: item.produtoId,
                                            nome: item.nome,
                                            observacao: item.observacao,
                                            clienteNome: item.clienteNome,
                                            quantidade: 1
                                          });
                                        }}
                                        className="p-1 text-gray-400 hover:text-amber-500 transition-colors cursor-pointer"
                                        title="Editar observações / cliente do item"
                                      >
                                        <Edit2 size={12} />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const maxTableId = salonTables ? Math.max(...salonTables.map(t => t.id), RESTAURANT_CONFIG.totalMesas) : RESTAURANT_CONFIG.totalMesas;
                                        const target = prompt(`Transferir item "${item.nome}" para qual mesa (1-${maxTableId})?`);
                                        if (target) {
                                          const tableNum = parseInt(target, 10);
                                          const isValidTable = salonTables ? salonTables.some(t => t.id === tableNum) : (tableNum >= 1 && tableNum <= RESTAURANT_CONFIG.totalMesas);
                                          if (!isNaN(tableNum) && isValidTable) {
                                            onTransferItem(item.id, tableNum);
                                          } else {
                                            alert(`Número de mesa inválido!`);
                                          }
                                        }
                                      }}
                                      className="p-1 text-gray-400 hover:text-[#10b981] transition-colors cursor-pointer"
                                      title="Transferir este item para outra mesa"
                                    >
                                      <Move size={12} />
                                    </button>
                                    
                                    {(!(activeRole === 'garcom' && !restauranteConfig?.perm_garcom_cancelar)) && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (confirm(`Deseja realmente cancelar o item "${item.nome}"?`)) {
                                            onCancelItem(item.id);
                                          }
                                        }}
                                        className="p-1 text-gray-400 hover:text-red-400 transition-colors cursor-pointer"
                                        title="Cancelar este item"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* DIVISÃO DE CONTA / EXTRATO DE CONSUMO POR CLIENTE (Col-5) */}
                  <div className="lg:col-span-5 bg-[#121214] border border-[#27272A] rounded-3xl p-5 flex flex-col justify-between h-full min-h-[400px]">
                    <div className="space-y-4">
                      
                      <div className="flex items-center justify-between pb-3.5 border-b border-[#27272A]">
                        <div className="flex items-center gap-1.5 text-white">
                          <Receipt size={16} className="text-[#10b981]" />
                          <h3 className="font-serif font-bold text-sm uppercase tracking-wide">Extrato por Cliente</h3>
                        </div>
                        <span className="text-[10px] font-sans font-bold text-[#A1A1AA] uppercase tracking-wider">Divisão Ativa</span>
                      </div>

                      {/* Customer list with subtotal calculations */}
                      <div className="space-y-2.5 max-h-[30vh] overflow-y-auto pr-1 scrollbar-thin">
                        {customerSubtotals.map((cust) => (
                          <div
                            key={cust.name}
                            id={`customer-total-${cust.name.toLowerCase().replace(/\s+/g, '-')}`}
                            className="bg-[#1C1C1F] border border-[#27272A] rounded-2xl p-4 flex items-center justify-between shadow-sm"
                          >
                            <div className="space-y-1 font-sans">
                              <span className="text-xs font-bold text-white truncate block max-w-[150px]">
                                {cust.name}
                              </span>
                              <span className="text-[10px] text-gray-400 font-medium block">
                                {cust.count} {cust.count === 1 ? 'item consumido' : 'itens consumidos'}
                              </span>
                            </div>

                            <div className="flex items-center gap-3">
                              <span className="font-mono text-xs sm:text-sm font-bold text-[#10b981]">
                                R$ {cust.total.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                    </div>

                    {/* Grand Total & Closing Table Commands */}
                    <div className="mt-4 pt-4 border-t border-[#27272A] space-y-3.5">
                      <div className="flex justify-between items-baseline font-sans">
                        <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">Total Acumulado:</span>
                        <span className="text-2xl font-bold font-mono text-[#10b981]">
                          R$ {totalValue.toFixed(2)}
                        </span>
                      </div>

                      <div className="pt-2 flex flex-col gap-2">
                        {/* Print Preview Button for waitstaff */}
                        <button
                          id="print-invoice-preview-btn"
                          onClick={handlePrintPreview}
                          className="w-full py-3 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] hover:border-[#10b981]/30 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer uppercase tracking-wider font-sans"
                        >
                          <Printer size={13} className="text-[#10b981]" />
                          <span>Prévia e Extrato</span>
                        </button>

                        {onClearTableOrders && (
                          <button
                            id="clear-table-orders-test-btn"
                            onClick={() => {
                              if (confirmClear) {
                                onClearTableOrders();
                                setConfirmClear(false);
                              } else {
                                setConfirmClear(true);
                                // Auto-reset after 4 seconds
                                setTimeout(() => setConfirmClear(false), 4000);
                              }
                            }}
                            className={`w-full py-2.5 rounded-xl font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all cursor-pointer uppercase tracking-wider font-sans ${
                              confirmClear
                                ? "bg-rose-600 hover:bg-rose-500 border border-rose-500 text-white animate-pulse"
                                : "bg-rose-950/40 hover:bg-rose-900/50 border border-rose-900/40 hover:border-rose-700/50 text-rose-300 hover:text-white"
                            }`}
                          >
                            <span>{confirmClear ? "Clique p/ Confirmar Zerar" : "Zerar Mesa (Testes)"}</span>
                          </button>
                        )}
                      </div>
                    </div>

                  </div>

                </div>
              )}
            </div>
          )}

          {/* TAB 2: LANÇAR ITENS (MOUNTS MENUPANEL) */}
          {activeTab === 'lancamento' && (
            <MenuPanel
              tableId={table.id}
              draftItems={draftItems}
              existingOrders={orders}
              settings={settings}
              onUpdateSettings={onUpdateSettings}
              onAddToDraft={onAddToDraft}
              onRemoveFromDraft={onRemoveFromDraft}
              onUpdateDraftItem={onUpdateDraftItem}
              onSubmitDraft={onSubmitDraft}
              historicClients={historicClients}
              liveProdutos={liveProdutos}
              isSubmitting={isSubmitting}
            />
          )}

          {/* TAB 3: TRANSFERIR MESA */}
          {activeTab === 'transferir' && (
            <div className="space-y-6 max-w-2xl mx-auto py-4">
              <div className="text-center space-y-2">
                <div className="p-3 bg-[#10b981]/10 text-[#10b981] rounded-full inline-block border border-[#10b981]/20">
                  <Move size={24} />
                </div>
                <h3 className="font-serif text-xl font-bold text-white">Transferência de Mesa</h3>
                <p className="text-xs text-gray-400 font-sans">
                  Selecione o tipo de transferência e a mesa de destino abaixo.
                </p>
              </div>

              {/* Selector for transfer type */}
              <div className="flex bg-[#121214] p-1 border border-[#27272A] rounded-xl font-sans text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setTransferType('total');
                    setSelectedItemsForTransfer([]);
                  }}
                  className={`flex-1 py-2 rounded-lg font-bold transition-all cursor-pointer ${
                    transferType === 'total' ? 'bg-rose-900/40 border border-rose-800/50 text-white shadow-lg' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Mesa Inteira
                </button>
                <button
                  type="button"
                  onClick={() => setTransferType('parcial')}
                  className={`flex-1 py-2 rounded-lg font-bold transition-all cursor-pointer ${
                    transferType === 'parcial' ? 'bg-rose-900/40 border border-rose-800/50 text-white shadow-lg' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Selecionar Itens ("Pedaço")
                </button>
              </div>

              {/* If partial, show items checklist */}
              {transferType === 'parcial' && (
                <div className="space-y-2 bg-[#121214]/50 border border-[#27272A] rounded-2xl p-4 max-h-48 overflow-y-auto">
                  <span className="text-[10px] text-gray-400 block font-bold uppercase tracking-wider mb-2">Selecione os itens para transferir:</span>
                  {orders.flatMap(o => o.itens).length === 0 ? (
                    <span className="text-xs text-gray-500 italic">Não há itens lançados para transferir.</span>
                  ) : (
                    orders.flatMap(o => o.itens).map(item => {
                      const isChecked = selectedItemsForTransfer.includes(item.id);
                      return (
                        <label
                          key={item.id}
                          className="flex items-center justify-between p-2 rounded-lg border border-[#27272A] hover:bg-[#27272A]/50 transition-all cursor-pointer text-xs"
                        >
                          <div className="flex items-center gap-2.5 text-white">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setSelectedItemsForTransfer(prev => prev.filter(id => id !== item.id));
                                } else {
                                  setSelectedItemsForTransfer(prev => [...prev, item.id]);
                                }
                              }}
                              className="rounded border-[#27272A] text-rose-400 focus:ring-[#f43f5e] h-3.5 w-3.5 bg-[#121214]"
                            />
                            <span>{item.nome}</span>
                            {item.clienteNome && <span className="text-[9px] text-[#10b981] bg-[#10b981]/10 border border-[#10b981]/20 px-1 rounded">Para: {item.clienteNome}</span>}
                          </div>
                          <span className="font-mono text-gray-400">R$ {item.preco.toFixed(2)}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              )}

              {/* Target tables grid */}
              <div className="space-y-2">
                <span className="text-[10px] text-gray-400 block font-bold uppercase tracking-wider text-center">Mesa de Destino:</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-1">
                  {TABLES.filter(t => t.id !== table.id).length === 0 ? (
                    <div className="col-span-full py-8 text-center text-gray-400 text-sm italic font-sans">
                      Nenhuma mesa disponível no momento.
                    </div>
                  ) : (
                    TABLES.filter(t => t.id !== table.id).map((t) => {
                      const isConfirming = confirmTransferTo === t.id;
                      const hasSelected = transferType === 'total' || selectedItemsForTransfer.length > 0;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          disabled={!hasSelected}
                          id={`transfer-target-mesa-${t.id}`}
                          onClick={() => {
                            if (!hasSelected) return;
                            if (isConfirming) {
                              if (transferType === 'total') {
                                onTransferTable(t.id);
                              } else {
                                // Transfer multiple items!
                                onTransferItems(selectedItemsForTransfer, t.id);
                                setSelectedItemsForTransfer([]);
                              }
                              setConfirmTransferTo(null);
                            } else {
                              setConfirmTransferTo(t.id);
                            }
                          }}
                          onMouseLeave={() => {
                            if (isConfirming) setConfirmTransferTo(null);
                          }}
                          className={`p-4 border rounded-2xl text-center transition-all flex flex-col items-center justify-center gap-1 group ${
                            !hasSelected
                              ? 'bg-[#1C1C1F]/40 border-[#27272A]/40 text-gray-600 cursor-not-allowed'
                              : isConfirming
                                ? 'bg-rose-900/40 border border-rose-800/50 border-rose-900/50 animate-pulse text-white cursor-pointer hover:scale-102'
                                : 'bg-[#1C1C1F] hover:bg-[#10b981]/10 border border-[#27272A] hover:border-[#10b981] text-white cursor-pointer hover:scale-102'
                          }`}
                        >
                          <span className={`text-base font-bold ${hasSelected ? 'text-white group-hover:text-[#10b981]' : 'text-gray-600'}`}>
                            {isConfirming ? 'Confirmar?' : `Mesa ${t.id}`}
                          </span>
                          {isConfirming && (
                            <span className="text-[9px] text-gray-300 font-sans">Toque para confirmar</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

        </div>

      </div>

      {/* EMBEDDED PRINT PREVIEW (RECEIPT) POPUP MODAL */}
      {showPrintPreview && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[#1C1C1F] border border-[#27272A] rounded-3xl shadow-2xl max-w-sm w-full p-6 space-y-4 max-h-[85vh] flex flex-col justify-between">
            
            {/* Invoice Header */}
            <div className="space-y-2 pb-3 border-b border-[#27272A]">
              <div className="flex justify-between items-center font-sans">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Extrato de Mesa</span>
                <button
                  id="close-print-preview-btn"
                  onClick={() => setShowPrintPreview(false)}
                  className="p-1 hover:bg-[#27272A] border border-transparent hover:border-[#27272A] rounded-full transition-colors text-gray-400 hover:text-white cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* RECEIPT GRAPHICS */}
            <div className="flex-1 overflow-y-auto bg-black border border-[#27272A] rounded-2xl p-5 font-mono text-[11px] text-gray-300 space-y-4 shadow-inner max-h-[50vh] scrollbar-thin">
              <div className="text-center space-y-1 border-b border-dashed border-[#27272A] pb-3">
                <p className="font-serif font-bold text-base text-white tracking-tight">{restaurantName.toUpperCase()}</p>
                <p className="text-[9px] text-[#10b981] leading-normal font-sans">Mesa de Atendimento de Excelência</p>
              </div>

              <div className="space-y-1 border-b border-dashed border-[#27272A] pb-3">
                <p><strong>DATA:</strong> {new Date().toLocaleDateString('pt-BR')} {new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}</p>
                <p><strong>MESA:</strong> #{table.id}</p>
                <p><strong>ATENDIMENTO:</strong> {activeWaiterNome}</p>
              </div>

              {/* Items List */}
              <div className="space-y-2 border-b border-dashed border-[#27272A] pb-3">
                <div className="flex justify-between font-bold text-[9px] text-gray-400 uppercase font-sans tracking-wider pb-1">
                  <span>IGUARIA</span>
                  <span>PREÇO</span>
                </div>
                
                {(() => {
                  const items = orders.flatMap(o => o.itens);
                  
                  // Check if there are any items with actual client names
                  const clientsWithItems = Array.from(new Set(
                    items.map(i => i.clienteNome ? i.clienteNome.trim() : '')
                  )).filter(name => name !== '' && name !== 'Consumo Geral');

                  if (clientsWithItems.length === 0) {
                    // No custom clients, group identical items globally
                    const globalGrouped: { [key: string]: { nome: string, preco: number, quantidade: number } } = {};
                    items.forEach(item => {
                      const key = `${item.nome}_${item.preco}`;
                      if (!globalGrouped[key]) {
                        globalGrouped[key] = { nome: item.nome, preco: item.preco, quantidade: 0 };
                      }
                      globalGrouped[key].quantidade += 1;
                    });

                    return (
                      <div className="space-y-1">
                        {Object.values(globalGrouped).map((item, idx) => (
                          <div key={idx} className="flex justify-between">
                            <span>{item.quantidade}x {item.nome}</span>
                            <span className="font-bold">R$ {(item.preco * item.quantidade).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  } else {
                    // Group items by client name, and put ones without client name in 'Consumo Geral'
                    const grouped: { [client: string]: typeof items } = {};
                    items.forEach(item => {
                      const client = item.clienteNome ? item.clienteNome.trim() : 'Consumo Geral';
                      if (!grouped[client]) {
                        grouped[client] = [];
                      }
                      grouped[client].push(item);
                    });

                    return (
                      <div className="space-y-3">
                        {Object.entries(grouped).map(([client, clientItems]) => {
                          // Group identical items within this client section
                          const clientGrouped: { [key: string]: { nome: string, preco: number, quantidade: number } } = {};
                          clientItems.forEach(item => {
                            const key = `${item.nome}_${item.preco}`;
                            if (!clientGrouped[key]) {
                              clientGrouped[key] = { nome: item.nome, preco: item.preco, quantidade: 0 };
                            }
                            clientGrouped[key].quantidade += 1;
                          });

                          return (
                            <div key={client} className="space-y-1 border-t border-dashed border-[#27272A] pt-2 first:border-0 first:pt-0">
                              <span className="font-bold text-[10px] text-[#10b981] uppercase font-sans tracking-wider block">
                                Cliente: {client}
                              </span>
                              {Object.values(clientGrouped).map((item, idx) => (
                                <div key={idx} className="flex justify-between pl-2">
                                  <span>{item.quantidade}x {item.nome}</span>
                                  <span className="font-bold">R$ {(item.preco * item.quantidade).toFixed(2)}</span>
                                </div>
                              ))}
                              <div className="text-right text-[10px] font-bold text-gray-400 pr-1 pt-0.5">
                                Subtotal {client}: R$ {clientItems.reduce((s, i) => s + i.preco, 0).toFixed(2)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }
                })()}
              </div>

              {/* Math totals */}
              <div className="space-y-1 pt-1 text-right">
                {(() => {
                  const itemsFiltered = orders.flatMap(o => o.itens);
                  const subTotal = itemsFiltered.reduce((s, i) => s + i.preco, 0);
                  const hasTax = restauranteConfig?.taxa_servico_ativa ?? true;
                  const taxRate = restauranteConfig?.taxa_servico_padrao ?? 10;
                  const taxVal = hasTax ? subTotal * (taxRate / 100) : 0;
                  const grandTotal = subTotal + taxVal;

                  return (
                    <div className="space-y-1 text-right text-[10px] text-gray-400 font-sans">
                      <div className="flex justify-between">
                        <span>Subtotal Consumo:</span>
                        <span className="font-mono">R$ {subTotal.toFixed(2)}</span>
                      </div>
                      {hasTax && (
                        <div className="flex justify-between">
                          <span>Taxa Serviço ({taxRate}%):</span>
                          <span className="font-mono">R$ {taxVal.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs font-bold text-[#10b981] border-t border-dotted border-[#27272A] pt-2.5 mt-2.5">
                        <span>TOTAL GERAL:</span>
                        <span className="font-mono">R$ {grandTotal.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="text-center pt-3 border-t border-dashed border-[#27272A] text-[9px] text-gray-500 font-sans">
                <p>Obrigado pelo seu consumo!</p>
                <p>Documento para conferência interna</p>
              </div>
            </div>

            {/* Print Status Feedback */}
            {printSuccess && (
              <div className="bg-[#4E6E58]/25 border border-[#4E6E58]/40 text-[#6E9E7C] p-2.5 rounded-xl text-center text-[10px] font-bold font-sans uppercase tracking-wider">
                Impressão enviada com sucesso!
              </div>
            )}

            {/* Simulated Print Button */}
            <button
              id="finalize-physical-print-mock-btn"
              onClick={async () => {
                if (onPrintReceipt) {
                  try {
                    await onPrintReceipt();
                    setPrintSuccess(true);
                    setTimeout(() => {
                      setPrintSuccess(false);
                      setShowPrintPreview(false);
                    }, 1500);
                  } catch (err) {
                    console.error("Error printing receipt:", err);
                    alert("Erro ao enviar impressão do recibo");
                  }
                } else {
                  setPrintSuccess(true);
                  setTimeout(() => {
                    setPrintSuccess(false);
                    setShowPrintPreview(false);
                  }, 1500);
                }
              }}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider border border-emerald-500/20 transition-all shadow-lg shadow-emerald-500/10"
            >
              <Printer size={13} className="text-white" />
              <span>Imprimir Extrato</span>
            </button>
          </div>
        </div>
      )}

      {/* REPRINT ORDER MODAL (VIA DE COZINHA) */}
      {selectedOrderToPrint && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[#1C1C1F] border border-[#27272A] rounded-3xl shadow-2xl max-w-sm w-full p-6 space-y-4 max-h-[85vh] flex flex-col justify-between">
            
            {/* Invoice Header */}
            <div className="space-y-2 pb-3 border-b border-[#27272A]">
              <div className="flex justify-between items-center font-sans">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Reimpressão de Lote (Cozinha)</span>
                <button
                  onClick={() => setSelectedOrderToPrint(null)}
                  className="p-1 hover:bg-[#27272A] border border-transparent hover:border-[#27272A] rounded-full transition-colors text-gray-400 hover:text-white cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* RECEIPT GRAPHICS */}
            <div className="flex-1 overflow-y-auto bg-black border border-[#27272A] rounded-2xl p-5 font-mono text-[11px] text-gray-300 space-y-4 shadow-inner max-h-[50vh] scrollbar-thin">
              <div className="text-center space-y-1 border-b border-dashed border-[#27272A] pb-3">
                <p className="font-serif font-bold text-base text-white tracking-tight">{restaurantName.toUpperCase()}</p>
                <p className="text-[9px] text-rose-400 leading-normal font-sans font-bold">REIMPRESSÃO • VIA COZINHA</p>
              </div>

              <div className="space-y-1 border-b border-dashed border-[#27272A] pb-3">
                <p><strong>LOTE:</strong> #{selectedOrderToPrint.id.slice(-4)}</p>
                {selectedOrderToPrint.tipo && <p><strong>TIPO:</strong> {selectedOrderToPrint.tipo.toUpperCase()}</p>}
                <p><strong>DATA:</strong> {new Date(selectedOrderToPrint.timestamp).toLocaleDateString('pt-BR')} {new Date(selectedOrderToPrint.timestamp).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}</p>
                <p><strong>MESA:</strong> #{table.id}</p>
                <p><strong>ATENDIMENTO:</strong> {selectedOrderToPrint.garcomNome}</p>
              </div>

              {/* Items List */}
              <div className="space-y-2 border-b border-dashed border-[#27272A] pb-3">
                <div className="flex justify-between font-bold text-[9px] text-gray-400 uppercase font-sans tracking-wider pb-1">
                  <span>ITEM</span>
                  <span>PREÇO</span>
                </div>
                
                <div className="space-y-2.5">
                  {/* Group duplicate items by name + observation + clientName to display quantity cleanly */}
                  {(() => {
                    interface GroupedKey {
                      nome: string;
                      observacao: string;
                      clienteNome: string;
                      preco: number;
                    }
                    const groupedMap = new Map<string, { item: GroupedKey; qty: number }>();
                    selectedOrderToPrint.itens.forEach(item => {
                      const key = `${item.nome}||${item.observacao}||${item.clienteNome}`;
                      const existing = groupedMap.get(key);
                      if (existing) {
                        existing.qty += 1;
                      } else {
                        groupedMap.set(key, {
                          item: {
                            nome: item.nome,
                            observacao: item.observacao,
                            clienteNome: item.clienteNome,
                            preco: item.preco
                          },
                          qty: 1
                        });
                      }
                    });

                    return Array.from(groupedMap.values()).map(({ item, qty }, idx) => (
                      <div key={idx} className="space-y-0.5">
                        <div className="flex justify-between font-bold">
                          <span>{qty}x {item.nome}</span>
                          <span className="text-gray-400">R$ {(item.preco * qty).toFixed(2)}</span>
                        </div>
                        {item.clienteNome && item.clienteNome !== 'Consumo Geral' && (
                          <p className="text-[9px] text-[#10b981] uppercase font-bold">Para: {item.clienteNome}</p>
                        )}
                        {item.observacao && (
                          <p className="text-[10px] text-rose-300 italic pl-2 border-l border-dashed border-rose-900/50/50">
                            Obs: "{item.observacao}"
                          </p>
                        )}
                      </div>
                    ));
                  })()}
                </div>
              </div>

              <div className="text-center pt-3 border-t border-dashed border-[#27272A] text-[9px] text-gray-500 font-sans">
                <p>Reimpressão de Comanda de Produção</p>
                <p>Controle Interno de Cozinha</p>
              </div>
            </div>

            {/* Print Status Feedback */}
            {printSuccess && (
              <div className="bg-[#4E6E58]/25 border border-[#4E6E58]/40 text-[#6E9E7C] p-2.5 rounded-xl text-center text-[10px] font-bold font-sans uppercase tracking-wider">
                Reimpressão enviada com sucesso!
              </div>
            )}

            {/* Simulated Print Button */}
            <button
              onClick={async () => {
                if (onPrintKitchenLaunch && selectedOrderToPrint) {
                  try {
                    await onPrintKitchenLaunch(selectedOrderToPrint.id);
                    setPrintSuccess(true);
                    setTimeout(() => {
                      setPrintSuccess(false);
                      setSelectedOrderToPrint(null);
                    }, 1500);
                  } catch (err) {
                    console.error("Error reprinting kitchen launch:", err);
                    alert("Erro ao enviar reimpressão para a cozinha");
                  }
                } else {
                  setPrintSuccess(true);
                  setTimeout(() => {
                    setPrintSuccess(false);
                    setSelectedOrderToPrint(null);
                  }, 1500);
                }
              }}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider border border-emerald-500/20 transition-all shadow-lg shadow-emerald-500/10"
            >
              <Printer size={13} className="text-white" />
              <span>Imprimir Via Cozinha</span>
            </button>
          </div>
        </div>
      )}

      {editingItem && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in">
            <div className="flex justify-between items-center pb-2 border-b border-[#27272A]">
              <h3 className="font-serif text-sm font-bold text-white">Editar Item: {editingItem.nome}</h3>
              <button 
                type="button"
                onClick={() => setEditingItem(null)} 
                className="p-1 text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Quantity Selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Quantidade:</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingItem({ ...editingItem, quantidade: Math.max(1, editingItem.quantidade - 1) })}
                    className="w-8 h-8 rounded-xl bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] flex items-center justify-center text-white font-bold cursor-pointer transition-colors"
                  >
                    -
                  </button>
                  <span className="text-sm font-bold text-white font-mono w-6 text-center">{editingItem.quantidade}</span>
                  <button
                    type="button"
                    onClick={() => setEditingItem({ ...editingItem, quantidade: editingItem.quantidade + 1 })}
                    className="w-8 h-8 rounded-xl bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] flex items-center justify-center text-white font-bold cursor-pointer transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Observations Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Observações de Preparo:</label>
                <input
                  type="text"
                  value={editingItem.observacao}
                  onChange={(e) => setEditingItem({ ...editingItem, observacao: e.target.value })}
                  className="w-full px-3.5 py-2 text-xs bg-[#1C1C1F] border border-[#27272A] rounded-xl focus:outline-none focus:border-[#10b981]/30 text-white"
                  placeholder="Ex: Sem cebola, Bem frito, etc."
                />
              </div>

              {/* Customer Name Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Nome do Cliente:</label>
                <input
                  type="text"
                  value={editingItem.clienteNome === 'Consumo Geral' ? '' : editingItem.clienteNome}
                  onChange={(e) => setEditingItem({ ...editingItem, clienteNome: e.target.value })}
                  className="w-full px-3.5 py-2 text-xs bg-[#1C1C1F] border border-[#27272A] rounded-xl focus:outline-none focus:border-[#10b981]/30 text-white"
                  placeholder="Ex: Maria (Opcional)"
                />
              </div>

              <button
                type="button"
                onClick={async () => {
                  const finalClient = editingItem.clienteNome.trim() || 'Consumo Geral';
                  if (onUpdateItemDetails) {
                    await onUpdateItemDetails(
                      editingItem.id, 
                      editingItem.observacao, 
                      finalClient,
                      editingItem.quantidade
                    );
                  }
                  setEditingItem(null);
                }}
                className="w-full py-2.5 bg-[#10b981] hover:bg-[#059669] text-[#121214] font-bold text-xs rounded-xl transition-all cursor-pointer uppercase tracking-wider text-center"
              >
                Confirmar Alterações
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
