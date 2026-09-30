
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  CalendarClock,
  CreditCard,
  ExternalLink,
  Headphones,
  History,
  Lock,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  Unlock,
  UsersRound,
  Wrench,
} from "lucide-react";
import { formatCurrency, getSubscriptionPlan } from "../config/subscriptionPlans";
import { SuperAdminReleaseModal } from "./SuperAdminReleaseModal";
import { SuperAdminTrialModal } from "./SuperAdminTrialModal";
import type { ContractInboxItem } from "./SuperAdminContractsTab";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";
import type { SuperAdminAuditLogEntry, Tenant } from "./superAdminTypes";

type SectionId =
  | "summary"
  | "implementation"
  | "plan"
  | "team"
  | "payments"
  | "operation"
  | "history";

type TrialRecord = {
  restaurantId: string;
  trialStatus: "active" | "expired" | "ended" | "converted" | "not_started";
  trialStartedAt?: string | null;
  trialEndsAt?: string | null;
  daysRemaining: number;
};

type ReleasePreview = {
  restaurant: { operationProfile?: string | null };
  subscription: {
    status: string;
    billingCycle: string;
    paymentMethod: string | null;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
  };
  steps: Record<"profile" | "hours" | "catalog" | "operations", boolean>;
  operations?: { orderTypes?: string[]; blockers?: string[] };
  counts?: { tables?: number; activeProducts?: number };
  readyForRelease: boolean;
  trialStarted: boolean;
};

type AccessDetail = {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  pendingUsers: number;
  activeAdmins: number;
  diagnostics: Array<{
    severity: "critical" | "warning" | "info";
    code: string;
    message: string;
    action: string;
  }>;
  users: Array<{
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    role: string;
    status: "ativo" | "inativo" | "pendente_ativacao";
    createdAt?: string | null;
  }>;
};

interface SuperAdminRestaurant360Props {
  tenant: Tenant;
  contracts: ContractInboxItem[];
  contractsAvailable: boolean;
  onBack: () => void;
  onRefreshTenant: () => void;
  onEdit: (tenant: Tenant) => void;
  onSupport: (tenant: Tenant) => void;
  onStatus: (tenant: Tenant) => void;
  onBenefits: (tenant: Tenant) => void;
  onOpenTeamControls: () => void;
}

const sections: Array<{
  id: SectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "summary", label: "Resumo", icon: Store },
  { id: "implementation", label: "Implantação", icon: Sparkles },
  { id: "plan", label: "Plano & benefícios", icon: ShieldCheck },
  { id: "team", label: "Equipe", icon: UsersRound },
  { id: "payments", label: "Pagamentos", icon: CreditCard },
  { id: "operation", label: "Operação", icon: Wrench },
  { id: "history", label: "Histórico", icon: History },
];

const stepLabels: Record<keyof ReleasePreview["steps"], string> = {
  profile: "Dados do restaurante",
  hours: "Horários",
  catalog: "Produto ativo",
  operations: "Modalidades",
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR");
}

function paymentStatusLabel(status?: string | null) {
  if (status === "connected") return "Mercado Pago conectado";
  if (status === "disconnected") return "Mercado Pago desconectado";
  if (status === "pending") return "Mercado Pago pendente";
  return "Status não informado";
}

function trialStatusLabel(status?: TrialRecord["trialStatus"] | null) {
  if (status === "active") return "Ativo";
  if (status === "expired") return "Expirado";
  if (status === "ended") return "Encerrado";
  if (status === "converted") return "Convertido";
  return "Não iniciado";
}

function formatContractMoney(value?: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? formatCurrency(parsed) : "—";
}

function formatContractRate(value?: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? (parsed * 100).toFixed(2).replace(".", ",") + "%"
    : "—";
}

