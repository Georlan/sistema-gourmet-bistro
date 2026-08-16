import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, Filter, PieChart as PieIcon, RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { localCalendarDate } from '../../utils/dateTime';

interface RelatorioFinanceiroTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatMoney = (value: number | null | undefined) => money.format(Number(value) || 0);

const CustomChartTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  return (
    <div className="space-y-1 rounded-2xl border border-koma-border bg-koma-panel p-3 text-left shadow-xl">
      <p className="text-[10px] font-bold text-koma-subtle">{row.name}</p>
      <p className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-300">{formatMoney(row.value)}</p>
    </div>
  );
};

export const RelatorioFinanceiroTab: React.FC<RelatorioFinanceiroTabProps> = ({
  apiBaseUrl,
  authHeaders,
}) => {
  const [periodoDias, setPeriodoDias] = useState('30');
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchFinanceiroData = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - Number(periodoDias));
      const startStr = localCalendarDate(startDate);
      const endStr = localCalendarDate(endDate);
      const response = await fetch(
        `${apiBaseUrl}/comandas/estatisticas/geral?data_inicio=${startStr}&data_fim=${endStr}`,
        { headers: authHeaders },
      );
      if (!response.ok) throw new Error('Erro ao carregar dados financeiros reais.');
      setStats(await response.json());
    } catch (error) {
      console.error(error);
      setErrorMsg('Falha ao conectar ao servidor para carregar o relatório financeiro.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFinanceiroData();
  }, [periodoDias]);

  const gross = Number(stats?.vendas_brutas || 0);
  const refunds = Number(stats?.estornos || 0);
  const net = Number(stats?.vendas_liquidas ?? stats?.faturamento ?? 0);
  const todayNet = Number(stats?.faturamento_hoje || 0);
  const totalAccounts = Number(stats?.total_pedidos || 0);
  const netAverageTicket = Number(stats?.ticket_medio || 0);
  const grossAverageTicket = Number(stats?.ticket_medio_bruto || 0);

  const grossBreakdown = stats?.breakdown_bruto || {};
  const refundBreakdown = stats?.breakdown_estornos || {};
  const netBreakdown = stats?.breakdown_pagamentos || {};

  const methods = useMemo(() => [
    {
      key: 'pix',
      name: 'Pix',
      gross: Number(grossBreakdown.pix || 0),
      refunds: Number(refundBreakdown.pix || 0),
      net: Number(netBreakdown.pix || 0),
      fill: '#059669',
    },
    {
      key: 'cartao',
      name: 'Cartão',
      gross: Number(grossBreakdown.cartao || 0),
      refunds: Number(refundBreakdown.cartao || 0),
      net: Number(netBreakdown.cartao || 0),
      fill: '#0284c7',
    },
    {
      key: 'dinheiro',
      name: 'Dinheiro',
      gross: Number(grossBreakdown.dinheiro || 0),
      refunds: Number(refundBreakdown.dinheiro || 0),
      net: Number(netBreakdown.dinheiro || 0),
      fill: '#d97706',
    },
  ], [grossBreakdown, refundBreakdown, netBreakdown]);

  const pieData = methods.filter((item) => item.gross > 0).map((item) => ({
    name: item.name,
    value: item.gross,
    fill: item.fill,
  }));

  const operationalRange = stats?.dia_operacional_inicio && stats?.dia_operacional_fim
    ? `${stats.dia_operacional_inicio} a ${stats.dia_operacional_fim}`
    : `últimos ${periodoDias} dias`;

  const kpis = [
    { label: 'Vendas brutas', value: gross, help: 'Pagamentos aprovados antes dos estornos' },
    { label: 'Estornos', value: refunds, help: 'Devoluções financeiras registradas no período' },
    { label: 'Receita líquida', value: net, help: 'Vendas brutas − estornos' },
    { label: 'Ticket líquido médio', value: netAverageTicket, help: `${totalAccounts} Conta(s) com recebimento · bruto ${formatMoney(grossAverageTicket)}` },
  ];

  return (
    <div className="space-y-5 text-left animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-koma-border bg-koma-panel/60 p-4">
        <div>
          <h3 className="font-serif text-sm font-bold text-koma-foreground">Reconciliação financeira</h3>
          <p className="mt-0.5 text-[10px] text-koma-subtle">
            Fonte: pagamentos aprovados menos estornos · dia operacional por turno · {operationalRange}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-2.5 py-1">
            <Filter size={12} className="text-koma-subtle" />
            <select value={periodoDias} onChange={(e) => setPeriodoDias(e.target.value)} className="cursor-pointer bg-transparent text-xs font-bold text-koma-foreground focus:outline-none">
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
            </select>
          </div>
          <button type="button" onClick={fetchFinanceiroData} className="cursor-pointer rounded-xl border border-koma-border p-2 text-koma-subtle transition-all hover:bg-koma-raised hover:text-koma-foreground" title="Atualizar financeiro">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
          <AlertCircle size={16} className="shrink-0" /> {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="space-y-1 rounded-2xl border border-koma-border bg-koma-panel p-4 shadow-xs">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-koma-muted">{kpi.label}</span>
            <strong className="block font-mono text-base font-extrabold text-koma-foreground">{formatMoney(kpi.value)}</strong>
            <span className="block text-[9px] leading-relaxed text-koma-muted">{kpi.help}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-koma-border bg-koma-panel p-4">
          <span className="text-[9px] font-bold uppercase tracking-wider text-koma-muted">Líquido do dia operacional atual</span>
          <strong className="mt-1 block font-mono text-lg font-bold text-emerald-700 dark:text-emerald-300">{formatMoney(todayNet)}</strong>
        </div>
        <div className="rounded-2xl border border-koma-border bg-koma-panel p-4">
          <span className="text-[9px] font-bold uppercase tracking-wider text-koma-muted">Contas com recebimento</span>
          <strong className="mt-1 block font-mono text-lg font-bold text-sky-700 dark:text-sky-300">{totalAccounts}</strong>
        </div>
        <div className="rounded-2xl border border-koma-border bg-koma-panel p-4">
          <span className="text-[9px] font-bold uppercase tracking-wider text-koma-muted">Equação de reconciliação</span>
          <strong className="mt-1 block text-xs font-bold text-koma-foreground">{formatMoney(gross)} − {formatMoney(refunds)} = {formatMoney(net)}</strong>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="space-y-4 rounded-3xl border border-koma-border bg-koma-panel p-5 shadow-xs">
          <div className="flex items-center justify-between border-b border-koma-border pb-2">
            <h4 className="flex items-center gap-2 font-serif text-sm font-bold text-koma-foreground"><PieIcon size={16} className="text-emerald-700 dark:text-emerald-400" /> Recebimentos brutos por meio</h4>
            <span className="text-[9px] text-koma-muted">antes dos estornos</span>
          </div>
          <div className="h-56 w-full">
            {pieData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                    {pieData.map((entry) => <Cell key={entry.name} fill={entry.fill} stroke="var(--color-koma-panel)" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip content={<CustomChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="flex h-full items-center justify-center text-xs text-koma-muted">Sem recebimentos no período</div>}
          </div>
        </div>

        <div className="space-y-4 rounded-3xl border border-koma-border bg-koma-panel p-5 shadow-xs">
          <div className="flex items-center justify-between border-b border-koma-border pb-2">
            <h4 className="flex items-center gap-2 font-serif text-sm font-bold text-koma-foreground"><BarChart3 size={16} className="text-sky-600 dark:text-sky-400" /> Líquido por meio</h4>
            <span className="text-[9px] text-koma-muted">bruto − estorno</span>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={methods} margin={{ top: 10, right: 10, left: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--koma-border-default)" vertical={false} opacity={0.6} />
                <XAxis dataKey="name" stroke="var(--koma-text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--koma-text-muted)" fontSize={11} width={50} tickLine={false} axisLine={false} tickFormatter={(v) => `R$ ${v}`} />
                <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'var(--koma-border-default)', opacity: 0.3 }} />
                <Bar dataKey="net" name="Líquido" radius={[6, 6, 0, 0]}>
                  {methods.map((entry) => <Cell key={entry.key} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-3xl border border-koma-border bg-koma-panel p-5 shadow-xs">
        <div className="flex items-center justify-between border-b border-koma-border pb-2">
          <h4 className="font-serif text-sm font-bold text-koma-foreground">Conciliação por meio de pagamento</h4>
          <span className="text-[9px] font-medium text-koma-muted">mesmo recorte operacional</span>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-koma-border">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="border-b border-koma-border bg-koma-raised text-[9px] font-extrabold uppercase tracking-wider text-koma-muted">
              <tr><th className="p-3.5">Meio</th><th className="p-3.5 text-right">Bruto</th><th className="p-3.5 text-right">Estornos</th><th className="p-3.5 text-right">Líquido</th></tr>
            </thead>
            <tbody className="divide-y divide-koma-border">
              {methods.map((method) => (
                <tr key={method.key} className="transition-colors hover:bg-koma-raised/50">
                  <td className="p-3.5 font-semibold text-koma-foreground">{method.name}</td>
                  <td className="p-3.5 text-right font-mono text-koma-foreground">{formatMoney(method.gross)}</td>
                  <td className="p-3.5 text-right font-mono text-rose-700 dark:text-rose-300">− {formatMoney(method.refunds)}</td>
                  <td className="p-3.5 text-right font-mono font-bold text-emerald-700 dark:text-emerald-300">{formatMoney(method.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-koma-border bg-koma-raised font-bold text-koma-foreground">
              <tr><td className="p-3.5">Total</td><td className="p-3.5 text-right font-mono">{formatMoney(gross)}</td><td className="p-3.5 text-right font-mono">− {formatMoney(refunds)}</td><td className="p-3.5 text-right font-mono">{formatMoney(net)}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};
