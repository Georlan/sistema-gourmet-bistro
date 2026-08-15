import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { Package, Search, Calendar as CalendarIcon, Download, Filter, BarChart2 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { PeriodoCalendarioModal } from './PeriodoCalendarioModal';
import { localCalendarDate } from '../../utils/dateTime';

interface RelatoriosProdutosTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  showToast: (msg: string) => void;
}

export interface ProdutoRelatorioItem {
  ranking: number;
  produto_id: number;
  produto_nome: string;
  categoria_nome: string;
  quantidade_vendida: number;
  faturamento_total: number;
  ticket_medio_item: number;
}

const CustomChartTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-koma-panel border border-koma-border p-3 rounded-2xl shadow-xl text-left font-sans space-y-1 z-50">
        <p className="text-[10px] font-bold text-koma-foreground">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-xs font-bold font-mono" style={{ color: entry.color }}>
            {entry.name}: {entry.dataKey === 'faturamento' ? `R$ ${entry.value.toFixed(2)}` : `${entry.value} un.`}
          </p>
        ))}
      </div>
    );
  }
  return null;
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
    return {
      inicio: localCalendarDate(start),
      fim: localCalendarDate(end),
    };
  };

  const defaults = getDefaultDates();
  const [dataInicio, setDataInicio] = useState(defaults.inicio);
  const [dataFim, setDataFim] = useState(defaults.fim);
  const [ordenacao, setOrdenacao] = useState<'mais_vendidos' | 'menos_vendidos' | 'todos'>('mais_vendidos');
  const [busca, setBusca] = useState('');
  const [categoriaId, setCategoriaId] = useState<string>('');

  const [isLoading, setIsLoading] = useState(false);
  const [produtos, setProdutos] = useState<ProdutoRelatorioItem[]>([]);
  const [categorias, setCategorias] = useState<{ id: any; nome: string }[]>([]);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Fetch categories list
  useEffect(() => {
    fetch(`${apiBaseUrl}/produtos/categorias`, { headers: authHeaders })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setCategorias(data);
      })
      .catch(() => {});
  }, [apiBaseUrl]);

  // Fetch products report
  const fetchProdutosReport = async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      let url = `${apiBaseUrl}/relatorios/produtos?data_inicio=${dataInicio}&data_fim=${dataFim}&ordenacao=${ordenacao}`;
      if (busca && busca.trim()) {
        url += `&busca=${encodeURIComponent(busca.trim())}`;
      }
      if (categoriaId) {
        url += `&categoria_id=${categoriaId}`;
      }

      const res = await fetch(url, { headers: authHeaders });
      if (res.ok) {
        const json = await res.json();
        setProdutos(json);
      } else {
        setHasError(true);
      }
    } catch (err) {
      console.error('Erro ao carregar relatório de produtos:', err);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProdutosReport();
  }, [dataInicio, dataFim, ordenacao, categoriaId]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchProdutosReport();
  };

  const handleExportCsv = () => {
    if (!produtos.length) return;
    let csv = 'Ranking;Produto;Categoria;Quantidade Vendida;Faturamento Total (R$);Ticket Médio Item (R$)\n';
    produtos.forEach((p) => {
      csv += `${p.ranking};"${p.produto_nome}";"${p.categoria_nome}";${p.quantidade_vendida};${p.faturamento_total.toFixed(2)};${p.ticket_medio_item.toFixed(2)}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `relatorio_produtos_${dataInicio}_a_${dataFim}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const topProdutosChartData = produtos.slice(0, 7).map((p) => ({
    name: p.produto_nome.length > 18 ? `${p.produto_nome.slice(0, 16)}...` : p.produto_nome,
    quantidade: p.quantidade_vendida,
    faturamento: p.faturamento_total,
  }));

  return (
    <div className={clsx('space-y-5', 'text-left', 'animate-fade-in')}>
      {/* Top Bar */}
      <div className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'p-4.5', 'rounded-3xl', 'flex', 'flex-col', 'sm:flex-row', 'sm:items-center', 'justify-between', 'gap-4')}>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Package size={18} className="text-emerald-700 dark:text-emerald-400" />
            <h3 className="font-serif font-bold text-base text-koma-foreground">Relatório de Desempenho de Produtos</h3>
          </div>
          <p className="text-[10px] text-koma-subtle">
            Período: <strong className="text-koma-secondary">{dataInicio}</strong> até <strong className="text-koma-secondary">{dataFim}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2.5">
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
            disabled={!produtos.length}
            className="px-3.5 py-2 bg-koma-raised hover:bg-koma-card border border-koma-border text-koma-muted hover:text-koma-foreground rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download size={14} />
            Exportar CSV
          </button>
        </div>
      </div>

      {hasError && !isLoading && (
        <div className="bg-koma-panel border border-rose-900/50 rounded-3xl p-8 text-center space-y-4 max-w-md mx-auto my-6 animate-fade-in">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
            <span className="font-bold text-lg">!</span>
          </div>
          <div className="space-y-1">
            <h3 className="text-koma-foreground font-bold text-sm">Não foi possível carregar o relatório de produtos</h3>
            <p className="text-koma-subtle text-xs">Por favor, tente novamente.</p>
          </div>
          <button
            onClick={() => fetchProdutosReport()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-koma-foreground font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Gráficos Visuais dos Mais Vendidos */}
      {topProdutosChartData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
          <div className="bg-koma-panel border border-koma-border p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl space-y-3 sm:space-y-4 shadow-xs">
            <div className="flex items-center gap-2 border-b border-koma-border pb-3">
              <BarChart2 size={16} className="text-emerald-700 dark:text-emerald-400" />
              <span className="font-serif font-bold text-sm text-koma-foreground">Top Produtos por Unidades Vendidas</span>
            </div>

            <div className="h-64 sm:h-72 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProdutosChartData} margin={{ top: 10, right: 10, left: 0, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--koma-border-default)" vertical={false} opacity={0.6} />
                  <XAxis dataKey="name" stroke="var(--koma-text-muted)" fontSize={9} interval={0} angle={-35} textAnchor="end" height={55} />
                  <YAxis stroke="var(--koma-text-muted)" fontSize={11} width={28} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'var(--koma-border-default)', opacity: 0.3 }} />
                  <Bar dataKey="quantidade" name="Unidades Vendidas" fill="#059669" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-koma-panel border border-koma-border p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl space-y-3 sm:space-y-4 shadow-xs">
            <div className="flex items-center gap-2 border-b border-koma-border pb-3">
              <BarChart2 size={16} className="text-sky-600 dark:text-sky-400" />
              <span className="font-serif font-bold text-sm text-koma-foreground">Top Produtos por Faturamento (R$)</span>
            </div>

            <div className="h-64 sm:h-72 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProdutosChartData} margin={{ top: 10, right: 10, left: 12, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--koma-border-default)" vertical={false} opacity={0.6} />
                  <XAxis dataKey="name" stroke="var(--koma-text-muted)" fontSize={9} interval={0} angle={-35} textAnchor="end" height={55} />
                  <YAxis stroke="var(--koma-text-muted)" fontSize={11} width={50} tickLine={false} axisLine={false} tickFormatter={(v) => `R$ ${v}`} />
                  <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'var(--koma-border-default)', opacity: 0.3 }} />
                  <Bar dataKey="faturamento" name="Faturamento (R$)" fill="#0284c7" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Filters Toolbar */}
      <div className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'p-3', 'sm:p-4', 'rounded-2xl', 'flex', 'flex-col', 'lg:flex-row', 'items-stretch', 'lg:items-center', 'justify-between', 'gap-2.5', 'sm:gap-3', 'shadow-xs')}>
        {/* Ordenação */}
        <div className="flex items-center gap-1.5 w-full lg:w-auto">
          <span className="text-[9px] font-bold text-koma-muted uppercase tracking-wider block shrink-0">Filtro:</span>
          <div className="grid grid-cols-3 bg-koma-input p-0.5 sm:p-1 border border-koma-border rounded-xl gap-0.5 sm:gap-1 flex-1 sm:flex-none">
            <button
              type="button"
              onClick={() => setOrdenacao('mais_vendidos')}
              className={`px-2.5 py-1.5 rounded-lg text-[9px] font-extrabold uppercase transition-all cursor-pointer text-center ${
                ordenacao === 'mais_vendidos'
                  ? 'koma-btn-success'
                  : 'text-koma-muted hover:text-koma-foreground'
              }`}
            >
              Mais Vendidos
            </button>
            <button
              type="button"
              onClick={() => setOrdenacao('menos_vendidos')}
              className={`px-2.5 py-1.5 rounded-lg text-[9px] font-extrabold uppercase transition-all cursor-pointer text-center ${
                ordenacao === 'menos_vendidos'
                  ? 'koma-btn-success'
                  : 'text-koma-muted hover:text-koma-foreground'
              }`}
            >
              Menos Vendidos
            </button>
            <button
              type="button"
              onClick={() => setOrdenacao('todos')}
              className={`px-2.5 py-1.5 rounded-lg text-[9px] font-extrabold uppercase transition-all cursor-pointer text-center ${
                ordenacao === 'todos'
                  ? 'koma-btn-success'
                  : 'text-koma-muted hover:text-koma-foreground'
              }`}
            >
              Todos
            </button>
          </div>
        </div>

        {/* Busca por Nome & Categoria */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full lg:w-auto flex-1 max-w-lg">
          <form onSubmit={handleSearchSubmit} className="relative w-full">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
            <input
              type="text"
              placeholder="Buscar produto..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs focus:outline-none focus:border-emerald-500/60"
            />
          </form>

          <select
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs font-medium cursor-pointer focus:outline-none focus:border-emerald-500/60 truncate"
          >
            <option value="">Todas as Categorias</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Products Table */}
      <div className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'rounded-2xl', 'sm:rounded-3xl', 'overflow-hidden', 'shadow-xs')}>
        {isLoading ? (
          <div className="p-12 text-center text-koma-muted text-xs animate-pulse">
            Carregando desempenho de produtos...
          </div>
        ) : produtos.length === 0 ? (
          <div className="p-12 text-center text-koma-muted text-xs font-medium">
            Nenhum produto encontrado para os filtros selecionados.
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[540px] text-left text-[10px]">
              <thead className="bg-koma-raised border-b border-koma-border text-koma-subtle uppercase tracking-wider font-extrabold text-[9px]">
                <tr>
                  <th className="p-2.5 sm:p-3.5 text-center font-mono w-14 sm:w-16">Posição</th>
                  <th className="p-2.5 sm:p-3.5">Produto</th>
                  <th className="p-2.5 sm:p-3.5">Categoria</th>
                  <th className="p-2.5 sm:p-3.5 text-center font-mono">Qtd Vendida</th>
                  <th className="p-2.5 sm:p-3.5 text-right font-mono">Faturamento Total</th>
                  <th className="p-2.5 sm:p-3.5 text-right font-mono">Ticket Médio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-koma-border">
                {produtos.map((p) => (
                  <tr key={p.produto_id} className="hover:bg-koma-raised/50 transition-colors">
                    <td className="p-2.5 sm:p-3.5 text-center font-mono font-extrabold text-koma-muted">
                      #{p.ranking}
                    </td>
                    <td className="p-2.5 sm:p-3.5 font-bold text-koma-foreground">{p.produto_nome}</td>
                    <td className="p-2.5 sm:p-3.5 text-koma-muted font-medium">{p.categoria_nome}</td>
                    <td className="p-2.5 sm:p-3.5 text-center font-mono font-bold text-koma-foreground text-xs">
                      {p.quantidade_vendida}
                    </td>
                    <td className="p-2.5 sm:p-3.5 text-right font-mono font-extrabold text-emerald-700 dark:text-emerald-400">
                      R$ {p.faturamento_total.toFixed(2)}
                    </td>
                    <td className="p-2.5 sm:p-3.5 text-right font-mono text-koma-foreground font-medium">
                      R$ {p.ticket_medio_item.toFixed(2)}
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
