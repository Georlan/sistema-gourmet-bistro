import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { Award, Calendar as CalendarIcon, Download, ShoppingBag, DollarSign, Percent, Filter, BarChart2 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { PeriodoCalendarioModal } from '../relatorios/PeriodoCalendarioModal';
import { localCalendarDate } from '../../utils/dateTime';

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

const CARGO_OPTIONS = [
  { value: '', label: 'Comercial (padrão)' },
  { value: 'todos', label: 'Todos os cargos' },
  { value: 'garcom', label: 'Garçom' },
  { value: 'caixa', label: 'Caixa' },
  { value: 'atendente', label: 'Atendente' },
  { value: 'gerente', label: 'Gerente' },
  { value: 'cozinha', label: 'Cozinha' },
  { value: 'admin', label: 'Administrador' },
];

const ROLE_LABEL: Record<string, string> = {
  garcom: 'Garçom',
  caixa: 'Caixa',
  operador_caixa: 'Op. Caixa',
  atendente: 'Atendente',
  gerente: 'Gerente',
  admin: 'Administrador',
  cozinha: 'Cozinha',
};

const CustomChartTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-koma-panel border border-koma-border p-3 rounded-2xl shadow-xl text-left font-sans space-y-1 z-50">
        <p className="text-[10px] font-bold text-koma-foreground">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-xs font-bold font-mono" style={{ color: entry.color }}>
            {entry.name}: {entry.dataKey === 'faturamento' ? `R$ ${entry.value.toFixed(2)}` : `${entry.value} comandas`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

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
      inicio: localCalendarDate(start),
      fim: localCalendarDate(end),
    };
  };

  const defaults = getDefaultDates();
  const [dataInicio, setDataInicio] = useState(defaults.inicio);
  const [dataFim, setDataFim] = useState(defaults.fim);
  const [isLoading, setIsLoading] = useState(false);
  const [cargo, setCargo] = useState('');                   // '' = commercial default

  const [taxaAtiva, setTaxaAtiva] = useState(true);
  const [taxaPadrao, setTaxaPadrao] = useState(10.0);
  const [membros, setMembros] = useState<GarcomPerformanceItem[]>([]);
  const [showCalendarModal, setShowCalendarModal] = useState(false);

  const fetchDesempenho = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        data_inicio: dataInicio,
        data_fim: dataFim,
      });
      if (cargo) params.set('cargo', cargo);

      const res = await fetch(
        `${apiBaseUrl}/relatorios/equipe/desempenho?${params.toString()}`,
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
  }, [dataInicio, dataFim, cargo]);

  const totalAtendimentos = membros.reduce((acc, m) => acc + m.pedidos_atendidos, 0);
  const totalFaturamento = membros.reduce((acc, m) => acc + m.faturamento, 0);
  const totalComissao = membros.reduce((acc, m) => acc + m.comissao, 0);

  const handleExportCsv = () => {
    if (!membros.length) return;
    const periodo = `${dataInicio} até ${dataFim}`;
    let csv = `Funcionário;Cargo;Pedidos Atendidos;Faturamento (R$);Ticket Médio (R$);Comissão Proporcional (R$);Período\n`;
    membros.forEach((m) => {
      const label = ROLE_LABEL[m.role] || m.role;
      csv += `"${m.nome}";"${label}";${m.pedidos_atendidos};${m.faturamento.toFixed(2)};${m.ticket_medio.toFixed(2)};${m.comissao.toFixed(2)};"${periodo}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `desempenho_equipe_${dataInicio}_a_${dataFim}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('CSV exportado com sucesso!');
  };

  const cargoLabel = CARGO_OPTIONS.find(o => o.value === cargo)?.label ?? 'Todos os cargos';

  const teamChartData = membros.slice(0, 8).map((m) => ({
    name: m.nome.split(' ')[0],
    faturamento: m.faturamento,
    pedidos: m.pedidos_atendidos,
  }));

  return (
    <div className={clsx('space-y-6', 'text-left', 'animate-fade-in')}>
      {/* Top Header Bar */}
      <div className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'p-4.5', 'rounded-3xl', 'flex', 'flex-col', 'sm:flex-row', 'sm:items-center', 'justify-between', 'gap-4')}>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Award size={18} className="text-emerald-700 dark:text-emerald-400" />
            <h3 className="font-serif font-bold text-base text-koma-foreground">Desempenho Comercial da Equipe</h3>
          </div>
          <p className="text-[10px] text-koma-subtle">
            Período: <strong className="text-koma-secondary">{dataInicio}</strong> até <strong className="text-koma-secondary">{dataFim}</strong>
            {' | '}Taxa de Serviço: <strong className="text-emerald-400">{taxaAtiva ? `${taxaPadrao}%` : 'Desativada'}</strong>
            {' | '}Filtro: <strong className="text-sky-400">{cargoLabel}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Cargo Filter */}
          <div className="relative flex items-center gap-1.5 bg-koma-input border border-koma-border rounded-xl px-3 py-2">
            <Filter size={12} className="text-emerald-700 dark:text-emerald-400 shrink-0" />
            <select
              id="cargo-filter-select"
              value={cargo}
              onChange={e => setCargo(e.target.value)}
              className="bg-transparent text-koma-foreground text-[10px] font-bold cursor-pointer outline-none pr-1"
            >
              {CARGO_OPTIONS.map(o => (
                <option key={o.value} value={o.value} className="bg-koma-card text-koma-foreground">
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => setShowCalendarModal(true)}
            className="px-3.5 py-2 bg-koma-raised hover:bg-koma-card border border-koma-border text-koma-foreground rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5"
          >
            <CalendarIcon size={14} className="text-emerald-700 dark:text-emerald-400" />
            Alterar Período
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!membros.length}
            className="px-3.5 py-2 bg-koma-raised hover:bg-koma-card border border-koma-border text-koma-secondary hover:text-koma-foreground rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download size={14} />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-2">
          <div className="flex justify-between items-center text-koma-subtle">
            <span className="text-[9px] font-bold uppercase tracking-wider">Total Atendimentos</span>
            <div className="p-1.5 bg-sky-500/15 text-sky-400 rounded-xl">
              <ShoppingBag size={16} />
            </div>
          </div>
          <strong className="text-2xl text-koma-foreground font-mono block">{totalAtendimentos}</strong>
          <span className="text-[9px] text-koma-muted block">Comandas atendidas pela equipe</span>
        </div>

        <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-2">
          <div className="flex justify-between items-center text-koma-subtle">
            <span className="text-[9px] font-bold uppercase tracking-wider">Faturamento Gerado</span>
            <div className="p-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 rounded-xl">
              <DollarSign size={16} />
            </div>
          </div>
          <strong className="text-2xl text-koma-foreground font-mono block">
            R$ {totalFaturamento.toFixed(2)}
          </strong>
          <span className="text-[9px] text-koma-muted block">Vendas diretas da equipe</span>
        </div>

        {taxaAtiva && (
          <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-2">
            <div className="flex justify-between items-center text-koma-subtle">
              <span className="text-[9px] font-bold uppercase tracking-wider">Comissão Total Proporcional</span>
              <div className="p-1.5 bg-purple-500/15 text-purple-400 rounded-xl">
                <Percent size={16} />
              </div>
            </div>
            <strong className="text-2xl text-purple-400 font-mono block">
              R$ {totalComissao.toFixed(2)}
            </strong>
            <span className="text-[9px] text-koma-muted block">Calculada individualmente conforme vendas</span>
          </div>
        )}
      </div>

      {/* Team Charts */}
      {teamChartData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-4">
            <div className="flex items-center gap-2 border-b border-koma-border pb-3">
              <BarChart2 size={16} className="text-emerald-700 dark:text-emerald-400" />
              <span className="font-serif font-bold text-sm text-koma-foreground">Faturamento Gerado por Atendente</span>
            </div>

            <div className="h-60 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamChartData} margin={{ top: 10, right: 10, left: -15, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--koma-border-default)" vertical={false} />
                  <XAxis dataKey="name" stroke="#71717A" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#71717A" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `R$${v}`} />
                  <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'var(--koma-border-default)' }} />
                  <Bar dataKey="faturamento" name="Faturamento (R$)" fill="#10b981" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-4">
            <div className="flex items-center gap-2 border-b border-koma-border pb-3">
              <BarChart2 size={16} className="text-sky-400" />
              <span className="font-serif font-bold text-sm text-koma-foreground">Volume de Atendimentos por Garçom</span>
            </div>

            <div className="h-60 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamChartData} margin={{ top: 10, right: 10, left: -15, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--koma-border-default)" vertical={false} />
                  <XAxis dataKey="name" stroke="#71717A" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#71717A" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'var(--koma-border-default)' }} />
                  <Bar dataKey="pedidos" name="Atendimentos" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Team Performance Table */}
      <div className="bg-koma-panel border border-koma-border rounded-3xl overflow-hidden p-5 space-y-4">
        <div className="border-b border-koma-border pb-2 flex items-center justify-between">
          <span className="font-serif font-bold text-sm text-koma-foreground">Desempenho por Funcionário</span>
          <span className="text-[9px] text-koma-muted font-mono">{membros.length} funcionário{membros.length !== 1 ? 's' : ''}</span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-koma-subtle text-xs animate-pulse">
            Carregando desempenho da equipe...
          </div>
        ) : membros.length === 0 ? (
          <div className="p-12 text-center text-koma-muted text-xs">
            Nenhum funcionário encontrado no período para o filtro selecionado.
          </div>
        ) : (
          <div className="overflow-x-auto border border-koma-border rounded-2xl">
            <table className="w-full text-left text-[10px]">
              <thead className="bg-koma-raised border-b border-koma-border text-koma-subtle uppercase tracking-wider font-bold">
                <tr>
                  <th className="p-3.5">#</th>
                  <th className="p-3.5">Funcionário</th>
                  <th className="p-3.5">Cargo</th>
                  <th className="p-3.5 text-center font-mono">Pedidos Atendidos</th>
                  <th className="p-3.5 text-right font-mono">Faturamento Individual</th>
                  <th className="p-3.5 text-right font-mono">Ticket Médio</th>
                  {taxaAtiva && <th className="p-3.5 text-right font-mono">Comissão ({taxaPadrao}%)</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-koma-border">
                {membros.map((m, idx) => (
                  <tr key={m.id} className="hover:bg-koma-raised/50 transition-colors">
                    <td className="p-3.5 font-mono text-koma-muted text-center">{idx + 1}</td>
                    <td className="p-3.5 font-bold text-koma-foreground">
                      <div>
                        <span>{m.nome}</span>
                        {m.email && <span className="text-[8px] text-koma-muted block">{m.email}</span>}
                      </div>
                    </td>
                    <td className="p-3.5 text-koma-secondary capitalize">
                      {ROLE_LABEL[m.role] || m.role}
                    </td>
                    <td className="p-3.5 text-center font-mono font-bold text-sky-400">
                      {m.pedidos_atendidos}
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-koma-foreground">
                      R$ {m.faturamento.toFixed(2)}
                    </td>
                    <td className="p-3.5 text-right font-mono text-koma-secondary">
                      R$ {m.ticket_medio.toFixed(2)}
                    </td>
                    {taxaAtiva && (
                      <td className="p-3.5 text-right font-mono font-extrabold text-purple-400">
                        R$ {m.comissao.toFixed(2)}
                      </td>
                    )}
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
