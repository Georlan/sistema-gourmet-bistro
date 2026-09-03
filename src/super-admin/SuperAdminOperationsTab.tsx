import React, { useState, useEffect } from "react";
import {
  Wrench,
  Server,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  GitBranch,
  Globe,
  Database,
  Power,
  X,
  HelpCircle,
} from "lucide-react";
import { superAdminErrorMessage, superAdminFetch, publicApiFetch } from "./superAdminApi";
import type { IntegrationsHealthStatus } from "./superAdminTypes";

interface SuperAdminOperationsTabProps {
  onAddLog: (
    text: string,
    level?: "INFO" | "WARNING" | "ERROR" | "CRITICAL" | "info" | "warning" | "error" | "critical" | "success",
    source?: string
  ) => void;
  onTriggerTelegramAlert: (text: string) => void;
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

export function SuperAdminOperationsTab({
  onAddLog,
  onTriggerTelegramAlert,
}: SuperAdminOperationsTabProps) {
  const [backendHealth, setBackendHealth] = useState<{ status: string; commit?: string; version?: string } | null>(null);
  const [integrationsHealth, setIntegrationsHealth] = useState<IntegrationsHealthStatus | null>(null);
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [githubRuns, setGithubRuns] = useState<GithubRun[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);

  const fetchOperationsData = async () => {
    setIsLoading(true);
    setOperationNotice(null);

    try {
      const res = await publicApiFetch("/health/live");
      if (res.ok) {
        setBackendHealth(await res.json());
      } else {
        setBackendHealth({ status: "unavailable" });
      }
    } catch {
      setBackendHealth({ status: "unavailable" });
    }

    try {
      const resHealth = await superAdminFetch("/api/super-admin/integrations/health");
      if (resHealth.ok) {
        setIntegrationsHealth(await resHealth.json());
      } else {
        setIntegrationsHealth(null);
      }
    } catch {
      setIntegrationsHealth(null);
    }

    try {
      const resDns = await superAdminFetch("/api/super-admin/cloudflare/dns");
      if (resDns.ok) {
        setDnsRecords(await resDns.json());
      } else {
        setDnsRecords([]);
      }
    } catch {
      setDnsRecords([]);
    }

    try {
      const resRuns = await superAdminFetch("/api/super-admin/github/runs");
      if (resRuns.ok) {
        const payload = await resRuns.json();
        const runs = Array.isArray(payload) ? payload : payload.workflow_runs || [];
        setGithubRuns(runs);
      } else {
        setGithubRuns([]);
      }
    } catch {
      setGithubRuns([]);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchOperationsData();
  }, []);

  const handleRestart = async () => {
    setIsRestarting(true);
    setShowRestartModal(false);
    try {
      const response = await superAdminFetch("/api/super-admin/railway/restart", { method: "POST" });
      if (response.ok) {
        setOperationNotice("Reinicialização de emergência disparada com sucesso no Railway.");
        onAddLog("Reinicialização de emergência do servidor disparada no Railway.", "CRITICAL", "OPERATIONS");
        onTriggerTelegramAlert("🚨 ALERTA CRÍTICO: Reinicialização do servidor KÔMA disparada pelo SuperAdmin.");
      }
    } catch (err) {
      const msg = superAdminErrorMessage(err);
      setOperationNotice(`Falha na reinicialização: ${msg}`);
      onAddLog(`Falha ao disparar reinicialização: ${msg}`, "ERROR", "OPERATIONS");
    } finally {
      setIsRestarting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-koma-foreground flex items-center gap-2">
              <Wrench className="w-5 h-5 text-[#00b894]" />
              Operações & Manutenção da Plataforma
            </h2>
            <p className="text-xs text-koma-muted mt-0.5">
              Diagnóstico em tempo real baseado exclusivamente em evidência do backend
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowRestartModal(true)}
              className="px-3 py-2 bg-rose-950/70 hover:bg-rose-900/80 border border-rose-800/60 text-rose-300 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Power className="w-4 h-4" /> Reiniciar Servidor (Emergência)
            </button>

            <button
              type="button"
              onClick={fetchOperationsData}
              disabled={isLoading}
              className="p-2 bg-koma-page border border-zinc-800 hover:border-zinc-700 rounded-lg text-koma-secondary hover:text-koma-foreground transition-colors disabled:opacity-50 cursor-pointer"
              title="Atualizar diagnóstico"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {operationNotice && (
          <div className="p-3 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-koma-secondary flex items-center justify-between">
            <span>{operationNotice}</span>
            <button
              type="button"
              onClick={() => setOperationNotice(null)}
              className="text-koma-subtle hover:text-koma-foreground text-xs font-bold cursor-pointer"
            >
              fechar
            </button>
          </div>
        )}
      </div>

      {/* Services Health Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Backend FastAPI */}
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Backend API (Live)</span>
            <Server className="w-4 h-4 text-[#00b894]" />
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${backendHealth?.status === "ok" ? "bg-emerald-400" : "bg-amber-400"}`}></span>
            <span className="font-bold text-sm text-koma-foreground">
              {backendHealth?.status === "ok" ? "Online / Saudável" : "Indisponível / Desconhecido"}
            </span>
          </div>
          <p className="text-[11px] text-koma-subtle font-mono">
            Commit: {backendHealth?.commit || "desconhecido"} (v{backendHealth?.version || "3.5"})
          </p>
        </div>

        {/* Postgres (Supabase) */}
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Postgres (Supabase)</span>
            <Database className="w-4 h-4 text-[#00b894]" />
          </div>
          <div className="flex items-center gap-2">
            {integrationsHealth?.database?.status === "available" ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span className="font-bold text-sm text-koma-foreground">Disponível</span>
              </>
            ) : integrationsHealth?.database?.status === "unavailable" ? (
              <>
                <span className="w-2 h-2 rounded-full bg-rose-400"></span>
                <span className="font-bold text-sm text-rose-300">Indisponível</span>
              </>
            ) : (
              <>
                <HelpCircle className="w-4 h-4 text-zinc-500" />
                <span className="font-bold text-sm text-koma-muted">Não verificado</span>
              </>
            )}
          </div>
          <p className="text-[11px] text-koma-subtle">
            {integrationsHealth?.database?.latency_ms != null
              ? `Latência: ${integrationsHealth.database.latency_ms}ms`
              : "Isolamento transacional por tenant"}
          </p>
        </div>

        {/* Railway / Cloud Infrastructure */}
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Railway Host</span>
            <Server className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-center gap-2">
            {integrationsHealth?.railway?.status === "configured" ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span className="font-bold text-sm text-koma-foreground">Configurado</span>
              </>
            ) : (
              <>
                <HelpCircle className="w-4 h-4 text-zinc-500" />
                <span className="font-bold text-sm text-koma-muted">Sem telemetria</span>
              </>
            )}
          </div>
          <p className="text-[11px] text-koma-subtle">
            Ambiente passionate-truth
          </p>
        </div>

        {/* Cloudflare Edge */}
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Cloudflare Edge / DNS</span>
            <Globe className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex items-center gap-2">
            {integrationsHealth?.cloudflare?.status === "configured" || dnsRecords.length > 0 ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span className="font-bold text-sm text-koma-foreground">Configurado</span>
              </>
            ) : (
              <>
                <HelpCircle className="w-4 h-4 text-zinc-500" />
                <span className="font-bold text-sm text-koma-muted">Não verificado</span>
              </>
            )}
          </div>
          <p className="text-[11px] text-koma-subtle">
            {dnsRecords.length > 0 ? `${dnsRecords.length} registro(s) mapeado(s)` : "Domínios e rotas"}
          </p>
        </div>
      </div>

      {/* Deployment Runs & Cloudflare Records */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* GitHub CI/CD Runs */}
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-[#00b894]" /> Histórico de CI / Deployments (GitHub)
            </h3>
            <span className="text-[11px] text-koma-muted">Branch main</span>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto text-xs">
            {githubRuns.length === 0 ? (
              <div className="py-6 text-center text-koma-muted">
                Nenhum histórico de execução retornado pela API ou integração não configurada.
              </div>
            ) : (
              githubRuns.slice(0, 5).map(run => (
                <div key={run.id} className="p-3 bg-koma-page rounded-lg border border-zinc-800 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-koma-foreground">{run.name || "Quality Gate"}</span>
                    <div className="text-[11px] text-koma-muted font-mono">{run.head_branch || "main"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      run.conclusion === "success"
                        ? "bg-emerald-950/60 text-emerald-300 border border-emerald-800/30"
                        : "bg-zinc-800 text-koma-secondary"
                    }`}>
                      {run.conclusion || run.status || "COMPLETED"}
                    </span>
                    {run.html_url && (
                      <a
                        href={run.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-koma-subtle hover:text-[#00b894]"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* DNS Records */}
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#00b894]" /> Registros DNS do SaaS (Cloudflare)
            </h3>
            <span className="text-[11px] text-koma-muted">Proxy</span>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto text-xs">
            {dnsRecords.length === 0 ? (
              <div className="py-6 text-center text-koma-muted">
                Nenhum registro DNS carregado ou integração não configurada.
              </div>
            ) : (
              dnsRecords.map(d => (
                <div key={d.id || d.name} className="p-2.5 bg-koma-page rounded-lg border border-zinc-800 flex items-center justify-between">
                  <span className="font-mono text-koma-foreground">{d.name}</span>
                  <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded">{d.type} • {d.proxied ? "Proxied" : "DNS Only"}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Emergency Restart Modal */}
      {showRestartModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-koma-card border border-rose-900/60 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-rose-400 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" /> Confirmar Reinicialização de Emergência
              </h3>
              <button
                type="button"
                onClick={() => setShowRestartModal(false)}
                className="text-koma-subtle hover:text-koma-foreground cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-koma-secondary">
              Esta ação enviará um comando de reboot imediato ao serviço Kôma no Railway.
              Um alerta crítico será transmitido ao canal de monitoramento do Telegram.
            </p>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowRestartModal(false)}
                className="px-3 py-2 bg-zinc-900 border border-zinc-700 text-koma-secondary hover:text-koma-foreground rounded-lg text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleRestart}
                disabled={isRestarting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isRestarting ? "Disparando..." : "Confirmar e Reiniciar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SuperAdminOperationsTab;
