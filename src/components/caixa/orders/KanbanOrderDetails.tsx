import React from 'react';
import clsx from 'clsx';
import { Smartphone, Users, ShoppingCart, X, Check, Printer, RefreshCw, ArrowUpRight, Trash2 } from 'lucide-react';
import type { Table } from '../../../types';
import {
  getCashierDeliveryStatusLabel as deliveryStatusLabel,
  getCashierHumanOrderNumber as humanOrderNumber,
  projectCashierDeliveryState,
} from '../../../domain/cashierOrderProjection';
import { formatBackendTime } from '../../../utils/dateTime';
import { formatCurrency, operationalOriginLabel } from '../cashierPresentation';

export interface KanbanDetailSourceItem {
  readonly nome?: string;
  readonly produto?: { readonly nome?: string };
  readonly observacao?: string;
  readonly cliente_nome?: string;
  readonly clienteNome?: string;
  readonly status?: string;
  readonly preco_unit?: number;
  readonly preco?: number;
}

/** Display-only shape supports both persisted table slices and legacy digital detail rows. */
export interface KanbanDetailOrder {
  readonly id: string;
  readonly mesaId: number;
  readonly itens: readonly KanbanDetailSourceItem[];
  readonly comandaId?: string;
  readonly displayNumber?: string;
  readonly projectionScope?: 'launch' | 'table';
  readonly numeroPedido?: number;
  readonly numero_pedido?: number | string;
  readonly isQuickSale?: boolean;
  readonly origemOperacional?: string;
  readonly modalidade?: string;
  readonly tipo?: string;
  readonly total?: number;
  readonly deliveryStatus?: string;
  readonly identificador?: string;
  readonly telefone?: string;
  readonly criadoEm?: string;
  readonly created_at?: string;
  readonly mesaOrigemId?: number;
  readonly mesaTransferidaDe?: number;
  readonly contextoSalao?: boolean;
}

export interface KanbanOrderDetailsProps {
  readonly order: KanbanDetailOrder;
  readonly transfer: {
    readonly targetId: string;
    readonly onTargetChange: (targetId: string) => void;
    readonly isTransferring: boolean;
    readonly tables: readonly Pick<Table, 'id' | 'nome'>[];
  };
  readonly actions: {
    readonly close: () => void;
    readonly advanceDigitalOrder: () => void;
    readonly reprintProduction: () => void;
    readonly printFullTable: () => void;
    readonly printTableValues: () => void;
    readonly transferTable: () => void;
    readonly cancelConsumption: () => void;
    readonly cancelOrder: () => void;
  };
}

type KanbanDetailItem = {
  nome: string;
  observacao: string;
  clienteNome: string;
  status: string;
  quantidade: number;
};



function groupKanbanDetailItems(items: readonly KanbanDetailSourceItem[]): KanbanDetailItem[] {
  const grouped = new Map<string, KanbanDetailItem>();
  (Array.isArray(items) ? items : []).forEach((item: KanbanDetailSourceItem) => {
    if (String(item?.status || '').toLowerCase() === 'cancelado') return;
    const nome = String(item?.nome || item?.produto?.nome || 'Item');
    const observacao = String(item?.observacao || '').trim();
    const clienteNome = String(item?.cliente_nome || item?.clienteNome || 'Consumo Geral').trim();
    const status = String(item?.status || 'preparando').toLowerCase();
    const key = [nome, observacao, clienteNome, status].join('\u0000');
    const current = grouped.get(key);
    if (current) {
      current.quantidade += 1;
    } else {
      grouped.set(key, { nome, observacao, clienteNome, status, quantidade: 1 });
    }
  });
  return Array.from(grouped.values());
}


