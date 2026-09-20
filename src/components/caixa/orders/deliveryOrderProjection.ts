import type { Order } from '../../../types';
import { getCashierOrderSlaData } from '../../../domain/cashierOrderProjection';
import { formatBackendTime } from '../../../utils/dateTime';
import type { DeliveryOrderView } from './cashierWorkspaceTypes';

const ACTIVE_DELIVERY_STATUSES = new Set<DeliveryOrderView['status']>([
  'pendente',
  'analise',
  'producao',
  'pronto',
  'transito',
]);

const DIGITAL_TYPES = new Set(['delivery', 'entrega', 'retirada', 'consumo no local']);

export function readActiveDeliveryStatus(raw: unknown): DeliveryOrderView['status'] | null {
  const status = String(raw || '').trim().toLowerCase() as DeliveryOrderView['status'];
  return ACTIVE_DELIVERY_STATUSES.has(status) ? status : null;
}

function readActiveDigitalStatus(order: Order): DeliveryOrderView['status'] | null {
  const type = String(order.tipo || '').trim().toLowerCase();
  if (!DIGITAL_TYPES.has(type)) return null;
  return readActiveDeliveryStatus(order.deliveryStatus);
}

export type CourierDeliveryBuckets = {
  preparing: DeliveryOrderView[];
  ready: DeliveryOrderView[];
  inTransit: DeliveryOrderView[];
};

export type PickupOrderBuckets = {
  awaitingAcceptance: DeliveryOrderView[];
  preparing: DeliveryOrderView[];
  ready: DeliveryOrderView[];
  late: DeliveryOrderView[];
};

/**
 * A resposta de uma transição de status pode ser deliberadamente compacta e
 * omitir os itens. Durante essa janela, mantém o último snapshot operacional
 * completo em vez de exibir um pedido fictício de R$ 0,00. A leitura dedicada
 * seguinte continua sendo a autoridade e substitui o card normalmente.
 */
const isPlaceholderCustomerName = (value: unknown) => {
  const normalized = String(value || '').trim().toLocaleLowerCase('pt-BR');
  return !normalized || normalized === 'cliente sem nome';
};

export function reconcileDeliveryOrderAfterStatus(
  previous: DeliveryOrderView,
  incoming: DeliveryOrderView,
): DeliveryOrderView {
  const identityAwareIncoming =
    isPlaceholderCustomerName(incoming.cliente) && !isPlaceholderCustomerName(previous.cliente)
      ? { ...incoming, cliente: previous.cliente }
      : incoming;

  if (identityAwareIncoming.quantidadeItens > 0 || previous.quantidadeItens <= 0) {
    return identityAwareIncoming;
  }

  return {
    ...identityAwareIncoming,
    cliente: previous.cliente,
    telefone: previous.telefone,
    itens: previous.itens,
    detailItems: previous.detailItems,
    total: previous.total,
    quantidadeItens: previous.quantidadeItens,
    pago: previous.pago,
    endereco: previous.endereco,
    canal: previous.canal,
    origemOperacional: previous.origemOperacional,
    isQuickSale: previous.isQuickSale,
    modalidade: previous.modalidade,
    paymentMethod: incoming.paymentMethod ?? previous.paymentMethod,
    changeFor: incoming.changeFor ?? previous.changeFor,
    numeroPedido: incoming.numeroPedido ?? previous.numeroPedido,
    mesaId: incoming.mesaId ?? previous.mesaId,
    garcomNome: incoming.garcomNome ?? previous.garcomNome,
  };
}

export function bucketPickupOrders(
  orders: readonly DeliveryOrderView[],
  now: number,
): PickupOrderBuckets {
  const buckets: PickupOrderBuckets = {
    awaitingAcceptance: [],
    preparing: [],
    ready: [],
    late: [],
  };

  orders.forEach((order) => {
    if (order.modalidade !== 'retirada' || order.isQuickSale) return;

    if (getCashierOrderSlaData(order, now).minutes > 25) {
      buckets.late.push(order);
    }

    if (order.status === 'pendente' || order.status === 'analise') {
      buckets.awaitingAcceptance.push(order);
    } else if (order.status === 'producao') {
      buckets.preparing.push(order);
    } else if (order.status === 'pronto' || order.status === 'transito') {
      buckets.ready.push(order);
    }
  });

  return buckets;
}


/**
 * A tela de Entregas é deliberadamente exclusiva de delivery. O Kanban geral
 * pode continuar projetando delivery + retirada, mas retirada nunca entra no
 * workspace de despacho de motoboys.
 *
 * A separação também respeita a state machine do backend: delivery só pode ser
 * despachado depois de `pronto`; `transito` significa que o pedido já saiu com
 * um entregador e pode então ser concluído.
 */
export function bucketCourierDeliveryOrders(
  orders: readonly DeliveryOrderView[],
): CourierDeliveryBuckets {
  const buckets: CourierDeliveryBuckets = {
    preparing: [],
    ready: [],
    inTransit: [],
  };

  orders.forEach((order) => {
    if (order.modalidade !== 'delivery') return;

    if (order.status === 'analise' || order.status === 'pendente' || order.status === 'producao') {
      buckets.preparing.push(order);
    } else if (order.status === 'pronto') {
      buckets.ready.push(order);
    } else if (order.status === 'transito') {
      buckets.inTransit.push(order);
    }
  });

  return buckets;
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
      rawType === 'consumo no local'
        ? 'consumo_local'
        : rawType === 'retirada' || /retirada\s+no\s+balc[aã]o/i.test(rawAddress)
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
      paymentMethod: order.paymentMethod ?? null,
      changeFor: order.changeFor ?? null,
      motoboyId: order.motoboyId ?? null,
      criadoEm: parsedTime === '—' ? '12:00' : parsedTime,
      created_at: order.created_at,
      numeroPedido: order.numeroPedido,
      mesaId: Number(order.mesaId || 0) || null,
      garcomNome: order.garcomNome,
    }];
  });
}