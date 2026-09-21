import { Ban, CheckCircle2, History, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

type CustomerBlock = {
  id: string;
  cliente_id?: string | null;
  reason: string;
  expires_at?: string | null;
  created_at?: string | null;
  active?: boolean;
  status?: 'active' | 'expired' | 'released';
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Sem expiração automática';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const statusLabel = (block: CustomerBlock) => {
  if (block.status === 'expired') return 'Expirado';
  if (block.status === 'released') return 'Desbloqueado';
  return 'Bloqueado';
};

export function OnlineOrderCustomerBlocks({
  apiBaseUrl,
  authHeaders,
}: {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}) {
  const [blocks, setBlocks] = useState<CustomerBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setFeedback('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/online-orders/blocks`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(typeof payload?.detail === 'string' ? payload.detail : 'Não foi possível consultar os bloqueios.');
      }
      setBlocks(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível consultar os bloqueios.');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeBlocks = useMemo(
    () => blocks.filter((block) => block.active === true || block.status === 'active'),
    [blocks],
  );
  const historyBlocks = useMemo(
    () => blocks.filter((block) => !(block.active === true || block.status === 'active')),
    [blocks],
  );

  const release = async (block: CustomerBlock) => {
    const confirmed = window.confirm(
      `Desbloquear este cliente para novos pedidos online?\n\nMotivo do bloqueio: ${block.reason}`,
    );
    if (!confirmed) return;

    setReleasingId(block.id);
    setFeedback('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/online-orders/blocks/${encodeURIComponent(block.id)}/release`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Bloqueio removido pela operação no painel KÔMA' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.detail === 'string' ? payload.detail : 'Não foi possível liberar o cliente.');
      }
      setBlocks((current) => current.map((item) => (
        item.id === block.id ? { ...item, active: false, status: 'released' } : item
      )));
      setFeedback('Cliente desbloqueado para novos pedidos online.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível liberar o cliente.');
    } finally {
      setReleasingId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" id="online-order-customer-blocks">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-rose-500/25 bg-rose-500/10 text-rose-500">
            <ShieldAlert size={19} />
          </span>
          <div>
            <h3 className="text-sm font-black text-koma-foreground">Clientes bloqueados</h3>
            <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-koma-muted">
              Veja quem está impedido de pedir, desbloqueie quando necessário e consulte o histórico. Dados sensíveis do cliente não são expostos aqui.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-koma-muted transition hover:text-koma-foreground disabled:opacity-50"
          aria-label="Atualizar clientes bloqueados"
          title="Atualizar"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-card px-3 py-5 text-[10px] font-semibold text-koma-muted">
          <Loader2 size={15} className="animate-spin text-emerald-500" /> Consultando bloqueios…
        </div>
      ) : (
        <>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <strong className="text-[10px] uppercase tracking-[0.12em] text-koma-muted">Bloqueios ativos</strong>
              <span className="rounded-full border border-koma-border px-2 py-0.5 text-[9px] font-black text-koma-secondary">
                {activeBlocks.length}
              </span>
            </div>

            {activeBlocks.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 size={15} /> Nenhum cliente bloqueado no momento.
              </div>
            ) : (
              <div className="space-y-2">
                {activeBlocks.map((block) => (
                  <article key={block.id} className="flex flex-col gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Ban size={14} className="shrink-0 text-rose-500" />
                        <strong className="text-[11px] text-koma-foreground">Bloqueio ativo</strong>
                        {block.cliente_id && <span className="rounded-md bg-koma-raised px-1.5 py-0.5 text-[8px] font-bold text-koma-muted">Cliente vinculado</span>}
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-koma-secondary">{block.reason || 'Sem motivo informado'}</p>
                      <p className="mt-1 text-[9px] text-koma-muted">Expira: {formatDateTime(block.expires_at)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void release(block)}
                      disabled={releasingId === block.id}
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-[10px] font-black text-emerald-600 transition hover:bg-emerald-500/20 dark:text-emerald-300 disabled:opacity-50"
                    >
                      {releasingId === block.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                      {releasingId === block.id ? 'Desbloqueando…' : 'Desbloquear'}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 border-t border-koma-border pt-4">
            <div className="mb-2 flex items-center gap-2">
              <History size={14} className="text-koma-muted" />
              <strong className="text-[10px] uppercase tracking-[0.12em] text-koma-muted">Histórico de bloqueios</strong>
            </div>
            {historyBlocks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-koma-border px-3 py-4 text-center text-[10px] text-koma-muted">
                O histórico aparecerá aqui quando um bloqueio expirar ou for removido.
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-koma-border bg-koma-card">
                {historyBlocks.map((block, index) => (
                  <article key={block.id} className={`flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${index > 0 ? 'border-t border-koma-border' : ''}`}>
                    <div className="min-w-0">
                      <p className="truncate text-[10px] font-semibold text-koma-secondary">{block.reason || 'Sem motivo informado'}</p>
                      <p className="mt-0.5 text-[9px] text-koma-muted">Criado em {formatDateTime(block.created_at)}</p>
                    </div>
                    <span className="shrink-0 rounded-full border border-koma-border px-2 py-1 text-[8px] font-black uppercase tracking-wider text-koma-muted">
                      {statusLabel(block)}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {feedback && <p className="mt-3 text-[10px] text-koma-muted" role="status">{feedback}</p>}
    </section>
  );
}
