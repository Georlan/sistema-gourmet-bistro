import type { Order, OrderItem, Table } from '../types';
import { normalizeOperationalTimestamp } from './operationalTime';
import {
  deriveFinancialState, deriveOperationalElapsedTime, deriveProductionState,
  getOrderItems, type OperationalTimestampSource,
} from './operationalState';
import { getOrderDisplayNumber } from './orderIdentity';
/** Cashier delivery column membership, not a payment or item-status inference. */
export function projectCashierDeliveryState(status?: string, modalidade?: string) {
  return {
    awaitingAcceptance: status === 'pendente' || status === 'analise',
    inProduction: status === 'producao',
    inFinalization: ['pronto', 'transito', 'saiu_para_entrega'].includes(status || ''),
    active: ['pendente', 'analise', 'producao', 'pronto', 'transito'].includes(status || ''),
    label: getCashierDeliveryStatusLabel(status, modalidade),
  };
}

export function getCashierDeliveryStatusLabel(status?: string, modalidade?: string): string {
  if (status === 'producao') return 'Em preparo';
  if (status === 'pronto') return modalidade === 'delivery' ? 'Pronto para envio' : 'Pronto para retirada';
  if (status === 'transito') return modalidade === 'delivery' ? 'Em rota' : 'Aguardando retirada';
  if (status === 'pendente' || status === 'analise') return 'Aguardando aceite';
  return 'Em atendimento';
}

export interface CashierTableSlice extends Order {
  projectionScope: 'launch' | 'table';
  comandaId: string;
  aberta_em?: unknown;
  data_abertura?: unknown;
  aberto_em?: unknown;
  criadoEm?: unknown;
  mesa?: Table & OperationalTimestampSource;
  contaPedida?: boolean;
  temItensEmPreparo?: boolean;
  itensEmPreparoCount?: number;
  comandaIds?: string[];
}

interface CashierTimeSource extends OperationalTimestampSource {
  mesa?: OperationalTimestampSource;
  itens?: unknown;
}

type CashierNumberSource = Partial<Pick<Order, 'id' | 'numeroPedido' | 'displayNumber'>> & {
  comandaId?: string;
  numero_pedido?: number | string;
  projectionScope?: string;
};

/** This predicate classifies fulfillment only; it does not decide payment state. */
export const isCashierTableOrder = (order: Order | null | undefined) => {
  if (!order || Number(order.mesaId) <= 0) return false;
  return !['delivery', 'entrega', 'retirada'].includes(String(order.tipo || '').toLowerCase());
};

/**
 * Receives the existing active-check snapshot (GET detalhes/todos?fechada=false).
 * These are cashier display slices, not a production/financial state machine:
 * requesting a bill moves all unpaid items to closing without making them ready.
 * Preparation intentionally retains paid items; closing without a bill request
 * intentionally selects ready, but not served, items. Keep those policies intact.
 */
export function projectCashierTableSlices(orders: Order[], salonTables: Table[], now: number) {
  return {
    tableOrdersInProduction: projectTableProduction(orders, salonTables, now),
    tableOrdersReady: projectTableClosing(orders, salonTables, now),
  };
}

export function getCashierHumanOrderNumber(order?: CashierNumberSource | null): string {
  const rawId = String(order?.comandaId || order?.id || '');
  if (rawId.startsWith('temp-')) return '…';
  const displayNumber = order?.projectionScope !== 'table' ? getOrderDisplayNumber(order || {}) : undefined;
  if (displayNumber) return displayNumber;
  const number = Number(order?.numeroPedido ?? order?.numero_pedido);
  if (Number.isFinite(number) && number > 0) return String(number);
  return String(order?.comandaId || order?.id || '—').slice(-4).toUpperCase();
}

