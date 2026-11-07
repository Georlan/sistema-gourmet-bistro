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
  groupKind: 'size' | 'pasteis' | 'sucos' | 'vitaminas' | 'refrigerantes' | 'generic';
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

const normalize = (val: string) =>
  (val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

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

function formatVariantLabel(name: string, kind: string): string {
  const norm = normalize(name);
  if (kind === 'pasteis') {
    return name
      .replace(/^pastel\s*(medio|médio|ao|ão)?\s*(de\s*)?/i, '')
      .replace(/^pastel\s*/i, '')
      .replace(/^\w/, (c) => c.toUpperCase());
  }
  if (kind === 'sucos') {
    return name.replace(/^suco\s*(de\s*)?/i, '').replace(/^\w/, (c) => c.toUpperCase());
  }
  if (kind === 'vitaminas') {
    return name.replace(/^vitamina\s*(de\s*)?/i, '').replace(/^\w/, (c) => c.toUpperCase());
  }
  if (kind === 'refrigerantes') {
    return name.replace(/^refrigerante\s*/i, '').replace(/^\w/, (c) => c.toUpperCase());
  }
  return name;
}

/**
 * Agrupa apenas o MESMO produto vendido em gramagens distintas. A identificação
 * vem do nome/gramagem dos SKUs cadastrados, nunca do ID do tenant, do produto
 * ou de um preço hardcoded. Batatas especiais e acompanhadas não correspondem
 * ao padrão e permanecem produtos independentes.
 */
function groupSizedFries(products: Product[]): CatalogDisplayItem[] {
  const details = new Map<Product, { base: string; size: string; grams: number }>();
  const families = new Map<string, Product[]>();
  for (const product of products) {
    const match = normalize(product.name).match(/^(batata frita)\s+(pequena|media|grande)\s*\(\s*(\d+)\s*g\s*\)$/);
    if (!match) continue;
    const key = match[1];
    details.set(product, { base: key, size: match[2], grams: Number(match[3]) });
    families.set(key, [...(families.get(key) || []), product]);
  }

  const shownFamilies = new Set<string>();
  return products.flatMap((product): CatalogDisplayItem[] => {
    const parsed = details.get(product);
    if (!parsed) return [product];
    const members = families.get(parsed.base) || [];
    if (members.length < 2 || new Set(members.map((item) => details.get(item)?.size)).size < 2) {
      return [product];
    }
    if (shownFamilies.has(parsed.base)) return [];
    shownFamilies.add(parsed.base);

    const sizeLabels: Record<string, string> = { pequena: 'Pequena', media: 'Média', grande: 'Grande' };
    const order: Record<string, number> = { pequena: 0, media: 1, grande: 2 };
    const variants: DisplayVariant[] = [...members]
      .sort((a, b) => (order[details.get(a)!.size] ?? 99) - (order[details.get(b)!.size] ?? 99))
      .map((item) => {
        const size = details.get(item)!;
        return {
          id: item.id,
          label: `${sizeLabels[size.size]} (${size.grams} g)`,
          description: item.description,
          price: calculateProductMinStartingPrice(item),
          product: item,
          isAvailable: item.isAvailable !== false,
        };
      });
    const available = variants.filter((variant) => variant.isAvailable);
    const prices = (available.length ? available : variants).map((variant) => variant.price);
    const title = product.name.replace(/\s+(Pequena|Média|Media|Grande)\s*\(\s*\d+\s*g\s*\)$/i, '');
    const family: GroupedDisplayProduct = {
      ...product,
      id: `family-size-${parsed.base.replace(/\s+/g, '-')}`,
      name: title,
      description: 'Escolha o tamanho da porção.',
      price: Math.min(...prices),
      isGrouped: true,
      groupKind: 'size',
      groupTitle: title,
      groupDescription: 'Escolha o tamanho:',
      minPrice: Math.min(...prices),
      hasVariablePrice: Math.max(...prices) > Math.min(...prices),
      variants,
      isAvailable: variants.some((variant) => variant.isAvailable),
    };
    return [family];
  });
}

export function groupCategoryProductsForDisplay(
  categoryName: string,
  products: Product[],
  restaurantId?: string | number,
): CatalogDisplayItem[] {
  if (!products || products.length === 0) return [];

  // Agrupamento genérico de tamanhos configurados como SKUs reais: independente de tenant.
  const catNorm = normalize(categoryName);
  if (catNorm.includes('batata') || catNorm.includes('frita')) return groupSizedFries(products);

  // Famílias legadas de outras categorias permanecem restritas ao piloto,
  // sem estender agrupamentos artificiais aos demais restaurantes.
  const isEligibleRestaurant = restaurantId !== undefined && restaurantId !== null && String(restaurantId) === '1';
  if (!isEligibleRestaurant) {
    return products;
  }

  // Grupo Pastéis
  if (catNorm.includes('pastel') || catNorm.includes('pasteis')) {
    const pasteis = products.filter((p) => normalize(p.name).includes('pastel'));
    if (pasteis.length >= 2) {
      const remaining = products.filter((p) => !pasteis.includes(p));
      const variants: DisplayVariant[] = pasteis.map((p) => ({
        id: p.id,
        label: formatVariantLabel(p.name, 'pasteis'),
        description: p.description,
        price: calculateProductMinStartingPrice(p),
        product: p,
        isAvailable: p.isAvailable !== false,
      }));

      const availableVariants = variants.filter((v) => v.isAvailable);
      const pricingPool = availableVariants.length > 0 ? availableVariants : variants;
      const prices = pricingPool.map((v) => v.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const leadProduct = pasteis.find((p) => normalize(p.name).includes('carne de sol')) || pasteis[0];

      const grouped: GroupedDisplayProduct = {
        ...leadProduct,
        id: 'family-pasteis',
        name: 'Pastel / Pastelão',
        description: 'Escolha o tamanho e o sabor do seu pastel.',
        price: minPrice,
        isGrouped: true,
        groupKind: 'pasteis',
        groupTitle: 'Pastel / Pastelão',
        groupDescription: 'Escolha o sabor:',
        minPrice,
        hasVariablePrice: true, // Pastéis têm opção Pastelão com acréscimo
        variants,
        isAvailable: variants.some((v) => v.isAvailable),
      };

      return [grouped, ...remaining];
    }
  }

  // 3. Grupo Vitaminas e Sucos
  if (catNorm.includes('vitamina') || catNorm.includes('suco')) {
    const sucos = products.filter((p) => normalize(p.name).startsWith('suco'));
    const vitaminas = products.filter((p) => normalize(p.name).startsWith('vitamina'));
    const others = products.filter((p) => !sucos.includes(p) && !vitaminas.includes(p));

    const result: CatalogDisplayItem[] = [];

    if (sucos.length >= 2) {
      const variants: DisplayVariant[] = sucos.map((p) => ({
        id: p.id,
        label: formatVariantLabel(p.name, 'sucos'),
        description: p.description,
        price: calculateProductMinStartingPrice(p),
        product: p,
        isAvailable: p.isAvailable !== false,
      }));
      const availableVariants = variants.filter((v) => v.isAvailable);
      const pricingPool = availableVariants.length > 0 ? availableVariants : variants;
      const prices = pricingPool.map((v) => v.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const lead = sucos[0];

      result.push({
        ...lead,
        id: 'family-sucos-300ml',
        name: 'Sucos Naturais (300 ml)',
        description: 'Suco natural da fruta, refrescante e geladinho. Garrafinha de 300 ml.',
        price: minPrice,
        isGrouped: true,
        groupKind: 'sucos',
        groupTitle: 'Sucos Naturais (300 ml)',
        groupDescription: 'Escolha sua fruta favorita:',
        minPrice,
        hasVariablePrice: maxPrice > minPrice,
        variants,
        isAvailable: variants.some((v) => v.isAvailable),
      });
    } else {
      result.push(...sucos);
    }

    if (vitaminas.length >= 2) {
      const variants: DisplayVariant[] = vitaminas.map((p) => ({
        id: p.id,
        label: formatVariantLabel(p.name, 'vitaminas'),
        description: p.description,
        price: calculateProductMinStartingPrice(p),
        product: p,
        isAvailable: p.isAvailable !== false,
      }));
      const availableVariants = variants.filter((v) => v.isAvailable);
      const pricingPool = availableVariants.length > 0 ? availableVariants : variants;
      const prices = pricingPool.map((v) => v.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const lead = vitaminas[0];

      result.push({
        ...lead,
        id: 'family-vitaminas-300ml',
        name: 'Vitaminas Especiais (300 ml)',
        description: 'Vitamina cremosa de 300 ml batida com fruta, leite integral e leite em pó.',
        price: minPrice,
        isGrouped: true,
        groupKind: 'vitaminas',
        groupTitle: 'Vitaminas Especiais (300 ml)',
        groupDescription: 'Escolha a fruta para a sua vitamina:',
        minPrice,
        hasVariablePrice: maxPrice > minPrice,
        variants,
        isAvailable: variants.some((v) => v.isAvailable),
      });
    } else {
      result.push(...vitaminas);
    }

    result.push(...others);
    return result;
  }

  // 4. Grupo Refrigerantes
  if (catNorm.includes('refrigerante') || catNorm.includes('bebida')) {
    const refri1L = products.filter((p) => {
      const n = normalize(p.name);
      const d = normalize(p.description || '');
      return n.includes('refrigerante') && (n.includes('1l') || d.includes('1l') || d.includes('1 l'));
    });

    if (refri1L.length >= 2) {
      const remaining = products.filter((p) => !refri1L.includes(p));
      const variants: DisplayVariant[] = refri1L.map((p) => ({
        id: p.id,
        label: formatVariantLabel(p.name, 'refrigerantes'),
        description: p.description,
        price: calculateProductMinStartingPrice(p),
        product: p,
        isAvailable: p.isAvailable !== false,
      }));

      const availableVariants = variants.filter((v) => v.isAvailable);
      const pricingPool = availableVariants.length > 0 ? availableVariants : variants;
      const prices = pricingPool.map((v) => v.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const lead = refri1L[0];

      const grouped: GroupedDisplayProduct = {
        ...lead,
        id: 'family-refrigerantes-1l',
        name: 'Refrigerante 1L',
        description: 'Refrigerante bem gelado garrafa de 1 litro. Escolha seu sabor favorito.',
        price: minPrice,
        isGrouped: true,
        groupKind: 'refrigerantes',
        groupTitle: 'Refrigerante 1L',
        groupDescription: 'Escolha o sabor da bebida:',
        minPrice,
        hasVariablePrice: maxPrice > minPrice,
        variants,
        isAvailable: variants.some((v) => v.isAvailable),
      };

      return [grouped, ...remaining];
    }
  }

  // Para qualquer outra categoria (ex: Hambúrgueres), cada produto é individual
  return products;
}
