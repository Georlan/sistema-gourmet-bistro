import React from "react";
import {
  ReceiptText,
  TrendingUp,
  Percent,
  CheckCircle2,
  Tag,
} from "lucide-react";
import type { Tenant } from "./superAdminTypes";
import {
  SUBSCRIPTION_PLANS,
  ANNUAL_DISCOUNT_RATE,
  formatCurrency,
  formatPercentage,
  getSubscriptionPricing,
} from "../config/subscriptionPlans";

interface SuperAdminBillingTabProps {
  tenants: Tenant[];
  tenantsAvailable?: boolean;
}

export function SuperAdminBillingTab({
  tenants,
  tenantsAvailable = false,
}: SuperAdminBillingTabProps) {
  const activeTenants = tenantsAvailable ? tenants.filter(t => t.status === "ACTIVE") : [];

  const totalMRR = tenantsAvailable
    ? activeTenants.reduce((acc, t) => {
        const matchedPlan = SUBSCRIPTION_PLANS.find(
          p => p.id === t.plan?.toLowerCase()
        );
        return acc + (matchedPlan?.price || 0);
      }, 0)
    : null;

  return (
    <div className="space-y-6">
      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">MRR Assinaturas Fixas</span>
            <div className="p-2 rounded-lg bg-emerald-950/60 text-[#00b894] border border-emerald-800/30">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-koma-foreground tracking-tight">
            {totalMRR !== null ? formatCurrency(totalMRR) : "—"}
          </div>
          <p className="text-[11px] text-koma-subtle">
            {tenantsAvailable
              ? `Recorrência base gerada por ${activeTenants.length} restaurante(s) ativo(s)`
              : "Dados ainda não disponíveis (aguardando endpoint da Fase 2)"}
          </p>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Receita Variável Split (Mês)</span>
            <div className="p-2 rounded-lg bg-purple-950/60 text-purple-300 border border-purple-800/30">
              <Percent className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-koma-foreground tracking-tight">
            —
          </div>
          <p className="text-[11px] text-koma-subtle">
            Dados ainda não disponíveis (aguardando consolidação da Fase 2)
          </p>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Faturamento Total Estimado</span>
            <div className="p-2 rounded-lg bg-blue-950/60 text-blue-300 border border-blue-800/30">
              <ReceiptText className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-400 tracking-tight">
            {totalMRR !== null ? formatCurrency(totalMRR) : "—"}
          </div>
          <p className="text-[11px] text-koma-subtle">
            {tenantsAvailable
              ? "Baseado exclusivamente nos planos ativos confirmados"
              : "Dados ainda não disponíveis"}
          </p>
        </div>
      </div>

      {/* Commercial Plans Matrix */}
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-koma-foreground flex items-center gap-2">
              <ReceiptText className="w-5 h-5 text-[#00b894]" />
              Catálogo Comercial Oficial KÔMA
            </h3>
            <p className="text-xs text-koma-muted mt-0.5">
              Consumido diretamente da fonte oficial ({SUBSCRIPTION_PLANS.length} planos com {formatPercentage(ANNUAL_DISCOUNT_RATE)} de desconto anual)
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {SUBSCRIPTION_PLANS.map(plan => {
            const pricing = getSubscriptionPricing(plan.price);
            const tenantCount = tenantsAvailable
              ? tenants.filter(t => t.plan?.toLowerCase() === plan.id).length
              : null;

            return (
              <div
                key={plan.id}
                className={`rounded-xl p-5 flex flex-col justify-between space-y-4 border ${
                  plan.recommended
                    ? "bg-koma-page border-[#00b894] shadow-[0_0_15px_rgba(0,184,148,0.1)]"
                    : "bg-koma-page/70 border-zinc-800"
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-koma-foreground">{plan.name}</span>
                    {tenantCount !== null ? (
                      <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-zinc-800 text-koma-secondary">
                        {tenantCount} cliente(s)
                      </span>
                    ) : (
                      <span className="text-[10px] text-koma-subtle font-mono">
                        Base isolada
                      </span>
                    )}
                  </div>

                  <div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-extrabold text-koma-foreground">
                        {formatCurrency(plan.price)}
                      </span>
                      <span className="text-xs text-koma-muted">/mês</span>
                    </div>
                    <div className="text-xs text-[#00b894] font-semibold mt-0.5">
                      + {formatPercentage(plan.splitFeeRate)} taxa split Pix
                    </div>
                    <div className="text-[11px] text-koma-subtle mt-1 flex items-center gap-1">
                      <Tag className="w-3 h-3 text-[#00b894]" />
                      Anual: {formatCurrency(pricing.annualTotal)}/ano ({formatCurrency(pricing.annualMonthlyEquivalent)}/mês)
                    </div>
                  </div>

                  <p className="text-xs text-koma-muted">{plan.tagline}</p>

                  <div className="pt-2 border-t border-zinc-800/60 space-y-2">
                    {plan.features.map(f => (
                      <div key={f} className="flex items-start gap-2 text-xs text-koma-secondary">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#00b894] shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default SuperAdminBillingTab;
