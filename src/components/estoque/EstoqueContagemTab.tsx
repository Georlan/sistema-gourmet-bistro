import React from 'react';
import { Plus, ClipboardCheck, CheckCircle2, Clock, Eye } from 'lucide-react';
import { SessaoContagemEstoque } from '../../types';

interface EstoqueContagemTabProps {
  contagens: SessaoContagemEstoque[];
  isLoading: boolean;
  onOpenNovaContagemModal: (sessaoId?: string) => void;
  onRefreshContagens: () => void;
}

export const EstoqueContagemTab: React.FC<EstoqueContagemTabProps> = ({
  contagens,
  onOpenNovaContagemModal
}) => {
  return (
    <div className="space-y-5 text-left animate-fade-in">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#121214]/60 border border-[#27272A] p-4 rounded-3xl">
        <div>
          <h3 className="font-serif text-sm font-bold text-white">Inventário Físico & Contagem de Estoque</h3>
          <p className="text-[10px] text-gray-400">Realize contagens parciais ou totais, salve rascunhos e confirme ajustes automáticos de divergências.</p>
        </div>
        <button
          type="button"
          onClick={() => onOpenNovaContagemModal()}
          className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
        >
          <Plus size={14} />
          <span>Nova Contagem Física</span>
        </button>
      </div>

      {/* Count Sessions List */}
      <div className="bg-[#121214]/60 border border-[#27272A] rounded-3xl p-5 space-y-3">
        <div className="overflow-x-auto border border-[#27272A]/40 rounded-2xl">
          <table className="w-full text-left text-[10px]">
            <thead>
              <tr className="bg-[#1C1C1F] border-b border-[#27272A] text-gray-400 uppercase tracking-wider font-bold">
                <th className="p-3">Data de Início</th>
                <th className="p-3">ID / Sessão</th>
                <th className="p-3">Status</th>
                <th className="p-3 font-mono">Itens Contados</th>
                <th className="p-3">Observação</th>
                <th className="p-3">Confirmação</th>
                <th className="p-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272A]/40">
              {contagens.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500 italic">
                    Nenhuma sessão de contagem registrada ainda. Clique em Nova Contagem Física para iniciar.
                  </td>
                </tr>
              ) : (
                contagens.map((c) => (
                  <tr key={c.id} className="hover:bg-[#1C1C1F]/20 transition-colors">
                    <td className="p-3 text-gray-400 whitespace-nowrap font-mono">
                      {new Date(c.created_at).toLocaleDateString('pt-BR')} {new Date(c.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="p-3 font-bold text-white font-mono">
                      #{c.id.slice(0, 8)}
                    </td>
                    <td className="p-3">
                      {c.status === 'confirmada' ? (
                        <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-emerald-500/10 text-emerald-400 flex items-center gap-1 w-fit">
                          <CheckCircle2 size={10} /> Confirmada
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-amber-500/10 text-amber-400 flex items-center gap-1 w-fit">
                          <Clock size={10} /> Rascunho
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono font-bold text-white">{c.itens?.length || 0} insumos</td>
                    <td className="p-3 text-gray-300 max-w-xs truncate">{c.observacao || '—'}</td>
                    <td className="p-3 text-gray-400 font-mono text-[9px]">
                      {c.confirmada_em ? new Date(c.confirmada_em).toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenNovaContagemModal(c.id)}
                        className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-gray-200 hover:text-white rounded-lg text-[9px] font-bold transition-all cursor-pointer inline-flex items-center gap-1"
                      >
                        {c.status === 'confirmada' ? <Eye size={12} /> : <ClipboardCheck size={12} />}
                        <span>{c.status === 'confirmada' ? 'Visualizar' : 'Editar / Confirmar'}</span>
                      </button>
                    </td>
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
