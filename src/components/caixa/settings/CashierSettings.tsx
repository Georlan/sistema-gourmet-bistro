import clsx from 'clsx';
import {
  AlertTriangle,
  Check,
  Edit3,
  Lock,
  Percent,
  Plus,
  Printer,
  RefreshCw,
  Smartphone,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import React, { useState } from 'react';
import { projectCashierSalonTables } from '../../../domain/cashierOrderProjection';
import { Table } from '../../../types';
import { PrintMonitorPanel } from '../../printing/PrintMonitorPanel';
import { OperationalBanner } from '../../shared/OperationalBanner';
import type { CaixaPanelProps, CashierNotice, CashierTab } from '../cashierContracts';
import type { useCashierSettings } from './useCashierSettings';

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
    permDelivery,
    permEdit,
    permAddCharges,
    permCancel,
    permShowStatus,
    permOpenEmpty,
    permAutoPrint,
    permCloseAccount,
    permDiscount,
    permSurcharge,
    permPeopleCount,
    permTransferTables,
    permTransferItems,
    permClientCall,
    permShowIdleTables,
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

  const [showAddMesaModal, setShowAddMesaModal] = useState(false);

  const [newMesaId, setNewMesaId] = useState('');

  const [newMesaCap, setNewMesaCap] = useState('4');

  const [newMesaNome, setNewMesaNome] = useState('');

  const [editingTable, setEditingTable] = useState<Table | null>(null);

  const [editTableCap, setEditTableCap] = useState('');

  const [editTableNome, setEditTableNome] = useState('');

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const [tableMutation, setTableMutation] = useState<'create' | 'update' | 'delete' | null>(null);

  const [tableFormError, setTableFormError] = useState('');

  const editingTableRuntime = editingTable
    ? salonTableCards.find((card) => card.table.id === editingTable.id)
    : undefined;

  const handleAddMesaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tableMutation) return;
    const mesaId = Number.parseInt(newMesaId, 10);
    const capacidade = Number.parseInt(newMesaCap, 10);
    if (!Number.isFinite(mesaId) || mesaId <= 0) {
      setTableFormError('Informe um número de mesa maior que zero.');
      return;
    }
    if (!Number.isFinite(capacidade) || capacidade <= 0) {
      setTableFormError('Informe uma capacidade maior que zero.');
      return;
    }
    if (salonTables.some((table) => table.id === mesaId)) {
      setTableFormError(`A Mesa ${mesaId} já existe no salão.`);
      return;
    }

    try {
      setTableMutation('create');
      setTableFormError('');
      await onCreateMesa(mesaId, capacidade, newMesaNome.trim() || undefined);
      setShowAddMesaModal(false);
      setNewMesaId('');
      setNewMesaCap('4');
      setNewMesaNome('');
      showToast(`Mesa ${mesaId} adicionada ao salão.`, 'success');
    } catch (err: any) {
      setTableFormError(err?.message || 'Não foi possível criar a mesa. Tente novamente.');
    } finally {
      setTableMutation(null);
    }
  };

  return (
    <>
      {(activeTab === 'impressao_salao' || activeSubTab === 'impressoras') && (
        <div className="space-y-5">
          <div
            className={clsx(
              'flex',
              'flex-wrap',
              'gap-1.5',
              'rounded-xl',
              'border',
              'border-koma-border',
              'bg-koma-page',
              'p-1',
              'w-fit',
            )}
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
                    selected ? 'bg-emerald-600 text-white shadow' : 'text-koma-subtle hover:text-koma-foreground'
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

          {printingSettingsTab === 'impressao' && !hasPrinting && (
            <div
              className={clsx(
                'bg-koma-card',
                'border',
                'border-amber-500/20',
                'rounded-3xl',
                'p-8',
                'text-center',
                'max-w-xl',
                'mx-auto',
                'space-y-3',
              )}
            >
              <Lock size={24} className={clsx('text-amber-400', 'mx-auto')} />
              <h3 className={clsx('text-koma-foreground', 'font-bold')}>Impressão não incluída no Kôma Pocket</h3>
              <p className={clsx('text-[10px]', 'text-koma-subtle')}>
                App do Garçom e Taxa de Serviço continuam disponíveis nas abas acima. Migre para o Kôma Pro ou Premium
                para liberar impressão.
              </p>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('assinatura_pix');
                  setActiveSubTab('planos');
                }}
                className={clsx(
                  'px-4',
                  'py-2',
                  'rounded-xl',
                  'bg-emerald-600',
                  'hover:bg-emerald-700',
                  'text-white',
                  'text-[10px]',
                  'font-bold',
                  'uppercase',
                  'cursor-pointer',
                )}
              >
                Comparar planos
              </button>
            </div>
          )}

          {printingSettingsTab === 'mesas' && (
            <OperationalBanner
              id="salon-tables-title"
              eyebrow="CONFIGURAÇÕES / SALÃO"
              title="Mesas"
              accent="prontas para receber"
              description="Capacidade e identificação do salão sem misturar configuração com comandas abertas."
              metrics={[
                { label: 'mesas cadastradas', value: salonTables.length },
                {
                  label: 'lugares disponíveis',
                  value: salonTables.reduce((total, table) => total + (table.capacidade || 4), 0),
                },
                {
                  label: 'nomes personalizados',
                  value: salonTables.filter((table) => Boolean(table.nome?.trim())).length,
                },
              ]}
            />
          )}

          {printingSettingsTab === 'garcom' && (
            <OperationalBanner
              id="waiter-app-title"
              eyebrow="CONFIGURAÇÕES / EQUIPE"
              title="Atendimento"
              accent="com autonomia controlada"
              description="Veja rapidamente o que a equipe pode fazer antes de ajustar cada permissão."
              metrics={[
                {
                  label: 'permissões ativas',
                  value: [
                    permDelivery,
                    permEdit,
                    permCancel,
                    permShowStatus,
                    permAutoPrint,
                    permCloseAccount,
                    permTransferTables,
                    permTransferItems,
                  ].filter(Boolean).length,
                },
                { label: 'impressão de pedido', value: permAutoPrint ? 'Automática' : 'Manual' },
                { label: 'fechamento no app', value: permCloseAccount ? 'Permitido' : 'Bloqueado' },
                { label: 'integrações pendentes', value: 7 },
              ]}
            />
          )}

          {printingSettingsTab === 'taxa' && (
            <OperationalBanner
              id="service-tax-title"
              eyebrow="CONFIGURAÇÕES / SERVIÇO"
              title="Taxa"
              accent={taxaServicoAtiva ? 'aplicada com clareza' : 'sob decisão do caixa'}
              description="A regra é única para o salão e chega ao fechamento sem cálculo paralelo."
              metrics={[
                { label: 'estado atual', value: taxaServicoAtiva ? 'Ativa' : 'Inativa' },
                { label: 'percentual padrão', value: taxaServicoAtiva ? `${serviceTaxRate}%` : '—' },
                { label: 'aplicação', value: 'Fechamento' },
                { label: 'alcance', value: 'Caixa e salão' },
              ]}
            />
          )}

          {printingSettingsTab === 'mesas' && (
            <section
              className={clsx('overflow-hidden', 'rounded-[22px]', 'border', 'border-koma-border', 'bg-koma-panel')}
            >
              <header
                className={clsx(
                  'flex',
                  'flex-col',
                  'gap-3',
                  'border-b',
                  'border-koma-border',
                  'px-4',
                  'py-4',
                  'sm:flex-row',
                  'sm:items-center',
                  'sm:justify-between',
                  'sm:px-5',
                )}
              >
                <div>
                  <h3 className={clsx('text-sm', 'font-bold', 'text-koma-foreground')}>Configuração das mesas</h3>
                  <p className={clsx('mt-1', 'text-[10px]', 'text-koma-muted')}>
                    Cadastre, nomeie e defina a capacidade. A ocupação continua sendo controlada pelas comandas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTableFormError('');
                    setShowAddMesaModal(true);
                  }}
                  className={clsx(
                    'inline-flex',
                    'min-h-10',
                    'items-center',
                    'justify-center',
                    'gap-1.5',
                    'rounded-xl',
                    'bg-[#10b981]',
                    'px-4',
                    'text-[9px]',
                    'font-extrabold',
                    'uppercase',
                    'tracking-wider',
                    'text-[#07110e]',
                    'transition-colors',
                    'hover:bg-[#35c99a]',
                  )}
                >
                  <Plus size={13} /> Adicionar mesa
                </button>
              </header>

              {salonTables.length === 0 ? (
                <div
                  className={clsx(
                    'flex',
                    'min-h-48',
                    'flex-col',
                    'items-center',
                    'justify-center',
                    'px-5',
                    'text-center',
                  )}
                >
                  <Users size={22} className="text-koma-muted" />
                  <strong className={clsx('mt-3', 'text-xs', 'text-koma-secondary')}>Nenhuma mesa cadastrada</strong>
                  <span className={clsx('mt-1', 'text-[10px]', 'text-koma-muted')}>
                    Adicione a primeira mesa para liberar a operação do salão.
                  </span>
                </div>
              ) : (
                <div className={clsx('grid', 'gap-2', 'p-4', 'sm:grid-cols-2', 'lg:grid-cols-3', '2xl:grid-cols-4')}>
                  {[...salonTables]
                    .sort((a, b) => a.id - b.id)
                    .map((table) => (
                      <article
                        key={table.id}
                        className={clsx(
                          'flex',
                          'items-center',
                          'justify-between',
                          'gap-3',
                          'rounded-2xl',
                          'border',
                          'border-[#292e2c]',
                          'bg-koma-card',
                          'p-3.5',
                        )}
                      >
                        <div className="min-w-0">
                          <span
                            className={clsx(
                              'block',
                              'font-mono',
                              'text-[8px]',
                              'font-bold',
                              'uppercase',
                              'tracking-[0.18em]',
                              'text-koma-muted',
                            )}
                          >
                            Mesa {table.id}
                          </span>
                          <strong className={clsx('mt-0.5', 'block', 'truncate', 'text-xs', 'text-koma-foreground')}>
                            {table.nome || `Mesa ${table.id}`}
                          </strong>
                          <span
                            className={clsx('mt-1', 'flex', 'items-center', 'gap-1', 'text-[9px]', 'text-koma-muted')}
                          >
                            <Users size={10} /> {table.capacidade || 4} lugares
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTable(table);
                            setEditTableCap(String(table.capacidade || 4));
                            setEditTableNome(table.nome || '');
                            setIsConfirmingDelete(false);
                            setTableFormError('');
                          }}
                          aria-label={`Editar Mesa ${table.id}`}
                          className={clsx(
                            'rounded-lg',
                            'border',
                            'border-koma-border-subtle',
                            'bg-white/[0.025]',
                            'p-2',
                            'text-koma-muted',
                            'transition-colors',
                            'hover:border-emerald-500/30',
                            'hover:text-emerald-800 dark:text-emerald-300',
                          )}
                        >
                          <Edit3 size={13} />
                        </button>
                      </article>
                    ))}
                </div>
              )}
            </section>
          )}

          {/* Service Tax config block moved to Salão e Impressão */}
          {printingSettingsTab === 'taxa' && (
            <div
              className={clsx(
                'lg:col-span-3',
                'bg-koma-card',
                'border',
                'border-koma-border',
                'rounded-3xl',
                'p-5',
                'space-y-3',
              )}
            >
              <span
                className={clsx(
                  'font-serif',
                  'font-bold',
                  'text-koma-secondary',
                  'block',
                  'pb-1',
                  'border-b',
                  'border-koma-border',
                )}
              >
                Taxa de Serviço do Salão
              </span>

              <div className={clsx('flex', 'justify-between', 'items-center', 'pt-1')}>
                <span className={clsx('text-[10px]', 'text-koma-secondary', 'font-semibold')}>
                  Ativar Taxa de 10% de Serviço
                </span>
                <label className={clsx('relative', 'inline-flex', 'items-center', 'cursor-pointer')}>
                  <input
                    type="checkbox"
                    checked={taxaServicoAtiva}
                    onChange={(e) => {
                      setTaxaServicoAtiva(e.target.checked);
                      setCheckoutServiceTax(e.target.checked);
                      updateConfiguracoes({ taxa_servico_ativa: e.target.checked });
                    }}
                    className={clsx('sr-only', 'peer')}
                  />
                  <div
                    className={clsx(
                      'w-9',
                      'h-5',
                      'bg-koma-raised',
                      'peer-focus:outline-none',
                      'rounded-full',
                      'peer',
                      'peer-checked:after:translate-x-full',
                      'peer-checked:after:border-white',
                      "after:content-['']",
                      'after:absolute',
                      'after:top-[2px]',
                      'after:left-[2px]',
                      'after:bg-white',
                      'after:border-gray-300',
                      'after:border',
                      'after:rounded-full',
                      'after:h-4',
                      'after:w-4',
                      'after:transition-all',
                      'peer-checked:bg-emerald-600',
                    )}
                  ></div>
                </label>
              </div>

              {taxaServicoAtiva && (
                <div className={clsx('space-y-1', 'pt-1.5', 'animate-scale-in', 'max-w-xs')}>
                  <label
                    className={clsx(
                      'text-[8px]',
                      'text-koma-subtle',
                      'font-bold',
                      'uppercase',
                      'tracking-wider',
                      'block',
                    )}
                  >
                    Porcentagem Customizada (%):
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={serviceTaxRate}
                    onChange={(e) => {
                      const val = Math.max(1, parseInt(e.target.value) || 1);
                      setServiceTaxRate(val);
                      updateConfiguracoes({ taxa_servico_padrao: val });
                    }}
                    className={clsx(
                      'w-full',
                      'px-3',
                      'py-1.5',
                      'bg-koma-page',
                      'border',
                      'border-koma-border',
                      'rounded-xl',
                      'text-koma-foreground',
                      'font-mono',
                      'text-[10px]',
                    )}
                  />
                </div>
              )}
            </div>
          )}

          {printingSettingsTab === 'impressao' && hasPrinting && (
            <PrintMonitorPanel
              apiBaseUrl={apiBaseUrl}
              authHeaders={authHeaders}
              onTestPrint={handleTestPrinter}
              testInProgress={isTestingPrinter}
            />
          )}

          {/* Waiters permissions switches (Left Column) */}
          {printingSettingsTab === 'garcom' && (
            <div
              className={clsx(
                'lg:col-span-2',
                'bg-koma-card/60',
                'border',
                'border-koma-border',
                'rounded-3xl',
                'p-5',
                'space-y-4',
                'flex',
                'flex-col',
                'overflow-hidden',
              )}
            >
              <div
                className={clsx(
                  'border-b',
                  'border-koma-border',
                  'pb-3',
                  'flex',
                  'justify-between',
                  'items-center',
                  'shrink-0',
                )}
              >
                <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary')}>
                  Configurações de Permissões do App do Garçom
                </span>
              </div>

              {/* Sub tabs inside configurations */}
              <div
                className={clsx(
                  'flex',
                  'gap-1.5',
                  'bg-koma-page',
                  'p-1',
                  'rounded-xl',
                  'border',
                  'border-koma-border',
                  'w-fit',
                  'shrink-0',
                )}
              >
                {[
                  { id: 'pedido', label: '1. Pedido' },
                  { id: 'fechamento', label: '2. Fechamento de Conta' },
                  { id: 'atendimento', label: '3. Atendimento' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setConfigSalSubTab(tab.id as any)}
                    className={`px-3 py-1.5 text-[9px] font-bold rounded-lg cursor-pointer transition-all ${
                      configSalSubTab === tab.id
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-koma-subtle hover:text-koma-foreground'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Switch list */}
              <div className={clsx('flex-1', 'overflow-y-auto', 'pr-1', 'space-y-3.5', 'pt-2')}>
                {configSalSubTab === 'pedido' && (
                  <div className={clsx('space-y-3.5', 'animate-scale-in')}>
                    {[
                      {
                        title: 'Permitir que garçom faça lançamentos de pedidos de delivery',
                        desc: 'Ao ativar, garçons podem criar comandas com canais externos no salão.',
                        checked: permDelivery,
                        available: true,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_delivery: val }),
                      },
                      {
                        title: 'Permitir que Garçons editem pedidos',
                        desc: 'Permite atualizar observações ou acrescentar itens em comandas já enviadas.',
                        checked: permEdit,
                        available: true,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_editar: val }),
                      },
                      {
                        title: 'Permitir que Garçons editem cobranças adicionais',
                        desc: 'Permite retirar/colocar taxas extras, como couvert artístico ou consumação mínima.',
                        checked: permAddCharges,
                        available: false,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_taxas: val }),
                      },
                      {
                        title: 'Permitir que garçons cancelem pedidos',
                        desc: 'Permite o cancelamento direto de itens pelo aplicativo sem aprovação do gerente.',
                        checked: permCancel,
                        available: true,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_cancelar: val }),
                      },
                      {
                        title: 'Permitir exibição de status de pedidos no mapa de mesas',
                        desc: "Gera ícones de produção ('Em preparo', 'Pronto') sobre as mesas no mapa.",
                        checked: permShowStatus,
                        available: true,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_status: val }),
                      },
                      {
                        title: 'Permitir que garçons abram comandas sem pedido',
                        desc: "Permite reservar uma mesa com status 'ocupada' sem lançar nenhum item.",
                        checked: permOpenEmpty,
                        available: false,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_abrir_vazia: val }),
                      },
                      {
                        title: 'Permitir impressão automática dos pedidos feitos pelo Garçom',
                        desc: 'Dispara a via térmica de produção no balcão imediatamente após o garçom confirmar.',
                        checked: permAutoPrint,
                        available: true,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_print: val }),
                      },
                    ].map((item, idx) => (
                      <div key={idx} className={clsx('flex', 'justify-between', 'items-start', 'gap-4')}>
                        <div className="space-y-0.5">
                          <div className={clsx('flex', 'items-center', 'gap-2')}>
                            <strong
                              className={clsx(
                                item.available ? 'text-koma-foreground' : 'text-koma-subtle',
                                'block',
                                'font-semibold',
                              )}
                            >
                              {item.title}
                            </strong>
                            {!item.available && (
                              <span
                                className={clsx(
                                  'rounded-full',
                                  'border',
                                  'border-amber-700/40',
                                  'bg-amber-900/20',
                                  'px-2',
                                  'py-0.5',
                                  'text-[8px]',
                                  'font-bold',
                                  'uppercase',
                                  'tracking-wide',
                                  'text-amber-400',
                                )}
                              >
                                Integração pendente
                              </span>
                            )}
                          </div>
                          <span className={clsx('text-[9px]', 'text-koma-muted', 'block', 'leading-relaxed')}>
                            {item.desc}
                          </span>
                        </div>
                        <label
                          className={clsx(
                            'relative',
                            'inline-flex',
                            'items-center',
                            item.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-45',
                            'shrink-0',
                            'mt-0.5',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={item.checked}
                            disabled={!item.available}
                            onChange={(e) => item.onChange(e.target.checked)}
                            className={clsx('sr-only', 'peer')}
                          />
                          <div
                            className={clsx(
                              'w-8',
                              'h-4.5',
                              'bg-koma-raised',
                              'peer-focus:outline-none',
                              'rounded-full',
                              'peer',
                              'peer-checked:after:translate-x-full',
                              'peer-checked:after:border-white',
                              "after:content-['']",
                              'after:absolute',
                              'after:top-[2px]',
                              'after:left-[2px]',
                              'after:bg-white',
                              'after:border-gray-300',
                              'after:border',
                              'after:rounded-full',
                              'after:h-3.5',
                              'after:w-3.5',
                              'after:transition-all',
                              'peer-checked:bg-emerald-600',
                            )}
                          ></div>
                        </label>
                      </div>
                    ))}
                  </div>
                )}

                {configSalSubTab === 'fechamento' && (
                  <div className={clsx('space-y-3.5', 'animate-scale-in')}>
                    {[
                      {
                        title: 'Permitir que Garçom feche a conta',
                        desc: 'Autoriza o garçom a encerrar a mesa e dar a baixa definitiva no consumo.',
                        checked: permCloseAccount,
                        available: true,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_fechar: val }),
                      },
                      {
                        title: 'Permitir que Garçom aplique desconto',
                        desc: 'Habilita a aplicação de porcentagem de desconto na conta final direto pelo aplicativo.',
                        checked: permDiscount,
                        available: false,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_desconto: val }),
                      },
                      {
                        title: 'Permitir que Garçom aplique acréscimo',
                        desc: 'Habilita a adição de valores extras ou gorjetas no fechamento da conta pelo app.',
                        checked: permSurcharge,
                        available: false,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_acrescimo: val }),
                      },
                    ].map((item, idx) => (
                      <div key={idx} className={clsx('flex', 'justify-between', 'items-start', 'gap-4')}>
                        <div className="space-y-0.5">
                          <div className={clsx('flex', 'items-center', 'gap-2')}>
                            <strong
                              className={clsx(
                                item.available ? 'text-koma-foreground' : 'text-koma-subtle',
                                'block',
                                'font-semibold',
                              )}
                            >
                              {item.title}
                            </strong>
                            {!item.available && (
                              <span
                                className={clsx(
                                  'rounded-full',
                                  'border',
                                  'border-amber-700/40',
                                  'bg-amber-900/20',
                                  'px-2',
                                  'py-0.5',
                                  'text-[8px]',
                                  'font-bold',
                                  'uppercase',
                                  'tracking-wide',
                                  'text-amber-400',
                                )}
                              >
                                Integração pendente
                              </span>
                            )}
                          </div>
                          <span className={clsx('text-[9px]', 'text-koma-muted', 'block', 'leading-relaxed')}>
                            {item.desc}
                          </span>
                        </div>
                        <label
                          className={clsx(
                            'relative',
                            'inline-flex',
                            'items-center',
                            item.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-45',
                            'shrink-0',
                            'mt-0.5',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={item.checked}
                            disabled={!item.available}
                            onChange={(e) => item.onChange(e.target.checked)}
                            className={clsx('sr-only', 'peer')}
                          />
                          <div
                            className={clsx(
                              'w-8',
                              'h-4.5',
                              'bg-koma-raised',
                              'peer-focus:outline-none',
                              'rounded-full',
                              'peer',
                              'peer-checked:after:translate-x-full',
                              'peer-checked:after:border-white',
                              "after:content-['']",
                              'after:absolute',
                              'after:top-[2px]',
                              'after:left-[2px]',
                              'after:bg-white',
                              'after:border-gray-300',
                              'after:border',
                              'after:rounded-full',
                              'after:h-3.5',
                              'after:w-3.5',
                              'after:transition-all',
                              'peer-checked:bg-emerald-600',
                            )}
                          ></div>
                        </label>
                      </div>
                    ))}
                  </div>
                )}

                {configSalSubTab === 'atendimento' && (
                  <div className={clsx('space-y-3.5', 'animate-scale-in')}>
                    {[
                      {
                        title: 'Permitir que o garçom informe quantas pessoas vão sentar à mesa',
                        desc: 'Abre pergunta inicial na abertura da mesa para cálculo automático do consumo/taxa individual.',
                        checked: permPeopleCount,
                        available: false,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_pessoas: val }),
                      },
                      {
                        title: 'Permitir que Garçom transfira mesas e comandas',
                        desc: 'Permite realocar todo o consumo de uma mesa para outra mesa vazia.',
                        checked: permTransferTables,
                        available: true,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_transferir_mesa: val }),
                      },
                      {
                        title: 'Permitir que Garçom transfira pedidos e pagamentos para mesas ocupadas',
                        desc: 'Mover itens isolados ou repassar contas a pagar entre comanda de clientes sentados.',
                        checked: permTransferItems,
                        available: true,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_transferir_item: val }),
                      },
                      {
                        title: 'Permitir que Cliente chame Garçom na mesa',
                        desc: 'Dispara notificações no painel do garçom se o cliente apertar o botão no cardápio digital QR Code.',
                        checked: permClientCall,
                        available: false,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_chamar: val }),
                      },
                      {
                        title: 'Permitir exibição de mesas ociosas',
                        desc: 'Destaca no mapa mesas sem novos pedidos há mais tempo.',
                        checked: permShowIdleTables,
                        available: false,
                        onChange: (val: boolean) => updateConfiguracoes({ perm_garcom_ociosas: val }),
                      },
                    ].map((item, idx) => (
                      <div key={idx} className={clsx('flex', 'justify-between', 'items-start', 'gap-4')}>
                        <div className="space-y-0.5">
                          <div className={clsx('flex', 'items-center', 'gap-2')}>
                            <strong
                              className={clsx(
                                item.available ? 'text-koma-foreground' : 'text-koma-subtle',
                                'block',
                                'font-semibold',
                              )}
                            >
                              {item.title}
                            </strong>
                            {!item.available && (
                              <span
                                className={clsx(
                                  'rounded-full',
                                  'border',
                                  'border-amber-700/40',
                                  'bg-amber-900/20',
                                  'px-2',
                                  'py-0.5',
                                  'text-[8px]',
                                  'font-bold',
                                  'uppercase',
                                  'tracking-wide',
                                  'text-amber-400',
                                )}
                              >
                                Integração pendente
                              </span>
                            )}
                          </div>
                          <span className={clsx('text-[9px]', 'text-koma-muted', 'block', 'leading-relaxed')}>
                            {item.desc}
                          </span>
                        </div>
                        <label
                          className={clsx(
                            'relative',
                            'inline-flex',
                            'items-center',
                            item.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-45',
                            'shrink-0',
                            'mt-0.5',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={item.checked}
                            disabled={!item.available}
                            onChange={(e) => item.onChange(e.target.checked)}
                            className={clsx('sr-only', 'peer')}
                          />
                          <div
                            className={clsx(
                              'w-8',
                              'h-4.5',
                              'bg-koma-raised',
                              'peer-focus:outline-none',
                              'rounded-full',
                              'peer',
                              'peer-checked:after:translate-x-full',
                              'peer-checked:after:border-white',
                              "after:content-['']",
                              'after:absolute',
                              'after:top-[2px]',
                              'after:left-[2px]',
                              'after:bg-white',
                              'after:border-gray-300',
                              'after:border',
                              'after:rounded-full',
                              'after:h-3.5',
                              'after:w-3.5',
                              'after:transition-all',
                              'peer-checked:bg-emerald-600',
                            )}
                          ></div>
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Printer messages & test (Right Column) */}
          {printingSettingsTab === 'impressao' && hasPrinting && (
            <div
              className={clsx(
                'bg-koma-panel',
                'border',
                'border-koma-border',
                'rounded-[22px]',
                'p-5',
                'grid',
                'grid-cols-1',
                'xl:grid-cols-2',
                'gap-6',
                'shadow-xs',
              )}
            >
              <div className="space-y-4">
                <div
                  className={clsx(
                    'flex',
                    'items-start',
                    'justify-between',
                    'gap-3',
                    'border-b',
                    'border-koma-border',
                    'pb-3',
                  )}
                >
                  <div>
                    <h3 className={clsx('text-sm', 'font-bold', 'text-koma-foreground')}>Personalização do cupom</h3>
                    <p className={clsx('mt-1', 'text-[10px]', 'text-koma-muted')}>
                      Uma configuração central para caixa, comandas e impressão automática.
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[8px] font-extrabold ${
                      printSettingsSaveState === 'error'
                        ? 'koma-badge-danger'
                        : printSettingsSaveState === 'dirty'
                          ? 'koma-badge-warning'
                          : 'koma-badge-success'
                    }`}
                  >
                    {printSettingsSaveState === 'saving'
                      ? 'SALVANDO…'
                      : printSettingsSaveState === 'dirty'
                        ? 'ALTERAÇÕES PENDENTES'
                        : printSettingsSaveState === 'error'
                          ? 'NÃO FOI SALVO'
                          : 'SALVO NO RESTAURANTE'}
                  </span>
                </div>

                <div className={clsx('space-y-3', 'text-left')}>
                  <div className="space-y-1">
                    <label
                      className={clsx(
                        'text-[9px]',
                        'font-bold',
                        'text-koma-muted',
                        'uppercase',
                        'tracking-wider',
                        'block',
                      )}
                    >
                      Nome do restaurante no cupom:
                    </label>
                    <input
                      type="text"
                      value={printHeader}
                      maxLength={80}
                      onChange={(e) => {
                        setPrintHeader(e.target.value);
                        setPrintSettingsSaveState('dirty');
                      }}
                      onBlur={() => updateConfiguracoes({ impressao_nome_restaurante: printHeader })}
                      className={clsx(
                        'w-full',
                        'px-3.5',
                        'py-2.5',
                        'bg-koma-input',
                        'border',
                        'border-koma-border',
                        'rounded-xl',
                        'text-koma-foreground',
                        'text-xs',
                        'font-medium',
                        'focus:outline-none',
                        'focus:border-emerald-500/60',
                      )}
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      className={clsx(
                        'text-[9px]',
                        'font-bold',
                        'text-koma-muted',
                        'uppercase',
                        'tracking-wider',
                        'block',
                      )}
                    >
                      Onde imprimir o nome:
                    </label>
                    <select
                      value={printNamePosition}
                      onChange={(e) =>
                        updateConfiguracoes({
                          impressao_nome_posicao: e.target.value as 'cabecalho' | 'rodape' | 'oculto',
                        })
                      }
                      className={clsx(
                        'w-full',
                        'px-3.5',
                        'py-2.5',
                        'bg-koma-input',
                        'border',
                        'border-koma-border',
                        'rounded-xl',
                        'text-koma-foreground',
                        'text-xs',
                        'font-medium',
                        'focus:outline-none',
                        'focus:border-emerald-500/60',
                      )}
                    >
                      <option value="cabecalho">Cabeçalho — maior destaque</option>
                      <option value="rodape">Rodapé</option>
                      <option value="oculto">Não imprimir</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label
                      className={clsx(
                        'text-[9px]',
                        'font-bold',
                        'text-koma-muted',
                        'uppercase',
                        'tracking-wider',
                        'block',
                      )}
                    >
                      Mensagem adicional de rodapé:
                    </label>
                    <input
                      type="text"
                      value={printFooter}
                      maxLength={160}
                      placeholder="Ex.: endereço, telefone ou agradecimento"
                      onChange={(e) => {
                        setPrintFooter(e.target.value);
                        setPrintSettingsSaveState('dirty');
                      }}
                      onBlur={() => updateConfiguracoes({ impressao_mensagem_rodape: printFooter })}
                      className={clsx(
                        'w-full',
                        'px-3.5',
                        'py-2.5',
                        'bg-koma-input',
                        'border',
                        'border-koma-border',
                        'rounded-xl',
                        'text-koma-foreground',
                        'text-xs',
                        'focus:outline-none',
                        'focus:border-emerald-500/60',
                      )}
                    />
                  </div>

                  <div className={clsx('flex', 'justify-between', 'items-center', 'pt-2')}>
                    <span className={clsx('text-xs', 'text-koma-foreground', 'font-medium')}>
                      Unificar Vias de Delivery (Via Única)
                    </span>
                    <label className={clsx('relative', 'inline-flex', 'items-center', 'cursor-pointer')}>
                      <input
                        type="checkbox"
                        checked={unificarViasDelivery}
                        onChange={(e) => {
                          setUnificarViasDelivery(e.target.checked);
                          updateConfiguracoes({ unificar_vias_delivery: e.target.checked });
                        }}
                        className={clsx('sr-only', 'peer')}
                      />
                      <div
                        className={clsx(
                          'w-9',
                          'h-5',
                          'bg-zinc-300',
                          'dark:bg-zinc-700',
                          'peer-focus:outline-none',
                          'rounded-full',
                          'peer',
                          'peer-checked:after:translate-x-full',
                          'peer-checked:after:border-white',
                          "after:content-['']",
                          'after:absolute',
                          'after:top-[2px]',
                          'after:left-[2px]',
                          'after:bg-white',
                          'after:border-gray-300',
                          'after:border',
                          'after:rounded-full',
                          'after:h-4',
                          'after:w-4',
                          'after:transition-all',
                          'peer-checked:bg-emerald-600',
                        )}
                      ></div>
                    </label>
                  </div>
                </div>
              </div>

              {/* Prévia aproximada: a largura final depende da impressora. */}
              <div className="space-y-2">
                <div className={clsx('flex', 'items-center', 'justify-between', 'gap-2')}>
                  <span className={clsx('font-serif', 'font-bold', 'text-koma-secondary')}>Prévia aproximada</span>
                  <span
                    className={clsx(
                      'rounded-full',
                      'border',
                      'border-koma-border',
                      'px-2',
                      'py-1',
                      'text-[8px]',
                      'text-koma-muted',
                    )}
                  >
                    exemplo em escala
                  </span>
                </div>
                <div
                  className={clsx(
                    'mx-auto',
                    'w-full',
                    'max-w-[380px]',
                    'bg-[#FFFFFC]',
                    'text-black',
                    'px-5',
                    'py-4',
                    'rounded-sm',
                    'border',
                    'border-gray-300',
                    'font-mono',
                    'text-[10px]',
                    'leading-[1.25]',
                    'shadow-[0_14px_30px_rgba(0,0,0,0.35)]',
                  )}
                >
                  {printNamePosition === 'cabecalho' && printHeader && (
                    <>
                      <div className={clsx('text-center', 'font-bold', 'uppercase', 'text-[12px]', 'leading-tight')}>
                        {printHeader}
                      </div>
                      <div className={clsx('border-t', 'border-dashed', 'border-gray-500', 'my-1.5')} />
                    </>
                  )}

                  <div className={clsx('text-center', 'font-bold', 'text-[12px]')}>CONSUMO NO LOCAL</div>
                  <div className={clsx('border-t', 'border-dashed', 'border-gray-500', 'my-1.5')} />
                  <div className={clsx('flex', 'justify-between')}>
                    <span>PEDIDO: #305</span>
                    <span>MESA: 3</span>
                  </div>
                  <div className={clsx('flex', 'justify-between')}>
                    <span>DATA: 28/07/2026</span>
                    <span>HORA: 18:01</span>
                  </div>
                  <div>GARÇOM: GEORLAN</div>
                  <div className={clsx('border-t', 'border-dashed', 'border-gray-500', 'my-1.5')} />

                  <div className="space-y-1">
                    <div className={clsx('flex', 'justify-between', 'gap-3')}>
                      <span>3x HAMBÚRGUER TRADICIONAL</span>
                      <span className="shrink-0">R$ 57,00</span>
                    </div>
                    <div className={clsx('pl-3', 'text-[8px]', 'text-gray-700')}>OBS: SEM CHEDDAR</div>
                    <div className={clsx('flex', 'justify-between', 'gap-3')}>
                      <span>2x HEINEKEN LONG NECK</span>
                      <span className="shrink-0">R$ 24,00</span>
                    </div>
                    <div className={clsx('flex', 'justify-between', 'gap-3')}>
                      <span>1x BAGUETE DE COSTELA</span>
                      <span className="shrink-0">R$ 36,00</span>
                    </div>
                    <div className={clsx('pl-3', 'text-[8px]', 'text-gray-700')}>OBS: SEM SALADA</div>
                  </div>

                  <div className={clsx('border-t', 'border-dashed', 'border-gray-500', 'my-1.5')} />
                  <div className={clsx('text-center', 'font-bold')}>CLIENTE: PAULO</div>
                  <div className={clsx('flex', 'justify-between', 'gap-3')}>
                    <span>1x CHEESE BACON</span>
                    <span className="shrink-0">R$ 25,00</span>
                  </div>
                  <div className={clsx('flex', 'justify-between', 'gap-3')}>
                    <span>1x HAMBÚRGUER SUÍNO</span>
                    <span className="shrink-0">R$ 19,00</span>
                  </div>
                  <div className={clsx('border-t', 'border-dashed', 'border-gray-500', 'my-1.5')} />
                  <div className={clsx('flex', 'justify-between')}>
                    <span>SUBTOTAL CONSUMO GERAL</span>
                    <span>R$ 117,00</span>
                  </div>
                  <div className={clsx('flex', 'justify-between')}>
                    <span>SUBTOTAL PAULO</span>
                    <span>R$ 44,00</span>
                  </div>
                  <div
                    className={clsx(
                      'border-y',
                      'border-double',
                      'border-koma-border',
                      'my-1.5',
                      'py-1',
                      'flex',
                      'justify-between',
                      'font-bold',
                      'text-[11px]',
                    )}
                  >
                    <span>TOTAL GERAL DA MESA</span>
                    <span>R$ 161,00</span>
                  </div>

                  <div className={clsx('text-center', 'text-[9px]', 'mt-2')}>
                    <span className="block">Gerenciado por Kôma</span>
                    <span className="block">Documento não fiscal</span>
                    {printFooter && <span className={clsx('block', 'mt-1', 'uppercase')}>{printFooter}</span>}
                    {printNamePosition === 'rodape' && printHeader && (
                      <span className={clsx('block', 'font-bold', 'mt-1', 'uppercase')}>{printHeader}</span>
                    )}
                  </div>
                </div>
                <p className={clsx('text-[8px]', 'leading-relaxed', 'text-koma-muted')}>
                  O nome, a posição e o rodapé acima atualizam esta simulação. A impressão real usa o formatador do
                  servidor e ajusta as quebras à largura da térmica.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
      {showAddMesaModal && (
        <div
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !tableMutation) setShowAddMesaModal(false);
          }}
          className={clsx(
            'fixed',
            'inset-0',
            'z-50',
            'flex',
            'items-center',
            'justify-center',
            'bg-black/80',
            'p-4',
            'backdrop-blur-sm',
          )}
        >
          <form
            onSubmit={handleAddMesaSubmit}
            className={clsx(
              'w-full',
              'max-w-md',
              'overflow-hidden',
              'rounded-[24px]',
              'border',
              'border-[#2b312e]',
              'bg-koma-card',
              'shadow-2xl',
              'animate-scale-in',
            )}
          >
            <div
              className={clsx(
                'flex',
                'items-start',
                'justify-between',
                'border-b',
                'border-[#2b312e]',
                'px-5',
                'py-4',
                'sm:px-6',
              )}
            >
              <div className={clsx('flex', 'items-center', 'gap-3')}>
                <span
                  className={clsx(
                    'flex',
                    'h-10',
                    'w-10',
                    'items-center',
                    'justify-center',
                    'rounded-xl',
                    'border',
                    'border-emerald-500/30',
                    'bg-emerald-500/15',
                    'text-emerald-800 dark:text-emerald-300',
                  )}
                >
                  <Plus size={18} />
                </span>
                <div>
                  <span
                    className={clsx(
                      'block',
                      'font-mono',
                      'text-[8px]',
                      'font-bold',
                      'uppercase',
                      'tracking-[0.2em]',
                      'text-emerald-700 dark:text-emerald-400',
                    )}
                  >
                    Estrutura do salão
                  </span>
                  <h3 className={clsx('mt-0.5', 'text-lg', 'font-bold', 'text-koma-foreground')}>Adicionar mesa</h3>
                  <p className={clsx('mt-0.5', 'text-[10px]', 'text-koma-muted')}>
                    Ela ficará disponível no caixa e no app do garçom.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={tableMutation !== null}
                onClick={() => setShowAddMesaModal(false)}
                aria-label="Fechar"
                className={clsx(
                  'rounded-lg',
                  'p-2',
                  'text-koma-muted',
                  'transition-colors',
                  'hover:bg-white/[0.05]',
                  'hover:text-koma-foreground',
                  'disabled:opacity-40',
                )}
              >
                <X size={16} />
              </button>
            </div>

            <div className={clsx('space-y-4', 'px-5', 'py-5', 'sm:px-6')}>
              <div className={clsx('grid', 'grid-cols-2', 'gap-3')}>
                <label className="space-y-1.5">
                  <span
                    className={clsx(
                      'block',
                      'text-[9px]',
                      'font-bold',
                      'uppercase',
                      'tracking-wider',
                      'text-koma-subtle',
                    )}
                  >
                    Número da mesa
                  </span>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="Ex: 31"
                    value={newMesaId}
                    onChange={(e) => {
                      setNewMesaId(e.target.value);
                      setTableFormError('');
                    }}
                    className={clsx(
                      'w-full',
                      'rounded-xl',
                      'border',
                      'border-[#303633]',
                      'bg-koma-panel',
                      'px-3',
                      'py-3',
                      'font-mono',
                      'text-sm',
                      'text-koma-foreground',
                      'outline-none',
                      'transition-colors',
                      'placeholder:text-zinc-700',
                      'focus:border-[#10b981]/60',
                    )}
                  />
                </label>
                <label className="space-y-1.5">
                  <span
                    className={clsx(
                      'block',
                      'text-[9px]',
                      'font-bold',
                      'uppercase',
                      'tracking-wider',
                      'text-koma-subtle',
                    )}
                  >
                    Lugares
                  </span>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="Ex: 4"
                    value={newMesaCap}
                    onChange={(e) => {
                      setNewMesaCap(e.target.value);
                      setTableFormError('');
                    }}
                    className={clsx(
                      'w-full',
                      'rounded-xl',
                      'border',
                      'border-[#303633]',
                      'bg-koma-panel',
                      'px-3',
                      'py-3',
                      'font-mono',
                      'text-sm',
                      'text-koma-foreground',
                      'outline-none',
                      'transition-colors',
                      'placeholder:text-zinc-700',
                      'focus:border-[#10b981]/60',
                    )}
                  />
                </label>
              </div>

              <label className={clsx('block', 'space-y-1.5')}>
                <span
                  className={clsx(
                    'block',
                    'text-[9px]',
                    'font-bold',
                    'uppercase',
                    'tracking-wider',
                    'text-koma-subtle',
                  )}
                >
                  Nome de referência <span className={clsx('normal-case', 'text-koma-muted')}>(opcional)</span>
                </span>
                <input
                  type="text"
                  maxLength={80}
                  placeholder="Ex.: Varanda, Deck ou Mesa VIP"
                  value={newMesaNome}
                  onChange={(e) => {
                    setNewMesaNome(e.target.value);
                    setTableFormError('');
                  }}
                  className={clsx(
                    'w-full',
                    'rounded-xl',
                    'border',
                    'border-[#303633]',
                    'bg-koma-panel',
                    'px-3',
                    'py-3',
                    'text-sm',
                    'text-koma-foreground',
                    'outline-none',
                    'transition-colors',
                    'placeholder:text-zinc-700',
                    'focus:border-[#10b981]/60',
                  )}
                />
              </label>

              {tableFormError && (
                <div
                  role="alert"
                  className={clsx(
                    'flex',
                    'gap-2',
                    'rounded-xl',
                    'border',
                    'border-rose-900/40',
                    'bg-rose-950/20',
                    'p-3',
                    'text-[11px]',
                    'leading-relaxed',
                    'text-rose-600 dark:text-rose-300',
                  )}
                >
                  <AlertTriangle className={clsx('mt-0.5', 'shrink-0')} size={14} />
                  {tableFormError}
                </div>
              )}

              <div className={clsx('flex', 'flex-col-reverse', 'gap-2', 'pt-1', 'sm:flex-row')}>
                <button
                  type="button"
                  disabled={tableMutation !== null}
                  onClick={() => setShowAddMesaModal(false)}
                  className={clsx(
                    'min-h-11',
                    'flex-1',
                    'rounded-xl',
                    'border',
                    'border-[#303633]',
                    'bg-koma-panel',
                    'px-4',
                    'text-xs',
                    'font-bold',
                    'text-koma-subtle',
                    'transition-colors',
                    'hover:text-koma-foreground',
                    'disabled:opacity-40',
                  )}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={tableMutation !== null}
                  className={clsx(
                    'flex',
                    'min-h-11',
                    'flex-1',
                    'items-center',
                    'justify-center',
                    'gap-2',
                    'rounded-xl',
                    'bg-[#10b981]',
                    'px-4',
                    'text-xs',
                    'font-extrabold',
                    'text-[#07110e]',
                    'transition-colors',
                    'hover:bg-[#35c99a]',
                    'disabled:cursor-wait',
                    'disabled:opacity-60',
                  )}
                >
                  {tableMutation === 'create' ? <RefreshCw className="animate-spin" size={14} /> : <Check size={14} />}
                  {tableMutation === 'create' ? 'Adicionando…' : 'Adicionar mesa'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
      {editingTable && (
        <div
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !tableMutation) {
              setEditingTable(null);
              setIsConfirmingDelete(false);
            }
          }}
          className={clsx(
            'fixed',
            'inset-0',
            'z-50',
            'flex',
            'items-center',
            'justify-center',
            'bg-black/80',
            'p-4',
            'backdrop-blur-sm',
          )}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (tableMutation) return;
              const capacity = Number.parseInt(editTableCap, 10);
              if (!Number.isFinite(capacity) || capacity <= 0) {
                setTableFormError('Informe uma capacidade maior que zero.');
                return;
              }
              try {
                setTableMutation('update');
                setTableFormError('');
                await onUpdateMesa(editingTable.id, capacity, editTableNome.trim() || `Mesa ${editingTable.id}`);
                showToast(`Mesa ${editingTable.id} atualizada.`, 'success');
                setEditingTable(null);
              } catch (err: any) {
                setTableFormError(err?.message || 'Não foi possível atualizar a mesa.');
              } finally {
                setTableMutation(null);
              }
            }}
            className={clsx(
              'w-full',
              'max-w-md',
              'overflow-hidden',
              'rounded-[24px]',
              'border',
              'border-[#2b312e]',
              'bg-koma-card',
              'shadow-2xl',
              'animate-scale-in',
            )}
          >
            <div
              className={clsx(
                'flex',
                'items-start',
                'justify-between',
                'border-b',
                'border-[#2b312e]',
                'px-5',
                'py-4',
                'sm:px-6',
              )}
            >
              <div className={clsx('flex', 'items-center', 'gap-3')}>
                <span
                  className={clsx(
                    'flex',
                    'h-10',
                    'w-10',
                    'items-center',
                    'justify-center',
                    'rounded-xl',
                    'border',
                    'border-emerald-500/30',
                    'bg-emerald-500/15',
                    'font-mono',
                    'text-base',
                    'font-extrabold',
                    'text-emerald-800 dark:text-emerald-300',
                  )}
                >
                  {editingTable.id}
                </span>
                <div>
                  <span
                    className={clsx(
                      'block',
                      'font-mono',
                      'text-[8px]',
                      'font-bold',
                      'uppercase',
                      'tracking-[0.2em]',
                      'text-emerald-700 dark:text-emerald-400',
                    )}
                  >
                    Configuração da mesa
                  </span>
                  <h3 className={clsx('mt-0.5', 'text-lg', 'font-bold', 'text-koma-foreground')}>
                    Editar Mesa {editingTable.id}
                  </h3>
                  <p className={clsx('mt-0.5', 'text-[10px]', 'text-koma-muted')}>
                    {editingTableRuntime?.isOccupied ? 'Em atendimento agora' : 'Livre e disponível no salão'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={tableMutation !== null}
                onClick={() => {
                  setEditingTable(null);
                  setIsConfirmingDelete(false);
                }}
                aria-label="Fechar"
                className={clsx(
                  'rounded-lg',
                  'p-2',
                  'text-koma-muted',
                  'transition-colors',
                  'hover:bg-white/[0.05]',
                  'hover:text-koma-foreground',
                  'disabled:opacity-40',
                )}
              >
                <X size={16} />
              </button>
            </div>

            <div className={clsx('space-y-4', 'px-5', 'py-5', 'sm:px-6')}>
              {isConfirmingDelete ? (
                <div
                  className={clsx(
                    'space-y-4',
                    'rounded-2xl',
                    'border',
                    'border-rose-900/40',
                    'bg-rose-950/20',
                    'p-4',
                    'text-center',
                  )}
                >
                  <span
                    className={clsx(
                      'mx-auto',
                      'flex',
                      'h-10',
                      'w-10',
                      'items-center',
                      'justify-center',
                      'rounded-full',
                      'bg-rose-500/10',
                      'text-rose-400',
                    )}
                  >
                    <Trash2 size={17} />
                  </span>
                  <div>
                    <strong className={clsx('block', 'text-sm', 'text-koma-foreground')}>
                      Remover Mesa {editingTable.id}?
                    </strong>
                    <p className={clsx('mt-1', 'text-[11px]', 'leading-relaxed', 'text-koma-subtle')}>
                      Ela sairá do salão em todos os dispositivos. O histórico de pedidos será preservado.
                    </p>
                  </div>
                  <div className={clsx('flex', 'gap-2')}>
                    <button
                      type="button"
                      onClick={() => setIsConfirmingDelete(false)}
                      disabled={tableMutation !== null}
                      className={clsx(
                        'min-h-10',
                        'flex-1',
                        'rounded-xl',
                        'border',
                        'border-[#303633]',
                        'bg-koma-panel',
                        'text-xs',
                        'font-bold',
                        'text-koma-subtle',
                        'transition-colors',
                        'hover:text-koma-foreground',
                        'disabled:opacity-40',
                      )}
                    >
                      Manter mesa
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (tableMutation) return;
                        try {
                          setTableMutation('delete');
                          setTableFormError('');
                          await onDeleteMesa(editingTable.id);
                          showToast(`Mesa ${editingTable.id} removida do salão.`, 'success');
                          setEditingTable(null);
                          setIsConfirmingDelete(false);
                        } catch (err: any) {
                          setTableFormError(err?.message || 'Não foi possível remover a mesa.');
                          setIsConfirmingDelete(false);
                        } finally {
                          setTableMutation(null);
                        }
                      }}
                      disabled={tableMutation !== null}
                      className={clsx(
                        'flex',
                        'min-h-10',
                        'flex-1',
                        'items-center',
                        'justify-center',
                        'gap-2',
                        'rounded-xl',
                        'bg-rose-600',
                        'text-xs',
                        'font-bold',
                        'text-koma-foreground',
                        'transition-colors',
                        'hover:bg-rose-500',
                        'disabled:cursor-wait',
                        'disabled:opacity-60',
                      )}
                    >
                      {tableMutation === 'delete' && <RefreshCw className="animate-spin" size={13} />}
                      {tableMutation === 'delete' ? 'Removendo…' : 'Remover'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={clsx('space-y-4', 'text-left')}>
                    <label className={clsx('block', 'space-y-1.5')}>
                      <span
                        className={clsx(
                          'block',
                          'text-[9px]',
                          'font-bold',
                          'uppercase',
                          'tracking-wider',
                          'text-koma-subtle',
                        )}
                      >
                        Nome de referência
                      </span>
                      <input
                        type="text"
                        maxLength={80}
                        placeholder={`Mesa ${editingTable.id}`}
                        value={editTableNome}
                        onChange={(e) => {
                          setEditTableNome(e.target.value);
                          setTableFormError('');
                        }}
                        className={clsx(
                          'w-full',
                          'rounded-xl',
                          'border',
                          'border-[#303633]',
                          'bg-koma-panel',
                          'px-3',
                          'py-3',
                          'text-sm',
                          'text-koma-foreground',
                          'outline-none',
                          'transition-colors',
                          'placeholder:text-zinc-700',
                          'focus:border-[#10b981]/60',
                        )}
                      />
                      <span className={clsx('block', 'text-[9px]', 'text-koma-muted')}>
                        Use um nome simples, como “Varanda” ou “Deck”.
                      </span>
                    </label>

                    <label className={clsx('block', 'space-y-1.5')}>
                      <span
                        className={clsx(
                          'block',
                          'text-[9px]',
                          'font-bold',
                          'uppercase',
                          'tracking-wider',
                          'text-koma-subtle',
                        )}
                      >
                        Capacidade
                      </span>
                      <div className="relative">
                        <Users
                          className={clsx('absolute', 'left-3', 'top-1/2', '-translate-y-1/2', 'text-koma-muted')}
                          size={14}
                        />
                        <input
                          type="number"
                          min="1"
                          required
                          placeholder="Ex: 4"
                          value={editTableCap}
                          onChange={(e) => {
                            setEditTableCap(e.target.value);
                            setTableFormError('');
                          }}
                          className={clsx(
                            'w-full',
                            'rounded-xl',
                            'border',
                            'border-[#303633]',
                            'bg-koma-panel',
                            'py-3',
                            'pl-9',
                            'pr-3',
                            'font-mono',
                            'text-sm',
                            'text-koma-foreground',
                            'outline-none',
                            'transition-colors',
                            'placeholder:text-zinc-700',
                            'focus:border-[#10b981]/60',
                          )}
                        />
                      </div>
                    </label>
                  </div>

                  {tableFormError && (
                    <div
                      role="alert"
                      className={clsx(
                        'flex',
                        'gap-2',
                        'rounded-xl',
                        'border',
                        'border-rose-900/40',
                        'bg-rose-950/20',
                        'p-3',
                        'text-[11px]',
                        'leading-relaxed',
                        'text-rose-600 dark:text-rose-300',
                      )}
                    >
                      <AlertTriangle className={clsx('mt-0.5', 'shrink-0')} size={14} />
                      {tableFormError}
                    </div>
                  )}

                  <div className={clsx('space-y-3', 'pt-1')}>
                    <div className={clsx('flex', 'flex-col-reverse', 'gap-2', 'sm:flex-row')}>
                      <button
                        type="button"
                        onClick={() => setEditingTable(null)}
                        disabled={tableMutation !== null}
                        className={clsx(
                          'min-h-11',
                          'flex-1',
                          'rounded-xl',
                          'border',
                          'border-[#303633]',
                          'bg-koma-panel',
                          'px-4',
                          'text-xs',
                          'font-bold',
                          'text-koma-subtle',
                          'transition-colors',
                          'hover:text-koma-foreground',
                          'disabled:opacity-40',
                        )}
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={tableMutation !== null}
                        className={clsx(
                          'flex',
                          'min-h-11',
                          'flex-1',
                          'items-center',
                          'justify-center',
                          'gap-2',
                          'rounded-xl',
                          'bg-[#10b981]',
                          'px-4',
                          'text-xs',
                          'font-extrabold',
                          'text-[#07110e]',
                          'transition-colors',
                          'hover:bg-[#35c99a]',
                          'disabled:cursor-wait',
                          'disabled:opacity-60',
                        )}
                      >
                        {tableMutation === 'update' ? (
                          <RefreshCw className="animate-spin" size={14} />
                        ) : (
                          <Check size={14} />
                        )}
                        {tableMutation === 'update' ? 'Salvando…' : 'Salvar alterações'}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsConfirmingDelete(true)}
                      disabled={Boolean(editingTableRuntime?.isOccupied) || tableMutation !== null}
                      className={clsx(
                        'flex',
                        'min-h-10',
                        'w-full',
                        'items-center',
                        'justify-center',
                        'gap-1.5',
                        'rounded-xl',
                        'border',
                        'border-rose-900/30',
                        'bg-rose-950/10',
                        'px-3',
                        'text-[10px]',
                        'font-bold',
                        'text-rose-400',
                        'transition-colors',
                        'hover:bg-rose-950/25',
                        'disabled:cursor-not-allowed',
                        'disabled:border-zinc-800',
                        'disabled:bg-transparent',
                        'disabled:text-zinc-600',
                      )}
                    >
                      <Trash2 size={12} />
                      {editingTableRuntime?.isOccupied
                        ? 'Finalize o atendimento para remover'
                        : 'Remover mesa do salão'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </form>
        </div>
      )}
    </>
  );
}
