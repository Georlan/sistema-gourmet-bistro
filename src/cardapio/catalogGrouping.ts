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
  groupKind: 'batata-tradicional' | 'pastel-medio' | 'pastelao' | 'sucos' | 'vitaminas' | 'refrigerantes' | 'generic';
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
  if (kind === 'pastel-medio' || kind === 'pastelao') {
    return name
      .replace(/^pastel\s+m[eé]dio\s*/i, '')
      .replace(/^pastel[aã]o\s*/i, '')
      .replace(/^de\s+/i, '')
      .replace(/^sabor\s+/i, '')
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

function legacyGroupCategoryProductsForDisplay(
  categoryName: string,
  products: Product[],
  restaurantId?: string | number,
): CatalogDisplayItem[] {
  if (!products || products.length === 0) return [];

  // O agrupamento visual por famílias foi validado inicialmente para o JE Lanches (ID 1).
  // Para outros restaurantes da plataforma, mantemos 100% o comportamento padrão e retrocompatibilidade,
  // preservando a flexibilidade de configurar famílias de produtos por tenant futuramente.
  const isEligibleRestaurant = restaurantId !== undefined && restaurantId !== null && String(restaurantId) === '1';
  if (!isEligibleRestaurant) {
    return products;
  }

  const catNorm = normalize(categoryName);

  // Agrupa apenas tamanhos do MESMO preparo, identificados nos produtos reais.
  // Outras batatas (especial, frango, carne de sol) ficam com seu próprio SKU.
  if (catNorm.includes('batata') || catNorm.includes('frita')) {
    const sizes = products.flatMap((p) => {
      const match = normalize(p.name).match(/^batata frita (pequena|media|grande)\s*\((\d+)\s*g\)$/);
      return match ? [{ product: p, size: match[1], grams: Number(match[2]) }] : [];
    }).sort((a, b) => a.grams - b.grams);

    if (sizes.length >= 2) {
      const groupedProducts = new Set(sizes.map((entry) => entry.product));
      const variants: DisplayVariant[] = sizes.map(({ product: p, size, grams }) => ({
        id: String(p.id),
        label: `${size === 'pequena' ? 'Pequena' : size === 'media' ? 'Média' : 'Grande'} · ${grams} g`,
        description: p.description,
        price: calculateProductMinStartingPrice(p),
        product: p,
        isAvailable: p.isAvailable !== false,
      }));
      const available = variants.filter((variant) => variant.isAvailable);
      const values = (available.length > 0 ? available : variants).map((variant) => variant.price);
      const lead = sizes[0].product;
      const grouped: GroupedDisplayProduct = {
        ...lead,
        id: 'family-batata-tradicional',
        name: 'Batata Frita Tradicional',
        description: 'Batata frita com molho rosé. Escolha o tamanho da porção.',
        price: Math.min(...values),
        isGrouped: true,
        groupKind: 'batata-tradicional',
        requiresExplicitVariantSelection: true,
        groupTitle: 'Batata Frita Tradicional',
        groupDescription: 'Escolha o tamanho:',
        minPrice: Math.min(...values),
        hasVariablePrice: Math.max(...values) > Math.min(...values),
        variants,
        isAvailable: variants.some((variant) => variant.isAvailable),
      };
      return [grouped, ...products.filter((p) => !groupedProducts.has(p))];
    }
    return products;
  }

  // Pastéis: o tamanho já é a identidade do card. Dentro dele escolhe-se
  // apenas um sabor. Não criar escolhas de tamanho duplicadas no modal.
  if (catNorm.includes('pastel') || catNorm.includes('pasteis')) {
    const groups = [
      { kind: 'pastel-medio' as const, title: 'Pastel Médio', matcher: /^pastel medio(?:\s|$)/ },
      { kind: 'pastelao' as const, title: 'Pastelão', matcher: /^pastelao(?:\s|$)/ },
    ];
    const groupedProducts = new Set<Product>();
    const display: CatalogDisplayItem[] = [];

    for (const group of groups) {
      const flavors = products.filter((p) => group.matcher.test(normalize(p.name)));
      if (flavors.length < 2) continue;
      const variants: DisplayVariant[] = flavors.map((p) => ({
        id: String(p.id),
        label: formatVariantLabel(p.name, group.kind),
        description: p.description,
        price: calculateProductMinStartingPrice(p),
        product: p,
        isAvailable: p.isAvailable !== false,
      }));
      const available = variants.filter((v) => v.isAvailable);
      const values = (available.length ? available : variants).map((v) => v.price);
      const minPrice = Math.min(...values);
      flavors.forEach((p) => groupedProducts.add(p));
      display.push({
        ...flavors[0],
        id: `family-${group.kind}`,
        name: group.title,
        description: group.kind === 'pastel-medio'
          ? 'Pastel médio crocante e preparado na hora. Escolha o recheio.'
          : 'Pastelão crocante e preparado na hora. Escolha o recheio.',
        price: minPrice,
        isGrouped: true,
        groupKind: group.kind,
        requiresExplicitVariantSelection: true,
        groupTitle: group.title,
        groupDescription: 'Escolha o sabor:',
        minPrice,
        hasVariablePrice: Math.max(...values) > minPrice,
        variants,
        isAvailable: variants.some((v) => v.isAvailable),
      });
    }
    return [...display, ...products.filter((p) => !groupedProducts.has(p))];
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


/**
 * Explicit persisted families take precedence over the JE legacy name fallback.
 * The family is a display-only card; every variant retains its own sellable SKU.
 * The old heuristic only sees as-yet-unmigrated products, avoiding duplicate cards.
 */
export function groupCategoryProductsForDisplay(
  categoryName: string,
  products: Product[],
  restaurantId?: string | number,
): CatalogDisplayItem[] {
  if (!products?.length) return [];

  const byFamily = new Map<string, Product[]>();
  for (const product of products) {
    if (!product.familia_id || !product.familia_nome) continue;
    const group = byFamily.get(product.familia_id) || [];
    group.push(product);
    byFamily.set(product.familia_id, group);
  }
  if (!byFamily.size) return legacyGroupCategoryProductsForDisplay(categoryName, products, restaurantId);

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
      groupKind: 'generic',
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

  // Legacy fallback is limited to products with no explicit family association.
  const ungrouped = products.filter(product => !product.familia_id || !byFamily.has(product.familia_id));
  const legacy = legacyGroupCategoryProductsForDisplay(categoryName, ungrouped, restaurantId);
  const legacyBySku = new Map<string, CatalogDisplayItem>();
  for (const display of legacy) {
    if (isGroupedProduct(display)) {
      for (const variant of display.variants) legacyBySku.set(variant.id, display);
    } else {
      legacyBySku.set(display.id, display);
    }
  }

  // Preserve category order as configured, using the first variant as the card anchor.
  const emitted = new Set<string>();
  const result: CatalogDisplayItem[] = [];
  for (const product of products) {
    const display = product.familia_id && native.has(product.familia_id)
      ? native.get(product.familia_id)!
      : legacyBySku.get(product.id) || product;
    const identity = isGroupedProduct(display) ? `family:${display.id}` : `sku:${display.id}`;
    if (emitted.has(identity)) continue;
    emitted.add(identity);
    result.push(display);
  }
  return result;
}