export function SuperAdminRestaurant360({
  tenant,
  contracts,
  contractsAvailable,
  onBack,
  onRefreshTenant,
  onEdit,
  onSupport,
  onStatus,
  onBenefits,
  onOpenTeamControls,
}: SuperAdminRestaurant360Props) {
  const [section, setSection] = useState<SectionId>("summary");
  const [trial, setTrial] = useState<TrialRecord | null>(null);
  const [release, setRelease] = useState<ReleasePreview | null>(null);
  const [access, setAccess] = useState<AccessDetail | null>(null);
  const [audit, setAudit] = useState<SuperAdminAuditLogEntry[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [trialOpen, setTrialOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);

  const linkedContract = useMemo(
    () => contracts.find(item => item.linkedRestaurantId === tenant.id) || null,
    [contracts, tenant.id],
  );
  const plan = getSubscriptionPlan(tenant.plan);
  const suspended = tenant.status?.toUpperCase() === "SUSPENDED";

  const loadData = useCallback(async () => {
    setLoading(true);
    const nextErrors: string[] = [];

    const results = await Promise.allSettled([
      superAdminFetch("/api/super-admin/trials").then(async response => {
        const body = await response.json();
        if (!response.ok || !Array.isArray(body)) {
          throw new Error(body?.detail || "Período grátis indisponível.");
        }
        return (body as TrialRecord[]).find(item => item.restaurantId === tenant.id) || null;
      }),
      superAdminFetch("/api/super-admin/onboarding/restaurantes/" + tenant.id + "/release").then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.detail || "Implantação indisponível.");
        return body as ReleasePreview;
      }),
      superAdminFetch("/api/super-admin/access/restaurantes/" + tenant.id).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.detail || "Equipe indisponível.");
        return body as AccessDetail;
      }),
      superAdminFetch("/api/super-admin/audit").then(async response => {
        const body = await response.json();
        if (!response.ok || !Array.isArray(body)) {
          throw new Error(body?.detail || "Auditoria indisponível.");
        }
        return (body as SuperAdminAuditLogEntry[])
          .filter(item => item.restauranteId === tenant.id)
          .slice(0, 100);
      }),
    ]);

    if (results[0].status === "fulfilled") setTrial(results[0].value as TrialRecord | null);
    else {
      setTrial(null);
      nextErrors.push("Trial: " + superAdminErrorMessage(results[0].reason));
    }

    if (results[1].status === "fulfilled") setRelease(results[1].value as ReleasePreview);
    else {
      setRelease(null);
      nextErrors.push("Implantação: " + superAdminErrorMessage(results[1].reason));
    }

    if (results[2].status === "fulfilled") setAccess(results[2].value as AccessDetail);
    else {
      setAccess(null);
      nextErrors.push("Equipe: " + superAdminErrorMessage(results[2].reason));
    }

    if (results[3].status === "fulfilled") setAudit(results[3].value as SuperAdminAuditLogEntry[]);
    else {
      setAudit([]);
      nextErrors.push("Histórico: " + superAdminErrorMessage(results[3].reason));
    }

    setErrors(nextErrors);
    setLoading(false);
  }, [tenant.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const refreshAll = async () => {
    onRefreshTenant();
    await loadData();
  };

  const readySteps = release ? Object.values(release.steps).filter(Boolean).length : null;

  return (
    <section className="space-y-5" data-testid="superadmin-restaurant-360">
      <div className="rounded-xl border border-[#1e293b] bg-koma-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={onBack}
              className="mt-0.5 rounded-lg border border-zinc-800 bg-koma-page p-2 text-koma-muted hover:text-koma-foreground"
              aria-label="Voltar para restaurantes"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-black text-koma-foreground">{tenant.name}</h2>
                <span className={
                  "rounded-full border px-2 py-0.5 text-[10px] font-black " +
                  (suspended
                    ? "border-rose-800/50 bg-rose-950/30 text-rose-300"
                    : "border-emerald-800/50 bg-emerald-950/30 text-emerald-300")
                }>
                  {suspended ? "SUSPENSO" : "ATIVO"}
                </span>
                <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-bold text-koma-secondary">
                  {plan.name || tenant.plan}
                </span>
              </div>
              <p className="mt-1 font-mono text-[11px] text-koma-muted">
                Tenant #{tenant.id}
                {tenant.subdomain ? " · " + tenant.subdomain + ".komafood.com.br" : ""}
              </p>
              <p className="mt-2 text-xs text-koma-muted">
                Ficha operacional única do restaurante.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onSupport(tenant)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs font-bold text-amber-300">
              <Headphones className="h-3.5 w-3.5" /> Modo suporte
            </button>
            <button type="button" onClick={() => onEdit(tenant)} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-bold text-koma-secondary">
              <Pencil className="h-3.5 w-3.5" /> Editar cadastro
            </button>
            <button
              type="button"
              onClick={() => onStatus(tenant)}
              className={
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold " +
                (suspended
                  ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-300"
                  : "border-rose-800/60 bg-rose-950/30 text-rose-300")
              }
            >
              {suspended ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {suspended ? "Reativar" : "Suspender"}
            </button>
            <button type="button" onClick={() => void refreshAll()} disabled={loading} className="rounded-lg border border-zinc-800 p-2 text-koma-muted disabled:opacity-50">
              <RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} />
            </button>
          </div>
        </div>

        <div className="mt-5 flex gap-1 overflow-x-auto border-t border-zinc-800 pt-4">
          {sections.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold " +
                  (section === item.id
                    ? "bg-[#00b894] text-black"
                    : "text-koma-muted hover:bg-koma-page hover:text-koma-foreground")
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-4 text-xs text-amber-200" role="status">
          <strong>Algumas fontes estão indisponíveis.</strong>
          {errors.map(message => <p key={message} className="mt-1 text-[11px] text-amber-200/80">{message}</p>)}
        </div>
      )}

      {section === "summary" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-zinc-800 bg-koma-card p-4">
              <span className="text-[10px] font-bold uppercase text-koma-muted">Trial</span>
              <strong className="mt-2 block text-lg text-koma-foreground">{trialStatusLabel(trial?.trialStatus)}</strong>
              <p className="mt-1 text-[11px] text-koma-muted">{trial?.trialStatus === "active" ? trial.daysRemaining + " dia(s) restante(s)" : formatDate(trial?.trialEndsAt)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-koma-card p-4">
              <span className="text-[10px] font-bold uppercase text-koma-muted">Implantação</span>
              <strong className="mt-2 block text-lg text-koma-foreground">{release ? String(readySteps) + "/4 itens" : "—"}</strong>
              <p className="mt-1 text-[11px] text-koma-muted">{release?.trialStarted ? "Operação liberada" : release?.readyForRelease ? "Pronto para liberar" : "Configuração em andamento"}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-koma-card p-4">
              <span className="text-[10px] font-bold uppercase text-koma-muted">Equipe</span>
              <strong className="mt-2 block text-lg text-koma-foreground">{access ? access.activeUsers + " ativo(s)" : "—"}</strong>
              <p className="mt-1 text-[11px] text-koma-muted">{access ? access.activeAdmins + " administrador(es)" : "Fonte indisponível"}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-koma-card p-4">
              <span className="text-[10px] font-bold uppercase text-koma-muted">Pagamento online</span>
              <strong className="mt-2 block text-base text-koma-foreground">{paymentStatusLabel(tenant.onlinePaymentStatus)}</strong>
              <p className="mt-1 text-[11px] text-koma-muted">Recebimento dos clientes do restaurante</p>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-xl border border-zinc-800 bg-koma-card p-5">
              <h3 className="text-sm font-bold text-koma-foreground">Estado operacional</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-zinc-800 bg-koma-page p-3 text-xs"><span className="text-koma-muted">Pedidos no mês</span><strong className="mt-1 block text-base text-koma-foreground">{tenant.monthlyOrders ?? "—"}</strong></div>
                <div className="rounded-lg border border-zinc-800 bg-koma-page p-3 text-xs"><span className="text-koma-muted">Recebimentos no mês</span><strong className="mt-1 block text-base text-koma-foreground">{tenant.monthlyBilling != null ? formatCurrency(tenant.monthlyBilling) : "—"}</strong></div>
                <div className="rounded-lg border border-zinc-800 bg-koma-page p-3 text-xs"><span className="text-koma-muted">Última atividade</span><strong className="mt-1 block text-sm text-koma-foreground">{formatDate(tenant.lastActivity)}</strong></div>
                <div className="rounded-lg border border-zinc-800 bg-koma-page p-3 text-xs"><span className="text-koma-muted">Tipo de operação</span><strong className="mt-1 block text-sm text-koma-foreground">{release?.restaurant.operationProfile || "Não informado"}</strong></div>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-koma-card p-5">
              <h3 className="text-sm font-bold text-koma-foreground">Pontos de atenção</h3>
              <div className="mt-3 space-y-2">
                {access?.diagnostics?.length ? access.diagnostics.map(item => (
                  <div key={item.code} className={
                    "rounded-lg border p-3 text-[11px] " +
                    (item.severity === "critical"
                      ? "border-rose-900/60 bg-rose-950/20 text-rose-200"
                      : item.severity === "warning"
                        ? "border-amber-900/60 bg-amber-950/20 text-amber-200"
                        : "border-zinc-800 bg-koma-page text-koma-secondary")
                  }>
                    <strong>{item.message}</strong>
                    <p className="mt-1 opacity-80">{item.action}</p>
                  </div>
                )) : (
                  <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 text-[11px] text-emerald-300">
                    {access ? "Nenhum alerta de acesso identificado." : "Diagnóstico de acesso indisponível."}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {section === "implementation" && (
        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-xl border border-zinc-800 bg-koma-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="text-base font-bold text-koma-foreground">Implantação & liberação</h3><p className="mt-1 text-xs text-koma-muted">O trial comercial começa após a liberação explícita da operação.</p></div>
              <button type="button" onClick={() => setReleaseOpen(true)} className="rounded-lg bg-[#00b894] px-3 py-2 text-xs font-black text-black">Ver implantação e liberar</button>
            </div>
            {release ? (
              <>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {(Object.keys(release.steps) as Array<keyof ReleasePreview["steps"]>).map(key => (
                    <div key={key} className={
                      "rounded-lg border p-3 text-xs " +
                      (release.steps[key]
                        ? "border-emerald-900/50 bg-emerald-950/20 text-emerald-200"
                        : "border-zinc-800 bg-koma-page text-koma-muted")
                    }>
                      {release.steps[key] ? "✓ " : "○ "}{stepLabels[key]}
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 border-t border-zinc-800 pt-4 sm:grid-cols-3 text-xs">
                  <div><span className="text-koma-muted">Modalidades</span><strong className="mt-1 block text-koma-foreground">{release.operations?.orderTypes?.length ? release.operations.orderTypes.join(", ") : "Não configuradas"}</strong></div>
                  <div><span className="text-koma-muted">Mesas</span><strong className="mt-1 block text-koma-foreground">{release.counts?.tables ?? 0}</strong></div>
                  <div><span className="text-koma-muted">Produtos ativos</span><strong className="mt-1 block text-koma-foreground">{release.counts?.activeProducts ?? 0}</strong></div>
                </div>
              </>
            ) : <p className="mt-4 text-xs text-koma-muted">Fonte de implantação indisponível.</p>}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-koma-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="flex items-center gap-2 text-sm font-bold text-koma-foreground"><CalendarClock className="h-4 w-4 text-violet-300" /> Período grátis</h3><p className="mt-1 text-xs text-koma-muted">Separado de suspensão, cobrança SaaS e Mercado Pago.</p></div>
              <button type="button" onClick={() => setTrialOpen(true)} className="rounded-lg border border-violet-800/60 bg-violet-950/30 px-3 py-2 text-xs font-bold text-violet-200">Gerenciar trial</button>
            </div>
            <div className="mt-4 rounded-xl border border-zinc-800 bg-koma-page p-4">
              <strong className="block text-xl text-koma-foreground">{trialStatusLabel(trial?.trialStatus)}</strong>
              <p className="mt-2 text-xs text-koma-muted">Início: {formatDate(trial?.trialStartedAt)}</p>
              <p className="mt-1 text-xs text-koma-muted">Fim: {formatDate(trial?.trialEndsAt)}</p>
              {trial?.trialStatus === "active" && <p className="mt-1 text-xs font-bold text-violet-200">{trial.daysRemaining} dia(s) restante(s)</p>}
            </div>
          </div>
        </div>
      )}

      {section === "plan" && (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-koma-card p-5">
            <span className="text-[10px] font-black uppercase tracking-wide text-[#00b894]">Plano de recursos atual</span>
            <h3 className="mt-1 text-xl font-black text-koma-foreground">{plan.name}</h3>
            <p className="mt-2 text-xs text-koma-muted">{plan.tagline}</p>
            <div className="mt-4 rounded-lg border border-zinc-800 bg-koma-page p-3 text-xs">
              <span className="text-koma-muted">Catálogo vigente</span>
              <strong className="mt-1 block text-base text-koma-foreground">{formatCurrency(plan.price)}/mês</strong>
              <p className="mt-1 text-[11px] text-koma-subtle">Referência atual; não substitui o aceite congelado.</p>
            </div>
            <button type="button" onClick={() => onBenefits(tenant)} className="mt-4 rounded-lg bg-[#00b894] px-3 py-2 text-xs font-black text-black">Ver baseline, overrides e efetivo</button>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-koma-card p-5">
            <span className="text-[10px] font-black uppercase tracking-wide text-amber-300">Condições contratadas</span>
            {linkedContract ? (
              <>
                <h3 className="mt-1 font-mono text-sm font-bold text-koma-foreground">{linkedContract.protocol}</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
                  <div><span className="text-koma-muted">Plano aceito</span><strong className="mt-1 block text-koma-foreground">{linkedContract.plan.toUpperCase()}</strong></div>
                  <div><span className="text-koma-muted">Ciclo</span><strong className="mt-1 block text-koma-foreground">{linkedContract.billingCycle}</strong></div>
                  <div><span className="text-koma-muted">Mensalidade congelada</span><strong className="mt-1 block text-koma-foreground">{formatContractMoney(linkedContract.fixedMonthlyPrice)}</strong></div>
                  <div><span className="text-koma-muted">Taxa online congelada</span><strong className="mt-1 block text-koma-foreground">{formatContractRate(linkedContract.marketplaceRate)}</strong></div>
                </div>
                <p className="mt-4 text-[11px] text-koma-muted">Benefícios individuais não alteram automaticamente cobrança, ciclo ou taxa do aceite.</p>
              </>
            ) : (
              <div className="mt-3 rounded-lg border border-zinc-800 bg-koma-page p-4 text-xs text-koma-muted">
                {contractsAvailable ? "Nenhum aceite vinculado foi localizado para este tenant." : "Inbox de contratações indisponível; termos não são inferidos pelo plano."}
              </div>
            )}
          </div>
        </div>
      )}

      {section === "team" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Total", access?.totalUsers],
              ["Ativos", access?.activeUsers],
              ["Administradores", access?.activeAdmins],
              ["Pendentes", access?.pendingUsers],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-zinc-800 bg-koma-card p-4">
                <span className="text-[10px] font-bold uppercase text-koma-muted">{label}</span>
                <strong className="mt-1 block text-xl text-koma-foreground">{value ?? "—"}</strong>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-koma-card">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 p-4">
              <div><h3 className="text-sm font-bold text-koma-foreground">Equipe do restaurante</h3><p className="mt-1 text-[11px] text-koma-muted">A ficha mostra somente a equipe deste tenant; o controle auditável existente continua disponível sem expor credenciais.</p></div>
              <button type="button" onClick={onOpenTeamControls} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-bold text-koma-secondary">Gerenciar acessos</button>
            </div>
            {access ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-xs">
                  <thead className="border-b border-zinc-800 text-[10px] uppercase text-koma-muted"><tr><th className="px-4 py-3">Usuário</th><th className="px-4 py-3">Cargo</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Criado</th></tr></thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {access.users.map(user => (
                      <tr key={user.id}>
                        <td className="px-4 py-3"><strong className="text-koma-foreground">{user.name}</strong><div className="mt-0.5 text-[10px] text-koma-muted">{user.email || user.phone || user.id}</div></td>
                        <td className="px-4 py-3 text-koma-secondary">{user.role}</td>
                        <td className="px-4 py-3 text-koma-secondary">{user.status === "ativo" ? "Ativo" : user.status === "inativo" ? "Bloqueado" : "Pendente"}</td>
                        <td className="px-4 py-3 text-koma-muted">{formatDate(user.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="p-6 text-xs text-koma-muted">Fonte de equipe indisponível.</p>}
          </div>
        </div>
      )}

      {section === "payments" && (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-koma-card p-5">
            <h3 className="flex items-center gap-2 text-base font-bold text-koma-foreground"><CreditCard className="h-4 w-4 text-[#00b894]" /> Pagamentos dos clientes</h3>
            <strong className="mt-4 block text-xl text-koma-foreground">{paymentStatusLabel(tenant.onlinePaymentStatus)}</strong>
            <p className="mt-2 text-xs text-koma-muted">Mercado Pago do Cardápio Online. Não representa mensalidade SaaS nem Pix anual da contratação.</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-koma-card p-5">
            <h3 className="text-base font-bold text-koma-foreground">Condição comercial</h3>
            {linkedContract ? (
              <div className="mt-4 space-y-3 text-xs">
                <div><span className="text-koma-muted">Taxa KÔMA congelada</span><strong className="mt-1 block text-lg text-koma-foreground">{formatContractRate(linkedContract.marketplaceRate)}</strong></div>
                <div><span className="text-koma-muted">Billing da assinatura</span><strong className="mt-1 block text-koma-foreground">{linkedContract.billingStatus || "Não informado"}</strong></div>
              </div>
            ) : <p className="mt-4 text-xs text-koma-muted">Sem contrato vinculado disponível; nenhuma taxa é inferida.</p>}
          </div>
        </div>
      )}

      {section === "operation" && (
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border border-zinc-800 bg-koma-card p-5">
            <h3 className="flex items-center gap-2 text-base font-bold text-koma-foreground"><Activity className="h-4 w-4 text-[#00b894]" /> Operação atual</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
              <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-koma-muted">Tipo</span><strong className="mt-1 block text-koma-foreground">{release?.restaurant.operationProfile || "Não informado"}</strong></div>
              <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-koma-muted">Modalidades</span><strong className="mt-1 block text-koma-foreground">{release?.operations?.orderTypes?.length ? release.operations.orderTypes.join(", ") : "Não configuradas"}</strong></div>
              <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-koma-muted">Mesas</span><strong className="mt-1 block text-koma-foreground">{release?.counts?.tables ?? "—"}</strong></div>
              <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-koma-muted">Produtos ativos</span><strong className="mt-1 block text-koma-foreground">{release?.counts?.activeProducts ?? "—"}</strong></div>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-koma-card p-5">
            <h3 className="text-sm font-bold text-koma-foreground">Ações operacionais</h3>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => onSupport(tenant)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs font-bold text-amber-300"><Headphones className="h-4 w-4" /> Modo suporte</button>
              <button type="button" onClick={() => onEdit(tenant)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-bold text-koma-secondary"><Pencil className="h-4 w-4" /> Editar cadastro e operação</button>
              {tenant.subdomain && <a href={"https://" + tenant.subdomain + ".komafood.com.br/"} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-bold text-koma-secondary"><ExternalLink className="h-4 w-4" /> Abrir cardápio público</a>}
            </div>
          </div>
        </div>
      )}

      {section === "history" && (
        <div className="rounded-xl border border-zinc-800 bg-koma-card">
          <div className="border-b border-zinc-800 p-4"><h3 className="text-base font-bold text-koma-foreground">Histórico administrativo</h3><p className="mt-1 text-xs text-koma-muted">Trilha persistente filtrada para este tenant.</p></div>
          {audit.length === 0 ? <p className="p-8 text-center text-xs text-koma-muted">Nenhum registro retornado.</p> : (
            <div className="divide-y divide-zinc-800/60">
              {audit.map(item => (
                <div key={item.id} className="p-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2"><strong className="font-mono text-koma-foreground">{item.action}</strong><span className="text-[10px] text-koma-muted">{formatDate(item.createdAt)}</span></div>
                  <p className="mt-2 text-koma-secondary">{item.reason}</p>
                  <p className="mt-1 text-[10px] text-koma-muted">Ator: {item.actor}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {trialOpen && <SuperAdminTrialModal tenant={tenant} onClose={() => setTrialOpen(false)} onUpdated={() => void refreshAll()} />}
      {releaseOpen && <SuperAdminReleaseModal restaurantId={tenant.id} onClose={() => setReleaseOpen(false)} onReleased={() => void refreshAll()} />}
    </section>
  );
}

export default SuperAdminRestaurant360;
