import { useEffect, useMemo, useState } from 'react';
import { normalizeCatalogSnapshot } from '../../../catalog/catalog';
import { Product } from '../../../types';
import type { CaixaPanelProps } from '../cashierContracts';

type Props = {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  liveProdutos: CaixaPanelProps['liveProdutos'];
  liveCategorias: CaixaPanelProps['liveCategorias'];
};

export function useCashierCatalog({ apiBaseUrl, authHeaders, liveProdutos, liveCategorias }: Props) {
  const [apiCategorias, setApiCategorias] = useState<any[]>([]);

  const [dynamicMenu, setDynamicMenu] = useState<Product[]>(() => {
    if (liveProdutos && liveProdutos.length > 0) return liveProdutos;
    return [];
  });

  const [apiProdutos, setApiProdutos] = useState<Product[]>([]);

  const suggestedProductCode = useMemo(() => {
    const numericCodes = apiProdutos
      .map((product) => String(product.id || '').trim())
      .filter((code) => /^\d+$/.test(code));
    const nextNumber = numericCodes.reduce((largest, code) => Math.max(largest, Number(code)), 0) + 1;
    const width = Math.max(3, ...numericCodes.map((code) => code.length));
    return String(nextNumber).padStart(width, '0');
  }, [apiProdutos]);

  const fetchProdutos = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/produtos/catalogo`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      if (res.ok) {
        const catalog = normalizeCatalogSnapshot(await res.json());
        setApiProdutos(catalog.produtos);
        setDynamicMenu(catalog.produtos);
        setApiCategorias(catalog.categorias);
      }
    } catch (e) {
      console.error('Error fetching catalog snapshot', e);
    }
  };

  const fetchCategorias = async () => {
    await fetchProdutos();
  };

  useEffect(() => {
    if (liveProdutos) {
      setApiProdutos(liveProdutos);
      setDynamicMenu(liveProdutos);
    }
  }, [liveProdutos]);

  useEffect(() => {
    if (liveCategorias) {
      setApiCategorias(liveCategorias);
    }
  }, [liveCategorias]);

  return { apiProdutos, apiCategorias, dynamicMenu, suggestedProductCode, fetchProdutos, fetchCategorias };
}
