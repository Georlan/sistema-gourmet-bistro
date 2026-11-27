import { useCallback, useEffect, useState } from 'react';
import { ChefHat, Play, Plus, RefreshCw, Scale } from 'lucide-react';
import type { B8BuffetLote, B8OrdemProducao, B8SubReceita } from '../../contracts/b8Contracts';
import type { Insumo } from '../../types';
import { snapshotFetch as fetch } from '../../utils/snapshotFetch';

interface EstoqueProducaoTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  insumos: Insumo[];
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  onChanged: () => void;
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function EstoqueProducaoTab({
  apiBaseUrl,
  authHeaders,
  insumos,
  showToast,
  onChanged,
}: EstoqueProducaoTabProps) {
  const [subReceitas, setSubReceitas] = useState<B8SubReceita[]>([]);
  const [ordens, setOrdens] = useState<B8OrdemProducao[]>([]);
  const [buffet, setBuffet] = useState<B8BuffetLote[]>([]);
  const [loading, setLoading] = useState(true);

  // Nova sub-receita (com múltiplos ingredientes!)
  const [srNome, setSrNome] = useState('');
  const [srUnidade, setSrUnidade] = useState('kg');
  const [srRendimento, setSrRendimento] = useState('1');
  const [srInsumoSaidaId, setSrInsumoSaidaId] = useState('');
  const [srIngredientes, setSrIngredientes] = useState<Array<{ insumo_id: string; quantidade: string; perda_tecnica_pct: string }>>([]);

  // Nova ordem de produção (executa com quantidade planejada e produzida real)
  const [opSubId, setOpSubId] = useState('');
  const [opPlanejada, setOpPlanejada] = useState('1');
  const [opProduzida, setOpProduzida] = useState('1');
  const [opPerda, setOpPerda] = useState('0');
  const [opValidade, setOpValidade] = useState('');

  // Buffet
  const [bfData, setBfData] = useState(todayIso);
  const [bfNome, setBfNome] = useState('');
  const [bfProd, setBfProd] = useState('');
  const [bfRep, setBfRep] = useState('0');
  const [bfSobra, setBfSobra] = useState('0');
  const [bfDesc, setBfDesc] = useState('0');
  const [bfCusto, setBfCusto] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [srRes, opRes, bfRes] = await Promise.all([
        fetch(`${apiBaseUrl}/b8/supply/sub-receitas`, { headers: authHeaders }),
        fetch(`${apiBaseUrl}/b8/supply/ordens-producao`, { headers: authHeaders }),
        fetch(`${apiBaseUrl}/b8/supply/buffet-lotes`, { headers: authHeaders }),
      ]);
      if (srRes.ok) {
        const list = await srRes.json();
        const arr: B8SubReceita[] = Array.isArray(list) ? list : [];
        setSubReceitas(arr);
        if (!opSubId && arr[0]?.id) setOpSubId(arr[0].id);
      }
      if (opRes.ok) {
        const list = await opRes.json();
        setOrdens(Array.isArray(list) ? list : []);
      }
      if (bfRes.ok) {
        const list = await bfRes.json();
        setBuffet(Array.isArray(list) ? list : []);
      }
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, authHeaders, opSubId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (srIngredientes.length === 0 && insumos[0]?.id) {
      setSrIngredientes([{ insumo_id: insumos[0].id, quantidade: '1', perda_tecnica_pct: '0' }]);
    }
  }, [insumos, srIngredientes.length]);

  const handleCreateSubReceita = async (e: React.FormEvent) => {
    e.preventDefault();
    const validIngs = srIngredientes
      .filter((i) => i.insumo_id && Number(i.quantidade) > 0)
      .map((i) => ({
        insumo_id: i.insumo_id,
        quantidade: Number(i.quantidade),
        unidade_medida: insumos.find((ins) => ins.id === i.insumo_id)?.unidade_medida || 'un',
        perda_tecnica_pct: Number(i.perda_tecnica_pct) || 0,
      }));
    if (!srNome.trim() || validIngs.length === 0 || Number(srRendimento) <= 0) {
      showToast('Informe nome, rendimento esperado e ao menos um ingrediente.', 'warning');
      return;
    }
    const res = await fetch(`${apiBaseUrl}/b8/supply/sub-receitas`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: srNome.trim(),
        unidade_rendimento: srUnidade,
        rendimento_esperado: Number(srRendimento),
        insumo_saida_id: srInsumoSaidaId || null,
        ingredientes: validIngs,
      }),
    });
    if (res.ok) {
      setSrNome('');
      showToast('Sub-receita criada.', 'success');
      await loadAll();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || 'Erro ao criar sub-receita.', 'error');
    }
  };

  const handleExecutarOrdem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opSubId || Number(opPlanejada) <= 0 || Number(opProduzida) <= 0) {
      showToast('Informe sub-receita, quantidade planejada e quantidade efetivamente produzida.', 'warning');
      return;
    }
    const res = await fetch(`${apiBaseUrl}/b8/supply/ordens-producao`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sub_receita_id: opSubId,
        quantidade_planejada: Number(opPlanejada),
        quantidade_produzida: Number(opProduzida),
        perda_producao: Number(opPerda) || 0,
        data_validade: opValidade || null,
      }),
    });
    if (res.ok) {
      showToast('Produção executada: matéria-prima baixada e lote gerado.', 'success');
      await loadAll();
      onChanged();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || 'Erro ao executar ordem de produção.', 'error');
    }
  };

  const handleRegistrarBuffet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bfNome.trim() || Number(bfProd) < 0) {
      showToast('Informe o nome da preparação do buffet.', 'warning');
      return;
    }
    const res = await fetch(`${apiBaseUrl}/b8/supply/buffet-lotes`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data_operacional: bfData,
        nome_preparacao: bfNome.trim(),
        unidade_medida: 'kg',
        quantidade_produzida: Number(bfProd) || 0,
        quantidade_reposicao: Number(bfRep) || 0,
        sobra: Number(bfSobra) || 0,
        descarte: Number(bfDesc) || 0,
        custo_lote: bfCusto ? Number(bfCusto) : null,
      }),
    });
    if (res.ok) {
      setBfNome('');
      setBfProd('');
      setBfRep('0');
      setBfSobra('0');
      setBfDesc('0');
      setBfCusto('');
      showToast('Lote de buffet registrado.', 'success');
      await loadAll();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || 'Erro ao registrar lote de buffet.', 'error');
    }
  };

  return (
    <div className="space-y-4 text-left animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-koma-foreground">Produção Interna, Sub-receitas e Buffet</h3>
          <p className="text-[11px] text-koma-muted">Controle preparo prévio, rendimento real e lotes por peso sem duplicar CMV.</p>
        </div>
        <button type="button" onClick={() => void loadAll()} disabled={loading} className="koma-btn-secondary">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={handleCreateSubReceita} className="space-y-3 rounded-2xl border border-koma-border bg-koma-panel p-4">
          <h4 className="flex items-center gap-2 text-xs font-bold uppercase text-koma-foreground">
            <ChefHat size={14} className="text-emerald-600 dark:text-emerald-300" /> Nova Sub-receita
          </h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <input placeholder="Nome (ex.: Molho da casa)" value={srNome} onChange={(e) => setSrNome(e.target.value)} className="min-h-9 rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
            <div className="flex gap-2">
              <input type="number" step="0.01" min="0.01" placeholder="Rendimento" value={srRendimento} onChange={(e) => setSrRendimento(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
              <select value={srUnidade} onChange={(e) => setSrUnidade(e.target.value)} className="koma-toolbar__select w-20">
                <option value="kg">kg</option>
                <option value="L">L</option>
                <option value="un">un</option>
              </select>
            </div>
            <select value={srInsumoSaidaId} onChange={(e) => setSrInsumoSaidaId(e.target.value)} className="koma-toolbar__select sm:col-span-2">
              <option value="">Insumo de saída (opcional para gerar lote no estoque)</option>
              {insumos.map((i) => <option key={i.id} value={i.id}>Gera lote de: {i.nome} ({i.unidade_medida})</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            {srIngredientes.map((ing, idx) => (
              <div key={idx} className="flex gap-2">
                <select
                  value={ing.insumo_id}
                  onChange={(e) => setSrIngredientes((cur) => cur.map((r, i) => i === idx ? { ...r, insumo_id: e.target.value } : r))}
                  className="koma-toolbar__select flex-1"
                >
                  {insumos.map((i) => <option key={i.id} value={i.id}>{i.nome} ({i.unidade_medida})</option>)}
                </select>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  placeholder="Qtd"
                  value={ing.quantidade}
                  onChange={(e) => setSrIngredientes((cur) => cur.map((r, i) => i === idx ? { ...r, quantidade: e.target.value } : r))}
                  className="min-h-9 w-24 rounded-xl border border-koma-border bg-koma-input px-2 font-mono text-xs text-koma-foreground"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => insumos[0]?.id && setSrIngredientes((cur) => [...cur, { insumo_id: insumos[0].id, quantidade: '1', perda_tecnica_pct: '0' }])}
              className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
            >
              + Adicionar ingrediente
            </button>
          </div>
          <button type="submit" className="koma-btn-success"><Plus size={14} /> Salvar sub-receita</button>
        </form>

        <form onSubmit={handleRegistrarBuffet} className="space-y-3 rounded-2xl border border-koma-border bg-koma-panel p-4">
          <h4 className="flex items-center gap-2 text-xs font-bold uppercase text-koma-foreground">
            <Scale size={14} className="text-emerald-600 dark:text-emerald-300" /> Lote de Buffet / Peso
          </h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <input placeholder="Preparação (ex.: Buffet Almoço)" value={bfNome} onChange={(e) => setBfNome(e.target.value)} className="min-h-9 rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
            <input type="date" value={bfData} onChange={(e) => setBfData(e.target.value)} className="min-h-9 rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
            <input type="number" step="0.01" min="0" placeholder="Produzido (kg)" value={bfProd} onChange={(e) => setBfProd(e.target.value)} className="min-h-9 rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
            <input type="number" step="0.01" min="0" placeholder="Reposição (kg)" value={bfRep} onChange={(e) => setBfRep(e.target.value)} className="min-h-9 rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
            <input type="number" step="0.01" min="0" placeholder="Sobra (kg)" value={bfSobra} onChange={(e) => setBfSobra(e.target.value)} className="min-h-9 rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
            <input type="number" step="0.01" min="0" placeholder="Descarte (kg)" value={bfDesc} onChange={(e) => setBfDesc(e.target.value)} className="min-h-9 rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
            <input type="number" step="0.01" min="0" placeholder="Custo total do lote (R$)" value={bfCusto} onChange={(e) => setBfCusto(e.target.value)} className="min-h-9 rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground sm:col-span-2" />
          </div>
          <button type="submit" className="koma-btn-secondary">Registrar lote de buffet</button>
        </form>
      </div>

      {subReceitas.length > 0 && (
        <form onSubmit={handleExecutarOrdem} className="grid gap-3 rounded-2xl border border-koma-border bg-koma-panel p-4 text-xs sm:grid-cols-2 lg:grid-cols-6 sm:items-end">
          <label className="lg:col-span-2">
            <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Executar Ordem de Produção</span>
            <select value={opSubId} onChange={(e) => setOpSubId(e.target.value)} className="koma-toolbar__select w-full">
              {subReceitas.map((sr) => (
                <option key={sr.id} value={sr.id}>
                  {sr.nome} ({sr.rendimento_esperado} {sr.unidade_rendimento})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Planejado</span>
            <input type="number" step="0.01" min="0.01" value={opPlanejada} onChange={(e) => setOpPlanejada(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
          </label>
          <label>
            <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Produzido real *</span>
            <input type="number" step="0.01" min="0.01" value={opProduzida} onChange={(e) => setOpProduzida(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
          </label>
          <label>
            <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Validade lote</span>
            <input type="date" value={opValidade} onChange={(e) => setOpValidade(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
          </label>
          <button type="submit" className="koma-btn-success"><Play size={13} /> Executar produção</button>
        </form>
      )}

      {ordens.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel">
          <header className="border-b border-koma-border bg-koma-raised/40 px-4 py-2.5 text-xs font-bold uppercase text-koma-foreground">
            Ordens de Produção Executadas
          </header>
          <div className="divide-y divide-koma-border text-xs">
            {ordens.map((op) => (
              <div key={op.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div>
                  <strong className="text-koma-foreground">{op.sub_receita_nome || op.sub_receita_id}</strong>
                  <span className="ml-2 text-koma-muted">
                    Planejado: {op.quantidade_planejada} · Produzido: <strong>{op.quantidade_produzida}</strong>
                    {op.rendimento_pct !== null && Number.isFinite(op.rendimento_pct) ? ` (${op.rendimento_pct}%)` : ''}
                    {' '}· Status: {op.status}
                    {op.concluida_em ? ` · ${op.concluida_em.slice(0, 10)}` : ''}
                  </span>
                </div>
                {op.custo_unitario_produzido !== null && Number.isFinite(op.custo_unitario_produzido) ? (
                  <span className="font-mono font-semibold text-koma-foreground">
                    Custo: {currency.format(op.custo_unitario_produzido)}/un
                    {op.custo_total_insumos !== null && Number.isFinite(op.custo_total_insumos)
                      ? ` (Total ${currency.format(op.custo_total_insumos)})`
                      : ''}
                  </span>
                ) : (
                  <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    Custo desconhecido
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {buffet.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel">
          <header className="border-b border-koma-border bg-koma-raised/40 px-4 py-2.5 text-xs font-bold uppercase text-koma-foreground">
            Registros de Buffet / Peso
          </header>
          <div className="divide-y divide-koma-border text-xs">
            {buffet.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div>
                  <strong className="text-koma-foreground">{b.nome_preparacao}</strong>
                  <span className="ml-2 text-koma-muted">{b.data_operacional}</span>
                </div>
                <span className="font-mono text-koma-muted">
                  Prod: {b.quantidade_produzida} {b.unidade_medida} · Rep: {b.quantidade_reposicao} · Sobra: {b.sobra} · Desc: {b.descarte}
                  {b.custo_lote !== null ? ` · Custo: ${currency.format(b.custo_lote)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
