import { useEffect, useRef } from 'react';
import { getAutomaticallyAcceptableOrders } from './automaticOrderAcceptance';
import type { DeliveryOrderView } from './cashierWorkspaceTypes';

export function useAutomaticOrderAcceptance(
  enabled: boolean,
  orders: readonly DeliveryOrderView[],
  acceptOrder: (order: DeliveryOrderView) => void,
) {
  const attemptedIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) {
      attemptedIdsRef.current.clear();
      return;
    }

    const pendingIds = new Set(orders.filter((order) => order.status === 'pendente').map((order) => order.id));
    for (const attemptedId of attemptedIdsRef.current) {
      if (!pendingIds.has(attemptedId)) attemptedIdsRef.current.delete(attemptedId);
    }

    for (const order of getAutomaticallyAcceptableOrders(true, orders)) {
      if (attemptedIdsRef.current.has(order.id)) continue;
      attemptedIdsRef.current.add(order.id);
      acceptOrder(order);
    }
  }, [enabled, orders, acceptOrder]);
}
