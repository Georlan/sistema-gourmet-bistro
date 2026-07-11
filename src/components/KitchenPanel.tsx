/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ChefHat, CheckCircle, Clock, Utensils, MessageSquare } from 'lucide-react';
import { Order, OrderItem } from '../types';

interface KitchenPanelProps {
  orders: Order[];
  onFinishPreparation: (orderId: string, itemId: string) => void;
  currentTime: number;
  modoExclusivoSalao?: boolean;
}

export const KitchenPanel: React.FC<KitchenPanelProps> = ({
  orders,
  onFinishPreparation,
  currentTime,
  modoExclusivoSalao,
}) => {
  // Extract all items currently in 'preparando' status across all active orders
  const activeKitchenItems = React.useMemo(() => {
    const list: {
      orderId: string;
      mesaId: number;
      garcomNome: string;
      orderTimestamp: number;
      item: OrderItem;
    }[] = [];

    orders.forEach((order) => {
      // If exclusive salon mode is active, ignore orders that do not belong to a table
      if (modoExclusivoSalao && (order.mesaId === null || order.mesaId <= 0)) {
        return;
      }
      order.itens.forEach((item) => {
        if (item.status === 'preparando') {
          list.push({
            orderId: order.id,
            mesaId: order.mesaId,
            garcomNome: order.garcomNome,
            orderTimestamp: order.timestamp,
            item,
          });
        }
      });
    });

    // Sort oldest first
    return list.sort((a, b) => a.orderTimestamp - b.orderTimestamp);
  }, [orders]);

  return (
    <div className="bg-[#1C1917] text-[#FAF7F2] rounded-3xl border border-[#2E2A25] p-6 shadow-2xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-5 border-b border-[#2E2A25]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-[#10b981]/15 text-[#10b981] rounded-2xl border border-[#10b981]/20">
            <ChefHat size={22} />
          </div>
          <div>
            <h3 className="font-serif text-lg font-bold text-white tracking-wide">Monitor de Alta Gastronomia</h3>
            <p className="text-xs text-[#8F8578]">Fila prioritária de preparos de pratos e observações da cozinha do Kôma</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-[#2E2A25] px-3 py-1.5 rounded-full border border-[#10b981]/10">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4E6E58] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#4E6E58]"></span>
          </span>
          <span className="text-[10px] uppercase font-bold text-[#FAF7F2] font-sans tracking-wider">Conectado ao Salão</span>
        </div>
      </div>

      {/* Grid showing cooking list */}
      {activeKitchenItems.length === 0 ? (
        <div className="py-20 text-center space-y-4 max-w-md mx-auto">
          <div className="p-4 bg-[#2E2A25] text-[#10b981]/40 rounded-full inline-block">
            <Utensils size={32} />
          </div>
          <div className="space-y-1">
            <p className="font-serif text-lg text-white">Cozinha em perfeita harmonia</p>
            <p className="text-xs text-[#8F8578] leading-relaxed">
              Todos os pratos e vinhos do Kôma foram encaminhados e estão em perfeita sintonia com as mesas.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {activeKitchenItems.map(({ orderId, mesaId, orderTimestamp, item }) => {
            const minutesElapsed = Math.floor((currentTime - orderTimestamp) / 60000);
            
            // Highlight cooking items waiting more than 15 minutes
            const isDelayed = minutesElapsed >= 15;

            return (
              <div
                key={item.id}
                id={`kitchen-card-${item.id}`}
                className={`bg-[#2E2A25]/40 border rounded-2xl p-5 flex flex-col justify-between transition-all duration-300 ${
                  isDelayed 
                    ? 'border-rose-900/50/50 bg-rose-900/40 border border-rose-800/50/5 shadow-lg shadow-[#f43f5e]/10' 
                    : 'border-[#2E2A25] hover:border-[#10b981]/30'
                }`}
              >
                <div className="space-y-4">
                  {/* Card Header: Table, Timer, and delay badge */}
                  <div className="flex justify-between items-center pb-3 border-b border-[#2E2A25]/80">
                    <span className="font-serif font-bold text-lg text-white">
                      {mesaId && mesaId > 0 ? `Mesa ${mesaId}` : 'Balcão / Viagem'}
                    </span>
                    
                    <div className="flex items-center gap-1.5 bg-[#1C1917] px-2.5 py-1 rounded-full border border-[#2E2A25]">
                      <Clock size={12} className={isDelayed ? 'text-rose-400' : 'text-[#10b981]'} />
                      <span className={`font-mono text-xs font-semibold ${isDelayed ? 'text-rose-400 font-bold' : 'text-[#10b981]'}`}>
                        {minutesElapsed}m atrás
                      </span>
                    </div>
                  </div>

                  {/* Product detail */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-start gap-2">
                      <h4 className="font-sans font-bold text-sm text-[#FAF7F2]">{item.nome}</h4>
                      {item.clienteNome && (
                        <span className="px-2 py-0.5 bg-[#10b981]/15 border border-[#10b981]/20 text-[#10b981] rounded text-[9px] font-bold uppercase tracking-wider">
                          {item.clienteNome}
                        </span>
                      )}
                    </div>

                    {/* Unit observation - Crucial for kitchen */}
                    {item.observacao ? (
                      <div className="flex items-start gap-1.5 p-3 bg-rose-900/40 border border-rose-800/50/5 border border-dashed border-rose-900/50/20 rounded-xl text-xs text-[#E5C79E] leading-normal font-sans">
                        <MessageSquare size={12} className="shrink-0 mt-0.5 text-[#10b981]" />
                        <span>"{item.observacao}"</span>
                      </div>
                    ) : (
                      <p className="text-xs text-[#8F8578] italic font-sans">Sem observações especiais.</p>
                    )}
                  </div>
                </div>

                {/* Confirm Ready button */}
                <button
                  id={`kitchen-finish-btn-${item.id}`}
                  onClick={() => onFinishPreparation(orderId, item.id)}
                  className="mt-5 w-full py-2.5 bg-[#4E6E58] hover:bg-[#5E836A] active:bg-[#3D5745] text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer tracking-wider uppercase font-sans border border-[#5E836A]/20"
                >
                  <CheckCircle size={14} />
                  <span>Concluir Preparo</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
