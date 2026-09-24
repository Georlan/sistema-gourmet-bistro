import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import React, { useState } from 'react';
import { projectCashierSalonTables } from '../../../domain/cashierSalonProjection';
import { Table } from '../../../types';
import { ONBOARDING_SETUP_MODE_KEY } from '../../onboarding/FirstAccessOnboarding';
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

function openInitialSetup() {
  try {
    sessionStorage.removeItem(ONBOARDING_SETUP_MODE_KEY);
  } catch {
    // O acesso continua disponível mesmo quando o storage do navegador estiver restrito.
  }
  window.location.href = '/ativar?resume=1';
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
    settingsLoadState,
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
    fetchConfiguracoes,
    handleTestPrinter,
  } = settings;
  const operationalSettingsTab =
    activeSubTab === 'impressao' || activeSubTab === 'mesas' || activeSubTab === 'garcom' || activeSubTab === 'taxa'
      ? activeSubTab
      : null;

  const [configSalSubTab, setConfigSalSubTab] = useState<'pedido' | 'fechamento' | 'atendimento'>('pedido');
  const isTechnicalIntegrations = activeSubTab === 'integracoes';
  const isAppearance = activeSubTab === 'aparencia';
  const isInitialSetup = activeSubTab === 'implantacao';

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

  const remoteSettingsUnavailable = !isTechnicalIntegrations && operationalSettingsTab && settingsLoadState !== 'loaded';

  return (
    <>
      {isTechnicalIntegrations && activeTab === 'impressao_salao' && (
        <CashierIntegrationsSettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
      )}

      {!isTechnicalIntegrations && activeTab === 'impressao_salao' && (
        <div className="space-y-5">
          {isAppearance && <CashierAppearanceSettings />}

          {isInitialSetup && (
            <section className="rounded-2xl border border-koma-border bg-koma-panel p-5 sm:p-6" aria-labelledby="cashier-initial-setup-title">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-700 dark:text-emerald-300">
                  <Sparkles size={18} />
                </span>
                <div className="min-w-0">
                  <h2 id="cashier-initial-setup-title" className="text-sm font-bold text-koma-foreground">Implantação inicial</h2>
                  <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-koma-muted">
                    Revise dados básicos, horários e o primeiro cardápio pelo fluxo guiado de ativação do restaurante.
                  </p>
                  <button
                    type="button"
                    onClick={openInitialSetup}
                    className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                  >
                    Reabrir implantação inicial
                  </button>
                </div>
              </div>
            </section>
          )}

          {remoteSettingsUnavailable && (
            <div className="rounded-2xl border border-koma-border bg-koma-panel p-8 text-center text-koma-muted">
              {settingsLoadState === 'loading' ? (
                <Loader2 size={22} className="mx-auto mb-3 animate-spin" />
              ) : (
                <RefreshCw size={22} className="mx-auto mb-3" />
              )}
              <p className="text-xs font-bold text-koma-foreground">
                {settingsLoadState === 'loading' ? 'Sincronizando configurações...' : 'Configurações indisponíveis'}
              </p>
              <p className="mx-auto mt-1 max-w-lg text-[10px] leading-relaxed">
                {settingsLoadState === 'loading'
                  ? 'Aguardando os valores reais do restaurante antes de exibir ou permitir alterações.'
                  : 'Os valores locais não serão usados como se fossem configurações do servidor.'}
              </p>
              {settingsLoadState === 'error' && (
                <button
                  type="button"
                  onClick={() => void fetchConfiguracoes()}
                  className="mt-4 rounded-xl border border-koma-border bg-koma-raised px-4 py-2 text-[10px] font-bold text-koma-foreground hover:bg-koma-card"
                >
                  Tentar novamente
                </button>
              )}
            </div>
          )}

          {operationalSettingsTab && settingsLoadState === 'loaded' && (
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
                hasPrinting={hasPrinting}
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
