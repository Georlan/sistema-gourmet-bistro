import { Ban, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

type CustomerBlock = {
  id: string;
  cliente_id?: string | null;
  reason: string;
  expires_at?: string | null;
  created_at?: string | null;
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

  const release = async (block: CustomerBlock) => {
    const confirmed = window.confirm(
      `Liberar este cliente para fazer novos pedidos online?\n\nMotivo do bloqueio: ${block.reason}`,
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
      setBlocks((current) => current.filter((item) => item.id !== block.id));
      setFeedback('Cliente liberado para novos pedidos online.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível liberar o cliente.');
    } finally {
      setReleasingId(null);
    }
  };

  return (
    <section className="mb-4 rounded-2xl border border-koma-border bg-koma-card p-4 sm:p-5" id="online-order-customer-blocks">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-rose-500/25 bg-rose-500/10 text-rose-500">
            <ShieldAlert size={19} />
          </span>
          <div>
            <h3 className="text-sm font-black text-koma-foreground">Clientes bloqueados</h3>
            <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-koma-subtle">
              Bloqueios criados pela operação impedem novos pedidos daquele cliente. O telefone não é exposto nesta tela; a liberação é auditável e vale apenas para este restaurante.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-panel text-koma-muted transition hover:text-koma-foreground disabled:opacity-50"
          aria-label="Atualizar clientes bloqueados"
          title="Atualizar"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-panel px-3 py-5 text-[10px] font-semibold text-koma-muted">
          <Loader2 size={15} className="animate-spin text-emerald-500" /> Consultando bloqueios…
        </div>
      ) : blocks.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
          <CheckCircle2 size={15} /> Nenhum cliente está bloqueado para novos pedidos online.
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {blocks.map((block) => (
            <article key={block.id} className="flex flex-col gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Ban size={14} className="shrink-0 text-rose-500" />
                  <strong className="text-[11px] text-koma-foreground">Bloqueio ativo</strong>
                  {block.cliente_id && <span className="rounded-md bg-koma-panel px-1.5 py-0.5 text-[8px] font-bold text-koma-muted">Cliente vinculado</span>}
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-koma-secondary">{block.reason || 'Sem motivo informado'}</p>
                <p className="mt-1 text-[9px] text-koma-subtle">Expira: {formatDateTime(block.expires_at)}</p>
              </div>
              <button
                type="button"
                onClick={() => void release(block)}
                disabled={releasingId === block.id}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-[10px] font-black text-emerald-600 transition hover:bg-emerald-500/20 dark:text-emerald-300 disabled:opacity-50"
              >
                {releasingId === block.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                {releasingId === block.id ? 'Liberando…' : 'Desbloquear'}
              </button>
            </article>
          ))}
        </div>
      )}

      {feedback && <p className="mt-3 text-[10px] text-koma-muted" role="status">{feedback}</p>}
    </section>
  );
}
