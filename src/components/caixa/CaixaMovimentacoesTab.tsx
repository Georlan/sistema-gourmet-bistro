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
import {
  formatBackendDateTime,
  formatBackendTime,
  localCalendarDate,
  parseBackendTimestamp,
} from '../../utils/dateTime';

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

      const createdAt = parseBackendTimestamp(movimentacao.criado_em);
      if (filterDataInicio && (!createdAt || createdAt < new Date(`${filterDataInicio}T00:00:00`))) return false;
      if (filterDataFim && (!createdAt || createdAt > new Date(`${filterDataFim}T23:59:59.999`))) return false;

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

  const latestMovementTime = useMemo(() => {
    const latestTimestamp = filteredMovs.reduce((latest, movimentacao) => {
      const timestamp = parseBackendTimestamp(movimentacao.criado_em)?.getTime() ?? Number.NaN;
      return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
    }, 0);
    return latestTimestamp > 0
      ? formatBackendTime(latestTimestamp)
      : '—';
  }, [filteredMovs]);

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
      formatBackendDateTime(movimentacao.criado_em),
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
    anchor.download = `movimentacoes-caixa-${localCalendarDate()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (isLoading && movimentacoes.length === 0) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Carregando movimentações do caixa">
        <div className="h-24 animate-pulse rounded-2xl border border-koma-border bg-koma-panel" />
        <div className="h-24 animate-pulse rounded-[20px] border border-koma-border bg-koma-panel" />
        <div className="h-80 animate-pulse rounded-[22px] border border-koma-border bg-koma-panel" />
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
          { label: 'suprimentos', value: formatCurrency(totals.suprimentos), valueClassName: 'text-emerald-800 dark:text-emerald-300' },
          { label: 'sangrias', value: formatCurrency(totals.sangrias), valueClassName: 'text-rose-800 dark:text-rose-300' },
          { label: 'saldo dos ajustes', value: formatCurrency(totals.suprimentos - totals.sangrias), valueClassName: totals.suprimentos >= totals.sangrias ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300' },
          { label: 'último no recorte', value: latestMovementTime },
        ]}
      />

      <section className="rounded-[20px] border border-koma-border bg-koma-panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em] text-koma-muted"><Filter size={13} className="text-emerald-800 dark:text-emerald-300" /> Filtros</span>
          <div className="flex items-center gap-2">
            {hasFilters && <button type="button" onClick={clearFilters} className="px-2 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 hover:text-[#7becce]">Limpar filtros</button>}
            <button type="button" onClick={exportCsv} disabled={filteredMovs.length === 0} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#303532] bg-koma-card px-3 py-2 text-[10px] font-bold text-koma-secondary transition-colors hover:border-emerald-300 dark:border-emerald-900/50 hover:text-emerald-800 dark:text-emerald-300 disabled:opacity-40">
              <Download size={13} /> Exportar CSV
            </button>
          </div>
        </div>
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1.3fr)_minmax(170px,.7fr)_minmax(155px,.6fr)_minmax(155px,.6fr)]">
          <label className="relative">
            <span className="sr-only">Buscar movimentação</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
            <input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Buscar motivo, observação ou operador" className="h-9 sm:h-10 w-full rounded-xl border border-koma-border bg-koma-card pl-9 pr-3 text-xs text-koma-foreground outline-none transition-colors placeholder:text-koma-muted focus:border-emerald-500" />
          </label>
          <select value={filterTipo} onChange={event => setFilterTipo(event.target.value)} className="h-9 sm:h-10 w-full rounded-xl border border-koma-border bg-koma-card px-3 text-xs text-koma-foreground outline-none focus:border-emerald-500">
            <option value="todos">Todas as operações</option>
            <option value="suprimento">Suprimentos</option>
            <option value="sangria">Sangrias</option>
          </select>
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 xl:col-span-2">
            <label className="relative"><span className="sr-only">Data inicial</span><CalendarDays size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" /><input type="date" value={filterDataInicio} onChange={event => setFilterDataInicio(event.target.value)} className="h-9 sm:h-10 w-full rounded-xl border border-koma-border bg-koma-card pl-9 pr-2 text-[11px] text-koma-foreground outline-none focus:border-emerald-500" /></label>
            <label className="relative"><span className="sr-only">Data final</span><CalendarDays size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" /><input type="date" value={filterDataFim} onChange={event => setFilterDataFim(event.target.value)} className="h-9 sm:h-10 w-full rounded-xl border border-koma-border bg-koma-card pl-9 pr-2 text-[11px] text-koma-foreground outline-none focus:border-emerald-500" /></label>
          </div>
        </div>
      </section>

      <section>
        <article className="overflow-hidden rounded-[20px] border border-koma-border bg-koma-panel">
          <header className="flex items-center justify-between gap-3 border-b border-koma-border px-4 py-3 sm:px-5">
            <div><h3 className="text-xs font-bold text-koma-foreground">Histórico de ajustes</h3><p className="mt-0.5 text-[10px] text-koma-muted">Ordem cronológica, do registro mais recente ao mais antigo</p></div>
            <span className="rounded-full border border-koma-border bg-koma-card px-2.5 py-1 text-[9px] font-bold text-koma-muted">{filteredMovs.length} registro(s)</span>
          </header>
          {filteredMovs.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center"><History size={24} className="text-koma-muted" /><strong className="mt-3 text-xs text-koma-subtle">Nenhuma movimentação encontrada</strong><span className="mt-1 max-w-sm text-[10px] leading-relaxed text-koma-muted">Revise os filtros ou use o Turno atual para registrar sangria ou suprimento.</span></div>
          ) : (
            <ul className="divide-y divide-koma-border">
              {filteredMovs.map(movimentacao => {
                const isSupply = movimentacao.tipo === 'suprimento';
                const dateLabel = formatBackendDateTime(movimentacao.criado_em, {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });
                return (
                  <li key={movimentacao.id} className="grid gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.015] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-5">
                    <span className={clsx('flex h-9 w-9 items-center justify-center rounded-xl border', isSupply ? 'border-emerald-300 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300' : 'border-rose-300 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300')}>{isSupply ? <ArrowDownRight size={15} /> : <ArrowUpRight size={15} />}</span>
                    <span className="min-w-0"><span className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><strong className="truncate text-xs text-koma-foreground">{movimentacao.descricao || (isSupply ? 'Suprimento' : 'Sangria')}</strong><span className="text-[9px] text-koma-muted">{dateLabel}</span></span><span className="mt-0.5 block truncate text-[10px] text-koma-muted">{movimentacao.usuario_nome || 'Operador'}{movimentacao.observacao ? ` · ${movimentacao.observacao}` : ''}</span><span className="mt-1 block text-[9px] tabular-nums text-koma-muted">Saldo: {formatCurrency(Number(movimentacao.saldo_anterior || 0))} → {formatCurrency(Number(movimentacao.saldo_posterior || 0))}</span></span>
                    <strong className={clsx('whitespace-nowrap text-sm font-bold tabular-nums sm:text-right', isSupply ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300')}>{isSupply ? '+' : '−'} {formatCurrency(Number(movimentacao.valor))}</strong>
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
