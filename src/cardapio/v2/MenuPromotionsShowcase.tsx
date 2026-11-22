import React, { useMemo } from "react";
import { Tag } from "lucide-react";
import {
  CatalogPromotion,
  LOCAL_PRODUCT_PLACEHOLDER,
  Product,
} from "../CardapioTypes";
import CatalogProductImage from "../components/CatalogProductImage";
import { MenuPromoArcBackdrop } from "./MenuSvgAssets";
import "./menuPromotions.css";

export interface MenuPromotionsShowcaseProps {
  id?: string;
  promotions: CatalogPromotion[];
  promotionCatalogProducts: Product[];
  formatPrice: (price: number) => string;
  onPromotionSelect?: (promo: CatalogPromotion) => void;
}

export function MenuPromotionsShowcase({
  id = "cardapio-promotions-home",
  promotions,
  promotionCatalogProducts,
  formatPrice,
  onPromotionSelect,
}: MenuPromotionsShowcaseProps) {
  const productImageById = useMemo(() => {
    const map = new Map<string, string>();
    for (const candidate of promotionCatalogProducts) {
      if (candidate.image && candidate.image !== LOCAL_PRODUCT_PLACEHOLDER) {
        map.set(String(candidate.id), candidate.image);
      }
    }
    return map;
  }, [promotionCatalogProducts]);

  if (!promotions || promotions.length === 0) {
    return null;
  }

  const layout =
    promotions.length === 1
      ? "single"
      : promotions.length === 2
        ? "pair"
        : "carousel";
  const countLabel =
    promotions.length === 1 ? "1 oferta" : `${promotions.length} ofertas`;

  const mediaSizes =
    layout === "single"
      ? "(max-width: 519px) 100vw, 236px"
      : layout === "pair"
        ? "(max-width: 559px) 78vw, 370px"
        : "(max-width: 767px) 72vw, 252px";

  return (
    <section
      className={`km-promo-showcase km-promo-showcase--${layout}`}
      id={id}
      data-promo-layout={layout}
      aria-label="Promoções da Casa"
    >
      <MenuPromoArcBackdrop className="km-promo-arc-svg" />
      <div className="km-promo-showcase__inner" id="km-highlights">
        <div className="km-section__head km-promo-showcase__head">
          <h2 className="km-promo-showcase__title">Promoções da Casa</h2>
          <span className="km-promo-showcase__count km-tabular">{countLabel}</span>
        </div>

        <div className={`km-promo-track km-promo-track--${layout}`}>
          {promotions.map((promo, index) => {
            let fallbackComponentImage: string | undefined;
            if (promo.componentes) {
              for (const group of promo.componentes) {
                for (const componentId of group) {
                  const candidateImage = productImageById.get(String(componentId));
                  if (candidateImage) {
                    fallbackComponentImage = candidateImage;
                    break;
                  }
                }
                if (fallbackComponentImage) break;
              }
            }

            const explicitImage = promo.imagem_url?.trim();
            const offerImage =
              explicitImage && explicitImage !== LOCAL_PRODUCT_PLACEHOLDER
                ? explicitImage
                : fallbackComponentImage;
            const description = promo.descricao?.trim();

            return (
              <button
                key={promo.id}
                type="button"
                className={`km-promo-card km-promo-card--${layout}`}
                aria-label={`Montar promoção ${promo.nome} por ${formatPrice(promo.preco)}`}
                onClick={() => onPromotionSelect?.(promo)}
              >
                <span className="km-promo-tag">
                  <Tag size={11} aria-hidden="true" />
                  {promo.tipo === "compre_ganhe" ? "Compre e ganhe" : "Oferta especial"}
                </span>

                <div
                  className={`km-promo-card__media${offerImage ? "" : " km-promo-card__media--empty"}`}
                >
                  <CatalogProductImage
                    image={offerImage}
                    alt={promo.nome}
                    priority={index < 2}
                    sizes={mediaSizes}
                  />
                </div>

                <div className="km-promo-card__body">
                  <h3 className="km-promo-card__title">{promo.nome}</h3>
                  {description ? (
                    <p className="km-promo-card__desc">{description}</p>
                  ) : null}

                  <div className="km-promo-card__footer">
                    <span className="km-price km-promo-card__price km-tabular">
                      {formatPrice(promo.preco)}
                    </span>
                    <span className="km-cta-mini km-promo-card__cta">
                      Aproveitar
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default React.memo(MenuPromotionsShowcase);
