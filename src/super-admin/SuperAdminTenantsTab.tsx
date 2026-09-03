import React, { useState } from "react";
import {
  Store,
  Search,
  Plus,
  ExternalLink,
  RefreshCw,
  Eye,
  CreditCard,
  X,
  Lock,
  Unlock,
  Edit3,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { Tenant } from "./superAdminTypes";
import {
  SUBSCRIPTION_PLANS,
  formatCurrency,
  formatPercentage,
} from "../config/subscriptionPlans";
import { superAdminFetch, superAdminErrorMessage } from "./superAdminApi";

interface SuperAdminTenantsTabProps {
  tenants: Tenant[];
  tenantsAvailable?: boolean;
  isLoading: boolean;
  refreshTenants: () => void;
  globalSearch: string;
}

function officialPlan(planId?: string) {
  if (!planId) return undefined;
  return SUBSCRIPTION_PLANS.find(p => p.id === planId.toLowerCase());
}

function paymentStatusLabel(status?: string | null) {
  if (status === "connected") return "Mercado Pago conectado";
  if (status === "disconnected") return "Desconectado";
  if (status === "pending") return "Pendente";
  return "Não disponível";
}

function formatActivity(value?: string | null) {
  if (!value) return "Não disponível";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR");
}

export function SuperAdminTenantsTab({
  tenants,
  tenantsAvailable = false,
  isLoading,
  refreshTenants,
  globalSearch,
}: SuperAdminTenantsTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<string>("ALL");
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [showNewTenantModal, setShowNewTenantModal] = useState(false);

  // Edit Modal State
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editPlan, setEditPlan] = useState("pocket");
  const [editReason, setEditReason] = useState("");
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Status Modal State (Suspend / Reactivate)
  const [statusTargetTenant, setStatusTargetTenant] = useState<Tenant | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const effectiveSearch = (globalSearch || searchTerm).toLowerCase().trim();
  const filteredTenants = tenants.filter(t => {
    const matchesSearch =
      !effectiveSearch ||
      t.name.toLowerCase().includes(effectiveSearch) ||
      t.id.toLowerCase().includes(effectiveSearch) ||
      Boolean(t.subdomain?.toLowerCase().includes(effectiveSearch)) ||
      Boolean(t.plan?.toLowerCase().includes(effectiveSearch));
    const matchesPlan = selectedPlan === "ALL" || t.plan?.toLowerCase() === selectedPlan;
    return matchesSearch && matchesPlan;
  });

  const openEditModal = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setEditName(tenant.name || "");
    setEditSlug(tenant.subdomain || "");
    setEditPlan(tenant.plan?.toLowerCase() || "pocket");
    setEditReason("");
    setEditError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTenant) return;
    if (!editReason.trim() || editReason.trim().length < 3) {
      setEditError("O motivo da alteração é obrigatório (mínimo de 3 caracteres).");
      return;
    }

    setIsSubmittingEdit(true);
    setEditError(null);
    try {
      const payload = {
        name: editName.trim(),
        subdomain: editSlug.trim() || undefined,
        plan: editPlan.toLowerCase(),
        reason: editReason.trim(),
      };
      const res = await superAdminFetch(`/api/super-admin/restaurantes/${editingTenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setEditingTenant(null);
        refreshTenants();
      } else {
        const errorData = await res.json().catch(() => null);
        setEditError(errorData?.detail || "Falha ao salvar alterações.");
      }
    } catch (err) {
      setEditError(superAdminErrorMessage(err));
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const openStatusModal = (tenant: Tenant) => {
    setStatusTargetTenant(tenant);
    setStatusReason("");
    setStatusError(null);
  };

  const handleConfirmStatusChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusTargetTenant) return;
    if (!statusReason.trim() || statusReason.trim().length < 3) {
      setStatusError("O motivo da alteração de status é obrigatório (mínimo de 3 caracteres).");
      return;
    }

    const nextStatus = statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    setIsSubmittingStatus(true);
    setStatusError(null);
    try {
      const res = await superAdminFetch(`/api/super-admin/restaurantes/${statusTargetTenant.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          reason: statusReason.trim(),
        }),
      });
      if (res.ok) {
        setStatusTargetTenant(null);
        refreshTenants();
      } else {
        const errorData = await res.json().catch(() => null);
        setStatusError(errorData?.detail || "Falha ao alterar status do restaurante.");
      }
    } catch (err) {
      setStatusError(superAdminErrorMessage(err));
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-koma-foreground flex items-center gap-2">
              <Store className="w-5 h-5 text-[#00b894]" />
              Gestão de Restaurantes
            </h2>
            <p className="text-xs text-koma-muted mt-0.5">
              Administração multi-tenant com trilha de auditoria atômica e isolamento RLS
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowNewTenantModal(true)}
              className="px-3.5 py-2 bg-zinc-900 border border-zinc-700 text-koma-secondary text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer hover:text-koma-foreground"
              title="Novo restaurante"
            >
              <Plus className="w-4 h-4" /> Novo restaurante
            </button>
            <button
              type="button"
              onClick={refreshTenants}
              disabled={isLoading}
              className="p-2 bg-koma-page border border-zinc-800 hover:border-zinc-700 rounded-lg text-koma-secondary hover:text-koma-foreground disabled:opacity-50 cursor-pointer"
              title="Atualizar lista"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-zinc-800/80">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-koma-subtle" />
            <input
              type="text"
              placeholder="Buscar por nome, ID, slug ou plano..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              disabled={!tenantsAvailable}
              className="w-full bg-koma-page border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-koma-foreground placeholder:text-koma-subtle focus:outline-none focus:border-[#00b894] disabled:opacity-50"
            />
          </div>
          <select
            value={selectedPlan}
            onChange={e => setSelectedPlan(e.target.value)}
            disabled={!tenantsAvailable}
            className="bg-koma-page border border-zinc-800 rounded-lg px-3 py-2 text-xs text-koma-foreground focus:outline-none focus:border-[#00b894] disabled:opacity-50"
          >
            <option value="ALL">Todos os planos</option>
            {SUBSCRIPTION_PLANS.map(plan => (
              <option key={plan.id} value={plan.id}>{plan.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-koma-card border border-[#1e293b] rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-koma-muted font-medium bg-koma-page/30">
                <th className="py-3 px-4">Estabelecimento</th>
                <th className="py-3 px-4">Status SaaS</th>
                <th className="py-3 px-4">Plano</th>
                <th className="py-3 px-4">Pagamento online</th>
                <th className="py-3 px-4">Pedidos no mês</th>
                <th className="py-3 px-4">Recebimentos no mês</th>
                <th className="py-3 px-4">Última atividade</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/40">
              {!tenantsAvailable ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-koma-muted">
                    <Store className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                    <div className="font-semibold text-koma-foreground text-sm">Dados dos restaurantes indisponíveis</div>
                    <p className="text-xs text-koma-subtle mt-1">A API cross-tenant não retornou uma fonte utilizável.</p>
                  </td>
                </tr>
              ) : filteredTenants.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-koma-muted">Nenhum restaurante localizado.</td></tr>
              ) : filteredTenants.map(tenant => {
                const plan = officialPlan(tenant.plan);
                const isSuspended = tenant.status?.toUpperCase() === "SUSPENDED";
                return (
                  <tr key={tenant.id} className="hover:bg-koma-page/40 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-koma-foreground flex items-center gap-1.5">
                        {tenant.name}
                        {tenant.subdomain && (
                          <a href={`/c/${tenant.subdomain}`} target="_blank" rel="noopener noreferrer" className="text-koma-subtle hover:text-[#00b894]" title="Abrir cardápio digital">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <div className="text-[11px] text-koma-muted font-mono">#{tenant.id}{tenant.subdomain ? ` • /c/${tenant.subdomain}` : ""}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border ${
                        isSuspended
                          ? "bg-rose-950/60 text-rose-400 border-rose-800/40"
                          : "bg-emerald-950/60 text-emerald-400 border-emerald-800/30"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isSuspended ? "bg-rose-400" : "bg-emerald-400"}`}></span>
                        {isSuspended ? "Suspenso" : "Ativo"}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border border-zinc-700 bg-zinc-900 text-koma-secondary">
                        {plan?.name || tenant.plan || "Não disponível"}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={tenant.onlinePaymentStatus === "connected" ? "text-emerald-400" : tenant.onlinePaymentStatus === "disconnected" ? "text-amber-400" : "text-koma-muted"}>
                        {paymentStatusLabel(tenant.onlinePaymentStatus)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-koma-foreground">{tenant.monthlyOrders ?? "—"}</td>
                    <td className="py-3.5 px-4 text-koma-foreground">{tenant.monthlyBilling != null ? formatCurrency(tenant.monthlyBilling) : "—"}</td>
                    <td className="py-3.5 px-4 text-koma-muted">{formatActivity(tenant.lastActivity)}</td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedTenant(tenant)}
                          className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-koma-secondary hover:text-koma-foreground flex items-center gap-1 cursor-pointer"
                          title="Ver detalhes"
                        >
                          <Eye className="w-3 h-3" /> Detalhes
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(tenant)}
                          className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-koma-secondary hover:text-koma-foreground flex items-center gap-1 cursor-pointer"
                          title="Editar restaurante e plano"
                        >
                          <Edit3 className="w-3 h-3" /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => openStatusModal(tenant)}
                          className={`p-1.5 border rounded cursor-pointer transition-colors ${
                            isSuspended
                              ? "bg-emerald-950/40 hover:bg-emerald-900/60 border-emerald-800/50 text-emerald-400"
                              : "bg-rose-950/40 hover:bg-rose-900/60 border-rose-800/50 text-rose-400"
                          }`}
                          title={isSuspended ? "Reativar restaurante" : "Suspender restaurante"}
                        >
                          {isSuspended ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Details Modal */}
      {selectedTenant && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-koma-card border border-[#1e293b] rounded-xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Store className="w-5 h-5 text-[#00b894]" />
                <h3 className="text-base font-bold text-koma-foreground">{selectedTenant.name}</h3>
              </div>
              <button type="button" onClick={() => setSelectedTenant(null)} className="text-koma-subtle hover:text-koma-foreground cursor-pointer"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="bg-koma-page p-3 rounded-lg border border-zinc-800"><span className="text-koma-muted">Tenant</span><p className="font-mono font-bold text-koma-foreground mt-1">#{selectedTenant.id}</p></div>
              <div className="bg-koma-page p-3 rounded-lg border border-zinc-800"><span className="text-koma-muted">Status</span><p className="font-bold text-koma-foreground mt-1">{selectedTenant.status?.toUpperCase() === "SUSPENDED" ? "Suspenso" : "Ativo"}</p></div>
              <div className="bg-koma-page p-3 rounded-lg border border-zinc-800"><span className="text-koma-muted">Plano</span><p className="font-bold text-koma-foreground mt-1">{officialPlan(selectedTenant.plan)?.name || selectedTenant.plan}</p></div>
              <div className="bg-koma-page p-3 rounded-lg border border-zinc-800"><span className="text-koma-muted">Pagamento online</span><p className="font-semibold text-koma-foreground mt-1">{paymentStatusLabel(selectedTenant.onlinePaymentStatus)}</p></div>
            </div>

            <div className="bg-koma-page p-4 rounded-lg border border-zinc-800 space-y-2 text-xs">
              <h4 className="font-bold text-koma-foreground flex items-center gap-1.5"><CreditCard className="w-4 h-4 text-[#00b894]" /> Comercial Oficial</h4>
              <p className="text-koma-muted">Mensalidade: <strong className="text-koma-secondary">{officialPlan(selectedTenant.plan) ? formatCurrency(officialPlan(selectedTenant.plan)!.price) : "Não disponível"}</strong></p>
              <p className="text-koma-muted">Taxa Split Pix: <strong className="text-koma-secondary">{officialPlan(selectedTenant.plan) ? formatPercentage(officialPlan(selectedTenant.plan)!.splitFeeRate) : "Não disponível"}</strong></p>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              {selectedTenant.subdomain && <a href={`/c/${selectedTenant.subdomain}`} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 bg-zinc-900 border border-zinc-700 text-koma-secondary rounded-lg text-xs flex items-center gap-1 cursor-pointer"><ExternalLink className="w-3.5 h-3.5" /> Abrir cardápio</a>}
              <button type="button" onClick={() => setSelectedTenant(null)} className="px-4 py-1.5 bg-[#00b894] text-black text-xs font-bold rounded-lg cursor-pointer">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Tenant Modal */}
      {editingTenant && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-koma-card border border-[#1e293b] rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-[#00b894]" />
                <h3 className="text-base font-bold text-koma-foreground">Editar Estabelecimento #{editingTenant.id}</h3>
              </div>
              <button type="button" onClick={() => setEditingTenant(null)} className="text-koma-subtle hover:text-koma-foreground cursor-pointer"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              <div>
                <label className="block text-koma-secondary font-medium mb-1">Nome do Estabelecimento</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  required
                  className="w-full bg-koma-page border border-zinc-800 rounded-lg p-2.5 text-xs text-koma-foreground focus:outline-none focus:border-[#00b894]"
                />
              </div>

              <div>
                <label className="block text-koma-secondary font-medium mb-1">Subdomínio / Slug (ex: bistrô)</label>
                <input
                  type="text"
                  value={editSlug}
                  onChange={e => setEditSlug(e.target.value)}
                  placeholder="slug-do-restaurante"
                  className="w-full bg-koma-page border border-zinc-800 rounded-lg p-2.5 text-xs text-koma-foreground font-mono focus:outline-none focus:border-[#00b894]"
                />
              </div>

              <div>
                <label className="block text-koma-secondary font-medium mb-1">Plano Comercial</label>
                <select
                  value={editPlan}
                  onChange={e => setEditPlan(e.target.value)}
                  className="w-full bg-koma-page border border-zinc-800 rounded-lg p-2.5 text-xs text-koma-foreground focus:outline-none focus:border-[#00b894]"
                >
                  {SUBSCRIPTION_PLANS.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatCurrency(p.price)}/mês ({formatPercentage(p.splitFeeRate)} split)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-koma-secondary font-medium mb-1">
                  Motivo da Alteração <span className="text-rose-400">*</span>
                </label>
                <textarea
                  rows={2}
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                  required
                  placeholder="Ex: Cliente solicitou upgrade para o plano Premium."
                  className="w-full bg-koma-page border border-zinc-800 rounded-lg p-2.5 text-xs text-koma-foreground placeholder:text-koma-subtle focus:outline-none focus:border-[#00b894]"
                />
                <p className="text-[10px] text-koma-subtle mt-0.5">Obrigatório para a trilha de auditoria administrativa persistente.</p>
              </div>

              {editError && (
                <div className="p-2.5 bg-rose-950/40 border border-rose-800/50 rounded-lg text-rose-300 text-xs">
                  {editError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setEditingTenant(null)}
                  disabled={isSubmittingEdit}
                  className="px-3 py-2 bg-zinc-900 border border-zinc-700 text-koma-secondary hover:text-koma-foreground rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-4 py-2 bg-[#00b894] hover:bg-[#00c996] text-black font-bold rounded-lg text-xs transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingEdit ? "Salvando..." : "Salvar Alterações"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Suspend / Reactivate Confirmation Modal */}
      {statusTargetTenant && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-koma-card border border-[#1e293b] rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <AlertTriangle className={`w-5 h-5 ${statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? "text-emerald-400" : "text-rose-400"}`} />
                <h3 className="text-base font-bold text-koma-foreground">
                  {statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? "Reativar Estabelecimento" : "Suspender Estabelecimento"}
                </h3>
              </div>
              <button type="button" onClick={() => setStatusTargetTenant(null)} className="text-koma-subtle hover:text-koma-foreground cursor-pointer"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleConfirmStatusChange} className="space-y-4 text-xs">
              <div className={`p-3 rounded-lg border text-xs ${
                statusTargetTenant.status?.toUpperCase() === "SUSPENDED"
                  ? "bg-emerald-950/30 border-emerald-800/40 text-emerald-200"
                  : "bg-rose-950/40 border-rose-800/50 text-rose-200"
              }`}>
                {statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? (
                  <p>
                    O restaurante <strong>{statusTargetTenant.name}</strong> terá o acesso da equipe e a criação de novos pedidos públicos restabelecidos imediatamente.
                  </p>
                ) : (
                  <p>
                    A suspensão de <strong>{statusTargetTenant.name}</strong> bloqueará o acesso de funcionários do tenant ao Caixa/Garçom e rejeitará novos pedidos no Cardápio Digital. Reconciliações de pagamentos anteriores permanecerão ativas.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-koma-secondary font-medium mb-1">
                  Motivo da {statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? "Reativação" : "Suspensão"} <span className="text-rose-400">*</span>
                </label>
                <textarea
                  rows={3}
                  value={statusReason}
                  onChange={e => setStatusReason(e.target.value)}
                  required
                  placeholder={statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? "Ex: Pagamento da fatura confirmado." : "Ex: Inadimplência da assinatura SaaS."}
                  className="w-full bg-koma-page border border-zinc-800 rounded-lg p-2.5 text-xs text-koma-foreground placeholder:text-koma-subtle focus:outline-none focus:border-[#00b894]"
                />
                <p className="text-[10px] text-koma-subtle mt-0.5">Obrigatório para registro em trilha de auditoria imutável.</p>
              </div>

              {statusError && (
                <div className="p-2.5 bg-rose-950/40 border border-rose-800/50 rounded-lg text-rose-300 text-xs">
                  {statusError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setStatusTargetTenant(null)}
                  disabled={isSubmittingStatus}
                  className="px-3 py-2 bg-zinc-900 border border-zinc-700 text-koma-secondary hover:text-koma-foreground rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingStatus}
                  className={`px-4 py-2 font-bold rounded-lg text-xs transition-colors disabled:opacity-50 cursor-pointer ${
                    statusTargetTenant.status?.toUpperCase() === "SUSPENDED"
                      ? "bg-emerald-500 hover:bg-emerald-600 text-black"
                      : "bg-rose-600 hover:bg-rose-700 text-white"
                  }`}
                >
                  {isSubmittingStatus ? "Processando..." : statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? "Confirmar Reativação" : "Confirmar Suspensão"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Tenant Modal Placeholder */}
      {showNewTenantModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-koma-card border border-[#1e293b] rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-koma-foreground flex items-center gap-2"><Plus className="w-5 h-5 text-[#00b894]" /> Novo restaurante</h3>
              <button type="button" onClick={() => setShowNewTenantModal(false)} className="text-koma-subtle hover:text-koma-foreground cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-3 bg-amber-950/30 border border-amber-800/40 rounded-lg text-xs text-amber-200">
              O provisionamento automático ainda não está ativo. A próxima etapa vai criar restaurante, administrador inicial e configurações em transação atômica.
            </div>
            <div className="flex justify-end"><button type="button" onClick={() => setShowNewTenantModal(false)} className="px-4 py-1.5 bg-[#00b894] text-black text-xs font-bold rounded-lg cursor-pointer">Entendido</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SuperAdminTenantsTab;
