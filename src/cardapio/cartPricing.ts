import { getEffectiveProductPrice } from '../domain/productMerchandising';
import { isGroupedProduct, type CatalogDisplayItem } from './catalogGrouping';
import type { CartItem } from './components/CardapioCartDrawer';

export interface CatalogDisplayEffectivePrice {
  effectivePrice: number;
  originalPrice: number | null;
  discountPercent: number | null;
  hasDiscount: boolean;
  isFromPrice: boolean;
}

type CartPricingItem = Pick<
  CartItem,
  'product' | 'selectedOptions' | 'promotionId' | 'promotionParts'
>;

type CartPricingLineItem = CartPricingItem & Pick<CartItem, 'quantity'>;

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/**
 * Canonical unit price for a public cart item (base effective price or campaign
 * package price + chosen modifier surcharges).
 */
export function getCardapioCartItemUnitPrice(item: CartPricingItem): number {
  const basePrice = item.promotionId
    ? (() => {
        const raw = Number(item.product?.price);
        return Number.isFinite(raw) && raw >= 0 ? raw : 0;
      })()
    : getEffectiveProductPrice(item.product?.price ?? 0, item.product?.promotionalPrice).effectivePrice;

  const flatSelected = Object.values(item.selectedOptions || {}).flat();
  const optionsExtra = flatSelected.length > 0
    ? flatSelected.reduce((sum, opt) => {
        const extra = Number(opt?.extraPrice);
        return sum + (Number.isFinite(extra) ? extra : 0);
      }, 0)
    : (item.promotionParts || []).reduce(
        (partsSum, part) =>
          partsSum + Object.values(part.selectedOptions || {}).flat().reduce((sum, opt) => {
            const extra = Number(opt?.extraPrice);
            return sum + (Number.isFinite(extra) ? extra : 0);
          }, 0),
        0,
      );

  return roundMoney(basePrice + optionsExtra);
}

/** Canonical line total (`unitPrice * quantity`) for a public cart item. */
export function getCardapioCartItemLineTotal(item: CartPricingLineItem): number {
  const qty = Number(item.quantity);
  const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 0;
  return roundMoney(getCardapioCartItemUnitPrice(item) * safeQty);
}

/** Canonical cart subtotal across all items in the public bag/checkout. */
export function getCardapioCartSubtotal(cart: readonly CartPricingLineItem[]): number {
  return roundMoney(cart.reduce((sum, item) => sum + getCardapioCartItemLineTotal(item), 0));
}

/**
 * Resolves the canonical catalog display price for both individual products
 * (including direct `promotionalPrice` discounts) and grouped families
 * (`minPrice` / `hasVariablePrice`).
 */
export function getCatalogDisplayEffectivePrice(item: CatalogDisplayItem): CatalogDisplayEffectivePrice {
  if (isGroupedProduct(item)) {
    const rawMin = Number(item.minPrice);
    const fallback = getEffectiveProductPrice(item.price, item.promotionalPrice).effectivePrice;
    const effectivePrice = roundMoney(Number.isFinite(rawMin) && rawMin >= 0 ? rawMin : fallback);
    const isFromPrice = Boolean(item.hasVariablePrice);

    if (!isFromPrice && Array.isArray(item.variants) && item.variants.length > 0) {
      const available = item.variants.filter((variant) => variant.isAvailable);
      const pool = available.length > 0 ? available : item.variants;
      const variantOriginals = pool.map((variant) => {
        if (!variant.product) return null;
        const resolution = getEffectiveProductPrice(
          variant.product.price,
          variant.product.promotionalPrice,
        );
        if (!resolution.hasDiscount || resolution.originalPrice == null) return null;
        const variantStarting = Number.isFinite(Number(variant.price))
          ? Number(variant.price)
          : resolution.effectivePrice;
        const mandatoryOffset = Math.max(0, variantStarting - resolution.effectivePrice);
        return roundMoney(resolution.originalPrice + mandatoryOffset);
      });

      const firstOriginal = variantOriginals[0];
      if (
        firstOriginal != null
        && firstOriginal > effectivePrice
        && variantOriginals.every((orig) => orig === firstOriginal)
      ) {
        const discountPercent = Math.max(
          1,
          Math.round(((firstOriginal - effectivePrice) / firstOriginal) * 100),
        );
        return {
          effectivePrice,
          originalPrice: firstOriginal,
          discountPercent,
          hasDiscount: true,
          isFromPrice: false,
        };
      }
    }

    return {
      effectivePrice,
      originalPrice: null,
      discountPercent: null,
      hasDiscount: false,
      isFromPrice,
    };
  }

  const resolved = getEffectiveProductPrice(item.price, item.promotionalPrice);
  return {
    effectivePrice: roundMoney(resolved.effectivePrice),
    originalPrice: resolved.originalPrice != null ? roundMoney(resolved.originalPrice) : null,
    discountPercent: resolved.discountPercent,
    hasDiscount: resolved.hasDiscount,
    isFromPrice: false,
  };
}
