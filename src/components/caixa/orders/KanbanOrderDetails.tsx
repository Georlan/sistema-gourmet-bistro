import { PAYMENT_LABELS, type PaymentMethod } from '../../../cardapio/paymentMethods';
import { OrderItemComposition } from '../../shared/OrderItemComposition';
import { itemCompositionPresentation, itemCompositionSignature, type CompositionSource } from '../../../domain/orderItemComposition';
import React from 'react';
import clsx from 'clsx';
import { X, Check } from 'lucide-react';
import type { Table } from '../../../types';
import type { TableOrderContext as Context } from '../../../domain/tableReadModel';
import { TableOrderContext } from '../../shared/TableOrderContext';
import type { CashierTableCard } from './cashierWorkspaceTypes';
import {
  getCashierDeliveryStatusLabel as deliveryStatusLabel,
  getCashierHumanOrderNumber as humanOrderNumber,
} from '../../../domain/cashierOrderProjection';
import { formatBackendTime } from '../../../utils/dateTime';
import { formatCurrency, operationalOriginLabel } from '../cashierPresentation';
import { DigitalReceiptAction } from '../digital-receipt/DigitalReceiptAction';
import { CashierDetailActionArt } from './CashierDetailActionArt';
import { CourierPaymentArtwork } from '../../courier/CourierGlyph';
import { CashierTableDestinations } from './CashierTableDestinations';

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
  readonly loadState?: 'loading' | 'loaded' | 'error';
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
  readonly endereco?: string;
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
    readonly mergeTable?: () => Promise<void>;
    readonly associateTable: () => void;
    readonly convertDeliveryToPickup: () => void;
    readonly cancelConsumption: () => void;
    readonly cancelOrder: () => void;
  };
  readonly canChangeFulfillment?: boolean;
  readonly checkingFulfillment?: boolean;
  readonly fulfillmentCheckFailed?: boolean;
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
  checkingFulfillment = false,
  fulfillmentCheckFailed = false,
  restaurantConfig,
  taxaServicoAtiva,
  serviceTaxRate,
  onToast,
}: KanbanOrderDetailsProps) {
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
  const hasTableConversion = !selectedIsQuickSale && selectedKanbanOrder.mesaId > 0;
  const checkingConversion = checkingFulfillment && !canChangeFulfillment && !hasTableConversion;
  const conversionLabel = fulfillmentCheckFailed && !hasTableConversion
    ? 'Tentar verificar alteração de tipo'
    : checkingConversion ? 'Verificando alteração de tipo' : 'Tipo e endereço';
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
  const selectedCanAdvanceDigital = selectedIsDigital && selectedIsReadyDelivery;
  const isGeneratedTableLabel = Number(selectedKanbanOrder.mesaId) > 0
    && new RegExp(`^mesa\\s*0*${Number(selectedKanbanOrder.mesaId)}$`, 'i').test(String(selectedKanbanOrder.identificador || '').trim());
  const paymentLabel = selectedKanbanOrder.paymentMethod && (Object.hasOwn(PAYMENT_LABELS, selectedKanbanOrder.paymentMethod) ? PAYMENT_LABELS[selectedKanbanOrder.paymentMethod as PaymentMethod] : selectedKanbanOrder.paymentMethod.replace(/_/g, ' '));
  const detailArt = selectedIsDelivery ? 'delivery' : selectedKanbanOrder.mesaId > 0 || selectedIsDineIn ? 'table' : 'pickup';

  return (
    <KanbanDetailFrame close={() => { if (!transfer.isTransferring) actions.close(); }}>
        <div className="orders-detail-modal__hero">
          <div className={clsx('orders-detail-modal__number', selectedIsQuickSale && 'is-quick-sale')}>
            <img src={`/brand/cashier/detail-${detailArt}-v2.svg`} width="64" height="64" alt="" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="orders-detail-modal__eyebrow">
              {selectedIsQuickSale
                ? 'Venda rápida'
                : selectedIsTableLinkedPickup
                  ? 'Retirada vinculada à mesa'
                  : selectedIsTableLinkedDineIn
                    ? 'Consumo'
                    : selectedKanbanOrder.contextoSalao
                      ? 'Atendimento do salão'
                      : selectedIsDelivery
                        ? 'Entrega'
                        : selectedIsDineIn
                          ? 'Consumo'
                          : 'Retirada'}
              {!selectedKanbanOrder.tableContext && <span> · {formatBackendTime(selectedKanbanOrder.criadoEm || selectedKanbanOrder.created_at)}</span>}
            </span>
            <h3 id="kanban-detail-title" className="orders-detail-modal__title">
              {selectedIsQuickSale
                ? `Pedido #${selectedOrderNumber}`
                : selectedIsTableLinkedPickup
                  ? `Retirada · Mesa ${String(selectedKanbanOrder.mesaId).padStart(2, '0')}`
                  : selectedIsTableLinkedDineIn
                    ? `Mesa ${String(selectedKanbanOrder.mesaId).padStart(2, '0')}`
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
            <div className="kd-hero-controls">
            {(canChangeFulfillment || checkingFulfillment || fulfillmentCheckFailed || hasTableConversion) && <button type="button" className="kd-hero-change" disabled={transfer.isTransferring || checkingConversion} onClick={actions.convertDeliveryToPickup} aria-label={conversionLabel} title={conversionLabel}><CashierDetailActionArt kind="change" /></button>}
            <button
              type="button"
              onClick={actions.close}
              disabled={transfer.isTransferring}
              className="orders-detail-modal__close"
              aria-label="Fechar detalhes"
            >
              <X size={18} />
            </button>
            </div>
          </div>
        </div>
        <div className="orders-detail-modal__body">
          {selectedKanbanOrder.identificador && !selectedIsQuickSale && !isGeneratedTableLabel && (
            <div className="orders-detail-modal__customer">
              <div><span>{selectedKanbanOrder.contextoSalao ? 'Atendimento' : 'Cliente'}</span><strong>{selectedKanbanOrder.identificador}</strong></div>
              {selectedKanbanOrder.telefone && <span className="orders-detail-modal__phone">{selectedKanbanOrder.telefone}</span>}
            </div>
          )}
          {selectedIsDelivery && selectedKanbanOrder.endereco && <div className="orders-detail-modal__address">
            <svg viewBox="0 0 32 40" width="28" height="35" fill="none" aria-hidden="true"><path d="M16 37S3 23 3 15a13 13 0 1 1 26 0c0 8-13 22-13 22Z" fill="#a7cfe8" stroke="#15394f" strokeWidth="2"/><circle cx="16" cy="15" r="5" fill="#15394f"/></svg>
            <div><span>Endereço de entrega</span><strong>{selectedKanbanOrder.endereco}</strong></div>
          </div>}

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
          {(selectedKanbanOrder.paymentMethod || Number(selectedKanbanOrder.changeFor || 0) > 0 || Number(selectedKanbanOrder.amountPaid || 0) > 0 || selectedKanbanOrder.onlinePaymentStatus === 'approved') && (() => {
            const paid = Math.max(0, Number(selectedKanbanOrder.amountPaid || 0));
            const due = Math.max(0, selectedKanbanOrder.amountDue ?? (selectedOrderTotal - paid));
            const onlineApproved = selectedKanbanOrder.onlinePaymentStatus === 'approved';
            // Online approval is not proof of a settled balance when the values are missing or disagree.
            const fullyPaid = selectedOrderTotal > 0 && paid >= selectedOrderTotal && due < 0.01;
            const needsVerification = onlineApproved && !fullyPaid && paid <= 0;
            if (fullyPaid) {
              return <div className="orders-detail-modal__payment is-paid kd-payment kd-payment--paid" aria-label="Pagamento do pedido">
                <span className="kd-payment__paid-symbol" aria-hidden="true"><Check size={20} strokeWidth={2.5} /></span>
                <div className="kd-payment__copy"><strong>{selectedIsDelivery ? 'Não cobrar' : 'Pago'}</strong><span>{onlineApproved ? 'Pagamento online aprovado' : 'Pagamento registrado'}</span></div>
              </div>;
            }
            if (needsVerification) {
              return <div className="orders-detail-modal__payment kd-payment" aria-label="Pagamento do pedido">
                <div className="kd-payment__copy"><strong>Conferir pagamento</strong><span>Pagamento online aprovado</span></div>
              </div>;
            }
            return <div className="orders-detail-modal__payment kd-payment" aria-label="Pagamento do pedido">
              <div className="kd-payment__copy">
                <span>{selectedIsDelivery ? 'Cobrar na entrega' : 'Pagamento no atendimento'}</span>
                {selectedIsDelivery && selectedOrderTotal > 0 && <strong>{formatCurrency(due)}</strong>}
                {onlineApproved && paid > 0 && <span>Pagamento online registrado parcialmente</span>}
                {selectedKanbanOrder.paymentMethod && <span className={selectedIsDelivery && /^(dinheiro|cartao|cartao_credito|cartao_debito)$/.test(selectedKanbanOrder.paymentMethod) ? 'sr-only' : undefined}>{paymentLabel}</span>}
                {String(selectedKanbanOrder.paymentMethod || '').trim().toLowerCase() === 'dinheiro' && Number(selectedKanbanOrder.changeFor || 0) > 0 && <p>Troco para {formatCurrency(Number(selectedKanbanOrder.changeFor))}</p>}
              </div>
              {selectedIsDelivery && selectedKanbanOrder.paymentMethod && /^(dinheiro|cartao|cartao_credito|cartao_debito)$/.test(selectedKanbanOrder.paymentMethod) && <CourierPaymentArtwork method={selectedKanbanOrder.paymentMethod === 'dinheiro' ? 'cash' : 'card'} />}
            </div>;
          })()}
          <details className="kd-items-disclosure">
            <summary><CashierDetailActionArt kind="items" /><span>Ver {selectedDetailItems.reduce((sum, item) => sum + item.quantidade, 0)} {selectedDetailItems.reduce((sum, item) => sum + item.quantidade, 0) === 1 ? 'item' : 'itens'}</span><span className="kd-items-chevron" aria-hidden="true">⌄</span></summary>
            {selectedKanbanOrder.tableContext && <TableOrderContext context={selectedKanbanOrder.tableContext} />}
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
          </details>
        </div>
        <footer className="orders-detail-modal__footer kd-footer">
          {salonActions && <div className="kd-actions-grid" aria-label="Ações da mesa">
            <button type="button" onClick={salonActions.addConsumption} className="kd-action kd-action--add"><CashierDetailActionArt kind="add" /><span>Adicionar itens</span></button>
            <button type="button" onClick={salonActions.receive} disabled={!salonActions.canReceive} className="kd-action kd-action--receive"><CashierDetailActionArt kind="receive" /><span>Receber</span></button>
          </div>}
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
                    {selectedKanbanOrder.courierAssignment.loadState === 'error' ? 'Não foi possível carregar entregadores' : selectedKanbanOrder.courierAssignment.loading ? 'Sincronizando entregadores...' : 'Selecionar entregador...'}
                  </option>
                  {selectedKanbanOrder.courierAssignment.options.map((courier) => (
                    <option key={courier.id} value={courier.id}>{courier.nome}</option>
                  ))}
                </select>
              ) : (
                <p className="text-xs font-bold text-koma-secondary">
                  {selectedCourierName || (selectedKanbanOrder.courierAssignment.loadState === 'error' ? 'Não foi possível carregar o entregador' : selectedKanbanOrder.courierAssignment.loading ? 'Carregando entregador…' : 'Entregador não identificado')}
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
                  {selectedIsReadyDelivery
                    ? 'Despachar pedido'
                    : selectedIsDelivery
                      ? 'Marcar como pronto'
                      : selectedIsDineIn
                        ? 'Marcar pronto para servir'
                        : 'Marcar pronto para retirada'}
                </span>
              </button>
            )}

          {hasPrinting !== false && <div className="kd-actions-grid" aria-label="Impressão">
            <button type="button" onClick={actions.printFullTable} className="kd-action kd-action--print"><CashierDetailActionArt kind="print" /><span>Reimprimir Total</span></button>
            {selectedKanbanOrder.mesaId > 0 && <button type="button" onClick={actions.printTableValues} className="kd-action kd-action--bill"><CashierDetailActionArt kind="bill" /><span>Conta Total</span></button>}
          </div>}
          {hasPrinting === false && selectedKanbanOrder.mesaId > 0 && <DigitalReceiptAction order={{ mesaId: selectedKanbanOrder.mesaId, identificador: selectedKanbanOrder.identificador, itens: selectedKanbanOrder.itens as any, valorPago: selectedKanbanOrder.amountPaid || 0, telefone: selectedKanbanOrder.telefone }} restaurantConfig={restaurantConfig} taxaServicoAtiva={taxaServicoAtiva} serviceTaxRate={serviceTaxRate} onToast={onToast} label="Compartilhar conta" />}
          {selectedKanbanOrder.mesaId > 0 && (selectedKanbanOrder.contextoSalao || salonActions) && <CashierTableDestinations source={selectedKanbanOrder.mesaId} transfer={transfer} actions={actions} />}
          {selectedCanAssociateTable && <CashierTableDestinations association source={0} transfer={transfer} actions={actions} />}
          {selectedIsDelivery && selectedDeliveryStatus === 'finalizado' && !(selectedKanbanOrder.mesaId > 0)
            ? <p className="text-sm text-koma-secondary">Entrega concluída.{Number(selectedKanbanOrder.amountDue || 0) > 0 && ' Registre o pagamento pendente no Caixa.'}</p>
            : <button type="button" onClick={selectedKanbanOrder.mesaId > 0 ? actions.cancelConsumption : actions.cancelOrder} className="kd-action kd-action--cancel">
            <CashierDetailActionArt kind="cancel" /><span>{selectedKanbanOrder.contextoSalao ? 'Cancelar toda a mesa e liberar' : selectedKanbanOrder.mesaId > 0 ? 'Cancelar somente este pedido' : 'Cancelar pedido'}</span>
          </button>}
        </footer>
    </KanbanDetailFrame>
  );
}


