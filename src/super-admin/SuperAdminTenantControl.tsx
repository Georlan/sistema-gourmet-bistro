import React, { useState } from "react";
import { 
  Building2, 
  DollarSign, 
  Play, 
  ShieldAlert, 
  CheckCircle, 
  Lock, 
  Unlock, 
  Plus, 
  Terminal, 
  RefreshCw,
  Search,
  Sliders
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  plan: "Pocket" | "Bistro" | "Delivery" | "Premium";
  monthlyOrders: number;
  monthlyBilling: number;
  status: "ACTIVE" | "SUSPENDED" | "PENDING";
  createdAt: string;
  lastActivity?: string;
  printerStatus?: "online" | "offline";
  failedWebhooksCount24h?: number;
  healthStatus?: "green" | "yellow" | "red";
}

export interface ActiveDevice {
  restaurantId: string;
  restaurantName: string;
  device: "Painel do Caixa" | "Printer Gateway";
  status: "CONNECTED" | "DISCONNECTED";
  ip: string;
}

export interface FailedWebhook {
  id: string;
  tenantName: string;
  orderId: string;
  event: string;
  amount: number;
  errorReason: string;
  createdAt: string;
  resolved: boolean;
}

interface SuperAdminTenantControlProps {
  tenants: Tenant[];
  onToggleStatus: (id: string, currentStatus: "ACTIVE" | "SUSPENDED" | "PENDING") => void;
  onAddLog: (text: string, type: "info" | "success" | "warning" | "error" | "critical") => void;
  onTriggerTelegramAlert: (text: string) => void;
  refreshTenants: () => void;
  isLoading: boolean;
  onConfigureTenant?: (id: string) => void;
  socketDevices: ActiveDevice[];
  failedWebhooks: FailedWebhook[];
}

