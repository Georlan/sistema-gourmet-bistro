import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  History,
  RefreshCw,
  ReceiptText,
  ShieldCheck,
  TrendingUp,
  X,
} from "lucide-react";
import type { Tenant } from "./superAdminTypes";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";
import {
  ANNUAL_DISCOUNT_RATE,
  SUBSCRIPTION_PLANS,
  formatCurrency,
  formatPercentage,
  getSubscriptionPlan,
  getSubscriptionPricing,
  type SubscriptionPlanId,
} from "../config/subscriptionPlans";

interface SuperAdminBillingTabProps {
  tenants: Tenant[];
  tenantsAvailable?: boolean;
}

type SubscriptionStatus =
  | "not_configured"
  | "active"
  | "past_due"
  | "canceled"
  | "needs_review";

type BillingCycle = "monthly" | "annual" | null;

interface BillingSubscription {
  restaurantId: string;
  restaurantName: string;
  saasStatus: string;
  plan: SubscriptionPlanId | string;
  billingCycle: BillingCycle;
  subscriptionStatus: SubscriptionStatus;
  storedStatus: Exclude<SubscriptionStatus, "needs_review">;
  periodAmountCents: number | null;
  monthlyEquivalentCents: number;
  currentPeriodEnd: string | null;
  source: "admin" | "provider" | null;
  catalogMismatch: boolean;
  updatedAt: string | null;
}

interface BillingHistoryItem {
  id: string;
  restaurantId: string;
  restaurantName: string;
  actor: string;
  action: string;
  reason: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  createdAt?: string | null;
}

interface BillingOverview {
  summary: {
    contractedMrrCents: number;
    currentMrrCents: number;
    activeSubscriptions: number;
    pastDueSubscriptions: number;
    canceledSubscriptions: number;
    notConfiguredSubscriptions: number;
    needsReviewSubscriptions: number;
    recurringRevenueReceivedAvailable: boolean;
  };
  subscriptions: BillingSubscription[];
  history: BillingHistoryItem[];
  rules: {
    annualDiscountRate: number;
    annualDiscountScope: string;
    pastDueAutoSuspendsTenant: boolean;
    mrrSource: string;
    receivedRevenueSource: string | null;
  };
}

const statusLabels: Record<SubscriptionStatus, string> = {
  not_configured: "Não configurada",
  active: "Ativa",
  past_due: "Inadimplente",
  canceled: "Cancelada",
  needs_review: "Revisão necessária",
};

const statusClasses: Record<SubscriptionStatus, string> = {
  not_configured: "border-zinc-700 bg-zinc-900 text-koma-muted",
  active: "border-emerald-800/50 bg-emerald-950/60 text-emerald-300",
  past_due: "border-amber-800/50 bg-amber-950/60 text-amber-300",
  canceled: "border-rose-800/50 bg-rose-950/60 text-rose-300",
  needs_review: "border-orange-800/50 bg-orange-950/60 text-orange-300",
};

function currencyFromCents(cents: number | null | undefined): string {
  return formatCurrency((cents || 0) / 100);
}

function dateLabel(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("pt-BR");
}

