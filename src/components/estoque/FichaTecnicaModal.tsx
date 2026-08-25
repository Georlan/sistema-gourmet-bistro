import { useEffect, useMemo, useState } from 'react';
import { Link2, Plus, Save, Trash2, X } from 'lucide-react';
import type { FichaTecnicaItem, FichaTecnicaProduto, Insumo, Product } from '../../types';

interface FichaTecnicaModalProps {
  produtos: Product[];
  insumos: Insumo[];
  fichas: FichaTecnicaProduto[];
  onClose: () => void;
  onSave: (produtoId: string, itens: Array<{ insumo_id: string; quantidade: number }>) => Promise<boolean>;
}

export function FichaTecnicaModal({ produtos, insumos, fichas, onClose, onSave }: FichaTecnicaModalProps) {
  const orderedProducts = useMemo(() => [...produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [produtos]);
  const [produtoId, setProdutoId] = useState(orderedProducts[0]?.id || '');
  const [items, setItems] = useState<FichaTecnicaItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ficha = fichas.find(item => item.produto_id === produtoId);
    setItems((ficha?.itens || []).map(item => ({ ...item })));
  }, [fichas, produtoId]);

  const selectedProduct = orderedProducts.find(product => product.id === produtoId);
  const availableForNew = insumos.find(insumo => !items.some(item => item.insumo_id === insumo.id));
  const estimatedCost = items.reduce((sum, item) => {
    const insumo = insumos.find(candidate => candidate.id === item.insumo_id);
    return sum + Number(item.quantidade || 0) * Number(insumo?.preco_medio_custo || 0);
  }, 0);

  const handleSave = async () => {
    if (!produtoId || items.some(item => !item.insumo_id || Number(item.quantidade) <= 0)) return;
    setSaving(true);
    try {
      await onSave(produtoId, items.map(item => ({ insumo_id: item.insumo_id, quantidade: Number(item.quantidade) })));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-koma-border bg-koma-panel shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="recipe-title">
        <header className="flex items-start justify-between gap-4 border-b border-koma-border px-4 py-3.5 sm:px-5">
          <div>
            <p className="orders-eyebrow"><span /> INTEGRAÇÃO COM VENDAS</p>
            <h2 id="recipe-title" className="mt-1 flex items-center gap-2 text-base font-bold text-koma-foreground"><Link2 size={17} className="text-emerald-600 dark:text-emerald-300" /> Fichas técnicas</h2>
            <p className="mt-1 text-[10px] text-koma-muted">Informe quanto cada venda consome. A baixa e o estorno por cancelamento serão automáticos.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-koma-muted hover:bg-koma-raised hover:text-koma-foreground" aria-label="Fechar fichas técnicas"><X size={17} /></button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-5">
          {orderedProducts.length === 0 || insumos.length === 0 ? (
            <div className="rounded-xl border border-dashed border-koma-border p-6 text-center">
              <strong className="text-sm text-koma-foreground">Cadastre produtos e ingredientes primeiro</strong>
              <p className="mt-1 text-[10px] text-koma-muted">A ficha técnica precisa de ao menos um produto e um ingrediente.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[9px] font-extrabold uppercase tracking-wider text-koma-muted">Produto vendido</span>
                <select className="koma-toolbar__select w-full" value={produtoId} onChange={event => setProdutoId(event.target.value)} aria-label="Produto da ficha técnica">
                  {orderedProducts.map(product => <option key={product.id} value={product.id}>{product.nome}{product.ativo === false ? ' · pausado' : ''}</option>)}
                </select>
              </label>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <strong className="text-xs text-koma-foreground">Ingredientes por unidade</strong>
                  <p className="text-[9px] text-koma-muted">Use a mesma unidade cadastrada no ingrediente.</p>
                </div>
                <button type="button" disabled={!availableForNew} onClick={() => availableForNew && setItems(current => [...current, { insumo_id: availableForNew.id, quantidade: 1, insumo: availableForNew }])} className="koma-btn-secondary disabled:cursor-not-allowed disabled:opacity-40"><Plus size={13} /> Adicionar</button>
              </div>

              {items.length === 0 ? (
                <button type="button" onClick={() => availableForNew && setItems([{ insumo_id: availableForNew.id, quantidade: 1, insumo: availableForNew }])} className="w-full rounded-xl border border-dashed border-koma-border p-5 text-center text-[10px] font-semibold text-koma-muted transition-colors hover:border-emerald-500/40 hover:text-koma-foreground">Nenhum ingrediente vinculado. Clique para adicionar o primeiro.</button>
              ) : (
                <div className="space-y-2">
                  {items.map((item, index) => {
                    const insumo = insumos.find(candidate => candidate.id === item.insumo_id);
                    return (
                      <div key={`${item.insumo_id}-${index}`} className="grid gap-2 rounded-xl border border-koma-border bg-koma-canvas/40 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_2.25rem] sm:items-end">
                        <label>
                          <span className="mb-1 block text-[9px] font-bold uppercase tracking-wide text-koma-muted">Ingrediente</span>
                          <select className="koma-toolbar__select w-full" value={item.insumo_id} onChange={event => setItems(current => current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, insumo_id: event.target.value } : candidate))}>
                            {insumos.map(candidate => <option key={candidate.id} value={candidate.id} disabled={items.some((existing, existingIndex) => existingIndex !== index && existing.insumo_id === candidate.id)}>{candidate.nome}</option>)}
                          </select>
                        </label>
                        <label>
                          <span className="mb-1 block text-[9px] font-bold uppercase tracking-wide text-koma-muted">Quantidade ({insumo?.unidade_medida || 'un'})</span>
                          <input className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-[10px] text-koma-foreground" type="number" min="0.0001" step="0.0001" value={item.quantidade} onChange={event => setItems(current => current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, quantidade: Number(event.target.value) } : candidate))} />
                        </label>
                        <button type="button" onClick={() => setItems(current => current.filter((_, candidateIndex) => candidateIndex !== index))} className="flex min-h-9 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-500/10 dark:text-rose-300" aria-label={`Remover ${insumo?.nome || 'ingrediente'}`}><Trash2 size={14} /></button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-col gap-1 rounded-xl border border-koma-border bg-koma-raised/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[10px] text-koma-muted">Custo estimado de ingredientes por {selectedProduct?.nome || 'produto'}</span>
                <strong className="font-mono text-sm text-emerald-700 dark:text-emerald-300">R$ {estimatedCost.toFixed(2)}</strong>
              </div>
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-koma-border px-4 py-3 sm:px-5">
          <button type="button" onClick={onClose} className="koma-btn-secondary">Cancelar</button>
          <button type="button" onClick={() => void handleSave()} disabled={saving || !produtoId || orderedProducts.length === 0 || insumos.length === 0} className="koma-btn-success disabled:cursor-wait disabled:opacity-50"><Save size={14} /> {saving ? 'Salvando…' : 'Salvar ficha'}</button>
        </footer>
      </section>
    </div>
  );
}
