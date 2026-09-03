import React, { useEffect, useState } from "react";
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
  CheckCircle2,
} from "lucide-react";
import { publicApiFetch, superAdminErrorMessage, superAdminFetch } from "./superAdminApi";
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
  proxied?: boolean;
}

interface GithubRun {
  id: number | string;
  name?: string;
  head_branch?: string;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
}

function configuredLabel(status?: string) {
  if (status === "configured_unverified") return "Configurado, não verificado";
  if (status === "not_configured") return "Não configurado";
  return "Não verificado";
}

export function SuperAdminOperationsTab({
  onAddLog,
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
      setBackendHealth(res.ok ? await res.json() : { status: "unavailable" });
    } catch {
      setBackendHealth({ status: "unavailable" });
    }

    try {
      const res = await superAdminFetch("/api/super-admin/integrations/health");
      setIntegrationsHealth(res.ok ? await res.json() : null);
    } catch {
      setIntegrationsHealth(null);
    }

    try {
      const res = await superAdminFetch("/api/super-admin/cloudflare/dns");
      if (res.ok) {
        const payload = await res.json();
        setDnsRecords(Array.isArray(payload) ? payload : payload.result || []);
      } else {
        setDnsRecords([]);
      }
    } catch {
      setDnsRecords([]);
    }

    try {
      const res = await superAdminFetch("/api/super-admin/github/runs");
      if (res.ok) {
        const payload = await res.json();
        setGithubRuns(Array.isArray(payload) ? payload : payload.workflow_runs || []);
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
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setOperationNotice("Comando de reinicialização aceito pelo backend.");
      onAddLog("Reinicialização de emergência solicitada ao Railway.", "CRITICAL", "OPERATIONS");
    } catch (err) {
      const msg = superAdminErrorMessage(err);
      setOperationNotice(`Reinicialização não confirmada: ${msg}`);
      onAddLog(`Falha ao solicitar reinicialização: ${msg}`, "ERROR", "OPERATIONS");
    } finally {
      setIsRestarting(false);
    }
  };

  const railwayConfigured = integrationsHealth?.railway?.status === "configured_unverified";
  const cloudflareConfigured = integrationsHealth?.cloudflare?.status === "configured_unverified";
  const githubConfigured = integrationsHealth?.github?.status === "configured_unverified";

  return (
    <div className="space-y-6">
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-koma-foreground flex items-center gap-2">
              <Wrench className="w-5 h-5 text-[#00b894]" />
              Operações & Manutenção
            </h2>
            <p className="text-xs text-koma-muted mt-0.5">Estado real quando existe prova; configuração não é tratada como saúde.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowRestartModal(true)}
              disabled={!railwayConfigured}
              className="px-3 py-2 bg-rose-950/70 border border-rose-800/60 text-rose-300 text-xs font-bold rounded-lg flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title={railwayConfigured ? "Solicitar reinicialização do backend" : "Integração Railway não configurada"}
            >
              <Power className="w-4 h-4" /> Reiniciar backend
            </button>
            <button type="button" onClick={fetchOperationsData} disabled={isLoading} className="p-2 bg-koma-page border border-zinc-800 rounded-lg text-koma-secondary disabled:opacity-50" title="Atualizar diagnóstico">
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        {operationNotice && <div className="p-3 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-koma-secondary">{operationNotice}</div>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-koma-muted">Backend API</span><Server className="w-4 h-4 text-[#00b894]" /></div>
          <div className="flex items-center gap-2">
            {backendHealth?.status === "ok" ? <><CheckCircle2 className="w-4 h-4 text-emerald-400" /><span className="font-bold text-sm text-koma-foreground">Saudável</span></> : <><HelpCircle className="w-4 h-4 text-zinc-500" /><span className="font-bold text-sm text-koma-muted">Indisponível / não verificado</span></>}
          </div>
          <p className="text-[11px] text-koma-subtle font-mono">Commit: {backendHealth?.commit || "desconhecido"} • versão {backendHealth?.version || "desconhecida"}</p>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-koma-muted">Banco de dados</span><Database className="w-4 h-4 text-[#00b894]" /></div>
          <div className="flex items-center gap-2">
            {integrationsHealth?.database?.status === "available" ? <><CheckCircle2 className="w-4 h-4 text-emerald-400" /><span className="font-bold text-sm text-koma-foreground">Disponível</span></> : integrationsHealth?.database?.status === "unavailable" ? <><AlertTriangle className="w-4 h-4 text-rose-400" /><span className="font-bold text-sm text-rose-300">Indisponível</span></> : <><HelpCircle className="w-4 h-4 text-zinc-500" /><span className="font-bold text-sm text-koma-muted">Não verificado</span></>}
          </div>
          <p className="text-[11px] text-koma-subtle">{integrationsHealth?.database?.latency_ms != null ? `SELECT 1 • ${integrationsHealth.database.latency_ms}ms` : "Sem medição"}</p>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-koma-muted">Railway</span><Server className="w-4 h-4 text-koma-subtle" /></div>
          <div className="flex items-center gap-2"><HelpCircle className="w-4 h-4 text-zinc-500" /><span className="font-bold text-sm text-koma-muted">{configuredLabel(integrationsHealth?.railway?.status)}</span></div>
          <p className="text-[11px] text-koma-subtle">A presença da API key não prova disponibilidade do serviço.</p>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-koma-muted">Cloudflare</span><Globe className="w-4 h-4 text-koma-subtle" /></div>
          <div className="flex items-center gap-2">
            {dnsRecords.length > 0 ? <><CheckCircle2 className="w-4 h-4 text-emerald-400" /><span className="font-bold text-sm text-koma-foreground">API respondeu</span></> : <><HelpCircle className="w-4 h-4 text-zinc-500" /><span className="font-bold text-sm text-koma-muted">{configuredLabel(integrationsHealth?.cloudflare?.status)}</span></>}
          </div>
          <p className="text-[11px] text-koma-subtle">{dnsRecords.length > 0 ? `${dnsRecords.length} registro(s) retornado(s)` : "Sem resposta de DNS carregada"}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2"><GitBranch className="w-4 h-4 text-[#00b894]" /> GitHub Actions</h3>
            <span className="text-[11px] text-koma-muted">{githubConfigured ? "Configurado" : "Não verificado"}</span>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto text-xs">
            {githubRuns.length === 0 ? <div className="py-6 text-center text-koma-muted">Nenhum workflow retornado.</div> : githubRuns.slice(0, 5).map(run => (
              <div key={run.id} className="p-3 bg-koma-page rounded-lg border border-zinc-800 flex items-center justify-between">
                <div><span className="font-semibold text-koma-foreground">{run.name || "Workflow"}</span><div className="text-[11px] text-koma-muted font-mono">{run.head_branch || "branch não informada"}</div></div>
                <div className="flex items-center gap-2"><span className="text-[10px] text-koma-secondary">{run.conclusion || run.status || "desconhecido"}</span>{run.html_url && <a href={run.html_url} target="_blank" rel="noopener noreferrer" className="text-koma-subtle hover:text-[#00b894]"><ExternalLink className="w-3.5 h-3.5" /></a>}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2"><Globe className="w-4 h-4 text-[#00b894]" /> DNS Cloudflare</h3>
            <span className="text-[11px] text-koma-muted">{cloudflareConfigured ? "Configurado" : "Não verificado"}</span>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto text-xs">
            {dnsRecords.length === 0 ? <div className="py-6 text-center text-koma-muted">Nenhum registro retornado.</div> : dnsRecords.map(record => (
              <div key={record.id || record.name} className="p-2.5 bg-koma-page rounded-lg border border-zinc-800 flex items-center justify-between"><span className="font-mono text-koma-foreground">{record.name || "sem nome"}</span><span className="text-[10px] text-koma-muted">{record.type || "?"} • {record.proxied ? "proxied" : "DNS only"}</span></div>
            ))}
          </div>
        </div>
      </div>

      {showRestartModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-koma-card border border-rose-900/60 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800"><h3 className="text-base font-bold text-rose-400 flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Reiniciar backend</h3><button type="button" onClick={() => setShowRestartModal(false)} className="text-koma-subtle hover:text-koma-foreground"><X className="w-5 h-5" /></button></div>
            <p className="text-xs text-koma-secondary">Esta ação solicita uma reinicialização real ao Railway. Use apenas em incidente operacional conhecido.</p>
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800"><button type="button" onClick={() => setShowRestartModal(false)} className="px-3 py-2 bg-zinc-900 border border-zinc-700 text-koma-secondary rounded-lg text-xs font-semibold">Cancelar</button><button type="button" onClick={handleRestart} disabled={isRestarting} className="px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">{isRestarting ? "Solicitando..." : "Confirmar reinicialização"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SuperAdminOperationsTab;
