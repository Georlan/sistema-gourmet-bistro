import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Download, Info, Search, Layers, AlertCircle, RefreshCw } from 'lucide-react';
import { PeriodoCalendarioModal } from './PeriodoCalendarioModal';
import { OperationalBanner } from '../shared/OperationalBanner';
import { ReportActionBar } from './ReportActionBar';
import { ReportPeriodButton } from './ReportPeriodButton';
import { useSharedReportPeriod } from './useSharedReportPeriod';
import { fetchReportJson, useReportRealtimeRefresh } from './useReportRealtimeRefresh';
import {
  type ModifierConsumptionReport,
  type ModifierConsumptionOrder,
  normalizeModifierConsumption,
  arrangeOptions,
  summarizeModifierConsumption,
  formatShare,
} from '../../domain/modifierConsumption';

interface RelatoriosComplementosViewProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  showToast: (msg: string) => void;
}

export const RelatoriosComplementosView: React.FC<RelatoriosComplementosViewProps> = ({
  apiBaseUrl,
  authHeaders,
  showToast,
}) => {
  const { dataInicio, dataFim, applyPeriod } = useSharedReportPeriod();
  const [report, setReport] = useState<ModifierConsumptionReport | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('todos');
  const [ordenacao, setOrdenacao] = useState<ModifierConsumptionOrder>('mais');
  const [busca, setBusca] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);

  const requestRef = useRef(0);

  const fetchReport = useCallback(async () => {
    const requestId = ++requestRef.current;
    setIsLoading(true);
    setHasError(false);
    try {
      let url = `${apiBaseUrl}/relatorios/complementos?data_inicio=${dataInicio}&data_fim=${dataFim}`;
      if (selectedProductId) {
        url += `&produto_id=${encodeURIComponent(selectedProductId)}`;
      }
      const json = await fetchReportJson<any>(url, authHeaders);
      if (requestRef.current === requestId) {
        setReport(normalizeModifierConsumption(json));
      }
    } catch (error) {
      console.error('Erro ao carregar relatório de complementos:', error);
      if (requestRef.current === requestId) {
        setHasError(true);
      }
    } finally {
      if (requestRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [apiBaseUrl, authHeaders, dataInicio, dataFim, selectedProductId]);

  useEffect(() => {
    void fetchReport();
    return () => {
      requestRef.current += 1;
    };
  }, [fetchReport]);

  useReportRealtimeRefresh(fetchReport);

  const summary = useMemo(() => {
    return report ? summarizeModifierConsumption(report) : null;
  }, [report]);

  const handleExportCsv = () => {
    if (!report || !report.grupos.length) return;
    let csv = 'Grupo;ID Opção;Opção;Quantidade;Participação (%);Status;Origem\n';
    report.grupos.forEach((g) => {
      g.opcoes.forEach((o) => {
        const status = o.arquivada ? 'Arquivada' : o.ativa === false ? 'Pausada' : 'Ativa';
        csv += `"${g.grupo_nome}";"${o.opcao_id}";"${o.opcao_nome}";${o.quantidade};${o.participacao_pct ?? ''};"${status}";"${g.grupo_origem_id || 'Próprio'}"\n`;
      });
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const prodSuffix = selectedProductId ? `_produto_${selectedProductId}` : '';
    link.download = `consumo_complementos_${dataInicio}_a_${dataFim}${prodSuffix}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Relatório de complementos exportado.');
  };

  const filteredGroups = useMemo(() => {
    if (!report) return [];
    if (selectedGroupId === 'todos') {
      return report.grupos;
    }
    return report.grupos.filter((g) => g.grupo_id === selectedGroupId);
  }, [report, selectedGroupId]);

  return (
    <div className="space-y-5 text-left animate-fade-in">
      {/* Banner de Indicadores Compactos */}
      <OperationalBanner
        id="reports-modifiers-heading"
        eyebrow="COMPLEMENTOS"
        title="Consumo de"
        accent="escolhas e complementos"
        description="Métricas reais de saída de opções e adicionais baseadas na entrada de pedidos."
        metrics={[
          {
            label: summary?.totalSelections === 1 ? 'seleção feita' : 'total de seleções',
            value: summary ? summary.totalSelections : '—',
          },
          {
            label: 'opções com saída',
            value: summary ? summary.optionsWithOutput : '—',
          },
          {
            label: 'grupo com mais saída',
            value: summary?.topGroup ? `${summary.topGroup.name} (${summary.topGroup.total})` : '—',
          },
          {
            label: 'opções ativas sem saída',
            value: summary ? summary.activeWithoutOutput : '—',
          },
        ]}
      />

      {/* Barra de Ações com Informação e Período */}
      <ReportActionBar
        info={
          <div className="flex min-w-0 items-start gap-2 text-[10px] leading-relaxed text-koma-muted">
            <Info size={14} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
            <span>
              <strong className="text-koma-foreground">Saída por unidade real.</strong> A contagem reflete o mix de opções escolhidas em cada unidade dos pedidos, excluindo cancelamentos.
            </span>
          </div>
        }
      >
        <ReportPeriodButton inicio={dataInicio} fim={dataFim} onClick={() => setShowCalendarModal(true)} />
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={!report || report.total_selecoes === 0 || isLoading || hasError}
          className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3.5 py-2 text-[10px] font-bold text-koma-muted transition-all hover:bg-koma-card hover:text-koma-foreground disabled:opacity-50"
        >
          <Download size={14} /> Exportar
        </button>
      </ReportActionBar>

      {/* Tratamento de Erro */}
      {hasError && !isLoading && (
        <div className="mx-auto my-6 max-w-md space-y-3 rounded-3xl border border-rose-900/50 bg-koma-panel p-8 text-center">
          <AlertCircle size={28} className="mx-auto text-rose-500" />
          <h3 className="text-sm font-bold text-koma-foreground">Não foi possível carregar o consumo de complementos</h3>
          <p className="text-xs text-koma-muted">Ocorreu uma falha ao consultar os dados operacionais.</p>
          <button
            onClick={() => void fetchReport()}
            className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Controles e Filtros */}
      <div className="space-y-3 rounded-2xl border border-koma-border bg-koma-panel p-3 shadow-xs">
        <div className="flex flex-col items-stretch justify-between gap-3 lg:flex-row lg:items-center">
          {/* Ordenação */}
          <div className="flex w-full items-center gap-1.5 lg:w-auto">
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-koma-muted">Ordenar:</span>
            <div className="grid flex-1 grid-cols-3 gap-1 rounded-xl border border-koma-border bg-koma-input p-1 sm:flex-none">
              {(
                [
                  ['mais', 'Mais consumidos'],
                  ['menos', 'Menos consumidos'],
                  ['todos', 'Todos'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setOrdenacao(value)}
                  className={clsx(
                    'cursor-pointer rounded-lg px-2.5 py-1.5 text-[9px] font-extrabold uppercase transition-all',
                    ordenacao === value ? 'koma-btn-success' : 'text-koma-muted hover:text-koma-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Filtro de Busca e Filtro de Produto de Origem */}
          <div className="grid w-full max-w-xl flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="relative w-full">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
              <input
                type="text"
                placeholder="Buscar opção de complemento..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="w-full rounded-xl border border-koma-border bg-koma-input py-2 pl-8 pr-3 text-xs text-koma-foreground focus:border-emerald-500/60 focus:outline-none"
              />
            </div>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="w-full cursor-pointer truncate rounded-xl border border-koma-border bg-koma-input px-3 py-2 text-xs font-medium text-koma-foreground focus:border-emerald-500/60 focus:outline-none"
            >
              <option value="">Todos os produtos vendidos</option>
              {report?.produtos.map((p) => (
                <option key={p.produto_id} value={p.produto_id}>
                  {p.produto_nome} ({p.unidades} un.)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Filtro de Grupos com Badges */}
        {report && report.grupos.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-koma-border/60 pt-2.5">
            <span className="mr-1 text-[9px] font-bold uppercase tracking-wider text-koma-muted">Grupos:</span>
            <button
              type="button"
              onClick={() => setSelectedGroupId('todos')}
              className={clsx(
                'rounded-lg px-2.5 py-1 text-[10px] font-bold transition-colors cursor-pointer',
                selectedGroupId === 'todos'
                  ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'bg-koma-raised text-koma-muted hover:text-koma-foreground',
              )}
            >
              Todos ({report.grupos.length})
            </button>
            {report.grupos.map((g) => (
              <button
                key={g.grupo_id}
                type="button"
                onClick={() => setSelectedGroupId(g.grupo_id)}
                className={clsx(
                  'rounded-lg px-2.5 py-1 text-[10px] font-bold transition-colors cursor-pointer',
                  selectedGroupId === g.grupo_id
                    ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-koma-raised text-koma-muted hover:text-koma-foreground',
                )}
              >
                {g.grupo_nome}
                <span className="ml-1 opacity-70 text-[9px]">({g.total_selecoes})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Conteúdo Principal / Rankings por Grupo */}
      {isLoading ? (
        <div className="rounded-3xl border border-koma-border bg-koma-panel p-12 text-center text-xs text-koma-muted animate-pulse">
          <RefreshCw size={24} className="mx-auto mb-2 animate-spin text-emerald-600" />
          Carregando consumo de complementos...
        </div>
      ) : report && report.total_selecoes === 0 && (!report.grupos.length || report.grupos.every((g) => g.opcoes.length === 0)) ? (
        <div className="rounded-3xl border border-koma-border bg-koma-panel p-12 text-center text-xs font-medium text-koma-muted">
          Nenhuma escolha de complemento encontrada para os filtros selecionados no período.
        </div>
      ) : (
        <div className="space-y-6">
          {filteredGroups.map((group) => {
            const arrangedOptions = arrangeOptions(group.opcoes, ordenacao, busca);
            const maxQuantityInGroup = Math.max(...group.opcoes.map((o) => o.quantidade), 1);

            return (
              <div
                key={group.grupo_id}
                className="overflow-hidden rounded-3xl border border-koma-border bg-koma-panel shadow-xs"
              >
                {/* Cabeçalho do Grupo */}
                <div className="flex flex-col gap-2 border-b border-koma-border bg-koma-raised/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <Layers size={16} className="text-emerald-700 dark:text-emerald-400" />
                    <div>
                      <h3 className="font-serif text-sm font-bold text-koma-foreground">
                        {group.grupo_nome}
                      </h3>
                      {group.grupo_origem_id && (
                        <span className="text-[9px] text-koma-muted block">
                          Adicionais derivados de outro grupo
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] font-mono">
                    <span className="text-koma-muted">
                      Total no grupo:{' '}
                      <strong className="text-koma-foreground font-bold">{group.total_selecoes} un.</strong>
                    </span>
                    {group.media_selecoes_por_unidade != null && (
                      <>
                        <span className="text-koma-muted">|</span>
                        <span className="text-emerald-700 dark:text-emerald-300" title="Média de seleções deste grupo por unidade vendida do produto selecionado">
                          Média: <strong>{group.media_selecoes_por_unidade.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} un./item</strong>
                        </span>
                      </>
                    )}
                    <span className="text-koma-muted">|</span>
                    <span className="text-koma-muted">
                      Com saída: <strong className="text-koma-foreground">{group.opcoes_com_saida}</strong>
                    </span>
                    {group.opcoes_sem_saida > 0 && (
                      <>
                        <span className="text-koma-muted">|</span>
                        <span className="text-rose-600 dark:text-rose-400">
                          Sem saída: <strong>{group.opcoes_sem_saida}</strong>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Lista / Ranking do Grupo */}
                {arrangedOptions.length === 0 ? (
                  <div className="p-8 text-center text-xs text-koma-muted italic">
                    Nenhuma opção encontrada para este grupo com os filtros aplicados.
                  </div>
                ) : (
                  <div className="divide-y divide-koma-border/60">
                    {arrangedOptions.map((opt, idx) => {
                      const pctWidth = group.total_selecoes > 0 ? (opt.quantidade / maxQuantityInGroup) * 100 : 0;
                      const isTop1 = idx === 0 && opt.quantidade > 0 && ordenacao === 'mais';
                      const isLowOrZero = opt.quantidade === 0;

                      return (
                        <div
                          key={opt.opcao_id}
                          className="group relative p-3.5 transition-colors hover:bg-koma-raised/40 sm:p-4"
                        >
                          {/* Barra Horizontal Visual de Fundo */}
                          <div
                            className={clsx(
                              'absolute inset-y-0 left-0 transition-all pointer-events-none opacity-10 dark:opacity-15',
                              isTop1 ? 'bg-emerald-500' : 'bg-emerald-600/70',
                            )}
                            style={{ width: `${pctWidth}%` }}
                          />

                          <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            {/* Nome e Indicador de Status */}
                            <div className="flex min-w-0 items-center gap-3">
                              <span
                                className={clsx(
                                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-mono font-bold',
                                  isTop1
                                    ? 'bg-emerald-600 text-white shadow-xs'
                                    : 'bg-koma-input text-koma-muted',
                                )}
                              >
                                {idx + 1}
                              </span>

                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-xs font-bold text-koma-foreground">
                                    {opt.opcao_nome}
                                  </span>
                                  {opt.ativa === false && !opt.arquivada && (
                                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                                      Pausada
                                    </span>
                                  )}
                                  {opt.arquivada && (
                                    <span className="rounded bg-koma-input px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-koma-muted">
                                      Removida
                                    </span>
                                  )}
                                  {!opt.cadastrada && (
                                    <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">
                                      Legada
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Quantidade e Participação Percentual */}
                            <div className="flex items-center justify-end gap-6 sm:gap-8">
                              <div className="text-right">
                                <span
                                  className={clsx(
                                    'font-mono text-sm font-extrabold',
                                    isLowOrZero
                                      ? 'text-koma-muted'
                                      : 'text-emerald-700 dark:text-emerald-300',
                                  )}
                                >
                                  {opt.quantidade}{' '}
                                  <span className="text-[10px] font-medium text-koma-muted">un.</span>
                                </span>
                              </div>

                              <div className="w-20 text-right">
                                <span
                                  className={clsx(
                                    'font-mono text-xs font-bold',
                                    opt.participacao_pct == null
                                      ? 'text-koma-muted'
                                      : opt.participacao_pct > 0
                                        ? 'text-koma-foreground'
                                        : 'text-koma-muted',
                                  )}
                                  title={
                                    opt.participacao_pct == null
                                      ? 'Grupo sem seleções no período'
                                      : 'Participação relativa às escolhas dentro deste grupo'
                                  }
                                >
                                  {formatShare(opt.participacao_pct)}
                                </span>
                                <span className="block text-[8px] text-koma-muted uppercase tracking-tighter">
                                  do grupo
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Calendário Compartilhado */}
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
