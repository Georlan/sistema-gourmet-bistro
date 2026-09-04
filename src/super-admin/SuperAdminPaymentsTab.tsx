import React from "react";
import { CheckCircle2, CreditCard, HelpCircle, Layers, XCircle } from "lucide-react";
import type { Tenant } from "./superAdminTypes";
import { SUBSCRIPTION_PLANS, formatPercentage } from "../config/subscriptionPlans";

interface SuperAdminPaymentsTabProps {
  tenants: Tenant[];
  tenantsAvailable: boolean;
}

function paymentStatusLabel(status?: string | null) {
  if (status === "connected") return "Conectado";
  if (status === "disconnected") return "Desconectado";
  if (status === "pending") return "Pendente";
  return "Não informado";
}

export function SuperAdminPaymentsTab({
  tenants,
  tenantsAvailable,
}: SuperAdminPaymentsTabProps) {
  const connected = tenantsAvailable
    ? tenants.filter(tenant => tenant.onlinePaymentStatus === "connected").length
    : null;
  const disconnected = tenantsAvailable
    ? tenants.filter(tenant => tenant.onlinePaymentStatus === "disconnected").length
    : null;
  const withoutConfirmedStatus = tenantsAvailable
    ? tenants.length - (connected ?? 0) - (disconnected ?? 0)
    : null;

  return (
    <div className="space-y-6">
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-koma-foreground flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-[#00b894]" />
            Pagamentos online
          </h2>
          <p className="text-xs text-koma-muted mt-0.5">
            Cobertura de conexão Mercado Pago informada pela API de restaurantes
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-zinc-800/60 text-xs">
          <div className="bg-koma-page p-4 rounded-xl border border-zinc-800 space-y-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <p className="text-koma-muted">Conectados</p>
            <p className="font-bold text-koma-foreground text-xl">{connected ?? "—"}</p>
          </div>
          <div className="bg-koma-page p-4 rounded-xl border border-zinc-800 space-y-2">
            <XCircle className="w-4 h-4 text-amber-400" />
            <p className="text-koma-muted">Desconectados</p>
            <p className="font-bold text-koma-foreground text-xl">{disconnected ?? "—"}</p>
          </div>
          <div className="bg-koma-page p-4 rounded-xl border border-zinc-800 space-y-2">
            <HelpCircle className="w-4 h-4 text-koma-subtle" />
            <p className="text-koma-muted">Sem status confirmado</p>
            <p className="font-bold text-koma-foreground text-xl">{withoutConfirmedStatus ?? "—"}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-base font-bold text-koma-foreground">Conexão por restaurante</h3>
            <p className="text-xs text-koma-muted mt-0.5">Esta tela não infere transações, webhooks ou valores recebidos.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-koma-muted font-medium">
                  <th className="py-2.5 px-3">Restaurante</th>
                  <th className="py-2.5 px-3">Plano</th>
                  <th className="py-2.5 px-3">Mercado Pago</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {!tenantsAvailable ? (
                  <tr><td colSpan={3} className="py-10 text-center text-koma-muted">Fonte de restaurantes indisponível.</td></tr>
                ) : tenants.length === 0 ? (
                  <tr><td colSpan={3} className="py-10 text-center text-koma-muted">Nenhum restaurante retornado.</td></tr>
                ) : tenants.map(tenant => (
                  <tr key={tenant.id}>
                    <td className="py-3 px-3 font-semibold text-koma-foreground">{tenant.name}</td>
                    <td className="py-3 px-3 text-koma-secondary">{tenant.plan || "Não informado"}</td>
                    <td className="py-3 px-3 text-koma-secondary">{paymentStatusLabel(tenant.onlinePaymentStatus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#00b894]" />
            Regra comercial
          </h3>
          <p className="text-[11px] text-koma-muted leading-relaxed">
            A taxa KÔMA incide somente em pedido online pago. Tarifas do provedor são separadas.
          </p>
          <div className="space-y-2">
            {SUBSCRIPTION_PLANS.map(plan => (
              <div key={plan.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-xs">
                <span className="text-koma-secondary">{plan.name}</span>
                <span className="font-mono text-koma-foreground">{formatPercentage(plan.splitFeeRate)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SuperAdminPaymentsTab;
