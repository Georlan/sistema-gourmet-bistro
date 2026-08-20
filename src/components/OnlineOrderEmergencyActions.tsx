import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { API_BASE_URL } from '../config/api';


type ActiveOnlineOrder = {
  id: string;
  numero_pedido?: number | string | null;
  tipo?: string | null;
  delivery_nome?: string | null;
  nome_cliente?: string | null;
  cliente_nome?: string | null;
  delivery_telefone?: string | null;
  status_comanda?: string | null;
  delivery_status?: string | null;
  status?: string | null;
  valor_total?: number | string | null;
  total?: number | string | null;
};

const isCashRoute = () => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  return view === 'caixa'
    || view === 'gerencia'
    || window.location.hash === '#caixa'
    || window.location.hash === '#gerencia';
};

const orderName = (order: ActiveOnlineOrder) => (
  order.delivery_nome
  || order.nome_cliente
  || order.cliente_nome
  || 'Cliente não identificado'
);

const orderStatus = (order: ActiveOnlineOrder) => String(
  order.delivery_status
  || order.status_comanda
  || order.status
  || 'ativo'
).replaceAll('_', ' ');

const orderType = (order: ActiveOnlineOrder) => {
  const value = String(order.tipo || '').toLowerCase();
  if (value === 'retirada') return 'Retirada';
  if (value === 'delivery' || value === 'entrega') return 'Delivery';
  return value || 'Online';
};

const money = (value: number | string | null | undefined) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(parsed);
};

