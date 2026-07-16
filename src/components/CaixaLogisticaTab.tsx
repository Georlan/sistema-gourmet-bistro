import React from 'react';
import clsx from 'clsx';
import { SimulatedDeliveryOrder, Motoboy } from '../types';

export interface CaixaLogisticaTabProps {
  simulatedOrders: SimulatedDeliveryOrder[];
  motoboys: Motoboy[];
  selectedMotoboys: Record<string, string>;
  setSelectedMotoboys: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleDespacharPedido: (orderId: string, motoboyId: number) => Promise<void> | void;
  handleFinalizarPedido: (orderId: string) => Promise<void> | void;
  handleCadastrarMotoboy: (e: React.FormEvent) => Promise<void> | void;
  novoMotoboyNome: string;
  setNovoMotoboyNome: (val: string) => void;
  novoMotoboyTelefone: string;
  setNovoMotoboyTelefone: (val: string) => void;
}

export const CaixaLogisticaTab: React.FC<CaixaLogisticaTabProps> = ({
  simulatedOrders,
  motoboys,
  selectedMotoboys,
  setSelectedMotoboys,
  handleDespacharPedido,
  handleFinalizarPedido,
  handleCadastrarMotoboy,
  novoMotoboyNome,
  setNovoMotoboyNome,
  novoMotoboyTelefone,
  setNovoMotoboyTelefone,
}) => {
  return (
    <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5', 'animate-fade-in', 'text-left')}>
      {/* Painel de Entregas (Colunas da Esquerda) */}
      <div className={clsx('lg:col-span-2', 'bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-5', 'flex', 'flex-col', 'overflow-hidden')}>
        <div className={clsx('border-b', 'border-[#27272A]', 'pb-3', 'shrink-0')}>
          <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'text-sm')}>Controle de Despacho e Entregas</span>
          <span className={clsx('text-[9px]', 'text-gray-500', 'block')}>Gerencie o fluxo de saída e entrega de pedidos de Delivery.</span>
        </div>

        {/* Pedidos Pendentes de Envio */}
        <div className={clsx('space-y-3', 'flex-1', 'overflow-y-auto')}>
          <span className={clsx('text-[10px]', 'font-bold', 'text-[#10b981]', 'uppercase', 'tracking-wider', 'block')}>Pedidos para Despachar</span>

          {simulatedOrders.filter(o => o.status === 'producao' || o.status === 'pendente' || o.status === 'analise').length === 0 ? (
            <div className={clsx('py-8', 'text-center', 'text-gray-500', 'text-xs', 'italic', 'bg-[#1C1C1F]/20', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
              Não há pedidos prontos ou em produção aguardando despacho no momento.
            </div>
          ) : (
            <div className="space-y-3">
              {simulatedOrders.filter(o => o.status === 'producao' || o.status === 'pendente' || o.status === 'analise').map((order) => {
                const motoboyId = selectedMotoboys[order.id] || '';
                return (
                  <div key={order.id} className={clsx('p-4', 'bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-2xl', 'flex', 'flex-col', 'sm:flex-row', 'justify-between', 'gap-3', 'text-xs')}>
                    <div className={clsx('space-y-1.5', 'flex-1')}>
                      <div className={clsx('flex', 'items-center', 'gap-2')}>
                        <span className={clsx('font-bold', 'text-white', 'text-[11px]')}>Pedido {order.id}</span>
                        <span className={clsx('bg-[#10b981]/15', 'text-[#10b981]', 'text-[8px]', 'font-bold', 'px-1.5', 'py-0.5', 'rounded', 'border', 'border-[#10b981]/20', 'uppercase')}>
                          {order.canal}
                        </span>
                      </div>
                      <span className={clsx('text-gray-300', 'font-bold', 'block')}>{order.cliente} • {order.telefone}</span>
                      <span className={clsx('text-gray-400', 'text-[10px]', 'block', 'leading-relaxed')}>{order.endereco}</span>
                      <span className={clsx('text-[9px]', 'text-gray-500', 'block', 'font-mono')}>Itens: {order.itens}</span>
                    </div>

                    <div className={clsx('flex', 'flex-col', 'sm:items-end', 'justify-between', 'gap-2', 'shrink-0')}>
                      <span className={clsx('font-mono', 'font-bold', 'text-emerald-400', 'text-[11px]')}>R$ {order.total.toFixed(2)}</span>

                      <div className={clsx('flex', 'items-center', 'gap-2')}>
                        <select
                          value={motoboyId}
                          onChange={(e) => setSelectedMotoboys(prev => ({ ...prev, [order.id]: e.target.value }))}
                          className={clsx('py-1.5', 'px-2', 'bg-[#121214]', 'border', 'border-[#27272A]', 'text-white', 'rounded-xl', 'text-[10px]', 'focus:outline-none', 'focus:border-[#10b981]')}
                        >
                          <option value="">Selecione o Entregador...</option>
                          {motoboys.filter(m => m.ativo).map(m => (
                            <option key={m.id} value={m.id}>{m.nome}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!motoboyId}
                          onClick={() => handleDespacharPedido(order.id, parseInt(motoboyId))}
                          className={clsx('py-1.5', 'px-3', 'bg-emerald-600', 'hover:bg-[#9d2b3c]', 'disabled:opacity-50', 'text-white', 'font-bold', 'rounded-xl', 'text-[10px]', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                        >
                          Despachar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pedidos Em Trânsito */}
          <span className={clsx('text-[10px]', 'font-bold', 'text-[#10b981]', 'uppercase', 'tracking-wider', 'block', 'pt-4')}>Em Trânsito (Entregas Ativas)</span>

          {simulatedOrders.filter(o => o.status === 'transito' || o.status === 'pronto').length === 0 ? (
            <div className={clsx('py-8', 'text-center', 'text-gray-500', 'text-xs', 'italic', 'bg-[#1C1C1F]/20', 'border', 'border-[#27272A]/40', 'rounded-2xl')}>
              Nenhum pedido em trânsito no momento.
            </div>
          ) : (
            <div className="space-y-3">
              {simulatedOrders.filter(o => o.status === 'transito' || o.status === 'pronto').map((order) => {
                return (
                  <div key={order.id} className={clsx('p-4', 'bg-[#1C1C1F]/40', 'border', 'border-[#27272A]/40', 'rounded-2xl', 'flex', 'flex-col', 'sm:flex-row', 'justify-between', 'gap-3', 'text-xs')}>
                    <div className={clsx('space-y-1', 'flex-1')}>
                      <div className={clsx('flex', 'items-center', 'gap-2')}>
                        <span className={clsx('font-bold', 'text-white', 'text-[11px]')}>Pedido {order.id}</span>
                        <span className={clsx('bg-emerald-500/10', 'text-emerald-400', 'text-[8px]', 'font-bold', 'px-1.5', 'py-0.5', 'rounded', 'border', 'border-emerald-500/20', 'uppercase', 'tracking-wider')}>
                          Em Trânsito
                        </span>
                      </div>
                      <span className={clsx('text-gray-300', 'font-bold', 'block')}>{order.cliente} • {order.telefone}</span>
                      <span className={clsx('text-gray-400', 'text-[10px]', 'block', 'leading-relaxed')}>{order.endereco}</span>
                    </div>

                    <div className={clsx('flex', 'flex-col', 'sm:items-end', 'justify-between', 'gap-2', 'shrink-0')}>
                      <span className={clsx('font-mono', 'font-bold', 'text-emerald-400', 'text-[11px]')}>R$ {order.total.toFixed(2)}</span>

                      <button
                        type="button"
                        onClick={() => handleFinalizarPedido(order.id)}
                        className={clsx('py-1.5', 'px-3', 'bg-emerald-600', 'hover:bg-emerald-700', 'text-white', 'font-bold', 'rounded-xl', 'text-[10px]', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
                      >
                        Concluir Entrega
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Gerenciamento de Fretistas (Coluna da Direita) */}
      <div className={clsx('bg-[#121214]/60', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-5', 'space-y-4', 'flex', 'flex-col', 'justify-between', 'overflow-hidden')}>
        <div className={clsx('space-y-4', 'flex-1', 'flex', 'flex-col', 'overflow-hidden')}>
          <div className={clsx('border-b', 'border-[#27272A]', 'pb-3', 'shrink-0')}>
            <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'block', 'text-sm')}>Fretistas Cadastrados</span>
            <span className={clsx('text-[9px]', 'text-gray-500', 'block')}>Lista de motoboys e entregadores de plantão.</span>
          </div>

          <div className={clsx('flex-1', 'overflow-y-auto', 'space-y-2.5')}>
            {motoboys.length === 0 ? (
              <span className={clsx('text-xs', 'text-gray-500', 'italic')}>Nenhum fretista cadastrado.</span>
            ) : (
              motoboys.map((m) => (
                <div key={m.id} className={clsx('p-3', 'bg-[#1C1C1F]', 'border', 'border-[#27272A]', 'rounded-xl', 'flex', 'items-center', 'justify-between', 'gap-2')}>
                  <div className="text-xs">
                    <span className={clsx('font-bold', 'text-white', 'block')}>{m.nome}</span>
                    <span className={clsx('text-[10px]', 'text-gray-400', 'block', 'font-mono')}>{m.telefone}</span>
                  </div>
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                    m.ativo ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                  }`}>
                    {m.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Cadastro de novo Motoboy */}
        <form onSubmit={handleCadastrarMotoboy} className={clsx('pt-4', 'border-t', 'border-[#27272A]', 'space-y-3', 'shrink-0')}>
          <span className={clsx('text-[10px]', 'font-bold', 'text-[#10b981]', 'uppercase', 'tracking-wider', 'block')}>Novo Fretista</span>

          <input
            type="text"
            required
            placeholder="Nome do Entregador"
            value={novoMotoboyNome}
            onChange={(e) => setNovoMotoboyNome(e.target.value)}
            className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'focus:outline-none', 'focus:border-[#10b981]')}
          />
          <input
            type="text"
            required
            placeholder="Telefone (ex: 81 99999-8888)"
            value={novoMotoboyTelefone}
            onChange={(e) => setNovoMotoboyTelefone(e.target.value)}
            className={clsx('w-full', 'px-3', 'py-2', 'bg-[#09090B]', 'border', 'border-[#27272A]', 'rounded-xl', 'text-white', 'text-xs', 'font-mono', 'focus:outline-none', 'focus:border-[#10b981]')}
          />
          <button
            type="submit"
            className={clsx('w-full', 'py-2', 'bg-emerald-600', 'hover:bg-[#9d2b3c]', 'text-white', 'font-bold', 'rounded-xl', 'text-[10px]', 'uppercase', 'tracking-wider', 'transition-colors', 'cursor-pointer')}
          >
            Adicionar Fretista
          </button>
        </form>
      </div>
    </div>
  );
};
