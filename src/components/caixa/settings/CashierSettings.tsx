
import { Lock, Percent, Printer, Smartphone, Users } from 'lucide-react';
import React, { useState } from 'react';
import { projectCashierSalonTables } from '../../../domain/cashierOrderProjection';
import { Table } from '../../../types';
import type { CaixaPanelProps, CashierNotice, CashierTab } from '../cashierContracts';
import { CashierPrintingSettings } from './CashierPrintingSettings';
import { CashierServiceTaxSettings } from './CashierServiceTaxSettings';
import { CashierTableDialogs } from './CashierTableDialogs';
import { CashierTableSettings } from './CashierTableSettings';
import { CashierWaiterSettings } from './CashierWaiterSettings';
import type { useCashierSettings } from './useCashierSettings';
import { useCashierTableSettings } from './useCashierTableSettings';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeTab: string;
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
  showToast: CashierNotice;
  setActiveTab: (tab: CashierTab) => void;
  hasPrinting: boolean;
  salonTables: Table[];
  salonTableCards: ReturnType<typeof projectCashierSalonTables>;
  onCreateMesa: CaixaPanelProps['onCreateMesa'];
  onUpdateMesa: CaixaPanelProps['onUpdateMesa'];
  onDeleteMesa: CaixaPanelProps['onDeleteMesa'];
  setCheckoutServiceTax: React.Dispatch<React.SetStateAction<boolean>>;
  settings: ReturnType<typeof useCashierSettings>;
}

