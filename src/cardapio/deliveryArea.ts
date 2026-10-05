import type { DeliveryAddressSnapshot } from '../domain/deliveryAddress';

export interface DeliveryAreaPolicy {
  enabled: boolean;
  city?: string;
  state?: string;
  neighborhoods?: string[];
}

const OUTSIDE_MESSAGE = 'Este endereço fica fora da área de entrega deste restaurante. Altere o endereço ou escolha Retirada.';
const INCOMPLETE_MESSAGE = 'Confirme o endereço completo para validar a área de entrega.';

function key(value: unknown): string {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ');
}

export function deliveryAreaError(
  policy: DeliveryAreaPolicy | null | undefined,
  address: DeliveryAddressSnapshot | null | undefined,
): string | null {
  if (!policy?.enabled) return null;
  if (!address) return INCOMPLETE_MESSAGE;

  if (key(address.cidade) !== key(policy.city) || String(address.uf || '').trim().toUpperCase() !== String(policy.state || '').trim().toUpperCase()) {
    return OUTSIDE_MESSAGE;
  }

  const neighborhoods = (policy.neighborhoods || []).map(key).filter(Boolean);
  if (neighborhoods.length > 0 && !neighborhoods.includes(key(address.bairro))) {
    return OUTSIDE_MESSAGE;
  }
  return null;
}
