import React, { useState } from "react";
import {
  Store,
  AlertCircle,
  ShoppingBag,
  TrendingUp,
  CreditCard,
  Search,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
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
  onForceConfirmWebhook: (id: string) => Promise<boolean>;
  globalSearch: string;
  runtimeHealth?: { status: "ok" | "unavailable"; commit?: string | null; version?: string } | null;
}

export function SuperAdminOverviewTab({
  tenants,
  tenantsAvailable = false,
  isLoadingTenants,
  refreshTenants,
  onNavigateToTab,
  onSelectTenantDetails,
  onToggleStatus,
  failedWebhooks,
  onForceConfirmWebhook,
  globalSearch,
  runtimeHealth,
}: SuperAdminOverviewTabProps) {
  const [tableSearch, setTableSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "SUSPENDED">("ALL");

  const effectiveSearch = (globalSearch || tableSearch).toLowerCase().trim();

  const filteredTenants = tenants.filter(t => {
    const matchesSearch =
      !effectiveSearch ||
      t.name.toLowerCase().includes(effectiveSearch) ||
      t.id.toLowerCase().includes(effectiveSearch) ||
      (t.subdomain && t.subdomain.toLowerCase().includes(effectiveSearch)) ||
      (t.plan && t.plan.toLowerCase().includes(effectiveSearch));

    const matchesStatus =
      statusFilter === "ALL" || t.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const activeCount = tenantsAvailable ? tenants.filter(t => t.status === "ACTIVE").length : null;
  const suspendedCount = tenantsAvailable ? tenants.filter(t => t.status === "SUSPENDED").length : null;

  const estimatedMRR = tenantsAvailable
    ? tenants
        .filter(t => t.status === "ACTIVE")
        .reduce((sum, t) => {
          const matchedPlan = SUBSCRIPTION_PLANS.find(
            p => p.id === t.plan?.toLowerCase()
          );
          return sum + (matchedPlan?.price || 0);
        }, 0)
    : null;

  const unresolvedWebhooks = failedWebhooks.filter(w => !w.resolved);

  return (
    <div className="space-y-6">
      {/* 5 KPI Cards Grid */}
      <section aria-label="Indicadores operacionais" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* KPI 1: Restaurantes Ativos */}
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Restaurantes ativos</span>
            <div className="p-2 rounded-lg bg-emerald-950/60 text-[#00b894] border border-emerald-800/30">
              <Store className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-koma-foreground tracking-tight">
              {activeCount !== null ? activeCount : "—"}{" "}
              <span className="text-xs font-normal text-koma-muted">
                {tenantsAvailable ? `/ ${tenants.length}` : ""}
              </span>
            </div>
            <p className="text-[11px] text-koma-subtle mt-1 flex items-center gap-1">
              {tenantsAvailable ? (
                suspendedCount && suspendedCount > 0 ? (
                  <span className="text-amber-400 font-medium">{suspendedCount} suspenso(s)</span>
                ) : (
                  <span className="text-emerald-400 font-medium">100% da base ativa</span>
                )
              ) : (
                <span className="text-zinc-400">Dados ainda não disponíveis</span>
              )}
            </p>
          </div>
        </div>

        {/* KPI 2: Inadimplentes */}
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Inadimplentes</span>
            <div className="p-2 rounded-lg bg-zinc-900 text-koma-subtle border border-zinc-800">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-koma-foreground tracking-tight">
              —
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              Aguardando consolidação
            </p>
          </div>
        </div>

        {/* KPI 3: Pedidos Online Hoje */}
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Pedidos online hoje</span>
            <div className="p-2 rounded-lg bg-blue-950/50 text-blue-400 border border-blue-800/30">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-koma-foreground tracking-tight">
              —
            </div>
            <p className="text-[11px] text-koma-subtle mt-1">
              Via cardápio digital KÔMA
            </p>
          </div>
        </div>

        {/* KPI 4: MRR Estimado */}
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">MRR estimado</span>
            <div className="p-2 rounded-lg bg-emerald-950/60 text-[#00b894] border border-emerald-800/30">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-koma-foreground tracking-tight">
              {estimatedMRR !== null ? formatCurrency(estimatedMRR) : "—"}
            </div>
            <p className="text-[11px] text-koma-subtle mt-1">
              {tenantsAvailable ? "Recorrência base confirmada" : "Dados ainda não disponíveis"}
            </p>
          </div>
        </div>

        {/* KPI 5: Falhas Críticas de Pagamento */}
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Falhas críticas pagamento</span>
            <div className={`p-2 rounded-lg border ${
              unresolvedWebhooks.length > 0
                ? "bg-rose-950/60 text-rose-400 border-rose-800/40"
                : "bg-emerald-950/60 text-[#00b894] border-emerald-800/30"
            }`}>
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className={`text-2xl font-bold tracking-tight ${
              unresolvedWebhooks.length > 0 ? "text-rose-400" : "text-koma-foreground"
            }`}>
              {unresolvedWebhooks.length}
            </div>
            <p className="text-[11px] text-koma-subtle mt-1">
              {unresolvedWebhooks.length > 0 ? "Exige ação operacional" : "Nenhum incidente crítico"}
            </p>
          </div>
        </div>
      </section>

      {/* Main Grid: Restaurants Table + Operational Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Table (2 cols) */}
        <div className="lg:col-span-2 bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#1e293b]/60">
            <div>
              <h2 className="text-base font-bold text-koma-foreground flex items-center gap-2">
                <Store className="w-4 h-4 text-[#00b894]" />
                Restaurantes Cadastrados
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-800 text-koma-secondary">
                  {filteredTenants.length}
                </span>
              </h2>
              <p className="text-xs text-koma-muted mt-0.5">Visão unificada dos estabelecimentos da plataforma</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-koma-subtle" />
                <input
                  type="text"
                  placeholder="Filtrar nesta lista..."
                  value={tableSearch}
                  onChange={e => setTableSearch(e.target.value)}
                  disabled={!tenantsAvailable}
                  className="w-44 sm:w-56 bg-koma-page border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-koma-foreground placeholder:text-koma-subtle focus:outline-none focus:border-[#00b894] disabled:opacity-50"
                />
              </div>

              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as "ALL" | "ACTIVE" | "SUSPENDED")}
                disabled={!tenantsAvailable}
                className="bg-koma-page border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-koma-foreground focus:outline-none focus:border-[#00b894] disabled:opacity-50"
              >
                <option value="ALL">Todos</option>
                <option value="ACTIVE">Ativos</option>
                <option value="SUSPENDED">Suspensos</option>
              </select>

              <button
                type="button"
                onClick={refreshTenants}
                disabled={isLoadingTenants}
                className="p-1.5 bg-koma-page border border-zinc-800 hover:border-zinc-700 rounded-lg text-koma-secondary hover:text-koma-foreground transition-colors disabled:opacity-50 cursor-pointer"
                title="Atualizar lista"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTenants ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800/80 text-koma-muted font-medium">
                  <th className="py-2.5 px-3">Restaurante</th>
                  <th className="py-2.5 px-3">ID</th>
                  <th className="py-2.5 px-3">Plano</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Pagamento Online</th>
                  <th className="py-2.5 px-3">Última Atividade</th>
                  <th className="py-2.5 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {!tenantsAvailable ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-koma-muted space-y-2">
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
                    <td colSpan={7} className="py-8 text-center text-koma-muted">
                      Nenhum restaurante encontrado com os filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  filteredTenants.map(tenant => {
                    const isSuspended = tenant.status === "SUSPENDED";

                    return (
                      <tr key={tenant.id} className="hover:bg-koma-page/50 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-semibold text-koma-foreground flex items-center gap-1.5">
                            {tenant.name}
                            {tenant.subdomain && (
                              <a
                                href={`/c/${tenant.subdomain}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-koma-subtle hover:text-[#00b894] transition-colors"
                                title={`Abrir cardápio /c/${tenant.subdomain}`}
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          <div className="text-[11px] text-koma-muted font-mono">
                            /c/{tenant.subdomain || `tenant-${tenant.id}`}
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <span className="font-mono text-xs text-koma-secondary bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                            #{tenant.id}
                          </span>
                        </td>

                        <td className="py-3 px-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${
                            tenant.plan === "Premium"
                              ? "bg-purple-950/50 text-purple-300 border-purple-800/40"
                              : tenant.plan === "Pro" || tenant.plan === "Delivery"
                              ? "bg-blue-950/50 text-blue-300 border-blue-800/40"
                              : "bg-emerald-950/50 text-emerald-300 border-emerald-800/40"
                          }`}>
                            {tenant.plan || "Pocket"}
                          </span>
                        </td>

                        <td className="py-3 px-3">
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

                        <td className="py-3 px-3">
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

                        <td className="py-3 px-3 text-koma-muted text-[11px]">
                          {tenant.lastActivity || "Não disponível"}
                        </td>

                        <td className="py-3 px-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onSelectTenantDetails ? onSelectTenantDetails(tenant) : onNavigateToTab("tenants")}
                              className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-koma-secondary hover:text-koma-foreground text-xs font-medium transition-colors cursor-pointer"
                              title="Gerenciar restaurante"
                            >
                              Gerenciar
                            </button>

                            <button
                              type="button"
                              onClick={() => onToggleStatus(tenant.id, tenant.status as "ACTIVE" | "SUSPENDED" | "PENDING")}
                              className={`p-1 rounded border transition-colors ${
                                isSuspended
                                  ? "bg-emerald-950/40 text-emerald-400 border-emerald-800/40 hover:bg-emerald-900/50"
                                  : "bg-zinc-900 text-koma-subtle border-zinc-800 hover:text-rose-400 hover:border-rose-900"
                              }`}
                              title={isSuspended ? "Reativar restaurante" : "Suspender restaurante"}
                            >
                              {isSuspended ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
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

          <div className="pt-2 flex items-center justify-between text-xs text-koma-muted">
            <span>
              {tenantsAvailable ? `Exibindo ${filteredTenants.length} de ${tenants.length} restaurantes` : "Base de dados isolada"}
            </span>
            <button
              type="button"
              onClick={() => onNavigateToTab("tenants")}
              className="font-medium text-[#00b894] hover:underline flex items-center gap-1 cursor-pointer"
            >
              Ver gestão completa de restaurantes <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Operational Alerts & System Health (1 col) */}
        <div className="space-y-4">
          {/* Alerts Section */}
          <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#1e293b]/60">
              <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Alertas Operacionais
              </h3>
              <span className="text-[11px] text-koma-muted">Tempo real</span>
            </div>

            {unresolvedWebhooks.length > 0 ? (
              <div className="space-y-2">
                {unresolvedWebhooks.map(wh => (
                  <div key={wh.id} className="p-3 bg-rose-950/30 border border-rose-800/40 rounded-lg text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-rose-300">Falha em Webhook</span>
                      <span className="text-[10px] text-koma-muted font-mono">{wh.createdAt}</span>
                    </div>
                    <p className="text-koma-secondary text-[11px]">
                      {wh.tenantName} — Pedido #{wh.orderId} (R$ {wh.amount.toFixed(2)})
                    </p>
                    <p className="text-rose-400 text-[10px] font-mono">{wh.errorReason}</p>
                    <button
                      type="button"
                      onClick={() => onForceConfirmWebhook(wh.id)}
                      className="w-full mt-1 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-[11px] transition-colors cursor-pointer"
                    >
                      Reconciliar e Confirmar
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-4 text-center space-y-1.5">
                <ShieldCheck className="w-8 h-8 text-[#00b894] mx-auto opacity-80" />
                <p className="text-xs font-semibold text-koma-foreground">Nenhum incidente crítico ativo</p>
                <p className="text-[11px] text-koma-muted">
                  Webhooks de pagamento, split e liquidação financeira estão operando normalmente.
                </p>
              </div>
            )}
          </div>

          {/* Quick Platform Status */}
          <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2 pb-2 border-b border-[#1e293b]/60">
              <ShieldCheck className="w-4 h-4 text-[#00b894]" />
              Status dos Serviços Centrais
            </h3>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-koma-secondary">Backend API (FastAPI)</span>
                <span className={`inline-flex items-center gap-1 font-medium ${
                  runtimeHealth?.status === "ok" ? "text-emerald-400" : "text-amber-400"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${runtimeHealth?.status === "ok" ? "bg-emerald-400" : "bg-amber-400"}`}></span>
                  {runtimeHealth?.status === "ok" ? "Online / Saudável" : "Desconhecido"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-koma-secondary">Mercado Pago Split</span>
                <span className="text-koma-muted font-mono">
                  {SUBSCRIPTION_PLANS.map(p => formatPercentage(p.splitFeeRate)).join(" / ")}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-koma-secondary">Postgres & Infraestrutura</span>
                <span className="text-koma-muted text-[11px]">
                  Ver Central de Operações
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-800/60">
              <button
                type="button"
                onClick={() => onNavigateToTab("operations")}
                className="w-full py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-lg text-xs font-semibold text-koma-secondary hover:text-koma-foreground transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                Abrir Central de Operações <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SuperAdminOverviewTab;
