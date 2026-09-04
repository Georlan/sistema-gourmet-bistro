import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";
import type { Tenant } from "./superAdminTypes";

type TrialStatus = "active" | "expired" | "ended" | "converted" | "not_started";
type TrialAction = "start" | "extend" | "end" | "renew";

type TrialRecord = {
  restaurantId: string;
  restaurantName: string;
  plan?: string | null;
  saasStatus: string;
  trialStatus: TrialStatus;
  trialStartedAt?: string | null;
  trialEndsAt?: string | null;
  daysRemaining: number;
};

interface SuperAdminTrialModalProps {
  tenant: Tenant;
  onClose: () => void;
  onUpdated?: () => void;
}

const STATUS_LABELS: Record<TrialStatus, string> = {
  active: "Trial ativo",
  expired: "Trial expirado",
  ended: "Encerrado manualmente",
  converted: "Convertido",
  not_started: "Não iniciado",
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR");
}

function statusClasses(status: TrialStatus) {
  if (status === "active") return "border-emerald-800/40 bg-emerald-950/40 text-emerald-300";
  if (status === "expired") return "border-amber-800/40 bg-amber-950/40 text-amber-300";
  if (status === "converted") return "border-sky-800/40 bg-sky-950/40 text-sky-300";
  return "border-zinc-700 bg-zinc-900 text-koma-secondary";
}

function availableActions(status: TrialStatus): TrialAction[] {
  if (status === "not_started") return ["start"];
  if (status === "active") return ["extend", "end"];
  return ["renew"];
}

function actionLabel(action: TrialAction) {
  if (action === "start") return "Iniciar trial";
  if (action === "extend") return "Estender trial";
  if (action === "end") return "Encerrar agora";
  return "Renovar trial";
}

function actionDescription(action: TrialAction) {
  if (action === "start") return "Concede uma nova janela gratuita para um restaurante sem trial anterior.";
  if (action === "extend") return "Adiciona dias ao período atual sem interromper o acesso.";
  if (action === "end") return "Encerra o período grátis agora, sem suspender o restaurante.";
  return "Abre uma nova janela gratuita excepcional para um trial já encerrado ou expirado.";
}

