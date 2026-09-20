import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  activeSubTab: string;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  now: number;
  handleFinalizarPedido: (orderId: string) => Promise<boolean>;
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
  activeSubTab,
  deliveryOrders,
  deliveryOrdersLoadState,
  selectedMotoboys,
  setSelectedMotoboys,
  motoboys,
  motoboysLoadState,
  handleDespacharKanban,
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
}: BoundaryProps) {
  const courierBuckets = useMemo(
    () => bucketCourierDeliveryOrders(deliveryOrders),
    [deliveryOrders],
  );
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const [completedRecent, setCompletedRecent] = useState<CompletedDeliveryApiOrder[]>([]);
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
      setCompletedRecent(Array.isArray(payload) ? payload : []);
      setHistoryError(false);
    } catch {
      setHistoryError(true);
    }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    if (activeSubTab !== 'entregadores') return;
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
  }, [activeSubTab, refreshCompleted]);

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
            {motoboysLoadState === 'loaded' ? 'Selecionar entregador...' : 'Sincronizando entregadores...'}
          </option>
          {motoboys.filter((motoboy) => motoboy.ativo).map((motoboy) => (
            <option key={motoboy.id} value={motoboy.id}>{motoboy.nome}</option>
          ))}
        </select>
      </label>
    );
  };

  return (
    <div className="space-y-4 text-left" id="cashier-deliveries-workspace">
      <section className="rounded-3xl border border-koma-border bg-koma-card/60 p-4 sm:p-5">
        <div className="flex flex-col gap-4 border-b border-koma-border pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-sky-500">Controle de entregas</span>
            <h2 className="mt-1 font-serif text-base font-bold text-koma-foreground">Delivery próprio</h2>
            <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-koma-muted">
              Aceite, acompanhe, organize o entregador, despache, receba e conclua deliveries sem trocar de tela.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-koma-border bg-koma-panel px-3 py-2">
              <strong className="block font-mono text-sm text-koma-foreground">{courierBuckets.preparing.length}</strong>
              <span className="text-[8px] font-bold uppercase text-koma-muted">aguardando/preparo</span>
            </div>
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2">
              <strong className="block font-mono text-sm text-emerald-400">{courierBuckets.ready.length}</strong>
              <span className="text-[8px] font-bold uppercase text-koma-muted">prontas</span>
            </div>
            <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 px-3 py-2">
              <strong className="block font-mono text-sm text-sky-400">{courierBuckets.inTransit.length}</strong>
              <span className="text-[8px] font-bold uppercase text-koma-muted">em rota</span>
            </div>
          </div>
        </div>

        {deliveryOrdersLoadState === 'loading' && deliveryOrders.length === 0 && (
          <div className="mt-4 rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-[9px] text-koma-muted" role="status">
            Sincronizando entregas…
          </div>
        )}
        {deliveryOrdersLoadState === 'error' && (
          <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[9px] text-amber-400" role="status">
            Não foi possível atualizar os pedidos agora. Mostrando o último estado conhecido.
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-3">
        <section className="rounded-2xl border border-koma-border bg-koma-card/45 p-4">
          <div className="mb-3">
            <h3 className="text-xs font-extrabold text-koma-foreground">Aguardando e em preparo</h3>
            <p className="mt-0.5 text-[9px] text-koma-muted">Aceite ou recuse novos pedidos; depois organize entregador e preparo.</p>
          </div>
          <div className="space-y-2">
            {courierBuckets.preparing.length === 0 ? (
              <div className="rounded-xl border border-dashed border-koma-border py-9 text-center text-[10px] text-koma-muted">
                Nenhuma entrega aguardando preparo.
              </div>
            ) : courierBuckets.preparing.map((order) => {
              const awaitingAcceptance = order.status === 'analise' || order.status === 'pendente';
              const pending = pendingIds.has(order.id);
              return (
                <article key={order.id} className="rounded-2xl border border-l-4 border-koma-border border-l-violet-500/70 bg-koma-panel/50 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-[11px] text-koma-foreground">Pedido {order.numeroPedido ? `#${order.numeroPedido}` : order.id}</strong>
                    <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-amber-500">
                      {awaitingAcceptance ? 'Aguardando aceite' : 'Em preparo'}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] font-bold text-koma-secondary">{order.cliente}{order.telefone ? ` · ${order.telefone}` : ''}</p>
                  <p className="mt-1 break-words text-[9px] text-koma-muted">{order.endereco || 'Endereço não informado'}</p>
                  <p className="mt-1 truncate font-mono text-[9px] text-koma-muted">Itens: {order.itens}</p>
                  <p className={`mt-2 text-[9px] font-bold ${order.pago ? 'text-emerald-500' : 'text-amber-500'}`}>
                    {getDigitalOrderPaymentSummary(order)}
                  </p>

                  {!awaitingAcceptance && (
                    <div className="mt-3">
                      {renderCourierSelect(order, 'Pré-atribuir entregador')}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => openDeliveryOrderDetails(order)} className="rounded-xl border border-koma-border px-3 py-2 text-[9px] font-bold text-koma-secondary hover:bg-koma-card">
                      Ver pedido
                    </button>
                    {awaitingAcceptance ? (
                      <>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => void runOrderAction(order.id, () => handleAcceptPendingDeliveryOrder(order))}
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
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => void runOrderAction(order.id, () => handleAdvanceDigitalOrder(order))}
                        className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-[9px] font-extrabold text-emerald-500 disabled:opacity-50"
                      >
                        {pending ? 'Atualizando…' : 'Marcar pronto para sair'}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-emerald-500/20 bg-koma-card/45 p-4">
          <div className="mb-3">
            <h3 className="text-xs font-extrabold text-koma-foreground">Prontos para sair</h3>
            <p className="mt-0.5 text-[9px] text-koma-muted">Confirme o entregador e a saída. O pedido só entra em rota depois desta ação.</p>
          </div>
          <div className="space-y-2">
            {courierBuckets.ready.length === 0 ? (
              <div className="rounded-xl border border-dashed border-koma-border py-9 text-center text-[10px] text-koma-muted">
                Nenhuma entrega pronta aguardando saída.
              </div>
            ) : courierBuckets.ready.map((order) => {
              const motoboyId = selectedMotoboys[order.id] || (order.motoboyId ? String(order.motoboyId) : '');
              const pending = pendingIds.has(order.id);
              return (
                <article key={order.id} className="rounded-2xl border border-l-4 border-emerald-500/25 border-l-violet-500/70 bg-koma-panel p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-[11px] text-koma-foreground">Pedido {order.numeroPedido ? `#${order.numeroPedido}` : order.id}</strong>
                    <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-emerald-500">Pronto</span>
                  </div>
                  <p className="mt-1 text-[10px] font-bold text-koma-secondary">{order.cliente}{order.telefone ? ` · ${order.telefone}` : ''}</p>
                  <p className="mt-1 break-words text-[9px] text-koma-muted">{order.endereco || 'Endereço não informado'}</p>
                  <p className="mt-1 truncate font-mono text-[9px] text-koma-muted">Itens: {order.itens}</p>
                  <p className={`mt-2 text-[9px] font-bold ${order.pago ? 'text-emerald-500' : 'text-amber-500'}`}>
                    {getDigitalOrderPaymentSummary(order)}
                  </p>

                  <div className="mt-3">{renderCourierSelect(order, 'Entregador')}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => openDeliveryOrderDetails(order)} className="rounded-xl border border-koma-border px-3 py-2 text-[9px] font-bold text-koma-secondary hover:bg-koma-card">
                      Ver pedido
                    </button>
                    <button
                      type="button"
                      disabled={!motoboyId || motoboysLoadState !== 'loaded' || pending}
                      onClick={() => void runOrderAction(order.id, () => handleDespacharKanban(order.id, motoboyId))}
                      className="rounded-xl bg-emerald-600 px-3 py-2 text-[9px] font-extrabold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {pending ? 'Despachando…' : 'Saiu para entrega'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-sky-500/20 bg-koma-card/45 p-4">
          <div className="mb-3">
            <h3 className="text-xs font-extrabold text-koma-foreground">Em rota</h3>
            <p className="mt-0.5 text-[9px] text-koma-muted">Confira cobrança e conclua quando o entregador confirmar a entrega.</p>
          </div>
          <div className="space-y-2">
            {courierBuckets.inTransit.length === 0 ? (
              <div className="rounded-xl border border-dashed border-koma-border py-9 text-center text-[10px] text-koma-muted">
                Nenhum pedido em rota no momento.
              </div>
            ) : courierBuckets.inTransit.map((order) => {
              const pending = pendingIds.has(order.id);
              return (
                <article key={order.id} className="rounded-2xl border border-sky-500/20 bg-koma-panel/45 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-[11px] text-koma-foreground">Pedido {order.numeroPedido ? `#${order.numeroPedido}` : order.id}</strong>
                    <span className="rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-sky-500">Em rota</span>
                  </div>
                  <p className="mt-1 text-[10px] font-bold text-koma-secondary">{order.cliente}{order.telefone ? ` · ${order.telefone}` : ''}</p>
                  <p className="mt-1 break-words text-[9px] text-koma-muted">{order.endereco || 'Endereço não informado'}</p>
                  <p className="mt-1 text-[9px] font-bold text-sky-500">
                    Entregador: {courierName(order.motoboyId) || (order.motoboyId ? `#${order.motoboyId}` : 'não identificado')}
                  </p>
                  <p className={`mt-2 text-[9px] font-bold ${order.pago ? 'text-emerald-500' : 'text-amber-500'}`}>
                    {getDigitalOrderPaymentSummary(order)}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => openDeliveryOrderDetails(order)} className="rounded-xl border border-koma-border px-3 py-2 text-[9px] font-bold text-koma-secondary hover:bg-koma-card">
                      Ver pedido
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void runOrderAction(order.id, () => handleFinalizarPedido(order.id))}
                      className="rounded-xl bg-sky-600 px-3 py-2 text-[9px] font-extrabold text-white hover:bg-sky-500 disabled:opacity-50"
                    >
                      {pending
                        ? order.pago ? 'Concluindo…' : 'Abrindo recebimento…'
                        : order.pago ? 'Marcar entregue' : 'Receber e marcar entregue'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-koma-border bg-koma-card/45 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-extrabold text-koma-foreground">Entregas concluídas hoje</h3>
            <p className="mt-0.5 text-[9px] text-koma-muted">Consulta rápida das entregas já encerradas neste dia local.</p>
          </div>
          <span className="rounded-full bg-koma-panel px-2 py-1 font-mono text-[9px] font-bold text-koma-muted">{completedToday.length}</span>
        </div>

        {historyError && (
          <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[9px] text-amber-400">
            Não foi possível atualizar o histórico agora. As entregas ativas continuam disponíveis normalmente.
          </div>
        )}

        {completedToday.length === 0 ? (
          <div className="rounded-xl border border-dashed border-koma-border py-9 text-center text-[10px] text-koma-muted">
            Nenhuma entrega concluída hoje.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {completedToday.map((order) => (
              <article key={order.id} className="rounded-xl border border-koma-border bg-koma-panel/45 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="text-[11px] text-koma-foreground">Pedido {order.numero_pedido ? `#${order.numero_pedido}` : order.id}</strong>
                    <p className="mt-1 text-[10px] font-bold text-koma-secondary">
                      {order.identificador || 'Cliente sem nome'}{order.delivery_telefone ? ` · ${order.delivery_telefone}` : ''}
                    </p>
                    <p className="mt-1 truncate text-[9px] text-koma-muted">{order.delivery_endereco || 'Endereço não informado'}</p>
                    {order.motoboy_id && (
                      <p className="mt-1 text-[9px] text-koma-muted">Entregador: {courierName(order.motoboy_id) || `#${order.motoboy_id}`}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="block text-[8px] font-extrabold uppercase text-emerald-500">Entregue</span>
                    <span className="mt-1 block font-mono text-[10px] text-koma-muted">{clock(order.fechado_em)}</span>
                    <span className="mt-1 block text-[10px] font-bold text-koma-foreground">{money(completedTotal(order))}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <details className="rounded-2xl border border-koma-border bg-koma-card/40 p-4">
        <summary className="cursor-pointer text-[10px] font-extrabold uppercase tracking-wider text-koma-secondary">
          Gerenciar entregadores
        </summary>
        <p className="mt-2 text-[9px] text-koma-muted">
          Cadastro e revogação ficam aqui como manutenção secundária; a atribuição diária permanece nos pedidos.
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
                  <span className="block font-mono text-[10px] text-koma-muted">{motoboy.telefone}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase ${motoboy.ativo ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                    {motoboy.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                  {motoboy.ativo && (
                    <button
                      type="button"
                      onClick={() => handleRevogarAcessoMotoboy(String(motoboy.id))}
                      className="rounded-lg border border-rose-500/30 px-2 py-1 text-[8px] font-bold uppercase text-rose-500 hover:bg-rose-500/10"
                    >
                      Revogar acesso
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={(event) => handleAddMotoboy(event, novoMotoboyNome, novoMotoboyTelefone)} className="space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">Novo entregador</span>
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
            <button type="submit" disabled={motoboysLoadState !== 'loaded'} className="w-full rounded-xl bg-emerald-600 py-2 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-emerald-500 disabled:opacity-50">
              Adicionar entregador
            </button>
          </form>
        </div>
      </details>
    </div>
  );
}
