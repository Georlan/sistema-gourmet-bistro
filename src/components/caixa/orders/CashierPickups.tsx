import { BoardLane, BoardSearch, BoardSync, FulfillmentTicket, matchesSearch } from './FulfillmentBoard';
import { useIdleReconciliation } from '../realtime/useIdleReconciliation';
import { useCallback, useMemo, useRef, useState } from 'react';

import { getCashierOrderSlaData } from '../../../domain/cashierOrderProjection';
import { localCalendarDate, parseBackendTimestamp } from '../../../utils/dateTime';
import { bucketPickupOrders } from './deliveryOrderProjection';
import type { DeliveryOrderView } from './cashierWorkspaceTypes';
import {
  getDigitalOrderAssociation,
  getDigitalOrderCustomerLabel,
  getDigitalOrderPaymentSummary,
  getDigitalOrderSourceLabel,
} from './digitalOrderPresentation';

type CompletedPickupApiOrder = {
  id: string;
  identificador?: string | null;
  numero_pedido?: number | null;
  delivery_telefone?: string | null;
  criado_em?: string | null;
  fechado_em?: string | null;
  valor_pago?: number | null;
  itens?: Array<{
    status?: string | null;
    preco_unit?: number | null;
    preco?: number | null;
    nome?: string | null;
    produto?: { nome?: string | null } | null;
  }>;
};

type Props = {
  query: string;
  setQuery: (value: string) => void;
  activeSubTab: string;
  hasDeliverySnapshot?: boolean;
  onRetry?: () => void;
  isWsConnected?: boolean;
  deliveryOrders: DeliveryOrderView[];
  deliveryOrdersLoadState: 'loading' | 'loaded' | 'error';
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  now: number;
  handleAcceptPendingDeliveryOrder: (order: DeliveryOrderView) => Promise<void>;
  handleRejectPendingDeliveryOrder: (order: DeliveryOrderView) => void;
  handleAdvanceDigitalOrder: (order: DeliveryOrderView) => Promise<void>;
  handleFinalizeDigitalOrder: (order: DeliveryOrderView) => Promise<void>;
  openDeliveryOrderDetails: (order: DeliveryOrderView) => void;
};

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

const clock = (raw?: string | null) => {
  const date = parseBackendTimestamp(raw);
  return date ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
};

const summaryItems = (items: CompletedPickupApiOrder['itens']) => {
  const counts: Record<string, number> = {};
  (items || [])
    .filter((item) => item.status !== 'cancelado')
    .forEach((item) => {
      const name = item.produto?.nome || item.nome || 'Item';
      counts[name] = (counts[name] || 0) + 1;
    });
  return Object.entries(counts).map(([name, qty]) => `${qty}x ${name}`).join(' + ') || 'Itens não informados';
};

const completedTotal = (order: CompletedPickupApiOrder) => {
  const paid = Number(order.valor_pago || 0);
  if (paid > 0) return paid;
  return (order.itens || [])
    .filter((item) => item.status !== 'cancelado')
    .reduce((sum, item) => sum + Number(item.preco_unit ?? item.preco ?? 0), 0);
};

