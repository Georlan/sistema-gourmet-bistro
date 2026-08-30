export const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value) || 0);

export const formatCompactCurrency = (value: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
}).format(Number(value) || 0);

export function operationalOriginLabel(origin?: string): string {
  if (origin === 'smartpos') return 'SmartPOS';
  if (origin === 'cardapio') return 'Cardápio online';
  if (origin === 'caixa') return 'Caixa';
  if (origin === 'garcom') return 'Garçom';
  return 'Kôma';
}

