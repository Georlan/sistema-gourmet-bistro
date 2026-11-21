import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeCatalogSnapshot, type CatalogSnapshot } from '../../../catalog/catalog';
import { fetchOperationalCatalog } from '../../../catalog/operationalCatalogClient';
import { API_BASE_URL } from '../../../config/api';
import { getOperationalAccessToken } from '../../../utils/authSession';

import type { OperationalRequestContext } from '../operationalContracts';
const EMPTY_CATALOG: CatalogSnapshot = { produtos: [], categorias: [] };
export const CATALOG_REFRESH_COALESCE_WINDOW_MS = 500;

export const createCatalogRefreshCoalescer = (
  windowMs = CATALOG_REFRESH_COALESCE_WINDOW_MS,
  now: () => number = () => Date.now(),
) => {
  let activeScope: string | null = null;
  let inFlight: Promise<void> | null = null;
  let pendingFollowUpTask: (() => Promise<boolean>) | null = null;
  let lastCompletedAt = 0;

  const startExecution = (scope: string, task: () => Promise<boolean>): Promise<void> => {
    const execution = (async () => {
      const succeeded = await task();
      if (succeeded && activeScope === scope) {
        lastCompletedAt = now();
      }
    })().finally(() => {
      if (inFlight === execution) {
        inFlight = null;
      }
      const nextTask = pendingFollowUpTask;
      pendingFollowUpTask = null;
      if (nextTask && activeScope === scope) {
        void startExecution(scope, nextTask);
      }
    });

    inFlight = execution;
    return execution;
  };

  return {
    run(
      scope: string,
      task: () => Promise<boolean>,
      options?: { coalesceOnly?: boolean },
    ): Promise<void> {
      const coalesceOnly = options?.coalesceOnly === true;
      if (activeScope !== scope) {
        activeScope = scope;
        inFlight = null;
        pendingFollowUpTask = null;
        lastCompletedAt = 0;
      }

      if (inFlight) {
        if (!coalesceOnly) {
          pendingFollowUpTask = task;
        }
        return inFlight;
      }

      if (coalesceOnly && lastCompletedAt > 0 && now() - lastCompletedAt < windowMs) {
        return Promise.resolve();
      }

      return startExecution(scope, task);
    },
    reset() {
      activeScope = null;
      inFlight = null;
      pendingFollowUpTask = null;
      lastCompletedAt = 0;
    },
  };
};

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
  const catalogCoalescerRef = useRef(createCatalogRefreshCoalescer());

  const fetchLiveCatalog = useCallback(async (options?: { coalesce?: boolean }) => {
    if (!scope || !token) return;
    await catalogCoalescerRef.current.run(scope, async () => {
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

        if (!isCurrent()) return false;
        if (result.status === 401) {
          handleLogout();
          return false;
        }
        if (!result.ok) {
          throw new Error(`CATALOG_HTTP_${result.status}`);
        }

        setSnapshot({ scope, data: normalizeCatalogSnapshot(result.payload) });
        return true;
      } catch (err) {
        if (isCurrent()) {
          console.error('Error fetching live catalog', err);
        }
        return false;
      }
    }, { coalesceOnly: options?.coalesce === true });
  }, [scope, token, portal, handleLogout]);

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchLiveCatalog();
    const cancel = () => {
      ++catalogRequestRef.current;
      catalogAbortRef.current?.abort();
      catalogCoalescerRef.current.reset();
    };
    return cancel;
  }, [isAuthenticated, fetchLiveCatalog]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (isWsConnected) return;

    const refreshIfVisible = () => {
      if (document.hidden) return;
      fetchLiveCatalog({ coalesce: true });
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) fetchLiveCatalog({ coalesce: true });
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
      fetchLiveCatalog({ coalesce: true });
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
