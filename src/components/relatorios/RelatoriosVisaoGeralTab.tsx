import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  TrendingUp,
  TrendingDown,
  Target,
  Calendar as CalendarIcon,
  Download,
  Eye,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import { PeriodoCalendarioModal } from './PeriodoCalendarioModal';
import { VendasDetalhesDrawer, VendaDetalheItem } from './VendasDetalhesDrawer';
import { MoneyInput } from '../MoneyInput';
import { OperationalBanner } from '../shared/OperationalBanner';
import { fetchReportJson, useReportRealtimeRefresh } from './useReportRealtimeRefresh';
import { ReportActionBar } from './ReportActionBar';
import { useSharedReportPeriod } from './useSharedReportPeriod';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatMoney = (value: number | null | undefined) => money.format(Number(value) || 0);
const formatDate = (value: string) => value.split('-').reverse().join('/');

interface RelatoriosVisaoGeralTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  showToast: (msg: string) => void;
}

const CustomChartTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-koma-panel border border-koma-border p-3 rounded-2xl shadow-xl text-left font-sans space-y-1 z-50">
        <p className="text-[10px] font-bold text-koma-subtle">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-xs font-bold font-mono" style={{ color: entry.color }}>
            {entry.name}: {typeof entry.value === 'number' && (entry.name.toLowerCase().includes('faturam') || entry.name.toLowerCase().includes('total')) ? formatMoney(entry.value) : entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export const RelatoriosVisaoGeralTab: React.FC<RelatoriosVisaoGeralTabProps> = ({
  apiBaseUrl,
  authHeaders,
  showToast,
}) => {
  const { dataInicio, dataFim, applyPeriod } = useSharedReportPeriod();
  const [isLoading, setIsLoading] = useState(false);

  // Modals & Drawers
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [showVendasDrawer, setShowVendasDrawer] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [newMetaInput, setNewMetaInput] = useState<number | ''>('');

  const [data, setData] = useState<any>(null);
  const [hasError, setHasError] = useState(false);
  const [vendasDetalhes, setVendasDetalhes] = useState<VendaDetalheItem[]>([]);
  const [isLoadingVendas, setIsLoadingVendas] = useState(false);
  const requestRef = useRef(0);

  const fetchVisaoGeral = useCallback(async (inicio = dataInicio, fim = dataFim) => {
    const requestId = ++requestRef.current;
    setIsLoading(true);
    setHasError(false);
    try {
      const json = await fetchReportJson<any>(
        `${apiBaseUrl}/relatorios/visao-geral?data_inicio=${inicio}&data_fim=${fim}`,
        authHeaders,
      );
      if (requestRef.current === requestId) setData(json);
    } catch (err) {
      console.error('Erro ao buscar visão geral:', err);
      if (requestRef.current === requestId) setHasError(true);
    } finally {
      if (requestRef.current === requestId) setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders, dataFim, dataInicio]);

  const fetchVendasDetalhes = async (inicio: string, fim: string) => {
    setIsLoadingVendas(true);
    try {
      const res = await fetch(
        `${apiBaseUrl}/relatorios/vendas-detalhes?data_inicio=${inicio}&data_fim=${fim}`,
        { headers: authHeaders }
      );
      if (res.ok) {
        const json = await res.json();
        setVendasDetalhes(json);
      }
    } catch (err) {
      console.error('Erro ao buscar detalhes das vendas:', err);
    } finally {
      setIsLoadingVendas(false);
    }
  };

  useEffect(() => {
    void fetchVisaoGeral();
    return () => { requestRef.current += 1; };
  }, [fetchVisaoGeral]);

  useReportRealtimeRefresh(fetchVisaoGeral);

  const handleApplyPeriod = (inicio: string, fim: string) => {
    applyPeriod(inicio, fim);
  };

  const handleSaveMeta = async () => {
    const val = Number(newMetaInput);
    if (newMetaInput === '' || !Number.isFinite(val) || val < 0) {
      showToast('Por favor insira um valor válido de meta.');
      return;
    }
    try {
      const res = await fetch(`${apiBaseUrl}/relatorios/meta-mensal`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta_mensal: val }),
      });
      if (res.ok) {
        showToast('✓ Meta mensal atualizada com sucesso!');
        setEditingMeta(false);
        fetchVisaoGeral(dataInicio, dataFim);
      }
    } catch (err) {
      showToast('Erro ao salvar meta mensal.');
    }
  };

  const handleExportCsv = () => {
    if (!data) return;
    let csv = 'Métrica;Valor\n';
    csv += `Recebimentos Líquidos (R$);${data.faturamento_total}\n`;
    csv += `Total de Pedidos;${data.total_pedidos}\n`;
    csv += `Ticket Médio (R$);${data.ticket_medio}\n`;
    csv += `Clientes Ativos;${data.clientes_ativos}\n`;
    csv += `Meta Mensal (R$);${data.meta_mensal}\n`;
    csv += `Meta Realizada (R$);${data.meta_realizada}\n`;
    csv += `Meta Restante (R$);${data.meta_restante}\n`;
    csv += `Progresso Meta (%);${data.meta_percentual}%\n`;
    csv += `Projeção Ritmo Atual (R$);${data.meta_projecao}\n`;
    csv += `Média Diária Necessária (R$);${data.meta_media_diaria_necessaria}\n`;

    csv += '\nData;Pedidos por Dia;Recebido (R$)\n';
    (data.vendas_por_dia || []).forEach((v: any) => {
      csv += `"${v.data}";${v.quantidade_pedidos};${v.total.toFixed(2)}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `relatorio_visao_geral_${dataInicio}_a_${dataFim}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Process data for charts
  const vendasPorDiaChartData = (data?.vendas_por_dia || []).map((item: any) => ({
    data: item.data ? item.data.split('-').slice(1).reverse().join('/') : '',
    faturamento: item.total || 0,
    pedidos: item.quantidade_pedidos || 0,
  }));

  const horariosPicoChartData = (data?.horarios_pico || [])
    .filter((h: any) => h.total_pedidos > 0)
    .map((h: any) => ({
      hora: h.hora,
      pedidos: h.total_pedidos,
      faturamento: h.faturamento || 0,
    }));

  const quickRead = useMemo(() => {
    const comparison = data?.comparativo_anterior || {};
    const hasPrevious = Boolean(
      comparison.tem_base_anterior
      ?? (Number(comparison.faturamento_anterior || 0) > 0 || Number(comparison.pedidos_anteriores || 0) > 0)
    );
    const revenueDelta = Number(comparison.variacao_faturamento_pct || 0);
    const ordersDelta = Number(comparison.variacao_pedidos_pct || 0);
    const peak = [...(data?.horarios_pico || [])]
      .filter((row: any) => Number(row.total_pedidos || 0) > 0)
      .sort((a: any, b: any) => Number(b.total_pedidos || 0) - Number(a.total_pedidos || 0))[0];
    const gross = Number(data?.vendas_brutas || 0);
    const refunds = Number(data?.estornos || 0);
    return {
      hasPrevious,
      revenueDelta,
      ordersDelta,
      peak,
      refundRate: gross > 0 ? (refunds / gross) * 100 : 0,
      refunds,
    };
  }, [data]);

  return (
    <div className={clsx('space-y-6', 'text-left', 'animate-fade-in')}>
      <OperationalBanner
        id="reports-overview-heading"
        eyebrow="VISÃO GERAL"
        title="Decisões"
        accent="em uma leitura"
        description={`Resultados de ${formatDate(dataInicio)} a ${formatDate(dataFim)}, atualizados pela operação.`}
        metrics={[
          { label: 'vendas líquidas', value: formatMoney(data?.faturamento_total) },
          { label: data?.total_pedidos === 1 ? 'pedido recebido' : 'pedidos recebidos', value: data?.total_pedidos ?? 0 },
          { label: 'ticket médio', value: formatMoney(data?.ticket_medio) },
          { label: data?.clientes_ativos === 1 ? 'cliente cadastrado' : 'clientes cadastrados', value: data?.clientes_ativos ?? 0 },
        ]}
      />

      <ReportActionBar info={(
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={clsx('h-2 w-2 rounded-full', isLoading ? 'animate-pulse bg-amber-500' : 'bg-emerald-500')} />
          <span>{isLoading ? 'Atualizando indicadores…' : 'Pagamentos aprovados menos estornos'}</span>
          {quickRead.hasPrevious && (
            <span className={quickRead.revenueDelta < 0 ? 'font-bold text-rose-700 dark:text-rose-300' : 'font-bold text-emerald-700 dark:text-emerald-300'}>
              Recebido {quickRead.revenueDelta >= 0 ? '+' : ''}{quickRead.revenueDelta.toLocaleString('pt-BR')}% vs. período anterior
            </span>
          )}
        </div>
      )}>
          <button
            type="button"
            onClick={() => {
              setShowVendasDrawer(true);
              fetchVendasDetalhes(dataInicio, dataFim);
            }}
            className="px-3.5 py-2 bg-emerald-500/15 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 rounded-xl text-[10px] font-extrabold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            <Eye size={14} />
            Ver vendas
          </button>

          <button
            type="button"
            onClick={() => setShowCalendarModal(true)}
            className="px-3.5 py-2 bg-koma-raised hover:bg-koma-card border border-koma-border text-koma-foreground rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5"
          >
            <CalendarIcon size={14} className="text-emerald-700 dark:text-emerald-400" />
            Período
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!data}
            className="px-3 py-2 bg-koma-raised hover:bg-koma-card border border-koma-border text-koma-muted hover:text-koma-foreground rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            title="Exportar CSV"
          >
            <Download size={14} />
            Exportar
          </button>
      </ReportActionBar>

      {hasError && !isLoading && (
        <div className="bg-koma-panel border border-rose-900/50 rounded-3xl p-8 text-center space-y-4 max-w-md mx-auto my-6 animate-fade-in">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
            <span className="font-bold text-lg">!</span>
          </div>
          <div className="space-y-1">
            <h3 className="text-koma-foreground font-bold text-sm">Não foi possível carregar os dados</h3>
            <p className="text-koma-subtle text-xs">Ocorreu uma falha ao comunicar com o servidor. Por favor, tente novamente.</p>
          </div>
          <button
            onClick={() => fetchVisaoGeral(dataInicio, dataFim)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-koma-foreground font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {!hasError && data && (
        <section className="grid grid-cols-1 gap-3 lg:grid-cols-3" aria-label="Leitura rápida para decisão">
          <article className={clsx('rounded-2xl border p-4', quickRead.hasPrevious && quickRead.revenueDelta < 0 ? 'border-rose-500/30 bg-rose-500/10' : 'border-koma-border bg-koma-panel')}>
            <div className="flex items-start gap-3">
              {quickRead.revenueDelta < 0
                ? <TrendingDown size={17} className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-300" />
                : <TrendingUp size={17} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" />}
              <div>
                <strong className="block text-xs text-koma-foreground">
                  {quickRead.hasPrevious ? `Recebido ${quickRead.revenueDelta >= 0 ? 'subiu' : 'caiu'} ${Math.abs(quickRead.revenueDelta).toLocaleString('pt-BR')}%` : 'Primeiro período comparável'}
                </strong>
                <span className="mt-1 block text-[10px] text-koma-muted">
                  {quickRead.hasPrevious ? `O volume de pedidos variou ${quickRead.ordersDelta >= 0 ? '+' : ''}${quickRead.ordersDelta.toLocaleString('pt-BR')}%.` : 'O próximo período mostrará a evolução dos recebimentos e pedidos.'}
                </span>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-koma-border bg-koma-panel p-4">
            <div className="flex items-start gap-3">
              <Clock size={17} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
              <div>
                <strong className="block text-xs text-koma-foreground">{quickRead.peak ? `Pico de movimento às ${quickRead.peak.hora}` : 'Sem horário de pico'}</strong>
                <span className="mt-1 block text-[10px] text-koma-muted">
                  {quickRead.peak ? `${quickRead.peak.total_pedidos} conta${quickRead.peak.total_pedidos === 1 ? '' : 's'} recebida${quickRead.peak.total_pedidos === 1 ? '' : 's'} nessa faixa; planeje a equipe para esse momento.` : 'Ainda não há vendas suficientes no período para orientar a escala.'}
                </span>
              </div>
            </div>
          </article>

          <article className={clsx('rounded-2xl border p-4', quickRead.refunds > 0 ? 'border-rose-500/30 bg-rose-500/10' : 'border-koma-border bg-koma-panel')}>
            <div className="flex items-start gap-3">
              <ShieldCheck size={17} className={quickRead.refunds > 0 ? 'mt-0.5 shrink-0 text-rose-600 dark:text-rose-300' : 'mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300'} />
              <div>
                <strong className="block text-xs text-koma-foreground">{quickRead.refunds > 0 ? `${quickRead.refundRate.toFixed(1).replace('.', ',')}% devolvido` : 'Nenhum estorno no período'}</strong>
                <span className="mt-1 block text-[10px] text-koma-muted">{quickRead.refunds > 0 ? `${formatMoney(quickRead.refunds)} em estornos pedem revisão.` : 'A receita líquida não sofreu redução por devoluções.'}</span>
              </div>
            </div>
          </article>
        </section>
      )}

      {/* Meta Mensal Block */}
      <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-4 shadow-xs">
        <div className="flex justify-between items-center border-b border-koma-border pb-3">
          <div className="flex items-center gap-2">
            <Target size={18} className="text-emerald-700 dark:text-emerald-400" />
            <span className="font-serif font-bold text-sm text-koma-foreground">Acompanhamento da Meta Mensal</span>
          </div>
          {editingMeta ? (
            <div className="flex items-center gap-2">
              <MoneyInput
                placeholder="0,00"
                value={newMetaInput}
                onValueChange={setNewMetaInput}
                selectOnFocus
                aria-label="Meta mensal"
                className="px-2.5 py-1 bg-koma-input border border-koma-border rounded-xl text-koma-foreground font-mono text-[10px] w-28 outline-none focus:border-emerald-500/50"
              />
              <button
                type="button"
                onClick={handleSaveMeta}
                className="px-3 py-1 koma-btn-success rounded-lg text-[9px] font-extrabold uppercase transition-all cursor-pointer shadow-xs"
              >
                Salvar
              </button>
              <button
                type="button"
                onClick={() => setEditingMeta(false)}
                className="px-2 py-1 bg-koma-raised text-koma-muted hover:text-koma-foreground rounded-lg text-[9px] font-bold"
              >
                X
              </button>
            </div>
          ) : (
            (data?.meta_mensal || 0) > 0 && (
              <button
                type="button"
                onClick={() => {
                  setNewMetaInput(Number(data?.meta_mensal || 0));
                  setEditingMeta(true);
                }}
                className="px-3 py-1 bg-koma-raised hover:bg-koma-card border border-koma-border text-koma-muted hover:text-koma-foreground rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer"
              >
                Configurar Meta
              </button>
            )
          )}
        </div>

        {(data?.meta_mensal || 0) <= 0 && !editingMeta ? (
          <div className="py-6 text-center space-y-3">
            <p className="text-xs text-koma-muted font-medium">Defina uma meta para acompanhar o ritmo do mês.</p>
            <button
              type="button"
              onClick={() => {
                setNewMetaInput('');
                setEditingMeta(true);
              }}
              className="px-5 py-2.5 koma-btn-success rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer inline-flex items-center gap-2 shadow-xs"
            >
              <Target size={15} />
              <span>Definir Meta Mensal</span>
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-[10px] font-mono">
                <span className="text-koma-subtle">
                  Realizado: <strong className="text-koma-foreground">{formatMoney(data?.meta_realizada)}</strong>
                </span>
                <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                  {data?.meta_percentual ?? 0}% Alcançado
                </span>
                <span className="text-koma-subtle">
                  Meta: <strong className="text-koma-foreground">{formatMoney(data?.meta_mensal)}</strong>
                </span>
              </div>

              <div className="w-full h-3 bg-koma-input border border-koma-border rounded-full overflow-hidden p-0.5">
                <div
                  className="h-full bg-[#10b981] rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, data?.meta_percentual || 0)}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-[10px]">
              <div className="bg-koma-raised/60 border border-koma-border/60 p-3 rounded-2xl space-y-1">
                <span className="text-koma-subtle text-[8px] font-bold uppercase tracking-wider block">Valor Restante</span>
                <strong className="text-sm font-mono text-koma-foreground block">
                  {formatMoney(data?.meta_restante)}
                </strong>
              </div>
              <div className="bg-koma-raised/60 border border-koma-border/60 p-3 rounded-2xl space-y-1">
                <span className="text-koma-subtle text-[8px] font-bold uppercase tracking-wider block">Projeção no Ritmo Atual</span>
                <strong className="text-sm font-mono text-emerald-400 block">
                  {formatMoney(data?.meta_projecao)}
                </strong>
              </div>
              <div className="bg-koma-raised/60 border border-koma-border/60 p-3 rounded-2xl space-y-1">
                <span className="text-koma-subtle text-[8px] font-bold uppercase tracking-wider block">Média Diária Necessária</span>
                <strong className="text-sm font-mono text-amber-400 block">
                  {formatMoney(data?.meta_media_diaria_necessaria)} / dia
                </strong>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Visão Gráfica: Evolução Diária & Horários de Pico */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-4">
          <div className="flex justify-between items-center border-b border-koma-border pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-emerald-700 dark:text-emerald-400" />
                <span className="font-serif font-bold text-sm text-koma-foreground">Recebimentos líquidos por dia</span>
            </div>
            <span className="text-[10px] text-koma-subtle">Receita líquida por dia</span>
          </div>

          <div className="h-64 w-full pt-2">
            {vendasPorDiaChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={vendasPorDiaChartData} margin={{ top: 10, right: 10, left: 12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="emeraldGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--koma-border-default)" vertical={false} opacity={0.6} />
                  <XAxis dataKey="data" stroke="var(--koma-text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--koma-text-muted)" fontSize={11} width={58} tickLine={false} axisLine={false} tickFormatter={(v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })} />
                  <Tooltip content={<CustomChartTooltip />} cursor={{ stroke: '#059669', strokeWidth: 1, strokeDasharray: '3 3' }} />
                  <Area type="monotone" dataKey="faturamento" name="Recebido (R$)" stroke="#059669" strokeWidth={2.5} fillOpacity={1} fill="url(#emeraldGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-koma-muted">Sem dados no período</div>
            )}
          </div>
        </div>

        <div className="bg-koma-panel border border-koma-border p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl space-y-4 shadow-xs">
          <div className="flex items-center gap-2 border-b border-koma-border pb-3">
            <Clock size={16} className="text-emerald-700 dark:text-emerald-400" />
            <span className="font-serif font-bold text-sm text-koma-foreground">Movimento por horário</span>
          </div>

          <div className="h-64 w-full pt-2">
            {horariosPicoChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={horariosPicoChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--koma-border-default)" vertical={false} opacity={0.6} />
                  <XAxis dataKey="hora" stroke="var(--koma-text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--koma-text-muted)" fontSize={11} width={28} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'var(--koma-border-default)', opacity: 0.3 }} />
                  <Bar dataKey="pedidos" name="Pedidos atendidos" fill="#059669" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-koma-muted">Nenhum pedido registrado nos horários</div>
            )}
          </div>
        </div>
      </div>

      <details className="group overflow-hidden rounded-3xl border border-koma-border bg-koma-panel shadow-xs">
        <summary className="flex cursor-pointer list-none items-center justify-between p-4 text-sm font-bold text-koma-foreground transition-colors hover:bg-koma-raised/60">
          <span>Ver detalhamento em tabelas</span>
          <span className="text-[10px] font-medium text-koma-muted group-open:hidden">Abrir</span>
          <span className="hidden text-[10px] font-medium text-koma-muted group-open:inline">Recolher</span>
        </summary>
      <div className="grid grid-cols-1 gap-4 border-t border-koma-border p-3 sm:p-4 lg:grid-cols-2">
        <div className="bg-koma-panel border border-koma-border p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl space-y-3 sm:space-y-4 shadow-xs">
          <div className="flex justify-between items-center border-b border-koma-border pb-2">
            <span className="font-serif font-bold text-sm text-koma-foreground">Detalhamento dos Pedidos por Dia</span>
          </div>

          <div className="overflow-x-auto border border-koma-border rounded-xl sm:rounded-2xl">
            <table className="w-full text-left text-[10px]">
              <thead className="bg-koma-raised border-b border-koma-border text-koma-subtle uppercase tracking-wider font-bold sticky top-0">
                <tr>
                  <th className="p-2.5 sm:p-3">Data</th>
                  <th className="p-2.5 sm:p-3 font-mono text-center">Qtd Pedidos</th>
                  <th className="p-2.5 sm:p-3 font-mono text-right">Recebido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-koma-border">
                {(data?.vendas_por_dia || []).map((v: any) => {
                  const parts = (v.data || '').split('-');
                  const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : v.data;
                  return (
                    <tr key={v.data} className="hover:bg-koma-raised/50 transition-colors">
                      <td className="p-2.5 sm:p-3 font-mono font-semibold text-koma-foreground">{formattedDate}</td>
                      <td className="p-2.5 sm:p-3 font-mono text-center font-bold text-koma-foreground">{v.quantidade_pedidos}</td>
                      <td className="p-2.5 sm:p-3 font-mono text-right font-extrabold text-emerald-700 dark:text-emerald-400">
                        {formatMoney(v.total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-4">
          <div className="flex items-center gap-2 border-b border-koma-border pb-2">
            <Clock size={16} className="text-emerald-700 dark:text-emerald-400" />
            <span className="font-serif font-bold text-sm text-koma-foreground">Detalhamento por Faixa Horária</span>
          </div>

          <div className="overflow-x-auto border border-koma-border rounded-2xl">
            <table className="w-full text-left text-[10px]">
              <thead className="bg-koma-raised border-b border-koma-border text-koma-subtle uppercase tracking-wider font-bold sticky top-0">
                <tr>
                  <th className="p-3">Horário</th>
                  <th className="p-3 font-mono text-center">Total Pedidos</th>
                  <th className="p-3 font-mono text-right">Recebido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-koma-border">
                {(data?.horarios_pico || [])
                  .filter((h: any) => h.total_pedidos > 0)
                  .map((h: any) => (
                    <tr key={h.hora} className="hover:bg-koma-raised/50 transition-colors">
                      <td className="p-3 font-mono font-bold text-koma-foreground">{h.hora}</td>
                      <td className="p-3 font-mono text-center text-koma-foreground font-bold">{h.total_pedidos}</td>
                      <td className="p-3 font-mono text-right font-bold text-emerald-400">
                        {formatMoney(h.faturamento)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      </details>

      {showCalendarModal && (
        <PeriodoCalendarioModal
          onClose={() => setShowCalendarModal(false)}
          dataInicio={dataInicio}
          dataFim={dataFim}
          onApply={handleApplyPeriod}
        />
      )}

      {showVendasDrawer && (
        <VendasDetalhesDrawer
          onClose={() => setShowVendasDrawer(false)}
          vendas={vendasDetalhes}
          isLoading={isLoadingVendas}
          dataInicio={dataInicio}
          dataFim={dataFim}
        />
      )}
    </div>
  );
};
