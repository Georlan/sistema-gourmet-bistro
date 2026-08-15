import React, { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, Filter, RefreshCw, BarChart3, AlertCircle, PieChart as PieIcon } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { localCalendarDate } from '../../utils/dateTime';

interface RelatorioFinanceiroTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

const CustomChartTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0];
    return (
      <div className="bg-koma-panel border border-koma-border p-3 rounded-2xl shadow-xl text-left font-sans space-y-1">
        <p className="text-[10px] font-bold text-koma-subtle">{data.name}</p>
        <p className="text-xs font-bold font-mono text-emerald-400">
          R$ {typeof data.value === 'number' ? data.value.toFixed(2) : data.value}
        </p>
      </div>
    );
  }
  return null;
};

export const RelatorioFinanceiroTab: React.FC<RelatorioFinanceiroTabProps> = ({
  apiBaseUrl,
  authHeaders
}) => {
  const [periodoDias, setPeriodoDias] = useState<string>('30');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [stats, setStats] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchFinanceiroData = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - parseInt(periodoDias));

      const startStr = localCalendarDate(startDate);
      const endStr = localCalendarDate(endDate);

      const res = await fetch(`${apiBaseUrl}/comandas/estatisticas/geral?data_inicio=${startStr}&data_fim=${endStr}`, {
        headers: authHeaders
      });
      if (!res.ok) throw new Error('Erro ao carregar dados financeiros reais.');
      const data = await res.json();
      setStats(data);
    } catch (err: any) {
      console.error(err);
      setErrorMsg('Falha ao conectar ao servidor para carregar o relatório financeiro.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFinanceiroData();
  }, [periodoDias]);

  const faturamentoBruto = stats?.faturamento ?? null;
  const totalPedidos = stats?.total_pedidos ?? null;
  const ticketMedio = stats?.ticket_medio ?? null;
  const faturamentoHoje = stats?.faturamento_hoje ?? null;

  const bk = stats?.breakdown_pagamentos || {};
  const din = Number(bk.dinheiro || 0);
  const pix = Number(bk.pix || 0);
  const car = Number(bk.cartao || 0);

  const paymentChartData = [
    { name: 'Pix', value: pix, color: '#059669' },
    { name: 'Cartão', value: car, color: '#0284c7' },
    { name: 'Dinheiro', value: din, color: '#d97706' }
  ].filter(item => item.value > 0);

  const paymentBarData = [
    { name: 'Pix', valor: pix, fill: '#059669' },
    { name: 'Cartão', valor: car, fill: '#0284c7' },
    { name: 'Dinheiro', valor: din, fill: '#d97706' }
  ];

  return (
    <div className="space-y-5 text-left animate-fade-in">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-koma-panel/60 border border-koma-border p-4 rounded-3xl">
        <div>
          <h3 className="font-serif text-sm font-bold text-koma-foreground">Resumo Financeiro & Recebimentos</h3>
          <p className="text-[10px] text-koma-subtle">Análise do faturamento total e distribuição por meio de pagamento do seu restaurante.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-koma-raised border border-koma-border px-2.5 py-1 rounded-xl">
            <Filter size={12} className="text-koma-subtle" />
            <select
              value={periodoDias}
              onChange={(e) => setPeriodoDias(e.target.value)}
              className="bg-transparent text-koma-foreground text-xs font-bold focus:outline-none cursor-pointer"
            >
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
            </select>
          </div>
          <button
            type="button"
            onClick={fetchFinanceiroData}
            className="p-2 border border-koma-border hover:bg-koma-raised text-koma-subtle hover:text-koma-foreground rounded-xl transition-all cursor-pointer"
            title="Atualizar Financeiro"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-koma-panel border border-koma-border p-4 rounded-2xl space-y-1 shadow-xs">
          <span className="text-[9px] font-bold uppercase tracking-wider text-koma-muted block">Faturamento Total</span>
          <strong className="text-base font-mono font-extrabold text-emerald-700 dark:text-emerald-400 block">
            {faturamentoBruto !== null ? `R$ ${Number(faturamentoBruto).toFixed(2)}` : 'Dados indisponíveis'}
          </strong>
          <span className="text-[9px] text-koma-muted block font-medium">Período de {periodoDias} dias</span>
        </div>

        <div className="bg-koma-panel border border-koma-border p-4 rounded-2xl space-y-1 shadow-xs">
          <span className="text-[9px] font-bold uppercase tracking-wider text-koma-muted block">Vendas de Hoje</span>
          <strong className="text-base font-mono font-bold text-koma-foreground block">
            {faturamentoHoje !== null ? `R$ ${Number(faturamentoHoje).toFixed(2)}` : 'Dados indisponíveis'}
          </strong>
          <span className="text-[9px] text-emerald-700 dark:text-emerald-400 block font-semibold">Data atual</span>
        </div>

        <div className="bg-koma-panel border border-koma-border p-4 rounded-2xl space-y-1 shadow-xs">
          <span className="text-[9px] font-bold uppercase tracking-wider text-koma-muted block">Pedidos Finalizados</span>
          <strong className="text-base font-mono font-bold text-sky-700 dark:text-sky-400 block">
            {totalPedidos !== null ? `${totalPedidos} comandas` : 'Dados indisponíveis'}
          </strong>
          <span className="text-[9px] text-koma-muted block font-medium">Volume do período</span>
        </div>

        <div className="bg-koma-panel border border-koma-border p-4 rounded-2xl space-y-1 shadow-xs">
          <span className="text-[9px] font-bold uppercase tracking-wider text-koma-muted block">Ticket Médio por Pedido</span>
          <strong className="text-base font-mono font-extrabold text-purple-700 dark:text-purple-300 block">
            {ticketMedio !== null ? `R$ ${Number(ticketMedio).toFixed(2)}` : 'Dados indisponíveis'}
          </strong>
          <span className="text-[9px] text-koma-muted block font-medium">Faturamento ÷ Pedidos</span>
        </div>
      </div>

      {/* Gráfico de Meios de Pagamento */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-koma-panel border border-koma-border rounded-3xl p-5 space-y-4 shadow-xs">
          <div className="border-b border-koma-border pb-2 flex items-center justify-between">
            <h4 className="font-serif text-sm font-bold text-koma-foreground flex items-center gap-2">
              <PieIcon size={16} className="text-emerald-700 dark:text-emerald-400" />
              <span>Vendas por Meio de Pagamento</span>
            </h4>
            <span className="text-[9px] text-koma-muted font-mono font-medium">Últimos {periodoDias} dias</span>
          </div>

          <div className="h-56 w-full pt-1">
            {paymentChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={paymentChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {paymentChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="var(--color-koma-panel)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-koma-muted">Sem dados de pagamento no período</div>
            )}
          </div>

          <div className="flex justify-center items-center gap-4 text-xs font-bold">
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#059669] inline-block" /><span>Pix</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#0284c7] inline-block" /><span>Cartão</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#d97706] inline-block" /><span>Dinheiro</span></div>
          </div>
        </div>

        <div className="bg-koma-panel border border-koma-border rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 space-y-4 shadow-xs">
          <div className="border-b border-koma-border pb-2 flex items-center justify-between">
            <h4 className="font-serif text-sm font-bold text-koma-foreground flex items-center gap-2">
              <BarChart3 size={16} className="text-sky-600 dark:text-sky-400" />
              <span>Comparativo dos Meios de Recebimento</span>
            </h4>
            <span className="text-[9px] text-koma-muted font-mono font-medium">Em R$</span>
          </div>

          <div className="h-56 w-full pt-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={paymentBarData} margin={{ top: 10, right: 10, left: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--koma-border-default)" vertical={false} opacity={0.6} />
                <XAxis dataKey="name" stroke="var(--koma-text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--koma-text-muted)" fontSize={11} width={50} tickLine={false} axisLine={false} tickFormatter={(v) => `R$ ${v}`} />
                <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'var(--koma-border-default)', opacity: 0.3 }} />
                <Bar dataKey="valor" radius={[6, 6, 0, 0]}>
                  {paymentBarData.map((entry, index) => (
                    <Cell key={`bar-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Real Sales & Payment Breakdown Table */}
      <div className="bg-koma-panel border border-koma-border rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 space-y-3 sm:space-y-4 text-left shadow-xs">
        <div className="border-b border-koma-border pb-2 flex items-center justify-between">
          <h4 className="font-serif text-sm font-bold text-koma-foreground flex items-center gap-2">
            <BarChart3 size={16} className="text-emerald-700 dark:text-emerald-400" />
            <span>Detalhamento Financeiro de Vendas</span>
          </h4>
          <span className="text-[9px] text-koma-muted font-mono font-medium">Últimos {periodoDias} dias</span>
        </div>

        <div className="overflow-x-auto border border-koma-border rounded-2xl">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="bg-koma-raised border-b border-koma-border text-koma-muted uppercase text-[9px] tracking-wider font-extrabold">
                <th className="p-3.5">Forma de Recebimento</th>
                <th className="p-3.5 text-right font-mono">Valor Total</th>
                <th className="p-3.5 text-right font-mono">% do Faturamento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-koma-border">
              <tr className="bg-koma-raised/80 font-extrabold">
                <td className="p-3.5 font-sans text-emerald-700 dark:text-emerald-400">1. FATURAMENTO TOTAL BRUTO</td>
                <td className="p-3.5 text-right text-emerald-700 dark:text-emerald-400 font-extrabold">
                  {faturamentoBruto !== null ? `R$ ${Number(faturamentoBruto).toFixed(2)}` : 'R$ 0.00'}
                </td>
                <td className="p-3.5 text-right text-emerald-700 dark:text-emerald-400 font-extrabold">100.0%</td>
              </tr>
              {(() => {
                const total = Number(faturamentoBruto || 0);
                return (
                  <>
                    <tr className="hover:bg-koma-raised/50 transition-colors">
                      <td className="p-3.5 pl-6 text-koma-foreground font-sans font-medium flex items-center gap-2">
                        <span>Recebimentos em Dinheiro</span>
                      </td>
                      <td className="p-3.5 text-right text-koma-foreground font-bold">
                        R$ {din.toFixed(2)}
                      </td>
                      <td className="p-3.5 text-right text-koma-muted font-semibold">
                        {total > 0 ? `${((din / total) * 100).toFixed(1)}%` : '0.0%'}
                      </td>
                    </tr>
                    <tr className="hover:bg-koma-raised/50 transition-colors">
                      <td className="p-3.5 pl-6 text-koma-foreground font-sans font-medium flex items-center gap-2">
                        <span>Recebimentos via Pix</span>
                      </td>
                      <td className="p-3.5 text-right text-koma-foreground font-bold">
                        R$ {pix.toFixed(2)}
                      </td>
                      <td className="p-3.5 text-right text-koma-muted font-semibold">
                        {total > 0 ? `${((pix / total) * 100).toFixed(1)}%` : '0.0%'}
                      </td>
                    </tr>
                    <tr className="hover:bg-koma-raised/50 transition-colors">
                      <td className="p-3.5 pl-6 text-koma-foreground font-sans font-medium flex items-center gap-2">
                        <span>Recebimentos em Cartão (Débito/Crédito)</span>
                      </td>
                      <td className="p-3.5 text-right text-koma-foreground font-bold">
                        R$ {car.toFixed(2)}
                      </td>
                      <td className="p-3.5 text-right text-koma-muted font-semibold">
                        {total > 0 ? `${((car / total) * 100).toFixed(1)}%` : '0.0%'}
                      </td>
                    </tr>
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
