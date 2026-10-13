import { useEffect, useState } from 'react';
import { KOMA_CHART_AXIS, KOMA_CHART_COLORS, KOMA_CHART_GRID } from '../../config/chartTheme';
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, Cell } from 'recharts';
import { menuMoney, menuPercent, quadrantLabels, quadrantClasses, type MenuProduct, type MenuReport } from '../../domain/menuIntelligence';

const colors = { estrela: KOMA_CHART_COLORS.primary, enigma: KOMA_CHART_COLORS.secondary, cavalo_batalha: KOMA_CHART_COLORS.warning, baixo_desempenho: KOMA_CHART_COLORS.neutral };
export function MenuIntelligenceMatrix({ report, onInspect }: { report: MenuReport; onInspect: (id: string) => void }) {
  const categories = report.categorias || [];
  const [categoryId, setCategoryId] = useState(categories[0]?.categoria_id || '');
  const category = categories.find(c => c.categoria_id === categoryId) || categories[0];
  useEffect(() => {
    if (!categories.some(c => c.categoria_id === categoryId)) setCategoryId(categories[0]?.categoria_id || '');
  }, [categories, categoryId]);
  if (!category) return <p className="rounded-2xl border border-koma-border p-6 text-sm text-koma-muted">Ainda não há categorias analisáveis. Confira os produtos, seus custos e amplie o período.</p>;
  const products = report.produtos.filter(p => p.categoria_id === category.categoria_id && (p.ativo || p.unidades));
  const plotted = products.filter(p => p.classificacao && p.margem_unitaria_observada != null);
  const points = plotted.map(p => ({ x: p.participacao_categoria_pct, y: p.margem_unitaria_observada, z: 100, product: p }));
  const renderTooltip = ({ active, payload }: { active?: boolean; payload?: readonly { payload?: { product: MenuProduct } }[] }) => {
    const p = payload?.[0]?.payload?.product;
    return active && p ? <div className="rounded-xl border border-koma-border bg-koma-panel p-3 text-xs text-koma-foreground"><strong>{p.nome}</strong><p>{quadrantLabels[p.classificacao!]}</p><p>{menuPercent(p.participacao_categoria_pct)} das unidades · {menuMoney(p.margem_unitaria_observada)}/un.</p></div> : null;
  };
  return <div className="space-y-4">
    <label className="block text-xs font-semibold text-koma-foreground">Categoria para comparar
      <select value={category.categoria_id} onChange={e => setCategoryId(e.target.value)} className="mt-2 w-full rounded-xl border border-koma-border bg-koma-input p-3 sm:w-auto" >
        {categories.map(c => <option key={c.categoria_id} value={c.categoria_id}>{c.nome}</option>)}
      </select>
    </label>
    <div className="rounded-2xl border border-koma-border bg-koma-panel p-4 text-xs text-koma-muted">
      <strong className="text-koma-foreground">Comparação dentro de {category.nome}</strong>
      <p className="mt-2">{category.produtos_comparaveis} produtos comparáveis · {category.pedidos_distintos} pedidos distintos · {category.unidades} unidades.</p>
      <p>Popularidade alta a partir de {menuPercent(category.limite_popularidade_pct)}. Margem alta a partir de {menuMoney(category.limite_margem_unitaria)}/un. (média ponderada da parcela coberta).</p>
      <p>Cobertura: {menuPercent(category.cobertura_custo_pct)} das unidades. {category.cobertura_completa ? 'Ingredientes cadastrados da base conhecidos.' : 'Custos parciais: classificação provisória.'} Disponibilidade histórica desconhecida.</p>
      {!category.triagem_disponivel && <p className="mt-2 font-semibold text-koma-foreground">Amostra insuficiente para esta triagem: pelo menos 3 produtos, 30 pedidos na categoria e um período de 7 dias. Essa regra não é garantia estatística.</p>}
    </div>
    {points.length > 0 && <figure className="hidden rounded-2xl border border-koma-border bg-koma-panel p-4 sm:block">
      <figcaption className="mb-4 text-sm font-semibold text-koma-foreground">Popularidade e margem unitária estimada · {category.nome}</figcaption>
      <div className="h-80" aria-label="Matriz de popularidade em percentual e margem em reais. Use a lista abaixo para investigar cada produto.">
        <ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 12, right: 20, bottom: 36, left: 20 }}>
          <CartesianGrid {...KOMA_CHART_GRID} />
          <XAxis {...KOMA_CHART_AXIS} type="number" dataKey="x" name="Popularidade" unit="%" tickFormatter={v => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} label={{ value: 'Participação nas unidades da categoria (%)', position: 'bottom', offset: 18, fill: 'var(--koma-text-muted)'  }} tick={{ fontSize: 11 }} />
          <YAxis {...KOMA_CHART_AXIS} type="number" dataKey="y" name="Margem unitária estimada" tickFormatter={v => `R$${v}`} label={{ value: 'Margem unitária (R$)', angle: -90, position: 'insideLeft', fill: 'var(--koma-text-muted)' }} tick={{ fontSize: 11 }} domain={['dataMin', 'dataMax']} />
          <ZAxis type="number" dataKey="z" range={[100, 100]} /><Tooltip content={renderTooltip} />
          <ReferenceLine x={category.limite_popularidade_pct} stroke={KOMA_CHART_COLORS.neutral} strokeDasharray="5 5" ifOverflow="extendDomain" />
          <ReferenceLine y={category.limite_margem_unitaria!} stroke={KOMA_CHART_COLORS.neutral} strokeDasharray="5 5" ifOverflow="extendDomain" />
          <Scatter data={points} onClick={(point) => { const p = point.payload?.product; if (p) onInspect(p.produto_id); }}>
            {points.map(p => <Cell key={p.product.produto_id} fill={colors[p.product.classificacao!]} />)}
          </Scatter>
        </ScatterChart></ResponsiveContainer>
      </div>
      <p className="mt-3 text-xs text-koma-muted">Fonte: pedidos por entrada no período selecionado; custo atual dos ingredientes cadastrados, sem modificadores. Não é lucro histórico.</p>
    </figure>}
    <div className="flex flex-wrap gap-2">{Object.entries(quadrantLabels).map(([key, label]) => <span key={key} className={`rounded-lg px-3 py-2 text-xs font-semibold ${quadrantClasses[key]}`}>{label}</span>)}</div>
    <div className="space-y-2">{products.map(p => <button key={p.produto_id} onClick={() => onInspect(p.produto_id)} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-koma-border bg-koma-panel p-4 text-left hover:bg-koma-raised">
      <span className="text-sm font-semibold text-koma-foreground">{p.nome}<span className="mt-1 block text-xs font-normal text-koma-muted">{p.unidades} un. · margem {menuMoney(p.margem_unitaria_observada)}/un.</span></span>
      <span className={`rounded-lg px-2 py-1 text-xs ${p.classificacao ? quadrantClasses[p.classificacao] : 'text-koma-muted'}`}>{p.classificacao ? quadrantLabels[p.classificacao] : 'Não classificável'}</span>
    </button>)}</div>
    <p className="text-xs text-koma-muted">Os quadrantes orientam investigação. Um produto cinza não deve ser retirado automaticamente; um amarelo pode ter boa contribuição total.</p>
  </div>;
}
