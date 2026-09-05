/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShoppingBag, PlusCircle, Zap, Printer, CheckCircle2, Move, GitMerge, Edit3, Trash2 } from 'lucide-react';
import type { AppRole, Order, OrderItem, Table } from '../../types';
import type { getCustomerSubtotals } from '../../domain';
import { deriveOrderOperationalState } from '../../domain/operationalState';
import { formatBackendTime } from '../../utils/dateTime';

interface MesaConsumptionConfig {
  taxa_servico_ativa?: boolean;
  taxa_servico_padrao?: number;
  perm_garcom_fechar?: boolean;
  perm_garcom_transferir_mesa?: boolean;
  perm_garcom_editar?: boolean;
  perm_garcom_cancelar_item?: boolean;
}

interface MesaConsumptionPanelProps {
  table: Table;
  orders: Order[];
  currentTime: number;
  activeRole: AppRole;
  restauranteConfig?: MesaConsumptionConfig;
  totalValue: number;
  customerSubtotals: ReturnType<typeof getCustomerSubtotals>;
  canTransferTables: boolean;
  canTransferItems: boolean;
  isPrintingDirect: boolean;
  directPrintToast: string;
  confirmClear: boolean;
  setActiveTab: React.Dispatch<React.SetStateAction<'consumo' | 'lancamento' | 'transferir' | 'mesclar'>>;
  setTransferType: React.Dispatch<React.SetStateAction<'total' | 'parcial' | 'mesclar'>>;
  setSelectedOrderToPrint: (order: Order) => void;
  setEditingItem: (item: Pick<OrderItem, 'id' | 'produtoId' | 'nome' | 'observacao' | 'clienteNome'> & { orderId: string; quantidade: number }) => void;
  onPrintPreview: () => void | Promise<void>;
  onPrintValues: () => void | Promise<void>;
  onCloseTable?: () => void;
  onMergeTables?: (sourceTableId: number, targetTableId: number) => void;
  onUnmergeTable?: (checkId: string) => void;
  onDeliverItem?: (checkId: string, itemId: string) => void;
  onCancelItem: (itemId: string) => void;
}

