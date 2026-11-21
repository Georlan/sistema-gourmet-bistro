import React, { useMemo, useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, Copy, Gift, ShoppingBag, SlidersHorizontal } from 'lucide-react';
import {
  selectedPromotionExtras,
  type PromotionCompositionStep,
  type PromotionPartSelection,
} from '../promotionComposition';
import { normalizeSlotQuantities } from '../../utils/promotionFormHelpers';
import CardapioProductModal from './CardapioProductModal';

/**
 * Camada de apresentação de uma oferta (1 a 4 slots, com suporte a quantidades por slot e brinde simples opcional).
 * NÃO altera preços, não cria pedidos nem envia itens soltos: a promoção inteira
 * é submetida para validação atômica pelo Order Core.
 */

interface Props {
  title: string;
  basePrice: number;
  steps: PromotionCompositionStep[];
  expectedStepCount?: number;
  brindeNome?: string | null;
  slotQuantities?: number[];
  restaurantId: string | number;
  onClose: () => void;
  onConfirm: (parts: PromotionPartSelection[]) => void;
  initialParts?: PromotionPartSelection[];
}

interface WizardFlowEntry {
  slotIdx: number;
  unitIdx: number;
  repeatAll: boolean;
  label: string;
  product: PromotionCompositionStep['product'];
}

const formatMoney = (amount: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amount);

function partSelectionSignature(part: PromotionPartSelection | null | undefined): string {
  if (!part) return '';
  const optionEntries = Object.entries(part.selectedOptions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([groupId, options]) => `${groupId}:${options.map((opt) => opt.id).sort().join(',')}`);
  return `${part.product.id}|${optionEntries.join(';')}|${part.notes.trim()}`;
}

function hydrateInitialSlotSelections(
  steps: PromotionCompositionStep[],
  quantities: number[],
  initialParts?: PromotionPartSelection[],
): {
  selections: Array<Array<PromotionPartSelection | null>>;
  repeatModes: boolean[];
} {
  let cursor = 0;
  const selections: Array<Array<PromotionPartSelection | null>> = [];
  const repeatModes: boolean[] = [];

  for (let slotIdx = 0; slotIdx < steps.length; slotIdx += 1) {
    const qty = quantities[slotIdx] ?? 1;
    const slotUnits: Array<PromotionPartSelection | null> = [];
    for (let u = 0; u < qty; u += 1) {
      const candidate = initialParts?.[cursor] ?? null;
      slotUnits.push(candidate && candidate.product.id === steps[slotIdx].product.id ? candidate : null);
      cursor += 1;
    }
    selections.push(slotUnits);
    if (qty > 1 && slotUnits.every(Boolean)) {
      const firstSig = partSelectionSignature(slotUnits[0]);
      repeatModes.push(slotUnits.every((unit) => partSelectionSignature(unit) === firstSig));
    } else {
      repeatModes.push(true);
    }
  }

  return { selections, repeatModes };
}

