import { BoardLane, BoardSearch, BoardSync, FulfillmentTicket, matchesSearch } from './FulfillmentBoard';
import { useIdleReconciliation } from '../realtime/useIdleReconciliation';
import { useCallback, useMemo, useRef, useState } from 'react';

import { localCalendarDate, parseBackendTimestamp } from '../../../utils/dateTime';
import type { useCashierOrders } from './useCashierOrders';
import type { DeliveryOrderView } from './cashierWorkspaceTypes';
import { bucketCourierDeliveryOrders } from './deliveryOrderProjection';
import { getDigitalOrderPaymentSummary } from './digitalOrderPresentation';

type BoundaryProps = Pick<
  ReturnType<typeof useCashierOrders>,
  | 'deliveryOrders'
  | 'deliveryOrdersLoadState'
  | 'selectedMotoboys'
  | 'setSelectedMotoboys'
  | 'motoboys'
  | 'motoboysLoadState'
  | 'handleDespacharKanban'
  | 'handleRevogarAcessoMotoboy'
  | 'handleGerarLinkMotoboy'
  | 'handleAddMotoboy'
  | 'novoMotoboyNome'
  | 'novoMotoboyTelefone'
  | 'setNewMotoboyNome'
  | 'setNewMotoboyTelefone'
  | 'handleAcceptPendingDeliveryOrder'
  | 'handleRejectPendingDeliveryOrder'
  | 'handleAdvanceDigitalOrder'
  | 'openDeliveryOrderDetails'
> & {
  query: string;
  setQuery: (value: string) => void;
  activeSubTab: string;
  hasDeliverySnapshot?: boolean;
  onRetry?: () => void;
  isWsConnected?: boolean;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  now: number;
  hasCourierApp: boolean;
  handleFinalizarPedido: (orderId: string) => Promise<boolean>;
  onRequestCourierReassignment: (order: DeliveryOrderView) => void;
  onRequestFulfillmentConversion: (order: DeliveryOrderView) => void;
};

