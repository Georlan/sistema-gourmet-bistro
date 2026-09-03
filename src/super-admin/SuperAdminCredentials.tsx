import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle, Key, RefreshCw, ShieldAlert } from "lucide-react";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";

interface SuperAdminCredentialsProps {
  onAddLog: (text: string, type: "info" | "success" | "warning" | "error" | "critical") => void;
  onRefreshHealthCheck?: () => void;
}

type IntegrationName = "sentry" | "cloudflare" | "railway" | "github" | "telegram" | "supabase";
type ConfigurationStatus = Record<IntegrationName, { configured: boolean }>;

const EMPTY_STATUS: ConfigurationStatus = {
  sentry: { configured: false },
  cloudflare: { configured: false },
  railway: { configured: false },
  github: { configured: false },
  telegram: { configured: false },
  supabase: { configured: false },
};

const LABELS: Record<IntegrationName, string> = {
  sentry: "Sentry",
  cloudflare: "Cloudflare",
  railway: "Railway",
  github: "GitHub",
  telegram: "Telegram",
  supabase: "Supabase",
};

function normalizeStatus(payload: unknown): ConfigurationStatus {
  if (!payload || typeof payload !== "object") return EMPTY_STATUS;
  const source = payload as Record<string, unknown>;
  return Object.keys(EMPTY_STATUS).reduce((result, key) => {
    const value = source[key];
    result[key as IntegrationName] = {
      configured: Boolean(value && typeof value === "object" && (value as { configured?: unknown }).configured === true),
    };
    return result;
  }, { ...EMPTY_STATUS } as ConfigurationStatus);
}

export default function SuperAdminCredentials({
  onAddLog,
  onRefreshHealthCheck,
}: SuperAdminCredentialsProps) {
  const [status, setStatus] = useState<ConfigurationStatus>(EMPTY_STATUS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<"cloudflare" | "github" | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<"cloudflare" | "github", string>>>({});

  const fetchConfiguration = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await superAdminFetch("/api/super-admin/credentials");
      const payload = await response.json();
      setStatus(normalizeStatus(payload));
      onAddLog("Metadados de configuração das integrações carregados.", "info");
    } catch (requestError) {
      const message = superAdminErrorMessage(requestError);
      setStatus(EMPTY_STATUS);
      setError(message);
      onAddLog(`Metadados de credenciais indisponíveis: ${message}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchConfiguration();
  }, []);

  const testConnection = async (service: "cloudflare" | "github") => {
    setTesting(service);
    setTestResults(previous => ({ ...previous, [service]: undefined }));
    try {
      const response = await superAdminFetch("/api/super-admin/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
      });
      const payload = await response.json() as { success?: boolean; source?: string };
      if (!payload.success) throw new Error("a API não confirmou a conexão");
      const message = `Conexão verificada pela fonte ${payload.source || "externa"}.`;
      setTestResults(previous => ({ ...previous, [service]: message }));
      onAddLog(`${LABELS[service]}: ${message}`, "success");
      onRefreshHealthCheck?.();
    } catch (requestError) {
      const message = superAdminErrorMessage(requestError);
      setTestResults(previous => ({ ...previous, [service]: message }));
      onAddLog(`Teste ${LABELS[service]} indisponível: ${message}`, "error");
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-6" id="superadmin-credentials-manager">
      <header className="rounded border border-[#1e293b]/40 bg-koma-card p-5">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-koma-foreground">
              <Key className="h-5 w-5 text-[#00b894]" />
              Estado das integrações
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-koma-subtle">
              Esta tela não recebe nem exibe segredos. A configuração deve ser feita no cofre de variáveis do ambiente de produção.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchConfiguration()}
            disabled={isLoading}
            className="flex items-center gap-2 rounded border border-[#334155] px-3 py-2 text-xs disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </header>

      <div className="rounded border border-amber-800/60 bg-amber-950/20 p-4 text-xs text-amber-200">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            “Configurado” indica apenas que as variáveis obrigatórias existem no servidor; não confirma saúde ou acesso. Gravação pelo painel permanece indisponível até existir um cofre auditável.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded border border-red-800 bg-red-950/30 p-4 text-xs text-red-300" role="status">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(LABELS) as IntegrationName[]).map(name => {
          const configured = status[name].configured;
          const canTest = name === "cloudflare" || name === "github";
          const testResult = canTest ? testResults[name] : undefined;
          return (
            <section key={name} className="rounded border border-[#1e293b]/40 bg-koma-card p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-koma-foreground">{LABELS[name]}</h3>
                <span className={`rounded border px-2 py-1 text-[9px] font-bold ${
                  configured
                    ? "border-amber-700 text-amber-300"
                    : "border-slate-700 text-koma-muted"
                }`}>
                  {configured ? "CONFIGURADO — NÃO VERIFICADO" : "NÃO CONFIGURADO"}
                </span>
              </div>

              {canTest && (
                <div className="mt-4 border-t border-[#1e293b]/40 pt-3">
                  <button
                    type="button"
                    disabled={!configured || testing === name}
                    onClick={() => void testConnection(name)}
                    className="rounded border border-[#334155] px-2.5 py-1.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {testing === name ? "Testando..." : "Testar conexão real"}
                  </button>
                  {testResult && (
                    <p className="mt-2 flex items-start gap-1.5 text-[10px] text-koma-subtle">
                      <CheckCircle className="mt-0.5 h-3 w-3 shrink-0" />
                      {testResult}
                    </p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
