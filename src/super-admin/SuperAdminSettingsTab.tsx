import React, { useState, useEffect } from "react";
import {
  Settings,
  Key,
  Bell,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Send,
  HelpCircle,
} from "lucide-react";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";
import type { CredentialsStatus } from "./superAdminTypes";

interface SuperAdminSettingsTabProps {
  onAddLog: (
    text: string,
    level?: "INFO" | "WARNING" | "ERROR" | "CRITICAL" | "info" | "warning" | "error" | "critical" | "success",
    source?: string
  ) => void;
  onTriggerTelegramAlert: (text: string) => Promise<boolean>;
}

export function SuperAdminSettingsTab({
  onTriggerTelegramAlert,
}: SuperAdminSettingsTabProps) {
  const [credentials, setCredentials] = useState<CredentialsStatus | null>(null);
  const [isLoadingCreds, setIsLoadingCreds] = useState(false);
  const [telegramText, setTelegramText] = useState("");
  const [isSendingTelegram, setIsSendingTelegram] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<string | null>(null);

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

  const handleSendTelegramTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!telegramText.trim()) return;

    setIsSendingTelegram(true);
    setTelegramStatus(null);
    try {
      const ok = await onTriggerTelegramAlert(telegramText.trim());
      if (ok) {
        setTelegramStatus("Alerta de teste enviado com sucesso ao Telegram.");
        setTelegramText("");
      } else {
        setTelegramStatus("Não foi possível enviar a notificação.");
      }
    } catch (err) {
      setTelegramStatus(`Erro: ${superAdminErrorMessage(err)}`);
    } finally {
      setIsSendingTelegram(false);
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
      name: "Supabase PostgreSQL",
      isConfigured: credentials?.supabase ? credentials.supabase.configured : null,
      details: "Banco de dados e isolamento multi-tenant",
    },
    {
      id: "railway",
      name: "Railway Platform",
      isConfigured: credentials?.railway ? credentials.railway.configured : null,
      details: "Hospedagem e operações do backend",
    },
    {
      id: "cloudflare",
      name: "Cloudflare Edge & DNS",
      isConfigured: credentials?.cloudflare ? credentials.cloudflare.configured : null,
      details: "Frontend, proxy e DNS",
    },
    {
      id: "github",
      name: "GitHub Deployments",
      isConfigured: credentials?.github ? credentials.github.configured : null,
      details: "Quality gates e histórico de builds",
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
              Configurações da Plataforma KÔMA
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
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/30">
                        <AlertCircle className="w-3 h-3" /> Não configurado
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
              <Bell className="w-4 h-4 text-amber-400" /> Teste de Notificações Telegram
            </h3>
            <span className={`text-[11px] font-semibold flex items-center gap-1 ${telegramConfigured ? "text-emerald-400" : "text-koma-muted"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${telegramConfigured ? "bg-emerald-400" : "bg-zinc-600"}`}></span>
              {telegramConfigured ? "Configurado" : "Não verificado"}
            </span>
          </div>

          <form onSubmit={handleSendTelegramTest} className="space-y-3 text-xs">
            <p className="text-koma-muted">
              O envio só é liberado quando o backend confirma que bot e chat estão configurados.
            </p>

            <div>
              <label className="block text-koma-secondary font-medium mb-1">Texto da Notificação</label>
              <textarea
                rows={3}
                placeholder="Ex: Teste operacional do Super Admin KÔMA..."
                value={telegramText}
                onChange={e => setTelegramText(e.target.value)}
                disabled={!telegramConfigured}
                className="w-full bg-koma-page border border-zinc-800 rounded-lg p-2.5 text-xs text-koma-foreground placeholder:text-koma-subtle focus:outline-none focus:border-[#00b894] disabled:opacity-50"
              />
            </div>

            {telegramStatus && (
              <p className="p-2 rounded bg-zinc-900 border border-zinc-800 text-xs text-koma-secondary">
                {telegramStatus}
              </p>
            )}

            <button
              type="submit"
              disabled={!telegramConfigured || isSendingTelegram || !telegramText.trim()}
              className="px-4 py-2 bg-[#00b894] hover:bg-[#00c996] text-black font-bold rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              {isSendingTelegram ? "Enviando..." : "Transmitir Alerta"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default SuperAdminSettingsTab;
