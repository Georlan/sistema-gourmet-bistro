import React, { useState, useEffect } from "react";
import {
  Settings,
  Key,
  Bell,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Send,
  Shield,
  ExternalLink,
} from "lucide-react";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";

interface SuperAdminSettingsTabProps {
  onAddLog: (
    text: string,
    level?: "INFO" | "WARNING" | "ERROR" | "CRITICAL" | "info" | "warning" | "error" | "critical" | "success",
    source?: string
  ) => void;
  onTriggerTelegramAlert: (text: string) => Promise<boolean>;
}

type IntegrationKey = "mercado_pago" | "telegram" | "supabase" | "railway" | "cloudflare" | "github";

export function SuperAdminSettingsTab({
  onAddLog,
  onTriggerTelegramAlert,
}: SuperAdminSettingsTabProps) {
  const [telegramText, setTelegramText] = useState("");
  const [isSendingTelegram, setIsSendingTelegram] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<string | null>(null);

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
      name: "Mercado Pago Produção (KomaADMIN)",
      configured: true,
      statusText: "Split & Webhook HMAC Configurados",
      details: "Client ID 2722128383126106 • Redirect URI ativo",
    },
    {
      id: "supabase",
      name: "Supabase PostgreSQL",
      configured: true,
      statusText: "Conexão de Produção Ativa",
      details: "Pool transacional com multi-tenancy e RLS",
    },
    {
      id: "railway",
      name: "Railway Platform",
      configured: true,
      statusText: "Serviço Kôma Online",
      details: "Projeto passionate-truth • Environment production",
    },
    {
      id: "cloudflare",
      name: "Cloudflare Edge & DNS",
      configured: true,
      statusText: "Proxy & SSL Ativo",
      details: "Roteamento dos domínios SaaS e cardápios",
    },
    {
      id: "telegram",
      name: "Telegram Bot Alertas",
      configured: true,
      statusText: "Canal de Monitoramento Conectado",
      details: "Transmissão de alertas operacionais em tempo real",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-koma-foreground flex items-center gap-2">
            <Settings className="w-5 h-5 text-[#00b894]" />
            Configurações da Plataforma KÔMA
          </h2>
          <p className="text-xs text-koma-muted mt-0.5">
            Gerenciamento de integrações centrais, canais de notificação e parâmetros de ambiente
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Integrations Status List */}
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2">
              <Key className="w-4 h-4 text-[#00b894]" /> Integrações Centrais
            </h3>
            <span className="text-[11px] text-koma-muted font-medium">Ambiente Produção</span>
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
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/30">
                      <CheckCircle2 className="w-3 h-3" /> Configurado
                    </span>
                  </div>
                  <p className="text-koma-muted text-[11px] mt-0.5">{integ.details}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Telegram Test Alerts Channel */}
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-400" /> Teste de Notificações Telegram
            </h3>
            <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Bot Ativo
            </span>
          </div>

          <form onSubmit={handleSendTelegramTest} className="space-y-3 text-xs">
            <p className="text-koma-muted">
              Envie uma mensagem de teste para verificar a entrega de alertas operacionais no canal do Telegram.
            </p>

            <div>
              <label className="block text-koma-secondary font-medium mb-1">Texto da Notificação</label>
              <textarea
                rows={3}
                placeholder="Ex: Teste operacional do SuperAdmin KÔMA..."
                value={telegramText}
                onChange={e => setTelegramText(e.target.value)}
                className="w-full bg-koma-page border border-zinc-800 rounded-lg p-2.5 text-xs text-koma-foreground placeholder:text-koma-subtle focus:outline-none focus:border-[#00b894]"
              />
            </div>

            {telegramStatus && (
              <p className="p-2 rounded bg-zinc-900 border border-zinc-800 text-xs text-koma-secondary">
                {telegramStatus}
              </p>
            )}

            <button
              type="submit"
              disabled={isSendingTelegram || !telegramText.trim()}
              className="px-4 py-2 bg-[#00b894] hover:bg-[#00c996] text-black font-bold rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
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
