import type { projectCashierSalonTables } from "../../../domain/cashierSalonProjection";

export type SalonCard = Readonly<
  ReturnType<typeof projectCashierSalonTables>[number]
>;
export type SalonStatusFilter = "all" | "free" | "occupied" | "payment";
export interface SalonActions {
  readonly receiveTable: (orders: SalonCard["tableOrders"]) => void;
  readonly inspectTable: (orders: SalonCard["tableOrders"]) => void;
  /** Opens the existing confirmation flow; does not transfer on the first click. */
  readonly prepareTransfer: (orders: SalonCard["tableOrders"]) => void;
  readonly openTableOrder: (tableId: number) => void;
}
