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

export function getDigitalOrderAssociation(
  order: Pick<DeliveryOrderView, 'modalidade' | 'mesaId' | 'garcomNome'>,
): string | null {
  const mesaId = Number(order.mesaId || 0);
  if (order.modalidade !== 'retirada' || mesaId <= 0) return null;
  const waiter = String(order.garcomNome || '').trim();
  return `Mesa ${String(mesaId).padStart(2, '0')}${waiter ? ` · ${waiter}` : ''}`;
}

