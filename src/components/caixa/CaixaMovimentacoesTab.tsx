import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Download,
  Filter,
  History,
  Search,
} from 'lucide-react';
import { CaixaMovimentacao, CaixaTurnoResumo } from '../../types';
import { OperationalBanner } from '../shared/OperationalBanner';

interface CaixaMovimentacoesTabProps {
  movimentacoes: CaixaMovimentacao[];
  turnoResumo?: CaixaTurnoResumo | null;
  isLoading: boolean;
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
});

const formatCurrency = (value: number) => currencyFormatter.format(Number(value) || 0);

const escapeCsv = (value: unknown) => {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
};

export const CaixaMovimentacoesTab: React.FC<CaixaMovimentacoesTabProps> = ({
  movimentacoes,
  turnoResumo,
  isLoading,
}) => {
  const [filterTipo, setFilterTipo] = useState('todos');
  const [filterDataInicio, setFilterDataInicio] = useState('');
  const [filterDataFim, setFilterDataFim] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredMovs = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase('pt-BR');

    return movimentacoes.filter(movimentacao => {
      if (filterTipo !== 'todos' && movimentacao.tipo !== filterTipo) return false;

      const createdAt = new Date(movimentacao.criado_em);
      if (filterDataInicio && createdAt < new Date(`${filterDataInicio}T00:00:00`)) return false;
      if (filterDataFim && createdAt > new Date(`${filterDataFim}T23:59:59.999`)) return false;

      if (normalizedSearch) {
        const searchable = [
          movimentacao.descricao,
          movimentacao.observacao,
          movimentacao.usuario_nome,
          movimentacao.tipo,
        ].join(' ').toLocaleLowerCase('pt-BR');
        if (!searchable.includes(normalizedSearch)) return false;
      }

      return true;
    });
  }, [filterDataFim, filterDataInicio, filterTipo, movimentacoes, searchTerm]);

  const totals = useMemo(() => filteredMovs.reduce(
    (accumulator, movimentacao) => {
      const value = Number(movimentacao.valor) || 0;
      if (movimentacao.tipo === 'suprimento') accumulator.suprimentos += value;
      if (movimentacao.tipo === 'sangria') accumulator.sangrias += value;
      return accumulator;
    },
    { suprimentos: 0, sangrias: 0 },
  ), [filteredMovs]);

  const hasFilters = Boolean(
    filterTipo !== 'todos' || filterDataInicio || filterDataFim || searchTerm.trim(),
  );

  const clearFilters = () => {
    setFilterTipo('todos');
    setFilterDataInicio('');
    setFilterDataFim('');
    setSearchTerm('');
  };

  const exportCsv = () => {
    const header = ['Data e hora', 'Tipo', 'Valor', 'Saldo anterior', 'Saldo posterior', 'Descrição', 'Observação', 'Operador'];
    const rows = filteredMovs.map(movimentacao => [
      new Date(movimentacao.criado_em).toLocaleString('pt-BR'),
      movimentacao.tipo,
      Number(movimentacao.valor).toFixed(2),
      Number(movimentacao.saldo_anterior || 0).toFixed(2),
      Number(movimentacao.saldo_posterior || 0).toFixed(2),
      movimentacao.descricao,
      movimentacao.observacao || '',
      movimentacao.usuario_nome || 'Operador',
    ]);
    const csv = `\uFEFF${[header, ...rows].map(row => row.map(escapeCsv).join(';')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `movimentacoes-caixa-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (isLoading && movimentacoes.length === 0) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Carregando movimentações do caixa">
        <div className="h-24 animate-pulse rounded-2xl border border-[#252b28] bg-[#0d100f]" />
        <div className="h-24 animate-pulse rounded-[20px] border border-[#252b28] bg-[#111412]" />
        <div className="h-80 animate-pulse rounded-[22px] border border-[#252b28] bg-[#0d100f]" />
      </div>
    );
  }

  return (
    <div className="orders-workspace space-y-4 text-left animate-fade-in" aria-busy={isLoading}>
      <OperationalBanner
        id="cash-movements-heading"
        eyebrow="HISTÓRICO DO CAIXA"
        title="Movimentações"
        accent="do caixa"
        description={`Sangrias e suprimentos do período${turnoResumo?.operador_nome ? ` · ${turnoResumo.operador_nome}` : ''}.`}
        metrics={[
          { label: 'suprimentos', value: formatCurrency(totals.suprimentos), valueClassName: 'text-[#54d9b3]' },
          { label: 'sangrias', value: formatCurrency(totals.sangrias), valueClassName: 'text-[#dfabab]' },
          { label: 'saldo dos ajustes', value: formatCurrency(totals.suprimentos - totals.sangrias), valueClassName: totals.suprimentos >= totals.sangrias ? 'text-[#54d9b3]' : 'text-[#dfabab]' },
          { label: 'turno atual', value: turnoResumo?.status === 'aberto' ? 'Aberto' : 'Fechado', valueClassName: turnoResumo?.status === 'aberto' ? 'text-emerald-300' : 'text-amber-300' },
        ]}
      />

      <section className="rounded-[20px] border border-[#252b28] bg-[#0d100f] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500"><Filter size={13} className="text-[#54d9b3]" /> Filtros</span>
          <div className="flex items-center gap-2">
            {hasFilters && <button type="button" onClick={clearFilters} className="px-2 text-[10px] font-bold text-[#54d9b3] hover:text-[#7becce]">Limpar filtros</button>}
            <button type="button" onClick={exportCsv} disabled={filteredMovs.length === 0} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#303532] bg-[#151816] px-3 py-2 text-[10px] font-bold text-zinc-300 transition-colors hover:border-[#196b55] hover:text-[#54d9b3] disabled:opacity-40">
              <Download size={13} /> Exportar CSV
            </button>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.3fr)_minmax(170px,.7fr)_minmax(155px,.6fr)_minmax(155px,.6fr)]">
          <label className="relative">
            <span className="sr-only">Buscar movimentação</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Buscar motivo, observação ou operador" className="h-10 w-full rounded-xl border border-[#2a302d] bg-[#151816] pl-9 pr-3 text-xs text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-[#196b55]" />
          </label>
          <select value={filterTipo} onChange={event => setFilterTipo(event.target.value)} className="h-10 w-full rounded-xl border border-[#2a302d] bg-[#151816] px-3 text-xs text-white outline-none focus:border-[#196b55]">
            <option value="todos">Todas as operações</option>
            <option value="suprimento">Suprimentos</option>
            <option value="sangria">Sangrias</option>
          </select>
          <label className="relative"><span className="sr-only">Data inicial</span><CalendarDays size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" /><input type="date" value={filterDataInicio} onChange={event => setFilterDataInicio(event.target.value)} className="h-10 w-full rounded-xl border border-[#2a302d] bg-[#151816] pl-9 pr-2 text-xs text-white outline-none focus:border-[#196b55]" /></label>
          <label className="relative"><span className="sr-only">Data final</span><CalendarDays size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" /><input type="date" value={filterDataFim} onChange={event => setFilterDataFim(event.target.value)} className="h-10 w-full rounded-xl border border-[#2a302d] bg-[#151816] pl-9 pr-2 text-xs text-white outline-none focus:border-[#196b55]" /></label>
        </div>
      </section>

      <section>
        <article className="overflow-hidden rounded-[20px] border border-[#252b28] bg-[#0d100f]">
          <header className="flex items-center justify-between gap-3 border-b border-[#252b28] px-4 py-3 sm:px-5">
            <div><h3 className="text-xs font-bold text-[#f5f4ef]">Histórico de ajustes</h3><p className="mt-0.5 text-[10px] text-zinc-500">Ordem cronológica, do registro mais recente ao mais antigo</p></div>
            <span className="rounded-full border border-[#2a302d] bg-[#151816] px-2.5 py-1 text-[9px] font-bold text-zinc-500">{filteredMovs.length} registro(s)</span>
          </header>
          {filteredMovs.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center"><History size={24} className="text-zinc-700" /><strong className="mt-3 text-xs text-zinc-400">Nenhuma movimentação encontrada</strong><span className="mt-1 max-w-sm text-[10px] leading-relaxed text-zinc-600">Revise os filtros ou use o Turno atual para registrar sangria ou suprimento.</span></div>
          ) : (
            <ul className="divide-y divide-[#202522]">
              {filteredMovs.map(movimentacao => {
                const isSupply = movimentacao.tipo === 'suprimento';
                const date = new Date(movimentacao.criado_em);
                return (
                  <li key={movimentacao.id} className="grid gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.015] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-5">
                    <span className={clsx('flex h-9 w-9 items-center justify-center rounded-xl border', isSupply ? 'border-[#145c49] bg-[#0b2d25] text-[#54d9b3]' : 'border-[#543535] bg-[#211414] text-[#dfabab]')}>{isSupply ? <ArrowDownRight size={15} /> : <ArrowUpRight size={15} />}</span>
                    <span className="min-w-0"><span className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><strong className="truncate text-xs text-[#f5f4ef]">{movimentacao.descricao || (isSupply ? 'Suprimento' : 'Sangria')}</strong><span className="text-[9px] text-zinc-600">{date.toLocaleDateString('pt-BR')} · {date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></span><span className="mt-0.5 block truncate text-[10px] text-zinc-500">{movimentacao.usuario_nome || 'Operador'}{movimentacao.observacao ? ` · ${movimentacao.observacao}` : ''}</span><span className="mt-1 block text-[9px] tabular-nums text-zinc-600">Saldo: {formatCurrency(Number(movimentacao.saldo_anterior || 0))} → {formatCurrency(Number(movimentacao.saldo_posterior || 0))}</span></span>
                    <strong className={clsx('whitespace-nowrap text-sm font-bold tabular-nums sm:text-right', isSupply ? 'text-[#54d9b3]' : 'text-[#dfabab]')}>{isSupply ? '+' : '−'} {formatCurrency(Number(movimentacao.valor))}</strong>
                  </li>
                );
              })}
            </ul>
          )}
        </article>

      </section>
    </div>
  );
};
