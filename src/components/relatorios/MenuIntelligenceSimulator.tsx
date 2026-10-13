import { useEffect, useRef, useState, type FormEvent } from 'react';
import { menuMoney, simulationMoneyInput, simulationQuantityInput, type MenuProduct, type MenuReport, type MenuSimulationInput, type MenuSimulationResult } from '../../domain/menuIntelligence';

type Values = { price: string; cost: string; qty: string; newPrice: string; newCost: string; variable: string; spend: string; low: string; middle: string; high: string };
function baseline(product?: MenuProduct): Values {
  const price = product && product.unidades_cobertas && product.valor_coberto != null ? product.valor_coberto / product.unidades_cobertas : product?.preco_cardapio;
  const qty = product?.unidades_cobertas || product?.unidades || 0;
  return { price: price?.toFixed(2) || '', cost: product?.custo_unitario?.toFixed(2) || '', qty: String(qty),
    newPrice: price?.toFixed(2) || '', newCost: product?.custo_unitario?.toFixed(2) || '', variable: '0', spend: '0',
    low: String(qty), middle: String(qty), high: String(qty) };
}
const fields: { key: keyof Values; label: string; money?: boolean }[] = [
  { key: 'price', label: 'Preço de referência (R$)', money: true },
  { key: 'cost', label: 'Custo de referência (R$)', money: true },
  { key: 'qty', label: 'Unidades de referência' },
  { key: 'newPrice', label: 'Preço proposto (R$)', money: true },
  { key: 'newCost', label: 'Custo proposto (R$)', money: true },
  { key: 'variable', label: 'Outras despesas variáveis por unidade (R$)', money: true },
  { key: 'spend', label: 'Gasto adicional da ação (R$)', money: true },
];

