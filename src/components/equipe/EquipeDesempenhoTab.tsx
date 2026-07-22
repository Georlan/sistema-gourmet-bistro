import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { Award, Calendar as CalendarIcon, Download, ShoppingBag, DollarSign, Percent } from 'lucide-react';
import { PeriodoCalendarioModal } from '../relatorios/PeriodoCalendarioModal';

interface EquipeDesempenhoTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  showToast: (msg: string) => void;
}

export interface GarcomPerformanceItem {
  id: string;
  nome: string;
  email: string;
  role: string;
  pedidos_atendidos: number;
  faturamento: number;
  ticket_medio: number;
  comissao: number;
  taxa_servico_usada: number;
}

export const EquipeDesempenhoTab: React.FC<EquipeDesempenhoTabProps> = ({
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

  const [taxaAtiva, setTaxaAtiva] = useState(true);
  const [taxaPadrao, setTaxaPadrao] = useState(10.0);
  const [membros, setMembros] = useState<GarcomPerformanceItem[]>([]);
  const [showCalendarModal, setShowCalendarModal] = useState(false);

  const fetchDesempenho = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `${apiBaseUrl}/relatorios/equipe/desempenho?data_inicio=${dataInicio}&data_fim=${dataFim}`,
        { headers: authHeaders }
      );
      if (res.ok) {
        const json = await res.json();
        setTaxaAtiva(json.taxa_servico_ativa);
        setTaxaPadrao(json.taxa_servico_padrao);
        setMembros(json.membros || []);
      }
    } catch (err) {
      console.error('Erro ao carregar desempenho da equipe:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDesempenho();
  }, [dataInicio, dataFim]);

  const totalAtendimentos = membros.reduce((acc, m) => acc + m.pedidos_atendidos, 0);
  const totalFaturamento = membros.reduce((acc, m) => acc + m.faturamento, 0);
  const totalComissao = membros.reduce((acc, m) => acc + m.comissao, 0);

  const handleExportCsv = () => {
    if (!membros.length) return;
    let csv = 'Funcionário;Cargo;Pedidos Atendidos;Faturamento (R$);Ticket Médio (R$);Comissão Proporcional (R$)\n';
    membros.forEach((m) => {
      csv += `"${m.nome}";"${m.role}";${m.pedidos_atendidos};${m.faturamento.toFixed(2)};${m.ticket_medio.toFixed(2)};${m.comissao.toFixed(2)}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `desempenho_equipe_${dataInicio}_a_${dataFim}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className={clsx('space-y-6', 'text-left', 'animate-fade-in')}>
      {/* Top Header Bar */}
      <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'p-4.5', 'rounded-3xl', 'flex', 'flex-col', 'sm:flex-row', 'sm:items-center', 'justify-between', 'gap-4')}>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Award size={18} className="text-[#10b981]" />
            <h3 className="font-serif font-bold text-base text-white">Desempenho & Comissão da Equipe</h3>
          </div>
          <p className="text-[10px] text-gray-400">
            Período: <strong className="text-gray-200">{dataInicio}</strong> até <strong className="text-gray-200">{dataFim}</strong> | Taxa de Serviço Vigente: <strong className="text-emerald-400">{taxaAtiva ? `${taxaPadrao}%` : 'Desativada'}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowCalendarModal(true)}
            className="px-3.5 py-2 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5"
          >
            <CalendarIcon size={14} className="text-[#10b981]" />
            Alterar Período
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!membros.length}
            className="px-3.5 py-2 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-gray-300 hover:text-white rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download size={14} />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#121214] border border-[#27272A] p-5 rounded-3xl space-y-2">
          <div className="flex justify-between items-center text-gray-400">
            <span className="text-[9px] font-bold uppercase tracking-wider">Total Atendimentos</span>
            <div className="p-1.5 bg-sky-500/15 text-sky-400 rounded-xl">
              <ShoppingBag size={16} />
            </div>
          </div>
          <strong className="text-2xl text-white font-mono block">{totalAtendimentos}</strong>
          <span className="text-[9px] text-gray-500 block">Comandas atendidas pelos garçons</span>
        </div>

        <div className="bg-[#121214] border border-[#27272A] p-5 rounded-3xl space-y-2">
          <div className="flex justify-between items-center text-gray-400">
            <span className="text-[9px] font-bold uppercase tracking-wider">Faturamento Gerado</span>
            <div className="p-1.5 bg-[#10b981]/15 text-[#10b981] rounded-xl">
              <DollarSign size={16} />
            </div>
          </div>
          <strong className="text-2xl text-white font-mono block">
            R$ {totalFaturamento.toFixed(2)}
          </strong>
          <span className="text-[9px] text-gray-500 block">Vendas diretas da equipe</span>
        </div>

        <div className="bg-[#121214] border border-[#27272A] p-5 rounded-3xl space-y-2">
          <div className="flex justify-between items-center text-gray-400">
            <span className="text-[9px] font-bold uppercase tracking-wider">Comissão Total Proporcional</span>
            <div className="p-1.5 bg-purple-500/15 text-purple-400 rounded-xl">
              <Percent size={16} />
            </div>
          </div>
          <strong className="text-2xl text-purple-400 font-mono block">
            R$ {totalComissao.toFixed(2)}
          </strong>
          <span className="text-[9px] text-gray-500 block">Calculada individualmente conforme vendas</span>
        </div>
      </div>

      {/* Team Performance Table */}
      <div className="bg-[#121214] border border-[#27272A] rounded-3xl overflow-hidden p-5 space-y-4">
        <div className="border-b border-[#27272A] pb-2">
          <span className="font-serif font-bold text-sm text-white">Desempenho por Funcionário</span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-gray-400 text-xs animate-pulse">
            Carregando desempenho dos garçons...
          </div>
        ) : membros.length === 0 ? (
          <div className="p-12 text-center text-gray-500 text-xs">
            Nenhum funcionário encontrado no período.
          </div>
        ) : (
          <div className="overflow-x-auto border border-[#27272A]/40 rounded-2xl">
            <table className="w-full text-left text-[10px]">
              <thead className="bg-[#1C1C1F] border-b border-[#27272A] text-gray-400 uppercase tracking-wider font-bold">
                <tr>
                  <th className="p-3.5">Funcionário</th>
                  <th className="p-3.5">Cargo</th>
                  <th className="p-3.5 text-center font-mono">Pedidos Atendidos</th>
                  <th className="p-3.5 text-right font-mono">Faturamento Individual</th>
                  <th className="p-3.5 text-right font-mono">Ticket Médio</th>
                  <th className="p-3.5 text-right font-mono">Comissão Proporcional ({taxaPadrao}%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272A]/40">
                {membros.map((m) => (
                  <tr key={m.id} className="hover:bg-[#1C1C1F]/40 transition-colors">
                    <td className="p-3.5 font-bold text-white">
                      <div>
                        <span>{m.nome}</span>
                        {m.email && <span className="text-[8px] text-gray-500 block">{m.email}</span>}
                      </div>
                    </td>
                    <td className="p-3.5 text-gray-300 capitalize">{m.role}</td>
                    <td className="p-3.5 text-center font-mono font-bold text-sky-400">
                      {m.pedidos_atendidos}
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-white">
                      R$ {m.faturamento.toFixed(2)}
                    </td>
                    <td className="p-3.5 text-right font-mono text-gray-300">
                      R$ {m.ticket_medio.toFixed(2)}
                    </td>
                    <td className="p-3.5 text-right font-mono font-extrabold text-purple-400">
                      R$ {m.comissao.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCalendarModal && (
        <PeriodoCalendarioModal
          onClose={() => setShowCalendarModal(false)}
          dataInicio={dataInicio}
          dataFim={dataFim}
          onApply={(ini, fim) => {
            setDataInicio(ini);
            setDataFim(fim);
          }}
        />
      )}
    </div>
  );
};
