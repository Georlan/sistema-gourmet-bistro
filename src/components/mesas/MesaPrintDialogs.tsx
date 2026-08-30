/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { X, Printer } from 'lucide-react';
import type { Order, Table } from '../../types';
import { getOrderDisplayNumber } from '../../domain/orderIdentity';
import { formatBackendDateTime } from '../../utils/dateTime';

interface MesaPrintDialogsProps {
  table: Table;
  orders: Order[];
  restaurantName: string;
  activeWaiterNome: string;
  restauranteConfig?: { taxa_servico_ativa?: boolean; taxa_servico_padrao?: number };
  showPrintPreview: boolean;
  selectedOrderToPrint: Order | null;
  printSuccess: boolean;
  setShowPrintPreview: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedOrderToPrint: React.Dispatch<React.SetStateAction<Order | null>>;
  onPrintReceipt?: (apenasValores?: boolean) => void | Promise<void>;
  onPrintKitchenLaunch?: (launchId: string) => void | Promise<void>;
}

/** Receipt and kitchen views keep their distinct grouping and server-backed actions. */
export function MesaPrintDialogs({
  table, orders, restaurantName, activeWaiterNome, restauranteConfig,
  showPrintPreview, selectedOrderToPrint, printSuccess, setShowPrintPreview, setSelectedOrderToPrint,
  onPrintReceipt, onPrintKitchenLaunch,
}: MesaPrintDialogsProps) {
  return (
    <>
      {/* EMBEDDED PRINT PREVIEW (RECEIPT) POPUP MODAL */}
      {showPrintPreview && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowPrintPreview(false);
            }
          }}
          className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50 animate-fade-in cursor-pointer"
        >
          <div className="bg-koma-panel border border-koma-border rounded-3xl shadow-2xl max-w-sm w-full p-6 space-y-4 max-h-[85vh] flex flex-col justify-between">

            {/* Invoice Header */}
            <div className="space-y-2 pb-3 border-b border-koma-border">
              <div className="flex justify-between items-center font-sans">
                <span className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider">Extrato de Mesa</span>
                <button
                  id="close-print-preview-btn"
                  onClick={() => setShowPrintPreview(false)}
                  className="p-1 hover:bg-koma-raised border border-transparent hover:border-koma-border rounded-full transition-colors text-koma-subtle hover:text-koma-foreground cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* RECEIPT GRAPHICS */}
            <div className="flex-1 overflow-y-auto bg-koma-page border border-koma-border rounded-2xl p-5 font-mono text-[11px] text-koma-muted space-y-4 shadow-inner max-h-[50vh] scrollbar-thin">
              <div className="text-center space-y-1 border-b border-dashed border-koma-border pb-3">
                <p className="font-serif font-bold text-base text-koma-foreground tracking-tight">{restaurantName.toUpperCase()}</p>
                <p className="text-[9px] text-emerald-700 dark:text-emerald-400 leading-normal font-sans">Conferência de Mesa</p>
              </div>

              <div className="space-y-1 border-b border-dashed border-koma-border pb-3">
                <p><strong>DATA:</strong> {new Date().toLocaleDateString('pt-BR')} {new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}</p>
                <p><strong>MESA:</strong> #{table.id}</p>
                <p><strong>ATENDIMENTO:</strong> {activeWaiterNome}</p>
              </div>

              {/* Items List */}
              <div className="space-y-2 border-b border-dashed border-koma-border pb-3">
                <div className="flex justify-between font-bold text-[9px] text-koma-subtle uppercase font-sans tracking-wider pb-1">
                  <span>ITEM</span>
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
                            <span className="font-bold">R$ {((item.preco ?? 0) * (item.quantidade ?? 1)).toFixed(2)}</span>
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
                            <div key={client} className="space-y-1 border-t border-dashed border-koma-border pt-2 first:border-0 first:pt-0">
                              <span className="font-bold text-[10px] text-emerald-700 dark:text-emerald-400 uppercase font-sans tracking-wider block">
                                Cliente: {client}
                              </span>
                              {Object.values(clientGrouped).map((item, idx) => (
                                <div key={idx} className="flex justify-between pl-2">
                                  <span>{item.quantidade}x {item.nome}</span>
                                  <span className="font-bold">R$ {((item.preco ?? 0) * (item.quantidade ?? 1)).toFixed(2)}</span>
                                </div>
                              ))}
                              <div className="text-right text-[10px] font-bold text-koma-subtle pr-1 pt-0.5">
                                Subtotal {client}: R$ {clientItems.reduce((s, i) => s + (i.preco ?? 0), 0).toFixed(2)}
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
                    <div className="space-y-1 text-right text-[10px] text-koma-subtle font-sans">
                      <div className="flex justify-between">
                        <span>Subtotal Consumo:</span>
                        <span className="font-mono">R$ {subTotal.toFixed(2)}</span>
                      </div>
                      {hasTax && (
                        <div className="flex justify-between">
                          <span>Taxa de Serviço ({taxRate}%):</span>
                          <span className="font-mono">R$ {taxVal.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs font-bold text-emerald-700 dark:text-emerald-400 border-t border-dotted border-koma-border pt-2.5 mt-2.5">
                        <span>TOTAL GERAL:</span>
                        <span className="font-mono">R$ {grandTotal.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="text-center pt-3 border-t border-dashed border-koma-border text-[9px] text-koma-subtle font-sans">
                <p>Conferência de mesa</p>
                <p>Não é documento fiscal</p>
              </div>
            </div>

            {/* Print Status Feedback */}
            {printSuccess && (
              <div className="bg-emerald-600/15 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-300 p-2.5 rounded-xl text-center text-[10px] font-bold font-sans uppercase tracking-wider">
                Impressão enviada com sucesso.
              </div>
            )}

            {/* Printing actions are enabled only when the server-backed handler exists. */}
            <div className="flex gap-2 w-full">
              <button
                id="finalize-physical-print-btn"
                disabled={!onPrintReceipt}
                onClick={() => onPrintReceipt?.(false)}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-koma-foreground rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider border border-emerald-500/20 transition-all shadow-lg shadow-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Printer size={13} className="text-koma-foreground" />
                <span>Extrato Completo</span>
              </button>

              <button
                disabled={!onPrintReceipt}
                onClick={() => onPrintReceipt?.(true)}
                className="flex-1 py-3 bg-amber-600 hover:bg-amber-500 text-koma-foreground rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider border border-amber-500/20 transition-all shadow-lg shadow-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Printer size={13} className="text-koma-foreground" />
                <span>Apenas Valores</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REPRINT ORDER MODAL (VIA DE COZINHA) */}
      {selectedOrderToPrint && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedOrderToPrint(null);
            }
          }}
          className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50 animate-fade-in cursor-pointer"
        >
          <div className="bg-koma-panel border border-koma-border rounded-3xl shadow-2xl max-w-sm w-full p-6 space-y-4 max-h-[85vh] flex flex-col justify-between">

            {/* Invoice Header */}
            <div className="space-y-2 pb-3 border-b border-koma-border">
              <div className="flex justify-between items-center font-sans">
                <span className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider">Reimpressão de Lote (Cozinha)</span>
                <button
                  onClick={() => setSelectedOrderToPrint(null)}
                  className="p-1 hover:bg-koma-raised border border-transparent hover:border-koma-border rounded-full transition-colors text-koma-subtle hover:text-koma-foreground cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* RECEIPT GRAPHICS */}
            <div className="flex-1 overflow-y-auto bg-koma-page border border-koma-border rounded-2xl p-5 font-mono text-[11px] text-koma-muted space-y-4 shadow-inner max-h-[50vh] scrollbar-thin">
              <div className="text-center space-y-1 border-b border-dashed border-koma-border pb-3">
                <p className="font-serif font-bold text-base text-koma-foreground tracking-tight">{restaurantName.toUpperCase()}</p>
                <p className="text-[9px] text-rose-400 leading-normal font-sans font-bold">REIMPRESSÃO • VIA COZINHA</p>
              </div>

              <div className="space-y-1 border-b border-dashed border-koma-border pb-3">
                <p><strong>LOTE:</strong> #{getOrderDisplayNumber(selectedOrderToPrint) || (selectedOrderToPrint.lancamentoId || selectedOrderToPrint.id).slice(-4)}</p>
                {selectedOrderToPrint.tipo && <p><strong>TIPO:</strong> {selectedOrderToPrint.tipo.toUpperCase()}</p>}
                <p><strong>DATA:</strong> {formatBackendDateTime(selectedOrderToPrint.timestamp)}</p>
                <p><strong>MESA:</strong> #{table.id}</p>
                <p><strong>ATENDIMENTO:</strong> {selectedOrderToPrint.garcomNome}</p>
              </div>

              {/* Items List */}
              <div className="space-y-2 border-b border-dashed border-koma-border pb-3">
                <div className="flex justify-between font-bold text-[9px] text-koma-subtle uppercase font-sans tracking-wider pb-1">
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
                          <span className="text-koma-subtle">R$ {((item.preco ?? 0) * qty).toFixed(2)}</span>
                        </div>
                        {item.clienteNome && item.clienteNome !== 'Consumo Geral' && (
                          <p className="text-[9px] text-emerald-700 dark:text-emerald-400 uppercase font-bold">Para: {item.clienteNome}</p>
                        )}
                        {item.observacao && (
                          <p className="text-[10px] text-rose-700 dark:text-rose-300 italic pl-2 border-l border-dashed border-rose-300 dark:border-rose-900/50">
                            Obs: "{item.observacao}"
                          </p>
                        )}
                      </div>
                    ));
                  })()}
                </div>
              </div>

              <div className="text-center pt-3 border-t border-dashed border-koma-border text-[9px] text-koma-subtle font-sans">
                <p>Reimpressão de Comanda de Produção</p>
                <p>Controle Interno de Cozinha</p>
              </div>
            </div>

            {/* Print Status Feedback */}
            {printSuccess && (
              <div className="bg-emerald-600/15 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-300 p-2.5 rounded-xl text-center text-[10px] font-bold font-sans uppercase tracking-wider">
                Reimpressão enviada com sucesso!
              </div>
            )}

            {/* Reprint is enabled only when the server-backed handler exists. */}
            <button
              disabled={!onPrintKitchenLaunch || !selectedOrderToPrint}
              onClick={() => onPrintKitchenLaunch?.(selectedOrderToPrint.lancamentoId || selectedOrderToPrint.id)}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-koma-foreground rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider border border-emerald-500/20 transition-all shadow-lg shadow-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Printer size={13} className="text-koma-foreground" />
              <span>Imprimir Via Cozinha</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