export function MenuIntelligenceSimulator({ report, apiBaseUrl, authHeaders, initialProductId }: {
  report: MenuReport; apiBaseUrl: string; authHeaders: Record<string, string>; initialProductId: string;
}) {
  const initialProduct = report.produtos.find(p => p.produto_id === initialProductId);
  const [productId, setProductId] = useState(initialProduct?.produto_id || '');
  const [values, setValues] = useState<Values>(() => baseline(initialProduct));
  const [result, setResult] = useState<MenuSimulationResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const invalidate = () => { request.current?.abort(); setResult(null); setError(''); setBusy(false); };
  const update = (key: keyof Values, value: string) => { invalidate(); setValues(prev => ({ ...prev, [key]: value })); };
  const choose = (id: string) => { invalidate(); setProductId(id); setValues(baseline(report.produtos.find(p => p.produto_id === id))); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); invalidate();
    const price = simulationMoneyInput(values.price), cost = simulationMoneyInput(values.cost), newPrice = simulationMoneyInput(values.newPrice), newCost = simulationMoneyInput(values.newCost);
    const variable = simulationMoneyInput(values.variable), spend = simulationMoneyInput(values.spend);
    const qty = simulationQuantityInput(values.qty), low = simulationQuantityInput(values.low), middle = simulationQuantityInput(values.middle), high = simulationQuantityInput(values.high);
    if ([price, cost, newPrice, newCost, variable, spend, qty, low, middle, high].some(v => v == null)) {
      setError('Informe valores de 0 a 1.000.000, dinheiro com até duas casas decimais e quantidades inteiras. Custo desconhecido precisa ser informado como hipótese.'); return;
    }
    const payload: MenuSimulationInput = { preco_atual: price!, custo_atual: cost!, preco_proposto: newPrice!, custo_proposto: newCost!, despesa_variavel_unitaria: variable!, gasto_acao: spend!, quantidade_atual: qty!, quantidades: [low!, middle!, high!] };
    const controller = new AbortController(); request.current = controller; setBusy(true);
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
    try {
      const response = await fetch(`${apiBaseUrl}/relatorios/inteligencia-cardapio/simulacoes`, {
        method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 403 ? 'Este acesso não permite calcular relatórios avançados.' : 'Não foi possível calcular. Confira os dados e tente novamente.');
      const next: MenuSimulationResult = await response.json();
      if (!controller.signal.aborted) setResult(next);
    } catch (err) {
      if (timedOut) setError('O cálculo demorou mais que o esperado. Tente novamente.');
      else if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Não foi possível calcular.');
    } finally {
      window.clearTimeout(timer);
      if (!controller.signal.aborted || timedOut) setBusy(false);
    }
  };
  return <div className="space-y-5">
    <div className="rounded-2xl border border-koma-border bg-koma-panel p-4 text-xs text-koma-muted">
      <strong className="text-koma-foreground">Compare antes de mudar preço ou custo</strong>
      <p className="mt-2">Valores preenchidos na seleção usam preço das unidades cobertas e ingredientes atuais. Onde não há composição coberta, o preço é do catálogo e o custo precisa ser revisado. Os campos são hipóteses editáveis; não alteram o restaurante.</p>
      <p className="mt-2">Não é lucro: impostos, taxas, adicionais e despesas fixas não informados ficam fora. Ao editar os dados, o resultado anterior é descartado.</p>
    </div>
    <form onSubmit={submit} className="space-y-5">
      <label className="block text-sm font-semibold text-koma-foreground">Produto de referência
        <select value={productId} onChange={e => choose(e.target.value)} className="mt-2 w-full rounded-xl border border-koma-border bg-koma-input p-3 text-sm">
          <option value="">Hipótese manual</option>{report.produtos.map(p => <option key={p.produto_id} value={p.produto_id}>{p.nome}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields.map(({ key, label, money }) => <label key={key} className="text-xs font-semibold text-koma-foreground">{label}
        <input value={values[key]} onChange={e => update(key, e.target.value)} inputMode={money ? 'decimal' : 'numeric'} required maxLength={16} className="mt-2 w-full rounded-xl border border-koma-border bg-koma-input p-3 text-sm font-normal" />
      </label>)}</div>
      <fieldset className="rounded-2xl border border-koma-border p-4"><legend className="px-2 text-sm font-semibold text-koma-foreground">Volumes hipotéticos para comparar</legend>
        <p className="mb-3 text-xs text-koma-muted">Edite os três volumes. Todos começam no volume de referência; nenhuma reação dos clientes é prevista.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{([{ key: 'low', label: 'Cenário conservador (unidades)' }, { key: 'middle', label: 'Cenário intermediário (unidades)' }, { key: 'high', label: 'Cenário otimista (unidades)' }] as const).map(f => <label key={f.key} className="text-xs text-koma-foreground">{f.label}<input value={values[f.key]} onChange={e => update(f.key, e.target.value)} inputMode="numeric" required maxLength={7} className="mt-2 w-full rounded-xl border border-koma-border bg-koma-input p-3" /></label>)}</div>
      </fieldset>
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      <button type="submit" disabled={busy} className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Calculando…' : 'Calcular cenários'}</button>
    </form>
    {result && <section aria-label="Resultado da simulação" className="space-y-4 rounded-2xl border border-koma-border bg-koma-panel p-5" aria-live="polite">
      <h3 className="text-base font-semibold text-koma-foreground">Resultado hipotético</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[
        ['Margem por unidade: antes → proposta', `${menuMoney(result.margem_atual)} → ${menuMoney(result.margem_proposta)}`],
        ['Contribuição de referência', menuMoney(result.contribuicao_referencia)],
        ['Unidades para preservar a contribuição', result.unidades_para_preservar ?? 'Não calculável'],
      ].map(([label, value]) => <div key={label} className="rounded-xl bg-koma-raised p-4"><p className="text-xs text-koma-muted">{label}</p><strong className="mt-2 block text-lg text-koma-foreground">{value}</strong></div>)}</div>
      {result.vendas_que_pode_perder != null && <p className="text-sm text-koma-foreground">{result.vendas_adicionais_necessarias ? `Precisa de ${result.vendas_adicionais_necessarias} vendas adicionais para preservar a contribuição.` : `Pode perder até ${result.vendas_que_pode_perder} vendas inteiras sob estes custos.`} Para superar: {result.unidades_para_superar} unidades.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{result.cenarios.map((c, index) => <div key={index} className="rounded-xl border border-koma-border p-4 text-sm text-koma-foreground"><strong>{['Conservador', 'Intermediário', 'Otimista'][index]}</strong><p className="mt-2">{c.quantidade} unidades · {menuMoney(c.contribuicao)}</p><p className="text-xs text-koma-muted">Diferença: {menuMoney(c.diferenca)}</p></div>)}</div>
      {result.avisos.map(w => <p key={w} className="text-xs text-koma-muted">{w}</p>)}
    </section>}
  </div>;
}
