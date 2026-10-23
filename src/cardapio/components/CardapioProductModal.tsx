/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Share2,
  ShoppingBag,
  X,
} from "lucide-react";
import {
  canIncrementSelectionQuantity,
  changeSelectionQuantity,
  modifierOptionQuantity,
  selectionCount,
  selectionWithinRules,
  type ModifierQuantityRules,
} from "../../domain/modifierQuantity";
import {
  Product,
  ProductModifier,
  ProductOption,
  getProductImageUrl,
  LOCAL_PRODUCT_PLACEHOLDER,
} from "../CardapioTypes";
import { trackAnalyticsEvent } from "../../analytics";
import { isMarmitariaSaladGroup } from "../../domain/marmitariaSalad";

interface CardapioProductModalProps {
  product: Product;
  initialItem?: { quantity: number; selectedOptions: Record<string, ProductOption[]>; notes: string };
  onClose: () => void;
  onAddToCart: (
    product: Product,
    quantity: number,
    selectedOptions: Record<string, ProductOption[]>,
    notes: string,
  ) => void;
  restaurantId?: string | number;
  // Reutiliza a montagem existente quando um pacote exige produtos em sequência.
  compositionStep?: {
    current: number;
    total: number;
    actionLabel: string;
    stepLabel: string;
    onBack?: () => void;
  };
}

type QuantityModifier = ProductModifier & { minSelection?: number };

// Reutiliza o formatador durante toques rápidos em listas extensas.
const priceFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const formatPrice = (value: number) => priceFormatter.format(value);

const rulesForModifier = (modifier: QuantityModifier): ModifierQuantityRules => ({
  optionIds: modifier.options.map((option) => option.id),
  minSelection: modifier.minSelection ?? (modifier.required ? 1 : 0),
  maxSelection: Math.max(1, Number(modifier.maxSelection || 1)),
  selectionMode: modifier.selectionMode,
});

