import React from 'react';
import { ArrowRight, Gift } from 'lucide-react';
import CatalogProductImage from './CatalogProductImage';
import { useActivePromotions } from '../useActivePromotions';
import { LOCAL_PRODUCT_PLACEHOLDER, type BrandConfig, type CatalogPromotion } from '../CardapioTypes';

const money = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

/** Ofertas explícitas: nunca confundidas com sugestões automáticas. */
export default function CardapioPromotions({
  brand,
  onSelect,
}: {
  brand: BrandConfig;
  onSelect: (promotion: CatalogPromotion) => void;
}) {
  const offers = useActivePromotions(brand.promotions);
  if (!offers.length) return null;

  return (
    <section
      aria-label="Promoções"
      className="w-full basis-full border-t border-koma-border pt-3"
      id="cardapio-promotions-home"
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          className="grid h-8 w-8 place-items-center rounded-xl border border-koma-border bg-koma-card text-koma-secondary"
          aria-hidden="true"
        >
          <Gift className="h-4 w-4" />
        </span>
        <div>
          <h2
            className="text-sm font-bold text-koma-foreground"
            style={{ fontFamily: 'var(--koma-font-display)' }}
          >
            Promoções
          </h2>
          <p className="text-[11px] text-koma-muted">
            Aproveite ofertas Compre e Ganhe, combos e descontos da casa.
          </p>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
        {offers.map((offer) => {
          const offerType =
            offer.tipo
            || (offer.brinde_nome ? 'compre_ganhe' : offer.componentes.length === 1 ? 'desconto_item' : 'combo');
          const eyebrow =
            offerType === 'compre_ganhe'
              ? 'Compre e ganhe'
              : offerType === 'desconto_item'
                ? 'Oferta especial'
                : 'Combo promocional';
          const offerImage = offer.componentes
            .flat()
            .map(
              (id) =>
                [...brand.products, ...(brand.promotionProducts || [])].find((product) => product.id === id)?.image,
            )
            .find((image) => image && image !== LOCAL_PRODUCT_PLACEHOLDER);

          return (
            <button
              key={offer.id}
              type="button"
              onClick={() => onSelect(offer)}
              className="flex min-w-[230px] max-w-[310px] flex-col gap-2 rounded-xl border border-koma-border bg-koma-panel p-3 text-left transition hover:bg-koma-raised"
              aria-label={`Montar promoção ${offer.nome} por ${money(offer.preco)}`}
            >
              <CatalogProductImage
                image={offerImage}
                className="h-28 w-full rounded-lg bg-koma-card object-cover"
              />
              <span className="text-[10px] font-bold uppercase tracking-wide text-koma-secondary">
                {eyebrow}
              </span>
              <strong
                className="text-sm font-bold text-koma-foreground"
                style={{ fontFamily: 'var(--koma-font-display)' }}
              >
                {offer.nome}
              </strong>
              {offer.brinde_nome && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-koma-secondary">
                  <Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Brinde: {offer.brinde_nome}
                </span>
              )}
              {offer.descricao && <span className="text-xs text-koma-muted">{offer.descricao}</span>}
              <span
                className="mt-auto flex items-center justify-between pt-1"
                style={{ color: 'var(--koma-success-text)' }}
              >
                <strong className="text-base font-bold tabular-nums">{money(offer.preco)}</strong>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
