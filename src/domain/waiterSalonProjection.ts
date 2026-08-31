import type { Order, Table } from "../types";
import {
  deriveTableOperationalState,
  type PendingPaymentReference,
} from "./operationalState";
import { indexTableOrders } from "./tableReadModel";

/** Waiter adapter deliberately keeps direct-table scope and snapshot visibility. */
export function projectWaiterSalonTables(
  tables: readonly Table[],
  orders: readonly Order[],
  pendingPayments: readonly PendingPaymentReference[],
  now: number,
) {
  const index = indexTableOrders(orders);
  return tables.map((table) => {
    const tableOrders = index.byTable.get(table.id) || [];
    return {
      table,
      tableOrders,
      operationalState: deriveTableOperationalState({
        table,
        orders: tableOrders,
        pendingPayments,
        mergedIntoMesaId: index.mergedInto.get(table.id) || null,
        now,
      }),
    };
  });
}

export type WaiterSalonRow = ReturnType<
  typeof projectWaiterSalonTables
>[number];

export function countWaiterSalonTables(
  rows: readonly WaiterSalonRow[],
  showProduction = true,
) {
  return {
    todos: rows.length,
    livres: rows.filter((row) => row.operationalState.occupancy === "FREE")
      .length,
    ocupadas: rows.filter(
      (row) => row.operationalState.occupancy === "IN_SERVICE",
    ).length,
    prontas: rows.filter(
      (row) => showProduction && row.operationalState.production.hasReadyItems,
    ).length,
  };
}
