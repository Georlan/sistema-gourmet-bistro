import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeCatalogSnapshot, type CatalogSnapshot } from '../../../catalog/catalog';
import { fetchOperationalCatalog } from '../../../catalog/operationalCatalogClient';
import { API_BASE_URL } from '../../../config/api';
import { getOperationalAccessToken } from '../../../utils/authSession';

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
  const token = isAuthenticated ? getOperationalAccessToken(portal) : '';
  const scope = token ? `${portal}:${token}` : null;
  const [snapshot, setSnapshot] = useState<{ scope: string; data: CatalogSnapshot } | null>(null);
  const catalogAbortRef = useRef<AbortController | null>(null);

  const catalogRequestRef = useRef(0);
  const hasCoalescedInitialRef = useRef(false);

  const fetchLiveCatalog = useCallback(async () => {
    if (!scope || !token) return;
    const isInitialCoalesce = !hasCoalescedInitialRef.current;
    hasCoalescedInitialRef.current = true;
    const requestId = ++catalogRequestRef.current;
    catalogAbortRef.current?.abort();
    const controller = new AbortController();
    catalogAbortRef.current = controller;
    const isCurrent = () => !controller.signal.aborted
      && requestId === catalogRequestRef.current
      && getOperationalAccessToken(portal) === token;
    try {
      const result = await fetchOperationalCatalog({
        apiBaseUrl: API_BASE_URL,
        token,
        force: !isInitialCoalesce,
      });

      if (!isCurrent()) return;
      if (result.status === 401) {
        handleLogout();
        return;
      }
      if (!result.ok) {
        throw new Error(`CATALOG_HTTP_${result.status}`);
      }

      setSnapshot({ scope, data: normalizeCatalogSnapshot(result.payload) });
    } catch (err) {
      if (isCurrent()) {
        console.error('Error fetching live catalog', err);
      }
    }
  }, [scope, token, portal, handleLogout]);

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

    const refreshIfVisible = () => {
      if (document.hidden) return;
      fetchLiveCatalog();
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) fetchLiveCatalog();
    };

    const interval = setInterval(refreshIfVisible, 40000); // fallback only while the app is visible
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
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
    cardapio_ativo_id: data.cardapio_ativo_id,
    cardapios_ativos_ids: data.cardapios_ativos_ids,
    cardapio_ativo_nome: data.cardapio_ativo_nome,
    cardapios: data.cardapios,
    fetchLiveCatalog, isOnline,
  };
}
