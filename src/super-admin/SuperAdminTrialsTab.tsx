import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, RefreshCw, Search, Sparkles } from "lucide-react";
import { KomaSnapshotLoading } from "../components/shared/KomaSnapshotLoading";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";
import { SuperAdminTrialModal } from "./SuperAdminTrialModal";
import type { Tenant } from "./superAdminTypes";

type TrialStatus = "active" | "expired" | "ended" | "converted" | "not_started";

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

interface SuperAdminTrialsTabProps {
  tenants: Tenant[];
  globalSearch: string;
  refreshTenants: () => void;
}

const STATUS_LABELS: Record<TrialStatus, string> = {
  active: "Ativo",
  expired: "Expirado",
  ended: "Encerrado",
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

export function SuperAdminTrialsTab({ tenants, globalSearch, refreshTenants }: SuperAdminTrialsTabProps) {
  const [trials, setTrials] = useState<TrialRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localSearch, setLocalSearch] = useState("");
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);

  const loadTrials = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await superAdminFetch("/api/super-admin/trials");
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || "Não foi possível carregar os períodos grátis.");
      }
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error("A API retornou um formato inválido para os períodos grátis.");
      setTrials(payload as TrialRecord[]);
      setHasSnapshot(true);
    } catch (requestError) {
      setError(superAdminErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrials();
  }, [loadTrials]);

  const search = (globalSearch || localSearch).trim().toLowerCase();
  const filteredTrials = useMemo(() => trials.filter(item => {
    if (!search) return true;
    return item.restaurantName.toLowerCase().includes(search)
      || item.restaurantId.toLowerCase().includes(search)
      || Boolean(item.plan?.toLowerCase().includes(search))
      || item.trialStatus.toLowerCase().includes(search);
  }), [trials, search]);

  const summary = useMemo(() => ({
    active: trials.filter(item => item.trialStatus === "active").length,
    expiringSoon: trials.filter(item => item.trialStatus === "active" && item.daysRemaining <= 2).length,
    expired: trials.filter(item => item.trialStatus === "expired" || item.trialStatus === "ended").length,
    notStarted: trials.filter(item => item.trialStatus === "not_started").length,
  }), [trials]);

  const refreshAll = async () => {
    await loadTrials();
    refreshTenants();
  };

  if (!hasSnapshot) {
    return (
      <KomaSnapshotLoading
        testId="superadmin-trials-snapshot-loading"
        title="Sincronizando períodos grátis"
        description="Carregando o estado real dos trials antes de mostrar totais e vencimentos."
        error={!isLoading ? error : null}
        errorDescription="Ainda não foi possível confirmar os períodos grátis. O KÔMA não vai presumir totais zerados."
        onRetry={() => void loadTrials()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#1e293b] bg-koma-card p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-koma-foreground"><Sparkles className="h-5 w-5 text-violet-300" /> Períodos grátis</h2>
            <p className="mt-1 text-xs text-koma-muted">Controle central dos 7 dias grátis e exceções concedidas pelo Super Admin.</p>
          </div>
          <button type="button" onClick={() => void loadTrials()} disabled={isLoading} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-bold text-koma-secondary hover:text-koma-foreground disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} /> Atualizar</button>
        </div>

        <div className="mt-4 grid gap-3 border-t border-zinc-800 pt-4 sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-[10px] uppercase tracking-wide text-koma-muted">Ativos</span><p className="mt-1 text-xl font-bold text-emerald-300">{summary.active}</p></div>
          <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-[10px] uppercase tracking-wide text-koma-muted">Até 2 dias</span><p className="mt-1 text-xl font-bold text-amber-300">{summary.expiringSoon}</p></div>
          <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-[10px] uppercase tracking-wide text-koma-muted">Expirados/encerrados</span><p className="mt-1 text-xl font-bold text-koma-foreground">{summary.expired}</p></div>
          <div className="rounded-lg border border-zinc-800 bg-koma-page p-3"><span className="text-[10px] uppercase tracking-wide text-koma-muted">Sem trial</span><p className="mt-1 text-xl font-bold text-koma-foreground">{summary.notStarted}</p></div>
        </div>

        <div className="mt-4 rounded-lg border border-amber-800/40 bg-amber-950/20 p-3 text-[11px] leading-relaxed text-amber-100/75">
          O vencimento do trial <strong className="text-amber-200">não suspende automaticamente</strong> o restaurante e não representa inadimplência. Mercado Pago do Cardápio Online e futura cobrança da mensalidade SaaS permanecem fluxos separados.
        </div>
      </div>

      <div className="rounded-xl border border-[#1e293b] bg-koma-card shadow-sm">
        <div className="flex flex-col gap-3 border-b border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-koma-subtle" /><input value={localSearch} onChange={event => setLocalSearch(event.target.value)} placeholder="Buscar restaurante, ID, plano ou status..." className="w-full rounded-lg border border-zinc-800 bg-koma-page py-2 pl-9 pr-3 text-xs text-koma-foreground placeholder:text-koma-subtle focus:border-violet-600 focus:outline-none" /></div>
          <span className="text-[11px] text-koma-muted">{filteredTrials.length} de {trials.length} restaurantes</span>
        </div>

        {error ? (
          <div className="p-8 text-center text-xs text-rose-300"><p>{error}</p><button type="button" onClick={() => void loadTrials()} className="mt-3 rounded border border-rose-800 px-3 py-1.5 font-semibold">Tentar novamente</button></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-zinc-800 bg-koma-page/30 text-koma-muted"><th className="px-4 py-3">Restaurante</th><th className="px-4 py-3">Trial</th><th className="px-4 py-3">Restante</th><th className="px-4 py-3">Término</th><th className="px-4 py-3">Status SaaS</th><th className="px-4 py-3 text-right">Ação</th></tr></thead>
              <tbody className="divide-y divide-zinc-800/40">
                {filteredTrials.length === 0 ? (
                  <tr><td colSpan={6} className="p-10 text-center text-koma-muted">Nenhum período grátis encontrado.</td></tr>
                ) : filteredTrials.map(item => {
                  const tenant = tenants.find(entry => entry.id === item.restaurantId);
                  return (
                    <tr key={item.restaurantId} className="hover:bg-koma-page/40">
                      <td className="px-4 py-3.5"><p className="font-semibold text-koma-foreground">{item.restaurantName}</p><p className="font-mono text-[10px] text-koma-muted">#{item.restaurantId} · {item.plan || "plano não disponível"}</p></td>
                      <td className="px-4 py-3.5"><span className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-bold ${statusClasses(item.trialStatus)}`}>{STATUS_LABELS[item.trialStatus]}</span></td>
                      <td className="px-4 py-3.5 font-bold text-koma-foreground">{item.trialStatus === "active" ? `${item.daysRemaining} dia${item.daysRemaining === 1 ? "" : "s"}` : "—"}</td>
                      <td className="px-4 py-3.5 text-koma-muted">{formatDate(item.trialEndsAt)}</td>
                      <td className="px-4 py-3.5 text-koma-secondary">{item.saasStatus}</td>
                      <td className="px-4 py-3.5 text-right"><button type="button" disabled={!tenant} onClick={() => tenant && setSelectedTenant(tenant)} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-800/50 bg-violet-950/30 px-3 py-1.5 text-[11px] font-bold text-violet-200 hover:bg-violet-900/40 disabled:cursor-not-allowed disabled:opacity-40" title={tenant ? "Gerenciar período grátis" : "Tenant não disponível na fonte principal"}><CalendarClock className="h-3.5 w-3.5" /> Gerenciar</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedTenant && <SuperAdminTrialModal tenant={selectedTenant} onClose={() => setSelectedTenant(null)} onUpdated={() => void refreshAll()} />}
    </div>
  );
}

export default SuperAdminTrialsTab;