/** Focus/return behavior stays separate from the stateless order presentation. */
function KanbanDetailFrame({ close, children }: { close: () => void; children: React.ReactNode }) {
  const dialog = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('[aria-label="Fechar detalhes"]')?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <div onClick={event => { if (event.target === event.currentTarget) close(); }}
    className="fixed inset-0 bg-black/85 backdrop-blur-xs z-[80] flex items-center justify-center p-4 cursor-pointer">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="kanban-detail-title"
      className="orders-detail-modal w-full max-w-[44rem] max-h-[calc(100dvh-2rem)] overflow-hidden rounded-3xl flex flex-col text-left relative animate-scale-in"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
        )).filter(control => {
          if (!control.getClientRects().length || getComputedStyle(control).visibility === 'hidden') return false;
          for (let parent = control.parentElement; parent; parent = parent.parentElement) {
            if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(control)) return false;
          }
          return true;
        });
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>{children}</div>
  </div>;
}

function ItemObservationEditor({ item, save, unit }: { item: KanbanDetailSourceItem; unit?: number; save: (id: string, observation: string) => Promise<void> }) {
  const [value, setValue] = React.useState(itemCompositionPresentation(item).observation);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const closeEditor = (element: HTMLElement) => {
    const details = element.closest('details');
    if (details) { details.open = false; details.querySelector('summary')?.focus(); }
  };
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
    <button type="button" disabled={saving} onClick={event => closeEditor(event.currentTarget)} className="orders-detail-modal__observation-close">Fechar edição</button>
    {message && <p role="status" className="text-xs">{message}</p>}
  </div>;
}
