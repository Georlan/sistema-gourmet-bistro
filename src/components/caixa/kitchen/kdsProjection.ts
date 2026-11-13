import { itemCompositionPresentation } from '../../../domain/orderItemComposition';
import type { Order, OrderItem } from '../../../types';

export type KdsKitchenItem = OrderItem &
  Pick<
    Order,
    'mesaId' | 'garcomNome' | 'displayNumber' | 'numeroPedido' | 'tipo' | 'origemOperacional' | 'identificador' | 'deliveryStatus'
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
  deliveryStatus?: Order['deliveryStatus'];
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

export const timestampValue = (value: unknown): number => {
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

/** A KDS ticket may start only after acceptance; local orders have no gate. */
export const isKdsKitchenOrderEligible = (status?: Order['deliveryStatus'] | string | null) =>
  !['pendente', 'analise', 'recusado'].includes(String(status || '').toLowerCase());

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
      deliveryStatus: item.deliveryStatus,
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
          return 0; // Stable Array.sort preserves the persisted item order within each phase.
        }),
        preparingCount,
        readyCount,
        totalCount: preparingCount + readyCount,
      };
    })
    .sort((a, b) => timestampValue(a.timestamp) - timestampValue(b.timestamp) || a.key.localeCompare(b.key));

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
  if (Number.isFinite(ticket.numeroPedido) && Number(ticket.numeroPedido) > 0) return `#${ticket.numeroPedido}`;
  return 'sem número';
}

export function getKdsDestinationLabel(ticket: Pick<KdsTicket, 'mesaId' | 'tipo'>) {
  const normalizedType = normalizeSearchText(ticket.tipo);
  if (normalizedType === 'entrega' || normalizedType === 'delivery') return 'Delivery';
  if (normalizedType === 'retirada') return 'Retirada';
  if (ticket.mesaId > 0) return `Mesa ${String(ticket.mesaId).padStart(2, '0')}`;
  return 'Balcão';
}

/** Search stays presentation-only and never changes operational membership/status. */
export function matchesKdsTicketQuery(ticket: KdsTicket, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const searchable = [
    getKdsDestinationLabel(ticket),
    ticket.mesaId > 0 ? `Mesa ${ticket.mesaId}` : null, // Search accepts both 04 and 4.
    getKdsTicketLabel(ticket),
    ticket.identificador,
    ticket.garcomNome,
    ticket.origemOperacional,
    ...ticket.items.flatMap((item) => [item.nome, item.observacao, item.clienteNome, item.cliente_nome, ...itemCompositionPresentation(item).lines]),
  ]
    .map(normalizeSearchText)
    .filter(Boolean)
    .join(' ');

  return searchable.includes(normalizedQuery);
}

/** Age measures time since the persisted launch, NOT active cooking time. */
export function getKdsWaitInfo(timestamp: unknown, now: number): {
  minutes: number | null;
  label: string;
  level: 'normal' | 'attention' | 'late' | 'unknown';
} {
  const started = timestampValue(timestamp);
  if (started === Number.MAX_SAFE_INTEGER || !Number.isFinite(now)) {
    return { minutes: null, label: 'Horário indisponível', level: 'unknown' };
  }
  const minutes = Math.max(0, Math.floor((now - started) / 60000));
  const label = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}`;
  return { minutes, label, level: minutes >= 15 ? 'late' : minutes >= 10 ? 'attention' : 'normal' };
}

export interface KdsDemandLine { key: string; name: string; count: number; details: string[] }

/** All-day counts only IDENTICAL recipes/observations; substitutions never merge. */
export function projectKdsDemand(items: readonly KdsKitchenItem[]): KdsDemandLine[] {
  const counts = new Map<string, KdsDemandLine>();
  for (const item of items) {
    if (item.status !== 'preparando') continue;
    const composition = itemCompositionPresentation(item);
    const details = [...composition.lines, composition.observation].filter(Boolean);
    const key = JSON.stringify([item.produtoId, item.nome, details]);
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { key, name: item.nome, count: 1, details });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR') || a.key.localeCompare(b.key));
}
