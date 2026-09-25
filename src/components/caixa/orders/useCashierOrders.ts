import React, { useEffect, useRef, useState } from 'react';
import { deriveProductionState } from '../../../domain/operationalState';
import { describeTableOrders } from '../../../domain/tableReadModel';
import type { Order } from '../../../types';
import type { CaixaPanelProps, CashierNotice } from '../cashierContracts';
import type { CashierTableCard, DeliveryOrderView } from '../orders/cashierWorkspaceTypes';
import {
  projectApiComandaToDeliveryView,
  projectDeliveryOrdersFromSharedSnapshot,
  reconcileDeliveryOrderAfterStatus,
} from './deliveryOrderProjection';

type Props = Pick<
  CaixaPanelProps,
  'orders' | 'apiBaseUrl' | 'authHeaders' | 'onRefreshOrders' | 'onOptimisticUpdateItemStatus'
> & {
  showToast: CashierNotice;
  isLoading: boolean;
  setIsLoading: (value: boolean) => void;
};

type PendingDeliveryMutation = {
  status?: DeliveryOrderView['status'];
  requestId: number;
};

type PendingCourierAssignment = {
  value: string;
  previous: string;
  requestId: number;
};

/** Owns orders state, effects and actions; composition supplies only cross-feature dependencies. */
export function useCashierOrders({
  orders,
  apiBaseUrl,
  authHeaders,
  onRefreshOrders,
  onOptimisticUpdateItemStatus,
  showToast,
  isLoading,
  setIsLoading,
}: Props) {
  const [selectedKanbanOrder, setSelectedKanbanOrder] = useState<any>(null);

  const [cancelConsumptionTarget, setCancelConsumptionTarget] = useState<{
    scope: 'order' | 'table' | 'digital';
    intent?: 'reject' | 'cancel';
    mesaId: number;
    orderId?: string;
    comandas: number;
    itens: number;
    total: number;
    itemIds: string[];
  } | null>(null);

  const [cancelTableReason, setCancelTableReason] = useState('');
  const [isCancellingTable, setIsCancellingTable] = useState(false);
  const [tableTransferTargetId, setTableTransferTargetId] = useState('');
  const [isTransferringTable, setIsTransferringTable] = useState(false);

  const openCancelTableConfirmation = (mesaId: number) => {
    const tableOrders = orders.filter((order) => Number(order.mesaId) === Number(mesaId));
    const activeItems = tableOrders
      .flatMap((order) => order.itens || [])
      .filter((item) => (item.status as string) !== 'cancelado');
    setCancelConsumptionTarget({
      scope: 'table',
      intent: 'cancel',
      mesaId,
      comandas: tableOrders.length,
      itens: activeItems.length,
      total: activeItems.reduce((sum, item) => sum + (Number(item.preco) || 0), 0),
      itemIds: activeItems.map((item) => String(item.id)).filter(Boolean),
    });
    setCancelTableReason('');
    setSelectedKanbanOrder(null);
  };

  const openCancelOrderConfirmation = (order: any, intent: 'reject' | 'cancel' = 'cancel') => {
    const rawItems = Array.isArray(order?.itens)
      ? order.itens
      : Array.isArray(order?.detailItems)
        ? order.detailItems
        : [];
    const activeItems = rawItems.filter(
      (item: any) => String(item?.status || '').toLowerCase() !== 'cancelado' && item?.id
    );
    const normalizedType = String(order?.modalidade || order?.tipo || '').toLowerCase();
    const isDigitalOrder =
      Number(order?.mesaId || 0) <= 0
      || ['delivery', 'entrega', 'retirada', 'pickup', 'dine_in', 'consumo_local', 'consumo no local'].includes(normalizedType);
    const comandaIds = new Set(
      activeItems.map((item: any) => String(item.comandaId || order.comandaId || order.id)).filter(Boolean)
    );
    setCancelConsumptionTarget({
      scope: isDigitalOrder ? 'digital' : 'order',
      intent: isDigitalOrder ? intent : 'cancel',
      mesaId: Number(order.mesaId || 0),
      orderId: isDigitalOrder ? String(order.id || order.comandaId || '') : undefined,
      comandas: isDigitalOrder ? 1 : comandaIds.size,
      itens: activeItems.length || Number(order.quantidadeItens || 0),
      total: Number(order.total) || activeItems.reduce((sum: number, item: any) => sum + (Number(item.preco) || 0), 0),
      itemIds: activeItems.map((item: any) => String(item.id)),
    });
    setCancelTableReason('');
    setSelectedKanbanOrder(null);
  };

  const handleCancelTableConsumption = async ({
    blockCustomer = false,
    blockDurationHours = null,
  }: {
    blockCustomer?: boolean;
    blockDurationHours?: 24 | 168 | 720 | null;
  } = {}) => {
    if (!cancelConsumptionTarget || cancelTableReason.trim().length < 3 || isCancellingTable) return;
    setIsCancellingTable(true);
    try {
      const isOrderScope = cancelConsumptionTarget.scope === 'order';
      const isDigitalScope = cancelConsumptionTarget.scope === 'digital';
      const isPendingRejection = isDigitalScope && cancelConsumptionTarget.intent === 'reject';
      const response = isDigitalScope
        ? await fetch(
            `${apiBaseUrl}/api/online-orders/orders/${encodeURIComponent(cancelConsumptionTarget.orderId || '')}/reject`,
            {
              method: 'POST',
              headers: { ...authHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                reason: cancelTableReason.trim(),
                block_customer: Boolean(isPendingRejection && blockCustomer),
                block_duration_hours: isPendingRejection && blockCustomer ? blockDurationHours : null,
              }),
            }
          )
        : await fetch(
            `${apiBaseUrl}/mesas/${cancelConsumptionTarget.mesaId}/${isOrderScope ? 'cancelar-itens' : 'cancelar-consumo'}`,
            {
              method: 'POST',
              headers: { ...authHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                motivo: cancelTableReason.trim(),
                ...(isOrderScope ? { item_ids: cancelConsumptionTarget.itemIds } : {}),
              }),
            }
          );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.detail || 'Não foi possível cancelar o pedido.');

      const cancelledOrderId = cancelConsumptionTarget.orderId;
      const digitalIntent = cancelConsumptionTarget.intent || 'cancel';
      const customerWasBlocked = Boolean(data?.customer_block_id);
      setCancelConsumptionTarget(null);
      setCancelTableReason('');
      if (isDigitalScope) {
        setDeliveryOrders((current) => current.filter((order) => String(order.id) !== String(cancelledOrderId)));
        window.dispatchEvent(new Event('koma_orders_updated'));
        if (digitalIntent === 'reject') {
          if (deliveryOrders.filter((order) => order.status === 'pendente').length <= 1) {
            setIsDrawerOpen(false);
          }
          showToast(
            customerWasBlocked
              ? 'Pedido recusado, motivo enviado ao cliente e novos pedidos deste cliente bloqueados.'
              : 'Pedido recusado e motivo enviado ao cliente.',
            'success'
          );
        } else {
          showToast('Pedido cancelado e removido da operação ativa.', 'success');
        }
      } else {
        await onRefreshOrders();
        showToast(
          isOrderScope
            ? `${data.itens_cancelados} item(ns) deste pedido cancelado(s).${data.mesa_liberada ? ` Mesa ${data.mesa_id} liberada.` : ' Os demais pedidos da mesa foram preservados.'}`
            : `Mesa ${data.mesa_id} liberada. ${data.itens_cancelados} item(ns) cancelado(s), sem lançamento no caixa.`,
          'success'
        );
      }
    } catch (error: any) {
      showToast(error?.message || 'Não foi possível cancelar o pedido.', 'error');
    } finally {
      setIsCancellingTable(false);
    }
  };

  const handleTransferTableFromSalon = async (order: any) => {
    const sourceMesaId = Number(order?.mesaId || 0);
    const targetMesaId = Number(tableTransferTargetId || 0);
    const primaryComandaId = String(order?.comandaId || order?.id || '');
    if (!sourceMesaId || !targetMesaId || !primaryComandaId || isTransferringTable) return;
    setIsTransferringTable(true);
    try {
      const response = await fetch(`${apiBaseUrl}/comandas/${primaryComandaId}/transferir/${targetMesaId}`, {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.detail || 'Não foi possível transferir a mesa.');
      setSelectedKanbanOrder(null);
      setTableTransferTargetId('');
      await onRefreshOrders();
      showToast(`Mesa ${sourceMesaId} transferida para a Mesa ${targetMesaId}.`, 'success');
    } catch (error: any) {
      showToast(error?.message || 'Não foi possível transferir a mesa.', 'error');
    } finally {
      setIsTransferringTable(false);
    }
  };

  const getTableMovementContext = (order: Order | any) => {
    const mesaId = Number(order?.mesaId || 0);
    if (mesaId <= 0) {
      return {
        mergedMesaIds: [] as number[],
        transferredFromMesaIds: [] as number[],
      };
    }

    const relatedOrders = (orders || []).filter((candidate) => {
      const normalizedType = String(candidate.tipo || '').toLowerCase();
      return (
        Number(candidate.mesaId) === mesaId &&
        !(candidate as any).fechada &&
        !['delivery', 'entrega', 'retirada'].includes(normalizedType)
      );
    });
    const movementSources = relatedOrders.length > 0 ? relatedOrders : [order];
    const mergedMesaIds = Array.from(
      new Set(
        movementSources
          .map((candidate) => Number(candidate.mesaOrigemId || 0))
          .filter((originId) => originId > 0 && originId !== mesaId)
      )
    ).sort((a, b) => a - b);
    const transferredFromMesaIds = Array.from(
      new Set(
        movementSources
          .map((candidate) => Number(candidate.mesaTransferidaDe || 0))
          .filter((originId) => originId > 0 && originId !== mesaId)
      )
    ).sort((a, b) => a - b);

    return { mergedMesaIds, transferredFromMesaIds };
  };

  const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrderView[]>(
    () => projectDeliveryOrdersFromSharedSnapshot(orders)
  );
  const [deliveryOrdersLoadState, setDeliveryOrdersLoadState] = useState<'loading' | 'loaded' | 'error'>(
    () => projectDeliveryOrdersFromSharedSnapshot(orders).length > 0 ? 'loaded' : 'loading'
  );
  const deliveryOrdersRequestRef = useRef(0);
  const pendingDeliveryMutationRef = useRef<Record<string, PendingDeliveryMutation>>({});
  const deliveryMutationSequenceRef = useRef(0);

  // The shared operational snapshot receives Caixa's optimistic order immediately.
  // Project only missing rows so richer server data already loaded by /delivery/ativos
  // remains authoritative. When a temp row is reconciled/rolled back upstream, remove it here too.
  useEffect(() => {
    const projected = projectDeliveryOrdersFromSharedSnapshot(orders);
    const sharedIds = new Set(projected.map((order) => String(order.id)));

    setDeliveryOrders((current) => {
      let changed = false;
      const currentIds = new Set(current.map((order) => String(order.id)));
      const next = current.filter((order) => {
        const id = String(order.id);
        const keep = !id.startsWith('temp-') || sharedIds.has(id);
        if (!keep) changed = true;
        return keep;
      });

      for (let index = projected.length - 1; index >= 0; index -= 1) {
        const order = projected[index];
        const id = String(order.id);
        if (currentIds.has(id)) continue;
        next.unshift(order);
        changed = true;
      }

      return changed ? next : current;
    });
  }, [orders]);

  const [motoboys, setMotoboys] = useState<any[]>([]);
  const [motoboysLoadState, setMotoboysLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const motoboysRequestRef = useRef(0);

  const [selectedMotoboys, setSelectedMotoboysState] = useState<Record<string, string>>({});
  const selectedMotoboysRef = useRef<Record<string, string>>({});
  const pendingCourierAssignmentRef = useRef<Record<string, PendingCourierAssignment>>({});
  const pendingCourierReassignmentRef = useRef<Set<string>>(new Set());
  const pendingFulfillmentConversionRef = useRef<Set<string>>(new Set());
  const courierAssignmentSequenceRef = useRef(0);

  const applySelectedMotoboysState = (next: Record<string, string>) => {
    selectedMotoboysRef.current = next;
    setSelectedMotoboysState(next);
  };

  const setSelectedMotoboys: React.Dispatch<React.SetStateAction<Record<string, string>>> = (update) => {
    const previous = selectedMotoboysRef.current;
    const next = typeof update === 'function' ? update(previous) : update;
    applySelectedMotoboysState(next);

    const changedOrderIds = new Set([...Object.keys(previous), ...Object.keys(next)]);
    changedOrderIds.forEach((orderId) => {
      const previousValue = previous[orderId] || '';
      const nextValue = next[orderId] || '';
      if (previousValue !== nextValue) {
        void handleAssignDeliveryCourier(orderId, nextValue, previousValue);
      }
    });
  };

  const [novoMotoboyNome, setNewMotoboyNome] = useState('');
  const [novoMotoboyTelefone, setNewMotoboyTelefone] = useState('');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    const selected = selectedKanbanOrder;
    const mesaId = Number(selected?.mesaId || 0);
    if (!selected || mesaId <= 0 || selected.contextoSalao || selected.projectionScope === 'table') return;

    const tableOrders = (orders || []).filter((order) => {
      const normalizedType = String(order.tipo || '').toLowerCase();
      return (
        Number(order.mesaId) === mesaId &&
        !(order as any).fechada &&
        !['delivery', 'entrega', 'retirada'].includes(normalizedType)
      );
    });
    if (tableOrders.length === 0) return;

    setSelectedKanbanOrder({
      ...tableOrders[0],
      projectionScope: 'table',
      contextoSalao: true,
      tableContext: describeTableOrders(tableOrders),
      itens: tableOrders.flatMap((order) => order.itens || []),
      comandaIds: tableOrders.map((order) => order.id),
    });
  }, [orders, selectedKanbanOrder]);

  const handleQuickPrintOrder = async (order: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      let url = '';
      if (order.mesaId && Number(order.mesaId) > 0 && order.projectionScope !== 'table') {
        url = `${apiBaseUrl}/comandas/lancamentos/${encodeURIComponent(String(order.id))}/reimprimir`;
      } else if (order.mesaId && Number(order.mesaId) > 0) {
        url = `${apiBaseUrl}/mesas/${order.mesaId}/imprimir-recibo?apenas_valores=false`;
      } else {
        url = `${apiBaseUrl}/comandas/${order.id}/imprimir-recibo`;
      }
      const response = await fetch(url, { method: 'POST', headers: authHeaders });
      if (response.ok) {
        showToast(
          order.projectionScope === 'launch'
            ? `Pedido #${order.displayNumber || order.numeroPedido || ''} enviado para reimpressão.`
            : 'Impressão via de conferência enviada para a fila!',
          'success'
        );
        window.dispatchEvent(new Event('koma_print_monitor_refresh'));
      } else {
        const errData = await response.json().catch(() => null);
        showToast(errData?.detail || 'Solicitação de impressão rápida concluída.', 'info');
      }
    } catch (err) {
      console.error(err);
      showToast('Falha na comunicação com o servidor de impressão.', 'error');
    }
  };

  const mapComandaToDeliveryView = projectApiComandaToDeliveryView;

  const syncSelectedMotoboysFromServer = (mapped: DeliveryOrderView[]) => {
    const activeIds = new Set(mapped.map((order) => String(order.id)));
    const next = { ...selectedMotoboysRef.current };

    Object.keys(next).forEach((orderId) => {
      if (!activeIds.has(orderId) && !pendingCourierAssignmentRef.current[orderId]) {
        delete next[orderId];
      }
    });

    mapped.forEach((order) => {
      const orderId = String(order.id);
      const pending = pendingCourierAssignmentRef.current[orderId];
      next[orderId] = pending?.value ?? (order.motoboyId ? String(order.motoboyId) : '');
    });

    applySelectedMotoboysState(next);
  };

  const fetchDeliveryOrders = async () => {
    const requestId = ++deliveryOrdersRequestRef.current;
    setDeliveryOrdersLoadState((current) => current === 'loaded' ? current : 'loading');
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/delivery/ativos`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        if (requestId !== deliveryOrdersRequestRef.current) return;
        const mapped = data
          .map(mapComandaToDeliveryView)
          .filter((order: DeliveryOrderView | null): order is DeliveryOrderView => order !== null)
          .map((order: DeliveryOrderView) => {
            const pending = pendingDeliveryMutationRef.current[String(order.id)];
            const pendingCourier = pendingCourierAssignmentRef.current[String(order.id)];
            const statusProjectedOrder = pending?.status ? { ...order, status: pending.status } : order;
            return {
              ...statusProjectedOrder,
              ...(pendingCourier ? { motoboyId: pendingCourier.value ? Number(pendingCourier.value) : null } : {}),
            };
          });
        setDeliveryOrders((current) => {
          const previousById = new Map(current.map((order) => [String(order.id), order]));
          return mapped.map((order: DeliveryOrderView) => {
            const previous = previousById.get(String(order.id));
            return previous ? reconcileDeliveryOrderAfterStatus(previous, order) : order;
          });
        });
        syncSelectedMotoboysFromServer(mapped);
        setDeliveryOrdersLoadState('loaded');
      } else if (requestId === deliveryOrdersRequestRef.current) {
        setDeliveryOrdersLoadState('error');
      }
    } catch (err) {
      if (requestId === deliveryOrdersRequestRef.current) {
        setDeliveryOrdersLoadState('error');
        console.error('Error fetching delivery orders', err);
      }
    }
  };

  const handleAssociateTableToOrder = async (order: any) => {
    const targetMesaId = Number(tableTransferTargetId || 0);
    const primaryComandaId = String(order?.comandaId || order?.id || '');
    const normalizedType = String(order?.modalidade || order?.tipo || '').trim().toLowerCase();
    const isDelivery = ['delivery', 'entrega'].includes(normalizedType);
    if (!targetMesaId || !primaryComandaId || isTransferringTable) return false;
    if (isDelivery) {
      showToast('Pedidos de delivery não podem ser associados a uma mesa.', 'error');
      return false;
    }

    setIsTransferringTable(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/comandas/${encodeURIComponent(primaryComandaId)}/associar-mesa/${targetMesaId}`,
        {
          method: 'POST',
          headers: authHeaders,
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.detail || 'Não foi possível associar o pedido à mesa.');

      setDeliveryOrders((current) =>
        current.map((candidate) =>
          String(candidate.id) === primaryComandaId
            ? { ...candidate, mesaId: targetMesaId }
            : candidate,
        ),
      );
      setSelectedKanbanOrder(null);
      setTableTransferTargetId('');
      await Promise.allSettled([onRefreshOrders(), fetchDeliveryOrders()]);
      showToast(`Pedido associado à Mesa ${targetMesaId}.`, 'success');
      return true;
    } catch (error: any) {
      showToast(error?.message || 'Não foi possível associar o pedido à mesa.', 'error');
      return false;
    } finally {
      setIsTransferringTable(false);
    }
  };

  const fetchMotoboys = async () => {
    const requestId = ++motoboysRequestRef.current;
    setMotoboysLoadState((current) => current === 'loaded' ? current : 'loading');
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/motoboys/lista`, { headers: authHeaders });
      if (!res.ok) {
        if (requestId === motoboysRequestRef.current) {
          setMotoboysLoadState((current) => current === 'loaded' ? current : 'error');
        }
        return;
      }
      const data = await res.json();
      if (requestId !== motoboysRequestRef.current) return;
      setMotoboys(data);
      setMotoboysLoadState('loaded');
    } catch (err) {
      if (requestId === motoboysRequestRef.current) {
        console.error('Error fetching motoboys', err);
        setMotoboysLoadState((current) => current === 'loaded' ? current : 'error');
      }
    }
  };

  useEffect(() => {
    void fetchMotoboys();
  }, [apiBaseUrl]);

  useEffect(() => {
    const handleDeliveryUpdate = () => {
      void fetchDeliveryOrders();
    };
    const handleTeamUpdate = () => {
      void fetchMotoboys();
    };
    window.addEventListener('koma_orders_updated', handleDeliveryUpdate);
    window.addEventListener('koma_team_updated', handleTeamUpdate);
    return () => {
      window.removeEventListener('koma_orders_updated', handleDeliveryUpdate);
      window.removeEventListener('koma_team_updated', handleTeamUpdate);
    };
  }, [apiBaseUrl]);

  async function handleAssignDeliveryCourier(orderId: string, nextMotoboyId: string, previousMotoboyId: string) {
    const orderKey = String(orderId);
    if (!orderKey || orderKey.startsWith('temp-')) return false;

    const requestId = ++courierAssignmentSequenceRef.current;
    pendingCourierAssignmentRef.current[orderKey] = {
      value: nextMotoboyId,
      previous: previousMotoboyId,
      requestId,
    };

    const optimisticMotoboyId = nextMotoboyId ? Number(nextMotoboyId) : null;
    setDeliveryOrders((current) => current.map((order) =>
      String(order.id) === orderKey ? { ...order, motoboyId: optimisticMotoboyId } : order
    ));
    setSelectedKanbanOrder((current: any) => {
      if (!current || String(current.id) !== orderKey || !current.courierAssignment) return current;
      return {
        ...current,
        courierAssignment: { ...current.courierAssignment, value: optimisticMotoboyId },
      };
    });

    try {
      const response = await fetch(`${apiBaseUrl}/comandas/${encodeURIComponent(orderKey)}/delivery/entregador`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ motoboy_id: nextMotoboyId ? Number(nextMotoboyId) : null }),
      });
      const data = await response.json().catch(() => ({}));
      const pending = pendingCourierAssignmentRef.current[orderKey];
      if (!pending || pending.requestId !== requestId) return response.ok;

      if (!response.ok) {
        delete pendingCourierAssignmentRef.current[orderKey];
        const rollback = { ...selectedMotoboysRef.current };
        rollback[orderKey] = previousMotoboyId;
        applySelectedMotoboysState(rollback);
        setDeliveryOrders((current) => current.map((order) =>
          String(order.id) === orderKey
            ? { ...order, motoboyId: previousMotoboyId ? Number(previousMotoboyId) : null }
            : order
        ));
        setSelectedKanbanOrder((current: any) => {
          if (!current || String(current.id) !== orderKey || !current.courierAssignment) return current;
          return {
            ...current,
            courierAssignment: {
              ...current.courierAssignment,
              value: previousMotoboyId ? Number(previousMotoboyId) : null,
            },
          };
        });
        showToast(data?.detail || 'Não foi possível atribuir o entregador.', 'error');
        void fetchDeliveryOrders();
        return false;
      }

      delete pendingCourierAssignmentRef.current[orderKey];
      const serverMotoboyId = data?.motoboy_id ? String(data.motoboy_id) : '';
      const confirmedSelection = { ...selectedMotoboysRef.current, [orderKey]: serverMotoboyId };
      applySelectedMotoboysState(confirmedSelection);
      const projected = mapComandaToDeliveryView(data);
      if (projected) {
        setDeliveryOrders((current) => current.map((order) => String(order.id) === orderKey ? projected : order));
      }
      setSelectedKanbanOrder((current: any) => {
        if (!current || String(current.id) !== orderKey || !current.courierAssignment) return current;
        return {
          ...current,
          courierAssignment: {
            ...current.courierAssignment,
            value: data?.motoboy_id ?? null,
          },
        };
      });
      showToast(serverMotoboyId ? 'Entregador atribuído ao pedido.' : 'Entregador removido do pedido.', 'success');
      void onRefreshOrders();
      window.dispatchEvent(new Event('koma_orders_updated'));
      return true;
    } catch (error) {
      const pending = pendingCourierAssignmentRef.current[orderKey];
      if (!pending || pending.requestId !== requestId) return false;
      delete pendingCourierAssignmentRef.current[orderKey];
      const rollback = { ...selectedMotoboysRef.current, [orderKey]: previousMotoboyId };
      applySelectedMotoboysState(rollback);
      setDeliveryOrders((current) => current.map((order) =>
        String(order.id) === orderKey
          ? { ...order, motoboyId: previousMotoboyId ? Number(previousMotoboyId) : null }
          : order
      ));
      showToast('Erro de conexão ao atribuir o entregador.', 'error');
      void fetchDeliveryOrders();
      return false;
    }
  }

  const handleReassignDeliveryCourier = async (
    orderId: string,
    nextMotoboyId: string,
    reason: string,
  ): Promise<boolean> => {
    const orderKey = String(orderId);
    if (!orderKey || !nextMotoboyId || pendingCourierReassignmentRef.current.has(orderKey)) {
      return false;
    }

    pendingCourierReassignmentRef.current.add(orderKey);
    try {
      const response = await fetch(
        `${apiBaseUrl}/comandas/${encodeURIComponent(orderKey)}/delivery/entregador/reassign`,
        {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            motoboy_id: Number(nextMotoboyId),
            motivo: reason.trim(),
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(data?.detail || 'Não foi possível trocar o entregador.', 'error');
        return false;
      }

      const projected = mapComandaToDeliveryView(data);
      if (projected) {
        setDeliveryOrders((current) => current.map((order) =>
          String(order.id) === orderKey
            ? reconcileDeliveryOrderAfterStatus(order, projected)
            : order
        ));
      }
      const confirmedSelection = {
        ...selectedMotoboysRef.current,
        [orderKey]: data?.motoboy_id ? String(data.motoboy_id) : nextMotoboyId,
      };
      applySelectedMotoboysState(confirmedSelection);
      showToast('Entregador da corrida alterado com motivo registrado.', 'success');
      void Promise.allSettled([fetchDeliveryOrders(), onRefreshOrders()]);
      window.dispatchEvent(new Event('koma_orders_updated'));
      return true;
    } catch (error) {
      console.error(error);
      showToast('Erro de conexão ao trocar o entregador.', 'error');
      void fetchDeliveryOrders();
      return false;
    } finally {
      pendingCourierReassignmentRef.current.delete(orderKey);
    }
  };

  const handleConvertDeliveryToPickup = async (
    orderId: string,
    reason: string,
  ): Promise<boolean> => {
    const orderKey = String(orderId);
    if (!orderKey || pendingFulfillmentConversionRef.current.has(orderKey)) return false;

    pendingFulfillmentConversionRef.current.add(orderKey);
    try {
      const response = await fetch(
        `${apiBaseUrl}/comandas/${encodeURIComponent(orderKey)}/delivery/converter-retirada`,
        {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ motivo: reason.trim() }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(data?.detail || 'Não foi possível alterar o pedido para retirada.', 'error');
        return false;
      }

      const nextSelections = { ...selectedMotoboysRef.current };
      delete nextSelections[orderKey];
      applySelectedMotoboysState(nextSelections);
      setSelectedKanbanOrder(null);

      // A leitura dedicada é a autoridade para recompor total, taxa e modalidade.
      // O broadcast do backend faz o mesmo em outros terminais.
      await Promise.allSettled([fetchDeliveryOrders(), onRefreshOrders()]);
      window.dispatchEvent(new Event('koma_orders_updated'));
      showToast('Pedido alterado para retirada. Status de preparo e pagamento foram preservados.', 'success');
      return true;
    } catch (error) {
      console.error(error);
      showToast('Erro de conexão ao alterar o pedido para retirada.', 'error');
      void fetchDeliveryOrders();
      return false;
    } finally {
      pendingFulfillmentConversionRef.current.delete(orderKey);
    }
  };

  const openDeliveryOrderDetails = (order: DeliveryOrderView) => {
    const fullComanda = orders.find((o) => o.id === order.id);
    const itemsMapped = fullComanda
      ? fullComanda.itens.map((it: any) => ({
          id: it.id,
          comandaId: fullComanda.id,
          nome: it.produto?.nome || it.nome || 'Item',
          preco: it.preco_unit || it.preco || 0,
          observacao: it.observacao || '',
          cliente_nome: it.cliente_nome || it.clienteNome || 'Consumo Geral',
          status: it.status,
          pago: it.pago,
          lancamentoId: it.lancamentoId || it.lancamento_id,
        }))
      : order.detailItems || order.itens.split(' + ').map((itStr: string) => {
          const match = itStr.match(/^(\d+)x\s+(.+)$/);
          return {
            nome: match ? match[2] : itStr,
            observacao: '',
            cliente_nome: 'Consumo Geral',
            status: order.status === 'pronto' ? 'pronto' : order.status === 'transito' ? 'entregue' : 'preparando',
            lancamentoId: undefined,
          };
        });

    const orderId = String(order.id);
    const currentCourierId = selectedMotoboysRef.current[orderId]
      || (order.motoboyId ? String(order.motoboyId) : '')
      || (fullComanda?.motoboyId ? String(fullComanda.motoboyId) : '');
    const courierOptions = motoboys
      .filter((motoboy) => motoboy.ativo)
      .map((motoboy) => ({ id: Number(motoboy.id), nome: String(motoboy.nome || `Entregador ${motoboy.id}`) }));

    const changeCourierFromKanban = (motoboyId: string) => {
      setSelectedMotoboys((current) => ({ ...current, [orderId]: motoboyId }));
      setSelectedKanbanOrder((current: any) => {
        if (!current || String(current.id) !== orderId || !current.courierAssignment) return current;
        return {
          ...current,
          courierAssignment: {
            ...current.courierAssignment,
            value: motoboyId ? Number(motoboyId) : null,
          },
        };
      });
    };

    setSelectedKanbanOrder({
      id: order.id,
      comandaId: order.id,
      mesaId: order.mesaId || 0,
      quantidadeItens: order.quantidadeItens,
      identificador: order.cliente,
      itens: itemsMapped,
      total: order.total,
      amountPaid: order.amountPaid,
      amountDue: order.amountDue,
      onlinePaymentStatus: order.onlinePaymentStatus,
      numeroPedido: order.numeroPedido,
      origemOperacional: order.origemOperacional,
      isQuickSale: order.isQuickSale,
      modalidade: order.modalidade,
      deliveryStatus: order.status,
      canal: order.canal,
      telefone: order.telefone,
      endereco: order.endereco,
      paymentMethod: order.paymentMethod,
      changeFor: order.changeFor,
      criadoEm: order.criadoEm,
      created_at: order.created_at,
      garcomNome: order.garcomNome,
      lancamentoId: itemsMapped.find((item: any) => item.lancamentoId)?.lancamentoId,
      courierAssignment: order.modalidade === 'delivery'
        ? {
            value: currentCourierId ? Number(currentCourierId) : null,
            options: courierOptions,
            loading: motoboysLoadState !== 'loaded',
            onChange: changeCourierFromKanban,
          }
        : undefined,
    });
  };

  const handleUpdateDeliveryStatus = async (orderId: string, statusNovo: string) => {
    const orderKey = String(orderId);
    if (pendingDeliveryMutationRef.current[orderKey]) return false;

    const previousIndex = deliveryOrders.findIndex((order) => String(order.id) === orderKey);
    const previousOrder = previousIndex >= 0 ? deliveryOrders[previousIndex] : undefined;
    const optimisticStatus = readActiveDeliveryStatus(statusNovo) || undefined;
    const requestId = ++deliveryMutationSequenceRef.current;

    pendingDeliveryMutationRef.current[orderKey] = { status: optimisticStatus, requestId };
    deliveryOrdersRequestRef.current += 1;

    if (optimisticStatus) {
      setDeliveryOrders((current) =>
        current.map((order) => String(order.id) === orderKey ? { ...order, status: optimisticStatus } : order)
      );
    }

    const finishCurrentMutation = () => {
      if (pendingDeliveryMutationRef.current[orderKey]?.requestId !== requestId) return false;
      delete pendingDeliveryMutationRef.current[orderKey];
      deliveryOrdersRequestRef.current += 1;
      return true;
    };

    const rollbackCurrentMutation = () => {
      if (!finishCurrentMutation()) return false;
      if (previousOrder && optimisticStatus) {
        setDeliveryOrders((current) => {
          const existingIndex = current.findIndex((order) => String(order.id) === orderKey);
          if (existingIndex >= 0) {
            return current.map((order) => String(order.id) === orderKey ? previousOrder : order);
          }
          const restored = [...current];
          restored.splice(Math.min(previousIndex, restored.length), 0, previousOrder);
          return restored;
        });
      }
      void fetchDeliveryOrders();
      return true;
    };

    try {
      const res = await fetch(`${apiBaseUrl}/comandas/${orderId}/delivery/status?status_novo=${statusNovo}`, {
        method: 'PUT',
        headers: authHeaders,
      });
      if (res.ok) {
        const updatedComanda = await res.json().catch(() => null);
        if (!finishCurrentMutation()) return true;
        if (updatedComanda) {
          const projected = mapComandaToDeliveryView(updatedComanda);
          setDeliveryOrders((current) =>
            projected
              ? current.map((order) => (
                  String(order.id) === orderKey
                    ? reconcileDeliveryOrderAfterStatus(order, projected)
                    : order
                ))
              : current.filter((order) => String(order.id) !== orderKey)
          );
        }
        void Promise.all([fetchDeliveryOrders(), onRefreshOrders()]);
        const estoqueAlertas = Array.isArray(updatedComanda?.estoque_alertas)
          ? updatedComanda.estoque_alertas
          : [];
        if (statusNovo === 'producao' && estoqueAlertas.length > 0) {
          const nomes = estoqueAlertas
            .map((alerta: any) => String(alerta?.nome || '').trim())
            .filter(Boolean);
          const resumo = nomes.slice(0, 2).join(', ') || 'ingrediente';
          const restantes = nomes.length > 2 ? ` +${nomes.length - 2}` : '';
          showToast(
            `Pedido aceito. Estoque indica ${resumo}${restantes} zerado/negativo; confira o estoque físico.`,
            'info',
          );
        } else {
          showToast('Status atualizado e cliente avisado automaticamente!');
        }
        return true;
      }

      const errorData = await res.json().catch(() => ({}));
      rollbackCurrentMutation();
      showToast(errorData?.detail || 'Erro ao atualizar status do pedido.', 'error');
      return false;
    } catch (err) {
      console.error(err);
      rollbackCurrentMutation();
      showToast('Erro de conexão ao atualizar status.', 'error');
      return false;
    }
  };

  const handleDespacharKanban = async (orderId: string, selectedMotoboyId: string) => {
    if (!selectedMotoboyId) {
      showToast('Selecione um entregador para despachar o pedido!', 'info');
      return;
    }
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/${orderId}/delivery/despachar`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ motoboy_id: Number(selectedMotoboyId) }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data) {
          const projected = mapComandaToDeliveryView(data);
          if (projected) {
            setDeliveryOrders((current) => current.map((order) => String(order.id) === String(orderId) ? projected : order));
          }
          const confirmedSelection = {
            ...selectedMotoboysRef.current,
            [String(orderId)]: data.motoboy_id ? String(data.motoboy_id) : selectedMotoboyId,
          };
          applySelectedMotoboysState(confirmedSelection);
        }
        showToast('Pedido despachado; entregador e cliente avisados automaticamente!');
        setSelectedKanbanOrder(null);
        void fetchDeliveryOrders();
        void onRefreshOrders();
      } else {
        const err = await res.json();
        showToast(`Erro ao despachar: ${err.detail}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao despachar.', 'error');
    }
  };

  const handleGerarLinkMotoboy = async (selectedMotoboyId: string) => {
    if (!selectedMotoboyId) {
      showToast('Selecione um entregador para gerar o link!', 'info');
      return;
    }
    const mb = motoboys.find((m) => String(m.id) === String(selectedMotoboyId));
    if (!mb) {
      showToast('Entregador não encontrado.', 'error');
      return;
    }
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/motoboys/${selectedMotoboyId}/gerar-link`, {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      const linkToCopy = data?.link_publico || data?.link;
      if (res.ok && linkToCopy) {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(linkToCopy).catch(() => {});
        }
        showToast(`Link de acesso de '${mb.nome}' copiado!`, 'success');
      } else {
        showToast(data?.detail || 'Não foi possível gerar o link de acesso.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao gerar link de acesso.', 'error');
    }
  };

  const handleRevogarAcessoMotoboy = async (selectedMotoboyId: string) => {
    if (!selectedMotoboyId) {
      showToast('Selecione um entregador para revogar o acesso!', 'info');
      return;
    }
    const mb = motoboys.find((m) => String(m.id) === String(selectedMotoboyId));
    if (!mb) {
      showToast('Entregador não encontrado.', 'error');
      return;
    }
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/motoboys/${selectedMotoboyId}/revogar-link`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (res.ok) showToast(`Acesso do entregador '${mb.nome}' revogado com sucesso!`, 'success');
      else showToast('Não foi possível revogar o acesso.', 'error');
    } catch (err) {
      console.error(err);
      showToast('Erro ao tentar revogar o acesso.', 'error');
    }
  };

  const handleCloseDigitalOrder = async (orderId: string): Promise<boolean> => {
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/${orderId}/fechar`, { method: 'PUT', headers: authHeaders });
      if (res.ok) {
        showToast('Pedido encerrado com sucesso!');
        setSelectedKanbanOrder(null);
        setDeliveryOrders((current) => current.filter((order) => String(order.id) !== String(orderId)));
        void Promise.all([fetchDeliveryOrders(), onRefreshOrders()]);
        return true;
      }
      showToast('Erro ao fechar comanda.', 'error');
      return false;
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao finalizar pedido.', 'error');
      return false;
    }
  };

  const handleRecusarPedido = async (orderId: string) => {
    await handleUpdateDeliveryStatus(orderId, 'recusado');
  };
  const handleFinalizarPedido = async (orderId: string) => handleCloseDigitalOrder(orderId);

  const handleAddMotoboy = async (e: React.FormEvent, newMotoboyNome: string, newMotoboyTelefone: string) => {
    e.preventDefault();
    if (!newMotoboyNome.trim() || !newMotoboyTelefone.trim()) return;
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/motoboys/cadastro`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: newMotoboyNome.trim(), telefone: newMotoboyTelefone.trim(), ativo: true }),
      });
      if (res.ok) {
        showToast('Entregador cadastrado e integrado à equipe com sucesso!');
        await fetchMotoboys();
        window.dispatchEvent(new CustomEvent('koma_team_updated'));
        setNewMotoboyNome('');
        setNewMotoboyTelefone('');
      } else {
        const errorData = await res.json().catch(() => ({}));
        showToast(errorData.detail || 'Erro ao cadastrar entregador.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao cadastrar entregador.', 'error');
    }
  };

  const handleUpdateItemStatus = async (itemId: string, newStatus: 'preparando' | 'pronto' | 'entregue') => {
    if (onOptimisticUpdateItemStatus) onOptimisticUpdateItemStatus(itemId, newStatus);
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/itens/${itemId}/status?status=${newStatus}`, {
        method: 'PUT',
        headers: authHeaders,
      });
      if (!res.ok) {
        alert('Erro ao atualizar status na cozinha.');
        onRefreshOrders();
      }
    } catch (err) {
      console.error(err);
      onRefreshOrders();
    }
  };

  const handleAcceptPendingDeliveryOrder = async (order: DeliveryOrderView) => {
    await handleUpdateDeliveryStatus(order.id, 'producao');
    if (deliveryOrders.filter((o) => o.status === 'pendente').length <= 1) setIsDrawerOpen(false);
  };

  const handleRejectPendingDeliveryOrder = (order: DeliveryOrderView) => openCancelOrderConfirmation(order, 'reject');

  const handleMarkTableItemsReady = async (order: CashierTableCard['order']) => {
    if (isLoading) return;
    const ids = deriveProductionState(order.itens).preparingItems.map((item) => item.id);
    if (onOptimisticUpdateItemStatus && ids.length > 0) onOptimisticUpdateItemStatus(ids, 'pronto');
    setIsLoading(true);
    try {
      await Promise.all(
        ids.map((id) => fetch(`${apiBaseUrl}/comandas/itens/${id}/status?status=pronto`, { method: 'PUT', headers: authHeaders }))
      );
    } catch (err) {
      console.error(err);
      onRefreshOrders();
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdvanceDigitalOrder = async (order: DeliveryOrderView) => {
    if (order.status !== 'producao') return;
    await handleUpdateDeliveryStatus(order.id, 'pronto');
  };

  const handleAdvanceSelectedKanbanOrder = async (selectedMotoboyId?: string) => {
    const isDelivery = selectedKanbanOrder.modalidade === 'delivery';
    const currentStatus = String(selectedKanbanOrder.deliveryStatus || '').toLowerCase();

    if (isDelivery && currentStatus === 'pronto') {
      const orderId = String(selectedKanbanOrder.id);
      const courierId = selectedMotoboyId
        || selectedMotoboysRef.current[orderId]
        || (selectedKanbanOrder.courierAssignment?.value ? String(selectedKanbanOrder.courierAssignment.value) : '');
      if (!courierId) {
        showToast('Selecione um entregador antes de iniciar a rota.', 'info');
        return;
      }
      await handleDespacharKanban(orderId, courierId);
      return;
    }

    if (currentStatus !== 'producao') return;
    const updated = await handleUpdateDeliveryStatus(selectedKanbanOrder.id, 'pronto');
    if (updated) setSelectedKanbanOrder(null);
  };

  const handleReprintSelectedKanbanProduction = async (launchId?: string) => {
    try {
      const selectedLaunchId = launchId || selectedKanbanOrder.lancamentoId;
      const printUrl = selectedLaunchId
        ? `${apiBaseUrl}/comandas/lancamentos/${encodeURIComponent(String(selectedLaunchId))}/reimprimir`
        : `${apiBaseUrl}/comandas/${selectedKanbanOrder.comandaId || selectedKanbanOrder.id}/imprimir-recibo`;
      const res = await fetch(printUrl, { method: 'POST', headers: authHeaders });
      if (res.ok) {
        window.dispatchEvent(new Event('koma_print_monitor_refresh'));
        if (launchId) {
          const label = selectedKanbanOrder.tableContext?.launches.find((launch: any) => launch.id === launchId)?.displayNumber;
          showToast(`Pedido #${label || launchId} enviado para reimpressão.`, 'success');
        } else setSelectedKanbanOrder(null);
      } else showToast('Erro ao solicitar reimpressão.', 'error');
    } catch (err) {
      console.error(err);
      showToast('Erro ao solicitar reimpressão.', 'error');
    }
  };

  const handlePrintSelectedKanbanTable = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/mesas/${selectedKanbanOrder.mesaId}/imprimir-recibo?apenas_valores=false`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (response.ok) {
        window.dispatchEvent(new Event('koma_print_monitor_refresh'));
        setSelectedKanbanOrder(null);
      } else {
        const errD = await response.json();
        showToast(`Erro: ${errD.detail}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao imprimir comanda inteira.', 'error');
    }
  };

  const handlePrintSelectedKanbanValues = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/mesas/${selectedKanbanOrder.mesaId}/imprimir-recibo?apenas_valores=true`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (response.ok) {
        window.dispatchEvent(new Event('koma_print_monitor_refresh'));
        setSelectedKanbanOrder(null);
      } else {
        const errD = await response.json();
        showToast(`Erro: ${errD.detail}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao imprimir Conta da Mesa.', 'error');
    }
  };

  const handleInspectSalonTable = (tableOrders: Order[]) =>
    tableOrders[0] &&
    setSelectedKanbanOrder({
      ...tableOrders[0],
      projectionScope: 'table',
      contextoSalao: true,
      tableContext: describeTableOrders(tableOrders),
      itens: tableOrders.flatMap((order) => order.itens || []),
      comandaIds: tableOrders.map((order) => order.id),
    });

  const handleTransferSelectedKanbanTable = () => handleTransferTableFromSalon(selectedKanbanOrder);
  const handleAssociateSelectedKanbanTable = () => handleAssociateTableToOrder(selectedKanbanOrder);
  const handleCancelSelectedKanbanConsumption = () =>
    selectedKanbanOrder.contextoSalao
      ? openCancelTableConfirmation(Number(selectedKanbanOrder.mesaId))
      : openCancelOrderConfirmation(selectedKanbanOrder);
  const handleCancelSelectedKanbanOrder = () => openCancelOrderConfirmation(selectedKanbanOrder);

  const saveItemObservation = async (itemId: string, observation: string) => {
    const response = await fetch(`${apiBaseUrl}/comandas/itens/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ observacao: observation }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Não foi possível salvar a observação.');
    setSelectedKanbanOrder((current: any) => current ? { ...current, itens: current.itens.map((item: any) =>
      String(item.id) === itemId ? { ...item, observacao: data.observacao } : item) } : current);
    await onRefreshOrders();
  };

  return {
    selectedKanbanOrder,
    saveItemObservation,
    setSelectedKanbanOrder,
    cancelConsumptionTarget,
    setCancelConsumptionTarget,
    cancelTableReason,
    setCancelTableReason,
    isCancellingTable,
    tableTransferTargetId,
    setTableTransferTargetId,
    isTransferringTable,
    openCancelTableConfirmation,
    openCancelOrderConfirmation,
    handleCancelTableConsumption,
    handleTransferTableFromSalon,
    getTableMovementContext,
    deliveryOrders,
    deliveryOrdersLoadState,
    motoboys,
    motoboysLoadState,
    selectedMotoboys,
    setSelectedMotoboys,
    novoMotoboyNome,
    setNewMotoboyNome,
    novoMotoboyTelefone,
    setNewMotoboyTelefone,
    isDrawerOpen,
    setIsDrawerOpen,
    handleQuickPrintOrder,
    fetchDeliveryOrders,
    fetchMotoboys,
    openDeliveryOrderDetails,
    handleUpdateDeliveryStatus,
    handleAssignDeliveryCourier,
    handleReassignDeliveryCourier,
    handleConvertDeliveryToPickup,
    handleDespacharKanban,
    handleGerarLinkMotoboy,
    handleRevogarAcessoMotoboy,
    handleCloseDigitalOrder,
    handleRecusarPedido,
    handleFinalizarPedido,
    handleAddMotoboy,
    handleUpdateItemStatus,
    handleAcceptPendingDeliveryOrder,
    handleRejectPendingDeliveryOrder,
    handleMarkTableItemsReady,
    handleAdvanceDigitalOrder,
    handleAdvanceSelectedKanbanOrder,
    handleReprintSelectedKanbanProduction,
    handlePrintSelectedKanbanTable,
    handlePrintSelectedKanbanValues,
    handleInspectSalonTable,
    handleTransferSelectedKanbanTable,
    handleAssociateSelectedKanbanTable,
    handleCancelSelectedKanbanConsumption,
    handleCancelSelectedKanbanOrder,
  };
}