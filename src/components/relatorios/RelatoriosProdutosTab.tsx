import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { BarChart2, Calendar as CalendarIcon, Download, Info, Package, Search } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PeriodoCalendarioModal } from './PeriodoCalendarioModal';
import { localCalendarDate } from '../../utils/dateTime';

interface RelatoriosProdutosTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
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
  showToast,
}) => {
  const getDefaultDates = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);
    return { inicio: localCalendarDate(start), fim: localCalendarDate(end) };
  };

  const defaults = getDefaultDates();
  const [dataInicio, setDataInicio] = useState(defaults.inicio);
  const [dataFim, setDataFim] = useState(defaults.fim);
  const [ordenacao, setOrdenacao] = useState<'mais_vendidos' | 'menos_vendidos' | 'todos'>('mais_vendidos');
  const [busca, setBusca] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [produtos, setProdutos] = useState<ProdutoRelatorioItem[]>([]);
  const [categorias, setCategorias] = useState<{ id: any; nome: string }[]>([]);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    fetch(`${apiBaseUrl}/produtos/categorias`, { headers: authHeaders })
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => Array.isArray(rows) && setCategorias(rows))
      .catch(() => {});
  }, [apiBaseUrl, authHeaders]);

  const fetchProdutosReport = async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      let url = `${apiBaseUrl}/relatorios/produtos?data_inicio=${dataInicio}&data_fim=${dataFim}&ordenacao=${ordenacao}`;
      if (busca.trim()) url += `&busca=${encodeURIComponent(busca.trim())}`;
      if (categoriaId) url += `&categoria_id=${categoriaId}`;

      const res = await fetch(url, { headers: authHeaders });
      if (!res.ok) throw new Error('Falha ao carregar produtos.');
      const json = await res.json();
      const normalized: ProdutoRelatorioItem[] = (Array.isArray(json) ? json : []).map((row: any) => ({
        ranking: Number(row.ranking || 0),
        produto_id: row.produto_id,
        produto_nome: row.produto_nome,
        categoria_nome: row.categoria_nome,
        quantidade_consumida: Number(row.quantidade_consumida ?? row.quantidade_vendida ?? 0),
        valor_consumido: Number(row.valor_consumido ?? 0),
        preco_medio_item: Number(row.preco_medio_item ?? row.ticket_medio_item ?? 0),
        natureza_valor: row.natureza_valor || 'consumo_operacional_nao_receita',
      }));
      setProdutos(normalized);
    } catch (error) {
      console.error('Erro ao carregar relatório de produtos:', error);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProdutosReport();
  }, [dataInicio, dataFim, ordenacao, categoriaId]);

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    fetchProdutosReport();
  };

  const handleExportCsv = () => {
    if (!produtos.length) return;
    let csv = 'Ranking;Produto;Categoria;Quantidade Consumida;Valor de Consumo (R$);Preço Médio Item (R$)\n';
    produtos.forEach((p) => {
      csv += `${p.ranking};"${p.produto_nome}";"${p.categoria_nome}";${p.quantidade_consumida};${p.valor_consumido.toFixed(2)};${p.preco_medio_item.toFixed(2)}\n`;
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

  const chartData = produtos.slice(0, 7).map((p) => ({
    name: p.produto_nome.length > 18 ? `${p.produto_nome.slice(0, 16)}...` : p.produto_nome,
    quantidade: p.quantidade_consumida,
    valor: p.valor_consumido,
  }));

  return (
    <div className={clsx('space-y-5', 'text-left', 'animate-fade-in')}>
      <div className="flex flex-col justify-between gap-4 rounded-3xl border border-koma-border bg-koma-panel p-4.5 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Package size={18} className="text-emerald-700 dark:text-emerald-400" />
            <h3 className="font-serif text-base font-bold text-koma-foreground">Desempenho Operacional de Produtos</h3>
          </div>
          <p className="text-[10px] text-koma-subtle">
            Período: <strong className="text-koma-secondary">{dataInicio}</strong> até <strong className="text-koma-secondary">{dataFim}</strong>
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => setShowCalendarModal(true)} className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-koma-foreground transition-all hover:bg-koma-card">
            <CalendarIcon size={14} className="text-emerald-700 dark:text-emerald-400" /> Alterar período
          </button>
          <button type="button" onClick={handleExportCsv} disabled={!produtos.length} className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3.5 py-2 text-[10px] font-bold text-koma-muted transition-all hover:bg-koma-card hover:text-koma-foreground disabled:opacity-50">
            <Download size={14} /> Exportar CSV
          </button>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-sky-300/40 bg-sky-50/70 p-4 text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-200">
        <Info size={16} className="mt-0.5 shrink-0" />
        <div>
          <strong className="block text-xs">Estes valores são de consumo, não de faturamento.</strong>
          <span className="mt-1 block text-[10px] leading-relaxed opacity-80">
            A aba mostra itens das Contas que tiveram recebimento no período. Pagamentos parciais não transformam o valor inteiro dos itens em receita; faturamento reconhecido permanece na Visão Geral/Financeiro.
          </span>
        </div>
      </div>

      {hasError && !isLoading && (
        <div className="mx-auto my-6 max-w-md space-y-3 rounded-3xl border border-rose-900/50 bg-koma-panel p-8 text-center">
          <h3 className="text-sm font-bold text-koma-foreground">Não foi possível carregar o consumo de produtos</h3>
          <button onClick={fetchProdutosReport} className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">Tentar novamente</button>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[
            { title: 'Top produtos por unidades consumidas', key: 'quantidade', name: 'Unidades consumidas' },
            { title: 'Top produtos por valor de consumo', key: 'valor', name: 'Valor de consumo' },
          ].map((chart) => (
            <div key={chart.key} className="space-y-4 rounded-3xl border border-koma-border bg-koma-panel p-5 shadow-xs">
              <div className="flex items-center gap-2 border-b border-koma-border pb-3">
                <BarChart2 size={16} className="text-emerald-700 dark:text-emerald-400" />
                <span className="font-serif text-sm font-bold text-koma-foreground">{chart.title}</span>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: chart.key === 'valor' ? 12 : 0, bottom: 50 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--koma-border-default)" vertical={false} opacity={0.6} />
                    <XAxis dataKey="name" stroke="var(--koma-text-muted)" fontSize={9} interval={0} angle={-35} textAnchor="end" height={55} />
                    <YAxis stroke="var(--koma-text-muted)" fontSize={11} width={chart.key === 'valor' ? 50 : 28} tickLine={false} axisLine={false} tickFormatter={chart.key === 'valor' ? (v) => `R$ ${v}` : undefined} />
                    <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'var(--koma-border-default)', opacity: 0.3 }} />
                    <Bar dataKey={chart.key} name={chart.name} fill={chart.key === 'valor' ? '#0284c7' : '#059669'} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
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
            <table className="w-full min-w-[620px] text-left text-[10px]">
              <thead className="border-b border-koma-border bg-koma-raised text-[9px] font-extrabold uppercase tracking-wider text-koma-subtle">
                <tr><th className="p-3 text-center">Posição</th><th className="p-3">Produto</th><th className="p-3">Categoria</th><th className="p-3 text-center">Qtd. consumida</th><th className="p-3 text-right">Valor de consumo</th><th className="p-3 text-right">Preço médio</th></tr>
              </thead>
              <tbody className="divide-y divide-koma-border">
                {produtos.map((p) => (
                  <tr key={p.produto_id} className="transition-colors hover:bg-koma-raised/50">
                    <td className="p-3 text-center font-mono font-extrabold text-koma-muted">#{p.ranking}</td>
                    <td className="p-3 font-bold text-koma-foreground">{p.produto_nome}</td>
                    <td className="p-3 font-medium text-koma-muted">{p.categoria_nome}</td>
                    <td className="p-3 text-center font-mono text-xs font-bold text-koma-foreground">{p.quantidade_consumida}</td>
                    <td className="p-3 text-right font-mono font-extrabold text-sky-700 dark:text-sky-300">R$ {p.valor_consumido.toFixed(2)}</td>
                    <td className="p-3 text-right font-mono font-medium text-koma-foreground">R$ {p.preco_medio_item.toFixed(2)}</td>
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
          onApply={(ini, fim) => { setDataInicio(ini); setDataFim(fim); }}
        />
      )}
    </div>
  );
};
