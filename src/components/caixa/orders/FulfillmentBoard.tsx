import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { CashierColumnHeader } from './CashierColumnHeader';
import type { DeliveryOrderView } from './cashierWorkspaceTypes';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (value: number) => currency.format(value);
export const matchesSearch = (query: string, values: unknown[]) => {
  const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const term = normalize(query.trim()).replace(/^#/, '');
  return !term || values.some(value => normalize(value).includes(term));
};

export function BoardSearch({ title, query, onChange, placeholder }: {
  title: string; query: string; onChange: (value: string) => void; placeholder: string;
}) {
  return <header className="fulfillment-tools">
    <h2>{title}</h2>
    <label><Search size={18} aria-hidden="true" />
      <input type="search" aria-label={placeholder} placeholder={placeholder} value={query} onChange={event => onChange(event.target.value)} />
    </label>
  </header>;
}

export function BoardLane({ title, kind, count, children, empty }: {
  title: string; kind: 'salon' | 'digital' | 'closing'; count: number; children: ReactNode; empty: string;
}) {
  return <section className={`fulfillment-lane orders-column--${kind}`}>
    <CashierColumnHeader title={title} kind={kind} count={count} />
    <div className="fulfillment-list">{count ? children : <p>{empty}</p>}</div>
  </section>;
}

export function FulfillmentTicket({ order, status, customer, payment, meta, children }: {
  order: DeliveryOrderView; status: string; customer: string; payment: string; meta?: ReactNode; children: ReactNode;
}) {
  const delivery = order.modalidade === 'delivery';
  return <article className="fulfillment-ticket" data-pickup-status={delivery ? undefined : order.status === 'pronto' ? 'ready' : order.status}>
    <header>
      <div className="fulfillment-number" aria-label={`Pedido ${order.numeroPedido || order.id}`}>
        <img src={delivery ? '/brand/cashier/delivery-v1.svg' : '/brand/cashier/pickup-v1.svg'} width="26" height="26" alt="" />
        <strong>#{order.numeroPedido || order.id}</strong>
      </div>
      <div><h4>{customer}</h4>{order.telefone && <span>{order.telefone}</span>}<p>{status}</p></div>
      <strong>{money(order.total)}</strong>
    </header>
    {delivery && <p>{order.endereco || 'Endereço não informado'}</p>}
    {meta}
    <p className="fulfillment-items">{order.itens}</p>
    <p className="fulfillment-payment">{payment}</p>
    <footer>{children}</footer>
  </article>;
}

export function BoardSync({ snapshot, state, label, retry }: {
  snapshot: boolean; state: string; label: string; retry?: () => void;
}) {
  if (state === 'error') return <p className="fulfillment-notice" role="alert">
    Falha ao atualizar os pedidos. {snapshot && 'Mostrando o último estado conhecido.'}
    {retry && <button onClick={retry}>Tentar novamente</button>}
  </p>;
  return snapshot ? null : <p className="fulfillment-notice" role="status">Sincronizando {label}…</p>;
}
