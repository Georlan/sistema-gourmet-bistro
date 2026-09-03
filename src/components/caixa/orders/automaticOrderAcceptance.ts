import type { DeliveryOrderView } from './cashierWorkspaceTypes';

/**
 * Keeps the automatic-acceptance policy explicit and isolated from the UI.
 * The acceptance action itself remains owned by useCashierOrders.
 */
export function getAutomaticallyAcceptableOrders(
  enabled: boolean,
  orders: readonly DeliveryOrderView[],
): readonly DeliveryOrderView[] {
  if (!enabled) return [];
  return orders.filter((order) => order.status === 'pendente');
}
