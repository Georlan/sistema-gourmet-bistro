/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Move, GitMerge, AlertTriangle } from 'lucide-react';
import type { Order, Table } from '../../types';

interface MesaTransferMergePanelProps {
  activeTab: 'consumo' | 'lancamento' | 'transferir' | 'mesclar';
  table: Table;
  orders: Order[];
  allOrders: Order[];
  salonTables?: Table[];
  originIds: number[];
  canTransferTables: boolean;
  canTransferItems: boolean;
  transferType: 'total' | 'parcial' | 'mesclar';
  selectedItemsForTransfer: string[];
  confirmTransferTo: number | null;
  setTransferType: React.Dispatch<React.SetStateAction<'total' | 'parcial' | 'mesclar'>>;
  setSelectedItemsForTransfer: React.Dispatch<React.SetStateAction<string[]>>;
  setConfirmTransferTo: React.Dispatch<React.SetStateAction<number | null>>;
  onTransferTable: (targetTableId: number) => void;
  onTransferItems: (itemIds: string[], targetTableId: number) => void;
  onMergeTables?: (sourceTableId: number, targetTableId: number) => void;
}

/** Both movement tabs share selection and confirmation state held by the modal. */
export function MesaTransferMergePanel({
  activeTab, table, orders, allOrders, salonTables, originIds, canTransferTables, canTransferItems,
  transferType, selectedItemsForTransfer, confirmTransferTo,
  setTransferType, setSelectedItemsForTransfer, setConfirmTransferTo,
  onTransferTable, onTransferItems, onMergeTables,
}: MesaTransferMergePanelProps) {
  const tablesList = salonTables || [];
  const availableTablesForTransfer = tablesList.filter(t => t.id !== table.id);
  const tablesWithOrders = tablesList.filter(t => t.id !== table.id && allOrders.some(o => o.mesaId === t.id));
  const tablesWithoutOrders = tablesList.filter(t => t.id !== table.id && !allOrders.some(o => o.mesaId === t.id));

  return (
    <>
      {/* TAB 3: TRANSFERIR MESA */}
      {activeTab === 'transferir' && (
        <div className="space-y-6 max-w-2xl mx-auto py-4">
          <div className="text-center space-y-2">
            <div className="p-3 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 rounded-full inline-block border border-emerald-500/30">
              <Move size={24} />
            </div>
            <h3 className="font-serif text-xl font-bold text-koma-foreground">Transferência de Mesa</h3>
            <p className="text-xs text-koma-subtle font-sans">
              Selecione o tipo de transferência e a mesa de destino abaixo.
            </p>
          </div>

          {/* Selector for transfer type */}
          <div className="flex bg-koma-panel p-1 border border-koma-border rounded-xl font-sans text-xs">
            {canTransferTables && (
            <button
              type="button"
              onClick={() => {
                setTransferType('total');
                setSelectedItemsForTransfer([]);
              }}
              className={`flex-1 py-2 rounded-lg font-bold transition-all cursor-pointer ${
                transferType === 'total' ? 'bg-rose-900/40 border border-rose-800/50 text-koma-foreground shadow-lg' : 'text-koma-subtle hover:text-koma-foreground'
              }`}
            >
              Mesa Inteira
            </button>
            )}
            {canTransferItems && (
            <button
              type="button"
              onClick={() => setTransferType('parcial')}
              className={`flex-1 py-2 rounded-lg font-bold transition-all cursor-pointer ${
                transferType === 'parcial' ? 'bg-rose-900/40 border border-rose-800/50 text-koma-foreground shadow-lg' : 'text-koma-subtle hover:text-koma-foreground'
              }`}
            >
              Selecionar Itens
            </button>
            )}
          </div>

          {/* If partial, show items checklist */}
          {transferType === 'parcial' && (
            <div className="space-y-2 bg-koma-panel/50 border border-koma-border rounded-2xl p-4 max-h-48 overflow-y-auto">
              <span className="text-[10px] text-koma-subtle block font-bold uppercase tracking-wider mb-2">Selecione os itens para transferir:</span>
              {orders.flatMap(o => o.itens).length === 0 ? (
                <span className="text-xs text-koma-subtle italic">Não há itens lançados para transferir.</span>
              ) : (
                orders.flatMap(o => o.itens).map(item => {
                  const isChecked = selectedItemsForTransfer.includes(item.id);
                  return (
                    <label
                      key={item.id}
                      className="flex items-center justify-between p-2 rounded-lg border border-koma-border hover:bg-koma-raised/50 transition-all cursor-pointer text-xs"
                    >
                      <div className="flex items-center gap-2.5 text-koma-foreground">
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
                          className="rounded border-koma-border text-rose-400 focus:ring-rose-500 h-3.5 w-3.5 bg-koma-input"
                        />
                        <span>{item.nome}</span>
                        {item.clienteNome && <span className="text-[9px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1 rounded">Para: {item.clienteNome}</span>}
                      </div>
                      <span className="font-mono text-koma-subtle">R$ {(item.preco ?? 0).toFixed(2)}</span>
                    </label>
                  );
                })
              )}
            </div>
          )}

          {/* Target tables grid */}
          <div className="space-y-2">
            <span className="text-[10px] text-koma-subtle block font-bold uppercase tracking-wider text-center">Mesa de Destino:</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-1">
              {availableTablesForTransfer.length === 0 ? (
                <div className="col-span-full py-8 text-center text-koma-subtle text-sm italic font-sans">
                  Nenhuma mesa disponível no momento.
                </div>
              ) : (
                availableTablesForTransfer.map((t) => {
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
                          ? 'bg-koma-panel/40 border-koma-border/40 text-gray-600 cursor-not-allowed'
                          : isConfirming
                            ? 'bg-amber-500/20 border border-amber-500/40 animate-pulse text-amber-300 cursor-pointer hover:scale-102 font-bold'
                            : 'bg-koma-panel hover:bg-emerald-500/15 border border-koma-border hover:border-emerald-500/40 text-koma-foreground cursor-pointer hover:scale-102'
                      }`}
                    >
                      <span className={`text-base font-bold ${hasSelected ? 'text-koma-foreground group-hover:text-emerald-700 dark:text-emerald-400' : 'text-gray-600'}`}>
                        {isConfirming ? 'Confirmar?' : `Mesa ${t.id}`}
                      </span>
                      {isConfirming && (
                        <span className="text-[9px] text-koma-muted font-sans">Toque para confirmar</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: MESCLAR MESA */}
      {activeTab === 'mesclar' && (
        <div className="space-y-6 max-w-2xl mx-auto py-4">
          <div className="text-center space-y-2">
            <div className="p-3 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 rounded-full inline-block border border-emerald-500/30">
              <GitMerge size={24} />
            </div>
            <h3 className="font-serif text-xl font-bold text-koma-foreground">Mesclar Mesa {table.id} com outra</h3>
            <p className="text-xs text-koma-subtle font-sans">
              Todo o consumo desta mesa será incorporado à mesa de destino. A mesa origem ficará livre.
            </p>
          </div>

          {/* Info banner ou bloqueio por limite de mesclagem */}
          {originIds.length > 0 ? (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 text-xs text-rose-600 dark:text-rose-300 font-sans flex items-start gap-2 max-w-md mx-auto">
              <span className="text-sm shrink-0">🚫</span>
              <div>
                <strong className="block text-rose-400 font-bold mb-0.5">Limite de Mesclagem Excedido</strong>
                <span>Esta mesa já possui consumo mesclado da <strong>Mesa {originIds.join(', ')}</strong>. O limite máximo é de 2 mesas mescladas juntas.</span>
              </div>
            </div>
          ) : (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3.5 text-xs text-amber-600 dark:text-amber-300 font-sans flex items-start gap-2">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>A mesclagem une as comandas. Use a aba <strong>Transferência → Selecionar Itens</strong> se quiser mover itens específicos sem mesclar a conta.</span>
            </div>
          )}

          {originIds.length === 0 && (
            <>
              {/* Occupied tables (recommended for merge) */}
              <div className="space-y-2">
                <span className="text-[10px] text-koma-subtle block font-bold uppercase tracking-wider text-center">Mesa Destino — Mesas Ocupadas:</span>
                {tablesWithOrders.length === 0 ? (
                  <div className="py-6 text-center text-koma-subtle text-sm italic font-sans bg-koma-panel/40 rounded-2xl border border-koma-border/40">
                    Nenhuma outra mesa está ocupada no momento.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-1">
                    {tablesWithOrders.map((t) => {
                      const isConfirming = confirmTransferTo === t.id;
                      const isTargetAlreadyMerged = allOrders?.some(o => o.mesaId === t.id && o.mesaOrigemId !== null && o.mesaOrigemId !== t.id);

                      return (
                        <button
                          key={t.id}
                          type="button"
                          id={`merge-target-mesa-${t.id}`}
                          disabled={isTargetAlreadyMerged}
                          onClick={() => {
                            if (isConfirming) {
                              if (onMergeTables) onMergeTables(table.id, t.id);
                              setConfirmTransferTo(null);
                            } else {
                              setConfirmTransferTo(t.id);
                            }
                          }}
                          onMouseLeave={() => { if (isConfirming) setConfirmTransferTo(null); }}
                          className={`p-4 border rounded-2xl text-center transition-all flex flex-col items-center justify-center gap-1 group ${
                            isTargetAlreadyMerged
                              ? 'bg-koma-panel border-koma-border text-koma-muted cursor-not-allowed opacity-40'
                              : isConfirming
                                ? 'bg-rose-900/40 border border-rose-800/50 animate-pulse text-koma-foreground cursor-pointer'
                                : 'bg-koma-raised hover:bg-emerald-500/10 border border-rose-500/30 hover:border-emerald-500 text-koma-foreground cursor-pointer hover:scale-102'
                          }`}
                        >
                          <span className={`text-base font-bold text-koma-foreground ${!isTargetAlreadyMerged && 'group-hover:text-emerald-400'}`}>
                            {isConfirming ? 'Confirmar?' : `Mesa ${t.id}`}
                          </span>
                          {isTargetAlreadyMerged ? (
                            <span className="text-[8px] text-koma-muted font-bold uppercase tracking-wider">Limite Atingido</span>
                          ) : !isConfirming ? (
                            <span className="text-[8px] text-rose-400 font-bold uppercase tracking-wider">Ocupada</span>
                          ) : (
                            <span className="text-[9px] text-koma-muted font-sans">Toque para confirmar</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Empty tables (less common for merge, but allowed) */}
              {tablesWithoutOrders.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[10px] text-koma-subtle block font-bold uppercase tracking-wider text-center">Mesas Livres (mesclar criará consumo nelas):</span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-1">
                    {tablesWithoutOrders.map((t) => {
                      const isConfirming = confirmTransferTo === t.id;
                      const isTargetAlreadyMerged = allOrders?.some(o => o.mesaId === t.id && o.mesaOrigemId !== null && o.mesaOrigemId !== t.id);

                      return (
                        <button
                          key={t.id}
                          type="button"
                          id={`merge-target-mesa-free-${t.id}`}
                          disabled={isTargetAlreadyMerged}
                          onClick={() => {
                            if (isConfirming) {
                              if (onMergeTables) onMergeTables(table.id, t.id);
                              setConfirmTransferTo(null);
                            } else {
                              setConfirmTransferTo(t.id);
                            }
                          }}
                          onMouseLeave={() => { if (isConfirming) setConfirmTransferTo(null); }}
                          className={`p-4 border rounded-2xl text-center transition-all flex flex-col items-center justify-center gap-1 group opacity-60 ${
                            isTargetAlreadyMerged
                              ? 'bg-koma-panel border-koma-border text-koma-muted cursor-not-allowed opacity-40'
                              : isConfirming
                                ? 'bg-rose-900/40 border border-rose-800/50 animate-pulse text-koma-foreground opacity-100 cursor-pointer'
                                : 'bg-koma-raised hover:bg-emerald-500/10 border border-koma-border hover:border-emerald-500 text-koma-foreground hover:opacity-100 cursor-pointer'
                          }`}
                        >
                          <span className="text-base font-bold text-koma-foreground group-hover:text-emerald-400">
                            {isConfirming ? 'Confirmar?' : `Mesa ${t.id}`}
                          </span>
                          {isTargetAlreadyMerged ? (
                            <span className="text-[8px] text-koma-muted font-bold uppercase tracking-wider">Limite Atingido</span>
                          ) : !isConfirming ? (
                            <span className="text-[8px] text-emerald-400 font-bold uppercase tracking-wider">Livre</span>
                          ) : (
                            <span className="text-[9px] text-koma-muted font-sans">Toque para confirmar</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
