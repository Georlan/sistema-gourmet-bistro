import { AlertCircle, CheckCircle2, Banknote, CreditCard } from 'lucide-react';

export interface CourierPaymentData {
  status: 'collect' | 'paid' | 'not_due' | 'check';
  method: 'cash' | 'card' | 'pix' | 'unknown';
  amount_due: number;
  change_for: number | null;
  change_amount: number | null;
  change_needs_check: boolean;
}
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const methodLabels = { cash: 'Dinheiro', card: 'Cartão · levar maquininha', pix: 'Pix', unknown: 'Forma a conferir com o Caixa' };

/** All payment decisions and change values come from the authorized backend. */
export function CourierPayment({ payment, legacyDue }: { payment?: CourierPaymentData; legacyDue: number }) {
  const status = payment?.status || (legacyDue > 0 ? 'collect' : 'not_due');
  const due = payment?.amount_due ?? legacyDue;
  const Icon = status === 'check' ? AlertCircle : status === 'paid' || status === 'not_due' ? CheckCircle2 : payment?.method === 'card' ? CreditCard : Banknote;
  return <section className={`k-courier__payment k-courier__payment--${status}`} aria-label="Pagamento da entrega">
    <div className="k-courier__payment-heading"><span><Icon size={19} aria-hidden="true" />{status === 'collect' ? 'Cobrar na entrega' : status === 'paid' ? 'Pago · não cobrar' : status === 'check' ? 'Conferir pagamento no Caixa' : 'Sem cobrança'}</span>{status === 'collect' && <strong>{currency.format(due)}</strong>}</div>
    {status === 'collect' && payment && <p className="k-courier__payment-method">{methodLabels[payment.method]}</p>}
    {status === 'collect' && payment?.change_amount != null && payment.change_amount > 0 && <div className="k-courier__change"><span>Troco <strong>{currency.format(payment.change_amount)}</strong></span><small>Cliente paga com {currency.format(payment.change_for!)}</small></div>}
    {status === 'collect' && payment?.method === 'cash' && payment.change_amount === 0 && <p>Valor exato · sem troco</p>}
    {payment?.change_needs_check && <p className="k-courier__payment-warning"><AlertCircle size={16} aria-hidden="true" />Troco informado menor que a cobrança. Confira com o Caixa.</p>}
  </section>;
}
