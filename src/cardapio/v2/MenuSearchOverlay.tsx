import React, { useEffect, useMemo, useRef } from "react";
import { ArrowLeft, X } from "lucide-react";
import { Product } from "../CardapioTypes";
import { smartSearchMatch } from "../../domain";
import MenuProductCard from "./MenuProductCard";
import { MenuSearchGlyph } from "./MenuSvgAssets";

interface MenuSearchOverlayProps {
  open: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  products: Product[];
  getProductCartQuantity: (productId: string) => number;
  onSelectProduct: (product: Product) => void;
  onFastAdd: (product: Product, event?: React.MouseEvent) => void;
  onFastRemove: (product: Product, event?: React.MouseEvent) => void;
}

export default function MenuSearchOverlay({
  open,
  query,
  onQueryChange,
  onClose,
  products,
  getProductCartQuantity,
  onSelectProduct,
  onFastAdd,
  onFastRemove,
}: MenuSearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return products.slice(0, 12);
    return products.filter(
      (p) => smartSearchMatch(p.name, trimmed) || smartSearchMatch(p.description || "", trimmed),
    );
  }, [products, query]);

  if (!open) return null;

  return (
    <div className="km-search-overlay" role="dialog" aria-modal="true" aria-label="Buscar no cardápio">
      <div className="km-search-overlay__head">
        <button
          type="button"
          className="km-icon-btn"
          onClick={onClose}
          aria-label="Voltar ao cardápio"
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>

        <div className="km-search-input-wrap">
          <MenuSearchGlyph size={18} className="km-search-input-wrap__icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Buscar prato, ingrediente ou bebida..."
            aria-label="Buscar prato, ingrediente ou bebida"
          />
          {query && (
            <button
              type="button"
              className="km-qty-btn"
              onClick={() => onQueryChange("")}
              aria-label="Limpar busca"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="km-search-overlay__body">
        <p className="km-search-overlay__meta">
          {query.trim()
            ? `${results.length} ${results.length === 1 ? "item encontrado" : "itens encontrados"}`
            : "Sugestões do cardápio"}
        </p>

        {results.length === 0 ? (
          <div className="km-search-empty">
            <p className="km-search-empty__title">Nenhum item encontrado</p>
            <p className="km-search-empty__desc">
              Tente buscar por outro nome ou categoria.
            </p>
          </div>
        ) : (
          <div className="km-product-grid">
            {results.map((product) => (
              <MenuProductCard
                key={product.id}
                product={product}
                cartQuantity={getProductCartQuantity(product.id)}
                onSelectProduct={(p) => {
                  onClose();
                  onSelectProduct(p as Product);
                }}
                onFastAdd={onFastAdd as any}
                onFastRemove={onFastRemove as any}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
