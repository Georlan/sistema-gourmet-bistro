import type { Order } from '../../../types';
import { formatBackendTime } from '../../../utils/dateTime';
import type { DeliveryOrderView } from './cashierWorkspaceTypes';

const ACTIVE_DELIVERY_STATUSES = new Set<DeliveryOrderView['status']>([
  'pendente',
  'analise',
  'producao',
  'pronto',
  'transito',
]);

const DIGITAL_TYPES = new Set(['delivery', 'entrega', 'retirada']);

export function readActiveDeliveryStatus(raw: unknown): DeliveryOrderView['status'] | null {
  const status = String(raw || '').trim().toLowerCase() as DeliveryOrderView['status'];
  return ACTIVE_DELIVERY_STATUSES.has(status) ? status : null;
}

function readActiveDigitalStatus(order: Order): DeliveryOrderView['status'] | null {
  const type = String(order.tipo || '').trim().toLowerCase();
  if (!DIGITAL_TYPES.has(type)) return null;
  return readActiveDeliveryStatus(order.deliveryStatus);
}

/**
 * Reaproveita o snapshot operacional já carregado pelo App para que o Caixa não
 * precise começar com a coluna online vazia enquanto uma segunda leitura chega.
 * O frontend nunca inventa uma etapa: somente estados ativos presentes no
 * snapshot autoritativo entram nessa projeção. A leitura dedicada de delivery
 * continua reconciliando o estado em background.
 */
export function projectDeliveryOrdersFromSharedSnapshot(
  orders: readonly Order[],
): DeliveryOrderView[] {
  return orders.flatMap((order) => {
    const status = readActiveDigitalStatus(order);
    if (!status) return [];

    const activeItems = (order.itens || []).filter((item) => item.status !== 'cancelado');
    const itemCounts: Record<string, number> = {};
    activeItems.forEach((item) => {
      const name = item.nome || 'Item';
      itemCounts[name] = (itemCounts[name] || 0) + 1;
    });

    const itens = Object.entries(itemCounts)
      .map(([name, qty]) => `${qty}x ${name}`)
      .join(' + ') || 'Nenhum item';
    const subtotal = activeItems.reduce((sum, item) => sum + (Number(item.preco) || 0), 0);
    const rawAddress = String(order.deliveryAddress || '').trim();
    const rawType = String(order.tipo || '').toLowerCase();
    const modalidade: DeliveryOrderView['modalidade'] =
      rawType === 'retirada' || /retirada\s+no\s+balc[aã]o/i.test(rawAddress)
        ? 'retirada'
        : 'delivery';

    const origemOperacional = order.origemOperacional || 'desconhecida';
    let canal: DeliveryOrderView['canal'] = origemOperacional === 'smartpos' ? 'smartpos' : 'site';
    const identifier = String(order.identificador || '');
    const normalizedIdentifier = identifier.toLowerCase();
    if (normalizedIdentifier.includes('ifood')) canal = 'ifood';
    else if (normalizedIdentifier.includes('whats')) canal = 'whats';

    const isQuickSale =
      modalidade === 'retirada' &&
      (origemOperacional === 'smartpos' ||
        (identifier.trim().toLowerCase() === 'balcão' && !String(order.clientePhone || '').trim()));

    const parsedTime = formatBackendTime(order.created_at ?? order.timestamp);

    return [{
      id: order.id,
      cliente: order.identificador || 'Cliente Sem Nome',
      telefone: order.clientePhone || '',
      itens,
      detailItems: activeItems,
      total: subtotal + (Number(order.deliveryTax) || 0),
      canal,
      origemOperacional,
      isQuickSale,
      quantidadeItens: activeItems.length,
      modalidade,
      pago: activeItems.length > 0 && activeItems.every((item) => Boolean(item.pago)),
      status,
      endereco: modalidade === 'delivery' ? rawAddress : '',
      criadoEm: parsedTime === '—' ? '12:00' : parsedTime,
      created_at: order.created_at,
      numeroPedido: order.numeroPedido,
    }];
  });
}
