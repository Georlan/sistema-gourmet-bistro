import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { localCalendarDate } from '../../utils/dateTime';
import {
  TrendingUp,
  ShoppingBag,
  Users,
  Target,
  Calendar as CalendarIcon,
  Download,
  Eye,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  BarChart2
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

interface RelatoriosVisaoGeralTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  showToast: (msg: string) => void;
}

const CustomChartTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#1C1C1F] border border-[#27272A] p-3 rounded-2xl shadow-xl text-left font-sans space-y-1 z-50">
        <p className="text-[10px] font-bold text-gray-400">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-xs font-bold font-mono" style={{ color: entry.color }}>
            {entry.name}: {typeof entry.value === 'number' && (entry.name.toLowerCase().includes('faturam') || entry.name.toLowerCase().includes('total')) ? `R$ ${entry.value.toFixed(2)}` : entry.value}
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
  const getDefaultDates = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);
    return {
      inicio: localCalendarDate(start),
      fim: localCalendarDate(end),
    };
  };

  const defaults = getDefaultDates();
  const [dataInicio, setDataInicio] = useState(defaults.inicio);
  const [dataFim, setDataFim] = useState(defaults.fim);
  const [isLoading, setIsLoading] = useState(false);

  // Modals & Drawers
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [showVendasDrawer, setShowVendasDrawer] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [newMetaInput, setNewMetaInput] = useState('');

  const [data, setData] = useState<any>(null);
  const [hasError, setHasError] = useState(false);
  const [vendasDetalhes, setVendasDetalhes] = useState<VendaDetalheItem[]>([]);
  const [isLoadingVendas, setIsLoadingVendas] = useState(false);

  const fetchVisaoGeral = async (inicio: string, fim: string) => {
    setIsLoading(true);
    setHasError(false);
    try {
      const res = await fetch(
        `${apiBaseUrl}/relatorios/visao-geral?data_inicio=${inicio}&data_fim=${fim}`,
        { headers: authHeaders }
      );
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        setHasError(true);
      }
    } catch (err) {
      console.error('Erro ao buscar visão geral:', err);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

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
    fetchVisaoGeral(dataInicio, dataFim);
  }, [dataInicio, dataFim]);

  const handleApplyPeriod = (inicio: string, fim: string) => {
    setDataInicio(inicio);
    setDataFim(fim);
  };

  const handleSaveMeta = async () => {
    const val = parseFloat(newMetaInput);
    if (isNaN(val) || val < 0) {
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
    csv += `Faturamento Total (R$);${data.faturamento_total}\n`;
    csv += `Total de Pedidos;${data.total_pedidos}\n`;
    csv += `Ticket Médio (R$);${data.ticket_medio}\n`;
    csv += `Clientes Ativos;${data.clientes_ativos}\n`;
    csv += `Meta Mensal (R$);${data.meta_mensal}\n`;
    csv += `Meta Realizada (R$);${data.meta_realizada}\n`;
    csv += `Meta Restante (R$);${data.meta_restante}\n`;
    csv += `Progresso Meta (%);${data.meta_percentual}%\n`;
    csv += `Projeção Ritmo Atual (R$);${data.meta_projecao}\n`;
    csv += `Média Diária Necessária (R$);${data.meta_media_diaria_necessaria}\n`;

    csv += '\nData;Pedidos por Dia;Faturamento (R$)\n';
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

  return (
    <div className={clsx('space-y-6', 'text-left', 'animate-fade-in')}>
      {/* Top Header Bar */}
      <div className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'p-4.5', 'rounded-3xl', 'flex', 'flex-col', 'sm:flex-row', 'sm:items-center', 'justify-between', 'gap-4')}>
        <div className="space-y-1">
          <h3 className="font-serif font-bold text-base text-white">Relatórios — Visão Geral Operacional</h3>
          <p className="text-[10px] text-gray-400">
            Período selecionado: <strong className="text-gray-200">{dataInicio}</strong> até <strong className="text-gray-200">{dataFim}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setShowVendasDrawer(true);
              fetchVendasDetalhes(dataInicio, dataFim);
            }}
            className="px-3.5 py-2 bg-[#10b981]/10 hover:bg-[#10b981]/20 border border-[#10b981]/30 text-[#10b981] rounded-xl text-[10px] font-extrabold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            <Eye size={14} />
            Ver Vendas
          </button>

          <button
            type="button"
            onClick={() => setShowCalendarModal(true)}
            className="px-3.5 py-2 bg-koma-raised hover:bg-koma-card border border-koma-border text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5"
          >
            <CalendarIcon size={14} className="text-[#10b981]" />
            Alterar Período
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!data}
            className="px-3 py-2 bg-koma-raised hover:bg-koma-card border border-koma-border text-gray-300 hover:text-white rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            title="Exportar CSV"
          >
            <Download size={14} />
            CSV
          </button>
        </div>
      </div>

      {hasError && !isLoading && (
        <div className="bg-koma-panel border border-rose-900/50 rounded-3xl p-8 text-center space-y-4 max-w-md mx-auto my-6 animate-fade-in">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
            <span className="font-bold text-lg">!</span>
          </div>
          <div className="space-y-1">
            <h3 className="text-white font-bold text-sm">Não foi possível carregar os dados</h3>
            <p className="text-gray-400 text-xs">Ocorreu uma falha ao comunicar com o servidor. Por favor, tente novamente.</p>
          </div>
          <button
            onClick={() => fetchVisaoGeral(dataInicio, dataFim)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Main Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-2">
          <div className="flex justify-between items-center text-gray-400">
            <span className="text-[9px] font-bold uppercase tracking-wider">Faturamento Total</span>
            <div className="p-1.5 bg-[#10b981]/15 text-[#10b981] rounded-xl">
              <TrendingUp size={16} />
            </div>
          </div>
          <strong className="text-2xl text-white font-mono block">
            R$ {data?.faturamento_total?.toFixed(2) ?? '0.00'}
          </strong>
          {data?.comparativo_anterior && (
            <div className="flex items-center gap-1 text-[9px]">
              {data.comparativo_anterior.variacao_faturamento_pct >= 0 ? (
                <span className="text-emerald-400 font-bold flex items-center">
                  <ArrowUpRight size={12} /> +{data.comparativo_anterior.variacao_faturamento_pct}%
                </span>
              ) : (
                <span className="text-rose-400 font-bold flex items-center">
                  <ArrowDownRight size={12} /> {data.comparativo_anterior.variacao_faturamento_pct}%
                </span>
              )}
              <span className="text-gray-500">vs período anterior</span>
            </div>
          )}
        </div>

        <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-2">
          <div className="flex justify-between items-center text-gray-400">
            <span className="text-[9px] font-bold uppercase tracking-wider">Total de Pedidos</span>
            <div className="p-1.5 bg-sky-500/15 text-sky-400 rounded-xl">
              <ShoppingBag size={16} />
            </div>
          </div>
          <strong className="text-2xl text-white font-mono block">
            {data?.total_pedidos ?? 0}
          </strong>
          {data?.comparativo_anterior && (
            <div className="flex items-center gap-1 text-[9px]">
              {data.comparativo_anterior.variacao_pedidos_pct >= 0 ? (
                <span className="text-emerald-400 font-bold flex items-center">
                  <ArrowUpRight size={12} /> +{data.comparativo_anterior.variacao_pedidos_pct}%
                </span>
              ) : (
                <span className="text-rose-400 font-bold flex items-center">
                  <ArrowDownRight size={12} /> {data.comparativo_anterior.variacao_pedidos_pct}%
                </span>
              )}
              <span className="text-gray-500">vs período anterior</span>
            </div>
          )}
        </div>

        <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-2">
          <div className="flex justify-between items-center text-gray-400">
            <span className="text-[9px] font-bold uppercase tracking-wider">Ticket Médio</span>
            <div className="p-1.5 bg-amber-500/15 text-amber-400 rounded-xl">
              <TrendingUp size={16} />
            </div>
          </div>
          <strong className="text-2xl text-white font-mono block">
            R$ {data?.ticket_medio?.toFixed(2) ?? '0.00'}
          </strong>
          <span className="text-[9px] text-gray-500 block">Média por comanda finalizada</span>
        </div>

        {(data?.clientes_ativos || 0) > 0 && (
          <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-2">
            <div className="flex justify-between items-center text-gray-400">
              <span className="text-[9px] font-bold uppercase tracking-wider">Clientes Ativos</span>
              <div className="p-1.5 bg-purple-500/15 text-purple-400 rounded-xl">
                <Users size={16} />
              </div>
            </div>
            <strong className="text-2xl text-white font-mono block">
              {data.clientes_ativos}
            </strong>
            <span className="text-[9px] text-gray-500 block">Clientes cadastrados com identificação</span>
          </div>
        )}
      </div>

      {/* Meta Mensal Block */}
      <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-4">
        <div className="flex justify-between items-center border-b border-koma-border pb-3">
          <div className="flex items-center gap-2">
            <Target size={18} className="text-[#10b981]" />
            <span className="font-serif font-bold text-sm text-white">Acompanhamento da Meta Mensal</span>
          </div>
          {editingMeta ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder="R$ Meta"
                value={newMetaInput}
                onChange={(e) => setNewMetaInput(e.target.value)}
                className="px-2.5 py-1 bg-koma-input border border-koma-border rounded-xl text-white font-mono text-[10px] w-28"
              />
              <button
                type="button"
                onClick={handleSaveMeta}
                className="px-3 py-1 bg-[#10b981] hover:bg-[#059669] text-zinc-950 rounded-lg text-[9px] font-extrabold uppercase transition-all cursor-pointer"
              >
                Salvar
              </button>
              <button
                type="button"
                onClick={() => setEditingMeta(false)}
                className="px-2 py-1 bg-koma-raised text-gray-400 hover:text-white rounded-lg text-[9px] font-bold"
              >
                X
              </button>
            </div>
          ) : (
            (data?.meta_mensal || 0) > 0 && (
              <button
                type="button"
                onClick={() => {
                  setNewMetaInput(String(data?.meta_mensal || ''));
                  setEditingMeta(true);
                }}
                className="px-3 py-1 bg-koma-raised hover:bg-koma-card border border-koma-border text-gray-300 hover:text-white rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer"
              >
                Configurar Meta
              </button>
            )
          )}
        </div>

        {(data?.meta_mensal || 0) <= 0 && !editingMeta ? (
          <div className="py-6 text-center space-y-3">
            <p className="text-xs text-gray-400">Nenhuma meta de faturamento mensal definida para este período.</p>
            <button
              type="button"
              onClick={() => {
                setNewMetaInput('');
                setEditingMeta(true);
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-sm"
            >
              <Target size={14} />
              <span>Definir Meta Mensal</span>
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-[10px] font-mono">
                <span className="text-gray-400">
                  Realizado: <strong className="text-white">R$ {data?.meta_realizada?.toFixed(2) ?? '0.00'}</strong>
                </span>
                <span className="text-[#10b981] font-bold">
                  {data?.meta_percentual ?? 0}% Alcançado
                </span>
                <span className="text-gray-400">
                  Meta: <strong className="text-white">R$ {data?.meta_mensal?.toFixed(2) ?? '0.00'}</strong>
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
                <span className="text-gray-400 text-[8px] font-bold uppercase tracking-wider block">Valor Restante</span>
                <strong className="text-sm font-mono text-white block">
                  R$ {data?.meta_restante?.toFixed(2) ?? '0.00'}
                </strong>
              </div>
              <div className="bg-koma-raised/60 border border-koma-border/60 p-3 rounded-2xl space-y-1">
                <span className="text-gray-400 text-[8px] font-bold uppercase tracking-wider block">Projeção no Ritmo Atual</span>
                <strong className="text-sm font-mono text-emerald-400 block">
                  R$ {data?.meta_projecao?.toFixed(2) ?? '0.00'}
                </strong>
              </div>
              <div className="bg-koma-raised/60 border border-koma-border/60 p-3 rounded-2xl space-y-1">
                <span className="text-gray-400 text-[8px] font-bold uppercase tracking-wider block">Média Diária Necessária</span>
                <strong className="text-sm font-mono text-amber-400 block">
                  R$ {data?.meta_media_diaria_necessaria?.toFixed(2) ?? '0.00'} / dia
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
              <TrendingUp size={16} className="text-[#10b981]" />
              <span className="font-serif font-bold text-sm text-white">Evolução Diária do Faturamento</span>
            </div>
            <span className="text-[10px] text-gray-400 font-mono">Tendência do Período</span>
          </div>

          <div className="h-64 w-full pt-2">
            {vendasPorDiaChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={vendasPorDiaChartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <defs>
                    <linearGradient id="emeraldGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
                  <XAxis dataKey="data" stroke="#71717A" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#71717A" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `R$${v}`} />
                  <Tooltip content={<CustomChartTooltip />} cursor={{ stroke: '#10b981', strokeWidth: 1, strokeDasharray: '3 3' }} />
                  <Area type="monotone" dataKey="faturamento" name="Faturamento (R$)" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#emeraldGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-gray-500">Sem dados no período</div>
            )}
          </div>
        </div>

        <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-4">
          <div className="flex items-center gap-2 border-b border-koma-border pb-3">
            <Clock size={16} className="text-sky-400" />
            <span className="font-serif font-bold text-sm text-white">Horários de Pico do Salão</span>
          </div>

          <div className="h-64 w-full pt-2">
            {horariosPicoChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={horariosPicoChartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
                  <XAxis dataKey="hora" stroke="#71717A" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#71717A" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }} />
                  <Bar dataKey="pedidos" name="Pedidos Atendidos" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-gray-500">Nenhum pedido registrado nos horários</div>
            )}
          </div>
        </div>
      </div>

      {/* Tabelas Detalhadas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-4">
          <div className="flex justify-between items-center border-b border-koma-border pb-2">
            <span className="font-serif font-bold text-sm text-white">Detalhamento dos Pedidos por Dia</span>
          </div>

          <div className="overflow-x-auto max-h-56 border border-koma-border rounded-2xl">
            <table className="w-full text-left text-[10px]">
              <thead className="bg-koma-raised border-b border-koma-border text-gray-400 uppercase tracking-wider font-bold sticky top-0">
                <tr>
                  <th className="p-3">Data</th>
                  <th className="p-3 font-mono text-center">Qtd Pedidos</th>
                  <th className="p-3 font-mono text-right">Faturamento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-koma-border">
                {(data?.vendas_por_dia || []).map((v: any) => (
                  <tr key={v.data} className="hover:bg-koma-raised/50 transition-colors">
                    <td className="p-3 font-mono text-gray-300">{v.data}</td>
                    <td className="p-3 font-mono text-center font-bold text-white">{v.quantidade_pedidos}</td>
                    <td className="p-3 font-mono text-right font-extrabold text-[#10b981]">
                      R$ {v.total.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-4">
          <div className="flex items-center gap-2 border-b border-koma-border pb-2">
            <Clock size={16} className="text-[#10b981]" />
            <span className="font-serif font-bold text-sm text-white">Detalhamento por Faixa Horária</span>
          </div>

          <div className="overflow-x-auto max-h-56 border border-koma-border rounded-2xl">
            <table className="w-full text-left text-[10px]">
              <thead className="bg-koma-raised border-b border-koma-border text-gray-400 uppercase tracking-wider font-bold sticky top-0">
                <tr>
                  <th className="p-3">Horário</th>
                  <th className="p-3 font-mono text-center">Total Pedidos</th>
                  <th className="p-3 font-mono text-right">Faturamento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-koma-border">
                {(data?.horarios_pico || [])
                  .filter((h: any) => h.total_pedidos > 0)
                  .map((h: any) => (
                    <tr key={h.hora} className="hover:bg-koma-raised/50 transition-colors">
                      <td className="p-3 font-mono font-bold text-white">{h.hora}</td>
                      <td className="p-3 font-mono text-center text-sky-400 font-bold">{h.total_pedidos}</td>
                      <td className="p-3 font-mono text-right font-bold text-emerald-400">
                        R$ {h.faturamento.toFixed(2)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

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
