import React, { useEffect, useState } from 'react';
import DeliveryAddressFields from '../../shared/DeliveryAddressFields';
import { EMPTY_DELIVERY_ADDRESS, deliveryAddressDraftToSnapshot, type DeliveryAddressDraft } from '../../../domain/deliveryAddress';
import { formatCurrency } from '../cashierPresentation';

export type FulfillmentConversionTarget = {
  orderId: string;
  orderLabel: string;
  options: ('pickup' | 'delivery')[];
  address?: Partial<DeliveryAddressDraft> | null;
  blockedReason?: string | null;
};
export type ConversionQuote = { token: string; previous_fee: number; delivery_fee: number; previous_total: number; total: number };
type Props = {
  target: FulfillmentConversionTarget | null;
  isSubmitting: boolean;
  onClose: () => void;
  onPreview: (payload: Record<string, unknown>) => Promise<ConversionQuote>;
  onSubmit: (reason: string, payload: Record<string, unknown>) => Promise<boolean>;
};

export function FulfillmentConversionDialog({ target, isSubmitting, onClose, onPreview, onSubmit }: Props) {
  const [reason, setReason] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState<DeliveryAddressDraft>({ ...EMPTY_DELIVERY_ADDRESS });
  const [quote, setQuote] = useState<ConversionQuote | null>(null);
  const [message, setMessage] = useState('');
  const [calculating, setCalculating] = useState(false);
  const generation = React.useRef(0);
  useEffect(() => {
    generation.current += 1;
    setReason(''); setPhone(''); setQuote(null); setMessage(''); setCalculating(false);
    const saved = { ...EMPTY_DELIVERY_ADDRESS, ...target?.address };
    setAddress({ ...saved, complemento: saved.complemento || '', referencia: saved.referencia || '' });
  }, [target]);
  if (!target) return null;
  const fulfillment = target.options[0];
  const busy = isSubmitting || calculating;
  const payload = { fulfillment, telefone: phone || undefined, address_snapshot: fulfillment === 'delivery' ? deliveryAddressDraftToSnapshot(address) : undefined };
  return <div className="fixed inset-0 z-[92] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
    <section role="dialog" aria-modal="true" aria-labelledby="fulfillment-conversion-title"
      className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-koma-border bg-koma-card p-5 shadow-2xl">
      <h2 id="fulfillment-conversion-title" className="text-base font-bold">Alterar tipo do pedido</h2>
      <p className="my-2 text-sm">{target.orderLabel}</p>
      {target.blockedReason ? <p role="alert">{target.blockedReason}</p> : <form className="space-y-3" onSubmit={async event => {
        event.preventDefault();
        if (busy || reason.trim().length < 3) return;
        setMessage('');
        if (!quote) {
          const revision = generation.current;
          setCalculating(true);
          try { const result = await onPreview(payload); if (revision === generation.current) setQuote(result); }
          catch (error) { if (revision === generation.current) setMessage(error instanceof Error ? error.message : 'Falha ao calcular.'); }
          finally { if (revision === generation.current) setCalculating(false); }
        } else {
          try {
            const success = await onSubmit(reason.trim(), { ...payload, token: quote.token });
            if (!success) { setQuote(null); setMessage('Alteração não confirmada. Confira o pedido e calcule novamente.'); }
          } catch (error) { setQuote(null); setMessage(error instanceof Error ? error.message : 'Falha ao alterar.'); }
        }
      }}>
        <label className="block text-sm">Novo tipo
          <select aria-label="Novo tipo do pedido" disabled={busy || !!quote} value={fulfillment} className="mt-1 w-full rounded-lg border border-koma-border bg-koma-panel p-2">
            {target.options.map(option => <option key={option} value={option}>{option === 'delivery' ? 'Entrega' : 'Retirada'}</option>)}
          </select>
        </label>
        {fulfillment === 'delivery' && <label className="block text-sm">Telefone de contato (confirme ou mantenha o atual)<input aria-label="Telefone de contato" type="tel" value={phone} disabled={busy || !!quote} onChange={event => setPhone(event.target.value)} className="mt-1 w-full rounded-lg border border-koma-border bg-koma-panel p-2" /></label>}
        {fulfillment === 'delivery' && <fieldset disabled={busy || !!quote}><DeliveryAddressFields compact value={address} onChange={value => { setAddress(value); setQuote(null); }} idPrefix="conversion-address" /></fieldset>}
        <label className="block text-sm">Motivo da alteração
          <textarea aria-label="Motivo da alteração" required minLength={3} maxLength={500} disabled={busy || !!quote} value={reason}
            onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded-lg border border-koma-border bg-koma-panel p-2" />
        </label>
        {quote && <div role="status" className="rounded-lg border border-amber-500/30 p-3 text-sm space-y-1">
          <p>Taxa de entrega: {formatCurrency(quote.previous_fee)} → {formatCurrency(quote.delivery_fee)}</p>
          <p>Total: {formatCurrency(quote.previous_total)} → {formatCurrency(quote.total)}</p>
          <p>A etapa de preparo será preservada. Confirme a alteração abaixo.</p>
          <button type="button" disabled={busy} onClick={() => setQuote(null)} className="underline">Revisar dados</button>
        </div>}
        {message && <p role="alert" className="text-sm text-rose-500">{message}</p>}
        <button type="submit" disabled={busy || reason.trim().length < 3} className="min-h-10 w-full rounded-xl bg-amber-600 px-4 text-sm font-bold text-white disabled:opacity-50">
          {busy ? 'Aguarde…' : quote ? 'Confirmar alteração' : 'Calcular e revisar'}
        </button>
      </form>}
      <button type="button" disabled={busy} onClick={onClose} className="mt-3 min-h-10 w-full rounded-xl border border-koma-border">Cancelar</button>
    </section>
  </div>;
}
