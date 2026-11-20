import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ShoppingBag, Trash2 } from 'lucide-react';
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
      .then(async (response) => {
        if (!response.ok) throw new Error('Não foi possível carregar as recomendações.');
        return response.json() as Promise<RecommendationConfig>;
      })
      .then((config) => {
        if (cancelled) return;
        setMode(config.modo === 'manual' ? 'manual' : 'automatico');
        setSelectedIds(Array.isArray(config.produto_ids) ? config.produto_ids : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, authHeaders.Authorization, authHeaders.authorization]);

  const byId = useMemo(() => new Map(products.map((product) => [String(product.id), product])), [products]);
  const candidates = useMemo(
    () =>
      products
        .filter((product) => !product.somente_promocao)
        .filter(
          (product) =>
            !search.trim() ||
            `${product.nome} ${product.variacao_rotulo || ''} ${product.id}`
              .toLocaleLowerCase('pt-BR')
              .includes(search.trim().toLocaleLowerCase('pt-BR')),
        )
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
        .slice(0, 60),
    [products, search],
  );

  const toggle = (id: string) => {
    setFeedback('');
    setError('');
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      return current.length < 4 ? [...current, id] : current;
    });
  };

  const move = (index: number, offset: number) => {
    setSelectedIds((current) => {
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
    <section
      className="space-y-4 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5"
      aria-label="Configurar recomendações da sacola"
    >
      <div className="flex items-start gap-2.5">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-card text-koma-foreground"
          aria-hidden="true"
        >
          <ShoppingBag size={16} />
        </span>
        <div>
          <h2
            className="text-base font-bold text-koma-foreground"
            style={{ fontFamily: 'var(--koma-font-display)' }}
          >
            Recomendações na sacola
          </h2>
          <p className="mt-0.5 text-xs text-koma-muted">
            Escolha o que sugerir ao cliente, sem mudar os produtos ou seus preços.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-koma-muted">Carregando configuração…</p>
      ) : (
        <>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-2 text-xs font-semibold text-koma-secondary">Como escolher as sugestões?</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-koma-border bg-koma-card p-3 text-sm text-koma-foreground">
              <input
                type="radio"
                name="cart-recommendations-mode"
                checked={mode === 'automatico'}
                onChange={() => {
                  setMode('automatico');
                  setFeedback('');
                  setError('');
                }}
              />
              <span>
                <strong className="font-semibold">Automático</strong>
                <small className="block text-xs text-koma-muted">O KÔMA escolhe os acompanhamentos.</small>
              </span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-koma-border bg-koma-card p-3 text-sm text-koma-foreground">
              <input
                type="radio"
                name="cart-recommendations-mode"
                checked={mode === 'manual'}
                onChange={() => {
                  setMode('manual');
                  setFeedback('');
                  setError('');
                }}
              />
              <span>
                <strong className="font-semibold">Escolhido por mim</strong>
                <small className="block text-xs text-koma-muted">Até 4 produtos em sua ordem preferida.</small>
              </span>
            </label>
          </fieldset>

          {mode === 'manual' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-koma-border bg-koma-card p-3">
                <strong className="text-xs font-semibold text-koma-foreground tabular-nums">
                  Selecionados ({selectedIds.length}/4)
                </strong>
                {!selectedIds.length && (
                  <p className="mt-1 text-xs text-koma-muted">
                    Marque produtos abaixo. A ordem define quais aparecem primeiro.
                  </p>
                )}
                <ol className="mt-2 space-y-1.5">
                  {selectedIds.map((id, index) => (
                    <li
                      key={id}
                      className="flex min-h-11 items-center gap-2 rounded-lg border border-koma-border bg-koma-panel px-2.5"
                    >
                      <span className="w-4 text-xs font-semibold text-koma-muted tabular-nums">{index + 1}.</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-koma-foreground">
                        {byId.get(id)?.nome || `Produto não encontrado (${id})`}
                      </span>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        aria-label={`Mover ${byId.get(id)?.nome || id} para cima`}
                        className="grid min-h-9 min-w-9 place-items-center rounded-lg border border-koma-border bg-koma-card text-koma-foreground disabled:opacity-30"
                      >
                        <ArrowUp size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={index === selectedIds.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label={`Mover ${byId.get(id)?.nome || id} para baixo`}
                        className="grid min-h-9 min-w-9 place-items-center rounded-lg border border-koma-border bg-koma-card text-koma-foreground disabled:opacity-30"
                      >
                        <ArrowDown size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggle(id)}
                        aria-label={`Remover ${byId.get(id)?.nome || id}`}
                        className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-2 text-xs font-semibold"
                        style={{
                          borderColor: 'var(--koma-danger-border)',
                          color: 'var(--koma-danger-text)',
                        }}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                        Remover
                      </button>
                    </li>
                  ))}
                </ol>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-koma-secondary">Buscar produto</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Ex.: refrigerante, batata, suco"
                  className="min-h-11 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-sm text-koma-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--koma-focus-ring)]"
                />
              </label>

              <div
                className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-koma-border bg-koma-card p-2"
                aria-label="Produtos disponíveis para recomendar"
              >
                {candidates.map((product) => {
                  const id = String(product.id);
                  const checked = selectedIds.includes(id);
                  const unavailable = product.ativo === false;
                  return (
                    <label
                      key={id}
                      className="flex min-h-11 items-center gap-3 rounded-lg px-2.5 text-xs transition hover:bg-koma-raised"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={(!checked && selectedIds.length >= 4) || (unavailable && !checked)}
                        onChange={() => toggle(id)}
                        aria-label={`Recomendar ${product.nome}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-koma-foreground">{product.nome}</span>
                      <span className="shrink-0 font-medium text-koma-muted tabular-nums">
                        {unavailable
                          ? 'Pausado'
                          : Number(product.preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                    </label>
                  );
                })}
                {!candidates.length && <p className="p-3 text-xs text-koma-muted">Nenhum produto encontrado.</p>}
              </div>

              <p className="text-xs text-koma-muted">
                O KÔMA não mostrará produtos indisponíveis e manterá a escolha de tamanho ou sabor para famílias.
              </p>
            </div>
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
          {feedback && (
            <p
              role="status"
              className="rounded-xl border px-3 py-2 text-xs font-semibold"
              style={{
                background: 'var(--koma-success-bg)',
                borderColor: 'var(--koma-success-border)',
                color: 'var(--koma-success-text)',
              }}
            >
              {feedback}
            </p>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold transition disabled:opacity-50"
            style={{
              background: 'var(--koma-action-bg)',
              color: 'var(--koma-action-text)',
            }}
          >
            {saving ? 'Salvando…' : 'Salvar recomendações'}
          </button>
        </>
      )}
    </section>
  );
}
