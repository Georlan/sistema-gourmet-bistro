import type { Product as CardapioProduct, ModifierGroup } from '../../../cardapio/CardapioTypes';
import type { PromotionPartSelection } from '../../../cardapio/promotionComposition';
import type { CatalogModifierGroup } from '../../../catalog/catalog';
import { getEffectiveProductPrice } from '../../../domain/productMerchandising';
import type { Product } from '../../../types';
import { normalizeSlotQuantities, type PromotionType } from '../../../utils/promotionFormHelpers';
import { pdvProductNeedsRequiredChoices } from './pdvProductChoices';

export interface PdvPromotion {
  id: string;
  nome: string;
  descricao?: string;
  preco: number;
  tipo?: PromotionType;
  brinde_nome?: string | null;
  componentes: string[][];
  quantidades?: number[];
  ativo: boolean;
  inicio_em?: string | null;
  fim_em?: string | null;
  status?: 'agendada' | 'ativa' | 'pausada' | 'encerrada';
}

export interface PdvPromotionCartItemLike {
  product?: Pick<Product, 'preco' | 'preco_promocional'>;
  quantity: number;
  modifiers?: Array<{ preco: number }>;
  promotionId?: string;
  promotionInstanceId?: string;
  promotionName?: string;
  promotionPrice?: number;
}

export interface PdvCartPricingSummary {
  itemsSubtotal: number;
  regularSubtotal: number;
  promotionsSubtotal: number;
  promotionInstanceCount: number;
}

function toCents(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.round(num * 100) : 0;
}

function resolveItemPromotionPrice(
  promotionId: string,
  itemPromoPrice: number | undefined,
  activePromotions: readonly PdvPromotion[],
): number | null {
  const live = activePromotions.find((promo) => String(promo.id) === String(promotionId));
  if (live && Number.isFinite(Number(live.preco)) && Number(live.preco) >= 0) {
    return Number(live.preco);
  }
  if (itemPromoPrice !== undefined && Number.isFinite(Number(itemPromoPrice)) && Number(itemPromoPrice) >= 0) {
    return Number(itemPromoPrice);
  }
  return null;
}

function promotionInstanceKey(item: PdvPromotionCartItemLike): string {
  return item.promotionInstanceId
    ? `${item.promotionId}::${item.promotionInstanceId}`
    : `${item.promotionId}::__default__`;
}

export function extractPromotionsPayload(data: unknown): {
  promotions: PdvPromotion[];
  isValid: boolean;
} {
  if (Array.isArray(data)) {
    return { promotions: data as PdvPromotion[], isValid: true };
  }
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.promocoes)) {
      return { promotions: record.promocoes as PdvPromotion[], isValid: true };
    }
  }
  return { promotions: [], isValid: false };
}

export function filterActivePdvPromotions(
  promotions: PdvPromotion[],
  nowMs: number = Date.now(),
): PdvPromotion[] {
  return promotions.filter((promo) => {
    if (promo.status === 'pausada' || promo.status === 'encerrada') return false;
    if (promo.ativo === false) return false;
    const startMs = promo.inicio_em ? Date.parse(promo.inicio_em) : NaN;
    const endMs = promo.fim_em ? Date.parse(promo.fim_em) : NaN;
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) return false;
    if (Number.isFinite(startMs) && nowMs < startMs) return false;
    if (Number.isFinite(endMs) && nowMs >= endMs) return false;
    if (promo.status === 'agendada' && !Number.isFinite(startMs)) return false;
    return true;
  });
}

