import React, { useEffect, useState } from 'react';
import { deriveProductionState } from '../../../domain/operationalState';
import { describeTableOrders } from '../../../domain/tableReadModel';
import type { Order } from '../../../types';
import { formatBackendTime } from '../../../utils/dateTime';
import type { CaixaPanelProps, CashierNotice } from '../cashierContracts';
import type { CashierTableCard, DeliveryOrderView } from '../orders/cashierWorkspaceTypes';

type Props = Pick<
  CaixaPanelProps,
  'orders' | 'apiBaseUrl' | 'authHeaders' | 'onRefreshOrders' | 'onOptimisticUpdateItemStatus'
> & {
  showToast: CashierNotice;
  isLoading: boolean;
  setIsLoading: (value: boolean) => void;
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
      mesaId,
      comandas: tableOrders.length,
      itens: activeItems.length,
      total: activeItems.reduce((sum, item) => sum + (Number(item.preco) || 0), 0),
      itemIds: activeItems.map((item) => String(item.id)).filter(Boolean),
    });
    setCancelTableReason('');
    setSelectedKanbanOrder(null);
  };

  const openCancelOrderConfirmation = (order: any) => {
    const activeItems = (order?.itens || []).filter(
      (item: any) => String(item?.status || '').toLowerCase() !== 'cancelado' && item?.id
    );
    const normalizedType = String(order?.modalidade || order?.tipo || '').toLowerCase();
    const isDigitalOrder =
      Number(order?.mesaId || 0) <= 0 || ['delivery', 'entrega', 'retirada'].includes(normalizedType);
    const comandaIds = new Set(
      activeItems.map((item: any) => String(item.comandaId || order.comandaId || order.id)).filter(Boolean)
    );
    setCancelConsumptionTarget({
      scope: isDigitalOrder ? 'digital' : 'order',
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

  const handleCancelTableConsumption = async () => {
    if (!cancelConsumptionTarget || cancelTableReason.trim().length < 3 || isCancellingTable) return;
    setIsCancellingTable(true);
    try {
      const isOrderScope = cancelConsumptionTarget.scope === 'order';
      const isDigitalScope = cancelConsumptionTarget.scope === 'digital';
      const response = isDigitalScope
        ? await fetch(
            `${apiBaseUrl}/comandas/${encodeURIComponent(cancelConsumptionTarget.orderId || '')}/delivery/status?status_novo=recusado`,
            { method: 'PUT', headers: authHeaders }
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
      setCancelConsumptionTarget(null);
      setCancelTableReason('');
      if (isDigitalScope) {
        setDeliveryOrders((current) => current.filter((order) => String(order.id) !== String(cancelledOrderId)));
        window.dispatchEvent(new Event('koma_orders_updated'));
        showToast('Pedido cancelado e removido da operação ativa.', 'success');
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

  const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrderView[]>([]);

  const [motoboys, setMotoboys] = useState<any[]>([]);

  const [selectedMotoboys, setSelectedMotoboys] = useState<{
    [orderId: string]: string;
  }>({});

  const [novoMotoboyNome, setNewMotoboyNome] = useState('');

  const [novoMotoboyTelefone, setNewMotoboyTelefone] = useState('');

  // ── Gaveta de Aceite (Floating Drawer) & Sistema de Áudio Unificado do Caixa ────
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Impressão rápida de pré-conta do card no Kanban
  const handleQuickPrintOrder = async (order: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      let url = '';
      if (order.mesaId && Number(order.mesaId) > 0) {
        url = `${apiBaseUrl}/mesas/${order.mesaId}/imprimir-recibo?apenas_valores=false`;
      } else {
        url = `${apiBaseUrl}/comandas/${order.id}/imprimir-recibo`;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: authHeaders,
      });
      if (response.ok) {
        showToast('Impressão via de conferência enviada para a fila!', 'success');
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

  const mapComandaToDeliveryView = (c: any): DeliveryOrderView => {
    const itemCounts: { [name: string]: number } = {};
    const itensArr = Array.isArray(c?.itens) ? c.itens : Array.isArray(c?.items) ? c.items : [];
    const activeItems = itensArr.filter((it: any) => it.status !== 'cancelado');
    activeItems.forEach((it: any) => {
      if (it.status !== 'cancelado') {
        const name = it.produto?.nome || it.nome || 'Item';
        itemCounts[name] = (itemCounts[name] || 0) + 1;
      }
    });
    const itensStr =
      Object.entries(itemCounts)
        .map(([name, qty]) => `${qty}x ${name}`)
        .join(' + ') || 'Nenhum item';

    const subtotal = activeItems.reduce((sum: number, it: any) => sum + (it.preco_unit || it.preco || 0), 0);
    const total = subtotal + (c.delivery_taxa || 0);

    const parsedTime = formatBackendTime(c.criado_em);
    const criadoEm = parsedTime === '—' ? '12:00' : parsedTime;

    const origins = (Array.isArray(c?.lancamentos) ? c.lancamentos : []).map((launch: any) =>
      String(launch?.origem || '').toLowerCase()
    );
    const origemOperacional: DeliveryOrderView['origemOperacional'] = origins.includes('smartpos')
      ? 'smartpos'
      : origins.includes('cardapio')
        ? 'cardapio'
        : origins.includes('caixa')
          ? 'caixa'
          : origins.includes('garcom')
            ? 'garcom'
            : 'desconhecida';

    let canal: DeliveryOrderView['canal'] = origemOperacional === 'smartpos' ? 'smartpos' : 'site';
    if (c.identificador && c.identificador.toLowerCase().includes('ifood')) {
      canal = 'ifood';
    } else if (c.identificador && c.identificador.toLowerCase().includes('whats')) {
      canal = 'whats';
    }

    const rawAddress = String(c.delivery_endereco || '').trim();
    const rawType = String(c.tipo || '').toLowerCase();
    const modalidade =
      rawType === 'retirada' || /retirada\s+no\s+balc[aã]o/i.test(rawAddress) ? 'retirada' : 'delivery';
    const isQuickSale =
      modalidade === 'retirada' &&
      (origemOperacional === 'smartpos' ||
        (String(c.identificador || '')
          .trim()
          .toLowerCase() === 'balcão' &&
          !String(c.delivery_telefone || '').trim()));

    return {
      id: c.id,
      cliente: c.identificador || 'Cliente Sem Nome',
      telefone: c.delivery_telefone || '',
      itens: itensStr,
      total: total,
      canal: canal,
      origemOperacional,
      isQuickSale,
      quantidadeItens: activeItems.length,
      modalidade,
      pago: activeItems.length > 0 && activeItems.every((it: any) => Boolean(it.pago)),
      status: c.delivery_status || 'pendente',
      endereco: modalidade === 'delivery' ? rawAddress : '',
      criadoEm: criadoEm,
      created_at: c.criado_em,
      numeroPedido: c.numero_pedido,
    };
  };

  const fetchDeliveryOrders = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/delivery/ativos`, {
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        const mapped = data.map(mapComandaToDeliveryView);
        setDeliveryOrders(mapped);
      }
    } catch (err) {
      console.error('Error fetching delivery orders', err);
    }
  };

  const fetchMotoboys = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/motoboys/lista`, {
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        setMotoboys(data);
      }
    } catch (err) {
      console.error('Error fetching motoboys', err);
    }
  };

  useEffect(() => {
    fetchDeliveryOrders();
    fetchMotoboys();

    const handleDeliveryUpdate = () => {
      fetchDeliveryOrders();
    };

    window.addEventListener('koma_orders_updated', handleDeliveryUpdate);
    return () => {
      window.removeEventListener('koma_orders_updated', handleDeliveryUpdate);
    };
  }, [apiBaseUrl]);

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
      : order.itens.split(' + ').map((itStr: string) => {
          const match = itStr.match(/^(\d+)x\s+(.+)$/);
          return {
            nome: match ? match[2] : itStr,
            observacao: '',
            cliente_nome: 'Consumo Geral',
            status: order.status === 'pronto' ? 'pronto' : order.status === 'transito' ? 'entregue' : 'preparando',
            lancamentoId: undefined,
          };
        });

    setSelectedKanbanOrder({
      id: order.id,
      comandaId: order.id,
      mesaId: 0,
      quantidadeItens: order.quantidadeItens,
      identificador: order.cliente,
      itens: itemsMapped,
      total: order.total,
      numeroPedido: order.numeroPedido,
      origemOperacional: order.origemOperacional,
      isQuickSale: order.isQuickSale,
      modalidade: order.modalidade,
      deliveryStatus: order.status,
      canal: order.canal,
      telefone: order.telefone,
      endereco: order.endereco,
      criadoEm: order.criadoEm,
      created_at: order.created_at,
      lancamentoId: itemsMapped.find((item: any) => item.lancamentoId)?.lancamentoId,
    });
  };

  const handleUpdateDeliveryStatus = async (orderId: string, statusNovo: string) => {
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/${orderId}/delivery/status?status_novo=${statusNovo}`, {
        method: 'PUT',
        headers: authHeaders,
      });
      if (res.ok) {
        fetchDeliveryOrders();
        onRefreshOrders();
        showToast('Status atualizado e cliente avisado automaticamente!');
        return true;
      } else {
        showToast('Erro ao atualizar status do pedido.', 'error');
        return false;
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao atualizar status.', 'error');
      return false;
    }
  };

  const handleDespacharKanban = async (orderId: string, selectedMotoboyId: string) => {
    if (!selectedMotoboyId) {
      showToast('Selecione um motoboy para despachar o pedido!', 'info');
      return;
    }
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/${orderId}/delivery/despachar`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ motoboy_id: Number(selectedMotoboyId) }),
      });
      if (res.ok) {
        showToast('Pedido despachado; motoboy e cliente avisados automaticamente!');
        setSelectedKanbanOrder(null);
        fetchDeliveryOrders();
        onRefreshOrders();
      } else {
        const err = await res.json();
        showToast(`Erro ao despachar: ${err.detail}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao despachar.', 'error');
    }
  };

  const handleRevogarAcessoMotoboy = async (selectedMotoboyId: string) => {
    if (!selectedMotoboyId) {
      showToast('Selecione um motoboy para revogar o acesso!', 'info');
      return;
    }
    const mb = motoboys.find((m) => String(m.id) === String(selectedMotoboyId));
    if (!mb) {
      showToast('Motoboy não encontrado.', 'error');
      return;
    }
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/motoboys/${selectedMotoboyId}/revogar-link`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (res.ok) {
        showToast(`Acesso do entregador '${mb.nome}' revogado com sucesso!`, 'success');
      } else {
        showToast('Não foi possível revogar o acesso.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao tentar revogar o acesso.', 'error');
    }
  };

  const handleFecharDelivery = async (orderId: string) => {
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/${orderId}/fechar`, {
        method: 'PUT',
        headers: authHeaders,
      });
      if (res.ok) {
        showToast('Comanda de delivery encerrada com sucesso!');
        setSelectedKanbanOrder(null);
        fetchDeliveryOrders();
        onRefreshOrders();
      } else {
        showToast('Erro ao fechar comanda.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao finalizar pedido.', 'error');
    }
  };

  const handleRecusarPedido = async (orderId: string) => {
    await handleUpdateDeliveryStatus(orderId, 'recusado');
  };

  const handleFinalizarPedido = async (orderId: string) => {
    await handleFecharDelivery(orderId);
  };

  const handleAddMotoboy = async (e: React.FormEvent, newMotoboyNome: string, newMotoboyTelefone: string) => {
    e.preventDefault();
    if (!newMotoboyNome.trim() || !newMotoboyTelefone.trim()) return;
    try {
      const res = await fetch(`${apiBaseUrl}/comandas/motoboys`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: newMotoboyNome,
          telefone: newMotoboyTelefone,
          ativo: true,
        }),
      });
      if (res.ok) {
        showToast('Fretista cadastrado com sucesso!');
        await fetchMotoboys();
        setNewMotoboyNome('');
        setNewMotoboyTelefone('');
      } else {
        showToast('Erro ao cadastrar fretista.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao cadastrar fretista.', 'error');
    }
  };

  // KDS Kitchen actions (status updates)
  const handleUpdateItemStatus = async (itemId: string, newStatus: 'preparando' | 'pronto' | 'entregue') => {
    // 1. Atualização Otimista Instantânea (0ms no front-end)
    if (onOptimisticUpdateItemStatus) {
      onOptimisticUpdateItemStatus(itemId, newStatus);
    }
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
    // Close drawer if no more pending
    if (deliveryOrders.filter((o) => o.status === 'pendente').length <= 1) setIsDrawerOpen(false);
  };

  const handleRejectPendingDeliveryOrder = async (order: DeliveryOrderView) => {
    await handleRecusarPedido(order.id);
    if (deliveryOrders.filter((o) => o.status === 'pendente').length <= 1) setIsDrawerOpen(false);
  };

  const handleMarkTableItemsReady = async (order: CashierTableCard['order']) => {
    if (isLoading) return;
    const ids = deriveProductionState(order.itens).preparingItems.map((item) => item.id);
    if (onOptimisticUpdateItemStatus && ids.length > 0) {
      onOptimisticUpdateItemStatus(ids, 'pronto');
    }
    setIsLoading(true);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`${apiBaseUrl}/comandas/itens/${id}/status?status=pronto`, {
            method: 'PUT',
            headers: authHeaders,
          })
        )
      );
    } catch (err) {
      console.error(err);
      onRefreshOrders();
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdvanceDigitalOrder = async (order: DeliveryOrderView) => {
    if (isLoading) return;
    const isDeliveryOrder = order.modalidade === 'delivery';
    handleUpdateDeliveryStatus(order.id, isDeliveryOrder ? 'transito' : 'pronto');
  };

  const handleAdvanceSelectedKanbanOrder = async () => {
    const isDelivery = selectedKanbanOrder.modalidade === 'delivery';
    const updated = await handleUpdateDeliveryStatus(selectedKanbanOrder.id, isDelivery ? 'transito' : 'pronto');
    if (updated) setSelectedKanbanOrder(null);
  };

  const handleReprintSelectedKanbanProduction = async () => {
    try {
      const printUrl = selectedKanbanOrder.lancamentoId
        ? `${apiBaseUrl}/comandas/lancamentos/${selectedKanbanOrder.lancamentoId}/reimprimir`
        : `${apiBaseUrl}/comandas/${selectedKanbanOrder.comandaId || selectedKanbanOrder.id}/imprimir-recibo`;
      const res = await fetch(printUrl, {
        method: 'POST',
        headers: authHeaders,
      });
      if (res.ok) {
        window.dispatchEvent(new Event('koma_print_monitor_refresh'));
        setSelectedKanbanOrder(null);
      } else {
        showToast('Erro ao solicitar reimpressão.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao solicitar reimpressão.', 'error');
    }
  };

  const handlePrintSelectedKanbanTable = async () => {
    try {
      const url = `${apiBaseUrl}/mesas/${selectedKanbanOrder.mesaId}/imprimir-recibo?apenas_valores=false`;
      const response = await fetch(url, {
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
      const url = `${apiBaseUrl}/mesas/${selectedKanbanOrder.mesaId}/imprimir-recibo?apenas_valores=true`;
      const response = await fetch(url, {
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
      showToast('Erro ao imprimir apenas valores.', 'error');
    }
  };

  const handleInspectSalonTable = (tableOrders: Order[], focusTransfer = false) =>
    tableOrders[0] &&
    setSelectedKanbanOrder({
      ...tableOrders[0],
      projectionScope: 'table',
      contextoSalao: true,
      focusTransfer,
      tableContext: describeTableOrders(tableOrders),
      itens: tableOrders.flatMap((order) => order.itens || []),
      comandaIds: tableOrders.map((order) => order.id),
    });

  const handleTransferSelectedKanbanTable = () => handleTransferTableFromSalon(selectedKanbanOrder);

  const handleCancelSelectedKanbanConsumption = () =>
    selectedKanbanOrder.contextoSalao
      ? openCancelTableConfirmation(Number(selectedKanbanOrder.mesaId))
      : openCancelOrderConfirmation(selectedKanbanOrder);

  const handleCancelSelectedKanbanOrder = () => openCancelOrderConfirmation(selectedKanbanOrder);

  return {
    selectedKanbanOrder,
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
    motoboys,
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
    handleDespacharKanban,
    handleRevogarAcessoMotoboy,
    handleFecharDelivery,
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
    handleCancelSelectedKanbanConsumption,
    handleCancelSelectedKanbanOrder,
  };
}