export default function CashierSettings({
  apiBaseUrl,
  authHeaders,
  activeTab,
  activeSubTab,
  setActiveSubTab,
  showToast,
  setActiveTab,
  hasPrinting,
  salonTables,
  salonTableCards,
  onCreateMesa,
  onUpdateMesa,
  onDeleteMesa,
  setCheckoutServiceTax,
  settings,
}: Props) {
  const {
    taxaServicoAtiva,
    setTaxaServicoAtiva,
    serviceTaxRate,
    setServiceTaxRate,
    unificarViasDelivery,
    setUnificarViasDelivery,
    updateConfiguracoes,
    waiterPermissions,
    printHeader,
    setPrintHeader,
    printFooter,
    setPrintFooter,
    printNamePosition,
    printSettingsSaveState,
    setPrintSettingsSaveState,
    isTestingPrinter,
    handleTestPrinter,
  } = settings;
  const [printingSettingsTab, setPrintingSettingsTab] = useState<'impressao' | 'mesas' | 'garcom' | 'taxa'>(
    'impressao',
  );

  const [configSalSubTab, setConfigSalSubTab] = useState<'pedido' | 'fechamento' | 'atendimento'>('pedido');

  const {
    handleDeleteMesa,
    handleUpdateMesaSubmit,
    showAddMesaModal,
    setShowAddMesaModal,
    newMesaId,
    setNewMesaId,
    newMesaCap,
    setNewMesaCap,
    newMesaNome,
    setNewMesaNome,
    editingTable,
    setEditingTable,
    editTableCap,
    setEditTableCap,
    editTableNome,
    setEditTableNome,
    isConfirmingDelete,
    setIsConfirmingDelete,
    tableMutation,
    tableFormError,
    setTableFormError,
    editingTableRuntime,
    handleAddMesaSubmit,
  } = useCashierTableSettings({
    onUpdateMesa,
    onDeleteMesa,
    salonTableCards,
    salonTables,
    onCreateMesa,
    showToast,
  });

  return (
    <>
      {(activeTab === 'impressao_salao' || activeSubTab === 'impressoras') && (
        <div className="space-y-5">
          <div
            className={"flex flex-wrap gap-1.5 rounded-xl border border-koma-border bg-koma-page p-1 w-fit"}
          >
            {[
              { id: 'impressao', label: 'Impressão', icon: Printer },
              { id: 'mesas', label: 'Mesas', icon: Users },
              { id: 'garcom', label: 'App do Garçom', icon: Smartphone },
              { id: 'taxa', label: 'Taxa de Serviço', icon: Percent },
            ].map((tab) => {
              const Icon = tab.icon;
              const selected = printingSettingsTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPrintingSettingsTab(tab.id as 'impressao' | 'mesas' | 'garcom' | 'taxa')}
                  className={`px-3 py-2 text-[9px] font-bold rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${
                    selected
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-koma-subtle hover:text-koma-foreground'
                  }`}
                >
                  <Icon size={12} />
                  {tab.label}
                  {tab.id === 'impressao' && !hasPrinting && (
                    <Lock size={10} className="text-amber-600 dark:text-amber-300" />
                  )}
                </button>
              );
            })}
          </div>

          <CashierPrintingSettings
            printingSettingsTab={printingSettingsTab}
            hasPrinting={hasPrinting}
            setActiveTab={setActiveTab}
            setActiveSubTab={setActiveSubTab}
            apiBaseUrl={apiBaseUrl}
            authHeaders={authHeaders}
            handleTestPrinter={handleTestPrinter}
            isTestingPrinter={isTestingPrinter}
            printSettingsSaveState={printSettingsSaveState}
            printHeader={printHeader}
            setPrintHeader={setPrintHeader}
            setPrintSettingsSaveState={setPrintSettingsSaveState}
            updateConfiguracoes={updateConfiguracoes}
            printNamePosition={printNamePosition}
            printFooter={printFooter}
            setPrintFooter={setPrintFooter}
            unificarViasDelivery={unificarViasDelivery}
            setUnificarViasDelivery={setUnificarViasDelivery}
          />

          <CashierTableSettings
            printingSettingsTab={printingSettingsTab}
            salonTables={salonTables}
            setTableFormError={setTableFormError}
            setShowAddMesaModal={setShowAddMesaModal}
            setEditingTable={setEditingTable}
            setEditTableCap={setEditTableCap}
            setEditTableNome={setEditTableNome}
            setIsConfirmingDelete={setIsConfirmingDelete}
          />

          <CashierWaiterSettings
            printingSettingsTab={printingSettingsTab}
            setConfigSalSubTab={setConfigSalSubTab}
            configSalSubTab={configSalSubTab}
            waiterPermissions={waiterPermissions}
            updateConfiguracoes={updateConfiguracoes}
          />

          <CashierServiceTaxSettings
            printingSettingsTab={printingSettingsTab}
            taxaServicoAtiva={taxaServicoAtiva}
            serviceTaxRate={serviceTaxRate}
            setTaxaServicoAtiva={setTaxaServicoAtiva}
            setCheckoutServiceTax={setCheckoutServiceTax}
            updateConfiguracoes={updateConfiguracoes}
            setServiceTaxRate={setServiceTaxRate}
          />

          {/* Service Tax config block moved to Salão e Impressão */}

          {/* Waiters permissions switches (Left Column) */}

          {/* Printer messages & test (Right Column) */}
        </div>
      )}
      <CashierTableDialogs
        handleDeleteMesa={handleDeleteMesa}
        handleUpdateMesaSubmit={handleUpdateMesaSubmit}
        showAddMesaModal={showAddMesaModal}
        tableMutation={tableMutation}
        setShowAddMesaModal={setShowAddMesaModal}
        handleAddMesaSubmit={handleAddMesaSubmit}
        newMesaId={newMesaId}
        setNewMesaId={setNewMesaId}
        setTableFormError={setTableFormError}
        newMesaCap={newMesaCap}
        setNewMesaCap={setNewMesaCap}
        newMesaNome={newMesaNome}
        setNewMesaNome={setNewMesaNome}
        tableFormError={tableFormError}
        editingTable={editingTable}
        setEditingTable={setEditingTable}
        setIsConfirmingDelete={setIsConfirmingDelete}
        editTableCap={editTableCap}
        editTableNome={editTableNome}
        editingTableRuntime={editingTableRuntime}
        isConfirmingDelete={isConfirmingDelete}
        setEditTableNome={setEditTableNome}
        setEditTableCap={setEditTableCap}
      />
    </>
  );
}
