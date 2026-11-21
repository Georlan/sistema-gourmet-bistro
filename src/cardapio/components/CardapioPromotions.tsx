import React from 'react';
import { ArrowRight, Gift } from 'lucide-react';
import CatalogProductImage from './CatalogProductImage';
import { useActivePromotions } from '../useActivePromotions';
import { LOCAL_PRODUCT_PLACEHOLDER, type BrandConfig, type CatalogPromotion } from '../CardapioTypes';
import {
  calculatePromotionRegularTotal,
  formatPromotionItemsSummary,
  normalizeSlotQuantities,
} from '../../utils/promotionFormHelpers';

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

  const catalogProducts = [...brand.products, ...(brand.promotionProducts || [])];

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
          <p className="text-xs text-koma-muted">
            Aproveite ofertas Compre e Ganhe, combos e descontos da casa.
          </p>
        </div>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-none">
        {offers.map((offer) => {
          const offerType =
            offer.tipo
            || (offer.brinde_nome ? 'compre_ganhe' : offer.componentes.length === 1 ? 'desconto_item' : 'combo');
          const eyebrow =
            offerType === 'compre_ganhe'
              ? 'Compre e ganhe'
              : offerType === 'desconto_item'
                ? 'Desconto em 1 item'
                : 'Combo promocional';
          const qtys = normalizeSlotQuantities(offer.componentes.length, offer.quantidades);
          const resolvedSlots = offer.componentes
            .map((ids, index) => {
              const product = catalogProducts.find((candidate) => ids.includes(candidate.id));
              return product ? { product, qty: qtys[index] ?? 1 } : null;
            })
            .filter((entry): entry is { product: (typeof catalogProducts)[number]; qty: number } => Boolean(entry));

          const offerImage = resolvedSlots
            .map((entry) => entry.product.image)
            .find((image) => image && image !== LOCAL_PRODUCT_PLACEHOLDER);

          const itemsSummary = formatPromotionItemsSummary(
            resolvedSlots.map((entry) => ({ nome: entry.product.name, qty: entry.qty })),
            offer.brinde_nome,
          );
          const regularTotal = calculatePromotionRegularTotal(
            resolvedSlots.map((entry) => ({ preco: entry.product.price, qty: entry.qty })),
          );
          const hasSavings = regularTotal > offer.preco + 0.005;
          const discountPercent = hasSavings && regularTotal > 0
            ? Math.round(((regularTotal - offer.preco) / regularTotal) * 100)
            : null;

          return (
            <button
              key={offer.id}
              type="button"
              onClick={() => onSelect(offer)}
              className="flex min-w-[240px] max-w-[320px] flex-col gap-2 rounded-xl border border-koma-border bg-koma-panel p-3 text-left transition hover:bg-koma-raised"
              aria-label={`Montar promoção ${offer.nome} por ${money(offer.preco)}`}
            >
              <CatalogProductImage
                image={offerImage}
                className="h-28 w-full rounded-lg bg-koma-card object-cover"
              />
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wide text-koma-secondary">
                  {eyebrow}
                </span>
                {discountPercent != null && discountPercent > 0 && (
                  <span
                    className="rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums"
                    style={{
                      background: 'var(--koma-success-bg)',
                      borderColor: 'var(--koma-success-border)',
                      color: 'var(--koma-success-text)',
                    }}
                  >
                    {discountPercent}% OFF
                  </span>
                )}
              </div>
              <strong
                className="text-sm font-bold text-koma-foreground"
                style={{ fontFamily: 'var(--koma-font-display)' }}
              >
                {offer.nome}
              </strong>
              {itemsSummary && (
                <span className="rounded-lg border border-koma-border bg-koma-card px-2 py-1 text-xs font-semibold text-koma-secondary tabular-nums">
                  {itemsSummary}
                </span>
              )}
              {offer.descricao && <span className="text-xs text-koma-muted">{offer.descricao}</span>}
              <span
                className="mt-auto flex items-end justify-between gap-2 pt-1"
                style={{ color: 'var(--koma-success-text)' }}
              >
                <span className="tabular-nums">
                  {hasSavings && (
                    <span className="block text-xs text-koma-muted line-through">
                      De {money(regularTotal)}
                    </span>
                  )}
                  <strong className="text-base font-bold">
                    {hasSavings ? `Por ${money(offer.preco)}` : money(offer.preco)}
                  </strong>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
