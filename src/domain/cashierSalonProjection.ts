import type { Order, Table } from "../types";
import {
  deriveTableOperationalState,
  type PendingPaymentReference,
} from "./operationalState";
import { describeTableOrders, indexTableOrders } from "./tableReadModel";

/** Cashier adapter: merged destination, active checks and legacy display consumption. */
export function projectCashierSalonTables(
  salonTables: Table[],
  orders: Order[],
  pendingPayments: readonly PendingPaymentReference[],
  now: number,
) {
  const index = indexTableOrders(orders);
  return salonTables.map((table) => {
    const mergedIntoMesaId = index.mergedInto.get(table.id) || null;
    const isMerged = mergedIntoMesaId !== null;
    const displayMesaId = mergedIntoMesaId ?? table.id;
    const tableOrders = index.activeByTable.get(displayMesaId) || [];
    const operational = deriveTableOperationalState({
      table,
      orders: tableOrders,
      pendingPayments,
      mergedIntoMesaId,
      now,
    });
    // Preserve Salão consumption; this is NOT an outstanding balance or a checkout quote.
    const total = tableOrders.reduce(
      (sum, order) =>
        sum +
        (order.itens || []).reduce(
          (itemsTotal, item) => itemsTotal + Number(item.preco || 0),
          0,
        ),
      0,
    );
    return {
      table,
      displayMesaId,
      tableOrders,
      isMerged,
      isOccupied: operational.occupancy === "IN_SERVICE",
      hasPendingPayment: operational.hasPendingPayment,
      operational,
      total,
      context: describeTableOrders(tableOrders),
    };
  });
}
