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
  Wrench,
} from "lucide-react";
import type { Tenant } from "./superAdminTypes";
import {
  SUBSCRIPTION_PLANS,
  formatCurrency,
  formatPercentage,
} from "../config/subscriptionPlans";

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

  return (
    <div className="space-y-6">
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-koma-foreground flex items-center gap-2">
              <Store className="w-5 h-5 text-[#00b894]" />
              Restaurantes
            </h2>
            <p className="text-xs text-koma-muted mt-0.5">
              Leitura operacional cross-tenant; mutações administrativas entram na Fase 2B
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowNewTenantModal(true)}
              className="px-3.5 py-2 bg-zinc-900 border border-zinc-700 text-koma-secondary text-xs font-bold rounded-lg flex items-center gap-1.5"
              title="Provisionamento automático ainda não implementado"
            >
              <Plus className="w-4 h-4" /> Novo restaurante
            </button>
            <button
              type="button"
              onClick={refreshTenants}
              disabled={isLoading}
              className="p-2 bg-koma-page border border-zinc-800 hover:border-zinc-700 rounded-lg text-koma-secondary hover:text-koma-foreground disabled:opacity-50"
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
                  <td colSpan={7} className="py-12 text-center text-koma-muted">
                    <Store className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                    <div className="font-semibold text-koma-foreground text-sm">Dados dos restaurantes indisponíveis</div>
                    <p className="text-xs text-koma-subtle mt-1">A API cross-tenant não retornou uma fonte utilizável.</p>
                  </td>
                </tr>
              ) : filteredTenants.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-koma-muted">Nenhum restaurante localizado.</td></tr>
              ) : filteredTenants.map(tenant => {
                const plan = officialPlan(tenant.plan);
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
                          className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-koma-secondary hover:text-koma-foreground flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" /> Detalhes
                        </button>
                        <button type="button" disabled className="p-1.5 bg-zinc-900 border border-zinc-800 text-zinc-600 rounded cursor-not-allowed" title="Suspender/reativar: Fase 2B">
                          <Lock className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" disabled className="p-1.5 bg-zinc-900 border border-zinc-800 text-zinc-600 rounded cursor-not-allowed" title="Manutenção por tenant: Fase 2B">
                          <Wrench className="w-3.5 h-3.5" />
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

      {selectedTenant && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-koma-card border border-[#1e293b] rounded-xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Store className="w-5 h-5 text-[#00b894]" />
                <h3 className="text-base font-bold text-koma-foreground">{selectedTenant.name}</h3>
              </div>
              <button type="button" onClick={() => setSelectedTenant(null)} className="text-koma-subtle hover:text-koma-foreground"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="bg-koma-page p-3 rounded-lg border border-zinc-800"><span className="text-koma-muted">Tenant</span><p className="font-mono font-bold text-koma-foreground mt-1">#{selectedTenant.id}</p></div>
              <div className="bg-koma-page p-3 rounded-lg border border-zinc-800"><span className="text-koma-muted">Plano</span><p className="font-bold text-koma-foreground mt-1">{officialPlan(selectedTenant.plan)?.name || selectedTenant.plan}</p></div>
              <div className="bg-koma-page p-3 rounded-lg border border-zinc-800"><span className="text-koma-muted">Pagamento online</span><p className="font-semibold text-koma-foreground mt-1">{paymentStatusLabel(selectedTenant.onlinePaymentStatus)}</p></div>
              <div className="bg-koma-page p-3 rounded-lg border border-zinc-800"><span className="text-koma-muted">Última atividade</span><p className="font-semibold text-koma-foreground mt-1">{formatActivity(selectedTenant.lastActivity)}</p></div>
            </div>

            <div className="bg-koma-page p-4 rounded-lg border border-zinc-800 space-y-2 text-xs">
              <h4 className="font-bold text-koma-foreground flex items-center gap-1.5"><CreditCard className="w-4 h-4 text-[#00b894]" /> Comercial</h4>
              <p className="text-koma-muted">Mensalidade: <strong className="text-koma-secondary">{officialPlan(selectedTenant.plan) ? formatCurrency(officialPlan(selectedTenant.plan)!.price) : "Não disponível"}</strong></p>
              <p className="text-koma-muted">Split: <strong className="text-koma-secondary">{officialPlan(selectedTenant.plan) ? formatPercentage(officialPlan(selectedTenant.plan)!.splitFeeRate) : "Não disponível"}</strong></p>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              {selectedTenant.subdomain && <a href={`/c/${selectedTenant.subdomain}`} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 bg-zinc-900 border border-zinc-700 text-koma-secondary rounded-lg text-xs flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> Abrir cardápio</a>}
              <button type="button" onClick={() => setSelectedTenant(null)} className="px-4 py-1.5 bg-[#00b894] text-black text-xs font-bold rounded-lg">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {showNewTenantModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-koma-card border border-[#1e293b] rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-koma-foreground flex items-center gap-2"><Plus className="w-5 h-5 text-[#00b894]" /> Novo restaurante</h3>
              <button type="button" onClick={() => setShowNewTenantModal(false)} className="text-koma-subtle hover:text-koma-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-3 bg-amber-950/30 border border-amber-800/40 rounded-lg text-xs text-amber-200">
              O provisionamento automático ainda não está ativo. A Fase 2C vai criar restaurante, administrador, configurações padrão e auditoria em uma única transação.
            </div>
            <div className="flex justify-end"><button type="button" onClick={() => setShowNewTenantModal(false)} className="px-4 py-1.5 bg-[#00b894] text-black text-xs font-bold rounded-lg">Entendido</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SuperAdminTenantsTab;
