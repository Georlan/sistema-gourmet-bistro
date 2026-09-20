import { AlertTriangle, CheckCircle2, Clock3, PackageCheck, Search, Store } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
  activeSubTab: string;
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

const matchesQuery = (order: DeliveryOrderView, query: string) => {
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  if (!normalized) return true;
  return [
    order.cliente,
    order.telefone,
    order.itens,
    order.numeroPedido,
    order.id,
  ].some((value) => String(value || '').toLocaleLowerCase('pt-BR').includes(normalized));
};

export function CashierPickups({
  activeSubTab,
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
  const [query, setQuery] = useState('');
  const [completedRecent, setCompletedRecent] = useState<CompletedPickupApiOrder[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());

  const refreshCompleted = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/comandas/delivery/retiradas/concluidas-recentes`, {
        headers: authHeaders,
      });
      if (!response.ok) throw new Error('pickup-history');
      const payload = await response.json();
      setCompletedRecent(Array.isArray(payload) ? payload : []);
      setHistoryError(false);
    } catch {
      setHistoryError(true);
    }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    if (activeSubTab !== 'retiradas') return;
    void refreshCompleted();

    const onOrdersUpdated = () => void refreshCompleted();
    window.addEventListener('koma_orders_updated', onOrdersUpdated);
    const intervalId = window.setInterval(() => {
      if (!document.hidden) void refreshCompleted();
    }, 30_000);

    return () => {
      window.removeEventListener('koma_orders_updated', onOrdersUpdated);
      window.clearInterval(intervalId);
    };
  }, [activeSubTab, deliveryOrders.length, refreshCompleted]);

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
    () => [...buckets.awaitingAcceptance, ...buckets.preparing].filter((order) => matchesQuery(order, query)),
    [buckets.awaitingAcceptance, buckets.preparing, query],
  );
  const ready = useMemo(
    () => buckets.ready.filter((order) => matchesQuery(order, query)),
    [buckets.ready, query],
  );
  const completedVisible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return completedToday;
    return completedToday.filter((order) => [
      order.identificador,
      order.delivery_telefone,
      order.numero_pedido,
      order.id,
      summaryItems(order.itens),
    ].some((value) => String(value || '').toLocaleLowerCase('pt-BR').includes(normalized)));
  }, [completedToday, query]);

  if (activeSubTab !== 'retiradas') return null;

  const setPending = (orderId: string, pending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (pending) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  };

  const acceptPickup = async (order: DeliveryOrderView) => {
    setPending(order.id, true);
    try {
      await handleAcceptPendingDeliveryOrder(order);
    } finally {
      setPending(order.id, false);
    }
  };

  const markReady = async (order: DeliveryOrderView) => {
    setPending(order.id, true);
    try {
      await handleAdvanceDigitalOrder(order);
    } finally {
      setPending(order.id, false);
    }
  };

  const finishPickup = async (order: DeliveryOrderView) => {
    setPending(order.id, true);
    try {
      await handleFinalizeDigitalOrder(order);
      void refreshCompleted();
    } finally {
      setPending(order.id, false);
    }
  };

  const renderActiveCard = (order: DeliveryOrderView, readyForPickup: boolean) => {
    const sla = getCashierOrderSlaData(order, now);
    const late = sla.minutes > 25;
    const pending = pendingIds.has(order.id);
    const awaitingAcceptance = order.status === 'pendente' || order.status === 'analise';

    return (
      <article
        key={order.id}
        className={`rounded-2xl border border-l-4 border-l-cyan-500/70 bg-koma-panel/55 p-4 ${late ? 'border-rose-500/35' : readyForPickup ? 'border-emerald-500/30' : 'border-koma-border'}`}
        data-pickup-status={readyForPickup ? 'ready' : order.status}
      >
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-xs text-koma-foreground">
                Pedido {order.numeroPedido ? `#${order.numeroPedido}` : order.id}
              </strong>
              <span className="rounded-md border border-koma-border bg-koma-card px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-koma-muted">
                {getDigitalOrderSourceLabel(order)}
              </span>
              {getDigitalOrderAssociation(order) && (
                <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-violet-700 dark:text-violet-300">
                  {getDigitalOrderAssociation(order)}
                </span>
              )}
              <span className={`rounded-md px-1.5 py-0.5 text-[8px] font-extrabold uppercase ${readyForPickup ? 'bg-emerald-500/15 text-emerald-400' : awaitingAcceptance ? 'bg-amber-500/10 text-amber-400' : 'bg-sky-500/10 text-sky-400'}`}>
                {readyForPickup ? 'Pronto para retirada' : awaitingAcceptance ? 'Aguardando aceite' : 'Em preparo'}
              </span>
              {late && (
                <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-rose-400">
                  <AlertTriangle size={10} /> Atrasada
                </span>
              )}
            </div>
            <div className="text-[11px] font-bold text-koma-secondary">
              {getDigitalOrderCustomerLabel(order)}{order.telefone ? ` · ${order.telefone}` : ''}
            </div>
            <div className="truncate text-[10px] text-koma-muted">Itens: {order.itens}</div>
            <div className="flex flex-wrap gap-3 text-[9px] text-koma-muted">
              <span>Aberto há {sla.label}</span>
              <span>{money(order.total)}</span>
              <span className={order.pago ? 'text-emerald-500' : 'text-amber-500'}>
                {getDigitalOrderPaymentSummary(order)}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
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
                  className="rounded-xl bg-emerald-600 px-3 py-2 text-[9px] font-extrabold text-white hover:bg-emerald-500 disabled:opacity-50"
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

            {!readyForPickup && order.status === 'producao' && (
              <button
                type="button"
                disabled={pending}
                onClick={() => void markReady(order)}
                className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-[9px] font-extrabold text-emerald-400 disabled:opacity-50"
              >
                {pending ? 'Atualizando…' : 'Marcar pronto para retirada'}
              </button>
            )}

            {readyForPickup && (
              <button
                type="button"
                disabled={pending}
                onClick={() => void finishPickup(order)}
                className="rounded-xl bg-emerald-600 px-3 py-2 text-[9px] font-extrabold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {pending
                  ? order.pago ? 'Concluindo…' : 'Abrindo recebimento…'
                  : order.pago ? 'Confirmar retirada' : 'Receber e concluir retirada'}
              </button>
            )}
          </div>
        </div>

        {awaitingAcceptance && (
          <p className="mt-3 border-t border-koma-border/70 pt-2 text-[9px] text-koma-muted">
            Aceite ou recuse aqui; a ação usa o mesmo fluxo canônico exibido em Pedidos.
          </p>
        )}
      </article>
    );
  };

  return (
    <div className="space-y-4 text-left" id="cashier-pickups-workspace">
      <section className="rounded-3xl border border-koma-border bg-koma-card/60 p-4 sm:p-5">
        <div className="flex flex-col gap-4 border-b border-koma-border pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-emerald-400">
              <Store size={18} />
              <span className="text-[10px] font-extrabold uppercase tracking-[0.18em]">Controle de retiradas</span>
            </div>
            <h2 className="mt-1 font-serif text-base font-bold text-koma-foreground">Retiradas do balcão</h2>
            <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-koma-muted">
              Workspace de balcão para aceitar, acompanhar, receber e concluir retiradas sem trocar de tela.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-koma-border bg-koma-panel px-3 py-2">
              <strong className="block font-mono text-sm text-koma-foreground">{buckets.awaitingAcceptance.length + buckets.preparing.length}</strong>
              <span className="text-[8px] font-bold uppercase text-koma-muted">pendentes</span>
            </div>
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2">
              <strong className="block font-mono text-sm text-emerald-400">{buckets.ready.length}</strong>
              <span className="text-[8px] font-bold uppercase text-koma-muted">prontas</span>
            </div>
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 px-3 py-2">
              <strong className="block font-mono text-sm text-rose-400">{buckets.late.length}</strong>
              <span className="text-[8px] font-bold uppercase text-koma-muted">atrasadas</span>
            </div>
            <div className="rounded-xl border border-koma-border bg-koma-panel px-3 py-2">
              <strong className="block font-mono text-sm text-koma-foreground">{completedToday.length}</strong>
              <span className="text-[8px] font-bold uppercase text-koma-muted">concluídas hoje</span>
            </div>
          </div>
        </div>

        {deliveryOrdersLoadState === 'loading' && deliveryOrders.length === 0 && (
          <div className="mt-4 rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-[9px] text-koma-muted" role="status">
            Sincronizando retiradas…
          </div>
        )}
        {deliveryOrdersLoadState === 'error' && (
          <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[9px] text-amber-400" role="status">
            Não foi possível atualizar os pedidos agora. Mostrando o último estado conhecido.
          </div>
        )}

        <label className="mt-4 flex max-w-xl items-center gap-2 rounded-xl border border-koma-border bg-koma-page px-3 py-2.5 focus-within:border-emerald-500/50">
          <Search size={14} className="text-koma-muted" />
          <span className="sr-only">Buscar retiradas</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar cliente, telefone, pedido ou item"
            className="min-w-0 flex-1 bg-transparent text-xs text-koma-foreground outline-none placeholder:text-koma-muted"
          />
        </label>
      </section>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <section className="rounded-2xl border border-koma-border bg-koma-card/45 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-xs font-extrabold text-koma-foreground">
                <Clock3 size={15} /> Aguardando e em preparo
              </h3>
              <p className="mt-0.5 text-[9px] text-koma-muted">Aceite ou recuse novos pedidos e avance o preparo sem sair deste workspace.</p>
            </div>
            <span className="rounded-full bg-amber-500/10 px-2 py-1 font-mono text-[9px] font-bold text-amber-400">{awaiting.length}</span>
          </div>
          <div className="space-y-2">
            {awaiting.length > 0 ? awaiting.map((order) => renderActiveCard(order, false)) : (
              <div className="rounded-xl border border-dashed border-koma-border py-10 text-center text-[10px] text-koma-muted">
                Nenhuma retirada aguardando preparo.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-emerald-500/20 bg-koma-card/45 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-xs font-extrabold text-koma-foreground">
                <PackageCheck size={15} className="text-emerald-400" /> Prontas para retirada
              </h3>
              <p className="mt-0.5 text-[9px] text-koma-muted">Confirmar a saída reutiliza o checkout/fechamento canônico.</p>
            </div>
            <span className="rounded-full bg-emerald-500/15 px-2 py-1 font-mono text-[9px] font-bold text-emerald-400">{ready.length}</span>
          </div>
          <div className="space-y-2">
            {ready.length > 0 ? ready.map((order) => renderActiveCard(order, true)) : (
              <div className="rounded-xl border border-dashed border-koma-border py-10 text-center text-[10px] text-koma-muted">
                Nenhuma retirada pronta aguardando cliente.
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-koma-border bg-koma-card/45 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-xs font-extrabold text-koma-foreground">
              <CheckCircle2 size={15} className="text-emerald-400" /> Concluídas hoje
            </h3>
            <p className="mt-0.5 text-[9px] text-koma-muted">Histórico somente leitura das retiradas já entregues ao cliente neste dia local.</p>
          </div>
          <span className="rounded-full bg-koma-panel px-2 py-1 font-mono text-[9px] font-bold text-koma-muted">{completedVisible.length}</span>
        </div>

        {historyError && (
          <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[9px] text-amber-300">
            Não foi possível atualizar o histórico concluído agora. As retiradas ativas continuam disponíveis normalmente.
          </div>
        )}

        {completedVisible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-koma-border py-9 text-center text-[10px] text-koma-muted">
            Nenhuma retirada concluída hoje.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {completedVisible.map((order) => (
              <article key={order.id} className="rounded-xl border border-koma-border bg-koma-panel/45 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="text-[11px] text-koma-foreground">
                      Pedido {order.numero_pedido ? `#${order.numero_pedido}` : order.id}
                    </strong>
                    <p className="mt-1 text-[10px] font-bold text-koma-secondary">
                      {order.identificador || 'Cliente sem nome'}{order.delivery_telefone ? ` · ${order.delivery_telefone}` : ''}
                    </p>
                    <p className="mt-1 truncate text-[9px] text-koma-muted">{summaryItems(order.itens)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="block text-[8px] font-extrabold uppercase text-emerald-400">Entregue</span>
                    <span className="mt-1 block font-mono text-[10px] text-koma-muted">{clock(order.fechado_em)}</span>
                    <span className="mt-1 block text-[10px] font-bold text-koma-foreground">{money(completedTotal(order))}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
