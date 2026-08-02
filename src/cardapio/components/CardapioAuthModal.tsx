/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { ArrowLeft, ArrowRight, KeyRound, Phone, ShieldCheck, User, X } from "lucide-react";
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

function responseError(data: any, fallback: string): string {
  if (typeof data?.detail === "string") return data.detail;
  if (Array.isArray(data?.detail) && typeof data.detail[0]?.msg === "string") {
    return data.detail[0].msg;
  }
  return fallback;
}

export default function CardapioAuthModal({
  restaurantId,
  onClose,
  onLoginSuccess,
}: CardapioAuthModalProps) {
  const [step, setStep] = useState<"identify" | "verify">("identify");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  const requestCode = async () => {
    const normalizedPhone = normalizeBrazilianPhone(phone);
    const cleanName = name.trim();
    if (normalizedPhone.length < 10 || normalizedPhone.length > 11) {
      setErrorMessage("Informe um celular válido com DDD.");
      return;
    }
    if (cleanName.length < 2) {
      setErrorMessage("Informe um nome válido.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setNotice("");
    try {
      const response = await fetch(`${API_BASE_URL}/cardapio/clientes/otp/solicitar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurante_id: Number(restaurantId),
          telefone: normalizedPhone,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(responseError(data, "Não foi possível enviar o código."));
      }
      setStep("verify");
      setNotice(data?.detail || "Código enviado ao seu WhatsApp.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o código. Tente novamente.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyCode = async () => {
    const normalizedPhone = normalizeBrazilianPhone(phone);
    const cleanName = name.trim();
    const normalizedCode = code.replace(/\D/g, "");
    if (normalizedCode.length !== 6) {
      setErrorMessage("Digite os 6 números enviados ao WhatsApp.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/cardapio/clientes/otp/verificar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurante_id: Number(restaurantId),
          telefone: normalizedPhone,
          nome: cleanName,
          codigo: normalizedCode,
          endereco: "",
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(responseError(data, "Código inválido ou expirado."));
      }
      if (!data?.access_token || !data?.cliente?.id) {
        throw new Error("O servidor retornou uma sessão inválida.");
      }
      onLoginSuccess(mapCustomerProfile(data.cliente), data.access_token);
      onClose();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível confirmar o código.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (step === "identify") void requestCode();
    else void verifyCode();
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
        className="relative w-full max-w-sm rounded-3xl bg-[#0e1017] border border-gray-800/80 p-6 shadow-2xl animate-scale-up"
        id="auth-modal-card"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full hover:bg-gray-800 text-gray-400 transition cursor-pointer"
          aria-label="Fechar identificação"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="text-center mt-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 mb-3">
            {step === "identify" ? <Phone className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
          </div>
          <h2 className="font-display text-xl font-bold text-white">
            {step === "identify" ? "Identifique-se pelo celular" : "Confirme seu número"}
          </h2>
          <p className="mt-1.5 text-xs text-gray-400 max-w-xs mx-auto leading-relaxed">
            {step === "identify"
              ? "Seu número conecta pedidos, pontos e perfil neste restaurante."
              : `Enviamos um código para ${formatBrazilianPhone(phone)}.`}
          </p>
        </div>

        {notice && (
          <div className="mt-4 rounded-xl bg-emerald-500/10 p-3 border border-emerald-500/20 text-xs text-emerald-400 font-medium text-center">
            {notice}
          </div>
        )}
        {errorMessage && (
          <div className="mt-4 rounded-xl bg-rose-500/10 p-3 border border-rose-500/20 text-xs text-rose-400 font-medium text-center">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4" id="auth-form-input">
          {step === "identify" ? (
            <>
              <label className="block">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                  Celular com DDD
                </span>
                <span className="relative block">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-gray-500 pointer-events-none" />
                  <input
                    type="tel"
                    required
                    autoFocus
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="(00) 00000-0000"
                    value={phone}
                    onChange={(event) => setPhone(formatBrazilianPhone(event.target.value))}
                    className="w-full rounded-xl border border-gray-800 bg-[#161824] py-3 pl-10 pr-4 text-xs text-white placeholder-gray-600 focus:border-emerald-500 outline-hidden transition"
                  />
                </span>
              </label>

              <label className="block">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                  Como devemos chamar você?
                </span>
                <span className="relative block">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-gray-500 pointer-events-none" />
                  <input
                    type="text"
                    required
                    maxLength={100}
                    autoComplete="name"
                    placeholder="Nome completo"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-xl border border-gray-800 bg-[#161824] py-3 pl-10 pr-4 text-xs text-white placeholder-gray-600 focus:border-emerald-500 outline-hidden transition"
                  />
                </span>
              </label>
            </>
          ) : (
            <label className="block">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                Código de 6 dígitos
              </span>
              <span className="relative block">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-gray-500 pointer-events-none" />
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
                  className="w-full rounded-xl border border-gray-800 bg-[#161824] py-3 pl-10 pr-4 text-center font-mono text-lg tracking-[0.35em] text-white placeholder-gray-600 focus:border-emerald-500 outline-hidden transition"
                />
              </span>
            </label>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 py-3.5 text-center text-xs font-bold text-white transition flex items-center justify-center gap-1.5"
          >
            {isSubmitting ? "Aguarde..." : step === "identify" ? "Enviar código" : "Confirmar e entrar"}
            {!isSubmitting && <ArrowRight className="h-4 w-4" />}
          </button>

          {step === "verify" && (
            <div className="flex items-center justify-between text-[10px] font-bold">
              <button
                type="button"
                onClick={() => {
                  setStep("identify");
                  setCode("");
                  setNotice("");
                  setErrorMessage("");
                }}
                className="flex items-center gap-1 text-gray-400 hover:text-white"
              >
                <ArrowLeft className="h-3 w-3" /> Alterar número
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void requestCode()}
                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
              >
                Reenviar código
              </button>
            </div>
          )}
        </form>

        <p className="mt-4 text-[10px] text-gray-500 text-center leading-relaxed">
          A confirmação impede que outra pessoa acesse seus dados e seus pontos apenas conhecendo seu número.
        </p>
      </div>
    </div>
  );
}
