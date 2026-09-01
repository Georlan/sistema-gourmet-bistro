/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Clock, Receipt, PlusCircle, Move, ArrowLeft, GitMerge } from 'lucide-react';
import { Table, Order, DraftItem, AppSettings, Product, AppRole } from '../types';
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
  currentTime: number;
  onClose: () => void;
  onUpdateSettings: (settings: AppSettings) => void;
  onAddToDraft: (product: Product, quantity?: number, observacao?: string, clienteNome?: string) => void;
  onRemoveFromDraft: (draftItemId: string) => void;
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
  currentTime,
  onClose,
  onUpdateSettings,
  onAddToDraft,
  onRemoveFromDraft,
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
  // Dynamic default tab based on whether table is active or empty
  const [activeTab, setActiveTab] = useState<'consumo' | 'lancamento' | 'transferir' | 'mesclar'>(
    orders.length === 0 ? 'lancamento' : 'consumo'
  );
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
  const permanenceTime = operationalState.elapsed;

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
        : 'Erro ao enviar impressão do recibo completo');
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
      alert(apenasValores ? "Erro ao enviar impressão do extrato resumido" : "Erro ao enviar impressão do recibo completo");
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
      className="fixed inset-0 bg-black/75 flex items-center justify-center p-0 sm:p-4 z-40 animate-fade-in overflow-y-auto"
    >
      <div className="bg-koma-card rounded-none sm:rounded-3xl border-0 sm:border border-koma-border shadow-2xl w-full max-w-5xl overflow-hidden h-full sm:h-auto max-h-full sm:max-h-[90vh] flex flex-col">
               {/* MODAL HEADER */}
        <div className="bg-koma-raised text-koma-foreground px-3 py-2.5 sm:p-5 flex flex-col gap-1.5 shrink-0 border-b border-koma-border z-30">
          {/* Top Line: Title + Status + Close Button */}
          <div className="flex justify-between items-center w-full">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 hover:bg-koma-card rounded-xl text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-koma-border shrink-0"
                title="Voltar ao mapa"
              >
                <ArrowLeft size={16} />
              </button>
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="font-serif text-base sm:text-2xl font-bold tracking-tight text-koma-foreground truncate">
                  Mesa {table.id}{originStr}
                </h2>
                <span className={`px-2 py-0.5 text-[9px] font-sans font-bold tracking-wider uppercase rounded-full border shrink-0 ${
                  operationalState.occupancy === 'FREE'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                    : operationalState.production.hasReadyItems
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                      : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                }`}>
                  {operationalState.occupancy === 'FREE' ? 'Livre' : operationalState.production.hasReadyItems ? 'Pronto' : 'Ocupada'}
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] uppercase tracking-wider bg-koma-panel px-2.5 py-1 rounded-lg border border-koma-border font-sans text-emerald-700 dark:text-emerald-400 font-bold hidden sm:inline-block">
                Garçom: <strong className="text-koma-foreground">{activeWaiterNome}</strong>
              </span>
              <button
                id="close-mesa-modal-btn"
                onClick={onClose}
                className="p-1.5 rounded-xl hover:bg-white/5 text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-transparent hover:border-koma-border"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Sub Line for active orders or mobile info */}
          {orders.length > 0 && (
            <div className="flex items-center justify-between gap-2 text-[11px] text-koma-subtle font-sans pt-0.5 border-t border-koma-border/50">
              <span className="flex items-center gap-1">
                <Clock size={11} className="text-emerald-700 dark:text-emerald-400" />
                Permanência: <strong className="text-koma-foreground font-medium font-mono">{permanenceTime}</strong>
              </span>
              <span className="text-[10px] text-emerald-400 font-bold sm:hidden">
                {activeWaiterNome}
              </span>
            </div>
          )}
        </div>

        {/* MODAL TABS */}
        <div
          role="tablist"
          aria-label="Ações da mesa"
          className="bg-koma-panel border-b border-koma-border px-2.5 sm:px-5 py-1.5 flex items-center gap-1.5 sm:gap-2 shrink-0 overflow-x-auto scrollbar-none no-scrollbar z-20"
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
            aria-selected={activeTab === 'lancamento'}
            onClick={() => setActiveTab('lancamento')}
            className={`flex-1 sm:flex-initial min-h-9 px-3 sm:px-4 py-1.5 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer uppercase tracking-wider font-sans whitespace-nowrap border ${
              activeTab === 'lancamento' 
                ? 'bg-koma-raised text-emerald-400 shadow-sm border-koma-border' 
                : 'text-koma-subtle hover:text-koma-foreground border-transparent'
            }`}
          >
            <PlusCircle size={13} className="text-emerald-400" />
            <span>Cardápio</span>
            {draftItems.length > 0 && (
              <span className="min-w-4 h-4 px-1 rounded-full bg-emerald-500 text-zinc-950 text-[9px] font-mono font-extrabold flex items-center justify-center">
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
        <div className="overflow-y-auto flex-1 text-left p-0">
          
          {/* TAB 1: CONSUMO ATIVO */}
          {activeTab === 'consumo' && (
            <MesaConsumptionPanel
              table={table}
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
              onCloseTable={onCloseTable ? handleCloseTableConfirmation : undefined}
              onMergeTables={onMergeTables}
              onUnmergeTable={onUnmergeTable}
              onDeliverItem={onDeliverItem}
              onCancelItem={onCancelItem}
            />
          )}

          {/* TAB 2: LANÇAR ITENS (MOUNTS MENUPANEL) */}
          {activeTab === 'lancamento' && (
            <MenuPanel
              tableId={table.id}
              draftItems={draftItems}
              existingOrders={orders}
              settings={settings}
              onUpdateSettings={onUpdateSettings}
              onAddToDraft={onAddToDraft}
              onRemoveFromDraft={onRemoveFromDraft}
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

      </div>

      <MesaPrintDialogs
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
      />

      {editingItem && (
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
