import React, { useEffect, useMemo, useState } from 'react';
import { isCashierTableOrder as isTableCheckoutOrder } from '../../../domain/cashierOrderProjection';
import type { Order, OrderItem } from '../../../types';
import { operationalFetch } from '../../../utils/operationalRequest';
import type { CaixaPanelProps, CashierNotice, LoyaltyCustomer } from '../cashierContracts';
import type {
  CashierTableCard,
  DeliveryOrderView,
  PendingCashPayment,
  SmartPosCardState,
} from '../orders/cashierWorkspaceTypes';

type Props = Pick<
  CaixaPanelProps,
  | 'orders'
  | 'apiBaseUrl'
  | 'authHeaders'
  | 'onRefreshOrders'
  | 'onRemovePendingPaymentOptimistic'
  | 'onRefreshPagamentosPendentes'
> & {
  showToast: CashierNotice;
  loyaltyUsers: LoyaltyCustomer[];
  taxaServicoAtiva: boolean;
  serviceTaxRate: number;
  isLoading: boolean;
  setErrorMsg: (value: string) => void;
  getSmartPosCardState: (order: Order) => SmartPosCardState | null;
  setSmartPosRecoveryError: (value: string) => void;
  fetchTurno: () => Promise<void>;
  handleFecharDelivery: (id: string) => Promise<void>;
  handleFinalizarPedido: (id: string) => Promise<void>;
};

