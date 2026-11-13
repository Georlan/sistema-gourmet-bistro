import { OrderItemComposition } from '../../shared/OrderItemComposition';
import { Check, ChevronRight, Search, UtensilsCrossed, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KitchenTimer } from './KitchenTimer';
import type { useCashierOrders } from '../orders/useCashierOrders';
import {
  getKdsDestinationLabel,
  getKdsTicketLabel,
  matchesKdsTicketQuery,
  projectKdsDemand,
  projectKdsTickets,
  type KdsKitchenItem,
  type KdsTicket,
} from './kdsProjection';

type KdsFilter = 'todos' | 'preparo' | 'prontos';

type KitchenProps = Pick<ReturnType<typeof useCashierOrders>, 'handleUpdateItemStatus'> & {
  activeSubTab: string;
  activeKitchenItems: KdsKitchenItem[];
  mode?: 'kds' | 'queue' | 'standalone';
};

const sourceLabel = (source: KdsTicket['origemOperacional']) => ({
  cardapio: 'Online', smartpos: 'SmartPOS', caixa: 'Caixa', garcom: 'Garçom', desconhecida: 'Origem não informada',
})[source || 'desconhecida'];

/** The same item/status projection powers Caixa, the KDS and the staff kitchen portal.
 * Kitchen preparation never owns delivery/serving or the financial order state. */
