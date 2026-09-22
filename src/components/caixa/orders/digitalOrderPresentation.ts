import type { DeliveryOrderView } from './cashierWorkspaceTypes';

export type DigitalOrderVisualKind = 'online' | 'waiter' | 'cashier' | 'smartpos' | 'unknown';

export function getDigitalOrderVisualKind(order: Pick<DeliveryOrderView, 'origemOperacional'>): DigitalOrderVisualKind {
  if (order.origemOperacional === 'cardapio') return 'online';
  if (order.origemOperacional === 'garcom') return 'waiter';
  if (order.origemOperacional === 'caixa') return 'cashier';
  if (order.origemOperacional === 'smartpos') return 'smartpos';
  return 'unknown';
}

export function getDigitalOrderSourceLabel(order: Pick<DeliveryOrderView, 'origemOperacional'>): string {
  const kind = getDigitalOrderVisualKind(order);
  if (kind === 'online') return 'Online';
  if (kind === 'waiter') return 'Garçom';
  if (kind === 'cashier') return 'Caixa';
  if (kind === 'smartpos') return 'SmartPOS';
  return 'Kôma';
}

export function getDigitalOrderFulfillmentLabel(
  order: Pick<DeliveryOrderView, 'modalidade'>,
): string {
  if (order.modalidade === 'delivery') return 'Delivery';
  if (order.modalidade === 'dine_in') return 'Consumo no local';
  return 'Retirada';
}

export function getDigitalOrderAssociation(
  order: Pick<DeliveryOrderView, 'modalidade' | 'mesaId' | 'garcomNome'>,
): string | null {
  const mesaId = Number(order.mesaId || 0);
  if (!['retirada', 'dine_in'].includes(order.modalidade) || mesaId <= 0) return null;
  const waiter = String(order.garcomNome || '').trim();
  return `Mesa ${String(mesaId).padStart(2, '0')}${waiter ? ` · ${waiter}` : ''}`;
}

export function getDigitalOrderTableBlockLabel(
  order: Pick<DeliveryOrderView, 'modalidade' | 'mesaId'>,
): string | null {
  const mesaId = Number(order.mesaId || 0);
  if (!['retirada', 'dine_in'].includes(order.modalidade) || mesaId <= 0) return null;
  return `M${mesaId}`;
}

export function getTableAssociationOptionLabel(table: {
  id: number;
  nome?: string;
  isOccupied?: boolean;
}): string {
  const id = Number(table.id);
  const configuredName = String(table.nome || '').trim();
  const normalizedName = configuredName.toLocaleLowerCase('pt-BR');
  const defaultNames = new Set([
    `mesa ${id}`,
    `mesa ${String(id).padStart(2, '0')}`,
  ]);
  const customName = configuredName && !defaultNames.has(normalizedName)
    ? ` · ${configuredName}`
    : '';
  return `${table.isOccupied ? '●' : '○'} Mesa ${id}${customName}${table.isOccupied ? ' · EM ATENDIMENTO' : ' · livre'}`;
}

export function getDigitalOrderCustomerLabel(
  order: Pick<DeliveryOrderView, 'cliente' | 'modalidade' | 'mesaId' | 'origemOperacional'>,
): string {
  const customer = String(order.cliente || '').trim();
  const isGeneric = !customer || customer.toLocaleLowerCase('pt-BR') === 'cliente sem nome';
  const mesaId = Number(order.mesaId || 0);
  if (isGeneric && order.modalidade === 'retirada' && order.origemOperacional === 'garcom' && mesaId > 0) {
    return `Retirada · Mesa ${String(mesaId).padStart(2, '0')}`;
  }
  if (customer) return customer;
  if (order.modalidade === 'delivery') return 'Entrega sem nome';
  if (order.modalidade === 'dine_in') return mesaId > 0
    ? `Consumo local · Mesa ${String(mesaId).padStart(2, '0')}`
    : 'Consumo local sem nome';
  return 'Retirada sem nome';
}


const digitalMoney = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

export function getDigitalOrderPaymentMethodLabel(raw: string | null | undefined): string | null {
  const value = String(raw || '').trim().toLocaleLowerCase('pt-BR');
  if (!value) return null;
  if (value === 'pix') return 'Pix';
  if (value === 'dinheiro') return 'Dinheiro';
  if (value === 'cartao' || value === 'cartão') return 'Cartão';
  if (value === 'cartao_debito' || value === 'cartão de débito') return 'Cartão de débito';
  if (value === 'cartao_credito' || value === 'cartão de crédito') return 'Cartão de crédito';
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toLocaleUpperCase('pt-BR'));
}

export function getDigitalOrderPaymentSummary(
  order: Pick<DeliveryOrderView, 'pago' | 'amountDue' | 'paymentMethod' | 'changeFor'>,
): string {
  const method = getDigitalOrderPaymentMethodLabel(order.paymentMethod);
  const due = Math.max(0, Number(order.amountDue) || 0);
  if (order.pago || due <= 0.009) {
    return method ? `Pago · ${method}` : 'Pago';
  }

  const parts = [`A cobrar ${digitalMoney(due)}`];
  if (method) parts.push(method);
  if (Number(order.changeFor || 0) > 0) parts.push(`Troco para ${digitalMoney(Number(order.changeFor))}`);
  return parts.join(' · ');
}
