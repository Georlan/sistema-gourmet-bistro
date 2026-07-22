import React, { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, Filter, RefreshCw, BarChart3, AlertCircle } from 'lucide-react';

interface RelatorioFinanceiroTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

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

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      const res = await fetch(`${apiBaseUrl}/comandas/estatisticas/geral?data_inicio=${startStr}&data_fim=${endStr}`, {
        headers: authHeaders
      });
      if (!res.ok) throw new Error('Erro ao carregar dados financeiros reais.');
      const data = await res.json();
      setStats(data);
    } catch (err: any) {
      console.error(err);
      setErrorMsg('Falha ao conectar ao servidor para carregar o DRE.');
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

  return (
    <div className="space-y-5 text-left animate-fade-in">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#121214]/60 border border-[#27272A] p-4 rounded-3xl">
        <div>
          <h3 className="font-serif text-sm font-bold text-white">Demonstrativo DRE & Relatório Financeiro</h3>
          <p className="text-[10px] text-gray-400">Análise de resultado operacional, faturamento e vendas com dados reais do tenant.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-[#1C1C1F] border border-[#27272A] px-2.5 py-1 rounded-xl">
            <Filter size={12} className="text-gray-400" />
            <select
              value={periodoDias}
              onChange={(e) => setPeriodoDias(e.target.value)}
              className="bg-transparent text-white text-xs font-bold focus:outline-none cursor-pointer"
            >
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
            </select>
          </div>
          <button
            type="button"
            onClick={fetchFinanceiroData}
            className="p-2 border border-[#27272A] hover:bg-[#1C1C1F] text-gray-400 hover:text-white rounded-xl transition-all cursor-pointer"
            title="Atualizar DRE"
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
        <div className="bg-[#121214]/80 border border-[#27272A] p-4 rounded-2xl space-y-1">
          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 block">Faturamento Bruto</span>
          <strong className="text-base font-mono font-bold text-emerald-400 block">
            {faturamentoBruto !== null ? `R$ ${Number(faturamentoBruto).toFixed(2)}` : 'Dados indisponíveis'}
          </strong>
          <span className="text-[8px] text-gray-500 block">Período de {periodoDias} dias</span>
        </div>

        <div className="bg-[#121214]/80 border border-[#27272A] p-4 rounded-2xl space-y-1">
          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 block">Vendas de Hoje</span>
          <strong className="text-base font-mono font-bold text-white block">
            {faturamentoHoje !== null ? `R$ ${Number(faturamentoHoje).toFixed(2)}` : 'Dados indisponíveis'}
          </strong>
          <span className="text-[8px] text-emerald-500/80 block">Data atual</span>
        </div>

        <div className="bg-[#121214]/80 border border-[#27272A] p-4 rounded-2xl space-y-1">
          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 block">Pedidos Finalizados</span>
          <strong className="text-base font-mono font-bold text-sky-400 block">
            {totalPedidos !== null ? `${totalPedidos} comandas` : 'Dados indisponíveis'}
          </strong>
          <span className="text-[8px] text-gray-500 block">Volume do período</span>
        </div>

        <div className="bg-[#121214]/80 border border-[#27272A] p-4 rounded-2xl space-y-1">
          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 block">Ticket Médio por Pedido</span>
          <strong className="text-base font-mono font-bold text-purple-400 block">
            {ticketMedio !== null ? `R$ ${Number(ticketMedio).toFixed(2)}` : 'Dados indisponíveis'}
          </strong>
          <span className="text-[8px] text-gray-500 block">Faturamento ÷ Pedidos</span>
        </div>
      </div>

      {/* Structured DRE Statement */}
      <div className="bg-[#121214]/60 border border-[#27272A] rounded-3xl p-5 space-y-4 text-left">
        <div className="border-b border-[#27272A] pb-2 flex items-center justify-between">
          <h4 className="font-serif text-sm font-bold text-white flex items-center gap-2">
            <BarChart3 size={16} className="text-emerald-400" />
            <span>Demonstrativo do Resultado do Exercício (DRE)</span>
          </h4>
          <span className="text-[9px] text-gray-400 font-mono">Consolidado Real</span>
        </div>

        <div className="overflow-x-auto border border-[#27272A]/40 rounded-2xl">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="bg-[#1C1C1F] border-b border-[#27272A] text-gray-400 uppercase text-[9px] tracking-wider">
                <th className="p-3">Estrutura DRE</th>
                <th className="p-3 text-right font-mono">Valor Consolidado</th>
                <th className="p-3 text-right font-mono">% do Faturamento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272A]/40 text-gray-200">
              <tr className="bg-[#1C1C1F]/40 font-bold">
                <td className="p-3 font-sans text-emerald-400">1. FATURAMENTO BRUTO DE VENDAS</td>
                <td className="p-3 text-right text-emerald-400">
                  {faturamentoBruto !== null ? `R$ ${Number(faturamentoBruto).toFixed(2)}` : 'Dados indisponíveis'}
                </td>
                <td className="p-3 text-right text-gray-400">100.0%</td>
              </tr>
              <tr>
                <td className="p-3 pl-6 text-gray-400 font-sans">(-) Deduções e Descontos Concedidos</td>
                <td className="p-3 text-right text-gray-400">
                  {stats?.descontos !== undefined ? `- R$ ${Number(stats.descontos).toFixed(2)}` : 'Dados indisponíveis'}
                </td>
                <td className="p-3 text-right text-gray-500">—</td>
              </tr>
              <tr className="font-semibold bg-[#1C1C1F]/20">
                <td className="p-3 font-sans text-white">2. FATURAMENTO LÍQUIDO</td>
                <td className="p-3 text-right text-white">
                  {faturamentoBruto !== null ? `R$ ${Number(faturamentoBruto - (stats?.descontos || 0)).toFixed(2)}` : 'Dados indisponíveis'}
                </td>
                <td className="p-3 text-right text-gray-400">
                  {faturamentoBruto ? `${(((faturamentoBruto - (stats?.descontos || 0)) / faturamentoBruto) * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
              <tr>
                <td className="p-3 pl-6 text-gray-400 font-sans">(-) Custos de Insumos / CMV Direto</td>
                <td className="p-3 text-right text-gray-400">
                  {stats?.cmv_real !== undefined ? `- R$ ${Number(stats.cmv_real).toFixed(2)}` : 'Dados indisponíveis'}
                </td>
                <td className="p-3 text-right text-gray-500">—</td>
              </tr>
              <tr className="font-bold bg-[#1C1C1F]/40 border-t border-[#27272A]">
                <td className="p-3 font-sans text-emerald-300">3. MARGEM BRUTA OPERACIONAL</td>
                <td className="p-3 text-right text-emerald-300">
                  {faturamentoBruto !== null ? `R$ ${Number(faturamentoBruto - (stats?.descontos || 0) - (stats?.cmv_real || 0)).toFixed(2)}` : 'Dados indisponíveis'}
                </td>
                <td className="p-3 text-right text-emerald-400">
                  {faturamentoBruto ? `${(((faturamentoBruto - (stats?.descontos || 0) - (stats?.cmv_real || 0)) / faturamentoBruto) * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
