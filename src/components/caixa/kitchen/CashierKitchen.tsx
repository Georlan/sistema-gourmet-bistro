import { ChefHat, Check, CircleDot, PackageCheck, Search, UtensilsCrossed } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { useCashierOrders } from '../orders/useCashierOrders';
import { KitchenTimer as KDSTimer } from './KitchenTimer';
import {
  getKdsDestinationLabel,
  getKdsTicketLabel,
  matchesKdsTicketQuery,
  projectKdsTickets,
  type KdsKitchenItem,
  type KdsTicket,
} from './kdsProjection';

type BoundaryProps = Pick<ReturnType<typeof useCashierOrders>, 'handleUpdateItemStatus'> & {
  activeSubTab: string;
  activeKitchenItems: KdsKitchenItem[];
  mode?: 'kds' | 'queue';
};

const toTimerTimestamp = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (value instanceof Date) return value.toISOString();
  return undefined;
};

const originLabel = (origin: KdsTicket['origemOperacional']) => {
  if (origin === 'cardapio') return 'Cardápio online';
  if (origin === 'smartpos') return 'SmartPOS';
  if (origin === 'caixa') return 'Caixa';
  if (origin === 'garcom') return 'Garçom';
  return null;
};

/**
 * Kitchen view over the canonical item statuses owned by the order flow.
 * Caixa and KDS therefore converge on the same preparing/ready/delivered state.
 */
