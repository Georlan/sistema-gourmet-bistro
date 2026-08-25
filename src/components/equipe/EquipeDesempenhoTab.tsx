import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Calendar as CalendarIcon, Download, Filter, BarChart2 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { PeriodoCalendarioModal } from '../relatorios/PeriodoCalendarioModal';
import { localCalendarDate } from '../../utils/dateTime';
import { OperationalBanner } from '../shared/OperationalBanner';
import { fetchReportJson, useReportRealtimeRefresh } from '../relatorios/useReportRealtimeRefresh';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatMoney = (value: number | null | undefined) => money.format(Number(value) || 0);
const formatDate = (value: string) => value.split('-').reverse().join('/');

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
            {entry.name}: {entry.dataKey === 'faturamento' ? formatMoney(entry.value) : `${entry.value} comandas`}
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
  const [chartMetric, setChartMetric] = useState<'faturamento' | 'pedidos'>('faturamento');
  const requestRef = useRef(0);

  const fetchDesempenho = useCallback(async () => {
    const requestId = ++requestRef.current;
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        data_inicio: dataInicio,
        data_fim: dataFim,
      });
      if (cargo) params.set('cargo', cargo);

      const json = await fetchReportJson<any>(
        `${apiBaseUrl}/relatorios/equipe/desempenho?${params.toString()}`,
        authHeaders,
      );
      if (requestRef.current === requestId) {
        setTaxaAtiva(json.taxa_servico_ativa);
        setTaxaPadrao(json.taxa_servico_padrao);
        setMembros(json.membros || []);
      }
    } catch (err) {
      console.error('Erro ao carregar desempenho da equipe:', err);
    } finally {
      if (requestRef.current === requestId) setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders, cargo, dataFim, dataInicio]);

  useEffect(() => {
    void fetchDesempenho();
    return () => { requestRef.current += 1; };
  }, [fetchDesempenho]);

  useReportRealtimeRefresh(fetchDesempenho);

  const totalAtendimentos = membros.reduce((acc, m) => acc + m.pedidos_atendidos, 0);
  const totalFaturamento = membros.reduce((acc, m) => acc + m.faturamento, 0);
  const totalComissao = membros.reduce((acc, m) => acc + m.comissao, 0);

  const handleExportCsv = () => {
    if (!membros.length) return;
    const periodo = `${dataInicio} até ${dataFim}`;
    let csv = `Funcionário;Cargo;Atendimentos;Valor Recebido (R$);Ticket Médio (R$);Serviço Proporcional (R$);Período\n`;
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
      <OperationalBanner
        id="reports-team-heading"
        eyebrow="EQUIPE"
        title="Desempenho"
        accent="que orienta"
        description={`Atendimentos atribuídos de ${formatDate(dataInicio)} a ${formatDate(dataFim)} · ${cargoLabel}.`}
        metrics={[
          { label: totalAtendimentos === 1 ? 'atendimento' : 'atendimentos', value: totalAtendimentos },
          { label: 'valor recebido', value: formatMoney(totalFaturamento) },
          { label: taxaAtiva ? `serviço proporcional (${taxaPadrao}%)` : 'taxa de serviço inativa', value: taxaAtiva ? formatMoney(totalComissao) : '—' },
        ]}
      />

      <div className="flex flex-col gap-3 rounded-2xl border border-koma-border bg-koma-panel p-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[10px] text-koma-muted">Compare participação e volume; valores sem atendimento permanecem visíveis na tabela.</span>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
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
            Período
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!membros.length}
            className="px-3.5 py-2 bg-koma-raised hover:bg-koma-card border border-koma-border text-koma-secondary hover:text-koma-foreground rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download size={14} />
            Exportar
          </button>
        </div>
      </div>

      {/* Team Charts */}
      {teamChartData.length > 0 && (
          <div className="bg-koma-panel border border-koma-border p-4 sm:p-5 rounded-3xl space-y-4 shadow-xs">
            <div className="flex flex-col gap-3 border-b border-koma-border pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
              <BarChart2 size={16} className="text-emerald-700 dark:text-emerald-400" />
              <span className="font-serif font-bold text-sm text-koma-foreground">{chartMetric === 'faturamento' ? 'Valor recebido por atendente' : 'Atendimentos por pessoa'}</span>
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-koma-border bg-koma-input p-1">
                <button type="button" onClick={() => setChartMetric('faturamento')} className={clsx('rounded-lg px-3 py-1.5 text-[9px] font-bold uppercase transition-colors', chartMetric === 'faturamento' ? 'koma-btn-success' : 'text-koma-muted')}>Valor</button>
                <button type="button" onClick={() => setChartMetric('pedidos')} className={clsx('rounded-lg px-3 py-1.5 text-[9px] font-bold uppercase transition-colors', chartMetric === 'pedidos' ? 'koma-btn-success' : 'text-koma-muted')}>Volume</button>
              </div>
            </div>

            <div className="h-64 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamChartData} margin={{ top: 10, right: 10, left: chartMetric === 'faturamento' ? 5 : -15, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--koma-border-default)" vertical={false} opacity={0.6} />
                  <XAxis dataKey="name" stroke="var(--koma-text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--koma-text-muted)" fontSize={11} width={chartMetric === 'faturamento' ? 62 : 34} tickLine={false} axisLine={false} tickFormatter={chartMetric === 'faturamento' ? (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : undefined} />
                  <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'var(--koma-border-default)' }} />
                  <Bar dataKey={chartMetric} name={chartMetric === 'faturamento' ? 'Valor recebido' : 'Atendimentos'} fill="#059669" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
      )}

      {/* Team Performance Table */}
      <div className="bg-koma-panel border border-koma-border rounded-3xl overflow-hidden p-5 space-y-4 shadow-xs">
        <div className="border-b border-koma-border pb-2 flex items-center justify-between">
          <span className="font-serif font-bold text-sm text-koma-foreground">Desempenho por Funcionário</span>
          <span className="text-[9px] text-koma-muted font-mono font-medium">{membros.length} funcionário{membros.length !== 1 ? 's' : ''}</span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-koma-muted text-xs animate-pulse">
            Carregando desempenho da equipe...
          </div>
        ) : membros.length === 0 ? (
          <div className="p-12 text-center text-koma-muted text-xs font-medium">
            Nenhum funcionário encontrado no período para o filtro selecionado.
          </div>
        ) : (
          <div className="overflow-x-auto border border-koma-border rounded-2xl">
            <table className="w-full text-left text-[10px]">
              <thead className="bg-koma-raised border-b border-koma-border text-koma-muted uppercase tracking-wider font-extrabold text-[9px]">
                <tr>
                  <th className="p-3.5">#</th>
                  <th className="p-3.5">Funcionário</th>
                  <th className="p-3.5">Cargo</th>
                  <th className="p-3.5 text-center font-mono">Atendimentos</th>
                  <th className="p-3.5 text-right font-mono">Valor recebido</th>
                  <th className="p-3.5 text-right font-mono">Ticket Médio</th>
                  {taxaAtiva && <th className="p-3.5 text-right font-mono">Serviço ({taxaPadrao}%)</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-koma-border">
                {membros.map((m, idx) => (
                  <tr key={m.id} className="hover:bg-koma-raised/50 transition-colors">
                    <td className="p-3.5 font-mono text-koma-muted text-center font-bold">{idx + 1}</td>
                    <td className="p-3.5 font-bold text-koma-foreground">
                      <div>
                        <span>{m.nome}</span>
                        {m.email && <span className="text-[9px] text-koma-muted block font-mono">{m.email}</span>}
                      </div>
                    </td>
                    <td className="p-3.5 text-koma-muted font-medium capitalize">
                      {ROLE_LABEL[m.role] || m.role}
                    </td>
                    <td className="p-3.5 text-center font-mono font-bold text-koma-foreground text-xs">
                      {m.pedidos_atendidos}
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-koma-foreground">
                      {formatMoney(m.faturamento)}
                    </td>
                    <td className="p-3.5 text-right font-mono text-koma-muted font-medium">
                      {formatMoney(m.ticket_medio)}
                    </td>
                    {taxaAtiva && (
                      <td className="p-3.5 text-right font-mono font-extrabold text-emerald-700 dark:text-emerald-300">
                        {formatMoney(m.comissao)}
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
