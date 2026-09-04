/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Plus } from "lucide-react";
import { Product, getProductImageUrl, LOCAL_PRODUCT_PLACEHOLDER } from "../CardapioTypes";
import "../cardapioTone.css";

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

  return (
    <article
      className={`cardapio-product-card group relative ${available ? "is-available" : "is-unavailable"}`}
      id={`product-card-${product.id}`}
    >
      {available && (
        <button
          type="button"
          className="cardapio-product-card__details-hitbox"
          onClick={() => onSelectProduct(product)}
          aria-label={`${product.name}, ${formattedPrice}, ver detalhes`}
        />
      )}
      <div className="cardapio-product-card__content">
        <div className="cardapio-product-card__copy">
          <div className="cardapio-product-card__heading">
            <h3 className="font-bold text-sm text-white group-hover:text-emerald-400 transition-colors leading-tight">
              {product.name}
            </h3>
            {!available && (
              <span className="rounded-md bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-rose-400">
                Esgotado
              </span>
            )}
          </div>
          {product.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-400 font-normal">
              {product.description}
            </p>
          )}
          <div className="cardapio-product-card__footer mt-auto pt-3">
            <strong className="cardapio-product-card__price text-sm font-extrabold text-emerald-400">
              {formattedPrice}
            </strong>
            {available && (
              <button
                type="button"
                onClick={() => {
                  onFastAdd(product);
                }}
                className="cardapio-product-card__add inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500 border border-emerald-500/30 hover:border-emerald-500 px-3 py-1.5 text-xs font-bold text-emerald-400 hover:text-white transition-all shadow-sm cursor-pointer"
                id={`btn-fast-add-${product.id}`}
                title={`Adicionar ${product.name}`}
                aria-label={`Adicionar ${product.name} à sacola`}
              >
                <Plus size={14} className="stroke-[2.5]" />
                <span>Adicionar</span>
              </button>
            )}
          </div>
        </div>

        <div className="cardapio-product-card__media shrink-0 overflow-hidden rounded-xl bg-white/5 border border-white/10 relative">
          <img
            src={getProductImageUrl(product.image)}
            alt={product.name}
            loading="lazy"
            decoding="async"
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
            }}
          />
        </div>
      </div>
    </article>
  );
}
