import type { BrandConfig } from './CardapioTypes';

export function getDeliveryMinimumRemaining(
  config: Pick<BrandConfig, 'pedidoMinimo'> | undefined,
  subtotal: number,
  fulfillment: 'delivery' | 'pickup' | 'dine_in',
): number {
  if (fulfillment !== 'delivery') return 0;
  return Math.max(0, Number(config?.pedidoMinimo || 0) - subtotal);
}

type DeliveryConfig = Pick<
  BrandConfig,
  'freteGratisValor' | 'tipoTaxaEntrega' | 'tabelaTaxasBairros' | 'tabelaTaxasKm' | 'taxaEntregaPadrao'
>;

/** Regras de apresentação; o backend continua sendo a autoridade do valor final. */
export function getDeliveryQuote(config: DeliveryConfig | undefined, subtotal: number, bairro: string) {
  const threshold = Number(config?.freteGratisValor || 0);
  const freeBySubtotal = threshold > 0 && subtotal >= threshold;
  const mode = config?.tipoTaxaEntrega
    || ((config?.tabelaTaxasBairros?.length || 0) > 0 ? 'bairro' : 'fixa');

  if (mode === 'distancia') {
    const distanceConfig = config?.tabelaTaxasKm?.[0];
    const minimumFee = Number(distanceConfig?.taxa_minima ?? config?.taxaEntregaPadrao ?? 0);
    return {
      fee: freeBySubtotal ? 0 : minimumFee,
      awaitingNeighborhood: false,
      awaitingLocation: !freeBySubtotal,
    };
  }

  if (mode === 'bairro') {
    const neighborhoods = config?.tabelaTaxasBairros ?? [];
    const selected = bairro
      ? neighborhoods.find((row) => row.bairro.toLowerCase() === bairro.toLowerCase())
      : undefined;
    return {
      fee: freeBySubtotal ? 0 : selected?.taxa ?? config?.taxaEntregaPadrao ?? 0,
      awaitingNeighborhood: neighborhoods.length > 0 && !selected && !freeBySubtotal,
    };
  }

  return {
    fee: freeBySubtotal ? 0 : config?.taxaEntregaPadrao ?? 0,
    awaitingNeighborhood: false,
  };
}