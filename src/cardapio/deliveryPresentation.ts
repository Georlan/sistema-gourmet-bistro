import type { BrandConfig } from './CardapioTypes';

export function getDeliveryMinimumRemaining(
  config: Pick<BrandConfig, 'pedidoMinimo'> | undefined,
  subtotal: number,
  fulfillment: 'delivery' | 'pickup',
): number {
  if (fulfillment !== 'delivery') return 0;
  return Math.max(0, Number(config?.pedidoMinimo || 0) - subtotal);
}

type DeliveryConfig = Pick<BrandConfig, 'freteGratisValor' | 'tabelaTaxasBairros' | 'taxaEntregaPadrao'>;

/** Existing cart fee rules, also used to preview delivery while pickup is selected. */
export function getDeliveryQuote(config: DeliveryConfig | undefined, subtotal: number, bairro: string) {
  const threshold = config?.freteGratisValor || 0;
  const freeBySubtotal = threshold > 0 && subtotal >= threshold;
  const neighborhoods = config?.tabelaTaxasBairros ?? [];
  const selected = bairro
    ? neighborhoods.find((row) => row.bairro.toLowerCase() === bairro.toLowerCase())
    : undefined;

  return {
    fee: freeBySubtotal ? 0 : selected?.taxa ?? config?.taxaEntregaPadrao ?? 0,
    // The default fee remains in the calculation; only its provisional nature is clarified.
    awaitingNeighborhood: neighborhoods.length > 0 && !selected && !freeBySubtotal,
  };
}
