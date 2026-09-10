import React, { useMemo } from 'react';
import { Megaphone } from 'lucide-react';
import type { BrandConfig, Product } from '../CardapioTypes';

const CAMPAIGN_CATEGORY = /(destaque|oferta|promo(?:c[aã]o|ç[aã]o)?|campanha|especial)/i;
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export function getCatalogHighlights(products: Product[]): Product[] {
  return products
    .filter((product) => product.isAvailable !== false && CAMPAIGN_CATEGORY.test(String(product.category || '')))
    .slice(0, 4);
}

export function CardapioHighlights({ brand }: { brand: BrandConfig }) {
  const highlights = useMemo(() => getCatalogHighlights(brand.products), [brand.products]);

  if (highlights.length === 0) return null;

  const focusProduct = (product: Product) => {
    const target = document.getElementById(`product-card-${product.id}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => target?.querySelector<HTMLElement>('.cardapio-product-card__details-hitbox')?.focus(), 450);
  };

  return (
    <section aria-labelledby="cardapio-highlights-title" className="w-full basis-full border-t border-koma-border pt-3" id="cardapio-highlights-home">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-500/10 text-amber-400">
          <Megaphone className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="cardapio-highlights-title" className="text-sm font-black text-koma-foreground">Destaques da casa</h2>
          <p className="text-[10px] text-koma-muted">Seleções e campanhas publicadas no catálogo atual.</p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" role="list">
        {highlights.map((product) => (
          <button
            key={product.id}
            type="button"
            role="listitem"
            onClick={() => focusProduct(product)}
            className="relative min-w-[220px] max-w-[280px] overflow-hidden rounded-xl border border-amber-500/20 bg-koma-panel text-left transition hover:border-amber-500/40 hover:bg-koma-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
            aria-label={`Ver destaque ${product.name} no cardápio`}
          >
            <img src={product.image} alt="" loading="lazy" decoding="async" className="h-24 w-full object-cover" />
            <span className="block p-3">
              <span className="text-[9px] font-black uppercase tracking-[0.12em] text-amber-400">Destaque</span>
              <strong className="mt-1 block truncate text-xs text-koma-foreground">{product.name}</strong>
              <span className="mt-1 block text-xs font-black text-emerald-400">{money(product.price)}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