export const getCashierTableOrderPresentation = (order: Order & { projectionScope?: string }, salonTables: Table[]) => {
  const mesaId = Number(order.mesaId || 0);
  const configuredName = salonTables.find(table => Number(table.id) === mesaId)?.nome?.trim();
  const activeItemCount = deriveProductionState(getOrderItems(order)).activeItemCount;
  const orderNumbers = Array.from(new Set(
    (order.numeroPedidos?.length ? order.numeroPedidos : [order.numeroPedido])
      .map(number => Number(number))
      .filter(number => Number.isFinite(number) && number > 0)
  ));
  const isPendingConfirmation = String(order.id || '').startsWith('temp-');
  const displayNumber = order.projectionScope !== 'table' ? getOrderDisplayNumber(order) : undefined;
  const orderLabel = isPendingConfirmation
    ? 'Pedido em envio'
    : displayNumber
      ? `Pedido ${displayNumber}`
      : orderNumbers.length > 1
        ? `Pedidos ${orderNumbers.map(number => `#${number}`).join(' + ')}`
        : `Pedido #${orderNumbers[0] || getCashierHumanOrderNumber(order)}`;

  return {
    shortLabel: mesaId > 0 ? `M${mesaId}` : 'B',
    title: configuredName || (mesaId > 0 ? `Mesa ${mesaId}` : 'Balcão'),
    subtitle: `${orderLabel} · ${activeItemCount} ${activeItemCount === 1 ? 'item' : 'itens'} · ${order.garcomNome || 'Atendimento'}`,
  };
};

const getCashierPrimaryTimestamp = (card: CashierTimeSource) => (
  card.mesa?.aberta_em ||
  card.mesa?.data_abertura ||
  card.mesa?.created_at ||
  card.aberta_em ||
  card.data_abertura ||
  card.aberto_em ||
  card.created_at ||
  card.timestamp ||
  card.criadoEm
);

const getCashierElapsedLabel = (card: CashierTimeSource, now: number) => {
  // Preserve the legacy label-only item fallback; SLA thresholds use the
  // order/table opening timestamp, as they did before the extraction.
  const timestamp = getCashierPrimaryTimestamp(card) ||
    (Array.isArray(card.itens) && card.itens.length > 0 && Math.min(
      ...card.itens.map((i: any) => {
        const t = i.criadoEm || i.created_at || i.timestamp;
        return normalizeOperationalTimestamp(t, now) ?? Infinity;
      }).filter((t: number) => t < Infinity)
    ));

  if (!timestamp) return 'AGORA';

  const elapsed = deriveOperationalElapsedTime(timestamp, now);
  if (!elapsed.timestamp) return 'AGORA';
  const diff = elapsed.minutes ?? 0;
  if (diff >= 2880) {
    const days = Math.floor(diff / 1440);
    return `${days}d ${Math.floor((diff % 1440) / 60)}h`;
  }
  if (diff >= 60) {
    return `${Math.floor(diff / 60)}h ${diff % 60}m`;
  }
  return diff === 0 ? 'AGORA' : `${diff} MIN`;
};

// Cálculo de tempo de espera dinâmico (SLA) sincronizado entre Salão/Garçom e Caixa
export const getCashierOrderSlaData = (order: CashierTimeSource, now: number) => {
  const timeFormatted = getCashierElapsedLabel(order, now);
  const timestampReal = getCashierPrimaryTimestamp(order);

  const elapsedMinutes = (deriveOperationalElapsedTime(timestampReal, now).minutes ?? 0);
  const labelText = timeFormatted;

  if (elapsedMinutes > 25) {
    return {
      minutes: elapsedMinutes,
      badgeClass: 'orders-card__time is-late',
      borderTopClass: 'is-late',
      label: labelText
    };
  } else if (elapsedMinutes >= 15) {
    return {
      minutes: elapsedMinutes,
      badgeClass: 'orders-card__time is-attention',
      borderTopClass: 'is-attention',
      label: labelText
    };
  } else {
    return {
      minutes: elapsedMinutes,
      badgeClass: 'orders-card__time is-normal',
      borderTopClass: 'is-normal',
      label: labelText
    };
  }
};

