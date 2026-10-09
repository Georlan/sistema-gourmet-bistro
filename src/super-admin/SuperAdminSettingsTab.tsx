import React, { useRef, useState } from "react";
import { Bell } from "lucide-react";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";
import type { TelegramHealthStatus } from "./superAdminTypes";

export function SuperAdminSettingsTab() {
  const [telegramHealth, setTelegramHealth] = useState<TelegramHealthStatus | null>(null);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [checkingTelegram, setCheckingTelegram] = useState(false);
  const checking = useRef(false);
  const checkTelegram = async () => {
    if (checking.current) return;
    checking.current = true;
    setCheckingTelegram(true); setTelegramHealth(null); setTelegramError(null);
    try {
      const response = await superAdminFetch("/api/super-admin/telegram/health");
      if (!response.ok) throw new Error("Diagnóstico indisponível");
      setTelegramHealth(await response.json());
    } catch (error) {
      setTelegramError("Diagnóstico não confirmado. " + superAdminErrorMessage(error));
    } finally { checking.current = false; setCheckingTelegram(false); }
  };
  return (
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-400" /> Diagnóstico Telegram
            </h3>
            <span className={`text-[11px] font-semibold flex items-center gap-1 ${"text-koma-muted"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${"bg-zinc-600"}`}></span>
              {telegramHealth?.status === "verified" ? "Verificado" : "Não verificado"}
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
            <button type="button" onClick={checkTelegram} disabled={checkingTelegram} className="px-4 py-2 bg-[#00b894] text-black font-bold rounded-lg disabled:opacity-50">
              {checkingTelegram ? "Verificando…" : "Verificar Telegram"}
            </button>
          </div>
        </div>
  );
}
export default SuperAdminSettingsTab;
