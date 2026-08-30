import React from 'react';
import { CreditCard } from 'lucide-react';

export const PAYMENT_LABELS = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
};

interface Props {
  method: keyof typeof PAYMENT_LABELS;
  fulfillment: 'delivery' | 'pickup';
  changeFor?: number;
}

/** Read-only projection of the payment choice already sent with the order. */
export default function CardapioPaymentSummary({ method, fulfillment, changeFor }: Props) {
  return (
    <div className="flex items-start gap-3">
      <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
      <div className="min-w-0">
        <h3 className="text-xs font-semibold text-koma-muted">Pagamento escolhido</h3>
        <p className="mt-1 text-sm font-bold text-koma-foreground">{PAYMENT_LABELS[method]} <span className="font-normal text-koma-secondary">· {fulfillment === 'delivery' ? 'na entrega' : 'na retirada'}</span></p>
        {method === 'dinheiro' && <p className="mt-1 text-xs text-koma-secondary">{changeFor && changeFor > 0 ? `Troco para ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(changeFor)}` : 'Sem troco solicitado'}</p>}
        <p className="mt-2 text-xs leading-relaxed text-koma-muted">Você paga diretamente ao restaurante. Não há cobrança online nesta etapa.</p>
      </div>
    </div>
  );
}