/** Consumption presentation; confirmations, dialogs and timers belong to the modal owner. */
export function MesaConsumptionPanel({
  table, orders, currentTime, activeRole, restauranteConfig, totalValue, customerSubtotals,
  canTransferTables, canTransferItems, isPrintingDirect, directPrintToast, confirmClear,
  setActiveTab, setTransferType, setSelectedOrderToPrint, setEditingItem,
  onPrintPreview, onPrintValues, onCloseTable, onMergeTables, onUnmergeTable, onDeliverItem, onCancelItem,
}: MesaConsumptionPanelProps) {
  return (
    <div className="p-3 sm:p-5 space-y-4 sm:space-y-6">
      {orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
          <div className="p-3.5 bg-koma-panel text-emerald-400 rounded-full border border-koma-border">
            <ShoppingBag size={28} />
          </div>
          <h3 className="font-serif text-lg font-bold text-koma-foreground">Mesa sem consumo ativo</h3>
          <p className="text-xs text-koma-subtle max-w-sm leading-relaxed">
            Nenhum pedido ativo foi lançado nesta mesa ainda. Use a aba de <strong>Cardápio</strong> para lançar o primeiro pedido.
          </p>
          <button
            id="go-to-billing-tab-btn"
            onClick={() => setActiveTab('lancamento')}
            className="mt-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-xl text-xs font-extrabold tracking-wider uppercase transition-colors cursor-pointer border border-emerald-400 shadow-md"
          >
            + Lançar Pedidos
          </button>
        </div>
      ) : (
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-4 sm:gap-6 items-stretch">

          {/* 1. RESUMO FINANCEIRO & AÇÕES RÁPIDAS (RENDERIZA NO TOPO NO MOBILE - 0 ROLAGEM) */}
          <div className="order-1 lg:order-2 lg:col-span-5 bg-koma-panel border border-koma-border rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 flex flex-col justify-between space-y-3 shadow-sm">
            <div className="space-y-3">
              {/* Origin & Transfer Badges */}
              {(() => {
                const transferOrigin = orders.find(o => o.mesaTransferidaDe)?.mesaTransferidaDe;
                const mergedOrigins = Array.from(new Set(orders.map(o => o.mesaOrigemId).filter((id): id is number => id !== null && id !== undefined && id !== table.id)));
                if (transferOrigin || mergedOrigins.length > 0) {
                  return (
                    <div className="flex flex-wrap gap-1.5 pb-0.5">
                      {transferOrigin && (
                        <span className="px-2 py-0.5 text-[9px] bg-purple-500/20 text-purple-300 border border-purple-500/35 rounded-md font-sans font-bold uppercase tracking-wider">
                          Transf. da Mesa {transferOrigin}
                        </span>
                      )}
                      {mergedOrigins.map(mId => (
                        <span key={mId} className="px-2 py-0.5 text-[9px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/35 rounded-md font-sans font-bold uppercase tracking-wider">
                          Mesclada com Mesa {mId}
                        </span>
                      ))}
                    </div>
                  );
                }
                return null;
              })()}

              {/* Financial Total */}
              {(() => {
                const hasTax = restauranteConfig?.taxa_servico_ativa ?? true;
                const taxRate = restauranteConfig?.taxa_servico_padrao ?? 10;
                const taxVal = hasTax ? totalValue * (taxRate / 100) : 0;
                const grandTotal = totalValue + taxVal;
                return (
                  <div className="bg-koma-raised border border-koma-border rounded-xl p-3 space-y-1.5 shadow-sm">
                    <div className="flex justify-between items-baseline font-sans text-xs text-koma-subtle">
                      <span className="font-bold uppercase tracking-wider">Subtotal:</span>
                      <span className="font-mono font-medium">R$ {totalValue.toFixed(2)}</span>
                    </div>
                    {hasTax && (
                      <div className="flex justify-between items-baseline font-sans text-xs text-koma-subtle">
                        <span className="font-bold uppercase tracking-wider">Taxa de Serviço ({taxRate}%):</span>
                        <span className="font-mono font-medium">R$ {taxVal.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center font-sans border-t border-koma-border/70 pt-2 mt-1">
                      <span className="text-xs text-koma-subtle font-bold uppercase tracking-wider">Total Geral:</span>
                      <span className="text-xl sm:text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400">
                        R$ {grandTotal.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Direct Print Feedback Toast */}
              {directPrintToast && (
                <div className="bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 px-3 py-1.5 rounded-xl text-center text-xs font-bold font-sans animate-fade-in">
                  {directPrintToast}
                </div>
              )}

              {/* Action Row 1: Fechamento + reimpressão total com impressão direta */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  id="quick-print-values-btn"
                  type="button"
                  disabled={isPrintingDirect}
                  onClick={onPrintValues}
                  className="py-2.5 px-2 bg-koma-raised hover:bg-koma-card border border-koma-border text-koma-foreground rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Imprimir fechamento apenas com valores"
                >
                  <Zap size={14} className="shrink-0 text-koma-subtle" />
                  <span>Fechamento</span>
                </button>

                <button
                  id="print-invoice-preview-btn"
                  type="button"
                  disabled={isPrintingDirect}
                  onClick={onPrintPreview}
                  className="py-2.5 px-2 bg-koma-raised hover:bg-koma-card border border-koma-border hover:border-emerald-500/30 text-koma-foreground rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Reimprimir todos os itens ativos da mesa"
                >
                  <Printer size={14} className="text-emerald-400 shrink-0" />
                  <span>Reimpressão</span>
                </button>
              </div>

              {/* Action Row 2: Adicionar Itens e Fechamento da Mesa (Dinâmico sem buracos vazios) */}
              {(() => {
                const canCloseTable = Boolean(onCloseTable && !(activeRole === 'garcom' && !restauranteConfig?.perm_garcom_fechar));
                return (
                  <div className={canCloseTable ? "grid grid-cols-2 gap-2" : "w-full"}>
                    <button
                      type="button"
                      onClick={() => setActiveTab('lancamento')}
                      className="w-full py-2.5 px-2 bg-koma-raised hover:bg-koma-card border border-koma-border hover:border-emerald-500/30 text-koma-foreground rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95"
                    >
                      <PlusCircle size={14} className="text-emerald-400 shrink-0" />
                      <span>Adicionar Itens</span>
                    </button>

                    {canCloseTable && (
                      <button
                        id="close-table-btn-consumo"
                        onClick={onCloseTable}
                        className={`py-2.5 px-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer font-sans transition-all border ${
                          confirmClear
                            ? 'bg-rose-800/40 border-rose-700/50 text-rose-300 animate-pulse'
                            : 'bg-koma-raised hover:bg-rose-950/30 border-koma-border hover:border-rose-800/40 text-rose-400'
                        }`}
                      >
                        <CheckCircle2 size={13} className="shrink-0" />
                        <span>{confirmClear ? 'Confirmar Fechamento?' : 'Fechar Mesa'}</span>
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Transfer / Merge Quick Actions */}
              <div className="flex items-center gap-2 pt-0.5">
                {(canTransferTables || canTransferItems) && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('transferir');
                      setTransferType(canTransferTables ? 'total' : 'parcial');
                    }}
                    className="flex-1 py-1.5 bg-koma-card hover:bg-koma-raised border border-koma-border text-koma-subtle hover:text-koma-foreground rounded-lg font-bold text-[10px] flex items-center justify-center gap-1 transition-colors cursor-pointer uppercase font-sans"
                  >
                    <Move size={11} className="text-emerald-400" />
                    <span>Transferir</span>
                  </button>
                )}
                {onMergeTables && canTransferTables && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('mesclar');
                      setTransferType('mesclar');
                    }}
                    className="flex-1 py-1.5 bg-koma-card hover:bg-koma-raised border border-koma-border text-koma-subtle hover:text-koma-foreground rounded-lg font-bold text-[10px] flex items-center justify-center gap-1 transition-colors cursor-pointer uppercase font-sans"
                  >
                    <GitMerge size={11} className="text-emerald-400" />
                    <span>Mesclar</span>
                  </button>
                )}
              </div>

              {/* Customer subtotal breakdown */}
              {customerSubtotals.length > 1 && (
                <div className="pt-2 border-t border-koma-border space-y-1.5">
                  <span className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">Divisão por Cliente:</span>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto scrollbar-thin">
                    {customerSubtotals.map((cust) => (
                      <div
                        key={cust.name}
                        className="bg-koma-raised/70 border border-koma-border/60 rounded-xl px-3 py-1.5 flex items-center justify-between text-xs"
                      >
                        <span className="font-bold text-koma-foreground truncate max-w-[140px]">{cust.name}</span>
                        <span className="font-mono font-bold text-emerald-400">R$ {cust.total.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 2. HISTÓRICO DE PEDIDOS LANÇADOS (NA COZINHA / PRONTO / ENTREGUE) */}
          <div className="order-2 lg:order-1 lg:col-span-7 space-y-3">
            <div className="flex items-center justify-between border-b border-koma-border pb-2">
              <h3 className="font-serif font-bold text-koma-foreground text-sm sm:text-base">Comanda de Pedidos</h3>
              <span className="text-[10px] font-semibold text-koma-subtle uppercase tracking-wider font-sans">Lotes: {orders.length}</span>
            </div>

            <div className="space-y-3 sm:max-h-[45vh] sm:overflow-y-auto max-h-none overflow-y-visible pr-1 scrollbar-thin">
              {orders.map((order) => {
                const orderState = deriveOrderOperationalState(order, currentTime);
                const launchKey = orderState.lancamentoId || orderState.checkId;
                const unpaidItems = order.itens.filter((item: any) => !item.pago);
                if (unpaidItems.length === 0) return null;

                return (
                <div
                  key={launchKey}
                  id={`placed-order-${launchKey}`}
                  className="border border-koma-border rounded-xl sm:rounded-2xl overflow-hidden bg-koma-panel/40"
                >
                  {/* Order Header */}
                  <div className="bg-koma-raised px-3.5 py-2 flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-koma-border gap-2 w-full">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold text-koma-foreground font-sans">Lote #{orderState.displayNumber || launchKey.slice(-4)}</span>
                      <span className="text-[10px] bg-koma-panel text-koma-muted px-2 py-0.5 rounded font-bold font-sans">
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
                      {order.mesaOrigemId && (
                        <span className="text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          Mesclado da Mesa {order.mesaOrigemId}
                        </span>
                      )}
                      {order.mesaTransferidaDe && (
                        <span className="text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                          Transferido da Mesa {order.mesaTransferidaDe}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-koma-subtle font-mono font-bold">
                        {formatBackendTime(order.timestamp)}
                      </span>

                      {order.mesaOrigemId && onUnmergeTable && (
                        <button
                          type="button"
                          disabled={activeRole === 'garcom' && !restauranteConfig?.perm_garcom_transferir_mesa}
                          onClick={() => onUnmergeTable(order.id)}
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-sans font-semibold transition-all flex items-center gap-1 shadow-sm ${
                            (activeRole === 'garcom' && !restauranteConfig?.perm_garcom_transferir_mesa)
                              ? 'bg-koma-panel/40 border border-koma-border/40 text-gray-600 cursor-not-allowed'
                              : 'bg-purple-950/40 hover:bg-purple-900/30 text-purple-300 hover:text-koma-foreground border border-purple-900/40 cursor-pointer'
                          }`}
                          title="Desmembrar este pedido de volta para sua mesa de origem"
                        >
                          <span>Desmembrar</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setSelectedOrderToPrint(order)}
                        className="px-2 py-0.5 bg-koma-raised hover:bg-emerald-500/15 text-koma-muted hover:text-koma-foreground border border-koma-border hover:border-emerald-500/30 rounded-lg text-[10px] font-sans font-semibold transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                        title="Reimprimir este lote de pedidos"
                      >
                        <Printer size={11} className="text-emerald-700 dark:text-emerald-400" />
                        <span>Reimprimir</span>
                      </button>
                    </div>
                  </div>

                  {/* Order Items */}
                  <div className="p-3 divide-y divide-koma-border">
                    {unpaidItems.map((item) => (
                      <div
                        key={item.id}
                        id={`placed-item-${item.id}`}
                        className="py-2.5 flex justify-between items-start gap-3 text-xs first:pt-0 last:pb-0 font-sans"
                      >
                        <div className="space-y-1 flex-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="font-bold text-koma-foreground">{item.nome}</span>
                            {item.clienteNome && (
                              <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded border border-emerald-500/30 uppercase tracking-wider">
                                Para: {item.clienteNome}
                              </span>
                            )}
                          </div>

                          {item.observacao ? (
                            <p className="text-[11px] text-koma-subtle italic bg-koma-panel px-2 py-0.5 rounded border border-dashed border-koma-border inline-block">
                              Obs: "{item.observacao}"
                            </p>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-koma-foreground text-xs sm:text-sm">R$ {(item.preco ?? 0).toFixed(2)}</span>

                          {item.status === 'preparando' && (
                            <span className="px-2 py-0.5 text-[9px] font-bold bg-amber-500/15 border border-amber-500/30 text-amber-400 rounded-md animate-pulse-subtle uppercase tracking-wider">
                              Na Cozinha
                            </span>
                          )}

                          {item.status === 'pronto' && (
                            <div className="flex items-center gap-1">
                              <span className="px-2 py-0.5 text-[9px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 rounded-md border border-emerald-500/30 animate-pulse uppercase tracking-wider">
                                Pronto!
                              </span>
                              <button
                                id={`deliver-item-btn-${item.id}`}
                                onClick={() => onDeliverItem(order.id, item.id)}
                                className="px-2 py-0.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-md text-[9px] font-extrabold uppercase tracking-wider transition-colors cursor-pointer"
                                title="Marcar como entregue à mesa"
                              >
                                Servir
                              </button>
                            </div>
                          )}

                          {item.status === 'entregue' && (
                            <span className="px-2 py-0.5 text-[9px] font-bold bg-emerald-500/10 text-emerald-400 rounded-md border border-emerald-500/20 flex items-center gap-1 uppercase tracking-wider">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                              Servido
                            </span>
                          )}

                          <div className="flex items-center gap-1 border-l border-koma-border pl-1.5 ml-1">
                            {((activeRole !== 'garcom' || restauranteConfig?.perm_garcom_editar)) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingItem({
                                    id: item.id,
                                    produtoId: item.produtoId,
                                    nome: item.nome,
                                    observacao: item.observacao,
                                    clienteNome: item.clienteNome || 'Consumo Geral',
                                    quantidade: 1,
                                    orderId: order.id
                                  });
                                }}
                                className="p-1 text-koma-subtle hover:text-emerald-400 transition-colors cursor-pointer"
                                title="Editar observação do item"
                              >
                                <Edit3 size={11} />
                              </button>
                            )}

                            {((activeRole !== 'garcom' || restauranteConfig?.perm_garcom_cancelar_item)) && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm(`Tem certeza que deseja cancelar "${item.nome}"?`)) {
                                    onCancelItem(item.id);
                                  }
                                }}
                                className="p-1 text-koma-subtle hover:text-red-400 transition-colors cursor-pointer"
                                title="Cancelar este item"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )})}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