export function CashierKitchen({ activeSubTab, activeKitchenItems, handleUpdateItemStatus, mode = 'kds' }: KitchenProps) {
  const active = mode === 'standalone' || activeSubTab === (mode === 'kds' ? 'kds' : 'preparo');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<KdsFilter>('todos');
  const [clock, setClock] = useState(() => Date.now());
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const pendingRef = useRef(new Set<string>());
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  // One clock per screen, not one timer per ticket. Avoid background work.
  useEffect(() => {
    if (!active) return;
    const tick = () => { if (!document.hidden) setClock(Date.now()); };
    tick();
    const interval = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', tick); };
  }, [active]);

  const projection = useMemo(() => projectKdsTickets(activeKitchenItems), [activeKitchenItems]);
  const demand = useMemo(() => projectKdsDemand(activeKitchenItems), [activeKitchenItems]);
  const visible = useMemo(() => projection.tickets.filter(ticket =>
    (filter === 'todos' || (filter === 'preparo' ? ticket.preparingCount > 0 : ticket.preparingCount === 0))
    && matchesKdsTicketQuery(ticket, query)
  ), [projection.tickets, filter, query]);

  /** Mark only persisted unfinished items. Stop on the first failed request so
   * partial success is never presented as a successful bulk operation. */
  const markReady = async (items: readonly KdsKitchenItem[]) => {
    const targets = items.filter(item => item.status === 'preparando' && !pendingRef.current.has(item.id));
    if (!targets.length) return;
    for (const item of targets) pendingRef.current.add(item.id);
    setPendingIds(new Set(pendingRef.current));
    setErrorNotice(null);
    let completed = 0;
    try {
      for (const item of targets) {
        let saved = false;
        try { saved = await handleUpdateItemStatus(item.id, 'pronto'); }
        catch (error) { console.error('KDS item update failed', error); }
        if (!saved) break;
        completed += 1;
      }
      if (completed !== targets.length) {
        setErrorNotice(completed > 0
          ? `${completed} de ${targets.length} itens confirmados. Confira os itens restantes antes de tentar novamente.`
          : 'Não foi possível confirmar o preparo. Confira a conexão e tente novamente.');
      }
    } finally {
      for (const item of targets) pendingRef.current.delete(item.id);
      setPendingIds(new Set(pendingRef.current));
    }
  };

  const renderTicket = (ticket: KdsTicket) => {
    const waiting = ticket.preparingCount > 0;
    const readyToConfirm = ticket.items.filter(item => item.status === 'preparando');
    const isPending = ticket.items.some(item => pendingIds.has(item.id));
    const source = sourceLabel(ticket.origemOperacional);
    return <article key={ticket.key} className="kds-ticket" data-kds-ticket={ticket.key} data-stage={waiting ? 'preparo' : 'pronto'}>
      <header className="kds-ticket__header">
        <div className="kds-ticket__heading">
          <div className="kds-ticket__title-row">
            <h3>Pedido {getKdsTicketLabel(ticket)}</h3>
            <span className="kds-ticket__destination">{getKdsDestinationLabel(ticket)}</span>
          </div>
          <div className="kds-ticket__meta">
            {ticket.identificador && <span>{ticket.identificador}</span>}
            {source && <span>{source}</span>}
            {ticket.garcomNome && <span>{ticket.garcomNome}</span>}
          </div>
        </div>
        <KitchenTimer itemTimestamp={ticket.timestamp} status={waiting ? 'preparando' : 'pronto'} now={clock} />
      </header>

      <div className="kds-ticket__progress">
        <span>{waiting ? `${ticket.readyCount} de ${ticket.totalCount} prontos` : `${ticket.totalCount} ${ticket.totalCount === 1 ? 'item pronto' : 'itens prontos'}`}</span>
        {!waiting && <span>Para expedição</span>}
        {waiting && ticket.deliveryStatus === 'aceito' && <span>Pedido aceito</span>}
      </div>
      <div className="kds-ticket__items">
        {ticket.items.map(item => {
          const ready = item.status === 'pronto';
          const pending = pendingIds.has(item.id);
          return <div className="kds-ticket__item" key={item.id} id={`kitchen-card-${item.id}`} data-kds-item-status={item.status}>
            <span className="kds-ticket__item-indicator" data-state={item.status} aria-hidden="true" />
            <div className="kds-ticket__item-description">
              <strong>{item.nome}</strong>
              {item.clienteNome && item.clienteNome !== 'Consumo Geral' && <small>{item.clienteNome}</small>}
              <OrderItemComposition item={item} />
            </div>
            {ready
              ? <span className="kds-ticket__item-complete"><Check size={15} aria-hidden="true" /> Pronto</span>
              : <button type="button" id={`kitchen-finish-btn-${item.id}`} className="kds-ticket__item-action" disabled={pending || isPending}
                  aria-label={`Marcar como pronto: ${item.nome}`}
                  onClick={() => void markReady([item])}>{pending ? 'Salvando…' : 'Pronto'}</button>}
          </div>;
        })}
      </div>
      {readyToConfirm.length > 1 && <footer className="kds-ticket__footer">
        <button type="button" className="kds-ticket__batch-action" disabled={isPending}
          onClick={() => void markReady(readyToConfirm)}>
          {isPending ? 'Confirmando…' : `Concluir ${readyToConfirm.length} itens`}
          {!isPending && <ChevronRight size={16} aria-hidden="true" />}
        </button>
      </footer>}
    </article>;
  };

  if (!active) return null;
  return <section className="kds-workspace" aria-label="Fila da cozinha" data-kitchen-mode={mode}>
    <header className="kds-workspace__header">
      <div className="kds-workspace__heading">
        <div className="kds-workspace__symbol" aria-hidden="true"><UtensilsCrossed size={20}/></div>
        <div><h2>Cozinha</h2><p>Produção e expedição</p></div>
      </div>
      <span className="kds-workspace__total">{projection.tickets.length} {projection.tickets.length === 1 ? 'pedido' : 'pedidos'}</span>
    </header>

    <div className="kds-workspace__controls">
      <div className="kds-workspace__filters" role="group" aria-label="Filtrar tickets da cozinha">
        {([
          { key: 'todos', label: 'Todos', count: projection.tickets.length },
          { key: 'preparo', label: 'Em preparo', count: projection.preparingTickets.length },
          { key: 'prontos', label: 'Prontos', count: projection.readyTickets.length },
        ] as const).map(option => <button key={option.key} type="button" aria-pressed={filter === option.key}
          className="kds-workspace__filter" onClick={() => setFilter(option.key)}>
          {option.label} <span>{option.count}</span>
        </button>)}
      </div>
      {projection.tickets.length > 0 && <label className="kds-workspace__search">
        <Search size={17} aria-hidden="true"/><span className="sr-only">Buscar tickets da cozinha</span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Buscar pedido, mesa ou item" />
        {query && <button type="button" aria-label="Limpar busca" onClick={() => setQuery('')}><X size={17} /></button>}
      </label>}
    </div>

    {errorNotice && <div className="kds-workspace__error" role="alert">{errorNotice}<button type="button" onClick={() => setErrorNotice(null)} aria-label="Dispensar aviso"><X size={16}/></button></div>}

    {demand.length > 0 && <details className="kds-workspace__demand">
      <summary>Produção total <span>{projection.preparingItemCount} {projection.preparingItemCount === 1 ? 'item pendente' : 'itens pendentes'}</span></summary>
      <div className="kds-workspace__demand-items">
        {demand.map(line => <div key={line.key} className="kds-workspace__demand-row">
          <strong>{line.count}× {line.name}</strong>
          {line.details.length > 0 && <span>{line.details.join(' · ')}</span>}
        </div>)}
      </div>
    </details>}

    {projection.tickets.length === 0
      ? <div className="kds-workspace__empty"><strong>Nenhum pedido na cozinha</strong><p>Os próximos lançamentos aparecerão nesta fila.</p></div>
      : visible.length === 0
        ? <div className="kds-workspace__empty"><strong>Nenhum pedido neste filtro</strong><p>Experimente outra etapa ou limpe a busca.</p></div>
        : <div className="kds-workspace__tickets">{visible.map(renderTicket)}</div>}
  </section>;
}
