import React, { useState } from 'react';
import clsx from 'clsx';
import { Plus, Filter, ArrowUpRight, ArrowDownLeft, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { MovimentacaoEstoque, Insumo } from '../../types';

interface EstoqueMovimentacoesTabProps {
  movimentacoes: MovimentacaoEstoque[];
  insumos: Insumo[];
  isLoading: boolean;
  onOpenNovaMovimentacaoModal: () => void;
  onRefreshMovimentacoes: () => void;
}

export const EstoqueMovimentacoesTab: React.FC<EstoqueMovimentacoesTabProps> = ({
  movimentacoes,
  insumos,
  isLoading,
  onOpenNovaMovimentacaoModal,
  onRefreshMovimentacoes
}) => {
  const [filterInsumoId, setFilterInsumoId] = useState<string>('');
  const [filterTipo, setFilterTipo] = useState<string>('todos');
  const [filterDataInicio, setFilterDataInicio] = useState<string>('');
  const [filterDataFim, setFilterDataFim] = useState<string>('');

  const filteredMovs = movimentacoes.filter(m => {
    if (filterInsumoId && m.insumo_id !== filterInsumoId) return false;
    if (filterTipo !== 'todos' && m.tipo !== filterTipo) return false;
    if (filterDataInicio && new Date(m.created_at) < new Date(filterDataInicio)) return false;
    if (filterDataFim && new Date(m.created_at) > new Date(`${filterDataFim}T23:59:59`)) return false;
    return true;
  });

  const getTipoBadge = (tipo: string) => {
    switch (tipo) {
      case 'entrada':
        return <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-emerald-500/10 text-emerald-400 flex items-center gap-1 w-fit"><ArrowDownLeft size={10} /> Entrada</span>;
      case 'saida':
        return <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-sky-500/10 text-sky-400 flex items-center gap-1 w-fit"><ArrowUpRight size={10} /> Saída</span>;
      case 'perda':
        return <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-red-500/10 text-red-400 flex items-center gap-1 w-fit"><AlertTriangle size={10} /> Perda</span>;
      case 'ajuste_positivo':
        return <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-emerald-500/10 text-emerald-300 flex items-center gap-1 w-fit"><Plus size={10} /> Ajuste (+)</span>;
      case 'ajuste_negativo':
        return <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-amber-500/10 text-amber-400 flex items-center gap-1 w-fit"><AlertTriangle size={10} /> Ajuste (-)</span>;
      case 'contagem':
        return <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-purple-500/10 text-purple-400 flex items-center gap-1 w-fit"><CheckCircle2 size={10} /> Contagem</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-zinc-800 text-gray-400">{tipo}</span>;
    }
  };

  return (
    <div className="space-y-5 text-left animate-fade-in">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#121214]/60 border border-[#27272A] p-4 rounded-3xl">
        <div>
          <h3 className="font-serif text-sm font-bold text-white">Histórico Auditável de Movimentações</h3>
          <p className="text-[10px] text-gray-400">Rastreabilidade completa de entradas, perdas, contagens e ajustes de saldo.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefreshMovimentacoes}
            className="p-2 border border-[#27272A] hover:bg-[#1C1C1F] text-gray-400 hover:text-white rounded-xl transition-all cursor-pointer"
            title="Atualizar Movimentações"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={onOpenNovaMovimentacaoModal}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            <Plus size={14} />
            <span>Nova Movimentação (Perda/Ajuste)</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 bg-[#121214]/40 border border-[#27272A] p-3 rounded-2xl">
        <div className="space-y-1">
          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
            <Filter size={10} />
            <span>Insumo</span>
          </label>
          <select
            value={filterInsumoId}
            onChange={(e) => setFilterInsumoId(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500"
          >
            <option value="">Todos os Insumos</option>
            {insumos.map(i => (
              <option key={i.id} value={i.id}>{i.nome}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Tipo</label>
          <select
            value={filterTipo}
            onChange={(e) => setFilterTipo(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500"
          >
            <option value="todos">Todos os Tipos</option>
            <option value="entrada">Entradas</option>
            <option value="perda">Perdas</option>
            <option value="ajuste_positivo">Ajustes Positivos (+)</option>
            <option value="ajuste_negativo">Ajustes Negativos (-)</option>
            <option value="contagem">Contagens</option>
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
                <th className="p-3">Insumo</th>
                <th className="p-3">Tipo</th>
                <th className="p-3 font-mono">Qtd</th>
                <th className="p-3 font-mono">Saldo Ant. ➔ Novo</th>
                <th className="p-3 font-mono">Custo Unit</th>
                <th className="p-3">Motivo / Justificativa</th>
                <th className="p-3">Origem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272A]/40">
              {filteredMovs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-500 italic">
                    Nenhuma movimentação encontrada para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredMovs.map((mov) => (
                  <tr key={mov.id} className="hover:bg-[#1C1C1F]/20 transition-colors">
                    <td className="p-3 text-gray-400 whitespace-nowrap font-mono">
                      {new Date(mov.created_at).toLocaleDateString('pt-BR')} {new Date(mov.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="p-3 font-bold text-white">
                      {mov.insumo?.nome || mov.insumo_id}
                      <span className="text-[8px] text-gray-500 block font-mono">ID: {mov.insumo_id}</span>
                    </td>
                    <td className="p-3">{getTipoBadge(mov.tipo)}</td>
                    <td className="p-3 font-mono font-bold text-white">{mov.quantidade} {mov.insumo?.unidade_medida || ''}</td>
                    <td className="p-3 font-mono text-gray-300 whitespace-nowrap">
                      {mov.saldo_anterior.toFixed(2)} ➔ <strong className={clsx(
                        mov.saldo_posterior > mov.saldo_anterior ? 'text-emerald-400' : mov.saldo_posterior < mov.saldo_anterior ? 'text-amber-400' : 'text-white'
                      )}>{mov.saldo_posterior.toFixed(2)}</strong>
                    </td>
                    <td className="p-3 font-mono text-gray-400">R$ {Number(mov.custo_unitario || 0).toFixed(2)}</td>
                    <td className="p-3 text-gray-300 max-w-xs truncate" title={mov.motivo}>
                      {mov.motivo}
                      {mov.observacao && <span className="text-[8px] text-gray-500 block">{mov.observacao}</span>}
                    </td>
                    <td className="p-3 text-gray-400 text-[9px] font-mono uppercase">{mov.origem || 'manual'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
