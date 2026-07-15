/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Product, getProductImageUrl } from "../CardapioTypes";
import { Plus } from "lucide-react";


interface CardapioProductCardProps {
  key?: React.Key;
  product: Product;
  onSelectProduct: (product: Product) => void;
  onFastAdd: (product: Product) => void;
}

export default function CardapioProductCard({
  product,
  onSelectProduct,
  onFastAdd
}: CardapioProductCardProps) {
  const formattedPrice = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(product.price);

  return (
    <div
      onClick={() => product.isAvailable && onSelectProduct(product)}
      className={`group relative flex flex-row md:flex-col justify-between md:justify-start gap-4 rounded-2xl border border-slate-500/10 bg-card-app p-4 hover:bg-slate-500/5 cursor-pointer transition shadow-2xs ${
        !product.isAvailable ? "opacity-60 cursor-not-allowed" : ""
      }`}
      id={`product-card-${product.id}`}
    >
      {/* Product Details (Left on mobile, Top on desktop) */}
      <div className="flex-1 min-w-0 flex flex-col justify-between md:justify-start">
        <div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-display text-sm md:text-base font-bold text-text-app group-hover:text-primary transition truncate">
              {product.name}
            </h3>
            {!product.isAvailable && (
              <span className="rounded bg-red-100/10 px-1.5 py-0.5 text-[8px] md:text-[9px] font-bold text-red-500 uppercase shrink-0">
                Esgotado
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] md:text-xs text-text-app/60 line-clamp-2 leading-relaxed">
            {product.description}
          </p>
        </div>
        <span className="mt-2 md:mt-4 block text-sm md:text-base font-extrabold text-primary">
          {formattedPrice}
        </span>
      </div>

      {/* Product Image and Quick Add (Right on mobile, Bottom/Center on desktop) */}
      <div className="relative h-16 w-16 md:h-36 md:w-full shrink-0">
        <img
          src={getProductImageUrl(product.image)}
          alt={product.name}
          className="h-full w-full rounded-xl object-cover shadow-xs transition group-hover:scale-[1.01]"
          loading="lazy"
        />
        {product.isAvailable && (
          <button
            onClick={(e) => {
              e.stopPropagation(); // Avoid opening the product details modal
              onFastAdd(product);
            }}
            className="absolute -bottom-1 -right-1 md:-bottom-2 md:-right-2 flex h-6 w-6 md:h-8 md:w-8 items-center justify-center rounded-lg md:rounded-xl bg-primary text-white shadow-md hover:scale-105 active:scale-95 transition duration-150 cursor-pointer"
            id={`btn-fast-add-${product.id}`}
            title="Adicionar rápido"
          >
            <Plus className="h-3.5 w-3.5 md:h-5 md:w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
