import CatalogProductImage from './CatalogProductImage';
import React from 'react';
import { Gift, ArrowRight } from 'lucide-react';
import { LOCAL_PRODUCT_PLACEHOLDER, type BrandConfig, type CatalogPromotion } from '../CardapioTypes';
const money = (v: number) => new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format(v);

/** Ofertas explícitas: nunca confundidas com sugestões automáticas. */
export default function CardapioPromotions({
  brand, onSelect,
}: {brand: BrandConfig; onSelect: (promotion: CatalogPromotion) => void}) {
  const offers = brand.promotions || [];
  if (!offers.length) return null;
  return (
    <section aria-label="Promoções" className="w-full basis-full border-t border-koma-border pt-3" id="cardapio-promotions-home">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-500/10 text-amber-400"><Gift className="h-4 w-4" /></span>
        <div><h2 className="text-sm font-black text-koma-foreground">Promoções</h2>
          <p className="text-[10px] text-koma-muted">Monte cada item por etapas e aproveite o preço do conjunto.</p>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
        {offers.map(offer => (
          <button key={offer.id} type="button" onClick={() => onSelect(offer)}
            className="flex min-w-[230px] max-w-[310px] flex-col gap-2 rounded-xl border border-amber-500/30 bg-koma-panel p-3 text-left transition hover:border-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
            aria-label={`Montar promoção ${offer.nome} por ${money(offer.preco)}`}>
            <CatalogProductImage image={offer.componentes.flat().map(id =>
              [...brand.products, ...(brand.promotionProducts || [])].find(product => product.id === id)?.image
            ).find(image => image && image !== LOCAL_PRODUCT_PLACEHOLDER)} className="h-28 w-full rounded-lg bg-koma-card object-cover" />
            <span className="text-[10px] font-black uppercase tracking-wide text-amber-400">Oferta da casa</span>
            <strong className="text-sm text-koma-foreground">{offer.nome}</strong>
            <span className="text-xs text-koma-muted">{offer.descricao}</span>
            <span className="flex items-center justify-between text-emerald-400"><strong className="text-base">{money(offer.preco)}</strong><ArrowRight className="h-4 w-4" /></span>
          </button>
        ))}
      </div>
    </section>
  );
}
