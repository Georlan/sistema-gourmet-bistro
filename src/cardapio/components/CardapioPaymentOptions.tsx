import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { PAYMENT_LABELS, PAYMENT_UNAVAILABLE_MESSAGE, type PaymentMethod } from '../paymentMethods';
import { KomaCardAsset, KomaCashAsset, KomaPixAsset } from '../v2/KomaVisualAssets';

interface Props {
  available: PaymentMethod[];
  selected: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
}

export default function CardapioPaymentOptions({ available, selected, onSelect }: Props) {
  if (available.length === 0) {
    return (
      <p
        role="status"
        className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3.5 text-xs leading-relaxed text-[var(--km-ink)]"
      >
        {PAYMENT_UNAVAILABLE_MESSAGE}
      </p>
    );
  }

  return (
    <div
      role="group"
      aria-label="Formas de pagamento disponíveis"
      className={`grid gap-2.5 ${available.length === 1 ? 'grid-cols-1' : available.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}
    >
      {available.map((method) => {
        const PaymentAsset = method === 'pix' ? KomaPixAsset : method === 'dinheiro' ? KomaCashAsset : KomaCardAsset;
        const isSelected = selected === method;
        return (
          <button
            key={method}
            type="button"
            aria-pressed={isSelected}
            aria-label={PAYMENT_LABELS[method]}
            onClick={() => onSelect(method)}
            className={`relative flex flex-col items-center justify-center gap-2 min-h-[82px] rounded-2xl border px-3 py-3 text-center transition active:scale-[0.98] cursor-pointer ${
              isSelected
                ? 'border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] text-[var(--km-ink)] ring-2 ring-[var(--km-accent-soft)] shadow-sm'
                : 'border-[var(--km-line)] bg-[var(--km-card)] text-[var(--km-ink-2)] hover:border-[var(--km-accent-border)] hover:text-[var(--km-ink)]'
            }`}
          >
            {method === 'pix' && (
              <span
                className="absolute right-2 top-2 rounded-full bg-[var(--km-accent)] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-[var(--km-on-accent)] leading-none"
                aria-hidden="true"
              >
                Imediato
              </span>
            )}
            {isSelected && method !== 'pix' && (
              <CheckCircle2
                className="absolute right-2.5 top-2.5 h-4 w-4 text-[var(--km-accent-text)]"
                aria-hidden="true"
              />
            )}
            <PaymentAsset className="h-9 w-9 shrink-0" />
            <span className="text-xs font-bold leading-snug text-[var(--km-ink)]">
              {PAYMENT_LABELS[method]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
