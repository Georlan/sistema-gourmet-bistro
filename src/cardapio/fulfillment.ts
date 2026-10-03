import type { BrandConfig } from "./CardapioTypes";

export type CardapioFulfillment = "delivery" | "pickup" | "dine_in";

// Preserve the existing public configuration rules, waiting until it is loaded.
export function getFulfillmentAvailability(brand?: BrandConfig) {
  const types = brand?.activeOrderTypes;
  return {
    delivery: Boolean(brand) && brand?.deliveryEnabled !== false && (!types || types.includes("delivery")),
    pickup: Boolean(brand) && (!types || types.includes("retirada")),
    dine_in: Boolean(brand) && (!types || types.includes("consumo_local")),
  };
}

export function resolveFulfillmentSelection(brand?: BrandConfig, selected?: CardapioFulfillment | null): CardapioFulfillment | null {
  const available = getFulfillmentAvailability(brand);
  if (selected && available[selected]) return selected;
  return available.delivery ? "delivery" : available.pickup ? "pickup" : available.dine_in ? "dine_in" : null;
}
