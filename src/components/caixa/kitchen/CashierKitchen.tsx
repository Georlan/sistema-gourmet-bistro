import { Check, ClipboardList, Maximize2, Minimize2, MoreHorizontal, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { itemCompositionPresentation } from '../../../domain/orderItemComposition';
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
  /** One backend transaction for a ticket, when the operator supports it. */
  handleConfirmTicketReady?: (itemIds: string[]) => Promise<boolean>;
  mode?: 'kds' | 'queue' | 'standalone';
};

const isMeaningfulCustomer = (name: string | undefined, destination: string) => {
  const normalized = (name || '').trim().toLocaleLowerCase();
  return !!normalized && normalized !== 'consumo geral' && normalized !== 'balcão'
    && normalized !== destination.toLocaleLowerCase();
};

/** One operational surface for cashier and kitchen-role staff.
 * Cooking changes item status only; serving, payment and fulfillment belong to other areas.
 */
export function CashierKitchen({ activeSubTab, activeKitchenItems, handleUpdateItemStatus, handleConfirmTicketReady, mode = 'kds' }: KitchenProps) {
  const active = mode === 'standalone' || activeSubTab === (mode === 'kds' ? 'kds' : 'preparo');
  const [filter, setFilter] = useState<KdsFilter>('preparo');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [demandOpen, setDemandOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(() => new Set());
  const pendingRef = useRef(new Set<string>());
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) return;
    const tick = () => { if (!document.hidden) setClock(Date.now()); };
    tick();
    const interval = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', tick); };
  }, [active]);
  useEffect(() => {
    if (searchOpen && active) searchRef.current?.focus();
  }, [searchOpen, active]);
  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setFocusMode(false); setToolsOpen(false); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [focusMode]);

  // The API has ACKed these items, but a background snapshot can still be in flight.
  // Keep local confirmed status until canonical props reflect it; never mark failed requests.
  useEffect(() => {
    const remaining = new Set(activeKitchenItems.filter(item => item.status === 'preparando').map(item => item.id));
    setConfirmedIds(previous => {
      if (![...previous].some(id => !remaining.has(id))) return previous;
      return new Set([...previous].filter(id => remaining.has(id)));
    });
  }, [activeKitchenItems]);
  const effectiveItems = useMemo(() => activeKitchenItems.map(item =>
    confirmedIds.has(item.id) && item.status === 'preparando'
      ? { ...item, status: 'pronto' as const }
      : item,
  ), [activeKitchenItems, confirmedIds]);
  const projection = useMemo(() => projectKdsTickets(effectiveItems), [effectiveItems]);
  const demand = useMemo(() => projectKdsDemand(effectiveItems), [effectiveItems]);
  const visible = useMemo(() => {
    // Queue by urgency of work, not by completion age. FIFO within each stage.
    const ordered = filter === 'preparo' ? projection.preparingTickets
      : filter === 'prontos' ? projection.readyTickets
        : [...projection.preparingTickets, ...projection.readyTickets];
    return ordered.filter(ticket => matchesKdsTicketQuery(ticket, query));
  }, [projection, filter, query]);

  const markReady = async (items: readonly KdsKitchenItem[]) => {
    const targets = items.filter(item => item.status === 'preparando'
      && !pendingRef.current.has(item.id) && !confirmedIds.has(item.id));
    if (!targets.length) return;
    targets.forEach(item => pendingRef.current.add(item.id));
    setPendingIds(new Set(pendingRef.current));
    setErrorNotice(null);
    try {
      let saved = false;
      if (targets.length > 1 && handleConfirmTicketReady) {
        saved = await handleConfirmTicketReady(targets.map(item => item.id));
      } else {
        // Only a one-item request in normal use; legacy marketing demo has no batch.
        saved = true;
        for (const item of targets) {
          let confirmed = false;
          try { confirmed = await handleUpdateItemStatus(item.id, 'pronto'); }
          catch (error) { console.error('KDS item confirmation failed', error); }
          if (!confirmed) { saved = false; break; }
          setConfirmedIds(current => new Set(current).add(item.id));
        }
      }
      if (saved) {
        setConfirmedIds(current => new Set([...current, ...targets.map(item => item.id)]));
      } else {
        setErrorNotice('Não foi possível confirmar o preparo. Os itens não confirmados continuam pendentes.');
      }
    } catch (error) {
      console.error('KDS ticket confirmation failed', error);
      setErrorNotice('Falha ao confirmar o preparo. Confira a conexão e tente novamente.');
    } finally {
      targets.forEach(item => pendingRef.current.delete(item.id));
      setPendingIds(new Set(pendingRef.current));
    }
  };

  const renderItem = (item: KdsKitchenItem, destination: string) => {
    const ready = item.status === 'pronto';
    const pending = pendingIds.has(item.id);
    const details = itemCompositionPresentation(item);
    const customerName = item.clienteNome || item.cliente_nome;
    return <div className="kds-ticket__item" key={item.id} id={`kitchen-card-${item.id}`} data-kds-item-status={item.status}>
      <span className="kds-ticket__item-indicator" data-state={item.status} aria-hidden="true" />
      <div className="kds-ticket__item-description">
        <strong>{item.nome}</strong>
        {isMeaningfulCustomer(customerName, destination) && <small>{customerName}</small>}
        {details.lines.map((line, index) => <small key={index} className="kds-ticket__composition">{line}</small>)}
        {details.observation && <small className="kds-ticket__observation"><b>OBS:</b> {details.observation}</small>}
      </div>
      {ready
        ? <span className="kds-ticket__item-complete" title="Preparo confirmado"><Check size={17} aria-hidden="true"/><span className="sr-only">Pronto</span></span>
        : <button type="button" id={`kitchen-finish-btn-${item.id}`} className="kds-ticket__item-action"
            disabled={pending} aria-label={`Marcar como pronto: ${item.nome}`}
            onClick={() => void markReady([item])}>{pending ? 'Salvando…' : <><Check size={17} aria-hidden="true"/> Pronto</>}</button>}
    </div>;
  };

  const renderTicket = (ticket: KdsTicket) => {
    const waiting = ticket.preparingCount > 0;
    const available = ticket.items.filter(item => item.status === 'preparando' && !pendingIds.has(item.id));
    const pendingCount = ticket.items.filter(item => pendingIds.has(item.id)).length;
    const batchTargets = available.slice(0, 40);
    const destination = getKdsDestinationLabel(ticket);
    const readyItems = ticket.items.filter(item => item.status === 'pronto');
    const preparingItems = ticket.items.filter(item => item.status === 'preparando');
    return <article key={ticket.key} className="kds-ticket" data-kds-ticket={ticket.key} data-stage={waiting ? 'preparo' : 'pronto'}>
      <header className="kds-ticket__header">
        <div className="kds-ticket__title-row">
          <h3>Pedido {getKdsTicketLabel(ticket)}</h3>
          <span className="kds-ticket__destination">{destination}</span>
          <KitchenTimer itemTimestamp={ticket.timestamp} status={waiting ? 'preparando' : 'pronto'} now={clock} />
        </div>
        <div className="kds-ticket__underhead">
          <span className="kds-ticket__progress">{waiting ? `${ticket.preparingCount} pendentes${ticket.readyCount ? ` · ${ticket.readyCount} prontos` : ''}` : `${ticket.readyCount} prontos · Para expedição`}</span>
          {ticket.identificador && <span className="kds-ticket__identifier">{ticket.identificador}</span>}
          {waiting && ticket.deliveryStatus === 'aceito' && <span className="kds-ticket__accepted">Aceito</span>}
          {waiting && batchTargets.length > 1 && <button type="button" className="kds-ticket__batch-action"
            onClick={() => void markReady(batchTargets)} aria-label={`Concluir ${batchTargets.length} itens do pedido ${getKdsTicketLabel(ticket)}`}>
            <Check size={16} aria-hidden="true"/> Concluir {batchTargets.length}
          </button>}
          {waiting && pendingCount > 0 && available.length <= 1 && <span className="kds-ticket__saving">{pendingCount} salvando</span>}
        </div>
      </header>
      <div className="kds-ticket__items">{preparingItems.map(item => renderItem(item, destination))}</div>
      {waiting && readyItems.length > 0 ? <details className="kds-ticket__ready-items">
        <summary><Check size={14} aria-hidden="true" /> {readyItems.length} {readyItems.length === 1 ? 'item já pronto' : 'itens já prontos'}</summary>
        <div>{readyItems.map(item => renderItem(item, destination))}</div>
      </details> : !waiting && <div className="kds-ticket__items">{readyItems.map(item => renderItem(item, destination))}</div>}
    </article>;
  };

  if (!active) return null;
  return <section className="kds-workspace" aria-label="Fila da cozinha" data-kitchen-mode={mode} data-focus={focusMode ? 'true' : 'false'}>
    <div className="kds-workspace__toolbar">
      <div className="kds-workspace__filters" role="group" aria-label="Filtrar tickets da cozinha">
        {([
          { key: 'preparo', label: 'Em preparo', count: projection.preparingTickets.length },
          { key: 'prontos', label: 'Prontos', count: projection.readyTickets.length },
          { key: 'todos', label: 'Todos', count: projection.tickets.length },
        ] as const).map(option => <button key={option.key} type="button" aria-pressed={filter === option.key}
          className="kds-workspace__filter" onClick={() => setFilter(option.key)}>{option.label}<span>{option.count}</span></button>)}
      </div>
      <div className="kds-workspace__tools">
        <button type="button" className="kds-workspace__tool" aria-label="Buscar pedido, mesa ou item" aria-pressed={searchOpen}
          onClick={() => { setSearchOpen(value => !value); setToolsOpen(false); }}><Search size={19}/></button>
        <button type="button" className="kds-workspace__tool" aria-label={focusMode ? 'Sair do modo foco' : 'Mais ferramentas da cozinha'}
          aria-expanded={focusMode ? undefined : toolsOpen}
          onClick={() => { if (focusMode) setFocusMode(false); else setToolsOpen(v => !v); }}>
          {focusMode ? <Minimize2 size={19}/> : <MoreHorizontal size={19}/>}
        </button>
        {toolsOpen && <div className="kds-workspace__menu" role="group" aria-label="Ferramentas da cozinha">
          <button type="button" onClick={() => { setDemandOpen(v => !v); setToolsOpen(false); }}><ClipboardList size={17}/> Produção total ({projection.preparingItemCount})</button>
          <button type="button" onClick={() => { setFocusMode(true); setToolsOpen(false); }}><Maximize2 size={17}/> Modo foco</button>
        </div>}
      </div>
    </div>
    {searchOpen && <div className="kds-workspace__search">
      <label className="sr-only" htmlFor="kds-ticket-search">Buscar tickets da cozinha</label>
      <input ref={searchRef} id="kds-ticket-search" type="search" value={query}
        onChange={event => setQuery(event.target.value)} placeholder="Número, mesa, item ou observação"/>
      <button type="button" onClick={() => { setQuery(''); setSearchOpen(false); }} aria-label="Fechar busca"><X size={18}/></button>
    </div>}
    {demandOpen && <section className="kds-workspace__demand" aria-label="Produção total">
      <div className="kds-workspace__demand-head"><strong>Produção total · {projection.preparingItemCount} pendentes</strong>
        <button type="button" aria-label="Fechar produção total" onClick={() => setDemandOpen(false)}><X size={18}/></button></div>
      {demand.length ? <div className="kds-workspace__demand-items">{demand.map(line => <div key={line.key} className="kds-workspace__demand-row"><strong>{line.count}× {line.name}</strong>{line.details.length > 0 && <small>{line.details.join(' · ')}</small>}</div>)}</div>
        : <p className="kds-workspace__demand-empty">Nenhum item pendente.</p>}
    </section>}
    {errorNotice && <div className="kds-workspace__error" role="alert">{errorNotice}<button type="button" onClick={() => setErrorNotice(null)} aria-label="Dispensar aviso"><X size={17}/></button></div>}
    {projection.tickets.length === 0
      ? <div className="kds-workspace__empty"><strong>Fila vazia</strong><p>Sem pedidos aguardando preparo.</p></div>
      : visible.length === 0
        ? <div className="kds-workspace__empty"><strong>Sem pedidos nesta etapa</strong><p>{query ? 'Experimente limpar a busca.' : 'Veja outra etapa.'}</p></div>
        : <div className="kds-workspace__tickets">{visible.map(renderTicket)}</div>}
  </section>;
}
