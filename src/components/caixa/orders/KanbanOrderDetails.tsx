import { OrderItemComposition } from '../../shared/OrderItemComposition';
import { itemCompositionPresentation, itemCompositionSignature, type CompositionSource } from '../../../domain/orderItemComposition';
import React from 'react';
import clsx from 'clsx';
import { Smartphone, Users, ShoppingCart, X, Check, Printer, RefreshCw, ArrowUpRight, Trash2, Plus, CreditCard } from 'lucide-react';
import type { Table } from '../../../types';
import type { TableOrderContext as Context } from '../../../domain/tableReadModel';
import { TableOrderContext } from '../../shared/TableOrderContext';
import type { CashierTableCard } from './cashierWorkspaceTypes';
import {
  getCashierDeliveryStatusLabel as deliveryStatusLabel,
  getCashierHumanOrderNumber as humanOrderNumber,
  projectCashierDeliveryState,
} from '../../../domain/cashierOrderProjection';
import { formatBackendTime } from '../../../utils/dateTime';
import { formatCurrency, operationalOriginLabel } from '../cashierPresentation';
import { DigitalReceiptAction } from '../digital-receipt/DigitalReceiptAction';
import { getTableAssociationOptionLabel } from './digitalOrderPresentation';

export interface KanbanDetailSourceItem extends CompositionSource {
  readonly id?: string;
  readonly lancamentoId?: string;
  readonly pago?: boolean;
  readonly nome?: string;
  readonly produto?: { readonly nome?: string };
  readonly observacao?: string;
  readonly cliente_nome?: string;
  readonly clienteNome?: string;
  readonly status?: string;
  readonly preco_unit?: number;
  readonly preco?: number;
}

export interface KanbanCourierAssignment {
  readonly value: number | null;
  readonly options: readonly { id: number; nome: string }[];
  readonly loading?: boolean;
  readonly onChange: (motoboyId: string) => void;
}

/** Detail shape supports persisted table slices plus operational digital controls. */
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
  readonly amountPaid?: number;
  readonly amountDue?: number;
  readonly deliveryStatus?: string;
  readonly onlinePaymentStatus?: string | null;
  readonly identificador?: string;
  readonly telefone?: string;
  readonly paymentMethod?: string | null;
  readonly changeFor?: number | null;
  readonly criadoEm?: string;
  readonly created_at?: string;
  readonly mesaOrigemId?: number;
  readonly mesaTransferidaDe?: number;
  readonly contextoSalao?: boolean;
  readonly tableContext?: Context;
  readonly courierAssignment?: KanbanCourierAssignment;
}

