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
    <div role="group" aria-label="Formas de pagamento disponíveis" className={`grid gap-2 ${available.length === 1 ? 'grid-cols-1' : available.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {available.map((method) => {
        const Icon = method === 'pix' ? QrCode : method === 'dinheiro' ? Banknote : CreditCard;
        return (
          <button key={method} type="button" aria-pressed={selected === method} onClick={() => onSelect(method)}
            className={`min-h-20 min-w-0 p-2.5 rounded-xl border text-center transition flex flex-col items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 ${selected === method ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 font-bold' : 'border-koma-border bg-koma-card text-koma-muted hover:text-koma-foreground'}`}>
            <Icon className="w-5 h-5" aria-hidden="true" />
            <span className="text-xs leading-snug">{PAYMENT_LABELS[method]}</span>
          </button>
        );
      })}
    </div>
  );
}
