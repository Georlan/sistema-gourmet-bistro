import React, { useMemo } from 'react';
import { Coffee, Flame, IceCreamBowl, PlusCircle, Sparkles } from 'lucide-react';
import type { BrandConfig, Product } from '../CardapioTypes';

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

const iconByKind = {
  destaque: Sparkles,
  combo: Flame,
  upsell: PlusCircle,
  bebida: Coffee,
  sobremesa: IceCreamBowl,
} as const;

export function buildCatalogRecommendations(
  products: Product[],
  categories?: string[],
): Recommendation[] {
  const available = products.filter((product) => product.isAvailable !== false);
  if (available.length === 0) return [];

  const chosenIds = new Set<string>();
  const recommendations: Recommendation[] = [];

  const addRecommendation = (product: Product, kind: RecommendationKind, label: string) => {
    if (chosenIds.has(product.id) || recommendations.length >= 3) return;
    chosenIds.add(product.id);
    recommendations.push({ kind, label, product });
  };

  // 1. Destaque / Produto Principal: burger, pizza, prato ou primeiro item da categoria inicial de comida
  const primaryProduct = available.find((product) => {
    const cat = normalize(product.category || '');
    return MAIN_CATEGORY_MATCHER.test(cat);
  }) || available.find((product) => {
    const cat = normalize(product.category || '');
    return !BEBIDA_MATCHER.test(cat) && !SOBREMESA_MATCHER.test(cat);
  });

  if (primaryProduct) {
    addRecommendation(primaryProduct, 'destaque', 'Destaque');
  }

  // 2. Combo
  const comboProduct = available.find((product) => {
    if (chosenIds.has(product.id)) return false;
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
    const cat = normalize(product.category || '');
    return UPSELL_MATCHER.test(cat);
  });

  if (upsellProduct) {
    addRecommendation(upsellProduct, 'upsell', 'Acompanhamento');
  }

  // 4. Complemento para até 3 itens (priorizando itens de comida antes de bebidas/sobremesas)
  if (recommendations.length < 3) {
    for (const product of available) {
      if (recommendations.length >= 3) break;
      if (chosenIds.has(product.id)) continue;
      const cat = normalize(product.category || '');
      if (!BEBIDA_MATCHER.test(cat) && !SOBREMESA_MATCHER.test(cat)) {
        addRecommendation(product, 'destaque', 'Sugestão');
      }
    }
  }

  // 5. Último recurso se o cardápio não possuir itens suficientes de comida
  if (recommendations.length < 3) {
    for (const product of available) {
      if (recommendations.length >= 3) break;
      if (chosenIds.has(product.id)) continue;
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

  return recommendations;
}

export function CardapioRecommendations({ brand }: { brand: BrandConfig }) {
  const recommendations = useMemo(
    () => buildCatalogRecommendations(brand.products, brand.categories),
    [brand.products, brand.categories],
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
    <section aria-labelledby="cardapio-recommendations-title" className="w-full basis-full border-t border-koma-border pt-3" id="cardapio-recommendations-home">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="cardapio-recommendations-title" className="text-sm font-black text-koma-foreground">Destaques do cardápio</h2>
          <p className="text-[10px] text-koma-muted">Sugestões disponíveis agora no cardápio.</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3" role="list">
        {recommendations.map(({ kind, label, product }) => {
          const Icon = iconByKind[kind];
          return (
            <button
              key={`${kind}-${product.id}`}
              type="button"
              role="listitem"
              onClick={() => openProduct(product)}
              className="flex min-w-0 items-center gap-3 rounded-xl border border-koma-border bg-koma-panel p-2.5 text-left transition hover:border-emerald-500/30 hover:bg-koma-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
              aria-label={`Abrir ${label.toLowerCase()} ${product.name}`}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-koma-card text-emerald-400">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[9px] font-black uppercase tracking-wide text-koma-muted">{label}</span>
                <strong className="block truncate text-xs text-koma-foreground">{product.name}</strong>
                <span className="mt-0.5 block text-xs font-black text-emerald-400">{money(product.price)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