function projectTableProduction(orders: Order[], salonTables: Table[], now: number) {
  const list: CashierTableSlice[] = [];
  (orders || []).forEach(comanda => {
    const isTableOrder = Number(comanda.mesaId) > 0 && isCashierTableOrder(comanda);
    if (!isTableOrder) return;
    if (deriveFinancialState([comanda]) === 'AWAITING_PAYMENT') return;
    const itemsByLancamento: Record<string, OrderItem[]> = {};
    const itensArr = getOrderItems(comanda);
    itensArr.forEach(item => {
      const lid = item.lancamentoId || comanda.id;
      if (!itemsByLancamento[lid]) itemsByLancamento[lid] = [];
      itemsByLancamento[lid].push(item);
    });
    Object.entries(itemsByLancamento).forEach(([lid, items]) => {
      const preparingItems = deriveProductionState(items).preparingItems;
      if (preparingItems.length > 0) {
        const mesaEntity = (salonTables || []).find(t => t.id === comanda.mesaId);
        const rawTableTimestamp =
          (comanda as any).aberta_em ||
          (comanda as any).data_abertura ||
          (comanda as any).aberto_em ||
          (mesaEntity as any)?.aberta_em ||
          (mesaEntity as any)?.data_abertura ||
          (mesaEntity as any)?.created_at ||
          comanda.created_at ||
          comanda.timestamp ||
          (comanda as any).criadoEm;

        list.push({
          id: lid,
          projectionScope: 'launch',
          // Only a canonical identity explicitly bound to this launch is usable.
          displayNumber: comanda.launchIdentities?.[lid]?.displayNumber
            || (comanda.lancamentoId === lid ? comanda.displayNumber : undefined),
          comandaId: comanda.id,
          numeroPedido: comanda.numeroPedido,
          origemOperacional: comanda.origemOperacional,
          mesaId: comanda.mesaId,
          mesaOrigemId: comanda.mesaOrigemId,
          mesaTransferidaDe: comanda.mesaTransferidaDe,
          identificador: (comanda as any).identificador ?? null,
          garcomId: comanda.garcomId,
          garcomNome: comanda.garcomNome,
          tipo: comanda.tipo,
          aberta_em: rawTableTimestamp,
          data_abertura: (comanda as any).data_abertura || rawTableTimestamp,
          aberto_em: (comanda as any).aberto_em || rawTableTimestamp,
          created_at: comanda.created_at || (comanda as any).criadoEm || rawTableTimestamp,
          timestamp: normalizeOperationalTimestamp(comanda.timestamp || rawTableTimestamp, now) ?? now,
          criadoEm: (comanda as any).criadoEm || comanda.created_at,
          mesa: mesaEntity,
          itens: preparingItems
        });
      }
    });
  });
  return list;
}

