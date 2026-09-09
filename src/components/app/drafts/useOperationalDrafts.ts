import React, { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../../config/api';
import { DraftItem, Order, Product } from '../../../types';
import {
  clearPersistedOperationKey,
  getOrCreatePersistedOperationKey,
  operationalFetch,
} from '../../../utils/operationalRequest';

const LOCAL_STORAGE_DRAFTS_KEY = 'koma_drafts_vFinal_v3';
import type { OperationalRequestContext, OperationalNotice } from '../operationalContracts';
import type { useOperationalOrders } from '../data/useOperationalOrders';

type BoundaryProps = Pick<OperationalRequestContext, 'getAuthHeaders'> &
  Pick<ReturnType<typeof useOperationalOrders>, 'orders' | 'setOrders' | 'fetchOrdersFromAPI'> & {
    activeWaiterNome: string;
    activeWaiterId: string;
    setSelectedTableId: React.Dispatch<React.SetStateAction<number | null>>;
    showToast: OperationalNotice;
  };

type ModifierMeta = {
  modificadorIds?: string[];
  modificadoresSelecionados?: Array<{ id: string; nome: string; preco: number }>;
  precoBase?: number;
};

type DecoratedProduct = Product & {
  __selectedModifierIds?: string[];
  __selectedModifiers?: Array<{ id: string; nome: string; preco: number }>;
  __selectedModifierTotal?: number;
};

/** Owns table drafts, persistence and launch submission including the synchronous guard and retry identity. */
export function useOperationalDrafts({
  activeWaiterNome,
  orders,
  setOrders,
  activeWaiterId,
  setSelectedTableId,
  showToast,
  fetchOrdersFromAPI,
  getAuthHeaders,
}: BoundaryProps) {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);

  const [drafts, setDrafts] = useState<{ [mesaId: number]: DraftItem[] }>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_DRAFTS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error loading drafts from localStorage', e);
      }
    }
    return {};
  });

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_DRAFTS_KEY, JSON.stringify(drafts));
  }, [drafts]);

  const getDraftItems = (mesaId: number) => drafts[mesaId] || [];

  const handleAddToDraft = (
    mesaId: number,
    product: Product,
    quantity = 1,
    observacao = '',
    clienteNome = '',
  ) => {
    setDrafts((prev) => {
      const existing = prev[mesaId] || [];
      const defaultClientName = clienteNome || (existing.length > 0 ? existing[0].clienteNome : '');
      const decorated = product as DecoratedProduct;
      const modifierTotal = Number(decorated.__selectedModifierTotal || 0);
      const newItem = {
        id: `draft-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        produtoId: product.id,
        nome: product.nome,
        preco: Number(product.preco) + modifierTotal,
        precoBase: Number(product.preco),
        observacao,
        clienteNome: defaultClientName,
        quantidade: quantity,
        modificadorIds: [...(decorated.__selectedModifierIds || [])],
        modificadoresSelecionados: [...(decorated.__selectedModifiers || [])],
      } as DraftItem & ModifierMeta;

      return { ...prev, [mesaId]: [...existing, newItem] };
    });
  };

  const handleRemoveFromDraft = (mesaId: number, draftItemId: string) => {
    setDrafts((prev) => ({
      ...prev,
      [mesaId]: (prev[mesaId] || []).filter((item) => item.id !== draftItemId),
    }));
  };

  const handleUpdateDraftItem = (mesaId: number, draftItemId: string, fields: Partial<DraftItem>) => {
    setDrafts((prev) => ({
      ...prev,
      [mesaId]: (prev[mesaId] || []).map((item) => (item.id === draftItemId ? { ...item, ...fields } : item)),
    }));
  };

  const handleEditDraftItems = (
    mesaId: number,
    draftItemIds: string[],
    fields: Pick<DraftItem, 'quantidade' | 'observacao' | 'clienteNome'>,
  ) => {
    const selectedIds = new Set(draftItemIds);
    if (selectedIds.size === 0) return;
    const modifierFields = fields as typeof fields & ModifierMeta;

    setDrafts((prev) => {
      const existing = prev[mesaId] || [];
      const primaryIndex = existing.findIndex((item) => selectedIds.has(item.id));
      if (primaryIndex < 0) return prev;
      const primaryId = existing[primaryIndex].id;
      const normalizedQuantity = Math.max(1, Math.floor(fields.quantidade || 1));
      const nextItems = existing.flatMap((item) => {
        if (!selectedIds.has(item.id)) return [item];
        if (item.id !== primaryId) return [];
        const current = item as DraftItem & ModifierMeta;
        const basePrice = Number(modifierFields.precoBase ?? current.precoBase ?? item.preco);
        const modifierTotal = (modifierFields.modificadoresSelecionados ?? current.modificadoresSelecionados ?? [])
          .reduce((sum, option) => sum + Number(option.preco || 0), 0);
        return [{
          ...item,
          quantidade: normalizedQuantity,
          observacao: fields.observacao,
          clienteNome: fields.clienteNome,
          preco: basePrice + modifierTotal,
          precoBase: basePrice,
          modificadorIds: modifierFields.modificadorIds ?? current.modificadorIds ?? [],
          modificadoresSelecionados: modifierFields.modificadoresSelecionados ?? current.modificadoresSelecionados ?? [],
        } as DraftItem & ModifierMeta];
      });
      return { ...prev, [mesaId]: nextItems };
    });
  };

  const handleSubmitDraft = async (
    mesaId: number,
    orderType: 'Consumo no Local' | 'Retirada' | 'Entrega' = 'Consumo no Local',
  ) => {
    if (isSubmittingRef.current) return;
    const items = drafts[mesaId] || [];
    if (items.length === 0) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    const optimisticItems: any[] = items.flatMap((item) => {
      const qty = item.quantidade || 1;
      const modifiers = (item as DraftItem & ModifierMeta).modificadoresSelecionados || [];
      return Array.from({ length: qty }, (_, i) => ({
        id: `opt_${Date.now()}_${i}_${item.produtoId}`,
        produtoId: item.produtoId,
        nome: item.nome,
        preco: item.preco,
        observacao: item.observacao,
        clienteNome: item.clienteNome.trim() || 'Consumo Geral',
        modificadores: modifiers,
        status: 'preparando' as const,
        pago: false,
        garcomNome: activeWaiterNome,
      }));
    });

    const existingComanda = orders.find((o) => o.mesaId === mesaId);
    if (existingComanda) {
      setOrders((prev) => prev.map((o) =>
        o.mesaId === mesaId ? { ...o, itens: [...o.itens, ...optimisticItems] } : o,
      ));
    } else {
      const optimisticOrder: Order = {
        id: `opt_comanda_${Date.now()}`,
        mesaId,
        garcomId: activeWaiterId,
        garcomNome: activeWaiterNome,
        timestamp: Date.now(),
        itens: optimisticItems,
        tipo: orderType,
        valorPago: 0,
      };
      setOrders((prev) => [...prev, optimisticOrder]);
    }

    setDrafts((prev) => {
      const copy = { ...prev };
      delete copy[mesaId];
      return copy;
    });
    setSelectedTableId(null);
    showToast('Enviando pedido para a cozinha...', 'info');

    const restoreDraftAndNotify = (errorMessage?: string) => {
      setDrafts((prev) => ({ ...prev, [mesaId]: items }));
      setSelectedTableId(mesaId);
      fetchOrdersFromAPI();
      showToast(
        errorMessage
          ? `${errorMessage}. Pedido preservado na mesa.`
          : 'Falha de conexão. Pedido preservado na mesa para reenviar.',
        'error',
      );
    };

    try {
      const activeComanda = orders.find((o) => o.mesaId === mesaId);
      let comandaId = activeComanda?.id;
      if (!comandaId) {
        const openRes = await operationalFetch(`${API_BASE_URL}/comandas/`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ mesa_id: mesaId, garcom_id: activeWaiterId, tipo: orderType }),
        });
        if (!openRes.ok) {
          const errData = await openRes.json().catch(() => null);
          restoreDraftAndNotify(errData?.detail || `Falha ao abrir comanda (${openRes.statusText})`);
          setIsSubmitting(false);
          return;
        }
        const newComanda = await openRes.json();
        comandaId = newComanda.id;
      }

      const launchItems = items.flatMap((item) => {
        const expanded = [];
        const qty = item.quantidade || 1;
        const modifierIds = (item as DraftItem & ModifierMeta).modificadorIds || [];
        for (let i = 0; i < qty; i++) {
          expanded.push({
            produto_id: item.produtoId,
            observacao: item.observacao,
            cliente_nome: item.clienteNome.trim() || 'Consumo Geral',
            modificador_ids: modifierIds,
          });
        }
        return expanded;
      });
      const launchStorageKey = `koma_pending_launch_${comandaId}`;
      const launchFingerprint = JSON.stringify({ comandaId, garcomId: activeWaiterId, itens: launchItems });
      const launchIdempotencyKey = getOrCreatePersistedOperationKey(
        launchStorageKey,
        launchFingerprint,
        'table-launch',
      );
      const launchRes = await operationalFetch(
        `${API_BASE_URL}/cardapio/modificadores/lancamentos/${comandaId}`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            garcom_id: activeWaiterId,
            idempotency_key: launchIdempotencyKey,
            itens: launchItems,
          }),
        },
      );
      if (!launchRes.ok) {
        const errData = await launchRes.json().catch(() => null);
        restoreDraftAndNotify(errData?.detail || `Falha ao lançar itens (${launchRes.statusText})`);
        setIsSubmitting(false);
        return;
      }

      const launchData = await launchRes.json();
      clearPersistedOperationKey(launchStorageKey, launchIdempotencyKey);
      if (launchData.dispensado_impressao) {
        showToast('Pedido registrado (sem impressão física).', 'info');
      } else {
        showToast('Pedido lançado para a cozinha com sucesso.', 'success');
      }
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      restoreDraftAndNotify('Erro de conexão com o servidor.');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return {
    isSubmitting,
    drafts,
    getDraftItems,
    handleAddToDraft,
    handleRemoveFromDraft,
    handleUpdateDraftItem,
    handleEditDraftItems,
    handleSubmitDraft,
  };
}
