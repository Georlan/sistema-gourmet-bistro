import { Lock, Monitor, Percent, Printer, Smartphone, Users } from 'lucide-react';
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

const CASHIER_SETTINGS_TAB_STORAGE_KEY = 'koma_cashier_settings_tab';

const CASHIER_SETTINGS_GROUPS = [
  {
    id: 'dispositivo',
    label: 'Neste dispositivo',
    description: 'Preferências locais para deixar este caixa confortável e pronto para operar.',
    tabs: [
      { id: 'aparencia', label: 'Aparência', description: 'Tema e tamanho do texto', icon: Monitor },
      { id: 'impressao', label: 'Impressão', description: 'Fila, testes e personalização do cupom', icon: Printer },
    ],
  },
  {
    id: 'operacao',
    label: 'Operação do salão',
    description: 'Regras compartilhadas que afetam atendimento, equipe e cobrança no restaurante.',
    tabs: [
      { id: 'mesas', label: 'Mesas', description: 'Cadastro, nomes e capacidade', icon: Users },
      { id: 'garcom', label: 'App do Garçom', description: 'Permissões e comportamento do atendimento', icon: Smartphone },
      { id: 'taxa', label: 'Taxa de Serviço', description: 'Ativação e percentual padrão', icon: Percent },
    ],
  },
] as const;

function isCashierSettingsTab(value: string | null): value is CashierSettingsTab {
  return value === 'aparencia' || value === 'impressao' || value === 'mesas' || value === 'garcom' || value === 'taxa';
}

function readInitialCashierSettingsTab(): CashierSettingsTab {
  if (typeof window === 'undefined') return 'aparencia';
  try {
    const stored = window.localStorage.getItem(CASHIER_SETTINGS_TAB_STORAGE_KEY);
    return isCashierSettingsTab(stored) ? stored : 'aparencia';
  } catch {
    return 'aparencia';
  }
}

function persistCashierSettingsTab(tab: CashierSettingsTab) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CASHIER_SETTINGS_TAB_STORAGE_KEY, tab);
  } catch {
    // Preferência local é melhoria de ergonomia; falha de storage não deve bloquear o Caixa.
  }
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
  const [settingsTab, setSettingsTab] = useState<CashierSettingsTab>(readInitialCashierSettingsTab);
  const operationalSettingsTab = settingsTab === 'aparencia' ? null : settingsTab;

  const [configSalSubTab, setConfigSalSubTab] = useState<'pedido' | 'fechamento' | 'atendimento'>('pedido');
  const isTechnicalIntegrations = activeSubTab === 'integracoes';

  const selectSettingsTab = (tab: CashierSettingsTab) => {
    setSettingsTab(tab);
    persistCashierSettingsTab(tab);
  };

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
      {isTechnicalIntegrations && (
        <CashierIntegrationsSettings apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
      )}

      {!isTechnicalIntegrations && (activeTab === 'impressao_salao' || activeSubTab === 'impressoras') && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-koma-border bg-koma-panel p-3 sm:p-4">
            <div className="mb-4 px-1">
              <h2 className="text-sm font-bold text-koma-foreground">Configurações do Caixa</h2>
              <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-koma-muted">
                Ajustes do dispositivo e da operação do salão separados por contexto. Integrações técnicas continuam isoladas no menu lateral.
              </p>
            </div>

            <div className="space-y-4" aria-label="Configurações do caixa">
              {CASHIER_SETTINGS_GROUPS.map((group) => (
                <section key={group.id} aria-labelledby={`cashier-settings-group-${group.id}`}>
                  <div className="mb-2 px-1">
                    <h3 id={`cashier-settings-group-${group.id}`} className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-koma-secondary">
                      {group.label}
                    </h3>
                    <p className="mt-0.5 text-[9px] leading-relaxed text-koma-muted">{group.description}</p>
                  </div>

                  <div className={`grid gap-2 ${group.id === 'dispositivo' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
                    {group.tabs.map((tab) => {
                      const Icon = tab.icon;
                      const selected = settingsTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => selectSettingsTab(tab.id)}
                          className={`cashier-settings-tab min-h-14 rounded-xl border px-3 py-3 text-left transition-colors flex items-start gap-2.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
                            selected
                              ? 'border-emerald-600 bg-emerald-500/10 text-emerald-800 dark:border-emerald-500/50 dark:text-emerald-200'
                              : 'border-koma-border bg-koma-page text-koma-secondary hover:bg-koma-raised hover:text-koma-foreground'
                          }`}
                        >
                          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-koma-border bg-koma-raised">
                            <Icon size={13} />
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 text-[10px] font-bold">
                              {tab.label}
                              {tab.id === 'impressao' && !hasPrinting && (
                                <Lock size={10} className="shrink-0 text-amber-700 dark:text-amber-300" />
                              )}
                            </span>
                            <span className="mt-1 block text-[9px] font-medium leading-snug opacity-75">
                              {tab.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
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
