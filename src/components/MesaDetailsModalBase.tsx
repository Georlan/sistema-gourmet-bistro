import { MesaPrintActions } from './mesas/MesaPrintActions';
import { findRepeatedDraft, planWaiterRepeat, type RepeatConfiguration } from '../domain/waiterRepeatItem';
import { WaiterServiceArtwork } from './mesas/WaiterServiceArtwork';
import { TablePresenceNotice } from './shared/TablePresenceNotice';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Clock, Receipt, PlusCircle, Move, ArrowLeft, GitMerge } from 'lucide-react';
import { Table, Order, DraftItem, AppSettings, Product, AppRole, OrderItem } from '../types';
import { getTableTotal, getCustomerSubtotals } from '../domain';
import { deriveTableOperationalState } from '../domain/operationalState';
import { MenuPanel } from './MenuPanel';
import { RESTAURANT_CONFIG } from '../data';
import type { CatalogCategory } from '../catalog/catalog';
import { MesaConsumptionPanel } from './mesas/MesaConsumptionPanel';
import { MesaTransferMergePanel } from './mesas/MesaTransferMergePanel';
import { MesaPrintDialogs } from './mesas/MesaPrintDialogs';

interface MesaDetailsModalProps {
  table: Table;
  orders: Order[];
  /** Internal adapter projection, computed before splitting checks into launches. */
  tableOperationalState?: ReturnType<typeof deriveTableOperationalState>;
  allOrders?: Order[]; // The full list of active orders across all tables to identify empty tables
  draftItems: DraftItem[];
  settings: AppSettings;
  activeRole: AppRole;
  activeWaiterId: string;
  activeWaiterNome: string;
  initialReadyOnly?: boolean;
  initialTab?: 'consumo' | 'lancamento' | 'transferir' | 'mesclar';
  currentTime: number;
  onClose: () => void;
  onUpdateSettings: (settings: AppSettings) => void;
  onAddToDraft: (product: Product, quantity?: number, observacao?: string, clienteNome?: string) => void;
  onRemoveFromDraft: (draftItemId: string) => void;
  onRestoreDraftItem?: (item: DraftItem, index: number) => boolean;
  draftScopeKey?: string | null;
  onUpdateDraftItem: (draftItemId: string, updates: Partial<DraftItem>) => void;
  onEditDraftItems: (
    draftItemIds: string[],
    updates: Pick<DraftItem, 'quantidade' | 'observacao' | 'clienteNome'>,
  ) => void;
  onSubmitDraft: (orderType: 'Consumo no Local' | 'Retirada' | 'Entrega') => void;
  otherWaitersServing?: string[];
  onTransferTable: (targetTableId: number) => void;
  onTransferItem: (itemId: string, targetTableId: number) => void;
  onTransferItems: (itemIds: string[], targetTableId: number) => void;
  onCancelItem: (itemId: string) => void;
  onCloseTable: () => void;
  onSettleCustomer?: (customerName: string) => void;
  onDeliverItem?: (orderId: string, itemId: string) => void;
  historicClients?: string[];
  restaurantName?: string;
  onClearTableOrders?: () => void;
  onPrintReceipt?: (apenasValores?: boolean) => void | Promise<void>;
  onPrintKitchenLaunch?: (orderId: string) => void | Promise<void>;
  salonTables?: Table[];
  liveProdutos?: Product[];
  liveCategorias?: CatalogCategory[];
  catalogReady?: boolean;
  restauranteConfig?: any;
  onUpdateItemDetails?: (itemId: string, observacao: string, clienteNome: string, quantidadeAdicional?: number) => void | Promise<void>;
  isSubmitting?: boolean;
  onMergeTables?: (sourceTableId: number, targetTableId: number) => void;
  onUnmergeTable?: (comandaId: string) => void;
}

