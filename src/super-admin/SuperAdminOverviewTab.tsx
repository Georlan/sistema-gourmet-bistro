import React, { useState } from "react";
import {
  Store,
  AlertCircle,
  ShoppingBag,
  TrendingUp,
  CreditCard,
  Search,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  CheckCircle2,
  HelpCircle,
} from "lucide-react";
import type { Tenant, FailedWebhook } from "./superAdminTypes";
import {
  SUBSCRIPTION_PLANS,
  formatCurrency,
  formatPercentage,
} from "../config/subscriptionPlans";

interface SuperAdminOverviewTabProps {
  tenants: Tenant[];
  tenantsAvailable?: boolean;
  isLoadingTenants: boolean;
  refreshTenants: () => void;
  onNavigateToTab: (tab: "tenants" | "payments" | "billing" | "operations" | "audit" | "settings") => void;
  onSelectTenantDetails?: (tenant: Tenant) => void;
  onToggleStatus: (id: string, currentStatus: "ACTIVE" | "SUSPENDED" | "PENDING") => Promise<boolean>;
  failedWebhooks: FailedWebhook[];
  globalSearch: string;
  runtimeHealth?: { status: "ok" | "unavailable"; commit?: string | null; version?: string } | null;
}

function planLabel(planId?: string) {
  if (!planId) return "Não disponível";
  return SUBSCRIPTION_PLANS.find(p => p.id === planId.toLowerCase())?.name || planId;
}

function formatActivity(value?: string | null) {
  if (!value) return "Não disponível";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR");
}

