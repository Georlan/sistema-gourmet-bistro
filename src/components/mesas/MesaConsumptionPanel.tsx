import { MesaPrintActions } from './MesaPrintActions';
import { planWaiterRepeat } from '../../domain/waiterRepeatItem';
import { OrderItemComposition } from '../shared/OrderItemComposition';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShoppingBag, PlusCircle, Printer, CheckCircle2, Move, GitMerge, Edit3, Trash2, Plus } from 'lucide-react';
import type { AppRole, Order, OrderItem, OrderItemModifier, Table, Product } from '../../types';
import type { getCustomerSubtotals } from '../../domain';
import { deriveOrderOperationalState } from '../../domain/operationalState';
import { formatBackendTime } from '../../utils/dateTime';

const waiterAmount = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface MesaConsumptionConfig {
  taxa_servico_ativa?: boolean;
  taxa_servico_padrao?: number;
  perm_garcom_fechar?: boolean;
  perm_garcom_print?: boolean;
  perm_garcom_transferir_mesa?: boolean;
  perm_garcom_editar?: boolean;
  perm_garcom_cancelar?: boolean;
  entitlements?: { printing?: boolean };
}

interface MesaConsumptionPanelProps {
  readyOnly?: boolean;
  onToggleReadyOnly?: () => void;
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
  onRepeatItem?: (item: OrderItem) => void;
  repeatProducts?: Product[];
  repeatCatalogReady?: boolean;
  cardapio_ativo_id?: string | null;
  cardapios_ativos_ids?: string[];
  isSubmitting?: boolean;
}