export function SuperAdminBillingTab(_props: SuperAdminBillingTabProps) {
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BillingSubscription | null>(null);
  const [plan, setPlan] = useState<SubscriptionPlanId>("pocket");
  const [cycle, setCycle] = useState<Exclude<BillingCycle, null>>("monthly");
  const [status, setStatus] = useState<Exclude<SubscriptionStatus, "needs_review">>("active");
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const loadBilling = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await superAdminFetch("/api/super-admin/billing");
      const payload = await response.json() as BillingOverview;
      setOverview(payload);
    } catch (err) {
      setOverview(null);
      setError(superAdminErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadBilling();
  }, []);

  const openEditor = (item: BillingSubscription) => {
    setEditing(item);
    setPlan(getSubscriptionPlan(item.plan).id);
    setCycle(item.billingCycle || "monthly");
    setStatus(item.storedStatus || "not_configured");
    setReason("");
  };

  const closeEditor = () => {
    if (isSaving) return;
    setEditing(null);
    setReason("");
  };

  const selectedPricing = useMemo(() => {
    const selectedPlan = getSubscriptionPlan(plan);
    const pricing = getSubscriptionPricing(selectedPlan.price);
    return {
      plan: selectedPlan,
      periodValue: cycle === "annual" ? pricing.annualTotal : pricing.monthly,
      monthlyEquivalent: cycle === "annual" ? pricing.annualMonthlyEquivalent : pricing.monthly,
    };
  }, [plan, cycle]);

  const saveSubscription = async () => {
    if (!editing || reason.trim().length < 3) return;
    setIsSaving(true);
    setError(null);
    try {
      await superAdminFetch(
        `/api/super-admin/billing/restaurantes/${encodeURIComponent(editing.restaurantId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan,
            billing_cycle: status === "not_configured" ? null : cycle,
            status,
            reason: reason.trim(),
          }),
        },
      );
      setEditing(null);
      setReason("");
      await loadBilling();
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const summary = overview?.summary;

  return (
    <div className="space-y-6">
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-koma-foreground flex items-center gap-2">
            <ReceiptText className="w-5 h-5 text-[#00b894]" />
            Planos & cobrança contratual
          </h2>
          <p className="text-xs text-koma-muted mt-1 max-w-3xl">
            Contrato persistido é fonte de MRR; não é comprovante de pagamento. Receita recorrente recebida só aparecerá quando existir um ledger de cobrança real.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadBilling()}
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-zinc-700 bg-koma-page text-xs font-bold text-koma-secondary hover:text-koma-foreground disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-xs text-rose-200" role="alert">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 space-y-2">
          <span className="text-xs text-koma-muted">MRR contratado</span>
          <div className="text-2xl font-bold text-koma-foreground">
            {summary ? currencyFromCents(summary.contractedMrrCents) : "—"}
          </div>
          <p className="text-[11px] text-koma-subtle">Ativas + inadimplentes, mensalizando contratos anuais.</p>
        </div>
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 space-y-2">
          <span className="text-xs text-koma-muted">MRR ativo</span>
          <div className="text-2xl font-bold text-emerald-400">
            {summary ? currencyFromCents(summary.currentMrrCents) : "—"}
          </div>
          <p className="text-[11px] text-koma-subtle">Somente contratos marcados como ativos.</p>
        </div>
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 space-y-2">
          <span className="text-xs text-koma-muted">Inadimplentes</span>
          <div className="text-2xl font-bold text-amber-300">{summary ? summary.pastDueSubscriptions : "—"}</div>
          <p className="text-[11px] text-koma-subtle">Não suspende o tenant automaticamente nesta etapa.</p>
        </div>
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 space-y-2">
          <span className="text-xs text-koma-muted">Receita recorrente recebida</span>
          <div className="text-2xl font-bold text-koma-foreground">—</div>
          <p className="text-[11px] text-koma-subtle">Indisponível até existir ledger de cobrança recorrente.</p>
        </div>
      </div>

      <div className="bg-koma-card border border-[#1e293b] rounded-xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-koma-foreground">Contratos por restaurante</h3>
            <p className="text-xs text-koma-muted mt-1">
              {summary
                ? `${summary.activeSubscriptions} ativo(s) • ${summary.pastDueSubscriptions} inadimplente(s) • ${summary.notConfiguredSubscriptions} não configurado(s) • ${summary.needsReviewSubscriptions} para revisão`
                : "Carregando fonte contratual..."}
            </p>
          </div>
          <span className="text-[10px] text-koma-subtle font-mono">fonte: contrato persistido / RLS por tenant</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-koma-page/70 text-koma-muted border-b border-zinc-800">
              <tr>
                <th className="px-4 py-3 font-semibold">Restaurante</th>
                <th className="px-4 py-3 font-semibold">Plano</th>
                <th className="px-4 py-3 font-semibold">Ciclo</th>
                <th className="px-4 py-3 font-semibold">Assinatura</th>
                <th className="px-4 py-3 font-semibold">Valor contratual</th>
                <th className="px-4 py-3 font-semibold">MRR</th>
                <th className="px-4 py-3 font-semibold">Status SaaS</th>
                <th className="px-4 py-3 font-semibold text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {(overview?.subscriptions || []).map(item => {
                const planInfo = getSubscriptionPlan(item.plan);
                return (
                  <tr key={item.restaurantId} className="hover:bg-koma-page/40">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-koma-foreground">{item.restaurantName}</div>
                      <div className="text-[10px] text-koma-subtle font-mono">#{item.restaurantId}</div>
                    </td>
                    <td className="px-4 py-3 text-koma-secondary">{planInfo.name}</td>
                    <td className="px-4 py-3 text-koma-secondary">
                      {item.billingCycle === "annual" ? "Anual" : item.billingCycle === "monthly" ? "Mensal" : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded border text-[10px] font-bold ${statusClasses[item.subscriptionStatus]}`}>
                        {statusLabels[item.subscriptionStatus]}
                      </span>
                      {item.catalogMismatch && (
                        <div className="mt-1 text-[10px] text-orange-300">Plano mudou fora do contrato; MRR removido até revisão.</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-koma-secondary">
                      {item.periodAmountCents == null
                        ? "—"
                        : `${currencyFromCents(item.periodAmountCents)}${item.billingCycle === "annual" ? "/ano" : "/mês"}`}
                    </td>
                    <td className="px-4 py-3 font-semibold text-koma-foreground">
                      {item.monthlyEquivalentCents > 0 ? currencyFromCents(item.monthlyEquivalentCents) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={item.saasStatus === "ACTIVE" ? "text-emerald-400" : "text-rose-300"}>
                        {item.saasStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEditor(item)}
                        className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-koma-page text-[11px] font-bold text-koma-secondary hover:text-koma-foreground"
                      >
                        Gerenciar contrato
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!isLoading && (overview?.subscriptions.length || 0) === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-koma-muted">Nenhum restaurante disponível na fonte real.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-base font-bold text-koma-foreground flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#00b894]" />
              Regras de cobrança
            </h3>
            <p className="text-xs text-koma-muted mt-1">Regras explícitas; nenhuma suspensão ou receita é inferida silenciosamente.</p>
          </div>
          <div className="space-y-2 text-xs text-koma-secondary">
            <div className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-[#00b894] shrink-0" /><span>Mensalidade fixa oficial: Pocket R$ 109, Pro R$ 209, Premium R$ 309.</span></div>
            <div className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-[#00b894] shrink-0" /><span>Anual aplica {formatPercentage(ANNUAL_DISCOUNT_RATE)} somente à mensalidade fixa.</span></div>
            <div className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-[#00b894] shrink-0" /><span>Inadimplência contratual é separada de suspensão SaaS; o Super Admin decide a suspensão.</span></div>
            <div className="flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" /><span>Alterar plano fora desta tela invalida o MRR do contrato até uma revisão explícita.</span></div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            {SUBSCRIPTION_PLANS.map(item => {
              const pricing = getSubscriptionPricing(item.price);
              return (
                <div key={item.id} className="rounded-lg border border-zinc-800 bg-koma-page/60 p-3">
                  <div className="text-xs font-bold text-koma-foreground">{item.name}</div>
                  <div className="text-lg font-bold mt-1">{formatCurrency(item.price)}<span className="text-[10px] font-normal text-koma-muted">/mês</span></div>
                  <div className="text-[10px] text-koma-subtle mt-1">Anual {formatCurrency(pricing.annualTotal)}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-base font-bold text-koma-foreground flex items-center gap-2">
              <History className="w-5 h-5 text-[#00b894]" />
              Histórico contratual
            </h3>
            <p className="text-xs text-koma-muted mt-1">Últimas alterações persistidas na auditoria append-only.</p>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {(overview?.history || []).map(item => (
              <div key={item.id} className="rounded-lg border border-zinc-800 bg-koma-page/50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-koma-foreground">{item.restaurantName} <span className="text-koma-subtle font-mono">#{item.restaurantId}</span></div>
                    <div className="text-[11px] text-koma-secondary mt-1">{item.reason}</div>
                  </div>
                  <div className="text-[10px] text-koma-subtle whitespace-nowrap">{dateLabel(item.createdAt)}</div>
                </div>
                <div className="text-[10px] text-koma-subtle mt-2">Operador: {item.actor}</div>
              </div>
            ))}
            {!isLoading && (overview?.history.length || 0) === 0 && (
              <div className="py-8 text-center text-xs text-koma-muted">Nenhuma alteração contratual registrada ainda.</div>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl border border-zinc-700 bg-koma-card shadow-2xl">
            <div className="flex items-start justify-between gap-4 p-5 border-b border-zinc-800">
              <div>
                <h3 className="text-base font-bold text-koma-foreground">Gerenciar contrato</h3>
                <p className="text-xs text-koma-muted mt-1">{editing.restaurantName} • ID #{editing.restaurantId}</p>
              </div>
              <button type="button" onClick={closeEditor} className="p-1 text-koma-muted hover:text-koma-foreground" aria-label="Fechar">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5 text-xs text-koma-secondary">
                  <span className="font-semibold">Plano</span>
                  <select value={plan} onChange={e => setPlan(e.target.value as SubscriptionPlanId)} className="w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-koma-foreground">
                    {SUBSCRIPTION_PLANS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5 text-xs text-koma-secondary">
                  <span className="font-semibold">Ciclo</span>
                  <select value={cycle} disabled={status === "not_configured"} onChange={e => setCycle(e.target.value as "monthly" | "annual")} className="w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-koma-foreground disabled:opacity-50">
                    <option value="monthly">Mensal</option>
                    <option value="annual">Anual</option>
                  </select>
                </label>
              </div>

              <label className="space-y-1.5 text-xs text-koma-secondary block">
                <span className="font-semibold">Status contratual</span>
                <select value={status} onChange={e => setStatus(e.target.value as Exclude<SubscriptionStatus, "needs_review">)} className="w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-koma-foreground">
                  <option value="not_configured">Não configurada</option>
                  <option value="active">Ativa</option>
                  <option value="past_due">Inadimplente</option>
                  <option value="canceled">Cancelada</option>
                </select>
              </label>

              {status !== "not_configured" && (
                <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4 text-xs">
                  <div className="font-bold text-koma-foreground">{selectedPricing.plan.name}</div>
                  <div className="text-koma-secondary mt-1">
                    Cobrança {cycle === "annual" ? "anual" : "mensal"}: <strong>{formatCurrency(selectedPricing.periodValue)}</strong>
                    {cycle === "annual" && <> • MRR equivalente <strong>{formatCurrency(selectedPricing.monthlyEquivalent)}</strong></>}
                  </div>
                  <div className="text-koma-subtle mt-1">Taxa por pedido online pago: {formatPercentage(selectedPricing.plan.splitFeeRate)}.</div>
                </div>
              )}

              <label className="space-y-1.5 text-xs text-koma-secondary block">
                <span className="font-semibold">Motivo da alteração *</span>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={1000} placeholder="Ex.: contrato anual confirmado com o cliente" className="w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-koma-foreground placeholder:text-koma-subtle" />
                <span className="text-[10px] text-koma-subtle">Persistido na auditoria; mínimo de 3 caracteres.</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 p-5 border-t border-zinc-800">
              <button type="button" onClick={closeEditor} disabled={isSaving} className="px-4 py-2 rounded-lg border border-zinc-700 text-xs font-bold text-koma-secondary disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={() => void saveSubscription()} disabled={isSaving || reason.trim().length < 3} className="px-4 py-2 rounded-lg bg-[#00b894] text-black text-xs font-black disabled:opacity-50">
                {isSaving ? "Salvando..." : "Salvar contrato"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="sr-only" aria-hidden="true">
        <TrendingUp />
      </div>
    </div>
  );
}

export default SuperAdminBillingTab;