export function SuperAdminOverviewTab({
  tenants,
  tenantsAvailable = false,
  isLoadingTenants,
  refreshTenants,
  onNavigateToTab,
  onSelectTenantDetails,
  failedWebhooks,
  globalSearch,
  runtimeHealth,
}: SuperAdminOverviewTabProps) {
  const [tableSearch, setTableSearch] = useState("");
  const effectiveSearch = (globalSearch || tableSearch).toLowerCase().trim();

  const filteredTenants = tenants.filter(t =>
    !effectiveSearch ||
    t.name.toLowerCase().includes(effectiveSearch) ||
    t.id.toLowerCase().includes(effectiveSearch) ||
    Boolean(t.subdomain?.toLowerCase().includes(effectiveSearch)) ||
    Boolean(t.plan?.toLowerCase().includes(effectiveSearch))
  );

  const activeCount = tenantsAvailable ? tenants.filter(t => t.status === "ACTIVE").length : null;
  const estimatedMRR = tenantsAvailable
    ? tenants
        .filter(t => t.status === "ACTIVE")
        .reduce((sum, tenant) => {
          const plan = SUBSCRIPTION_PLANS.find(p => p.id === tenant.plan?.toLowerCase());
          return sum + (plan?.price || 0);
        }, 0)
    : null;

  const monthlyOrders = tenantsAvailable && tenants.every(t => t.monthlyOrders != null)
    ? tenants.reduce((sum, tenant) => sum + Number(tenant.monthlyOrders || 0), 0)
    : null;

  // A fonte agregada de incidentes de pagamento ainda será criada na Fase 3.
  // Um array vazio local não é evidência de ausência de incidentes.
  const paymentIncidentFeedAvailable = failedWebhooks.length > 0;
  const unresolvedPaymentIncidents = failedWebhooks.filter(w => !w.resolved).length;

  return (
    <div className="space-y-6">
      <section aria-label="Indicadores operacionais" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Restaurantes registrados</span>
            <Store className="w-4 h-4 text-[#00b894]" />
          </div>
          <div className="mt-3 text-2xl font-bold text-koma-foreground">
            {activeCount !== null ? activeCount : "—"}
          </div>
          <p className="text-[11px] text-koma-subtle mt-1">
            {tenantsAvailable ? `${tenants.length} tenant(s) na fonte cross-tenant` : "Fonte indisponível"}
          </p>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Inadimplentes</span>
            <AlertCircle className="w-4 h-4 text-koma-subtle" />
          </div>
          <div className="mt-3 text-2xl font-bold text-koma-foreground">—</div>
          <p className="text-[11px] text-koma-subtle mt-1">Cobrança recorrente ainda não consolidada</p>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Pedidos no mês</span>
            <ShoppingBag className="w-4 h-4 text-blue-400" />
          </div>
          <div className="mt-3 text-2xl font-bold text-koma-foreground">
            {monthlyOrders !== null ? monthlyOrders : "—"}
          </div>
          <p className="text-[11px] text-koma-subtle mt-1">
            {monthlyOrders !== null ? "Consolidado dos tenants retornados" : "Dados ainda não disponíveis"}
          </p>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">MRR base</span>
            <TrendingUp className="w-4 h-4 text-[#00b894]" />
          </div>
          <div className="mt-3 text-2xl font-bold text-koma-foreground">
            {estimatedMRR !== null ? formatCurrency(estimatedMRR) : "—"}
          </div>
          <p className="text-[11px] text-koma-subtle mt-1">Planos ativos × catálogo oficial</p>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Incidentes de pagamento</span>
            <CreditCard className="w-4 h-4 text-koma-subtle" />
          </div>
          <div className="mt-3 text-2xl font-bold text-koma-foreground">
            {paymentIncidentFeedAvailable ? unresolvedPaymentIncidents : "—"}
          </div>
          <p className="text-[11px] text-koma-subtle mt-1">
            {paymentIncidentFeedAvailable ? "Fonte de eventos carregada" : "Feed agregado entra na Fase 3"}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#1e293b]/60">
            <div>
              <h2 className="text-base font-bold text-koma-foreground flex items-center gap-2">
                <Store className="w-4 h-4 text-[#00b894]" />
                Restaurantes
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-800 text-koma-secondary">
                  {tenantsAvailable ? filteredTenants.length : "—"}
                </span>
              </h2>
              <p className="text-xs text-koma-muted mt-0.5">Leitura cross-tenant com isolamento RLS por restaurante</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-koma-subtle" />
                <input
                  type="text"
                  placeholder="Filtrar restaurantes..."
                  value={tableSearch}
                  onChange={e => setTableSearch(e.target.value)}
                  disabled={!tenantsAvailable}
                  className="w-44 sm:w-56 bg-koma-page border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-koma-foreground placeholder:text-koma-subtle focus:outline-none focus:border-[#00b894] disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                onClick={refreshTenants}
                disabled={isLoadingTenants}
                className="p-1.5 bg-koma-page border border-zinc-800 hover:border-zinc-700 rounded-lg text-koma-secondary hover:text-koma-foreground disabled:opacity-50"
                title="Atualizar lista"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTenants ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800/80 text-koma-muted font-medium">
                  <th className="py-2.5 px-3">Restaurante</th>
                  <th className="py-2.5 px-3">Plano</th>
                  <th className="py-2.5 px-3">Pagamento online</th>
                  <th className="py-2.5 px-3">Última atividade</th>
                  <th className="py-2.5 px-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {!tenantsAvailable ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-koma-muted">
                      <Store className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                      <div className="font-semibold text-koma-foreground text-sm">Dados dos restaurantes indisponíveis</div>
                      <p className="text-xs text-koma-subtle mt-1">A API cross-tenant não respondeu com uma fonte utilizável.</p>
                    </td>
                  </tr>
                ) : filteredTenants.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-koma-muted">Nenhum restaurante encontrado.</td></tr>
                ) : filteredTenants.map(tenant => (
                  <tr key={tenant.id} className="hover:bg-koma-page/50 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-semibold text-koma-foreground flex items-center gap-1.5">
                        {tenant.name}
                        {tenant.subdomain && (
                          <a href={`/c/${tenant.subdomain}`} target="_blank" rel="noopener noreferrer" className="text-koma-subtle hover:text-[#00b894]">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <div className="text-[11px] text-koma-muted font-mono">#{tenant.id} {tenant.subdomain ? `• /c/${tenant.subdomain}` : ""}</div>
                    </td>
                    <td className="py-3 px-3 text-koma-secondary">{planLabel(tenant.plan)}</td>
                    <td className="py-3 px-3">
                      {tenant.onlinePaymentStatus === "connected" ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-3 h-3" /> Conectado</span>
                      ) : tenant.onlinePaymentStatus === "disconnected" ? (
                        <span className="text-amber-400">Desconectado</span>
                      ) : (
                        <span className="text-koma-muted">Não disponível</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-koma-muted">{formatActivity(tenant.lastActivity)}</td>
                    <td className="py-3 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => onSelectTenantDetails ? onSelectTenantDetails(tenant) : onNavigateToTab("tenants")}
                        className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-koma-secondary hover:text-koma-foreground"
                      >
                        Gerenciar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pt-2 flex items-center justify-between text-xs text-koma-muted">
            <span>{tenantsAvailable ? `${tenants.length} tenant(s) carregado(s)` : "Fonte indisponível"}</span>
            <button type="button" onClick={() => onNavigateToTab("tenants")} className="font-medium text-[#00b894] hover:underline flex items-center gap-1">
              Gestão completa <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2 pb-2 border-b border-[#1e293b]/60">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Central de Incidentes
            </h3>
            <div className="py-4 text-center space-y-1.5">
              <HelpCircle className="w-7 h-7 text-zinc-500 mx-auto" />
              <p className="text-xs font-semibold text-koma-foreground">Feed operacional ainda não consolidado</p>
              <p className="text-[11px] text-koma-muted">Impressão, Print Agent, outbox, pedidos e pagamentos serão agregados na Fase 4.</p>
            </div>
          </div>

          <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-koma-foreground pb-2 border-b border-[#1e293b]/60">Serviços centrais</h3>
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-koma-secondary">Backend API</span>
                <span className={runtimeHealth?.status === "ok" ? "text-emerald-400" : "text-koma-muted"}>
                  {runtimeHealth?.status === "ok" ? "Saudável" : "Não verificado"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-koma-secondary">Split comercial</span>
                <span className="text-koma-muted font-mono">{SUBSCRIPTION_PLANS.map(p => formatPercentage(p.splitFeeRate)).join(" / ")}</span>
              </div>
            </div>
            <button type="button" onClick={() => onNavigateToTab("operations")} className="w-full py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-lg text-xs font-semibold text-koma-secondary flex items-center justify-center gap-1">
              Abrir Central de Operações <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SuperAdminOverviewTab;
