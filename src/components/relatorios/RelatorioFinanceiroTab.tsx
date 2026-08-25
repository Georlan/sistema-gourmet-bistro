import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Filter, RefreshCw, WalletCards } from 'lucide-react';
import { localCalendarDate } from '../../utils/dateTime';
import { OperationalBanner } from '../shared/OperationalBanner';
import { fetchReportJson, useReportRealtimeRefresh } from './useReportRealtimeRefresh';

interface RelatorioFinanceiroTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatMoney = (value: number | null | undefined) => money.format(Number(value) || 0);
const formatDate = (value: string) => value.split('-').reverse().join('/');

export const RelatorioFinanceiroTab: React.FC<RelatorioFinanceiroTabProps> = ({
  apiBaseUrl,
  authHeaders,
}) => {
  const [periodoDias, setPeriodoDias] = useState('30');
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const requestRef = useRef(0);

  const fetchFinanceiroData = useCallback(async () => {
    const requestId = ++requestRef.current;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - Number(periodoDias));
      const nextStats = await fetchReportJson<any>(
        `${apiBaseUrl}/comandas/estatisticas/geral?data_inicio=${localCalendarDate(startDate)}&data_fim=${localCalendarDate(endDate)}`,
        authHeaders,
      );
      if (requestRef.current === requestId) setStats(nextStats);
    } catch (error) {
      console.error(error);
      if (requestRef.current === requestId) setErrorMsg('Não foi possível carregar a conciliação financeira.');
    } finally {
      if (requestRef.current === requestId) setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders, periodoDias]);

  useEffect(() => {
    void fetchFinanceiroData();
    return () => { requestRef.current += 1; };
  }, [fetchFinanceiroData]);

  useReportRealtimeRefresh(fetchFinanceiroData);

  const gross = Number(stats?.vendas_brutas || 0);
  const refunds = Number(stats?.estornos || 0);
  const net = Number(stats?.vendas_liquidas ?? stats?.faturamento ?? 0);
  const todayNet = Number(stats?.faturamento_hoje || 0);
  const totalAccounts = Number(stats?.total_pedidos || 0);
  const netAverageTicket = Number(stats?.ticket_medio || 0);
  const grossBreakdown = stats?.breakdown_bruto || {};
  const refundBreakdown = stats?.breakdown_estornos || {};
  const netBreakdown = stats?.breakdown_pagamentos || {};

  const methods = useMemo(() => [
    { key: 'pix', name: 'Pix', gross: Number(grossBreakdown.pix || 0), refunds: Number(refundBreakdown.pix || 0), net: Number(netBreakdown.pix || 0) },
    { key: 'cartao', name: 'Cartão', gross: Number(grossBreakdown.cartao || 0), refunds: Number(refundBreakdown.cartao || 0), net: Number(netBreakdown.cartao || 0) },
    { key: 'dinheiro', name: 'Dinheiro', gross: Number(grossBreakdown.dinheiro || 0), refunds: Number(refundBreakdown.dinheiro || 0), net: Number(netBreakdown.dinheiro || 0) },
  ], [grossBreakdown, refundBreakdown, netBreakdown]);

  const operationalRange = stats?.dia_operacional_inicio && stats?.dia_operacional_fim
    ? `${formatDate(stats.dia_operacional_inicio)} a ${formatDate(stats.dia_operacional_fim)}`
    : `últimos ${periodoDias} dias`;

  return (
    <div className="space-y-5 text-left animate-fade-in">
      <OperationalBanner
        id="reports-financial-heading"
        eyebrow="FINANCEIRO"
        title="Dinheiro"
        accent="sem desencontro"
        description={`Pagamentos aprovados menos estornos, por dia operacional · ${operationalRange}.`}
        metrics={[
          { label: 'receita líquida', value: formatMoney(net) },
          { label: 'vendas brutas', value: formatMoney(gross) },
          { label: 'estornos', value: formatMoney(refunds), valueClassName: refunds > 0 ? 'text-rose-600 dark:text-rose-300' : undefined },
          { label: 'ticket médio', value: formatMoney(netAverageTicket) },
        ]}
      />

      <div className="flex flex-col gap-3 rounded-2xl border border-koma-border bg-koma-panel p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-koma-muted">
          <span><strong className="text-koma-foreground">{totalAccounts}</strong> {totalAccounts === 1 ? 'conta recebida' : 'contas recebidas'}</span>
          <span>Hoje: <strong className="text-emerald-700 dark:text-emerald-300">{formatMoney(todayNet)}</strong></span>
          <span className="hidden md:inline">Bruto − estornos = líquido</span>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-2.5 py-2 sm:flex-none">
            <Filter size={12} className="text-koma-subtle" />
            <select value={periodoDias} onChange={(event) => setPeriodoDias(event.target.value)} className="min-w-0 flex-1 cursor-pointer bg-transparent text-xs font-bold text-koma-foreground focus:outline-none">
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
            </select>
          </div>
          <button type="button" onClick={() => void fetchFinanceiroData()} className="cursor-pointer rounded-xl border border-koma-border bg-koma-raised p-2 text-koma-subtle transition-all hover:text-koma-foreground" title="Atualizar relatório" aria-label="Atualizar relatório financeiro">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-2xl border border-koma-danger-border bg-koma-danger-bg p-3 text-xs text-koma-danger-text">
          <AlertCircle size={16} className="shrink-0" /> {errorMsg}
        </div>
      )}

      <section className="overflow-hidden rounded-3xl border border-koma-border bg-koma-panel shadow-xs" aria-labelledby="payment-methods-heading">
        <div className="flex flex-col gap-1 border-b border-koma-border p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
          <div>
            <h3 id="payment-methods-heading" className="flex items-center gap-2 font-serif text-sm font-bold text-koma-foreground">
              <WalletCards size={16} className="text-emerald-700 dark:text-emerald-300" /> Recebimentos por meio
            </h3>
            <p className="mt-1 text-[10px] text-koma-muted">A barra mostra a participação no líquido; os valores permitem conferir bruto e estorno sem repetir gráficos.</p>
          </div>
          <strong className="font-mono text-sm text-emerald-700 dark:text-emerald-300">{formatMoney(net)}</strong>
        </div>

        <div className="divide-y divide-koma-border">
          {methods.map((method) => {
            const share = net > 0 ? Math.max(0, Math.min(100, (method.net / net) * 100)) : 0;
            return (
              <article key={method.key} className="grid gap-3 p-4 transition-colors hover:bg-koma-raised/40 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(12rem,2fr)_repeat(3,minmax(7rem,0.8fr))] sm:items-center sm:px-5">
                <div className="flex items-center justify-between sm:block">
                  <strong className="text-xs text-koma-foreground">{method.name}</strong>
                  <span className="text-[10px] font-bold text-koma-muted sm:hidden">{share.toFixed(0)}%</span>
                </div>
                <div className="space-y-1.5">
                  <div className="h-2 overflow-hidden rounded-full bg-koma-input">
                    <div className="h-full rounded-full bg-emerald-600 transition-all duration-500" style={{ width: `${share}%` }} />
                  </div>
                  <span className="hidden text-[9px] text-koma-muted sm:block">{share.toFixed(0)}% da receita líquida</span>
                </div>
                <div className="flex justify-between gap-2 sm:block sm:text-right"><span className="text-[9px] uppercase text-koma-muted">Bruto</span><strong className="block font-mono text-xs text-koma-foreground">{formatMoney(method.gross)}</strong></div>
                <div className="flex justify-between gap-2 sm:block sm:text-right"><span className="text-[9px] uppercase text-koma-muted">Estornos</span><strong className="block font-mono text-xs text-rose-700 dark:text-rose-300">− {formatMoney(method.refunds)}</strong></div>
                <div className="flex justify-between gap-2 sm:block sm:text-right"><span className="text-[9px] uppercase text-koma-muted">Líquido</span><strong className="block font-mono text-xs text-emerald-700 dark:text-emerald-300">{formatMoney(method.net)}</strong></div>
              </article>
            );
          })}
        </div>

        <div className="flex flex-col gap-1 border-t border-koma-border bg-koma-raised px-4 py-3 text-xs font-bold text-koma-foreground sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <span>Conferência do período</span>
          <span className="font-mono">{formatMoney(gross)} − {formatMoney(refunds)} = {formatMoney(net)}</span>
        </div>
      </section>
    </div>
  );
};
