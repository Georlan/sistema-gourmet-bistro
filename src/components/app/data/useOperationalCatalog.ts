import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeCatalogSnapshot, type CatalogSnapshot } from '../../../catalog/catalog';
import { API_BASE_URL } from '../../../config/api';

import type { OperationalRequestContext } from '../operationalContracts';
const EMPTY_CATALOG: CatalogSnapshot = { produtos: [], categorias: [] };
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
  const tokenKey = portal === 'caixa' ? 'koma_caixa_token' : 'koma_waiter_token';
  const token = isAuthenticated ? localStorage.getItem(tokenKey) : null;
  const scope = token ? `${portal}:${token}` : null;
  const [snapshot, setSnapshot] = useState<{ scope: string; data: CatalogSnapshot } | null>(null);
  const catalogAbortRef = useRef<AbortController | null>(null);

  const catalogRequestRef = useRef(0);

  const fetchLiveCatalog = useCallback(async () => {
    if (!scope || !token) return;
    const requestId = ++catalogRequestRef.current;
    catalogAbortRef.current?.abort();
    const controller = new AbortController();
    catalogAbortRef.current = controller;
    const isCurrent = () => !controller.signal.aborted
      && requestId === catalogRequestRef.current && localStorage.getItem(tokenKey) === token;
    try {
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      let payload: unknown;
      const catalogResponse = await fetch(`${API_BASE_URL}/produtos/catalogo`, {
        headers,
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!isCurrent()) return;
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
          fetch(`${API_BASE_URL}/produtos/`, { headers, cache: 'no-store', signal: controller.signal }),
          fetch(`${API_BASE_URL}/produtos/categorias`, { headers, cache: 'no-store', signal: controller.signal }),
        ]);
        if (!isCurrent()) return;
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

      if (!isCurrent()) return;
      setSnapshot({ scope, data: normalizeCatalogSnapshot(payload) });
    } catch (err) {
      if (isCurrent()) {
        console.error('Error fetching live catalog', err);
      }
    }
  }, [scope, token, tokenKey, handleLogout]);

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchLiveCatalog();
    const cancel = () => {
      ++catalogRequestRef.current;
      catalogAbortRef.current?.abort();
    };
    return cancel;
  }, [isAuthenticated, fetchLiveCatalog]);

  useEffect(() => {
    if (!isAuthenticated) return;
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
  const catalog = snapshot?.scope === scope ? snapshot.data : null;
  const data = catalog ?? EMPTY_CATALOG;
  return {
    isProductsLoaded: catalog !== null,
    liveProdutos: data.produtos,
    liveCategorias: data.categorias,
    fetchLiveCatalog, isOnline,
  };
}
