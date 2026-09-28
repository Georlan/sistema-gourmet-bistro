import { PasswordRecoveryHelp } from "../../components/auth/PasswordRecoveryHelp";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { ArrowRight, Coins, Lock, Mail, Phone, Sparkles, User, X } from "lucide-react";
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
  accountRequired?: boolean;
  onClose: () => void;
  onLoginSuccess: (profile: CustomerProfile, token: string) => void;
}

export const PASSWORD_RECOVERY = "ATIVO";

export default function CardapioAuthModal({
  restaurantId,
  accountRequired = false,
  onClose,
  onLoginSuccess,
}: CardapioAuthModalProps) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [registerStep, setRegisterStep] = useState<"details" | "email_sent">("details");

  const numericRestaurantId = Number(restaurantId);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!Number.isInteger(numericRestaurantId) || numericRestaurantId <= 0) {
      setErrorMessage("Não foi possível identificar o restaurante.");
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setErrorMessage("Informe um e-mail válido.");
      return;
    }
    if (!password) {
      setErrorMessage("Informe sua senha.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await authFetch(`${API_BASE_URL}/cardapio/clientes/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurante_id: numericRestaurantId,
          email: cleanEmail,
          senha: password,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.access_token || !data?.cliente) {
        throw new Error(data?.detail || "E-mail ou senha incorretos.");
      }

      const profile = mapCustomerProfile(data.cliente);
      if (accountRequired && profile.emailVerified !== true) {
        throw new Error("Confirme seu e-mail antes de fazer pedidos por este cardápio.");
      }
      onLoginSuccess(profile, String(data.access_token));
      onClose();
    } catch (error) {
      setErrorMessage(authRequestErrorMessage(error, "Falha ao realizar login."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!Number.isInteger(numericRestaurantId) || numericRestaurantId <= 0) {
      setErrorMessage("Não foi possível identificar o restaurante.");
      return;
    }
    const cleanName = name.trim();
    if (cleanName.length < 2) {
      setErrorMessage("Informe seu nome completo.");
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setErrorMessage("Informe um e-mail válido.");
      return;
    }
    const cleanPhone = normalizeBrazilianPhone(phone);
    if (cleanPhone.length < 10 || cleanPhone.length > 11) {
      setErrorMessage("Informe um celular com DDD (10 ou 11 dígitos).");
      return;
    }
    if (password.length < 8) {
      setErrorMessage("A senha deve conter no mínimo 8 caracteres.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const response = await authFetch(`${API_BASE_URL}/cardapio/clientes/cadastro/solicitar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurante_id: numericRestaurantId,
          nome: cleanName,
          email: cleanEmail,
          telefone: cleanPhone,
          senha: password,
          endereco: "",
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.detail || "Não foi possível enviar o e-mail de confirmação.");
      }
      setRegisterStep("email_sent");
    } catch (error) {
      setErrorMessage(authRequestErrorMessage(error, "Não foi possível criar sua conta agora."));
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
        className="relative max-h-[calc(100dvh-0.5rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-[28px] border border-white/10 bg-[#0e1217] px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pt-6 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-[28px] animate-scale-up"
        id="auth-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Fechar */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-gray-400 transition hover:bg-white/10 hover:text-white cursor-pointer"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header com Ícone e Benefícios */}
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shadow-inner">
            {tab === "login" ? <Coins className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
              Clube de Vantagens
            </span>
            <h2 className="font-display text-lg font-black tracking-tight text-white" id="auth-modal-title">
              {tab === "login" ? "Entrar na Minha Conta" : "Criar Minha Conta"}
            </h2>
          </div>
        </div>

        <p className="mt-2.5 text-xs leading-relaxed text-gray-300">
          {accountRequired
            ? "Para enviar pedidos, entre na sua conta ou crie uma nova e confirme o cadastro pelo e-mail."
            : "Acompanhe seus pedidos e consulte os benefícios disponíveis neste restaurante. Você também pode comprar como visitante."}
        </p>

        {/* Seletor de Abas (Entrar / Criar Conta) */}
        <div className="mt-4 flex rounded-xl bg-white/5 p-1 border border-white/10">
          <button
            type="button"
            onClick={() => {
              setTab("login");
              setErrorMessage("");
            }}
            className={`min-h-11 flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              tab === "login"
                ? "bg-emerald-500 text-white shadow-md"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("register");
              setErrorMessage("");
            }}
            className={`min-h-11 flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              tab === "register"
                ? "bg-emerald-500 text-white shadow-md"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Criar Conta
          </button>
        </div>

        {errorMessage && (
          <div
            className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-semibold text-rose-400 animate-fade-in"
            role="alert"
          >
            <p>{errorMessage}</p>
          </div>
        )}

        {/* Formulário de Login */}
        {tab === "login" ? (
          <form onSubmit={handleLogin} className="mt-4 space-y-3.5" id="auth-login-form">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-gray-300">Seu e-mail</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="exemplo@email.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errorMessage) setErrorMessage("");
                  }}
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-11 pr-4 text-base sm:text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50"
                  required
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-gray-300">Sua senha</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errorMessage) setErrorMessage("");
                  }}
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-11 pr-4 text-base sm:text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50"
                  required
                />
              </div>
            </label>

            <PasswordRecoveryHelp customer restaurantId={restaurantId} />

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 hover:shadow-emerald-500/30 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
            >
              <span>{isSubmitting ? "Entrando..." : "Entrar"}</span>
              {!isSubmitting && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        ) : (
          /* Formulário de Cadastro */
          <form onSubmit={handleRegister} className="mt-4 space-y-3" id="auth-register-form">
            {registerStep === "details" ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-300">Nome completo</span>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input type="text" autoComplete="name" placeholder="Como podemos te chamar?" value={name}
                      onChange={(e) => { setName(e.target.value); if (errorMessage) setErrorMessage(""); }}
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-11 pr-4 text-base sm:text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50" required />
                  </div>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-300">E-mail</span>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input type="email" autoComplete="email" placeholder="seu@email.com" value={email}
                      onChange={(e) => { setEmail(e.target.value); if (errorMessage) setErrorMessage(""); }}
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-11 pr-4 text-base sm:text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50" required />
                  </div>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-300">Celular / WhatsApp (com DDD)</span>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input type="tel" inputMode="numeric" autoComplete="tel" placeholder="(11) 99999-9999" value={phone}
                      onChange={(e) => { setPhone(formatBrazilianPhone(e.target.value)); if (errorMessage) setErrorMessage(""); }}
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-11 pr-4 text-base sm:text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50" required />
                  </div>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-300">Criar senha</span>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input type="password" autoComplete="new-password" placeholder="Mínimo 8 caracteres" value={password}
                      onChange={(e) => { setPassword(e.target.value); if (errorMessage) setErrorMessage(""); }}
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-11 pr-4 text-base sm:text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50" required />
                  </div>
                </label>
                <button type="submit" disabled={isSubmitting}
                  className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60 cursor-pointer">
                  <span>{isSubmitting ? "Enviando..." : "Criar conta"}</span>
                  {!isSubmitting && <ArrowRight className="h-4 w-4" />}
                </button>
              </>
            ) : (
              <div className="space-y-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div>
                  <p className="text-sm font-bold text-emerald-300">Confira seu e-mail</p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-300">
                    Enviamos um link de confirmação para <strong>{email.trim().toLowerCase()}</strong>.
                    Abra o link para concluir sua conta no KÔMA.
                  </p>
                </div>
                <button type="submit" disabled={isSubmitting}
                  className="flex min-h-11 w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-xs font-bold text-gray-200 hover:bg-white/10 disabled:opacity-60">
                  {isSubmitting ? "Reenviando..." : "Reenviar e-mail"}
                </button>
                <button type="button" onClick={() => { setRegisterStep("details"); setErrorMessage(""); }}
                  className="min-h-11 w-full text-xs font-semibold text-gray-400 underline underline-offset-4 hover:text-white">
                  Alterar dados
                </button>
              </div>
            )}
          </form>
        )}

        {/* Continuar como visitante */}
        <div className="text-center pt-3 mt-1 border-t border-white/5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 w-full text-xs font-semibold text-gray-400 hover:text-gray-200 transition underline underline-offset-4 cursor-pointer"
          >
            Continuar como visitante
          </button>
        </div>
      </div>
    </div>
  );
}