export default function CardapioProductModal({
  product,
  initialItem,
  onClose,
  onAddToCart,
  restaurantId,
  compositionStep,
}: CardapioProductModalProps) {
  const groupRefs = useRef(new Map<string, HTMLElement>());
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, ProductOption[]>>({});
  const [notes, setNotes] = useState("");
  const [currentImgIndex, setCurrentImgIndex] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [expandedExtras, setExpandedExtras] = useState<Record<string, boolean>>({});
  const draftOptionsRef = useRef(selectedOptions);
  const [draftIdentity, setDraftIdentity] = useState<{ productId: Product['id']; restaurantId: typeof restaurantId; initialItem: typeof initialItem } | null>(null);
  useEffect(() => { draftOptionsRef.current = selectedOptions; }, [selectedOptions]);

  const reportedViewRef = useRef(false);
  useEffect(() => {
    if (reportedViewRef.current) return;
    reportedViewRef.current = true;
    trackAnalyticsEvent('public_product_viewed', {
      restaurant_id: restaurantId || '',
      product_id: product.id,
      product_name: product.name,
      category: product.category,
      price: product.price,
      has_modifiers: Boolean(
        (product.modifiers && product.modifiers.length > 0)
        || (product.modifierGroups && product.modifierGroups.length > 0)
      ),
    });
  }, [product.id, restaurantId]);

  const galleryImages = useMemo(
    () => (product.imagesGallery && product.imagesGallery.length > 0
      ? product.imagesGallery.slice(0, 4)
      : [product.image]),
    [product],
  );

  const allModifiers = useMemo<QuantityModifier[]>(() => {
    if (product.modifiers && product.modifiers.length > 0) {
      return product.modifiers.map((modifier) => ({
        ...modifier,
        minSelection: modifier.required ? 1 : 0,
      }));
    }
    if (product.modifierGroups && product.modifierGroups.length > 0) {
      return product.modifierGroups.map((g) => ({
        id: g.id,
        title: g.name,
        required: typeof g.minSelection === "number" ? g.minSelection > 0 : g.type === "obrigatorio",
        maxSelection: g.maxSelection,
        minSelection: g.minSelection,
        selectionMode: g.selectionMode,
        options: g.options
          .filter((option) => option.active !== false)
          .map((o) => ({
            id: o.id,
            name: o.name,
            extraPrice: o.extraPrice,
          })),
      }));
    }
    return [];
  }, [product]);

  useEffect(() => {
    const previous = draftIdentity;
    const newDraft = !previous || previous.productId !== product.id
      || previous.restaurantId !== restaurantId || previous.initialItem !== initialItem;
    const source = newDraft ? initialItem?.selectedOptions || {} : draftOptionsRef.current;
    const initial: Record<string, ProductOption[]> = {};
    allModifiers.forEach((modifier) => {
      const options = new Map(modifier.options.map(option => [option.id, option]));
      initial[modifier.id] = (source[modifier.id] || []).flatMap(option => options.has(option.id) ? [options.get(option.id)!] : []);
    });
    setSelectedOptions(initial);
    const previousCount = Object.values(source).flat().length;
    if (previousCount > Object.values(initial).flat().length) {
      setFeedback("Algumas opções não estão mais disponíveis. Confira a montagem antes de salvar.");
    } else if (newDraft) {
      setFeedback("");
    }
    if (newDraft) {
      setQuantity(initialItem?.quantity || 1);
      setNotes(initialItem?.notes || "");
      setCurrentImgIndex(0);
      setExpandedExtras({});
      // Estado, em vez de ref, mantém a inicialização idempotente no replay
      // de efeitos do StrictMode antes do primeiro commit das escolhas.
      setDraftIdentity({ productId: product.id, restaurantId, initialItem });
    }
  }, [allModifiers, product, initialItem, restaurantId, draftIdentity]);

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

  const handleOptionQuantity = (
    modifier: QuantityModifier,
    option: ProductOption,
    delta: -1 | 1,
  ) => {
    setFeedback("");
    const currentSelections = selectedOptions[modifier.id] || [];
    const currentIds = currentSelections.map((selected) => selected.id);
    const rules = rulesForModifier(modifier);

    if (delta > 0 && !canIncrementSelectionQuantity(rules, currentIds, option.id)) {
      const max = Math.max(1, Number(modifier.maxSelection || 1));
      if (max === 1) {
        // Em grupos exclusivos, o + de outra opção substitui a seleção atual.
      } else {
        setFeedback(modifier.selectionMode
          ? `Respeite o limite de ${max} ${modifier.selectionMode === "porcoes" ? "porções" : "tipos diferentes, sem repetir"} em ${modifier.title}.`
          : `Você pode escolher até ${max} tipos diferentes em ${modifier.title}. A quantidade de cada adicional continua livre.`);
        return;
      }
    }

    // O cálculo deve partir do estado mais recente, não do render anterior.
    // Dois toques no mesmo frame precisam somar duas porções sem ultrapassar o máximo.
    setSelectedOptions((current) => {
      const latestIds = (current[modifier.id] || []).map((selected) => selected.id);
      const nextIds = changeSelectionQuantity(rules, latestIds, option.id, delta);
      if (latestIds.length === nextIds.length && latestIds.every((id, index) => id === nextIds[index])) {
        return current;
      }
      const optionsById = new Map(modifier.options.map((candidate) => [candidate.id, candidate] as const));
      return {
        ...current,
        [modifier.id]: nextIds.flatMap((id) => {
          const selected = optionsById.get(id);
          return selected ? [selected] : [];
        }),
      };
    });
  };

  const handleAdd = () => {
    const unsatisfied = allModifiers.filter((modifier) => {
      const selections = selectedOptions[modifier.id] || [];
      return !selectionWithinRules(
        rulesForModifier(modifier),
        selections.map((selection) => selection.id),
      );
    });

    if (unsatisfied.length > 0) {
      setFeedback(`Confira as escolhas em ${unsatisfied.map((m) => m.title).join(", ")} antes de ${compositionStep ? "continuar" : initialItem ? "salvar" : "adicionar"}.`);
      setExpandedExtras(current => ({ ...current, [unsatisfied[0].id]: true }));
      const group = groupRefs.current.get(unsatisfied[0].id);
      group?.scrollIntoView({ block: "center", behavior: "smooth" });
      group?.focus({ preventScroll: true });
      return;
    }

    onAddToCart(product, compositionStep ? 1 : quantity, selectedOptions, notes.trim());
    // Um passo de promoção só coleta as escolhas: não fecha nem grava na sacola.
    // Quem coordena o pacote controla o próximo passo e o envio atômico ao backend.
    if (!compositionStep) onClose();
  };

  // O portal impede que transform/overflow em ancestrais do catálogo desloquem
  // o contexto de posicionamento do sheet fixo no navegador mobile.
  return createPortal(
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden bg-black/75 backdrop-blur-sm p-0 sm:items-center sm:p-4 animate-fade-in cursor-pointer"
      id="product-details-modal"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-product-name"
        className="koma-art-modal-sheet absolute inset-x-0 bottom-0 top-3 flex min-h-0 w-full flex-col overflow-hidden rounded-t-[32px] border border-white/10 shadow-2xl sm:relative sm:inset-auto sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:rounded-[36px] animate-slide-up"
      >
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-20 h-1.5 w-12 rounded-full bg-white/30 sm:hidden" />

        <div className={`koma-art-modal-hero ${allModifiers.length > 0 ? "h-40 sm:h-52" : "h-52 sm:h-68"}`}>
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
          <div className="koma-art-modal-hero-melt" />

          <div className="absolute right-3.5 top-3.5 z-10 flex gap-2">
            <button
              type="button"
              onClick={handleShare}
              className="koma-art-glass-btn"
              title="Compartilhar produto"
              aria-label="Compartilhar produto"
              id="btn-share-product"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="koma-art-glass-btn"
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
                className="koma-art-glass-btn absolute left-3 top-1/2 -translate-y-1/2 z-10 !w-9 !h-9"
                aria-label="Foto anterior"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentImgIndex((current) => current < galleryImages.length - 1 ? current + 1 : 0)}
                className="koma-art-glass-btn absolute right-3 top-1/2 -translate-y-1/2 z-10 !w-9 !h-9"
                aria-label="Próxima foto"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-1.5 backdrop-blur">
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
          <div className="absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-full border border-emerald-400/40 bg-[#0f241c] px-4 py-2 text-xs font-bold text-emerald-300 shadow-xl backdrop-blur-md">
            Link copiado
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-24 sm:p-6 sm:pb-8 no-scrollbar" data-testid="product-modal-scroll">
          {compositionStep && (
            <div className="mb-3" aria-label={`Etapa ${compositionStep.current} de ${compositionStep.total}`}>
              <p className="text-xs font-bold text-emerald-400">
                Etapa {compositionStep.current} de {compositionStep.total} · {compositionStep.stepLabel}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(compositionStep.current / compositionStep.total) * 100}%` }} />
              </div>
            </div>
          )}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-serif text-2xl font-black tracking-tight text-koma-foreground sm:text-3xl" id="modal-product-name">{product.name}</h2>
              {product.description && (
                <p className="mt-2 text-sm leading-relaxed text-koma-muted">{product.description}</p>
              )}
            </div>
            <strong className="shrink-0 font-serif text-lg font-black text-emerald-400 sm:text-xl">{compositionStep ? "Incluso na promoção" : formatPrice(product.price)}</strong>
          </div>

          {product.marmitaria === true && allModifiers.some(modifier => (modifier.minSelection ?? 0) > 0) && (
            <div className="mt-3.5 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-xs text-koma-muted">
              <p className="font-bold text-koma-foreground">Montagem de {product.name}</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {allModifiers.filter(modifier => (modifier.minSelection ?? 0) > 0).map(modifier => {
                const min = modifier.minSelection ?? 0;
                const max = Math.max(1, Number(modifier.maxSelection || 1));
                return <span key={modifier.id}>{modifier.title}: {min === max ? min : `${min} a ${max}`} {modifier.selectionMode === "porcoes" ? (max === 1 ? "porção" : "porções") : (max === 1 ? "opção" : "opções")}</span>;
              })}
              </div>
            </div>
          )}

          {allModifiers.length > 0 && (
            <div className="mt-4 space-y-4 border-t border-white/10 pt-4 sm:mt-6 sm:space-y-5 sm:pt-5">
              {allModifiers.map((modifier) => {
                const selections = selectedOptions[modifier.id] || [];
                const selectedIds = selections.map((selection) => selection.id);
                const rules = rulesForModifier(modifier);
                const selectedTypes = selectionCount(rules, selectedIds);
                const max = Math.max(1, Number(modifier.maxSelection || 1));
                const freeGarnishes = product.marmitaria === true
                  && modifier.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase() === "guarnicoes"
                  && max >= 20 && (modifier.minSelection ?? 0) === 0;

                const min = rules.minSelection || 0;
                const optionalSalad = product.marmitaria === true && min === 0 && isMarmitariaSaladGroup(modifier.title);
                const unit = modifier.selectionMode === "porcoes" ? (max === 1 ? "porção" : "porções") : (max === 1 ? "opção" : "opções");
                const instruction = freeGarnishes ? "Escolha à vontade"
                  : min === max ? `Escolha ${max} ${unit}`
                  : min > 0 ? `Escolha de ${min} a ${max} ${unit}`
                  : `Escolha até ${max} ${unit}`;
                const simpleSelection = modifier.selectionMode === "tipos" || max === 1;
                const complete = modifier.required && selectionWithinRules(rules, selectedIds);
                const collapsible = min === 0 && modifier.options.length > 0 && modifier.options.every(option => option.extraPrice > 0);
                const expanded = !collapsible || expandedExtras[modifier.id] === true;
                const surcharge = selections.reduce((total, option) => total + option.extraPrice, 0);
                const Heading = collapsible ? "button" : "div";

                return (
                  <section key={modifier.id} tabIndex={-1} aria-label={modifier.title} ref={node => { if (node) groupRefs.current.set(modifier.id, node); else groupRefs.current.delete(modifier.id); }}>
                    <Heading
                      {...(collapsible ? { type: "button" as const, "aria-expanded": expanded, "aria-controls": `modifier-options-${modifier.id}`, onClick: () => setExpandedExtras(current => ({ ...current, [modifier.id]: !expanded })) } : {})}
                      className={`flex w-full items-start justify-between gap-3 text-left ${collapsible ? "rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 transition hover:border-emerald-500/30" : ""}`}
                    >
                      <div>
                        <h3 className="text-sm font-black text-koma-foreground">{modifier.title}</h3>
                        {collapsible && <p className="mt-1 text-xs font-bold text-emerald-400">{selections.length === 0 ? "Nenhum selecionado · Sem acréscimo" : `${selections.length} ${selections.length === 1 ? "adicional" : "adicionais"} · + ${formatPrice(surcharge)} por item`}</p>}
                        <p className="mt-0.5 text-xs text-koma-muted">
                          {instruction}
                          {modifier.selectionMode === "porcoes" && max > 1 && " · Pode repetir"}
                          {!modifier.selectionMode && max > 1 && " · Quantidade livre por adicional"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {collapsible && <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-koma-muted transition-transform ${expanded ? "rotate-180" : ""}`} />}
                        {(max > 1 || modifier.required) && (
                          <span className="text-[10px] font-black text-emerald-400">
                            {freeGarnishes
                              ? (selectedTypes > 0
                                ? `${selectedTypes} ${modifier.selectionMode === "porcoes" ? (selectedTypes === 1 ? "porção" : "porções") : (selectedTypes === 1 ? "tipo" : "tipos")}`
                                : "Livre")
                              : `${selectedTypes}/${max}`}
                          </span>
                        )}
                        <span className={`koma-art-modal-pill-badge ${complete ? "koma-art-modal-pill-badge--complete" : modifier.required ? "koma-art-modal-pill-badge--required" : "koma-art-modal-pill-badge--optional"}`}>
                          {complete ? "Completo" : modifier.required ? "Obrigatório" : "Opcional"}
                        </span>
                      </div>
                    </Heading>

                    <div id={`modifier-options-${modifier.id}`} hidden={!expanded} className="mt-3 space-y-2">
                      {optionalSalad && (
                        <label
                          className={`koma-art-modal-option-card ${selections.length === 0 ? "is-selected" : ""} cursor-pointer`}
                        >
                          <span className="text-sm font-bold text-koma-foreground">Sem salada</span>
                          <span className="flex shrink-0 items-center gap-3">
                            <span className="text-xs font-bold text-koma-muted">{selections.length === 0 ? "Selecionado" : "Selecionar"}</span>
                            <input
                              type="checkbox"
                              aria-label="Sem salada"
                              checked={selections.length === 0}
                              onChange={() => {
                                // Estado derivado das escolhas reais: não adiciona um complemento fictício.
                                setSelectedOptions(current => ({ ...current, [modifier.id]: [] }));
                                setFeedback("");
                              }}
                              className="h-5 w-5 accent-emerald-500 rounded cursor-pointer"
                            />
                          </span>
                        </label>
                      )}
                      {modifier.options.map((option) => {
                        const optionQuantity = modifierOptionQuantity(selectedIds, option.id);
                        const selected = optionQuantity > 0;
                        const canIncrement = canIncrementSelectionQuantity(rules, selectedIds, option.id)
                          || (max === 1 && optionQuantity === 0);

                        const OptionRow = simpleSelection ? "label" : "div";
                        return (
                          <OptionRow
                            key={option.id}
                            className={`koma-art-modal-option-card ${simpleSelection ? "cursor-pointer" : ""} ${
                              selected
                                ? "is-selected"
                                : optionalSalad && selections.length === 0
                                  ? "opacity-60"
                                  : ""
                            }`}
                          >
                            {optionalSalad && !simpleSelection && (
                              <button
                                type="button"
                                aria-label={`Escolher ${option.name}`}
                                disabled={!canIncrement}
                                onClick={() => handleOptionQuantity(modifier, option, 1)}
                                className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                              />
                            )}
                            <span className={`relative min-w-0 ${optionalSalad && !simpleSelection ? "pointer-events-none" : ""}`}>
                              <span className={`block text-sm font-bold ${optionalSalad && !selected && selections.length === 0 ? "text-koma-muted" : "text-koma-foreground"}`}>{option.name}</span>
                              {option.extraPrice > 0 && (
                                <span className="mt-0.5 block text-xs font-bold text-emerald-400">+ {formatPrice(option.extraPrice)} cada</span>
                              )}
                            </span>
                            {simpleSelection ? (
                              <span className="relative flex min-h-11 min-w-11 shrink-0 items-center justify-center">
                                <input
                                  type="checkbox"
                                  aria-label={`Selecionar ${option.name}`}
                                  checked={selected}
                                  disabled={!selected && !canIncrement}
                                  onChange={() => handleOptionQuantity(modifier, option, selected ? -1 : 1)}
                                  className={
                                    max === 1
                                      ? "absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                                      : "h-5 w-5 accent-emerald-500 rounded cursor-pointer"
                                  }
                                />
                                {max === 1 && (
                                  <div
                                    className={`koma-art-single-choice-indicator ${selected ? "is-selected" : ""}`}
                                    aria-hidden="true"
                                  />
                                )}
                              </span>
                            ) : (
                            <span className="relative flex shrink-0 items-center koma-art-stepper-pill">
                              <button
                                type="button"
                                onClick={() => handleOptionQuantity(modifier, option, -1)}
                                disabled={optionQuantity <= 0}
                                className="koma-art-stepper-btn hover:text-rose-400"
                                aria-label={`Remover uma unidade de ${option.name}`}
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <span className="koma-art-stepper-val" aria-label={`${optionQuantity} unidade(s) de ${option.name}`}>
                                {optionQuantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleOptionQuantity(modifier, option, 1)}
                                disabled={!canIncrement}
                                className="koma-art-stepper-btn hover:text-emerald-400"
                                aria-label={`Adicionar uma unidade de ${option.name}`}
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </span>
                            )}
                          </OptionRow>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          <label className="mt-6 block border-t border-white/10 pt-5">
            <span className="text-sm font-black text-koma-foreground">Alguma observação?</span>
            <span className="mt-0.5 block text-xs text-koma-muted">Opcional · até 200 caracteres</span>
            <textarea
              id="notes-textarea"
              placeholder="Ex.: sem cebola, massa bem assada..."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-2.5 min-h-[84px] w-full resize-none rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 text-sm leading-relaxed text-koma-foreground outline-none transition placeholder:text-stone-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30"
              maxLength={200}
            />
          </label>

          {feedback && (
            <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/[0.08] p-3.5 text-xs font-semibold leading-relaxed text-amber-400" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{feedback}</span>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-white/10 bg-black/40 backdrop-blur-md px-4 pt-3.5 pb-[calc(0.85rem+env(safe-area-inset-bottom,0px))] sm:p-5 sm:px-6" data-testid="product-modal-footer">
          {compositionStep ? (
            <div className="flex items-center gap-2">
              {compositionStep.onBack && (
                <button type="button" onClick={compositionStep.onBack} className="min-h-12 rounded-full border border-white/15 px-5 text-sm font-bold text-koma-foreground transition hover:bg-white/5">
                  Voltar
                </button>
              )}
              <button
                type="button"
                onClick={handleAdd}
                className="min-h-12 min-w-0 flex-1 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-6 text-sm font-black text-white hover:from-emerald-400 hover:to-teal-400 shadow-lg shadow-emerald-950/40 transition-all cursor-pointer"
                aria-label={compositionStep.actionLabel}
              >
                {compositionStep.actionLabel}
              </button>
            </div>
          ) : (
          <>
          <p className="mb-2 text-xs text-koma-muted">Quantidade de itens{quantity > 1 ? " · Mesma montagem para todas as unidades" : ""}</p>
          <div className="flex items-center gap-3">
          <div className="flex shrink-0 items-center koma-art-stepper-pill">
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.max(1, current - 1))}
              className="koma-art-stepper-btn"
              disabled={quantity <= 1}
              id="btn-qty-minus"
              aria-label="Diminuir quantidade"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="koma-art-stepper-val">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((current) => current + 1)}
              className="koma-art-stepper-btn"
              id="btn-qty-plus"
              aria-label="Aumentar quantidade"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleAdd}
            className="koma-action-primary flex min-h-12 min-w-0 touch-manipulation flex-1 items-center justify-between gap-3 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-5 text-white shadow-lg shadow-emerald-950/40 transition hover:from-emerald-400 hover:to-teal-400 active:scale-[0.99] cursor-pointer"
            id="btn-add-to-cart-action"
            aria-label={`${initialItem ? "Salvar" : "Adicionar"} ${quantity} × ${product.name} · ${formatPrice(totalPrice)}`}
          >
            <span className="flex items-center gap-2 text-xs font-black">
              <ShoppingBag className="h-4 w-4 shrink-0" /> {initialItem ? "Salvar" : "Adicionar"} {quantity}×
            </span>
            <strong className="text-sm font-black">{formatPrice(totalPrice)}</strong>
          </button>
          </div>
          </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
