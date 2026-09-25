import type { Order } from '../../../types';
import { getCashierOrderSlaData } from '../../../domain/cashierOrderProjection';
import { formatBackendTime } from '../../../utils/dateTime';
import type { DeliveryOrderView } from './cashierWorkspaceTypes';

const ACTIVE_DIGITAL_STATUSES = new Set<DeliveryOrderView['status']>([
  'pendente',
  'analise',
  'producao',
  'pronto',
  'transito',
]);

const DELIVERY_TYPES = new Set(['delivery', 'entrega']);
const PICKUP_TYPES = new Set(['retirada', 'pickup', 'viagem', 'balcao', 'balcão']);
const DINE_IN_TYPES = new Set(['consumo no local', 'consumo_local', 'dine_in', 'mesa', 'local', 'salao', 'salão']);

export function readActiveDigitalOrderStatus(raw: unknown): DeliveryOrderView['status'] | null {
  const status = String(raw || '').trim().toLowerCase() as DeliveryOrderView['status'];
  return ACTIVE_DIGITAL_STATUSES.has(status) ? status : null;
}

/** Alias legado enquanto os consumidores migram do vocabulário "delivery". */
export function readActiveDeliveryStatus(raw: unknown): DeliveryOrderView['status'] | null {
  return readActiveDigitalOrderStatus(raw);
}

export function readDigitalOrderFulfillment(
  rawType: unknown,
  rawAddress: unknown = '',
): DeliveryOrderView['modalidade'] | null {
  const type = String(rawType || '').trim().toLowerCase();
  if (DELIVERY_TYPES.has(type)) return 'delivery';
  if (PICKUP_TYPES.has(type)) return 'retirada';
  if (DINE_IN_TYPES.has(type)) return 'dine_in';
  if (/retirada\s+no\s+balc[aã]o/i.test(String(rawAddress || ''))) return 'retirada';
  return null;
}


/**
 * Normaliza a comanda crua retornada pelas rotas operacionais no mesmo read model
 * usado por Pedidos, Retiradas e Entregas. Assim modalidade, saldo, origem,
 * entregador e apresentação não ganham interpretações diferentes por tela.
 */
export function projectApiComandaToDeliveryView(c: any): DeliveryOrderView | null {
  const status = readActiveDeliveryStatus(c?.delivery_status);
  if (!status) return null;

  const itensArr = Array.isArray(c?.itens) ? c.itens : Array.isArray(c?.items) ? c.items : [];
  const activeItems = itensArr.filter((item: any) => item?.status !== 'cancelado');
  const itemCounts: Record<string, number> = {};
  activeItems.forEach((item: any) => {
    const name = item?.produto?.nome || item?.nome || 'Item';
    itemCounts[name] = (itemCounts[name] || 0) + 1;
  });

  const itens = Object.entries(itemCounts)
    .map(([name, qty]) => `${qty}x ${name}`)
    .join(' + ') || 'Nenhum item';
  const subtotal = activeItems.reduce(
    (sum: number, item: any) => sum + (Number(item?.preco_unit ?? item?.preco) || 0),
    0,
  );
  const total = subtotal + (Number(c?.delivery_taxa) || 0);
  const amountPaid = Math.max(0, Number(c?.valor_pago) || 0);
  const amountDue = Math.max(0, total - amountPaid);

  const origins = (Array.isArray(c?.lancamentos) ? c.lancamentos : []).map((launch: any) =>
    String(launch?.origem || '').toLowerCase()
  );
  const origemOperacional: DeliveryOrderView['origemOperacional'] = origins.includes('smartpos')
    ? 'smartpos'
    : origins.includes('cardapio')
      ? 'cardapio'
      : origins.includes('caixa')
        ? 'caixa'
        : origins.includes('garcom')
          ? 'garcom'
          : 'desconhecida';

  let canal: DeliveryOrderView['canal'] = origemOperacional === 'smartpos' ? 'smartpos' : 'site';
  const identifier = String(c?.identificador || '');
  const normalizedIdentifier = identifier.toLowerCase();
  if (normalizedIdentifier.includes('ifood')) canal = 'ifood';
  else if (normalizedIdentifier.includes('whats')) canal = 'whats';

  const rawAddress = String(c?.delivery_endereco || '').trim();
  const modalidade = readDigitalOrderFulfillment(c?.tipo, rawAddress);
  if (!modalidade) return null;

  const isQuickSale =
    modalidade === 'retirada' &&
    (
      origemOperacional === 'smartpos'
      || (identifier.trim().toLowerCase() === 'balcão' && !String(c?.delivery_telefone || '').trim())
    );

  const parsedTime = formatBackendTime(c?.criado_em);

  return {
    id: c.id,
    cliente: identifier || 'Cliente Sem Nome',
    telefone: c?.delivery_telefone || '',
    itens,
    detailItems: activeItems,
    total,
    amountPaid,
    amountDue,
    canal,
    origemOperacional,
    isQuickSale,
    quantidadeItens: activeItems.length,
    modalidade,
    pago: activeItems.length > 0 && activeItems.every((item: any) => Boolean(item?.pago)),
    status,
    endereco: modalidade === 'delivery' ? rawAddress : '',
    paymentMethod: c?.delivery_forma_pagamento || null,
    onlinePaymentStatus: c?.online_payment_status || null,
    changeFor: c?.delivery_troco_para == null ? null : Number(c.delivery_troco_para),
    motoboyId: c?.motoboy_id ?? null,
    criadoEm: parsedTime === '—' ? '12:00' : parsedTime,
    created_at: c?.criado_em,
    numeroPedido: c?.numero_pedido,
    mesaId: Number(c?.mesa_id || 0) || null,
    garcomNome: c?.criada_por?.nome || c?.garcom?.nome || '',
  };
}

function readActiveDigitalStatus(order: Order): DeliveryOrderView['status'] | null {
  const fulfillment = readDigitalOrderFulfillment(order.tipo, order.deliveryAddress);
  if (!fulfillment) return null;
  return readActiveDigitalOrderStatus(order.deliveryStatus);
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
    amountPaid: incoming.amountPaid ?? previous.amountPaid,
    amountDue: incoming.amountDue ?? previous.amountDue,
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
    const total = subtotal + (Number(order.deliveryTax) || 0);
    const amountPaid = Math.max(0, Number(order.valorPago) || 0);
    const amountDue = Math.max(0, total - amountPaid);
    const rawAddress = String(order.deliveryAddress || '').trim();
    const modalidade = readDigitalOrderFulfillment(order.tipo, rawAddress);
    if (!modalidade) return [];

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
      total,
      amountPaid,
      amountDue,
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