import React from 'react';
import clsx from 'clsx';
import { MapPin, CreditCard, Check } from 'lucide-react';
import { Order, SimulatedDeliveryOrder, Motoboy } from '../types';

export interface CaixaKanbanBoardProps {
  localProductionRounds: any[];
  simulatedOrders: SimulatedDeliveryOrder[];
  groupedTableOrdersReady: any[];
  orders: Order[];
  modoExclusivoSalao: boolean;
  plano?: string;
  activeMotoboysList: Motoboy[];
  isLoading: boolean;
  taxaServicoAtiva: boolean;
  serviceTaxRate: number;
  handleProntoItemAction: (itemId: number) => Promise<void> | void;
  handleProntoRoundAction: (roundItens: any[]) => Promise<void> | void;
  handleDespacharPedido: (orderId: string, motoboyId: number) => Promise<void> | void;
  handleUpdateDeliveryStatus: (orderId: string, status: string) => Promise<void> | void;
  handleFinalizarPedido: (orderId: string) => Promise<void> | void;
  setSelectedMotoboys: React.Dispatch<React.SetStateAction<{ [orderId: string]: string }>>;
  setSelectedOrder: (order: any) => void;
  setShowCheckoutModal: (val: boolean) => void;
  setCheckoutServiceTax: (val: boolean) => void;
  setSplitPeople: (val: string) => void;
  setSelectedItemIds: (val: string[]) => void;
  setPaymentValor: (val: string) => void;
  openSimulatedOrderDetails: (order: SimulatedDeliveryOrder) => void;
  setSelectedKanbanOrder: (order: any) => void;
}

