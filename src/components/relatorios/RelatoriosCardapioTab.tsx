import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReportPeriodButton } from './ReportPeriodButton';
import { PeriodoCalendarioModal } from './PeriodoCalendarioModal';
import { useSharedReportPeriod } from './useSharedReportPeriod';
import { fetchReportJson, useReportRealtimeRefresh } from './useReportRealtimeRefresh';
import { OperationalBanner } from '../shared/OperationalBanner';

type Product = {
  produto_id: string; nome: string; categoria: string; ativo: boolean; unidades: number;
  unidades_anteriores: number; variacao_pct: number | null; participacao_pct: number;
  preco_medio: number | null; preco_cardapio: number; custo_unitario: number | null;
  margem_unitaria_cardapio: number | null; margem_pct_cardapio: number | null;
  sugestoes: { tipo: string; titulo: string; motivo: string }[];
};
type Report = { inicio_anterior: string; fim_anterior: string; unidades: number; produtos: Product[] };
const money = (value: number | null) => value == null ? 'Não calculado' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value: string) => value.split('-').reverse().join('/');

export function RelatoriosCardapioTab({ apiBaseUrl, authHeaders }: { apiBaseUrl: string; authHeaders: Record<string, string> }) {
  const { dataInicio, dataFim, applyPeriod } = useSharedReportPeriod();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('todos');
  const [category, setCategory] = useState('');
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(false); setReport(null);
    try {
      const next = await fetchReportJson<Report>(`${apiBaseUrl}/relatorios/inteligencia-cardapio?data_inicio=${dataInicio}&data_fim=${dataFim}`, authHeaders, controller.signal);
      if (!controller.signal.aborted) setReport(next);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [apiBaseUrl, authHeaders, dataInicio, dataFim]);
  useEffect(() => { void refresh(); return () => request.current?.abort(); }, [refresh]);
  useReportRealtimeRefresh(refresh);
  const products = report?.produtos;
  const rows = useMemo(() => (products || []).filter(p =>
    p.nome.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')) && (!category || p.categoria === category)
    && (filter === 'todos' || (filter === 'sem_saida' ? p.ativo && p.unidades === 0 : p.sugestoes.some(s => s.tipo === filter)))
  ), [products, search, category, filter]);
  const active = (products || []).filter(p => p.ativo);
  return <div className="space-y-5 text-left">
    <OperationalBanner id="reports-menu-heading" eyebrow="GESTÃO DO CARDÁPIO" title="O que sai" accent="e o que merece atenção" description="Uma leitura da demanda para decidir com mais segurança." metrics={[
      { label: 'unidades pedidas', value: report?.unidades ?? '—' },
      { label: 'ativos sem saída', value: report ? active.filter(p => p.unidades === 0).length : '—' },
      { label: 'preços para revisar', value: report ? (products || []).filter(p => p.sugestoes.some(s => s.tipo === 'rever_preco')).length : '—' },
      { label: 'produtos com custos', value: report ? `${(products || []).filter(p => p.custo_unitario != null).length}/${products?.length || 0}` : '—' },
    ]} />
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-koma-border bg-koma-panel p-4">
      <p className="max-w-3xl text-xs text-koma-muted">Saída pela entrada do pedido, incluindo abertos; cancelamentos excluídos. Consumo não é faturamento recebido.
        {report && <span className="mt-1 block">Comparado com {date(report.inicio_anterior)} a {date(report.fim_anterior)} — mesma duração.</span>}
      </p>
      <ReportPeriodButton inicio={dataInicio} fim={dataFim} onClick={() => setCalendar(true)} />
    </div>
    <div className="rounded-2xl border border-koma-border bg-koma-panel p-4 text-xs text-koma-muted">
      <strong className="text-koma-foreground">Antes de mudar o cardápio:</strong> confira disponibilidade, dias de funcionamento e tamanho da amostra. As sugestões orientam uma revisão; você decide a ação.
      <p className="mt-2">Margem estimada = preço atual do cardápio menos custo atual dos ingredientes. Não inclui adicionais, taxas, impostos, equipe ou despesas fixas; não representa lucro nem margem histórica.</p>
    </div>
    <div className="flex flex-wrap gap-3">
      <input aria-label="Buscar produto no desempenho" placeholder="Buscar produto…" value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-koma-border bg-koma-panel p-3 text-sm text-koma-foreground" />
      <select aria-label="Filtrar atenção do cardápio" value={filter} onChange={e => setFilter(e.target.value)} className="rounded-xl border border-koma-border bg-koma-panel p-3 text-sm text-koma-foreground">
        <option value="todos">Todos os produtos</option><option value="sem_saida">Ativos sem saída</option><option value="rever_preco">Revisar preço ou custos</option><option value="queda">Queda de saída</option><option value="sem_custo">Custos incompletos</option>
      </select>
      <select aria-label="Categoria no desempenho" value={category} onChange={e => setCategory(e.target.value)} className="rounded-xl border border-koma-border bg-koma-panel p-3 text-sm text-koma-foreground">
        <option value="">Todas as categorias</option>{Array.from(new Set((products || []).map(p => p.categoria))).sort().map(c => <option key={c}>{c}</option>)}
      </select>
    </div>
    {loading && <p role="status" className="p-6 text-koma-muted">Carregando desempenho do cardápio…</p>}
    {error && <div role="alert" className="rounded-2xl border border-rose-500/40 p-6 text-koma-foreground">Não foi possível carregar o desempenho. <button onClick={() => void refresh()} className="underline">Tentar novamente</button></div>}
    {report && <div className="overflow-x-auto rounded-2xl border border-koma-border bg-koma-panel">
      <table className="w-full text-left text-xs">
        <caption className="p-4 text-left text-koma-muted">{rows.length} produtos nesta visão · ordenados por unidades pedidas</caption>
        <thead className="hidden bg-koma-raised text-koma-muted md:table-header-group"><tr>{['Produto', 'Saída e comparação', 'Preço praticado / atual', 'Custo e margem atuais', 'Próximo passo'].map(h => <th key={h} className="p-4">{h}</th>)}</tr></thead>
        <tbody className="block divide-y divide-koma-border md:table-row-group">{rows.map(p => <tr key={p.produto_id} className="block p-3 md:table-row md:p-0">
          <td className="block p-2 text-koma-foreground md:table-cell md:p-4"><strong>{p.nome}</strong><span className="mt-1 block text-koma-muted">{p.categoria} · {p.ativo ? 'Ativo hoje' : 'Pausado hoje'}</span></td>
          <td className="block p-2 text-koma-foreground md:table-cell md:p-4"><span className="mr-2 font-bold md:hidden">Saída:</span><strong>{p.unidades} un.</strong><span className="block text-koma-muted">{p.participacao_pct.toLocaleString('pt-BR')}% da saída</span><span className="block text-koma-muted">Antes: {p.unidades_anteriores} un. · {p.variacao_pct == null ? 'Sem base anterior' : `${p.variacao_pct > 0 ? '+' : ''}${p.variacao_pct.toLocaleString('pt-BR')}%`}</span></td>
          <td className="block p-2 text-koma-foreground md:table-cell md:p-4"><span className="mb-1 block font-bold md:hidden">Preço praticado / atual</span><span className="block">Médio: {p.preco_medio == null ? 'Sem saída' : money(p.preco_medio)}</span><span className="block text-koma-muted">Cardápio: {money(p.preco_cardapio)}</span></td>
          <td className="block p-2 text-koma-foreground md:table-cell md:p-4"><span className="mb-1 block font-bold md:hidden">Custo e margem atuais</span><span className="block">Custo: {money(p.custo_unitario)}</span><span className="block text-koma-muted">Margem: {money(p.margem_unitaria_cardapio)}{p.margem_pct_cardapio == null ? '' : ` (${p.margem_pct_cardapio.toLocaleString('pt-BR')}%)`}</span></td>
          <td className="block p-2 text-koma-foreground md:table-cell md:min-w-64 md:p-4">{p.sugestoes.length ? p.sugestoes.map(s => <div key={s.tipo} className="mb-2"><strong>{s.titulo}</strong><p className="mt-1 text-koma-muted">{s.motivo}</p></div>) : <span className="text-koma-muted">Acompanhar saída e custos ao longo do tempo.</span>}</td>
        </tr>)}</tbody>
      </table>{!rows.length && <p className="p-6 text-center text-koma-muted">Nenhum produto nesta seleção.</p>}
    </div>}
    {calendar && <PeriodoCalendarioModal onClose={() => setCalendar(false)} dataInicio={dataInicio} dataFim={dataFim} onApply={(inicio, fim) => { applyPeriod(inicio, fim); setCalendar(false); }} />}
  </div>;
}
