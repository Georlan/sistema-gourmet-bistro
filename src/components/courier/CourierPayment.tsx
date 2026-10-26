import { CourierPaymentArtwork } from './CourierGlyph';
import { AlertCircle, CheckCircle2, Banknote } from 'lucide-react';

export interface CourierPaymentData {
  status: 'collect' | 'paid' | 'not_due' | 'check';
  method: 'cash' | 'card' | 'pix' | 'unknown';
  amount_due: number;
  change_for: number | null;
  change_amount: number | null;
  change_needs_check: boolean;
}
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const methodLabels = { cash: 'Cobrar em dinheiro', card: 'Cobrar no cartão', pix: 'Cobrar no Pix', unknown: 'Cobrar · conferir forma no Caixa' };

/** All payment decisions and change values come from the authorized backend. */
export function CourierPayment({ payment, legacyDue }: { payment?: CourierPaymentData; legacyDue: number }) {
  const status = payment?.status || (legacyDue > 0 ? 'collect' : 'not_due');
  const due = payment?.amount_due ?? legacyDue;
  const Icon = status === 'check' ? AlertCircle : status === 'paid' || status === 'not_due' ? CheckCircle2 : Banknote;
  return <section className={`k-courier__payment k-courier__payment--${status}`} aria-label="Pagamento da entrega">
    <div className="k-courier__payment-heading">
      {status === 'collect' ? <><div><span className="k-courier__payment-method">{payment ? methodLabels[payment.method] : 'Cobrar na entrega'}</span><strong>{currency.format(due)}</strong></div>{payment && (payment.method === 'cash' || payment.method === 'card') && <CourierPaymentArtwork method={payment.method} />}</>
        : <span><Icon size={24} aria-hidden="true" />{status === 'paid' ? 'Não cobrar' : status === 'check' ? 'Conferir no Caixa' : 'Sem cobrança'}</span>}
    </div>
    {status === 'collect' && payment?.change_amount != null && payment.change_amount > 0 && <div className="k-courier__change"><span>Troco <strong>{currency.format(payment.change_amount)}</strong></span><small>Paga com {currency.format(payment.change_for!)}</small></div>}
    {status === 'collect' && payment?.method === 'cash' && payment.change_amount === 0 && <p>Valor exato · sem troco</p>}
    {payment?.change_needs_check && <p className="k-courier__payment-warning"><AlertCircle size={16} aria-hidden="true" />Troco a conferir no Caixa.</p>}
  </section>;
}