// Col 3 — Fechar conta: mesas com status 'aguardando_pagamento' (conta pedida) ou itens prontos individualmente
// Unifica comandas da mesma mesa em um único card de pagamento.
function projectTableClosing(orders: Order[], salonTables: Table[], now: number) {
  const list: CashierTableSlice[] = [];
  const groupedByMesa: Record<number, Array<{ comanda: Order; itens: OrderItem[]; contaPedida: boolean }>> = {};

  (orders || []).forEach(comanda => {
    const isTableOrder = Number(comanda.mesaId) > 0 && isCashierTableOrder(comanda);
    if (!isTableOrder) return;

    const production = deriveProductionState(getOrderItems(comanda));
    const unpaid = production.activeItems.filter(item => !item.pago);
    const readyItems = production.readyItems.filter(item => !item.pago);
    const contaPedida = deriveFinancialState([comanda]) === 'AWAITING_PAYMENT';

    if (contaPedida && unpaid.length > 0) {
      if (!groupedByMesa[comanda.mesaId]) {
        groupedByMesa[comanda.mesaId] = [];
      }
      groupedByMesa[comanda.mesaId].push({ comanda, itens: unpaid, contaPedida: true });
    } else if (readyItems.length > 0) {
      if (!groupedByMesa[comanda.mesaId]) {
        groupedByMesa[comanda.mesaId] = [];
      }
      groupedByMesa[comanda.mesaId].push({ comanda, itens: readyItems, contaPedida: false });
    }
  });

  Object.entries(groupedByMesa).forEach(([mesaIdStr, entries]) => {
    const mesaId = Number(mesaIdStr);
    const allItems: OrderItem[] = [];
    entries.forEach(e => {
      (e.itens || []).forEach(it => {
        allItems.push({
          ...it,
          comandaId: e.comanda.id
        });
      });
    });

    const hasContaPedida = entries.some(e => e.contaPedida);
    const relatedTableOrders = (orders || []).filter(o => Number(o.mesaId) === mesaId && !(o as any).fechada);
    const itensEmPreparoCount = relatedTableOrders.reduce((count, relatedOrder) => {
      const preparingItems = deriveProductionState(getOrderItems(relatedOrder)).preparingItems;
      return count + preparingItems.filter(item => !item.pago).length;
    }, 0);

    const firstComanda = entries[0].comanda;
    const mesaEntity = (salonTables || []).find(t => t.id === mesaId);

    let oldestComandaTime: any = null;
    entries.forEach(e => {
      const cTime =
        (e.comanda as any).aberta_em ||
        (e.comanda as any).data_abertura ||
        (e.comanda as any).aberto_em ||
        e.comanda.created_at ||
        e.comanda.timestamp ||
        (e.comanda as any).criadoEm;
      if (!oldestComandaTime) {
        oldestComandaTime = cTime;
      } else if (cTime) {
        const t1 = normalizeOperationalTimestamp(cTime, now) ?? Number.NaN;
        const t2 = normalizeOperationalTimestamp(oldestComandaTime, now) ?? Number.NaN;
        if (!isNaN(t1) && (isNaN(t2) || t1 < t2)) {
          oldestComandaTime = cTime;
        }
      }
    });

    if (!oldestComandaTime && mesaEntity) {
      oldestComandaTime = (mesaEntity as any).aberta_em || (mesaEntity as any).data_abertura || (mesaEntity as any).created_at;
    }

    list.push({
      projectionScope: 'table',
      id: firstComanda.id, // ID real da comanda principal para rotear requisições
      comandaId: firstComanda.id,
      numeroPedido: firstComanda.numeroPedido,
      numeroPedidos: Array.from(new Set(
        entries
          .map(entry => Number(entry.comanda.numeroPedido))
          .filter(number => Number.isFinite(number) && number > 0)
      )),
      origemOperacional: firstComanda.origemOperacional,
      mesaId: mesaId,
      mesaOrigemId: firstComanda.mesaOrigemId,
      mesaTransferidaDe: firstComanda.mesaTransferidaDe,
      identificador: firstComanda.identificador ?? null,
      garcomId: firstComanda.garcomId,
      garcomNome: firstComanda.garcomNome,
      tipo: firstComanda.tipo,
      aberta_em: oldestComandaTime || (firstComanda as any).aberta_em,
      data_abertura: (firstComanda as any).data_abertura || oldestComandaTime,
      aberto_em: (firstComanda as any).aberto_em || oldestComandaTime,
      created_at: firstComanda.created_at || (firstComanda as any).criadoEm || oldestComandaTime,
      timestamp: normalizeOperationalTimestamp(firstComanda.timestamp || oldestComandaTime, now) ?? now,
      criadoEm: (firstComanda as any).criadoEm || firstComanda.created_at,
      mesa: mesaEntity,
      valorPago: entries.reduce((sum, e) => sum + (e.comanda.valorPago || 0), 0),
      itens: allItems,
      contaPedida: hasContaPedida,
      temItensEmPreparo: itensEmPreparoCount > 0,
      itensEmPreparoCount,
      comandaIds: entries.map(e => e.comanda.id)
    });
  });

  return list;
}

export const formatCashierOldestAge = (values: unknown[], now: number) => {
  const MIN_VALID_EPOCH = 1577836800000; // 2020-01-01T00:00:00Z
  const timestamps = values
    .map(v => normalizeOperationalTimestamp(v, now))
    .filter((value): value is number => value !== null && value >= MIN_VALID_EPOCH && value <= now + 60_000);
  if (timestamps.length === 0) return '—';
  const elapsedMinutes = Math.max(0, Math.floor((now - Math.min(...timestamps)) / 60_000));
  if (elapsedMinutes < 1) return 'Agora';
  if (elapsedMinutes < 60) return `${elapsedMinutes} min`;
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};