export default function CardapioPromotionWizard({
  title,
  basePrice,
  steps,
  expectedStepCount,
  brindeNome,
  slotQuantities,
  restaurantId,
  onClose,
  onConfirm,
  initialParts,
}: Props) {
  const quantities = useMemo(
    () => normalizeSlotQuantities(steps.length, slotQuantities),
    [steps.length, slotQuantities],
  );

  const initialHydration = useMemo(
    () => hydrateInitialSlotSelections(steps, quantities, initialParts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [slotSelections, setSlotSelections] = useState<Array<Array<PromotionPartSelection | null>>>(
    initialHydration.selections,
  );
  const [repeatModes, setRepeatModes] = useState<boolean[]>(initialHydration.repeatModes);

  const wizardFlow = useMemo<WizardFlowEntry[]>(() => {
    const entries: WizardFlowEntry[] = [];
    steps.forEach((step, slotIdx) => {
      const qty = quantities[slotIdx] ?? 1;
      if (qty === 1) {
        entries.push({
          slotIdx,
          unitIdx: 0,
          repeatAll: false,
          label: step.label,
          product: step.product,
        });
      } else if (repeatModes[slotIdx]) {
        entries.push({
          slotIdx,
          unitIdx: 0,
          repeatAll: true,
          label: `${qty}× ${step.label}`,
          product: step.product,
        });
      } else {
        for (let unitIdx = 0; unitIdx < qty; unitIdx += 1) {
          entries.push({
            slotIdx,
            unitIdx,
            repeatAll: false,
            label: `${step.label} (${unitIdx + 1} de ${qty})`,
            product: step.product,
          });
        }
      }
    });
    return entries;
  }, [steps, quantities, repeatModes]);

  const [stepIndex, setStepIndex] = useState(0);
  const [copyRevision, setCopyRevision] = useState(0);
  const review = stepIndex >= wizardFlow.length;

  const hasUnavailableProduct =
    steps.length < 1
    || steps.length > 4
    || (expectedStepCount != null && steps.length !== expectedStepCount)
    || steps.some((step) => step.product.isAvailable === false);

  const flatParts = useMemo<Array<PromotionPartSelection | null>>(
    () => slotSelections.flat(),
    [slotSelections],
  );

  const expectedTotalParts = quantities.reduce((sum, q) => sum + q, 0);
  const complete =
    !hasUnavailableProduct
    && flatParts.length === expectedTotalParts
    && steps.every((step, slotIdx) => {
      const units = slotSelections[slotIdx] || [];
      return (
        units.length === (quantities[slotIdx] ?? 1)
        && units.every(
          (unit) =>
            unit !== null
            && unit.quantity === 1
            && unit.product.id === step.product.id,
        )
      );
    });

  const extras = selectedPromotionExtras(flatParts);
  const cleanGift = typeof brindeNome === 'string' && brindeNome.trim() ? brindeNome.trim() : null;

  const jumpToSlotUnit = (slotIdx: number, unitIdx: number, forceIndividual = false) => {
    const nextRepeat = forceIndividual
      ? repeatModes.map((mode, idx) => (idx === slotIdx ? false : mode))
      : repeatModes;
    if (forceIndividual) {
      setRepeatModes(nextRepeat);
    }
    let targetIndex = 0;
    for (let s = 0; s < steps.length; s += 1) {
      const qty = quantities[s] ?? 1;
      if (s === slotIdx) {
        targetIndex += nextRepeat[s] || qty === 1 ? 0 : unitIdx;
        break;
      }
      targetIndex += nextRepeat[s] || qty === 1 ? 1 : qty;
    }
    setStepIndex(targetIndex);
  };

  const applySameChoiceToSlot = (slotIdx: number, preferredUnitIdx?: number) => {
    setSlotSelections((current) => {
      const next = current.map((units) => [...units]);
      const preferred =
        preferredUnitIdx !== undefined ? next[slotIdx]?.[preferredUnitIdx] : null;
      const template = preferred || next[slotIdx]?.find(Boolean) || null;
      const qty = quantities[slotIdx] ?? 1;
      if (template) {
        next[slotIdx] = Array.from({ length: qty }, () => ({
          ...template,
          selectedOptions: { ...template.selectedOptions },
        }));
      }
      return next;
    });
    setRepeatModes((current) => current.map((mode, idx) => (idx === slotIdx ? true : mode)));
    setCopyRevision((rev) => rev + 1);
  };

  const switchSlotMode = (slotIdx: number, repeatAll: boolean, currentUnitIdx = 0) => {
    if (!repeatAll) {
      jumpToSlotUnit(slotIdx, 0, true);
      return;
    }
    applySameChoiceToSlot(slotIdx, currentUnitIdx);
    let targetIndex = 0;
    for (let s = 0; s < steps.length; s += 1) {
      if (s === slotIdx) break;
      const qty = quantities[s] ?? 1;
      targetIndex += repeatModes[s] || qty === 1 ? 1 : qty;
    }
    setStepIndex(targetIndex);
  };

  const copyFromPreviousUnit = (slotIdx: number, unitIdx: number) => {
    if (unitIdx <= 0) return;
    const slotUnits = slotSelections[slotIdx] || [];
    const source =
      slotUnits[unitIdx - 1]
      || [...slotUnits.slice(0, unitIdx)].reverse().find(Boolean)
      || null;
    if (!source) return;
    setSlotSelections((current) => {
      const next = current.map((units) => [...units]);
      const qty = quantities[slotIdx] ?? 1;
      if (!next[slotIdx]) {
        next[slotIdx] = Array.from({ length: qty }, () => null);
      }
      next[slotIdx][unitIdx] = {
        ...source,
        selectedOptions: { ...source.selectedOptions },
      };
      return next;
    });
    setCopyRevision((rev) => rev + 1);
  };

  const splitSlotForIndividualEditing = (slotIdx: number) => {
    jumpToSlotUnit(slotIdx, 0, true);
  };

  if (hasUnavailableProduct) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <section
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="w-full max-w-sm rounded-2xl border border-koma-border bg-koma-panel p-5 text-koma-foreground"
        >
          <h2
            className="text-lg font-bold"
            style={{ fontFamily: 'var(--koma-font-display)' }}
          >
            {title}
          </h2>
          <p className="mt-3 text-sm text-koma-muted">
            Esta promoção está indisponível porque um dos itens foi pausado.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 min-h-11 w-full rounded-xl border border-koma-border bg-koma-card text-sm font-semibold text-koma-foreground"
          >
            Voltar ao cardápio
          </button>
        </section>
      </div>
    );
  }

  if (!review) {
    const current = wizardFlow[stepIndex];
    const currentSlotQty = quantities[current.slotIdx] ?? 1;
    const currentSlotUnits = slotSelections[current.slotIdx] || [];
    const stored = currentSlotUnits[current.unitIdx] ?? null;
    const previousFilledUnit =
      !current.repeatAll && current.unitIdx > 0
        ? currentSlotUnits[current.unitIdx - 1]
          || [...currentSlotUnits.slice(0, current.unitIdx)].reverse().find(Boolean)
          || null
        : null;

    const multiUnitHeaderSlot = currentSlotQty > 1 ? (
      <div
        className="space-y-2.5 rounded-2xl border border-koma-border bg-koma-card p-3"
        aria-label={`Modo de escolha para ${steps[current.slotIdx].label}`}
      >
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Como montar estas unidades">
          <button
            type="button"
            aria-pressed={current.repeatAll}
            onClick={() => switchSlotMode(current.slotIdx, true, current.unitIdx)}
            className="min-h-11 rounded-xl border px-3 py-2 text-xs font-bold transition tabular-nums"
            style={
              current.repeatAll
                ? {
                    background: 'var(--koma-action-bg)',
                    borderColor: 'var(--koma-action-bg)',
                    color: 'var(--koma-action-text)',
                  }
                : {
                    background: 'var(--koma-surface-panel)',
                    borderColor: 'var(--koma-border-default)',
                    color: 'var(--koma-text-secondary)',
                  }
            }
          >
            Todas iguais ({currentSlotQty}×)
          </button>
          <button
            type="button"
            aria-pressed={!current.repeatAll}
            onClick={() => switchSlotMode(current.slotIdx, false, current.unitIdx)}
            className="min-h-11 rounded-xl border px-3 py-2 text-xs font-bold transition tabular-nums"
            style={
              !current.repeatAll
                ? {
                    background: 'var(--koma-action-bg)',
                    borderColor: 'var(--koma-action-bg)',
                    color: 'var(--koma-action-text)',
                  }
                : {
                    background: 'var(--koma-surface-panel)',
                    borderColor: 'var(--koma-border-default)',
                    color: 'var(--koma-text-secondary)',
                  }
            }
          >
            Escolher cada uma ({currentSlotQty})
          </button>
        </div>

        {current.repeatAll ? (
          <p className="text-xs leading-relaxed text-koma-muted">
            Esta montagem será aplicada às <strong className="text-koma-foreground">{currentSlotQty} unidades</strong> de {steps[current.slotIdx].label}.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5" role="navigation" aria-label="Selecionar unidade">
              {Array.from({ length: currentSlotQty }, (_, unitIdx) => {
                const isActive = unitIdx === current.unitIdx;
                const isDone = Boolean(currentSlotUnits[unitIdx]);
                return (
                  <button
                    key={unitIdx}
                    type="button"
                    aria-current={isActive ? 'step' : undefined}
                    aria-label={`${steps[current.slotIdx].label} unidade ${unitIdx + 1} de ${currentSlotQty}${isDone ? ' (montada)' : ''}`}
                    onClick={() => jumpToSlotUnit(current.slotIdx, unitIdx)}
                    className="inline-flex min-h-11 min-w-11 flex-1 items-center justify-center gap-1 rounded-xl border px-2 text-xs font-bold transition tabular-nums"
                    style={
                      isActive
                        ? {
                            background: 'var(--koma-action-bg)',
                            borderColor: 'var(--koma-action-bg)',
                            color: 'var(--koma-action-text)',
                          }
                        : isDone
                          ? {
                              background: 'var(--koma-success-bg)',
                              borderColor: 'var(--koma-success-border)',
                              color: 'var(--koma-success-text)',
                            }
                          : {
                              background: 'var(--koma-surface-panel)',
                              borderColor: 'var(--koma-border-default)',
                              color: 'var(--koma-text-secondary)',
                            }
                    }
                  >
                    {isDone && !isActive && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    <span>#{unitIdx + 1}</span>
                  </button>
                );
              })}
            </div>
            {previousFilledUnit && (
              <button
                type="button"
                onClick={() => copyFromPreviousUnit(current.slotIdx, current.unitIdx)}
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-koma-border bg-koma-panel px-3 text-xs font-bold text-koma-secondary transition hover:bg-koma-raised hover:text-koma-foreground"
              >
                <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Copiar escolhas da #{current.unitIdx} para a #{current.unitIdx + 1}
              </button>
            )}
          </div>
        )}
      </div>
    ) : undefined;

    return (
      <CardapioProductModal
        key={`${current.slotIdx}-${current.unitIdx}-${current.product.id}-${copyRevision}`}
        product={current.product}
        restaurantId={restaurantId}
        initialItem={
          stored
            ? {
                quantity: 1,
                selectedOptions: stored.selectedOptions,
                notes: stored.notes,
              }
            : undefined
        }
        onClose={onClose}
        compositionStep={{
          current: stepIndex + 1,
          total: wizardFlow.length + 1,
          stepLabel: current.label,
          unitMultiplier: current.repeatAll ? currentSlotQty : 1,
          headerSlot: multiUnitHeaderSlot,
          actionLabel:
            stepIndex === wizardFlow.length - 1
              ? 'Revisar promoção'
              : `Continuar para ${wizardFlow[stepIndex + 1].label}`,
          onBack: stepIndex > 0 ? () => setStepIndex(stepIndex - 1) : undefined,
        }}
        onAddToCart={(product, _quantity, selectedOptions, notes) => {
          const selection: PromotionPartSelection = {
            product,
            quantity: 1,
            selectedOptions,
            notes,
          };
          setSlotSelections((currentSlots) => {
            const next = currentSlots.map((units) => [...units]);
            const qty = quantities[current.slotIdx] ?? 1;
            if (current.repeatAll) {
              next[current.slotIdx] = Array.from({ length: qty }, () => ({
                ...selection,
                selectedOptions: { ...selection.selectedOptions },
              }));
            } else {
              if (!next[current.slotIdx]) {
                next[current.slotIdx] = Array.from({ length: qty }, () => null);
              }
              next[current.slotIdx][current.unitIdx] = selection;
            }
            return next;
          });
          setStepIndex(stepIndex + 1);
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="promotion-review-title"
        className="flex max-h-[95dvh] w-full max-w-lg flex-col rounded-t-3xl border border-koma-border bg-koma-panel text-koma-foreground sm:rounded-3xl"
      >
        <div className="overflow-y-auto p-5">
          <p
            className="text-xs font-bold tabular-nums"
            style={{ color: 'var(--koma-success-text)' }}
          >
            Etapa {wizardFlow.length + 1} de {wizardFlow.length + 1} · Conferir pedido
          </p>
          <h2
            id="promotion-review-title"
            className="mt-2 text-xl font-bold"
            style={{ fontFamily: 'var(--koma-font-display)' }}
          >
            {title}
          </h2>
          <p className="mt-1 text-xs text-koma-muted">
            Confira a montagem de cada item antes de adicionar a promoção.
          </p>
          <div className="mt-4 space-y-3">
            {steps.map((step, slotIdx) => {
              const qty = quantities[slotIdx] ?? 1;
              const units = slotSelections[slotIdx] || [];
              const isRepeated = repeatModes[slotIdx];
              const allFilled = units.length === qty && units.every(Boolean);

              if (qty === 1) {
                const part = units[0];
                const choices = part ? Object.values(part.selectedOptions).flat() : [];
                return (
                  <div key={`${slotIdx}-${step.product.id}`} className="rounded-xl border border-koma-border bg-koma-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm text-koma-foreground">{step.label}</strong>
                      {part && (
                        <CheckCircle2
                          className="h-4 w-4 shrink-0"
                          style={{ color: 'var(--koma-success-text)' }}
                          aria-label="Montagem concluída"
                        />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-koma-muted">
                      {choices.length
                        ? choices.map((option) => option.name).join(', ')
                        : 'Sem complementos selecionados'}
                    </p>
                    {part?.notes && <p className="mt-1 text-xs text-koma-muted">Observação: {part.notes}</p>}
                    <button
                      type="button"
                      onClick={() => jumpToSlotUnit(slotIdx, 0)}
                      className="mt-2 min-h-11 text-xs font-bold text-koma-secondary hover:text-koma-foreground"
                    >
                      Alterar escolhas
                    </button>
                  </div>
                );
              }

              const firstPart = units[0];
              const firstChoices = firstPart ? Object.values(firstPart.selectedOptions).flat() : [];

              return (
                <div key={`${slotIdx}-${step.product.id}`} className="space-y-2.5 rounded-xl border border-koma-border bg-koma-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm text-koma-foreground tabular-nums">
                      {qty}× {step.label}
                    </strong>
                    {allFilled && (
                      <CheckCircle2
                        className="h-4 w-4 shrink-0"
                        style={{ color: 'var(--koma-success-text)' }}
                        aria-label="Montagem concluída"
                      />
                    )}
                  </div>

                  {isRepeated ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-koma-secondary">
                        Mesma escolha aplicada para todas ({qty}×)
                      </p>
                      <p className="text-xs text-koma-muted">
                        {firstChoices.length
                          ? firstChoices.map((option) => option.name).join(', ')
                          : 'Sem complementos selecionados'}
                      </p>
                      {firstPart?.notes && (
                        <p className="text-xs text-koma-muted">Observação: {firstPart.notes}</p>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => jumpToSlotUnit(slotIdx, 0)}
                          className="min-h-11 rounded-xl border border-koma-border bg-koma-panel px-3 text-xs font-bold text-koma-foreground transition hover:bg-koma-raised"
                        >
                          Alterar escolhas ({qty}×)
                        </button>
                        <button
                          type="button"
                          onClick={() => splitSlotForIndividualEditing(slotIdx)}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-panel px-3 text-xs font-semibold text-koma-secondary transition hover:bg-koma-raised hover:text-koma-foreground"
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                          Personalizar cada uma ({qty}×)
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => applySameChoiceToSlot(slotIdx)}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-koma-border bg-koma-panel px-3 text-xs font-bold text-koma-secondary transition hover:bg-koma-raised hover:text-koma-foreground"
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        Aplicar mesma escolha para todas ({qty}×)
                      </button>
                      <div className="space-y-2">
                        {units.map((unitPart, unitIdx) => {
                          const unitChoices = unitPart ? Object.values(unitPart.selectedOptions).flat() : [];
                          return (
                            <div
                              key={`${slotIdx}-${unitIdx}`}
                              className="flex items-start justify-between gap-2 rounded-lg border border-koma-border bg-koma-panel p-2.5"
                            >
                              <div className="min-w-0">
                                <span className="block text-xs font-bold text-koma-foreground tabular-nums">
                                  {step.label} · Unidade {unitIdx + 1} de {qty}
                                </span>
                                <span className="mt-0.5 block text-xs text-koma-muted">
                                  {unitChoices.length
                                    ? unitChoices.map((option) => option.name).join(', ')
                                    : 'Sem complementos selecionados'}
                                </span>
                                {unitPart?.notes && (
                                  <span className="mt-0.5 block text-xs text-koma-muted">
                                    Obs.: {unitPart.notes}
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => jumpToSlotUnit(slotIdx, unitIdx, true)}
                                className="min-h-11 shrink-0 rounded-lg px-2.5 text-xs font-bold text-koma-secondary hover:text-koma-foreground"
                              >
                                Alterar
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {cleanGift && (
              <div
                className="flex items-center gap-2.5 rounded-xl border p-3 text-xs font-semibold"
                style={{
                  background: 'var(--koma-success-bg)',
                  borderColor: 'var(--koma-success-border)',
                  color: 'var(--koma-success-text)',
                }}
              >
                <Gift className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Brinde incluso: {cleanGift}</span>
              </div>
            )}
          </div>
          <div className="mt-4 space-y-2 rounded-xl border border-koma-border bg-koma-card p-3 text-sm">
            <div className="flex justify-between">
              <span>Preço-base da promoção</span>
              <strong className="tabular-nums">{formatMoney(basePrice)}</strong>
            </div>
            {extras > 0 && (
              <div className="flex justify-between">
                <span>Adicionais escolhidos</span>
                <strong className="tabular-nums">+ {formatMoney(extras)}</strong>
              </div>
            )}
            <div className="flex justify-between border-t border-koma-border pt-2 font-bold">
              <span>Total estimado</span>
              <span className="tabular-nums">{formatMoney(basePrice + extras)}</span>
            </div>
            <p className="text-xs text-koma-muted">
              O servidor confirma preço, condições, disponibilidade e adicionais ao registrar o pedido.
            </p>
          </div>
        </div>
        <div className="flex gap-2 border-t border-koma-border p-4">
          <button
            type="button"
            onClick={() => setStepIndex(Math.max(0, wizardFlow.length - 1))}
            className="min-h-11 rounded-xl border border-koma-border bg-koma-card px-3 text-sm font-bold text-koma-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Voltar à montagem</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl border border-koma-border bg-koma-card px-3 text-sm font-semibold text-koma-secondary"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!complete}
            onClick={() => {
              if (complete) {
                const parts = flatParts.filter((part): part is PromotionPartSelection => Boolean(part));
                onConfirm(parts);
              }
            }}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold disabled:opacity-50"
            style={{
              background: 'var(--koma-action-bg)',
              color: 'var(--koma-action-text)',
            }}
          >
            <ShoppingBag className="h-4 w-4" aria-hidden="true" /> Adicionar promoção
          </button>
        </div>
      </section>
    </div>
  );
}
