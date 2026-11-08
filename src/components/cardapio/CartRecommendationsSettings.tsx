import { ArrowDown, ArrowUp, Check, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Product } from '../../types';

interface Props {
  produtos: Product[];
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onClose: () => void;
}

const maxPicks = 6;

/** Operador seleciona apenas IDs reais: sem duplicar produtos ou criar ofertas. */
export default function CartRecommendationsSettings({ produtos, apiBaseUrl, authHeaders, onClose }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [previous, setPrevious] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const byId = useMemo(() => new Map(produtos.map(product => [String(product.id), product])), [produtos]);

  useEffect(() => {
    let active = true;
    fetch(`${apiBaseUrl}/api/cardapio-digital/recomendacoes`, { headers: authHeaders })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'Não foi possível carregar as recomendações.');
        return Array.isArray(data.produto_ids) ? data.produto_ids.map(String) as string[] : [];
      })
      .then(ids => { if (active) { setSelected(ids); setPrevious(ids); } })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Falha ao carregar.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [apiBaseUrl, authHeaders]);

  const options = useMemo(() => produtos
    .filter(product => product.ativo !== false && product.somente_promocao !== true)
    .filter(product => !search.trim() || `${product.nome} ${product.categoria || ''} ${product.variacao_rotulo || ''}`
      .toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  , [produtos, search]);

  const move = (id: string, offset: number) => {
    setSelected(ids => {
      const next = [...ids], index = next.indexOf(id), target = index + offset;
      if (index < 0 || target < 0 || target >= next.length) return ids;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const toggle = (id: string) => {
    setError('');
    setSelected(ids => ids.includes(id)
      ? ids.filter(value => value !== id)
      : ids.length < maxPicks ? [...ids, id] : ids);
  };

  const save = async () => {
    if (busy || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiBaseUrl}/api/cardapio-digital/recomendacoes`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_ids: selected, anteriores: previous }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Não foi possível salvar as recomendações.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/75 p-3" role="presentation">
      <section role="dialog" aria-modal="true" aria-label="Recomendações na sacola"
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-2xl dark:border-white/15 dark:bg-[#14251d] dark:text-white">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-white/10">
          <div>
            <h2 className="text-lg font-black">Recomendações na sacola</h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Escolha até seis produtos existentes. A ordem abaixo define a prioridade.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-slate-300 dark:border-white/20"
            aria-label="Fechar recomendações"><X size={18}/></button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {error && <p role="alert" className="rounded-lg border border-rose-400 bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</p>}
          {busy ? <p role="status" className="text-sm">Carregando...</p> : <>
            <section aria-label="Produtos escolhidos" className="space-y-2">
              <div className="flex justify-between gap-2 text-xs font-bold">
                <span>Escolhidos ({selected.length}/{maxPicks})</span>
                <span className="text-slate-500">{selected.length ? 'Seleção manual' : 'Sugestões automáticas'}</span>
              </div>
              {selected.length === 0
                ? <p className="rounded-lg bg-slate-100 p-3 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">Sem escolha manual, o KÔMA recomenda automaticamente bebidas e acompanhamentos.</p>
                : selected.map((id, index) => {
                  const product = byId.get(id);
                  return <div key={id} className="flex min-w-0 items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-2">
                    <span className="w-5 shrink-0 text-center text-xs font-black">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-xs font-bold">{product?.nome || 'Produto não encontrado'}</span>
                    <button type="button" disabled={index === 0} onClick={() => move(id,-1)} aria-label={`Subir ${product?.nome || id}`}
                      className="grid h-9 w-8 shrink-0 place-items-center disabled:opacity-30"><ArrowUp size={15}/></button>
                    <button type="button" disabled={index === selected.length-1} onClick={() => move(id,1)} aria-label={`Descer ${product?.nome || id}`}
                      className="grid h-9 w-8 shrink-0 place-items-center disabled:opacity-30"><ArrowDown size={15}/></button>
                    <button type="button" onClick={() => toggle(id)} aria-label={`Remover ${product?.nome || id}`}
                      className="grid h-9 w-8 shrink-0 place-items-center text-rose-600"><X size={15}/></button>
                  </div>;
                })}
            </section>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-3 text-slate-500" size={16}/>
              <input type="search" aria-label="Buscar produtos para recomendar" placeholder="Buscar produto..."
                value={search} onChange={event => setSearch(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-300 bg-transparent pl-10 pr-3 text-sm outline-none focus:border-emerald-500 dark:border-white/20"/>
            </label>
            <section aria-label="Produtos disponíveis" className="space-y-1.5">
              {options.length === 0 && <p className="text-xs text-slate-500">Nenhum produto disponível encontrado.</p>}
              {options.map(product => {
                const checked = selected.includes(String(product.id));
                const disabled = !checked && selected.length >= maxPicks;
                return <button key={product.id} type="button" onClick={() => toggle(String(product.id))}
                  disabled={disabled} aria-pressed={checked}
                  aria-label={`${checked ? 'Desmarcar' : 'Recomendar'} ${product.nome}`}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-left disabled:opacity-40 dark:border-white/10">
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${checked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-400'}`}>
                    {checked && <Check size={13}/>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold">{product.nome}</span>
                    {product.variacao_rotulo && <span className="block text-[10px] text-slate-500 dark:text-slate-300">Opção: {product.variacao_rotulo}</span>}
                  </span>
                  <span className="shrink-0 text-xs font-semibold">R$ {Number(product.preco).toFixed(2).replace('.', ',')}</span>
                </button>;
              })}
            </section>
          </>}
        </div>
        <footer className="flex shrink-0 gap-2 border-t border-slate-200 p-3 dark:border-white/10">
          <button type="button" onClick={onClose} disabled={saving} className="min-h-11 flex-1 rounded-xl border border-slate-300 px-4 text-xs font-bold dark:border-white/20">Cancelar</button>
          <button type="button" onClick={() => void save()} disabled={busy || saving || Boolean(error && !selected.length)}
            className="min-h-11 flex-1 rounded-xl bg-emerald-500 px-4 text-xs font-black text-emerald-950 disabled:opacity-50">
            {saving ? 'Salvando...' : 'Salvar recomendações'}
          </button>
        </footer>
      </section>
    </div>, document.body,
  );
}