const summarizeItemModifiers = (modifiers: readonly OrderItemModifier[]) => {
  const summary = new Map<string, { modifier: OrderItemModifier; quantity: number }>();
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

/** Consumption presentation; confirmations, dialogs and timers belong to the modal owner. */
export function MesaConsumptionPanel({
  readyOnly = false, onToggleReadyOnly,
  table, orders, currentTime, activeRole, restauranteConfig, totalValue, customerSubtotals,
  canTransferTables, canTransferItems, isPrintingDirect, directPrintToast, confirmClear,
  setActiveTab, setTransferType, setSelectedOrderToPrint, setEditingItem,
  onPrintPreview, onPrintValues, onCloseTable, onMergeTables, onUnmergeTable, onDeliverItem, onCancelItem,
  onRepeatItem, repeatProducts = [], repeatCatalogReady = false,
  cardapio_ativo_id, cardapios_ativos_ids, isSubmitting = false,
}: MesaConsumptionPanelProps) {
  const amount = (value: number) => activeRole === 'garcom' ? waiterAmount.format(value) : value.toFixed(2);
  const repeatProductMap = new Map(repeatProducts.map(product => [product.id, product]));
  const hasPrinting = restauranteConfig?.entitlements?.printing === true
    && (activeRole !== 'garcom' || restauranteConfig?.perm_garcom_print === true);
  const allUnpaidItems = orders.flatMap(o => (o.itens || []).filter((item: any) => !item.pago));
  const readyCount = allUnpaidItems.filter(item => item.status === 'pronto').length;
  const preparingCount = allUnpaidItems.filter(item => item.status === 'preparando').length;
  const activeItemCountByCheck = new Map<string, number>();
  const hasPaymentByCheck = new Map<string, boolean>();
  orders.forEach((o) => {
    const checkKey = String(o.checkId || o.id || '');
    const activeInLot = (o.itens || []).filter((it: any) => it.status !== 'cancelado').length;
    activeItemCountByCheck.set(checkKey, (activeItemCountByCheck.get(checkKey) || 0) + activeInLot);
    if (Number(o.valorPago || 0) > 0 || (o.itens || []).some((it: any) => Boolean(it.pago))) {
      hasPaymentByCheck.set(checkKey, true);
    }
  });

  return (
    <div className="kw-consumption p-3 sm:p-5 space-y-4 sm:space-y-6">
      {onToggleReadyOnly && <div className="flex min-h-11 items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{readyOnly ? 'Prontos para servir' : 'Todos os itens'}</h3>
        <button id="toggle-ready-consumption" type="button" onClick={onToggleReadyOnly} className="min-h-[44px] rounded-xl px-3 text-xs font-semibold text-koma-foreground bg-koma-raised">
          {readyOnly ? 'Ver todos' : 'Só prontos'}
        </button>
      </div>}
      {readyOnly && readyCount === 0 && <p role="status" className="text-sm text-koma-muted py-4">Nenhum item pronto no momento.</p>}
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
          {!readyOnly && <div className="kw-consumption-summary order-1 lg:order-2 lg:col-span-5 p-3.5 sm:p-5 flex flex-col justify-between space-y-3">
            <div className="space-y-3">
              {/* Origin & Transfer Badges */}
              {(() => {
                const transferOrigin = orders.find(o => o.mesaTransferidaDe)?.mesaTransferidaDe;
                const mergedOrigins = Array.from(new Set(orders.map(o => o.mesaOrigemId).filter((id): id is number => id !== null && id !== undefined && id !== table.id)));
                if (transferOrigin || mergedOrigins.length > 0) {
                  return (
                    <div className="flex flex-wrap gap-1.5 pb-0.5">
                      {transferOrigin && (
                        <span className="px-2 py-0.5 text-[9px] bg-purple-500/20 text-purple-800 dark:text-purple-300 border border-purple-500/35 rounded-md font-sans font-bold uppercase tracking-wider">
                          Transf. da Mesa {transferOrigin}
                        </span>
                      )}
                      {mergedOrigins.map(mId => (
                        <span key={mId} className="px-2 py-0.5 text-[9px] bg-indigo-500/20 text-indigo-800 dark:text-indigo-300 border border-indigo-500/35 rounded-md font-sans font-bold uppercase tracking-wider">
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
                if (activeRole === 'garcom') return (
                  <div className="kw-consumption-total kw-consumption-total--compact">
                    <div><span className="text-xs text-koma-muted">Total da mesa</span><strong className="text-xl font-mono text-emerald-400 whitespace-nowrap">R$ {amount(grandTotal)}</strong></div>
                    {hasTax && <div className="kw-consumption-tax text-koma-muted"><span>Itens R$ {amount(totalValue)}</span><span>Serviço {taxRate}% · R$ {amount(taxVal)}</span></div>}
                  </div>
                );
                return (
                  <div className="kw-consumption-total p-3.5 space-y-2">
                    <div className="flex justify-between items-center font-sans">
                      <div>
                        <span className="text-[10px] text-koma-subtle font-bold uppercase tracking-wider block">Total Geral:</span>
                        <span className="text-xl sm:text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400">
                          R$ {amount(grandTotal)}
                        </span>
                      </div>
                      <div className="text-right text-xs font-sans text-koma-subtle space-y-0.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-bold uppercase tracking-wider text-[10px]">Subtotal:</span>
                          <span className="font-mono font-medium text-koma-foreground">R$ {amount(totalValue)}</span>
                        </div>
                        {hasTax && (
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="font-bold uppercase tracking-wider text-[10px]">Taxa de Serviço ({taxRate}%):</span>
                            <span className="font-mono font-medium">R$ {amount(taxVal)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Direct Print Feedback Toast */}
              {activeRole !== 'garcom' && hasPrinting && directPrintToast && (
                <div className="bg-emerald-500/20 border border-emerald-500/40 text-emerald-800 dark:text-emerald-300 px-3 py-1.5 rounded-xl text-center text-xs font-bold font-sans animate-fade-in">
                  {directPrintToast}
                </div>
              )}

              {/* Action Row 1: impressão só existe quando o plano possui essa capacidade */}
              {hasPrinting && activeRole !== 'garcom' && <MesaPrintActions
                isPrintingDirect={isPrintingDirect} onPrintValues={onPrintValues} onPrintPreview={onPrintPreview}
              />}

              {/* Action Row 2: Adicionar Itens e encerramento da Mesa (Dinâmico sem buracos vazios) */}
              {(() => {
                const canCloseTable = Boolean(onCloseTable && !(activeRole === 'garcom' && !restauranteConfig?.perm_garcom_fechar));
                return (
                  <div className={canCloseTable && (activeRole !== 'garcom' || restauranteConfig?.perm_garcom_editar) ? "grid grid-cols-2 gap-2" : "w-full"}>
                    {(activeRole !== 'garcom' || restauranteConfig?.perm_garcom_editar) && <button
                      type="button"
                      onClick={() => setActiveTab('lancamento')}
                      className="min-h-[42px] w-full py-2.5 px-2 bg-koma-raised hover:bg-koma-card border border-koma-border hover:border-emerald-500/30 text-koma-foreground rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-xs"
                    >
                      <PlusCircle size={14} className="text-emerald-400 shrink-0" />
                      <span>Adicionar Itens</span>
                    </button>}

                    {canCloseTable && (
                      <button
                        id="close-table-btn-consumo"
                        onClick={onCloseTable}
                        className={`min-h-[42px] py-2.5 px-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer font-sans transition-all border shadow-xs ${
                          confirmClear
                            ? 'bg-rose-50 dark:bg-rose-800/40 border-rose-300 dark:border-rose-700/50 text-rose-800 dark:text-rose-300 animate-pulse'
                            : 'bg-koma-raised hover:bg-rose-950/30 border-koma-border hover:border-rose-800/40 text-rose-400'
                        }`}
                      >
                        <CheckCircle2 size={13} className="shrink-0" />
                        <span>{confirmClear ? 'Confirmar encerramento?' : 'Fechar Mesa'}</span>
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Transfer / Merge Quick Actions */}
              {activeRole !== 'garcom' && <div className="flex items-center gap-2 pt-0.5">
                {(canTransferTables || canTransferItems) && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('transferir');
                      setTransferType(canTransferTables ? 'total' : 'parcial');
                    }}
                    className="min-h-[34px] flex-1 py-1.5 bg-koma-card hover:bg-koma-raised border border-koma-border hover:border-koma-border-strong text-koma-subtle hover:text-koma-foreground rounded-xl font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all cursor-pointer uppercase font-sans shadow-xs active:scale-95"
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
                    className="min-h-[34px] flex-1 py-1.5 bg-koma-card hover:bg-koma-raised border border-koma-border hover:border-koma-border-strong text-koma-subtle hover:text-koma-foreground rounded-xl font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all cursor-pointer uppercase font-sans shadow-xs active:scale-95"
                  >
                    <GitMerge size={11} className="text-emerald-400" />
                    <span>Mesclar</span>
                  </button>
                )}
              </div>}

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
                        <span className="font-bold text-koma-foreground truncate max-w-[140px]">{activeRole === 'garcom' && cust.name.trim().toLocaleLowerCase('pt-BR') === 'consumo geral' ? 'Mesa' : cust.name}</span>
                        <span className="font-mono font-bold text-emerald-400">R$ {amount(cust.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          }
          {/* 2. HISTÓRICO DE PEDIDOS LANÇADOS (NA COZINHA / PRONTO / ENTREGUE) */}
          <div className={`order-2 lg:order-1 ${readyOnly ? 'lg:col-span-12' : 'lg:col-span-7'} space-y-3`}>
            {!readyOnly && <div className="flex flex-wrap items-center justify-between border-b border-koma-border pb-2.5 gap-2">
              <div className="flex items-center gap-2">
                <h3 className="font-serif font-bold text-koma-foreground text-sm sm:text-base">{activeRole === 'garcom' ? 'Pedidos' : 'Comanda de Pedidos'}</h3>
                <span className={activeRole === 'garcom' ? 'text-[10px] text-koma-muted font-sans' : 'text-[10px] font-semibold text-koma-subtle uppercase tracking-wider font-sans bg-koma-panel border border-koma-border/80 px-2 py-0.5 rounded-md'}>
                  {activeRole === 'garcom' ? `${orders.length} ${orders.length === 1 ? 'pedido' : 'pedidos'}` : `Lotes: ${orders.length}`}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {readyCount > 0 && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-bold bg-emerald-500/15 text-emerald-400 rounded-md border border-emerald-500/30 animate-pulse uppercase tracking-wider">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {readyCount} {readyCount === 1 ? 'Pronto' : 'Prontos'}
                  </span>
                )}
                {preparingCount > 0 && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-bold bg-rose-500/15 text-rose-300 rounded-md border border-rose-500/30 uppercase tracking-wider">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
                    {preparingCount} na cozinha
                  </span>
                )}
              </div>
            </div>

            }
            <div className="space-y-3 sm:max-h-[45vh] sm:overflow-y-auto max-h-none overflow-y-visible pr-1 scrollbar-thin">
              {orders.map((order) => {
                const orderState = deriveOrderOperationalState(order, currentTime);
                const launchKey = orderState.lancamentoId || orderState.checkId;
                const unpaidItems = order.itens.filter((item: any) => !item.pago && (!readyOnly || item.status === 'pronto'));
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
                      <span className="text-xs font-bold text-koma-foreground font-sans">{activeRole === 'garcom' ? orderState.displayNumber ? `Pedido ${orderState.displayNumber}` : 'Pedido sem número' : `Lote #${orderState.displayNumber || launchKey.slice(-4)}`}</span>
                      <span className={activeRole === 'garcom' ? 'text-[10px] text-koma-muted font-sans' : 'text-[10px] bg-koma-panel text-koma-muted px-2 py-0.5 rounded font-bold font-sans'}>
                        {activeRole === 'garcom' ? order.garcomNome : `Garçom: ${order.garcomNome}`}
                      </span>
                      {order.tipo && (activeRole !== 'garcom' || order.tipo.trim().toLocaleLowerCase('pt-BR') !== 'consumo no local') && (
                        <span className={`text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                          order.tipo === 'Retirada'
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
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
                              : 'bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 dark:hover:bg-purple-900/30 text-purple-800 dark:text-purple-300 hover:text-koma-foreground border border-purple-300 dark:border-purple-900/40 cursor-pointer'
                          }`}
                          title="Desmembrar este pedido de volta para sua mesa de origem"
                        >
                          <span>Desmembrar</span>
                        </button>
                      )}

                      {hasPrinting && (
                        <button
                          type="button"
                          onClick={() => setSelectedOrderToPrint(order)}
                          className="px-2 py-0.5 bg-koma-raised hover:bg-emerald-500/15 text-koma-muted hover:text-koma-foreground border border-koma-border hover:border-emerald-500/30 rounded-lg text-[10px] font-sans font-semibold transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                          title="Reimprimir este lote de pedidos"
                        >
                          <Printer size={11} className="text-emerald-700 dark:text-emerald-400" />
                          <span>Reimprimir</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Order Items */}
                  <div className="p-3 divide-y divide-koma-border">
                    {unpaidItems.map((item) => {
                      const repeatPlan = onRepeatItem
                        ? planWaiterRepeat(item, repeatProductMap.get(item.produtoId), cardapio_ativo_id, cardapios_ativos_ids)
                        : null;
                      return (
                      <div
                        key={item.id}
                        id={`placed-item-${item.id}`}
                        className="kw-consumption-item py-2.5 flex justify-between items-start gap-3 text-xs first:pt-0 last:pb-0 font-sans"
                      >
                        <div className="space-y-1 flex-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="font-bold text-koma-foreground">{item.nome}</span>
                            {item.clienteNome && (activeRole !== 'garcom' || item.clienteNome.trim().toLocaleLowerCase('pt-BR') !== 'consumo geral') && (
                              <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded border border-emerald-500/30 uppercase tracking-wider">
                                Para: {item.clienteNome}
                              </span>
                            )}
                          </div>

                          {!item.composicao_agrupada && (item.modificadores || []).length > 0 && (
                            <div
                              id={`placed-item-modifiers-${item.id}`}
                              data-testid={`placed-item-modifiers-${item.id}`}
                              className="flex flex-wrap gap-1"
                              aria-label={`Adicionais de ${item.nome}`}
                            >
                              {summarizeItemModifiers(item.modificadores || []).map(({ modifier, quantity }) => (
                                <span
                                  key={modifier.id}
                                  className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400"
                                >
                                  + {quantity > 1 ? `${quantity}x ` : ''}{modifier.nome}
                                </span>
                              ))}
                            </div>
                          )}

                          {item.composicao_agrupada ? <OrderItemComposition item={item} className="text-koma-subtle" /> : item.observacao ? (
                            <p className="text-[11px] text-koma-subtle italic bg-koma-panel px-2 py-0.5 rounded border border-dashed border-koma-border inline-block">
                              Obs: "{item.observacao}"
                            </p>
                          ) : null}

                          {!readyOnly && (activeRole !== 'garcom' || restauranteConfig?.perm_garcom_cancelar) && (() => {
                            const checkKey = String(order.checkId || order.id || '');
                            const isLastActiveItemOnCheck = (activeItemCountByCheck.get(checkKey) || 0) <= 1;
                            const checkHasPayment = Boolean(hasPaymentByCheck.get(checkKey));
                            const restrictionNote = checkHasPayment
                              ? 'Comanda com pagamento: solicite estorno ou cancelamento no Caixa.'
                              : isLastActiveItemOnCheck
                                ? 'Último item ativo da comanda: solicite o cancelamento do pedido no Caixa.'
                                : null;
                            if (!restrictionNote) return null;
                            return (
                              <p
                                id={`cancel-restriction-note-${item.id}`}
                                data-testid={`cancel-restriction-note-${item.id}`}
                                className="text-[10px] text-amber-400/90 font-medium leading-snug"
                              >
                                {restrictionNote}
                              </p>
                            );
                          })()}
                        </div>

                        <div className="kw-consumption-actions flex items-center gap-2 shrink-0">
                          <div className="kw-consumption-state contents">
                          {!readyOnly && <span className="font-mono font-bold text-koma-foreground text-xs sm:text-sm">R$ {amount((item.preco ?? 0))}</span>}

                          {item.status === 'preparando' && (
                            <span className="px-2 py-0.5 text-[9px] font-bold bg-rose-500/15 border border-rose-500/30 text-rose-300 rounded-md flex items-center gap-1 uppercase tracking-wider">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
                              Na Cozinha
                            </span>
                          )}

                          {item.status === 'pronto' && (
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 text-[9px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 rounded-md border border-emerald-500/30 flex items-center gap-1 animate-pulse uppercase tracking-wider">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                Pronto!
                              </span>
                              <button
                                id={`deliver-item-btn-${item.id}`}
                                onClick={() => onDeliverItem?.(order.id, item.id)}
                                className="min-h-[32px] px-3 py-1 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-zinc-950 rounded-lg text-xs font-black uppercase tracking-wider transition-all shadow-xs cursor-pointer flex items-center justify-center"
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

                          </div>
                          {!readyOnly && <div className="kw-consumption-tools contents">
                          {onRepeatItem && (
                            <button type="button" id={`repeat-item-btn-${item.id}`} className="kw-repeat-item"
                              disabled={isSubmitting || !repeatCatalogReady || repeatPlan?.kind === 'unavailable'}
                              aria-label={`Pedir novamente ${item.nome}`}
                              title={!repeatCatalogReady ? 'Carregando cardápio' : repeatPlan?.kind === 'unavailable' ? repeatPlan.reason : 'Adicionar uma unidade ao rascunho'}
                              onClick={() => onRepeatItem(item)}><Plus size={14} aria-hidden="true" /> Pedir mais</button>
                          )}

                          <div className="kw-consumption-edit flex items-center gap-1 border-l border-koma-border pl-1.5 ml-1">
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
                                aria-label={`Editar observação de ${item.nome}`}
                              >
                                <Edit3 size={11} />
                              </button>
                            )}

                            {((activeRole !== 'garcom' || restauranteConfig?.perm_garcom_cancelar)) && (() => {
                              const checkKey = String(order.checkId || order.id || '');
                              const isLastActiveItemOnCheck = (activeItemCountByCheck.get(checkKey) || 0) <= 1;
                              const checkHasPayment = Boolean(hasPaymentByCheck.get(checkKey));
                              const cancelRestrictionReason = checkHasPayment
                                ? 'Há pagamento registrado nesta comanda. Solicite o cancelamento ou estorno no Caixa.'
                                : isLastActiveItemOnCheck
                                  ? 'Último item ativo da comanda — solicite o cancelamento do pedido ou liberação da mesa no Caixa.'
                                  : null;

                              if (cancelRestrictionReason) {
                                return (
                                  <button
                                    type="button"
                                    id={`cancel-item-btn-${item.id}`}
                                    disabled
                                    aria-disabled="true"
                                    className="p-1 text-koma-muted/40 cursor-not-allowed"
                                    title={cancelRestrictionReason}
                                    aria-label={`Cancelamento bloqueado para ${item.nome}: ${cancelRestrictionReason}`}
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                );
                              }

                              return (
                                <button
                                  type="button"
                                  id={`cancel-item-btn-${item.id}`}
                                  onClick={() => {
                                    if (confirm(`Tem certeza que deseja cancelar "${item.nome}"?`)) {
                                      onCancelItem(item.id);
                                    }
                                  }}
                                  className="p-1 text-koma-subtle hover:text-red-400 transition-colors cursor-pointer"
                                  title="Cancelar este item"
                                  aria-label={`Cancelar ${item.nome}`}
                                >
                                  <Trash2 size={11} />
                                </button>
                              );
                            })()}
                          </div>
                          </div>}
                        </div>
                      </div>
                    ); })}
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
