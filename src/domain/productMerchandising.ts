export type ProductBadge = 'novidade' | 'mais_vendido' | 'recomendado' | 'edicao_limitada';

export const PRODUCT_BADGE_LABELS: Readonly<Record<ProductBadge, string>> = {
  novidade: 'Novidade',
  mais_vendido: 'Mais pedido',
  recomendado: 'Recomendado',
  edicao_limitada: 'Edição limitada',
};

export const PRODUCT_BADGE_OPTIONS: ReadonlyArray<{ value: ProductBadge | ''; label: string }> = [
  { value: '', label: 'Nenhum' },
  { value: 'novidade', label: 'Novidade' },
  { value: 'mais_vendido', label: 'Mais pedido' },
  { value: 'recomendado', label: 'Recomendado' },
  { value: 'edicao_limitada', label: 'Edição limitada' },
];

const VALID_BADGES = new Set<string>(Object.keys(PRODUCT_BADGE_LABELS));

export function normalizeProductBadge(value: unknown): ProductBadge | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  return VALID_BADGES.has(clean) ? (clean as ProductBadge) : null;
}

export function getProductBadgeLabel(badge: ProductBadge | string | null | undefined): string | null {
  const normalized = normalizeProductBadge(badge);
  return normalized ? PRODUCT_BADGE_LABELS[normalized] : null;
}

export interface ProductPriceResolution {
  effectivePrice: number;
  originalPrice: number | null;
  discountPercent: number | null;
  hasDiscount: boolean;
}

export function getEffectiveProductPrice(
  regularPrice: number,
  promotionalPrice?: number | null,
): ProductPriceResolution {
  const base = Number(regularPrice);
  const safeBase = Number.isFinite(base) && base >= 0 ? base : 0;
  const promo = promotionalPrice == null ? NaN : Number(promotionalPrice);

  if (Number.isFinite(promo) && promo > 0 && safeBase > 0 && promo < safeBase) {
    const discountPercent = Math.round(((safeBase - promo) / safeBase) * 100);
    return {
      effectivePrice: promo,
      originalPrice: safeBase,
      discountPercent: Math.max(1, discountPercent),
      hasDiscount: true,
    };
  }

  return {
    effectivePrice: safeBase,
    originalPrice: null,
    discountPercent: null,
    hasDiscount: false,
  };
}