export function getNextPdvPromotionTransition(
  promotions: readonly PdvPromotion[],
  nowMs: number = Date.now(),
): { nextAtMs: number; isStartBoundary: boolean } | null {
  let nextAtMs = Number.POSITIVE_INFINITY;
  let isStartBoundary = false;

  for (const promo of promotions) {
    if (promo.ativo === false || promo.status === 'pausada' || promo.status === 'encerrada') {
      continue;
    }
    const startMs = promo.inicio_em ? Date.parse(promo.inicio_em) : NaN;
    const endMs = promo.fim_em ? Date.parse(promo.fim_em) : NaN;
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
      continue;
    }
    if (Number.isFinite(startMs) && startMs > nowMs && startMs < nextAtMs) {
      nextAtMs = startMs;
      isStartBoundary = true;
    }
    if (Number.isFinite(endMs) && endMs > nowMs && endMs < nextAtMs) {
      nextAtMs = endMs;
      isStartBoundary = false;
    }
  }

  return Number.isFinite(nextAtMs) ? { nextAtMs, isStartBoundary } : null;
}

/**
 * Computes canonical PDV cart pricing: each promotion instance is charged at
 * `promo.preco` once per instance plus paid modifiers on its parts, while
 * regular items use `getEffectiveProductPrice` plus modifiers.
 */
export function calculatePdvCartPricing(
  cartItems: readonly PdvPromotionCartItemLike[],
  activePromotions: readonly PdvPromotion[] = [],
): PdvCartPricingSummary {
  let regularCents = 0;
  let promotionsCents = 0;

  const instances = new Map<string, { promotionId: string; items: PdvPromotionCartItemLike[] }>();

  for (const item of cartItems) {
    const qty = Math.max(0, Number(item.quantity || 0));
    if (qty <= 0) continue;

    if (item.promotionId) {
      const key = promotionInstanceKey(item);
      const group = instances.get(key);
      if (group) {
        group.items.push(item);
      } else {
        instances.set(key, { promotionId: item.promotionId, items: [item] });
      }
      continue;
    }

    const base = getEffectiveProductPrice(
      Number(item.product?.preco || 0),
      item.product?.preco_promocional,
    ).effectivePrice;
    const mods = (item.modifiers || []).reduce((sum, mod) => sum + Number(mod.preco || 0), 0);
    regularCents += Math.round((base + mods) * qty * 100);
  }

  for (const group of instances.values()) {
    const itemPromoPrice = group.items.find((item) => item.promotionPrice !== undefined)?.promotionPrice;
    const resolvedPromoPrice = resolveItemPromotionPrice(
      group.promotionId,
      itemPromoPrice,
      activePromotions,
    );

    const instanceBaseCents = resolvedPromoPrice !== null
      ? toCents(resolvedPromoPrice)
      : group.items.reduce((sum, item) => {
          const qty = Math.max(0, Number(item.quantity || 0));
          const base = getEffectiveProductPrice(
            Number(item.product?.preco || 0),
            item.product?.preco_promocional,
          ).effectivePrice;
          return sum + Math.round(base * qty * 100);
        }, 0);

    const instanceModsCents = group.items.reduce((sum, item) => {
      const qty = Math.max(0, Number(item.quantity || 0));
      const mods = (item.modifiers || []).reduce((mSum, mod) => mSum + Number(mod.preco || 0), 0);
      return sum + Math.round(mods * qty * 100);
    }, 0);

    promotionsCents += instanceBaseCents + instanceModsCents;
  }

  return {
    itemsSubtotal: (regularCents + promotionsCents) / 100,
    regularSubtotal: regularCents / 100,
    promotionsSubtotal: promotionsCents / 100,
    promotionInstanceCount: instances.size,
  };
}

/**
 * Allocates exact unit prices for flattened optimistic Kanban `tempItems` so
 * their sum matches `calculatePdvCartPricing(cartItems, activePromotions).itemsSubtotal`
 * to the cent.
 */
