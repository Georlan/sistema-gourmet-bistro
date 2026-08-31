import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { BarChart2, Calendar as CalendarIcon, Download, Info, Search } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PeriodoCalendarioModal } from './PeriodoCalendarioModal';
import { OperationalBanner } from '../shared/OperationalBanner';
import { fetchReportJson, useReportRealtimeRefresh } from './useReportRealtimeRefresh';
import { ReportActionBar } from './ReportActionBar';
import { useSharedReportPeriod } from './useSharedReportPeriod';

interface RelatoriosProdutosTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  categorias: { id: string | number; nome: string }[];
  showToast: (msg: string) => void;
}

export interface ProdutoRelatorioItem {
  ranking: number;
  produto_id: string | number;
  produto_nome: string;
  categoria_nome: string;
  quantidade_consumida: number;
  valor_consumido: number;
  preco_medio_item: number;
  natureza_valor: 'consumo_operacional_nao_receita' | string;
  ficha_tecnica_configurada: boolean;
  custo_unitario_estimado: number | null;
  cmv_estimado: number | null;
  margem_contribuicao_estimada: number | null;
  margem_percentual_estimada: number | null;
}

const CustomChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="z-50 space-y-1 rounded-2xl border border-koma-border bg-koma-panel p-3 text-left font-sans shadow-xl">
      <p className="text-[10px] font-bold text-koma-foreground">{label}</p>
      {payload.map((entry: any, index: number) => (
        <p key={index} className="text-xs font-bold font-mono" style={{ color: entry.color }}>
          {entry.name}: {entry.dataKey === 'valor' ? `R$ ${Number(entry.value).toFixed(2)}` : `${entry.value} un.`}
        </p>
      ))}
    </div>
  );
};

