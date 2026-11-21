/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Search,
  Share2,
  ShoppingBag,
  Star,
  Tag,
  X,
} from "lucide-react";
import { getEffectiveProductPrice, getProductBadgeLabel } from "../../domain/productMerchandising";
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
  ProductOption,
  getProductImageUrl,
  LOCAL_PRODUCT_PLACEHOLDER,
} from "../CardapioTypes";
import { isGroupedProduct, type GroupedDisplayProduct } from "../catalogGrouping";
import { trackAnalyticsEvent } from "../../analytics";
import { isMarmitariaSaladGroup } from "../../domain/marmitariaSalad";
import { containModalFocus } from "../../utils/modalFocus";

import {
  shouldExpandModifierByDefault,
  type QuantityModifier,
} from "../modifierExpansion";

interface CardapioProductModalProps {
  product: Product | GroupedDisplayProduct;
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
    unitMultiplier?: number;
    headerSlot?: React.ReactNode;
  };
}

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!dialogRef.current) return;
    const dialog = dialogRef.current;
    return containModalFocus(dialog, () => closeRef.current(), dialog.querySelector<HTMLElement>('#btn-close-modal') || dialog);
  }, []);
  const isGrouped = isGroupedProduct(product);
  const requiresExplicitVariant = isGrouped && product.requiresExplicitVariantSelection === true;
  // Native families carry their own selection axis. Never infer this from a
  // tenant-specific product name or from the generic display kind.
  const isSizeVariant = isGrouped && product.familia_eixo === 'tamanho';
  const defaultVariantId = useMemo(() => {
    if (!isGrouped || requiresExplicitVariant) return "";
    const avail = product.variants.find((v) => v.isAvailable);
    return avail ? avail.id : (product.variants[0]?.id || "");
  }, [isGrouped, product, requiresExplicitVariant]);

  const [selectedVariantId, setSelectedVariantId] = useState<string>(defaultVariantId);

  useEffect(() => {
    if (isGrouped) {
      const avail = product.variants.find((v) => v.isAvailable);
      setSelectedVariantId(requiresExplicitVariant ? "" : (avail ? avail.id : (product.variants[0]?.id || "")));
    }
  }, [isGrouped, product, requiresExplicitVariant]);

  const activeVariant = useMemo(() => {
    if (!isGrouped || (requiresExplicitVariant && !selectedVariantId)) return null;
    return product.variants.find((v) => v.id === selectedVariantId)
      || (requiresExplicitVariant ? null : product.variants[0] || null);
  }, [isGrouped, product, selectedVariantId, requiresExplicitVariant]);
  const needsVariantSelection = requiresExplicitVariant && !activeVariant;

  // A family may have one commercial photo; switching the sellable SKU
  // must not blank the customer's image when that SKU has no separate photo.
  const effectiveProduct: Product = activeVariant ? {
    ...activeVariant.product,
    image: activeVariant.product.image || product.image,
    imagesGallery: (activeVariant.product.imagesGallery || []).some(Boolean)
      ? activeVariant.product.imagesGallery
      : [product.image].filter(Boolean),
  } : (product as Product);

  const groupRefs = useRef(new Map<string, HTMLElement>());
  const variantRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const [highlightedGroupId, setHighlightedGroupId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, ProductOption[]>>({});
  const [notes, setNotes] = useState("");
  const [currentImgIndex, setCurrentImgIndex] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [expandedExtras, setExpandedExtras] = useState<Record<string, boolean>>({});
  const [groupSearch, setGroupSearch] = useState<Record<string, string>>({});
  const draftOptionsRef = useRef(selectedOptions);
  const [draftIdentity, setDraftIdentity] = useState<{ productId: Product['id']; restaurantId: typeof restaurantId; initialItem: typeof initialItem } | null>(null);
  useEffect(() => { draftOptionsRef.current = selectedOptions; }, [selectedOptions]);
  useEffect(() => () => {
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
  }, []);

  const triggerHighlight = (groupId: string) => {
    setHighlightedGroupId(groupId);
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedGroupId((current) => (current === groupId ? null : current));
      highlightTimerRef.current = null;
    }, 1800);
  };

  const scrollToModifierGroup = (groupId: string, highlight = false) => {
    setExpandedExtras((current) => (current[groupId] ? current : { ...current, [groupId]: true }));
    if (highlight) triggerHighlight(groupId);
    window.requestAnimationFrame(() => {
      const group = groupRefs.current.get(groupId);
      group?.scrollIntoView({ block: "start", behavior: "smooth" });
      group?.focus({ preventScroll: true });
    });
  };

  const reportedViewRef = useRef(false);
  useEffect(() => {
    // Famílias visuais não são produtos reais: aguardar a escolha do SKU.
    if (reportedViewRef.current || needsVariantSelection) return;
    reportedViewRef.current = true;
    trackAnalyticsEvent('public_product_viewed', {
      restaurant_id: restaurantId || '',
      product_id: effectiveProduct.id,
      product_name: effectiveProduct.name,
      category: effectiveProduct.category,
      price: effectiveProduct.price,
      has_modifiers: Boolean(
        (effectiveProduct.modifiers && effectiveProduct.modifiers.length > 0)
        || (effectiveProduct.modifierGroups && effectiveProduct.modifierGroups.length > 0)
      ),
    });
  }, [effectiveProduct.id, restaurantId, needsVariantSelection]);

  const galleryImages = useMemo(() => {
    const rawList =
      effectiveProduct.imagesGallery && effectiveProduct.imagesGallery.length > 0
        ? effectiveProduct.imagesGallery
        : [effectiveProduct.image];
    const deduped = Array.from(
      new Set(rawList.map((item) => (item || "").trim()).filter(Boolean)),
    ).slice(0, 4);
    return deduped.length > 0 ? deduped : [effectiveProduct.image];
  }, [effectiveProduct]);

  const allModifiers = useMemo<QuantityModifier[]>(() => {
    if (effectiveProduct.modifiers && effectiveProduct.modifiers.length > 0) {
      return effectiveProduct.modifiers.map((modifier) => ({
        ...modifier,
        minSelection: modifier.required ? 1 : 0,
      }));
    }
    if (effectiveProduct.modifierGroups && effectiveProduct.modifierGroups.length > 0) {
      return effectiveProduct.modifierGroups.map((g) => ({
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
  }, [effectiveProduct]);

  useEffect(() => {
    const previous = draftIdentity;
    const newDraft = !previous || previous.productId !== effectiveProduct.id
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
      const defaultExpanded: Record<string, boolean> = {};
      allModifiers.forEach((m) => {
        if (shouldExpandModifierByDefault(m, allModifiers.length)) {
          defaultExpanded[m.id] = true;
        }
      });
      setExpandedExtras(defaultExpanded);
      setGroupSearch({});
      // Estado, em vez de ref, mantém a inicialização idempotente no replay
      // de efeitos do StrictMode antes do primeiro commit das escolhas.
      setDraftIdentity({ productId: effectiveProduct.id, restaurantId, initialItem });
    }
  }, [allModifiers, effectiveProduct, initialItem, restaurantId, draftIdentity]);

  const effectivePriceInfo = useMemo(
    () => getEffectiveProductPrice(effectiveProduct.price, effectiveProduct.promotionalPrice),
    [effectiveProduct.price, effectiveProduct.promotionalPrice],
  );

  const unitPrice = useMemo(() => {
    let value = effectivePriceInfo.effectivePrice;
    Object.values(selectedOptions).forEach((options) => {
      options.forEach((option) => {
        value += option.extraPrice;
      });
    });
    return value;
  }, [effectivePriceInfo.effectivePrice, selectedOptions]);

  const totalPrice = unitPrice * quantity;

  const extrasPerUnit = useMemo(
    () =>
      Object.values(selectedOptions)
        .flat()
        .reduce((sum, option) => sum + (option.extraPrice || 0), 0),
    [selectedOptions],
  );

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
    if (highlightedGroupId === modifier.id) {
      setHighlightedGroupId(null);
    }
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

  const unsatisfiedModifiers = useMemo(() => {
    return allModifiers.filter((modifier) => {
      const selections = selectedOptions[modifier.id] || [];
      return !selectionWithinRules(
        rulesForModifier(modifier),
        selections.map((selection) => selection.id),
      );
    });
  }, [allModifiers, selectedOptions]);

  const hasUnsatisfied = needsVariantSelection || unsatisfiedModifiers.length > 0;

  const handleAdd = () => {
    if (needsVariantSelection) {
      setFeedback(isSizeVariant
        ? 'Escolha o tamanho antes de adicionar.'
        : 'Escolha o sabor antes de adicionar.');
      triggerHighlight("__variant__");
      variantRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (unsatisfiedModifiers.length > 0) {
      setFeedback(`Confira as escolhas em ${unsatisfiedModifiers.map((m) => m.title).join(", ")} antes de ${compositionStep ? "continuar" : initialItem ? "salvar" : "adicionar"}.`);
      scrollToModifierGroup(unsatisfiedModifiers[0].id, true);
      return;
    }

    onAddToCart(effectiveProduct, compositionStep ? 1 : quantity, selectedOptions, notes.trim());
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
      className="fixed inset-0 z-[70] flex items-end justify-center overflow-hidden p-0 sm:items-center sm:p-4 animate-fade-in cursor-pointer"
      style={{ backgroundColor: "var(--km-overlay)" }}
      id="product-details-modal"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-product-name"
        className="koma-art-modal-sheet absolute inset-x-0 bottom-0 top-3 flex min-h-0 w-full flex-col overflow-hidden rounded-t-[32px] border shadow-2xl sm:relative sm:inset-auto sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:rounded-[36px] animate-slide-up"
        style={{
          backgroundColor: "var(--km-dialog)",
          color: "var(--km-ink)",
          borderColor: "var(--km-line)",
        }}
      >
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-20 h-1.5 w-12 rounded-full bg-[var(--km-line-strong)] sm:hidden" />

        <div className={`koma-art-modal-hero relative w-full shrink-0 overflow-hidden bg-[var(--km-panel)] ${allModifiers.length > 0 ? "h-36 sm:h-44" : "h-52 sm:h-64"}`}>
          <img
            src={getProductImageUrl(galleryImages[currentImgIndex] || effectiveProduct.image)}
            alt={effectiveProduct.name}
            className="h-full w-full object-cover transition duration-300"
            decoding="async"
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
            }}
          />
          <div
            className="koma-art-modal-hero-melt pointer-events-none absolute inset-0"
            style={{ background: "linear-gradient(to bottom, transparent 48%, var(--km-dialog) 100%)" }}
          />

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
              <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5 rounded-full border border-[var(--km-line)] bg-[var(--km-dialog)] px-2.5 py-1.5 shadow-md">
                {galleryImages.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setCurrentImgIndex(index)}
                    className={`h-1.5 rounded-full transition-all ${index === currentImgIndex ? "w-4 bg-[var(--km-accent)]" : "w-1.5 bg-[var(--km-line-strong)]"}`}
                    aria-label={`Ver foto ${index + 1}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {showToast && (
          <div className="absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-full border border-[var(--km-accent-border)] bg-[var(--km-dialog)] px-4 py-2 text-xs font-bold text-[var(--km-accent-text)] shadow-xl">
            Link copiado
          </div>
        )}

        {allModifiers.length > 0 && (
          <nav
            aria-label="Etapas da montagem"
            className="shrink-0 z-30 flex items-center gap-2 overflow-x-auto border-b border-[var(--km-line-subtle)] bg-[var(--km-dialog)] px-4 py-2.5 sm:px-6 no-scrollbar"
            data-testid="modifier-steps-bar"
          >
            {allModifiers.map((modifier) => {
              const selections = selectedOptions[modifier.id] || [];
              const selectedIds = selections.map((selection) => selection.id);
              const rules = rulesForModifier(modifier);
              const selectedTotal = selectionCount(rules, selectedIds);
              const satisfied = selectionWithinRules(rules, selectedIds);
              const missingCount = Math.max(0, (rules.minSelection || 0) - selectedTotal);
              const isComplete = modifier.required ? satisfied : selections.length > 0;
              const isPendingRequired = modifier.required && !satisfied;

              const statusStyle: React.CSSProperties | undefined = isComplete
                ? {
                    backgroundColor: "var(--km-accent-soft)",
                    borderColor: "var(--km-accent-border)",
                    color: "var(--km-accent-text)",
                  }
                : isPendingRequired
                  ? {
                      backgroundColor: "var(--km-alert-soft)",
                      borderColor: "var(--km-alert-border)",
                      color: "var(--km-alert-text)",
                    }
                  : undefined;

              const stepAriaLabel = isComplete
                ? `${modifier.title}: concluído`
                : isPendingRequired
                  ? `${modifier.title}: ${missingCount > 0 ? `falta ${missingCount}` : "obrigatório"}`
                  : `${modifier.title}: opcional`;

              return (
                <button
                  key={modifier.id}
                  type="button"
                  onClick={() => scrollToModifierGroup(modifier.id, true)}
                  aria-label={stepAriaLabel}
                  data-step-state={isComplete ? "complete" : isPendingRequired ? "pending" : "optional"}
                  style={statusStyle}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-all cursor-pointer active:scale-[0.98] ${
                    !isComplete && !isPendingRequired
                      ? "border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-muted)] hover:border-[var(--km-line-strong)] hover:text-[var(--km-ink)]"
                      : "hover:opacity-90"
                  }`}
                >
                  {isComplete && (
                    <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} aria-hidden="true" />
                  )}
                  <span className="whitespace-nowrap">{modifier.title}</span>
                  {isPendingRequired && (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-extrabold leading-none tabular-nums"
                      style={{
                        backgroundColor: "var(--km-alert-dot)",
                        color: "var(--km-on-alert)",
                      }}
                    >
                      {missingCount > 0 ? `Falta ${missingCount}` : "Ajustar"}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-10 sm:px-6 sm:pt-5 sm:pb-10 no-scrollbar" data-testid="product-modal-scroll">
          {compositionStep && (
            <div className="mb-3" aria-label={`Etapa ${compositionStep.current} de ${compositionStep.total}`}>
              <p className="text-xs font-bold text-[var(--km-accent-text)]">
                Etapa {compositionStep.current} de {compositionStep.total} · {compositionStep.stepLabel}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--km-raised)]" aria-hidden="true">
                <div className="h-full rounded-full bg-[var(--km-accent)]" style={{ width: `${(compositionStep.current / compositionStep.total) * 100}%` }} />
              </div>
              {compositionStep.headerSlot && (
                <div className="mt-3">{compositionStep.headerSlot}</div>
              )}
            </div>
          )}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {(effectiveProduct.destaque || product.destaque || getProductBadgeLabel(effectiveProduct.selo || product.selo)) && (
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  {(effectiveProduct.destaque || product.destaque) && (
                    <span
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        background: "var(--koma-info-bg)",
                        borderColor: "var(--koma-info-border)",
                        color: "var(--koma-info-text)",
                      }}
                    >
                      <Star size={11} aria-hidden="true" /> Destaque
                    </span>
                  )}
                  {getProductBadgeLabel(effectiveProduct.selo || product.selo) && (
                    <span
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--km-accent-text)]"
                    >
                      <Tag size={11} aria-hidden="true" /> {getProductBadgeLabel(effectiveProduct.selo || product.selo)}
                    </span>
                  )}
                </div>
              )}
              <h2 className="font-serif text-2xl font-black tracking-tight text-[var(--km-ink)] sm:text-3xl" id="modal-product-name">{product.name}</h2>
              {(activeVariant?.description || effectiveProduct.description || product.description) && (
                <p className="mt-2 text-sm leading-relaxed text-[var(--km-muted)]">{activeVariant?.description || effectiveProduct.description || product.description}</p>
              )}
            </div>
            <div className="shrink-0 text-right tabular-nums">
              {!compositionStep && !needsVariantSelection && effectivePriceInfo.hasDiscount && effectivePriceInfo.originalPrice != null && (
                <span className="block text-xs text-[var(--km-muted)] line-through">
                  De {formatPrice(effectivePriceInfo.originalPrice)}
                </span>
              )}
              <strong className="block font-serif text-lg font-black text-[var(--km-accent-text)] sm:text-xl">
                {compositionStep
                  ? "Incluso na promoção"
                  : needsVariantSelection
                    ? `A partir de ${formatPrice(unitPrice)}`
                    : effectivePriceInfo.hasDiscount
                      ? `Por ${formatPrice(unitPrice)}`
                      : formatPrice(unitPrice)}
              </strong>
            </div>
          </div>

          {isGrouped && product.variants && product.variants.length > 0 && (
            <div
              ref={variantRef}
              className={`mt-4 rounded-2xl border p-3.5 transition-all ${
                highlightedGroupId === "__variant__"
                  ? "border-rose-400 bg-rose-50/50 ring-2 ring-rose-500/40 dark:border-rose-500/50 dark:bg-rose-500/10"
                  : "border-[var(--km-line)] bg-[var(--km-panel)]"
              }`}
              id="modal-variants-selector"
            >
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-[var(--km-ink)]">
                  {product.groupDescription || "Escolha uma opção"}
                </h3>
                {needsVariantSelection ? (
                  <span
                    className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide"
                    style={{
                      backgroundColor: "var(--km-alert-soft)",
                      borderColor: "var(--km-alert-border)",
                      color: "var(--km-alert-text)",
                    }}
                  >
                    Obrigatório
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--km-accent-text)]">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Pronto
                  </span>
                )}
              </div>
              <div className={requiresExplicitVariant ? "grid grid-cols-1 gap-2" : "grid grid-cols-1 sm:grid-cols-2 gap-2"}>
                {product.variants.map((v) => {
                  const isSelected = v.id === selectedVariantId;
                  const isAvail = v.isAvailable;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      disabled={!isAvail}
                      onClick={() => {
                        if (isSelected) return;
                        setSelectedVariantId(v.id);
                        setSelectedOptions({});
                        setFeedback("");
                        if (highlightedGroupId === "__variant__") setHighlightedGroupId(null);
                      }}
                      className={`flex min-h-[52px] flex-row items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-all cursor-pointer ${
                        isSelected
                          ? "bg-[var(--km-accent-soft)] border-[var(--km-accent-border)] text-[var(--km-ink)] shadow-sm"
                          : isAvail
                            ? "bg-[var(--km-card)] hover:border-[var(--km-line-strong)] border-[var(--km-line)] text-[var(--km-ink)]"
                            : "bg-[var(--km-panel)] border-[var(--km-line-subtle)] text-[var(--km-subtle)] opacity-60 line-through cursor-not-allowed"
                      }`}
                      id={`variant-btn-${v.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <span className={requiresExplicitVariant ? "block text-sm font-bold leading-snug whitespace-normal" : "block text-xs font-bold truncate"}>{v.label}</span>
                        {v.description && (
                          <p className={requiresExplicitVariant ? "mt-0.5 text-xs text-[var(--km-muted)] leading-relaxed" : "mt-0.5 text-[10px] text-[var(--km-muted)] line-clamp-1"}>{v.description}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2.5">
                        <strong className={`text-xs font-black tabular-nums ${isSelected ? "text-[var(--km-accent-text)]" : "text-[var(--km-muted)]"}`}>
                          {formatPrice(v.price)}
                        </strong>
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                            isSelected
                              ? "border-[var(--km-accent)] bg-[var(--km-accent)] text-[var(--km-on-accent)]"
                              : "border-[var(--km-line-strong)] bg-transparent"
                          }`}
                          aria-hidden="true"
                        >
                          {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {allModifiers.length > 0 && (
            <div className="mt-4 space-y-5 border-t border-[var(--km-line-subtle)] pt-4 sm:mt-5 sm:space-y-6 sm:pt-5">
              {allModifiers.map((modifier, modifierIndex) => {
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
                const instruction = freeGarnishes
                  ? "À vontade"
                  : min === max
                    ? `Escolha ${max}`
                    : min > 0
                      ? `Escolha ${min} a ${max}`
                      : `Escolha até ${max}`;
                const simpleSelection = modifier.selectionMode === "tipos" || max === 1;
                const complete = modifier.required && selectionWithinRules(rules, selectedIds);
                const collapsible = min === 0 && modifier.options.length > 0;
                const expanded = !collapsible || expandedExtras[modifier.id] === true;
                const surcharge = selections.reduce((total, option) => total + option.extraPrice, 0);
                const Heading = collapsible ? "button" : "div";
                const showInlineSearch = expanded && modifier.options.length > 8;
                const rawQuery = groupSearch[modifier.id] || "";
                const normalizedQuery = rawQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
                const visibleOptions = normalizedQuery
                  ? modifier.options.filter((option) =>
                      option.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(normalizedQuery),
                    )
                  : modifier.options;
                const isHighlighted = highlightedGroupId === modifier.id;

                return (
                  <section
                    key={modifier.id}
                    tabIndex={-1}
                    aria-label={modifier.title}
                    ref={node => { if (node) groupRefs.current.set(modifier.id, node); else groupRefs.current.delete(modifier.id); }}
                    className={`scroll-mt-4 transition-all ${
                      isHighlighted
                        ? "-mx-2 rounded-2xl bg-rose-50/50 p-2 ring-2 ring-rose-500/45 dark:bg-rose-500/10"
                        : ""
                    }`}
                  >
                    <Heading
                      {...(collapsible
                        ? {
                            type: "button" as const,
                            "aria-expanded": expanded,
                            "aria-controls": `modifier-options-${modifier.id}`,
                            onClick: () => setExpandedExtras((current) => ({ ...current, [modifier.id]: !expanded })),
                          }
                        : {})}
                      className={`flex w-full items-center justify-between gap-3 text-left ${
                        collapsible && !expanded
                          ? "rounded-2xl border border-[var(--km-line)] bg-[var(--km-panel)] p-3.5 transition hover:border-[var(--km-accent-border)] cursor-pointer"
                          : "sticky -top-4 sm:-top-5 z-10 -mx-4 px-4 sm:-mx-6 sm:px-6 py-2.5 bg-[var(--km-dialog)] border-b border-[var(--km-line-subtle)]" + (collapsible ? " cursor-pointer" : "")
                      }`}
                    >
                      <div className="min-w-0">
                        <h3 className="text-sm font-black text-[var(--km-ink)]">
                          {modifierIndex + 1}. {modifier.title}
                        </h3>
                        {collapsible && !expanded && (
                          <p className="mt-0.5 text-xs font-bold text-[var(--km-accent-text)]">
                            {selections.length === 0
                              ? "Nenhum selecionado"
                              : `${selections.length} selecionado${selections.length === 1 ? "" : "s"}${surcharge > 0 ? ` · + ${formatPrice(surcharge)}` : ""}`}
                          </p>
                        )}
                        <p className="mt-0.5 text-xs font-medium text-[var(--km-muted)]">
                          {instruction}
                          {modifier.selectionMode === "porcoes" && max > 1 && " · Pode repetir"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {collapsible && <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-[var(--km-muted)] transition-transform ${expanded ? "rotate-180" : ""}`} />}
                        {(max > 1 || modifier.required) && !complete && (
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-extrabold tabular-nums ${
                              selectedTypes > 0
                                ? "border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)]"
                                : "border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-ink-2)]"
                            }`}
                          >
                            {freeGarnishes
                              ? (selectedTypes > 0 ? `${selectedTypes}` : "Livre")
                              : `${selectedTypes}/${max}`}
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
                            complete
                              ? "border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)]"
                              : modifier.required
                                ? ""
                                : "border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-muted)]"
                          }`}
                          style={
                            !complete && modifier.required
                              ? {
                                  backgroundColor: "var(--km-alert-soft)",
                                  borderColor: "var(--km-alert-border)",
                                  color: "var(--km-alert-text)",
                                }
                              : undefined
                          }
                        >
                          {complete && <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />}
                          {complete ? "Pronto" : modifier.required ? "Obrigatório" : "Opcional"}
                        </span>
                      </div>
                    </Heading>

                    <div id={`modifier-options-${modifier.id}`} hidden={!expanded} className="mt-3 space-y-2">
                      {showInlineSearch && (
                        <div className="relative mb-2.5">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--km-muted)]" aria-hidden="true" />
                          <input
                            type="search"
                            value={rawQuery}
                            onChange={(event) =>
                              setGroupSearch((current) => ({ ...current, [modifier.id]: event.target.value }))
                            }
                            placeholder={`Buscar em ${modifier.title.toLowerCase()}...`}
                            aria-label={`Buscar em ${modifier.title}`}
                            className="min-h-10 w-full rounded-xl border border-[var(--km-line)] bg-[var(--km-input)] py-2 pl-9 pr-9 text-xs font-medium text-[var(--km-ink)] placeholder:text-[var(--km-subtle)] outline-none transition focus:border-[var(--km-focus)]"
                          />
                          {rawQuery && (
                            <button
                              type="button"
                              onClick={() => setGroupSearch((current) => ({ ...current, [modifier.id]: "" }))}
                              aria-label={`Limpar busca em ${modifier.title}`}
                              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--km-muted)] hover:text-[var(--km-ink)]"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                      {optionalSalad && (
                        <label
                          className={`relative flex min-h-[52px] w-full flex-row items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 transition-all cursor-pointer ${
                            selections.length === 0
                              ? "border-[var(--km-accent-border)] bg-[var(--km-accent-soft)]"
                              : "border-[var(--km-line)] bg-[var(--km-card)] hover:border-[var(--km-line-strong)]"
                          }`}
                        >
                          <span className="min-w-0 flex-1 text-left text-sm font-bold text-[var(--km-ink)]">Sem salada</span>
                          <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                            <input
                              type="checkbox"
                              aria-label="Sem salada"
                              checked={selections.length === 0}
                              onChange={() => {
                                // Estado derivado das escolhas reais: não adiciona um complemento fictício.
                                setSelectedOptions(current => ({ ...current, [modifier.id]: [] }));
                                setFeedback("");
                              }}
                              className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
                            />
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--km-focus)] peer-focus-visible:ring-offset-1 ${
                                selections.length === 0
                                  ? "border-[var(--km-accent)] bg-[var(--km-accent)] text-[var(--km-on-accent)]"
                                  : "border-[var(--km-line-strong)] bg-transparent"
                              }`}
                              aria-hidden="true"
                            >
                              {selections.length === 0 && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                            </span>
                          </span>
                        </label>
                      )}
                      {visibleOptions.length === 0 && normalizedQuery && (
                        <p className="rounded-xl border border-[var(--km-line-subtle)] bg-[var(--km-panel)] px-3.5 py-3 text-xs text-[var(--km-muted)]">
                          Nenhuma opção encontrada para "{rawQuery}".
                        </p>
                      )}
                      {visibleOptions.map((option) => {
                        const optionQuantity = modifierOptionQuantity(selectedIds, option.id);
                        const selected = optionQuantity > 0;
                        const canIncrement = canIncrementSelectionQuantity(rules, selectedIds, option.id)
                          || (max === 1 && optionQuantity === 0);
                        const isRowDisabled = simpleSelection && !selected && !canIncrement;

                        const OptionRow = simpleSelection ? "label" : "div";
                        return (
                          <OptionRow
                            key={option.id}
                            className={`relative flex min-h-[52px] w-full flex-row items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 transition-all ${
                              simpleSelection
                                ? (isRowDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")
                                : ""
                            } ${
                              selected
                                ? "border-[var(--km-accent-border)] bg-[var(--km-accent-soft)]"
                                : optionalSalad && selections.length === 0
                                  ? "border-[var(--km-line)] bg-[var(--km-card)] opacity-65 hover:opacity-100"
                                  : "border-[var(--km-line)] bg-[var(--km-card)] hover:border-[var(--km-line-strong)]"
                            }`}
                          >
                            {optionalSalad && !simpleSelection && (
                              <button
                                type="button"
                                aria-label={`Escolher ${option.name}`}
                                disabled={!canIncrement}
                                onClick={() => handleOptionQuantity(modifier, option, 1)}
                                className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--km-focus)]"
                              />
                            )}
                            <span className={`relative min-w-0 flex-1 text-left ${optionalSalad && !simpleSelection ? "pointer-events-none" : ""}`}>
                              <span className={`block text-sm font-bold leading-snug ${optionalSalad && !selected && selections.length === 0 ? "text-[var(--km-muted)]" : "text-[var(--km-ink)]"}`}>
                                {option.name}
                              </span>
                              {option.extraPrice > 0 && (
                                <span className="mt-0.5 block text-xs font-bold text-[var(--km-accent-text)] tabular-nums">
                                  + {formatPrice(option.extraPrice)}{modifier.selectionMode === "porcoes" && max > 1 ? " cada" : ""}
                                </span>
                              )}
                            </span>
                            {simpleSelection ? (
                              <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                                <input
                                  type="checkbox"
                                  aria-label={`Selecionar ${option.name}`}
                                  checked={selected}
                                  disabled={!selected && !canIncrement}
                                  onChange={() => handleOptionQuantity(modifier, option, selected ? -1 : 1)}
                                  className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                                />
                                <span
                                  className={`flex h-6 w-6 items-center justify-center border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--km-focus)] peer-focus-visible:ring-offset-1 ${
                                    max === 1 ? "rounded-full" : "rounded-lg"
                                  } ${
                                    selected
                                      ? "border-[var(--km-accent)] bg-[var(--km-accent)] text-[var(--km-on-accent)]"
                                      : "border-[var(--km-line-strong)] bg-transparent"
                                  }`}
                                  aria-hidden="true"
                                >
                                  {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                                </span>
                              </span>
                            ) : (
                            <span className="relative z-10 flex shrink-0 items-center koma-art-stepper-pill">
                              <button
                                type="button"
                                onClick={() => handleOptionQuantity(modifier, option, -1)}
                                disabled={optionQuantity <= 0}
                                className="koma-art-stepper-btn hover:text-rose-400 disabled:opacity-35"
                                aria-label={`Remover uma unidade de ${option.name}`}
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <span className="koma-art-stepper-val min-w-[24px] text-center text-xs font-black text-[var(--km-ink)] tabular-nums" aria-label={`${optionQuantity} unidade(s) de ${option.name}`}>
                                {optionQuantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleOptionQuantity(modifier, option, 1)}
                                disabled={!canIncrement}
                                className="koma-art-stepper-btn hover:text-[var(--km-accent-text)] disabled:opacity-35"
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

          <label className="mt-6 block border-t border-[var(--km-line-subtle)] pt-5">
            <span className="text-sm font-black text-[var(--km-ink)]">Alguma observação?</span>
            <span className="mt-0.5 block text-xs text-[var(--km-muted)]">Opcional · até 200 caracteres</span>
            <textarea
              id="notes-textarea"
              placeholder="Ex.: sem cebola, massa bem assada..."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-2.5 min-h-[84px] w-full resize-none rounded-2xl border border-[var(--km-line)] bg-[var(--km-input)] p-3.5 text-sm leading-relaxed text-[var(--km-ink)] outline-none transition placeholder:text-[var(--km-subtle)] focus:border-[var(--km-focus)]"
              maxLength={200}
            />
          </label>

          {feedback && (
            <div
              className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-semibold leading-relaxed text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/12 dark:text-rose-300"
              role="alert"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{feedback}</span>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[var(--km-line-subtle)] bg-[var(--km-panel)] px-4 pt-3.5 pb-[calc(0.85rem+env(safe-area-inset-bottom,0px))] sm:p-5 sm:px-6" data-testid="product-modal-footer">
          {compositionStep ? (
            <div>
              {compositionStep.unitMultiplier && compositionStep.unitMultiplier > 1 && extrasPerUnit > 0 && (
                <p className="mb-2 text-xs font-medium text-[var(--km-ink-2)] tabular-nums">
                  Adicionais desta montagem: + {formatPrice(extrasPerUnit)} × {compositionStep.unitMultiplier} ={' '}
                  <strong className="text-[var(--km-ink)]">+ {formatPrice(extrasPerUnit * compositionStep.unitMultiplier)}</strong>
                </p>
              )}
              <div className="flex items-center gap-2">
                {compositionStep.onBack && (
                  <button type="button" onClick={compositionStep.onBack} className="min-h-12 rounded-full border border-[var(--km-line)] bg-[var(--km-raised)] px-5 text-sm font-bold text-[var(--km-ink)] transition hover:opacity-90">
                    Voltar
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAdd}
                  className="min-h-12 min-w-0 flex-1 rounded-full bg-[var(--km-accent)] px-6 text-sm font-black text-[var(--km-on-accent)] hover:bg-[var(--km-accent-hover)] transition-all cursor-pointer"
                  style={{ boxShadow: "var(--km-shadow-cta)" }}
                  aria-label={compositionStep.actionLabel}
                >
                  {compositionStep.actionLabel}
                </button>
              </div>
            </div>
          ) : (
          <>
          {hasUnsatisfied ? (
            <p
              className="mb-2 flex items-center gap-1.5 text-xs font-bold"
              style={{ color: "var(--km-alert-text)" }}
              role="status"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {needsVariantSelection
                ? (isSizeVariant ? 'Escolha o tamanho para continuar' : 'Escolha o sabor para continuar')
                : `Escolha ${unsatisfiedModifiers.map((m) => m.title).join(", ")} para continuar`}
            </p>
          ) : (
            <p className="mb-2 text-xs text-[var(--km-muted)]">Quantidade{quantity > 1 ? " · Mesma montagem para todas" : ""}</p>
          )}
          <div className="flex items-center gap-3">
          <div className="flex shrink-0 items-center koma-art-stepper-pill">
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.max(1, current - 1))}
              className="koma-art-stepper-btn disabled:opacity-35"
              disabled={quantity <= 1}
              id="btn-qty-minus"
              aria-label="Diminuir quantidade"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="koma-art-stepper-val min-w-[28px] text-center text-sm font-black text-[var(--km-ink)] tabular-nums">{quantity}</span>
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
            className={`flex min-h-12 min-w-0 touch-manipulation flex-1 items-center justify-between gap-3 rounded-full px-5 transition active:scale-[0.99] cursor-pointer ${
              hasUnsatisfied
                ? "border"
                : "koma-action-primary bg-[var(--km-accent)] text-[var(--km-on-accent)] hover:bg-[var(--km-accent-hover)]"
            }`}
            style={
              hasUnsatisfied
                ? {
                    backgroundColor: "var(--km-alert-soft)",
                    borderColor: "var(--km-alert-border)",
                    color: "var(--km-alert-text)",
                  }
                : { boxShadow: "var(--km-shadow-cta)" }
            }
            id="btn-add-to-cart-action"
            aria-label={`${initialItem ? "Salvar" : "Adicionar"} ${quantity} × ${product.name} · ${formatPrice(totalPrice)}`}
          >
            <span className="flex items-center gap-2 text-xs font-black">
              <ShoppingBag className="h-4 w-4 shrink-0" />
              <span>{initialItem ? "Salvar" : "Adicionar"} {quantity}×</span>
            </span>
            <strong className="text-sm font-black tabular-nums">{needsVariantSelection ? "Escolha uma opção" : formatPrice(totalPrice)}</strong>
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
