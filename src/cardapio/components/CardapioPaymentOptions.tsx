import React from 'react';
import { Banknote, CreditCard, QrCode } from 'lucide-react';
import { PAYMENT_LABELS, PAYMENT_UNAVAILABLE_MESSAGE, type PaymentMethod } from '../paymentMethods';

interface Props {
  available: PaymentMethod[];
  selected: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
}

export default function CardapioPaymentOptions({ available, selected, onSelect }: Props) {
  if (available.length === 0) {
    return <p role="status" className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-koma-foreground">{PAYMENT_UNAVAILABLE_MESSAGE}</p>;
  }
  return (
    <div role="group" aria-label="Formas de pagamento disponíveis" className={`grid gap-2.5 ${available.length === 1 ? 'grid-cols-1' : available.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {available.map((method) => {
        const Icon = method === 'pix' ? QrCode : method === 'dinheiro' ? Banknote : CreditCard;
        const isSelected = selected === method;
        return (
          <button
            key={method}
            type="button"
            aria-pressed={isSelected}
            aria-label={PAYMENT_LABELS[method]}
            onClick={() => onSelect(method)}
            className={`koma-art-pay-card ${isSelected ? 'is-selected' : ''}`}
          >
            {method === 'pix' && (
              <span className="koma-art-pix-badge" aria-hidden="true">Imediato</span>
            )}
            <Icon className={`w-5 h-5 ${isSelected ? 'text-emerald-400' : 'text-koma-muted'}`} aria-hidden="true" />
            <span className="text-xs font-bold leading-snug">{PAYMENT_LABELS[method]}</span>
          </button>
        );
      })}
    </div>
  );
}
