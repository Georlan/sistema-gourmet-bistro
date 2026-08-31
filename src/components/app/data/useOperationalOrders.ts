import React, { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../../config/api';
import { readCheckLaunchIdentities } from '../../../domain/orderIdentity';
import { Order, Product } from '../../../types';
import { parseBackendTimestamp } from '../../../utils/dateTime';

const parseBackendDateTime = (dateStr: any): number => {
  return parseBackendTimestamp(dateStr)?.getTime() ?? Date.now();
};
import type { OperationalRequestContext, OperationalErrorSink } from '../operationalContracts';
type BoundaryProps = OperationalRequestContext & OperationalErrorSink & { liveProdutos: Product[] };

/** Owns the shared order snapshot, response mapping, targeted refresh and optimistic overlays. */
export function useOperationalOrders({
  liveProdutos,
  getAuthHeaders,
  handleLogout,
  setFetchError,
}: BoundaryProps) {
  const fetchOrdersAbortControllerRef = useRef<AbortController | null>(null);

  const targetedOrderRequestRef = useRef<Record<string, number>>({});

  const optimisticItemStatusRef = useRef<
    Record<string, { status: 'preparando' | 'pronto' | 'entregue'; ts: number }>
  >({});

  const [isOrdersLoaded, setIsOrdersLoaded] = useState(false);

  const [orders, setOrders] = useState<Order[]>([]);

  const ordersRef = useRef<Order[]>(orders);

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const mapBackendComandaToOrder = (comanda: any, now = Date.now()): Order => ({
    launchIdentities: readCheckLaunchIdentities(comanda),
    id: comanda.id,
    numeroPedido: Number.isFinite(Number(comanda.numero_pedido)) ? Number(comanda.numero_pedido) : undefined,
    origemOperacional: (() => {
      const origins = (Array.isArray(comanda.lancamentos) ? comanda.lancamentos : []).map((launch: any) =>
        String(launch?.origem || '').toLowerCase(),
      );
      if (origins.includes('smartpos')) return 'smartpos';
      if (origins.includes('cardapio')) return 'cardapio';
      if (origins.includes('caixa')) return 'caixa';
      if (origins.includes('garcom')) return 'garcom';
      return 'desconhecida';
    })(),
    clienteId: comanda.cliente_id || comanda.cliente?.id || null,
    clientePhone: comanda.cliente?.telefone || comanda.delivery_telefone || comanda.telefone || null,
    mesaId: comanda.mesa_id || 0,
    garcomId: comanda.garcom_id,
    garcomNome: comanda.criada_por?.nome || comanda.garcom?.nome || 'Garçom',
    timestamp: parseBackendDateTime(comanda.criado_em),
    tipo: comanda.tipo,
    valorPago: comanda.valor_pago || 0,
    identificador: comanda.identificador || null,
    statusComanda: comanda.status_comanda || null,
    deliveryStatus: comanda.delivery_status || null,
    mesaOrigemId: comanda.mesa_origem_id || null,
    mesaTransferidaDe: comanda.mesa_transferida_de || null,
    itens: (comanda.itens || [])
      .filter((item: any) => item.status !== 'cancelado')
      .map((item: any) => {
        const opt = optimisticItemStatusRef.current[item.id];
        let effectiveStatus = item.status;
        if (opt && now - opt.ts < 8000) {
          if (opt.status === item.status) {
            delete optimisticItemStatusRef.current[item.id];
          } else {
            effectiveStatus = opt.status;
          }
        }
        return {
          id: item.id,
          produtoId: item.produto_id,
          nome:
            item.produto?.nome ||
            liveProdutos.find((p) => p.id === item.produto_id)?.nome ||
            `Item #${item.produto_id}`,
          preco: item.preco_unit,
          observacao: item.observacao || '',
          clienteNome: item.cliente_nome || 'Consumo Geral',
          status: effectiveStatus,
          lancamentoId: item.lancamento_id,
        };
      }),
  });

  const fetchOrdersFromAPI = async () => {
    if (fetchOrdersAbortControllerRef.current) {
      fetchOrdersAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
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
      setIsOrdersLoaded(true);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Connection error to backend:', err);
        setFetchError(`Erro de conexão comandas: ${err.message || String(err)}`);
      }
    }
  };

  const fetchOrderByIdFromAPI = async (comandaId: string) => {
    const normalizedId = String(comandaId || '').trim();
    if (!normalizedId) {
      fetchOrdersFromAPI();
      return;
    }

    const requestVersion = (targetedOrderRequestRef.current[normalizedId] || 0) + 1;
    targetedOrderRequestRef.current[normalizedId] = requestVersion;

    try {
      const response = await fetch(`${API_BASE_URL}/comandas/${encodeURIComponent(normalizedId)}`, {
        headers: getAuthHeaders(),
        cache: 'no-store',
      });
      if (response.status === 401) {
        handleLogout();
        return;
      }
      if (response.status === 404) {
        if (targetedOrderRequestRef.current[normalizedId] === requestVersion) {
          setOrders((prevOrders) => prevOrders.filter((order) => String(order.id) !== normalizedId));
        }
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const mappedOrder = mapBackendComandaToOrder(await response.json());
      if (targetedOrderRequestRef.current[normalizedId] !== requestVersion) return;

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
      setIsOrdersLoaded(true);
      setFetchError(null);
    } catch (err) {
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
      optimisticItemStatusRef.current[id] = { status: newStatus, ts: now };
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
