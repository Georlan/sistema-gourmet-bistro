
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
import type { SupportNavigationTarget } from "./SuperAdminSupportModal";
import type { SuperAdminAuditLogEntry, Tenant } from "./superAdminTypes";

type OperationMode = "consumo_local" | "retirada" | "delivery";

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
  operations?: {
    configured?: boolean;
    ready?: boolean;
    orderTypes?: string[];
    tableMapEnabled?: boolean;
    blockers?: string[];
    capabilities?: {
      dineIn?: { enabled?: boolean; ready?: boolean };
      pickup?: { enabled?: boolean; ready?: boolean };
      delivery?: { enabled?: boolean; ready?: boolean };
    };
  };
  counts?: { tables?: number; activeProducts?: number };
  catalogAssistance?: { status?: string; filename?: string } | null;
  progress?: { completed?: number; total?: number };
  payments?: { mercadoPagoConnected?: boolean; pixOnlineAvailable?: boolean };
  onboarding?: {
    mode?: string;
    releaseState?: string;
    operationReleased?: boolean;
    requiresKomaRelease?: boolean;
  };
  readiness?: {
    configurationComplete?: boolean;
    trialStarted?: boolean;
    operationReleased?: boolean;
    readyToOperate?: boolean;
    blockers?: string[];
  };
  readyForRelease: boolean;
  trialStarted: boolean;
};

