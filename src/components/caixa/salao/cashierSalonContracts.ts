import type { projectCashierSalonTables } from "../../../domain/cashierSalonProjection";

export type SalonCard = Readonly<
  ReturnType<typeof projectCashierSalonTables>[number]
>;
export type SalonStatusFilter = "all" | "free" | "occupied" | "payment";
export interface SalonActions {
  readonly inspectTable: (orders: SalonCard["tableOrders"]) => void;
  readonly openTableOrder: (tableId: number) => void;
}
