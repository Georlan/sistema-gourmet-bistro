/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Product } from './CardapioTypes';

export type ProductClassification = 'main' | 'side' | 'beverage' | 'dessert' | 'other';

const normalize = (value: string) =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const BEVERAGE_MATCHER =
  /(^|\b)(bebida|bebidas|drink|drinks|refrigerante|refrigerantes|suco|sucos|cerveja|cervejas|chopp|agua|aguas|refri|cha|cha gelado|coca|guarana|soda|long neck)(\b|$)/i;

const SIDE_MATCHER =
  /(^|\b)(porcao|porcoes|acompanhamento|acompanhamentos|fritas|batata|batatas|farofa|mandioca|anel|aneis|onion|nugget|nuggets|molho|molhos|entrada|entradas|petisco|petiscos|adicional|adicionais|guarnicao|guarnicoes)(\b|$)/i;

const DESSERT_MATCHER =
  /(^|\b)(sobremesa|sobremesas|doce|doces|dessert|desserts|sorvete|sorvetes|pudim|acai|brownie|milkshake|milk-shake|torta|tortinha|petit gateau)(\b|$)/i;

const MAIN_MATCHER =
  /(^|\b)(burger|burgers|hamburguer|hamburgueres|pizza|pizzas|marmita|marmitas|marmitaria|prato|pratos|refeicao|refeicoes|lanche|lanches|sanduiche|sanduiches|combo|combos|smash|poke|salada|saladas)(\b|$)/i;

export function classifyProduct(product: Product): ProductClassification {
  const cat = normalize(product.category);
  const name = normalize(product.name);

  // Um ingrediente no nome nunca transforma um prato principal em complemento.
  if (MAIN_MATCHER.test(cat) || MAIN_MATCHER.test(name)) return 'main';
  if (BEVERAGE_MATCHER.test(cat) || BEVERAGE_MATCHER.test(name)) return 'beverage';
  if (SIDE_MATCHER.test(cat) || SIDE_MATCHER.test(name)) return 'side';
  if (DESSERT_MATCHER.test(cat) || DESSERT_MATCHER.test(name)) return 'dessert';
  if (MAIN_MATCHER.test(cat) || MAIN_MATCHER.test(name)) return 'main';
  return 'other';
}

export interface PairingRecommendationsParams {
  catalog: Product[];
  cartProductIds?: (string | number)[];
  focusedProductId?: string | number | null;
  limit?: number;
  excludeCartItems?: boolean;
}

/**
 * Retorna produtos contextuais e complementares ao pedido do cliente,
 * priorizando acompanhamentos, bebidas e sobremesas de forma balanceada.
 *
 * Invariantes:
 * - Nunca recomenda o produto atualmente em foco.
 * - Nunca recomenda pratos principais (mains como burgers/pizzas/marmitas) em seções de harmonização/upsell.
 * - Se excludeCartItems for false (padrão), mantém as recomendações estáveis sem fazer cards sumirem ao adicionar.
 * - Nunca recomenda produtos indisponíveis (isAvailable === false).
 * - Se não houver complementos relevantes suficientes, retorna menos ou zero itens (nunca preenche com burgers).
 */
export function getPairingRecommendations({
  catalog,
  cartProductIds = [],
  focusedProductId = null,
  limit = 4,
  excludeCartItems = false,
}: PairingRecommendationsParams): Product[] {
  if (!catalog || catalog.length === 0 || limit <= 0) return [];

  const excludedIds = new Set<string>();
  if (focusedProductId != null) {
    excludedIds.add(String(focusedProductId));
  }
  if (excludeCartItems) {
    for (const id of cartProductIds) {
      excludedIds.add(String(id));
    }
  }

  // Apenas produtos disponíveis e não excluídos
  const eligible = catalog.filter(
    (p) => p.isAvailable !== false && !excludedIds.has(String(p.id))
  );

  if (eligible.length === 0) return [];

  const groups = { side: [] as Product[], beverage: [] as Product[], dessert: [] as Product[] };
  for (const product of eligible) {
    const kind = classifyProduct(product);
    if (kind === 'side' || kind === 'beverage' || kind === 'dessert') groups[kind].push(product);
  }
  // A lista persistente não depende da sacola: trocar + por quantidade não
  // desloca cards nem remove o item que o cliente acabou de adicionar.
  const kinds = ['side', 'beverage', 'dessert'] as const;
  const cartIds = new Set(cartProductIds.map(String));
  const present = new Set(catalog.filter(p => cartIds.has(String(p.id))).map(classifyProduct));
  const firstKinds = excludeCartItems ? kinds.filter(kind => !present.has(kind)) : kinds;
  const candidates = [
    ...firstKinds.map(kind => groups[kind][0]),
    ...groups.beverage, ...groups.side, ...groups.dessert,
  ];
  const seen = new Set<string>();
  return candidates.filter((product): product is Product => {
    if (!product || seen.has(String(product.id))) return false;
    seen.add(String(product.id));
    return true;
  }).slice(0, limit);
}
