import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  GitBranch,
  Globe,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
} from "lucide-react";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";

interface SuperAdminDevOpsProps {
  onAddLog: (text: string, type: "info" | "success" | "warning" | "error" | "critical") => void;
  onTriggerTelegramAlert: (text: string) => void;
}

interface IntegrationHealth {
  status?: string;
  source?: string;
  simulated?: boolean;
  latency_ms?: number;
}

interface DnsRecord {
  id?: string;
  name?: string;
  type?: string;
  content?: string;
  proxied?: boolean;
}

interface GithubRun {
  id: number | string;
  name?: string;
  head_branch?: string;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  updated_at?: string;
}

function healthLabel(health: IntegrationHealth | undefined): string {
  if (!health) return "NÃO CONSULTADO";
  if (health.status === "available") return "DISPONÍVEL";
  if (health.status === "configured_unverified") return "CONFIGURADO — NÃO VERIFICADO";
  if (health.status === "not_configured") return "NÃO CONFIGURADO";
  return (health.status || "INDISPONÍVEL").replaceAll("_", " ").toUpperCase();
}

function normalizeGithubRuns(payload: unknown): GithubRun[] {
  if (Array.isArray(payload)) return payload as GithubRun[];
  if (!payload || typeof payload !== "object") return [];
  const runs = (payload as { workflow_runs?: unknown }).workflow_runs;
  return Array.isArray(runs) ? runs as GithubRun[] : [];
}

