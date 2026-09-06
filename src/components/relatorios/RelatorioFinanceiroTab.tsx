import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Calendar as CalendarIcon, RefreshCw, WalletCards } from 'lucide-react';
import { KomaSnapshotLoading } from '../shared/KomaSnapshotLoading';
import { OperationalBanner } from '../shared/OperationalBanner';
import { fetchReportJson, useReportRealtimeRefresh } from './useReportRealtimeRefresh';
import { PeriodoCalendarioModal } from './PeriodoCalendarioModal';
import { ReportActionBar } from './ReportActionBar';
import { useSharedReportPeriod } from './useSharedReportPeriod';

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
  const { dataInicio, dataFim, applyPeriod } = useSharedReportPeriod();
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const requestRef = useRef(0);

  const fetchFinanceiroData = useCallback(async () => {
    const requestId = ++requestRef.current;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const nextStats = await fetchReportJson<any>(
        `${apiBaseUrl}/comandas/estatisticas/geral?data_inicio=${dataInicio}&data_fim=${dataFim}`,
        authHeaders,
      );
      if (requestRef.current === requestId) setStats(nextStats);
    } catch (error) {
      console.error(error);
      if (requestRef.current === requestId) setErrorMsg('Não foi possível carregar a conciliação financeira.');
    } finally {
      if (requestRef.current === requestId) setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders, dataFim, dataInicio]);

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
  const comparison = stats?.comparativo_anterior || {};
  const hasPrevious = Boolean(comparison.tem_base_anterior);
  const netDelta = Number(comparison.variacao_recebido_pct || 0);

  const methods = useMemo(() => [
    { key: 'pix', name: 'Pix', gross: Number(grossBreakdown.pix || 0), refunds: Number(refundBreakdown.pix || 0), net: Number(netBreakdown.pix || 0) },
    { key: 'cartao', name: 'Cartão', gross: Number(grossBreakdown.cartao || 0), refunds: Number(refundBreakdown.cartao || 0), net: Number(netBreakdown.cartao || 0) },
    { key: 'dinheiro', name: 'Dinheiro', gross: Number(grossBreakdown.dinheiro || 0), refunds: Number(refundBreakdown.dinheiro || 0), net: Number(netBreakdown.dinheiro || 0) },
  ], [grossBreakdown, refundBreakdown, netBreakdown]);

  const operationalRange = stats?.dia_operacional_inicio && stats?.dia_operacional_fim
    ? `${formatDate(stats.dia_operacional_inicio)} a ${formatDate(stats.dia_operacional_fim)}`
    : `${formatDate(dataInicio)} a ${formatDate(dataFim)}`;

  if (!stats) {
    return (
      <KomaSnapshotLoading
        testId="financial-report-snapshot-loading"
        title="Sincronizando financeiro"
        description="Conferindo recebimentos, estornos e meios de pagamento antes de mostrar os valores do período."
        error={!isLoading ? errorMsg : null}
        errorDescription="Ainda não foi possível confirmar os valores financeiros. O KÔMA não vai substituir dados desconhecidos por zero."
        onRetry={() => void fetchFinanceiroData()}
      />
    );
  }

  return (
    <div className="space-y-5 text-left animate-fade-in">
      <OperationalBanner
        id="reports-financial-heading"
        eyebrow="FINANCEIRO"
        title="Recebimentos"
        accent="sob controle"
        description={`O que foi aprovado e devolvido, por dia operacional · ${operationalRange}.`}
        metrics={[
          { label: 'recebido após estornos', value: formatMoney(net) },
          { label: 'pagamentos aprovados', value: formatMoney(gross) },
          { label: 'valor devolvido', value: formatMoney(refunds), valueClassName: refunds > 0 ? 'text-rose-600 dark:text-rose-300' : undefined },
          { label: 'média por conta', value: formatMoney(netAverageTicket) },
        ]}
      />

      <ReportActionBar info={(
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span><strong className="text-koma-foreground">{totalAccounts}</strong> {totalAccounts === 1 ? 'conta recebida' : 'contas recebidas'}</span>
          <span>Hoje: <strong className="text-emerald-700 dark:text-emerald-300">{formatMoney(todayNet)}</strong></span>
          {hasPrevious && <span className={netDelta < 0 ? 'font-bold text-rose-700 dark:text-rose-300' : 'font-bold text-emerald-700 dark:text-emerald-300'}>Recebido {netDelta >= 0 ? '+' : ''}{netDelta.toLocaleString('pt-BR')}% vs. período anterior</span>}
        </div>
      )}>
          <button type="button" onClick={() => setShowCalendarModal(true)} className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-koma-foreground transition-all hover:bg-koma-card">
            <CalendarIcon size={14} className="text-emerald-700 dark:text-emerald-300" /> Período
          </button>
          <button type="button" onClick={() => void fetchFinanceiroData()} className="cursor-pointer rounded-xl border border-koma-border bg-koma-raised p-2 text-koma-subtle transition-all hover:text-koma-foreground" title="Atualizar relatório" aria-label="Atualizar relatório financeiro">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
      </ReportActionBar>

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

      <div className="flex items-start gap-2 rounded-2xl border border-koma-border bg-koma-panel p-3 text-[10px] leading-relaxed text-koma-muted">
        <AlertCircle size={14} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
        <span><strong className="text-koma-foreground">Sobre o valor exibido:</strong> taxas da maquininha, antecipação e delivery ainda não são descontadas. O total mostra pagamentos aprovados menos devoluções registradas.</span>
      </div>

      {showCalendarModal && (
        <PeriodoCalendarioModal
          onClose={() => setShowCalendarModal(false)}
          dataInicio={dataInicio}
          dataFim={dataFim}
          onApply={applyPeriod}
        />
      )}
    </div>
  );
};