export function SuperAdminTrialModal({ tenant, onClose, onUpdated }: SuperAdminTrialModalProps) {
  const [trial, setTrial] = useState<TrialRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<TrialAction | null>(null);
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadTrial = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await superAdminFetch("/api/super-admin/trials");
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || "Não foi possível carregar o período grátis.");
      }
      const payload = await response.json() as TrialRecord[];
      const current = payload.find(item => item.restaurantId === tenant.id);
      setTrial(current || {
        restaurantId: tenant.id,
        restaurantName: tenant.name,
        plan: tenant.plan,
        saasStatus: tenant.status || "ACTIVE",
        trialStatus: "not_started",
        trialStartedAt: null,
        trialEndsAt: null,
        daysRemaining: 0,
      });
    } catch (error) {
      setLoadError(superAdminErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [tenant.id, tenant.name, tenant.plan, tenant.status]);

  useEffect(() => {
    void loadTrial();
  }, [loadTrial]);

  const actions = useMemo(
    () => availableActions(trial?.trialStatus || "not_started"),
    [trial?.trialStatus],
  );

  const chooseAction = (action: TrialAction) => {
    setSelectedAction(action);
    setDays(action === "extend" ? 1 : 7);
    setReason("");
    setActionError(null);
    setSuccessMessage(null);
  };

  const submitAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedAction) return;
    if (reason.trim().length < 3) {
      setActionError("Informe um motivo com pelo menos 3 caracteres para a auditoria.");
      return;
    }
    if (selectedAction !== "end" && (!Number.isInteger(days) || days < 1 || days > 90)) {
      setActionError("Informe entre 1 e 90 dias.");
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const response = await superAdminFetch(`/api/super-admin/trials/restaurantes/${tenant.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: selectedAction,
          ...(selectedAction === "end" ? {} : { days }),
          reason: reason.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || "Não foi possível atualizar o trial.");
      }
      setSuccessMessage(payload?.message || "Período grátis atualizado com sucesso.");
      setSelectedAction(null);
      setReason("");
      await loadTrial();
      onUpdated?.();
    } catch (error) {
      setActionError(superAdminErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[#1e293b] bg-koma-card p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
          <div className="flex gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-violet-800/50 bg-violet-950/30 text-violet-300">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-koma-foreground">Período grátis · {tenant.name}</h3>
              <p className="mt-1 text-[11px] text-koma-muted">Super Admin controla a janela gratuita sem criar cobrança SaaS.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-koma-subtle hover:text-koma-foreground" aria-label="Fechar controle de trial"><X className="h-5 w-5" /></button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-koma-muted"><RefreshCw className="h-4 w-4 animate-spin" /> Carregando trial...</div>
        ) : loadError ? (
          <div className="mt-5 rounded-lg border border-rose-800/50 bg-rose-950/30 p-4 text-xs text-rose-300">
            <p>{loadError}</p>
            <button type="button" onClick={() => void loadTrial()} className="mt-3 rounded border border-rose-700 px-2.5 py-1 font-semibold">Tentar novamente</button>
          </div>
        ) : trial ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-koma-page p-3 text-xs">
                <span className="text-koma-muted">Estado</span>
                <div className={`mt-1.5 inline-flex rounded border px-2 py-0.5 text-[11px] font-bold ${statusClasses(trial.trialStatus)}`}>{STATUS_LABELS[trial.trialStatus]}</div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-koma-page p-3 text-xs">
                <span className="text-koma-muted">Dias restantes</span>
                <p className="mt-1 text-lg font-bold text-koma-foreground">{trial.daysRemaining}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-koma-page p-3 text-xs">
                <span className="text-koma-muted">Status SaaS</span>
                <p className="mt-1 font-bold text-koma-foreground">{trial.saasStatus}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-koma-muted">Início</span><p className="mt-1 font-medium text-koma-secondary">{formatDate(trial.trialStartedAt)}</p></div>
              <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-koma-muted">Término</span><p className="mt-1 font-medium text-koma-secondary">{formatDate(trial.trialEndsAt)}</p></div>
            </div>

            <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3 text-[11px] leading-relaxed text-amber-100/75">
              <div className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /><p><strong className="text-amber-200">Trial e suspensão são controles separados.</strong> Expirar ou encerrar o período grátis não muda o status SaaS e não bloqueia o restaurante automaticamente. Suspensão continua sendo uma ação administrativa explícita.</p></div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-koma-muted">Ações disponíveis</p>
              <div className="flex flex-wrap gap-2">
                {actions.map(action => (
                  <button key={action} type="button" onClick={() => chooseAction(action)} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold ${action === "end" ? "border-rose-800/50 bg-rose-950/30 text-rose-300" : "border-violet-800/50 bg-violet-950/30 text-violet-200"}`}>
                    <CalendarClock className="h-3.5 w-3.5" /> {actionLabel(action)}
                  </button>
                ))}
              </div>
            </div>

            {selectedAction && (
              <form onSubmit={submitAction} className="space-y-3 rounded-lg border border-zinc-800 bg-koma-page p-4 text-xs">
                <div>
                  <p className="font-bold text-koma-foreground">{actionLabel(selectedAction)}</p>
                  <p className="mt-1 text-[10px] text-koma-muted">{actionDescription(selectedAction)}</p>
                </div>
                {selectedAction !== "end" && (
                  <label className="block"><span className="mb-1 block font-medium text-koma-secondary">Dias</span><input type="number" min={1} max={90} step={1} value={days} onChange={event => setDays(Number(event.target.value))} className="w-full rounded-lg border border-zinc-800 bg-koma-card p-2.5 text-koma-foreground focus:border-violet-600 focus:outline-none" /></label>
                )}
                <label className="block"><span className="mb-1 block font-medium text-koma-secondary">Motivo administrativo <span className="text-rose-400">*</span></span><textarea rows={3} value={reason} onChange={event => setReason(event.target.value)} required placeholder="Ex: Extensão de cortesia aprovada para conclusão da implantação." className="w-full rounded-lg border border-zinc-800 bg-koma-card p-2.5 text-koma-foreground placeholder:text-koma-subtle focus:border-violet-600 focus:outline-none" /><span className="mt-1 block text-[10px] text-koma-subtle">A ação e o motivo ficam registrados na auditoria imutável do Super Admin.</span></label>
                {actionError && <div role="alert" className="rounded border border-rose-800/50 bg-rose-950/30 p-2.5 text-rose-300">{actionError}</div>}
                <div className="flex justify-end gap-2"><button type="button" onClick={() => setSelectedAction(null)} disabled={isSubmitting} className="rounded border border-zinc-700 px-3 py-2 font-semibold text-koma-secondary disabled:opacity-50">Cancelar</button><button type="submit" disabled={isSubmitting} className={`rounded px-4 py-2 font-bold disabled:opacity-50 ${selectedAction === "end" ? "bg-rose-600 text-white" : "bg-violet-500 text-black"}`}>{isSubmitting ? "Processando..." : "Confirmar ação"}</button></div>
              </form>
            )}

            {successMessage && <div role="status" className="rounded-lg border border-emerald-800/40 bg-emerald-950/30 p-3 text-xs text-emerald-300">{successMessage}</div>}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end border-t border-zinc-800 pt-4"><button type="button" onClick={onClose} className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-koma-secondary hover:text-koma-foreground">Fechar</button></div>
      </div>
    </div>
  );
}

export default SuperAdminTrialModal;