export const CaixaKanbanBoard: React.FC<CaixaKanbanBoardProps> = ({
  localProductionRounds,
  simulatedOrders,
  groupedTableOrdersReady,
  orders,
  modoExclusivoSalao,
  plano = 'premium',
  activeMotoboysList,
  isLoading,
  taxaServicoAtiva,
  serviceTaxRate,
  handleProntoItemAction,
  handleProntoRoundAction,
  handleDespacharPedido,
  handleUpdateDeliveryStatus,
  handleFinalizarPedido,
  setSelectedMotoboys,
  setSelectedOrder,
  setShowCheckoutModal,
  setCheckoutServiceTax,
  setSplitPeople,
  setSelectedItemIds,
  setPaymentValor,
  openSimulatedOrderDetails,
  setSelectedKanbanOrder,
}) => {
  const isTwoColumns = modoExclusivoSalao || plano === 'bistro' || plano === 'delivery';
  const includesRetiradaInLocal = modoExclusivoSalao || plano === 'bistro';
  const localSimulatedOrdersInPreparo = includesRetiradaInLocal
    ? simulatedOrders.filter(o => o.status === 'producao' && !o.endereco && !(o.mesaId && o.mesaId > 0))
    : [];
  const totalLocalCount = localProductionRounds.length + localSimulatedOrdersInPreparo.length;

  const checkoutTableOrders = plano === 'delivery' ? [] : groupedTableOrdersReady;
  const checkoutSimulatedOrders = simulatedOrders.filter(o => {
    const isReady = o.status === 'transito' || o.status === 'pronto';
    if (!isReady) return false;
    if (modoExclusivoSalao || plano === 'bistro') {
      return !o.endereco;
    }
    return true;
  });
  const totalCheckoutCount = checkoutTableOrders.length + checkoutSimulatedOrders.length;

  return (
    <div className={clsx(
      'flex-1', 'grid', 'gap-4', 'min-h-0',
      isTwoColumns ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 md:grid-cols-3'
    )}>

      {plano !== 'delivery' && (
        <div className="flex flex-col overflow-hidden rounded-2xl border border-orange-500/20 bg-gradient-to-b from-orange-950/20 to-[#0c0c0e]/80 text-left">
          {/* Column header */}
          <div className="px-4 py-3 border-b border-orange-500/15 flex justify-between items-center shrink-0 bg-orange-950/30">
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_6px_2px_rgba(251,146,60,0.4)]"></div>
              <div>
                <span className="font-bold text-orange-100 text-sm tracking-wide block">Produção Local</span>
                <span className="text-[9px] text-orange-400/60 font-mono">Mesa / Garçom — por rodada</span>
              </div>
            </div>
            <span className={clsx(
              'font-bold px-2.5 py-0.5 rounded-full font-mono text-[10px]',
              totalLocalCount > 0
                ? 'bg-orange-500/20 text-orange-300 animate-pulse'
                : 'bg-orange-500/10 text-orange-500/50'
            )}>
              {totalLocalCount}
            </span>
          </div>

          <div className="p-3 flex-1 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-orange-900/30 scrollbar-track-transparent">
            {totalLocalCount === 0 ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-orange-700/50 space-y-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="opacity-40">
                <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>
              </svg>
              <p className="text-[11px] italic">Nenhuma rodada em preparo</p>
            </div>
          ) : (
            <>
              {localProductionRounds.map((round) => (
                <div
                  key={`prod-round-${round.rodadaId}`}
                  className="group bg-[#15100a] border border-orange-500/20 hover:border-orange-400/50 p-3 rounded-xl space-y-2.5 transition-all duration-200 hover:shadow-[0_0_14px_rgba(251,146,60,0.1)]"
                >
                  {/* Round header */}
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap gap-1 mb-1">
                        <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-black bg-orange-500/15 text-orange-400 rounded-md font-mono border border-orange-500/20">
                          🍽️ {round.mesaId && round.mesaId > 0 ? `Mesa ${round.mesaId}` : 'Balcão'}
                        </span>
                        {round.mesaOrigemId && Number(round.mesaOrigemId) !== Number(round.mesaId) && (
                          <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-black bg-teal-500/10 text-teal-300 rounded-md font-mono border border-teal-500/20">
                            🔗 +M{round.mesaOrigemId}
                          </span>
                        )}
                        <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-black bg-yellow-500/10 text-yellow-400 rounded-md font-mono border border-yellow-500/20 flex items-center gap-1">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse"></span>
                          {round.itens.length} {round.itens.length === 1 ? 'item' : 'itens'}
                        </span>
                      </div>
                      <strong className="text-white text-sm block">{round.identificador || (round.mesaId && round.mesaId > 0 ? `Consumo Mesa ${round.mesaId}` : 'Consumo Balcão')}</strong>
                      <span className="text-[10px] text-gray-500 block mt-0.5">👨‍🍳 {round.garcomNome || 'Garçom'}</span>
                    </div>
                    <span className="text-[9px] text-gray-600 font-mono shrink-0">#{round.rodadaId.slice(-4)}</span>
                  </div>

                  {/* Items list */}
                  <div className="space-y-1.5 pt-1.5 border-t border-orange-500/10">
                    {round.itens.map((item: any, idx: number) => (
                      <div key={`item-${item.itemId || idx}`} className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <span className="text-[11px] text-orange-100 font-semibold block truncate">{item.nome}</span>
                          {item.observacao && (
                            <span className="text-[9px] text-orange-300/60 italic block">📝 {item.observacao}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (isLoading) return;
                            await handleProntoItemAction(item.itemId);
                          }}
                          className="shrink-0 px-2 py-1 bg-orange-600/30 hover:bg-orange-500/50 border border-orange-500/30 text-orange-300 hover:text-white rounded-md font-black text-[8px] transition-all duration-150 cursor-pointer uppercase tracking-wider flex items-center gap-1"
                        >
                          <Check size={9} /> OK
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Mark ALL as ready button */}
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (isLoading) return;
                      await handleProntoRoundAction(round.itens);
                    }}
                    className="w-full py-2 bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 active:scale-95 text-white rounded-lg font-black text-[10px] transition-all duration-150 cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-[0_2px_8px_rgba(251,146,60,0.3)]"
                  >
                    <Check size={12} /> Rodada Pronta
                  </button>
                </div>
              ))}

              {/* If includesRetiradaInLocal is TRUE, show Retirada orders in preparation here */}
              {includesRetiradaInLocal && simulatedOrders
                .filter(o => o.status === 'producao' && !o.endereco && !(o.mesaId && o.mesaId > 0))
                .map((order) => {
                  const btnLabel = '🏪 Retirada Pronta';
                  const btnClass = 'bg-emerald-600 hover:bg-emerald-500 shadow-[0_2px_8px_rgba(16,185,129,0.25)]';

                  return (
                    <div
                      key={`prod-online-${order.id}`}
                      onClick={() => openSimulatedOrderDetails(order)}
                      className="group bg-[#0d1812] border border-emerald-500/15 hover:border-emerald-400/40 p-3.5 rounded-xl space-y-3 transition-all duration-200 cursor-pointer hover:shadow-[0_0_16px_rgba(52,211,153,0.06)]"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap gap-1 mb-1.5">
                            <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-black rounded-md font-mono border bg-violet-500/10 text-violet-400 border-violet-500/20">
                              🏪 Retirada
                            </span>
                            <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-black bg-yellow-500/10 text-yellow-400 rounded-md font-mono border border-yellow-500/20">⏳ Preparando</span>
                          </div>
                          <strong className="text-white text-sm block truncate">{order.cliente}</strong>
                          <span className="text-[10px] text-gray-400 block">{order.telefone}</span>
                        </div>
                        <span className="font-black text-white font-mono text-[13px] shrink-0">R$ {order.total.toFixed(2)}</span>
                      </div>

                      <p className="text-[10px] text-emerald-300/70 bg-black/40 px-2.5 py-2 rounded-lg border border-emerald-500/10 leading-relaxed font-mono">
                        {order.itens}
                      </p>

                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (isLoading) return;
                          await handleUpdateDeliveryStatus(order.id, 'pronto');
                          alert(`Simulação de WhatsApp: Mensagem enviada para ${order.cliente} (${order.telefone}) avisando que o pedido está pronto para retirada!`);
                        }}
                        className={clsx('w-full py-2 active:scale-95 text-white rounded-lg font-black text-[10px] transition-all duration-150 cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5', btnClass)}
                      >
                        {btnLabel}
                      </button>
                    </div>
                  );
                })}
            </>
          )}
        </div>
      </div>
      )}

      {/* ═══════════════════════════════════════
          COLUMN 2: Delivery & Retirada (online em preparo + em rota)
      ═══════════════════════════════════════ */}
      {!(modoExclusivoSalao || plano === 'bistro') && (
        <div className="flex flex-col overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/20 to-[#0c0c0e]/80 text-left">
          {/* Column header */}
          <div className="px-4 py-3 border-b border-emerald-500/15 flex justify-between items-center shrink-0 bg-emerald-950/30">
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.4)]"></div>
              <div>
                <span className="font-bold text-emerald-100 text-sm tracking-wide block">Delivery & Retirada</span>
                <span className="text-[9px] text-emerald-400/60 font-mono">Em Preparo</span>
              </div>
            </div>
            <span className={clsx(
              'font-bold px-2.5 py-0.5 rounded-full font-mono text-[10px]',
              (modoExclusivoSalao ? 0 : simulatedOrders.filter(o => o.status === 'producao').length) > 0
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-emerald-500/10 text-emerald-500/50'
            )}>
              {modoExclusivoSalao ? 0 : simulatedOrders.filter(o => o.status === 'producao').length}
            </span>
          </div>

          <div className="p-3 flex-1 overflow-y-auto space-y-3 scrollbar-thin scrollbar-thumb-emerald-900/30 scrollbar-track-transparent">
            {(modoExclusivoSalao || simulatedOrders.filter(o => o.status === 'producao').length === 0) ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-emerald-700/50 space-y-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="opacity-40">
                  <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                </svg>
                <p className="text-[11px] italic">Nenhum pedido externo em preparo</p>
                {modoExclusivoSalao && <p className="text-[9px] text-emerald-700/40">Modo Salão exclusivo ativo</p>}
              </div>
            ) : (
              simulatedOrders.filter(o => o.status === 'producao').map((order) => {
                const hasAddress = !!order.endereco;
                const isMesa = order.mesaId && order.mesaId > 0;

                let badgeEmoji = '🏪';
                let badgeLabel = 'Retirada';
                let badgeClass = 'bg-violet-500/10 text-violet-400 border-violet-500/20';
                let btnLabel = '🏪 Retirada Pronta';
                let btnClass = 'bg-emerald-600 hover:bg-emerald-500 shadow-[0_2px_8px_rgba(16,185,129,0.25)]';

                if (hasAddress) {
                  badgeEmoji = '🛵'; badgeLabel = 'Delivery';
                  badgeClass = 'bg-orange-500/10 text-orange-400 border-orange-500/20';
                  btnLabel = '🛵 Saiu para Entrega';
                  btnClass = 'bg-orange-600 hover:bg-orange-500 shadow-[0_2px_8px_rgba(234,88,12,0.25)]';
                } else if (isMesa) {
                  badgeEmoji = '🍽️'; badgeLabel = `Mesa ${order.mesaId}`;
                  badgeClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                  btnLabel = '✓ Pedido Pronto';
                }

                return (
                  <div
                    key={`prod-online-${order.id}`}
                    onClick={() => openSimulatedOrderDetails(order)}
                    className="group bg-[#0d1812] border border-emerald-500/15 hover:border-emerald-400/40 p-3.5 rounded-xl space-y-3 transition-all duration-200 cursor-pointer hover:shadow-[0_0_16px_rgba(52,211,153,0.06)]"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          <span className={clsx('px-2 py-0.5 text-[9px] uppercase tracking-widest font-black rounded-md font-mono border', badgeClass)}>
                            {badgeEmoji} {badgeLabel}
                          </span>
                          <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-black bg-yellow-500/10 text-yellow-400 rounded-md font-mono border border-yellow-500/20">⏳ Preparando</span>
                        </div>
                        <strong className="text-white text-sm block truncate">{order.cliente}</strong>
                        <span className="text-[10px] text-gray-400 block">{order.telefone}</span>
                      </div>
                      <span className="font-black text-white font-mono text-[13px] shrink-0">R$ {order.total.toFixed(2)}</span>
                    </div>

                    <p className="text-[10px] text-emerald-300/70 bg-black/40 px-2.5 py-2 rounded-lg border border-emerald-500/10 leading-relaxed font-mono">
                      {order.itens}
                    </p>

                    {order.endereco && (
                      <div className="flex items-start gap-1.5 bg-rose-950/20 px-2 py-1.5 rounded-lg border border-rose-500/10">
                        <MapPin size={10} className="shrink-0 text-rose-400 mt-0.5" />
                        <span className="text-[9.5px] text-rose-300/70 leading-relaxed">{order.endereco}</span>
                      </div>
                    )}

                    {hasAddress ? (
                      <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[9px] text-gray-400 block font-bold uppercase tracking-wider">Despachar via:</span>
                        <div className="flex gap-2 flex-wrap">
                          {activeMotoboysList.map((m) => {
                            const firstName = m.nome.split(' ')[0];
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (isLoading) return;
                                  setSelectedMotoboys(prev => ({ ...prev, [order.id]: String(m.id) }));
                                  await handleDespacharPedido(order.id, m.id);
                                  alert(`Simulação de WhatsApp: Mensagem enviada para ${order.cliente} (${order.telefone}) avisando que o pedido saiu para entrega com o entregador ${firstName}!`);
                                }}
                                className="flex-1 py-1.5 px-2 bg-orange-600 hover:bg-orange-500 active:scale-95 text-white rounded-lg font-black text-[10px] transition-all duration-150 cursor-pointer uppercase tracking-wider text-center"
                              >
                                [ {firstName} ]
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (isLoading) return;
                          await handleUpdateDeliveryStatus(order.id, 'pronto');
                          if (isMesa) {
                            alert(`Simulação de WhatsApp: Mensagem enviada para ${order.cliente} (${order.telefone}) avisando que o pedido da Mesa ${order.mesaId} está pronto!`);
                          } else {
                            alert(`Simulação de WhatsApp: Mensagem enviada para ${order.cliente} (${order.telefone}) avisando que o pedido está pronto para retirada!`);
                          }
                        }}
                        className={clsx('w-full py-2 active:scale-95 text-white rounded-lg font-black text-[10px] transition-all duration-150 cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5', btnClass)}
                      >
                        {btnLabel}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════
          COLUMN 3: Fechamento & Contas
          (mesas prontas/conta pedida + delivery em trânsito/pronto)
      ═══════════════════════════════════════ */}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-b from-blue-950/20 to-[#0c0c0e]/80 text-left">
        {/* Column header */}
        <div className="px-4 py-3 border-b border-blue-500/15 flex justify-between items-center shrink-0 bg-blue-950/30">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_6px_2px_rgba(96,165,250,0.4)]"></div>
            <div>
              <span className="font-bold text-blue-100 text-sm tracking-wide block">Fechamento & Contas</span>
              <span className="text-[9px] text-blue-400/60 font-mono">Prontos / Em rota / Conta pedida</span>
            </div>
          </div>
          <span className={clsx(
            'font-bold px-2.5 py-0.5 rounded-full font-mono text-[10px]',
            totalCheckoutCount > 0
              ? 'bg-blue-500/20 text-blue-300'
              : 'bg-blue-500/10 text-blue-500/50'
          )}>
            {totalCheckoutCount}
          </span>
        </div>

        <div className="p-3 flex-1 overflow-y-auto space-y-3 scrollbar-thin scrollbar-thumb-blue-900/30 scrollbar-track-transparent">
          {totalCheckoutCount === 0 ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-blue-700/50 space-y-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="opacity-40">
                <rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>
              </svg>
              <p className="text-[11px] italic">Nenhuma conta pendente</p>
            </div>
          ) : (
            <>
              {/* Delivery / Retirada orders in transit or ready */}
              {checkoutSimulatedOrders.map((order) => {
                const isDelivery = !!order.endereco;
                const badgeEmoji = isDelivery ? '🛵' : '🏪';
                const badgeLabel = isDelivery ? 'Delivery — Em Rota' : 'Retirada — Pronta';
                const badgeClass = isDelivery ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-violet-500/10 text-violet-400 border-violet-500/20';

                return (
                  <div
                    key={`ready-online-${order.id}`}
                    onClick={() => openSimulatedOrderDetails(order)}
                    className="group bg-[#0b0d14] border border-blue-500/20 hover:border-blue-400/40 p-3.5 rounded-xl space-y-3 transition-all duration-200 cursor-pointer"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          <span className={clsx('px-2 py-0.5 text-[9px] uppercase tracking-widest font-black rounded-md font-mono border', badgeClass)}>
                            {badgeEmoji} {badgeLabel}
                          </span>
                        </div>
                        <strong className="text-white text-sm block truncate">{order.cliente}</strong>
                        <span className="text-[10px] text-gray-400 block">{order.telefone}</span>
                      </div>
                      <span className="font-black text-white font-mono text-[13px] shrink-0">R$ {order.total.toFixed(2)}</span>
                    </div>

                    <p className="text-[10px] text-blue-300/70 bg-black/40 px-2.5 py-2 rounded-lg border border-blue-500/10 leading-relaxed font-mono">
                      {order.itens}
                    </p>

                    {order.endereco && (
                      <div className="flex items-start gap-1.5 bg-rose-950/20 px-2 py-1.5 rounded-lg border border-rose-500/10">
                        <MapPin size={10} className="shrink-0 text-rose-400 mt-0.5" />
                        <span className="text-[9.5px] text-rose-300/70 leading-relaxed">{order.endereco}</span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (isLoading) return;
                        const fullOrder = orders.find(o => o.id === order.id);
                        if (fullOrder) {
                          setSelectedOrder({
                            ...fullOrder,
                            itens: fullOrder.itens.map((it: any) => ({
                              id: it.id,
                              produtoId: it.produto_id || it.produtoId,
                              name: it.nome || `Item ${it.produtoId}`,
                              preco: it.preco_unit || it.preco,
                              observacao: it.observacao || '',
                              clienteNome: it.cliente_nome || it.clienteNome || 'Consumo Geral',
                              status: it.status,
                              pago: it.pago
                            }))
                          });
                          setShowCheckoutModal(true);
                          setCheckoutServiceTax(false);
                          setSplitPeople('1');
                          setSelectedItemIds([]);
                          const sub = fullOrder.itens.filter((it: any) => !it.pago).reduce((s: number, it: any) => s + (it.preco_unit || it.preco || 0), 0);
                          setPaymentValor(sub.toFixed(2));
                        } else {
                          await handleFinalizarPedido(order.id);
                        }
                      }}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white rounded-lg font-black text-[10px] transition-all duration-150 cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-[0_2px_8px_rgba(59,130,246,0.25)]"
                    >
                      <CreditCard size={11} /> Fechar Conta
                    </button>
                  </div>
                );
              })}

              {checkoutTableOrders.map((order) => {
                if (order.isGrouped) {
                  const contaPedida = order.contaPedida;
                  return (
                    <div
                      key={order.id}
                      className={clsx(
                        'bg-[#0b0d14] border p-3.5 rounded-xl space-y-3 transition-all duration-200',
                        contaPedida ? 'border-blue-500/40 hover:border-blue-400/60 hover:shadow-[0_0_16px_rgba(96,165,250,0.08)]' : 'border-emerald-500/25 hover:border-emerald-400/45'
                      )}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap gap-1 mb-1.5">
                            <span className={clsx(
                              'px-2 py-0.5 text-[9px] uppercase tracking-widest font-black rounded-md font-mono border',
                              contaPedida ? 'bg-blue-500/15 text-blue-400 border-blue-500/25' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            )}>
                              🍽️ Mesa {order.mesaId} — {order.originalOrders.length} Comandas
                            </span>
                            {order.temItensEmPreparo && (
                              <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-black bg-amber-500/10 text-amber-400 rounded-md font-mono border border-amber-500/20" title="Itens ainda sendo preparados">
                                ⏳ Em preparo
                              </span>
                            )}
                          </div>
                          <strong className="text-white text-sm block truncate">{order.identificador}</strong>
                          <span className="text-[10px] text-gray-500 block">👨‍🍳 {order.garcomNome}</span>
                        </div>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-white/5">
                        {order.originalOrders.map((origOrder: any) => {
                          const origItemCounts: Record<string, number> = {};
                          origOrder.itens.forEach((it: any) => {
                            const name = it.nome || 'Item';
                            origItemCounts[name] = (origItemCounts[name] || 0) + 1;
                          });
                          const origItemsStr = Object.entries(origItemCounts)
                            .map(([name, qty]) => `${qty}x ${name}`)
                            .join(' • ') || 'Nenhum item';

                          return (
                            <div key={`orig-${origOrder.id}`} className="bg-black/30 p-2.5 rounded-lg border border-white/5 space-y-1.5">
                              <div className="flex justify-between items-center text-[9px]">
                                <span className="font-bold text-gray-300">{origOrder.identificador || `Comanda #${origOrder.id.slice(-4)}`}</span>
                                <span className="text-gray-600 font-mono">#{origOrder.id.slice(-4)}</span>
                              </div>
                              <p className="text-[9.5px] text-emerald-300/80 font-mono leading-relaxed">{origItemsStr}</p>
                            </div>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (isLoading) return;
                          setSelectedOrder({
                            id: order.id,
                            mesaId: order.mesaId,
                            mesaOrigemId: order.mesaOrigemId,
                            mesaTransferidaDe: order.mesaTransferidaDe,
                            identificador: order.identificador,
                            garcomNome: order.garcomNome,
                            tipo: order.tipo,
                            valorPago: order.valorPago,
                            itens: order.itens.map((it: any) => ({
                              id: it.id, produtoId: it.produto_id || it.produtoId,
                              nome: it.nome || `Item ${it.produtoId}`, preco: it.preco_unit || it.preco,
                              observacao: it.observacao || '', clienteNome: it.cliente_nome || it.clienteNome || 'Consumo Geral',
                              status: it.status, pago: it.pago
                            })),
                            isGrouped: true,
                            originalOrders: order.originalOrders
                          });
                          setShowCheckoutModal(true);
                          setCheckoutServiceTax(true);
                          setSplitPeople('1');
                          setSelectedItemIds([]);
                          const sub = order.itens.filter((it: any) => !it.pago).reduce((s: number, it: any) => s + (it.preco_unit || it.preco || 0), 0);
                          setPaymentValor((sub * (1.0 + (taxaServicoAtiva ? serviceTaxRate / 100 : 0))).toFixed(2));
                        }}
                        className={clsx('w-full py-2 active:scale-95 text-white rounded-lg font-black text-[10px] transition-all duration-150 cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5', contaPedida ? 'bg-blue-600 hover:bg-blue-500 shadow-[0_2px_8px_rgba(96,165,250,0.25)]' : 'bg-emerald-600 hover:bg-emerald-500 shadow-[0_2px_8px_rgba(16,185,129,0.25)]')}
                      >
                        <Check size={11} /> Fechar Conta
                      </button>
                    </div>
                  );
                }

                // Single (non-grouped) order
                const itemCounts: Record<string, number> = {};
                order.itens.forEach((it: { nome?: string }) => {
                  const name = it.nome || 'Item';
                  itemCounts[name] = (itemCounts[name] || 0) + 1;
                });
                const itemsStr = Object.entries(itemCounts)
                  .map(([name, qty]) => `${qty}x ${name}`)
                  .join(' • ') || 'Nenhum item';
                const contaPedida = !!(order as any).contaPedida;
                const badgeText = (order.mesaId && order.mesaId > 0)
                  ? (contaPedida ? `Mesa ${order.mesaId} — Conta Pedida` : `Mesa ${order.mesaId} — Pronto`)
                  : (contaPedida ? 'Balcão — Conta Pedida' : 'Balcão — Pronto');

                return (
                  <div
                    key={`close-${order.id}`}
                    onClick={() => setSelectedKanbanOrder(order)}
                    className={clsx(
                      'bg-[#0b0d14] border p-3.5 rounded-xl space-y-3 transition-all duration-200 cursor-pointer',
                      contaPedida ? 'border-blue-500/40 hover:border-blue-400/60 hover:shadow-[0_0_16px_rgba(96,165,250,0.08)]' : 'border-emerald-500/25 hover:border-emerald-400/45'
                    )}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          <span className={clsx(
                            'px-2 py-0.5 text-[9px] uppercase tracking-widest font-black rounded-md font-mono border',
                            contaPedida ? 'bg-blue-500/15 text-blue-400 border-blue-500/25' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          )}>
                            🍽️ {badgeText}
                          </span>
                          {!contaPedida && order.temItensEmPreparo && (
                            <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-black bg-amber-500/10 text-amber-400 rounded-md font-mono border border-amber-500/20">
                              ⏳ Em preparo
                            </span>
                          )}
                          {order.mesaOrigemId && Number(order.mesaOrigemId) !== Number(order.mesaId) && (
                            <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-black bg-teal-500/10 text-teal-300 rounded-md font-mono border border-teal-500/20">
                              🔗 +Mesa {order.mesaOrigemId}
                            </span>
                          )}
                        </div>
                        <strong className="text-white text-sm block truncate">
                          {order.identificador || ((order.mesaId && order.mesaId > 0) ? `Consumo Mesa ${order.mesaId}` : 'Consumo Balcão')}
                        </strong>
                        <span className="text-[10px] text-gray-500 block">👨‍🍳 {order.garcomNome || 'Garçom'}</span>
                      </div>
                      <span className="text-[9px] text-gray-600 font-mono shrink-0">#{order.id.slice(-4)}</span>
                    </div>

                    <p className={clsx('text-[10px] bg-black/40 px-2.5 py-2 rounded-lg border leading-relaxed font-mono', contaPedida ? 'text-blue-300/80 border-blue-500/10' : 'text-emerald-300/80 border-emerald-500/10')}>
                      {itemsStr}
                    </p>

                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (isLoading) return;
                        const fullOrder = orders.find(o => o.id === order.comandaId);
                        if (!fullOrder) return;
                        setSelectedOrder({
                          ...fullOrder,
                          itens: fullOrder.itens.map((it: any) => ({
                            id: it.id, produtoId: it.produto_id || it.produtoId,
                            nome: it.nome || `Item ${it.produtoId}`, preco: it.preco_unit || it.preco,
                            observacao: it.observacao || '', clienteNome: it.cliente_nome || it.clienteNome || 'Consumo Geral',
                            status: it.status, pago: it.pago
                          }))
                        });
                        setShowCheckoutModal(true);
                        setCheckoutServiceTax(true);
                        setSplitPeople('1');
                        setSelectedItemIds([]);
                        const sub = fullOrder.itens.filter((it: any) => !it.pago).reduce((s: number, it: any) => s + (it.preco_unit || it.preco || 0), 0);
                        setPaymentValor((sub * (1.0 + (taxaServicoAtiva ? serviceTaxRate / 100 : 0))).toFixed(2));
                      }}
                      className={clsx('w-full py-2 active:scale-95 text-white rounded-lg font-black text-[10px] transition-all duration-150 cursor-pointer uppercase tracking-wider flex items-center justify-center gap-1.5', contaPedida ? 'bg-blue-600 hover:bg-blue-500 shadow-[0_2px_8px_rgba(96,165,250,0.25)]' : 'bg-emerald-600 hover:bg-emerald-500 shadow-[0_2px_8px_rgba(16,185,129,0.25)]')}
                    >
                      <Check size={11} /> Fechar Conta
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

    </div>
  );
};
