import React, { useState, useEffect, useRef } from "react";
import { 
  Terminal as TerminalIcon, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Play, 
  Pause, 
  Trash2, 
  ShieldAlert, 
  Sparkles, 
  Send,
  Zap,
  Filter
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export interface FailedWebhook {
  id: string;
  tenantName: string;
  orderId: string;
  event: string;
  errorReason: string;
  amount: number;
  createdAt: string;
  resolved: boolean;
}

export interface SentryLog {
  id: string;
  timestamp: string;
  level: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  service: string;
  message: string;
}

export interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  count: number;
  permalink: string;
  level: string;
  status: string;
}

interface SuperAdminTerminalProps {
  failedWebhooks: FailedWebhook[];
  onForceConfirmWebhook: (id: string) => Promise<boolean>;
  sentryLogs: SentryLog[];
  onAddLog: (text: string, type: "info" | "success" | "warning" | "error" | "critical") => void;
  onTriggerTelegramAlert: (text: string) => void;
  onClearLogs: () => void;
}

export default function SuperAdminTerminal({
  failedWebhooks: initialWebhooks,
  onForceConfirmWebhook,
  sentryLogs,
  onAddLog,
  onTriggerTelegramAlert,
  onClearLogs
}: SuperAdminTerminalProps) {
  const [webhooks, setWebhooks] = useState<FailedWebhook[]>(initialWebhooks);
  const [logFilter, setLogFilter] = useState<string>("ALL");
  const [isStreamingLogs, setIsStreamingLogs] = useState(true);
  const [liveLogs, setLiveLogs] = useState<SentryLog[]>(sentryLogs);
  const terminalBottomRef = useRef<HTMLDivElement>(null);

  // Real Sentry issues integration state
  const [activeSentryTab, setActiveSentryTab] = useState<"stream" | "issues">("issues");
  const [sentryIssues, setSentryIssues] = useState<SentryIssue[]>([]);
  const [isLoadingIssues, setIsLoadingIssues] = useState(false);

  const fetchIssues = async () => {
    setIsLoadingIssues(true);
    try {
      const res = await fetch("/api/super-admin/sentry/issues");
      if (res.ok) {
        const data = await res.json();
        setSentryIssues(data);
      }
    } catch (e) {
      console.error("[SENTRY] Fetch issues frontend error:", e);
    } finally {
      setIsLoadingIssues(false);
    }
  };

  useEffect(() => {
    if (activeSentryTab === "issues") {
      fetchIssues();
    }
  }, [activeSentryTab]);

  const handleResolveIssue = async (id: string) => {
    onAddLog(`Silenciando exceção Sentry: ID ${id}...`, "warning");
    try {
      const res = await fetch(`/api/super-admin/sentry/issues/${id}/resolve`, {
        method: "PUT"
      });
      if (res.ok) {
        setSentryIssues(prev => prev.filter(issue => issue.id !== id));
        onAddLog(`✅ Exceção Sentry #${id} silenciada com sucesso na produção!`, "success");
        onTriggerTelegramAlert(`🤫 SILENCIADO: Erro #${id} foi silenciado via SuperAdmin.`);
      } else {
        onAddLog(`Failed to resolve Sentry issue. Check backend logs.`, "error");
      }
    } catch (e) {
      console.error(e);
      onAddLog(`Communication failure resolving Sentry issue.`, "error");
    }
  };

  useEffect(() => {
    setWebhooks(initialWebhooks);
  }, [initialWebhooks]);

  useEffect(() => {
    setLiveLogs(sentryLogs);
    if (isStreamingLogs && terminalBottomRef.current) {
      terminalBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [sentryLogs, isStreamingLogs]);

  // Handle the manual confirmation click
  const handleForceConfirm = async (webhook: FailedWebhook) => {
    onAddLog(`Forcing manual confirmation for webhook: ${webhook.id}`, "warning");
    const success = await onForceConfirmWebhook(webhook.id);
    if (success) {
      // Remove webhook or mark resolved
      setWebhooks(prev => prev.map(w => w.id === webhook.id ? { ...w, resolved: true } : w));
      onAddLog(`✅ Webhook ${webhook.id} successfully bypassed! Payment confirmed, order ${webhook.orderId} sent to cashier kitchen.`, "success");
      onTriggerTelegramAlert(`✅ BYPASS EFETUADO: Pedido ${webhook.orderId} (${webhook.tenantName}) liberado via SuperAdmin.`);
    } else {
      onAddLog(`Failed to force webhook confirmation. Check server logs.`, "error");
    }
  };

  const filteredLogs = liveLogs.filter(log => {
    if (logFilter === "ALL") return true;
    return log.level === logFilter;
  });

  return (
    <div className="space-y-6" id="superadmin-terminal-control">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Failed Webhooks Resolving Card */}
        <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded flex flex-col h-full animate-fade-in" id="failed-webhooks-panel">
          <div className="border-b border-[#1e293b]/40 pb-3 mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-mono text-white font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 animate-pulse" />
                [01] ASAAS WEBHOOK RESOLVER (FALHAS)
              </h3>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5">FORÇAR ASSINATURA MANUAL DE PAGAMENTOS</p>
            </div>
            <span className="text-[9px] text-red-400 bg-red-950/40 border border-red-900/60 px-2 py-0.5 rounded font-mono font-bold">
              {webhooks.filter(w => !w.resolved).length} ERROS ATIVOS
            </span>
          </div>

          <div className="space-y-4 overflow-y-auto flex-1 max-h-[450px] scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
            {webhooks.filter(w => !w.resolved).length === 0 ? (
              <div className="bg-emerald-950/20 border border-emerald-500/30 p-8 rounded-lg text-center my-4 animate-fade-in" id="webhooks-empty-state">
                <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-3 animate-bounce" />
                <h4 className="text-emerald-400 font-mono font-bold text-sm">
                  🎉 Fila de Webhooks limpa e operando em tempo real!
                </h4>
                <p className="text-[10px] text-emerald-600/80 font-mono mt-1">
                  Todos os pagamentos processados com sucesso pelo gateway Asaas.
                </p>
              </div>
            ) : (
              <AnimatePresence>
                {webhooks.map(wh => {
                  if (wh.resolved) return null;
                  return (
                    <motion.div
                      key={wh.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-black border border-[#1e293b]/40 rounded p-4 flex flex-col space-y-3 hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[10px] bg-red-950 text-red-400 border border-red-900 px-1.5 py-0.5 rounded font-bold font-mono">
                            {wh.event}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono ml-2">ID: {wh.id}</span>
                        </div>
                        <span className="font-bold text-white font-mono text-xs">
                          R$ {wh.amount.toFixed(2)}
                        </span>
                      </div>

                      <div className="text-xs font-sans text-slate-300">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-500 font-mono text-[10px]">INQUILINO:</span>
                          <span className="font-semibold text-white font-mono">{wh.tenantName}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-slate-500 font-mono text-[10px]">PEDIDO ID:</span>
                          <span className="font-mono bg-[#090c15] px-1.5 py-0.5 text-slate-300 rounded border border-[#1e293b]/40 text-[10px]">
                            {wh.orderId}
                          </span>
                        </div>
                        <div className="mt-2 text-[11px] font-mono text-red-400 bg-red-950/20 border border-red-900/30 p-2 rounded flex items-start gap-2">
                          <ShieldAlert className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold">CAUSA DO ERRO: </span>
                            {wh.errorReason}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-[#1e293b]/40">
                        <span className="text-[9px] text-slate-500 font-mono">OCORRIDO EM: {wh.createdAt}</span>
                        <button
                          onClick={() => handleForceConfirm(wh)}
                          className="bg-red-500 hover:bg-red-600 text-black font-mono font-bold text-[10px] px-3 py-1.5 rounded transition-all flex items-center gap-1.5 cursor-pointer shadow-[0_0_8px_rgba(239,68,68,0.2)]"
                        >
                          <Zap className="w-3.5 h-3.5 fill-black" />
                          FORÇAR CONFIRMAÇÃO MANUAL
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        </div>

        {/* Real-time Sentry Log Stream */}
        <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded flex flex-col h-full" id="sentry-stream-panel">
          <div className="border-b border-[#1e293b]/40 pb-3 mb-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-mono text-white font-bold flex items-center gap-2">
                <TerminalIcon className="w-4 h-4 text-[#00b894]" />
                [02] SENTRY REAL ISSUES & CENTRAL LOGS
              </h3>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5">EXCEÇÕES PRODUÇÃO E EVENTOS OPERACIONAIS</p>
            </div>

            {/* Elegant Tab Switcher */}
            <div className="flex bg-black border border-[#1e293b]/40 rounded p-0.5 self-start">
              <button
                onClick={() => setActiveSentryTab("issues")}
                className={`px-3 py-1.5 text-[9px] font-mono rounded cursor-pointer transition-all ${
                  activeSentryTab === "issues" 
                    ? "bg-[#00b894] text-black font-bold" 
                    : "text-slate-400 hover:text-white"
                }`}
              >
                SENTRY REAL ISSUES
              </button>
              <button
                onClick={() => setActiveSentryTab("stream")}
                className={`px-3 py-1.5 text-[9px] font-mono rounded cursor-pointer transition-all ${
                  activeSentryTab === "stream" 
                    ? "bg-[#00b894] text-black font-bold" 
                    : "text-slate-400 hover:text-white"
                }`}
              >
                LOCAL LOG STREAM
              </button>
            </div>

            {activeSentryTab === "stream" && (
              <div className="flex items-center gap-2">
                {/* Level Filter */}
                <div className="flex items-center gap-1 bg-black border border-[#1e293b]/40 rounded px-1.5 py-1">
                  <Filter className="w-3 h-3 text-slate-500" />
                  <select
                    className="bg-transparent border-none text-[10px] font-mono text-white focus:outline-none cursor-pointer"
                    value={logFilter}
                    onChange={e => setLogFilter(e.target.value)}
                  >
                    <option value="ALL">ALL LEVELS</option>
                    <option value="INFO">INFO</option>
                    <option value="WARNING">WARNING</option>
                    <option value="ERROR">ERROR</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>

                {/* Play / Pause stream */}
                <button
                  onClick={() => setIsStreamingLogs(!isStreamingLogs)}
                  className={`p-1.5 rounded border text-[10px] font-mono flex items-center gap-1 cursor-pointer transition-colors ${
                    isStreamingLogs 
                      ? "bg-emerald-950/20 border-[#00b894]/20/60 text-[#00b894]" 
                      : "bg-zinc-900 border-[#1e293b]/40 text-slate-400"
                  }`}
                  title={isStreamingLogs ? "Pause automatic scrolling" : "Enable automatic scrolling"}
                >
                  {isStreamingLogs ? (
                    <>
                      <Pause className="w-3 h-3 text-[#00b894] animate-pulse" />
                      LIVE
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3" />
                      PAUSED
                    </>
                  )}
                </button>

                {/* Clear logs */}
                <button
                  onClick={onClearLogs}
                  className="bg-zinc-900 border border-[#1e293b]/40 hover:border-[#334155] p-1.5 rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="Limpar logs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {activeSentryTab === "issues" ? (
            /* Real Sentry Issues Panel List */
            <div className="bg-black border border-[#1e293b]/40 rounded p-4 flex-1 flex flex-col font-mono text-xs overflow-hidden h-[360px]">
              <div className="flex items-center justify-between text-[10px] text-slate-500 border-b border-[#1e293b]/40 pb-2 mb-2 shrink-0">
                <span>API SENTRY CONECTADA & EXCEÇÕES</span>
                <button 
                  onClick={fetchIssues} 
                  className="text-[#00b894] hover:underline cursor-pointer"
                  disabled={isLoadingIssues}
                >
                  {isLoadingIssues ? "RECARREGANDO..." : "[SINCRONIZAR SENTRY]"}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3.5 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent pr-1">
                {isLoadingIssues ? (
                  <div className="text-zinc-500 text-center py-16 animate-pulse">
                    Conectando à API oficial do Sentry e extraindo exceções de produção...
                  </div>
                ) : sentryIssues.length === 0 ? (
                  <div className="text-zinc-600 italic text-center py-16">
                    🟢 Excelente! Nenhuma exceção não resolvida registrada na produção do Sentry.
                  </div>
                ) : (
                  sentryIssues.map(issue => {
                    const isCrit = issue.level === "fatal" || issue.level === "critical" || issue.title.includes("Timeout") || issue.title.includes("Refused") || issue.title.includes("Error");
                    return (
                      <div key={issue.id} className="bg-[#090c15] border border-[#1e293b]/40 hover:border-slate-700 p-3 rounded transition-all flex flex-col space-y-2">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase mr-1.5 border ${
                              isCrit 
                                ? "bg-red-950 text-red-400 border-red-900/60" 
                                : "bg-amber-950 text-amber-400 border-amber-900/60"
                            }`}>
                              {issue.level}
                            </span>
                            <span className="text-[9px] text-slate-500 font-mono">#{issue.id}</span>
                            <h4 className="font-bold text-slate-200 mt-1 font-sans text-xs leading-normal">
                              {issue.title}
                            </h4>
                          </div>
                          <span className="text-white bg-slate-900 px-1.5 py-0.5 rounded text-[10px] border border-slate-800 font-bold shrink-0">
                            {issue.count}x
                          </span>
                        </div>

                        <div className="text-[10px] text-slate-400 bg-[#090a0f]/60 p-2 rounded font-mono truncate border border-zinc-900/60">
                          <span className="text-slate-600">ARQUIVO: </span>
                          {issue.culprit}
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-[#1e293b]/40 gap-2 shrink-0">
                          <a
                            href={issue.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-[#00b894] transition-colors text-[9px] underline flex items-center gap-1"
                          >
                            VER DETALHES NO SENTRY &rarr;
                          </a>

                          <button
                            onClick={() => handleResolveIssue(issue.id)}
                            className="bg-red-950/60 hover:bg-red-900 text-red-400 border border-red-900/40 font-mono font-bold text-[9px] px-2.5 py-1 rounded transition-colors cursor-pointer"
                          >
                            SILENCIAR ERRO
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* Sentry Logs Console Terminal Window (Log Stream) */
            <div className="bg-black border border-[#1e293b]/40 rounded p-4 flex-1 flex flex-col font-mono text-xs overflow-hidden h-[360px]">
              <div className="flex items-center justify-between text-[10px] text-slate-500 border-b border-[#1e293b]/40 pb-2 mb-2">
                <span>SENTRY_ENGINE_v2.4_STREAMING</span>
                <span className="flex items-center gap-1 font-bold">
                  <span className={`w-1.5 h-1.5 rounded-full bg-red-500 ${isStreamingLogs ? "animate-ping" : ""}`}></span>
                  SENTRY_API_ONLINE
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                {filteredLogs.length === 0 ? (
                  <div className="text-zinc-600 italic text-center py-12">
                    No log entries matched your filter.
                  </div>
                ) : (
                  filteredLogs.map(log => {
                    let levelColor = "text-zinc-400";
                    if (log.level === "WARNING") levelColor = "text-amber-400 font-semibold";
                    if (log.level === "ERROR") levelColor = "text-red-400 font-bold";
                    if (log.level === "CRITICAL") levelColor = "text-purple-400 bg-purple-950/20 px-1 rounded border border-purple-950 font-black animate-pulse";

                    return (
                      <div key={log.id} className="hover:bg-zinc-950 p-1 rounded transition-colors text-[11px] leading-relaxed">
                        <span className="text-zinc-600">[{log.timestamp}]</span>{" "}
                        <span className={`${levelColor} font-mono`}>{log.level}</span>{" "}
                        <span className="text-zinc-500 font-semibold">&lt;{log.service}&gt;</span>{" "}
                        <span className="text-zinc-300 font-sans">{log.message}</span>
                      </div>
                    );
                  })
                )}
                <div ref={terminalBottomRef} />
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Real Sentry Integration Explanation */}
      <div className="bg-[#121420] border border-[#1e293b]/40 p-4 rounded flex flex-col space-y-2 animate-fade-in">
        <h4 className="text-xs font-mono text-slate-400 font-bold flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#00b894]" />
          [SISTEMA_DOCKER] INTEGRAÇÃO CENTRAL SENTRY & FASTAPI
        </h4>
        <p className="text-[10px] text-slate-500 font-mono leading-relaxed">
          The FastAPI backend imports the Sentry SDK. For any unhandled exception across your tenant schemas (e.g., PostgreSQL connection pools breaking, missing column references, printer gateway offline), Sentry catches the event, logs the stack trace, and instantly broadcasts the payload through our centralized logging service and pushes an alert directly to your Telegram Bot.
        </p>
      </div>
    </div>
  );
}