export interface KanbanOrderDetailsProps {
  readonly order: KanbanDetailOrder;
  readonly saveObservation?: (itemId: string, observation: string) => Promise<void>;
  readonly tableMovement?: CashierTableCard['tableMovement'];
  readonly salonActions?: {
    readonly addConsumption: () => void;
    readonly receive: () => void;
    readonly canReceive: boolean;
  };
  readonly transfer: {
    readonly targetId: string;
    readonly onTargetChange: (targetId: string) => void;
    readonly isTransferring: boolean;
    readonly tables: readonly (Pick<Table, 'id' | 'nome'> & {
      readonly isOccupied?: boolean;
      readonly total?: number;
    })[];
  };
  readonly actions: {
    readonly close: () => void;
    readonly advanceDigitalOrder: (courierId?: string) => void;
    readonly reprintProduction: (launchId?: string) => void;
    readonly printFullTable: () => void;
    readonly printTableValues: () => void;
    readonly transferTable: () => void;
    readonly associateTable: () => void;
    readonly convertDeliveryToPickup: () => void;
    readonly cancelConsumption: () => void;
    readonly cancelOrder: () => void;
  };
  readonly canChangeFulfillment?: boolean;
  readonly hasPrinting?: boolean;
  readonly restaurantConfig?: Record<string, unknown> | null;
  readonly taxaServicoAtiva?: boolean;
  readonly serviceTaxRate?: number;
  readonly onToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

type KanbanDetailItem = CompositionSource & {
  nome: string;
  observacao: string;
  clienteNome: string;
  status: string;
  quantidade: number;
  sourceItems: KanbanDetailSourceItem[];
};

function groupKanbanDetailItems(items: readonly KanbanDetailSourceItem[]): KanbanDetailItem[] {
  const grouped = new Map<string, KanbanDetailItem>();
  (Array.isArray(items) ? items : []).forEach((item: KanbanDetailSourceItem) => {
    if (String(item?.status || '').toLowerCase() === 'cancelado') return;
    const nome = String(item?.nome || item?.produto?.nome || 'Item');
    const observacao = String(item?.observacao || '').trim();
    const clienteNome = String(item?.cliente_nome || item?.clienteNome || 'Consumo Geral').trim();
    const status = String(item?.status || 'preparando').toLowerCase();
    const key = [nome, observacao, clienteNome, status, itemCompositionSignature(item)].join('\u0000');
    const current = grouped.get(key);
    if (current) {
      current.quantidade += 1;
      current.sourceItems.push(item);
    } else {
      grouped.set(key, { ...item, nome, observacao, clienteNome, status, quantidade: 1, sourceItems: [item] });
    }
  });
  return Array.from(grouped.values());
}

/** Modal UI only; owner callbacks preserve failure handling and close-on-success behavior. */
export function KanbanOrderDetails({
  order: selectedKanbanOrder,
  transfer,
  actions,
  salonActions,
  tableMovement,
  saveObservation,
  hasPrinting = true,
  canChangeFulfillment = false,
  restaurantConfig,
  taxaServicoAtiva,
  serviceTaxRate,
  onToast,
}: KanbanOrderDetailsProps) {
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
  const selectedNormalizedFulfillment = String(
    selectedKanbanOrder?.modalidade || selectedKanbanOrder?.tipo || '',
  ).trim().toLowerCase();
  const selectedIsDigital = Boolean(selectedKanbanOrder)
    && ['retirada', 'pickup', 'entrega', 'delivery', 'dine_in', 'consumo_local', 'consumo no local'].includes(selectedNormalizedFulfillment);
  const selectedIsTableLinkedPickup = selectedIsDigital
    && ['retirada', 'pickup'].includes(selectedNormalizedFulfillment)
    && Number(selectedKanbanOrder?.mesaId || 0) > 0;
  const selectedIsDineIn = ['dine_in', 'consumo_local', 'consumo no local'].includes(selectedNormalizedFulfillment);
  const selectedIsTableLinkedDineIn = selectedIsDigital
    && selectedIsDineIn
    && Number(selectedKanbanOrder?.mesaId || 0) > 0;
  const selectedIsDelivery = selectedNormalizedFulfillment === 'delivery'
    || selectedNormalizedFulfillment === 'entrega';
  const selectedCanAssociateTable = !selectedIsQuickSale
    && Number(selectedKanbanOrder?.mesaId || 0) <= 0
    && ['retirada', 'pickup', 'dine_in', 'consumo_local', 'consumo no local'].includes(selectedNormalizedFulfillment);
  const selectedDeliveryStatus = String(selectedKanbanOrder?.deliveryStatus || '').toLowerCase();
  const selectedIsReadyDelivery = selectedIsDelivery && selectedDeliveryStatus === 'pronto';
  const selectedCanAssignCourier = selectedIsDelivery
    && Boolean(selectedKanbanOrder.courierAssignment)
    && selectedDeliveryStatus === 'pronto';
  const selectedCourierId = selectedKanbanOrder.courierAssignment?.value
    ? String(selectedKanbanOrder.courierAssignment.value)
    : '';
  const selectedCourierName = selectedKanbanOrder.courierAssignment?.options.find(
    (courier) => String(courier.id) === selectedCourierId,
  )?.nome;
  const selectedOrderTotal = selectedKanbanOrder
    ? Number(selectedKanbanOrder.total ?? selectedKanbanOrder.itens?.reduce(
      (sum: number, item: KanbanDetailSourceItem) => sum + Number(item.preco_unit || item.preco || 0),
      0,
    ) ?? 0)
    : 0;
  const selectedCanAdvanceDigital = selectedIsDigital
    && (
      projectCashierDeliveryState(selectedKanbanOrder?.deliveryStatus).inProduction
      || selectedIsReadyDelivery
    );
  const isWholeTableDetail = Boolean(selectedKanbanOrder.tableContext);
  const selectedAssociationTable = salonTables.find(
    (table) => String(table.id) === String(tableTransferTargetId),
  );

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) actions.close(); }}
      className={"fixed inset-0 bg-black/85 backdrop-blur-xs z-[80] flex items-center justify-center p-4 cursor-pointer"}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="kanban-detail-title" className={"orders-detail-modal w-full max-w-[44rem] max-h-[calc(100dvh-2rem)] overflow-hidden rounded-3xl flex flex-col text-left relative animate-scale-in"}>
        <div className="orders-detail-modal__hero">
          <div className={clsx('orders-detail-modal__number', selectedIsQuickSale && 'is-quick-sale')}>
            {selectedIsQuickSale ? <Smartphone size={18} /> : selectedKanbanOrder.mesaId > 0 ? <Users size={18} /> : <ShoppingCart size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <span className="orders-detail-modal__eyebrow">
              {selectedIsQuickSale
                ? 'Venda rápida'
                : selectedIsTableLinkedPickup
                  ? 'Retirada vinculada à mesa'
                  : selectedIsTableLinkedDineIn
                    ? 'Consumo local vinculado à mesa'
                    : selectedKanbanOrder.contextoSalao
                      ? 'Atendimento do salão'
                      : selectedIsDelivery
                        ? 'Delivery'
                        : selectedIsDineIn
                          ? 'Consumo no local'
                          : 'Retirada'}
              {!selectedKanbanOrder.tableContext && <span> · {selectedKanbanOrder.criadoEm || formatBackendTime(selectedKanbanOrder.created_at) || '—'}</span>}
            </span>
            <h3 id="kanban-detail-title" className="orders-detail-modal__title">
              {selectedIsQuickSale
                ? `Pedido #${selectedOrderNumber}`
                : selectedIsTableLinkedPickup
                  ? `Retirada · Mesa ${String(selectedKanbanOrder.mesaId).padStart(2, '0')}`
                  : selectedIsTableLinkedDineIn
                    ? `Consumo local · Mesa ${String(selectedKanbanOrder.mesaId).padStart(2, '0')}`
                    : selectedKanbanOrder.contextoSalao && selectedKanbanOrder.mesaId > 0
                      ? `Mesa ${selectedKanbanOrder.mesaId}`
                      : `Pedido #${selectedOrderNumber}`}
            </h3>
            <div className="orders-detail-modal__status-line">
              {selectedKanbanOrder.mesaId > 0 && !selectedKanbanOrder.tableContext && <span>Pedido #{selectedOrderNumber}</span>}
              <span>{operationalOriginLabel(selectedKanbanOrder.origemOperacional)}</span>
              {restaurantConfig?.nome && <span>· {String(restaurantConfig.nome)}</span>}
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
        <div className="orders-detail-modal__body">
          {selectedKanbanOrder.identificador && !selectedIsQuickSale && (
            <div className="orders-detail-modal__customer">
              <div><span>Cliente</span><strong>{selectedKanbanOrder.identificador}</strong></div>
              {selectedKanbanOrder.telefone && <span className="orders-detail-modal__phone">{selectedKanbanOrder.telefone}</span>}
            </div>
          )}
          {selectedKanbanOrder.tableContext && <TableOrderContext context={selectedKanbanOrder.tableContext} />}
          {tableMovement && <div className="space-y-1 text-xs text-koma-secondary">
            {tableMovement.mergedMesaIds.length > 0 && <p>Consumo unido de: {tableMovement.mergedMesaIds.map(id => `Mesa ${id}`).join(', ')}.</p>}
            {tableMovement.transferredFromMesaIds.length > 0 && <p>Consumo transferido de: {tableMovement.transferredFromMesaIds.map(id => `Mesa ${id}`).join(', ')}.</p>}
          </div>}
          {!tableMovement && selectedKanbanOrder.mesaOrigemId && Number(selectedKanbanOrder.mesaOrigemId) !== Number(selectedKanbanOrder.mesaId) && (
            <div className={"bg-emerald-50 dark:bg-emerald-950/20 p-3 rounded-2xl border border-emerald-300 dark:border-emerald-900/40 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between shadow-sm font-sans"}>
              <div>
                <strong className={"text-emerald-800 dark:text-emerald-400 block text-[9px] uppercase tracking-wider font-bold"}>Consumo Mesclado:</strong>
                <span className="leading-relaxed">Este lote possui consumo mesclado da <strong>Mesa {selectedKanbanOrder.mesaOrigemId}</strong> para a <strong>Mesa {selectedKanbanOrder.mesaId}</strong>.</span>
              </div>
            </div>
          )}
          {!tableMovement && selectedKanbanOrder.mesaTransferidaDe && Number(selectedKanbanOrder.mesaTransferidaDe) !== Number(selectedKanbanOrder.mesaId) && (
            <div className={"bg-purple-50 dark:bg-purple-950/20 p-3 rounded-2xl border border-purple-300 dark:border-purple-900/40 text-xs text-purple-800 dark:text-purple-300 flex items-center justify-between shadow-sm font-sans"}>
              <div>
                <strong className={"text-purple-800 dark:text-purple-400 block text-[9px] uppercase tracking-wider font-bold"}>Consumo Transferido:</strong>
                <span className="leading-relaxed">Este lote foi transferido da <strong>Mesa {selectedKanbanOrder.mesaTransferidaDe}</strong> para a <strong>Mesa {selectedKanbanOrder.mesaId}</strong>.</span>
              </div>
            </div>
          )}
          {(selectedKanbanOrder.paymentMethod || Number(selectedKanbanOrder.changeFor || 0) > 0) && (() => {
            const isOnlinePaid =
              selectedKanbanOrder.onlinePaymentStatus === 'approved' ||
              (Number(selectedKanbanOrder.amountPaid || 0) >= Number(selectedKanbanOrder.total || 0) &&
                Number(selectedKanbanOrder.total || 0) > 0);

            if (isOnlinePaid) {
              return (
                <div className="orders-detail-modal__payment is-paid" aria-label="Pagamento do pedido">
                  <div className="flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                      Pagamento online aprovado
                    </span>
                  </div>
                  {selectedKanbanOrder.paymentMethod && (
                    <strong className="mt-1 block text-sm capitalize text-koma-foreground">
                      {selectedKanbanOrder.paymentMethod}
                    </strong>
                  )}
                  {Number(selectedKanbanOrder.amountPaid || 0) > 0 && (
                    <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                      Valor recebido: {formatCurrency(Number(selectedKanbanOrder.amountPaid))}
                    </p>
                  )}
                </div>
              );
            }

            return (
              <div className="orders-detail-modal__payment" aria-label="Pagamento do pedido">
                <span className="block text-[9px] font-bold uppercase tracking-wider text-koma-secondary">
                  Pagamento no atendimento
                </span>
                {selectedKanbanOrder.paymentMethod && (
                  <strong className="mt-1 block text-sm capitalize text-koma-foreground">
                    {selectedKanbanOrder.paymentMethod}
                  </strong>
                )}
                {Number(selectedKanbanOrder.changeFor || 0) > 0 && (
                  <p className="mt-1 text-xs font-bold text-koma-foreground">
                    Troco para {formatCurrency(Number(selectedKanbanOrder.changeFor))}
                  </p>
                )}
              </div>
            );
          })()}
          <div className="space-y-2">
            <div className="orders-detail-modal__section-title">
              <span>Itens do pedido</span>
              <strong>{selectedDetailItems.reduce((sum, item) => sum + item.quantidade, 0)} no total</strong>
            </div>
            <div className="orders-detail-modal__items">
              {selectedDetailItems.map((item, idx) => (
                <div key={item.sourceItems[0]?.id || `${item.nome}-${idx}`} className="orders-detail-modal__item">
                  <span className="orders-detail-modal__quantity">{item.quantidade}×</span>
                  <div className="min-w-0 flex-1">
                    <strong>{item.nome}</strong>
                    <OrderItemComposition item={item} className="orders-detail-modal__observation" />
                    {item.clienteNome !== 'Consumo Geral' && item.clienteNome.toLowerCase() !== 'balcão' && item.clienteNome !== 'Cliente identificado' && item.clienteNome.toLocaleLowerCase() !== selectedKanbanOrder.identificador?.toLocaleLowerCase() && (
                      <span className="orders-detail-modal__for">Para: {item.clienteNome}</span>
                    )}
                    {saveObservation && item.sourceItems.some(source => source.id && source.status === 'preparando' && !source.pago) && (
                      <details className="orders-detail-modal__edit" onToggle={event => { if (event.currentTarget.open) event.currentTarget.querySelector<HTMLTextAreaElement>('textarea')?.focus(); }}>
                        <summary>{itemCompositionPresentation(item).observation ? 'Editar observação' : 'Adicionar observação'}</summary>
                        {item.sourceItems.filter(source => source.id && source.status === 'preparando' && !source.pago).map(source => (
                          <ItemObservationEditor key={source.id} item={source} save={saveObservation} unit={item.quantidade > 1 ? item.sourceItems.indexOf(source) + 1 : undefined} />
                        ))}
                      </details>
                    )}
                  </div>
                  <span className={clsx('orders-detail-modal__item-status', item.status === 'pronto' && 'is-ready')}>
                    {item.status === 'preparando' ? 'Em preparo' : item.status === 'pronto' ? 'Pronto' : item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <footer className="orders-detail-modal__footer">
        {selectedKanbanOrder.contextoSalao && salonActions && (
          <div className="grid grid-cols-2 gap-2" aria-label="Ações da mesa">
            <button type="button" onClick={salonActions.addConsumption} className="orders-detail-modal__reprint min-h-11">
              <Plus size={14} aria-hidden="true" />Adicionar consumo
            </button>
            <button type="button" onClick={salonActions.receive} disabled={!salonActions.canReceive} className="orders-detail-modal__primary-action min-h-11 disabled:cursor-not-allowed disabled:opacity-40">
              <CreditCard size={14} aria-hidden="true" />Receber
            </button>
          </div>
        )}
          {selectedIsDelivery && ['pronto', 'transito'].includes(selectedDeliveryStatus) && selectedKanbanOrder.courierAssignment && (
            <div className="rounded-xl border border-koma-border bg-koma-panel/60 p-3 space-y-2">
              <div className="orders-detail-modal__section-title">
                <span>Entregador</span>
                <strong>{selectedDeliveryStatus === 'transito' ? 'Em rota' : 'Atribuição logística'}</strong>
              </div>
              {selectedCanAssignCourier ? (
                <select
                  aria-label="Entregador do pedido"
                  value={selectedCourierId}
                  disabled={selectedKanbanOrder.courierAssignment.loading}
                  onChange={(event) => selectedKanbanOrder.courierAssignment?.onChange(event.target.value)}
                  className="min-h-10 w-full rounded-xl border border-koma-border bg-koma-card px-3 text-xs font-bold text-koma-foreground outline-none focus:border-emerald-500/60 disabled:opacity-60"
                >
                  <option value="">
                    {selectedKanbanOrder.courierAssignment.loading ? 'Sincronizando entregadores...' : 'Selecionar entregador...'}
                  </option>
                  {selectedKanbanOrder.courierAssignment.options.map((courier) => (
                    <option key={courier.id} value={courier.id}>{courier.nome}</option>
                  ))}
                </select>
              ) : (
                <p className="text-xs font-bold text-koma-secondary">
                  {selectedCourierName || 'Entregador não identificado'}
                </p>
              )}
            </div>
          )}
            {selectedCanAdvanceDigital && (
              <button
                type="button"
                disabled={selectedIsReadyDelivery && (!selectedCourierId || selectedKanbanOrder.courierAssignment?.loading)}
                onClick={() => actions.advanceDigitalOrder(selectedCourierId || undefined)}
                className="orders-detail-modal__primary-action disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check size={15} />
                <span>
                  {selectedKanbanOrder.deliveryStatus === 'aceito'
                    ? 'Iniciar preparo'
                    : selectedIsReadyDelivery
                    ? 'Despachar pedido'
                    : selectedIsDelivery
                      ? 'Marcar como pronto'
                      : selectedIsDineIn
                        ? 'Marcar pronto para servir'
                        : 'Marcar pronto para retirada'}
                </span>
              </button>
            )}
          <details className="orders-detail-modal__more">
            <summary>Mais opções</summary>
            <div className="orders-detail-modal__more-content">
          {hasPrinting !== false && selectedKanbanOrder.tableContext && selectedKanbanOrder.tableContext.launches.length > 0 && (
            <div className="space-y-2 rounded-xl border border-koma-border bg-koma-panel/60 p-3">
              <div className="orders-detail-modal__section-title">
                <span>Pedidos desta mesa</span>
                <strong>{selectedKanbanOrder.tableContext.launches.length} no atendimento</strong>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {selectedKanbanOrder.tableContext.launches.map((launch) => {
                  const label = launch.displayNumber || launch.id;
                  return (
                    <button
                      key={launch.id}
                      type="button"
                      onClick={() => actions.reprintProduction(launch.id)}
                      className="orders-detail-modal__reprint min-h-10"
                      aria-label={`Reimprimir pedido ${label}`}
                    >
                      <Printer size={13} aria-hidden="true" />
                      <span>Reimprimir #{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

            {canChangeFulfillment && (
              <button
                type="button"
                onClick={actions.convertDeliveryToPickup}
                className="orders-detail-modal__secondary-action"
              >
                Alterar tipo do pedido
              </button>
            )}
            {!isWholeTableDetail && hasPrinting !== false && (
              <button
                type="button"
                onClick={() => actions.reprintProduction()}
                className="orders-detail-modal__reprint"
              >
                <Printer size={13} />
                <span>Reimprimir produção</span>
              </button>
            )}
            {Boolean(selectedKanbanOrder.mesaId && selectedKanbanOrder.mesaId > 0) && (
              <div className={"space-y-2 w-full"}>
                {selectedKanbanOrder.contextoSalao && (
                  hasPrinting !== false ? (
                    <div className={"flex gap-2 w-full"}>
                      <button
                        type="button"
                        onClick={actions.printFullTable}
                        title="Reimprime todos os itens ativos da mesa"
                        className={"flex-1 py-2.5 bg-koma-panel hover:bg-koma-raised text-koma-secondary hover:text-koma-foreground font-bold text-xs rounded-xl transition-all cursor-pointer uppercase tracking-wider text-center flex items-center justify-center gap-1.5 border border-koma-border shadow-lg"}
                      >
                        <Printer size={13} />
                        <span>Reimpressão total</span>
                      </button>
                      <button
                        type="button"
                        onClick={actions.printTableValues}
                        title="Imprime a Conta da Mesa"
                        className={"flex-1 py-2.5 bg-koma-panel hover:bg-koma-raised text-koma-secondary hover:text-koma-foreground font-bold text-xs rounded-xl transition-all cursor-pointer uppercase tracking-wider text-center flex items-center justify-center gap-1.5 border border-koma-border shadow-lg"}
                      >
                        <Printer size={13} />
                        <span>Conta da Mesa</span>
                      </button>
                    </div>
                  ) : (
                    <div className="w-full">
                      <DigitalReceiptAction
                        order={{
                          mesaId: selectedKanbanOrder.mesaId,
                          identificador: selectedKanbanOrder.identificador,
                          itens: (selectedKanbanOrder.itens as any) || [],
                          valorPago: selectedKanbanOrder.amountPaid || 0,
                          telefone: selectedKanbanOrder.telefone,
                        }}
                        restaurantConfig={restaurantConfig}
                        taxaServicoAtiva={taxaServicoAtiva}
                        serviceTaxRate={serviceTaxRate}
                        label="Compartilhar Conta da Mesa (WhatsApp)"
                        className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                        onToast={onToast}
                      />
                    </div>
                  )
                )}
                {selectedKanbanOrder.contextoSalao && (
                  <div className={"flex gap-2 w-full"}>
                    <select
                      aria-label="Mesa de destino"
                      value={tableTransferTargetId}
                      onChange={(event) => setTableTransferTargetId(event.target.value)}
                      disabled={isTransferringTable}
                      className={"min-h-10 min-w-0 flex-1 rounded-xl border border-koma-border bg-koma-panel px-3 text-xs font-bold text-koma-secondary outline-none focus:border-emerald-500/60"}
                    >
                      <option value="">Transferir para…</option>
                      {salonTables
                        .filter(table => Number(table.id) !== Number(selectedKanbanOrder.mesaId))
                        .map(table => <option key={table.id} value={table.id}>{getTableAssociationOptionLabel(table)}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={actions.transferTable}
                      disabled={!tableTransferTargetId || isTransferringTable}
                      className={"flex min-h-10 items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"}
                    >
                      {isTransferringTable ? <RefreshCw className="animate-spin" size={13} /> : <ArrowUpRight size={13} />}
                      Transferir
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={actions.cancelConsumption}
                  className={"flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-rose-300 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 px-3 text-[10px] font-bold text-rose-700 dark:text-rose-300 transition-colors hover:bg-rose-100 dark:hover:bg-rose-950/40"}
                >
                  <Trash2 size={13} />
                  {selectedKanbanOrder.contextoSalao ? 'Cancelar toda a mesa e liberar' : 'Cancelar somente este pedido'}
                </button>
              </div>
            )}
            {Number(selectedKanbanOrder.mesaId || 0) <= 0 && (
              <div className="w-full space-y-2">
                {selectedCanAssociateTable && (
                  <>
                    <div className="flex gap-2 w-full">
                      <select
                        aria-label="Mesa para associar ao pedido"
                        aria-describedby="association-table-status"
                        value={tableTransferTargetId}
                        onChange={(event) => setTableTransferTargetId(event.target.value)}
                        disabled={isTransferringTable}
                        className="min-h-10 min-w-0 flex-1 rounded-xl border border-koma-border bg-koma-panel px-3 text-xs font-bold text-koma-secondary outline-none focus:border-emerald-500/60"
                      >
                        <option value="">Associar à mesa…</option>
                        {salonTables.map((table) => (
                          <option key={table.id} value={table.id}>
                            {getTableAssociationOptionLabel(table)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={actions.associateTable}
                        disabled={!tableTransferTargetId || isTransferringTable}
                        className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isTransferringTable ? <RefreshCw className="animate-spin" size={13} /> : <Users size={13} />}
                        {selectedAssociationTable?.isOccupied ? 'Associar mesmo assim' : 'Associar'}
                      </button>
                    </div>
                    <div
                      id="association-table-status"
                      role="status"
                      className={clsx(
                        'flex min-h-10 items-start gap-2 rounded-xl border px-3 py-2 text-[10px]',
                        selectedAssociationTable?.isOccupied
                          ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                          : 'border-koma-border bg-koma-panel text-koma-muted',
                      )}
                    >
                      <span aria-hidden="true" className={clsx(
                        'mt-1 h-2 w-2 shrink-0 rounded-full',
                        selectedAssociationTable?.isOccupied ? 'bg-rose-500' : selectedAssociationTable ? 'bg-emerald-500' : 'bg-koma-muted',
                      )} />
                      <span>
                        {!selectedAssociationTable
                          ? 'Escolha uma mesa. Mesas em atendimento estão marcadas com ●.'
                          : selectedAssociationTable.isOccupied
                            ? `Mesa ${selectedAssociationTable.id} já está em atendimento${Number(selectedAssociationTable.total || 0) > 0 ? `, com ${formatCurrency(Number(selectedAssociationTable.total))} em aberto` : ''}. Associe somente se este cliente estiver nessa mesa.`
                            : `Mesa ${selectedAssociationTable.id} está livre e será vinculada a este pedido.`}
                      </span>
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={actions.cancelOrder}
                  className={"flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-rose-300 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 px-3 text-[10px] font-bold text-rose-700 dark:text-rose-300 transition-colors hover:bg-rose-100 dark:hover:bg-rose-950/40"}
                >
                  <Trash2 size={13} />
                  Cancelar pedido
                </button>
              </div>
            )}
            </div>
          </details>
        </footer>
      </div>
    </div>
  );
}

function ItemObservationEditor({ item, save, unit }: { item: KanbanDetailSourceItem; unit?: number; save: (id: string, observation: string) => Promise<void> }) {
  const [value, setValue] = React.useState(itemCompositionPresentation(item).observation);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState('');
  return <div className="rounded-xl border border-koma-border p-3 space-y-2">
    <label className="block text-xs text-koma-foreground">Observação — {item.nome || item.produto?.nome || 'Item'}{unit ? ` · Unidade ${unit}` : ''}
      <textarea value={value} maxLength={1000} disabled={saving} onChange={event => { setValue(event.target.value); setMessage(''); }} className="mt-2 block w-full rounded-lg border border-koma-border bg-koma-card p-2" />
    </label>
    <button type="button" disabled={saving || value === itemCompositionPresentation(item).observation} onClick={async () => {
      setSaving(true); setMessage('');
      try { await save(String(item.id), value); setMessage('Observação salva.'); }
      catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível salvar.'); }
      finally { setSaving(false); }
    }} className="text-xs font-bold text-emerald-500 disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar observação'}</button>
    {message && <p role="status" className="text-xs">{message}</p>}
  </div>;
}