export function allocatePdvOptimisticItemPrices(
  cartItems: readonly PdvPromotionCartItemLike[],
  activePromotions: readonly PdvPromotion[] = [],
): number[] {
  type FlattenedUnit = {
    regularCents: number;
    modsCents: number;
    promotionId?: string;
    promotionPrice?: number;
    instanceKey?: string;
  };

  const units: FlattenedUnit[] = [];
  const instanceUnitIndices = new Map<string, number[]>();

  for (const item of cartItems) {
    const qty = Math.max(0, Math.trunc(Number(item.quantity || 0)));
    if (qty <= 0) continue;

    const regularCents = toCents(
      getEffectiveProductPrice(
        Number(item.product?.preco || 0),
        item.product?.preco_promocional,
      ).effectivePrice,
    );
    const modsCents = (item.modifiers || []).reduce((sum, mod) => sum + toCents(mod.preco), 0);
    const key = item.promotionId ? promotionInstanceKey(item) : undefined;

    for (let i = 0; i < qty; i += 1) {
      const flatIdx = units.length;
      units.push({
        regularCents,
        modsCents,
        promotionId: item.promotionId,
        promotionPrice: item.promotionPrice,
        instanceKey: key,
      });
      if (key) {
        const list = instanceUnitIndices.get(key) || [];
        list.push(flatIdx);
        instanceUnitIndices.set(key, list);
      }
    }
  }

  const allocated = units.map((unit) => (unit.regularCents + unit.modsCents) / 100);

  for (const unitIndices of instanceUnitIndices.values()) {
    const first = units[unitIndices[0]];
    const itemPromoPrice = unitIndices
      .map((idx) => units[idx].promotionPrice)
      .find((price) => price !== undefined);
    const resolvedPrice = first.promotionId
      ? resolveItemPromotionPrice(first.promotionId, itemPromoPrice, activePromotions)
      : null;

    if (resolvedPrice === null) continue;

    const targetBaseCents = toCents(resolvedPrice);
    const baseSumCents = unitIndices.reduce((sum, idx) => sum + units[idx].regularCents, 0);
    const basePerUnit = unitIndices.map((idx) => {
      if (baseSumCents > 0) {
        return Math.floor((targetBaseCents * units[idx].regularCents) / baseSumCents);
      }
      return Math.floor(targetBaseCents / unitIndices.length);
    });

    const remainder = targetBaseCents - basePerUnit.reduce((sum, val) => sum + val, 0);
    for (let r = 0; r < remainder; r += 1) {
      basePerUnit[r % unitIndices.length] += 1;
    }

    unitIndices.forEach((flatIdx, pos) => {
      allocated[flatIdx] = (basePerUnit[pos] + units[flatIdx].modsCents) / 100;
    });
  }

  return allocated;
}

export function findConflictingPdvPromotion(
  cartItems: readonly PdvPromotionCartItemLike[],
  nextPromoId: string,
): { promotionId: string; promotionName?: string } | null {
  const conflict = cartItems.find(
    (item) => Boolean(item.promotionId) && String(item.promotionId) !== String(nextPromoId),
  );
  if (!conflict || !conflict.promotionId) return null;
  return {
    promotionId: conflict.promotionId,
    promotionName: conflict.promotionName,
  };
}

export function removePdvPromotionInstanceAt<T extends PdvPromotionCartItemLike>(
  cartItems: readonly T[],
  index: number,
): { nextCart: T[]; removedPromoName: string | null } {
  const target = cartItems[index];
  if (!target) {
    return { nextCart: [...cartItems], removedPromoName: null };
  }
  if (!target.promotionId) {
    return {
      nextCart: cartItems.filter((_, i) => i !== index),
      removedPromoName: null,
    };
  }
  const nextCart = target.promotionInstanceId
    ? cartItems.filter(
        (item) =>
          !(item.promotionId === target.promotionId && item.promotionInstanceId === target.promotionInstanceId),
      )
    : cartItems.filter((item) => item.promotionId !== target.promotionId);
  return {
    nextCart,
    removedPromoName: target.promotionName || 'Promoção',
  };
}

