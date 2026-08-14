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
      <div className="bg-[#1C1C1F] border border-[#27272A] p-3 rounded-2xl shadow-xl text-left font-sans space-y-1 z-50">
        <p className="text-[10px] font-bold text-white">{label}</p>
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
            <Package size={18} className="text-[#10b981]" />
            <h3 className="font-serif font-bold text-base text-white">Relatório de Desempenho de Produtos</h3>
          </div>
          <p className="text-[10px] text-gray-400">
            Período: <strong className="text-gray-200">{dataInicio}</strong> até <strong className="text-gray-200">{dataFim}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowCalendarModal(true)}
            className="px-3.5 py-2 bg-koma-raised hover:bg-koma-card border border-koma-border text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5"
          >
            <CalendarIcon size={14} className="text-[#10b981]" />
            Alterar Período
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!produtos.length}
            className="px-3.5 py-2 bg-koma-raised hover:bg-koma-card border border-koma-border text-gray-300 hover:text-white rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
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
            <h3 className="text-white font-bold text-sm">Não foi possível carregar o relatório de produtos</h3>
            <p className="text-gray-400 text-xs">Por favor, tente novamente.</p>
          </div>
          <button
            onClick={() => fetchProdutosReport()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Gráficos Visuais dos Mais Vendidos */}
      {topProdutosChartData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-4">
            <div className="flex items-center gap-2 border-b border-koma-border pb-3">
              <BarChart2 size={16} className="text-[#10b981]" />
              <span className="font-serif font-bold text-sm text-white">Top Produtos por Unidades Vendidas</span>
            </div>

            <div className="h-60 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProdutosChartData} margin={{ top: 10, right: 10, left: -15, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
                  <XAxis dataKey="name" stroke="#71717A" fontSize={9} interval={0} angle={-25} textAnchor="end" />
                  <YAxis stroke="#71717A" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }} />
                  <Bar dataKey="quantidade" name="Unidades Vendidas" fill="#10b981" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-4">
            <div className="flex items-center gap-2 border-b border-koma-border pb-3">
              <BarChart2 size={16} className="text-sky-400" />
              <span className="font-serif font-bold text-sm text-white">Top Produtos por Faturamento (R$)</span>
            </div>

            <div className="h-60 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProdutosChartData} margin={{ top: 10, right: 10, left: -15, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
                  <XAxis dataKey="name" stroke="#71717A" fontSize={9} interval={0} angle={-25} textAnchor="end" />
                  <YAxis stroke="#71717A" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `R$${v}`} />
                  <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }} />
                  <Bar dataKey="faturamento" name="Faturamento (R$)" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Filters Toolbar */}
      <div className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'p-4', 'rounded-2xl', 'flex', 'flex-col', 'md:flex-row', 'items-center', 'justify-between', 'gap-3')}>
        {/* Ordenação */}
        <div className="flex items-center gap-1.5 w-full md:w-auto">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Filtro:</span>
          <div className="flex bg-koma-input p-1 border border-koma-border rounded-xl gap-1">
            <button
              type="button"
              onClick={() => setOrdenacao('mais_vendidos')}
              className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer ${
                ordenacao === 'mais_vendidos'
                  ? 'bg-[#10b981] text-zinc-950 font-bold'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Mais Vendidos
            </button>
            <button
              type="button"
              onClick={() => setOrdenacao('menos_vendidos')}
              className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer ${
                ordenacao === 'menos_vendidos'
                  ? 'bg-[#10b981] text-zinc-950 font-bold'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Menos Vendidos
            </button>
            <button
              type="button"
              onClick={() => setOrdenacao('todos')}
              className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer ${
                ordenacao === 'todos'
                  ? 'bg-[#10b981] text-zinc-950 font-bold'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Todos
            </button>
          </div>
        </div>

        {/* Busca por Nome & Categoria */}
        <div className="flex items-center gap-2 w-full md:w-auto flex-1 max-w-lg">
          <form onSubmit={handleSearchSubmit} className="relative flex-1">
            <Search size={14} className="absolute left-3 top-2.5 text-gray-500" />
            <input
              type="text"
              placeholder="Buscar por nome do produto..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-koma-input border border-koma-border rounded-xl text-white text-[10px]"
            />
          </form>

          <select
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            className="px-3 py-1.5 bg-koma-input border border-koma-border rounded-xl text-white text-[10px] cursor-pointer"
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
      <div className={clsx('bg-koma-panel', 'border', 'border-koma-border', 'rounded-3xl', 'overflow-hidden')}>
        {isLoading ? (
          <div className="p-12 text-center text-gray-400 text-xs animate-pulse">
            Carregando desempenho de produtos...
          </div>
        ) : produtos.length === 0 ? (
          <div className="p-12 text-center text-gray-500 text-xs">
            Nenhum produto encontrado para os filtros selecionados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[10px]">
              <thead className="bg-koma-raised border-b border-koma-border text-gray-400 uppercase tracking-wider font-bold">
                <tr>
                  <th className="p-3.5 text-center font-mono w-16">Posição</th>
                  <th className="p-3.5">Produto</th>
                  <th className="p-3.5">Categoria</th>
                  <th className="p-3.5 text-center font-mono">Qtd Vendida</th>
                  <th className="p-3.5 text-right font-mono">Faturamento Total</th>
                  <th className="p-3.5 text-right font-mono">Ticket Médio do Item</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-koma-border">
                {produtos.map((p) => (
                  <tr key={p.produto_id} className="hover:bg-koma-raised/50 transition-colors">
                    <td className="p-3.5 text-center font-mono font-extrabold text-gray-400">
                      #{p.ranking}
                    </td>
                    <td className="p-3.5 font-bold text-white">{p.produto_nome}</td>
                    <td className="p-3.5 text-gray-300">{p.categoria_nome}</td>
                    <td className="p-3.5 text-center font-mono font-bold text-sky-400">
                      {p.quantidade_vendida}
                    </td>
                    <td className="p-3.5 text-right font-mono font-extrabold text-[#10b981]">
                      R$ {p.faturamento_total.toFixed(2)}
                    </td>
                    <td className="p-3.5 text-right font-mono text-gray-300">
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
