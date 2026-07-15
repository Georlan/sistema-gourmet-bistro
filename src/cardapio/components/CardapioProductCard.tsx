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
      className={`group relative flex items-center gap-4 border-b border-slate-500/10 bg-card-app p-4 hover:bg-slate-500/5 cursor-pointer transition ${
        !product.isAvailable ? "opacity-60 cursor-not-allowed" : ""
      }`}
      id={`product-card-${product.id}`}
    >
      {/* Product Details (Left Side) */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="font-display text-base font-bold text-text-app group-hover:text-primary transition truncate">
            {product.name}
          </h3>
          {!product.isAvailable && (
            <span className="rounded bg-red-100/10 px-1.5 py-0.5 text-[9px] font-bold text-red-500 uppercase">
              Esgotado
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-text-app/60 line-clamp-2 leading-relaxed">
          {product.description}
        </p>
        <span className="mt-3.5 block text-base font-extrabold text-primary">
          {formattedPrice}
        </span>
      </div>

      {/* Product Image and Quick Add (Right Side) */}
      <div className="relative h-20 w-20 shrink-0">
        <img
          src={getProductImageUrl(product.image)}
          alt={product.name}
          className="h-full w-full rounded-2xl object-cover shadow-sm transition group-hover:scale-[1.03]"
          loading="lazy"
        />
        {product.isAvailable && (
          <button
            onClick={(e) => {
              e.stopPropagation(); // Avoid opening the product details modal
              onFastAdd(product);
            }}
            className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-white shadow-md hover:scale-105 active:scale-95 transition duration-150"
            id={`btn-fast-add-${product.id}`}
            title="Adicionar rápido"
          >
            <Plus className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
