import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Gift, ShoppingBag } from 'lucide-react';
import {
  isValidPromotionParts,
  selectedPromotionExtras,
  type PromotionCompositionStep,
  type PromotionPartSelection,
} from '../promotionComposition';
import CardapioProductModal from './CardapioProductModal';

/**
 * Camada de apresentação de uma oferta (1 a 4 etapas + brinde simples opcional).
 * NÃO altera preços, não cria pedidos nem envia itens soltos: a promoção inteira
 * é submetida para validação atômica pelo Order Core.
 */

interface Props {
  title: string;
  basePrice: number;
  steps: PromotionCompositionStep[];
  expectedStepCount?: number;
  brindeNome?: string | null;
  restaurantId: string | number;
  onClose: () => void;
  onConfirm: (parts: PromotionPartSelection[]) => void;
  initialParts?: PromotionPartSelection[];
}

const formatMoney = (amount: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amount);

export default function CardapioPromotionWizard({
  title,
  basePrice,
  steps,
  expectedStepCount,
  brindeNome,
  restaurantId,
  onClose,
  onConfirm,
  initialParts,
}: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [parts, setParts] = useState<Array<PromotionPartSelection | null>>(initialParts || []);
  const review = stepIndex >= steps.length;
  const hasUnavailableProduct =
    steps.length < 1
    || steps.length > 4
    || (expectedStepCount != null && steps.length !== expectedStepCount)
    || steps.some((step) => step.product.isAvailable === false);
  const complete = isValidPromotionParts(steps, parts);
  const extras = selectedPromotionExtras(parts);
  const cleanGift = typeof brindeNome === 'string' && brindeNome.trim() ? brindeNome.trim() : null;

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
    const current = steps[stepIndex];
    const stored = parts[stepIndex];

    return (
      <CardapioProductModal
        key={`${stepIndex}-${current.product.id}`}
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
          total: steps.length + 1,
          stepLabel: current.label,
          actionLabel:
            stepIndex === steps.length - 1
              ? 'Revisar promoção'
              : `Continuar para ${steps[stepIndex + 1].label}`,
          onBack: stepIndex > 0 ? () => setStepIndex(stepIndex - 1) : undefined,
        }}
        onAddToCart={(product, _quantity, selectedOptions, notes) => {
          const selection: PromotionPartSelection = {
            product,
            quantity: 1,
            selectedOptions,
            notes,
          };
          setParts((currentParts) => {
            const next = [...currentParts];
            next[stepIndex] = selection;
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
            Etapa {steps.length + 1} de {steps.length + 1} · Conferir pedido
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
            {steps.map((step, index) => {
              const part = parts[index];
              const choices = part ? Object.values(part.selectedOptions).flat() : [];
              return (
                <div key={`${index}-${step.product.id}`} className="rounded-xl border border-koma-border bg-koma-card p-3">
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
                    onClick={() => setStepIndex(index)}
                    className="mt-2 min-h-11 text-xs font-bold text-koma-secondary hover:text-koma-foreground"
                  >
                    Alterar escolhas
                  </button>
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
            onClick={() => setStepIndex(steps.length - 1)}
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
              if (complete) onConfirm(parts);
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
