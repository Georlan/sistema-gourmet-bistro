import type { DeliveryOrderView } from './cashierWorkspaceTypes';

export function getAutomaticallyAcceptableOrders(
  enabled: boolean,
  orders: readonly DeliveryOrderView[],
): readonly DeliveryOrderView[] {
  if (!enabled) return [];
  return orders.filter((order) => order.status === 'pendente');
}
