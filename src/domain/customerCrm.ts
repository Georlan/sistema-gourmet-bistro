import type { LoyaltyCustomer } from '../components/caixa/cashierContracts';

export type CustomerSort = 'orders' | 'spent' | 'recent' | 'absent' | 'name';
export type CustomerSegment = 'ALL' | 'REPEAT' | 'ATENCAO' | 'REATIVAR' | 'SEM_COMPRA';
export const customerSegmentLabel = (customer: LoyaltyCustomer) => ({
  ATIVO: 'Ativo', ATENCAO: 'Atenção', REATIVAR: 'Reativar', SEM_COMPRA: 'Sem compra',
}[customer.segmento_relacionamento || 'SEM_COMPRA']);

export function selectCrmCustomers(customers: LoyaltyCustomer[], search: string, segment: CustomerSegment, sort: CustomerSort) {
  const term = search.trim().toLocaleLowerCase('pt-BR');
  const digits = term.replace(/\D/g, '');
  return customers.filter(customer => {
    const matchesSearch = !term || `${customer.cliente} ${customer.telefone}`.toLocaleLowerCase('pt-BR').includes(term)
      || (digits.length > 0 && /^[\d\s()+-]+$/.test(term) && customer.telefone.replace(/\D/g, '').includes(digits));
    const matchesSegment = segment === 'ALL' || (segment === 'REPEAT'
      ? (customer.pedidos_concluidos ?? 0) >= 2
      : (customer.segmento_relacionamento || 'SEM_COMPRA') === segment);
    return matchesSearch && matchesSegment;
  }).sort((a, b) => {
    let difference = 0;
    if (sort === 'orders') difference = (b.pedidos_concluidos ?? 0) - (a.pedidos_concluidos ?? 0) || (b.valor_pago_total ?? 0) - (a.valor_pago_total ?? 0);
    if (sort === 'spent') difference = (b.valor_pago_total ?? 0) - (a.valor_pago_total ?? 0);
    if (sort === 'recent') difference = (a.dias_sem_comprar ?? Infinity) - (b.dias_sem_comprar ?? Infinity);
    if (sort === 'absent') difference = (b.dias_sem_comprar ?? -1) - (a.dias_sem_comprar ?? -1);
    return (Number.isNaN(difference) ? 0 : difference) || a.cliente.localeCompare(b.cliente, 'pt-BR') || a.id.localeCompare(b.id);
  });
}
