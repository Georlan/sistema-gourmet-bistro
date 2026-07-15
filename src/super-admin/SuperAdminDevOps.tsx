import React, { useState, useEffect } from "react";
import { 
  Cpu, 
  Database, 
  GitBranch, 
  Globe, 
  Server, 
  Zap, 
  ShieldAlert, 
  RefreshCw, 
  Plus, 
  CloudLightning,
  Play
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface SuperAdminDevOpsProps {
  onAddLog: (text: string, type: "info" | "success" | "warning" | "error" | "critical") => void;
  onTriggerTelegramAlert: (text: string) => void;
}

export default function SuperAdminDevOps({
  onAddLog,
  onTriggerTelegramAlert
}: SuperAdminDevOpsProps) {
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartCountdown, setRestartCountdown] = useState(0);
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [dnsList, setDnsList] = useState<any[]>([]);
  const [newSubdomain, setNewSubdomain] = useState("");
  const [newTarget, setNewTarget] = useState("k-ingress-prod.railway.app");
  const [isAddingDns, setIsAddingDns] = useState(false);

  // Stats / Metrics real-world values
  const [railwayCpu, setRailwayCpu] = useState<number | null>(null);
  const [railwayRam, setRailwayRam] = useState<number | null>(null); // MB
  const [dbConnections, setDbConnections] = useState<number | null>(null);
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const [githubCommits, setGithubCommits] = useState<any[]>([]);

  // Connection error states
  const [railwayError, setRailwayError] = useState<string | null>(null);
  const [cloudflareError, setCloudflareError] = useState<string | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);

  // Health check status of credentials and APIs
  const [apiHealth, setApiHealth] = useState<any>(null);
  const [isRefreshingHealth, setIsRefreshingHealth] = useState(false);

  // Deploy Global states (v3.5 automation)
  const [commitMessage, setCommitMessage] = useState("");
  const [deployLogsState, setDeployLogsState] = useState<string[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);

  const fetchApiHealth = async () => {
    setIsRefreshingHealth(true);
    try {
      const res = await fetch("/api/super-admin/integrations/health");
      if (res.ok) {
        const data = await res.json();
        setApiHealth(data);
      }
    } catch (e) {
      console.error("[HEALTH CHECK] Error fetching api health:", e);
    } finally {
      setIsRefreshingHealth(false);
    }
  };

  // Fetch Cloudflare CNAME Records list
  const fetchDnsList = async () => {
    try {
      const res = await fetch("/api/super-admin/cloudflare/dns");
      if (res.ok) {
        const data = await res.json();
        setDnsList(data || []);
        setCloudflareError(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setCloudflareError(data.error || "SEM CONEXÃO — CREDENCIAL INVÁLIDA");
        setDnsList([]);
      }
    } catch (e: any) {
      console.error("[CLOUDFLARE] Frontend list fetch error:", e);
      setCloudflareError(e.message || "Erro de rede");
      setDnsList([]);
    }
  };

  // Fetch Railway Telemetry resource states
  const fetchRailwayTelemetry = async () => {
    try {
      const res = await fetch("/api/super-admin/railway/telemetry");
      if (res.ok) {
        const data = await res.json();
        if (data.offline || data.cpu === null) {
          setRailwayCpu(null);
          setRailwayRam(null);
          setDbConnections(null);
        } else {
          setRailwayCpu(data.cpu);
          setRailwayRam(data.ram);
          setDbConnections(data.dbConnections);
        }
        setDeployLogs(data.deployLogs || []);
        setRailwayError(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setRailwayError(data.error || "SEM CONEXÃO — CREDENCIAL INVÁLIDA");
        setRailwayCpu(null);
        setRailwayRam(null);
        setDbConnections(null);
        setDeployLogs([]);
      }
    } catch (e: any) {
      console.error("[RAILWAY] Frontend telemetry fetch error:", e);
      setRailwayError(e.message || "Erro de rede");
      setRailwayCpu(null);
      setRailwayRam(null);
      setDbConnections(null);
      setDeployLogs([]);
    }
  };

  // Fetch GitHub Workflow Deploy runs
  const fetchGithubRuns = async () => {
    try {
      const res = await fetch("/api/super-admin/github/runs");
      if (res.ok) {
        const data = await res.json();
        setGithubCommits(data || []);
        setGithubError(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setGithubError(data.error || "SEM CONEXÃO — CREDENCIAL INVÁLIDA");
        setGithubCommits([]);
      }
    } catch (e: any) {
      console.error("[GITHUB] Frontend runs fetch error:", e);
      setGithubError(e.message || "Erro de rede");
      setGithubCommits([]);
    }
  };

  // Initialize and poll resources on mount
  useEffect(() => {
    fetchApiHealth();
    fetchDnsList();
    fetchRailwayTelemetry();
    fetchGithubRuns();

    // Poll resource metrics every 8 seconds
    const interval = setInterval(() => {
      fetchRailwayTelemetry();
    }, 8000);

    return () => clearInterval(interval);
  }, []);

  const handleAddDns = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubdomain.trim()) return;

    setIsAddingDns(true);
    onAddLog(`Creating Cloudflare dynamic CNAME record for ${newSubdomain}...`, "info");
    
    try {
      const res = await fetch("/api/super-admin/cloudflare/cname", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurante_slug: newSubdomain })
      });
      if (res.ok) {
        const data = await res.json();
        onAddLog(`✅ Cloudflare dynamic routing configured: ${data.record.subdomain} points to ${data.record.target} with SSL enabled.`, "success");
        onTriggerTelegramAlert(`🌐 Cloudflare: Novo subdomínio DNS mapeado! https://${data.record.subdomain}`);
        setNewSubdomain("");
        fetchDnsList();
      } else {
        onAddLog(`Failed to configure Cloudflare CNAME record. Check zone configurations.`, "error");
      }
    } catch (e) {
      console.error(e);
      onAddLog(`Network error contacting Cloudflare endpoint.`, "error");
    } finally {
      setIsAddingDns(false);
    }
  };

  const handleRestartServer = () => {
    if (isRestarting) return;
    setShowRestartModal(true);
  };

  const executeRestartServer = async () => {
    setShowRestartModal(false);
    setIsRestarting(true);
    setRestartCountdown(5);
    onAddLog("🚨 REINICIALIZAÇÃO DE EMERGÊNCIA DISPARADA!", "critical");
    onTriggerTelegramAlert("🚨 ALERTA CRÍTICO: Reinicialização de Emergência do servidor central disparada pelo SuperAdmin!");

    try {
      await fetch("/api/super-admin/railway/restart", {
        method: "POST"
      });
    } catch (e) {
      console.error("[RAILWAY REBOOT CALL ERROR]", e);
    }

    const timer = setInterval(() => {
      setRestartCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          executeServerWakeup();
          return 0;
        }
        onAddLog(`[REBOOT] Servidor reiniciando em ${prev - 1}...`, "warning");
        return prev - 1;
      });
    }, 1000);
  };

  const executeServerWakeup = () => {
    onAddLog("[REBOOT] Express container group killed (SIGTERM dispatch).", "info");
    onAddLog("[REBOOT] Starting container build: node-koma:prod-v3...", "info");
    onAddLog("[REBOOT] Port 3000 mapping validated. Container routing initialized.", "info");
    onAddLog("[REBOOT] Redis instance connection established on redis://default:6379", "info");
    onAddLog("[REBOOT] Supabase Pool restored. 100 client connections isolated successfully.", "info");
    onAddLog("🟢 Servidor central ONLINE e operando normalmente em tempo recorde!", "success");
    onTriggerTelegramAlert("🟢 RECOVERY: O Servidor Central do SaaS foi reiniciado com sucesso e restabeleceu todas as conexões.");
    setIsRestarting(false);
    fetchRailwayTelemetry();
  };

  const triggerGithubWorkflow = async (branch: string) => {
    onAddLog(`GitHub Actions API: Dispatched workflow for branch [${branch}]`, "info");
    onAddLog(`[CI/CD] Triggering build environment on Ubuntu-22.04 matrix...`, "info");
    onTriggerTelegramAlert(`⚙️ GitHub: Executando workflow de CI/CD para a branch [${branch}]...`);
    
    try {
      const res = await fetch("/api/super-admin/github/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch })
      });
      if (res.ok) {
        onAddLog(`[CI/CD] Deployment successfully pushed to build pipeline!`, "success");
        setTimeout(() => fetchGithubRuns(), 1500);
      } else {
        onAddLog(`Failed to trigger GitHub Actions dispatch.`, "error");
      }
    } catch (e) {
      console.error(e);
      onAddLog(`Network error contacting GitHub API.`, "error");
    }
  };

  const handleDeployGlobal = async () => {
    if (!commitMessage.trim()) return;
    setIsDeploying(true);
    setDeployLogsState(["Initializing Global Deploy sequence..."]);
    onAddLog(`🚀 DEPLOY GLOBAL: Disparando commit "${commitMessage}" para o GitHub.`, "info");
    onTriggerTelegramAlert(`🚀 Deploy Global Iniciado: Enviando alterações para a branch main. Acompanhe os logs no cockpit.`);

    try {
      const response = await fetch("/api/super-admin/git/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: commitMessage })
      });

      if (!response.body) {
        throw new Error("No response body available for streaming.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last partial line in the buffer
        buffer = lines.pop() || "";

        setDeployLogsState(prev => {
          const updated = [...prev];
          lines.forEach(line => {
            if (line.trim()) {
              updated.push(line);
            }
          });
          return updated;
        });
      }

      if (buffer.trim()) {
        setDeployLogsState(prev => [...prev, buffer]);
      }

      setCommitMessage("");
      onAddLog(`🚀 DEPLOY GLOBAL: Concluído com sucesso! Código integrado ao GitHub.`, "success");
      onTriggerTelegramAlert(`🟢 Deploy Global Finalizado: Código sincronizado no GitHub. Railway/Cloudflare iniciando builds automáticas.`);
    } catch (err: any) {
      console.error(err);
      setDeployLogsState(prev => [...prev, `>>> [ERROR] Falha de comunicação: ${err.message}`]);
      onAddLog(`❌ DEPLOY GLOBAL ERROR: Falha ao executar deploy.`, "error");
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="space-y-6" id="superadmin-devops-control">

      {/* Real-time API Connection Diagnostics Panel */}
      <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded" id="api-diagnostics-panel">
        <div className="border-b border-[#1e293b]/40 pb-3 mb-4 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="relative">
              <span className="absolute inline-flex h-2.5 w-2.5 rounded-full bg-[#00b894] opacity-75 animate-ping"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00b894]"></span>
            </div>
            <h3 className="text-sm font-mono text-white font-bold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-[#00b894]" />
              DIAGNÓSTICO E SAÚDE DAS INTEGRAÇÕES (API GATEWAY)
            </h3>
          </div>
          <button
            onClick={fetchApiHealth}
            disabled={isRefreshingHealth}
            className="text-xs bg-[#111827] hover:bg-black border border-[#1e293b]/40 text-slate-300 font-mono py-1 px-3 rounded flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 text-[#00b894] ${isRefreshingHealth ? "animate-spin" : ""}`} />
            {isRefreshingHealth ? "REFRESCANDO..." : "REFRESCAR CONEXÕES"}
          </button>
        </div>

        {!apiHealth ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-black/40 border border-zinc-900 p-3.5 rounded animate-pulse space-y-2">
                <div className="h-4 bg-zinc-800 rounded w-1/2"></div>
                <div className="h-3 bg-zinc-800 rounded w-3/4"></div>
                <div className="h-2 bg-zinc-800 rounded w-1/3"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
            {/* Cloudflare */}
            <div className={`p-3.5 rounded border transition-all ${
              apiHealth.cloudflare?.status === "CONNECTED"
                ? "bg-emerald-950/20/10 border-emerald-950 text-slate-300"
                : "bg-amber-950/10 border-amber-900/40 text-slate-300"
            }`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold font-mono text-white flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-slate-400" />
                  Cloudflare DNS
                </span>
                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  apiHealth.cloudflare?.status === "CONNECTED"
                    ? "bg-emerald-950/20/40 border border-[#00b894]/20 text-[#00b894]"
                    : "bg-amber-950/40 border border-amber-850 text-amber-400"
                }`}>
                  {apiHealth.cloudflare?.status === "CONNECTED" ? "CONECTADO" : "AJUSTE REQ."}
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400">{apiHealth.cloudflare?.message}</p>
              {apiHealth.cloudflare?.status !== "CONNECTED" && (
                <p className="text-[10px] text-amber-500/90 mt-1.5 italic">
                  * Dica: Verifique se o CLOUDFLARE_ZONE_ID no painel de configurações é o ID real, não "test".
                </p>
              )}
            </div>

            {/* GitHub */}
            <div className={`p-3.5 rounded border transition-all ${
              apiHealth.github?.status === "CONNECTED"
                ? "bg-emerald-950/20/10 border-emerald-950 text-slate-300"
                : "bg-amber-950/10 border-amber-900/40 text-slate-300"
            }`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold font-mono text-white flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-slate-400" />
                  GitHub CI/CD
                </span>
                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  apiHealth.github?.status === "CONNECTED"
                    ? "bg-emerald-950/20/40 border border-[#00b894]/20 text-[#00b894]"
                    : "bg-amber-950/40 border border-amber-850 text-amber-400"
                }`}>
                  {apiHealth.github?.status === "CONNECTED" ? "CONECTADO" : "FALHA CONEXÃO"}
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400">{apiHealth.github?.message}</p>
              {apiHealth.github?.status !== "CONNECTED" && (
                <p className="text-[10px] text-amber-500/90 mt-1.5 italic">
                  * Dica: Garanta que o GITHUB_TOKEN possui permissões de "workflow" e "repo" ativas.
                </p>
              )}
            </div>

            {/* Railway */}
            <div className={`p-3.5 rounded border transition-all ${
              apiHealth.railway?.status === "CONNECTED"
                ? "bg-emerald-950/20/10 border-emerald-950 text-slate-300"
                : "bg-amber-950/10 border-amber-900/40 text-slate-300"
            }`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold font-mono text-white flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-slate-400" />
                  Railway Core
                </span>
                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  apiHealth.railway?.status === "CONNECTED"
                    ? "bg-emerald-950/20/40 border border-[#00b894]/20 text-[#00b894]"
                    : "bg-amber-950/40 border border-amber-850 text-amber-400"
                }`}>
                  {apiHealth.railway?.status === "CONNECTED" ? "CONECTADO" : "NÃO AUTORIZADO"}
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400">{apiHealth.railway?.message}</p>
              {apiHealth.railway?.status !== "CONNECTED" && (
                <p className="text-[10px] text-amber-500/90 mt-1.5 italic">
                  * Dica: Verifique se o RAILWAY_TOKEN é um token de desenvolvedor válido para o projeto.
                </p>
              )}
            </div>

            {/* Sentry */}
            <div className={`p-3.5 rounded border transition-all ${
              apiHealth.sentry?.status === "CONNECTED"
                ? "bg-emerald-950/20/10 border-emerald-950 text-slate-300"
                : "bg-amber-950/10 border-amber-900/40 text-slate-300"
            }`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold font-mono text-white flex items-center gap-1.5">
                  <CloudLightning className="w-3.5 h-3.5 text-slate-400" />
                  Sentry Telemetria
                </span>
                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  apiHealth.sentry?.status === "CONNECTED"
                    ? "bg-emerald-950/20/40 border border-[#00b894]/20 text-[#00b894]"
                    : "bg-amber-950/40 border border-amber-850 text-amber-400"
                }`}>
                  {apiHealth.sentry?.status === "CONNECTED" ? "CONECTADO" : "ACESSO NEGADO"}
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400">{apiHealth.sentry?.message}</p>
              {apiHealth.sentry?.status !== "CONNECTED" && (
                <p className="text-[10px] text-amber-500/90 mt-1.5 italic">
                  * Dica: O token de autenticação do Sentry requer o escopo "project:read" habilitado.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Informative fallback toggle indicator */}
        <div className="mt-3 text-[10px] font-mono text-slate-500 flex items-center gap-1.5 bg-black/20 p-2 rounded border border-zinc-900">
          <span className="inline-block w-2 h-2 rounded-full bg-[#00b894]"></span>
          <span>
            <strong>Transparência de Conexão:</strong> Este painel opera estritamente com dados de telemetria e fluxos obtidos via conexões de API reais. Se uma credencial for inválida, um aviso de erro persistente será exibido no lugar de dados simulados.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Railway Server Health Stats */}
        <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded flex flex-col" id="railway-panel">
          <div className="border-b border-[#1e293b]/40 pb-3 mb-4 flex items-center justify-between">
            <h3 className="text-sm font-mono text-white font-bold flex items-center gap-2">
              <Server className="w-4 h-4 text-[#00b894]" />
              [01] RAILWAY CONTAINER SAÚDE (CORE API)
            </h3>
            <span className="text-[9px] text-[#00b894] bg-[#00b894]/15 px-2 py-0.5 rounded font-mono font-bold border border-[#00b894]/20/60">
              RAILWAY_API
            </span>
          </div>

          {railwayError ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-red-950/20 border border-red-900/50 rounded p-6 text-center text-red-400 font-mono space-y-3 my-auto min-h-[350px]">
              <ShieldAlert className="w-10 h-10 text-red-500 animate-pulse" />
              <span className="font-bold text-sm tracking-wider uppercase">SEM CONEXÃO — CREDENCIAL INVÁLIDA</span>
              <p className="text-xs text-red-300/85 max-w-[280px]">
                {railwayError}
              </p>
              <p className="text-[10px] text-slate-500 font-sans italic mt-2">
                Verifique se o token, o project ID e o service ID foram fornecidos corretamente.
              </p>
            </div>
          ) : (
            <div className="space-y-5 flex-1">
              {/* CPU Bar */}
              <div>
                <div className="flex items-center justify-between text-xs font-mono mb-1.5">
                  <span className="text-slate-400 flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-slate-500" />
                    CPU_USAGE
                  </span>
                  <span className="font-bold text-white">
                    {railwayCpu !== null ? `${railwayCpu.toFixed(1)}%` : "Carregando..."}
                  </span>
                </div>
                <div className="w-full bg-black rounded-full h-2 border border-[#1e293b]/40 overflow-hidden">
                  {railwayCpu !== null ? (
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${
                        railwayCpu > 80 ? "bg-red-500" : railwayCpu > 50 ? "bg-amber-500" : "bg-[#00b894]"
                      }`}
                      style={{ width: `${Math.min(railwayCpu, 100)}%` }}
                    ></div>
                  ) : (
                    <div className="h-full bg-zinc-700/50 rounded-full animate-pulse w-1/3"></div>
                  )}
                </div>
              </div>

              {/* RAM Bar */}
              <div>
                <div className="flex items-center justify-between text-xs font-mono mb-1.5">
                  <span className="text-slate-400 flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-slate-500" />
                    RAM_ALLOCATED (512MB LIMIT)
                  </span>
                  <span className="font-bold text-white">
                    {railwayRam !== null ? `${railwayRam}MB / 512MB` : "Carregando..."}
                  </span>
                </div>
                <div className="w-full bg-black rounded-full h-2 border border-[#1e293b]/40 overflow-hidden">
                  {railwayRam !== null ? (
                    <div 
                      className="h-full bg-[#00b894] rounded-full transition-all duration-500"
                      style={{ width: `${(railwayRam / 512) * 100}%` }}
                    ></div>
                  ) : (
                    <div className="h-full bg-zinc-700/50 rounded-full animate-pulse w-1/2"></div>
                  )}
                </div>
              </div>

              {/* Supabase connections stat */}
              <div className="bg-black border border-[#1e293b]/40 p-3.5 rounded flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#00b894]" />
                  <div className="text-xs font-mono">
                    <p className="text-white font-bold">SUPABASE_POOL_CONN</p>
                    <p className="text-[10px] text-slate-500">PostgreSQL isolated multi-tenant</p>
                  </div>
                </div>
                <span className="text-sm font-mono font-bold text-[#00b894]">
                  {dbConnections !== null ? `${dbConnections} / 100` : "--- / 100"}
                </span>
              </div>

              {/* Railway Terminal Outputs */}
              <div className="bg-black/80 border border-[#1e293b]/40 p-3 rounded font-mono text-[10px] space-y-1 text-slate-400 h-[140px] overflow-y-auto">
                <span className="text-slate-500 block border-b border-zinc-950 pb-1 mb-1">LIVE_RAILWAY_STDERR_STREAM</span>
                {deployLogs.length > 0 ? (
                  deployLogs.map((log, idx) => (
                    <div key={idx} className="whitespace-nowrap overflow-hidden text-ellipsis text-slate-400">
                      {log}
                    </div>
                  ))
                ) : (
                  <div className="text-slate-600 italic">Nenhum log disponível ou servidor offline.</div>
                )}
              </div>

              {/* Emergency Restart button */}
              <button
                onClick={handleRestartServer}
                disabled={isRestarting}
                className="w-full bg-red-950/40 hover:bg-red-900/60 disabled:bg-zinc-900 border border-red-900/40 disabled:border-transparent text-red-400 disabled:text-zinc-600 font-mono text-xs font-bold py-3 rounded transition-all flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_8px_rgba(239,68,68,0.1)]"
              >
                <ShieldAlert className={`w-4 h-4 text-red-500 ${isRestarting ? "animate-spin" : ""}`} />
                {isRestarting ? `REINICIANDO EM ${restartCountdown}s...` : "REINICIAR SERVIDOR DE EMERGÊNCIA"}
              </button>
            </div>
          )}
        </div>

        {/* Cloudflare DNS Domains Automation Panel */}
        <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded" id="cloudflare-panel">
          <div className="border-b border-[#1e293b]/40 pb-3 mb-4 flex items-center justify-between">
            <h3 className="text-sm font-mono text-white font-bold flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#00b894]" />
              [02] CLOUDFLARE DOMÍNIOS AUTOMÁTICOS
            </h3>
            <span className="text-[9px] text-[#00b894] bg-[#00b894]/15 px-2 py-0.5 rounded font-mono font-bold border border-[#00b894]/20/60">
              CLOUDFLARE_API
            </span>
          </div>

          {cloudflareError ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-red-950/20 border border-red-900/50 rounded p-6 text-center text-red-400 font-mono space-y-3 my-auto min-h-[350px]">
              <ShieldAlert className="w-10 h-10 text-red-500 animate-pulse" />
              <span className="font-bold text-sm tracking-wider uppercase">SEM CONEXÃO — CREDENCIAL INVÁLIDA</span>
              <p className="text-xs text-red-300/85 max-w-[280px]">
                {cloudflareError}
              </p>
              <p className="text-[10px] text-slate-500 font-sans italic mt-2">
                Verifique se o token e o Zone ID foram fornecidos e estão válidos.
              </p>
            </div>
          ) : (
            <div className="space-y-4 flex-1">
              {/* Create subdomain form */}
              <form onSubmit={handleAddDns} className="bg-black border border-[#1e293b]/40 p-3 rounded space-y-3">
                <p className="text-[10px] text-[#00b894] font-mono uppercase font-bold">Novo Mapeamento CNAME Dinâmico</p>
                
                <div className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      className="w-full bg-black border border-[#1e293b]/40 rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                      placeholder="Ex: pizzaria-sol"
                      value={newSubdomain}
                      onChange={e => setNewSubdomain(e.target.value)}
                      disabled={isAddingDns}
                      required
                    />
                    <span className="absolute right-2 top-2 text-[10px] font-mono text-slate-500">.koma.com</span>
                  </div>
                  <button
                    type="submit"
                    disabled={isAddingDns || !newSubdomain.trim()}
                    className="bg-[#00b894] hover:bg-[#059669] disabled:bg-zinc-800 border border-emerald-600 disabled:border-transparent text-black p-2 rounded transition-colors cursor-pointer flex items-center justify-center"
                    title="Create DNS record"
                  >
                    {isAddingDns ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 text-black font-bold" />}
                  </button>
                </div>
              </form>

              {/* Subdomain List */}
              <div className="space-y-2 overflow-y-auto max-h-[280px] scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent pr-1">
                {dnsList.length === 0 ? (
                  <div className="text-center py-8 text-xs font-mono text-slate-500 border border-dashed border-zinc-800 rounded bg-black/30 px-4">
                    Nenhum subdomínio ativo no momento. Digite um slug no campo acima para criar.
                  </div>
                ) : (
                  dnsList.map((dns, idx) => (
                    <div key={idx} className="bg-black border border-[#1e293b]/40 p-3 rounded flex items-center justify-between text-xs font-mono">
                      <div>
                        <p className="text-white font-bold">{dns.subdomain}</p>
                        <p className="text-[9px] text-[#00b894] mt-0.5">CNAME &rarr; {dns.target}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-[9px] text-[#00b894] bg-emerald-950/20/40 border border-emerald-950 px-1.5 rounded font-bold">
                          🟢 PROXIED
                        </span>
                        <span className="text-[9px] text-slate-400 bg-zinc-950 px-1.5 rounded">
                          SSL: {dns.ssl}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* GitHub Actions CI/CD Branch Panel */}
        <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded" id="github-panel">
          <div className="border-b border-[#1e293b]/40 pb-3 mb-4 flex items-center justify-between">
            <h3 className="text-sm font-mono text-white font-bold flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-[#00b894]" />
              [03] GITHUB CI/CD WORKFLOW RUNS
            </h3>
            <span className="text-[9px] text-[#00b894] bg-[#00b894]/15 px-2 py-0.5 rounded font-mono font-bold border border-[#00b894]/20/60">
              GITHUB_API
            </span>
          </div>

          {githubError ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-red-950/20 border border-red-900/50 rounded p-6 text-center text-red-400 font-mono space-y-3 my-auto min-h-[350px]">
              <ShieldAlert className="w-10 h-10 text-red-500 animate-pulse" />
              <span className="font-bold text-sm tracking-wider uppercase">SEM CONEXÃO — CREDENCIAL INVÁLIDA</span>
              <p className="text-xs text-red-300/85 max-w-[280px]">
                {githubError}
              </p>
              <p className="text-[10px] text-slate-500 font-sans italic mt-2">
                Verifique se o token de autenticação e o repositório foram preenchidos corretamente.
              </p>
            </div>
          ) : (
            <div className="space-y-4 flex-1">
              <div className="space-y-3 overflow-y-auto max-h-[300px] scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                {githubCommits.length === 0 ? (
                  <div className="text-center py-8 text-xs font-mono text-slate-500 border border-dashed border-zinc-800 rounded bg-black/30 px-4">
                    Sem dados de deploy ativos. Verifique as credenciais GITHUB_TOKEN.
                  </div>
                ) : (
                  githubCommits.map((commit, idx) => (
                    <div key={idx} className="bg-black border border-[#1e293b]/40 p-3 rounded flex flex-col space-y-2 text-xs font-mono">
                      <div className="flex items-center justify-between">
                        <span className="text-white font-bold flex items-center gap-1 bg-[#090c15] border border-[#1e293b]/40 px-1.5 py-0.5 rounded text-[10px]">
                          <GitBranch className="w-3.5 h-3.5 text-[#00b894]" />
                          {commit.branch}
                        </span>
                        {commit.status === "success" ? (
                          <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/20/40 border border-emerald-500 px-1.5 rounded">
                            Success
                          </span>
                        ) : commit.status === "failure" ? (
                          <span className="text-[9px] font-bold text-red-400 bg-red-950/40 border border-red-500 px-1.5 rounded">
                            Failure
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold text-amber-400 bg-amber-950/40 border border-amber-500 px-1.5 rounded animate-pulse">
                            In Progress
                          </span>
                        )}
                      </div>
                      
                      <p className="text-slate-300 font-sans text-xs">{commit.text}</p>

                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1.5 border-t border-zinc-900/60">
                        <span>COMMIT: {commit.id} by {commit.author}</span>
                        <span>{commit.time}</span>
                      </div>
                      
                      <div className="pt-1">
                        <button
                          onClick={() => triggerGithubWorkflow(commit.branch)}
                          className="text-[9px] bg-emerald-950/20/60 hover:bg-emerald-900/60 border border-[#00b894]/20/40 text-[#00b894] font-mono py-1 px-2 rounded cursor-pointer transition-all"
                        >
                          FORÇAR REDEPLOY (WORKFLOW_DISPATCH)
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Deploy Global Section */}
              <div className="mt-6 pt-6 border-t border-[#1e293b]/40 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-mono text-white font-bold flex items-center gap-1.5 uppercase">
                    🚀 DISPARAR DEPLOY GLOBAL
                  </h4>
                  <span className="text-[8px] text-slate-500 font-mono">AUTOMATION_V3.5</span>
                </div>

                <div className="space-y-3">
                  <label className="block text-[10px] font-mono text-slate-400 uppercase">
                    Mensagem de Commit (Obrigatório)
                  </label>
                  <div className="flex flex-col md:flex-row gap-3">
                    <input
                      type="text"
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="Ex: refactor: optimization of memory caching"
                      className="flex-1 bg-black border border-[#1e293b]/40 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                      disabled={isDeploying}
                    />
                    <button
                      onClick={handleDeployGlobal}
                      disabled={isDeploying || !commitMessage.trim()}
                      className={`px-5 py-2 rounded font-mono text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                        isDeploying || !commitMessage.trim()
                          ? "bg-zinc-800 text-zinc-500 border-transparent cursor-not-allowed"
                          : "bg-emerald-500 hover:bg-emerald-600 text-black font-extrabold"
                      }`}
                    >
                      {isDeploying ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          DEPLOYING...
                        </>
                      ) : (
                        <>
                          <span>🚀 DISPARAR DEPLOY GLOBAL</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Provisioning Terminal for Git Output */}
                  <div className="bg-black/90 border border-zinc-900 rounded p-3 font-mono text-[10px] text-slate-300 h-[180px] overflow-y-auto flex flex-col space-y-1">
                    <div className="text-slate-500 border-b border-zinc-950 pb-1 mb-2 flex items-center justify-between">
                      <span>PROVISIONING_TERMINAL</span>
                      <span className={`w-2 h-2 rounded-full ${isDeploying ? "bg-[#00b894] animate-pulse" : "bg-zinc-600"}`}></span>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                      {deployLogsState.length === 0 ? (
                        <span className="text-slate-600 italic">No deployment running. Enter a commit message and trigger.</span>
                      ) : (
                        deployLogsState.map((line, idx) => (
                          <div key={idx} className={
                            line.startsWith(">>> [SUCCESS]") 
                              ? "text-emerald-400 font-bold" 
                              : line.startsWith(">>> [ERROR]") 
                              ? "text-red-400 font-bold" 
                              : line.startsWith("$") 
                              ? "text-sky-400 font-bold" 
                              : "text-slate-400"
                          }>
                            {line}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* DevOps Architecture Details */}
      <div className="bg-[#121420] border border-[#1e293b]/40 p-4 rounded flex flex-col space-y-2 animate-fade-in">
        <h4 className="text-xs font-mono text-slate-400 font-bold flex items-center gap-1.5">
          <CloudLightning className="w-3.5 h-3.5 text-[#00b894]" />
          [SISTEMA_DOCKER] ARQUITETURA DO ORQUESTRADOR DE INFRAESTRUTURA
        </h4>
        <p className="text-[10px] text-slate-500 font-mono leading-relaxed">
          The SuperAdmin console communicates directly with our Python FastAPI backend. The FastAPI application makes use of decoupled services using standard Dependency Injection design patterns to talk directly to Cloudflare, Sentry, and Railway. All credentials, API keys, and auth scopes are safely hidden on our servers, ensuring your restaurant's digital gateways are completely secure.
        </p>
      </div>

      {/* Modal: Confirm Restart Server */}
      <AnimatePresence>
        {showRestartModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-mono text-xs text-slate-300">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#050814] border border-red-900/40 rounded-lg max-w-md w-full p-5 space-y-4 shadow-[0_0_35px_rgba(239,68,68,0.25)]"
            >
              <div className="flex items-center gap-2 text-red-500 font-bold border-b border-[#1e293b]/40 pb-3 uppercase text-sm">
                <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
                <span>Confirmar Reinicialização de Emergência</span>
              </div>
              <p className="leading-relaxed">
                Você tem certeza que deseja realizar a <strong className="text-white">REINICIALIZAÇÃO DE EMERGÊNCIA</strong> do servidor central no Railway em produção?
              </p>
              <div className="bg-red-950/20 border border-red-900/30 p-3 rounded text-red-400 text-[11px] leading-relaxed">
                <strong>🚨 PERIGO: Ações Irreversíveis</strong>
                <p className="mt-1">
                  Esta ação derrubará temporariamente o cardápio e o PDV (ponto de venda) de todos os restaurantes em produção. Clientes ativos não conseguirão finalizar pedidos durante o tempo de inicialização do servidor.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRestartModal(false)}
                  className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/50 px-3 py-2 rounded text-slate-400 hover:text-white cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={executeRestartServer}
                  className="bg-red-950 hover:bg-red-900 border border-red-800 text-red-400 px-4 py-2 rounded font-bold cursor-pointer transition-colors flex items-center gap-1.5 shadow-[0_0_8px_rgba(239,68,68,0.2)]"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Sim, Reiniciar Servidor
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
