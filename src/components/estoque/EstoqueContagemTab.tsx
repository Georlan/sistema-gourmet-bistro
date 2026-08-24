import React from 'react';
import { Plus, ClipboardCheck, CheckCircle2, Clock, Eye } from 'lucide-react';
import { SessaoContagemEstoque } from '../../types';
import { formatBackendDateTime } from '../../utils/dateTime';
import { KomaEmptyState } from '../shared/KomaEmptyState';

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
    <div className="space-y-3.5 text-left animate-fade-in">
      <div className="koma-toolbar">
        <div>
          <p className="text-[10px] font-medium text-koma-muted">Conte o estoque, salve rascunhos e confirme divergências quando terminar.</p>
        </div>
        <div className="koma-toolbar__actions ml-auto">
          <button type="button" onClick={() => onOpenNovaContagemModal()} className="koma-btn-success"><Plus size={14} /> Novo inventário</button>
        </div>
      </div>

      {contagens.length === 0 ? (
        <KomaEmptyState
          icon={ClipboardCheck}
          title="Nenhum inventário realizado"
          description="Inicie uma contagem física para comparar o saldo do sistema com o estoque real."
          action={{ label: 'Novo inventário', onClick: () => onOpenNovaContagemModal(), icon: Plus }}
        />
      ) : (
        <div className="overflow-x-auto border border-koma-border rounded-2xl bg-koma-panel">
          <table className="koma-data-table min-w-[720px]">
            <thead>
              <tr className="bg-koma-raised border-b border-koma-border text-koma-subtle uppercase tracking-wider font-bold">
                <th className="p-3">Data de Início</th>
                <th className="p-3">ID / Sessão</th>
                <th className="p-3">Status</th>
                <th className="p-3 font-mono">Itens Contados</th>
                <th className="p-3">Observação</th>
                <th className="p-3">Confirmação</th>
                <th className="p-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-koma-border">
              {contagens.map((c) => (
                  <tr key={c.id} className="hover:bg-koma-raised/50 transition-colors">
                    <td className="p-3 text-koma-subtle whitespace-nowrap font-mono">
                      {formatBackendDateTime(c.created_at)}
                    </td>
                    <td className="p-3 font-bold text-koma-foreground font-mono">
                      #{c.id.slice(0, 8)}
                    </td>
                    <td className="p-3">
                      {c.status === 'confirmada' ? (
                        <span className="koma-status-badge koma-badge-success">
                          <CheckCircle2 size={10} /> Confirmada
                        </span>
                      ) : (
                        <span className="koma-status-badge koma-badge-warning">
                          <Clock size={10} /> Rascunho
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono font-bold text-koma-foreground">{c.itens?.length || 0} ingredientes</td>
                    <td className="p-3 text-koma-secondary max-w-xs truncate">{c.observacao || '—'}</td>
                    <td className="p-3 text-koma-subtle font-mono text-[9px]">
                      {c.confirmada_em ? formatBackendDateTime(c.confirmada_em, { dateStyle: 'short' }) : '—'}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenNovaContagemModal(c.id)}
                        className="px-2.5 py-1 bg-koma-raised hover:bg-koma-raised text-koma-secondary hover:text-koma-foreground rounded-lg text-[9px] font-bold transition-all cursor-pointer inline-flex items-center gap-1 border border-koma-border"
                      >
                        {c.status === 'confirmada' ? <Eye size={12} /> : <ClipboardCheck size={12} />}
                        <span>{c.status === 'confirmada' ? 'Visualizar' : 'Editar / Confirmar'}</span>
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