export function CashierPickups({
  query, setQuery, activeSubTab, hasDeliverySnapshot, onRetry,
  isWsConnected = false,
  deliveryOrders,
  deliveryOrdersLoadState,
  apiBaseUrl,
  authHeaders,
  now,
  handleAcceptPendingDeliveryOrder,
  handleRejectPendingDeliveryOrder,
  handleAdvanceDigitalOrder,
  handleFinalizeDigitalOrder,
  openDeliveryOrderDetails,
}: Props) {
  const [completedRecent, setCompletedRecent] = useState<CompletedPickupApiOrder[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const pendingIdsRef = useRef<Set<string>>(new Set());

  const refreshCompleted = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/comandas/delivery/retiradas/concluidas-recentes`, {
        headers: authHeaders,
      });
      if (!response.ok) throw new Error('pickup-history');
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error('invalid-history');
      setCompletedRecent(payload);
      setHistoryLoaded(true);
      setHistoryError(false);
    } catch {
      setHistoryError(true);
    }
  }, [apiBaseUrl, authHeaders]);

  useIdleReconciliation({
    enabled: historyOpen && activeSubTab === 'retiradas',
    isWsConnected,
    eventName: 'koma_orders_updated',
    refresh: refreshCompleted,
  });

  const buckets = useMemo(
    () => bucketPickupOrders(deliveryOrders, now),
    [deliveryOrders, now],
  );

  const completedToday = useMemo(() => {
    const today = localCalendarDate(new Date(now));
    return completedRecent.filter((order) => {
      const closedAt = parseBackendTimestamp(order.fechado_em);
      return Boolean(closedAt && localCalendarDate(closedAt) === today);
    });
  }, [completedRecent, now]);

  const awaiting = useMemo(
    () => [...buckets.awaitingAcceptance, ...buckets.preparing].filter((order) => matchesSearch(query, [order.cliente, order.telefone, order.itens, order.numeroPedido, order.id, getDigitalOrderAssociation(order)])),
    [buckets.awaitingAcceptance, buckets.preparing, query],
  );
  const ready = useMemo(
    () => buckets.ready.filter((order) => matchesSearch(query, [order.cliente, order.telefone, order.itens, order.numeroPedido, order.id, getDigitalOrderAssociation(order)])),
    [buckets.ready, query],
  );
  const completedVisible = useMemo(() => {
    if (!query.trim()) return completedToday;
    return completedToday.filter((order) => matchesSearch(query, [
      order.identificador,
      order.delivery_telefone,
      order.numero_pedido,
      order.id,
      summaryItems(order.itens),
    ]));
  }, [completedToday, query]);

  if (activeSubTab !== 'retiradas') return null;

  const setPending = (orderId: string, pending: boolean) => {
    const next = new Set(pendingIdsRef.current);
    if (pending) next.add(orderId);
    else next.delete(orderId);
    pendingIdsRef.current = next;
    setPendingIds(next);
  };

  const acceptPickup = async (order: DeliveryOrderView) => {
    if (pendingIdsRef.current.has(order.id)) return;
    setPending(order.id, true);
    try {
      await handleAcceptPendingDeliveryOrder(order);
    } finally {
      setPending(order.id, false);
    }
  };

  const markReady = async (order: DeliveryOrderView) => {
    if (pendingIdsRef.current.has(order.id)) return;
    setPending(order.id, true);
    try {
      await handleAdvanceDigitalOrder(order);
    } finally {
      setPending(order.id, false);
    }
  };

  const finishPickup = async (order: DeliveryOrderView) => {
    if (pendingIdsRef.current.has(order.id)) return;
    setPending(order.id, true);
    try {
      await handleFinalizeDigitalOrder(order);

    } finally {
      setPending(order.id, false);
    }
  };

  const renderActiveCard = (order: DeliveryOrderView, readyForPickup: boolean) => {
    const sla = getCashierOrderSlaData(order, now);
    const late = sla.minutes > 25;
    const pending = pendingIds.has(order.id);
    const awaitingAcceptance = order.status === 'pendente' || order.status === 'analise';

    return <FulfillmentTicket key={order.id} order={order} customer={getDigitalOrderCustomerLabel(order)}
      payment={getDigitalOrderPaymentSummary(order)} status={readyForPickup ? 'Pronto para retirada' : awaitingAcceptance ? 'Aguardando aceite' : order.status === 'aceito' ? 'Aceito · aguardando preparo' : 'Em preparo'}
      meta={<p className="fulfillment-meta">{[getDigitalOrderSourceLabel(order), getDigitalOrderAssociation(order), sla.label, late && 'Atrasada'].filter(Boolean).join(' · ')}</p>}>
      <button
        type="button"
        onClick={() => openDeliveryOrderDetails(order)}
        className="rounded-xl border border-koma-border px-3 py-2 text-[9px] font-bold text-koma-secondary hover:bg-koma-card"
      >
        Ver pedido
      </button>

      {awaitingAcceptance && (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() => void acceptPickup(order)}
            className="primary"
          >
            {pending ? 'Aceitando…' : 'Aceitar pedido'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => handleRejectPendingDeliveryOrder(order)}
            className="rounded-xl border border-rose-500/35 px-3 py-2 text-[9px] font-extrabold text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
          >
            Recusar
          </button>
        </>
      )}

      {!readyForPickup && (order.status === 'aceito' || order.status === 'producao') && (
        <button
          type="button"
          disabled={pending}
          onClick={() => void markReady(order)}
          className="primary"
        >
          {pending ? 'Atualizando…' : 'Marcar pronto para retirada'}
        </button>
      )}

      {readyForPickup && (
        <button
          type="button"
          disabled={pending}
          onClick={() => void finishPickup(order)}
          className="primary"
        >
          {pending
            ? order.pago ? 'Concluindo…' : 'Abrindo recebimento…'
            : order.pago ? 'Confirmar retirada' : 'Receber e concluir retirada'}
        </button>
      )}
    </FulfillmentTicket>;
  };
  const snapshot = hasDeliverySnapshot ?? (deliveryOrdersLoadState === 'loaded' || deliveryOrders.length > 0);

  return <div className="fulfillment-board" id="cashier-pickups-workspace">
    <BoardSearch title="Retiradas do balcão" query={query} onChange={setQuery} placeholder="Buscar cliente, telefone, pedido ou item" />
    <BoardSync snapshot={snapshot} state={deliveryOrdersLoadState} label="retiradas" retry={onRetry} />
    {snapshot && <div className="fulfillment-lanes">
      <BoardLane title="Aguardando e em preparo" kind="digital" count={awaiting.length} empty={query ? 'Nenhum resultado nesta etapa.' : 'Nenhuma retirada aguardando preparo.'}>{awaiting.map(order => renderActiveCard(order, false))}</BoardLane>
      <BoardLane title="Prontas para retirada" kind="closing" count={ready.length} empty={query ? 'Nenhum resultado nesta etapa.' : 'Nenhuma retirada pronta aguardando cliente.'}>{ready.map(order => renderActiveCard(order, true))}</BoardLane>
    </div>}
    <details className="fulfillment-history" onToggle={event => setHistoryOpen(event.currentTarget.open)}>
      <summary>Concluídas hoje {historyOpen && historyLoaded && ` · ${completedVisible.length}`}</summary>
      {!historyLoaded && !historyError && <p role="status">Buscando histórico…</p>}
        {historyError && (
          <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            Não foi possível atualizar o histórico concluído agora. As retiradas ativas continuam disponíveis normalmente.
          </div>
        )}

        {historyLoaded && completedVisible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-koma-border py-9 text-center text-sm text-koma-muted">
            Nenhuma retirada concluída hoje.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {completedVisible.map((order) => (
              <article key={order.id} className="rounded-xl border border-koma-border bg-koma-panel/45 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="text-sm text-koma-foreground">
                      Pedido {order.numero_pedido ? `#${order.numero_pedido}` : order.id}
                    </strong>
                    <p className="mt-1 text-sm font-bold text-koma-secondary">
                      {order.identificador || 'Cliente sem nome'}{order.delivery_telefone ? ` · ${order.delivery_telefone}` : ''}
                    </p>
                    <p className="mt-1 truncate text-sm text-koma-muted">{summaryItems(order.itens)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="block text-sm font-extrabold uppercase text-emerald-400">Entregue</span>
                    <span className="mt-1 block font-mono text-sm text-koma-muted">{clock(order.fechado_em)}</span>
                    <span className="mt-1 block text-sm font-bold text-koma-foreground">{money(completedTotal(order))}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
    </details>
    </div>;
}
