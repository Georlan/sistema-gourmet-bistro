import { useEffect, useMemo, useState } from 'react';
import type { Product } from '../../types';

type RecommendationMode = 'automatico' | 'manual';
type RecommendationConfig = { modo: RecommendationMode; produto_ids: string[] };

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  products: Product[];
}

export default function CartRecommendationsSettings({ apiBaseUrl, authHeaders, products }: Props) {
  const [mode, setMode] = useState<RecommendationMode>('automatico');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBaseUrl}/api/cardapio-digital/recomendacoes-sacola`, { headers: authHeaders })
      .then(async response => {
        if (!response.ok) throw new Error('Não foi possível carregar as recomendações.');
        return response.json() as Promise<RecommendationConfig>;
      })
      .then(config => {
        if (cancelled) return;
        setMode(config.modo === 'manual' ? 'manual' : 'automatico');
        setSelectedIds(Array.isArray(config.produto_ids) ? config.produto_ids : []);
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiBaseUrl, authHeaders.Authorization, authHeaders.authorization]);

  const byId = useMemo(() => new Map(products.map(product => [String(product.id), product])), [products]);
  const candidates = useMemo(() => products
    .filter(product => !product.somente_promocao)
    .filter(product => !search.trim() || `${product.nome} ${product.variacao_rotulo || ''} ${product.id}`
      .toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, 60), [products, search]);

  const toggle = (id: string) => {
    setFeedback('');
    setError('');
    setSelectedIds(current => {
      if (current.includes(id)) return current.filter(value => value !== id);
      return current.length < 4 ? [...current, id] : current;
    });
  };

  const move = (index: number, offset: number) => {
    setSelectedIds(current => {
      const next = [...current];
      const target = index + offset;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const save = async () => {
    if (saving || loading) return;
    if (mode === 'manual' && !selectedIds.length) {
      setError('Selecione pelo menos um produto, ou use o modo automático.');
      return;
    }
    setSaving(true);
    setFeedback('');
    setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/recomendacoes-sacola`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo: mode, produto_ids: mode === 'manual' ? selectedIds : [] }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || 'Não foi possível salvar as recomendações.');
      setFeedback('Recomendações salvas. O cardápio será atualizado automaticamente.');
      if (mode === 'automatico') setSelectedIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#111713]"
      aria-label="Configurar recomendações da sacola">
      <div>
        <h2 className="text-base font-black text-slate-950 dark:text-white">Recomendações na sacola</h2>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Escolha o que sugerir ao cliente, sem mudar os produtos ou seus preços.
        </p>
      </div>
      {loading ? <p className="text-sm text-slate-500">Carregando configuração…</p> : (
        <>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-2 text-xs font-bold text-slate-800 dark:text-slate-200">Como escolher as sugestões?</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 p-3 text-sm dark:border-white/15">
              <input type="radio" name="cart-recommendations-mode" checked={mode === 'automatico'}
                onChange={() => { setMode('automatico'); setFeedback(''); setError(''); }} />
              <span><strong>Automático</strong><small className="block text-xs text-slate-500">O KÔMA escolhe os acompanhamentos.</small></span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 p-3 text-sm dark:border-white/15">
              <input type="radio" name="cart-recommendations-mode" checked={mode === 'manual'}
                onChange={() => { setMode('manual'); setFeedback(''); setError(''); }} />
              <span><strong>Escolhido por mim</strong><small className="block text-xs text-slate-500">Até 4 produtos em sua ordem preferida.</small></span>
            </label>
          </fieldset>
          {mode === 'manual' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                <strong className="text-xs text-slate-800 dark:text-white">Selecionados ({selectedIds.length}/4)</strong>
                {!selectedIds.length && <p className="mt-1 text-xs text-slate-500">Marque produtos abaixo. A ordem define quais aparecem primeiro.</p>}
                <ol className="mt-2 space-y-1.5">
                  {selectedIds.map((id, index) => (
                    <li key={id} className="flex min-h-10 items-center gap-2 rounded-lg bg-white/80 px-2 dark:bg-black/20">
                      <span className="w-4 text-xs font-bold text-slate-500">{index + 1}.</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                        {byId.get(id)?.nome || `Produto não encontrado (${id})`}
                      </span>
                      <button type="button" disabled={index === 0} onClick={() => move(index, -1)}
                        aria-label={`Mover ${byId.get(id)?.nome || id} para cima`}
                        className="min-h-9 min-w-9 rounded-lg border border-slate-200 text-xs disabled:opacity-30 dark:border-white/15">↑</button>
                      <button type="button" disabled={index === selectedIds.length - 1} onClick={() => move(index, 1)}
                        aria-label={`Mover ${byId.get(id)?.nome || id} para baixo`}
                        className="min-h-9 min-w-9 rounded-lg border border-slate-200 text-xs disabled:opacity-30 dark:border-white/15">↓</button>
                      <button type="button" onClick={() => toggle(id)} aria-label={`Remover ${byId.get(id)?.nome || id}`}
                        className="min-h-9 rounded-lg border border-rose-300 px-2 text-xs text-rose-700 dark:text-rose-300">Remover</button>
                    </li>
                  ))}
                </ol>
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Buscar produto</span>
                <input type="search" value={search} onChange={event => setSearch(event.target.value)}
                  placeholder="Ex.: refrigerante, batata, suco"
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-white/15 dark:bg-black/20 dark:text-white" />
              </label>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-white/15" aria-label="Produtos disponíveis para recomendar">
                {candidates.map(product => {
                  const id = String(product.id);
                  const checked = selectedIds.includes(id);
                  const unavailable = product.ativo === false;
                  return (
                    <label key={id} className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-xs hover:bg-slate-50 dark:hover:bg-white/5">
                      <input type="checkbox" checked={checked}
                        disabled={(!checked && selectedIds.length >= 4) || (unavailable && !checked)}
                        onChange={() => toggle(id)} aria-label={`Recomendar ${product.nome}`} />
                      <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-200">{product.nome}</span>
                      <span className="shrink-0 font-mono text-slate-600 dark:text-slate-400">
                        {unavailable ? 'Pausado' : Number(product.preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                    </label>
                  );
                })}
                {!candidates.length && <p className="p-3 text-xs text-slate-500">Nenhum produto encontrado.</p>}
              </div>
              <p className="text-xs text-slate-500">O KÔMA não mostrará produtos indisponíveis e manterá a escolha de tamanho ou sabor para famílias.</p>
            </div>
          )}
          {error && <p role="alert" className="text-xs font-bold text-rose-600">{error}</p>}
          {feedback && <p role="status" className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{feedback}</p>}
          <button type="button" onClick={() => void save()} disabled={saving}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-500 px-5 text-sm font-black text-emerald-950 disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar recomendações'}
          </button>
        </>
      )}
    </section>
  );
}
