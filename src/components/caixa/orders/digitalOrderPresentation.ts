import type { DeliveryOrderView } from './cashierWorkspaceTypes';

export type DigitalOrderVisualKind = 'online' | 'waiter' | 'cashier' | 'smartpos' | 'unknown';

export function getDigitalOrderVisualKind(order: Pick<DeliveryOrderView, 'origemOperacional'>): DigitalOrderVisualKind {
  if (order.origemOperacional === 'cardapio') return 'online';
  if (order.origemOperacional === 'garcom') return 'waiter';
  if (order.origemOperacional === 'caixa') return 'cashier';
  if (order.origemOperacional === 'smartpos') return 'smartpos';
  return 'unknown';
}

export function getDigitalOrderSourceLabel(order: Pick<DeliveryOrderView, 'origemOperacional'>): string {
  const kind = getDigitalOrderVisualKind(order);
  if (kind === 'online') return 'Online';
  if (kind === 'waiter') return 'Garçom';
  if (kind === 'cashier') return 'Caixa';
  if (kind === 'smartpos') return 'SmartPOS';
  return 'Kôma';
}

export function getDigitalOrderFulfillmentLabel(
  order: Pick<DeliveryOrderView, 'modalidade'>,
): string {
  if (order.modalidade === 'delivery') return 'Delivery';
  if (order.modalidade === 'consumo_local') return 'Consumo no local';
  return 'Retirada';
}

export function getDigitalOrderAssociation(
  order: Pick<DeliveryOrderView, 'modalidade' | 'mesaId' | 'garcomNome'>,
): string | null {
  const mesaId = Number(order.mesaId || 0);
  if (order.modalidade === 'delivery' || mesaId <= 0) return null;
  const waiter = String(order.garcomNome || '').trim();
  return `Mesa ${String(mesaId).padStart(2, '0')}${waiter ? ` · ${waiter}` : ''}`;
}

export function getDigitalOrderCustomerLabel(
  order: Pick<DeliveryOrderView, 'cliente' | 'modalidade' | 'mesaId' | 'origemOperacional'>,
): string {
  const customer = String(order.cliente || '').trim();
  const isGeneric = !customer || customer.toLocaleLowerCase('pt-BR') === 'cliente sem nome';
  const mesaId = Number(order.mesaId || 0);
  if (isGeneric && order.modalidade === 'retirada' && order.origemOperacional === 'garcom' && mesaId > 0) {
    return `Retirada · Mesa ${String(mesaId).padStart(2, '0')}`;
  }
  if (customer) return customer;
  if (order.modalidade === 'delivery') return 'Entrega sem nome';
  if (order.modalidade === 'consumo_local') return 'Consumo local sem nome';
  return 'Retirada sem nome';
}