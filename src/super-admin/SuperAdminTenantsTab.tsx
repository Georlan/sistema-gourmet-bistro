import React, { useState } from "react";
import {
  Store,
  Search,
  Plus,
  ExternalLink,
  RefreshCw,
  Lock,
  Unlock,
  Trash2,
  CheckCircle2,
  XCircle,
  Eye,
  CreditCard,
  X,
} from "lucide-react";
import type { Tenant } from "./superAdminTypes";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";
import {
  SUBSCRIPTION_PLANS,
  formatPercentage,
} from "../config/subscriptionPlans";

interface SuperAdminTenantsTabProps {
  tenants: Tenant[];
  tenantsAvailable?: boolean;
  isLoading: boolean;
  refreshTenants: () => void;
  onToggleStatus: (id: string, currentStatus: "ACTIVE" | "SUSPENDED" | "PENDING") => Promise<boolean>;
  onAddLog: (
    text: string,
    level?: "INFO" | "WARNING" | "ERROR" | "CRITICAL" | "info" | "warning" | "error" | "critical" | "success",
    source?: string
  ) => void;
  onTriggerTelegramAlert: (text: string) => void;
  globalSearch: string;
}

export function SuperAdminTenantsTab({
  tenants,
  tenantsAvailable = false,
  isLoading,
  refreshTenants,
  onToggleStatus,
  onAddLog,
  onTriggerTelegramAlert,
  globalSearch,
}: SuperAdminTenantsTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [showNewTenantModal, setShowNewTenantModal] = useState(false);
  const [showFlushModal, setShowFlushModal] = useState(false);
  const [flushTarget, setFlushTarget] = useState<Tenant | null>(null);
  const [isFlushing, setIsFlushing] = useState(false);
  const [flushResult, setFlushResult] = useState<string | null>(null);

  const effectiveSearch = (globalSearch || searchTerm).toLowerCase().trim();

  const filteredTenants = tenants.filter(t => {
    const matchesSearch =
      !effectiveSearch ||
      t.name.toLowerCase().includes(effectiveSearch) ||
      t.id.toLowerCase().includes(effectiveSearch) ||
      (t.subdomain && t.subdomain.toLowerCase().includes(effectiveSearch)) ||
      (t.plan && t.plan.toLowerCase().includes(effectiveSearch));

    const matchesPlan = selectedPlan === "ALL" || t.plan?.toLowerCase() === selectedPlan.toLowerCase();
    const matchesStatus = selectedStatus === "ALL" || t.status === selectedStatus;

    return matchesSearch && matchesPlan && matchesStatus;
  });

  const handleFlushCache = async () => {
    if (!flushTarget) return;
    setIsFlushing(true);
    setFlushResult(null);
    try {
      await superAdminFetch(`/api/super-admin/restaurantes/${encodeURIComponent(flushTarget.id)}/flush-cache`, {
        method: "POST",
      });
      setFlushResult(`Cache Redis do restaurante ${flushTarget.name} limpo com sucesso.`);
      onAddLog(`Cache Redis do restaurante #${flushTarget.id} foi limpo.`, "INFO", "TENANTS");
      onTriggerTelegramAlert(`Cache Redis de ${flushTarget.name} foi limpo pelo SuperAdmin.`);
    } catch (err) {
      const msg = superAdminErrorMessage(err);
      setFlushResult(`Falha ao limpar cache: ${msg}`);
      onAddLog(`Falha ao limpar cache do restaurante #${flushTarget.id}: ${msg}`, "ERROR", "TENANTS");
    } finally {
      setIsFlushing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Action Bar */}
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-koma-foreground flex items-center gap-2">
              <Store className="w-5 h-5 text-[#00b894]" />
              Gestão de Restaurantes (Tenants)
            </h2>
            <p className="text-xs text-koma-muted mt-0.5">
              Administração da base de estabelecimentos, isolamento de dados e planos
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowNewTenantModal(true)}
              className="px-3.5 py-2 bg-[#00b894] hover:bg-[#00c996] text-black text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Novo Restaurante
            </button>

            <button
              type="button"
              onClick={refreshTenants}
              disabled={isLoading}
              className="p-2 bg-koma-page border border-zinc-800 hover:border-zinc-700 rounded-lg text-koma-secondary hover:text-koma-foreground transition-colors disabled:opacity-50 cursor-pointer"
              title="Atualizar lista"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-zinc-800/80">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-koma-subtle" />
            <input
              type="text"
              placeholder="Buscar por nome, ID, subdomínio ou plano..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              disabled={!tenantsAvailable}
              className="w-full bg-koma-page border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-koma-foreground placeholder:text-koma-subtle focus:outline-none focus:border-[#00b894] disabled:opacity-50"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={selectedPlan}
              onChange={e => setSelectedPlan(e.target.value)}
              disabled={!tenantsAvailable}
              className="bg-koma-page border border-zinc-800 rounded-lg px-3 py-2 text-xs text-koma-foreground focus:outline-none focus:border-[#00b894] disabled:opacity-50"
            >
              <option value="ALL">Todos os Planos</option>
              {SUBSCRIPTION_PLANS.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
              disabled={!tenantsAvailable}
              className="bg-koma-page border border-zinc-800 rounded-lg px-3 py-2 text-xs text-koma-foreground focus:outline-none focus:border-[#00b894] disabled:opacity-50"
            >
              <option value="ALL">Todos os Status</option>
              <option value="ACTIVE">Ativos</option>
              <option value="SUSPENDED">Suspensos</option>
              <option value="PENDING">Pendentes</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tenants Table */}
      <div className="bg-koma-card border border-[#1e293b] rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-koma-muted font-medium bg-koma-page/30">
                <th className="py-3 px-4">Estabelecimento</th>
                <th className="py-3 px-4">ID</th>
                <th className="py-3 px-4">Plano</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Pagamento Online</th>
                <th className="py-3 px-4">Volume (Mês)</th>
                <th className="py-3 px-4">Cadastro</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/40">
              {!tenantsAvailable ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-koma-muted space-y-2">
                    <Store className="w-8 h-8 text-zinc-600 mx-auto" />
                    <div className="font-semibold text-koma-foreground text-sm">
                      Dados dos restaurantes indisponíveis
                    </div>
                    <p className="text-xs text-koma-subtle max-w-md mx-auto">
                      A listagem cross-tenant ainda não possui fonte auditável no servidor (planejada para a Fase 2).
                    </p>
                  </td>
                </tr>
              ) : filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-koma-muted">
                    Nenhum restaurante localizado com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredTenants.map(tenant => {
                  const isSuspended = tenant.status === "SUSPENDED";

                  return (
                    <tr key={tenant.id} className="hover:bg-koma-page/40 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-koma-foreground flex items-center gap-1.5">
                          {tenant.name}
                          {tenant.subdomain && (
                            <a
                              href={`/c/${tenant.subdomain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-koma-subtle hover:text-[#00b894] transition-colors"
                              title={`Abrir cardápio digital /c/${tenant.subdomain}`}
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <div className="text-[11px] text-koma-muted font-mono">
                          /c/{tenant.subdomain || `tenant-${tenant.id}`}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="font-mono text-xs text-koma-secondary bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 font-bold">
                          #{tenant.id}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${
                          tenant.plan === "Premium"
                            ? "bg-purple-950/50 text-purple-300 border-purple-800/40"
                            : tenant.plan === "Pro" || tenant.plan === "Delivery" || tenant.plan === "Bistro"
                            ? "bg-blue-950/50 text-blue-300 border-blue-800/40"
                            : "bg-emerald-950/50 text-emerald-300 border-emerald-800/40"
                        }`}>
                          {tenant.plan || "Pocket"}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        {isSuspended ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-950/60 text-rose-300 border border-rose-800/40">
                            <XCircle className="w-3 h-3" /> Suspenso
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">
                            <CheckCircle2 className="w-3 h-3" /> Ativo
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        {tenant.onlinePaymentStatus ? (
                          <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border ${
                            tenant.onlinePaymentStatus === "connected"
                              ? "text-emerald-400 bg-emerald-950/40 border-emerald-800/30"
                              : tenant.onlinePaymentStatus === "disconnected"
                              ? "text-amber-400 bg-amber-950/40 border-amber-800/30"
                              : "text-koma-subtle bg-zinc-900 border-zinc-800"
                          }`}>
                            {tenant.onlinePaymentStatus === "connected"
                              ? "Mercado Pago Ativo"
                              : tenant.onlinePaymentStatus === "disconnected"
                              ? "Desconectado"
                              : "Pendente"}
                          </span>
                        ) : (
                          <span className="text-[11px] text-koma-subtle font-mono">
                            Não disponível
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-koma-foreground">
                          {tenant.monthlyOrders != null ? `${tenant.monthlyOrders} pedidos` : "—"}
                        </div>
                        <div className="text-[11px] text-koma-muted">
                          {tenant.monthlyBilling != null
                            ? `R$ ${tenant.monthlyBilling.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                            : "—"}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-koma-muted text-[11px]">
                        {tenant.createdAt || "Não disponível"}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedTenant(tenant)}
                            className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-koma-secondary hover:text-koma-foreground text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                            title="Ver detalhes"
                          >
                            <Eye className="w-3 h-3" /> Detalhes
                          </button>

                          <button
                            type="button"
                            onClick={() => onToggleStatus(tenant.id, tenant.status as "ACTIVE" | "SUSPENDED" | "PENDING")}
                            className={`p-1.5 rounded border transition-colors ${
                              isSuspended
                                ? "bg-emerald-950/40 text-emerald-400 border-emerald-800/40 hover:bg-emerald-900/50"
                                : "bg-zinc-900 text-koma-subtle border-zinc-800 hover:text-rose-400 hover:border-rose-900"
                            }`}
                            title={isSuspended ? "Reativar restaurante" : "Suspender restaurante"}
                          >
                            {isSuspended ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setFlushTarget(tenant);
                              setFlushResult(null);
                              setShowFlushModal(true);
                            }}
                            className="p-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-koma-subtle hover:text-amber-400 rounded transition-colors cursor-pointer"
                            title="Limpar cache Redis deste tenant"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tenant Details Modal */}
      {selectedTenant && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-koma-card border border-[#1e293b] rounded-xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Store className="w-5 h-5 text-[#00b894]" />
                <h3 className="text-base font-bold text-koma-foreground">{selectedTenant.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTenant(null)}
                className="text-koma-subtle hover:text-koma-foreground cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="bg-koma-page p-3 rounded-lg border border-zinc-800 space-y-1">
                <span className="text-koma-muted">ID do Tenant</span>
                <p className="font-mono font-bold text-koma-foreground text-sm">#{selectedTenant.id}</p>
              </div>

              <div className="bg-koma-page p-3 rounded-lg border border-zinc-800 space-y-1">
                <span className="text-koma-muted">Plano Contratado</span>
                <p className="font-bold text-[#00b894] text-sm">{selectedTenant.plan}</p>
              </div>

              <div className="bg-koma-page p-3 rounded-lg border border-zinc-800 space-y-1">
                <span className="text-koma-muted">Slug do Cardápio</span>
                <p className="font-mono text-koma-foreground">
                  {selectedTenant.subdomain ? `/c/${selectedTenant.subdomain}` : "Não configurado"}
                </p>
              </div>

              <div className="bg-koma-page p-3 rounded-lg border border-zinc-800 space-y-1">
                <span className="text-koma-muted">Status Operacional</span>
                <p className={`font-bold ${selectedTenant.status === "ACTIVE" ? "text-emerald-400" : "text-rose-400"}`}>
                  {selectedTenant.status === "ACTIVE" ? "Ativo" : "Suspenso"}
                </p>
              </div>
            </div>

            <div className="bg-koma-page p-4 rounded-lg border border-zinc-800 space-y-2 text-xs">
              <h4 className="font-bold text-koma-foreground flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-[#00b894]" /> Pagamentos & Split
              </h4>
              <p className="text-koma-muted">
                Taxa de split conforme plano {selectedTenant.plan}:{" "}
                <strong className="text-koma-secondary">
                  {(() => {
                    const planObj = SUBSCRIPTION_PLANS.find(
                      p => p.id === selectedTenant.plan?.toLowerCase()
                    );
                    return planObj ? formatPercentage(planObj.splitFeeRate) : "Não disponível";
                  })()}
                </strong>
              </p>
              <div className="flex items-center justify-between pt-1">
                <span className="text-koma-muted">Conta Mercado Pago:</span>
                <span className="font-semibold text-koma-secondary">
                  {selectedTenant.onlinePaymentStatus || "Não disponível"}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
              {selectedTenant.subdomain && (
                <a
                  href={`/c/${selectedTenant.subdomain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-koma-secondary hover:text-koma-foreground text-xs font-semibold rounded-lg transition-colors flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Abrir Cardápio
                </a>
              )}

              <button
                type="button"
                onClick={() => setSelectedTenant(null)}
                className="px-4 py-1.5 bg-[#00b894] hover:bg-[#00c996] text-black text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flush Cache Modal */}
      {showFlushModal && flushTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-koma-card border border-[#1e293b] rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-koma-foreground flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-amber-400" /> Limpeza de Cache Redis
              </h3>
              <button
                type="button"
                onClick={() => setShowFlushModal(false)}
                className="text-koma-subtle hover:text-koma-foreground cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-koma-secondary">
              Deseja invalidar todo o cache Redis do restaurante{" "}
              <strong className="text-koma-foreground">{flushTarget.name} (#{flushTarget.id})</strong>?
            </p>

            {flushResult && (
              <p className="text-xs p-2.5 rounded bg-zinc-900 border border-zinc-800 text-koma-secondary">
                {flushResult}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowFlushModal(false)}
                className="px-3 py-2 bg-zinc-900 border border-zinc-700 text-koma-secondary hover:text-koma-foreground rounded-lg text-xs font-semibold cursor-pointer"
              >
                Fechar
              </button>

              <button
                type="button"
                onClick={handleFlushCache}
                disabled={isFlushing}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isFlushing ? "Limpando..." : "Confirmar Limpeza"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Tenant Modal */}
      {showNewTenantModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-koma-card border border-[#1e293b] rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-koma-foreground flex items-center gap-2">
                <Plus className="w-5 h-5 text-[#00b894]" /> Novo Restaurante (Tenant)
              </h3>
              <button
                type="button"
                onClick={() => setShowNewTenantModal(false)}
                className="text-koma-subtle hover:text-koma-foreground cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-amber-950/30 border border-amber-800/40 rounded-lg text-xs space-y-1 text-amber-200">
              <strong className="block font-bold">Aviso de Provisionamento:</strong>
              <p>
                O provisionamento automático via endpoint `/api/super-admin/restaurantes/onboarding` está agendado para a Fase 2.
                Novos restaurantes atualmente são provisionados no banco de dados com isolamento transacional garantido.
              </p>
            </div>

            <div className="flex items-center justify-end pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowNewTenantModal(false)}
                className="px-4 py-1.5 bg-[#00b894] hover:bg-[#00c996] text-black text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SuperAdminTenantsTab;
