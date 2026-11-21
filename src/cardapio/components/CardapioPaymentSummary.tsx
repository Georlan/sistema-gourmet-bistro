import React from 'react';

import { PAYMENT_LABELS } from '../paymentMethods';
import { KomaCardAsset, KomaCashAsset, KomaPixAsset } from '../v2/KomaVisualAssets';
export { PAYMENT_LABELS } from '../paymentMethods';

interface Props {
  method: keyof typeof PAYMENT_LABELS;
  fulfillment: 'delivery' | 'pickup' | 'dine_in';
  changeFor?: number;
  isDirectPix?: boolean;
}

/** Read-only projection of the payment choice already sent with the order. */
export default function CardapioPaymentSummary({ method, fulfillment, changeFor, isDirectPix = false }: Props) {
  const isOnlinePix = method === 'pix';
  const PaymentAsset = method === 'pix' ? KomaPixAsset : method === 'dinheiro' ? KomaCashAsset : KomaCardAsset;
  const fulfillmentText = isOnlinePix
    ? (isDirectPix ? 'antecipado via Pix próprio' : 'online agora')
    : fulfillment === 'delivery'
      ? 'na entrega'
      : fulfillment === 'dine_in'
        ? 'no atendimento'
        : 'na retirada';

  return (
    <div className="flex items-center gap-3">
      <PaymentAsset className="h-10 w-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="sr-only">Pagamento escolhido</span>
        <p className="text-sm font-bold text-[var(--km-ink)] leading-snug">
          {PAYMENT_LABELS[method]}{' '}
          <span className="font-normal text-[var(--km-muted)]">· {fulfillmentText}</span>
        </p>
        {method === 'dinheiro' && (
          <span className="mt-1 inline-flex items-center rounded-full border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--km-accent-text)]">
            {changeFor && changeFor > 0
              ? `Troco para ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(changeFor)}`
              : 'Sem troco solicitado'}
          </span>
        )}
        {isOnlinePix ? (
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--km-muted)]">
            {isDirectPix
              ? 'Você paga pelo Pix do restaurante e a equipe confirma o recebimento antes de liberar o pedido.'
              : 'O pedido só aparece para o restaurante após a confirmação automática do pagamento.'}
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-[var(--km-muted)]">Não há cobrança online nesta etapa.</p>
        )}
      </div>
    </div>
  );
}
