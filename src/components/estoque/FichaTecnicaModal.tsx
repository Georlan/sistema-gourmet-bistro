import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Link2, Plus, Save, Trash2, X } from 'lucide-react';
import type { B8OpcaoModificador, B8SubReceita } from '../../contracts/b8Contracts';
import type { FichaTecnicaProduto, Insumo, Product } from '../../types';
import { snapshotFetch as fetch } from '../../utils/snapshotFetch';

interface FichaTecnicaModalProps {
  produtos: Product[];
  insumos: Insumo[];
  fichas: FichaTecnicaProduto[];
  apiBaseUrl?: string;
  authHeaders?: Record<string, string>;
  showToast?: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  onClose: () => void;
  onSave: (produtoId: string, itens: Array<{ insumo_id: string; quantidade: number }>) => Promise<boolean>;
}

interface UniversalRow {
  insumo_id: string | null;
  sub_receita_id: string | null;
  quantidade: number;
  unidade_medida: string;
  papel: string;
}

export function FichaTecnicaModal({
  produtos,
  insumos,
  fichas,
  apiBaseUrl,
  authHeaders,
  showToast,
  onClose,
  onSave,
}: FichaTecnicaModalProps) {
  const orderedProducts = useMemo(() => [...produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [produtos]);
  const [entidadeTipo, setEntidadeTipo] = useState<'produto' | 'opcao_modificador'>('produto');
  const [entidadeId, setEntidadeId] = useState(orderedProducts[0]?.id || '');
  const [opcoesMod, setOpcoesMod] = useState<B8OpcaoModificador[]>([]);
  const [subReceitas, setSubReceitas] = useState<B8SubReceita[]>([]);
  const [rows, setRows] = useState<UniversalRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!apiBaseUrl || !authHeaders) return;
    let active = true;
    void Promise.all([
      fetch(`${apiBaseUrl}/b8/supply/modificadores-opcoes`, { headers: authHeaders }),
      fetch(`${apiBaseUrl}/b8/supply/sub-receitas`, { headers: authHeaders }),
    ]).then(async ([mRes, srRes]) => {
      if (!active) return;
      if (mRes.ok) {
        const list = await mRes.json();
        setOpcoesMod(Array.isArray(list) ? list : []);
      }
      if (srRes.ok) {
        const list = await srRes.json();
        setSubReceitas(Array.isArray(list) ? list : []);
      }
    });
    return () => {
      active = false;
    };
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    if (entidadeTipo === 'produto' && !orderedProducts.some((p) => p.id === entidadeId)) {
      setEntidadeId(orderedProducts[0]?.id || '');
    } else if (entidadeTipo === 'opcao_modificador' && !opcoesMod.some((o) => o.id === entidadeId)) {
      setEntidadeId(opcoesMod[0]?.id || '');
    }
  }, [entidadeId, entidadeTipo, opcoesMod, orderedProducts]);

  useEffect(() => {
    if (!entidadeId) {
      setRows([]);
      return;
    }
    let active = true;
    const loadUniversal = async () => {
      if (apiBaseUrl && authHeaders) {
        const res = await fetch(`${apiBaseUrl}/b8/supply/fichas/${entidadeTipo}/${entidadeId}`, { headers: authHeaders });
        if (res.ok && active) {
          const data = await res.json();
          const comps = Array.isArray(data?.componentes) ? data.componentes : [];
          if (comps.length > 0) {
            setRows(
              comps.map((c: any) => ({
                insumo_id: c.insumo_id || null,
                sub_receita_id: c.sub_receita_id || null,
                quantidade: Number(c.quantidade || 1),
                unidade_medida: c.unidade_medida || 'un',
                papel: c.papel || (entidadeTipo === 'opcao_modificador' ? 'complemento' : 'ingrediente'),
              })),
            );
            return;
          }
        }
      }
      if (!active) return;
      if (entidadeTipo === 'produto') {
        const ficha = fichas.find((item) => item.produto_id === entidadeId);
        setRows(
          (ficha?.itens || []).map((item) => ({
            insumo_id: item.insumo_id,
            sub_receita_id: null,
            quantidade: Number(item.quantidade || 1),
            unidade_medida: item.insumo?.unidade_medida || 'un',
            papel: 'ingrediente',
          })),
        );
      } else {
        setRows([]);
      }
    };
    void loadUniversal();
    return () => {
      active = false;
    };
  }, [apiBaseUrl, authHeaders, entidadeId, entidadeTipo, fichas]);

  const selectedProduct = entidadeTipo === 'produto' ? orderedProducts.find((p) => p.id === entidadeId) : undefined;
  const selectedOpt = entidadeTipo === 'opcao_modificador' ? opcoesMod.find((o) => o.id === entidadeId) : undefined;

  const costSummary = useMemo(() => {
    let total = 0;
    let complete = rows.length > 0;
    for (const r of rows) {
      if (r.insumo_id) {
        const ins = insumos.find((c) => c.id === r.insumo_id);
        const unit = Number(ins?.preco_medio_custo || 0);
        if (unit <= 0) complete = false;
        else total += Number(r.quantidade || 0) * unit;
      } else if (r.sub_receita_id) {
        const sr = subReceitas.find((s) => s.id === r.sub_receita_id);
        if (!sr || !sr.custo_completo || sr.custo_unitario_estimado === null) complete = false;
        else total += Number(r.quantidade || 0) * Number(sr.custo_unitario_estimado);
      }
    }
    const salePrice = selectedProduct
      ? Number(selectedProduct.preco_promocional ?? selectedProduct.preco ?? 0)
      : Number(selectedOpt?.preco ?? 0);
    const margin = complete && salePrice > 0 ? salePrice - total : null;
    const marginPct = margin !== null && salePrice > 0 ? (margin / salePrice) * 100 : null;
    return { total, complete, salePrice, margin, marginPct };
  }, [insumos, rows, selectedOpt, selectedProduct, subReceitas]);

  const addInsumoRow = () => {
    const candidate = insumos[0];
    if (!candidate) return;
    setRows((cur) => [
      ...cur,
      {
        insumo_id: candidate.id,
        sub_receita_id: null,
        quantidade: 1,
        unidade_medida: candidate.unidade_medida || 'un',
        papel: entidadeTipo === 'opcao_modificador' ? 'complemento' : 'ingrediente',
      },
    ]);
  };

  const addSubReceitaRow = () => {
    const candidate = subReceitas[0];
    if (!candidate) return;
    setRows((cur) => [
      ...cur,
      {
        insumo_id: null,
        sub_receita_id: candidate.id,
        quantidade: 1,
        unidade_medida: candidate.unidade_rendimento || 'kg',
        papel: 'ingrediente',
      },
    ]);
  };

  const handleSave = async () => {
    if (!entidadeId || rows.some((r) => (!r.insumo_id && !r.sub_receita_id) || Number(r.quantidade) <= 0)) return;
    setSaving(true);
    try {
      if (apiBaseUrl && authHeaders) {
        const res = await fetch(`${apiBaseUrl}/b8/supply/fichas/${entidadeTipo}/${entidadeId}`, {
          method: 'PUT',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            componentes: rows.map((r) => ({
              insumo_id: r.insumo_id,
              sub_receita_id: r.sub_receita_id,
              quantidade: Number(r.quantidade),
              unidade_medida: r.unidade_medida || 'un',
              papel: r.papel || 'ingrediente',
            })),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          showToast?.(err.detail || 'Erro ao salvar ficha técnica.', 'error');
          return;
        }
      }
      if (entidadeTipo === 'produto' && rows.every((r) => r.insumo_id !== null)) {
        await onSave(
          entidadeId,
          rows.map((r) => ({ insumo_id: String(r.insumo_id), quantidade: Number(r.quantidade) })),
        );
      } else {
        showToast?.('Ficha técnica universal salva.', 'success');
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-3" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-koma-border bg-koma-panel shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="recipe-title">
        <header className="flex items-start justify-between gap-4 border-b border-koma-border px-4 py-3.5 sm:px-5">
          <div>
            <p className="orders-eyebrow"><span /> INTEGRAÇÃO COM VENDAS E CUSTO HISTÓRICO</p>
            <h2 id="recipe-title" className="mt-1 flex items-center gap-2 text-base font-bold text-koma-foreground"><Link2 size={17} className="text-emerald-600 dark:text-emerald-300" /> Fichas técnicas universais</h2>
            <p className="mt-1 text-[10px] text-koma-muted">Vincule ingredientes, embalagens e sub-receitas a produtos ou complementos. Alterações não reescrevem vendas passadas.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-koma-muted hover:bg-koma-raised hover:text-koma-foreground" aria-label="Fechar fichas técnicas"><X size={17} /></button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setEntidadeTipo('produto')} className={entidadeTipo === 'produto' ? 'koma-btn-success' : 'koma-btn-secondary'}>
              Produtos ({orderedProducts.length})
            </button>
            <button type="button" onClick={() => setEntidadeTipo('opcao_modificador')} className={entidadeTipo === 'opcao_modificador' ? 'koma-btn-success' : 'koma-btn-secondary'}>
              Modificadores / Complementos ({opcoesMod.length})
            </button>
          </div>

          {insumos.length === 0 ? (
            <div className="rounded-xl border border-dashed border-koma-border p-6 text-center">
              <strong className="text-sm text-koma-foreground">Cadastre ingredientes primeiro</strong>
              <p className="mt-1 text-[10px] text-koma-muted">A ficha técnica precisa de ao menos um ingrediente cadastrado.</p>
            </div>
          ) : (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[9px] font-extrabold uppercase tracking-wider text-koma-muted">
                  {entidadeTipo === 'produto' ? 'Produto vendido' : 'Opção de modificador / complemento'}
                </span>
                <select className="koma-toolbar__select w-full" value={entidadeId} onChange={(e) => setEntidadeId(e.target.value)} aria-label="Item da ficha técnica">
                  {entidadeTipo === 'produto'
                    ? orderedProducts.map((product) => (
                        <option key={product.id} value={product.id}>{product.nome}{product.ativo === false ? ' · pausado' : ''}</option>
                      ))
                    : opcoesMod.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.grupo_nome} → {opt.nome}</option>
                      ))}
                </select>
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-xs text-koma-foreground">Componentes da composição</strong>
                <div className="flex gap-2">
                  <button type="button" onClick={addInsumoRow} className="koma-btn-secondary"><Plus size={13} /> Ingrediente / Embalagem</button>
                  {subReceitas.length > 0 && (
                    <button type="button" onClick={addSubReceitaRow} className="koma-btn-secondary"><Plus size={13} /> Sub-receita</button>
                  )}
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-koma-border p-5 text-center text-[11px] text-koma-muted">
                  Nenhum componente vinculado ainda. Adicione um ingrediente, embalagem ou sub-receita.
                </div>
              ) : (
                <div className="space-y-2">
                  {rows.map((row, index) => {
                    const isSub = Boolean(row.sub_receita_id);
                    return (
                      <div key={index} className="grid gap-2 rounded-xl border border-koma-border bg-koma-canvas/40 p-3 sm:grid-cols-[minmax(0,1fr)_7.5rem_6.5rem_2.25rem] sm:items-end">
                        <label>
                          <span className="mb-1 block text-[9px] font-bold uppercase text-koma-muted">{isSub ? 'Sub-receita' : 'Ingrediente'}</span>
                          {isSub ? (
                            <select
                              className="koma-toolbar__select w-full"
                              value={row.sub_receita_id || ''}
                              onChange={(e) => setRows((cur) => cur.map((c, i) => i === index ? { ...c, sub_receita_id: e.target.value } : c))}
                            >
                              {subReceitas.map((sr) => <option key={sr.id} value={sr.id}>{sr.nome}</option>)}
                            </select>
                          ) : (
                            <select
                              className="koma-toolbar__select w-full"
                              value={row.insumo_id || ''}
                              onChange={(e) => {
                                const ins = insumos.find((x) => x.id === e.target.value);
                                setRows((cur) => cur.map((c, i) => i === index ? { ...c, insumo_id: e.target.value, unidade_medida: ins?.unidade_medida || 'un' } : c));
                              }}
                            >
                              {insumos.map((ins) => <option key={ins.id} value={ins.id}>{ins.nome} ({ins.unidade_medida})</option>)}
                            </select>
                          )}
                        </label>
                        <label>
                          <span className="mb-1 block text-[9px] font-bold uppercase text-koma-muted">Papel</span>
                          <select
                            className="koma-toolbar__select w-full"
                            value={row.papel}
                            onChange={(e) => setRows((cur) => cur.map((c, i) => i === index ? { ...c, papel: e.target.value } : c))}
                          >
                            <option value="ingrediente">Ingrediente</option>
                            <option value="complemento">Complemento</option>
                            <option value="embalagem">Embalagem</option>
                          </select>
                        </label>
                        <label>
                          <span className="mb-1 block text-[9px] font-bold uppercase text-koma-muted">Qtd ({row.unidade_medida})</span>
                          <input
                            className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-2.5 font-mono text-[10px] text-koma-foreground"
                            type="number"
                            min="0.0001"
                            step="0.0001"
                            value={row.quantidade}
                            onChange={(e) => setRows((cur) => cur.map((c, i) => i === index ? { ...c, quantidade: Number(e.target.value) } : c))}
                          />
                        </label>
                        <button type="button" onClick={() => setRows((cur) => cur.filter((_, i) => i !== index))} className="flex min-h-9 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-500/10 dark:text-rose-300" aria-label="Remover componente"><Trash2 size={14} /></button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-col gap-1 rounded-xl border border-koma-border bg-koma-raised/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-[11px] text-koma-muted">
                  {costSummary.complete ? (
                    <span>
                      Custo estimado: <strong className="font-mono text-koma-foreground">R$ {costSummary.total.toFixed(2)}</strong>
                      {costSummary.margin !== null && (
                        <> · Margem de contribuição: <strong className="font-mono text-emerald-700 dark:text-emerald-300">R$ {costSummary.margin.toFixed(2)} ({costSummary.marginPct?.toFixed(1)}%)</strong></>
                      )}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                      <AlertTriangle size={13} /> Custo incompleto (insumo/sub-receita sem custo conhecido — não tratado como zero)
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-koma-border px-4 py-3 sm:px-5">
          <button type="button" onClick={onClose} className="koma-btn-secondary">Cancelar</button>
          <button type="button" onClick={() => void handleSave()} disabled={saving || !entidadeId || insumos.length === 0} className="koma-btn-success disabled:cursor-wait disabled:opacity-50"><Save size={14} /> {saving ? 'Salvando…' : 'Salvar ficha'}</button>
        </footer>
      </section>
    </div>
  );
}
