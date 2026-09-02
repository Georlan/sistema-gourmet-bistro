
import { Plus, Search, Users, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { aplicarMascaraTelefoneInput } from '../../../utils/phonePresentation';
import CuponsTab from '../../clientes/CuponsTab';
import MoneyInput from '../../MoneyInput';
import { KomaEmptyState } from '../../shared/KomaEmptyState';
import { OperationalBanner } from '../../shared/OperationalBanner';
import type { CashierNotice, LoyaltyCustomer } from '../cashierContracts';
import { CustomerRelationshipPanel } from './CustomerRelationshipPanel';
import { CustomerSatisfactionPanel } from './CustomerSatisfactionPanel';
import { useCustomerSatisfaction } from './useCustomerSatisfaction';

const formatarTelefoneTabela = (tel?: string) => {
  if (!tel) return '-';
  const limpo = tel.replace(/\D/g, '');
  if (limpo.length === 11) {
    return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 7)}-${limpo.slice(7)}`;
  } else if (limpo.length === 10) {
    return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 6)}-${limpo.slice(6)}`;
  }
  return tel; // Retorna o valor original se contiver letras (como os usuários legados 'georlan', 'caixa1')
};
interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeTab: string;
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
  showToast: CashierNotice;
  loyaltyUsers: LoyaltyCustomer[];
  refreshLoyaltyUsers: () => Promise<void>;
}