/** Modal UI only; owner callbacks preserve failure handling and close-on-success behavior. */
export function KanbanOrderDetails({ order: selectedKanbanOrder, transfer, actions }: KanbanOrderDetailsProps) {
  const { targetId: tableTransferTargetId, onTargetChange: setTableTransferTargetId,
    isTransferring: isTransferringTable, tables: salonTables } = transfer;
  const selectedDetailItems = selectedKanbanOrder
    ? groupKanbanDetailItems(selectedKanbanOrder.itens)
    : [];
  const selectedOrderNumber = selectedKanbanOrder
    ? humanOrderNumber(selectedKanbanOrder)
    : '—';
  const selectedIsQuickSale = Boolean(selectedKanbanOrder?.isQuickSale)
    || (
      selectedKanbanOrder?.origemOperacional === 'smartpos'
      && Number(selectedKanbanOrder?.mesaId || 0) === 0
      && String(selectedKanbanOrder?.modalidade || selectedKanbanOrder?.tipo || '').toLowerCase() === 'retirada'
    );
  const selectedIsDigital = Boolean(selectedKanbanOrder)
    && ['retirada', 'entrega', 'delivery'].includes(String(selectedKanbanOrder?.modalidade || selectedKanbanOrder?.tipo || '').toLowerCase());
  const selectedOrderTotal = selectedKanbanOrder
    ? Number(selectedKanbanOrder.total ?? selectedKanbanOrder.itens?.reduce(
      (sum: number, item: KanbanDetailSourceItem) => sum + Number(item.preco_unit || item.preco || 0),
      0,
    ) ?? 0)
    : 0;
  const selectedCanAdvanceDigital = selectedIsDigital
    && projectCashierDeliveryState(selectedKanbanOrder?.deliveryStatus).inProduction;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) actions.close(); }}
      className={clsx('fixed', 'inset-0', 'bg-black/85', 'backdrop-blur-xs', 'z-50', 'flex', 'items-center', 'justify-center', 'p-4', 'cursor-pointer')}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="kanban-detail-title" className={clsx('orders-detail-modal', 'w-full', 'max-w-md', 'rounded-3xl', 'p-5', 'space-y-4', 'text-left', 'relative', 'animate-scale-in')}>
        <div className="orders-detail-modal__hero">
          <div className={clsx('orders-detail-modal__number', selectedIsQuickSale && 'is-quick-sale')}>
            {selectedIsQuickSale ? <Smartphone size={18} /> : selectedKanbanOrder.mesaId > 0 ? <Users size={18} /> : <ShoppingCart size={18} />}
            <strong>{selectedKanbanOrder.mesaId > 0 ? `M${selectedKanbanOrder.mesaId}` : `#${selectedOrderNumber}`}</strong>
          </div>
          <div className="min-w-0 flex-1">
            <span className="orders-detail-modal__eyebrow">
              {selectedIsQuickSale ? 'Venda rápida' : selectedKanbanOrder.mesaId > 0 ? 'Atendimento do salão' : selectedKanbanOrder.modalidade === 'delivery' ? 'Delivery' : 'Retirada'}
            </span>
            <h3 id="kanban-detail-title" className="orders-detail-modal__title">
              {selectedIsQuickSale
                ? `Pedido #${selectedOrderNumber}`
                : selectedKanbanOrder.mesaId > 0
                  ? `Mesa ${selectedKanbanOrder.mesaId}`
                  : selectedKanbanOrder.identificador || `Pedido #${selectedOrderNumber}`}
            </h3>
            <div className="orders-detail-modal__status-line">
              <span>{operationalOriginLabel(selectedKanbanOrder.origemOperacional)}</span>
              <span aria-hidden="true">•</span>
              <strong>{deliveryStatusLabel(selectedKanbanOrder.deliveryStatus, selectedKanbanOrder.modalidade)}</strong>
            </div>
          </div>
          <div className="orders-detail-modal__hero-side">
            <strong>{formatCurrency(selectedOrderTotal)}</strong>
            <button
              type="button"
              onClick={actions.close}
              className="orders-detail-modal__close"
              aria-label="Fechar detalhes"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="orders-detail-modal__metrics">
          <div><span>Pedido</span><strong>#{selectedOrderNumber}</strong></div>
          <div><span>Horário</span><strong>{selectedKanbanOrder.criadoEm || formatBackendTime(selectedKanbanOrder.created_at) || '—'}</strong></div>
          <div><span>Itens</span><strong>{selectedDetailItems.reduce((sum, item) => sum + item.quantidade, 0)}</strong></div>
        </div>
        {/* Itens e info extras */}
        <div className="space-y-3">
          {selectedKanbanOrder.mesaOrigemId && Number(selectedKanbanOrder.mesaOrigemId) !== Number(selectedKanbanOrder.mesaId) && (
            <div className={clsx('bg-emerald-950/20', 'p-3', 'rounded-2xl', 'border', 'border-emerald-900/40', 'text-xs', 'text-emerald-600 dark:text-emerald-300', 'flex', 'items-center', 'justify-between', 'shadow-sm', 'font-sans')}>
              <div>
                <strong className={clsx('text-emerald-400', 'block', 'text-[9px]', 'uppercase', 'tracking-wider', 'font-bold')}>Consumo Mesclado:</strong>
                <span className="leading-relaxed">Este lote possui consumo mesclado da <strong>Mesa {selectedKanbanOrder.mesaOrigemId}</strong> para a <strong>Mesa {selectedKanbanOrder.mesaId}</strong>.</span>
              </div>
              <span className={clsx('text-lg', 'shrink-0', 'pl-2')}>🔗</span>
            </div>
          )}
          {selectedKanbanOrder.mesaTransferidaDe && Number(selectedKanbanOrder.mesaTransferidaDe) !== Number(selectedKanbanOrder.mesaId) && (
            <div className={clsx('bg-purple-950/20', 'p-3', 'rounded-2xl', 'border', 'border-purple-900/40', 'text-xs', 'text-purple-300', 'flex', 'items-center', 'justify-between', 'shadow-sm', 'font-sans', 'animate-pulse-subtle')}>
              <div>
                <strong className={clsx('text-purple-400', 'block', 'text-[9px]', 'uppercase', 'tracking-wider', 'font-bold')}>Consumo Transferido:</strong>
                <span className="leading-relaxed">Este lote foi transferido da <strong>Mesa {selectedKanbanOrder.mesaTransferidaDe}</strong> para a <strong>Mesa {selectedKanbanOrder.mesaId}</strong>.</span>
              </div>
              <span className={clsx('text-lg', 'shrink-0', 'pl-2')}>🔄</span>
            </div>
          )}
          {selectedKanbanOrder.identificador && !selectedIsQuickSale && (
            <div className="orders-detail-modal__customer">
              <div>
                <span>Cliente</span>
                <strong>{selectedKanbanOrder.identificador}</strong>
              </div>
              {selectedKanbanOrder.telefone && <span>{selectedKanbanOrder.telefone}</span>}
            </div>
          )}
          <div className="space-y-2">
            <div className="orders-detail-modal__section-title">
              <span>Itens do pedido</span>
              <strong>{selectedDetailItems.reduce((sum, item) => sum + item.quantidade, 0)} no total</strong>
            </div>
            <div className="orders-detail-modal__items">
              {selectedDetailItems.map((item, idx) => (
                <div key={`${item.nome}-${item.observacao}-${idx}`} className="orders-detail-modal__item">
                  <span className="orders-detail-modal__quantity">{item.quantidade}×</span>
                  <div className="min-w-0 flex-1">
                    <strong>{item.nome}</strong>
                    {item.observacao && <span className="orders-detail-modal__observation">{item.observacao}</span>}
                    {item.clienteNome !== 'Consumo Geral' && item.clienteNome.toLowerCase() !== 'balcão' && (
                      <span className="orders-detail-modal__for">Para: {item.clienteNome}</span>
                    )}
                  </div>
                  <span className={clsx('orders-detail-modal__item-status', item.status === 'pronto' && 'is-ready')}>
                    {item.status === 'preparando' ? 'Em preparo' : item.status === 'pronto' ? 'Pronto' : item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {/* Botões de impressão */}
          <div className={clsx('flex', 'flex-col', 'gap-2', 'pt-1')}>
            {selectedCanAdvanceDigital && (
              <button
                type="button"
                onClick={actions.advanceDigitalOrder}
                className="orders-detail-modal__primary-action"
              >
                <Check size={15} />
                <span>{selectedKanbanOrder.modalidade === 'delivery' ? 'Marcar saída para entrega' : 'Marcar pronto para retirada'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={actions.reprintProduction}
              className="orders-detail-modal__reprint"
            >
              <Printer size={13} />
              <span>Reimprimir produção</span>
            </button>
            {Boolean(selectedKanbanOrder.mesaId && selectedKanbanOrder.mesaId > 0) && (
              <div className={clsx('space-y-2', 'w-full')}>
                <div className={clsx('flex', 'gap-2', 'w-full')}>
                  <button
                    type="button"
                    onClick={actions.printFullTable}
                    className={clsx('flex-1', 'py-2.5', 'bg-koma-panel', 'hover:bg-koma-raised', 'text-koma-secondary', 'hover:text-koma-foreground', 'font-bold', 'text-xs', 'rounded-xl', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'text-center', 'flex', 'items-center', 'justify-center', 'gap-1.5', 'border', 'border-koma-border', 'shadow-lg')}
                  >
                    <Printer size={13} />
                    <span>Comanda Inteira</span>
                  </button>
                  <button
                    type="button"
                    onClick={actions.printTableValues}
                    className={clsx('flex-1', 'py-2.5', 'bg-koma-panel', 'hover:bg-koma-raised', 'text-koma-secondary', 'hover:text-koma-foreground', 'font-bold', 'text-xs', 'rounded-xl', 'transition-all', 'cursor-pointer', 'uppercase', 'tracking-wider', 'text-center', 'flex', 'items-center', 'justify-center', 'gap-1.5', 'border', 'border-koma-border', 'shadow-lg')}
                  >
                    <Printer size={13} />
                    <span>Só Valores</span>
                  </button>
                </div>
                {selectedKanbanOrder.contextoSalao && (
                  <div className={clsx('flex', 'gap-2', 'w-full')}>
                    <select
                      aria-label="Mesa de destino"
                      value={tableTransferTargetId}
                      onChange={(event) => setTableTransferTargetId(event.target.value)}
                      disabled={isTransferringTable}
                      className={clsx('min-h-10', 'min-w-0', 'flex-1', 'rounded-xl', 'border', 'border-koma-border', 'bg-koma-panel', 'px-3', 'text-xs', 'font-bold', 'text-koma-secondary', 'outline-none', 'focus:border-emerald-500/60')}
                    >
                      <option value="">Transferir para…</option>
                      {salonTables
                        .filter(table => Number(table.id) !== Number(selectedKanbanOrder.mesaId))
                        .map(table => <option key={table.id} value={table.id}>Mesa {table.id}{table.nome ? ` · ${table.nome}` : ''}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={actions.transferTable}
                      disabled={!tableTransferTargetId || isTransferringTable}
                      className={clsx('flex', 'min-h-10', 'items-center', 'justify-center', 'gap-2', 'rounded-xl', 'border', 'border-emerald-500/30', 'bg-emerald-500/10', 'px-3', 'text-[10px]', 'font-bold', 'text-emerald-700 dark:text-emerald-300', 'hover:bg-emerald-500/20', 'disabled:cursor-not-allowed', 'disabled:opacity-40')}
                    >
                      {isTransferringTable ? <RefreshCw className="animate-spin" size={13} /> : <ArrowUpRight size={13} />}
                      Transferir
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={actions.cancelConsumption}
                  className={clsx('flex', 'min-h-10', 'w-full', 'items-center', 'justify-center', 'gap-2', 'rounded-xl', 'border', 'border-rose-300 dark:border-rose-900/40', 'bg-rose-50 dark:bg-rose-950/20', 'px-3', 'text-[10px]', 'font-bold', 'text-rose-700 dark:text-rose-300', 'transition-colors', 'hover:bg-rose-100 dark:hover:bg-rose-950/40')}
                >
                  <Trash2 size={13} />
                  {selectedKanbanOrder.contextoSalao ? 'Cancelar toda a mesa e liberar' : 'Cancelar somente este pedido'}
                </button>
              </div>
            )}
            {Number(selectedKanbanOrder.mesaId || 0) <= 0 && (
              <button
                type="button"
                onClick={actions.cancelOrder}
                className={clsx('flex', 'min-h-10', 'w-full', 'items-center', 'justify-center', 'gap-2', 'rounded-xl', 'border', 'border-rose-300 dark:border-rose-900/40', 'bg-rose-50 dark:bg-rose-950/20', 'px-3', 'text-[10px]', 'font-bold', 'text-rose-700 dark:text-rose-300', 'transition-colors', 'hover:bg-rose-100 dark:hover:bg-rose-950/40')}
              >
                <Trash2 size={13} />
                Cancelar pedido
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
