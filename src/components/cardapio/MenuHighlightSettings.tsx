import { useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import type { Product } from '../../types';

type Props = { apiBaseUrl: string; authHeaders: Record<string, string>; products: Product[] };

export default function MenuHighlightSettings({ apiBaseUrl, authHeaders, products }: Props) {
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const options = useMemo(
    () =>
      products
        .filter((p) => p.ativo !== false && !p.somente_promocao)
        .slice()
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [products],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoaded(false);
    setError('');
    fetch(`${apiBaseUrl}/api/cardapio-digital/destaque`, { headers: authHeaders, signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('Não foi possível carregar o destaque.');
        return r.json();
      })
      .then((data) => {
        setSelected(typeof data.produto_id === 'string' ? data.produto_id : '');
        setLoaded(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message || 'Erro ao carregar.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [apiBaseUrl, authHeaders.Authorization, authHeaders.authorization]);

  async function save() {
    if (saving || loading || !loaded) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/cardapio-digital/destaque`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_id: selected || null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || 'Não foi possível salvar o destaque.');
      setMessage('Destaque salvo.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar o destaque.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="space-y-3 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5"
      aria-label="Configurar destaque do cardápio"
    >
      <div className="flex items-start gap-2.5">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-card text-koma-foreground"
          aria-hidden="true"
        >
          <Star size={16} />
        </span>
        <div>
          <h2
            className="text-base font-bold text-koma-foreground"
            style={{ fontFamily: 'var(--koma-font-display)' }}
          >
            Destaque do cardápio
          </h2>
          <p className="mt-0.5 text-xs text-koma-muted">
            Escolha um produto principal ou deixe o KÔMA mostrar o mais pedido.
          </p>
        </div>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-koma-secondary">Produto em destaque</span>
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setMessage('');
            setError('');
          }}
          disabled={loading || saving || !loaded}
          className="min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--koma-focus-ring)]"
        >
          <option value="">Automático · mais pedido</option>
          {selected && !options.some((p) => String(p.id) === selected) && (
            <option value={selected}>Produto indisponível</option>
          )}
          {options.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.nome}
              {p.variacao_rotulo ? ` · ${p.variacao_rotulo}` : ''}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={() => void save()}
        disabled={loading || saving || !loaded}
        className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50"
        style={{
          background: 'var(--koma-action-bg)',
          color: 'var(--koma-action-text)',
        }}
      >
        {saving ? 'Salvando…' : 'Salvar destaque'}
      </button>

      {message && (
        <p
          role="status"
          className="rounded-xl border px-3 py-2 text-xs font-semibold"
          style={{
            background: 'var(--koma-success-bg)',
            borderColor: 'var(--koma-success-border)',
            color: 'var(--koma-success-text)',
          }}
        >
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border px-3 py-2 text-xs font-semibold"
          style={{
            background: 'var(--koma-danger-bg)',
            borderColor: 'var(--koma-danger-border)',
            color: 'var(--koma-danger-text)',
          }}
        >
          {error}
        </p>
      )}
    </section>
  );
}
