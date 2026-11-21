import type { Product } from './CardapioTypes';

const CAMPAIGN_CATEGORY = /(destaque|oferta|promo(?:c[aã]o|ç[aã]o)?|campanha|especial|especiais)/i;
const PROMOTION_CATEGORY = /(oferta|promo(?:c[aã]o|ç[aã]o)?)/i;

export const isCampaignPromotionProduct = (product: Product): boolean =>
  PROMOTION_CATEGORY.test(String(product.category || ''));

/**
 * Seleciona os destaques/ofertas do catálogo público vigente preservando
 * campanhas promocionais acima do recorte de outros destaques.
 */
export function getCatalogHighlights(products: Product[]): Product[] {
  const eligible = products.filter(
    (product) => product.isAvailable !== false && CAMPAIGN_CATEGORY.test(String(product.category || '')),
  );
  const promotions = eligible.filter(isCampaignPromotionProduct);
  return promotions.length > 0 ? promotions : eligible.slice(0, 4);
}
