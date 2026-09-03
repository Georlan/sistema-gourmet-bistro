import React, { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Store,
  CreditCard,
  ReceiptText,
  Wrench,
  History,
  Settings,
  LogOut,
  Search,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";
import type { Tenant, FailedWebhook } from "./superAdminTypes";
import {
  clearSuperAdminSession,
  publicApiFetch,
  superAdminErrorMessage,
  superAdminFetch,
} from "./superAdminApi";
import { SuperAdminOverviewTab } from "./SuperAdminOverviewTab";
import { SuperAdminTenantsTab } from "./SuperAdminTenantsTab";
import { SuperAdminPaymentsTab } from "./SuperAdminPaymentsTab";
import { SuperAdminBillingTab } from "./SuperAdminBillingTab";
import { SuperAdminOperationsTab } from "./SuperAdminOperationsTab";
import { SuperAdminAuditTab, type AuditLogItem } from "./SuperAdminAuditTab";
import { SuperAdminSettingsTab } from "./SuperAdminSettingsTab";

type TabId =
  | "overview"
  | "tenants"
  | "payments"
  | "billing"
  | "operations"
  | "audit"
  | "settings";

export default function SuperAdminPanel() {
  const frontendBuildSha = import.meta.env.VITE_BUILD_SHA || "75ac2e8";
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [globalSearch, setGlobalSearch] = useState("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantsAvailable, setTenantsAvailable] = useState(false);
  const [isLoadingTenants, setIsLoadingTenants] = useState(false);
  const [failedWebhooks, setFailedWebhooks] = useState<FailedWebhook[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [runtimeHealth, setRuntimeHealth] = useState<{ status: "ok" | "unavailable"; commit?: string | null; version?: string } | null>(null);
  const [apiNotice, setApiNotice] = useState<string | null>(null);

  const reportApiError = (context: string, error: unknown) => {
    const message = `${context}: ${superAdminErrorMessage(error)}`;
    setApiNotice(message);
    console.warn(`[SUPERADMIN] ${message}`);
  };

  const addAuditLog = (
    text: string,
    level: "INFO" | "WARNING" | "ERROR" | "CRITICAL" | "info" | "warning" | "error" | "critical" | "success" = "INFO",
    source: string = "CONSOLE"
  ) => {
    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0];
    let normalizedLevel: "INFO" | "WARNING" | "ERROR" | "CRITICAL" = "INFO";
    if (level === "WARNING" || level === "warning") normalizedLevel = "WARNING";
    else if (level === "ERROR" || level === "error") normalizedLevel = "ERROR";
    else if (level === "CRITICAL" || level === "critical") normalizedLevel = "CRITICAL";
    else normalizedLevel = "INFO";

    const newLog: AuditLogItem = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: timeStr,
      level: normalizedLevel,
      source,
      message: text,
    };
    setAuditLogs(prev => [newLog, ...prev.slice(0, 99)]);
  };

  const fetchTenants = async () => {
    setIsLoadingTenants(true);
    try {
      const response = await superAdminFetch("/api/super-admin/restaurantes");
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          setTenants(data);
          setTenantsAvailable(true);
        } else {
          setTenants([]);
          setTenantsAvailable(false);
        }
      } else {
        setTenants([]);
        setTenantsAvailable(false);
      }
    } catch {
      setTenants([]);
      setTenantsAvailable(false);
    } finally {
      setIsLoadingTenants(false);
    }
  };

  useEffect(() => {
    publicApiFetch("/health/live")
      .then(res => res.json())
      .then(data => setRuntimeHealth({ status: data.status === "ok" ? "ok" : "unavailable", commit: data.commit, version: data.version }))
      .catch(() => setRuntimeHealth({ status: "unavailable" }));

    fetchTenants();
    addAuditLog("Sessão autenticada de SuperAdmin iniciada.", "INFO", "AUTH");
  }, []);

  const handleToggleTenantStatus = async (id: string, currentStatus: "ACTIVE" | "SUSPENDED" | "PENDING") => {
    const targetStatus = currentStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    try {
      await superAdminFetch(`/api/super-admin/restaurantes/${encodeURIComponent(id)}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus })
      });
      setTenants(prev => prev.map(t => t.id === id ? { ...t, status: targetStatus } : t));
      addAuditLog(`Status do restaurante #${id} alterado para ${targetStatus}.`, "INFO", "TENANTS");
      return true;
    } catch (err) {
      reportApiError("Status do restaurante não foi alterado", err);
      return false;
    }
  };

  const handleForceConfirmWebhook = async (id: string): Promise<boolean> => {
    try {
      await superAdminFetch(`/api/super-admin/webhooks/asaas/${encodeURIComponent(id)}/confirm`, {
        method: "POST"
      });
      setFailedWebhooks(prev => prev.map(w => w.id === id ? { ...w, resolved: true } : w));
      addAuditLog(`Webhook #${id} confirmado manualmente.`, "INFO", "PAYMENTS");
      return true;
    } catch (err) {
      reportApiError("Webhook não foi confirmado", err);
      return false;
    }
  };

  const triggerTelegramAlert = async (text: string) => {
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
      addAuditLog(`Notificação entregue ao Telegram: ${text.substring(0, 40)}...`, "INFO", "TELEGRAM");
      return true;
    } catch (err) {
      reportApiError("Telegram: mensagem não enviada", err);
      return false;
    }
  };

  const navItems = [
    { id: "overview" as TabId, label: "Visão geral", icon: LayoutDashboard },
    { id: "tenants" as TabId, label: "Restaurantes", icon: Store },
    { id: "payments" as TabId, label: "Pagamentos online", icon: CreditCard },
    { id: "billing" as TabId, label: "Planos e cobrança", icon: ReceiptText },
    { id: "operations" as TabId, label: "Operações e manutenção", icon: Wrench },
    { id: "audit" as TabId, label: "Auditoria", icon: History },
    { id: "settings" as TabId, label: "Configurações", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-koma-page text-koma-foreground flex flex-col font-sans antialiased" id="superadmin-root">
      
      {/* Top Notice Bar if any error */}
      {apiNotice && (
        <div className="flex items-center justify-between gap-4 border-b border-amber-800/60 bg-amber-950/40 px-6 py-2 text-xs text-amber-200" role="status">
          <span>{apiNotice}</span>
          <button type="button" className="underline font-bold" onClick={() => setApiNotice(null)}>
            fechar
          </button>
        </div>
      )}

      {/* Main Header */}
      <header className="flex items-center justify-between px-6 py-3.5 bg-koma-card border-b border-[#1e293b] shrink-0 gap-4" id="superadmin-header">
        {/* Brand & Title */}
        <div className="flex items-center gap-3.5">
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-1.5 text-koma-muted hover:text-koma-foreground rounded-lg border border-zinc-800"
            aria-label="Abrir menu lateral"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#00b894] flex items-center justify-center font-black text-black text-sm tracking-tight shadow-sm select-none">
              K
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-koma-foreground tracking-tight">
                  Super Admin KÔMA
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800/40">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Online
                </span>
              </div>
              <p className="text-[11px] text-koma-muted hidden sm:block">
                Console Operacional Central • Produção
              </p>
            </div>
          </div>
        </div>

        {/* Global Search */}
        <div className="flex-1 max-w-md hidden md:block">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-koma-subtle" />
            <input
              type="text"
              placeholder="Buscar por restaurante, ID, admin ou slug..."
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              className="w-full bg-koma-page border border-zinc-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-koma-foreground placeholder:text-koma-subtle focus:outline-none focus:border-[#00b894]"
            />
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex flex-col items-end text-[11px] text-koma-muted font-mono">
            <span className="text-koma-foreground font-semibold">
              BE {runtimeHealth?.commit || "75ac2e8"} • FE {frontendBuildSha}
            </span>
            <span className="text-[10px] text-koma-subtle">passionate-truth / prod</span>
          </div>

          <div className="h-6 w-px bg-zinc-800 hidden lg:block"></div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-block px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-semibold text-koma-secondary">
              admin
            </span>

            <button
              type="button"
              onClick={() => clearSuperAdminSession()}
              className="px-3 py-1.5 bg-zinc-900 hover:bg-rose-950/50 border border-zinc-800 hover:border-rose-800/60 text-koma-secondary hover:text-rose-300 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Encerrar sessão de SuperAdmin"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sair</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Body with Sidebar + Content */}
      <div className="flex-1 flex min-h-0 relative" id="superadmin-body-container">
        
        {/* Left Sidebar Navigation */}
        <aside
          className={`w-64 bg-koma-card border-r border-[#1e293b] flex flex-col justify-between shrink-0 z-30 ${
            isMobileMenuOpen ? "absolute inset-y-0 left-0 shadow-2xl" : "hidden md:flex"
          }`}
          id="superadmin-sidebar"
        >
          <div className="p-3 space-y-1.5">
            <div className="px-3 py-2 text-[10px] font-bold text-koma-muted uppercase tracking-wider">
              Navegação
            </div>

            <nav className="space-y-1">
              {navItems.map(item => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setIsMobileMenuOpen(false);
                    }}
                    className={`w-full text-left text-xs font-semibold px-3 py-2.5 rounded-lg transition-all flex items-center justify-between cursor-pointer ${
                      isActive
                        ? "bg-[#00b894] text-black font-bold shadow-sm"
                        : "text-koma-secondary hover:bg-koma-page hover:text-koma-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className={`w-4 h-4 ${isActive ? "text-black" : "text-koma-muted"}`} />
                      <span>{item.label}</span>
                    </div>
                    {isActive && <ChevronRight className="w-3.5 h-3.5 text-black" />}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Sidebar Footer */}
          <div className="p-4 border-t border-zinc-800/80 bg-koma-page/40 text-[11px] text-koma-muted space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-koma-foreground">KÔMA SaaS Platform</span>
              <span className="text-[#00b894] font-bold">v3.5</span>
            </div>
            <p className="text-[10px] text-koma-subtle">Isolamento Multi-Tenant Garantido</p>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 bg-koma-page p-6 overflow-y-auto" id="superadmin-content">
          {activeTab === "overview" && (
            <SuperAdminOverviewTab
              tenants={tenants}
              tenantsAvailable={tenantsAvailable}
              isLoadingTenants={isLoadingTenants}
              refreshTenants={fetchTenants}
              onNavigateToTab={(tab) => setActiveTab(tab)}
              onToggleStatus={handleToggleTenantStatus}
              failedWebhooks={failedWebhooks}
              onForceConfirmWebhook={handleForceConfirmWebhook}
              globalSearch={globalSearch}
              runtimeHealth={runtimeHealth}
            />
          )}

          {activeTab === "tenants" && (
            <SuperAdminTenantsTab
              tenants={tenants}
              tenantsAvailable={tenantsAvailable}
              isLoading={isLoadingTenants}
              refreshTenants={fetchTenants}
              onToggleStatus={handleToggleTenantStatus}
              onAddLog={addAuditLog}
              onTriggerTelegramAlert={triggerTelegramAlert}
              globalSearch={globalSearch}
            />
          )}

          {activeTab === "payments" && (
            <SuperAdminPaymentsTab
              failedWebhooks={failedWebhooks}
              webhooksAvailable={failedWebhooks.length > 0}
              onForceConfirmWebhook={handleForceConfirmWebhook}
              onAddLog={addAuditLog}
              onTriggerTelegramAlert={triggerTelegramAlert}
            />
          )}

          {activeTab === "billing" && (
            <SuperAdminBillingTab
              tenants={tenants}
              tenantsAvailable={tenantsAvailable}
            />
          )}

          {activeTab === "operations" && (
            <SuperAdminOperationsTab
              onAddLog={addAuditLog}
              onTriggerTelegramAlert={triggerTelegramAlert}
            />
          )}

          {activeTab === "audit" && (
            <SuperAdminAuditTab
              logs={auditLogs}
              onClearLogs={() => setAuditLogs([])}
            />
          )}

          {activeTab === "settings" && (
            <SuperAdminSettingsTab
              onAddLog={addAuditLog}
              onTriggerTelegramAlert={triggerTelegramAlert}
            />
          )}
        </main>
      </div>
    </div>
  );
}
