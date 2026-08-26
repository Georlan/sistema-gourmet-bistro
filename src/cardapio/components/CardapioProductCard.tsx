/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Plus } from "lucide-react";
import { Product, getProductImageUrl, LOCAL_PRODUCT_PLACEHOLDER } from "../CardapioTypes";

interface CardapioProductCardProps {
  key?: React.Key;
  product: Product;
  onSelectProduct: (product: Product) => void;
  onFastAdd: (product: Product) => void;
}

export default function CardapioProductCard({
  product,
  onSelectProduct,
  onFastAdd,
}: CardapioProductCardProps) {
  const available = product.isAvailable !== false;
  const formattedPrice = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(product.price);

  const openProduct = () => {
    if (available) onSelectProduct(product);
  };

  return (
    <article
      className={`cardapio-product-card ${available ? "is-available" : "is-unavailable"}`}
      id={`product-card-${product.id}`}
      onClick={openProduct}
      onKeyDown={(event) => {
        if (!available || event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openProduct();
        }
      }}
      role={available ? "button" : undefined}
      tabIndex={available ? 0 : -1}
      aria-label={`${product.name}, ${formattedPrice}${available ? ", ver detalhes" : ", indisponível"}`}
    >
      <div className="cardapio-product-card__content">
        <div className="cardapio-product-card__copy">
          <div className="cardapio-product-card__heading">
            <h3>{product.name}</h3>
            {!available && <span>Indisponível</span>}
          </div>
          {product.description && <p>{product.description}</p>}
          <strong className="cardapio-product-card__price">{formattedPrice}</strong>
        </div>

        <div className="cardapio-product-card__media">
          <img
            src={getProductImageUrl(product.image)}
            alt={product.name}
            loading="lazy"
            decoding="async"
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
            }}
          />
          {available && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onFastAdd(product);
              }}
              className="cardapio-product-card__add"
              id={`btn-fast-add-${product.id}`}
              title={`Adicionar ${product.name}`}
              aria-label={`Adicionar ${product.name} à sacola`}
            >
              <Plus size={17} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
