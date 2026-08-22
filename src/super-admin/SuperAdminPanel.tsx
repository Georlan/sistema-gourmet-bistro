import React, { useState, useEffect } from "react";
import { 
  Terminal, 
  ShieldAlert, 
  Building2, 
  Bell, 
  Cpu, 
  LogOut,
  Database,
  Key,
  Sliders
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import SuperAdminTenantControl, { Tenant } from "./SuperAdminTenantControl";
import SuperAdminTerminal, { FailedWebhook, SentryLog } from "./SuperAdminTerminal";
import SuperAdminDevOps from "./SuperAdminDevOps";
import SuperAdminTelegram, { TelegramAlert } from "./SuperAdminTelegram";
import SuperAdminDatabaseEditor from "./SuperAdminDatabaseEditor";
import SuperAdminCredentials from "./SuperAdminCredentials";
import SuperAdminWhitelabel from "./SuperAdminWhitelabel";
import {
  clearSuperAdminSession,
  publicApiFetch,
  superAdminErrorMessage,
  superAdminFetch,
} from "./superAdminApi";

type TabId = "metrics" | "webhooks" | "database" | "devops" | "telegram" | "credentials" | "whitelabel";

export interface ActiveDevice {
  restaurantId: string;
  restaurantName: string;
  device: "Painel do Caixa" | "Printer Gateway";
  status: "CONNECTED" | "DISCONNECTED";
  ip: string;
}

export default function SuperAdminPanel() {
  const frontendBuildSha = import.meta.env.VITE_BUILD_SHA || "não informado";
  const [activeTab, setActiveTab] = useState<TabId>("metrics");
  const [selectedWhitelabelTenantId, setSelectedWhitelabelTenantId] = useState<string>("");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantsAvailable, setTenantsAvailable] = useState(false);
  const [failedWebhooks, setFailedWebhooks] = useState<FailedWebhook[]>([]);
  const webhooksAvailable = false;
  const [sentryLogs, setSentryLogs] = useState<SentryLog[]>([]);
  const [telegramMessages, setTelegramMessages] = useState<TelegramAlert[]>([]);
  const [isLoadingTenants, setIsLoadingTenants] = useState(false);
  const [currentTime, setCurrentTime] = useState("");
  const [socketDevices, setSocketDevices] = useState<ActiveDevice[]>([]);
  const [flashAlert, setFlashAlert] = useState<{ id: string; title: string; message: string; timestamp: string; type: "sentry" | "webhook" } | null>(null);
  const [runtimeHealth, setRuntimeHealth] = useState<{ status: "ok" | "unavailable"; commit?: string | null } | null>(null);
  const [apiNotice, setApiNotice] = useState<string | null>(null);

  const reportApiError = (context: string, error: unknown) => {
    const message = `${context}: ${superAdminErrorMessage(error)}`;
    setApiNotice(message);
    console.warn(`[SUPERADMIN] ${message}`);
  };

  const fetchTenants = async () => {
    setIsLoadingTenants(true);
    try {
      const response = await superAdminFetch("/api/super-admin/restaurantes");
      if (response.ok) {
        const data = await response.json();
        setTenants(data);
        setTenantsAvailable(true);
      }
    } catch (err) {
      setTenants([]);
      setTenantsAvailable(false);
      reportApiError("Restaurantes indisponíveis", err);
    } finally {
      setIsLoadingTenants(false);
    }
  };

  const fetchSocketDevices = async () => {
    try {
      const response = await superAdminFetch("/api/super-admin/websocket-clients");
      if (response.ok) {
        const data = await response.json();
        setSocketDevices(data);
      }
    } catch (err) {
      reportApiError("Inventário WebSocket indisponível", err);
    }
  };

  const fetchActiveSentryIssue = async () => {
    try {
      const response = await superAdminFetch("/api/super-admin/sentry/issues");
      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          const firstIssue = data[0];
          setFlashAlert({
            id: firstIssue.id,
            title: "ERRO SENTRY ATIVO DETECTADO",
            message: `${firstIssue.title} - Arquivo: ${firstIssue.culprit} (${firstIssue.count} ocorrência(s))`,
            timestamp: new Date().toTimeString().split(" ")[0],
            type: "sentry"
          });
        } else {
          // Hide alert if it was a Sentry one
          setFlashAlert(prev => prev && prev.type === "sentry" ? null : prev);
        }
      }
    } catch (err) {
      reportApiError("Issues do Sentry indisponíveis", err);
    }
  };

  // Populate from authenticated HTTP endpoints. There is no SuperAdmin WebSocket
  // contract in the backend yet, so the UI must not connect to an invented channel.
  useEffect(() => {
    publicApiFetch("/health/live")
      .then(response => response.json())
      .then(data => setRuntimeHealth({ status: data.status === "ok" ? "ok" : "unavailable", commit: data.commit }))
      .catch(() => setRuntimeHealth({ status: "unavailable" }));
    fetchTenants();
    fetchSocketDevices();
    fetchActiveSentryIssue();

    const updateClock = () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hour = String(now.getHours()).padStart(2, "0");
      const min = String(now.getMinutes()).padStart(2, "0");
      const sec = String(now.getSeconds()).padStart(2, "0");
      setCurrentTime(`${year}-${month}-${day} ${hour}:${min}:${sec}`);
    };
    updateClock();
    const intervalId = setInterval(updateClock, 1000);

    // Poll only the authenticated sources exposed by the panel.
    const pollIntervalId = setInterval(() => {
      fetchSocketDevices();
      fetchActiveSentryIssue();
    }, 15000);

    return () => {
      clearInterval(intervalId);
      clearInterval(pollIntervalId);
    };
  }, []);

  const addSentryLog = (text: string, type: "info" | "success" | "warning" | "error" | "critical") => {
    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0];
    
    let level: "INFO" | "WARNING" | "ERROR" | "CRITICAL" = "INFO";
    if (type === "warning") level = "WARNING";
    if (type === "error") level = "ERROR";
    if (type === "critical") level = "CRITICAL";

    const newLog: SentryLog = {
      id: `log_man_${Date.now()}`,
      timestamp: timeStr,
      level,
      service: "SUPERADMIN-UI",
      message: text
    };
    setSentryLogs(prev => [...prev, newLog]);
  };

  const handleToggleTenantStatus = async (id: string, currentStatus: "ACTIVE" | "SUSPENDED" | "PENDING") => {
    const targetStatus = currentStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    try {
      await superAdminFetch(`/api/super-admin/restaurantes/${encodeURIComponent(id)}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus })
      });
      setTenants(prev => prev.map(t => t.id === id ? { ...t, status: targetStatus } : t));
      return true;
    } catch (err) {
      addSentryLog(`Status do restaurante não foi alterado: ${superAdminErrorMessage(err)}`, "error");
      return false;
    }
  };

  const handleForceConfirmWebhook = async (id: string): Promise<boolean> => {
    try {
      await superAdminFetch(`/api/super-admin/webhooks/asaas/${encodeURIComponent(id)}/confirm`, {
        method: "POST"
      });
      setFailedWebhooks(prev => prev.map(w => w.id === id ? { ...w, resolved: true } : w));
      return true;
    } catch (err) {
      addSentryLog(`Webhook não foi confirmado: ${superAdminErrorMessage(err)}`, "error");
      return false;
    }
  };

  const triggerTelegramAlert = async (text: string) => {
    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0].substring(0, 5);
    const newMsg: TelegramAlert = {
      id: `tg_${Date.now()}`,
      sender: "bot",
      text,
      timestamp: timeStr
    };
    try {
      const safeText = text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      const response = await superAdminFetch("/api/super-admin/telegram/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: safeText })
      });
      const data = await response.json() as { success?: boolean };
      if (!data.success) {
        throw new Error("o servidor não confirmou a entrega");
      }
      setTelegramMessages(prev => [...prev, newMsg]);
      addSentryLog("Telegram: mensagem entregue com sucesso via bot.", "success");
      return true;
    } catch (err) {
      addSentryLog(`Telegram: mensagem não enviada — ${superAdminErrorMessage(err)}`, "error");
      return false;
    }
  };

  return (
    <div className="min-h-screen bg-koma-page text-[#9ca3af] flex flex-col font-mono select-none border-4 border-[#121420] antialiased" id="superadmin-root">
      
      {/* Real-time Flashing Red Alerter */}
      <AnimatePresence>
        {flashAlert && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.98 }}
            className="bg-red-950 border-b-2 border-red-500 text-white font-mono text-xs px-6 py-3 flex items-center justify-between gap-4 animate-pulse shrink-0 shadow-[0_4px_20px_rgba(239,68,68,0.2)]"
          >
            <div className="flex items-center gap-3">
              <span className="bg-red-500 text-black px-1.5 py-0.5 rounded font-bold animate-pulse text-[10px]">
                LIVE_ALERT
              </span>
              <div>
                <span className="font-bold text-red-400">[{flashAlert.title}]</span>
                <p className="text-koma-secondary mt-0.5 font-sans">{flashAlert.message}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {flashAlert.type === "webhook" && (
                <button
                  onClick={async () => {
                    const confirmed = await handleForceConfirmWebhook(flashAlert.id);
                    if (confirmed) setFlashAlert(null);
                  }}
                  className="bg-red-600 hover:bg-red-700 text-white px-2.5 py-1 rounded font-bold text-[10px] transition-colors border border-red-400 cursor-pointer"
                >
                  RESOLVER E CONFIRMAR AGORA
                </button>
              )}
              <button
                onClick={() => setFlashAlert(null)}
                className="text-koma-subtle hover:text-koma-foreground font-bold underline text-[10px] px-2 py-1 cursor-pointer"
              >
                DESCARTAR
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {apiNotice && (
        <div className="flex items-center justify-between gap-4 border-b border-amber-700 bg-amber-950/40 px-6 py-2 text-xs text-amber-200" role="status">
          <span>{apiNotice}</span>
          <button type="button" className="underline" onClick={() => setApiNotice(null)}>fechar</button>
        </div>
      )}

      {/* Immersive UI Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between px-6 py-4 bg-koma-card border-b border-[#1e293b]/40 shadow-lg shrink-0 gap-4" id="superadmin-header">
        <div className="flex items-center space-x-4">
          <div className={`h-3 w-3 rounded-full ${runtimeHealth?.status === "ok" ? "bg-[#00b894] shadow-[0_0_8px_#00b894]" : "bg-amber-500"}`}></div>
          
          <div className="flex items-center gap-3">
            {/* Minimalist Dynamic SVG Kôma Logo */}
            <div className="flex items-center justify-center bg-[#00b894] text-black font-extrabold px-2.5 py-1 rounded text-[11px] tracking-widest font-sans shadow-[0_0_12px_rgba(0,184,148,0.35)] select-none">
              KÔMA
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter text-koma-foreground flex items-center gap-1.5">
                KÔMA <span className="text-[#00b894]">DATA</span> <span className="text-[10px] text-koma-muted font-normal tracking-normal uppercase">FE {frontendBuildSha}</span>
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <div className={`px-2 py-0.5 border text-[9px] rounded font-bold tracking-widest ${runtimeHealth?.status === "ok" ? "border-[#00b894] text-[#00b894]" : "border-amber-500 text-amber-400"}`}>
                  {runtimeHealth?.status === "ok" ? "PROCESSO HTTP: ATIVO" : "STATUS: NÃO VERIFICADO"}
                </div>
                <span className="text-[9px] text-[#9ca3af] uppercase font-sans tracking-wide">Kôma SaaS Core - Solopreneur Monitor</span>
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic Telemetry Stats */}
        <div className="flex space-x-6 md:space-x-8 text-[11px] font-mono text-[#9ca3af]">
          <div className="flex flex-col items-start md:items-end">
            <span className="text-koma-muted uppercase text-[9px] tracking-wider">Railway Node</span>
            <span className="text-koma-foreground font-bold">{runtimeHealth?.commit ? `BE ${runtimeHealth.commit}` : "NÃO INFORMADO"}</span>
          </div>
          <div className="flex flex-col items-start md:items-end">
            <span className="text-koma-muted uppercase text-[9px] tracking-wider">Memory</span>
            <span className="text-amber-400 font-bold">NÃO DISPONÍVEL</span>
          </div>
          <div className="flex flex-col items-start md:items-end">
            <span className="text-koma-muted uppercase text-[9px] tracking-wider">Server Time</span>
            <span className="text-koma-foreground font-mono font-bold tracking-tight">{currentTime || "NÃO INFORMADO"}</span>
          </div>
          <button
            type="button"
            onClick={() => clearSuperAdminSession()}
            className="flex items-center gap-1 self-center rounded border border-[#334155] px-2 py-1 text-[10px] text-koma-secondary hover:border-red-700 hover:text-red-300"
            title="Encerrar a sessão de SuperAdmin"
          >
            <LogOut className="h-3.5 w-3.5" />
            SAIR
          </button>
        </div>
      </header>

      {/* Main Grid View */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0" id="superadmin-body-container">
        
        {/* Left Sidebar Navigation */}
        <aside className="w-full md:w-64 bg-koma-card border-r border-[#1e293b]/40 flex flex-col justify-between shrink-0" id="superadmin-sidebar">
          {/* Top Nav List */}
          <div className="p-4 space-y-4">
            <div className="text-[10px] font-mono text-koma-muted uppercase tracking-widest px-2 font-bold">
              [SYSTEM_NAVIGATION]
            </div>
            
            <nav className="space-y-2">
              <button
                onClick={() => setActiveTab("metrics")}
                className={`w-full text-left font-mono text-xs px-3 py-2.5 rounded transition-all flex items-center justify-between cursor-pointer border ${
                  activeTab === "metrics" 
                    ? "bg-koma-page border-[#00b894] text-koma-foreground font-bold shadow-[0_0_8px_rgba(0,184,148,0.15)]" 
                    : "border-transparent text-koma-subtle hover:bg-koma-page/60 hover:text-koma-foreground"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Building2 className={`w-4 h-4 ${activeTab === "metrics" ? "text-[#00b894]" : "text-koma-muted"}`} />
                  [01] METRICS & CONTROLE
                </div>
              </button>

              <button
                onClick={() => setActiveTab("webhooks")}
                className={`w-full text-left font-mono text-xs px-3 py-2.5 rounded transition-all flex items-center justify-between cursor-pointer border ${
                  activeTab === "webhooks" 
                    ? "bg-koma-page border-[#00b894] text-koma-foreground font-bold shadow-[0_0_8px_rgba(0,184,148,0.15)]" 
                    : "border-transparent text-koma-subtle hover:bg-koma-page/60 hover:text-koma-foreground"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Terminal className={`w-4 h-4 ${activeTab === "webhooks" ? "text-[#00b894]" : "text-koma-muted"}`} />
                  [02] WEBHOOK TERMINAL
                </div>
              </button>

              <button
                onClick={() => setActiveTab("database")}
                className={`w-full text-left font-mono text-xs px-3 py-2.5 rounded transition-all flex items-center justify-between cursor-pointer border ${
                  activeTab === "database" 
                    ? "bg-koma-page border-[#00b894] text-koma-foreground font-bold shadow-[0_0_8px_rgba(0,184,148,0.15)]" 
                    : "border-transparent text-koma-subtle hover:bg-koma-page/60 hover:text-koma-foreground"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Database className={`w-4 h-4 ${activeTab === "database" ? "text-[#00b894]" : "text-koma-muted"}`} />
                  [03] DATABASE GRID EDITOR
                </div>
              </button>

              <button
                onClick={() => setActiveTab("devops")}
                className={`w-full text-left font-mono text-xs px-3 py-2.5 rounded transition-all flex items-center justify-between cursor-pointer border ${
                  activeTab === "devops" 
                    ? "bg-koma-page border-[#00b894] text-koma-foreground font-bold shadow-[0_0_8px_rgba(0,184,148,0.15)]" 
                    : "border-transparent text-koma-subtle hover:bg-koma-page/60 hover:text-koma-foreground"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Cpu className={`w-4 h-4 ${activeTab === "devops" ? "text-[#00b894]" : "text-koma-muted"}`} />
                  [04] ORQUESTRADOR INFRA
                </div>
              </button>

              <button
                onClick={() => setActiveTab("telegram")}
                className={`w-full text-left font-mono text-xs px-3 py-2.5 rounded transition-all flex items-center justify-between cursor-pointer border ${
                  activeTab === "telegram" 
                    ? "bg-koma-page border-[#00b894] text-koma-foreground font-bold shadow-[0_0_8px_rgba(0,184,148,0.15)]" 
                    : "border-transparent text-koma-subtle hover:bg-koma-page/60 hover:text-koma-foreground"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Bell className={`w-4 h-4 ${activeTab === "telegram" ? "text-[#00b894]" : "text-koma-muted"}`} />
                  [05] TELEGRAM ALERTS
                </div>
              </button>

              <button
                onClick={() => setActiveTab("credentials")}
                className={`w-full text-left font-mono text-xs px-3 py-2.5 rounded transition-all flex items-center justify-between cursor-pointer border ${
                  activeTab === "credentials" 
                    ? "bg-koma-page border-[#00b894] text-koma-foreground font-bold shadow-[0_0_8px_rgba(0,184,148,0.15)]" 
                    : "border-transparent text-koma-subtle hover:bg-koma-page/60 hover:text-koma-foreground"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Key className={`w-4 h-4 ${activeTab === "credentials" ? "text-[#00b894]" : "text-koma-muted"}`} />
                  [06] GERENCIAR CHAVES
                </div>
              </button>

              <button
                onClick={() => setActiveTab("whitelabel")}
                className={`w-full text-left font-mono text-xs px-3 py-2.5 rounded transition-all flex items-center justify-between cursor-pointer border ${
                  activeTab === "whitelabel" 
                    ? "bg-koma-page border-[#00b894] text-koma-foreground font-bold shadow-[0_0_8px_rgba(0,184,148,0.15)]" 
                    : "border-transparent text-koma-subtle hover:bg-koma-page/60 hover:text-koma-foreground"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Sliders className={`w-4 h-4 ${activeTab === "whitelabel" ? "text-[#00b894]" : "text-koma-muted"}`} />
                  [07] CONFIGURADOR WHITELABEL
                </div>
              </button>
            </nav>

            <div className="h-px bg-koma-raised my-4"></div>

            {/* Real-time WebSocket Devices Monitor Card */}
            <div className="bg-koma-page/60 border border-[#1e293b]/30 p-3 rounded font-mono text-[10px] space-y-2">
              <span className="text-[#00b894] block uppercase font-bold border-b border-[#1e293b]/30 pb-1.5 tracking-wider flex items-center justify-between">
                <span>[WEBSOCKET_DEVICES]</span>
                <span className="h-1.5 w-1.5 rounded-full bg-[#00b894] animate-ping"></span>
              </span>
              <div className="space-y-1.5 max-h-[140px] overflow-y-auto scrollbar-thin">
                {socketDevices.map((d) => {
                  const isConn = d.status === "CONNECTED";
                  return (
                    <div key={`${d.restaurantId}_${d.device}`} className="flex items-center justify-between border-b border-zinc-900/40 pb-1.5 last:border-0 last:pb-0">
                      <div>
                        <div className="font-bold text-koma-foreground text-[9px] truncate max-w-[100px]">{d.restaurantName}</div>
                        <div className="text-[8px] text-koma-muted">{d.device}</div>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            await superAdminFetch("/api/super-admin/websocket-clients/toggle", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ restaurantId: d.restaurantId, device: d.device })
                            });
                          } catch (e) {
                            reportApiError("Controle WebSocket indisponível", e);
                          }
                        }}
                        className={`px-1 py-0.5 rounded text-[8px] font-bold font-mono transition-all border cursor-pointer ${
                          isConn 
                            ? "bg-emerald-950/80 text-[#00b894] border-[#00b894]/30 hover:bg-red-950/50 hover:text-red-400 hover:border-red-900" 
                            : "bg-red-950/80 text-red-400 border-red-900/30 hover:bg-emerald-950/50 hover:text-[#00b894] hover:border-[#00b894]/30"
                        }`}
                        title="Clique para derrubar ou reconectar o dispositivo"
                      >
                        {isConn ? "ON" : "OFF"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Local Node Telemetry Box from the Cockpit Theme */}
            <div className="bg-koma-page/60 border border-[#1e293b]/30 p-3 rounded font-mono text-[10px] space-y-2">
              <span className="text-koma-muted block uppercase font-bold border-b border-[#1e293b]/30 pb-1.5 tracking-wider">[LOCAL_TELEMETRY]</span>
              <div className="flex justify-between">
                <span>FASTAPI PORT</span>
                <span className="text-koma-muted font-bold">NÃO VERIFICADO</span>
              </div>
              <div className="flex justify-between">
                <span>REDIS CACHE</span>
                <span className="text-koma-muted font-bold">NÃO VERIFICADO</span>
              </div>
              <div className="flex justify-between">
                <span>SENTRY STATUS</span>
                <span className="text-koma-muted font-bold">NÃO VERIFICADO</span>
              </div>
              <div className="flex justify-between">
                <span>SUPABASE PG</span>
                <span className="text-koma-muted font-bold">NÃO VERIFICADO</span>
              </div>
            </div>
          </div>

          {/* Bottom metadata */}
          <div className="p-4 border-t border-[#1e293b]/40 bg-black/20 font-mono text-[10px] text-koma-muted space-y-1">
            <p className="text-koma-foreground opacity-40 font-bold">KOMA DATA SERVICE</p>
            <p>BUILD: FINAL-RELEASE</p>
            <p className="text-[9px] text-slate-600">DevOps Workspace v2.4</p>
          </div>
        </aside>

        {/* Content Area with background container styling */}
        <main className="flex-1 bg-koma-page p-6 overflow-y-auto scrollbar-thin scrollbar-thumb-[#121420] scrollbar-track-transparent" id="superadmin-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.12 }}
              className="h-full"
            >
              {activeTab === "metrics" && (
                <SuperAdminTenantControl
                  tenants={tenants}
                  dataAvailable={tenantsAvailable}
                  onToggleStatus={handleToggleTenantStatus}
                  onAddLog={addSentryLog}
                  onTriggerTelegramAlert={triggerTelegramAlert}
                  refreshTenants={fetchTenants}
                  isLoading={isLoadingTenants}
                  onConfigureTenant={(id) => {
                    setSelectedWhitelabelTenantId(id);
                    setActiveTab("whitelabel");
                  }}
                  socketDevices={socketDevices}
                  failedWebhooks={failedWebhooks}
                  webhooksAvailable={webhooksAvailable}
                />
              )}

              {activeTab === "webhooks" && (
                <SuperAdminTerminal
                  failedWebhooks={failedWebhooks}
                  webhooksAvailable={webhooksAvailable}
                  onForceConfirmWebhook={handleForceConfirmWebhook}
                  sentryLogs={sentryLogs}
                  onAddLog={addSentryLog}
                  onTriggerTelegramAlert={triggerTelegramAlert}
                  onClearLogs={() => setSentryLogs([])}
                />
              )}

              {activeTab === "database" && (
                <SuperAdminDatabaseEditor
                  onAddLog={addSentryLog}
                  refreshTenantsList={fetchTenants}
                />
              )}

              {activeTab === "devops" && (
                <SuperAdminDevOps
                  onAddLog={addSentryLog}
                  onTriggerTelegramAlert={triggerTelegramAlert}
                />
              )}

              {activeTab === "telegram" && (
                <SuperAdminTelegram
                  telegramMessages={telegramMessages}
                  onTriggerTelegramAlert={triggerTelegramAlert}
                  onClearMessages={() => setTelegramMessages([])}
                />
              )}

              {activeTab === "credentials" && (
                <SuperAdminCredentials
                  onAddLog={addSentryLog}
                />
              )}

              {activeTab === "whitelabel" && (
                <SuperAdminWhitelabel
                  tenants={tenants}
                  selectedTenantId={selectedWhitelabelTenantId}
                  setSelectedTenantId={setSelectedWhitelabelTenantId}
                  onAddLog={addSentryLog}
                  onTriggerTelegramAlert={triggerTelegramAlert}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Immersive UI Bottom Status Footer */}
      <footer className="h-8 bg-koma-card border-t border-[#1e293b]/40 px-4 flex items-center justify-between text-[10px] text-koma-muted shrink-0 select-none font-mono" id="superadmin-footer">
        <div>
          SERVIÇOS: <span className="text-koma-muted font-bold">CONSULTE O DIAGNÓSTICO AUTENTICADO</span>
        </div>
        <div className="flex items-center space-x-4">
          <span>BUILD: <span className="text-koma-foreground font-bold">{frontendBuildSha}</span></span>
          <span className="text-koma-foreground opacity-40">KÔMA DATA CONSOLE</span>
        </div>
      </footer>
    </div>
  );
}