export const RelatoriosProdutosTab: React.FC<RelatoriosProdutosTabProps> = ({
  apiBaseUrl,
  authHeaders,
  categorias,
  showToast,
}) => {
  const { dataInicio, dataFim, applyPeriod } = useSharedReportPeriod();
  const [ordenacao, setOrdenacao] = useState<'mais_vendidos' | 'menos_vendidos' | 'todos'>('mais_vendidos');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [chartMetric, setChartMetric] = useState<'quantidade' | 'valor'>('quantidade');
  const [isLoading, setIsLoading] = useState(false);
  const [produtos, setProdutos] = useState<ProdutoRelatorioItem[]>([]);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [hasError, setHasError] = useState(false);
  const requestRef = useRef(0);

  const fetchProdutosReport = useCallback(async () => {
    const requestId = ++requestRef.current;
    setIsLoading(true);
    setHasError(false);
    try {
      let url = `${apiBaseUrl}/relatorios/produtos?data_inicio=${dataInicio}&data_fim=${dataFim}&ordenacao=${ordenacao}`;
      if (buscaAplicada) url += `&busca=${encodeURIComponent(buscaAplicada)}`;
      if (categoriaId) url += `&categoria_id=${categoriaId}`;

      const json = await fetchReportJson<any[]>(url, authHeaders);
      const normalized: ProdutoRelatorioItem[] = (Array.isArray(json) ? json : []).map((row: any) => ({
        ranking: Number(row.ranking || 0),
        produto_id: row.produto_id,
        produto_nome: row.produto_nome,
        categoria_nome: row.categoria_nome,
        quantidade_consumida: Number(row.quantidade_consumida ?? row.quantidade_vendida ?? 0),
        valor_consumido: Number(row.valor_consumido ?? 0),
        preco_medio_item: Number(row.preco_medio_item ?? row.ticket_medio_item ?? 0),
        natureza_valor: row.natureza_valor || 'consumo_operacional_nao_receita',
        ficha_tecnica_configurada: Boolean(row.ficha_tecnica_configurada),
        custo_unitario_estimado: row.custo_unitario_estimado == null ? null : Number(row.custo_unitario_estimado),
        cmv_estimado: row.cmv_estimado == null ? null : Number(row.cmv_estimado),
        margem_contribuicao_estimada: row.margem_contribuicao_estimada == null ? null : Number(row.margem_contribuicao_estimada),
        margem_percentual_estimada: row.margem_percentual_estimada == null ? null : Number(row.margem_percentual_estimada),
      }));
      if (requestRef.current === requestId) setProdutos(normalized);
    } catch (error) {
      console.error('Erro ao carregar relatório de produtos:', error);
      if (requestRef.current === requestId) setHasError(true);
    } finally {
      if (requestRef.current === requestId) setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders, buscaAplicada, categoriaId, dataFim, dataInicio, ordenacao]);

  useEffect(() => {
    void fetchProdutosReport();
    return () => { requestRef.current += 1; };
  }, [fetchProdutosReport]);

  useReportRealtimeRefresh(fetchProdutosReport);

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = busca.trim();
    if (normalized === buscaAplicada) void fetchProdutosReport();
    else setBuscaAplicada(normalized);
  };

  const handleExportCsv = () => {
    if (!produtos.length) return;
    let csv = 'Ranking;Produto;Categoria;Quantidade Consumida;Valor de Consumo (R$);Preço Médio Item (R$);CMV Estimado (R$);Margem Estimada (R$);Margem Estimada (%)\n';
    produtos.forEach((p) => {
      csv += `${p.ranking};"${p.produto_nome}";"${p.categoria_nome}";${p.quantidade_consumida};${p.valor_consumido.toFixed(2)};${p.preco_medio_item.toFixed(2)};${p.cmv_estimado?.toFixed(2) ?? ''};${p.margem_contribuicao_estimada?.toFixed(2) ?? ''};${p.margem_percentual_estimada?.toFixed(1) ?? ''}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `consumo_produtos_${dataInicio}_a_${dataFim}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Relatório operacional exportado.');
  };

  const chartData = [...produtos]
    .filter((p) => p.quantidade_consumida > 0)
    .sort((a, b) => chartMetric === 'quantidade'
      ? b.quantidade_consumida - a.quantidade_consumida
      : b.valor_consumido - a.valor_consumido)
    .slice(0, 7)
    .map((p) => ({
    name: p.produto_nome.length > 28 ? `${p.produto_nome.slice(0, 26)}…` : p.produto_nome,
    quantidade: p.quantidade_consumida,
    valor: p.valor_consumido,
  }));
  const totalUnidades = useMemo(() => produtos.reduce((sum, item) => sum + item.quantidade_consumida, 0), [produtos]);
  const totalConsumo = useMemo(() => produtos.reduce((sum, item) => sum + item.valor_consumido, 0), [produtos]);
  const produtosComConsumo = useMemo(() => produtos.filter((item) => item.quantidade_consumida > 0).length, [produtos]);
  const produtosComCusto = useMemo(() => produtos.filter((item) => item.quantidade_consumida > 0 && item.ficha_tecnica_configurada).length, [produtos]);
  const chartTitle = chartMetric === 'quantidade' ? 'Produtos mais consumidos' : 'Maior valor de consumo';

  return (
    <div className={"space-y-5 text-left animate-fade-in"}>
      <OperationalBanner
        id="reports-products-heading"
        eyebrow="PRODUTOS"
        title="O que mais"
        accent="movimenta o cardápio"
        description="Consumo real das contas recebidas, separado do faturamento financeiro."
        metrics={[
          { label: produtosComConsumo === 1 ? 'produto vendido' : 'produtos vendidos', value: produtosComConsumo },
          { label: 'unidades consumidas', value: totalUnidades },
          { label: 'valor de consumo', value: totalConsumo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) },
          { label: 'custos mapeados', value: `${produtosComCusto}/${produtosComConsumo}` },
        ]}
      />

      <ReportActionBar info={(
        <div className="flex min-w-0 items-start gap-2 text-[10px] leading-relaxed text-koma-muted">
          <Info size={14} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
          <span><strong className="text-koma-foreground">Consumo não é faturamento.</strong> CMV e margem aparecem somente quando a ficha técnica tem todos os custos cadastrados.</span>
        </div>
      )}>
          <button type="button" onClick={() => setShowCalendarModal(true)} className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-koma-foreground transition-all hover:bg-koma-card">
            <CalendarIcon size={14} className="text-emerald-700 dark:text-emerald-400" /> Período
          </button>
          <button type="button" onClick={handleExportCsv} disabled={!produtos.length} className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3.5 py-2 text-[10px] font-bold text-koma-muted transition-all hover:bg-koma-card hover:text-koma-foreground disabled:opacity-50">
            <Download size={14} /> Exportar
          </button>
      </ReportActionBar>

      {hasError && !isLoading && (
        <div className="mx-auto my-6 max-w-md space-y-3 rounded-3xl border border-rose-900/50 bg-koma-panel p-8 text-center">
          <h3 className="text-sm font-bold text-koma-foreground">Não foi possível carregar o consumo de produtos</h3>
          <button onClick={fetchProdutosReport} className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">Tentar novamente</button>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="space-y-4 rounded-3xl border border-koma-border bg-koma-panel p-4 sm:p-5 shadow-xs">
              <div className="flex flex-col gap-3 border-b border-koma-border pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                <BarChart2 size={16} className="text-emerald-700 dark:text-emerald-400" />
                <span className="font-serif text-sm font-bold text-koma-foreground">{chartTitle}</span>
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-koma-border bg-koma-input p-1">
                  <button type="button" onClick={() => setChartMetric('quantidade')} className={clsx('rounded-lg px-3 py-1.5 text-[9px] font-bold uppercase transition-colors', chartMetric === 'quantidade' ? 'koma-btn-success' : 'text-koma-muted hover:text-koma-foreground')}>Unidades</button>
                  <button type="button" onClick={() => setChartMetric('valor')} className={clsx('rounded-lg px-3 py-1.5 text-[9px] font-bold uppercase transition-colors', chartMetric === 'valor' ? 'koma-btn-success' : 'text-koma-muted hover:text-koma-foreground')}>Valor</button>
                </div>
              </div>
              <div className="h-72 w-full sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={chartData} margin={{ top: 4, right: 18, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--koma-border-default)" horizontal={false} opacity={0.6} />
                    <XAxis type="number" stroke="var(--koma-text-muted)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={chartMetric === 'valor' ? (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : undefined} />
                    <YAxis type="category" dataKey="name" stroke="var(--koma-text-muted)" fontSize={9} width={150} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'var(--koma-border-default)', opacity: 0.3 }} />
                    <Bar dataKey={chartMetric} name={chartMetric === 'valor' ? 'Valor de consumo' : 'Unidades consumidas'} fill="#059669" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
        </div>
      )}

      <div className="flex flex-col items-stretch justify-between gap-3 rounded-2xl border border-koma-border bg-koma-panel p-3 shadow-xs lg:flex-row lg:items-center">
        <div className="flex w-full items-center gap-1.5 lg:w-auto">
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-koma-muted">Ordenar:</span>
          <div className="grid flex-1 grid-cols-3 gap-1 rounded-xl border border-koma-border bg-koma-input p-1 sm:flex-none">
            {[
              ['mais_vendidos', 'Mais consumidos'],
              ['menos_vendidos', 'Menos consumidos'],
              ['todos', 'Todos'],
            ].map(([value, label]) => (
              <button key={value} type="button" onClick={() => setOrdenacao(value as typeof ordenacao)} className={`cursor-pointer rounded-lg px-2.5 py-1.5 text-[9px] font-extrabold uppercase transition-all ${ordenacao === value ? 'koma-btn-success' : 'text-koma-muted hover:text-koma-foreground'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid w-full max-w-lg flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
          <form onSubmit={handleSearchSubmit} className="relative w-full">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
            <input type="text" placeholder="Buscar produto..." value={busca} onChange={(e) => setBusca(e.target.value)} className="w-full rounded-xl border border-koma-border bg-koma-input py-2 pl-8 pr-3 text-xs text-koma-foreground focus:border-emerald-500/60 focus:outline-none" />
          </form>
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className="w-full cursor-pointer truncate rounded-xl border border-koma-border bg-koma-input px-3 py-2 text-xs font-medium text-koma-foreground focus:border-emerald-500/60 focus:outline-none">
            <option value="">Todas as categorias</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-koma-border bg-koma-panel shadow-xs">
        {isLoading ? (
          <div className="p-12 text-center text-xs text-koma-muted animate-pulse">Carregando consumo de produtos...</div>
        ) : produtos.length === 0 ? (
          <div className="p-12 text-center text-xs font-medium text-koma-muted">Nenhum produto encontrado para os filtros selecionados.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[10px]">
              <thead className="border-b border-koma-border bg-koma-raised text-[9px] font-extrabold uppercase tracking-wider text-koma-subtle">
                <tr><th className="p-3 text-center">Posição</th><th className="p-3">Produto</th><th className="p-3">Categoria</th><th className="p-3 text-center">Qtd.</th><th className="p-3 text-right">Valor de consumo</th><th className="p-3 text-right">Preço médio</th><th className="p-3 text-right">CMV estimado</th><th className="p-3 text-right">Margem estimada</th></tr>
              </thead>
              <tbody className="divide-y divide-koma-border">
                {produtos.map((p) => (
                  <tr key={p.produto_id} className="transition-colors hover:bg-koma-raised/50">
                    <td className="p-3 text-center font-mono font-extrabold text-koma-muted">#{p.ranking}</td>
                    <td className="p-3 font-bold text-koma-foreground">{p.produto_nome}</td>
                    <td className="p-3 font-medium text-koma-muted">{p.categoria_nome}</td>
                    <td className="p-3 text-center font-mono text-xs font-bold text-koma-foreground">{p.quantidade_consumida}</td>
                    <td className="p-3 text-right font-mono font-extrabold text-emerald-700 dark:text-emerald-300">{p.valor_consumido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td className="p-3 text-right font-mono font-medium text-koma-foreground">{p.preco_medio_item.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td className="p-3 text-right font-mono font-medium text-koma-foreground" title={p.cmv_estimado == null ? 'Cadastre todos os custos da ficha técnica para calcular' : 'Custo dos ingredientes pelo custo médio atual'}>
                      {p.cmv_estimado == null ? <span className="text-koma-muted">—</span> : p.cmv_estimado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </td>
                    <td className={clsx('p-3 text-right font-mono font-extrabold', p.margem_percentual_estimada != null && p.margem_percentual_estimada < 20 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300')} title={p.margem_contribuicao_estimada == null ? 'Cadastre todos os custos da ficha técnica para calcular' : 'Valor de consumo menos CMV estimado'}>
                      {p.margem_contribuicao_estimada == null ? <span className="text-koma-muted">—</span> : <>{p.margem_contribuicao_estimada.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} <span className="block text-[8px]">{p.margem_percentual_estimada?.toLocaleString('pt-BR')}%</span></>}
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
          onApply={applyPeriod}
        />
      )}
    </div>
  );
};
