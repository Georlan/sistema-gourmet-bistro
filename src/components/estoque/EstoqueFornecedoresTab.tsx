import { useMemo, useState } from 'react';
import { Building2, Edit3, Plus, Search, Trash2, X } from 'lucide-react';
import type { Distribuidor } from '../../types';
import { KomaEmptyState } from '../shared/KomaEmptyState';

interface EstoqueFornecedoresTabProps {
  fornecedores: Distribuidor[];
  onCreate: () => void;
  onEdit: (fornecedor: Distribuidor) => void;
  onDelete: (fornecedor: Distribuidor) => void;
}

function formatCnpj(value?: string | null) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 14) return value || 'Não informado';
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function EstoqueFornecedoresTab({ fornecedores, onCreate, onEdit, onDelete }: EstoqueFornecedoresTabProps) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return fornecedores.filter(fornecedor => !term || `${fornecedor.nome_fantasia} ${fornecedor.razao_social || ''} ${fornecedor.cnpj || ''}`.toLocaleLowerCase('pt-BR').includes(term));
  }, [fornecedores, search]);

  return (
    <div className="space-y-3.5 text-left animate-fade-in">
      <section className="koma-toolbar">
        <div className="koma-toolbar__search">
          <Search size={14} aria-hidden="true" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar fornecedor…" aria-label="Buscar fornecedores" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca"><X size={13} /></button>}
        </div>
        <div className="koma-toolbar__actions"><button type="button" onClick={onCreate} className="koma-btn-success"><Plus size={14} /> Novo fornecedor</button></div>
      </section>

      {filtered.length === 0 ? (
        <KomaEmptyState
          icon={Building2}
          title={fornecedores.length === 0 ? 'Cadastre o primeiro fornecedor' : 'Nenhum fornecedor encontrado'}
          description={fornecedores.length === 0 ? 'Fornecedores são associados automaticamente quando você importa uma NF-e, ou podem ser cadastrados manualmente.' : 'Tente outro nome, razão social ou CNPJ.'}
          action={fornecedores.length === 0 ? { label: 'Novo fornecedor', onClick: onCreate, icon: Plus } : { label: 'Limpar busca', onClick: () => setSearch(''), variant: 'secondary' }}
        />
      ) : (
        <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel" aria-label="Fornecedores cadastrados">
          <header className="border-b border-koma-border bg-koma-raised/40 px-3 py-2.5 text-[10px] text-koma-muted sm:px-4"><strong className="font-mono text-koma-foreground">{filtered.length}</strong> de {fornecedores.length} fornecedores</header>
          <div className="hidden grid-cols-[minmax(13rem,1fr)_minmax(12rem,0.8fr)_10rem_7rem_5rem] items-center gap-3 border-b border-koma-border bg-koma-raised/20 px-4 py-2 text-[9px] font-extrabold uppercase tracking-[0.08em] text-koma-muted lg:grid">
            <span>Fornecedor</span><span>Razão social</span><span>CNPJ</span><span>Prazo médio</span><span className="text-right">Ações</span>
          </div>
          {filtered.map(fornecedor => (
            <article key={fornecedor.id} className="grid gap-3 border-b border-koma-border px-3 py-3 last:border-b-0 hover:bg-koma-raised/50 sm:px-4 lg:grid-cols-[minmax(13rem,1fr)_minmax(12rem,0.8fr)_10rem_7rem_5rem] lg:items-center">
              <div className="min-w-0"><h2 className="truncate text-xs font-bold text-koma-foreground">{fornecedor.nome_fantasia || 'Sem nome fantasia'}</h2><p className="mt-1 text-[9px] text-koma-muted lg:hidden">{formatCnpj(fornecedor.cnpj)} · entrega em {fornecedor.lead_time_dias ?? 3} dias</p></div>
              <span className="hidden truncate text-[10px] text-koma-secondary lg:block">{fornecedor.razao_social || 'Não informada'}</span>
              <span className="hidden font-mono text-[10px] text-koma-secondary lg:block">{formatCnpj(fornecedor.cnpj)}</span>
              <span className="hidden text-[10px] text-koma-secondary lg:block">{fornecedor.lead_time_dias ?? 3} dias</span>
              <div className="flex items-center justify-end gap-0.5">
                <button type="button" onClick={() => onEdit(fornecedor)} className="rounded-lg p-2 text-koma-muted hover:bg-koma-raised hover:text-koma-foreground" aria-label={`Editar ${fornecedor.nome_fantasia}`}><Edit3 size={13} /></button>
                <button type="button" onClick={() => onDelete(fornecedor)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-500/10 dark:text-rose-300" aria-label={`Excluir ${fornecedor.nome_fantasia}`}><Trash2 size={13} /></button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
