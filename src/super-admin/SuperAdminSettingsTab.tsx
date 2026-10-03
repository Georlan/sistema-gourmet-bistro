import React, { useState, useEffect } from "react";
import {
  Settings,
  Key,
  Bell,
  CheckCircle2,
  RefreshCw,
  HelpCircle,
} from "lucide-react";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";
import type { CredentialsStatus, TelegramHealthStatus } from "./superAdminTypes";


export function SuperAdminSettingsTab() {
  const [credentials, setCredentials] = useState<CredentialsStatus | null>(null);
  const [isLoadingCreds, setIsLoadingCreds] = useState(false);
  const [telegramHealth, setTelegramHealth] = useState<TelegramHealthStatus | null>(null);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [checkingTelegram, setCheckingTelegram] = useState(false);

  const fetchCredentials = async () => {
    setIsLoadingCreds(true);
    try {
      const res = await superAdminFetch("/api/super-admin/credentials");
      if (res.ok) {
        setCredentials(await res.json());
      } else {
        setCredentials(null);
      }
    } catch {
      setCredentials(null);
    } finally {
      setIsLoadingCreds(false);
    }
  };

  useEffect(() => {
    fetchCredentials();
  }, []);

  const checkTelegram = async () => {
    setCheckingTelegram(true);
    setTelegramHealth(null);
    setTelegramError(null);
    try {
      const response = await superAdminFetch("/api/super-admin/telegram/health");
      if (!response.ok) throw new Error("Diagnóstico indisponível");
      setTelegramHealth(await response.json());
    } catch (error) {
      setTelegramError("Diagnóstico não confirmado. " + superAdminErrorMessage(error));
    } finally {
      setCheckingTelegram(false);
    }
  };

  const integrations = [
    {
      id: "mercado_pago",
      name: "Mercado Pago",
      isConfigured: credentials?.mercado_pago ? credentials.mercado_pago.configured : null,
      details: "OAuth do marketplace, split e assinatura de webhook no backend",
    },
    {
      id: "supabase",
      name: "Supabase (acesso opcional)",
      isConfigured: credentials?.supabase ? credentials.supabase.configured : null,
      details: "Credencial administrativa opcional; a disponibilidade do banco está em Saúde",
    },
    {
      id: "railway",
      name: "Railway Platform",
      isConfigured: credentials?.railway ? credentials.railway.configured : null,
      details: "API administrativa opcional; ausência de token não significa hospedagem desconectada",
    },
    {
      id: "cloudflare",
      name: "Cloudflare Edge & DNS",
      isConfigured: credentials?.cloudflare ? credentials.cloudflare.configured : null,
      details: "Acesso administrativo DNS opcional; ausência de token não significa frontend indisponível",
    },
    {
      id: "github",
      name: "GitHub Deployments",
      isConfigured: credentials?.github ? credentials.github.configured : null,
      details: "Token opcional para consultar o histórico de um repositório público",
    },
    {
      id: "telegram",
      name: "Telegram Bot Alertas",
      isConfigured: credentials?.telegram ? credentials.telegram.configured : null,
      details: "Canal opcional de alertas operacionais",
    },
  ];

  const telegramConfigured = credentials?.telegram?.configured === true;

  return (
    <div className="space-y-6">
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-koma-foreground flex items-center gap-2">
              <Settings className="w-5 h-5 text-[#00b894]" />
              Acessos e diagnóstico de integrações
            </h2>
            <p className="text-xs text-koma-muted mt-0.5">
              Estado de configuração das integrações centrais sem expor credenciais
            </p>
          </div>

          <button
            type="button"
            onClick={fetchCredentials}
            disabled={isLoadingCreds}
            className="p-2 bg-koma-page border border-zinc-800 hover:border-zinc-700 rounded-lg text-koma-secondary hover:text-koma-foreground transition-colors disabled:opacity-50 cursor-pointer self-start sm:self-auto"
            title="Atualizar estado das integrações"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingCreds ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2">
              <Key className="w-4 h-4 text-[#00b894]" /> Integrações Centrais
            </h3>
            <span className="text-[11px] text-koma-muted font-medium">Somente presença de configuração</span>
          </div>

          <div className="space-y-3">
            {integrations.map(integ => (
              <div
                key={integ.id}
                className="p-3.5 bg-koma-page rounded-xl border border-zinc-800 flex items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="font-bold text-koma-foreground flex items-center gap-2">
                    {integ.name}
                    {integ.isConfigured === true ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/30">
                        <CheckCircle2 className="w-3 h-3" /> Configurado
                      </span>
                    ) : integ.isConfigured === false ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-koma-muted bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                        <HelpCircle className="w-3 h-3" /> { ["railway", "cloudflare", "github", "supabase"].includes(integ.id) ? "Acesso opcional não habilitado" : "Não configurado" }
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-koma-muted bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                        <HelpCircle className="w-3 h-3" /> Não verificado
                      </span>
                    )}
                  </div>
                  <p className="text-koma-muted text-[11px] mt-0.5">{integ.details}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-400" /> Diagnóstico Telegram
            </h3>
            <span className={`text-[11px] font-semibold flex items-center gap-1 ${telegramConfigured ? "text-emerald-400" : "text-koma-muted"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${telegramConfigured ? "bg-emerald-400" : "bg-zinc-600"}`}></span>
              {telegramConfigured ? "Configurado" : "Não verificado"}
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <p className="text-koma-muted">Consulta o bot, o destino e a participação pelo backend. Nenhuma mensagem é enviada.</p>
            {telegramHealth && <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
              <strong className={telegramHealth.status === "verified" ? "text-emerald-400" : "text-koma-secondary"}>
                {telegramHealth.status === "verified" ? "Bot e destino verificados" : telegramHealth.status === "unavailable" ? "Consulta rejeitada / acesso indisponível" : telegramHealth.status === "not_configured" ? "Não configurado" : "Não verificado"}
              </strong>
              <p>{telegramHealth.detail}</p>
              <p className="text-koma-muted">Verificado em {new Date(telegramHealth.checked_at).toLocaleString("pt-BR")}</p>
              <p className="text-koma-muted">Entrega de mensagens: não testada.</p>
            </div>}
            {telegramError && <p role="alert">{telegramError}</p>}
            <button type="button" onClick={checkTelegram} disabled={!telegramConfigured || checkingTelegram} className="px-4 py-2 bg-[#00b894] text-black font-bold rounded-lg disabled:opacity-50">
              {checkingTelegram ? "Verificando…" : "Verificar Telegram"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SuperAdminSettingsTab;