type TenantIncident = {
  id: string;
  tenant_id: number;
  tenant_name: string;
  source: "outbox" | "mercado_pago" | "impressao" | "acesso" | "tenant" | string;
  severity: "critical" | "high" | "medium" | "low" | "info" | string;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  detected_at: string;
  last_seen_at?: string | null;
  recommended_action: string;
  action_available?: boolean;
  action_type?: string | null;
  action_target_id?: string | null;
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
  onSupport: (tenant: Tenant, target?: SupportNavigationTarget) => void;
  onStatus: (tenant: Tenant) => void;
  onBenefits: (tenant: Tenant) => void;
  onOpenTeamControls: () => void;
  onOpenCatalogAssistance: () => void;
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

function supportTargetForCockpit(key: string): SupportNavigationTarget | null {
  if (key === "profile") return { tab: "cardapio_digital", subTab: "cardapio_perfil", label: "Dados do restaurante" };
  if (key === "hours") return { tab: "cardapio_digital", subTab: "cardapio_pedidos", label: "Horários e pedidos online" };
  if (key === "catalog") return { tab: "cardapio", subTab: "produtos", label: "Cardápio / produtos" };
  if (key === "dine-in") return { tab: "impressao_salao", subTab: "mesas", label: "Salão / mesas" };
  if (key === "delivery") return { tab: "cardapio_digital", subTab: "cardapio_entrega", label: "Configuração de entrega" };
  if (key === "payment") return { tab: "cardapio_digital", subTab: "cardapio_pagamentos", label: "Formas de pagamento" };
  return null;
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
  onOpenCatalogAssistance,
}: SuperAdminRestaurant360Props) {
  const [section, setSection] = useState<SectionId>("summary");
  const [trial, setTrial] = useState<TrialRecord | null>(null);
  const [release, setRelease] = useState<ReleasePreview | null>(null);
  const [access, setAccess] = useState<AccessDetail | null>(null);
  const [audit, setAudit] = useState<SuperAdminAuditLogEntry[]>([]);
  const [incidents, setIncidents] = useState<TenantIncident[]>([]);
  const [incidentsAvailable, setIncidentsAvailable] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [trialOpen, setTrialOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [operationsEditing, setOperationsEditing] = useState(false);
  const [operationModes, setOperationModes] = useState<OperationMode[]>([]);
  const [operationReason, setOperationReason] = useState("");
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);

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
      superAdminFetch("/api/super-admin/incidents?tenant_id=" + encodeURIComponent(tenant.id)).then(async response => {
        const body = await response.json();
        if (!response.ok || !Array.isArray(body)) {
          throw new Error(body?.detail || "Incidentes operacionais indisponíveis.");
        }
        return body as TenantIncident[];
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

    if (results[4].status === "fulfilled") {
      setIncidents(results[4].value as TenantIncident[]);
      setIncidentsAvailable(true);
    } else {
      setIncidents([]);
      setIncidentsAvailable(false);
      nextErrors.push("Incidentes: " + superAdminErrorMessage(results[4].reason));
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
  const criticalIncidentCount = incidents.filter(item => item.severity === "critical" || item.severity === "high").length;

  const incidentTone = (severity: string) => {
    if (severity === "critical" || severity === "high") return "border-rose-900/60 bg-rose-950/20 text-rose-200";
    if (severity === "medium") return "border-amber-900/60 bg-amber-950/20 text-amber-200";
    if (severity === "low") return "border-zinc-700 bg-zinc-900/40 text-koma-secondary";
    return "border-zinc-800 bg-koma-page text-koma-muted";
  };

  const incidentSourceLabel = (source: string) => {
    if (source === "mercado_pago") return "Mercado Pago";
    if (source === "impressao") return "Impressão";
    if (source === "outbox") return "Integrações / Outbox";
    if (source === "acesso") return "Acesso";
    if (source === "tenant") return "Restaurante";
    return source;
  };

  const openOperationsEditor = () => {
    const current = (release?.operations?.orderTypes || [])
      .filter((value): value is OperationMode => (
        value === "consumo_local" || value === "retirada" || value === "delivery"
      ));
    setOperationModes(current);
    setOperationReason("");
    setOperationError(null);
    setOperationNotice(null);
    setOperationsEditing(true);
  };

  const toggleOperationMode = (mode: OperationMode) => {
    setOperationModes(current => (
      current.includes(mode)
        ? current.filter(item => item !== mode)
        : [...current, mode]
    ));
  };

  const saveOperationModes = async () => {
    if (operationBusy) return;
    if (operationModes.length === 0) {
      setOperationError("Selecione ao menos uma modalidade.");
      return;
    }
    if (operationReason.trim().length < 3) {
      setOperationError("Informe um motivo administrativo com pelo menos 3 caracteres.");
      return;
    }

    setOperationBusy(true);
    setOperationError(null);
    setOperationNotice(null);
    try {
      const response = await superAdminFetch(
        "/api/super-admin/onboarding/restaurantes/" + tenant.id + "/operations",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_types: operationModes,
            reason: operationReason.trim(),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body?.detail || "Não foi possível atualizar as modalidades.");
      setRelease(body as ReleasePreview);
      setOperationReason("");
      setOperationNotice("Modalidades atualizadas com auditoria. Configurações especializadas não foram alteradas.");
      setOperationsEditing(false);
      onRefreshTenant();
    } catch (error) {
      setOperationError(superAdminErrorMessage(error));
    } finally {
      setOperationBusy(false);
    }
  };

  const reissueActivationInvite = async () => {
    if (!linkedContract || inviteBusy) return;
    setInviteBusy(true);
    setInviteNotice(null);
    setInviteError(null);
    try {
      const response = await superAdminFetch(
        "/api/super-admin/signups/" + encodeURIComponent(linkedContract.protocol) + "/activation-invite",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: "Reemissão do convite inicial pela ficha Restaurante 360",
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body?.detail || "Não foi possível reemitir o convite inicial.");
      setInviteNotice("Novo convite agendado. O link anterior foi invalidado.");
      await loadData();
    } catch (error) {
      setInviteError(superAdminErrorMessage(error));
    } finally {
      setInviteBusy(false);
    }
  };

  const cockpitItems = release ? [
    {
      key: "access",
      label: "Acesso",
      state: access ? (access.activeAdmins > 0 ? "ready" : "blocked") : "unknown",
      detail: access
        ? (access.activeAdmins > 0
          ? access.activeAdmins + " administrador(es) ativo(s)"
          : access.pendingUsers > 0
            ? access.pendingUsers + " convite(s) pendente(s)"
            : "Sem administrador ativo")
        : "Fonte de acesso indisponível",
      evidence: access ? access.totalUsers + " usuário(s) no tenant" : "—",
      owner: access && access.activeAdmins === 0 ? "KÔMA / cliente" : "—",
      nextStep: access && access.activeAdmins > 0
        ? "Nenhuma ação necessária."
        : access?.pendingUsers
          ? "Reemitir o convite inicial ou revisar o usuário pendente."
          : "Criar ou reativar um administrador.",
    },
    {
      key: "operation-profile",
      label: "Tipo de operação",
      state: release.restaurant.operationProfile ? "ready" : "unknown",
      detail: release.restaurant.operationProfile || "Não informado",
      evidence: "Metadado operacional do tenant",
      owner: "KÔMA pode corrigir",
      nextStep: "Corrigir somente se a classificação estiver errada; isso não altera o cardápio automaticamente.",
    },
    {
      key: "profile",
      label: "Dados do restaurante",
      state: release.steps.profile ? "ready" : "pending",
      detail: release.steps.profile ? "Dados essenciais preenchidos" : "Dados essenciais pendentes",
      evidence: "Readiness canônico do onboarding",
      owner: release.steps.profile ? "—" : "Cliente",
      nextStep: release.steps.profile ? "Revisar apenas se houver dado incorreto." : "Completar os dados básicos na tela canônica.",
    },
    {
      key: "hours",
      label: "Horários",
      state: release.steps.hours ? "ready" : "pending",
      detail: release.steps.hours ? "Horários estruturados" : "Horários pendentes",
      evidence: "Readiness canônico do onboarding",
      owner: release.steps.hours ? "—" : "Cliente",
      nextStep: release.steps.hours ? "Revisar somente se a rotina mudou." : "Definir os horários de funcionamento.",
    },
    {
      key: "catalog",
      label: "Cardápio",
      state: release.steps.catalog
        ? "ready"
        : release.catalogAssistance?.status
          ? "waiting"
          : "pending",
      detail: release.steps.catalog
        ? String(release.counts?.activeProducts ?? 0) + " produto(s) ativo(s)"
        : release.catalogAssistance?.status === "processing"
          ? "Fonte recebida · em preparação"
          : release.catalogAssistance?.status
            ? "Fonte recebida · aguardando estruturação"
            : "Nenhum produto ativo nem fonte assistida",
      evidence: release.catalogAssistance?.filename || "Catálogo do tenant",
      owner: release.steps.catalog ? "—" : release.catalogAssistance?.status ? "KÔMA" : "Cliente",
      nextStep: release.steps.catalog
        ? "Revisar catálogo se necessário."
        : release.catalogAssistance?.status
          ? "Estruturar e publicar a fonte assistida antes da liberação."
          : "Enviar a fonte do cardápio ou cadastrar o primeiro produto ativo.",
    },
    {
      key: "operations",
      label: "Modalidades",
      state: release.operations?.configured
        ? (release.operations?.ready ? "ready" : "blocked")
        : "pending",
      detail: release.operations?.orderTypes?.length
        ? release.operations.orderTypes.join(", ")
        : "Não configuradas",
      evidence: release.operations?.blockers?.length
        ? "Blockers: " + release.operations.blockers.join(", ")
        : "Política canônica de modalidades",
      owner: release.operations?.configured ? (release.operations?.ready ? "—" : "Cliente / KÔMA") : "Cliente",
      nextStep: release.operations?.configured && release.operations?.ready
        ? "Nenhuma ação necessária."
        : "Corrigir modalidades e resolver as configurações especializadas indicadas pelos blockers.",
    },
    {
      key: "dine-in",
      label: "Salão / mesas",
      state: release.operations?.capabilities?.dineIn?.enabled
        ? (release.operations?.tableMapEnabled
          ? (release.operations?.capabilities?.dineIn?.ready ? "ready" : "blocked")
          : "optional")
        : "optional",
      detail: release.operations?.capabilities?.dineIn?.enabled
        ? (release.operations?.tableMapEnabled
          ? String(release.counts?.tables ?? 0) + " mesa(s) cadastrada(s)"
          : "Consumo local ativo · mapa de mesas desativado")
        : "Consumo local não está ativo",
      evidence: "Readiness operacional do salão",
      owner: release.operations?.capabilities?.dineIn?.enabled && release.operations?.tableMapEnabled && !release.operations?.capabilities?.dineIn?.ready ? "KÔMA / cliente" : "—",
      nextStep: release.operations?.capabilities?.dineIn?.enabled && release.operations?.tableMapEnabled && !release.operations?.capabilities?.dineIn?.ready
        ? "Cadastrar/completar as mesas ou revisar o mapa do salão."
        : "Nenhuma ação obrigatória.",
    },
    {
      key: "delivery",
      label: "Delivery",
      state: release.operations?.capabilities?.delivery?.enabled
        ? (release.operations?.capabilities?.delivery?.ready ? "ready" : "blocked")
        : "optional",
      detail: release.operations?.capabilities?.delivery?.enabled
        ? (release.operations?.capabilities?.delivery?.ready
          ? "Configuração de entrega válida"
          : "Configuração de entrega incompleta")
        : "Delivery não está ativo",
      evidence: "Taxa/tabela/localização conforme modo configurado",
      owner: release.operations?.capabilities?.delivery?.enabled && !release.operations?.capabilities?.delivery?.ready ? "Cliente / KÔMA" : "—",
      nextStep: release.operations?.capabilities?.delivery?.enabled && !release.operations?.capabilities?.delivery?.ready
        ? "Revisar taxa, cobertura/bairros e demais regras de entrega."
        : "Nenhuma ação obrigatória.",
    },
    {
      key: "payment",
      label: "Pagamento online",
      state: release.payments?.mercadoPagoConnected ? "ready" : "optional",
      detail: release.payments?.mercadoPagoConnected
        ? "Mercado Pago conectado"
        : "Mercado Pago não conectado",
      evidence: "Conta de pagamento do Cardápio Online",
      owner: release.payments?.mercadoPagoConnected ? "—" : "Cliente quando quiser pagamento online",
      nextStep: release.payments?.mercadoPagoConnected
        ? "Revisar somente se houver incidente de pagamento."
        : "Configurar formas de pagamento; conectar Mercado Pago apenas se quiser pagamento online.",
    },
    {
      key: "release",
      label: "Liberação / trial",
      state: release.readiness?.trialStarted
        ? "ready"
        : release.readyForRelease
          ? "waiting"
          : "blocked",
      detail: release.readiness?.trialStarted
        ? "Operação liberada · trial iniciado"
        : release.readyForRelease
          ? "Implantação essencial pronta · aguardando KÔMA"
          : "Ainda há blockers de implantação",
      evidence: release.readiness?.blockers?.length
        ? "Blockers: " + release.readiness.blockers.join(", ")
        : "Readiness canônico do onboarding",
      owner: release.readiness?.trialStarted ? "—" : release.readyForRelease ? "KÔMA" : "Cliente / KÔMA",
      nextStep: release.readiness?.trialStarted
        ? "Acompanhar o período grátis."
        : release.readyForRelease
          ? "Revisar e liberar a operação; só então iniciar os 7 dias."
          : "Resolver os blockers canônicos antes da revisão KÔMA.",
    },
  ] as const : [];

  const cockpitTone = (state: string) => {
    if (state === "ready") return "border-emerald-900/50 bg-emerald-950/20 text-emerald-200";
    if (state === "blocked") return "border-rose-900/50 bg-rose-950/20 text-rose-200";
    if (state === "waiting") return "border-amber-900/50 bg-amber-950/20 text-amber-200";
    if (state === "optional") return "border-zinc-800 bg-koma-page text-koma-muted";
    return "border-zinc-800 bg-koma-page text-koma-secondary";
  };

  const cockpitStateLabel = (state: string) => {
    if (state === "ready") return "Pronto";
    if (state === "blocked") return "Bloqueado";
    if (state === "waiting") return "Aguardando";
    if (state === "optional") return "Opcional";
    if (state === "pending") return "Pendente";
    return "Indisponível";
  };

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
                {incidents.slice(0, 3).map(item => (
                  <div key={item.id} className={"rounded-lg border p-3 text-[11px] " + incidentTone(item.severity)}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{item.title}</strong>
                      <span className="text-[9px] font-black uppercase opacity-75">{incidentSourceLabel(item.source)}</span>
                    </div>
                    <p className="mt-1 opacity-80">{item.recommended_action}</p>
                  </div>
                ))}
                {incidentsAvailable && incidents.length === 0 && (access?.diagnostics?.length ? access.diagnostics.slice(0, 2).map(item => (
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
                    {access ? "Nenhum incidente operacional ou alerta de acesso identificado." : "Diagnóstico de acesso indisponível."}
                  </div>
                ))}
                {!incidentsAvailable && (
                  <div className="rounded-lg border border-zinc-800 bg-koma-page p-3 text-[11px] text-koma-muted">
                    Diagnóstico de incidentes indisponível; nenhum estado saudável foi presumido.
                  </div>
                )}
                {incidents.length > 3 && <p className="text-[10px] text-koma-muted">+ {incidents.length - 3} incidente(s) na aba Operação.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {section === "implementation" && (
        <div className="space-y-5">
          <div className="rounded-xl border border-zinc-800 bg-koma-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-koma-foreground">Cockpit de implantação</h3>
                <p className="mt-1 text-xs text-koma-muted">Estados e blockers vêm das projeções canônicas do backend; a ficha apenas organiza a evidência operacional.</p>
              </div>
              <button type="button" onClick={() => setReleaseOpen(true)} className="rounded-lg bg-[#00b894] px-3 py-2 text-xs font-black text-black">Revisar e liberar</button>
            </div>

            {release ? (
              <>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {cockpitItems.map(item => (
                    <div key={item.key} className={"rounded-xl border p-4 " + cockpitTone(item.state)}>
                      <div className="flex items-start justify-between gap-3">
                        <strong className="text-sm">{item.label}</strong>
                        <span className="rounded-full border border-current/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide">
                          {cockpitStateLabel(item.state)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs">{item.detail}</p>
                      <div className="mt-3 grid gap-1 text-[10px] opacity-80">
                        <p><strong>Evidência:</strong> {item.evidence}</p>
                        <p><strong>Quem age:</strong> {item.owner}</p>
                        <p><strong>Próximo passo:</strong> {item.nextStep}</p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                      {item.key === "operations" && (
                        <button type="button" onClick={openOperationsEditor} className="rounded-lg border border-current/30 px-3 py-1.5 text-[10px] font-black">
                          Corrigir modalidades
                        </button>
                      )}
                      {item.key === "operation-profile" && (
                        <button type="button" onClick={() => onEdit(tenant)} className="rounded-lg border border-current/30 px-3 py-1.5 text-[10px] font-black">
                          Corrigir tipo
                        </button>
                      )}
                      {item.key === "access" && (
                        <button type="button" onClick={onOpenTeamControls} className="rounded-lg border border-current/30 px-3 py-1.5 text-[10px] font-black">
                          Gerenciar acessos
                        </button>
                      )}
                      {item.key === "catalog" && release.catalogAssistance && (
                        <button type="button" onClick={onOpenCatalogAssistance} className="rounded-lg border border-current/30 px-3 py-1.5 text-[10px] font-black">
                          Abrir fila de cardápios
                        </button>
                      )}
                      {supportTargetForCockpit(item.key) && (
                        <button
                          type="button"
                          onClick={() => {
                            const target = supportTargetForCockpit(item.key);
                            if (target) onSupport(tenant, target);
                          }}
                          className="rounded-lg border border-current/30 px-3 py-1.5 text-[10px] font-black"
                        >
                          Abrir tela canônica em suporte
                        </button>
                      )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-xl border border-zinc-800 bg-koma-page p-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-koma-foreground">Readiness de liberação</strong>
                    <span className={release.readyForRelease ? "font-bold text-emerald-300" : "font-bold text-amber-300"}>
                      {release.readiness?.trialStarted
                        ? "Liberado"
                        : release.readyForRelease
                          ? "Pronto para revisão KÔMA"
                          : "Ainda bloqueado"}
                    </span>
                  </div>
                  <p className="mt-2 text-koma-muted">
                    {release.readiness?.blockers?.length
                      ? "Blockers canônicos: " + release.readiness.blockers.join(", ")
                      : "Nenhum blocker canônico pendente antes da liberação."}
                  </p>
                </div>
                {operationNotice && <div className="mt-4 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 text-xs text-emerald-300">{operationNotice}</div>}
                {operationsEditing && (
                  <div className="mt-4 rounded-xl border border-[#00b894]/40 bg-emerald-950/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-bold text-koma-foreground">Corrigir modalidades</h4>
                        <p className="mt-1 text-[11px] text-koma-muted">
                          Esta ação altera somente a política canônica de atendimento. Delivery, mesas e outras configurações especializadas continuam separadas e podem gerar blockers de readiness.
                        </p>
                      </div>
                      <button type="button" onClick={() => setOperationsEditing(false)} disabled={operationBusy} className="text-xs text-koma-muted">Cancelar</button>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {([
                        ["retirada", "Retirada"],
                        ["consumo_local", "Consumo no local"],
                        ["delivery", "Delivery"],
                      ] as Array<[OperationMode, string]>).map(([value, label]) => (
                        <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-xs text-koma-secondary">
                          <input
                            type="checkbox"
                            checked={operationModes.includes(value)}
                            onChange={() => toggleOperationMode(value)}
                            disabled={operationBusy}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <label className="mt-4 block text-xs text-koma-muted">
                      Motivo obrigatório
                      <textarea
                        rows={2}
                        value={operationReason}
                        onChange={event => setOperationReason(event.target.value)}
                        placeholder="Ex.: modalidade informada incorretamente durante a implantação."
                        disabled={operationBusy}
                        className="mt-1 w-full resize-none rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-koma-foreground"
                      />
                    </label>
                    {operationError && <div className="mt-3 rounded-lg border border-rose-900/50 bg-rose-950/20 p-3 text-xs text-rose-300">{operationError}</div>}
                    <div className="mt-4 flex justify-end">
                      <button type="button" onClick={() => void saveOperationModes()} disabled={operationBusy} className="rounded-lg bg-[#00b894] px-4 py-2 text-xs font-black text-black disabled:opacity-50">
                        {operationBusy ? "Salvando…" : "Salvar modalidades"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : <p className="mt-4 text-xs text-koma-muted">Fonte de implantação indisponível.</p>}
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-xl border border-zinc-800 bg-koma-card p-5">
              <h3 className="text-sm font-bold text-koma-foreground">Resumo essencial</h3>
              {release ? (
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
              ) : <p className="mt-4 text-xs text-koma-muted">Fonte de implantação indisponível.</p>}
            </div>

            <div className="rounded-xl border border-zinc-800 bg-koma-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="flex items-center gap-2 text-sm font-bold text-koma-foreground"><CalendarClock className="h-4 w-4 text-violet-300" /> Período grátis</h3><p className="mt-1 text-xs text-koma-muted">Só começa após a liberação comercial; é separado de suspensão, cobrança SaaS e Mercado Pago.</p></div>
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
              <div className="flex flex-wrap gap-2">
                {linkedContract && access?.users.some(user => user.role === "admin" && user.status === "pendente_ativacao") && (
                  <button type="button" onClick={() => void reissueActivationInvite()} disabled={inviteBusy} className="rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs font-bold text-amber-300 disabled:opacity-50">
                    {inviteBusy ? "Reemitindo…" : "Reemitir convite inicial"}
                  </button>
                )}
                <button type="button" onClick={onOpenTeamControls} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-bold text-koma-secondary">Gerenciar acessos</button>
              </div>
            </div>
            {inviteNotice && <div className="border-b border-emerald-900/40 bg-emerald-950/20 px-4 py-3 text-xs text-emerald-300">{inviteNotice}</div>}
            {inviteError && <div className="border-b border-rose-900/40 bg-rose-950/20 px-4 py-3 text-xs text-rose-300">{inviteError}</div>}
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
        <div className="space-y-5">
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
              <button type="button" onClick={openOperationsEditor} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#00b894]/50 bg-emerald-950/20 px-3 py-2 text-xs font-bold text-emerald-300"><Wrench className="h-4 w-4" /> Corrigir modalidades</button>
              <button type="button" onClick={() => onSupport(tenant)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs font-bold text-amber-300"><Headphones className="h-4 w-4" /> Modo suporte</button>
              <button type="button" onClick={() => onEdit(tenant)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-bold text-koma-secondary"><Pencil className="h-4 w-4" /> Editar cadastro e operação</button>
              {tenant.subdomain && <a href={"https://" + tenant.subdomain + ".komafood.com.br/"} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-bold text-koma-secondary"><ExternalLink className="h-4 w-4" /> Abrir cardápio público</a>}
            </div>
          </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-koma-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 p-4">
            <div>
              <h3 className="text-sm font-bold text-koma-foreground">Incidentes operacionais deste restaurante</h3>
              <p className="mt-1 text-[11px] text-koma-muted">Diagnóstico real por tenant: impressão, Mercado Pago, Outbox/integrações, acesso e estado do restaurante.</p>
            </div>
            <span className={
              "rounded-full border px-2.5 py-1 text-[10px] font-black " +
              (!incidentsAvailable
                ? "border-zinc-700 bg-zinc-900 text-koma-muted"
                : criticalIncidentCount > 0
                  ? "border-rose-800/60 bg-rose-950/30 text-rose-300"
                  : incidents.length > 0
                  ? "border-amber-800/60 bg-amber-950/30 text-amber-300"
                  : "border-emerald-800/60 bg-emerald-950/30 text-emerald-300")
            }>
              {!incidentsAvailable
                ? "Indisponível"
                : criticalIncidentCount > 0
                  ? criticalIncidentCount + " crítico(s)/alto(s)"
                  : incidents.length > 0
                    ? incidents.length + " incidente(s)"
                    : "Sem incidentes"}
            </span>
          </div>
          {!incidentsAvailable ? (
            <div className="p-6 text-xs text-koma-muted">A fonte de incidentes está indisponível. O painel não presume que o restaurante esteja saudável.</div>
          ) : incidents.length === 0 ? (
            <div className="p-6 text-xs text-emerald-300">Nenhum incidente foi detectado pelas fontes operacionais atuais.</div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {incidents.map(item => (
                <article key={item.id} className="p-4 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className="text-[9px] font-black uppercase tracking-wide text-koma-muted">{incidentSourceLabel(item.source)}</span>
                      <h4 className="mt-1 font-bold text-koma-foreground">{item.title}</h4>
                    </div>
                    <span className={"rounded-full border px-2 py-0.5 text-[9px] font-black uppercase " + incidentTone(item.severity)}>
                      {item.severity}
                    </span>
                  </div>
                  <p className="mt-2 leading-relaxed text-koma-secondary">{item.detail}</p>
                  <div className="mt-3 rounded-lg border border-zinc-800 bg-koma-page p-3">
                    <strong className="text-koma-foreground">Próximo passo</strong>
                    <p className="mt-1 text-koma-muted">{item.recommended_action}</p>
                    {item.last_seen_at && <p className="mt-1 text-[10px] text-koma-subtle">Último sinal: {formatDate(item.last_seen_at)}</p>}
                  </div>
                </article>
              ))}
            </div>
          )}
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
