import type { Product } from './CardapioTypes';
import {
  groupCategoryProductsForDisplay,
  isGroupedProduct,
  type CatalogDisplayItem,
  type GroupedDisplayProduct,
} from './catalogGrouping';

/**
 * Recomendações e catálogo devem abrir a MESMA montagem.
 *
 * Se o catálogo mostra uma família configurada, converte qualquer variante
 * recomendada à família; se mostra produtos separados, preserva o SKU original.
 * Sem IDs de restaurantes/produtos ou regras de preços específicas.
 */
export function resolvePairingDisplay(
  catalog: Product[],
  recommended: Product[],
  restaurantId?: string | number,
  limit = 4,
): CatalogDisplayItem[] {
  const byProductId = new Map<string, GroupedDisplayProduct>();
  const categories = new Set(catalog.map((product) => product.category));
  for (const category of categories) {
    const categoryProducts = catalog.filter((product) => product.category === category);
    for (const item of groupCategoryProductsForDisplay(category, categoryProducts, restaurantId)) {
      if (!isGroupedProduct(item)) continue;
      for (const variant of item.variants) byProductId.set(String(variant.id), item);
    }
  }

  const seen = new Set<string>();
  const result: CatalogDisplayItem[] = [];
  for (const product of recommended) {
    const item = byProductId.get(String(product.id)) || product;
    if (seen.has(String(item.id))) continue;
    seen.add(String(item.id));
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}
