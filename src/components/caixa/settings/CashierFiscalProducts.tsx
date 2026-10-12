import React, { useEffect, useRef, useState } from 'react';
import { snapshotFetch as fetch } from '../../../utils/snapshotFetch';

type Product = {
  productId: string; name: string; currentPrice: string; active: boolean;
  preparationStatus: 'pending' | 'reviewed' | 'blocked' | 'expired' | 'scheduled';
  ncm: string | null; commercialUnit: string | null;
};
type Page = { items: Product[]; total: number; hasMore: boolean };
const LABELS: Record<Product['preparationStatus'], string> = {
  pending: 'Dados fiscais pendentes', reviewed: 'Cadastro revisado', blocked: 'Revisão necessária',
  expired: 'Cadastro vencido', scheduled: 'Vigência futura',
};

export function CashierFiscalProducts({ apiBaseUrl, authHeaders }: {
  apiBaseUrl: string; authHeaders: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const headersRef = useRef(authHeaders);
  headersRef.current = authHeaders;
  // Depend on credentials, not the identity of a parent-created headers object.
  const credentialsKey = JSON.stringify(authHeaders);
  useEffect(() => {
    setPage(null);
    setError('');
    if (!open) return;
    let disposed = false;
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/onboarding/fiscal/products?offset=${offset}&limit=50`, {
          headers: headersRef.current, cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error('Não foi possível carregar os produtos fiscais. Tente atualizar.');
        const result = await response.json() as Page;
        if (!Array.isArray(result.items) || !Number.isInteger(result.total) || result.total < 0 || typeof result.hasMore !== 'boolean'
          || result.items.some(item => !item || typeof item.productId !== 'string' || typeof item.name !== 'string'
            || typeof item.currentPrice !== 'string' || !Number.isFinite(Number(item.currentPrice))
            || !Object.hasOwn(LABELS, item.preparationStatus))) {
          throw new Error('Não foi possível carregar os produtos fiscais. Tente atualizar.');
        }
        if (!disposed) setPage(result);
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : 'Falha ao carregar produtos.');
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => { disposed = true; controller.abort(); };
  }, [apiBaseUrl, credentialsKey, open, offset, refresh]);

  return <section aria-label="Preparação fiscal dos produtos" className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-bold text-koma-foreground">Produtos do cardápio</h3>
        <p className="mt-1 text-xs text-koma-muted">Nome e preço vêm do cardápio. Cada produto já aparece aqui, inclusive os novos.</p>
      </div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-xl border border-koma-border px-3 py-2 text-xs font-bold text-koma-foreground">
        {open ? 'Recolher produtos' : 'Ver preparação dos produtos'}
      </button>
    </div>
    {open && <div className="mt-4 space-y-3">
      <p className="text-xs text-koma-muted">Esta etapa organiza o cadastro. A classificação dos impostos e o tratamento de adicionais e combos ainda precisam de revisão antes da emissão.</p>
      <button type="button" disabled={loading} onClick={() => setRefresh(refresh + 1)} className="rounded-lg border border-koma-border px-3 py-2 text-xs text-koma-foreground disabled:opacity-50">Atualizar produtos</button>
      {loading && <p role="status" className="text-xs text-koma-muted">Carregando produtos…</p>}
      {error && <p role="alert" className="text-xs text-rose-700 dark:text-rose-200">{error}</p>}
      {page && <>
        <p className="text-xs text-koma-muted">{page.total} produtos · página {Math.floor(offset / 50) + 1}</p>
        {page.items.length === 0 && <p className="text-xs text-koma-muted">Nenhum produto nesta página. Os produtos cadastrados no cardápio aparecerão aqui.</p>}
        <ul className="space-y-2">
          {page.items.map(product => <li key={product.productId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-koma-border p-3">
            <div className="min-w-0 flex-1">
              <p className="break-words text-xs font-bold text-koma-foreground">{product.name}{!product.active && <span className="ml-2 font-normal text-koma-muted">Inativo</span>}</p>
              <p className="mt-1 text-xs text-koma-muted">Preço atual: {Number(product.currentPrice).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · NCM: {product.ncm || 'pendente'} · Unidade: {product.commercialUnit || 'pendente'}</p>
            </div>
            <span className="rounded-full border border-koma-border px-2 py-1 text-xs text-koma-secondary">{LABELS[product.preparationStatus]}</span>
          </li>)}
        </ul>
        <div className="flex gap-3">
          <button type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className="rounded-lg border border-koma-border px-3 py-2 text-xs text-koma-foreground disabled:opacity-50">Anterior</button>
          <button type="button" disabled={loading || !page.hasMore} onClick={() => setOffset(offset + 50)} className="rounded-lg border border-koma-border px-3 py-2 text-xs text-koma-foreground disabled:opacity-50">Próxima</button>
        </div>
      </>}
    </div>}
  </section>;
}