type CompletedDeliveryApiOrder = {
  id: string;
  identificador?: string | null;
  numero_pedido?: number | null;
  delivery_telefone?: string | null;
  delivery_endereco?: string | null;
  delivery_taxa?: number | null;
  delivery_forma_pagamento?: string | null;
  delivery_troco_para?: number | null;
  motoboy_id?: number | null;
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

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

const clock = (raw?: string | null) => {
  const date = parseBackendTimestamp(raw);
  return date ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
};

const completedTotal = (order: CompletedDeliveryApiOrder) => {
  const itemTotal = (order.itens || [])
    .filter((item) => item.status !== 'cancelado')
    .reduce((sum, item) => sum + Number(item.preco_unit ?? item.preco ?? 0), 0);
  return itemTotal + Number(order.delivery_taxa || 0);
};

/** Delivery workspace; state transitions remain owned by useCashierOrders/backend. */
export function CashierCouriers({
  query, setQuery, activeSubTab, hasDeliverySnapshot, onRetry,
  isWsConnected = false,
  deliveryOrders,
  deliveryOrdersLoadState,
  selectedMotoboys,
  setSelectedMotoboys,
  motoboys,
  motoboysLoadState,
  handleDespacharKanban,
  handleGerarLinkMotoboy,
  handleRevogarAcessoMotoboy,
  handleFinalizarPedido,
  handleAddMotoboy,
  novoMotoboyNome,
  novoMotoboyTelefone,
  setNewMotoboyNome,
  setNewMotoboyTelefone,
  handleAcceptPendingDeliveryOrder,
  handleRejectPendingDeliveryOrder,
  handleAdvanceDigitalOrder,
  openDeliveryOrderDetails,
  apiBaseUrl,
  authHeaders,
  now,
  hasCourierApp,
  onRequestCourierReassignment,
  onRequestFulfillmentConversion,
}: BoundaryProps) {
  const courierBuckets = useMemo(
    () => bucketCourierDeliveryOrders(deliveryOrders),
    [deliveryOrders],
  );
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const [completedRecent, setCompletedRecent] = useState<CompletedDeliveryApiOrder[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState(false);

  const courierName = (motoboyId?: number | null) => {
    if (!motoboyId) return null;
    return motoboys.find((motoboy) => Number(motoboy.id) === Number(motoboyId))?.nome || null;
  };

  const refreshCompleted = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/comandas/delivery/entregas/concluidas-recentes`, {
        headers: authHeaders,
      });
      if (!response.ok) throw new Error('delivery-history');
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
    enabled: historyOpen && activeSubTab === 'entregadores',
    isWsConnected,
    eventName: 'koma_orders_updated',
    refresh: refreshCompleted,
  });

  const completedToday = useMemo(() => {
    const today = localCalendarDate(new Date(now));
    return completedRecent.filter((order) => {
      const closedAt = parseBackendTimestamp(order.fechado_em);
      return Boolean(closedAt && localCalendarDate(closedAt) === today);
    });
  }, [completedRecent, now]);

  if (activeSubTab !== 'entregadores') return null;

  const setPending = (orderId: string, pending: boolean) => {
    const next = new Set(pendingIdsRef.current);
    if (pending) next.add(orderId);
    else next.delete(orderId);
    pendingIdsRef.current = next;
    setPendingIds(next);
  };

  const runOrderAction = async (orderId: string, action: () => Promise<unknown>) => {
    if (pendingIdsRef.current.has(orderId)) return;
    setPending(orderId, true);
    try {
      await action();
    } finally {
      setPending(orderId, false);
    }
  };

  const renderCourierSelect = (order: DeliveryOrderView, label: string) => {
    const selectedId = selectedMotoboys[order.id] || (order.motoboyId ? String(order.motoboyId) : '');
    return (
      <label className="flex min-w-0 flex-col gap-1 text-[8px] font-bold uppercase tracking-wider text-koma-muted">
        {label}
        <select
          aria-label={`Entregador do pedido ${order.numeroPedido || order.id}`}
          value={selectedId}
          disabled={motoboysLoadState !== 'loaded' || pendingIds.has(order.id)}
          onChange={(event) => setSelectedMotoboys((current) => ({
            ...current,
            [order.id]: event.target.value,
          }))}
          className="min-h-9 rounded-xl border border-koma-border bg-koma-card px-2 text-[10px] font-bold normal-case tracking-normal text-koma-foreground outline-none focus:border-emerald-500/60 disabled:opacity-60"
        >
          <option value="">
            {motoboysLoadState === 'error' ? 'Falha ao carregar entregadores' : motoboysLoadState === 'loaded' ? 'Selecionar entregador...' : 'Sincronizando entregadores...'}
          </option>
          {motoboys
            .filter((motoboy) => motoboy.ativo || String(motoboy.id) === selectedId)
            .map((motoboy) => (
              <option key={motoboy.id} value={motoboy.id}>
                {motoboy.nome}{!motoboy.ativo ? ' (Inativo)' : ''}
              </option>
            ))}
        </select>
      </label>
    );
  };

  const snapshot = hasDeliverySnapshot ?? (deliveryOrdersLoadState === 'loaded' || deliveryOrders.length > 0);
  const visible = (orders: DeliveryOrderView[]) => orders.filter(order => matchesSearch(query, [
    order.numeroPedido, order.id, order.cliente, order.telefone, order.itens, order.endereco, courierName(order.motoboyId),
  ]));
  const stages = [
    { title: 'Aguardando e em preparo', kind: 'digital', rows: courierBuckets.preparing, empty: 'Nenhuma entrega aguardando preparo.' },
    { title: 'Prontos para sair', kind: 'closing', rows: courierBuckets.ready, empty: 'Nenhuma entrega aguardando saída.' },
    { title: 'Em rota', kind: 'salon', rows: courierBuckets.inTransit, empty: 'Nenhum pedido em rota.' },
  ] as const;
  const renderTicket = (order: DeliveryOrderView) => {
    const pending = pendingIds.has(order.id);
    const acceptance = order.status === 'analise' || order.status === 'pendente';
    const transit = order.status === 'transito';
    const delivered = order.status === 'finalizado';
    const ready = order.status === 'pronto';
    const motoboyId = selectedMotoboys[order.id] || (order.motoboyId ? String(order.motoboyId) : '');
    const status = delivered ? 'Entregue · falta receber' : transit ? 'Em rota' : ready ? 'Pronto' : acceptance ? 'Aguardando aceite' : order.status === 'aceito' ? 'Aceito · aguardando preparo' : 'Em preparo';
    return <FulfillmentTicket key={order.id} order={order} status={status} customer={order.cliente} payment={getDigitalOrderPaymentSummary(order)}
      meta={(transit || delivered) && <p>Entregador: {courierName(order.motoboyId) || (order.motoboyId ? `#${order.motoboyId}` : 'não identificado')}</p>}>
      {ready && renderCourierSelect(order, 'Entregador')}
      <button onClick={() => openDeliveryOrderDetails(order)}>Ver pedido</button>
      {!transit && !delivered && <button disabled={pending} onClick={() => onRequestFulfillmentConversion(order)}>Alterar para retirada</button>}
      {transit && <button disabled={pending} onClick={() => onRequestCourierReassignment(order)}>Trocar entregador</button>}
      {acceptance && <button disabled={pending} onClick={() => handleRejectPendingDeliveryOrder(order)}>Recusar</button>}
      {transit || delivered ? <button className="primary" disabled={pending} onClick={() => void runOrderAction(order.id, () => handleFinalizarPedido(order.id))}>{delivered ? 'Receber saldo' : order.pago ? 'Marcar entregue' : 'Receber e marcar entregue'}</button>
       : ready ? <button className="primary" disabled={pending || !motoboyId || motoboysLoadState !== 'loaded'} onClick={() => void runOrderAction(order.id, () => handleDespacharKanban(order.id, motoboyId))}>Despachar pedido</button>
       : <button className="primary" disabled={pending} onClick={() => void runOrderAction(order.id, () => acceptance ? handleAcceptPendingDeliveryOrder(order) : handleAdvanceDigitalOrder(order))}>{acceptance ? 'Aceitar pedido' : 'Marcar como pronto'}</button>}
    </FulfillmentTicket>;
  };
  const completedVisible = completedToday.filter(order => matchesSearch(query, [
    order.identificador, order.numero_pedido, order.id, order.delivery_endereco, order.delivery_telefone,
    courierName(order.motoboy_id), ...(order.itens || []).map(item => item.produto?.nome || item.nome),
  ]));
  const balances = visible(courierBuckets.awaitingPayment);
  return <div className="fulfillment-board" id="cashier-deliveries-workspace">
    <BoardSearch title="Entregas próprias" query={query} onChange={setQuery} placeholder="Buscar pedido, cliente, endereço ou entregador" />
    <BoardSync snapshot={snapshot} state={deliveryOrdersLoadState} label="entregas" retry={onRetry} />
    {snapshot && <>
      <div className="fulfillment-lanes">{stages.map(stage => {
        const rows = visible(stage.rows);
        return <BoardLane key={stage.title} title={stage.title} kind={stage.kind} count={rows.length} empty={query ? 'Nenhum resultado nesta etapa.' : stage.empty}>{rows.map(renderTicket)}</BoardLane>;
      })}</div>
      {balances.length > 0 && <BoardLane title="Entregues a receber" kind="closing" count={balances.length} empty="">{balances.map(renderTicket)}</BoardLane>}
    </>}
    <details className="fulfillment-history" onToggle={event => setHistoryOpen(event.currentTarget.open)}>
      <summary>Entregas concluídas hoje {historyOpen && historyLoaded && ` · ${completedVisible.length}`}</summary>
      {!historyLoaded && !historyError && <p role="status">Buscando histórico…</p>}
        {historyError && (
          <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-400">
            Não foi possível atualizar o histórico agora. As entregas ativas continuam disponíveis normalmente.
          </div>
        )}

        {historyLoaded && completedVisible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-koma-border py-9 text-center text-sm text-koma-muted">
            Nenhuma entrega concluída hoje.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {completedVisible.map((order) => (
              <article key={order.id} className="rounded-xl border border-koma-border bg-koma-panel/45 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="text-sm text-koma-foreground">Pedido {order.numero_pedido ? `#${order.numero_pedido}` : order.id}</strong>
                    <p className="mt-1 text-sm font-bold text-koma-secondary">
                      {order.identificador || 'Cliente sem nome'}{order.delivery_telefone ? ` · ${order.delivery_telefone}` : ''}
                    </p>
                    <p className="mt-1 truncate text-sm text-koma-muted">{order.delivery_endereco || 'Endereço não informado'}</p>
                    {order.motoboy_id && (
                      <p className="mt-1 text-sm text-koma-muted">Entregador: {courierName(order.motoboy_id) || `#${order.motoboy_id}`}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="block text-sm font-extrabold uppercase text-emerald-500">Entregue</span>
                    <span className="mt-1 block font-mono text-sm text-koma-muted">{clock(order.fechado_em)}</span>
                    <span className="mt-1 block text-sm font-bold text-koma-foreground">{money(completedTotal(order))}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
    </details>

      <details className="rounded-2xl border border-koma-border bg-koma-card/40 p-4">
        <summary className="cursor-pointer text-sm font-extrabold uppercase tracking-wider text-koma-secondary">
          Gerenciar entregadores
        </summary>
        <p className="mt-2 text-sm text-koma-muted">
          {hasCourierApp
            ? 'Cadastro e acesso ao App do Entregador ficam aqui como manutenção secundária; a atribuição diária permanece nos pedidos.'
            : 'Cadastre os entregadores da operação; atribuição e despacho continuam disponíveis sem o App do Entregador.'}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            {motoboysLoadState === 'loading' ? (
              <span className="text-xs italic text-koma-muted">Sincronizando entregadores...</span>
            ) : motoboysLoadState === 'error' ? (
              <span className="text-xs italic text-amber-500">Não foi possível confirmar a lista de entregadores.</span>
            ) : motoboys.length === 0 ? (
              <span className="text-xs italic text-koma-muted">Nenhum entregador cadastrado.</span>
            ) : motoboys.map((motoboy) => (
              <div key={motoboy.id} className="flex items-center justify-between gap-2 rounded-xl border border-koma-border bg-koma-panel p-3">
                <div className="min-w-0 text-xs">
                  <strong className="block truncate text-koma-foreground">{motoboy.nome}</strong>
                  <span className="block font-mono text-sm text-koma-muted">{motoboy.telefone}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-sm font-bold uppercase ${motoboy.ativo ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                    {motoboy.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                  {hasCourierApp && motoboy.ativo && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleGerarLinkMotoboy?.(String(motoboy.id))}
                        className="rounded-lg border border-emerald-500/30 px-2 py-1 text-sm font-bold uppercase text-emerald-500 hover:bg-emerald-500/10"
                        title="Copiar link de acesso ao PWA do entregador"
                      >
                        Copiar link
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRevogarAcessoMotoboy(String(motoboy.id))}
                        className="rounded-lg border border-rose-500/30 px-2 py-1 text-sm font-bold uppercase text-rose-500 hover:bg-rose-500/10"
                      >
                        Revogar acesso
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={(event) => handleAddMotoboy(event, novoMotoboyNome, novoMotoboyTelefone)} className="space-y-3">
            <span className="text-sm font-bold uppercase tracking-wider text-emerald-500">Novo entregador</span>
            <input
              type="text"
              required
              placeholder="Nome do entregador"
              value={novoMotoboyNome}
              onChange={(event) => setNewMotoboyNome(event.target.value)}
              className="w-full rounded-xl border border-koma-border bg-koma-page px-3 py-2 text-xs text-koma-foreground outline-none focus:border-emerald-500"
            />
            <input
              type="text"
              required
              placeholder="Telefone"
              value={novoMotoboyTelefone}
              onChange={(event) => setNewMotoboyTelefone(event.target.value)}
              className="w-full rounded-xl border border-koma-border bg-koma-page px-3 py-2 font-mono text-xs text-koma-foreground outline-none focus:border-emerald-500"
            />
            <button type="submit" disabled={motoboysLoadState !== 'loaded'} className="w-full rounded-xl bg-emerald-600 py-2 text-sm font-bold uppercase tracking-wider text-white hover:bg-emerald-500 disabled:opacity-50">
              Adicionar entregador
            </button>
          </form>
        </div>
      </details>
    </div>;
}
