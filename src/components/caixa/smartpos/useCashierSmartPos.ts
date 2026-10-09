import { snapshotFetch as fetch } from '../../../utils/snapshotFetch';
import { orderUpdateAffects } from '../../../utils/orderUpdate';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Order } from '../../../types';
import { operationalFetch } from '../../../utils/operationalRequest';
import { createVisibleRefresh, smartPosFallbackInterval } from '../../../utils/visibleRefresh';
import type { CaixaPanelProps, CashierNotice } from '../cashierContracts';
import type { SmartPosCardState } from '../orders/cashierWorkspaceTypes';

interface SmartPosCashPaymentView {
  intent_id: string;
  status: string;
  metodo?: string;
  provider_last_error?: string | null;
  pagamento_id?: string | null;
}

interface SmartPosCashRow {
  mesa_id: number;
  estado_operacional:
    | 'em_preparo'
    | 'pronto'
    | 'aguardando_pagamento'
    | 'pagamento_processando'
    | 'aprovado_pendente_liquidacao';
  origem_smartpos?: boolean;
  pagamento?: SmartPosCashPaymentView | null;
}

type Props = Pick<CaixaPanelProps, 'apiBaseUrl' | 'authHeaders' | 'onRefreshOrders' | 'isWsConnected'> & {
  activeSubTab: string;
  showToast: CashierNotice;
  fetchTurno: () => Promise<void>;
  onReconciled: () => void;
};

/** Owns smartpos state, effects and actions; composition supplies only cross-feature dependencies. */
export function useCashierSmartPos({
  apiBaseUrl,
  isWsConnected = false,
  authHeaders,
  onRefreshOrders,
  activeSubTab,
  showToast,
  fetchTurno,
  onReconciled,
}: Props) {
  const [smartPosCashRows, setSmartPosCashRows] = useState<SmartPosCashRow[]>([]);

  const [isReconcilingSmartPos, setIsReconcilingSmartPos] = useState(false);

  const [smartPosRecoveryError, setSmartPosRecoveryError] = useState('');

  const smartPosAuthorization = authHeaders.Authorization || authHeaders.authorization || '';

  const smartPosCashByTable = useMemo(
    () => new Map(smartPosCashRows.map((row) => [Number(row.mesa_id), row])),
    [smartPosCashRows]
  );

  const refreshSmartPosCashProjection = useCallback(async () => {
    if (activeSubTab !== 'pedidos' || !smartPosAuthorization) {
      setSmartPosCashRows([]);
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/auth/smartpos/caixa/operacao`, {
        headers: { Authorization: smartPosAuthorization },
        cache: 'no-store',
      });
      if (response.status === 401 || response.status === 403) {
        setSmartPosCashRows([]);
        return;
      }
      if (!response.ok) return;
      const data = await response.json().catch(() => []);
      setSmartPosCashRows(Array.isArray(data) ? data : []);
    } catch {
      // A fila principal continua utilizável; o próximo refresh reconcilia o indicador.
    }
  }, [activeSubTab, apiBaseUrl, smartPosAuthorization]);

  useEffect(() => {
    if (activeSubTab !== 'pedidos' || !smartPosAuthorization) {
      setSmartPosCashRows([]);
      return;
    }

    const refresh = createVisibleRefresh(refreshSmartPosCashProjection, () => !document.hidden);
    refresh.invalidate();
    const timer = window.setInterval(refresh.tick, smartPosFallbackInterval(isWsConnected));
    window.addEventListener('focus', refresh.resume);
    const onOrdersUpdated = (event: Event) => {
      if (orderUpdateAffects(event, 'payments')) refresh.invalidate();
    };
    window.addEventListener('koma_orders_updated', onOrdersUpdated);
    window.addEventListener('koma_smartpos_updated', refresh.invalidate);
    document.addEventListener('visibilitychange', refresh.resume);
    return () => {
      refresh.stop();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh.resume);
      window.removeEventListener('koma_orders_updated', onOrdersUpdated);
      window.removeEventListener('koma_smartpos_updated', refresh.invalidate);
      document.removeEventListener('visibilitychange', refresh.resume);
    };
  }, [activeSubTab, refreshSmartPosCashProjection, smartPosAuthorization, isWsConnected]);

  const getSmartPosCardState = useCallback(
    (order: Order): SmartPosCardState | null => {
      const mesaId = Number(order?.mesaId || 0);
      if (mesaId <= 0) return null;
      const row = smartPosCashByTable.get(mesaId);
      if (!row) return null;

      if (row.pagamento?.provider_last_error) {
        return {
          label: 'MAQUININHA · ATENÇÃO',
          chipClass: 'is-attention',
          blocksPayment: true,
          ctaLabel: 'Revisar pagamento',
          intentId: row.pagamento.intent_id,
        };
      }
      if (row.estado_operacional === 'aprovado_pendente_liquidacao') {
        return {
          label: 'MAQUININHA · FINALIZANDO',
          chipClass: 'is-primary',
          blocksPayment: true,
          ctaLabel: 'Revisar pagamento',
          intentId: row.pagamento?.intent_id,
          canReconcile: true,
        };
      }
      if (row.estado_operacional === 'pagamento_processando') {
        return {
          label: 'MAQUININHA · PROCESSANDO',
          chipClass: 'is-primary',
          blocksPayment: true,
          ctaLabel: 'Acompanhar pagamento',
          intentId: row.pagamento?.intent_id,
        };
      }
      if (row.origem_smartpos) {
        return {
          label: 'MAQUININHA',
          chipClass: 'is-muted',
          blocksPayment: false,
        };
      }
      return null;
    },
    [smartPosCashByTable]
  );

  const handleReconcileSmartPosPayment = async (intentId: string) => {
    if (!intentId || isReconcilingSmartPos) return;
    setIsReconcilingSmartPos(true);
    setSmartPosRecoveryError('');
    try {
      const response = await operationalFetch(
        `${apiBaseUrl}/auth/smartpos/payment-intents/${encodeURIComponent(intentId)}/reconciliar-liquidacao`,
        {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.detail || 'Não foi possível concluir a liquidação da maquininha.');
      }

      onReconciled();
      showToast('Pagamento da maquininha conciliado com sucesso.', 'success');
      await Promise.all([onRefreshOrders(), fetchTurno(), refreshSmartPosCashProjection()]);
    } catch (err: any) {
      setSmartPosRecoveryError(err?.message || 'Falha ao reconciliar o pagamento aprovado.');
    } finally {
      setIsReconcilingSmartPos(false);
    }
  };

  return {
    isReconcilingSmartPos,
    smartPosRecoveryError,
    setSmartPosRecoveryError,
    refreshSmartPosCashProjection,
    getSmartPosCardState,
    handleReconcileSmartPosPayment,
  };
}
