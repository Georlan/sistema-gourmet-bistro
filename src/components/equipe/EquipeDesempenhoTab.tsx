import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Calendar as CalendarIcon, Download, Filter, BarChart2 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { PeriodoCalendarioModal } from '../relatorios/PeriodoCalendarioModal';
import { KomaSnapshotLoading } from '../shared/KomaSnapshotLoading';
import { OperationalBanner } from '../shared/OperationalBanner';
import { fetchReportJson, useReportRealtimeRefresh } from '../relatorios/useReportRealtimeRefresh';
import { ReportActionBar } from '../relatorios/ReportActionBar';
import { useSharedReportPeriod } from '../relatorios/useSharedReportPeriod';

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
  { value: 'atendimento', label: 'Atendimento' },
  { value: '', label: 'Comercial (inclui caixa)' },
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
  const { dataInicio, dataFim, applyPeriod } = useSharedReportPeriod();
  const [cargo, setCargo] = useState('atendimento');
  const snapshotKey = `${dataInicio}:${dataFim}:${cargo}`;
  const [loadedSnapshotKey, setLoadedSnapshotKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const [taxaAtiva, setTaxaAtiva] = useState(false);
  const [taxaPadrao, setTaxaPadrao] = useState(0);
  const [membros, setMembros] = useState<GarcomPerformanceItem[]>([]);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [chartMetric, setChartMetric] = useState<'faturamento' | 'pedidos'>('faturamento');
  const requestRef = useRef(0);

  const fetchDesempenho = useCallback(async () => {
    const requestId = ++requestRef.current;
    const requestSnapshotKey = `${dataInicio}:${dataFim}:${cargo}`;
    setIsLoading(true);
    setHasError(false);
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
      if (!json || typeof json !== 'object' || !Array.isArray(json.membros)) {
        throw new Error('TEAM_PERFORMANCE_INVALID_RESPONSE');
      }
      if (requestRef.current === requestId) {
        setTaxaAtiva(Boolean(json.taxa_servico_ativa));
        setTaxaPadrao(Number(json.taxa_servico_padrao || 0));
        setMembros(json.membros);
        setLoadedSnapshotKey(requestSnapshotKey);
      }
    } catch (err) {
      console.error('Erro ao carregar desempenho da equipe:', err);
      if (requestRef.current === requestId) setHasError(true);
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
    let csv = `Funcionário;Cargo;Atendimentos;Valor Atribuído (R$);Ticket Médio (R$);Serviço Proporcional (R$);Período\n`;
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

  const teamChartData = membros.filter((m) => m.pedidos_atendidos > 0).slice(0, 8).map((m) => ({
    name: m.nome.length > 24 ? `${m.nome.slice(0, 22)}…` : m.nome,
    faturamento: m.faturamento,
    pedidos: m.pedidos_atendidos,
  }));
  const identityIssues = useMemo(() => {
    const counts = new Map<string, number>();
    membros.forEach((member) => {
      const key = (member.nome || '').trim().toLocaleLowerCase('pt-BR');
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    const duplicateNames = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name));
    const affectedIds = new Set(
      membros
        .filter((member) => !member.email || duplicateNames.has((member.nome || '').trim().toLocaleLowerCase('pt-BR')))
        .map((member) => member.id),
    );
    return { duplicateNames, affectedCount: affectedIds.size };
  }, [membros]);

  if (loadedSnapshotKey !== snapshotKey) {
    return (
      <KomaSnapshotLoading
        testId="team-performance-snapshot-loading"
        title="Sincronizando desempenho da equipe"
        description="Carregando os atendimentos reais para este período e função antes de mostrar totais ou uma equipe vazia."
        error={!isLoading && hasError ? 'Não foi possível carregar o desempenho da equipe.' : null}
        errorDescription="Ainda não foi possível confirmar este recorte. O KÔMA não vai exibir zeros nem dados de outro filtro como se fossem atuais."
        onRetry={() => void fetchDesempenho()}
      />
    );
  }

  return (
    <div className={"space-y-6 text-left animate-fade-in"}>
      <OperationalBanner
        id="reports-team-heading"
        eyebrow="EQUIPE"
        title="Desempenho"
        accent="que orienta"
        description={`Atendimentos atribuídos de ${formatDate(dataInicio)} a ${formatDate(dataFim)} · ${cargoLabel}.`}
        metrics={[
          { label: totalAtendimentos === 1 ? 'atendimento' : 'atendimentos', value: totalAtendimentos },
          { label: 'valor atribuído', value: formatMoney(totalFaturamento) },
          { label: taxaAtiva ? `serviço proporcional (${taxaPadrao}%)` : 'taxa de serviço inativa', value: taxaAtiva ? formatMoney(totalComissao) : '—' },
        ]}
      />

      <ReportActionBar info={<span>O valor é atribuído a quem abriu a comanda; use os cargos para não misturar atendimento e caixa.</span>}>
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
      </ReportActionBar>

      {hasError && !isLoading && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-500/35 bg-rose-500/10 p-3 text-[10px] leading-relaxed text-rose-800 dark:text-rose-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span><strong>Não foi possível atualizar este relatório.</strong> O último snapshot válido foi mantido.</span>
        </div>
      )}

      {identityIssues.affectedCount > 0 && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3 text-[10px] leading-relaxed text-amber-900 dark:text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span><strong>Revise {identityIssues.affectedCount} {identityIssues.affectedCount === 1 ? 'cadastro' : 'cadastros'} da equipe.</strong> Nome repetido ou e-mail ausente pode dividir o histórico da mesma pessoa.</span>
        </div>
      )}

      {teamChartData.length > 0 && (
          <div className="bg-koma-panel border border-koma-border p-4 sm:p-5 rounded-3xl space-y-4 shadow-xs">
            <div className="flex flex-col gap-3 border-b border-koma-border pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
              <BarChart2 size={16} className="text-emerald-700 dark:text-emerald-400" />
              <span className="font-serif font-bold text-sm text-koma-foreground">{chartMetric === 'faturamento' ? 'Valor atribuído por atendente' : 'Atendimentos por pessoa'}</span>
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-koma-border bg-koma-input p-1">
                <button type="button" onClick={() => setChartMetric('faturamento')} className={clsx('rounded-lg px-3 py-1.5 text-[9px] font-bold uppercase transition-colors', chartMetric === 'faturamento' ? 'koma-btn-success' : 'text-koma-muted')}>Valor</button>
                <button type="button" onClick={() => setChartMetric('pedidos')} className={clsx('rounded-lg px-3 py-1.5 text-[9px] font-bold uppercase transition-colors', chartMetric === 'pedidos' ? 'koma-btn-success' : 'text-koma-muted')}>Volume</button>
              </div>
            </div>

            <div className="h-64 w-full pt-1 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={teamChartData} margin={{ top: 4, right: 18, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--koma-border-default)" horizontal={false} opacity={0.6} />
                  <XAxis type="number" stroke="var(--koma-text-muted)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={chartMetric === 'faturamento' ? (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : undefined} />
                  <YAxis type="category" dataKey="name" stroke="var(--koma-text-muted)" fontSize={10} width={125} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'var(--koma-border-default)' }} />
                  <Bar dataKey={chartMetric} name={chartMetric === 'faturamento' ? 'Valor atribuído' : 'Atendimentos'} fill="#059669" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
      )}

      <div className="bg-koma-panel border border-koma-border rounded-3xl overflow-hidden p-5 space-y-4 shadow-xs">
        <div className="border-b border-koma-border pb-2 flex items-center justify-between">
          <span className="font-serif font-bold text-sm text-koma-foreground">Desempenho por Funcionário</span>
          <span className="text-[9px] text-koma-muted font-mono font-medium">{membros.length} funcionário{membros.length !== 1 ? 's' : ''}</span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-koma-muted text-xs animate-pulse">
            Atualizando desempenho da equipe...
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
                  <th className="p-3.5 text-right font-mono">Valor atribuído</th>
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
                        {(!m.email || identityIssues.duplicateNames.has((m.nome || '').trim().toLocaleLowerCase('pt-BR'))) && (
                          <span className="mt-1 block text-[8px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Cadastro precisa de revisão</span>
                        )}
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
          onApply={applyPeriod}
        />
      )}
    </div>
  );
};