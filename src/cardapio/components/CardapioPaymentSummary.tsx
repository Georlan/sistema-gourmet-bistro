import React from 'react';
import { CreditCard } from 'lucide-react';

import { PAYMENT_LABELS } from '../paymentMethods';
export { PAYMENT_LABELS } from '../paymentMethods';

interface Props {
  method: keyof typeof PAYMENT_LABELS;
  fulfillment: 'delivery' | 'pickup';
  changeFor?: number;
}

/** Read-only projection of the payment choice already sent with the order. */
export default function CardapioPaymentSummary({ method, fulfillment, changeFor }: Props) {
  const isOnlinePix = method === 'pix';
  return (
    <div className="flex items-start gap-3">
      <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
      <div className="min-w-0">
        <h3 className="text-xs font-semibold text-koma-muted">Pagamento escolhido</h3>
        <p className="mt-1 text-sm font-bold text-koma-foreground">{PAYMENT_LABELS[method]} <span className="font-normal text-koma-secondary">· {isOnlinePix ? 'online agora' : fulfillment === 'delivery' ? 'na entrega' : 'na retirada'}</span></p>
        {method === 'dinheiro' && <p className="mt-1 text-xs text-koma-secondary">{changeFor && changeFor > 0 ? `Troco para ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(changeFor)}` : 'Sem troco solicitado'}</p>}
        <p className="mt-2 text-xs leading-relaxed text-koma-muted">{isOnlinePix ? 'O pedido só aparece para o restaurante após a confirmação automática do pagamento.' : 'Você paga diretamente ao restaurante. Não há cobrança online nesta etapa.'}</p>
      </div>
    </div>
  );
}