export function extractPdvPromotionOrderFields(
  cartItems: PdvPromotionCartItemLike[],
  activePromotions: readonly PdvPromotion[] = [],
): {
  promocao_id: string | undefined;
  promocao_item_indices: number[] | undefined;
  promocao_preco_esperado?: number;
} {
  const firstPromoItem = cartItems.find((item) => Boolean(item.promotionId));
  const firstPromoId = firstPromoItem?.promotionId;
  if (!firstPromoId) {
    return { promocao_id: undefined, promocao_item_indices: undefined };
  }

  const indices: number[] = [];
  let flatIndex = 0;
  for (const item of cartItems) {
    const qty = Math.max(0, Number(item.quantity || 0));
    for (let i = 0; i < qty; i += 1) {
      if (item.promotionId === firstPromoId) {
        indices.push(flatIndex);
      }
      flatIndex += 1;
    }
  }

  if (indices.length === 0) {
    return { promocao_id: undefined, promocao_item_indices: undefined };
  }

  const unitPromoPrice = resolveItemPromotionPrice(
    firstPromoId,
    firstPromoItem?.promotionPrice,
    activePromotions,
  );
  if (unitPromoPrice !== null) {
    return {
      promocao_id: firstPromoId,
      promocao_item_indices: indices,
      promocao_preco_esperado: Math.round(unitPromoPrice * 100) / 100,
    };
  }

  return {
    promocao_id: firstPromoId,
    promocao_item_indices: indices,
  };
}

export function findPromotionStepProducts(
  promo: PdvPromotion,
  products: Product[],
): Product[] {
  return promo.componentes
    .map((ids) => products.find((candidate) => ids.includes(String(candidate.id))))
    .filter((product): product is Product => Boolean(product));
}

export function isSingleItemSimpleDiscountPromotion(
  promo: PdvPromotion,
  products: Product[],
): Product | null {
  if (promo.componentes.length !== 1) return null;
  const quantities = normalizeSlotQuantities(1, promo.quantidades);
  if (quantities[0] !== 1) return null;
  if (promo.tipo && promo.tipo !== 'desconto_item') return null;

  const product = products.find((candidate) => promo.componentes[0].includes(String(candidate.id)));
  if (!product) return null;
  if (pdvProductNeedsRequiredChoices(product)) return null;
  return product;
}

type ProductWithModifiers = Product & { grupos_modificadores?: CatalogModifierGroup[] };

export function toCardapioProduct(product: Product): CardapioProduct {
  const modifierGroups = ((product as ProductWithModifiers).grupos_modificadores || []).map<ModifierGroup>((group) => {
    const min = group.min_selecoes ?? 0;
    const max = group.max_selecoes ?? 1;
    return {
      id: group.id,
      name: group.nome,
      minSelection: min,
      maxSelection: max,
      selectionMode: group.modo_selecao === 'porcoes' || group.modo_selecao === 'tipos' ? group.modo_selecao : undefined,
      type: group.tipo === 'obrigatorio' || group.tipo === 'meio_a_meio' ? group.tipo : (min > 0 ? 'obrigatorio' : 'opcional'),
      options: (group.opcoes || []).map((opt) => ({
        id: opt.id,
        name: opt.nome,
        extraPrice: Number(opt.preco_adicional || 0),
        active: opt.ativo !== false,
      })),
    };
  });

  const effective = getEffectiveProductPrice(Number(product.preco || 0), product.preco_promocional);
  return {
    id: String(product.id),
    name: product.nome,
    description: product.descricao || '',
    price: effective.effectivePrice,
    image: product.imagem || '',
    category: product.categoria || 'Cardápio',
    isAvailable: product.ativo !== false,
    modifiers: [],
    modifierGroups,
  };
}

export function partSelectionToPdvCartFields(part: PromotionPartSelection) {
  const selectedOptions = Object.values(part.selectedOptions).flat();
  return {
    productId: part.product.id,
    obs: part.notes || '',
    modifierIds: selectedOptions.map((opt) => opt.id),
    modifiers: selectedOptions.map((opt) => ({
      id: opt.id,
      nome: opt.name,
      preco: Number(opt.extraPrice || 0),
    })),
  };
}
