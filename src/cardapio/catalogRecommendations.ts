import type { Product } from './CardapioTypes';

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

export type RecommendationKind = 'destaque' | 'combo' | 'upsell' | 'bebida' | 'sobremesa';

export type Recommendation = {
  kind: RecommendationKind;
  label: string;
  product: Product;
};

const MAIN_CATEGORY_MATCHER = /(^|\b)(burger|burgers|hamburguer|hamburgueres|lanche|lanches|smash|pizza|pizzas|quentinha|quentinhas|marmita|marmitas|prato|pratos|refeicao|refeicoes|principal|principais)(\b|$)/;
const COMBO_MATCHER = /(^|\b)(combo|combos|promocional|promocionais|oferta|ofertas)(\b|$)/;
const UPSELL_MATCHER = /(^|\b)(porcao|porcoes|petisco|petiscos|fritas|batata|batatas|onion|anel|aneis|nuggets|acompanhamento|acompanhamentos|entrada|entradas|adicional|adicionais|guarnicao|guarnicoes)(\b|$)/;
const BEBIDA_MATCHER = /(^|\b)(bebida|bebidas|drink|drinks|refrigerante|refrigerantes|suco|sucos|cerveja|cervejas|chopp|agua|aguas)(\b|$)/;
const SOBREMESA_MATCHER = /(^|\b)(sobremesa|sobremesas|doce|doces|dessert|desserts|sorvete|sorvetes|milkshake|milk-shake|acai|brownie)(\b|$)/;

/** Seleciona recomendações complementares exclusivamente a partir do catálogo público vigente. */
export function buildCatalogRecommendations(
  products: Product[],
  _categories?: string[],
  excludeProductIds?: string[] | Set<string>,
): Recommendation[] {
  const available = products.filter((product) => product.isAvailable !== false);
  if (available.length === 0) return [];

  const excluded = excludeProductIds
    ? (excludeProductIds instanceof Set ? excludeProductIds : new Set(excludeProductIds))
    : new Set<string>();

  const pickRecommendations = (filterExcluded: boolean): Recommendation[] => {
    const chosenIds = new Set<string>();
    const recs: Recommendation[] = [];

    const addRecommendation = (product: Product, kind: RecommendationKind, label: string) => {
      if (chosenIds.has(product.id) || recs.length >= 3) return;
      if (filterExcluded && excluded.has(product.id)) return;
      chosenIds.add(product.id);
      recs.push({ kind, label, product });
    };

    const primaryProduct = available.find((product) => {
      if (filterExcluded && excluded.has(product.id)) return false;
      const cat = normalize(product.category || '');
      return MAIN_CATEGORY_MATCHER.test(cat);
    }) || available.find((product) => {
      if (filterExcluded && excluded.has(product.id)) return false;
      const cat = normalize(product.category || '');
      return !BEBIDA_MATCHER.test(cat) && !SOBREMESA_MATCHER.test(cat);
    });

    if (primaryProduct) {
      addRecommendation(primaryProduct, 'destaque', 'Destaque');
    }

    const comboProduct = available.find((product) => {
      if (chosenIds.has(product.id)) return false;
      if (filterExcluded && excluded.has(product.id)) return false;
      const cat = normalize(product.category || '');
      const name = normalize(product.name || '');
      return COMBO_MATCHER.test(cat) || COMBO_MATCHER.test(name);
    });

    if (comboProduct) {
      addRecommendation(comboProduct, 'combo', 'Combo');
    }

    const upsellProduct = available.find((product) => {
      if (chosenIds.has(product.id)) return false;
      if (filterExcluded && excluded.has(product.id)) return false;
      const cat = normalize(product.category || '');
      return UPSELL_MATCHER.test(cat);
    });

    if (upsellProduct) {
      addRecommendation(upsellProduct, 'upsell', 'Acompanhamento');
    }

    if (recs.length < 3) {
      for (const product of available) {
        if (recs.length >= 3) break;
        if (chosenIds.has(product.id)) continue;
        if (filterExcluded && excluded.has(product.id)) continue;
        const cat = normalize(product.category || '');
        if (!BEBIDA_MATCHER.test(cat) && !SOBREMESA_MATCHER.test(cat)) {
          addRecommendation(product, 'destaque', 'Sugestão');
        }
      }
    }

    if (recs.length < 3) {
      for (const product of available) {
        if (recs.length >= 3) break;
        if (chosenIds.has(product.id)) continue;
        if (filterExcluded && excluded.has(product.id)) continue;
        const cat = normalize(product.category || '');
        if (BEBIDA_MATCHER.test(cat)) {
          addRecommendation(product, 'bebida', 'Bebida');
        } else if (SOBREMESA_MATCHER.test(cat)) {
          addRecommendation(product, 'sobremesa', 'Sobremesa');
        } else {
          addRecommendation(product, 'destaque', 'Sugestão');
        }
      }
    }

    return recs;
  };

  const candidateRecs = excluded.size > 0 ? pickRecommendations(true) : pickRecommendations(false);
  const hasRealPhoto = (img?: string) => Boolean(img) && !img?.startsWith('data:image/svg+xml');
  const hasPhotoProducts = available.some((p) => hasRealPhoto(p.image));
  if (hasPhotoProducts && !candidateRecs.some((r) => hasRealPhoto(r.product.image))) {
    return pickRecommendations(false);
  }
  return candidateRecs.length > 0 ? candidateRecs : pickRecommendations(false);
}
