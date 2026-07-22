import React, { useState } from 'react';
import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, Plus, RefreshCw, Filter } from 'lucide-react';
import { CaixaMovimentacao } from '../../types';

interface CaixaMovimentacoesTabProps {
  movimentacoes: CaixaMovimentacao[];
  isLoading: boolean;
  onOpenSangriaModal: () => void;
  onOpenSuprimentoModal: () => void;
  onRefresh: () => void;
}

export const CaixaMovimentacoesTab: React.FC<CaixaMovimentacoesTabProps> = ({
  movimentacoes,
  isLoading,
  onOpenSangriaModal,
  onOpenSuprimentoModal,
  onRefresh
}) => {
  const [filterTipo, setFilterTipo] = useState<string>('todos');
  const [filterDataInicio, setFilterDataInicio] = useState<string>('');
  const [filterDataFim, setFilterDataFim] = useState<string>('');

  const filteredMovs = movimentacoes.filter(m => {
    if (filterTipo !== 'todos' && m.tipo !== filterTipo) return false;
    if (filterDataInicio && new Date(m.criado_em) < new Date(filterDataInicio)) return false;
    if (filterDataFim && new Date(m.criado_em) > new Date(`${filterDataFim}T23:59:59`)) return false;
    return true;
  });

  return (
    <div className="space-y-5 text-left animate-fade-in">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#121214]/60 border border-[#27272A] p-4 rounded-3xl">
        <div>
          <h3 className="font-serif text-sm font-bold text-white">Movimentações de Caixa (Sangrias e Suprimentos)</h3>
          <p className="text-[10px] text-gray-400">Rastreabilidade completa de retiradas (sangrias) e aportes de troco (suprimentos).</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="p-2 border border-[#27272A] hover:bg-[#1C1C1F] text-gray-400 hover:text-white rounded-xl transition-all cursor-pointer"
            title="Atualizar Movimentações"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={onOpenSuprimentoModal}
            className="px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Plus size={14} />
            <span>+ Novo Suprimento</span>
          </button>
          <button
            type="button"
            onClick={onOpenSangriaModal}
            className="px-3.5 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Plus size={14} />
            <span>+ Nova Sangria</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#121214]/40 border border-[#27272A] p-3 rounded-2xl">
        <div className="space-y-1">
          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
            <Filter size={10} />
            <span>Tipo de Movimentação</span>
          </label>
          <select
            value={filterTipo}
            onChange={(e) => setFilterTipo(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500"
          >
            <option value="todos">Todas as Movimentações</option>
            <option value="suprimento">Apenas Suprimentos (+)</option>
            <option value="sangria">Apenas Sangrias (-)</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Data Início</label>
          <input
            type="date"
            value={filterDataInicio}
            onChange={(e) => setFilterDataInicio(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Data Fim</label>
          <input
            type="date"
            value={filterDataFim}
            onChange={(e) => setFilterDataFim(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-[#121214]/60 border border-[#27272A] rounded-3xl p-5 space-y-3">
        <div className="overflow-x-auto border border-[#27272A]/40 rounded-2xl">
          <table className="w-full text-left text-[10px]">
            <thead>
              <tr className="bg-[#1C1C1F] border-b border-[#27272A] text-gray-400 uppercase tracking-wider font-bold">
                <th className="p-3">Data / Hora</th>
                <th className="p-3">Tipo</th>
                <th className="p-3 font-mono">Valor</th>
                <th className="p-3 font-mono">Saldo Anterior ➔ Novo</th>
                <th className="p-3">Motivo / Descrição</th>
                <th className="p-3">Operador</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272A]/40">
              {filteredMovs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500 italic">
                    Nenhuma movimentação registrada no caixa para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredMovs.map((mov) => {
                  const isSuprimento = mov.tipo === 'suprimento';
                  return (
                    <tr key={mov.id} className="hover:bg-[#1C1C1F]/20 transition-colors">
                      <td className="p-3 text-gray-400 whitespace-nowrap font-mono">
                        {new Date(mov.criado_em).toLocaleDateString('pt-BR')} {new Date(mov.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-3">
                        <span className={clsx(
                          'px-2.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider flex items-center gap-1 w-fit',
                          isSuprimento ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                        )}>
                          {isSuprimento ? <ArrowDownRight size={10} /> : <ArrowUpRight size={10} />}
                          {isSuprimento ? 'Suprimento' : 'Sangria'}
                        </span>
                      </td>
                      <td className={clsx('p-3 font-mono font-bold text-sm', isSuprimento ? 'text-emerald-400' : 'text-red-400')}>
                        {isSuprimento ? '+' : '-'} R$ {Number(mov.valor).toFixed(2)}
                      </td>
                      <td className="p-3 font-mono text-gray-300 whitespace-nowrap">
                        R$ {(mov.saldo_anterior || 0).toFixed(2)} ➔ <strong className="text-white">R$ {(mov.saldo_posterior || 0).toFixed(2)}</strong>
                      </td>
                      <td className="p-3 text-gray-300 max-w-xs truncate" title={mov.descricao}>
                        {mov.descricao || '—'}
                        {mov.observacao && <span className="text-[8px] text-gray-500 block">{mov.observacao}</span>}
                      </td>
                      <td className="p-3 text-gray-300 font-semibold">
                        {mov.usuario_nome || 'Operador'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
