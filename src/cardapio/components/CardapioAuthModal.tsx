/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Coins, KeyRound, Phone, RefreshCw, Sparkles, User, X } from "lucide-react";
import { API_BASE_URL } from "../../config/api";
import { authFetch, authRequestErrorMessage } from "../../utils/authRequest";
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
      const response = await authFetch(`${API_BASE_URL}/cardapio/clientes/otp/solicitar`, {
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
      setErrorMessage(authRequestErrorMessage(error, "Falha ao enviar o código."));
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
      setErrorMessage("Digite os 6 números do código recebido.");
      return;
    }
    if (cleanName.length < 2) {
      setErrorMessage("Informe seu nome para personalizarmos seu atendimento.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const response = await authFetch(`${API_BASE_URL}/cardapio/clientes/otp/verificar`, {
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
      setErrorMessage(authRequestErrorMessage(error, "Não foi possível confirmar o código."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm p-0 sm:items-center sm:p-4 animate-fade-in cursor-pointer"
      id="auth-modal-overlay"
    >
      <div
        className="relative w-full max-w-md rounded-t-[28px] border border-white/10 bg-[#0e1217] p-6 shadow-2xl sm:rounded-[28px] animate-scale-up"
        id="auth-modal-card"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Fechar */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-gray-400 transition hover:bg-white/10 hover:text-white cursor-pointer"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header com Ícone e Benefícios */}
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shadow-inner">
            {step === "identify" ? <Coins className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
              {step === "identify" ? "Clube de Vantagens" : "Verificação Rápida"}
            </span>
            <h2 className="font-display text-lg font-black tracking-tight text-white">
              {step === "identify" ? "Acesse seus Benefícios" : "Confirme seu WhatsApp"}
            </h2>
          </div>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-gray-300">
          {step === "identify"
            ? "Ganhe cashback em cada pedido, resgate cupons exclusivos e acompanhe seu histórico."
            : `Enviamos um código de 6 dígitos via WhatsApp para ${formatBrazilianPhone(normalizedPhone)}.`}
        </p>

        {/* Indicador de Etapas */}
        <div className="mt-4 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-emerald-500 transition-all duration-300" />
          <div className={`flex-1 h-1.5 rounded-full transition-all duration-300 ${step === "verify" ? "bg-emerald-500" : "bg-white/10"}`} />
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-semibold text-rose-400 animate-fade-in" role="alert">
            <p>{errorMessage}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4" id="auth-form-input">
          {step === "identify" ? (
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-gray-300">Seu WhatsApp (com DDD)</span>
              <div className="relative">
                <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="tel"
                  autoFocus
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="(11) 99999-9999"
                  value={phone}
                  onChange={(event) => {
                    setPhone(formatBrazilianPhone(event.target.value));
                    if (errorMessage) setErrorMessage("");
                  }}
                  className="h-12 w-full rounded-xl border border-white/10 bg-white/5 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50"
                />
              </div>
            </label>
          ) : (
            <>
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-gray-300">Código de 6 dígitos</span>
                <input
                  type="text"
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
                  className="h-12 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-center font-mono text-xl tracking-[0.4em] text-white outline-none transition placeholder:text-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-gray-300">Como podemos te chamar?</span>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    maxLength={100}
                    autoComplete="name"
                    placeholder="Seu nome ou apelido"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      if (errorMessage) setErrorMessage("");
                    }}
                    className="h-12 w-full rounded-xl border border-white/10 bg-white/5 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50"
                  />
                </div>
              </label>
            </>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 hover:shadow-emerald-500/30 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
          >
            <span>{isSubmitting ? "Aguarde..." : step === "identify" ? "Acessar Benefícios" : "Confirmar e Entrar"}</span>
            {!isSubmitting && <ArrowRight className="h-4 w-4" />}
          </button>

          {step === "verify" ? (
            <div className="flex items-center justify-between pt-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  setStep("identify");
                  setErrorMessage("");
                }}
                className="inline-flex items-center gap-1 font-semibold text-gray-400 hover:text-white transition cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Trocar número
              </button>
              <button
                type="button"
                disabled={isResending}
                onClick={() => void requestCode(true)}
                className="inline-flex items-center gap-1 font-semibold text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isResending ? "animate-spin" : ""}`} />
                Reenviar código
              </button>
            </div>
          ) : (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={onClose}
                className="text-xs font-semibold text-gray-400 hover:text-gray-200 transition underline underline-offset-4 cursor-pointer"
              >
                Continuar sem me identificar por enquanto
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
