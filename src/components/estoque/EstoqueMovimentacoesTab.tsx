import React, { useState } from 'react';
import clsx from 'clsx';
import { Plus, Filter, ArrowUpRight, ArrowDownLeft, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { MovimentacaoEstoque, Insumo } from '../../types';
import { formatBackendDateTime, parseBackendTimestamp } from '../../utils/dateTime';

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
    const createdAt = parseBackendTimestamp(m.created_at);
    if (filterDataInicio && (!createdAt || createdAt < new Date(`${filterDataInicio}T00:00:00`))) return false;
    if (filterDataFim && (!createdAt || createdAt > new Date(`${filterDataFim}T23:59:59.999`))) return false;
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
        return <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 flex items-center gap-1 w-fit"><Plus size={10} /> Ajuste (+)</span>;
      case 'ajuste_negativo':
        return <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-amber-500/10 text-amber-400 flex items-center gap-1 w-fit"><AlertTriangle size={10} /> Ajuste (-)</span>;
      case 'contagem':
        return <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-purple-500/10 text-purple-400 flex items-center gap-1 w-fit"><CheckCircle2 size={10} /> Contagem</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-koma-raised text-koma-subtle">{tipo}</span>;
    }
  };

  return (
    <div className="space-y-5 text-left animate-fade-in">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-koma-panel/60 border border-koma-border p-4 rounded-3xl">
        <div>
          <h3 className="font-serif text-sm font-bold text-koma-foreground">Histórico Auditável de Movimentações</h3>
          <p className="text-[10px] text-koma-subtle">Rastreabilidade completa de entradas, perdas, contagens e ajustes de saldo.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefreshMovimentacoes}
            className="p-2 border border-koma-border hover:bg-koma-raised text-koma-subtle hover:text-koma-foreground rounded-xl transition-all cursor-pointer"
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
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 bg-koma-raised/60 border border-koma-border p-3 rounded-2xl">
        <div className="space-y-1">
          <label className="text-[9px] font-bold text-koma-subtle uppercase tracking-wider flex items-center gap-1">
            <Filter size={10} />
            <span>Ingrediente</span>
          </label>
          <select
            value={filterInsumoId}
            onChange={(e) => setFilterInsumoId(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs focus:outline-none focus:border-emerald-500"
          >
            <option value="">Todos os ingredientes</option>
            {insumos.map(i => (
              <option key={i.id} value={i.id}>{i.nome}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[9px] font-bold text-koma-subtle uppercase tracking-wider">Tipo</label>
          <select
            value={filterTipo}
            onChange={(e) => setFilterTipo(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs focus:outline-none focus:border-emerald-500"
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
          <label className="text-[9px] font-bold text-koma-subtle uppercase tracking-wider">Data Início</label>
          <input
            type="date"
            value={filterDataInicio}
            onChange={(e) => setFilterDataInicio(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs font-mono focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[9px] font-bold text-koma-subtle uppercase tracking-wider">Data Fim</label>
          <input
            type="date"
            value={filterDataFim}
            onChange={(e) => setFilterDataFim(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs font-mono focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-koma-panel/60 border border-koma-border rounded-3xl p-5 space-y-3">
        <div className="overflow-x-auto border border-koma-border rounded-2xl">
          <table className="w-full text-left text-[10px]">
            <thead>
              <tr className="bg-koma-raised border-b border-koma-border text-koma-subtle uppercase tracking-wider font-bold">
                <th className="p-3">Data / Hora</th>
                <th className="p-3">Ingrediente</th>
                <th className="p-3">Tipo</th>
                <th className="p-3 font-mono">Qtd</th>
                <th className="p-3 font-mono">Saldo Ant. ➔ Novo</th>
                <th className="p-3 font-mono">Custo Unit</th>
                <th className="p-3">Motivo / Justificativa</th>
                <th className="p-3">Origem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-koma-border">
              {filteredMovs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-koma-muted italic">
                    Nenhuma movimentação encontrada para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredMovs.map((mov) => (
                  <tr key={mov.id} className="hover:bg-koma-raised/50 transition-colors">
                    <td className="p-3 text-koma-subtle whitespace-nowrap font-mono">
                      {formatBackendDateTime(mov.created_at)}
                    </td>
                    <td className="p-3 font-bold text-koma-foreground">
                      {mov.insumo?.nome || mov.insumo_id}
                      <span className="text-[8px] text-koma-muted block font-mono">ID: {mov.insumo_id}</span>
                    </td>
                    <td className="p-3">{getTipoBadge(mov.tipo)}</td>
                    <td className="p-3 font-mono font-bold text-koma-foreground">{mov.quantidade} {mov.insumo?.unidade_medida || ''}</td>
                    <td className="p-3 font-mono text-koma-secondary whitespace-nowrap">
                      {mov.saldo_anterior.toFixed(2)} ➔ <strong className={clsx(
                        mov.saldo_posterior > mov.saldo_anterior ? 'text-emerald-400' : mov.saldo_posterior < mov.saldo_anterior ? 'text-amber-400' : 'text-koma-foreground'
                      )}>{mov.saldo_posterior.toFixed(2)}</strong>
                    </td>
                    <td className="p-3 font-mono text-koma-subtle">R$ {Number(mov.custo_unitario || 0).toFixed(2)}</td>
                    <td className="p-3 text-koma-secondary max-w-xs truncate" title={mov.motivo}>
                      {mov.motivo}
                      {mov.observacao && <span className="text-[8px] text-koma-muted block">{mov.observacao}</span>}
                    </td>
                    <td className="p-3 text-koma-subtle text-[9px] font-mono uppercase">{mov.origem || 'manual'}</td>
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
