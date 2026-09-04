import React, { useState } from "react";
import {
  AlertTriangle,
  CreditCard,
  Edit3,
  ExternalLink,
  Eye,
  Headphones,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Store,
  Unlock,
  X,
} from "lucide-react";
import {
  SUBSCRIPTION_PLANS,
  formatCurrency,
  formatPercentage,
} from "../config/subscriptionPlans";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";
import { SuperAdminNewTenantModal } from "./SuperAdminNewTenantModal";
import { SuperAdminSupportModal } from "./SuperAdminSupportModal";
import type { Tenant } from "./superAdminTypes";

interface SuperAdminTenantsTabProps {
  tenants: Tenant[];
  tenantsAvailable?: boolean;
  isLoading: boolean;
  refreshTenants: () => void;
  globalSearch: string;
}

function officialPlan(planId?: string) {
  if (!planId) return undefined;
  return SUBSCRIPTION_PLANS.find(plan => plan.id === planId.toLowerCase());
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
  const [selectedPlan, setSelectedPlan] = useState("ALL");
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [supportTenant, setSupportTenant] = useState<Tenant | null>(null);
  const [showNewTenantModal, setShowNewTenantModal] = useState(false);

  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editPlan, setEditPlan] = useState("pocket");
  const [editReason, setEditReason] = useState("");
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [statusTargetTenant, setStatusTargetTenant] = useState<Tenant | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const effectiveSearch = (globalSearch || searchTerm).toLowerCase().trim();
  const filteredTenants = tenants.filter(tenant => {
    const matchesSearch =
      !effectiveSearch
      || tenant.name.toLowerCase().includes(effectiveSearch)
      || tenant.id.toLowerCase().includes(effectiveSearch)
      || Boolean(tenant.subdomain?.toLowerCase().includes(effectiveSearch))
      || Boolean(tenant.plan?.toLowerCase().includes(effectiveSearch));
    const matchesPlan = selectedPlan === "ALL" || tenant.plan?.toLowerCase() === selectedPlan;
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

  const handleSaveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingTenant) return;
    if (editReason.trim().length < 3) {
      setEditError("O motivo da alteração é obrigatório (mínimo de 3 caracteres).");
      return;
    }

    setIsSubmittingEdit(true);
    setEditError(null);
    try {
      const response = await superAdminFetch(`/api/super-admin/restaurantes/${editingTenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          subdomain: editSlug.trim() || undefined,
          plan: editPlan.toLowerCase(),
          reason: editReason.trim(),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || "Falha ao salvar alterações.");
      }
      setEditingTenant(null);
      refreshTenants();
    } catch (error) {
      setEditError(superAdminErrorMessage(error));
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const openStatusModal = (tenant: Tenant) => {
    setStatusTargetTenant(tenant);
    setStatusReason("");
    setStatusError(null);
  };

  const handleConfirmStatusChange = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!statusTargetTenant) return;
    if (statusReason.trim().length < 3) {
      setStatusError("O motivo da alteração de status é obrigatório (mínimo de 3 caracteres).");
      return;
    }

    const nextStatus = statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    setIsSubmittingStatus(true);
    setStatusError(null);
    try {
      const response = await superAdminFetch(`/api/super-admin/restaurantes/${statusTargetTenant.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, reason: statusReason.trim() }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || "Falha ao alterar status do restaurante.");
      }
      setStatusTargetTenant(null);
      refreshTenants();
    } catch (error) {
      setStatusError(superAdminErrorMessage(error));
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-xl border border-[#1e293b] bg-koma-card p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-koma-foreground">
              <Store className="h-5 w-5 text-[#00b894]" /> Gestão de Restaurantes
            </h2>
            <p className="mt-0.5 text-xs text-koma-muted">Administração multi-tenant com trilha de auditoria atômica e isolamento RLS</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowNewTenantModal(true)} className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-bold text-koma-secondary hover:text-koma-foreground" title="Novo restaurante">
              <Plus className="h-4 w-4" /> Novo restaurante
            </button>
            <button type="button" onClick={refreshTenants} disabled={isLoading} className="rounded-lg border border-zinc-800 bg-koma-page p-2 text-koma-secondary hover:border-zinc-700 hover:text-koma-foreground disabled:opacity-50" title="Atualizar lista">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t border-zinc-800/80 pt-3 sm:flex-row">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-koma-subtle" />
            <input type="text" placeholder="Buscar por nome, ID, slug ou plano..." value={searchTerm} onChange={event => setSearchTerm(event.target.value)} disabled={!tenantsAvailable} className="w-full rounded-lg border border-zinc-800 bg-koma-page py-2 pl-9 pr-3 text-xs text-koma-foreground placeholder:text-koma-subtle focus:border-[#00b894] focus:outline-none disabled:opacity-50" />
          </div>
          <select value={selectedPlan} onChange={event => setSelectedPlan(event.target.value)} disabled={!tenantsAvailable} className="rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-xs text-koma-foreground focus:border-[#00b894] focus:outline-none disabled:opacity-50">
            <option value="ALL">Todos os planos</option>
            {SUBSCRIPTION_PLANS.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#1e293b] bg-koma-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-koma-page/30 font-medium text-koma-muted">
                <th className="px-4 py-3">Estabelecimento</th><th className="px-4 py-3">Status SaaS</th><th className="px-4 py-3">Plano</th><th className="px-4 py-3">Pagamento online</th><th className="px-4 py-3">Pedidos no mês</th><th className="px-4 py-3">Recebimentos no mês</th><th className="px-4 py-3">Última atividade</th><th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/40">
              {!tenantsAvailable ? (
                <tr><td colSpan={8} className="py-12 text-center text-koma-muted"><Store className="mx-auto mb-2 h-8 w-8 text-zinc-600" /><div className="text-sm font-semibold text-koma-foreground">Dados dos restaurantes indisponíveis</div><p className="mt-1 text-xs text-koma-subtle">A API cross-tenant não retornou uma fonte utilizável.</p></td></tr>
              ) : filteredTenants.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-koma-muted">Nenhum restaurante localizado.</td></tr>
              ) : filteredTenants.map(tenant => {
                const plan = officialPlan(tenant.plan);
                const isSuspended = tenant.status?.toUpperCase() === "SUSPENDED";
                return (
                  <tr key={tenant.id} className="transition-colors hover:bg-koma-page/40">
                    <td className="px-4 py-3.5"><div className="flex items-center gap-1.5 font-semibold text-koma-foreground">{tenant.name}{tenant.subdomain && <a href={`/c/${tenant.subdomain}`} target="_blank" rel="noopener noreferrer" className="text-koma-subtle hover:text-[#00b894]" title="Abrir cardápio digital"><ExternalLink className="h-3 w-3" /></a>}</div><div className="font-mono text-[11px] text-koma-muted">#{tenant.id}{tenant.subdomain ? ` • /c/${tenant.subdomain}` : ""}</div></td>
                    <td className="px-4 py-3.5"><span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-bold ${isSuspended ? "border-rose-800/40 bg-rose-950/60 text-rose-400" : "border-emerald-800/30 bg-emerald-950/60 text-emerald-400"}`}><span className={`h-1.5 w-1.5 rounded-full ${isSuspended ? "bg-rose-400" : "bg-emerald-400"}`} />{isSuspended ? "Suspenso" : "Ativo"}</span></td>
                    <td className="px-4 py-3.5"><span className="inline-flex rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] font-semibold text-koma-secondary">{plan?.name || tenant.plan || "Não disponível"}</span></td>
                    <td className="px-4 py-3.5"><span className={tenant.onlinePaymentStatus === "connected" ? "text-emerald-400" : tenant.onlinePaymentStatus === "disconnected" ? "text-amber-400" : "text-koma-muted"}>{paymentStatusLabel(tenant.onlinePaymentStatus)}</span></td>
                    <td className="px-4 py-3.5 text-koma-foreground">{tenant.monthlyOrders ?? "—"}</td>
                    <td className="px-4 py-3.5 text-koma-foreground">{tenant.monthlyBilling != null ? formatCurrency(tenant.monthlyBilling) : "—"}</td>
                    <td className="px-4 py-3.5 text-koma-muted">{formatActivity(tenant.lastActivity)}</td>
                    <td className="px-4 py-3.5 text-right"><div className="inline-flex items-center gap-1.5">
                      <button type="button" onClick={() => setSupportTenant(tenant)} className="flex items-center gap-1 rounded border border-amber-800/60 bg-amber-950/40 px-2 py-1 text-amber-300 hover:bg-amber-900/60 hover:text-amber-100" title="Acessar estabelecimento em Modo Suporte auditado"><Headphones className="h-3 w-3" /> Suporte</button>
                      <button type="button" onClick={() => setSelectedTenant(tenant)} className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-koma-secondary hover:bg-zinc-800 hover:text-koma-foreground" title="Ver detalhes"><Eye className="h-3 w-3" /> Detalhes</button>
                      <button type="button" onClick={() => openEditModal(tenant)} className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-koma-secondary hover:bg-zinc-800 hover:text-koma-foreground" title="Editar restaurante e plano"><Edit3 className="h-3 w-3" /> Editar</button>
                      <button type="button" onClick={() => openStatusModal(tenant)} className={`rounded border p-1.5 ${isSuspended ? "border-emerald-800/50 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-900/60" : "border-rose-800/50 bg-rose-950/40 text-rose-400 hover:bg-rose-900/60"}`} title={isSuspended ? "Reativar restaurante" : "Suspender restaurante"}>{isSuspended ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}</button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg space-y-5 rounded-xl border border-[#1e293b] bg-koma-card p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3"><div className="flex items-center gap-2"><Store className="h-5 w-5 text-[#00b894]" /><h3 className="text-base font-bold text-koma-foreground">{selectedTenant.name}</h3></div><button type="button" onClick={() => setSelectedTenant(null)} className="text-koma-subtle hover:text-koma-foreground"><X className="h-5 w-5" /></button></div>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-koma-muted">Tenant</span><p className="mt-1 font-mono font-bold text-koma-foreground">#{selectedTenant.id}</p></div>
              <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-koma-muted">Status</span><p className="mt-1 font-bold text-koma-foreground">{selectedTenant.status?.toUpperCase() === "SUSPENDED" ? "Suspenso" : "Ativo"}</p></div>
              <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-koma-muted">Plano</span><p className="mt-1 font-bold text-koma-foreground">{officialPlan(selectedTenant.plan)?.name || selectedTenant.plan}</p></div>
              <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-koma-muted">Pagamento online</span><p className="mt-1 font-semibold text-koma-foreground">{paymentStatusLabel(selectedTenant.onlinePaymentStatus)}</p></div>
            </div>
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-koma-page p-4 text-xs"><h4 className="flex items-center gap-1.5 font-bold text-koma-foreground"><CreditCard className="h-4 w-4 text-[#00b894]" /> Comercial Oficial</h4><p className="text-koma-muted">Mensalidade: <strong className="text-koma-secondary">{officialPlan(selectedTenant.plan) ? formatCurrency(officialPlan(selectedTenant.plan)!.price) : "Não disponível"}</strong></p><p className="text-koma-muted">Taxa Split Pix: <strong className="text-koma-secondary">{officialPlan(selectedTenant.plan) ? formatPercentage(officialPlan(selectedTenant.plan)!.splitFeeRate) : "Não disponível"}</strong></p></div>
            <div className="flex justify-end gap-2 border-t border-zinc-800 pt-3">
              <button type="button" onClick={() => { const t = selectedTenant; setSelectedTenant(null); setSupportTenant(t); }} className="flex items-center gap-1.5 rounded-lg border border-amber-600/60 bg-amber-950/60 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-900/80"><Headphones className="h-3.5 w-3.5" /> Entrar em Modo Suporte</button>
              {selectedTenant.subdomain && <a href={`/c/${selectedTenant.subdomain}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-koma-secondary"><ExternalLink className="h-3.5 w-3.5" /> Abrir cardápio</a>}
              <button type="button" onClick={() => setSelectedTenant(null)} className="rounded-lg bg-[#00b894] px-4 py-1.5 text-xs font-bold text-black">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {editingTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg space-y-4 rounded-xl border border-[#1e293b] bg-koma-card p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3"><div className="flex items-center gap-2"><Edit3 className="h-5 w-5 text-[#00b894]" /><h3 className="text-base font-bold text-koma-foreground">Editar Estabelecimento #{editingTenant.id}</h3></div><button type="button" onClick={() => setEditingTenant(null)} className="text-koma-subtle hover:text-koma-foreground"><X className="h-5 w-5" /></button></div>
            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              <label className="block"><span className="mb-1 block font-medium text-koma-secondary">Nome do Estabelecimento</span><input type="text" value={editName} onChange={event => setEditName(event.target.value)} required className="w-full rounded-lg border border-zinc-800 bg-koma-page p-2.5 text-koma-foreground focus:border-[#00b894] focus:outline-none" /></label>
              <label className="block"><span className="mb-1 block font-medium text-koma-secondary">Subdomínio / Slug</span><input type="text" value={editSlug} onChange={event => setEditSlug(event.target.value)} placeholder="slug-do-restaurante" className="w-full rounded-lg border border-zinc-800 bg-koma-page p-2.5 font-mono text-koma-foreground focus:border-[#00b894] focus:outline-none" /></label>
              <label className="block"><span className="mb-1 block font-medium text-koma-secondary">Plano Comercial</span><select value={editPlan} onChange={event => setEditPlan(event.target.value)} className="w-full rounded-lg border border-zinc-800 bg-koma-page p-2.5 text-koma-foreground focus:border-[#00b894] focus:outline-none">{SUBSCRIPTION_PLANS.map(plan => <option key={plan.id} value={plan.id}>{plan.name} — {formatCurrency(plan.price)}/mês ({formatPercentage(plan.splitFeeRate)} split)</option>)}</select></label>
              <label className="block"><span className="mb-1 block font-medium text-koma-secondary">Motivo da Alteração <span className="text-rose-400">*</span></span><textarea rows={2} value={editReason} onChange={event => setEditReason(event.target.value)} required placeholder="Ex: Cliente solicitou upgrade para o plano Premium." className="w-full rounded-lg border border-zinc-800 bg-koma-page p-2.5 text-koma-foreground placeholder:text-koma-subtle focus:border-[#00b894] focus:outline-none" /><span className="mt-0.5 block text-[10px] text-koma-subtle">Obrigatório para a trilha de auditoria administrativa persistente.</span></label>
              {editError && <div className="rounded-lg border border-rose-800/50 bg-rose-950/40 p-2.5 text-xs text-rose-300">{editError}</div>}
              <div className="flex justify-end gap-2 border-t border-zinc-800 pt-3"><button type="button" onClick={() => setEditingTenant(null)} disabled={isSubmittingEdit} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-koma-secondary disabled:opacity-50">Cancelar</button><button type="submit" disabled={isSubmittingEdit} className="rounded-lg bg-[#00b894] px-4 py-2 text-xs font-bold text-black disabled:opacity-50">{isSubmittingEdit ? "Salvando..." : "Salvar Alterações"}</button></div>
            </form>
          </div>
        </div>
      )}

      {statusTargetTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-[#1e293b] bg-koma-card p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3"><div className="flex items-center gap-2"><AlertTriangle className={`h-5 w-5 ${statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? "text-emerald-400" : "text-rose-400"}`} /><h3 className="text-base font-bold text-koma-foreground">{statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? "Reativar Estabelecimento" : "Suspender Estabelecimento"}</h3></div><button type="button" onClick={() => setStatusTargetTenant(null)} className="text-koma-subtle hover:text-koma-foreground"><X className="h-5 w-5" /></button></div>
            <form onSubmit={handleConfirmStatusChange} className="space-y-4 text-xs">
              <div className={`rounded-lg border p-3 ${statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? "border-emerald-800/40 bg-emerald-950/30 text-emerald-200" : "border-rose-800/50 bg-rose-950/40 text-rose-200"}`}>{statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? <p>O restaurante <strong>{statusTargetTenant.name}</strong> terá o acesso da equipe e a criação de novos pedidos públicos restabelecidos imediatamente.</p> : <p>A suspensão de <strong>{statusTargetTenant.name}</strong> bloqueará o acesso de funcionários do tenant ao Caixa/Garçom e rejeitará novos pedidos no Cardápio Digital. Reconciliações de pagamentos anteriores permanecerão ativas.</p>}</div>
              <label className="block"><span className="mb-1 block font-medium text-koma-secondary">Motivo da {statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? "Reativação" : "Suspensão"} <span className="text-rose-400">*</span></span><textarea rows={3} value={statusReason} onChange={event => setStatusReason(event.target.value)} required placeholder={statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? "Ex: Pagamento da fatura confirmado." : "Ex: Inadimplência da assinatura SaaS."} className="w-full rounded-lg border border-zinc-800 bg-koma-page p-2.5 text-koma-foreground placeholder:text-koma-subtle focus:border-[#00b894] focus:outline-none" /><span className="mt-0.5 block text-[10px] text-koma-subtle">Obrigatório para registro em trilha de auditoria imutável.</span></label>
              {statusError && <div className="rounded-lg border border-rose-800/50 bg-rose-950/40 p-2.5 text-xs text-rose-300">{statusError}</div>}
              <div className="flex justify-end gap-2 border-t border-zinc-800 pt-3"><button type="button" onClick={() => setStatusTargetTenant(null)} disabled={isSubmittingStatus} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-koma-secondary disabled:opacity-50">Cancelar</button><button type="submit" disabled={isSubmittingStatus} className={`rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-50 ${statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? "bg-emerald-500 text-black" : "bg-rose-600 text-white"}`}>{isSubmittingStatus ? "Processando..." : statusTargetTenant.status?.toUpperCase() === "SUSPENDED" ? "Confirmar Reativação" : "Confirmar Suspensão"}</button></div>
            </form>
          </div>
        </div>
      )}

      {showNewTenantModal && (
        <SuperAdminNewTenantModal
          onClose={() => setShowNewTenantModal(false)}
          onCreated={refreshTenants}
        />
      )}

      {supportTenant && (
        <SuperAdminSupportModal
          tenant={supportTenant}
          onClose={() => setSupportTenant(null)}
          onSessionStarted={() => setSupportTenant(null)}
        />
      )}
    </div>
  );
}

export default SuperAdminTenantsTab;
