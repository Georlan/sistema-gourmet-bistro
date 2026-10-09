import React, { useEffect, useRef, useState } from "react";
import {
  Wrench,
  Server,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  GitBranch,
  Globe,
  Database,
  HelpCircle,
  CheckCircle2,
} from "lucide-react";
import { publicApiFetch, superAdminFetch } from "./superAdminApi";
import type { IntegrationsHealthStatus } from "./superAdminTypes";


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
  head_sha?: string;
  created_at?: string;
}

function configuredLabel(status?: string) {
  if (status === "configured_unverified") return "Acesso configurado";
  if (status === "not_configured") return "Consulta administrativa não habilitada";
  return "Não verificado";
}

export function SuperAdminOperationsTab() {
  const [backendHealth, setBackendHealth] = useState<{ status: string; commit?: string; version?: string } | null>(null);
  const [integrationsHealth, setIntegrationsHealth] = useState<IntegrationsHealthStatus | null>(null);
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [githubRuns, setGithubRuns] = useState<GithubRun[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [githubStatus, setGithubStatus] = useState("Não verificado");
  const [dnsStatus, setDnsStatus] = useState("Não verificado");
  const loadingRef = useRef(false);

  const fetchOperationsData = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);
    setBackendHealth(null);
    setIntegrationsHealth(null);
    setGithubRuns([]);
    setDnsRecords([]);
    setGithubStatus("Consultando…");
    setDnsStatus("Não verificado");
    let health: IntegrationsHealthStatus | null = null;

    try {
      const res = await publicApiFetch("/health/live");
      setBackendHealth(res.ok ? await res.json() : { status: "unavailable" });
    } catch {
      setBackendHealth({ status: "unavailable" });
    }

    try {
      const res = await superAdminFetch("/api/super-admin/integrations/health");
      health = res.ok ? await res.json() : null;
      setIntegrationsHealth(health);
    } catch {
      setIntegrationsHealth(null);
    }

    if (health?.cloudflare?.status === "configured_unverified") {
      try {
        const res = await superAdminFetch("/api/super-admin/cloudflare/dns");
        if (!res.ok) throw new Error("DNS unavailable");
        const payload = await res.json();
        setDnsRecords(Array.isArray(payload) ? payload : payload.result || []);
        setDnsStatus("API respondeu");
      } catch {
        setDnsStatus("Consulta DNS não confirmada");
      }
    }

    try {
      const res = await superAdminFetch("/api/super-admin/github/runs");
      if (res.ok) {
        const payload = await res.json();
        setGithubRuns(Array.isArray(payload) ? payload : payload.workflow_runs || []);
        setGithubStatus("Consulta confirmada");
      } else {
        setGithubStatus("Consulta não confirmada");
      }
    } catch {
      setGithubStatus("Consulta não confirmada");
    }

    setIsLoading(false);
    loadingRef.current = false;
  };

  useEffect(() => {
    fetchOperationsData();
  }, []);

  const cloudflareConfigured = integrationsHealth?.cloudflare?.status === "configured_unverified";

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
            <button type="button" onClick={fetchOperationsData} disabled={isLoading} className="p-2 bg-koma-page border border-zinc-800 rounded-lg text-koma-secondary disabled:opacity-50" title="Atualizar diagnóstico">
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-koma-muted">Backend API</span><Server className="w-4 h-4 text-[#00b894]" /></div>
          <div className="flex items-center gap-2">
            {backendHealth?.status === "ok" ? <><CheckCircle2 className="w-4 h-4 text-emerald-400" /><span className="font-bold text-sm text-koma-foreground">Respondendo (live)</span></> : <><HelpCircle className="w-4 h-4 text-zinc-500" /><span className="font-bold text-sm text-koma-muted">Indisponível / não verificado</span></>}
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
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-koma-muted">Evolution / WhatsApp operacional</span><Globe className="w-4 h-4 text-koma-subtle" /></div>
          <div className="flex items-center gap-2">
            {integrationsHealth?.evolution?.status === "available" ? (
              <><CheckCircle2 className="w-4 h-4 text-emerald-400" /><span className="font-bold text-sm text-koma-foreground">Conectado</span></>
            ) : integrationsHealth?.evolution?.status === "degraded" ? (
              <><AlertTriangle className="w-4 h-4 text-amber-400" /><span className="font-bold text-sm text-amber-300">Degradado</span></>
            ) : integrationsHealth?.evolution?.status === "unavailable" ? (
              <><AlertTriangle className="w-4 h-4 text-rose-400" /><span className="font-bold text-sm text-rose-300">Indisponível</span></>
            ) : integrationsHealth?.evolution?.status === "not_configured" ? (
              <><HelpCircle className="w-4 h-4 text-zinc-500" /><span className="font-bold text-sm text-koma-muted">Não configurado</span></>
            ) : (
              <><HelpCircle className="w-4 h-4 text-zinc-500" /><span className="font-bold text-sm text-koma-muted">Não verificado</span></>
            )}
          </div>
          <p className="text-[11px] text-koma-subtle">
            {integrationsHealth?.evolution?.details?.details || "Sem diagnóstico de conexão carregado"}
          </p>
        </div>
      </div>

      <details className="rounded-xl border border-zinc-800 bg-koma-card p-4">
        <summary className="cursor-pointer text-sm font-bold">Hospedagem e DNS · consultas administrativas opcionais</summary>
        <p className="mt-2 text-xs text-koma-muted">A configuração dessas consultas não mede a disponibilidade do sistema. A saúde operacional aparece acima.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-koma-muted">Railway</span><Server className="w-4 h-4 text-koma-subtle" /></div>
          <div className="flex items-center gap-2"><HelpCircle className="w-4 h-4 text-zinc-500" /><span className="font-bold text-sm text-koma-muted">{integrationsHealth?.railway?.hosting_detected ? "Runtime Railway identificado" : "Hospedagem não verificada"}</span></div>
          <p className="text-[11px] text-koma-subtle">{configuredLabel(integrationsHealth?.railway?.status)}. Acesso à API administrativa é opcional e não determina saúde da hospedagem.</p>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-koma-muted">Cloudflare</span><Globe className="w-4 h-4 text-koma-subtle" /></div>
          <div className="flex items-center gap-2">
            {dnsStatus === "API respondeu" ? <><CheckCircle2 className="w-4 h-4 text-emerald-400" /><span className="font-bold text-sm text-koma-foreground">API respondeu</span></> : <><HelpCircle className="w-4 h-4 text-zinc-500" /><span className="font-bold text-sm text-koma-muted">{cloudflareConfigured ? dnsStatus : configuredLabel(integrationsHealth?.cloudflare?.status)}</span></>}
          </div>
          <p className="text-[11px] text-koma-subtle">{dnsStatus === "API respondeu" ? `${dnsRecords.length} registro(s) retornado(s)` : "Consulta DNS opcional; não mede a disponibilidade do frontend."}</p>
        </div>

        </div>
      </details>

      <div className={`grid grid-cols-1 gap-6 ${cloudflareConfigured ? "lg:grid-cols-2" : ""}`}>
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2"><GitBranch className="w-4 h-4 text-[#00b894]" /> GitHub Actions</h3>
            <span className="text-[11px] text-koma-muted">{githubStatus}</span>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto text-xs">
            {githubRuns.length === 0 ? <div className="py-6 text-center text-koma-muted">{githubStatus === "Consulta confirmada" ? "Nenhum workflow retornado." : "Histórico indisponível nesta consulta."}</div> : githubRuns.slice(0, 5).map(run => (
              <div key={run.id} className="p-3 bg-koma-page rounded-lg border border-zinc-800 flex items-center justify-between">
                <div><span className="font-semibold text-koma-foreground">{run.name || "Workflow"}</span><div className="text-[11px] text-koma-muted font-mono">{run.head_branch || "branch não informada"} · {run.head_sha?.slice(0, 12) || "SHA não informado"}</div>{run.created_at && <div className="text-[11px] text-koma-muted">{new Date(run.created_at).toLocaleString("pt-BR")}</div>}</div>
                <div className="flex items-center gap-2"><span className="text-[10px] text-koma-secondary">{run.conclusion || run.status || "desconhecido"}</span>{run.html_url && <a href={run.html_url} target="_blank" rel="noopener noreferrer" className="text-koma-subtle hover:text-[#00b894]"><ExternalLink className="w-3.5 h-3.5" /></a>}</div>
              </div>
            ))}
          </div>
        </div>

        {cloudflareConfigured && <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2"><Globe className="w-4 h-4 text-[#00b894]" /> DNS Cloudflare</h3>
            <span className="text-[11px] text-koma-muted">{dnsStatus}</span>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto text-xs">
            {dnsRecords.length === 0 ? <div className="py-6 text-center text-koma-muted">{dnsStatus === "API respondeu" ? "Nenhum registro retornado." : "Consulta DNS não confirmada."}</div> : dnsRecords.map(record => (
              <div key={record.id || record.name} className="p-2.5 bg-koma-page rounded-lg border border-zinc-800 flex items-center justify-between"><span className="font-mono text-koma-foreground">{record.name || "sem nome"}</span><span className="text-[10px] text-koma-muted">{record.type || "?"} • {record.proxied ? "proxied" : "DNS only"}</span></div>
            ))}
          </div>
        </div>}
      </div>

    </div>
  );
}

export default SuperAdminOperationsTab;
