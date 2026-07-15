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
      className={`group relative flex flex-row lg:flex-col gap-3 rounded-2xl border border-slate-500/10 bg-card-app p-3 hover:bg-slate-500/5 cursor-pointer transition-all shadow-2xs hover:shadow-md hover:border-slate-500/20 ${
        !product.isAvailable ? "opacity-60 cursor-not-allowed" : ""
      }`}
      id={`product-card-${product.id}`}
    >
      {/* Product Image — Right on mobile/tablet, Top on desktop */}
      <div className="relative shrink-0 h-20 w-20 lg:h-32 lg:w-full order-last lg:order-first">
        <img
          src={getProductImageUrl(product.image)}
          alt={product.name}
          className="h-full w-full rounded-xl object-cover shadow-xs transition group-hover:scale-[1.02] duration-300"
          loading="lazy"
        />
        {product.isAvailable && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFastAdd(product);
            }}
            className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white shadow-md hover:scale-105 active:scale-95 transition duration-150 cursor-pointer"
            id={`btn-fast-add-${product.id}`}
            title="Adicionar rápido"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Product Details — Left on mobile/tablet, Below image on desktop */}
      <div className="flex-1 min-w-0 flex flex-col justify-between lg:justify-start gap-1">
        <div>
          <div className="flex items-start gap-1.5 flex-wrap">
            <h3 className="font-display text-sm font-bold text-text-app group-hover:text-primary transition leading-tight line-clamp-2">
              {product.name}
            </h3>
            {!product.isAvailable && (
              <span className="rounded bg-red-100/10 px-1.5 py-0.5 text-[8px] font-bold text-red-500 uppercase shrink-0 mt-0.5">
                Esgotado
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-text-app/55 line-clamp-2 leading-relaxed">
            {product.description}
          </p>
        </div>
        <span className="mt-2 block text-sm font-extrabold text-primary">
          {formattedPrice}
        </span>
      </div>
    </div>
  );
}
