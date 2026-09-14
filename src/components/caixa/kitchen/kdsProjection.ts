import type { Order, OrderItem } from '../../../types';

export type KdsKitchenItem = OrderItem &
  Pick<
    Order,
    'mesaId' | 'garcomNome' | 'displayNumber' | 'numeroPedido' | 'tipo' | 'origemOperacional' | 'identificador'
  > & {
    orderId: Order['id'];
    timestamp: unknown;
  };

export interface KdsTicket {
  key: string;
  orderId: Order['id'];
  launchId?: string;
  mesaId: number;
  garcomNome: string;
  displayNumber?: string;
  numeroPedido?: number;
  tipo?: Order['tipo'];
  origemOperacional?: Order['origemOperacional'];
  identificador?: string;
  timestamp: unknown;
  items: KdsKitchenItem[];
  preparingCount: number;
  readyCount: number;
  totalCount: number;
}

export interface KdsProjection {
  tickets: KdsTicket[];
  preparingTickets: KdsTicket[];
  readyTickets: KdsTicket[];
  preparingItemCount: number;
  readyItemCount: number;
}

const timestampValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.MAX_SAFE_INTEGER;
};

const ticketKeyFor = (item: KdsKitchenItem) =>
  item.lancamentoId ? `launch:${item.lancamentoId}` : `order:${item.orderId}`;

const normalizeSearchText = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/**
 * KDS is a projection of the same item states used by Caixa.
 * It never owns a second order state machine: when Caixa changes item statuses,
 * rebuilding this projection moves the affected ticket automatically.
 */
export function projectKdsTickets(items: readonly KdsKitchenItem[]): KdsProjection {
  const grouped = new Map<string, KdsTicket>();

  for (const item of items) {
    const key = ticketKeyFor(item);
    const current = grouped.get(key);

    if (current) {
      current.items.push(item);
      if (timestampValue(item.timestamp) < timestampValue(current.timestamp)) {
        current.timestamp = item.timestamp;
      }
      continue;
    }

    grouped.set(key, {
      key,
      orderId: item.orderId,
      launchId: item.lancamentoId,
      mesaId: item.mesaId,
      garcomNome: item.garcomNome,
      displayNumber: item.displayNumber,
      numeroPedido: item.numeroPedido,
      tipo: item.tipo,
      origemOperacional: item.origemOperacional,
      identificador: item.identificador,
      timestamp: item.timestamp,
      items: [item],
      preparingCount: 0,
      readyCount: 0,
      totalCount: 0,
    });
  }

  const tickets = Array.from(grouped.values())
    .map((ticket) => {
      const preparingCount = ticket.items.filter((item) => item.status === 'preparando').length;
      const readyCount = ticket.items.filter((item) => item.status === 'pronto').length;
      return {
        ...ticket,
        items: [...ticket.items].sort((a, b) => {
          if (a.status !== b.status) return a.status === 'preparando' ? -1 : 1;
          return a.nome.localeCompare(b.nome, 'pt-BR');
        }),
        preparingCount,
        readyCount,
        totalCount: preparingCount + readyCount,
      };
    })
    .sort((a, b) => timestampValue(a.timestamp) - timestampValue(b.timestamp));

  const preparingTickets = tickets.filter((ticket) => ticket.preparingCount > 0);
  const readyTickets = tickets.filter((ticket) => ticket.preparingCount === 0 && ticket.readyCount > 0);

  return {
    tickets,
    preparingTickets,
    readyTickets,
    preparingItemCount: tickets.reduce((total, ticket) => total + ticket.preparingCount, 0),
    readyItemCount: tickets.reduce((total, ticket) => total + ticket.readyCount, 0),
  };
}

export function getKdsTicketLabel(ticket: Pick<KdsTicket, 'displayNumber' | 'numeroPedido' | 'orderId'>) {
  if (ticket.displayNumber) return `#${ticket.displayNumber.replace(/^#/, '')}`;
  if (ticket.numeroPedido !== undefined) return `#${ticket.numeroPedido}`;
  return `#${String(ticket.orderId).slice(-6)}`;
}

export function getKdsDestinationLabel(ticket: Pick<KdsTicket, 'mesaId' | 'tipo'>) {
  if (ticket.mesaId > 0) return `Mesa ${ticket.mesaId}`;

  const normalizedType = normalizeSearchText(ticket.tipo);
  if (normalizedType === 'entrega' || normalizedType === 'delivery') return 'Delivery';
  if (normalizedType === 'retirada') return 'Retirada';
  return 'Balcão';
}

/** Search stays presentation-only and never changes operational membership/status. */
export function matchesKdsTicketQuery(ticket: KdsTicket, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const searchable = [
    getKdsDestinationLabel(ticket),
    getKdsTicketLabel(ticket),
    ticket.identificador,
    ticket.garcomNome,
    ticket.origemOperacional,
    ...ticket.items.flatMap((item) => [item.nome, item.observacao, item.clienteNome, item.cliente_nome]),
  ]
    .map(normalizeSearchText)
    .filter(Boolean)
    .join(' ');

  return searchable.includes(normalizedQuery);
}
