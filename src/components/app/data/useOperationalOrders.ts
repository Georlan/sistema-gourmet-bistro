import React, { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../../config/api';
import { Order, Product } from '../../../types';
import type { OperationalRequestContext, OperationalErrorSink } from '../operationalContracts';
import {
  mapBackendComandaToOperationalOrder,
  preserveOptimisticOrderIdentity,
} from './operationalOrderMapping';

type BoundaryProps = OperationalRequestContext & OperationalErrorSink & {
  liveProdutos: Product[];
  scopeKey: string;
};

type OptimisticItemStatus = {
  status: 'preparando' | 'pronto' | 'entregue';
  ts: number;
};

type OptimisticOrderReconcileDetail = {
  tempId?: string;
  comanda?: unknown;
};

type OptimisticOrderRemoveDetail = {
  orderId?: string;
};

/** Owns the shared order snapshot, response mapping, targeted refresh and optimistic overlays. */
export function useOperationalOrders({
  liveProdutos,
  getAuthHeaders,
  handleLogout,
  setFetchError,
  scopeKey,
}: BoundaryProps) {
  const fetchOrdersAbortControllerRef = useRef<AbortController | null>(null);

  // Protocol IDs are data, never property names on a prototype-bearing object.
  const targetedOrderRequestRef = useRef(new Map<string, number>());

  const optimisticItemStatusRef = useRef<Map<string, OptimisticItemStatus>>(new Map());

  const [loadedScopeKey, setLoadedScopeKey] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const ordersRef = useRef<Order[]>(orders);
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  useEffect(() => {
    fetchOrdersAbortControllerRef.current?.abort();
    fetchOrdersAbortControllerRef.current = null;
    targetedOrderRequestRef.current.clear();
    optimisticItemStatusRef.current.clear();
    setOrders([]);
    setLoadedScopeKey('');
  }, [scopeKey]);

  useEffect(() => {
    const removeOptimisticOrder = (rawOrderId: unknown) => {
      const orderId = String(rawOrderId || '').trim();
      if (!orderId.startsWith('temp-')) return;
      setOrders((current) => current.filter((order) => String(order.id) !== orderId));
    };

    const handleOptimisticRemove = (event: Event) => {
      const detail = (event as CustomEvent<OptimisticOrderRemoveDetail>).detail;
      removeOptimisticOrder(detail?.orderId);
    };

    const handleOptimisticReconcile = (event: Event) => {
      const detail = (event as CustomEvent<OptimisticOrderReconcileDetail>).detail;
      const tempId = String(detail?.tempId || '').trim();
      const comanda = detail?.comanda as any;
      if (!tempId.startsWith('temp-') || !comanda?.id) return;

      const mappedOrder = mapBackendComandaToOperationalOrder({ comanda, liveProdutos });
      setOrders((current) => {
        const optimisticOrder = current.find((order) => String(order.id) === tempId);
        const reconciledOrder = preserveOptimisticOrderIdentity(optimisticOrder, mappedOrder);
        return [
          reconciledOrder,
          ...current.filter(
            (order) => String(order.id) !== tempId && String(order.id) !== String(mappedOrder.id),
          ),
        ];
      });
      setFetchError(null);
    };

    window.addEventListener('koma_optimistic_order_remove', handleOptimisticRemove);
    window.addEventListener('koma_optimistic_order_reconcile', handleOptimisticReconcile);
    return () => {
      window.removeEventListener('koma_optimistic_order_remove', handleOptimisticRemove);
      window.removeEventListener('koma_optimistic_order_reconcile', handleOptimisticReconcile);
    };
  }, [liveProdutos, setFetchError]);

  const mapBackendComandaToOrder = (comanda: any, now = Date.now()): Order => {
    const mapped = mapBackendComandaToOperationalOrder({ comanda, liveProdutos });
    return {
      ...mapped,
      itens: mapped.itens.map((item) => {
        const opt = optimisticItemStatusRef.current.get(String(item.id));
        if (!opt || now - opt.ts >= 8000) return item;
        if (opt.status === item.status) {
          optimisticItemStatusRef.current.delete(String(item.id));
          return item;
        }
        return { ...item, status: opt.status };
      }),
    };
  };

  const fetchOrdersFromAPI = async () => {
    if (!scopeKey) return;
    if (fetchOrdersAbortControllerRef.current) {
      fetchOrdersAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    const requestScopeKey = scopeKey;
    fetchOrdersAbortControllerRef.current = controller;

    try {
      const response = await fetch(`${API_BASE_URL}/comandas/detalhes/todos?fechada=false`, {
        headers: getAuthHeaders(),
        signal: controller.signal,
      });
      if (response.status === 401) {
        handleLogout();
        return;
      }
      if (!response.ok) {
        console.error('Failed to fetch comandas from backend');
        setFetchError(`Erro HTTP comandas ${response.status}: ${response.statusText}`);
        return;
      }
      const comandas = await response.json();
      if (requestScopeKey !== scopeKeyRef.current) return;
      const now = Date.now();

      const mappedOrders = comandas.map((comanda: any) => mapBackendComandaToOrder(comanda, now));

      setOrders((prevOrders) => {
        const tempOrders = prevOrders.filter(
          (p) =>
            String(p.id).startsWith('temp-') &&
            !mappedOrders.some((m) => m.mesaId > 0 && m.mesaId === p.mesaId),
        );
        return [...mappedOrders, ...tempOrders];
      });
      setLoadedScopeKey(requestScopeKey);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Connection error to backend:', err);
        setFetchError(`Erro de conexão comandas: ${err.message || String(err)}`);
      }
    } finally {
      if (fetchOrdersAbortControllerRef.current === controller) {
        fetchOrdersAbortControllerRef.current = null;
      }
    }
  };

  const fetchOrderByIdFromAPI = async (comandaId: string) => {
    const normalizedId = String(comandaId || '').trim();
    if (!normalizedId) {
      fetchOrdersFromAPI();
      return;
    }
    if (!scopeKey) return;

    const requestScopeKey = scopeKey;
    const requestVersion = (targetedOrderRequestRef.current.get(normalizedId) || 0) + 1;
    targetedOrderRequestRef.current.set(normalizedId, requestVersion);

    try {
      const response = await fetch(`${API_BASE_URL}/comandas/${encodeURIComponent(normalizedId)}`, {
        headers: getAuthHeaders(),
        cache: 'no-store',
      });
      if (response.status === 401) {
        handleLogout();
        return;
      }
      if (requestScopeKey !== scopeKeyRef.current) return;
      if (response.status === 404) {
        if (targetedOrderRequestRef.current.get(normalizedId) === requestVersion) {
          setOrders((prevOrders) => prevOrders.filter((order) => String(order.id) !== normalizedId));
        }
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const mappedOrder = mapBackendComandaToOrder(await response.json());
      if (
        requestScopeKey !== scopeKeyRef.current ||
        targetedOrderRequestRef.current.get(normalizedId) !== requestVersion
      ) return;

      setOrders((prevOrders) => {
        const nextOrders = prevOrders.filter(
          (order) =>
            String(order.id) !== String(mappedOrder.id) &&
            !(
              String(order.id).startsWith('temp-') &&
              mappedOrder.mesaId > 0 &&
              order.mesaId === mappedOrder.mesaId
            ),
        );
        return [...nextOrders, mappedOrder].sort((a, b) => a.timestamp - b.timestamp);
      });
      // A targeted fetch proves only one check. It must never mark the full operational
      // snapshot as ready; readiness is established exclusively by fetchOrdersFromAPI.
      setFetchError(null);
    } catch (err) {
      if (requestScopeKey !== scopeKeyRef.current) return;
      console.warn('Falha no refresh direcionado da comanda; reconciliando snapshot completo.', err);
      fetchOrdersFromAPI();
    }
  };

  const handleOptimisticUpdateItemStatus = (
    itemId: string | string[],
    newStatus: 'preparando' | 'pronto' | 'entregue',
  ) => {
    const itemIds = Array.isArray(itemId) ? itemId : [itemId];
    const now = Date.now();
    itemIds.forEach((id) => {
      optimisticItemStatusRef.current.set(String(id), { status: newStatus, ts: now });
    });
    setOrders((prevOrders) =>
      prevOrders.map((order) => ({
        ...order,
        itens: order.itens.map((item) => (itemIds.includes(item.id) ? { ...item, status: newStatus } : item)),
      })),
    );
  };

  const handleOptimisticAddOrder = (newOrder: Order) => {
    setOrders((prev) => [newOrder, ...prev]);
  };

  const handleTransferTableOptimistic = (sourceTableId: number, targetTableId: number) => {
    setOrders((prev) => prev.map((o) => (o.mesaId === sourceTableId ? { ...o, mesaId: targetTableId } : o)));
  };

  const isOrdersLoaded = Boolean(scopeKey) && loadedScopeKey === scopeKey;
  return {
    orders,
    setOrders,
    ordersRef,
    isOrdersLoaded,
    fetchOrdersFromAPI,
    fetchOrderByIdFromAPI,
    handleOptimisticUpdateItemStatus,
    handleOptimisticAddOrder,
    handleTransferTableOptimistic,
  };
}
