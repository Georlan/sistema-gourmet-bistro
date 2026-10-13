import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReportPeriodButton } from './ReportPeriodButton';
import { PeriodoCalendarioModal } from './PeriodoCalendarioModal';
import { ReportActionBar } from './ReportActionBar';
import { useSharedReportPeriod } from './useSharedReportPeriod';
import { fetchReportJson, useReportRealtimeRefresh } from './useReportRealtimeRefresh';
import { OperationalBanner } from '../shared/OperationalBanner';
import { MenuIntelligenceMatrix } from './MenuIntelligenceMatrix';
import { MenuIntelligenceSimulator } from './MenuIntelligenceSimulator';
import { MenuProductDetail } from './MenuProductDetail';
import { menuMoney, menuPercent, menuReportCsv, type MenuReport } from '../../domain/menuIntelligence';

type Tab = 'diagnostico' | 'matriz' | 'oportunidades' | 'simulador';
const tabs: { id: Tab; label: string }[] = [{ id: 'diagnostico', label: 'Diagnóstico' }, { id: 'matriz', label: 'Matriz de Cardápio' }, { id: 'oportunidades', label: 'Oportunidades' }, { id: 'simulador', label: 'Simulador' }];
const date = (value: string) => value.split('-').reverse().join('/');

export function RelatoriosCardapioTab({ apiBaseUrl, authHeaders, onNavigate }: {
  apiBaseUrl: string; authHeaders: Record<string, string>; onNavigate?: (tab: string) => void;
}) {
  const { dataInicio, dataFim, applyPeriod } = useSharedReportPeriod();
  const [loaded, setLoaded] = useState<{ identity: string; report: MenuReport } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const [tab, setTab] = useState<Tab>('diagnostico');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('todos');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('unidades');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [simulationId, setSimulationId] = useState('');
  const request = useRef<AbortController | null>(null);
  const identity = JSON.stringify([apiBaseUrl, dataInicio, dataFim, Object.entries(authHeaders).sort()]);
  const report = loaded?.identity === identity ? loaded.report : null;
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(false);
    try {
      const next = await fetchReportJson<MenuReport>(`${apiBaseUrl}/relatorios/inteligencia-cardapio?data_inicio=${dataInicio}&data_fim=${dataFim}`, authHeaders, controller.signal);
      if (!controller.signal.aborted) setLoaded({ identity, report: next });
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [apiBaseUrl, authHeaders, dataInicio, dataFim, identity]);
  useEffect(() => { void refresh(); return () => request.current?.abort(); }, [refresh]);
  useEffect(() => { setSelectedId(null); setSimulationId(''); setCategory(''); }, [identity]);
  useReportRealtimeRefresh(refresh);
  const products = report?.produtos || [];
  const rows = useMemo(() => {
    const filtered = products.filter(p => p.nome.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))
      && (!category || (p.categoria_id || p.categoria) === category)
      && (filter === 'todos' || (filter === 'sem_saida' ? p.ativo && p.unidades === 0 : p.sugestoes.some(s => s.tipo === filter))));
    return filtered.sort((a, b) => sort === 'contribuicao' ? (b.contribuicao_estimada ?? -Infinity) - (a.contribuicao_estimada ?? -Infinity) || b.unidades - a.unidades
      : sort === 'cmv' ? (b.cmv_pct_estimado ?? -Infinity) - (a.cmv_pct_estimado ?? -Infinity) || b.unidades - a.unidades : b.unidades - a.unidades);
  }, [products, search, category, filter, sort]);
  const categoryOptions = Array.from(new Map(products.map(p => [p.categoria_id || p.categoria, p.categoria])).entries()).sort((a,b) => a[1].localeCompare(b[1]));
  const summary = report?.resumo;
  const selected = products.find(p => p.produto_id === selectedId);
  const exportReport = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([menuReportCsv(report, dataInicio, dataFim)], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = `inteligencia_cardapio_${dataInicio}_${dataFim}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const simulate = (id: string) => { setSelectedId(null); setSimulationId(id); setTab('simulador'); };
  return <div className="space-y-5 text-left">
    <OperationalBanner id="reports-menu-heading" eyebrow="INTELIGÊNCIA DO CARDÁPIO" title="Inteligência" accent="do Cardápio" description="Demanda, custos e contribuição para orientar decisões." metrics={[
      { label: 'unidades pedidas', value: report?.unidades ?? '—' },
      { label: 'valor dos itens', value: menuMoney(summary?.valor_itens) },
      { label: 'contribuição estimada', value: menuMoney(summary?.contribuicao_estimada) },
      { label: 'unidades com custo coberto', value: menuPercent(summary?.cobertura_custo_pct) },
    ]} />
    <ReportActionBar info={<><strong className="text-koma-foreground">Pedidos pela entrada, incluindo abertos; cancelamentos excluídos.</strong><span className="block">Consumo não é faturamento recebido. {report && `Comparado com ${date(report.inicio_anterior)} a ${date(report.fim_anterior)} — mesma duração.`}</span></>}>
      <ReportPeriodButton inicio={dataInicio} fim={dataFim} onClick={() => setCalendar(true)} />
      <button onClick={exportReport} disabled={!report || error} className="rounded-xl border border-koma-border px-3 py-2 text-xs font-semibold text-koma-foreground disabled:opacity-50">Exportar análise</button>
      {onNavigate && <button onClick={() => onNavigate('financeiro')} className="rounded-xl border border-koma-border px-3 py-2 text-xs font-semibold text-koma-foreground">Ver recebimentos</button>}
    </ReportActionBar>
    <div className="overflow-x-auto"><div role="tablist" aria-label="Inteligência do Cardápio" className="flex w-max min-w-full gap-1 rounded-xl border border-koma-border bg-koma-panel p-1">{tabs.map(t => <button key={t.id} id={`menu-tab-${t.id}`} type="button" role="tab" aria-selected={tab === t.id} aria-controls="menu-intelligence-panel" onClick={() => setTab(t.id)} className={`whitespace-nowrap rounded-lg px-4 py-3 text-xs font-semibold ${tab === t.id ? 'bg-emerald-600 text-white' : 'text-koma-muted hover:bg-koma-raised'}`}>{t.label}</button>)}</div></div>
    <p className="rounded-xl border border-koma-border bg-koma-panel p-4 text-xs text-koma-muted">Custos e contribuição usam os ingredientes atuais cadastrados das unidades sem modificadores. Adicionais sem ficha, descontos da conta, taxas, impostos e despesas não informados ficam fora. <strong className="text-koma-foreground">Contribuição não é lucro.</strong> A comparação anterior também usa o custo atual; não representa lucro histórico. Confira disponibilidade e tamanho da amostra antes de agir.</p>
    {loading && <p role="status" className="text-xs text-koma-muted">{report ? 'Atualizando análise…' : 'Carregando desempenho do cardápio…'}</p>}
    {error && <div role="alert" className="rounded-xl border border-rose-500/40 p-4 text-sm text-koma-foreground">Não foi possível carregar a análise. <button onClick={() => void refresh()} className="underline">Tentar novamente</button>{report && <p className="mt-2 text-xs text-koma-muted">Os dados abaixo são da última leitura bem-sucedida.</p>}</div>}
    {report && <section id="menu-intelligence-panel" role="tabpanel" aria-labelledby={`menu-tab-${tab}`} className="space-y-5">
      {tab === 'diagnostico' && <>
        {summary && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
          ['Valor dos itens: atual / anterior', `${menuMoney(summary.valor_itens)} / ${menuMoney(summary.valor_itens_anterior)}`],
          ['Custo estimado da parcela coberta', menuMoney(summary.custo_total_estimado)],
          ['Contribuição estimada: atual / anterior', `${menuMoney(summary.contribuicao_estimada)} / ${menuMoney(summary.contribuicao_anterior_estimada)}`],
          ['Cobertura: atual / anterior', `${summary.unidades_cobertas} de ${report.unidades} / ${summary.unidades_anteriores_cobertas} de ${summary.unidades_anteriores} un.`],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-koma-border bg-koma-panel p-4"><p className="text-xs text-koma-muted">{label}</p><strong className="mt-2 block text-sm text-koma-foreground">{value}</strong></div>)}</div>}
        {report.unidades === 0 && <p className="rounded-xl border border-koma-border p-4 text-sm text-koma-muted">Nenhum pedido elegível neste período. Amplie o intervalo e confira disponibilidade; ausência de demanda não prova que o cardápio está saudável.</p>}
        <div className="flex flex-wrap gap-3">
          <input aria-label="Buscar produto no desempenho" placeholder="Buscar produto…" value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-koma-border bg-koma-input p-3 text-sm text-koma-foreground" />
          <select aria-label="Filtrar atenção do cardápio" value={filter} onChange={e => setFilter(e.target.value)} className="max-w-full rounded-xl border border-koma-border bg-koma-input p-3 text-xs text-koma-foreground"><option value="todos">Todos os produtos</option><option value="sem_saida">Ativos sem saída</option><option value="rever_preco">Revisar preço ou custos</option><option value="queda">Queda de saída</option><option value="sem_custo">Custos incompletos</option></select>
          <select aria-label="Categoria no desempenho" value={category} onChange={e => setCategory(e.target.value)} className="max-w-full rounded-xl border border-koma-border bg-koma-input p-3 text-xs text-koma-foreground"><option value="">Todas as categorias</option>{categoryOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          <select aria-label="Ordenar diagnóstico" value={sort} onChange={e => setSort(e.target.value)} className="max-w-full rounded-xl border border-koma-border bg-koma-input p-3 text-xs text-koma-foreground"><option value="unidades">Maior demanda</option><option value="contribuicao">Maior contribuição estimada</option><option value="cmv">Maior CMV estimado</option></select>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-koma-border bg-koma-panel"><table className="w-full text-left text-xs">
          <caption className="p-4 text-left text-koma-muted">{rows.length} produtos nesta seleção. Totais no cabeçalho representam todo o período.</caption>
          <thead className="hidden bg-koma-raised text-koma-muted md:table-header-group"><tr>{['Produto', 'Demanda', 'Preço / custo da base', 'Contribuição estimada', 'Próximo passo'].map(h => <th key={h} className="p-4">{h}</th>)}</tr></thead>
          <tbody className="block divide-y divide-koma-border md:table-row-group">{rows.map(p => <tr key={p.produto_id} className="block p-3 md:table-row md:p-0">
            <td className="block p-2 md:table-cell md:p-4"><button onClick={() => setSelectedId(p.produto_id)} className="font-semibold text-koma-foreground underline decoration-koma-border underline-offset-4">{p.nome}</button><span className="mt-1 block text-koma-muted">{p.categoria} · {p.ativo ? 'Ativo hoje' : 'Pausado hoje'}</span></td>
            <td className="block p-2 text-koma-foreground md:table-cell md:p-4"><strong>{p.unidades} un.</strong><span className="block text-koma-muted">Antes: {p.unidades_anteriores} un. · {p.variacao_pct == null ? 'Sem base anterior' : `${p.variacao_pct > 0 ? '+' : ''}${p.variacao_pct.toLocaleString('pt-BR')}%`}</span></td>
            <td className="block p-2 text-koma-foreground md:table-cell md:p-4"><span className="block">Médio: {p.preco_medio == null ? 'Sem saída' : menuMoney(p.preco_medio)}</span><span className="block">Cardápio: {menuMoney(p.preco_cardapio)}</span><span className="block text-koma-muted">Custo da base: {menuMoney(p.custo_unitario)}</span></td>
            <td className="block p-2 text-koma-foreground md:table-cell md:p-4"><strong>{menuMoney(p.contribuicao_estimada)}</strong><span className="block text-koma-muted">{p.unidades_cobertas ?? '—'} de {p.unidades} un. cobertas · CMV {menuPercent(p.cmv_pct_estimado)}</span><span className="block text-koma-muted">Margem/un.: {menuMoney(p.margem_unitaria_observada)}</span></td>
            <td className="block p-2 text-koma-foreground md:table-cell md:p-4">{p.sugestoes.map(s => <div key={s.tipo} className="mb-2"><strong>{s.titulo}</strong><p className="text-koma-muted">{s.motivo}</p></div>)}<button onClick={() => simulate(p.produto_id)} className="rounded-lg border border-koma-border px-3 py-2 font-semibold">Simular {p.nome}</button></td>
          </tr>)}</tbody>
        </table>{!rows.length && <p className="p-6 text-center text-sm text-koma-muted">Nenhum produto nesta seleção.</p>}</div>
        {!!report.categorias?.length && <section className="rounded-2xl border border-koma-border bg-koma-panel p-4"><h2 className="mb-4 text-sm font-semibold text-koma-foreground">Participação das categorias na demanda</h2><div className="space-y-4">{report.categorias.map(c => <div key={c.categoria_id}><div className="flex justify-between gap-3 text-xs text-koma-foreground"><strong>{c.nome}</strong><span>{c.unidades} un. · contribuição {menuMoney(c.contribuicao_estimada)}</span></div><div className="my-2 h-2 rounded bg-koma-raised"><div className="h-2 rounded bg-emerald-600" style={{ width: `${report.unidades ? c.unidades / report.unidades * 100 : 0}%` }} /></div><p className="text-xs text-koma-muted">Cobertura dos custos: {menuPercent(c.cobertura_custo_pct)}</p></div>)}</div></section>}
      </>}
      {tab === 'matriz' && <MenuIntelligenceMatrix report={report} onInspect={setSelectedId} />}
      {tab === 'oportunidades' && <div className="space-y-4"><h2 className="text-base font-semibold text-koma-foreground">Ações para investigar, com evidências</h2><p className="text-xs text-koma-muted">Regras de demanda e custos, sem promessa de retorno. Compras conjuntas e taxa de inclusão de bebidas ainda não foram medidas nesta versão.</p>{report.oportunidades?.length ? report.oportunidades.map(o => <article key={`${o.produto_id}:${o.tipo}`} className="space-y-3 rounded-2xl border border-koma-border bg-koma-panel p-4"><h3 className="text-sm font-semibold text-koma-foreground">{o.titulo} · {o.produto_nome}</h3><p className="text-sm text-koma-muted">{o.motivo}</p><p className="text-xs text-koma-muted">Evidência: {o.unidades} unidades agora / {o.unidades_anteriores} antes · contribuição {menuMoney(o.contribuicao_estimada)} · cobertura {menuPercent(o.cobertura_custo_pct)}.</p><p className="text-xs text-koma-muted">Para testar: registre a ação e compare demanda e contribuição em períodos equivalentes, conferindo oferta e custos. Antes/depois não prova causalidade.</p><div className="flex flex-wrap gap-2"><button onClick={() => setSelectedId(o.produto_id)} className="rounded-lg border border-koma-border px-3 py-2 text-xs font-semibold text-koma-foreground">Ver evidências</button><button onClick={() => simulate(o.produto_id)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">Simular estratégia</button></div></article>) : <p className="rounded-xl border border-koma-border p-5 text-sm text-koma-muted">Nenhuma oportunidade identificada pelas regras disponíveis. Confira custos e amplie o período; isso não garante ausência de melhorias.</p>}</div>}
      {tab === 'simulador' && <MenuIntelligenceSimulator key={`${identity}:${simulationId}`} report={report} apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} initialProductId={simulationId} />}
    </section>}
    {selected && <MenuProductDetail key={selected.produto_id} product={selected} category={report?.categorias?.find(c => c.categoria_id === selected.categoria_id)} onClose={() => setSelectedId(null)} onSimulate={() => simulate(selected.produto_id)} />}
    {calendar && <PeriodoCalendarioModal onClose={() => setCalendar(false)} dataInicio={dataInicio} dataFim={dataFim} onApply={(inicio, fim) => { applyPeriod(inicio, fim); setCalendar(false); }} />}
  </div>;
}
