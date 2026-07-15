/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Product, ProductModifier, ProductOption, getProductImageUrl } from "../CardapioTypes";
import { X, Plus, Minus, Check, Share2 } from "lucide-react";


interface CardapioProductModalProps {
  product: Product;
  onClose: () => void;
  onAddToCart: (
    product: Product,
    quantity: number,
    selectedOptions: Record<string, ProductOption[]>,
    notes: string
  ) => void;
}

export default function CardapioProductModal({
  product,
  onClose,
  onAddToCart
}: CardapioProductModalProps) {
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, ProductOption[]>>({});
  const [notes, setNotes] = useState("");
  const [totalPrice, setTotalPrice] = useState(product.price);
  const [showToast, setShowToast] = useState(false);

  const handleShare = async () => {
    const shareData = {
      title: product.name,
      text: `${product.name} - ${product.description || ""}`,
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.warn("Compartilhamento nativo cancelado ou falhou:", err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(window.location.href);
        setShowToast(true);
        setTimeout(() => setShowToast(false), 2500);
      } catch (err) {
        console.error("Falha ao copiar link:", err);
      }
    }
  };

  // Initialize selected options with defaults/required first options if applicable
  useEffect(() => {
    const initial: Record<string, ProductOption[]> = {};
    product.modifiers?.forEach((modifier) => {
      if (modifier.required && modifier.options.length > 0) {
        // Pre-select first option for required modifiers
        initial[modifier.id] = [modifier.options[0]];
      } else {
        initial[modifier.id] = [];
      }
    });
    setSelectedOptions(initial);
    setQuantity(1);
    setNotes("");
  }, [product]);

  // Recalculate price whenever selected options or quantity changes
  useEffect(() => {
    let basePrice = product.price;

    // Add prices of all selected options
    Object.values(selectedOptions).forEach((optionsList) => {
      (optionsList as ProductOption[]).forEach((opt) => {
        basePrice += opt.extraPrice;
      });
    });

    setTotalPrice(basePrice * quantity);
  }, [selectedOptions, quantity, product]);

  const handleOptionSelect = (modifier: ProductModifier, option: ProductOption) => {
    const currentSelections = selectedOptions[modifier.id] || [];

    if (modifier.maxSelection === 1) {
      // Radio button behavior: replace selection
      setSelectedOptions({
        ...selectedOptions,
        [modifier.id]: [option]
      });
    } else {
      // Checkbox behavior
      const exists = currentSelections.some((s) => s.id === option.id);
      let updated: ProductOption[];

      if (exists) {
        updated = currentSelections.filter((s) => s.id !== option.id);
      } else {
        if (currentSelections.length >= modifier.maxSelection) {
          // Reached limit, ignore or swap first
          updated = [...currentSelections.slice(1), option];
        } else {
          updated = [...currentSelections, option];
        }
      }

      setSelectedOptions({
        ...selectedOptions,
        [modifier.id]: updated
      });
    }
  };

  const handleAdd = () => {
    // Check if all required modifiers are satisfied
    const unsatisfied = product.modifiers?.filter((modifier) => {
      const selections = selectedOptions[modifier.id] || [];
      return modifier.required && selections.length === 0;
    });

    if (unsatisfied && unsatisfied.length > 0) {
      alert(`Por favor, preencha as opções obrigatórias: ${unsatisfied.map((m) => m.title).join(", ")}`);
      return;
    }

    onAddToCart(product, quantity, selectedOptions, notes);
    onClose();
  };

  const formattedTotalPrice = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(totalPrice);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4 animate-fade-in"
      id="product-details-modal"
    >
      {/* Modal Card wrapper */}
      <div className="relative flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-card-app border border-slate-500/10 shadow-2xl sm:max-w-md sm:rounded-3xl overflow-hidden animate-slide-up">
        
        {/* Banner image and close button */}
        <div className="relative h-48 w-full shrink-0">
          <img src={getProductImageUrl(product.image)} alt={product.name} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-linear-to-b from-black/40 via-transparent to-black/10" />
          
          <button
            onClick={handleShare}
            className="absolute top-4 right-14 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition cursor-pointer"
            title="Compartilhar Produto"
            id="btn-share-product"
          >
            <Share2 className="h-4.5 w-4.5" />
          </button>

          <button
            onClick={onClose}
            className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition cursor-pointer"
            id="btn-close-modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {showToast && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-white text-[11px] font-bold px-3 py-2 rounded-xl shadow-lg border border-emerald-400 animate-slide-up flex items-center gap-1.5 whitespace-nowrap">
            <span>✓ Link do produto copiado!</span>
          </div>
        )}

        {/* Modal content body */}
        <div className="flex-1 overflow-y-auto p-5 no-scrollbar">
          {/* Header titles */}
          <div>
            <h2 className="font-display text-xl font-bold text-text-app" id="modal-product-name">{product.name}</h2>
            <p className="mt-1.5 text-xs text-text-app/60 leading-relaxed">{product.description}</p>
            <span className="mt-3 block text-lg font-bold text-primary">
              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(product.price)}
            </span>
          </div>

          {/* Modifier Groups list */}
          {product.modifiers && product.modifiers.length > 0 && (
            <div className="mt-6 flex flex-col gap-6">
              {product.modifiers.map((modifier) => {
                const selections = selectedOptions[modifier.id] || [];
                return (
                  <div key={modifier.id} className="rounded-2xl border border-slate-500/10 bg-slate-500/5 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-text-app">{modifier.title}</h4>
                        <p className="text-[10px] text-text-app/40">
                          {modifier.maxSelection === 1 ? "Selecione 1 opção" : `Selecione até ${modifier.maxSelection} opções`}
                        </p>
                      </div>
                      {modifier.required ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold text-primary uppercase">
                          Obrigatório
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[9px] font-bold text-text-app/55 uppercase">
                          Opcional
                        </span>
                      )}
                    </div>

                    {/* Option items inside modifier */}
                    <div className="mt-3 flex flex-col gap-1.5">
                      {modifier.options.map((option) => {
                        const isSelected = selections.some((s) => s.id === option.id);
                        return (
                          <div
                            key={option.id}
                            onClick={() => handleOptionSelect(modifier, option)}
                            className={`flex items-center justify-between rounded-xl border p-3 cursor-pointer transition ${
                              isSelected
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-slate-500/10 bg-card-app text-text-app/80 hover:bg-slate-500/5"
                            }`}
                          >
                            <span className="text-xs font-semibold">{option.name}</span>
                            <div className="flex items-center gap-2">
                              {option.extraPrice > 0 && (
                                <span className="text-xs font-bold text-text-app/40">
                                  + R$ {option.extraPrice.toFixed(2)}
                                </span>
                              )}
                              <div
                                className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                                  isSelected
                                    ? "bg-primary border-primary text-white"
                                    : "border-slate-500/15"
                                  }`}
                              >
                                {isSelected && <Check className="h-3.5 w-3.5" />}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Observations / Remarks text box */}
          <div className="mt-6">
            <label className="text-xs font-bold text-text-app" htmlFor="notes-textarea">Observações</label>
            <textarea
              id="notes-textarea"
              placeholder="Alguma restrição, ponto da carne ou observação especial? Escreva aqui..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-500/10 bg-slate-500/5 p-3 text-xs text-text-app outline-hidden focus:border-primary transition min-h-[60px]"
              maxLength={200}
            />
          </div>
        </div>

        {/* Footer controls: Quantity selector and Add Button */}
        <div className="sticky bottom-0 border-t border-slate-500/15 bg-card-app p-4 flex items-center justify-between gap-4 shadow-lg shrink-0">
          {/* Quantity plus/minus */}
          <div className="flex items-center gap-3 rounded-full border border-slate-500/15 p-1">
            <button
              onClick={() => quantity > 1 && setQuantity(quantity - 1)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-500/10 hover:bg-slate-500/20 text-text-app/80 transition"
              id="btn-qty-minus"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-6 text-center text-sm font-bold text-text-app">{quantity}</span>
            <button
              onClick={() => setQuantity(quantity + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-500/10 hover:bg-slate-500/20 text-text-app/80 transition"
              id="btn-qty-plus"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {/* Add to Cart button */}
          <button
            onClick={handleAdd}
            className="flex-1 rounded-xl bg-primary py-3 text-center text-sm font-bold text-white shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition duration-150"
            id="btn-add-to-cart-action"
          >
            Adicionar • {formattedTotalPrice}
          </button>
        </div>

      </div>
    </div>
  );
}