/** Owns checkout state, effects and actions; composition supplies only cross-feature dependencies. */
export function useCheckoutController({
  orders,
  apiBaseUrl,
  authHeaders,
  onRefreshOrders,
  onRemovePendingPaymentOptimistic,
  onRefreshPagamentosPendentes,
  showToast,
  loyaltyUsers,
  taxaServicoAtiva,
  serviceTaxRate,
  isLoading,
  setErrorMsg,
  getSmartPosCardState,
  setSmartPosRecoveryError,
  fetchTurno,
  handleFecharDelivery,
  handleFinalizarPedido,
}: Props) {
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  const isProcessingPaymentRef = React.useRef(false);
  // Synchronous guard against double-click
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const buildTableCheckoutOrder = (tableComandas: Order[]): Order | null => {
    if (tableComandas.length === 0) return null;

    const primaryComanda = tableComandas[0];
    const combinedItems = tableComandas.flatMap((comanda) => {
      const arr = Array.isArray(comanda?.itens) ? comanda.itens : Array.isArray(comanda?.items) ? comanda.items : [];
      return arr.map((item: any) => ({
        id: item.id,
        produtoId: item.produto_id || item.produtoId,
        nome: item.nome || `Item ${item.produto_id || item.produtoId}`,
        preco: item.preco_unit || item.preco,
        observacao: item.observacao || '',
        clienteNome: item.cliente_nome || item.clienteNome || 'Consumo Geral',
        status: item.status,
        pago: item.pago,
        comandaId: comanda.id,
      }));
    });

    return {
      ...primaryComanda,
      valorPago: tableComandas.reduce((sum, comanda) => sum + Number(comanda.valorPago || 0), 0),
      itens: combinedItems,
      comandaIds: tableComandas.map((comanda) => comanda.id),
    } as Order;
  };

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const [showCheckoutModal, setShowCheckoutModal] = useState(false);

  const identifiedCustomer = useMemo(() => {
    if (!selectedOrder) return null;

    // 1. Direct phone on selectedOrder
    const directPhone = (
      selectedOrder.clientePhone ||
      (selectedOrder as any).delivery_telefone ||
      (selectedOrder as any).telefone ||
      (selectedOrder as any).cliente?.telefone ||
      ''
    ).trim();

    // 2. Direct client ID
    const directClientId = selectedOrder.clienteId || (selectedOrder as any).cliente_id;
    if (directClientId) {
      const user = loyaltyUsers.find((u) => String(u.id) === String(directClientId));
      if (user) {
        return {
          id: user.id,
          nome: user.cliente || user.nome || selectedOrder.identificador || 'Cliente',
          telefone: user.telefone || directPhone || '',
          saldoCashback: Number(user.saldoCashback ?? user.saldo_cashback ?? 0),
          pontos: Number(user.pontos ?? user.saldo_pontos ?? 0),
        };
      }
    }

    if (directPhone) {
      const cleanPhone = directPhone.replace(/\D/g, '');
      const user = loyaltyUsers.find((u) => (u.telefone || '').replace(/\D/g, '') === cleanPhone);
      if (user) {
        return {
          id: user.id,
          nome: user.cliente || user.nome || selectedOrder.identificador || 'Cliente',
          telefone: user.telefone,
          saldoCashback: Number(user.saldoCashback ?? user.saldo_cashback ?? 0),
          pontos: Number(user.pontos ?? user.saldo_pontos ?? 0),
        };
      }
      return {
        id: null,
        nome: selectedOrder.identificador || 'Cliente',
        telefone: directPhone,
        saldoCashback: 0,
        pontos: 0,
      };
    }

    // 3. Match by item.clienteNome or selectedOrder.identificador in loyaltyUsers
    const nameToMatch = (selectedOrder.identificador || '').trim().toLowerCase();
    if (nameToMatch && nameToMatch !== 'consumo geral') {
      const user = loyaltyUsers.find(
        (u) =>
          (u.cliente || '').trim().toLowerCase() === nameToMatch || (u.nome || '').trim().toLowerCase() === nameToMatch
      );
      if (user && user.telefone) {
        return {
          id: user.id,
          nome: user.cliente || user.nome,
          telefone: user.telefone,
          saldoCashback: Number(user.saldoCashback ?? user.saldo_cashback ?? 0),
          pontos: Number(user.pontos ?? user.saldo_pontos ?? 0),
        };
      }
    }

    // 4. Check items for client name that matches a registered customer with phone
    for (const item of selectedOrder.itens || []) {
      const itName = (item.clienteNome || '').trim().toLowerCase();
      if (itName && itName !== 'consumo geral') {
        const user = loyaltyUsers.find(
          (u) => (u.cliente || '').trim().toLowerCase() === itName || (u.nome || '').trim().toLowerCase() === itName
        );
        if (user && user.telefone) {
          return {
            id: user.id,
            nome: user.cliente || user.nome,
            telefone: user.telefone,
            saldoCashback: Number(user.saldoCashback ?? user.saldo_cashback ?? 0),
            pontos: Number(user.pontos ?? user.saldo_pontos ?? 0),
          };
        }
      }
    }

    return null;
  }, [selectedOrder, loyaltyUsers]);

  // Counted values for closing cashier

  // Checkout payment states
  const [checkoutServiceTax, setCheckoutServiceTax] = useState(true);

  const [splitPeople, setSplitPeople] = useState('1');

  const [paymentMetodo, setPaymentMetodo] = useState<
    'dinheiro' | 'pix' | 'cartao' | 'cartao_debito' | 'cartao_credito'
  >('pix');

  const [paymentValor, setPaymentValor] = useState<number | ''>('');

  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);

  const [paymentCPF, setPaymentCPF] = useState('');

  // Generate idempotency key when checkout order changes
  useEffect(() => {
    if (selectedOrder) {
      setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    } else {
      setIdempotencyKey('');
    }
  }, [selectedOrder]);

  // Auto-initialize paymentValor when checkout modal opens. Mesas priorizam itens prontos;
  // sem itens prontos, o operador precisa optar conscientemente por um adiantamento.
  useEffect(() => {
    if (showCheckoutModal && selectedOrder) {
      if (!paymentValor || Number(paymentValor || 0) <= 0) {
        const readyItemIds = selectedOrder.itens
          .filter((item) => !item.pago && isItemReadyForCheckout(item))
          .map((item) => item.id);
        const balance = isTableCheckoutOrder(selectedOrder)
          ? readyItemIds.length > 0
            ? getSelectedItemsTotal(selectedOrder, readyItemIds)
            : 0
          : getCheckoutBalance(selectedOrder);
        if (balance > 0) {
          setPaymentValor(balance);
        }
      }
    } else if (!showCheckoutModal) {
      setPaymentValor('');
    }
  }, [showCheckoutModal, selectedOrder]);

  // Handle payment processing
  const handleProcessPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || isProcessingPaymentRef.current) return; // Sync ref guard
    const smartPosState = getSmartPosCardState(selectedOrder);
    if (smartPosState?.blocksPayment) {
      setSmartPosRecoveryError('Revise a operação da maquininha antes de lançar outra baixa para esta mesa.');
      return;
    }
    isProcessingPaymentRef.current = true;
    setErrorMsg('');
    setIsProcessingPayment(true);

    try {
      let valorPagamento = Number(paymentValor || 0);
      if (!Number.isFinite(valorPagamento) || valorPagamento <= 0) {
        const autoBalance = getCheckoutBalance(selectedOrder);
        if (autoBalance > 0) {
          valorPagamento = autoBalance;
        } else {
          throw new Error('Informe um valor de pagamento maior que zero.');
        }
      }

      const comandaIds: string[] = (selectedOrder as any).comandaIds || [selectedOrder.id];
      const isMesaPayment = isTableCheckoutOrder(selectedOrder);
      const effectiveIdempotencyKey = idempotencyKey || `idem-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      if (selectedItemIds.length > 0) {
        const totalSelecionado = getSelectedItemsTotal(selectedOrder, selectedItemIds);
        if (Math.abs(valorPagamento - totalSelecionado) > 0.01) {
          throw new Error(
            'Para pagar itens marcados, use o valor total da seleção. ' + 'Limpe a seleção para lançar um valor livre.'
          );
        }
      }

      const effectiveClienteId = identifiedCustomer?.id || selectedOrder.clienteId || null;
      const effectiveCpfOrPhone = (identifiedCustomer?.telefone || paymentCPF).replace(/\D/g, '') || null;
      const effectiveClienteNome = identifiedCustomer?.nome || selectedOrder.identificador || null;

      if (isMesaPayment) {
        // A mesa é uma única conta monetária. O backend distribui esta baixa,
        // de forma atômica, entre todas as comandas abertas da mesa. A seleção
        // é opcional e serve para registrar quais itens foram quitados.
        const res = await operationalFetch(`${apiBaseUrl}/caixa/mesas/${selectedOrder.mesaId}/pagar`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            valor: valorPagamento,
            metodo: paymentMetodo,
            incluir_taxa_servico: taxaServicoAtiva && checkoutServiceTax,
            item_ids: selectedItemIds.length > 0 ? selectedItemIds : null,
            idempotency_key: effectiveIdempotencyKey,
            cliente_id: effectiveClienteId,
            cpf_cliente: effectiveCpfOrPhone,
            nome_cliente: effectiveClienteNome,
          }),
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.detail || 'Erro ao registrar pagamento da mesa');
        }
      } else if (selectedItemIds.length > 0) {
        // Opção 1: Itens selecionados. Agrupa os IDs de itens pela comanda de origem
        const itemsByComanda: Record<string, { itemIds: string[]; subtotal: number }> = {};
        selectedItemIds.forEach((itemId) => {
          const itemObj = selectedOrder.itens.find((i) => i.id === itemId);
          if (itemObj) {
            const cid = itemObj.comandaId || selectedOrder.id;
            if (!itemsByComanda[cid]) {
              itemsByComanda[cid] = { itemIds: [], subtotal: 0 };
            }
            itemsByComanda[cid].itemIds.push(itemId);
            itemsByComanda[cid].subtotal += itemObj.preco;
          }
        });

        // Efetua o pagamento em cada comanda correspondente
        const comandaEntries = Object.entries(itemsByComanda);
        let idx = 0;
        const totalSubtotal = Object.values(itemsByComanda).reduce((sum, d) => sum + d.subtotal, 0);
        const originalVal = Number(paymentValor || 0);

        for (const [cid, data] of comandaEntries) {
          const isLast = idx === comandaEntries.length - 1;
          // Distribui o valor proporcionalmente baseado no subtotal
          const ratio = data.subtotal / totalSubtotal;
          const valToPay = isLast
            ? originalVal -
              comandaEntries
                .slice(0, idx)
                .reduce((sum, entry) => sum + (entry[1].subtotal / totalSubtotal) * originalVal, 0)
            : originalVal * ratio;

          const res = await operationalFetch(`${apiBaseUrl}/caixa/comandas/${cid}/pagar`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              valor: parseFloat(valToPay.toFixed(2)),
              metodo: paymentMetodo,
              item_ids: data.itemIds,
              idempotency_key: `${effectiveIdempotencyKey}-${cid}`,
              cliente_id: effectiveClienteId,
              cpf_cliente: effectiveCpfOrPhone,
              nome_cliente: effectiveClienteNome,
            }),
          });
          if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.detail || `Erro ao pagar itens da comanda ${cid}`);
          }
          idx++;
        }
      } else {
        // Opção 2: Valor geral. Liquida as comandas sequencialmente
        let remainingVal = Number(paymentValor || 0);

        for (const cid of comandaIds) {
          if (remainingVal <= 0.01) break;

          // Busca itens pendentes desta comanda no card unificado
          const comUnpaidItems = selectedOrder.itens.filter(
            (i) => i.comandaId === cid && !i.pago && i.status !== ('cancelado' as any)
          );
          if (comUnpaidItems.length === 0) continue;

          const comSubtotal = comUnpaidItems.reduce((sum, item) => sum + item.preco, 0);
          const comTaxa = taxaServicoAtiva && checkoutServiceTax ? comSubtotal * (serviceTaxRate / 100) : 0;
          const comTotal = comSubtotal + comTaxa;

          // Valor a pagar para esta comanda
          const valToPay = Math.min(remainingVal, comTotal);

          const res = await operationalFetch(`${apiBaseUrl}/caixa/comandas/${cid}/pagar`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              valor: parseFloat(valToPay.toFixed(2)),
              metodo: paymentMetodo,
              item_ids: null,
              idempotency_key: `${effectiveIdempotencyKey}-${cid}`,
              cliente_id: effectiveClienteId,
              cpf_cliente: effectiveCpfOrPhone,
              nome_cliente: effectiveClienteNome,
            }),
          });
          if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.detail || `Erro ao registrar pagamento na comanda ${cid}`);
          }
          remainingVal -= valToPay;
        }
      }

      setPaymentValor('');
      setPaymentCPF('');
      setSelectedItemIds([]);
      setIdempotencyKey(`idem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

      setSelectedOrder(null);
      setShowCheckoutModal(false);
      await Promise.all([onRefreshOrders(), fetchTurno()]);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro de conexão ao servidor.');
    } finally {
      isProcessingPaymentRef.current = false;
      setIsProcessingPayment(false);
    }
  };

  const isItemReadyForCheckout = (item: OrderItem, order?: Order | null) => {
    if (item.status === 'pronto' || item.status === 'entregue') return true;
    const currentOrder = order || selectedOrder;
    if (
      currentOrder &&
      !isTableCheckoutOrder(currentOrder) &&
      ['pronto', 'transito', 'saiu_para_entrega'].includes(
        String(currentOrder.deliveryStatus || currentOrder.status || '')
      )
    ) {
      return (item.status as string) !== 'cancelado';
    }
    return false;
  };

  // Checkout calculations helper
  const getCheckoutTotals = (order: Order, includeServiceTax = checkoutServiceTax) => {
    // Em mesa, Item.pago é apenas histórico visual: o saldo é financeiro e
    // corresponde ao consumo ativo menos Pagamento(s) aprovados.
    const chargeableItems = isTableCheckoutOrder(order)
      ? order.itens.filter((i) => (i.status as string) !== 'cancelado')
      : order.itens.filter((i) => !i.pago && (i.status as string) !== 'cancelado');
    const subtotal = chargeableItems.reduce((sum, item) => sum + item.preco, 0);
    const taxa = taxaServicoAtiva && includeServiceTax ? subtotal * (serviceTaxRate / 100) : 0;
    const total = subtotal + taxa;
    return { subtotal, taxa, total, chargeableItems };
  };

  const getCheckoutBalance = (order: Order, includeServiceTax = checkoutServiceTax) => {
    const { total } = getCheckoutTotals(order, includeServiceTax);
    return Math.max(0, total - Number(order.valorPago || 0));
  };

  const getSelectedItemsTotal = (order: Order, itemIds: string[], includeServiceTax = checkoutServiceTax) => {
    const selectedItems = order.itens.filter(
      (item) =>
        itemIds.includes(item.id) &&
        !item.pago &&
        (item.status as string) !== 'cancelado' &&
        isItemReadyForCheckout(item)
    );
    const subtotal = selectedItems.reduce((sum, item) => sum + item.preco, 0);
    const taxa = taxaServicoAtiva && includeServiceTax ? subtotal * (serviceTaxRate / 100) : 0;
    const selectedTotal = subtotal + taxa;

    // Na mesa, uma baixa anterior sem vínculo com itens pode deixar o saldo
    // menor que a seleção. Nesse caso, o máximo devido continua sendo o saldo.
    return isTableCheckoutOrder(order)
      ? Math.min(selectedTotal, getCheckoutBalance(order, includeServiceTax))
      : selectedTotal;
  };

  const handleOpenTablePayment = async (order: CashierTableCard['order']) => {
    if (isLoading) return;

    const tableComandas = orders.filter((o) => Number(o.mesaId) === Number(order.mesaId) && isTableCheckoutOrder(o));
    const checkoutOrder = buildTableCheckoutOrder(tableComandas);
    if (!checkoutOrder) return;

    const readyItemIds = checkoutOrder.itens
      .filter((item) => !item.pago && isItemReadyForCheckout(item))
      .map((item) => item.id);
    setSelectedOrder(checkoutOrder);
    setShowCheckoutModal(true);
    setCheckoutServiceTax(true);
    setSplitPeople('1');
    setSelectedItemIds(readyItemIds);
    setSmartPosRecoveryError('');
    const readyTotal = readyItemIds.length > 0 ? getSelectedItemsTotal(checkoutOrder, readyItemIds, true) : 0;
    setPaymentValor(readyTotal > 0 ? readyTotal : '');
  };

  const handleFinalizeDigitalOrder = async (order: DeliveryOrderView) => {
    if (isLoading) return;
    if (order.pago) {
      await handleFecharDelivery(order.id);
      return;
    }
    const fullOrder = orders.find((o) => o.id === order.id);
    if (fullOrder) {
      const mappedOrder: Order = {
        ...fullOrder,
        deliveryStatus: (order.status === 'analise' ? 'pendente' : order.status) as Order['deliveryStatus'],
        itens: fullOrder.itens.map((item: any) => ({
          id: item.id,
          produtoId: item.produto_id || item.produtoId,
          nome: item.nome || `Item ${item.produtoId}`,
          preco: item.preco_unit || item.preco,
          observacao: item.observacao || '',
          clienteNome: item.cliente_nome || item.clienteNome || 'Consumo Geral',
          status:
            item.status === 'preparando' && ['pronto', 'transito', 'saiu_para_entrega'].includes(order.status)
              ? 'pronto'
              : item.status,
          pago: item.pago,
        })),
      };
      const activeUnpaidItemIds = mappedOrder.itens
        .filter((item: any) => !item.pago && (item.status as string) !== 'cancelado')
        .map((item: any) => item.id);
      setSelectedOrder(mappedOrder);
      setShowCheckoutModal(true);
      setCheckoutServiceTax(false);
      setSplitPeople('1');
      setSelectedItemIds(activeUnpaidItemIds);
      const sub = mappedOrder.itens
        .filter((item: any) => !item.pago && (item.status as string) !== 'cancelado')
        .reduce((s: number, it: any) => s + (it.preco_unit || it.preco || 0), 0);
      setPaymentValor(sub);
    } else {
      handleFinalizarPedido(order.id);
    }
  };

  const handleReceiveSalonTable = (tableOrders: Order[]) => {
    const checkoutOrder = buildTableCheckoutOrder(tableOrders);
    if (!checkoutOrder) return;
    setSelectedOrder(checkoutOrder);
    setShowCheckoutModal(true);
    setCheckoutServiceTax(true);
    setSplitPeople('1');
    setSelectedItemIds([]);
    const subtotal = checkoutOrder.itens
      .filter((item) => (item.status as string) !== 'cancelado')
      .reduce((sum, item) => sum + item.preco, 0);
    const checkoutTotal = subtotal * (1.0 + (taxaServicoAtiva ? serviceTaxRate / 100 : 0));
    setPaymentValor(Math.max(0, checkoutTotal - Number(checkoutOrder.valorPago || 0)));
  };

  const printCheckoutReceipt = async () => {
    if (!selectedOrder) return;
    try {
      const url = `${apiBaseUrl}/mesas/${selectedOrder.mesaId}/imprimir-recibo?apenas_valores=false`;

      const response = await fetch(url, {
        method: 'POST',
        headers: authHeaders,
      });
      if (response.ok) {
        window.dispatchEvent(new Event('koma_print_monitor_refresh'));
      } else {
        const err = await response.json();
        alert(`Erro ao imprimir: ${err.detail}`);
      }
    } catch (err) {
      console.error(err);
      alert('Erro de conexão ao imprimir extrato.');
    }
  };

  const printCheckoutValues = async () => {
    if (!selectedOrder) return;
    try {
      const url = `${apiBaseUrl}/mesas/${selectedOrder.mesaId}/imprimir-recibo?apenas_valores=true`;

      const response = await fetch(url, {
        method: 'POST',
        headers: authHeaders,
      });
      if (response.ok) {
        window.dispatchEvent(new Event('koma_print_monitor_refresh'));
      } else {
        const err = await response.json();
        alert(`Erro ao imprimir: ${err.detail}`);
      }
    } catch (err) {
      console.error(err);
      alert('Erro de conexão ao imprimir extrato resumido.');
    }
  };

  // Complete actions stay with the state/effects owner; extracted views only request them.
  const handleConfirmPendingCashPayment = async (pag: PendingCashPayment) => {
    if (onRemovePendingPaymentOptimistic) onRemovePendingPaymentOptimistic(pag.id);
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/pagamentos/${pag.id}/aprovar`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (res.ok) {
        showToast('Pagamento em dinheiro confirmado!');
        onRefreshOrders();
        if (onRefreshPagamentosPendentes) onRefreshPagamentosPendentes();
      } else {
        if (onRefreshPagamentosPendentes) onRefreshPagamentosPendentes();
      }
    } catch (e) {
      console.error(e);
      if (onRefreshPagamentosPendentes) onRefreshPagamentosPendentes();
    }
  };

  const handleRejectPendingCashPayment = async (pag: PendingCashPayment) => {
    if (onRemovePendingPaymentOptimistic) onRemovePendingPaymentOptimistic(pag.id);
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/pagamentos/${pag.id}/recusar`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (res.ok) {
        showToast('Pagamento recusado.');
        onRefreshOrders();
        if (onRefreshPagamentosPendentes) onRefreshPagamentosPendentes();
      } else {
        if (onRefreshPagamentosPendentes) onRefreshPagamentosPendentes();
      }
    } catch (e) {
      console.error(e);
      if (onRefreshPagamentosPendentes) onRefreshPagamentosPendentes();
    }
  };
  return {
    handleConfirmPendingCashPayment,
    handleRejectPendingCashPayment,
    printCheckoutReceipt,
    printCheckoutValues,
    isProcessingPayment,
    selectedOrder,
    setSelectedOrder,
    showCheckoutModal,
    setShowCheckoutModal,
    identifiedCustomer,
    checkoutServiceTax,
    setCheckoutServiceTax,
    splitPeople,
    setSplitPeople,
    paymentMetodo,
    setPaymentMetodo,
    paymentValor,
    setPaymentValor,
    selectedItemIds,
    setSelectedItemIds,
    paymentCPF,
    setPaymentCPF,
    handleProcessPayment,
    isItemReadyForCheckout,
    getCheckoutTotals,
    getCheckoutBalance,
    getSelectedItemsTotal,
    handleOpenTablePayment,
    handleFinalizeDigitalOrder,
    handleReceiveSalonTable,
  };
}

export type CheckoutController = ReturnType<typeof useCheckoutController>;