export function CashierKitchen({ activeSubTab, activeKitchenItems, handleUpdateItemStatus, mode = 'kds' }: BoundaryProps) {
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const projection = useMemo(() => projectKdsTickets(activeKitchenItems), [activeKitchenItems]);
  const visiblePreparingTickets = useMemo(
    () => projection.preparingTickets.filter((ticket) => matchesKdsTicketQuery(ticket, searchQuery)),
    [projection.preparingTickets, searchQuery],
  );
  const visibleReadyTickets = useMemo(
    () => projection.readyTickets.filter((ticket) => matchesKdsTicketQuery(ticket, searchQuery)),
    [projection.readyTickets, searchQuery],
  );

  const expectedSubTab = mode === 'kds' ? 'kds' : 'preparo';
  if (activeSubTab !== expectedSubTab) return null;

  const runTransition = async (
    items: readonly KdsKitchenItem[],
    newStatus: 'pronto' | 'entregue',
  ) => {
    const ids = items.map((item) => item.id).filter((id) => !pendingItemIds.has(id));
    if (ids.length === 0) return;

    setPendingItemIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.add(id));
      return next;
    });

    try {
      await Promise.all(ids.map((id) => handleUpdateItemStatus(id, newStatus)));
    } finally {
      setPendingItemIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const advanceItem = async (item: KdsKitchenItem) => {
    await runTransition([item], item.status === 'preparando' ? 'pronto' : 'entregue');
  };

  const advanceTicket = async (ticket: KdsTicket) => {
    const preparingItems = ticket.items.filter((item) => item.status === 'preparando');
    if (preparingItems.length > 0) {
      await runTransition(preparingItems, 'pronto');
      return;
    }

    await runTransition(
      ticket.items.filter((item) => item.status === 'pronto'),
      'entregue',
    );
  };

  const renderTicket = (ticket: KdsTicket) => {
    const ready = ticket.preparingCount === 0;
    const source = originLabel(ticket.origemOperacional);
    const actionableItems = ready
      ? ticket.items.filter((item) => item.status === 'pronto')
      : ticket.items.filter((item) => item.status === 'preparando');
    const ticketPending = actionableItems.some((item) => pendingItemIds.has(item.id));

    return (
      <article
        key={ticket.key}
        className={`overflow-hidden rounded-2xl border bg-koma-card shadow-sm ${
          ready ? 'border-emerald-500/30' : 'border-koma-border'
        }`}
      >
        <header className="space-y-3 border-b border-koma-border px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-extrabold text-koma-foreground">
                  {getKdsTicketLabel(ticket)}
                </span>
                <span className="rounded-md border border-koma-border bg-koma-panel px-2 py-0.5 font-mono text-[10px] font-bold text-koma-muted">
                  {getKdsDestinationLabel(ticket)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-koma-muted">
                {ticket.identificador && <span>{ticket.identificador}</span>}
                {source && <span>{source}</span>}
                <span>Lançado por {ticket.garcomNome}</span>
              </div>
            </div>
            <KDSTimer
              itemTimestamp={toTimerTimestamp(ticket.timestamp)}
              status={ready ? 'pronto' : 'preparando'}
            />
          </div>

          <div className="flex items-center justify-between gap-3 text-[10px]">
            <span className="font-semibold text-koma-muted">
              {ready
                ? `${ticket.readyCount} ${ticket.readyCount === 1 ? 'item pronto' : 'itens prontos'}`
                : `${ticket.readyCount}/${ticket.totalCount} prontos`}
            </span>
            {!ready && ticket.readyCount > 0 && (
              <span className="font-bold text-emerald-500">Parcialmente pronto</span>
            )}
          </div>

          {!ready && ticket.totalCount > 1 && (
            <div className="h-1 overflow-hidden rounded-full bg-koma-panel" aria-hidden="true">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.round((ticket.readyCount / ticket.totalCount) * 100)}%` }}
              />
            </div>
          )}
        </header>

        <div className="divide-y divide-koma-border/70">
          {ticket.items.map((item) => {
            const itemReady = item.status === 'pronto';
            const pending = pendingItemIds.has(item.id);
            return (
              <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                <div
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    itemReady ? 'bg-emerald-500' : 'bg-amber-400'
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <strong className="text-xs text-koma-foreground">{item.nome}</strong>
                    {item.clienteNome && item.clienteNome !== 'Consumo Geral' && (
                      <span className="rounded bg-koma-panel px-1.5 py-0.5 text-[9px] font-semibold text-koma-muted">
                        {item.clienteNome}
                      </span>
                    )}
                  </div>
                  {item.observacao && (
                    <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-2.5 py-2 text-[10px] font-bold leading-relaxed text-rose-400">
                      {item.observacao}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void advanceItem(item)}
                  className={`shrink-0 rounded-lg border px-3 py-2 text-[9px] font-extrabold uppercase tracking-wide transition disabled:cursor-wait disabled:opacity-50 ${
                    itemReady
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                      : 'border-emerald-500 bg-emerald-500 text-[#101411] hover:bg-emerald-400'
                  }`}
                  aria-label={`${itemReady ? 'Marcar como entregue' : 'Marcar como pronto'}: ${item.nome}`}
                >
                  {pending ? 'Salvando…' : itemReady ? 'Entregue' : 'Pronto'}
                </button>
              </div>
            );
          })}
        </div>

        {actionableItems.length > 1 && (
          <div className="border-t border-koma-border bg-koma-panel/35 p-3">
            <button
              type="button"
              disabled={ticketPending}
              onClick={() => void advanceTicket(ticket)}
              className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[9px] font-extrabold uppercase tracking-wide transition disabled:cursor-wait disabled:opacity-50 ${
                ready
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                  : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
              }`}
            >
              <Check size={12} />
              {ticketPending
                ? 'Atualizando ticket…'
                : ready
                  ? `Marcar ${actionableItems.length} itens como entregues`
                  : `Marcar ${actionableItems.length} restantes como prontos`}
            </button>
          </div>
        )}
      </article>
    );
  };

  const renderLane = (
    title: string,
    subtitle: string,
    tickets: KdsTicket[],
    totalTickets: number,
    readyLane = false,
  ) => (
    <section className="min-w-0 rounded-2xl border border-koma-border bg-koma-page/40 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div>
          <h3 className="flex items-center gap-2 text-xs font-extrabold text-koma-foreground">
            {readyLane ? <PackageCheck size={15} /> : <UtensilsCrossed size={15} />}
            {title}
          </h3>
          <p className="mt-0.5 text-[10px] text-koma-muted">{subtitle}</p>
        </div>
        <span
          className={`rounded-full px-2 py-1 font-mono text-[10px] font-bold ${
            readyLane
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-amber-500/10 text-amber-400'
          }`}
        >
          {searchQuery.trim() ? `${tickets.length}/${totalTickets}` : tickets.length}
        </span>
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-koma-border px-4 py-10 text-center text-[10px] text-koma-muted">
          {searchQuery.trim()
            ? 'Nenhum ticket desta etapa corresponde à busca.'
            : readyLane
              ? 'Nada aguardando saída.'
              : 'Nenhum ticket em preparo.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{tickets.map(renderTicket)}</div>
      )}
    </section>
  );

  if (mode === 'queue') {
    return (
      <div className="space-y-4 rounded-3xl border border-koma-border bg-koma-card/60 p-4 sm:p-5" data-kitchen-mode="queue">
        <div className="flex flex-col gap-3 border-b border-koma-border pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-emerald-400">
              <ChefHat size={20} />
            </div>
            <div>
              <h2 className="font-serif text-base font-bold text-koma-secondary">Fila de preparo</h2>
              <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-koma-muted">
                Acompanhe o que está sendo preparado e marque itens como prontos ou entregues. Esta fila na tela funciona sem impressão física.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold">
            <span className="rounded-full bg-amber-500/10 px-2.5 py-1.5 text-amber-400">{projection.preparingItemCount} em preparo</span>
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1.5 text-emerald-400">{projection.readyItemCount} prontos</span>
          </div>
        </div>

        {projection.tickets.length === 0 ? (
          <div className="py-20 text-center">
            <ChefHat size={30} className="mx-auto mb-3 text-koma-muted/40" />
            <p className="font-serif text-base font-bold text-koma-foreground">Nada para preparar agora</p>
            <p className="mt-1 text-[10px] text-koma-muted">Novos pedidos aparecem aqui automaticamente.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{projection.tickets.map(renderTicket)}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-3xl border border-koma-border bg-koma-card/60 p-4 sm:p-5">
      <div className="flex flex-col gap-4 border-b border-koma-border pb-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-emerald-400">
            <ChefHat size={20} />
          </div>
          <div>
            <h2 className="font-serif text-base font-bold text-koma-secondary">Produção da cozinha</h2>
            <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-koma-muted">
              Mesma fila operacional do Caixa, organizada por tickets para a cozinha. Alterações feitas no Caixa aparecem aqui e vice-versa.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-koma-border bg-koma-panel px-2.5 py-1.5 text-[10px] font-bold text-koma-foreground">
            <CircleDot size={11} className="text-emerald-400" />
            {projection.tickets.length} {projection.tickets.length === 1 ? 'ticket' : 'tickets'}
          </span>
          <span className="rounded-full bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-bold text-amber-400">
            {projection.preparingItemCount} em preparo
          </span>
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1.5 text-[10px] font-bold text-emerald-400">
            <Check size={11} /> {projection.readyItemCount} prontos
          </span>
        </div>
      </div>

      {projection.tickets.length > 0 && (
        <label className="flex max-w-xl items-center gap-2 rounded-xl border border-koma-border bg-koma-page px-3 py-2.5 focus-within:border-emerald-500/50">
          <Search size={14} className="shrink-0 text-koma-muted" aria-hidden="true" />
          <span className="sr-only">Buscar tickets da cozinha</span>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Buscar mesa, pedido, cliente, item ou observação"
            className="min-w-0 flex-1 bg-transparent text-xs text-koma-foreground outline-none placeholder:text-koma-muted"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="shrink-0 rounded-md px-2 py-1 text-[9px] font-bold text-koma-muted hover:bg-koma-panel hover:text-koma-foreground"
            >
              Limpar
            </button>
          )}
        </label>
      )}

      {projection.tickets.length === 0 ? (
        <div className="py-24 text-center">
          <ChefHat size={34} className="mx-auto mb-3 text-koma-muted/40" />
          <p className="font-serif text-base font-bold text-koma-foreground">Cozinha limpa</p>
          <p className="mt-1 text-[10px] text-koma-muted">Novos lançamentos aparecerão aqui automaticamente.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-2">
          {renderLane(
            'Em produção',
            'Tickets com pelo menos um item ainda em preparo.',
            visiblePreparingTickets,
            projection.preparingTickets.length,
          )}
          {renderLane(
            'Prontos para sair',
            'Tickets cujos itens ativos já estão prontos.',
            visibleReadyTickets,
            projection.readyTickets.length,
            true,
          )}
        </div>
      )}
    </div>
  );
}
