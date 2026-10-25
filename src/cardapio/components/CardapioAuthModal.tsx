import { PasswordRecoveryHelp } from "../../components/auth/PasswordRecoveryHelp";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { containModalFocus } from "../../utils/modalFocus";
import { PasswordInput } from "../../components/auth/PasswordInput";
import "../../components/auth/authPresentation.css";
import { X } from "lucide-react";
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
  hasBenefits?: boolean;
  restaurantName?: string;
  onClose: () => void;
  onLoginSuccess: (profile: CustomerProfile, token: string) => void;
}

export const PASSWORD_RECOVERY = "ATIVO";

export default function CardapioAuthModal({
  restaurantId,
  accountRequired = false,
  hasBenefits = false,
  restaurantName,
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

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const pending = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const releaseFocus = containModalFocus(dialog, () => closeRef.current(), dialog.querySelector<HTMLButtonElement>('#auth-close') || dialog);
    return () => { requestRef.current?.abort(); releaseFocus(); };
  }, []);

  const numericRestaurantId = Number(restaurantId);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending.current) return;
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

    pending.current = true;
    requestRef.current = new AbortController();
    const signal = requestRef.current.signal;
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await authFetch(`${API_BASE_URL}/cardapio/clientes/login`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurante_id: numericRestaurantId,
          email: cleanEmail,
          senha: password,
        }),
      });

      const data = await response.json().catch(() => null);
      if (signal.aborted) return;
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
      if (signal.aborted) return;
      setErrorMessage(authRequestErrorMessage(error, "Falha ao realizar login."));
    } finally {
      pending.current = false;
      if (!signal.aborted) setIsSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending.current) return;
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

    pending.current = true;
    requestRef.current = new AbortController();
    const signal = requestRef.current.signal;
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const response = await authFetch(`${API_BASE_URL}/cardapio/clientes/cadastro/solicitar`, {
        method: "POST",
        signal,
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
      if (signal.aborted) return;
      if (!response.ok) {
        throw new Error(data?.detail || "Não foi possível enviar o e-mail de confirmação.");
      }
      setRegisterStep("email_sent");
    } catch (error) {
      if (signal.aborted) return;
      setErrorMessage(authRequestErrorMessage(error, "Não foi possível criar sua conta agora."));
    } finally {
      pending.current = false;
      if (!signal.aborted) setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="k-customer-auth" id="auth-modal-overlay"
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} className="k-customer-auth__sheet" id="auth-modal-card"
        role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        <header className="k-customer-auth__header">
          <button id="auth-close" type="button" onClick={onClose} className="k-customer-auth__close" aria-label="Fechar">
            <X size={20} aria-hidden="true" />
          </button>
          <svg className="k-customer-auth__art" viewBox="0 0 100 100" fill="none" aria-hidden="true" focusable="false">
            <path d="M4 100V56A36 36 0 0 1 40 20h60v80Z" fill="currentColor" />
            <circle cx="54" cy="47" r="11" className="k-customer-auth__portrait" />
            <path d="M32 83v-4a22 22 0 0 1 44 0v4Z" className="k-customer-auth__portrait" />
            <path d="m4 18 9-9 9 9-9 9Z" fill="currentColor" />
          </svg>
          {restaurantName && <p className="k-customer-auth__restaurant">{restaurantName}</p>}
          <h2 className="k-customer-auth__title" id="auth-modal-title">{tab === 'login' ? 'Entrar na sua conta' : 'Criar sua conta'}</h2>
        </header>
        {accountRequired ? <p className="k-auth-intro">Para pedir, entre e confirme o e-mail da sua conta.</p>
          : hasBenefits ? <p className="k-auth-intro">Entre para acompanhar seus pedidos e benefícios.</p> : null}
        <div className="k-customer-auth__modes" role="group" aria-label="Acesso do cliente">
          <button type="button" disabled={isSubmitting} aria-pressed={tab === 'login'}
            onClick={() => { setTab('login'); setErrorMessage(''); }}>Entrar</button>
          <button type="button" disabled={isSubmitting} aria-pressed={tab === 'register'}
            onClick={() => { setTab('register'); setErrorMessage(''); }}>Criar Conta</button>
        </div>
        {errorMessage && <p className="k-auth-feedback" role="alert">{errorMessage}</p>}
        {tab === 'login' ? <form onSubmit={handleLogin} className="k-auth-form" id="auth-login-form" aria-busy={isSubmitting}>
          <div className="k-auth-field">
            <label htmlFor="customer-login-email" className="k-auth-label">Seu e-mail</label>
            <input id="customer-login-email" name="email" type="email" inputMode="email" autoComplete="username"
              autoCapitalize="none" spellCheck={false} disabled={isSubmitting} placeholder="seu@email.com" required
              value={email} onChange={event => { setEmail(event.target.value); setErrorMessage(''); }} className="k-auth-input" />
          </div>
          <div className="k-auth-field">
            <label htmlFor="customer-login-password" className="k-auth-label">Sua senha</label>
            <PasswordInput key="login-password" id="customer-login-password" name="password" autoComplete="current-password"
              disabled={isSubmitting} required value={password} onChange={event => { setPassword(event.target.value); setErrorMessage(''); }} />
          </div>
          <PasswordRecoveryHelp customer restaurantId={restaurantId} initialEmail={email} disabled={isSubmitting} allowGuest={!accountRequired} />
          <button type="submit" disabled={isSubmitting} className="k-auth-action">{isSubmitting ? 'Entrando...' : 'Entrar'}</button>
        </form> : <form onSubmit={handleRegister} className="k-auth-form" id="auth-register-form" aria-busy={isSubmitting}>
          {registerStep === 'details' ? <>
            <div className="k-auth-field">
              <label htmlFor="customer-register-name" className="k-auth-label">Nome completo</label>
              <input id="customer-register-name" name="name" type="text" autoComplete="name" disabled={isSubmitting}
                required value={name} onChange={event => { setName(event.target.value); setErrorMessage(''); }} className="k-auth-input" />
            </div>
            <div className="k-auth-field">
              <label htmlFor="customer-register-email" className="k-auth-label">E-mail</label>
              <input id="customer-register-email" name="email" type="email" inputMode="email" autoComplete="email"
                autoCapitalize="none" spellCheck={false} disabled={isSubmitting} required value={email}
                onChange={event => { setEmail(event.target.value); setErrorMessage(''); }} className="k-auth-input" />
            </div>
            <div className="k-auth-field">
              <label htmlFor="customer-register-phone" className="k-auth-label">Celular / WhatsApp (com DDD)</label>
              <input id="customer-register-phone" name="tel" type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 99999-9999"
                disabled={isSubmitting} required value={phone} onChange={event => { setPhone(formatBrazilianPhone(event.target.value)); setErrorMessage(''); }} className="k-auth-input" />
            </div>
            <div className="k-auth-field">
              <label htmlFor="customer-register-password" className="k-auth-label">Criar senha</label>
              <PasswordInput key="register-password" id="customer-register-password" name="new-password" autoComplete="new-password"
                placeholder="Mínimo 8 caracteres" minLength={8} disabled={isSubmitting} required value={password}
                onChange={event => { setPassword(event.target.value); setErrorMessage(''); }} />
            </div>
            <button type="submit" disabled={isSubmitting} className="k-auth-action">{isSubmitting ? 'Enviando...' : 'Criar conta'}</button>
          </> : <div className="k-customer-auth__success" role="status">
            <strong>Confira seu e-mail</strong>
            <p>Enviamos um link de confirmação para <b>{email.trim().toLowerCase()}</b>.</p>
            <button type="submit" disabled={isSubmitting} className="k-auth-action">{isSubmitting ? 'Reenviando...' : 'Reenviar e-mail'}</button>
            <button type="button" className="k-customer-auth__guest" onClick={() => { setRegisterStep('details'); setErrorMessage(''); }}>Alterar dados</button>
          </div>}
        </form>}
        <button type="button" onClick={onClose} className="k-customer-auth__guest">
          {accountRequired ? 'Voltar ao cardápio' : 'Continuar como visitante'}
        </button>
      </div>
    </div>, document.body,
  );
}
