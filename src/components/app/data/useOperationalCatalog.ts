import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeCatalogSnapshot, type CatalogCategory } from '../../../catalog/catalog';
import { API_BASE_URL } from '../../../config/api';
import { Product } from '../../../types';

import type { OperationalRequestContext } from '../operationalContracts';
type BoundaryProps = Pick<OperationalRequestContext, 'handleLogout'> & {
  portal: 'garcom' | 'caixa';
  isAuthenticated: boolean;
  isWsConnected: boolean;
};

/** Owns the atomic live catalog and connectivity fallback shared by operational roles. */
export function useOperationalCatalog({
  portal,
  handleLogout,
  isAuthenticated,
  isWsConnected,
}: BoundaryProps) {
  const [isProductsLoaded, setIsProductsLoaded] = useState(false);

  const [liveProdutos, setLiveProdutos] = useState<Product[]>([]);

  const [liveCategorias, setLiveCategorias] = useState<CatalogCategory[]>([]);

  const catalogRequestRef = useRef(0);

  const fetchLiveCatalog = useCallback(async () => {
    const requestId = ++catalogRequestRef.current;
    try {
      const tokenKey = portal === 'caixa' ? 'koma_caixa_token' : 'koma_waiter_token';
      const token = localStorage.getItem(tokenKey);
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      let payload: unknown;
      const catalogResponse = await fetch(`${API_BASE_URL}/produtos/catalogo`, {
        headers,
        cache: 'no-store',
      });

      if (catalogResponse.status === 401) {
        handleLogout();
        return;
      }

      if (catalogResponse.ok) {
        payload = await catalogResponse.json();
      } else if (catalogResponse.status === 404 || catalogResponse.status === 405) {
        // Compatibilidade durante deploy gradual: o endpoint atômico pode
        // chegar alguns segundos depois do frontend novo.
        const [productsResponse, categoriesResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/produtos/`, { headers, cache: 'no-store' }),
          fetch(`${API_BASE_URL}/produtos/categorias`, { headers, cache: 'no-store' }),
        ]);
        if (productsResponse.status === 401 || categoriesResponse.status === 401) {
          handleLogout();
          return;
        }
        if (!productsResponse.ok || !categoriesResponse.ok) {
          throw new Error(`CATALOG_HTTP_${productsResponse.status}_${categoriesResponse.status}`);
        }
        payload = {
          produtos: await productsResponse.json(),
          categorias: await categoriesResponse.json(),
        };
      } else {
        throw new Error(`CATALOG_HTTP_${catalogResponse.status}`);
      }

      if (requestId !== catalogRequestRef.current) return;
      const catalog = normalizeCatalogSnapshot(payload);
      setLiveProdutos(catalog.produtos);
      setLiveCategorias(catalog.categorias);
      setIsProductsLoaded(true);
    } catch (err) {
      if (requestId === catalogRequestRef.current) {
        console.error('Error fetching live catalog', err);
      }
    }
  }, [portal]);

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchLiveCatalog();
    if (isWsConnected) return;
    const interval = setInterval(() => {
      fetchLiveCatalog();
    }, 40000); // refresh every 40s if not connected to WS
    return () => clearInterval(interval);
  }, [isAuthenticated, isWsConnected, fetchLiveCatalog]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      fetchLiveCatalog();
      window.dispatchEvent(new Event('koma_orders_updated'));
      window.dispatchEvent(new Event('koma_customers_updated'));
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchLiveCatalog]);
  return { isProductsLoaded, liveProdutos, liveCategorias, fetchLiveCatalog, isOnline };
}
