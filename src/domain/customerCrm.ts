import type { LoyaltyCustomer } from '../components/caixa/cashierContracts';

export type CustomerSort = 'orders' | 'spent' | 'recent' | 'absent' | 'name';
export type CustomerSegment = 'ALL' | 'SECOND' | 'BALANCE' | 'CADENCE' | 'ATIVO' | 'REPEAT' | 'ATENCAO' | 'REATIVAR' | 'SEM_COMPRA';
export const customerSegmentLabel = (customer: LoyaltyCustomer) => ({
  ATIVO: 'Ativo', ATENCAO: 'Atenção', REATIVAR: 'Reativar', SEM_COMPRA: 'Sem compra',
}[customer.segmento_relacionamento || 'SEM_COMPRA']);

export function selectCrmCustomers(customers: LoyaltyCustomer[], search: string, segment: CustomerSegment, sort: CustomerSort) {
  const term = search.trim().toLocaleLowerCase('pt-BR');
  const digits = term.replace(/\D/g, '');
  return customers.filter(customer => {
    const matchesSearch = !term || `${customer.cliente} ${customer.telefone}`.toLocaleLowerCase('pt-BR').includes(term)
      || (digits.length > 0 && /^[\d\s()+-]+$/.test(term) && customer.telefone.replace(/\D/g, '').includes(digits));
    const matchesSegment = matchesCustomerSegment(customer, segment);
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


export function matchesCustomerSegment(customer: LoyaltyCustomer, segment: CustomerSegment): boolean {
  const count = customer.pedidos_concluidos ?? 0;
  const days = customer.dias_sem_comprar;
  if (segment === 'ALL') return true;
  if (segment === 'REPEAT') return count >= 2;
  if (segment === 'SECOND') return count === 1 && days != null && days >= 6 && days <= 30;
  if (segment === 'BALANCE') return count > 0 && days != null && days > 30 && (customer.pontos > 0 || customer.saldoCashback > 0);
  const interval = customer.intervalo_medio_dias ?? 0;
  if (segment === 'CADENCE') return count >= 3 && days != null && interval >= 1 && days > Math.max(7, interval * 1.5);
  return (customer.segmento_relacionamento || 'SEM_COMPRA') === segment;
}

export const customerOpportunityRules = [
  { segment: 'SECOND', label: 'Incentivar a 2ª compra', explanation: 'Uma compra concluída e de 6 a 30 dias sem voltar.' },
  { segment: 'BALANCE', label: 'Benefício parado', explanation: 'Já comprou, tem pontos ou cashback e não volta há mais de 30 dias. Confira a regra do programa antes de oferecer resgate.' },
  { segment: 'CADENCE', label: 'Fora do ritmo habitual', explanation: 'Ao menos 3 compras, intervalo médio de 1 dia ou mais e ausência acima de 1,5 vez esse intervalo (mínimo de 7 dias). Indício para revisar, não previsão.' },
] as const;
