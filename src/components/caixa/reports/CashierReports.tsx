import clsx from 'clsx';
import { ArrowUpRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CatalogCategory } from '../../../catalog/catalog';
import { localCalendarDate } from '../../../utils/dateTime';
import { EquipeDesempenhoTab } from '../../equipe/EquipeDesempenhoTab';
import { RelatorioFinanceiroTab } from '../../relatorios/RelatorioFinanceiroTab';
import { RelatoriosProdutosTab } from '../../relatorios/RelatoriosProdutosTab';
import { RelatoriosVisaoGeralTab } from '../../relatorios/RelatoriosVisaoGeralTab';
import type { CashierNotice } from '../cashierContracts';
import type { useCashierOrders } from '../orders/useCashierOrders';

interface Props {
  deliveryOrders: ReturnType<typeof useCashierOrders>['deliveryOrders'];
  activeKitchenItems: readonly { status: string }[];
  apiCategorias: CatalogCategory[];
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeTab: string;
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
  showToast: CashierNotice;
}

export default function CashierReports({
  apiBaseUrl,
  authHeaders,
  activeTab,
  activeSubTab,
  setActiveSubTab,
  showToast,
  deliveryOrders,
  activeKitchenItems,
  apiCategorias,
}: Props) {
  const [waitersPerformance, setWaitersPerformance] = useState<
    { nome_garcon: string; pedidos_atendidos: number; comissao_acumulada: number }[]
  >([]);

  const [generalStats, setGeneralStats] = useState<any>(null);

  const [horariosPico, setHorariosPico] = useState<
    { dia_semana_label: string; dia_semana: number; hora: string; total_pedidos: number }[]
  >([]);

  const getPeriodString = () => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - parseInt(desempenhoRange));
    const format = (d: Date) => d.toLocaleDateString('pt-BR');
    return `${format(startDate)} - ${format(endDate)}`;
  };

  const handleExportReports = () => {
    if (!generalStats) return;
    const period = getPeriodString();

    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
    csvContent += `Relatório Consolidado de Vendas - Koma\n`;
    csvContent += `Período:;${period}\n\n`;

    csvContent += `MÉTRICAS GERAIS\n`;
    csvContent += `Indicador;Valor\n`;
    csvContent += `Vendas Líquidas;R$ ${generalStats.faturamento.toFixed(2)}\n`;
    csvContent += `Líquido de Hoje;R$ ${generalStats.faturamento_hoje.toFixed(2)}\n`;
    csvContent += `Ticket Médio;R$ ${generalStats.ticket_medio.toFixed(2)}\n`;
    csvContent += `Total de Pedidos;${generalStats.total_pedidos}\n`;
    csvContent += `Clientes Ativos;${generalStats.clientes_ativos}\n`;
    csvContent += `Qualidade do Cardápio;${generalStats.qualidade_cardapio}%\n\n`;

    csvContent += `PEDIDOS POR MODALIDADE\n`;
    csvContent += `Modalidade;Pedidos\n`;
    csvContent += `Entrega (Delivery);${generalStats.pedidos_modalidade?.delivery ?? 0}\n`;
    csvContent += `Consumo no Local (Mesa);${generalStats.pedidos_modalidade?.local ?? 0}\n`;
    csvContent += `Retirada (Balcão);${generalStats.pedidos_modalidade?.balcao ?? 0}\n\n`;

    csvContent += `TOP 5 ITENS MAIS PEDIDOS\n`;
    csvContent += `Rank;Item;Saídas;Preço Unitário\n`;
    (generalStats.top_itens ?? []).forEach((item: any) => {
      csvContent += `${item.rank};${item.name};${item.count};R$ ${item.price.toFixed(2)}\n`;
    });
    csvContent += '\n';

    csvContent += `DESEMPENHO DOS GARÇONS\n`;
    csvContent += `Garçom;Pedidos Atendidos;Comissão Acumulada (10%)\n`;
    waitersPerformance.forEach((w: any) => {
      csvContent += `${w.nome_garcon};${w.pedidos_atendidos};R$ ${w.comissao_acumulada.toFixed(2)}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `relatorio_consolidado_${desempenhoRange}_dias.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const [desempenhoRange, setDesempenhoRange] = useState<'7' | '15' | '30'>('7');
  useEffect(() => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - parseInt(desempenhoRange));
    const startStr = localCalendarDate(startDate);
    const endStr = localCalendarDate(endDate);
    if (activeTab === 'operacao' && ['equipe', 'relatorio_garçons'].includes(activeSubTab)) {
      fetch(`${apiBaseUrl}/garcons/relatorio?data_inicio=${startStr}&data_fim=${endStr}`, { headers: authHeaders })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setWaitersPerformance(data);
        })
        .catch((err) => console.error('Error fetching waiter report:', err));
    }
    if (
      activeTab === 'operacao' &&
      ['visao_geral', 'vendas', 'produtos_mais_vendidos', 'desempenho', 'relatorio_geral', 'top10'].includes(
        activeSubTab,
      )
    ) {
      fetch(`${apiBaseUrl}/comandas/estatisticas/geral?data_inicio=${startStr}&data_fim=${endStr}`, {
        headers: authHeaders,
      })
        .then((res) => res.json())
        .then((data) => {
          if (data && data.faturamento !== undefined) setGeneralStats(data);
        })
        .catch((err) => console.error('Error fetching general stats report:', err));
    }
    if (
      (activeTab === 'relatorios' || activeTab === 'dashboard') &&
      ['metas', 'metas_previsoes'].includes(activeSubTab)
    ) {
      fetch(`${apiBaseUrl}/comandas/estatisticas/pico`, { headers: authHeaders })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setHorariosPico(data);
        })
        .catch((err) => console.error('Error fetching peak hours:', err));
    }
  }, [activeTab, activeSubTab, desempenhoRange]);
  return (
    <>
      {activeSubTab === 'desempenho' && (
        <div className="space-y-6">
          {/* Header metrics boxes */}
          <div className={clsx('grid', 'grid-cols-2', 'md:grid-cols-4', 'gap-4')}>
            <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'p-4', 'rounded-2xl')}>
              <span
                className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-koma-subtle', 'block')}
              >
                Líquido de Hoje
              </span>
              <strong className={clsx('text-xl', 'text-koma-foreground', 'font-mono', 'block', 'mt-1')}>
                R$ $
                {(generalStats?.faturamento_hoje ?? 0.0).toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </strong>
            </div>
            <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'p-4', 'rounded-2xl')}>
              <span
                className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-koma-subtle', 'block')}
              >
                Em análise agora
              </span>
              <strong className={clsx('text-xl', 'text-amber-500', 'font-mono', 'block', 'mt-1')}>
                {deliveryOrders.filter((o) => o.status === 'analise').length}
              </strong>
            </div>
            <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'p-4', 'rounded-2xl')}>
              <span
                className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-koma-subtle', 'block')}
              >
                Em produção agora
              </span>
              <strong
                className={clsx('text-xl', 'text-emerald-700 dark:text-emerald-400', 'font-mono', 'block', 'mt-1')}
              >
                {deliveryOrders.filter((o) => o.status === 'producao').length +
                  activeKitchenItems.filter((i) => i.status === 'preparando').length}
              </strong>
            </div>
            <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'p-4', 'rounded-2xl')}>
              <span
                className={clsx('text-[9px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-koma-subtle', 'block')}
              >
                Pronto para entrega
              </span>
              <strong className={clsx('text-xl', 'text-emerald-500', 'font-mono', 'block', 'mt-1')}>
                {deliveryOrders.filter((o) => o.status === 'pronto').length}
              </strong>
            </div>
          </div>

          {/* Date Filters & Middle Metrics */}
          <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'p-4', 'rounded-2xl', 'space-y-4')}>
            <div className={clsx('flex', 'justify-between', 'items-center', 'border-b', 'border-koma-border', 'pb-3')}>
              <div className={clsx('flex', 'items-center', 'gap-2')}>
                <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary')}>Relatório Consolidado</span>
              </div>
              <div
                className={clsx('flex', 'gap-1', 'bg-koma-page', 'p-1', 'rounded-xl', 'border', 'border-koma-border')}
              >
                {[
                  { id: '7', label: 'Últimos 7 dias' },
                  { id: '15', label: 'Últimos 15 dias' },
                  { id: '30', label: 'Últimos 30 dias' },
                ].map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setDesempenhoRange(r.id as any)}
                    className={`px-3 py-1 text-[9px] font-bold rounded-lg cursor-pointer transition-all ${
                      desempenhoRange === r.id
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-koma-subtle hover:text-koma-foreground'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={clsx('grid', 'grid-cols-1', 'md:grid-cols-3', 'gap-4', 'font-mono')}>
              <div
                className={clsx(
                  'bg-koma-panel',
                  'p-3.5',
                  'rounded-xl',
                  'border',
                  'border-koma-border/50',
                  'flex',
                  'justify-between',
                  'items-center',
                )}
              >
                <div>
                  <span
                    className={clsx(
                      'text-[8px]',
                      'font-bold',
                      'font-sans',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-widest',
                      'block',
                    )}
                  >
                    Receita Líquida
                  </span>
                  <strong className={clsx('text-base', 'text-koma-foreground', 'mt-1', 'block')}>
                    R$ $
                    {(generalStats?.faturamento ?? 0.0).toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </div>
                <span
                  className={clsx(
                    'text-[10px]',
                    'text-emerald-400',
                    'font-bold',
                    'bg-emerald-500/10',
                    'px-2',
                    'py-0.5',
                    'rounded',
                    'flex',
                    'items-center',
                    'gap-0.5',
                  )}
                >
                  <ArrowUpRight size={10} /> Real
                </span>
              </div>

              <div
                className={clsx(
                  'bg-koma-panel',
                  'p-3.5',
                  'rounded-xl',
                  'border',
                  'border-koma-border/50',
                  'flex',
                  'justify-between',
                  'items-center',
                )}
              >
                <div>
                  <span
                    className={clsx(
                      'text-[8px]',
                      'font-bold',
                      'font-sans',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-widest',
                      'block',
                    )}
                  >
                    Pedidos
                  </span>
                  <strong className={clsx('text-base', 'text-koma-foreground', 'mt-1', 'block')}>
                    {generalStats?.total_pedidos ?? 0}
                  </strong>
                </div>
                <span
                  className={clsx(
                    'text-[10px]',
                    'text-emerald-400',
                    'font-bold',
                    'bg-emerald-500/10',
                    'px-2',
                    'py-0.5',
                    'rounded',
                    'flex',
                    'items-center',
                    'gap-0.5',
                  )}
                >
                  <ArrowUpRight size={10} /> Real
                </span>
              </div>

              <div
                className={clsx(
                  'bg-koma-panel',
                  'p-3.5',
                  'rounded-xl',
                  'border',
                  'border-koma-border/50',
                  'flex',
                  'justify-between',
                  'items-center',
                )}
              >
                <div>
                  <span
                    className={clsx(
                      'text-[8px]',
                      'font-bold',
                      'font-sans',
                      'text-koma-subtle',
                      'uppercase',
                      'tracking-widest',
                      'block',
                    )}
                  >
                    Ticket Médio
                  </span>
                  <strong className={clsx('text-base', 'text-koma-foreground', 'mt-1', 'block')}>
                    R$ $
                    {(generalStats?.ticket_medio ?? 0.0).toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </div>
                <span
                  className={clsx(
                    'text-[10px]',
                    'text-emerald-400',
                    'font-bold',
                    'bg-emerald-500/10',
                    'px-2',
                    'py-0.5',
                    'rounded',
                    'flex',
                    'items-center',
                    'gap-0.5',
                  )}
                >
                  <ArrowUpRight size={10} /> Real
                </span>
              </div>
            </div>
          </div>

          {/* Bottom Gauges & Best Sellers List */}
          <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-3', 'gap-5')}>
            {/* 1. Cardapio Quality Gauge */}
            <div
              className={clsx(
                'bg-koma-card/60',
                'border',
                'border-koma-border',
                'rounded-3xl',
                'p-5',
                'flex',
                'flex-col',
                'items-center',
                'justify-between',
                'text-center',
                'space-y-4',
              )}
            >
              <span
                className={clsx(
                  'font-serif',
                  'font-bold',
                  'text-koma-secondary',
                  'block',
                  'text-left',
                  'w-full',
                  'border-b',
                  'border-koma-border',
                  'pb-2',
                )}
              >
                Qualidade do Cardápio
              </span>

              <div className={clsx('relative', 'h-28', 'w-28', 'flex', 'items-center', 'justify-center')}>
                <svg className={clsx('absolute', 'inset-0', 'transform', '-rotate-90')} viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" stroke="#27272A" strokeWidth="8" fill="transparent" />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    stroke="url(#gradient)"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray="264"
                    strokeDashoffset={264 - (264 * (generalStats?.qualidade_cardapio ?? 100)) / 100}
                    strokeLinecap="round"
                  />
                  <defs>
                    <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#10b981" />
                      <stop offset="100%" stopColor="#10b981" />
                    </linearGradient>
                  </defs>
                </svg>
                <span className={clsx('text-lg', 'font-bold', 'font-mono', 'text-koma-foreground')}>
                  {generalStats?.qualidade_cardapio ?? 100}%
                </span>
              </div>

              <div className="space-y-1">
                <strong className={clsx('text-koma-foreground', 'font-medium', 'block', 'text-xs')}>
                  Cardápio Otimizado
                </strong>
                <p className={clsx('text-[9px]', 'text-koma-muted')}>
                  Seu cardápio possui ótimas descrições e fotos de alta resolução cadastrados.
                </p>
              </div>
            </div>

            {/* 2. Modality Split Gauges */}
            <div className={clsx('bg-koma-card/60', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'space-y-3')}>
              <span
                className={clsx(
                  'font-serif',
                  'font-bold',
                  'text-koma-secondary',
                  'block',
                  'border-b',
                  'border-koma-border',
                  'pb-2',
                )}
              >
                Pedidos por Modalidade
              </span>

              <div className={clsx('space-y-2.5', 'pt-2')}>
                {[
                  {
                    name: 'Entrega (Delivery)',
                    count: generalStats?.pedidos_modalidade?.delivery ?? 0,
                    max: Math.max(1, generalStats?.total_pedidos ?? 1),
                    barColor: 'bg-rose-600',
                  },
                  {
                    name: 'Consumo no Local (Mesa)',
                    count: generalStats?.pedidos_modalidade?.local ?? 0,
                    max: Math.max(1, generalStats?.total_pedidos ?? 1),
                    barColor: 'bg-[#10b981]',
                  },
                  {
                    name: 'Retirada (Balcão)',
                    count: generalStats?.pedidos_modalidade?.balcao ?? 0,
                    max: Math.max(1, generalStats?.total_pedidos ?? 1),
                    barColor: 'bg-emerald-600',
                  },
                ].map((mod, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className={clsx('flex', 'justify-between', 'text-[10px]')}>
                      <span className="text-koma-subtle">{mod.name}</span>
                      <strong className={clsx('text-koma-foreground', 'font-mono')}>{mod.count} pedidos</strong>
                    </div>
                    <div className={clsx('h-1.5', 'w-full', 'bg-koma-panel', 'rounded-full', 'overflow-hidden')}>
                      <div
                        className={`h-full ${mod.barColor} rounded-full`}
                        style={{ width: `${(mod.count / mod.max) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. Top Items list */}
            <div className={clsx('bg-koma-card/60', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'space-y-3')}>
              <span
                className={clsx(
                  'font-serif',
                  'font-bold',
                  'text-koma-secondary',
                  'block',
                  'border-b',
                  'border-koma-border',
                  'pb-2',
                )}
              >
                Top 5 Itens Mais Pedidos
              </span>

              <div className={clsx('divide-y', 'divide-koma-border')}>
                {(generalStats?.top_itens ?? []).map((item: any, idx: number) => (
                  <div key={idx} className={clsx('py-2', 'flex', 'justify-between', 'items-center')}>
                    <div className={clsx('flex', 'items-center', 'gap-2.5')}>
                      <span
                        className={`h-5 w-5 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold ${
                          idx === 0
                            ? 'bg-emerald-600 text-white'
                            : idx === 1
                              ? 'bg-[#10b981] text-[#121214]'
                              : 'bg-koma-panel text-koma-subtle'
                        }`}
                      >
                        {item.rank}
                      </span>
                      <span className={clsx('font-medium', 'text-koma-foreground', 'block')}>{item.name}</span>
                    </div>
                    <span className={clsx('text-[10px]', 'font-bold', 'text-koma-subtle', 'font-mono')}>
                      {item.count} saídas
                    </span>
                  </div>
                ))}
                {(generalStats?.top_itens ?? []).length === 0 && (
                  <div className={clsx('py-8', 'text-center', 'text-koma-muted', 'italic', 'text-[10px]')}>
                    Nenhum item vendido no período
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {(activeTab === 'relatorios' || activeTab === 'dashboard') &&
        ['visao_geral', 'metas', 'vendas', 'indicadores', 'relatorio_geral', 'consolidado_vendas'].includes(
          activeSubTab,
        ) && <RelatoriosVisaoGeralTab apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} showToast={showToast} />}
      {(activeTab === 'relatorios' || activeTab === 'dashboard') &&
        ['financeiro', 'demonstrativo_dre', 'dre', 'fluxo_caixa'].includes(activeSubTab) && (
          <RelatorioFinanceiroTab apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
        )}
      {(activeTab === 'relatorios' || activeTab === 'dashboard') &&
        ['produtos', 'produtos_mais_vendidos', 'top10', 'mais_vendidos'].includes(activeSubTab) && (
          <RelatoriosProdutosTab
            apiBaseUrl={apiBaseUrl}
            authHeaders={authHeaders}
            categorias={apiCategorias}
            showToast={showToast}
          />
        )}
      {(activeTab === 'relatorios' || activeTab === 'dashboard') && activeSubTab === 'equipe' && (
        <EquipeDesempenhoTab apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} showToast={showToast} />
      )}
    </>
  );
}
