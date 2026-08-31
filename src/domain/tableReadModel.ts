import type { Order } from "../types";
import { getOrderCheckId } from "./orderIdentity";
import { splitOrdersByLaunch } from "./orderLots";
import { getOrderItems, isActiveOperationalOrder } from "./operationalState";

/** Read-only indexes over the existing snapshot, not a second store or financial authority. */
export function indexTableOrders(orders: readonly Order[]) {
  const byTable = new Map<number, Order[]>();
  const activeByTable = new Map<number, Order[]>();
  const mergedInto = new Map<number, number>();
  for (const order of orders) {
    const add = (index: Map<number, Order[]>) => {
      const group = index.get(order.mesaId);
      if (group) group.push(order);
      else index.set(order.mesaId, [order]);
    };
    add(byTable);
    if (isActiveOperationalOrder(order)) add(activeByTable);
    // Preserve the legacy first matching merge reference, including its fallback to null.
    if (order.mesaOrigemId != null && !mergedInto.has(order.mesaOrigemId)) {
      mergedInto.set(order.mesaOrigemId, order.mesaId);
    }
  }
  return { byTable, activeByTable, mergedInto } as {
    byTable: ReadonlyMap<number, Order[]>;
    activeByTable: ReadonlyMap<number, Order[]>;
    mergedInto: ReadonlyMap<number, number>;
  };
}

export function getTableCheckNumbers(orders: readonly Order[]): number[] {
  return Array.from(
    new Set(
      orders
        .flatMap((order) =>
          order.numeroPedidos?.length
            ? order.numeroPedidos
            : [order.numeroPedido],
        )
        .map(Number)
        .filter((number) => Number.isFinite(number) && number > 0),
    ),
  );
}

/** Persisted identities only. Missing launch IDs never become invented orders or suffixes. */
export function describeTableOrders(orders: readonly Order[]) {
  const launches = new Map<string, { id: string; displayNumber?: string }>();
  for (const lot of splitOrdersByLaunch(
    orders.map((order) =>
      Array.isArray(order.itens)
        ? order
        : { ...order, itens: getOrderItems(order) },
    ),
  )) {
    if (lot.lancamentoId && (!launches.has(lot.lancamentoId) ||
      (!launches.get(lot.lancamentoId)?.displayNumber && lot.displayNumber)))
      launches.set(lot.lancamentoId, {
        id: lot.lancamentoId,
        displayNumber: lot.displayNumber,
      });
  }
  return {
    checkCount: new Set(orders.map(getOrderCheckId)).size,
    checkNumbers: getTableCheckNumbers(orders),
    launches: Array.from(launches.values()),
    hasUnidentifiedItems: orders.some((order) =>
      getOrderItems(order).some((item) => !item.lancamentoId?.trim()),
    ),
    attendants: Array.from(
      new Set(orders.map((order) => order.garcomNome?.trim()).filter(Boolean)),
    ),
  };
}

export type TableOrderContext = ReturnType<typeof describeTableOrders>;
