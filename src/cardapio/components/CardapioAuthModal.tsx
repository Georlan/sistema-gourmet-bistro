/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { ArrowLeft, ArrowRight, Check, KeyRound, Phone, RefreshCw, ShieldCheck, User, X } from "lucide-react";
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

  const validatePhone = () => {
    if (!Number.isInteger(numericRestaurantId) || numericRestaurantId <= 0) {
      setErrorMessage("Não foi possível identificar o restaurante.");
      return false;
    }
    if (normalizedPhone.length < 10 || normalizedPhone.length > 11) {
      setErrorMessage("Informe um celular válido com DDD.");
      return false;
    }
    return true;
  };

  const requestCode = async (resend = false) => {
    if (!validatePhone()) return;
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
      setErrorMessage("Digite os 6 números do código enviado pelo WhatsApp.");
      return;
    }
    if (cleanName.length < 2) {
      setErrorMessage("Informe como devemos chamar você.");
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4 animate-fade-in cursor-pointer"
      id="auth-modal-overlay"
    >
      <div
        className="relative w-full max-w-md rounded-t-[28px] border border-koma-border bg-koma-panel p-5 shadow-2xl sm:rounded-[28px] sm:p-6 animate-scale-up"
        id="auth-modal-card"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-koma-subtle transition hover:bg-koma-raised hover:text-koma-foreground cursor-pointer"
          aria-label="Fechar identificação"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="pr-10">
          <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.16em] text-emerald-500">
            <span>Identificação</span>
            <span className="text-koma-muted">{step === "identify" ? "1 de 2" : "2 de 2"}</span>
          </div>
          <h2 className="mt-2 font-display text-xl font-black tracking-tight text-koma-foreground">
            {step === "identify" ? "Continue com seu celular" : "Só falta confirmar"}
          </h2>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-koma-muted">
            {step === "identify"
              ? "Usamos seu número para vincular o pedido e mostrar o acompanhamento neste restaurante."
              : `Digite o código enviado para ${formatBrazilianPhone(normalizedPhone)} e informe seu nome.`}
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2" aria-hidden="true">
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[9px] font-bold text-emerald-500">
            {step === "verify" ? <Check size={12} /> : <Phone size={12} />}
            Celular
          </div>
          <div className={step === "verify"
            ? "flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[9px] font-bold text-emerald-500"
            : "flex items-center gap-2 rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-[9px] font-bold text-koma-muted"}
          >
            <KeyRound size={12} /> Código
          </div>
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-semibold text-rose-400" role="alert">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4" id="auth-form-input">
          {step === "identify" ? (
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">Celular com DDD</span>
              <span className="relative block">
                <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-koma-muted" />
                <input
                  type="tel"
                  required
                  autoFocus
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="(00) 00000-0000"
                  value={phone}
                  onChange={(event) => {
                    setPhone(formatBrazilianPhone(event.target.value));
                    if (errorMessage) setErrorMessage("");
                  }}
                  className="h-12 w-full rounded-xl border border-koma-border bg-koma-card pl-11 pr-4 text-sm text-koma-foreground outline-none transition placeholder:text-koma-subtle focus:border-emerald-500"
                />
              </span>
            </label>
          ) : (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">Código de 6 números</span>
                <input
                  type="text"
                  required
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                    if (errorMessage) setErrorMessage("");
                  }}
                  className="h-12 w-full rounded-xl border border-koma-border bg-koma-card px-4 text-center font-mono text-xl tracking-[0.42em] text-koma-foreground outline-none transition placeholder:text-koma-subtle focus:border-emerald-500"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">Como devemos chamar você?</span>
                <span className="relative block">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-koma-muted" />
                  <input
                    type="text"
                    required
                    maxLength={100}
                    autoComplete="name"
                    placeholder="Seu nome"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      if (errorMessage) setErrorMessage("");
                    }}
                    className="h-12 w-full rounded-xl border border-koma-border bg-koma-card pl-11 pr-4 text-sm text-koma-foreground outline-none transition placeholder:text-koma-subtle focus:border-emerald-500"
                  />
                </span>
              </label>
            </>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black uppercase tracking-wider text-white transition hover:bg-emerald-600 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
          >
            <span>{isSubmitting ? "Aguarde..." : step === "identify" ? "Receber código" : "Confirmar e continuar"}</span>
            {!isSubmitting && <ArrowRight className="h-4 w-4" />}
          </button>

          {step === "verify" && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setStep("identify");
                  setErrorMessage("");
                }}
                className="inline-flex items-center gap-1 text-[10px] font-bold text-koma-subtle transition hover:text-koma-foreground cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Alterar número
              </button>
              <button
                type="button"
                disabled={isResending}
                onClick={() => void requestCode(true)}
                className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 transition hover:text-emerald-500 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isResending ? "animate-spin" : ""}`} />
                Reenviar código
              </button>
            </div>
          )}
        </form>

        <div className="mt-5 flex items-start gap-2 rounded-xl border border-koma-border bg-koma-card/70 p-3 text-[10px] leading-relaxed text-koma-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <span>O código serve para proteger seu histórico de pedidos e evitar que outra pessoa use seu número.</span>
        </div>
      </div>
    </div>
  );
}