export const MesaDetailsModal: React.FC<MesaDetailsModalProps> = ({
  table,
  orders,
  tableOperationalState,
  allOrders = [],
  draftItems,
  isSubmitting = false,
  settings,
  activeRole,
  activeWaiterId,
  activeWaiterNome,
  initialTab,
  initialReadyOnly = false,
  currentTime,
  onClose,
  onUpdateSettings,
  onAddToDraft,
  onRemoveFromDraft,
  onRestoreDraftItem,
  draftScopeKey,
  onUpdateDraftItem,
  onEditDraftItems,
  onSubmitDraft,
  otherWaitersServing = [],
  onTransferTable,
  onTransferItem,
  onTransferItems,
  onCancelItem,
  onCloseTable,
  onSettleCustomer,
  onDeliverItem,
  historicClients = [],
  restaurantName = RESTAURANT_CONFIG.nomePadrao,
  onClearTableOrders,
  onPrintReceipt,
  onPrintKitchenLaunch,
  salonTables,
  liveProdutos = [],
  liveCategorias = [],
  catalogReady = false,
  restauranteConfig,
  onUpdateItemDetails,
  onMergeTables,
  onUnmergeTable,
}) => {
  // Dynamic default tab based on whether table is active or empty, or explicit initialTab
  const [requestedTab, setActiveTab] = useState<'consumo' | 'lancamento' | 'transferir' | 'mesclar'>(
    initialTab ?? (orders.length === 0 ? 'lancamento' : 'consumo')
  );
  const [readyOnly, setReadyOnly] = useState(initialReadyOnly);
  const showReadyOnly = readyOnly && activeRole === 'garcom' && restauranteConfig?.perm_garcom_status !== false;
  const [repeatConfiguration, setRepeatConfiguration] = useState<RepeatConfiguration | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState<boolean>(false);
  const [selectedOrderToPrint, setSelectedOrderToPrint] = useState<Order | null>(null);
  const [confirmTransferTo, setConfirmTransferTo] = useState<number | null>(null);
  const [selectedItemsForTransfer, setSelectedItemsForTransfer] = useState<string[]>([]);
  const [transferType, setTransferType] = useState<'total' | 'parcial' | 'mesclar'>('total');
  const [printSuccess, setPrintSuccess] = useState<boolean>(false);
  const [isPrintingDirect, setIsPrintingDirect] = useState<boolean>(false);
  const [directPrintToast, setDirectPrintToast] = useState<string>('');
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  const canTransferTables = activeRole !== 'garcom'
    || Boolean(restauranteConfig?.perm_garcom_transferir_mesa);
  const canTransferItems = activeRole !== 'garcom'
    || Boolean(restauranteConfig?.perm_garcom_transferir_item);
  const canCreateExternalOrder = activeRole !== 'garcom'
    || Boolean(restauranteConfig?.perm_garcom_delivery);
  const canAppendOrderItems = activeRole !== 'garcom'
    || orders.length === 0
    || Boolean(restauranteConfig?.perm_garcom_editar);
  const hasPrinting = restauranteConfig?.entitlements?.printing === true
    && (activeRole !== 'garcom' || restauranteConfig?.perm_garcom_print === true);
  const canEditItems = activeRole !== 'garcom' || Boolean(restauranteConfig?.perm_garcom_editar);
  const activeTab = (requestedTab === 'lancamento' && !canAppendOrderItems)
    || (requestedTab === 'transferir' && ((!canTransferTables && !canTransferItems)
      || (transferType === 'total' && !canTransferTables) || (transferType === 'parcial' && !canTransferItems)))
    || (requestedTab === 'mesclar' && !canTransferTables) ? 'consumo' : requestedTab;
  React.useEffect(() => {
    if (activeTab !== requestedTab) setActiveTab(activeTab);
    if (!canEditItems) setEditingItem(null);
    if (!canTransferTables && !canTransferItems) {
      setSelectedItemsForTransfer([]);
      setConfirmTransferTo(null);
    }
  }, [activeTab, requestedTab, canEditItems, canTransferTables, canTransferItems]);

  // Lock background scroll when modal is active
  React.useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const totalValue = getTableTotal(orders);
  const customerSubtotals = getCustomerSubtotals(orders);

  const operationalState = tableOperationalState || deriveTableOperationalState({
    table,
    orders,
    now: currentTime,
  });
  const canRepeatItems = activeRole === 'garcom' && canAppendOrderItems
    && operationalState.financial !== 'AWAITING_PAYMENT' && !operationalState.hasPendingConfirmation;
  const handleRepeatItem = (item: OrderItem) => {
    if (!canRepeatItems || isSubmitting || !catalogReady) return;
    const plan = planWaiterRepeat(item, liveProdutos.find(product => product.id === item.produtoId));
    if (plan.kind === 'unavailable') return;
    if (plan.kind === 'configure') {
      setRepeatConfiguration(plan.configuration);
      setActiveTab('lancamento');
      return;
    }
    const existing = findRepeatedDraft(draftItems, plan);
    if (existing) onUpdateDraftItem(existing.id, { quantidade: (existing.quantidade || 1) + 1 });
    else onAddToDraft(plan.product, 1, plan.observation, plan.client);
  };
  const repeatedDraftQuantity = draftItems.reduce((sum, item) => sum + (item.quantidade || 1), 0);
  const elapsedTime = operationalState.elapsed;

  const originIds = Array.from(new Set(orders.map(o => o.mesaOrigemId).filter((id): id is number => id !== null && id !== undefined && id !== table.id)));
  const originStr = originIds.length > 0 ? ` + ${originIds.join(' + ')}` : '';

  // One direct-print path for both closing summary and full receipt.
  // The legacy preview remains only as a safe fallback when no real print handler is wired.
  const handleDirectReceiptPrint = async (apenasValores: boolean) => {
    if (!onPrintReceipt) {
      setShowPrintPreview(true);
      return;
    }

    setIsPrintingDirect(true);
    try {
      await onPrintReceipt(apenasValores);
      setDirectPrintToast('Impressão enviada com sucesso.');
      setTimeout(() => setDirectPrintToast(''), 3000);
    } catch (e) {
      console.error(e);
      alert(apenasValores
        ? 'Erro ao enviar impressão de fechamento'
        : 'Erro ao enviar reimpressão da mesa');
    } finally {
      setIsPrintingDirect(false);
    }
  };

  const handleDirectPrint = () => handleDirectReceiptPrint(true);
  const handleDirectFullPrint = () => handleDirectReceiptPrint(false);

  const handleCloseTableConfirmation = () => {
    if (confirmClear) {
      onCloseTable();
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
    }
  };

  const handleReceiptPrint = async (apenasValores = false) => {
    if (!onPrintReceipt) return;
    try {
      await onPrintReceipt(apenasValores);
      setPrintSuccess(true);
      setTimeout(() => {
        setPrintSuccess(false);
        setShowPrintPreview(false);
      }, 1500);
    } catch (err) {
      console.error("Error printing receipt:", err);
      alert(apenasValores ? "Erro ao enviar impressão de fechamento" : "Erro ao enviar reimpressão da mesa");
    }
  };

  const handleKitchenPrint = async (launchId: string) => {
    if (!onPrintKitchenLaunch) return;
    try {
      await onPrintKitchenLaunch(launchId);
      setPrintSuccess(true);
      setTimeout(() => {
        setPrintSuccess(false);
        setSelectedOrderToPrint(null);
      }, 1500);
    } catch (err) {
      console.error("Error reprinting kitchen launch:", err);
      alert("Erro ao enviar reimpressão para a cozinha");
    }
  };

  return (
    <div 
      id="modal-outer-overlay"
      onClick={(e) => {
        if ((e.target as HTMLElement).id === 'modal-outer-overlay') {
          onClose();
        }
      }}
      className="kw-flow-overlay fixed inset-0 bg-black/75 flex items-center justify-center p-0 sm:p-4 z-40 animate-fade-in overflow-y-auto"
    >
      <div className="kw-flow bg-koma-card rounded-none sm:rounded-3xl border-0 sm:border border-koma-border shadow-2xl w-full max-w-5xl overflow-hidden h-full sm:h-auto max-h-full sm:max-h-[90vh] flex flex-col">
        <header className="kw-flow-hero">
          <div className="kw-flow-toolbar">
            <button type="button" onClick={onClose} aria-label="Voltar ao mapa de mesas" title="Voltar ao mapa" className="kw-flow-back"><ArrowLeft size={19} /></button>
            <div className="kw-flow-title"><span>Atendimento</span><h2>{table.nome?.trim() || `Mesa ${table.id}`}{originStr}</h2></div>
            <WaiterServiceArtwork className="kw-flow-art" />
            <button id="close-mesa-modal-btn" type="button" onClick={onClose} aria-label="Fechar detalhes da mesa" className="kw-flow-close"><X size={19} /></button>
          </div>
          <div className="kw-flow-meta"><span>{activeWaiterNome}</span>
            {orders.length > 0 && <span aria-label={`Tempo na mesa ${elapsedTime}`}><Clock size={12} />{elapsedTime}</span>}
            <TablePresenceNotice names={otherWaitersServing} />
          </div>
        </header>

        {/* MODAL TABS */}
        <div
          role="tablist"
          aria-label="Ações da mesa"
          className="kw-flow-tabs bg-koma-panel border-b border-koma-border px-2.5 sm:px-5 py-1.5 flex items-center gap-1.5 sm:gap-2 shrink-0 overflow-x-auto scrollbar-none no-scrollbar z-20"
        >
          <button
            id="tab-consumo-btn"
            type="button"
            role="tab"
            aria-selected={activeTab === 'consumo'}
            onClick={() => setActiveTab('consumo')}
            className={`flex-1 sm:flex-initial min-h-9 px-3 sm:px-4 py-1.5 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer uppercase tracking-wider font-sans whitespace-nowrap border ${
              activeTab === 'consumo' 
                ? 'bg-koma-raised text-emerald-400 shadow-sm border-koma-border' 
                : 'text-koma-subtle hover:text-koma-foreground border-transparent'
            }`}
          >
            <Receipt size={13} className="text-emerald-400" />
            <span>Consumo</span>
          </button>

          {canAppendOrderItems && (
          <button
            id="tab-lancamento-btn"
            type="button"
            role="tab"
            aria-label="Pedido (Cardápio)"
            aria-selected={activeTab === 'lancamento'}
            onClick={() => setActiveTab('lancamento')}
            className={`flex-1 sm:flex-initial min-h-9 px-3 sm:px-4 py-1.5 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer uppercase tracking-wider font-sans whitespace-nowrap border ${
              activeTab === 'lancamento' 
                ? 'bg-koma-raised text-emerald-400 shadow-sm border-koma-border' 
                : 'text-koma-subtle hover:text-koma-foreground border-transparent'
            }`}
          >
            <PlusCircle size={13} className="text-emerald-400" />
            <span>{canRepeatItems && activeTab === 'consumo' && repeatedDraftQuantity > 0 ? 'Revisar' : 'Lançar'}</span>
            {draftItems.length > 0 && (
              <span aria-live="polite" className="min-w-4 h-4 px-1 rounded-full bg-emerald-500 text-zinc-950 text-[9px] font-mono font-extrabold flex items-center justify-center">
                {draftItems.reduce((total, item) => total + (item.quantidade || 1), 0)}
              </span>
            )}
          </button>
          )}

          {orders.length > 0 && (canTransferTables || canTransferItems) && (
            <button
              id="tab-transferir-btn"
              type="button"
              role="tab"
              aria-selected={activeTab === 'transferir'}
              onClick={() => {
                setActiveTab('transferir');
                setTransferType(canTransferTables ? 'total' : 'parcial');
              }}
              className={`flex-1 sm:flex-initial min-h-9 px-3 sm:px-4 py-1.5 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer uppercase tracking-wider font-sans whitespace-nowrap border ${
                activeTab === 'transferir' 
                  ? 'bg-koma-raised text-emerald-400 shadow-sm border-koma-border' 
                  : 'text-koma-subtle hover:text-koma-foreground border-transparent'
              }`}
            >
              <Move size={13} className="text-emerald-400" />
              <span>Transferir</span>
            </button>
          )}

          {orders.length > 0 && onMergeTables && canTransferTables && (
            <button
              id="tab-mesclar-btn"
              type="button"
              role="tab"
              aria-selected={activeTab === 'mesclar'}
              onClick={() => {
                setActiveTab('mesclar');
              }}
              className={`flex-1 sm:flex-initial min-h-9 px-3 sm:px-4 py-1.5 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer uppercase tracking-wider font-sans whitespace-nowrap border ${
                activeTab === 'mesclar' 
                  ? 'bg-koma-raised text-emerald-400 shadow-sm border-koma-border' 
                  : 'text-koma-subtle hover:text-koma-foreground border-transparent'
              }`}
            >
              <GitMerge size={13} className="text-emerald-400" />
              <span>Mesclar</span>
            </button>
          )}
        </div>

        {/* MODAL BODY WITH SCROLL */}
        <div className="kw-flow-body overflow-y-auto flex-1 text-left p-0">
          
          {/* TAB 1: CONSUMO ATIVO */}
          {activeTab === 'consumo' && (
            <>
            <MesaConsumptionPanel
              table={table}
              readyOnly={showReadyOnly}
              onToggleReadyOnly={initialReadyOnly && activeRole === 'garcom' && restauranteConfig?.perm_garcom_status !== false ? () => setReadyOnly(value => !value) : undefined}
              orders={orders}
              currentTime={currentTime}
              activeRole={activeRole}
              restauranteConfig={restauranteConfig}
              totalValue={totalValue}
              customerSubtotals={customerSubtotals}
              canTransferTables={canTransferTables}
              canTransferItems={canTransferItems}
              isPrintingDirect={isPrintingDirect}
              directPrintToast={directPrintToast}
              confirmClear={confirmClear}
              setActiveTab={setActiveTab}
              setTransferType={setTransferType}
              setSelectedOrderToPrint={setSelectedOrderToPrint}
              setEditingItem={setEditingItem}
              onPrintPreview={handleDirectFullPrint}
              onPrintValues={handleDirectPrint}
              onCloseTable={onCloseTable && (activeRole !== 'garcom' || restauranteConfig?.perm_garcom_fechar) ? handleCloseTableConfirmation : undefined}
              onMergeTables={onMergeTables}
              onUnmergeTable={onUnmergeTable}
              onDeliverItem={onDeliverItem}
              onCancelItem={onCancelItem}
              onRepeatItem={canRepeatItems ? handleRepeatItem : undefined}
              repeatProducts={liveProdutos}
              repeatCatalogReady={catalogReady}
              isSubmitting={isSubmitting}
            />
            </>
          )}

          {/* TAB 2: LANÇAR ITENS (MOUNTS MENUPANEL) */}
          {activeTab === 'lancamento' && (
            <MenuPanel
              key={`${table.id}:${draftScopeKey ?? ''}`}
              standardQuickEntry={activeRole === 'garcom'}
              initialConfiguration={repeatConfiguration}
              onInitialConfigurationConsumed={() => setRepeatConfiguration(null)}
              tableId={table.id}
              draftItems={draftItems}
              existingOrders={orders}
              settings={settings}
              onUpdateSettings={onUpdateSettings}
              onAddToDraft={onAddToDraft}
              onRemoveFromDraft={onRemoveFromDraft}
              onRestoreDraftItem={onRestoreDraftItem}
              onUpdateDraftItem={onUpdateDraftItem}
              onEditDraftItems={onEditDraftItems}
              onSubmitDraft={onSubmitDraft}
              historicClients={historicClients}
              isSubmitting={isSubmitting}
              liveProdutos={liveProdutos}
              liveCategorias={liveCategorias}
              catalogReady={catalogReady}
              allowExternalOrders={canCreateExternalOrder}
            />
          )}

          <MesaTransferMergePanel
            compact={activeRole === 'garcom'}
            activeTab={activeTab}
            table={table}
            orders={orders}
            allOrders={allOrders}
            salonTables={salonTables}
            originIds={originIds}
            canTransferTables={canTransferTables}
            canTransferItems={canTransferItems}
            transferType={transferType}
            selectedItemsForTransfer={selectedItemsForTransfer}
            confirmTransferTo={confirmTransferTo}
            setTransferType={setTransferType}
            setSelectedItemsForTransfer={setSelectedItemsForTransfer}
            setConfirmTransferTo={setConfirmTransferTo}
            onTransferTable={onTransferTable}
            onTransferItems={onTransferItems}
            onMergeTables={onMergeTables}
          />

        </div>

        {activeRole === 'garcom' && activeTab === 'consumo' && hasPrinting && orders.length > 0 && (
          <div className="kw-consumption-actions" role="toolbar" aria-label="Ações da mesa">
            {directPrintToast && <p className="kw-consumption-actions__feedback" role="status">{directPrintToast}</p>}
            <MesaPrintActions isPrintingDirect={isPrintingDirect} onPrintValues={handleDirectPrint} onPrintPreview={handleDirectFullPrint} />
          </div>
        )}
      </div>

      {hasPrinting && <MesaPrintDialogs
        table={table}
        orders={orders}
        restaurantName={restaurantName}
        activeWaiterNome={activeWaiterNome}
        restauranteConfig={restauranteConfig}
        showPrintPreview={showPrintPreview}
        selectedOrderToPrint={selectedOrderToPrint}
        printSuccess={printSuccess}
        setShowPrintPreview={setShowPrintPreview}
        setSelectedOrderToPrint={setSelectedOrderToPrint}
        onPrintReceipt={onPrintReceipt ? handleReceiptPrint : undefined}
        onPrintKitchenLaunch={onPrintKitchenLaunch ? handleKitchenPrint : undefined}
      />}

      {editingItem && canEditItems && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditingItem(null);
            }
          }}
          className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 cursor-pointer"
        >
          <div className="w-full max-w-sm bg-koma-dialog border border-koma-border rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in">
            <div className="flex justify-between items-center pb-2 border-b border-koma-border">
              <h3 className="font-serif text-sm font-bold text-koma-foreground">Editar Item: {editingItem.nome}</h3>
              <button 
                type="button"
                onClick={() => setEditingItem(null)} 
                className="p-1 text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Quantity Selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">Quantidade:</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingItem({ ...editingItem, quantidade: Math.max(1, editingItem.quantidade - 1) })}
                    className="w-8 h-8 rounded-xl bg-koma-raised hover:bg-koma-card border border-koma-border flex items-center justify-center text-koma-foreground font-bold cursor-pointer transition-colors"
                  >
                    -
                  </button>
                  <span className="text-sm font-bold text-koma-foreground font-mono w-6 text-center">{editingItem.quantidade}</span>
                  <button
                    type="button"
                    onClick={() => setEditingItem({ ...editingItem, quantidade: editingItem.quantidade + 1 })}
                    className="w-8 h-8 rounded-xl bg-koma-raised hover:bg-koma-card border border-koma-border flex items-center justify-center text-koma-foreground font-bold cursor-pointer transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Observations Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">Observações de Preparo:</label>
                <input
                  type="text"
                  value={editingItem.observacao}
                  onChange={(e) => setEditingItem({ ...editingItem, observacao: e.target.value })}
                  className="w-full px-3.5 py-2 text-xs bg-koma-input border border-koma-border rounded-xl focus:outline-none focus:border-emerald-400/30 text-koma-foreground"
                  placeholder="Ex: Sem cebola, Bem frito, etc."
                />
              </div>

              {/* Customer Name Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">Nome do Cliente:</label>
                <input
                  type="text"
                  value={editingItem.clienteNome === 'Consumo Geral' ? '' : editingItem.clienteNome}
                  onChange={(e) => setEditingItem({ ...editingItem, clienteNome: e.target.value })}
                  className="w-full px-3.5 py-2 text-xs bg-koma-input border border-koma-border rounded-xl focus:outline-none focus:border-emerald-400/30 text-koma-foreground"
                  placeholder="Ex: Maria (Opcional)"
                />
              </div>

              <button
                type="button"
                onClick={async () => {
                  const finalClient = editingItem.clienteNome.trim() || 'Consumo Geral';
                  if (onUpdateItemDetails) {
                    await onUpdateItemDetails(
                      editingItem.id, 
                      editingItem.observacao, 
                      finalClient,
                      editingItem.quantidade
                    );
                  }
                  setEditingItem(null);
                }}
                className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs rounded-xl transition-all cursor-pointer uppercase tracking-wider text-center shadow-sm"
              >
                Confirmar Alterações
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};