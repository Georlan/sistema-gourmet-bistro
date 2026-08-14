/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { ArrowLeft, ArrowRight, KeyRound, Phone, RefreshCw, User, X } from "lucide-react";
import { API_BASE_URL } from "../../config/api";
import {
  CustomerProfile,
  formatBrazilianPhone,
  mapCustomerProfile,
  normalizeBrazilianPhone,
} from "../customerSession";

interface CardapioAuthModalProps {
  restaurantId: string | number;
  onClose: () => void;
  onLoginSuccess: (profile: CustomerProfile, token: string) => void;
}

export default function CardapioAuthModal({
  restaurantId,
  onClose,
  onLoginSuccess,
}: CardapioAuthModalProps) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"identify" | "verify">("identify");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const normalizedPhone = normalizeBrazilianPhone(phone);
  const cleanName = name.trim();
  const numericRestaurantId = Number(restaurantId);

  const validateIdentity = () => {
    if (!Number.isInteger(numericRestaurantId) || numericRestaurantId <= 0) {
      setErrorMessage("Não foi possível identificar o restaurante.");
      return false;
    }
    if (normalizedPhone.length < 10 || normalizedPhone.length > 11) {
      setErrorMessage("Informe um celular válido com DDD.");
      return false;
    }
    if (cleanName.length < 2) {
      setErrorMessage("Informe um nome válido.");
      return false;
    }
    return true;
  };

  const requestCode = async (resend = false) => {
    if (!validateIdentity()) return;
    resend ? setIsResending(true) : setIsSubmitting(true);
    setErrorMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/cardapio/clientes/otp/solicitar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurante_id: numericRestaurantId,
          telefone: normalizedPhone,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.detail || "Não foi possível enviar o código agora.");
      }
      setStep("verify");
      setCode("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao enviar o código.");
    } finally {
      setIsSubmitting(false);
      setIsResending(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (step === "identify") {
      await requestCode();
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setErrorMessage("Digite o código de 6 números enviado pelo WhatsApp.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/cardapio/clientes/otp/verificar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurante_id: numericRestaurantId,
          telefone: normalizedPhone,
          codigo: code,
          nome: cleanName,
          endereco: "",
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.access_token || !data?.cliente) {
        throw new Error(data?.detail || "Código inválido ou expirado.");
      }
      onLoginSuccess(mapCustomerProfile(data.cliente), String(data.access_token));
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível confirmar o código.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 animate-fade-in cursor-pointer"
      id="auth-modal-overlay"
    >
      <div
        className="relative w-full max-w-sm rounded-3xl bg-koma-panel border border-gray-800/80 p-6 shadow-2xl animate-scale-up"
        id="auth-modal-card"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full hover:bg-gray-800 text-koma-subtle transition cursor-pointer"
          aria-label="Fechar identificação"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="text-center mt-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 mb-3">
            {step === "identify" ? <Phone className="h-6 w-6" /> : <KeyRound className="h-6 w-6" />}
          </div>
          <h2 className="font-display text-xl font-bold text-koma-foreground">
            {step === "identify" ? "Identifique-se pelo celular" : "Confirme seu WhatsApp"}
          </h2>
          <p className="mt-1.5 text-xs text-koma-subtle max-w-xs mx-auto leading-relaxed">
            {step === "identify"
              ? "Seu número conecta seus pedidos e perfil somente neste restaurante."
              : `Enviamos um código de 6 números para ${formatBrazilianPhone(normalizedPhone)}.`}
          </p>
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-xl bg-rose-500/10 p-3 border border-rose-500/20 text-xs text-rose-400 font-medium text-center">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4" id="auth-form-input">
          {step === "identify" ? (
            <>
              <label className="block">
                <span className="text-[10px] font-bold text-koma-muted uppercase tracking-wider block mb-1">Celular com DDD</span>
                <span className="relative block">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-koma-muted pointer-events-none" />
                  <input
                    type="tel"
                    required
                    autoFocus
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="(00) 00000-0000"
                    value={phone}
                    onChange={(event) => setPhone(formatBrazilianPhone(event.target.value))}
                    className="w-full rounded-xl border border-koma-border bg-koma-card py-3 pl-10 pr-4 text-xs text-koma-foreground placeholder-gray-600 focus:border-emerald-500 outline-hidden transition"
                  />
                </span>
              </label>

              <label className="block">
                <span className="text-[10px] font-bold text-koma-muted uppercase tracking-wider block mb-1">Como devemos chamar você?</span>
                <span className="relative block">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-koma-muted pointer-events-none" />
                  <input
                    type="text"
                    required
                    maxLength={100}
                    autoComplete="name"
                    placeholder="Nome completo"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-xl border border-koma-border bg-koma-card py-3 pl-10 pr-4 text-xs text-koma-foreground placeholder-gray-600 focus:border-emerald-500 outline-hidden transition"
                  />
                </span>
              </label>
            </>
          ) : (
            <label className="block">
              <span className="text-[10px] font-bold text-koma-muted uppercase tracking-wider block mb-1">Código de confirmação</span>
              <input
                type="text"
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full rounded-xl border border-koma-border bg-koma-card px-4 py-3 text-center font-mono text-xl tracking-[0.45em] text-koma-foreground placeholder-gray-700 focus:border-emerald-500 outline-hidden transition"
              />
            </label>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 py-3.5 text-center text-xs font-bold text-white transition flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider"
          >
            <span>{isSubmitting ? "Aguarde..." : step === "identify" ? "Enviar código" : "Confirmar e entrar"}</span>
            {!isSubmitting && <ArrowRight className="h-4 w-4" />}
          </button>

          {step === "verify" && (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => { setStep("identify"); setErrorMessage(""); }}
                className="inline-flex items-center gap-1 text-[10px] font-bold text-koma-subtle hover:text-white transition cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Alterar número
              </button>
              <button
                type="button"
                disabled={isResending}
                onClick={() => void requestCode(true)}
                className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isResending ? "animate-spin" : ""}`} />
                Reenviar código
              </button>
            </div>
          )}
        </form>

        <p className="mt-4 text-[10px] text-koma-muted text-center leading-relaxed">
          O código confirma que o número pertence a você e protege seu histórico e seus pontos.
        </p>
      </div>
    </div>
  );
}
