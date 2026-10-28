import { useMemo } from 'react';
import type { CaixaPanelProps } from '../cashierContracts';

type Props = Pick<
  CaixaPanelProps,
  | 'liveProdutos'
  | 'liveCategorias'
  | 'onRefreshCategorias'
  | 'cardapio_ativo_id'
  | 'cardapios_ativos_ids'
  | 'cardapio_ativo_nome'
  | 'cardapios'
>;

/** Cashier selectors over the operational catalog; no second snapshot or HTTP owner. */
export function useCashierCatalog({
  liveProdutos = [],
  liveCategorias = [],
  onRefreshCategorias,
  cardapio_ativo_id,
  cardapios_ativos_ids,
  cardapio_ativo_nome,
  cardapios,
}: Props) {
  const apiProdutos = liveProdutos;
  const suggestedProductCode = useMemo(() => {
    const numericCodes = apiProdutos
      .map((product) => String(product.id || '').trim())
      .filter((code) => /^\d+$/.test(code));
    const nextNumber = numericCodes.reduce((largest, code) => Math.max(largest, Number(code)), 0) + 1;
    const width = Math.max(3, ...numericCodes.map((code) => code.length));
    return String(nextNumber).padStart(width, '0');
  }, [apiProdutos]);

  return {
    apiProdutos,
    apiCategorias: liveCategorias,
    dynamicMenu: liveProdutos,
    cardapio_ativo_id,
    cardapios_ativos_ids,
    cardapio_ativo_nome,
    cardapios,
    suggestedProductCode,
    fetchProdutos: onRefreshCategorias,
    fetchCategorias: onRefreshCategorias,
  };
}
