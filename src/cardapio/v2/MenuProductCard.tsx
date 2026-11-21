import React from "react";
import { Minus, Plus } from "lucide-react";
import { Product } from "../CardapioTypes";
import { isGroupedProduct, type GroupedDisplayProduct } from "../catalogGrouping";
import { getEffectiveProductPrice, getProductBadgeLabel } from "../../domain/productMerchandising";
import CatalogProductImage from "../components/CatalogProductImage";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export const formatMenuPrice = (value: number): string => currencyFormatter.format(value);

interface MenuProductCardProps {
  product: Product | GroupedDisplayProduct;
  cartQuantity: number;
  variant?: "row" | "highlight";
  priority?: boolean;
  onSelectProduct: (product: Product | GroupedDisplayProduct) => void;
  onFastAdd: (product: Product | GroupedDisplayProduct, event?: React.MouseEvent) => void;
  onFastRemove: (product: Product | GroupedDisplayProduct, event?: React.MouseEvent) => void;
}

const MenuProductCard = React.memo(function MenuProductCard({
  product,
  cartQuantity,
  variant = "row",
  priority = false,
  onSelectProduct,
  onFastAdd,
  onFastRemove,
}: MenuProductCardProps) {
  const available = product.isAvailable !== false;
  const isGrouped = isGroupedProduct(product);
  const badgeLabel = getProductBadgeLabel(product.selo);
  const priceInfo = getEffectiveProductPrice(product.price, product.promotionalPrice);

  const formattedEffective = formatMenuPrice(priceInfo.effectivePrice);
  const formattedOriginal =
    priceInfo.hasDiscount && priceInfo.originalPrice != null
      ? formatMenuPrice(priceInfo.originalPrice)
      : null;

  const displayPrice =
    isGrouped && product.hasVariablePrice ? `A partir de ${formattedEffective}` : formattedEffective;

  const hasModifiers = Boolean(
    isGrouped ||
      (product.modifiers && product.modifiers.length > 0) ||
      (product.modifierGroups && product.modifierGroups.length > 0),
  );

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!available) return;
    if (isGrouped || hasModifiers) {
      onSelectProduct(product);
      return;
    }
    onFastAdd(product, e);
  };

  const handleQuickRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!available) return;
    onFastRemove(product, e);
  };

  const isHighlight = variant === "highlight";

  return (
    <article
      className={`km-product-card ${isHighlight ? "km-product-card--highlight" : ""} ${available ? "" : "is-unavailable"}`}
      id={`product-card-${product.id}`}
    >
      {available && (
        <button
          type="button"
          className="km-product-card__hitbox"
          onClick={() => onSelectProduct(product)}
          aria-label={`Ver detalhes de ${product.name} — ${displayPrice}`}
        />
      )}

      {isHighlight && (
        <div className="km-product-card__media">
          <CatalogProductImage image={product.image} alt={product.name} priority={priority} width={160} height={136} />
          {available && (cartQuantity === 0 || hasModifiers) && (
            <button
              type="button"
              className="km-add-fab"
              onClick={handleQuickAdd}
              aria-label={`Adicionar ${product.name} à sacola`}
            >
              <Plus size={17} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <div className="km-product-card__info">
        {(!available || badgeLabel || product.destaque) && (
          <div>
            {!available && <span className="km-badge km-badge--muted">Esgotado</span>}
            {available && badgeLabel && <span className="km-badge">{badgeLabel}</span>}
            {available && !badgeLabel && product.destaque && (
              <span className="km-badge">Destaque</span>
            )}
          </div>
        )}

        <h3 className="km-product-card__title">{product.name}</h3>

        {!isHighlight && product.description && (
          <p className="km-product-card__desc">{product.description}</p>
        )}

        <div className="km-product-card__price-row">
          <span className="km-price">{displayPrice}</span>
          {formattedOriginal && <span className="km-price--strike">{formattedOriginal}</span>}

          {available && cartQuantity > 0 && !hasModifiers && (
            <div className="km-qty-control" style={{ marginLeft: "auto" }}>
              <button
                type="button"
                className="km-qty-btn"
                onClick={handleQuickRemove}
                aria-label={`Remover uma unidade de ${product.name}`}
              >
                <Minus size={13} aria-hidden="true" />
              </button>
              <span className="km-qty-value">{cartQuantity}</span>
              <button
                type="button"
                className="km-qty-btn km-qty-btn--add"
                onClick={handleQuickAdd}
                aria-label={`Adicionar mais uma unidade de ${product.name}`}
              >
                <Plus size={13} aria-hidden="true" />
              </button>
            </div>
          )}

          {!isHighlight && available && (cartQuantity === 0 || hasModifiers) && (
            <button
              type="button"
              className="km-add-pill"
              style={{ marginLeft: "auto" }}
              onClick={handleQuickAdd}
              aria-label={`Adicionar ${product.name} à sacola`}
            >
              <span>{hasModifiers ? "Escolher" : "Adicionar"}</span>
              <span className="km-add-pill__circle">
                <Plus size={14} aria-hidden="true" />
              </span>
            </button>
          )}
        </div>
      </div>

      {!isHighlight && (
        <div className="km-product-card__media">
          <CatalogProductImage image={product.image} alt={product.name} priority={priority} width={92} height={92} />
        </div>
      )}
    </article>
  );
});

export default MenuProductCard;