export default function OnlineOrderEmergencyActions() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<ActiveOnlineOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const visible = isCashRoute();
  const token = visible ? localStorage.getItem('koma_caixa_token') : null;

  useEffect(() => {
    if (!visible || !token) {
      setPortalTarget(null);
      return;
    }

    const locate = () => {
      const target = document.querySelector<HTMLElement>(
        '.orders-column--closing .orders-column__header',
      );
      setPortalTarget((current) => current === target ? current : target);
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [token, visible]);

  const loadOrders = useCallback(async () => {
    const currentToken = localStorage.getItem('koma_caixa_token');
    if (!currentToken) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/comandas/delivery/ativos`, {
        headers: { Authorization: `Bearer ${currentToken}` },
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(response.status === 403
          ? 'Seu usuário não possui permissão para consultar pedidos online.'
          : 'Não foi possível carregar os pedidos online ativos.');
      }
      const data = await response.json();
      setOrders(Array.isArray(data) ? data : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar pedidos online.');
    } finally {
      setLoading(false);
    }
  }, []);

  const openEmergencyActions = useCallback(() => {
    setOpen(true);
    void loadOrders();
  }, [loadOrders]);

  const cancelOrder = useCallback(async (order: ActiveOnlineOrder) => {
    const currentToken = localStorage.getItem('koma_caixa_token');
    if (!currentToken) return;

    const label = order.numero_pedido ? `#${order.numero_pedido}` : order.id;
    const confirmed = window.confirm(
      `CANCELAMENTO DE EMERGÊNCIA\n\nCancelar o pedido ${label} de ${orderName(order)}?\n\n` +
      'O backend marcará o pedido como recusado, cancelará os itens ativos e fechará a comanda. ' +
      'Use somente quando a operação não puder ser concluída.',
    );
    if (!confirmed) return;

    setCancellingId(order.id);
    setError('');
    try {
      const response = await fetch(
        `${API_BASE_URL}/comandas/${encodeURIComponent(order.id)}/delivery/status?status_novo=recusado`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${currentToken}` },
        },
      );
      if (!response.ok) {
        let detail = '';
        try {
          const payload = await response.json();
          detail = typeof payload?.detail === 'string' ? payload.detail : '';
        } catch {
          // Resposta sem JSON: usa mensagem normalizada abaixo.
        }
        throw new Error(detail || (
          response.status === 403
            ? 'Seu usuário não possui permissão para cancelar este pedido.'
            : 'O pedido não pôde ser cancelado.'
        ));
      }

      await loadOrders();
      window.dispatchEvent(new Event('koma_orders_updated'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha no cancelamento emergencial.');
    } finally {
      setCancellingId(null);
    }
  }, [loadOrders]);

  const sortedOrders = useMemo(() => [...orders].sort((a, b) => {
    const aNumber = Number(a.numero_pedido || 0);
    const bNumber = Number(b.numero_pedido || 0);
    return bNumber - aNumber;
  }), [orders]);

  if (!visible || !token) return null;

  const trigger = portalTarget ? createPortal(
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        openEmergencyActions();
      }}
      className="ml-2 inline-flex h-7 items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-2 text-[10px] font-bold uppercase tracking-wide text-red-800 transition hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300 dark:hover:bg-red-950/35"
      title="Ações de exceção para pedidos online ativos"
    >
      <ShieldAlert size={12} /> Exceção
    </button>,
    portalTarget,
  ) : null;

  return (
    <>
      {trigger}
      {open && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <section className="w-full max-w-2xl overflow-hidden rounded-2xl border border-koma-border bg-koma-surface shadow-2xl">
            <header className="flex items-center justify-between gap-3 border-b border-koma-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <ShieldAlert size={18} className="shrink-0 text-red-400" />
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-black">Exceções de pedidos online</h2>
                  <p className="text-[10px] text-koma-muted">Cancelamento emergencial — ação autoritativa no backend</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadOrders()}
                  disabled={loading}
                  className="flex size-8 items-center justify-center rounded-lg border border-koma-border text-koma-muted disabled:opacity-50"
                  aria-label="Atualizar pedidos online"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex size-8 items-center justify-center rounded-lg border border-koma-border text-koma-muted"
                  aria-label="Fechar exceções"
                >
                  <X size={14} />
                </button>
              </div>
            </header>

            <div className="max-h-[70vh] overflow-y-auto p-4">
              <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-900/40 bg-amber-950/15 p-3 text-xs text-amber-200">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                Use esta ação somente em falhas reais de retirada/entrega ou quando o pedido não puder mais ser concluído.
              </div>

              {error && (
                <p className="mb-3 rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-xs text-red-300">{error}</p>
              )}

              {loading && sortedOrders.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-koma-muted">
                  <Loader2 size={16} className="animate-spin" /> Carregando pedidos…
                </div>
              ) : sortedOrders.length === 0 ? (
                <p className="rounded-xl border border-dashed border-koma-border p-6 text-center text-sm text-koma-muted">
                  Nenhum pedido online ativo.
                </p>
              ) : (
                <div className="grid gap-2">
                  {sortedOrders.map((order) => {
                    const total = money(order.valor_total ?? order.total);
                    const label = order.numero_pedido ? `#${order.numero_pedido}` : order.id;
                    return (
                      <article key={order.id} className="flex flex-col gap-3 rounded-xl border border-koma-border bg-koma-page p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-sm">Pedido {label}</strong>
                            <span className="rounded-full border border-koma-border px-2 py-0.5 text-[9px] font-bold uppercase text-koma-muted">{orderType(order)}</span>
                            <span className="rounded-full border border-koma-border px-2 py-0.5 text-[9px] uppercase text-koma-subtle">{orderStatus(order)}</span>
                          </div>
                          <p className="mt-1 truncate text-xs text-koma-muted">
                            {orderName(order)}{order.delivery_telefone ? ` · ${order.delivery_telefone}` : ''}
                          </p>
                          {total && <p className="mt-1 text-xs font-bold text-koma-accent">{total}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => void cancelOrder(order)}
                          disabled={cancellingId !== null}
                          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-800/70 bg-red-950/25 px-3 text-xs font-bold text-red-300 transition hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {cancellingId === order.id ? <Loader2 size={14} className="animate-spin" /> : <ShieldAlert size={14} />}
                          Cancelar pedido
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
