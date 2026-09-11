import { Lock, MonitorCog, Percent, Printer, Smartphone, Users } from 'lucide-react';
import React, { useState } from 'react';
import { projectCashierSalonTables } from '../../../domain/cashierSalonProjection';
import { Table } from '../../../types';
import type { CaixaPanelProps, CashierNotice, CashierTab } from '../cashierContracts';
import { CashierAppearanceSettings } from './CashierAppearanceSettings';
import { CashierIntegrationsSettings } from './CashierIntegrationsSettings';
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

type CashierSettingsTab = 'aparencia' | 'impressao' | 'mesas' | 'garcom' | 'taxa';

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
  const [settingsTab, setSettingsTab] = useState<CashierSettingsTab>('aparencia');
  const operationalSettingsTab = settingsTab === 'aparencia' ? null : settingsTab;

  const [configSalSubTab, setConfigSalSubTab] = useState<'pedido' | 'fechamento' | 'atendimento'>('pedido');
  const isTechnicalIntegrations = activeSubTab === 'integracoes';

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

  const settingsTabs = [
    { id: 'aparencia', label: 'Aparência', icon: MonitorCog },
    { id: 'impressao', label: 'Impressão', icon: Printer },
    { id: 'mesas', label: 'Mesas', icon: Users },
    { id: 'garcom', label: 'App do Garçom', icon: Smartphone },
    { id: 'taxa', label: 'Taxa de Serviço', icon: Percent },
  ] as const;

  return (
    <>
      {isTechnicalIntegrations && (
        <CashierIntegrationsSettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
      )}

      {!isTechnicalIntegrations && (activeTab === 'impressao_salao' || activeSubTab === 'impressoras') && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-koma-border bg-koma-panel p-3 sm:p-4">
            <div className="mb-3 px-1">
              <h2 className="text-sm font-bold text-koma-foreground">Configurações do Caixa</h2>
              <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
                Ajustes do dispositivo e da operação do salão, organizados por tarefa. Integrações técnicas continuam separadas no menu lateral.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" role="tablist" aria-label="Configurações do caixa">
              {settingsTabs.map((tab) => {
                const Icon = tab.icon;
                const selected = settingsTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setSettingsTab(tab.id)}
                    className={`min-h-11 rounded-xl border px-3 py-2 text-[10px] font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
                      selected
                        ? 'border-emerald-600 bg-emerald-500/10 text-emerald-800 dark:border-emerald-500/50 dark:text-emerald-200'
                        : 'border-koma-border bg-koma-page text-koma-secondary hover:bg-koma-raised hover:text-koma-foreground'
                    }`}
                  >
                    <Icon size={13} />
                    <span>{tab.label}</span>
                    {tab.id === 'impressao' && !hasPrinting && (
                      <Lock size={10} className="text-amber-700 dark:text-amber-300" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {settingsTab === 'aparencia' && <CashierAppearanceSettings />}

          {operationalSettingsTab && (
            <>
              <CashierPrintingSettings
                printingSettingsTab={operationalSettingsTab}
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
                printingSettingsTab={operationalSettingsTab}
                salonTables={salonTables}
                setTableFormError={setTableFormError}
                setShowAddMesaModal={setShowAddMesaModal}
                setEditingTable={setEditingTable}
                setEditTableCap={setEditTableCap}
                setEditTableNome={setEditTableNome}
                setIsConfirmingDelete={setIsConfirmingDelete}
              />

              <CashierWaiterSettings
                printingSettingsTab={operationalSettingsTab}
                setConfigSalSubTab={setConfigSalSubTab}
                configSalSubTab={configSalSubTab}
                waiterPermissions={waiterPermissions}
                updateConfiguracoes={updateConfiguracoes}
              />

              <CashierServiceTaxSettings
                printingSettingsTab={operationalSettingsTab}
                taxaServicoAtiva={taxaServicoAtiva}
                serviceTaxRate={serviceTaxRate}
                setTaxaServicoAtiva={setTaxaServicoAtiva}
                setCheckoutServiceTax={setCheckoutServiceTax}
                updateConfiguracoes={updateConfiguracoes}
                setServiceTaxRate={setServiceTaxRate}
              />
            </>
          )}
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
