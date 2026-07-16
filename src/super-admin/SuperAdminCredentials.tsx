import React, { useState, useEffect } from "react";
import clsx from "clsx";
import { 
  Key, 
  Lock, 
  Eye, 
  EyeOff, 
  Save, 
  RefreshCw, 
  Globe, 
  GitBranch, 
  Server, 
  CloudLightning, 
  Database, 
  AlertCircle, 
  CheckCircle,
  HelpCircle,
  Sparkles,
  AlertTriangle
} from "lucide-react";

interface SuperAdminCredentialsProps {
  onAddLog: (text: string, type: "info" | "success" | "warning" | "error" | "critical") => void;
  onRefreshHealthCheck?: () => void;
}

export default function SuperAdminCredentials({ onAddLog, onRefreshHealthCheck }: SuperAdminCredentialsProps) {
  const [keys, setKeys] = useState<Record<string, string>>({
    CLOUDFLARE_TOKEN: "",
    CLOUDFLARE_ZONE_ID: "",
    GITHUB_TOKEN: "",
    GITHUB_OWNER: "",
    GITHUB_REPO: "",
    RAILWAY_TOKEN: "",
    RAILWAY_PROJECT_ID: "",
    RAILWAY_SERVICE_ID: "",
    SENTRY_AUTH_TOKEN: "",
    SENTRY_ORG: "",
    SENTRY_PROJECT: "",
    SUPABASE_URL: "",
    SUPABASE_KEY: ""
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: "success" | "error" | null; message: string }>({ type: null, message: "" });
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});

  // Real-time connection testing states
  const [testStatus, setTestStatus] = useState<Record<string, { status: "idle" | "loading" | "success" | "error"; message: string }>>({
    cloudflare: { status: "idle", message: "" },
    github: { status: "idle", message: "" },
    railway: { status: "idle", message: "" },
    sentry: { status: "idle", message: "" }
  });

  // Safe warnings & confirmation overlay states
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [pendingWarnings, setPendingWarnings] = useState<{ key: string; message: string }[]>([]);

  // Format validator for fields
  const validateField = (name: string, value: string): string | null => {
    if (!value || value.trim() === "" || value.includes("...")) return null; // Blank or masked values are ok (not configured or unchanged)
    const val = value.trim();

    // Skip validation for mock settings/defaults
    const isMock = val.includes("mock") || val.includes("koma") || val === "Georlan" || val === "solopreneur" || val === "sistema-gourmet-bistro";
    if (isMock) return null;

    if (name === "CLOUDFLARE_ZONE_ID") {
      if (val === "test" || val === "placeholder") {
        return "Zone ID não pode ser um placeholder ('test' ou 'placeholder').";
      }
      if (!/^[a-fA-F0-9]{32}$/.test(val)) {
        return "Zone ID do Cloudflare deve ser um hash hexadecimal de exatamente 32 caracteres (0-9, a-f).";
      }
    }

    if (name === "CLOUDFLARE_TOKEN") {
      if (val === "test" || val === "placeholder") {
        return "Token não pode ser um placeholder.";
      }
      if (val.length < 20) {
        return "Token muito curto para ser um Cloudflare API Token válido.";
      }
    }

    if (name === "GITHUB_TOKEN") {
      if (val === "test" || val === "placeholder") {
        return "Token não pode ser um placeholder.";
      }
      if (!val.startsWith("ghp_") && !val.startsWith("github_pat_")) {
        return "Formato incomum. Tokens do GitHub geralmente iniciam com 'ghp_' ou 'github_pat_'.";
      }
      if (val.startsWith("ghp_") && val.length !== 40) {
        return "Token clássico do GitHub (ghp_...) deve ter exatamente 40 caracteres.";
      }
    }

    if (name === "RAILWAY_PROJECT_ID" || name === "RAILWAY_SERVICE_ID") {
      if (val === "test" || val === "placeholder") {
        return "ID não pode ser um placeholder.";
      }
      if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(val)) {
        return "Deve ser um UUID válido (ex: a1b2c3d4-1234-5678-abcd-1234567890ab).";
      }
    }

    if (name === "RAILWAY_TOKEN") {
      if (val === "test" || val === "placeholder") {
        return "Token não pode ser um placeholder.";
      }
      if (val.length < 15) {
        return "Token muito curto para um Railway Developer Token válido.";
      }
    }

    if (name === "SENTRY_AUTH_TOKEN") {
      if (val === "test" || val === "placeholder") {
        return "Token não pode ser um placeholder.";
      }
      if (!/^[a-fA-F0-9]{64}$/.test(val) && val.length < 32) {
        return "Formato inválido. O token Sentry deve ser um hash hexadecimal de 64 caracteres.";
      }
    }

    if (name === "SUPABASE_URL") {
      if (val === "test" || val === "placeholder") {
        return "URL não pode ser um placeholder.";
      }
      if (!val.startsWith("https://") || !val.includes(".supabase.co")) {
        return "A URL do Supabase deve iniciar com https:// e incluir '.supabase.co'.";
      }
    }

    return null;
  };

  // Get all active warnings for the typed keys
  const getFormWarnings = () => {
    const warnings: { key: string; message: string }[] = [];
    Object.entries(keys).forEach(([key, val]) => {
      const warning = validateField(key, val as string);
      if (warning) {
        warnings.push({ key, message: warning });
      }
    });
    return warnings;
  };

  // Fetch current environment variables from backend
  const fetchCredentials = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/super-admin/credentials");
      if (res.ok) {
        const data = await res.json();
        setKeys(prev => ({ ...prev, ...data }));
        onAddLog("Chaves de integração carregadas do servidor com sucesso.", "info");
      } else {
        onAddLog("Falha ao carregar chaves do servidor (código HTTP não ótimo).", "warning");
      }
    } catch (e: any) {
      console.error(e);
      onAddLog(`Erro de rede ao carregar chaves: ${e.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCredentials();
  }, []);

  const handleChange = (key: string, value: string) => {
    setKeys(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleToggleVisibility = (key: string) => {
    setVisibleKeys(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // Live test connection endpoint caller
  const testConnection = async (service: string) => {
    setTestStatus(prev => ({
      ...prev,
      [service]: { status: "loading", message: "Disparando chamada de teste de integridade..." }
    }));
    try {
      const res = await fetch("/api/super-admin/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, credentials: keys })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestStatus(prev => ({
          ...prev,
          [service]: { status: "success", message: data.message }
        }));
        onAddLog(`[TESTE CONEXÃO] ${service.toUpperCase()} estabelecido: ${data.message}`, "success");
      } else {
        setTestStatus(prev => ({
          ...prev,
          [service]: { status: "error", message: data.error || "A API externa retornou erro de credencial." }
        }));
        onAddLog(`[TESTE CONEXÃO] ${service.toUpperCase()} falhou: ${data.error || "Inválido"}`, "error");
      }
    } catch (err: any) {
      setTestStatus(prev => ({
        ...prev,
        [service]: { status: "error", message: `Erro de rede ou timeout: ${err.message}` }
      }));
      onAddLog(`[TESTE CONEXÃO] ${service.toUpperCase()} falhou com erro de rede.`, "error");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const warnings = getFormWarnings();
    if (warnings.length > 0) {
      setPendingWarnings(warnings);
      setShowWarningModal(true);
      return;
    }
    await executeSave();
  };

  const confirmAndSave = async () => {
    setShowWarningModal(false);
    setPendingWarnings([]);
    await executeSave();
  };

  const executeSave = async () => {
    setIsSaving(true);
    setSaveStatus({ type: null, message: "" });

    try {
      const res = await fetch("/api/super-admin/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: keys })
      });

      if (res.ok) {
        const data = await res.json();
        setSaveStatus({ type: "success", message: data.message || "Credenciais salvas e propagadas com sucesso!" });
        onAddLog("Credenciais do sistema atualizadas e gravadas em disco (.env).", "success");
        
        // Trigger health check refresh on the parent view if callback provided
        if (onRefreshHealthCheck) {
          setTimeout(() => {
            onRefreshHealthCheck();
          }, 800);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        const errMsg = data.error || "Erro desconhecido ao salvar credenciais.";
        setSaveStatus({ type: "error", message: errMsg });
        onAddLog(`Erro ao salvar credenciais: ${errMsg}`, "error");
      }
    } catch (e: any) {
      console.error(e);
      setSaveStatus({ type: "error", message: `Falha de rede: ${e.message}` });
      onAddLog(`Falha na gravação das credenciais: ${e.message}`, "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6" id="superadmin-credentials-manager">
      
      {/* Intro Header Card */}
      <div className={clsx('bg-[#121420]', 'border', 'border-[#1e293b]/40', 'p-5', 'rounded', 'flex', 'flex-col', 'md:flex-row', 'md:items-center', 'justify-between', 'gap-4')}>
        <div>
          <h2 className={clsx('text-base', 'font-bold', 'text-white', 'flex', 'items-center', 'gap-2')}>
            <Key className={clsx('w-5', 'h-5', 'text-[#00b894]')} />
            GERENCIADOR DE CHAVES & CREDENCIAIS DO SISTEMA
          </h2>
          <p className={clsx('text-xs', 'text-slate-400', 'mt-1', 'max-w-2xl', 'font-sans', 'leading-relaxed')}>
            Configure e edite as chaves de API reais do seu sistema diretamente por aqui. As atualizações modificam o arquivo <code className={clsx('text-amber-400', 'font-mono')}>.env</code> de forma persistente e recarregam as configurações em memória em tempo de execução, sem necessidade de reinicializar o container do servidor de forma forçada.
          </p>
        </div>
        <button
          onClick={fetchCredentials}
          disabled={isLoading || isSaving}
          className={clsx('text-xs', 'bg-black/40', 'hover:bg-black', 'border', 'border-[#1e293b]/40', 'text-slate-300', 'font-mono', 'py-1.5', 'px-3', 'rounded', 'flex', 'items-center', 'gap-2', 'transition-all', 'cursor-pointer', 'disabled:opacity-50')}
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#00b894] ${isLoading ? "animate-spin" : ""}`} />
          {isLoading ? "CARREGANDO..." : "RECARREGAR DO DISCO"}
        </button>
      </div>

      {saveStatus.type && (
        <div className={`p-4 rounded border text-xs font-mono flex items-center gap-3 animate-fadeIn ${
          saveStatus.type === "success" 
            ? "bg-emerald-950/20/20 border-emerald-500/50 text-emerald-400" 
            : "bg-red-950/20 border-red-500/50 text-red-400"
        }`}>
          {saveStatus.type === "success" ? (
            <CheckCircle className={clsx('w-5', 'h-5', 'shrink-0')} />
          ) : (
            <AlertCircle className={clsx('w-5', 'h-5', 'shrink-0')} />
          )}
          <div>
            <span className={clsx('font-bold', 'uppercase', 'block')}>{saveStatus.type === "success" ? "SUCESSO DE CONFIGURAÇÃO" : "ERRO DE PROCESSO"}</span>
            <span className={clsx('font-sans', 'text-[11px]', 'opacity-90', 'mt-0.5', 'block')}>{saveStatus.message}</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        
        {/* Grid of Credentials Sections */}
        <div className={clsx('grid', 'grid-cols-1', 'lg:grid-cols-2', 'gap-6')}>

          {/* Module 1: Cloudflare */}
          <div className={clsx('bg-[#121420]', 'border', 'border-[#1e293b]/40', 'p-5', 'rounded', 'flex', 'flex-col', 'justify-between')} id="cred-module-cloudflare">
            <div>
              <div className={clsx('flex', 'items-center', 'justify-between', 'border-b', 'border-[#1e293b]/40', 'pb-3', 'mb-4')}>
                <div className={clsx('flex', 'items-center', 'gap-2')}>
                  <Globe className={clsx('w-4', 'h-4', 'text-orange-500')} />
                  <h3 className={clsx('text-sm', 'font-bold', 'text-white', 'font-mono', 'uppercase', 'tracking-wide')}>
                    [01] Cloudflare DNS API
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => testConnection("cloudflare")}
                  disabled={testStatus.cloudflare?.status === "loading" || !keys.CLOUDFLARE_TOKEN || !keys.CLOUDFLARE_ZONE_ID}
                  className={clsx('text-[10px]', 'font-mono', 'bg-black/40', 'hover:bg-[#00b894]/20', 'border', 'border-[#1e293b]/60', 'hover:border-[#00b894]/50', 'disabled:border-zinc-850', 'disabled:opacity-40', 'disabled:hover:bg-transparent', 'text-slate-300', 'hover:text-[#00b894]', 'py-1', 'px-2.5', 'rounded', 'transition-all', 'cursor-pointer', 'flex', 'items-center', 'gap-1.5')}
                >
                  {testStatus.cloudflare?.status === "loading" ? (
                    <>
                      <RefreshCw className={clsx('w-3', 'h-3', 'animate-spin', 'text-[#00b894]')} />
                      TESTANDO...
                    </>
                  ) : (
                    <>
                      <Sparkles className={clsx('w-3', 'h-3', 'text-[#00b894]')} />
                      TESTAR CONEXÃO
                    </>
                  )}
                </button>
              </div>
              <p className={clsx('text-[11px]', 'text-slate-400', 'mb-4', 'font-sans', 'leading-relaxed')}>
                Usado para gerenciar, criar e auditar registros CNAME de subdomínios para novos estabelecimentos (tenants).
              </p>

              {testStatus.cloudflare?.status !== "idle" && (
                <div className={`mb-4 p-2.5 rounded text-[11px] font-mono border animate-fadeIn ${
                  testStatus.cloudflare?.status === "success" 
                    ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-400" 
                    : "bg-red-950/20 border-red-500/30 text-red-400"
                }`}>
                  <span className={clsx('font-bold', 'flex', 'items-center', 'gap-1')}>
                    {testStatus.cloudflare?.status === "success" ? "🟢 CONEXÃO REAL SUCESSO" : "🔴 CONEXÃO REAL FALHOU"}
                  </span>
                  <p className={clsx('mt-1', 'text-[10px]', 'opacity-90', 'leading-relaxed')}>{testStatus.cloudflare?.message}</p>
                </div>
              )}

              <div className={clsx('space-y-4', 'font-mono', 'text-xs')}>
                {/* CLOUDFLARE_ZONE_ID */}
                <div className="space-y-1.5">
                  <label className={clsx('text-slate-400', 'flex', 'items-center', 'justify-between')}>
                    <span>CLOUDFLARE_ZONE_ID</span>
                    {keys.CLOUDFLARE_ZONE_ID ? (
                      <span className={clsx('text-[9px]', 'text-[#00b894]', 'bg-[#00b894]/10', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-[#00b894]/20')}>DEFINIDO</span>
                    ) : (
                      <span className={clsx('text-[9px]', 'text-amber-500', 'bg-amber-950/30', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-amber-900/50')}>VAZIO</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={keys.CLOUDFLARE_ZONE_ID}
                    onChange={(e) => handleChange("CLOUDFLARE_ZONE_ID", e.target.value)}
                    placeholder="Ex: d759e6912389104fa28330ffda987b7a (não use 'test')"
                    className={`w-full bg-[#090a0f]/60 border rounded py-2 px-3 text-slate-200 placeholder:text-slate-600 focus:outline-none transition-all ${
                      validateField("CLOUDFLARE_ZONE_ID", keys.CLOUDFLARE_ZONE_ID)
                        ? "border-amber-500/50 focus:border-amber-500"
                        : "border-[#1e293b]/40 focus:border-[#00b894]"
                    }`}
                  />
                  {validateField("CLOUDFLARE_ZONE_ID", keys.CLOUDFLARE_ZONE_ID) && (
                    <span className={clsx('text-[10px]', 'text-amber-500', 'mt-1', 'block', 'flex', 'items-center', 'gap-1', 'font-sans')}>
                      <AlertCircle className={clsx('w-3.5', 'h-3.5', 'text-amber-500', 'shrink-0')} />
                      {validateField("CLOUDFLARE_ZONE_ID", keys.CLOUDFLARE_ZONE_ID)}
                    </span>
                  )}
                </div>

                {/* CLOUDFLARE_TOKEN */}
                <div className="space-y-1.5">
                  <label className={clsx('text-slate-400', 'flex', 'items-center', 'justify-between')}>
                    <span>CLOUDFLARE_TOKEN</span>
                    {keys.CLOUDFLARE_TOKEN ? (
                      <span className={clsx('text-[9px]', 'text-[#00b894]', 'bg-[#00b894]/10', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-[#00b894]/20')}>DEFINIDO</span>
                    ) : (
                      <span className={clsx('text-[9px]', 'text-amber-500', 'bg-amber-950/30', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-amber-900/50')}>VAZIO</span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type={visibleKeys.CLOUDFLARE_TOKEN ? "text" : "password"}
                      value={keys.CLOUDFLARE_TOKEN}
                      onChange={(e) => handleChange("CLOUDFLARE_TOKEN", e.target.value)}
                      placeholder="Ex: bearer_token_com_permissao_dns_zone"
                      className={`w-full bg-[#090a0f]/60 border rounded py-2 pl-3 pr-10 text-slate-200 placeholder:text-slate-600 focus:outline-none transition-all ${
                        validateField("CLOUDFLARE_TOKEN", keys.CLOUDFLARE_TOKEN)
                          ? "border-amber-500/50 focus:border-amber-500"
                          : "border-[#1e293b]/40 focus:border-[#00b894]"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => handleToggleVisibility("CLOUDFLARE_TOKEN")}
                      className={clsx('absolute', 'right-3', 'top-1/2', '-translate-y-1/2', 'text-slate-500', 'hover:text-slate-300', 'cursor-pointer')}
                    >
                      {visibleKeys.CLOUDFLARE_TOKEN ? <EyeOff className={clsx('w-4', 'h-4')} /> : <Eye className={clsx('w-4', 'h-4')} />}
                    </button>
                  </div>
                  {validateField("CLOUDFLARE_TOKEN", keys.CLOUDFLARE_TOKEN) && (
                    <span className={clsx('text-[10px]', 'text-amber-500', 'mt-1', 'block', 'flex', 'items-center', 'gap-1', 'font-sans')}>
                      <AlertCircle className={clsx('w-3.5', 'h-3.5', 'text-amber-500', 'shrink-0')} />
                      {validateField("CLOUDFLARE_TOKEN", keys.CLOUDFLARE_TOKEN)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <div className={clsx('mt-4', 'pt-3', 'border-t', 'border-zinc-900', 'flex', 'items-center', 'gap-2', 'text-[10px]', 'text-slate-500', 'font-sans')}>
              <HelpCircle className={clsx('w-3.5', 'h-3.5', 'text-amber-500')} />
              <span>O Zone ID pode ser encontrado no menu lateral direito da sua Dashboard Cloudflare.</span>
            </div>
          </div>

          {/* Module 2: GitHub Actions */}
          <div className={clsx('bg-[#121420]', 'border', 'border-[#1e293b]/40', 'p-5', 'rounded', 'flex', 'flex-col', 'justify-between')} id="cred-module-github">
            <div>
              <div className={clsx('flex', 'items-center', 'justify-between', 'border-b', 'border-[#1e293b]/40', 'pb-3', 'mb-4')}>
                <div className={clsx('flex', 'items-center', 'gap-2')}>
                  <GitBranch className={clsx('w-4', 'h-4', 'text-purple-400')} />
                  <h3 className={clsx('text-sm', 'font-bold', 'text-white', 'font-mono', 'uppercase', 'tracking-wide')}>
                    [02] GitHub Actions CI/CD
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => testConnection("github")}
                  disabled={testStatus.github?.status === "loading" || !keys.GITHUB_TOKEN}
                  className={clsx('text-[10px]', 'font-mono', 'bg-black/40', 'hover:bg-[#00b894]/20', 'border', 'border-[#1e293b]/60', 'hover:border-[#00b894]/50', 'disabled:border-zinc-850', 'disabled:opacity-40', 'disabled:hover:bg-transparent', 'text-slate-300', 'hover:text-[#00b894]', 'py-1', 'px-2.5', 'rounded', 'transition-all', 'cursor-pointer', 'flex', 'items-center', 'gap-1.5')}
                >
                  {testStatus.github?.status === "loading" ? (
                    <>
                      <RefreshCw className={clsx('w-3', 'h-3', 'animate-spin', 'text-[#00b894]')} />
                      TESTANDO...
                    </>
                  ) : (
                    <>
                      <Sparkles className={clsx('w-3', 'h-3', 'text-[#00b894]')} />
                      TESTAR CONEXÃO
                    </>
                  )}
                </button>
              </div>
              <p className={clsx('text-[11px]', 'text-slate-400', 'mb-4', 'font-sans', 'leading-relaxed')}>
                Usado para consultar status de builds anteriores e disparar workflows automáticos de testes ou deployments.
              </p>

              {testStatus.github?.status !== "idle" && (
                <div className={`mb-4 p-2.5 rounded text-[11px] font-mono border animate-fadeIn ${
                  testStatus.github?.status === "success" 
                    ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-400" 
                    : "bg-red-950/20 border-red-500/30 text-red-400"
                }`}>
                  <span className={clsx('font-bold', 'flex', 'items-center', 'gap-1')}>
                    {testStatus.github?.status === "success" ? "🟢 CONEXÃO REAL SUCESSO" : "🔴 CONEXÃO REAL FALHOU"}
                  </span>
                  <p className={clsx('mt-1', 'text-[10px]', 'opacity-90', 'leading-relaxed')}>{testStatus.github?.message}</p>
                </div>
              )}

              <div className={clsx('space-y-3', 'font-mono', 'text-xs')}>
                {/* GITHUB_OWNER */}
                <div className="space-y-1.5">
                  <label className={clsx('text-slate-400', 'flex', 'items-center', 'justify-between')}>
                    <span>GITHUB_OWNER (Nome do Usuário/Organização)</span>
                    {keys.GITHUB_OWNER ? (
                      <span className={clsx('text-[9px]', 'text-[#00b894]', 'bg-[#00b894]/10', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-[#00b894]/20')}>DEFINIDO</span>
                    ) : (
                      <span className={clsx('text-[9px]', 'text-amber-500', 'bg-amber-950/30', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-amber-900/50')}>VAZIO</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={keys.GITHUB_OWNER}
                    onChange={(e) => handleChange("GITHUB_OWNER", e.target.value)}
                    placeholder="Padrão: Georlan"
                    className={clsx('w-full', 'bg-[#090a0f]/60', 'border', 'border-[#1e293b]/40', 'rounded', 'py-2', 'px-3', 'text-slate-200', 'placeholder:text-slate-600', 'focus:outline-none', 'focus:border-[#00b894]', 'transition-all')}
                  />
                </div>

                {/* GITHUB_REPO */}
                <div className="space-y-1.5">
                  <label className={clsx('text-slate-400', 'flex', 'items-center', 'justify-between')}>
                    <span>GITHUB_REPO (Nome do Repositório)</span>
                    {keys.GITHUB_REPO ? (
                      <span className={clsx('text-[9px]', 'text-[#00b894]', 'bg-[#00b894]/10', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-[#00b894]/20')}>DEFINIDO</span>
                    ) : (
                      <span className={clsx('text-[9px]', 'text-amber-500', 'bg-amber-950/30', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-amber-900/50')}>VAZIO</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={keys.GITHUB_REPO}
                    onChange={(e) => handleChange("GITHUB_REPO", e.target.value)}
                    placeholder="Padrão: sistema-gourmet-bistro"
                    className={clsx('w-full', 'bg-[#090a0f]/60', 'border', 'border-[#1e293b]/40', 'rounded', 'py-2', 'px-3', 'text-slate-200', 'placeholder:text-slate-600', 'focus:outline-none', 'focus:border-[#00b894]', 'transition-all')}
                  />
                </div>

                {/* GITHUB_TOKEN */}
                <div className="space-y-1.5">
                  <label className={clsx('text-slate-400', 'flex', 'items-center', 'justify-between')}>
                    <span>GITHUB_TOKEN (Personal Access Token)</span>
                    {keys.GITHUB_TOKEN ? (
                      <span className={clsx('text-[9px]', 'text-[#00b894]', 'bg-[#00b894]/10', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-[#00b894]/20')}>DEFINIDO</span>
                    ) : (
                      <span className={clsx('text-[9px]', 'text-amber-500', 'bg-amber-950/30', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-amber-900/50')}>VAZIO</span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type={visibleKeys.GITHUB_TOKEN ? "text" : "password"}
                      value={keys.GITHUB_TOKEN}
                      onChange={(e) => handleChange("GITHUB_TOKEN", e.target.value)}
                      placeholder="Ex: ghp_xxxxxxxxxxxxxxxxxxxx"
                      className={`w-full bg-[#090a0f]/60 border rounded py-2 pl-3 pr-10 text-slate-200 placeholder:text-slate-600 focus:outline-none transition-all ${
                        validateField("GITHUB_TOKEN", keys.GITHUB_TOKEN)
                          ? "border-amber-500/50 focus:border-amber-500"
                          : "border-[#1e293b]/40 focus:border-[#00b894]"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => handleToggleVisibility("GITHUB_TOKEN")}
                      className={clsx('absolute', 'right-3', 'top-1/2', '-translate-y-1/2', 'text-slate-500', 'hover:text-slate-300', 'cursor-pointer')}
                    >
                      {visibleKeys.GITHUB_TOKEN ? <EyeOff className={clsx('w-4', 'h-4')} /> : <Eye className={clsx('w-4', 'h-4')} />}
                    </button>
                  </div>
                  {validateField("GITHUB_TOKEN", keys.GITHUB_TOKEN) && (
                    <span className={clsx('text-[10px]', 'text-amber-500', 'mt-1', 'block', 'flex', 'items-center', 'gap-1', 'font-sans')}>
                      <AlertCircle className={clsx('w-3.5', 'h-3.5', 'text-amber-500', 'shrink-0')} />
                      {validateField("GITHUB_TOKEN", keys.GITHUB_TOKEN)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <div className={clsx('mt-4', 'pt-3', 'border-t', 'border-zinc-900', 'flex', 'items-center', 'gap-2', 'text-[10px]', 'text-slate-500', 'font-sans')}>
              <HelpCircle className={clsx('w-3.5', 'h-3.5', 'text-amber-500')} />
              <span>O token deve possuir permissões ativas para ler e disparar 'workflows' e 'actions'.</span>
            </div>
          </div>

          {/* Module 3: Railway */}
          <div className={clsx('bg-[#121420]', 'border', 'border-[#1e293b]/40', 'p-5', 'rounded', 'flex', 'flex-col', 'justify-between')} id="cred-module-railway">
            <div>
              <div className={clsx('flex', 'items-center', 'justify-between', 'border-b', 'border-[#1e293b]/40', 'pb-3', 'mb-4')}>
                <div className={clsx('flex', 'items-center', 'gap-2')}>
                  <Server className={clsx('w-4', 'h-4', 'text-rose-400')} />
                  <h3 className={clsx('text-sm', 'font-bold', 'text-white', 'font-mono', 'uppercase', 'tracking-wide')}>
                    [03] Railway Cloud Engine
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => testConnection("railway")}
                  disabled={testStatus.railway?.status === "loading" || !keys.RAILWAY_TOKEN || !keys.RAILWAY_PROJECT_ID || !keys.RAILWAY_SERVICE_ID}
                  className={clsx('text-[10px]', 'font-mono', 'bg-black/40', 'hover:bg-[#00b894]/20', 'border', 'border-[#1e293b]/60', 'hover:border-[#00b894]/50', 'disabled:border-zinc-850', 'disabled:opacity-40', 'disabled:hover:bg-transparent', 'text-slate-300', 'hover:text-[#00b894]', 'py-1', 'px-2.5', 'rounded', 'transition-all', 'cursor-pointer', 'flex', 'items-center', 'gap-1.5')}
                >
                  {testStatus.railway?.status === "loading" ? (
                    <>
                      <RefreshCw className={clsx('w-3', 'h-3', 'animate-spin', 'text-[#00b894]')} />
                      TESTANDO...
                    </>
                  ) : (
                    <>
                      <Sparkles className={clsx('w-3', 'h-3', 'text-[#00b894]')} />
                      TESTAR CONEXÃO
                    </>
                  )}
                </button>
              </div>
              <p className={clsx('text-[11px]', 'text-slate-400', 'mb-4', 'font-sans', 'leading-relaxed')}>
                Usado para carregar estatísticas reais de uso de recursos (CPU, RAM, conexões de banco) e registros operacionais de deploy.
              </p>

              {testStatus.railway?.status !== "idle" && (
                <div className={`mb-4 p-2.5 rounded text-[11px] font-mono border animate-fadeIn ${
                  testStatus.railway?.status === "success" 
                    ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-400" 
                    : "bg-red-950/20 border-red-500/30 text-red-400"
                }`}>
                  <span className={clsx('font-bold', 'flex', 'items-center', 'gap-1')}>
                    {testStatus.railway?.status === "success" ? "🟢 CONEXÃO REAL SUCESSO" : "🔴 CONEXÃO REAL FALHOU"}
                  </span>
                  <p className={clsx('mt-1', 'text-[10px]', 'opacity-90', 'leading-relaxed')}>{testStatus.railway?.message}</p>
                </div>
              )}

              <div className={clsx('space-y-3', 'font-mono', 'text-xs')}>
                {/* RAILWAY_PROJECT_ID */}
                <div className="space-y-1.5">
                  <label className={clsx('text-slate-400', 'flex', 'items-center', 'justify-between')}>
                    <span>RAILWAY_PROJECT_ID</span>
                    {keys.RAILWAY_PROJECT_ID ? (
                      <span className={clsx('text-[9px]', 'text-[#00b894]', 'bg-[#00b894]/10', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-[#00b894]/20')}>DEFINIDO</span>
                    ) : (
                      <span className={clsx('text-[9px]', 'text-amber-500', 'bg-amber-950/30', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-amber-900/50')}>VAZIO</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={keys.RAILWAY_PROJECT_ID}
                    onChange={(e) => handleChange("RAILWAY_PROJECT_ID", e.target.value)}
                    placeholder="Ex: a1b2c3d4-1234-5678-abcd-1234567890ab"
                    className={`w-full bg-[#090a0f]/60 border rounded py-2 px-3 text-slate-200 placeholder:text-slate-600 focus:outline-none transition-all ${
                      validateField("RAILWAY_PROJECT_ID", keys.RAILWAY_PROJECT_ID)
                        ? "border-amber-500/50 focus:border-amber-500"
                        : "border-[#1e293b]/40 focus:border-[#00b894]"
                    }`}
                  />
                  {validateField("RAILWAY_PROJECT_ID", keys.RAILWAY_PROJECT_ID) && (
                    <span className={clsx('text-[10px]', 'text-amber-500', 'mt-1', 'block', 'flex', 'items-center', 'gap-1', 'font-sans')}>
                      <AlertCircle className={clsx('w-3.5', 'h-3.5', 'text-amber-500', 'shrink-0')} />
                      {validateField("RAILWAY_PROJECT_ID", keys.RAILWAY_PROJECT_ID)}
                    </span>
                  )}
                </div>

                {/* RAILWAY_SERVICE_ID */}
                <div className="space-y-1.5">
                  <label className={clsx('text-slate-400', 'flex', 'items-center', 'justify-between')}>
                    <span>RAILWAY_SERVICE_ID (ID do Serviço de Container)</span>
                    {keys.RAILWAY_SERVICE_ID ? (
                      <span className={clsx('text-[9px]', 'text-[#00b894]', 'bg-[#00b894]/10', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-[#00b894]/20')}>DEFINIDO</span>
                    ) : (
                      <span className={clsx('text-[9px]', 'text-amber-500', 'bg-amber-950/30', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-amber-900/50')}>VAZIO</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={keys.RAILWAY_SERVICE_ID}
                    onChange={(e) => handleChange("RAILWAY_SERVICE_ID", e.target.value)}
                    placeholder="Ex: f9e8d7c6-1234-abcd-9876-ef0123456789"
                    className={`w-full bg-[#090a0f]/60 border rounded py-2 px-3 text-slate-200 placeholder:text-slate-600 focus:outline-none transition-all ${
                      validateField("RAILWAY_SERVICE_ID", keys.RAILWAY_SERVICE_ID)
                        ? "border-amber-500/50 focus:border-amber-500"
                        : "border-[#1e293b]/40 focus:border-[#00b894]"
                    }`}
                  />
                  {validateField("RAILWAY_SERVICE_ID", keys.RAILWAY_SERVICE_ID) && (
                    <span className={clsx('text-[10px]', 'text-amber-500', 'mt-1', 'block', 'flex', 'items-center', 'gap-1', 'font-sans')}>
                      <AlertCircle className={clsx('w-3.5', 'h-3.5', 'text-amber-500', 'shrink-0')} />
                      {validateField("RAILWAY_SERVICE_ID", keys.RAILWAY_SERVICE_ID)}
                    </span>
                  )}
                </div>

                {/* RAILWAY_TOKEN */}
                <div className="space-y-1.5">
                  <label className={clsx('text-slate-400', 'flex', 'items-center', 'justify-between')}>
                    <span>RAILWAY_TOKEN (Developer API Token)</span>
                    {keys.RAILWAY_TOKEN ? (
                      <span className={clsx('text-[9px]', 'text-[#00b894]', 'bg-[#00b894]/10', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-[#00b894]/20')}>DEFINIDO</span>
                    ) : (
                      <span className={clsx('text-[9px]', 'text-amber-500', 'bg-amber-950/30', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-amber-900/50')}>VAZIO</span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type={visibleKeys.RAILWAY_TOKEN ? "text" : "password"}
                      value={keys.RAILWAY_TOKEN}
                      onChange={(e) => handleChange("RAILWAY_TOKEN", e.target.value)}
                      placeholder="Ex: rly_xxxxxxxxxxxxxxxxxxxx"
                      className={`w-full bg-[#090a0f]/60 border rounded py-2 pl-3 pr-10 text-slate-200 placeholder:text-slate-600 focus:outline-none transition-all ${
                        validateField("RAILWAY_TOKEN", keys.RAILWAY_TOKEN)
                          ? "border-amber-500/50 focus:border-amber-500"
                          : "border-[#1e293b]/40 focus:border-[#00b894]"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => handleToggleVisibility("RAILWAY_TOKEN")}
                      className={clsx('absolute', 'right-3', 'top-1/2', '-translate-y-1/2', 'text-slate-500', 'hover:text-slate-300', 'cursor-pointer')}
                    >
                      {visibleKeys.RAILWAY_TOKEN ? <EyeOff className={clsx('w-4', 'h-4')} /> : <Eye className={clsx('w-4', 'h-4')} />}
                    </button>
                  </div>
                  {validateField("RAILWAY_TOKEN", keys.RAILWAY_TOKEN) && (
                    <span className={clsx('text-[10px]', 'text-amber-500', 'mt-1', 'block', 'flex', 'items-center', 'gap-1', 'font-sans')}>
                      <AlertCircle className={clsx('w-3.5', 'h-3.5', 'text-amber-500', 'shrink-0')} />
                      {validateField("RAILWAY_TOKEN", keys.RAILWAY_TOKEN)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <div className={clsx('mt-4', 'pt-3', 'border-t', 'border-zinc-900', 'flex', 'items-center', 'gap-2', 'text-[10px]', 'text-slate-500', 'font-sans')}>
              <HelpCircle className={clsx('w-3.5', 'h-3.5', 'text-amber-500')} />
              <span>O token deve ser gerado no painel de configurações de conta na Railway Cloud.</span>
            </div>
          </div>

          {/* Module 4: Sentry */}
          <div className={clsx('bg-[#121420]', 'border', 'border-[#1e293b]/40', 'p-5', 'rounded', 'flex', 'flex-col', 'justify-between')} id="cred-module-sentry">
            <div>
              <div className={clsx('flex', 'items-center', 'justify-between', 'border-b', 'border-[#1e293b]/40', 'pb-3', 'mb-4')}>
                <div className={clsx('flex', 'items-center', 'gap-2')}>
                  <CloudLightning className={clsx('w-4', 'h-4', 'text-cyan-400')} />
                  <h3 className={clsx('text-sm', 'font-bold', 'text-white', 'font-mono', 'uppercase', 'tracking-wide')}>
                    [04] Sentry Telemetry System
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => testConnection("sentry")}
                  disabled={testStatus.sentry?.status === "loading" || !keys.SENTRY_AUTH_TOKEN || !keys.SENTRY_ORG || !keys.SENTRY_PROJECT}
                  className={clsx('text-[10px]', 'font-mono', 'bg-black/40', 'hover:bg-[#00b894]/20', 'border', 'border-[#1e293b]/60', 'hover:border-[#00b894]/50', 'disabled:border-zinc-850', 'disabled:opacity-40', 'disabled:hover:bg-transparent', 'text-slate-300', 'hover:text-[#00b894]', 'py-1', 'px-2.5', 'rounded', 'transition-all', 'cursor-pointer', 'flex', 'items-center', 'gap-1.5')}
                >
                  {testStatus.sentry?.status === "loading" ? (
                    <>
                      <RefreshCw className={clsx('w-3', 'h-3', 'animate-spin', 'text-[#00b894]')} />
                      TESTANDO...
                    </>
                  ) : (
                    <>
                      <Sparkles className={clsx('w-3', 'h-3', 'text-[#00b894]')} />
                      TESTAR CONEXÃO
                    </>
                  )}
                </button>
              </div>
              <p className={clsx('text-[11px]', 'text-slate-400', 'mb-4', 'font-sans', 'leading-relaxed')}>
                Usado para carregar issues reais, erros ativos de produção, frequências de exceção e telemetria de logs.
              </p>

              {testStatus.sentry?.status !== "idle" && (
                <div className={`mb-4 p-2.5 rounded text-[11px] font-mono border animate-fadeIn ${
                  testStatus.sentry?.status === "success" 
                    ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-400" 
                    : "bg-red-950/20 border-red-500/30 text-red-400"
                }`}>
                  <span className={clsx('font-bold', 'flex', 'items-center', 'gap-1')}>
                    {testStatus.sentry?.status === "success" ? "🟢 CONEXÃO REAL SUCESSO" : "🔴 CONEXÃO REAL FALHOU"}
                  </span>
                  <p className={clsx('mt-1', 'text-[10px]', 'opacity-90', 'leading-relaxed')}>{testStatus.sentry?.message}</p>
                </div>
              )}

              <div className={clsx('space-y-3', 'font-mono', 'text-xs')}>
                {/* SENTRY_ORG */}
                <div className="space-y-1.5">
                  <label className={clsx('text-slate-400', 'flex', 'items-center', 'justify-between')}>
                    <span>SENTRY_ORG (Apelido/Slug da Organização)</span>
                    {keys.SENTRY_ORG ? (
                      <span className={clsx('text-[9px]', 'text-[#00b894]', 'bg-[#00b894]/10', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-[#00b894]/20')}>DEFINIDO</span>
                    ) : (
                      <span className={clsx('text-[9px]', 'text-amber-500', 'bg-amber-950/30', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-amber-900/50')}>VAZIO</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={keys.SENTRY_ORG}
                    onChange={(e) => handleChange("SENTRY_ORG", e.target.value)}
                    placeholder="Ex: koma-saas"
                    className={clsx('w-full', 'bg-[#090a0f]/60', 'border', 'border-[#1e293b]/40', 'rounded', 'py-2', 'px-3', 'text-slate-200', 'placeholder:text-slate-600', 'focus:outline-none', 'focus:border-[#00b894]', 'transition-all')}
                  />
                </div>

                {/* SENTRY_PROJECT */}
                <div className="space-y-1.5">
                  <label className={clsx('text-slate-400', 'flex', 'items-center', 'justify-between')}>
                    <span>SENTRY_PROJECT (Slug do Projeto)</span>
                    {keys.SENTRY_PROJECT ? (
                      <span className={clsx('text-[9px]', 'text-[#00b894]', 'bg-[#00b894]/10', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-[#00b894]/20')}>DEFINIDO</span>
                    ) : (
                      <span className={clsx('text-[9px]', 'text-amber-500', 'bg-amber-950/30', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-amber-900/50')}>VAZIO</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={keys.SENTRY_PROJECT}
                    onChange={(e) => handleChange("SENTRY_PROJECT", e.target.value)}
                    placeholder="Ex: api-node-express"
                    className={clsx('w-full', 'bg-[#090a0f]/60', 'border', 'border-[#1e293b]/40', 'rounded', 'py-2', 'px-3', 'text-slate-200', 'placeholder:text-slate-600', 'focus:outline-none', 'focus:border-[#00b894]', 'transition-all')}
                  />
                </div>

                {/* SENTRY_AUTH_TOKEN */}
                <div className="space-y-1.5">
                  <label className={clsx('text-slate-400', 'flex', 'items-center', 'justify-between')}>
                    <span>SENTRY_AUTH_TOKEN</span>
                    {keys.SENTRY_AUTH_TOKEN ? (
                      <span className={clsx('text-[9px]', 'text-[#00b894]', 'bg-[#00b894]/10', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-[#00b894]/20')}>DEFINIDO</span>
                    ) : (
                      <span className={clsx('text-[9px]', 'text-amber-500', 'bg-amber-950/30', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-amber-900/50')}>VAZIO</span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type={visibleKeys.SENTRY_AUTH_TOKEN ? "text" : "password"}
                      value={keys.SENTRY_AUTH_TOKEN}
                      onChange={(e) => handleChange("SENTRY_AUTH_TOKEN", e.target.value)}
                      placeholder="Ex: sentry_auth_token_com_projeto_read"
                      className={`w-full bg-[#090a0f]/60 border rounded py-2 pl-3 pr-10 text-slate-200 placeholder:text-slate-600 focus:outline-none transition-all ${
                        validateField("SENTRY_AUTH_TOKEN", keys.SENTRY_AUTH_TOKEN)
                          ? "border-amber-500/50 focus:border-amber-500"
                          : "border-[#1e293b]/40 focus:border-[#00b894]"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => handleToggleVisibility("SENTRY_AUTH_TOKEN")}
                      className={clsx('absolute', 'right-3', 'top-1/2', '-translate-y-1/2', 'text-slate-500', 'hover:text-slate-300', 'cursor-pointer')}
                    >
                      {visibleKeys.SENTRY_AUTH_TOKEN ? <EyeOff className={clsx('w-4', 'h-4')} /> : <Eye className={clsx('w-4', 'h-4')} />}
                    </button>
                  </div>
                  {validateField("SENTRY_AUTH_TOKEN", keys.SENTRY_AUTH_TOKEN) && (
                    <span className={clsx('text-[10px]', 'text-amber-500', 'mt-1', 'block', 'flex', 'items-center', 'gap-1', 'font-sans')}>
                      <AlertCircle className={clsx('w-3.5', 'h-3.5', 'text-amber-500', 'shrink-0')} />
                      {validateField("SENTRY_AUTH_TOKEN", keys.SENTRY_AUTH_TOKEN)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <div className={clsx('mt-4', 'pt-3', 'border-t', 'border-zinc-900', 'flex', 'items-center', 'gap-2', 'text-[10px]', 'text-slate-500', 'font-sans')}>
              <HelpCircle className={clsx('w-3.5', 'h-3.5', 'text-amber-500')} />
              <span>O token Sentry deve ser do tipo "Internal Integration" ou "User Auth Token".</span>
            </div>
          </div>

          {/* Module 5: Supabase */}
          <div className={clsx('bg-[#121420]', 'border', 'border-[#1e293b]/40', 'p-5', 'rounded', 'lg:col-span-2', 'flex', 'flex-col', 'justify-between')} id="cred-module-supabase">
            <div>
              <div className={clsx('flex', 'items-center', 'gap-2', 'border-b', 'border-[#1e293b]/40', 'pb-3', 'mb-4')}>
                <Database className={clsx('w-4', 'h-4', 'text-emerald-400')} />
                <h3 className={clsx('text-sm', 'font-bold', 'text-white', 'font-mono', 'uppercase', 'tracking-wide')}>
                  [05] Supabase / PostgreSQL Client API
                </h3>
              </div>
              <p className={clsx('text-[11px]', 'text-slate-400', 'mb-4', 'font-sans', 'leading-relaxed')}>
                Configure a URL e a chave de API (anon/service) do Supabase para conectar à base PostgreSQL real. Caso as credenciais não estejam corretas, o gateway de dados reverte automaticamente para o modo resiliente de alta-fidelidade local, impedindo falhas em tela.
              </p>

              <div className={clsx('grid', 'grid-cols-1', 'md:grid-cols-2', 'gap-4', 'font-mono', 'text-xs')}>
                {/* SUPABASE_URL */}
                <div className="space-y-1.5">
                  <label className={clsx('text-slate-400', 'flex', 'items-center', 'justify-between')}>
                    <span>SUPABASE_URL</span>
                    {keys.SUPABASE_URL ? (
                      <span className={clsx('text-[9px]', 'text-[#00b894]', 'bg-[#00b894]/10', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-[#00b894]/20')}>DEFINIDO</span>
                    ) : (
                      <span className={clsx('text-[9px]', 'text-amber-500', 'bg-amber-950/30', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-amber-900/50')}>VAZIO</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={keys.SUPABASE_URL}
                    onChange={(e) => handleChange("SUPABASE_URL", e.target.value)}
                    placeholder="Ex: https://abccdefgxyz.supabase.co"
                    className={`w-full bg-[#090a0f]/60 border rounded py-2 px-3 text-slate-200 placeholder:text-slate-600 focus:outline-none transition-all ${
                      validateField("SUPABASE_URL", keys.SUPABASE_URL)
                        ? "border-amber-500/50 focus:border-amber-500"
                        : "border-[#1e293b]/40 focus:border-[#00b894]"
                    }`}
                  />
                  {validateField("SUPABASE_URL", keys.SUPABASE_URL) && (
                    <span className={clsx('text-[10px]', 'text-amber-500', 'mt-1', 'block', 'flex', 'items-center', 'gap-1', 'font-sans')}>
                      <AlertCircle className={clsx('w-3.5', 'h-3.5', 'text-amber-500', 'shrink-0')} />
                      {validateField("SUPABASE_URL", keys.SUPABASE_URL)}
                    </span>
                  )}
                </div>

                {/* SUPABASE_KEY */}
                <div className="space-y-1.5">
                  <label className={clsx('text-slate-400', 'flex', 'items-center', 'justify-between')}>
                    <span>SUPABASE_KEY (anon key ou service_role key)</span>
                    {keys.SUPABASE_KEY ? (
                      <span className={clsx('text-[9px]', 'text-[#00b894]', 'bg-[#00b894]/10', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-[#00b894]/20')}>DEFINIDO</span>
                    ) : (
                      <span className={clsx('text-[9px]', 'text-amber-500', 'bg-amber-950/30', 'px-1.5', 'py-0.2', 'rounded', 'border', 'border-amber-900/50')}>VAZIO</span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type={visibleKeys.SUPABASE_KEY ? "text" : "password"}
                      value={keys.SUPABASE_KEY}
                      onChange={(e) => handleChange("SUPABASE_KEY", e.target.value)}
                      placeholder="Chave de API pública ou privada"
                      className={clsx('w-full', 'bg-[#090a0f]/60', 'border', 'border-[#1e293b]/40', 'rounded', 'py-2', 'pl-3', 'pr-10', 'text-slate-200', 'placeholder:text-slate-600', 'focus:outline-none', 'focus:border-[#00b894]', 'transition-all')}
                    />
                    <button
                      type="button"
                      onClick={() => handleToggleVisibility("SUPABASE_KEY")}
                      className={clsx('absolute', 'right-3', 'top-1/2', '-translate-y-1/2', 'text-slate-500', 'hover:text-slate-300', 'cursor-pointer')}
                    >
                      {visibleKeys.SUPABASE_KEY ? <EyeOff className={clsx('w-4', 'h-4')} /> : <Eye className={clsx('w-4', 'h-4')} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Save Controls Panel */}
        <div className={clsx('bg-[#121420]', 'border', 'border-[#1e293b]/40', 'p-4', 'rounded', 'flex', 'items-center', 'justify-between', 'gap-4', 'flex-wrap')} id="credentials-actions-panel">
          <div className={clsx('text-[10px]', 'font-mono', 'text-slate-500', 'flex', 'items-center', 'gap-1.5', 'bg-black/30', 'py-2', 'px-3', 'rounded', 'border', 'border-zinc-900/55', 'max-w-lg')}>
            <Sparkles className={clsx('w-3.5', 'h-3.5', 'text-[#00b894]', 'animate-pulse')} />
            <span>As credenciais salvas entram em operação imediatamente após a confirmação do processo de persistência do servidor.</span>
          </div>
          
          <button
            type="submit"
            disabled={isSaving}
            className={clsx('bg-[#00b894]', 'hover:bg-[#00b894]/80', 'text-black', 'font-bold', 'font-mono', 'text-xs', 'px-6', 'py-2.5', 'rounded', 'cursor-pointer', 'transition-all', 'flex', 'items-center', 'gap-2', 'shadow-[0_0_12px_rgba(16,185,129,0.3)]', 'hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]', 'disabled:opacity-50')}
          >
            <Save className={clsx('w-4', 'h-4')} />
            {isSaving ? "SALVANDO CHAVES..." : "SALVAR TODAS AS CHAVES"}
          </button>
        </div>

      </form>

      {/* Safety Confirmation / Warning Overlay modal */}
      {showWarningModal && (
        <div className={clsx('fixed', 'inset-0', 'z-50', 'flex', 'items-center', 'justify-center', 'bg-black/80', 'backdrop-blur-sm', 'p-4', 'animate-fadeIn')}>
          <div className={clsx('bg-[#0b0c13]', 'border-2', 'border-red-500/60', 'w-full', 'max-w-xl', 'p-6', 'rounded-lg', 'shadow-[0_0_50px_rgba(239,68,68,0.25)]', 'flex', 'flex-col', 'gap-4')}>
            
            <div className={clsx('flex', 'items-start', 'gap-3.5', 'border-b', 'border-[#1e293b]/40', 'pb-4')}>
              <div className={clsx('p-2.5', 'bg-red-950/40', 'rounded', 'border', 'border-red-500/30')}>
                <AlertTriangle className={clsx('w-6', 'h-6', 'text-red-500', 'animate-pulse')} />
              </div>
              <div>
                <h3 className={clsx('text-sm', 'font-bold', 'text-white', 'font-mono', 'uppercase', 'tracking-wide')}>
                  ⚠️ CONFIRMAÇÃO DE GRAVAÇÃO COM INCONSISTÊNCIAS
                </h3>
                <p className={clsx('text-[11px]', 'text-slate-400', 'font-sans', 'mt-1')}>
                  O sistema identificou um ou mais campos com formatação suspeita que sabidamente impedirão a conexão real com as APIs externas.
                </p>
              </div>
            </div>

            <div className={clsx('bg-[#121420]', 'border', 'border-[#1e293b]/40', 'p-3.5', 'rounded', 'text-xs', 'font-mono', 'max-h-52', 'overflow-y-auto', 'space-y-2.5')}>
              {pendingWarnings.map((warning, idx) => (
                <div key={idx} className={clsx('flex', 'gap-2', 'text-amber-400', 'bg-amber-950/20', 'p-2', 'rounded', 'border', 'border-amber-500/20')}>
                  <AlertCircle className={clsx('w-4', 'h-4', 'shrink-0', 'text-amber-500')} />
                  <div>
                    <span className={clsx('font-bold', 'text-[10px]', 'uppercase', 'block', 'text-slate-400')}>{warning.key}</span>
                    <span className={clsx('text-[11px]', 'leading-relaxed', 'block', 'mt-0.5')}>{warning.message}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className={clsx('p-3', 'bg-black/40', 'border', 'border-zinc-900', 'rounded', 'text-[10px]', 'text-slate-400', 'leading-relaxed', 'font-sans')}>
              <strong>Impacto do Salvamento:</strong> Ao persistir valores inválidos, placeholders como "test", ou hashes truncados, o Painel do Orquestrador de Infra [04] entrará em modo de ERRO EXPLÍCITO DE CONEXÃO e desativará os gráficos e fluxos em tempo real.
            </div>

            <div className={clsx('flex', 'items-center', 'justify-end', 'gap-3', 'font-mono', 'text-xs', 'mt-2')}>
              <button
                onClick={() => setShowWarningModal(false)}
                className={clsx('bg-black', 'hover:bg-zinc-900', 'text-slate-300', 'hover:text-white', 'border', 'border-[#1e293b]', 'py-2', 'px-4', 'rounded', 'cursor-pointer', 'transition-all')}
              >
                CANCELAR E CORRIGIR
              </button>
              <button
                onClick={confirmAndSave}
                className={clsx('bg-red-600', 'hover:bg-red-700', 'text-white', 'font-bold', 'py-2', 'px-4', 'rounded', 'cursor-pointer', 'transition-all', 'shadow-[0_0_15px_rgba(239,68,68,0.4)]')}
              >
                FORÇAR SALVAMENTO (SALVAR ASSIM MESMO)
              </button>
            </div>

          </div>
        </div>
      )}
      
    </div>
  );
}
