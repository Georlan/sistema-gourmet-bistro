import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
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
  ArrowDownRight
} from 'lucide-react';
import { PeriodoCalendarioModal } from './PeriodoCalendarioModal';
import { VendasDetalhesDrawer, VendaDetalheItem } from './VendasDetalhesDrawer';

interface RelatoriosVisaoGeralTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  showToast: (msg: string) => void;
}

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
      inicio: start.toISOString().split('T')[0],
      fim: end.toISOString().split('T')[0],
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

  // Report Data
  const [data, setData] = useState<any>(null);
  const [vendasDetalhes, setVendasDetalhes] = useState<VendaDetalheItem[]>([]);
  const [isLoadingVendas, setIsLoadingVendas] = useState(false);

  const fetchVisaoGeral = async (inicio: string, fim: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `${apiBaseUrl}/relatorios/visao-geral?data_inicio=${inicio}&data_fim=${fim}`,
        { headers: authHeaders }
      );
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Erro ao buscar visão geral:', err);
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

  return (
    <div className={clsx('space-y-6', 'text-left', 'animate-fade-in')}>
      {/* Top Header Bar */}
      <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-4.5', 'rounded-3xl', 'flex', 'flex-col', 'sm:flex-row', 'sm:items-center', 'justify-between', 'gap-4')}>
        <div className="space-y-1">
          <h3 className="font-serif font-bold text-base text-white">Relatórios — Visão Geral Operacional</h3>
          <p className="text-[10px] text-gray-400">
            Período selecionado: <strong className="text-gray-200">{dataInicio}</strong> até <strong className="text-gray-200">{dataFim}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Botão Ver Vendas */}
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

          {/* Seletor de Período */}
          <button
            type="button"
            onClick={() => setShowCalendarModal(true)}
            className="px-3.5 py-2 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5"
          >
            <CalendarIcon size={14} className="text-[#10b981]" />
            Alterar Período
          </button>

          {/* Exportar CSV */}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!data}
            className="px-3 py-2 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-gray-300 hover:text-white rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            title="Exportar CSV"
          >
            <Download size={14} />
            CSV
          </button>
        </div>
      </div>

      {/* Main Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Faturamento */}
        <div className="bg-[#121214] border border-[#27272A] p-5 rounded-3xl space-y-2">
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

        {/* Total Pedidos */}
        <div className="bg-[#121214] border border-[#27272A] p-5 rounded-3xl space-y-2">
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

        {/* Ticket Médio */}
        <div className="bg-[#121214] border border-[#27272A] p-5 rounded-3xl space-y-2">
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

        {/* Clientes Ativos */}
        <div className="bg-[#121214] border border-[#27272A] p-5 rounded-3xl space-y-2">
          <div className="flex justify-between items-center text-gray-400">
            <span className="text-[9px] font-bold uppercase tracking-wider">Clientes Ativos</span>
            <div className="p-1.5 bg-purple-500/15 text-purple-400 rounded-xl">
              <Users size={16} />
            </div>
          </div>
          <strong className="text-2xl text-white font-mono block">
            {data?.clientes_ativos ?? 0}
          </strong>
          <span className="text-[9px] text-gray-500 block">Comandas cadastradas no período</span>
        </div>
      </div>

      {/* Meta Mensal Block */}
      <div className="bg-[#121214] border border-[#27272A] p-5 rounded-3xl space-y-4">
        <div className="flex justify-between items-center border-b border-[#27272A] pb-3">
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
                className="px-2.5 py-1 bg-[#09090B] border border-[#27272A] rounded-xl text-white font-mono text-[10px] w-28"
              />
              <button
                type="button"
                onClick={handleSaveMeta}
                className="px-3 py-1 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-lg text-[9px] font-extrabold uppercase transition-all cursor-pointer"
              >
                Salvar
              </button>
              <button
                type="button"
                onClick={() => setEditingMeta(false)}
                className="px-2 py-1 bg-[#1C1C1F] text-gray-400 hover:text-white rounded-lg text-[9px] font-bold"
              >
                X
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setNewMetaInput(String(data?.meta_mensal || ''));
                setEditingMeta(true);
              }}
              className="px-3 py-1 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-gray-300 hover:text-white rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer"
            >
              Configurar Meta
            </button>
          )}
        </div>

        {/* Meta Progress Bar */}
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

          <div className="w-full h-3 bg-[#09090B] border border-[#27272A] rounded-full overflow-hidden p-0.5">
            <div
              className="h-full bg-[#10b981] rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, data?.meta_percentual || 0)}%` }}
            />
          </div>
        </div>

        {/* Projeção e Ritmo */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-[10px]">
          <div className="bg-[#1C1C1F]/60 border border-[#27272A]/60 p-3 rounded-2xl space-y-1">
            <span className="text-gray-400 text-[8px] font-bold uppercase tracking-wider block">Valor Restante</span>
            <strong className="text-sm font-mono text-white block">
              R$ {data?.meta_restante?.toFixed(2) ?? '0.00'}
            </strong>
          </div>
          <div className="bg-[#1C1C1F]/60 border border-[#27272A]/60 p-3 rounded-2xl space-y-1">
            <span className="text-gray-400 text-[8px] font-bold uppercase tracking-wider block">Projeção no Ritmo Atual</span>
            <strong className="text-sm font-mono text-emerald-400 block">
              R$ {data?.meta_projecao?.toFixed(2) ?? '0.00'}
            </strong>
          </div>
          <div className="bg-[#1C1C1F]/60 border border-[#27272A]/60 p-3 rounded-2xl space-y-1">
            <span className="text-gray-400 text-[8px] font-bold uppercase tracking-wider block">Média Diária Necessária</span>
            <strong className="text-sm font-mono text-amber-400 block">
              R$ {data?.meta_media_diaria_necessaria?.toFixed(2) ?? '0.00'} / dia
            </strong>
          </div>
        </div>
      </div>

      {/* Grid: Pedidos por dia (Plano Bistrô: NO delivery) & Horários de Pico */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Vendas por Dia */}
        <div className="bg-[#121214] border border-[#27272A] p-5 rounded-3xl space-y-4">
          <div className="flex justify-between items-center border-b border-[#27272A] pb-2">
            <span className="font-serif font-bold text-sm text-white">Pedidos por Dia (Plano Bistrô)</span>
            <span className="text-[8px] font-bold bg-[#1C1C1F] text-gray-400 px-2 py-0.5 rounded-full uppercase">
              Sem Delivery
            </span>
          </div>

          <div className="overflow-x-auto max-h-64 border border-[#27272A]/40 rounded-2xl">
            <table className="w-full text-left text-[10px]">
              <thead className="bg-[#1C1C1F] border-b border-[#27272A] text-gray-400 uppercase tracking-wider font-bold sticky top-0">
                <tr>
                  <th className="p-3">Data</th>
                  <th className="p-3 font-mono text-center">Qtd Pedidos</th>
                  <th className="p-3 font-mono text-right">Faturamento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272A]/40">
                {(data?.vendas_por_dia || []).map((v: any) => (
                  <tr key={v.data} className="hover:bg-[#1C1C1F]/40 transition-colors">
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

        {/* Horários de Pico */}
        <div className="bg-[#121214] border border-[#27272A] p-5 rounded-3xl space-y-4">
          <div className="flex items-center gap-2 border-b border-[#27272A] pb-2">
            <Clock size={16} className="text-[#10b981]" />
            <span className="font-serif font-bold text-sm text-white">Horários de Pico do Salão</span>
          </div>

          <div className="overflow-x-auto max-h-64 border border-[#27272A]/40 rounded-2xl">
            <table className="w-full text-left text-[10px]">
              <thead className="bg-[#1C1C1F] border-b border-[#27272A] text-gray-400 uppercase tracking-wider font-bold sticky top-0">
                <tr>
                  <th className="p-3">Horário</th>
                  <th className="p-3 font-mono text-center">Total Pedidos</th>
                  <th className="p-3 font-mono text-right">Faturamento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272A]/40">
                {(data?.horarios_pico || [])
                  .filter((h: any) => h.total_pedidos > 0)
                  .map((h: any) => (
                    <tr key={h.hora} className="hover:bg-[#1C1C1F]/40 transition-colors">
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

      {/* Modals & Drawers */}
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