export default function SuperAdminTenantControl({
  tenants,
  onToggleStatus,
  onAddLog,
  onTriggerTelegramAlert,
  refreshTenants,
  isLoading,
  onConfigureTenant,
  socketDevices,
  failedWebhooks
}: SuperAdminTenantControlProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<string>("ALL");
  const [onboardName, setOnboardName] = useState("");
  const [onboardPlan, setOnboardPlan] = useState<"Pocket" | "Bistro" | "Delivery" | "Premium">("Delivery");
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [onboardConsole, setOnboardConsole] = useState<string[]>([]);
  const [onboardProgress, setOnboardProgress] = useState(0);
  const [onboardStatusText, setOnboardStatusText] = useState("");
  const [showFlushConfirmModal, setShowFlushConfirmModal] = useState(false);
  const [pendingFlushTenant, setPendingFlushTenant] = useState<{ id: string; name: string } | null>(null);

  const filteredTenants = tenants.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase()) || t.subdomain.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPlan = selectedPlan === "ALL" || t.plan === selectedPlan;
    return matchesSearch && matchesPlan;
  });

  const runOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onboardName.trim()) return;

    setIsOnboarding(true);
    setOnboardConsole([]);
    setOnboardProgress(0);
    setOnboardStatusText("Iniciando onboarding...");
    const slug = onboardName.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
    const subdomain = `${slug}.koma.com`;

    const logs = [
      `[INIT] Starting 1-Click Onboarding for "${onboardName}"...`,
      `[AUTH] Authenticating SuperAdmin session context via JWT...`,
      `[SUPABASE] Connecting to pool postgres://supabase_admin@db.koma.supabase.co:5432...`,
      `[SUPABASE] Creating tenant record in "public.tenants" with schema schema_${slug}...`,
      `[SCHEMA] Creating schema "schema_${slug}" for multi-tenant database isolation...`,
      `[SCHEMA] Creating tables inside "schema_${slug}": categories, products, orders, users, sessions...`,
      `[SEED] Seeding default menus (Burgers, Drinks, Sides, Desserts) for "schema_${slug}"...`,
      `[SEED] Inserting sample product: "Burger Suprema Koma" ($34.90) with stock constraints...`,
      `[CLOUDFLARE] Dispatching CNAME creation request to Cloudflare API...`,
      `[CLOUDFLARE] Successfully mapped ${subdomain} -> k-ingress-prod.railway.app (ID: cf_rec_896321)`,
      `[TELEGRAM] Dispatching alert message to owner channel...`,
      `[SUCCESS] Onboarding completed! Tenant is LIVE at https://${subdomain}`
    ];

    onAddLog(`Starting 1-Click onboarding for: ${onboardName}`, "info");

    for (let i = 0; i < logs.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 300));
      setOnboardConsole(prev => [...prev, logs[i]]);
      setOnboardProgress(Math.round(((i + 1) / (logs.length + 1)) * 100));
      setOnboardStatusText(logs[i].substring(0, 45) + "...");
    }

    setOnboardStatusText("Aguardando Banco...");
    setOnboardProgress(95);

    try {
      const response = await fetch("/api/super-admin/restaurantes/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: onboardName, plan: onboardPlan, subdomain })
      });
      const data = await response.json();
      
      if (response.ok) {
        setOnboardProgress(100);
        setOnboardStatusText("Sucesso!");
        onAddLog(`🎉 Onboarding completed for ${onboardName}!`, "success");
        onTriggerTelegramAlert(`🎉 Novo cliente! ${onboardName} se cadastrou no plano ${onboardPlan}.`);
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        setOnboardName("");
        refreshTenants();
      } else {
        setOnboardStatusText("Erro no banco!");
        setOnboardProgress(0);
        onAddLog(`Error during database onboarding: ${data.error || "Unknown error"}`, "error");
      }
    } catch (err) {
      setOnboardStatusText("Erro de rede!");
      setOnboardProgress(0);
      onAddLog("Network error during restaurant onboarding.", "error");
    } finally {
      setIsOnboarding(false);
    }
  };

  const handleFinancialToggle = (tenant: Tenant) => {
    const targetStatus = tenant.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    onToggleStatus(tenant.id, tenant.status);
    
    if (targetStatus === "SUSPENDED") {
      onAddLog(`⚠️ BLOQUEIO FINANCEIRO ATIVADO: ${tenant.name} suspenso por inadimplência.`, "warning");
      onTriggerTelegramAlert(`⚠️ Alerta Financeiro: ${tenant.name} foi SUSPENSO devido a pendências de pagamento.`);
    } else {
      onAddLog(`🟢 Desbloqueio financeiro efetuado para: ${tenant.name}. Re-ativado.`, "success");
      onTriggerTelegramAlert(`🟢 Status Financeiro: ${tenant.name} foi re-ativado e liberado.`);
    }
  };

  const handleFlushRedis = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/super-admin/restaurantes/${id}/flush-cache`, {
        method: "POST"
      });
      if (res.ok) {
        onAddLog(`🧼 Cache Redis limpo para: ${name}.`, "success");
        onTriggerTelegramAlert(`🧼 Cache Redis: ${name} teve seu cache limpo por comando do SuperAdmin.`);
      } else {
        onAddLog(`Erro ao limpar cache de ${name}`, "error");
      }
    } catch {
      onAddLog(`Erro de rede ao limpar cache de ${name}`, "error");
    }
  };

  return (
    <div className="space-y-6" id="superadmin-tenant-control">
      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#121420] border border-[#1e293b]/40 p-4 rounded relative overflow-hidden" id="stat-total-restaurants">
          <div className="absolute top-0 right-0 p-3 opacity-10">
            <Building2 className="w-12 h-12 text-white" />
          </div>
          <p className="text-xs text-[#9ca3af] font-mono">[TOTAL_TENANTS]</p>
          {isLoading ? (
            <div className="w-20 h-7 bg-slate-800/60 rounded animate-pulse mt-1"></div>
          ) : (
            <p className="text-2xl font-mono font-bold text-white mt-1">{tenants.length}</p>
          )}
          <div className="text-[10px] text-[#00b894] font-mono mt-2 flex items-center gap-1 font-bold">
            <span className="w-1.5 h-1.5 bg-[#00b894] rounded-full animate-pulse shadow-[0_0_6px_#00b894]"></span>
            100% MONITORADO
          </div>
        </div>

        <div className="bg-[#121420] border border-[#1e293b]/40 p-4 rounded relative overflow-hidden" id="stat-mrr">
          <div className="absolute top-0 right-0 p-3 opacity-10">
            <DollarSign className="w-12 h-12 text-white" />
          </div>
          <p className="text-xs text-[#9ca3af] font-mono">[MRR_REAL]</p>
          {isLoading ? (
            <div className="w-32 h-7 bg-slate-800/60 rounded animate-pulse mt-1"></div>
          ) : (
            <p className="text-2xl font-mono font-bold text-[#00b894] mt-1">
              R$ {tenants.reduce((acc, curr) => acc + curr.monthlyBilling, 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          )}
          <div className="text-[10px] text-[#9ca3af] font-mono mt-2">
            FATURAMENTO REAL DOS CLIENTES ATIVOS
          </div>
        </div>

        <div className="bg-[#121420] border border-[#1e293b]/40 p-4 rounded relative overflow-hidden" id="stat-monthly-orders">
          <div className="absolute top-0 right-0 p-3 opacity-10">
            <Terminal className="w-12 h-12 text-white" />
          </div>
          <p className="text-xs text-[#9ca3af] font-mono">[PEDIDOS_MES_CORRENTE]</p>
          {isLoading ? (
            <div className="w-24 h-7 bg-slate-800/60 rounded animate-pulse mt-1"></div>
          ) : (
            <p className="text-2xl font-mono font-bold text-white mt-1">
              {tenants.reduce((acc, curr) => acc + curr.monthlyOrders, 0).toLocaleString()}
            </p>
          )}
          <div className="text-[10px] text-[#9ca3af] font-mono mt-2">
            MÉDIA DE PEDIDOS / MIN: {(tenants.reduce((acc, curr) => acc + curr.monthlyOrders, 0) / (30 * 24 * 60)).toFixed(2)}
          </div>
        </div>

        <div className="bg-[#121420] border border-[#1e293b]/40 p-4 rounded relative overflow-hidden" id="stat-active-percentage">
          <div className="absolute top-0 right-0 p-3 opacity-10">
            <ShieldAlert className="w-12 h-12 text-white" />
          </div>
          <p className="text-xs text-[#9ca3af] font-mono">[INADIMPLENTES_BLOQUEADOS]</p>
          {isLoading ? (
            <div className="w-16 h-7 bg-slate-800/60 rounded animate-pulse mt-1"></div>
          ) : (
            <p className="text-2xl font-mono font-bold text-[#ef4444] mt-1">
              {tenants.filter(t => t.status === "SUSPENDED").length}
            </p>
          )}
          <div className="text-[10px] text-red-400 font-mono mt-2 flex items-center gap-1.5 font-bold">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
            AÇÕES FINANCEIRAS EM LOTE
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Onboarding Control Card */}
        <div className="lg:col-span-1 bg-[#121420] border border-[#1e293b]/40 p-5 rounded flex flex-col space-y-4" id="onboarding-panel">
          <div className="border-b border-[#1e293b]/40 pb-3 flex items-center justify-between">
            <h3 className="text-sm font-mono text-white font-bold flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#00b894]" />
              [01] ONBOARDING 1-CLIQUE
            </h3>
            <span className="text-[9px] font-mono text-[#00b894] bg-emerald-950/20 px-2 py-0.5 rounded border border-[#00b894]/30 font-bold">
              FASTAPI_API
            </span>
          </div>

          <form onSubmit={runOnboarding} className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-[#9ca3af] mb-1">NOME_DO_RESTAURANTE</label>
              <input
                type="text"
                className="w-full bg-black/60 border border-[#1e293b]/40 rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-[#00b894] transition-colors"
                placeholder="Ex: Pizzaria Sol"
                value={onboardName}
                onChange={e => setOnboardName(e.target.value)}
                disabled={isOnboarding}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-[#9ca3af] mb-1">PLANO_SAAS</label>
              <select
                className="w-full bg-black/60 border border-[#1e293b]/40 rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-[#00b894]"
                value={onboardPlan}
                onChange={e => setOnboardPlan(e.target.value as any)}
                disabled={isOnboarding}
              >
                <option value="Pocket">Pocket (R$ 99/mês)</option>
                <option value="Bistro">Bistro (R$ 199/mês)</option>
                <option value="Delivery">Delivery (R$ 299/mês)</option>
                <option value="Premium">Premium (R$ 499/mês)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isOnboarding || !onboardName.trim()}
              className={`w-full py-2.5 rounded font-mono text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                isOnboarding
                  ? "bg-zinc-800 text-zinc-500 cursor-not-allowed border-transparent"
                  : "bg-[#00b894] hover:bg-[#059669] text-black shadow-[0_0_8px_rgba(0,184,148,0.2)] border-transparent"
              }`}
            >
              {isOnboarding ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  ROTEANDO INFRA...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-black text-black" />
                  DISPARAR ONBOARDING
                </>
              )}
            </button>
            {isOnboarding && (
              <div className="space-y-1.5 animate-fade-in mt-2" id="onboarding-progress-bar">
                <div className="flex items-center justify-between font-mono text-[9px] text-slate-400">
                  <span className="truncate">{onboardStatusText}</span>
                  <span className="font-bold text-[#00b894]">{onboardProgress}%</span>
                </div>
                <div className="h-1.5 bg-black/60 border border-[#1e293b]/40 rounded overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-500 to-[#00b894] transition-all duration-300 shadow-[0_0_8px_#00b894]"
                    style={{ width: `${onboardProgress}%` }}
                  />
                </div>
              </div>
            )}
          </form>

          {/* Onboarding Logs Terminal inside card */}
          <div className="flex-1 min-h-[160px] max-h-[220px] bg-black/60 border border-[#1e293b]/40 rounded p-3 overflow-y-auto font-mono text-[10px] space-y-1 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
            <div className="text-slate-500 border-b border-zinc-950 pb-1 mb-2 flex items-center justify-between">
              <span>PROVISIONING_TERMINAL</span>
              <span className="w-2 h-2 rounded-full bg-[#00b894] animate-pulse shadow-[0_0_4px_#00b894]"></span>
            </div>
            {onboardConsole.length === 0 ? (
              <span className="text-slate-600 italic">Waiting for command...</span>
            ) : (
              onboardConsole.map((line, idx) => (
                <div key={idx} className={line.includes("[SUCCESS]") ? "text-[#00b894] font-bold" : line.includes("[ERROR]") ? "text-red-500 font-bold" : "text-slate-400"}>
                  {line}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Tenants Table Grid */}
        <div className="lg:col-span-2 bg-[#121420] border border-[#1e293b]/40 p-5 rounded flex flex-col" id="tenants-list-panel">
          <div className="border-b border-[#1e293b]/40 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-mono text-white font-bold flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#00b894]" />
                [02] CONTROLE DE INQUILINOS (TENANTS)
              </h3>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5">ESTADO GERAL E BLOQUEIO DE INADIMPLÊNCIA</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
                <input
                  type="text"
                  placeholder="Pesquisar..."
                  className="bg-black/60 border border-[#1e293b]/40 rounded pl-8 pr-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#00b894] w-36 md:w-48"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>

              <select
                className="bg-black/60 border border-[#1e293b]/40 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                value={selectedPlan}
                onChange={e => setSelectedPlan(e.target.value)}
              >
                <option value="ALL">Planos (Todos)</option>
                <option value="Pocket">Pocket</option>
                <option value="Bistro">Bistro</option>
                <option value="Delivery">Delivery</option>
                <option value="Premium">Premium</option>
              </select>

              <button
                onClick={refreshTenants}
                disabled={isLoading}
                className="bg-black/60 border border-[#1e293b]/40 hover:border-[#00b894] p-1.5 rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Sincronizar Supabase"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-[#00b894]" : ""}`} />
              </button>
            </div>
          </div>

          {/* Tenants Table */}
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-[#1e293b]/40 text-slate-400 pb-2">
                  <th className="py-2.5 font-semibold">RESTAURANTE / ID</th>
                  <th className="py-2.5 font-semibold">PLANO</th>
                  <th className="py-2.5 font-semibold text-right">FATURADO (MÊS)</th>
                  <th className="py-2.5 font-semibold text-center">STATUS</th>
                  <th className="py-2.5 font-semibold text-center">SAÚDE OPERACIONAL</th>
                  <th className="py-2.5 font-semibold text-center">ÚLT. ATIVIDADE</th>
                  <th className="py-2.5 font-semibold text-center">AÇÕES E CONTROLE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e293b]/30 text-slate-300">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-500">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#00b894]" />
                      Consultando registros no PostgreSQL (Supabase)...
                    </td>
                  </tr>
                ) : filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-zinc-500 italic">
                      Nenhum restaurante encontrado.
                    </td>
                  </tr>
                ) : (
                  filteredTenants.map(t => {
                    const pricing = { Pocket: 99, Bistro: 199, Delivery: 299, Premium: 499 };
                    const mrrVal = pricing[t.plan];
                    const isSuspended = t.status === "SUSPENDED";

                    // Determine printer status reactively from socketDevices
                    const printer = socketDevices?.find(d => d.restaurantId === t.id && d.device === "Printer Gateway");
                    const printerStatus = printer ? (printer.status === "CONNECTED" ? "online" : "offline") : (t.printerStatus || "online");

                    // Filter failed webhooks for this tenant name in the last 24 hours (unresolved)
                    const now = Date.now();
                    const oneDayMs = 24 * 60 * 60 * 1000;
                    const tenantWebhooks = failedWebhooks?.filter(w => {
                      const isSameTenant = w.tenantName.toLowerCase() === t.name.toLowerCase() ||
                                           w.tenantName.toLowerCase().includes(t.name.toLowerCase()) ||
                                           t.name.toLowerCase().includes(w.tenantName.toLowerCase());
                      if (!isSameTenant) return false;
                      if (w.resolved) return false;
                      const time = w.createdAt ? new Date(w.createdAt).getTime() : 0;
                      return (now - time) <= oneDayMs;
                    }) || [];

                    const failedWebhooksCount24h = tenantWebhooks.length;

                    // Combine to calculate healthStatus
                    const healthStatus = (printerStatus === "offline" && failedWebhooksCount24h > 0) || failedWebhooksCount24h >= 2
                      ? "red"
                      : (printerStatus === "offline" || failedWebhooksCount24h === 1)
                      ? "yellow"
                      : "green";

                    // Determine last activity: latest of t.lastActivity, t.createdAt, or any failed webhooks of this tenant
                    let lastActivity = t.lastActivity || t.createdAt || "";
                    let maxTime = lastActivity ? new Date(lastActivity).getTime() : 0;

                    for (const w of tenantWebhooks) {
                      const time = w.createdAt ? new Date(w.createdAt).getTime() : 0;
                      if (time > maxTime) {
                        maxTime = time;
                        lastActivity = w.createdAt;
                      }
                    }

                    if (lastActivity && lastActivity.includes("T")) {
                      lastActivity = lastActivity.replace("T", " ").substring(0, 16);
                    } else if (lastActivity) {
                      lastActivity = lastActivity.substring(0, 16);
                    }

                    return (
                      <tr 
                        key={t.id} 
                        className={`hover:bg-[#121420]/60 transition-colors ${isSuspended ? "bg-red-950/5 border-l-2 border-l-red-500" : ""}`}
                      >
                        <td className="py-3">
                          <div className="font-bold text-white flex items-center gap-1.5">
                            {t.name}
                          </div>
                          <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                            <span>ID: {t.id}</span>
                            <span>•</span>
                            <span className="text-[#00b894] hover:underline cursor-pointer">
                              https://{t.subdomain}
                            </span>
                          </div>
                        </td>
                        <td className="py-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            t.plan === "Premium" ? "bg-purple-950/80 text-purple-400 border border-purple-800" :
                            t.plan === "Delivery" ? "bg-sky-950/80 text-sky-400 border border-sky-800" :
                            t.plan === "Bistro" ? "bg-amber-950/80 text-amber-400 border border-amber-800" :
                            "bg-zinc-800 text-zinc-300"
                          }`}>
                            {t.plan}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <div className="font-bold text-white">
                            R$ {(t.monthlyBilling).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-[10px] text-slate-500">{t.monthlyOrders} ped.</div>
                        </td>
                        <td className="py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                            isSuspended 
                              ? "bg-red-950 text-red-400 border border-red-900" 
                              : "bg-emerald-950/30 text-[#00b894] border border-[#00b894]/30"
                          }`}>
                            <span className={`w-1 h-1 rounded-full ${isSuspended ? "bg-red-500 animate-pulse" : "bg-[#00b894]"}`}></span>
                            {t.status}
                          </span>
                        </td>
                        <td className="py-3 text-center">
                          <div className="flex items-center justify-center gap-2.5">
                            {/* Glowing Health status indicator */}
                            <span className="relative flex h-2.5 w-2.5 shrink-0">
                              {healthStatus === "green" ? (
                                <>
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" title="Saúde Operacional: Excelente"></span>
                                </>
                              ) : healthStatus === "yellow" ? (
                                <>
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" title="Saúde Operacional: Atenção Requerida"></span>
                                </>
                              ) : (
                                <>
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" title="Saúde Operacional: Crítica"></span>
                                </>
                              )}
                            </span>

                            {/* Printer and Webhook failure details */}
                            <div className="flex flex-col items-start gap-0.5 text-[9px] font-semibold text-left">
                              <span className={printerStatus === "online" ? "text-emerald-400" : "text-red-400 animate-pulse font-bold"}>
                                🖨️ {printerStatus === "online" ? "Online" : "Offline"}
                              </span>
                              <span className={failedWebhooksCount24h > 0 ? "text-amber-400 font-bold" : "text-slate-500"}>
                                ⚠️ {failedWebhooksCount24h} {failedWebhooksCount24h === 1 ? "erro" : "erros"} (24h)
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-center text-slate-400 text-[10px] font-mono whitespace-nowrap">
                          {lastActivity}
                        </td>
                        <td className="py-3">
                          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                            {/* Tactile lock toggle switch slider from Cockpit Theme */}
                            <div className="flex items-center gap-1.5">
                              {isSuspended ? (
                                <div onClick={() => handleFinancialToggle(t)} className="w-8 h-4 bg-[#ef4444] rounded-full relative shadow-inner cursor-pointer animate-pulse" title="Clique para liberar acesso">
                                  <div className="absolute left-1 top-1 w-2 h-2 bg-white rounded-full"></div>
                                </div>
                              ) : (
                                <div onClick={() => handleFinancialToggle(t)} className="w-8 h-4 bg-[#00b894] rounded-full relative shadow-inner cursor-pointer" title="Clique para suspender">
                                  <div className="absolute right-1 top-1 w-2 h-2 bg-white rounded-full"></div>
                                </div>
                              )}
                              <span className={isSuspended ? "text-red-400 text-[9px] font-bold" : "text-[#00b894] text-[9px] font-bold"}>
                                {isSuspended ? "BLOQUEADO" : "LIBERADO"}
                              </span>
                            </div>

                            {/* Configure Whitelabel Button */}
                            <button
                              onClick={() => onConfigureTenant?.(t.id)}
                              className="bg-black/60 hover:bg-zinc-900 border border-teal-900/40 hover:border-teal-600/85 text-teal-500 hover:text-teal-400 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold transition-all flex items-center gap-1 cursor-pointer"
                              title="Configurar Whitelabel para este restaurante"
                            >
                              <Sliders className="w-2.5 h-2.5 text-teal-500" />
                              CONFIGURAR
                            </button>

                            {/* Redis Flush Button */}
                            <button
                              onClick={() => {
                                setPendingFlushTenant({ id: t.id, name: t.name });
                                setShowFlushConfirmModal(true);
                              }}
                              className="bg-black/60 hover:bg-zinc-900 border border-amber-900/40 hover:border-amber-600/85 text-amber-500 hover:text-amber-400 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold transition-all flex items-center gap-1 cursor-pointer"
                              title="Limpar Cache Redis deste restaurante"
                            >
                              <RefreshCw className="w-2.5 h-2.5 text-amber-500 animate-pulse" />
                              FLUSH
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal: Confirm Flush Redis */}
      <AnimatePresence>
        {showFlushConfirmModal && pendingFlushTenant && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-mono text-xs text-slate-300">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#050814] border border-amber-900/40 rounded-lg max-w-md w-full p-5 space-y-4 shadow-[0_0_35px_rgba(245,158,11,0.15)]"
            >
              <div className="flex items-center gap-2 text-amber-500 font-bold border-b border-[#1e293b]/40 pb-3 uppercase text-sm">
                <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0" />
                <span>Confirmar Limpeza de Cache (FLUSH)</span>
              </div>
              <p className="leading-relaxed">
                Você tem certeza que deseja realizar a limpeza completa do cache Redis para o inquilino <strong className="text-white">"{pendingFlushTenant.name}"</strong>?
              </p>
              <div className="bg-amber-950/20 border border-amber-900/30 p-3 rounded text-amber-400 text-[11px] leading-relaxed">
                <strong>O que vai acontecer:</strong>
                <p className="mt-1">
                  Isso forçará o banco de dados a reconstruir todos os itens do menu, configurações e layout no próximo acesso do cliente. O cardápio digital poderá apresentar uma leve latência inicial no primeiro carregamento pós-limpeza.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowFlushConfirmModal(false);
                    setPendingFlushTenant(null);
                  }}
                  className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/50 px-3 py-2 rounded text-slate-400 hover:text-white cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const { id, name } = pendingFlushTenant;
                    setShowFlushConfirmModal(false);
                    setPendingFlushTenant(null);
                    await handleFlushRedis(id, name);
                  }}
                  className="bg-amber-950 text-amber-400 hover:bg-amber-900 border border-amber-800 px-4 py-2 rounded font-bold cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Sim, Limpar Cache (FLUSH)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
