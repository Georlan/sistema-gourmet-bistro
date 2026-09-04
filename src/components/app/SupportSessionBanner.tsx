import React, { useEffect, useState } from "react";
import { Clock, LogOut, ShieldAlert } from "lucide-react";
import { clearOperatorSession } from "../../utils/authSession";
import {
  SUPPORT_SESSION_STORAGE_KEY,
  type StoredSupportSession,
} from "../../super-admin/SuperAdminSupportModal";
import { API_BASE_URL } from "../../config/api";

export function SupportSessionBanner() {
  const [session, setSession] = useState<StoredSupportSession | null>(() => {
    try {
      const raw = localStorage.getItem(SUPPORT_SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [remainingText, setRemainingText] = useState<string>("");
  const [isEnding, setIsEnding] = useState<boolean>(false);

  useEffect(() => {
    if (!session?.expiresAt) return;

    const updateTimer = () => {
      const expires = new Date(session.expiresAt).getTime();
      const now = Date.now();
      const diffMs = expires - now;

      if (diffMs <= 0) {
        setRemainingText("Expirado");
        handleEndSession(true);
        return;
      }

      const minutes = Math.floor(diffMs / 60000);
      const seconds = Math.floor((diffMs % 60000) / 1000);
      setRemainingText(`${minutes}m ${seconds < 10 ? "0" : ""}${seconds}s`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [session]);

  if (!session) return null;

  const handleEndSession = async (isAutomatic = false) => {
    if (isEnding) return;
    setIsEnding(true);

    try {
      const token =
        localStorage.getItem("koma_caixa_token") ||
        localStorage.getItem("token");

      if (token) {
        await fetch(`${API_BASE_URL}/api/super-admin/support/end-current`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            reason: isAutomatic
              ? "Sessão de suporte expirada automaticamente."
              : "Encerrada voluntariamente pelo operador KÔMA via banner.",
          }),
        }).catch(() => null);
      }
    } finally {
      localStorage.removeItem(SUPPORT_SESSION_STORAGE_KEY);
      clearOperatorSession();
      window.location.href = "/super-admin";
    }
  };

  return (
    <div
      role="region"
      aria-label="Aviso de Modo Suporte Ativo"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-amber-600/80 bg-amber-950/95 px-4 py-2 text-xs text-amber-100 shadow-md backdrop-blur"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 font-bold uppercase tracking-wider text-amber-400">
          <ShieldAlert className="h-3.5 w-3.5" />
          Modo Suporte Ativo
        </span>
        <span className="text-amber-200/90">
          Restaurante: <strong>{session.restaurantName}</strong> (#{session.restaurantId})
        </span>
        <span className="hidden text-amber-400/60 sm:inline">•</span>
        <span className="text-amber-200/80">
          Operador: <strong>{session.operator}</strong>
        </span>
        {session.reason && (
          <>
            <span className="hidden text-amber-400/60 sm:inline">•</span>
            <span className="italic text-amber-300/80 truncate max-w-xs" title={session.reason}>
              "{session.reason}"
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 font-mono font-semibold text-amber-300">
          <Clock className="h-3.5 w-3.5 text-amber-400" />
          {remainingText || "Calculando..."}
        </span>
        <button
          type="button"
          onClick={() => handleEndSession(false)}
          disabled={isEnding}
          className="flex items-center gap-1 rounded-md bg-amber-500 px-3 py-1 font-bold text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
        >
          <LogOut className="h-3 w-3" />
          {isEnding ? "Encerrando..." : "Encerrar Suporte"}
        </button>
      </div>
    </div>
  );
}
