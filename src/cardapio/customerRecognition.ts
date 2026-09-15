import { normalizeBrazilianPhone } from './customerSession';

export type CustomerRecognitionStatus = 'idle' | 'checking' | 'found' | 'new';

export const isCompleteBrazilianPhone = (phone: string): boolean => {
  const normalized = normalizeBrazilianPhone(phone);
  return normalized.length === 10 || normalized.length === 11;
};

export async function recognizePublicCustomer(
  restaurantId: string | number,
  phone: string,
  apiBaseUrl: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const normalized = normalizeBrazilianPhone(phone);
  if (normalized.length !== 10 && normalized.length !== 11) return false;

  const response = await fetch(`${apiBaseUrl}/cardapio/clientes/reconhecer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      restaurante_id: Number(restaurantId),
      telefone: normalized,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Falha ao reconhecer cliente (${response.status}).`);
  }

  const payload = await response.json() as { found?: boolean };
  return payload.found === true;
}
