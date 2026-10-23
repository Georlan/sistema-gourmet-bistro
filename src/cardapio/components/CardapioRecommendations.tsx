import React, { useMemo, useState, useEffect } from 'react';
import type { BrandConfig, Product } from '../CardapioTypes';
import CatalogProductImage from './CatalogProductImage';

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

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

export function buildCatalogRecommendations(
  products: Product[],
  categories?: string[],
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

    // 1. Destaque / Produto Principal: burger, pizza, prato ou primeiro item da categoria inicial de comida
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

    // 2. Combo
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

    // 3. Upsell relevante / Acompanhamento / Porção
    const upsellProduct = available.find((product) => {
      if (chosenIds.has(product.id)) return false;
      if (filterExcluded && excluded.has(product.id)) return false;
      const cat = normalize(product.category || '');
      return UPSELL_MATCHER.test(cat);
    });

    if (upsellProduct) {
      addRecommendation(upsellProduct, 'upsell', 'Acompanhamento');
    }

    // 4. Complemento para até 3 itens (priorizando itens de comida antes de bebidas/sobremesas)
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

    // 5. Último recurso se o cardápio não possuir itens suficientes de comida
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

export function CardapioRecommendations({ brand }: { brand: BrandConfig }) {
  const [excludedIds, setExcludedIds] = useState<string[] | undefined>(brand.popularProductIds);

  useEffect(() => {
    if (brand.popularProductIds && brand.popularProductIds.length > 0) {
      setExcludedIds(brand.popularProductIds);
    }
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string[]>).detail;
      if (Array.isArray(detail)) {
        setExcludedIds(detail);
      }
    };
    window.addEventListener('koma:popular-products-loaded', handler);
    return () => window.removeEventListener('koma:popular-products-loaded', handler);
  }, [brand.popularProductIds]);

  const recommendations = useMemo(
    () => buildCatalogRecommendations(brand.products, brand.categories, excludedIds ?? brand.popularProductIds),
    [brand.products, brand.categories, excludedIds, brand.popularProductIds],
  );

  if (recommendations.length === 0) return null;

  const openProduct = (product: Product) => {
    const target = document.getElementById(`product-card-${product.id}`);
    const detailsTrigger = target?.querySelector<HTMLButtonElement>('.cardapio-product-card__details-hitbox');
    if (detailsTrigger) {
      detailsTrigger.click();
      return;
    }
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <section aria-labelledby="cardapio-recommendations-title" className="cardapio-editorial-section w-full basis-full" id="cardapio-recommendations-home">
      <div className="cardapio-showcase-header">
        <h2 id="cardapio-recommendations-title" className="cardapio-showcase-heading">Combina com seu pedido</h2>
        <span className="cardapio-showcase-badge">Seleção da casa</span>
      </div>
      <div className="cardapio-recommendation-list" role="list">
        {recommendations.map(({ kind, label, product }) => (
          <button
            key={`${kind}-${product.id}`}
            type="button"
            role="listitem"
            onClick={() => openProduct(product)}
            className="cardapio-editorial-card"
            aria-label={`Abrir ${label.toLowerCase()} ${product.name}`}
          >
            <span className="cardapio-editorial-card__content">
              <span className="cardapio-editorial-card__label">{label}</span>
              <strong className="cardapio-editorial-card__name">{product.name}</strong>
              <span className="cardapio-editorial-card__price">{money(product.price)}</span>
            </span>
            <CatalogProductImage image={product.image} className="cardapio-editorial-card__image" />
          </button>
        ))}
      </div>
    </section>
  );
}