export default function SuperAdminDevOps({ onAddLog, onTriggerTelegramAlert }: SuperAdminDevOpsProps) {
  const [health, setHealth] = useState<Record<string, IntegrationHealth>>({});
  const [healthError, setHealthError] = useState<string | null>(null);
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [dnsError, setDnsError] = useState<string | null>(null);
  const [githubRuns, setGithubRuns] = useState<GithubRun[]>([]);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [railwayError, setRailwayError] = useState<string | null>(null);
  const [railwayMetrics, setRailwayMetrics] = useState<Record<string, unknown> | null>(null);
  const [newSubdomain, setNewSubdomain] = useState("");
  const [isAddingDns, setIsAddingDns] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRestartConfirmation, setShowRestartConfirmation] = useState(false);

  const fetchHealth = async () => {
    try {
      const response = await superAdminFetch("/api/super-admin/integrations/health");
      setHealth(await response.json());
      setHealthError(null);
    } catch (error) {
      setHealth({});
      setHealthError(superAdminErrorMessage(error));
    }
  };

  const fetchDns = async () => {
    try {
      const response = await superAdminFetch("/api/super-admin/cloudflare/dns");
      const payload = await response.json();
      setDnsRecords(Array.isArray(payload) ? payload : []);
      setDnsError(null);
    } catch (error) {
      setDnsRecords([]);
      setDnsError(superAdminErrorMessage(error));
    }
  };

  const fetchGithub = async () => {
    try {
      const response = await superAdminFetch("/api/super-admin/github/runs");
      setGithubRuns(normalizeGithubRuns(await response.json()));
      setGithubError(null);
    } catch (error) {
      setGithubRuns([]);
      setGithubError(superAdminErrorMessage(error));
    }
  };

  const fetchRailway = async () => {
    try {
      const response = await superAdminFetch("/api/super-admin/railway/telemetry");
      setRailwayMetrics(await response.json());
      setRailwayError(null);
    } catch (error) {
      setRailwayMetrics(null);
      setRailwayError(superAdminErrorMessage(error));
    }
  };

  const refresh = async () => {
    setIsRefreshing(true);
    await Promise.all([fetchHealth(), fetchDns(), fetchGithub(), fetchRailway()]);
    setIsRefreshing(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const addDns = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const subdomain = newSubdomain.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(subdomain)) {
      setDnsError("Informe um hostname válido, sem protocolo ou caminho.");
      return;
    }

    setIsAddingDns(true);
    setDnsError(null);
    try {
      const response = await superAdminFetch("/api/super-admin/cloudflare/cname", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain }),
      });
      const payload = await response.json() as { success?: boolean; record?: DnsRecord };
      if (!payload.success || !payload.record) throw new Error("a API não confirmou a criação do CNAME");
      setNewSubdomain("");
      onAddLog(`Cloudflare confirmou o CNAME ${payload.record.name || subdomain}.`, "success");
      onTriggerTelegramAlert(`Cloudflare confirmou um novo CNAME: ${payload.record.name || subdomain}.`);
      await fetchDns();
    } catch (error) {
      const message = superAdminErrorMessage(error);
      setDnsError(message);
      onAddLog(`CNAME não criado: ${message}`, "error");
    } finally {
      setIsAddingDns(false);
    }
  };

  const restartRailway = async () => {
    setShowRestartConfirmation(false);
    setIsRestarting(true);
    try {
      const response = await superAdminFetch("/api/super-admin/railway/restart", { method: "POST" });
      const payload = await response.json() as { reboot_dispatched?: boolean };
      if (!payload.reboot_dispatched) throw new Error("o executor não confirmou a reinicialização");
      onAddLog("Railway confirmou o comando de reinicialização.", "success");
      onTriggerTelegramAlert("Railway confirmou uma reinicialização solicitada pelo SuperAdmin.");
      await fetchRailway();
    } catch (error) {
      const message = superAdminErrorMessage(error);
      setRailwayError(message);
      onAddLog(`Reinicialização não executada: ${message}`, "error");
    } finally {
      setIsRestarting(false);
    }
  };

  const dispatchGithub = async (branch: string) => {
    try {
      await superAdminFetch("/api/super-admin/github/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch }),
      });
      onAddLog(`GitHub confirmou o workflow para ${branch}.`, "success");
      onTriggerTelegramAlert(`GitHub confirmou um workflow para ${branch}.`);
      await fetchGithub();
    } catch (error) {
      const message = superAdminErrorMessage(error);
      setGithubError(message);
      onAddLog(`Workflow não disparado: ${message}`, "error");
    }
  };

  return (
    <div className="space-y-6" id="superadmin-devops-control">
      <header className="flex flex-col justify-between gap-4 rounded border border-[#1e293b]/40 bg-koma-card p-5 md:flex-row md:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-koma-foreground">
            <ShieldAlert className="h-4 w-4 text-[#00b894]" />
            Infraestrutura e integrações
          </h2>
          <p className="mt-1 text-xs text-koma-muted">Somente dados e ações confirmados pelas APIs configuradas.</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isRefreshing}
          className="flex items-center gap-2 rounded border border-[#334155] px-3 py-2 text-xs disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </header>

      {healthError && (
        <p className="rounded border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-200" role="status">
          Diagnóstico: {healthError}
        </p>
      )}

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" id="api-diagnostics-panel">
        {Object.entries(health).map(([name, item]) => (
          <div key={name} className="rounded border border-[#1e293b]/40 bg-koma-card p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-bold uppercase text-koma-foreground">{name}</span>
              <span className="rounded border border-amber-800 px-1.5 py-0.5 text-[8px] text-amber-300">
                {healthLabel(item)}
              </span>
            </div>
            <p className="mt-2 text-[10px] text-koma-muted">
              Fonte: {item.source || "não informada"}
              {typeof item.latency_ms === "number" ? ` · ${item.latency_ms} ms` : ""}
            </p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="rounded border border-[#1e293b]/40 bg-koma-card p-5" id="railway-panel">
          <h3 className="flex items-center gap-2 text-sm font-bold text-koma-foreground">
            <Server className="h-4 w-4" /> Railway
          </h3>
          {railwayError ? (
            <p className="my-5 rounded border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-200">{railwayError}</p>
          ) : (
            <pre className="my-5 max-h-48 overflow-auto rounded bg-black/30 p-3 text-[10px] text-koma-subtle">
              {JSON.stringify(railwayMetrics, null, 2)}
            </pre>
          )}
          <button
            type="button"
            disabled={isRestarting}
            onClick={() => setShowRestartConfirmation(true)}
            className="w-full rounded border border-red-900 bg-red-950/30 px-3 py-2 text-xs font-bold text-red-300 disabled:opacity-50"
          >
            {isRestarting ? "Solicitando..." : "Solicitar reinicialização"}
          </button>
        </section>

        <section className="rounded border border-[#1e293b]/40 bg-koma-card p-5" id="cloudflare-panel">
          <h3 className="flex items-center gap-2 text-sm font-bold text-koma-foreground">
            <Globe className="h-4 w-4" /> Cloudflare DNS
          </h3>
          <form onSubmit={addDns} className="my-4 flex gap-2">
            <input
              value={newSubdomain}
              onChange={event => setNewSubdomain(event.target.value)}
              disabled={isAddingDns}
              placeholder="app.exemplo.com"
              aria-label="Hostname CNAME"
              className="min-w-0 flex-1 rounded border border-[#334155] bg-black/30 px-3 py-2 text-xs"
            />
            <button type="submit" disabled={isAddingDns || !newSubdomain.trim()} className="rounded bg-[#00b894] p-2 text-black disabled:opacity-40">
              {isAddingDns ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </button>
          </form>
          {dnsError ? (
            <p className="rounded border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-200">{dnsError}</p>
          ) : dnsRecords.length === 0 ? (
            <p className="py-6 text-center text-xs text-koma-muted">Nenhum registro retornado pela API.</p>
          ) : (
            <ul className="max-h-56 space-y-2 overflow-auto">
              {dnsRecords.map(record => (
                <li key={record.id || `${record.name}-${record.content}`} className="rounded border border-[#1e293b]/40 p-3 text-xs">
                  <p className="font-bold text-koma-foreground">{record.name}</p>
                  <p className="mt-1 text-[10px] text-koma-muted">{record.type} → {record.content} · proxy {record.proxied ? "ativo" : "inativo"}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded border border-[#1e293b]/40 bg-koma-card p-5" id="github-panel">
          <h3 className="flex items-center gap-2 text-sm font-bold text-koma-foreground">
            <GitBranch className="h-4 w-4" /> GitHub Actions
          </h3>
          {githubError ? (
            <p className="my-4 rounded border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-200">{githubError}</p>
          ) : githubRuns.length === 0 ? (
            <p className="py-6 text-center text-xs text-koma-muted">Nenhum workflow retornado pela API.</p>
          ) : (
            <ul className="mt-4 max-h-72 space-y-2 overflow-auto">
              {githubRuns.slice(0, 20).map(run => (
                <li key={run.id} className="rounded border border-[#1e293b]/40 p-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-koma-foreground">{run.name || `Workflow ${run.id}`}</p>
                      <p className="mt-1 text-[10px] text-koma-muted">{run.head_branch || "branch não informada"} · {run.conclusion || run.status || "sem status"}</p>
                    </div>
                    {run.html_url && (
                      <a href={run.html_url} target="_blank" rel="noreferrer" aria-label="Abrir workflow no GitHub">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                  {run.head_branch && (
                    <button type="button" onClick={() => void dispatchGithub(run.head_branch!)} className="mt-2 text-[10px] text-[#00b894] underline">
                      Solicitar workflow_dispatch
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex items-start gap-2 rounded border border-amber-800/60 bg-amber-950/20 p-4 text-xs text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Deploy global, dispatch e reinicialização não são apresentados como ativos por configuração. Cada ação só é considerada concluída após confirmação explícita da API; respostas 501/503 permanecem indisponíveis.
      </div>

      {showRestartConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded border border-red-900 bg-koma-page p-5">
            <h3 className="flex items-center gap-2 font-bold text-red-300"><ShieldAlert className="h-5 w-5" /> Confirmar reinicialização</h3>
            <p className="mt-3 text-xs leading-relaxed text-koma-secondary">A operação pode interromper todos os restaurantes. O painel enviará uma solicitação; só registrará sucesso se o executor confirmar.</p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setShowRestartConfirmation(false)} className="rounded border border-[#334155] px-3 py-2 text-xs">Cancelar</button>
              <button type="button" onClick={() => void restartRailway()} className="rounded border border-red-800 bg-red-950 px-3 py-2 text-xs font-bold text-red-300">Confirmar solicitação</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
