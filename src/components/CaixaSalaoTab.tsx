import React from 'react';
import clsx from 'clsx';
import { Plus, Edit3, Trash2, X } from 'lucide-react';
import { Table, Order } from '../types';

export interface CaixaSalaoTabProps {
  salonTables: Table[];
  orders: Order[];
  pagamentosPendentes: any[];
  setShowAddMesaModal: (val: boolean) => void;
  onUpdateMesa: (id: number, capacidade: number, nome?: string) => Promise<void> | void;
  handleDeleteMesaAction: (id: number) => void;
  handleForceFreeTable: (id: number) => void;
  setSelectedOrder: (order: any) => void;
  setShowCheckoutModal: (val: boolean) => void;
  setCheckoutServiceTax: (val: boolean) => void;
  setSplitPeople: (val: string) => void;
  setSelectedItemIds: (val: string[]) => void;
  setPaymentValor: (val: string) => void;
  serviceTaxRate: number;
  checkoutServiceTax: boolean;
  isLoading: boolean;
}

export const CaixaSalaoTab: React.FC<CaixaSalaoTabProps> = ({
  salonTables,
  orders,
  pagamentosPendentes,
  setShowAddMesaModal,
  onUpdateMesa,
  handleDeleteMesaAction,
  handleForceFreeTable,
  setSelectedOrder,
  setShowCheckoutModal,
  setCheckoutServiceTax,
  setSplitPeople,
  setSelectedItemIds,
  setPaymentValor,
  serviceTaxRate,
  checkoutServiceTax,
  isLoading,
}) => {
  return (
    <div className={clsx('h-full', 'flex', 'flex-col', 'space-y-4')}>
      <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-3', 'rounded-2xl', 'flex', 'justify-between', 'items-center', 'gap-3')}>
        <span className={clsx('font-serif', 'font-bold', 'text-gray-300')}>Estrutura Física do Salão</span>
        <button
          onClick={() => setShowAddMesaModal(true)}
          className={clsx('px-4', 'py-2', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]', 'font-bold', 'rounded-xl', 'flex', 'items-center', 'gap-1.5', 'cursor-pointer', 'text-[10px]', 'uppercase', 'tracking-wider', 'shadow')}
        >
          <Plus size={12} />
          <span>Adicionar Mesa</span>
        </button>
      </div>

      <div className={clsx('flex-1', 'bg-[#121214]/50', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'overflow-y-auto')}>
        <div className={clsx('grid', 'grid-cols-1', 'sm:grid-cols-2', 'md:grid-cols-3', 'lg:grid-cols-4', 'xl:grid-cols-6', 'gap-4')}>
          {salonTables.map((table) => {
            const mergedIntoMesaId = orders.find(o => o.mesaOrigemId === table.id)?.mesaId || null;
            const isMerged = mergedIntoMesaId !== null;
            const displayMesaId = isMerged ? mergedIntoMesaId : table.id;
            const tableOrders = orders.filter(o => o.mesaId === displayMesaId);
            const isOcupada = tableOrders.length > 0;
            const hasPendingPayment = pagamentosPendentes.some(pag =>
              tableOrders.some(o => o.id === pag.comanda_id)
            );

            return (
              <div
                key={table.id}
                className={`bg-[#121214] border rounded-2xl p-3 flex flex-col justify-between gap-3 transition-all relative group ${hasPendingPayment
                  ? 'border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)] animate-pulse'
                  : isMerged
                    ? 'border-dashed border-zinc-700 opacity-60 bg-zinc-950/20'
                    : isOcupada
                      ? 'border-rose-500/40 hover:border-rose-500'
                      : 'border-[#27272A] hover:border-[#10b981]/30'
                  }`}
              >
                <div className={clsx('flex', 'justify-between', 'items-start')}>
                  <div>
                    <span className={clsx('text-[9px]', 'font-bold', 'text-gray-500', 'uppercase', 'tracking-widest', 'block')}>Mesa</span>
                    <strong className={clsx('text-xl', 'font-serif', 'text-white', 'leading-none')}>{table.id}</strong>
                    {table.nome && table.nome !== `Mesa ${table.id}` && (
                      <span className={clsx('text-[9px]', 'text-[#10b981]', 'block', 'mt-0.5')}>{table.nome}</span>
                    )}
                  </div>
                  <div className={clsx('flex', 'gap-1', 'opacity-0', 'group-hover:opacity-100', 'transition-opacity')}>
                    <button
                      onClick={() => {
                        const newName = prompt(`Novo nome/identificação para Mesa ${table.id} (Deixe em branco para padrão):`, table.nome || '');
                        const newCap = prompt(`Nova capacidade (lugares) para Mesa ${table.id}?`, table.capacidade.toString());
                        if (newCap && !isNaN(parseInt(newCap))) {
                          onUpdateMesa(table.id, parseInt(newCap), newName !== null ? (newName.trim() || `Mesa ${table.id}`) : undefined);
                        } else if (newName !== null) {
                          onUpdateMesa(table.id, table.capacidade, newName.trim() || `Mesa ${table.id}`);
                        }
                      }}
                      className={clsx('p-1', 'text-gray-400', 'hover:text-[#10b981]')}
                      title="Editar capacidade"
                    >
                      <Edit3 size={10} />
                    </button>
                    <button
                      onClick={() => handleDeleteMesaAction(table.id)}
                      className={clsx('p-1', 'text-gray-400', 'hover:text-emerald-500')}
                      title="Excluir mesa"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  {hasPendingPayment ? (
                    <span className={clsx('px-2', 'py-0.5', 'text-[8px]', 'bg-amber-500/10', 'text-amber-400', 'font-bold', 'rounded-md', 'block', 'w-fit', 'border', 'border-amber-500/20', 'uppercase', 'tracking-wider animate-pulse')}>Confirmar Dinheiro</span>
                  ) : isMerged ? (
                    <span className={clsx('px-2', 'py-0.5', 'text-[8px]', 'bg-zinc-800', 'text-zinc-400', 'font-bold', 'rounded-md', 'block', 'w-fit', 'border', 'border-zinc-700/30', 'uppercase', 'tracking-wider')}>Mesclada na Mesa {mergedIntoMesaId}</span>
                  ) : isOcupada ? (
                    <span className={clsx('px-2', 'py-0.5', 'text-[8px]', 'bg-rose-500/10', 'text-rose-400', 'font-bold', 'rounded-md', 'block', 'w-fit', 'border', 'border-rose-500/10', 'uppercase', 'tracking-wider')}>Ocupada</span>
                  ) : (
                    <span className={clsx('px-2', 'py-0.5', 'text-[8px]', 'bg-emerald-500/10', 'text-emerald-400', 'rounded-md', 'block', 'w-fit', 'border', 'border-emerald-500/10', 'uppercase', 'tracking-wider')}>Livre</span>
                  )}
                  {(() => {
                    const origemId = tableOrders.find(o => o.mesaOrigemId && Number(o.mesaOrigemId) !== Number(displayMesaId))?.mesaOrigemId;
                    const transfId = tableOrders.find(o => o.mesaTransferidaDe && Number(o.mesaTransferidaDe) !== Number(displayMesaId))?.mesaTransferidaDe;
                    if (origemId) {
                      return (
                        <span className="px-2 py-0.5 text-[8px] bg-emerald-500/10 text-emerald-300 font-bold rounded-md block w-fit border border-emerald-500/20 uppercase tracking-wider animate-pulse-subtle" title={`Consumo mesclado da Mesa ${origemId}`}>
                          🔗 Mesclado de Mesa {origemId}
                        </span>
                      );
                    }
                    if (transfId) {
                      return (
                        <span className="px-2 py-0.5 text-[8px] bg-purple-500/10 text-purple-300 font-bold rounded-md block w-fit border border-purple-500/20 uppercase tracking-wider" title={`Consumo transferido da Mesa ${transfId}`}>
                          🔗 Transferido da Mesa {transfId}
                        </span>
                      );
                    }
                    return null;
                  })()}
                </div>

                {isOcupada && (
                  <div className={clsx('flex', 'gap-1', 'pt-1.5', 'border-t', 'border-[#27272A]')}>
                    <button
                      onClick={() => {
                        const order = tableOrders[0];
                        setSelectedOrder({
                          ...order,
                          itens: order.itens.map((item: any) => ({
                            id: item.id,
                            produtoId: item.produto_id || item.produtoId,
                            nome: item.nome || `Item ${item.produtoId}`,
                            preco: item.preco_unit || item.preco,
                            observacao: item.observacao || '',
                            clienteNome: item.cliente_nome || 'Consumo Geral',
                            status: item.status,
                            pago: item.pago
                          }))
                        });
                        setShowCheckoutModal(true);
                        setCheckoutServiceTax(true);
                        setSplitPeople('1');
                        setSelectedItemIds([]);
                        const sub = order.itens.filter((item: any) => !item.pago).reduce((s: number, it: any) => s + (it.preco_unit || it.preco || 0), 0);
                        setPaymentValor((sub * (1.0 + (checkoutServiceTax ? serviceTaxRate / 100 : 0))).toFixed(2));
                      }}
                      className={clsx('flex-1', 'py-1', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'rounded', 'font-bold', 'text-[8px]', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider')}
                    >
                      Checkout
                    </button>
                    <button
                      onClick={() => handleForceFreeTable(table.id)}
                      className={clsx('p-1', 'bg-emerald-600/20', 'hover:bg-emerald-600', 'text-[#C46A74]', 'hover:text-white', 'rounded', 'transition-colors', 'cursor-pointer')}
                    >
                      <X size={10} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
