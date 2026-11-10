import { useEffect, useMemo, useState } from 'react';
import type { Product } from '../../types';

type Props = { apiBaseUrl: string; authHeaders: Record<string, string>; products: Product[] };

export default function MenuHighlightSettings({ apiBaseUrl, authHeaders, products }: Props) {
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const options = useMemo(() => products.filter(p => p.ativo !== false && !p.somente_promocao)
    .slice().sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR')), [products]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoaded(false); setError('');
    fetch(`${apiBaseUrl}/api/cardapio-digital/destaque`, { headers: authHeaders, signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error('Não foi possível carregar o destaque.'); return r.json(); })
      .then(data => { setSelected(typeof data.produto_id === 'string' ? data.produto_id : ''); setLoaded(true); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message || 'Erro ao carregar.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [apiBaseUrl, authHeaders.Authorization, authHeaders.authorization]);
  async function save() {
    if (saving || loading || !loaded) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/destaque`, {
        method: 'PUT', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_id: selected || null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || 'Não foi possível salvar o destaque.');
      setMessage('Destaque salvo.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar o destaque.'); }
    finally { setSaving(false); }
  }
  return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#111713]" aria-label="Configurar destaque do cardápio">
    <h2 className="text-base font-black text-slate-950 dark:text-white">Destaque do cardápio</h2>
    <p className="text-xs text-slate-600 dark:text-slate-400">Escolha um produto ou deixe o KÔMA mostrar o mais pedido.</p>
    <label className="block space-y-1"><span className="text-xs font-bold">Produto em destaque</span>
      <select value={selected} onChange={e => { setSelected(e.target.value); setMessage(''); setError(''); }} disabled={loading || saving || !loaded}
        className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-white/15 dark:bg-[#16241d] dark:text-white">
        <option value="">Automático · mais pedido</option>
        {selected && !options.some(p => String(p.id) === selected) && <option value={selected}>Produto indisponível</option>}
        {options.map(p => <option key={p.id} value={String(p.id)}>{p.nome}{p.variacao_rotulo ? ` · ${p.variacao_rotulo}` : ''}</option>)}
      </select>
    </label>
    <button type="button" onClick={save} disabled={loading || saving || !loaded} className="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar destaque'}</button>
    {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
    {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
  </section>;
}