export default function CashierCustomers({
  apiBaseUrl,
  authHeaders,
  activeTab,
  activeSubTab,
  setActiveSubTab,
  showToast,
  loyaltyUsers,
  refreshLoyaltyUsers,
}: Props) {
  const [clientesSearch, setClientesSearch] = useState('');

  const filteredLoyaltyUsers = useMemo(() => {
    const term = clientesSearch.trim().toLocaleLowerCase('pt-BR');
    if (!term) return loyaltyUsers;
    return loyaltyUsers.filter((user) => `${user.cliente} ${user.telefone}`.toLocaleLowerCase('pt-BR').includes(term));
  }, [clientesSearch, loyaltyUsers]);

  const relationshipSummary = useMemo(() => {
    let ativos = 0;
    let atencao = 0;
    let reativar = 0;
    for (const u of loyaltyUsers) {
      const seg = u.segmento_relacionamento || 'SEM_COMPRA';
      if (seg === 'ATIVO') ativos++;
      else if (seg === 'ATENCAO') atencao++;
      else if (seg === 'REATIVAR') reativar++;
    }
    return { ativos, atencao, reativar };
  }, [loyaltyUsers]);

  const handleSaveFidelidadeConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${apiBaseUrl}/fidelidade/config`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(fidelidadeConfig),
      });
      if (res.ok) {
        showToast('Configurações do Programa de Fidelidade salvas com sucesso!');
      } else {
        showToast('Falha ao salvar as configurações.', 'error');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const [fidelidadeConfig, setFidelidadeConfig] = useState({
    ativo: true,
    tipo_recompensa: 'PONTOS', // PONTOS | CASHBACK
    taxa_conversao: 1.0,
    valor_ponto_em_dinheiro: 0.05,
  });

  const [editingCrmUser, setEditingCrmUser] = useState<any>(null);

  const [crmFormNome, setCrmFormNome] = useState('');

  const [crmFormTelefone, setCrmFormTelefone] = useState('');

  const [crmFormPontos, setCrmFormPontos] = useState<number>(0);

  const [crmFormCashback, setCrmFormCashback] = useState<number>(0);

  const [showNewCrmModal, setShowNewCrmModal] = useState(false);

  const [newCrmNome, setNewCrmNome] = useState('');

  const [newCrmTelefone, setNewCrmTelefone] = useState('');

  const [newCrmSaldo, setNewCrmSaldo] = useState<number | ''>(0);
  const isClientesTabActive = activeTab === 'clientes' && ['clientes', 'crm', 'banco_clientes'].includes(activeSubTab);
  const {
    data: satisfactionData,
    isLoading: isSatisfactionLoading,
    submitSatisfaction,
  } = useCustomerSatisfaction({
    apiBaseUrl,
    authHeaders,
    enabled: isClientesTabActive,
  });

  const [showSatisfactionModal, setShowSatisfactionModal] = useState(false);
  const [satisfactionClienteId, setSatisfactionClienteId] = useState('');
  const [satisfactionNota, setSatisfactionNota] = useState<number>(5);
  const [satisfactionComentario, setSatisfactionComentario] = useState('');
  const [isSubmittingSatisfaction, setIsSubmittingSatisfaction] = useState(false);

  const handleOpenSatisfactionModal = () => {
    setSatisfactionClienteId(loyaltyUsers[0]?.id || '');
    setSatisfactionNota(5);
    setSatisfactionComentario('');
    setShowSatisfactionModal(true);
  };

  const handleRegisterSatisfaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!satisfactionClienteId) {
      showToast('Selecione um cliente para a avaliação.', 'info');
      return;
    }
    setIsSubmittingSatisfaction(true);
    const result = await submitSatisfaction({
      cliente_id: satisfactionClienteId,
      nota: satisfactionNota,
      comentario: satisfactionComentario.trim() || undefined,
    });
    setIsSubmittingSatisfaction(false);
    if (result.success) {
      showToast('Avaliação registrada com sucesso!');
      setShowSatisfactionModal(false);
    } else {
      showToast(result.error || 'Falha ao registrar avaliação.', 'error');
    }
  };

  const handleUpdateClient = async (clienteId: string, newNome: string, newPhone: string, newSaldo?: number) => {
    try {
      const body: any = {
        cliente: newNome.trim(),
        telefone: newPhone.replace(/\D/g, ''),
      };
      if (newSaldo !== undefined && !isNaN(newSaldo)) {
        if (fidelidadeConfig.tipo_recompensa === 'PONTOS') {
          body.saldo_pontos = Math.round(newSaldo);
        } else {
          body.saldo_cashback = newSaldo;
        }
      }
      const res = await fetch(`${apiBaseUrl}/fidelidade/clientes/${clienteId}`, {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showToast('Cliente atualizado com sucesso!');
        await refreshLoyaltyUsers();
        return true;
      } else {
        const err = await res.json();
        showToast(err.detail || 'Falha ao atualizar cliente.', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Erro de conexão.', 'error');
    }
    return false;
  };

  const handleCreateClient = async (nome: string, telefone: string, saldoInicial: number) => {
    try {
      const body: any = {
        cliente: nome.trim(),
        telefone: telefone.replace(/\D/g, ''),
      };
      if (!isNaN(saldoInicial)) {
        if (fidelidadeConfig.tipo_recompensa === 'PONTOS') {
          body.saldo_pontos = Math.round(saldoInicial);
        } else {
          body.saldo_cashback = saldoInicial;
        }
      }
      const res = await fetch(`${apiBaseUrl}/fidelidade/clientes`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showToast('Cliente cadastrado com sucesso!');
        await refreshLoyaltyUsers();
        return true;
      } else {
        const err = await res.json();
        showToast(err.detail || 'Erro ao cadastrar cliente.', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Erro de conexão.', 'error');
    }
    return false;
  };
  useEffect(() => {
    if (activeTab === 'clientes') {
      fetch(`${apiBaseUrl}/fidelidade/config`, { headers: authHeaders })
        .then((res) => res.json())
        .then((data) => {
          if (data && data.tipo_recompensa) setFidelidadeConfig(data);
        })
        .catch((err) => console.error('Error fetching fidelity config:', err));

      void refreshLoyaltyUsers();
    }
  }, [activeTab, activeSubTab, apiBaseUrl, authHeaders.Authorization]);
  return (
    <>
      {activeTab === 'clientes' && activeSubTab === 'fidelidade' && (
        <div className="space-y-4 text-left animate-fade-in">
          <OperationalBanner
            id="loyalty-heading"
            eyebrow="RELACIONAMENTO"
            title="Fidelidade"
            accent={fidelidadeConfig.ativo ? 'ativa e simples' : 'pronta para começar'}
            description="Defina uma regra fácil de explicar e acompanhe os pontos de cada cliente em uma única lista."
            metrics={[
              {
                label: loyaltyUsers.length === 1 ? 'cliente participante' : 'clientes participantes',
                value: loyaltyUsers.length,
              },
              {
                label: 'situação',
                value: fidelidadeConfig.ativo ? 'Ativo' : 'Pausado',
                valueClassName: fidelidadeConfig.ativo
                  ? 'text-emerald-600 dark:text-emerald-300'
                  : 'text-amber-600 dark:text-amber-300',
              },
            ]}
          />
          <div className={"grid grid-cols-1 md:grid-cols-2 gap-4 max-w-5xl"}>
            <div
              className={"bg-koma-card border border-koma-border p-5 rounded-2xl space-y-4 h-fit"}
            >
              <div className="border-b border-koma-border pb-3">
                <div>
                  <span className="block text-sm font-bold text-koma-foreground">Configuração do programa</span>
                  <span className="mt-0.5 block text-[10px] text-koma-muted">
                    Defina como os clientes acumulam e resgatam benefícios.
                  </span>
                </div>
              </div>

              <form onSubmit={handleSaveFidelidadeConfig} className="space-y-4">
                <div className={"flex items-center justify-between"}>
                  <span className={"text-[10px] font-semibold text-koma-secondary"}>
                    {fidelidadeConfig.ativo ? 'Programa ativo' : 'Programa pausado'}
                  </span>
                  <label className={"relative inline-flex items-center cursor-pointer shrink-0"}>
                    <input
                      type="checkbox"
                      checked={fidelidadeConfig.ativo}
                      onChange={(e) => setFidelidadeConfig((prev) => ({ ...prev, ativo: e.target.checked }))}
                      className={"sr-only peer"}
                    />
                    <div
                      className={"w-8 h-4.5 bg-koma-raised peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-emerald-600"}
                    ></div>
                  </label>
                </div>

                <div className="space-y-1">
                  <label
                    className={"text-[9px] font-bold text-koma-secondary uppercase tracking-wider block"}
                  >
                    Benefício oferecido
                  </label>
                  <select
                    value={fidelidadeConfig.tipo_recompensa}
                    onChange={(e) => setFidelidadeConfig((prev) => ({ ...prev, tipo_recompensa: e.target.value }))}
                    disabled={!fidelidadeConfig.ativo}
                    className={"w-full px-3 py-2 bg-koma-page border border-koma-border rounded-xl text-koma-foreground text-[10px] disabled:opacity-50"}
                  >
                    <option value="PONTOS">Pontos</option>
                    <option value="CASHBACK">Dinheiro de volta</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label
                    className={"text-[9px] font-bold text-koma-secondary uppercase tracking-wider block"}
                  >
                    {fidelidadeConfig.tipo_recompensa === 'PONTOS'
                      ? 'Pontos ganhos a cada R$ 1'
                      : 'Percentual devolvido ao cliente'}
                  </label>
                  <input
                    type="number"
                    value={fidelidadeConfig.taxa_conversao}
                    onChange={(e) =>
                      setFidelidadeConfig((prev) => ({ ...prev, taxa_conversao: Number(e.target.value) }))
                    }
                    disabled={!fidelidadeConfig.ativo}
                    className={"w-full px-3 py-2 bg-koma-page border border-koma-border rounded-xl text-koma-foreground font-mono text-[10px] disabled:opacity-50"}
                  />
                </div>

                {fidelidadeConfig.tipo_recompensa === 'PONTOS' && (
                  <div className="space-y-1">
                    <label
                      className={"text-[9px] font-bold text-koma-secondary uppercase tracking-wider block"}
                    >
                      Valor de cada ponto
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={fidelidadeConfig.valor_ponto_em_dinheiro}
                      onChange={(e) =>
                        setFidelidadeConfig((prev) => ({ ...prev, valor_ponto_em_dinheiro: Number(e.target.value) }))
                      }
                      disabled={!fidelidadeConfig.ativo}
                      className={"w-full px-3 py-2 bg-koma-page border border-koma-border rounded-xl text-koma-foreground font-mono text-[10px] disabled:opacity-50"}
                    />
                  </div>
                )}

                <button
                  type="submit"
                  className="koma-btn-success flex min-h-10 w-full items-center justify-center rounded-xl text-[10px] font-bold"
                >
                  Salvar programa
                </button>
              </form>
            </div>

            <div
              className={"bg-koma-panel border border-koma-border rounded-2xl p-5 space-y-4 h-fit"}
            >
              <div className="border-b border-koma-border pb-3">
                <span className="block text-sm font-bold text-koma-foreground">Como funciona</span>
                <span className="mt-0.5 block text-[10px] text-koma-muted">
                  Uma visão simples da regra aplicada nas próximas vendas identificadas.
                </span>
              </div>
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
                <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                  Exemplo em uma compra de R$ 100
                </span>
                <strong className="mt-2 block font-mono text-xl text-koma-foreground">
                  {fidelidadeConfig.tipo_recompensa === 'PONTOS'
                    ? `${Math.max(0, fidelidadeConfig.taxa_conversao * 100).toFixed(0)} pontos`
                    : `R$ ${Math.max(0, fidelidadeConfig.taxa_conversao).toFixed(2)} de cashback`}
                </strong>
                <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
                  {fidelidadeConfig.tipo_recompensa === 'PONTOS'
                    ? `Cada ponto vale R$ ${Number(fidelidadeConfig.valor_ponto_em_dinheiro || 0).toFixed(2)} no resgate.`
                    : `O cliente recebe ${Number(fidelidadeConfig.taxa_conversao || 0).toFixed(2)}% do valor da compra.`}
                </p>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-koma-border bg-koma-raised px-3 py-2.5">
                <span className="text-[10px] text-koma-muted">Clientes participantes</span>
                <strong className="font-mono text-sm text-koma-foreground">{loyaltyUsers.length}</strong>
              </div>
              <button
                type="button"
                onClick={() => setActiveSubTab('clientes')}
                className="koma-btn-secondary inline-flex min-h-9 items-center justify-center px-3 text-[10px] font-bold"
              >
                Ver pontos dos clientes
              </button>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'clientes' && ['cupons', 'cupom', 'promocoes', 'descontos'].includes(activeSubTab) && (
        <div className="space-y-4">
          <CuponsTab
            apiBaseUrl={apiBaseUrl}
            authHeaders={authHeaders}
            onShowNotification={(msg, type) => showToast(msg, type === 'error' ? 'error' : 'success')}
          />
        </div>
      )}
      {activeTab === 'clientes' && ['clientes', 'crm', 'banco_clientes'].includes(activeSubTab) && (
        <div className={"space-y-3.5 text-left animate-fade-in"}>
          <OperationalBanner
            id="customers-heading"
            eyebrow="RELACIONAMENTO"
            title="Clientes"
            accent="em uma única lista"
            description="Encontre contatos rapidamente e acompanhe os benefícios sem repetir cadastros."
            metrics={[
              { label: loyaltyUsers.length === 1 ? 'total' : 'totais', value: loyaltyUsers.length },
              {
                label: 'ativos',
                value: relationshipSummary.ativos,
                valueClassName: 'text-emerald-600 dark:text-emerald-300',
              },
              {
                label: 'atenção',
                value: relationshipSummary.atencao,
                valueClassName: 'text-amber-600 dark:text-amber-300',
              },
              {
                label: 'reativar',
                value: relationshipSummary.reativar,
                valueClassName: 'text-rose-600 dark:text-rose-400',
              },
            ]}
          />

          <CustomerRelationshipPanel customers={loyaltyUsers} />

          <CustomerSatisfactionPanel
            resumo={satisfactionData.resumo}
            recentes={satisfactionData.recentes}
            isLoading={isSatisfactionLoading}
            onOpenRegisterModal={handleOpenSatisfactionModal}
          />

          <section className="koma-toolbar">
            <div className="koma-toolbar__search">
              <Search size={14} aria-hidden="true" />
              <input
                value={clientesSearch}
                onChange={(event) => setClientesSearch(event.target.value)}
                placeholder="Buscar por nome ou WhatsApp…"
                aria-label="Buscar clientes"
              />
              {clientesSearch && (
                <button type="button" onClick={() => setClientesSearch('')} aria-label="Limpar busca">
                  <X size={13} />
                </button>
              )}
            </div>
            {(clientesSearch || filteredLoyaltyUsers.length !== loyaltyUsers.length) && (
              <p className="shrink-0 text-[10px] font-medium text-koma-muted">
                <strong className="font-mono text-koma-foreground">{filteredLoyaltyUsers.length}</strong> de{' '}
                {loyaltyUsers.length} {loyaltyUsers.length === 1 ? 'cliente' : 'clientes'}
              </p>
            )}
            <div className="koma-toolbar__actions">
              <button
                type="button"
                onClick={() => {
                  setNewCrmNome('');
                  setNewCrmTelefone('');
                  setNewCrmSaldo(0);
                  setShowNewCrmModal(true);
                }}
                className="koma-btn-success"
              >
                <Plus size={14} /> Novo cliente
              </button>
            </div>
          </section>

          <div
            className={"bg-koma-panel border border-koma-border rounded-2xl p-3 space-y-4 shadow-xs"}
          >
            {filteredLoyaltyUsers.length > 0 ? (
              <div className={"overflow-x-auto border border-koma-border rounded-2xl"}>
                <table className={"w-full text-left text-xs"}>
                  <thead>
                    <tr
                      className={"bg-koma-raised border-b border-koma-border text-koma-muted uppercase tracking-wider font-extrabold text-[9px]"}
                    >
                      <th className="p-3.5">Cliente</th>
                      <th className="p-3.5">WhatsApp</th>
                      <th className="p-3.5">Última compra</th>
                      <th className="p-3.5">Pedidos</th>
                      <th className={"p-3.5 font-mono"}>Benefício atual</th>
                      <th className={"p-3.5 text-right"}>Ações</th>
                    </tr>
                  </thead>
                  <tbody className={"divide-y divide-koma-border"}>
                    {filteredLoyaltyUsers.map((user) => (
                      <tr key={user.id} className={"hover:bg-koma-raised/50 transition-colors"}>
                        <td className={"p-3.5 font-bold text-koma-foreground"}>{user.cliente}</td>
                        <td className={"p-3.5 font-mono text-koma-muted text-xs"}>
                          {formatarTelefoneTabela(user.telefone)}
                        </td>
                        <td className={"p-3.5 font-mono text-xs text-koma-muted"}>
                          {user.dias_sem_comprar === null || user.dias_sem_comprar === undefined
                            ? 'Nunca'
                            : user.dias_sem_comprar === 0
                            ? 'Hoje'
                            : user.dias_sem_comprar === 1
                            ? 'Ontem'
                            : `há ${user.dias_sem_comprar} dias`}
                        </td>
                        <td className={"p-3.5 font-mono text-xs text-koma-foreground"}>
                          {user.pedidos_concluidos ?? 0}
                        </td>
                        <td
                          className={"p-3.5 font-mono text-emerald-700 dark:text-emerald-400 font-extrabold text-xs"}
                        >
                          {fidelidadeConfig.tipo_recompensa === 'PONTOS'
                            ? `${user.pontos} pts`
                            : `R$ ${user.saldoCashback.toFixed(2)}`}
                        </td>
                        <td className={"p-3.5 text-right"}>
                          <button
                            onClick={() => {
                              setEditingCrmUser(user);
                              setCrmFormNome(user.cliente);
                              setCrmFormTelefone(aplicarMascaraTelefoneInput(user.telefone));
                              setCrmFormPontos(user.pontos || 0);
                              setCrmFormCashback(user.saldoCashback || 0);
                            }}
                            className={"px-3.5 py-1.5 koma-btn-secondary rounded-xl transition-all cursor-pointer font-bold text-xs"}
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <KomaEmptyState
                icon={<Users size={24} className="text-koma-muted" />}
                title={loyaltyUsers.length === 0 ? 'Nenhum cliente cadastrado ainda' : 'Nenhum cliente encontrado'}
                description={
                  loyaltyUsers.length === 0
                    ? 'Cadastre clientes ou aguarde os primeiros pedidos identificados no cardápio e balcão.'
                    : 'Ajuste ou limpe a busca para ver outros clientes.'
                }
                action={
                  loyaltyUsers.length === 0
                    ? {
                        label: 'Cadastrar primeiro cliente',
                        onClick: () => {
                          setNewCrmNome('');
                          setNewCrmTelefone('');
                          setNewCrmSaldo(0);
                          setShowNewCrmModal(true);
                        },
                      }
                    : { label: 'Limpar busca', onClick: () => setClientesSearch(''), variant: 'secondary' }
                }
                variant="panel"
              />
            )}
          </div>
        </div>
      )}
      {editingCrmUser && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingCrmUser(null);
          }}
          className={"fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"}
        >
          <div
            className={"w-full max-w-md bg-koma-card border border-koma-border rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8"}
          >
            <div className={"flex justify-between items-center pb-2 border-b border-koma-border"}>
              <h3 className={"font-serif text-sm font-bold text-koma-foreground"}>Editar Cliente CRM</h3>
              <button
                type="button"
                onClick={() => setEditingCrmUser(null)}
                className={"p-1 text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-transparent"}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!crmFormNome.trim() || !crmFormTelefone.trim()) {
                  alert('Preencha todos os campos!');
                  return;
                }
                const newSaldo = fidelidadeConfig.tipo_recompensa === 'PONTOS' ? crmFormPontos : crmFormCashback;
                const updated = await handleUpdateClient(editingCrmUser.id, crmFormNome, crmFormTelefone, newSaldo);
                if (updated) setEditingCrmUser(null);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Telefone / WhatsApp:
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  required
                  autoFocus
                  placeholder="(00) 00000-0000"
                  value={crmFormTelefone}
                  onChange={(e) => setCrmFormTelefone(aplicarMascaraTelefoneInput(e.target.value))}
                  className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                />
              </div>

              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Nome:
                </label>
                <input
                  type="text"
                  required
                  value={crmFormNome}
                  onChange={(e) => setCrmFormNome(e.target.value)}
                  className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                />
              </div>

              {/* EDITABLE FIELDS */}
              <div className={"grid grid-cols-2 gap-4"}>
                {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? (
                  <div className={"space-y-1 col-span-2"}>
                    <label
                      className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                    >
                      Saldo de Pontos (Ajuste):
                    </label>
                    <input
                      type="number"
                      required
                      value={crmFormPontos}
                      onChange={(e) => setCrmFormPontos(Number(e.target.value))}
                      className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono text-xs"}
                    />
                  </div>
                ) : (
                  <div className={"space-y-1 col-span-2"}>
                    <label
                      className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                    >
                      Saldo Cashback R$ (Ajuste):
                    </label>
                    <MoneyInput
                      required
                      value={crmFormCashback}
                      onValueChange={(value) => setCrmFormCashback(Number(value || 0))}
                      className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono text-xs"}
                    />
                  </div>
                )}
              </div>

              <div className={"flex gap-2 pt-2"}>
                <button
                  type="button"
                  onClick={() => setEditingCrmUser(null)}
                  className={"flex-1 py-2 bg-koma-card hover:bg-koma-raised border border-koma-border text-koma-foreground rounded-xl font-bold cursor-pointer transition-colors"}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={"flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl font-bold cursor-pointer transition-colors"}
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showNewCrmModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNewCrmModal(false);
          }}
          className={"fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"}
        >
          <div
            className={"w-full max-w-md bg-koma-card border border-koma-border rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8"}
          >
            <div className={"flex justify-between items-center pb-2 border-b border-koma-border"}>
              <h3 className={"font-serif text-sm font-bold text-koma-foreground"}>
                Cadastrar Novo Cliente
              </h3>
              <button
                type="button"
                onClick={() => setShowNewCrmModal(false)}
                className={"p-1 text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-transparent"}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newCrmNome.trim() || !newCrmTelefone.trim()) {
                  alert('Preencha todos os campos!');
                  return;
                }
                const created = await handleCreateClient(newCrmNome, newCrmTelefone, Number(newCrmSaldo || 0));
                if (created) setShowNewCrmModal(false);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Telefone / WhatsApp:
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  required
                  autoFocus
                  placeholder="(00) 00000-0000"
                  value={newCrmTelefone}
                  onChange={(e) => setNewCrmTelefone(aplicarMascaraTelefoneInput(e.target.value))}
                  className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                />
              </div>

              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  Nome:
                </label>
                <input
                  type="text"
                  required
                  value={newCrmNome}
                  onChange={(e) => setNewCrmNome(e.target.value)}
                  className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"}
                />
              </div>

              <div className="space-y-1">
                <label
                  className={"text-[10px] font-bold text-koma-subtle uppercase tracking-wider block"}
                >
                  {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? 'Pontos Iniciais:' : 'Cashback Inicial R$:'}
                </label>
                {fidelidadeConfig.tipo_recompensa === 'PONTOS' ? (
                  <input
                    type="number"
                    step="1"
                    value={newCrmSaldo}
                    onChange={(e) => setNewCrmSaldo(e.target.value === '' ? '' : Number(e.target.value))}
                    className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono text-xs"}
                  />
                ) : (
                  <MoneyInput
                    value={newCrmSaldo}
                    onValueChange={setNewCrmSaldo}
                    className={"w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono text-xs"}
                  />
                )}
              </div>

              <div className={"flex gap-2 pt-2"}>
                <button
                  type="button"
                  onClick={() => setShowNewCrmModal(false)}
                  className={"flex-1 py-2 border border-koma-border hover:border-koma-border bg-zinc-950 text-koma-subtle hover:text-koma-foreground rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={"flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"}
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSatisfactionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-2xl border border-koma-border bg-koma-panel p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-koma-border-subtle">
              <div>
                <p className="orders-eyebrow"><span /> SATISFAÇÃO</p>
                <h3 className="text-sm font-black text-koma-foreground">Registrar avaliação de cliente</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSatisfactionModal(false)}
                className="text-koma-muted hover:text-koma-foreground transition-colors p-1"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleRegisterSatisfaction} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                  Cliente cadastrado:
                </label>
                {loyaltyUsers.length === 0 ? (
                  <p className="text-xs text-amber-500 py-1">
                    Nenhum cliente cadastrado no restaurante.
                  </p>
                ) : (
                  <select
                    value={satisfactionClienteId}
                    onChange={(e) => setSatisfactionClienteId(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] text-xs"
                  >
                    <option value="" disabled>Selecione um cliente…</option>
                    {loyaltyUsers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome || c.cliente} {c.telefone ? `(${formatarTelefoneTabela(c.telefone)})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                  Nota (1 a 5 estrelas):
                </label>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSatisfactionNota(n)}
                      className={`flex-1 py-2 rounded-xl border text-xs font-bold transition-all flex flex-col items-center gap-1 cursor-pointer ${
                        satisfactionNota === n
                          ? n >= 4
                            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30'
                            : n === 3
                            ? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30'
                            : 'border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/30'
                          : 'border-koma-border bg-koma-canvas/50 text-koma-muted hover:border-koma-border/80'
                      }`}
                    >
                      <span className="text-sm font-black">{n}</span>
                      <span className="text-[9px] font-medium text-koma-subtle">
                        {n >= 4 ? 'Positiva' : n === 3 ? 'Neutra' : 'Insat.'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                  Comentário opcional (máx. 1000 caracteres):
                </label>
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={satisfactionComentario}
                  onChange={(e) => setSatisfactionComentario(e.target.value)}
                  placeholder="Ex.: Elogiou a velocidade da entrega e o atendimento…"
                  className="w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] text-xs resize-none"
                />
                <span className="text-[9px] text-koma-subtle block text-right font-mono">
                  {satisfactionComentario.length}/1000
                </span>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSatisfactionModal(false)}
                  className="flex-1 py-2 border border-koma-border bg-zinc-950 text-koma-subtle hover:text-koma-foreground rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingSatisfaction || loyaltyUsers.length === 0}
                  className="flex-1 py-2 bg-[#10b981] hover:bg-[#059669] disabled:opacity-50 text-[#121214] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  {isSubmittingSatisfaction ? 'Salvando…' : 'Salvar avaliação'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
