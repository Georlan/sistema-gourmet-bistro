/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Minus, Plus } from "lucide-react";
import { Product, getProductImageUrl, LOCAL_PRODUCT_PLACEHOLDER } from "../CardapioTypes";
import "../cardapioTone.css";

interface CardapioProductCardProps {
  key?: React.Key;
  product: Product;
  cartQuantity?: number;
  onSelectProduct: (product: Product) => void;
  onFastAdd: (product: Product) => void;
  onFastRemove?: (product: Product) => void;
}

export default function CardapioProductCard({
  product,
  cartQuantity = 0,
  onSelectProduct,
  onFastAdd,
  onFastRemove,
}: CardapioProductCardProps) {
  const available = product.isAvailable !== false;
  const hasModifiers = Boolean(
    (product.modifiers && product.modifiers.length > 0) ||
    (product.modifierGroups && product.modifierGroups.length > 0)
  );

  const formattedPrice = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(product.price);

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!available) return;
    onFastAdd(product);
  };

  return (
    <article
      className={`cardapio-product-card group relative ${available ? "is-available" : "is-unavailable"}`}
      id={`product-card-${product.id}`}
      onClick={() => {
        if (available) onSelectProduct(product);
      }}
    >
      {available && (
        <button
          type="button"
          className="cardapio-product-card__details-hitbox"
          onClick={(event) => { event.stopPropagation(); onSelectProduct(product); }}
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
            {available && hasModifiers && (
              <span className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-emerald-400/90">
                Opções
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
              hasModifiers ? (
                <span className="text-xs font-bold text-emerald-400">Escolher opções</span>
              ) : cartQuantity > 0 ? (
                <div
                  className="cardapio-product-card__stepper relative z-10 inline-flex items-center gap-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 p-0.5 shadow-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFastRemove?.(product);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20 active:scale-95 cursor-pointer"
                    id={`btn-fast-dec-${product.id}`}
                    aria-label={`Diminuir ${product.name}`}
                  >
                    <Minus size={13} className="stroke-[2.5]" />
                  </button>
                  <span
                    className="min-w-[1.25rem] text-center text-xs font-black text-emerald-400"
                    id={`qty-${product.id}`}
                  >
                    {cartQuantity}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFastAdd(product);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 text-white transition hover:bg-emerald-400 active:scale-95 shadow-sm cursor-pointer"
                    id={`btn-fast-inc-${product.id}`}
                    aria-label={`Aumentar ${product.name}`}
                  >
                    <Plus size={13} className="stroke-[2.5]" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleAction}
                  className="cardapio-product-card__add relative z-10 inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500 border border-emerald-500/30 hover:border-emerald-500 px-3 py-1.5 text-xs font-bold text-emerald-400 hover:text-white transition-all shadow-sm cursor-pointer"
                  id={`btn-fast-add-${product.id}`}
                  title={`Adicionar ${product.name}`}
                  aria-label={`Adicionar ${product.name} à sacola`}
                >
                  <Plus size={14} className="stroke-[2.5]" />
                  <span>Adicionar</span>
                </button>
              )
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
