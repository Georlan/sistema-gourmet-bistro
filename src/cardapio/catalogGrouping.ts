/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Product } from './CardapioTypes';

export interface DisplayVariant {
  id: string;
  label: string;
  description?: string;
  price: number;
  product: Product;
  isAvailable: boolean;
}

export interface GroupedDisplayProduct extends Product {
  isGrouped: true;
  /** Exige escolha consciente antes de adicionar o SKU real à sacola. */
  requiresExplicitVariantSelection?: boolean;
  groupTitle: string;
  groupDescription: string;
  minPrice: number;
  hasVariablePrice: boolean;
  variants: DisplayVariant[];
}

export type CatalogDisplayItem = Product | GroupedDisplayProduct;

export function isGroupedProduct(item: CatalogDisplayItem): item is GroupedDisplayProduct {
  return Boolean(item && typeof item === 'object' && (item as GroupedDisplayProduct).isGrouped === true);
}

/**
 * Calcula o custo mínimo de entrada de um produto, somando o preço base ao
 * menor custo possível de seleções obrigatórias (minSelection > 0 ou tipo 'obrigatorio').
 */
export function calculateProductMinStartingPrice(product: Product): number {
  let minCost = Number(product.price) || 0;

  if (product.modifierGroups && product.modifierGroups.length > 0) {
    for (const group of product.modifierGroups) {
      const isRequired = typeof group.minSelection === 'number'
        ? group.minSelection > 0
        : group.type === 'obrigatorio';
      const minSelection = Math.max(0, group.minSelection ?? (isRequired ? 1 : 0));

      if (minSelection > 0 && group.options && group.options.length > 0) {
        const activeOptions = group.options.filter((o) => o.active !== false);
        if (activeOptions.length > 0) {
          const sortedPrices = activeOptions
            .map((o) => Number(o.extraPrice) || 0)
            .sort((a, b) => a - b);
          const cheapest = sortedPrices.slice(0, minSelection);
          const groupMinExtra = cheapest.reduce((sum, price) => sum + price, 0);
          minCost += groupMinExtra;
        }
      }
    }
  } else if (product.modifiers && product.modifiers.length > 0) {
    for (const mod of product.modifiers) {
      if (mod.required && mod.options && mod.options.length > 0) {
        const sortedPrices = mod.options
          .map((o) => Number(o.extraPrice) || 0)
          .sort((a, b) => a - b);
        minCost += sortedPrices[0] || 0;
      }
    }
  }

  return minCost;
}

/**
 * One card per persisted family, preserving real SKU identities and product order.
 * Unassociated products always remain independent, regardless of tenant/name.
 */
export function groupCategoryProductsForDisplay(
  _categoryName: string,
  products: Product[],
  _restaurantId?: string | number,
): CatalogDisplayItem[] {
  if (!products?.length) return [];

  const byFamily = new Map<string, Product[]>();
  for (const product of products) {
    if (!product.familia_id || !product.familia_nome) continue;
    const group = byFamily.get(product.familia_id) || [];
    group.push(product);
    byFamily.set(product.familia_id, group);
  }
  if (!byFamily.size) return products;

  const native = new Map<string, GroupedDisplayProduct>();
  for (const [familyId, members] of byFamily) {
    const lead = members[0];
    const variants: DisplayVariant[] = members.map((product) => ({
      id: String(product.id),
      label: product.variacao_rotulo || product.name,
      description: product.description,
      price: calculateProductMinStartingPrice(product),
      product,
      isAvailable: product.isAvailable !== false,
    }));
    const available = variants.filter(variant => variant.isAvailable);
    const prices = (available.length ? available : variants).map(variant => variant.price);
    const minPrice = Math.min(...prices);
    native.set(familyId, {
      ...lead,
      id: `family-${familyId}`,
      name: lead.familia_nome!,
      description: lead.familia_descricao || lead.description,
      image: lead.familia_imagem || lead.image,
      price: minPrice,
      isGrouped: true,
      requiresExplicitVariantSelection: variants.length > 1,
      groupTitle: lead.familia_nome!,
      groupDescription: lead.familia_eixo === 'tamanho' ? 'Escolha o tamanho:' :
        lead.familia_eixo === 'sabor' ? 'Escolha o sabor:' : 'Escolha a opção:',
      minPrice,
      hasVariablePrice: Math.max(...prices) > minPrice,
      variants,
      isAvailable: variants.some(variant => variant.isAvailable),
    });
  }

  // Each SKU is mapped to its persisted family card at most once.
  const emitted = new Set<string>();
  const result: CatalogDisplayItem[] = [];
  for (const product of products) {
    const display = product.familia_id && native.has(product.familia_id)
      ? native.get(product.familia_id)!
      : product;
    const identity = isGroupedProduct(display) ? `family:${display.id}` : `sku:${display.id}`;
    if (emitted.has(identity)) continue;
    emitted.add(identity);
    result.push(display);
  }
  return result;
}
