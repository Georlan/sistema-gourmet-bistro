/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { ArrowRight, Phone, ShoppingBag, User, X } from "lucide-react";

interface CustomerProfile {
  name: string;
  phone: string;
  address: string;
}

interface CardapioAuthModalProps {
  onClose: () => void;
  onLoginSuccess: (userProfile: CustomerProfile) => void;
}

const formatPhoneBrazilian = (value: string) => {
  const numbers = value.replace(/\D/g, "").slice(0, 11);
  if (numbers.length <= 2) return numbers ? `(${numbers}` : "";
  if (numbers.length <= 6) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  if (numbers.length <= 10) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  }
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
};

export default function CardapioAuthModal({
  onClose,
  onLoginSuccess
}: CardapioAuthModalProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage("");

    const cleanName = name.trim();
    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanName.length < 2) {
      setErrorMessage("Informe um nome válido.");
      return;
    }
    if (cleanPhone.length < 10 || cleanPhone.length > 11) {
      setErrorMessage("Informe um celular válido com DDD.");
      return;
    }

    const profile: CustomerProfile = {
      name: cleanName,
      phone: cleanPhone,
      address: ""
    };
    localStorage.setItem("koma_cliente_perfil", JSON.stringify(profile));
    localStorage.setItem("whitelabel_menu_current_user", JSON.stringify(profile));
    onLoginSuccess(profile);
    onClose();
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
          id="btn-close-auth"
          aria-label="Fechar identificação"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="text-center mt-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 mb-3">
            <ShoppingBag className="h-6 w-6" />
          </div>
          <h2 className="font-display text-xl font-bold text-white" id="auth-title">
            Dados para o pedido
          </h2>
          <p className="mt-1.5 text-xs text-gray-400 max-w-xs mx-auto leading-relaxed">
            Informe como o restaurante pode identificar e contatar você sobre este pedido.
          </p>
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-xl bg-rose-500/10 p-3 border border-rose-500/20 text-xs text-rose-400 font-medium text-center">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4" id="auth-form-input">
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
                className="w-full rounded-xl border border-gray-800 bg-[#161824] py-3 pl-10 pr-4 text-xs text-white placeholder-gray-600 focus:bg-[#161824] focus:border-emerald-500 outline-hidden transition"
              />
            </span>
          </label>

          <label className="block">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
              Celular com DDD
            </span>
            <span className="relative block">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-gray-500 pointer-events-none" />
              <input
                type="tel"
                required
                inputMode="numeric"
                autoComplete="tel"
                placeholder="(00) 00000-0000"
                value={phone}
                onChange={(event) => setPhone(formatPhoneBrazilian(event.target.value))}
                className="w-full rounded-xl border border-gray-800 bg-[#161824] py-3 pl-10 pr-4 text-xs text-white placeholder-gray-600 focus:bg-[#161824] focus:border-emerald-500 outline-hidden transition"
              />
            </span>
          </label>

          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 py-3.5 text-center text-xs font-bold text-white shadow-lg shadow-emerald-500/10 hover:scale-[1.01] active:scale-[0.99] transition duration-150 mt-2 flex items-center justify-center gap-1.5"
            id="btn-auth-identify"
          >
            Continuar para o pedido
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <p className="mt-4 text-[10px] text-gray-500 text-center leading-relaxed">
          Os dados ficam neste dispositivo e serão enviados ao restaurante somente com o pedido.
        </p>
      </div>
    </div>
  );
}
