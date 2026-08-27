/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Share2,
  ShoppingBag,
  X,
} from "lucide-react";
import {
  Product,
  ProductModifier,
  ProductOption,
  getProductImageUrl,
  LOCAL_PRODUCT_PLACEHOLDER,
} from "../CardapioTypes";

interface CardapioProductModalProps {
  product: Product;
  onClose: () => void;
  onAddToCart: (
    product: Product,
    quantity: number,
    selectedOptions: Record<string, ProductOption[]>,
    notes: string,
  ) => void;
}

const formatPrice = (value: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
}).format(value);

export default function CardapioProductModal({
  product,
  onClose,
  onAddToCart,
}: CardapioProductModalProps) {
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, ProductOption[]>>({});
  const [notes, setNotes] = useState("");
  const [currentImgIndex, setCurrentImgIndex] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [showToast, setShowToast] = useState(false);

  const galleryImages = useMemo(
    () => (product.imagesGallery && product.imagesGallery.length > 0
      ? product.imagesGallery.slice(0, 4)
      : [product.image]),
    [product],
  );

  const allModifiers = useMemo(() => {
    if (product.modifiers && product.modifiers.length > 0) return product.modifiers;
    if (product.modifierGroups && product.modifierGroups.length > 0) {
      return product.modifierGroups.map((g) => ({
        id: g.id,
        title: g.name,
        required: g.type === "obrigatorio" || g.minSelection > 0,
        maxSelection: g.maxSelection,
        minSelection: g.minSelection,
        options: g.options.map((o) => ({
          id: o.id,
          name: o.name,
          extraPrice: o.extraPrice,
        })),
      }));
    }
    return [];
  }, [product]);

  useEffect(() => {
    const initial: Record<string, ProductOption[]> = {};
    allModifiers.forEach((modifier) => {
      initial[modifier.id] = [];
    });
    setSelectedOptions(initial);
    setQuantity(1);
    setNotes("");
    setFeedback("");
    setCurrentImgIndex(0);
  }, [allModifiers, product]);

  const unitPrice = useMemo(() => {
    let value = product.price;
    Object.values(selectedOptions).forEach((options) => {
      options.forEach((option) => {
        value += option.extraPrice;
      });
    });
    return value;
  }, [product.price, selectedOptions]);

  const totalPrice = unitPrice * quantity;

  const handleShare = async () => {
    const shareData = {
      title: product.name,
      text: product.description ? `${product.name} — ${product.description}` : product.name,
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(window.location.href);
      setShowToast(true);
      window.setTimeout(() => setShowToast(false), 2200);
    } catch {
      // O produto continua acessível pelo cardápio mesmo sem clipboard.
    }
  };

  const handleOptionSelect = (modifier: any, option: ProductOption) => {
    setFeedback("");
    const currentSelections = selectedOptions[modifier.id] || [];

    if (modifier.maxSelection === 1) {
      setSelectedOptions((current) => ({ ...current, [modifier.id]: [option] }));
      return;
    }

    const exists = currentSelections.some((selected) => selected.id === option.id);
    if (exists) {
      setSelectedOptions((current) => ({
        ...current,
        [modifier.id]: currentSelections.filter((selected) => selected.id !== option.id),
      }));
      return;
    }

    if (currentSelections.length >= modifier.maxSelection) {
      setFeedback(`Você pode escolher até ${modifier.maxSelection} opção${modifier.maxSelection === 1 ? "" : "ões"} em ${modifier.title}.`);
      return;
    }

    setSelectedOptions((current) => ({
      ...current,
      [modifier.id]: [...currentSelections, option],
    }));
  };

  const handleAdd = () => {
    const unsatisfied = allModifiers.filter((modifier) => {
      const selections = selectedOptions[modifier.id] || [];
      const minReq = (modifier as any).minSelection || (modifier.required ? 1 : 0);
      return selections.length < minReq;
    });

    if (unsatisfied.length > 0) {
      setFeedback(`Selecione as opções obrigatórias em ${unsatisfied.map((m) => m.title).join(", ")} antes de adicionar.`);
      return;
    }

    onAddToCart(product, quantity, selectedOptions, notes.trim());
    onClose();
  };

  return (
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4 animate-fade-in cursor-pointer"
      id="product-details-modal"
    >
      <div className="relative flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-[30px] border border-koma-border bg-koma-panel shadow-2xl sm:max-w-lg sm:rounded-[30px] animate-slide-up">
        <div className="relative h-52 w-full shrink-0 overflow-hidden bg-koma-card sm:h-60">
          <img
            src={getProductImageUrl(galleryImages[currentImgIndex] || product.image)}
            alt={product.name}
            className="h-full w-full object-cover transition duration-300"
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/25" />

          <div className="absolute right-3 top-3 flex gap-2">
            <button
              type="button"
              onClick={handleShare}
              className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur transition hover:bg-black/70"
              title="Compartilhar produto"
              aria-label="Compartilhar produto"
              id="btn-share-product"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur transition hover:bg-black/70"
              aria-label="Fechar detalhes do produto"
              id="btn-close-modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {galleryImages.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setCurrentImgIndex((current) => current > 0 ? current - 1 : galleryImages.length - 1)}
                className="absolute left-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur"
                aria-label="Foto anterior"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentImgIndex((current) => current < galleryImages.length - 1 ? current + 1 : 0)}
                className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur"
                aria-label="Próxima foto"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-1.5 backdrop-blur">
                {galleryImages.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setCurrentImgIndex(index)}
                    className={`h-1.5 rounded-full transition-all ${index === currentImgIndex ? "w-4 bg-emerald-400" : "w-1.5 bg-white/50"}`}
                    aria-label={`Ver foto ${index + 1}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {showToast && (
          <div className="absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-xl border border-emerald-400/30 bg-[#0f241c] px-3 py-2 text-[10px] font-bold text-emerald-200 shadow-lg">
            Link copiado
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 sm:p-6 no-scrollbar">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-display text-xl font-black tracking-tight text-koma-foreground" id="modal-product-name">{product.name}</h2>
              {product.description && (
                <p className="mt-2 text-xs leading-relaxed text-koma-muted">{product.description}</p>
              )}
            </div>
            <strong className="shrink-0 text-base font-black text-emerald-500">{formatPrice(product.price)}</strong>
          </div>

          {allModifiers.length > 0 && (
            <div className="mt-6 space-y-5 border-t border-koma-border pt-5">
              {allModifiers.map((modifier) => {
                const selections = selectedOptions[modifier.id] || [];
                return (
                  <section key={modifier.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-black text-koma-foreground">{modifier.title}</h3>
                        <p className="mt-0.5 text-[10px] text-koma-muted">
                          {modifier.maxSelection === 1 ? "Escolha uma opção" : `Escolha até ${modifier.maxSelection} opções`}
                        </p>
                      </div>
                      <span className={modifier.required
                        ? "rounded-lg border border-emerald-500/20 bg-emerald-500/[0.08] px-2 py-1 text-[8px] font-black uppercase text-emerald-500"
                        : "rounded-lg border border-koma-border bg-koma-card px-2 py-1 text-[8px] font-black uppercase text-koma-muted"}
                      >
                        {modifier.required ? "Obrigatório" : "Opcional"}
                      </span>
                    </div>

                    <div className="mt-3 space-y-2">
                      {modifier.options.map((option) => {
                        const selected = selections.some((item) => item.id === option.id);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => handleOptionSelect(modifier, option)}
                            className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${
                              selected
                                ? "border-emerald-500/40 bg-emerald-500/[0.08]"
                                : "border-koma-border bg-koma-card hover:border-emerald-500/25"
                            }`}
                          >
                            <span className="min-w-0 text-xs font-semibold text-koma-foreground">{option.name}</span>
                            <span className="flex shrink-0 items-center gap-2">
                              {option.extraPrice > 0 && <span className="text-[10px] font-bold text-koma-muted">+ {formatPrice(option.extraPrice)}</span>}
                              <span className={`grid h-5 w-5 place-items-center rounded-full border ${selected ? "border-emerald-500 bg-emerald-500 text-white" : "border-koma-border text-transparent"}`}>
                                <Check className="h-3 w-3" />
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          <label className="mt-6 block border-t border-koma-border pt-5">
            <span className="text-xs font-black text-koma-foreground">Alguma observação?</span>
            <span className="mt-0.5 block text-[10px] text-koma-muted">Opcional · até 200 caracteres</span>
            <textarea
              id="notes-textarea"
              placeholder="Ex.: sem cebola, massa bem assada..."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-2.5 min-h-[76px] w-full resize-none rounded-xl border border-koma-border bg-koma-card p-3 text-xs leading-relaxed text-koma-foreground outline-none transition placeholder:text-koma-subtle focus:border-emerald-500"
              maxLength={200}
            />
          </label>

          {feedback && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] p-3 text-[10px] font-semibold leading-relaxed text-amber-500" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{feedback}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-koma-border bg-koma-panel p-4 sm:px-6">
          <div className="flex shrink-0 items-center rounded-xl border border-koma-border bg-koma-card p-1">
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.max(1, current - 1))}
              className="grid h-9 w-9 place-items-center rounded-lg text-koma-secondary transition hover:bg-koma-raised disabled:opacity-40"
              disabled={quantity <= 1}
              id="btn-qty-minus"
              aria-label="Diminuir quantidade"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-8 text-center text-sm font-black text-koma-foreground">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((current) => current + 1)}
              className="grid h-9 w-9 place-items-center rounded-lg text-koma-secondary transition hover:bg-koma-raised"
              id="btn-qty-plus"
              aria-label="Aumentar quantidade"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleAdd}
            className="flex h-12 min-w-0 flex-1 items-center justify-between gap-3 rounded-xl bg-emerald-500 px-4 text-white transition hover:bg-emerald-600 active:scale-[0.99]"
            id="btn-add-to-cart-action"
          >
            <span className="flex items-center gap-2 text-xs font-black uppercase tracking-wider">
              <ShoppingBag className="h-4 w-4" /> Adicionar
            </span>
            <strong className="text-sm">{formatPrice(totalPrice)}</strong>
          </button>
        </div>
      </div>
    </div>
  );
}
