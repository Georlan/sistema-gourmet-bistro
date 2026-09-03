import React, { useState } from "react";
import { AlertCircle, Clock, Headphones, ShieldAlert, X } from "lucide-react";
import { superAdminFetch } from "./superAdminApi";
import type { Tenant } from "./superAdminTypes";
import { saveOperatorSession } from "../utils/authSession";

interface SuperAdminSupportModalProps {
  tenant: Tenant;
  onClose: () => void;
  onSessionStarted?: (tenantId: string) => void;
}

export const SUPPORT_SESSION_STORAGE_KEY = "koma_support_session";

export interface StoredSupportSession {
  sessionId: string;
  restaurantId: number;
  restaurantName: string;
  operator: string;
  reason: string;
  expiresAt: string;
}

export function SuperAdminSupportModal({
  tenant,
  onClose,
  onSessionStarted,
}: SuperAdminSupportModalProps) {
  const [reason, setReason] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanReason = reason.trim();
    if (cleanReason.length < 5) {
      setError("O motivo da intervenção é obrigatório (mínimo 5 caracteres).");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await superAdminFetch(
        `/api/super-admin/support/${tenant.id}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: cleanReason,
            duration_minutes: Number(durationMinutes),
          }),
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || "Falha ao iniciar sessão de suporte.");
      }

      const data = await response.json();

      // Grava a sessão de suporte localmente para exibição do banner
      const sessionData: StoredSupportSession = {
        sessionId: data.session_id,
        restaurantId: data.restaurant_id,
        restaurantName: data.restaurant_name,
        operator: data.operator,
        reason: data.reason,
        expiresAt: data.expires_at,
      };
      localStorage.setItem(
        SUPPORT_SESSION_STORAGE_KEY,
        JSON.stringify(sessionData)
      );

      // Aplica as credenciais operacionais temporárias da sessão de suporte
      saveOperatorSession(data.access_token, {
        id: `support:${data.operator}`,
        nome: `Suporte KÔMA (${data.operator})`,
        role: "admin",
      });

      if (onSessionStarted) {
        onSessionStarted(tenant.id);
      }

      // Redireciona imediatamente para o caixa operacional com indicador de suporte
      window.location.href = `/?view=caixa&support=1`;
    } catch (err: any) {
      setError(err?.message || "Erro inesperado ao criar sessão de suporte.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg space-y-5 rounded-2xl border border-amber-600/40 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2 text-amber-400">
            <ShieldAlert className="h-5 w-5" />
            <h3 className="text-base font-bold text-zinc-100">
              Iniciar Modo Suporte (Auditado)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 text-xs text-amber-200">
          <div className="flex items-start gap-2.5">
            <Headphones className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="space-y-1">
              <p className="font-semibold text-amber-300">
                Estabelecimento-alvo: {tenant.name} (#{tenant.id})
              </p>
              <p className="text-amber-200/80 leading-relaxed">
                Você acessará o ambiente operacional deste restaurante com sua
                identidade de operador KÔMA. Nenhuma senha de cliente é utilizada ou
                revelada. Todas as ações nesta sessão serão registradas em trilha de
                auditoria imutável.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <label className="block">
            <span className="mb-1 block font-medium text-zinc-300">
              Motivo da Intervenção de Suporte <span className="text-rose-400">*</span>
            </span>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              placeholder="Ex: Investigação de fechamento de caixa ou cancelamento de item relatado pelo cliente."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
            />
            <span className="mt-1 block text-[10px] text-zinc-400">
              Obrigatório para registro em trilha de auditoria permanente.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 flex items-center gap-1 font-medium text-zinc-300">
              <Clock className="h-3.5 w-3.5 text-amber-400" /> Duração da Sessão
            </span>
            <select
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-zinc-100 focus:border-amber-500 focus:outline-none"
            >
              <option value={15}>15 minutos</option>
              <option value={30}>30 minutos (recomendado)</option>
              <option value={60}>60 minutos (sessão longa)</option>
            </select>
          </label>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-800/60 bg-rose-950/40 p-3 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-zinc-800 pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 font-bold text-black hover:bg-amber-400 disabled:opacity-50 shadow-md shadow-amber-500/20"
            >
              {isSubmitting ? "Iniciando..." : "Entrar em Modo Suporte"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
