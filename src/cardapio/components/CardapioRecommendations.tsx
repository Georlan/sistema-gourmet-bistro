import React, { useMemo } from 'react';
import { Coffee, IceCreamBowl, PlusCircle, Sparkles } from 'lucide-react';
import type { BrandConfig, Product } from '../CardapioTypes';

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

type RecommendationKind = 'bebida' | 'sobremesa' | 'adicional';

type Recommendation = {
  kind: RecommendationKind;
  label: string;
  product: Product;
};

const CATEGORY_MATCHERS: Record<RecommendationKind, RegExp> = {
  bebida: /(^|\b)(bebida|bebidas|drink|drinks|refrigerante|refrigerantes|suco|sucos|cerveja|cervejas)(\b|$)/,
  sobremesa: /(^|\b)(sobremesa|sobremesas|doce|doces|dessert|desserts|sorvete|sorvetes)(\b|$)/,
  adicional: /(^|\b)(adicional|adicionais|extra|extras|complemento|complementos|acompanhamento|acompanhamentos)(\b|$)/,
};

const LABELS: Record<RecommendationKind, string> = {
  bebida: 'Bebida',
  sobremesa: 'Sobremesa',
  adicional: 'Adicional',
};

function firstAvailableForKind(products: Product[], kind: RecommendationKind) {
  return products.find((product) => (
    product.isAvailable !== false
    && CATEGORY_MATCHERS[kind].test(normalize(product.category))
  ));
}

export function buildCatalogRecommendations(products: Product[]): Recommendation[] {
  const kinds: RecommendationKind[] = ['bebida', 'sobremesa', 'adicional'];
  return kinds.flatMap((kind) => {
    const product = firstAvailableForKind(products, kind);
    return product ? [{ kind, label: LABELS[kind], product }] : [];
  });
}

const iconByKind = {
  bebida: Coffee,
  sobremesa: IceCreamBowl,
  adicional: PlusCircle,
} as const;

export function CardapioRecommendations({ brand }: { brand: BrandConfig }) {
  const recommendations = useMemo(() => buildCatalogRecommendations(brand.products), [brand.products]);

  if (recommendations.length === 0) return null;

  const focusProduct = (product: Product) => {
    const target = document.getElementById(`product-card-${product.id}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof window !== 'undefined') {
      window.setTimeout(() => target?.querySelector<HTMLElement>('.cardapio-product-card__details-hitbox')?.focus(), 450);
    }
  };

  return (
    <section aria-labelledby="cardapio-recommendations-title" className="w-full basis-full border-t border-koma-border pt-3" id="cardapio-recommendations-home">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="cardapio-recommendations-title" className="text-sm font-black text-koma-foreground">Complete seu pedido</h2>
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
              onClick={() => focusProduct(product)}
              className="flex min-w-0 items-center gap-3 rounded-xl border border-koma-border bg-koma-panel p-2.5 text-left transition hover:border-emerald-500/30 hover:bg-koma-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
              aria-label={`Ver sugestão de ${label.toLowerCase()}: ${product.name}`}
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
