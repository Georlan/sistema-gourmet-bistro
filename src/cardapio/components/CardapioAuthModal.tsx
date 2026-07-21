/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { X, User, Phone, ShieldCheck, Sparkles, MessageSquare, ArrowRight } from "lucide-react";
import { API_BASE_URL } from "../../config/api";

interface CardapioAuthModalProps {
  onClose: () => void;
  onLoginSuccess: (userProfile: any) => void;
  restauranteId?: number;
}

export default function CardapioAuthModal({ onClose, onLoginSuccess, restauranteId = 1 }: CardapioAuthModalProps) {
  const [step, setStep] = useState<"input" | "otp">("input");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [maskedData, setMaskedData] = useState<{
    nome_mascarado: string;
    endereco_mascarado: string;
    telefone_mascarado: string;
  } | null>(null);



  const formatPhoneBrazilian = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    const truncated = numbers.slice(0, 11);
    if (truncated.length <= 2) {
      return truncated.length > 0 ? `(${truncated}` : "";
    }
    if (truncated.length <= 6) {
      return `(${truncated.slice(0, 2)}) ${truncated.slice(2)}`;
    }
    if (truncated.length <= 10) {
      return `(${truncated.slice(0, 2)}) ${truncated.slice(2, 6)}-${truncated.slice(6)}`;
    }
    return `(${truncated.slice(0, 2)}) ${truncated.slice(2, 7)}-${truncated.slice(7)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhoneBrazilian(e.target.value));
  };

  const handleIdentify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    
    const cleanPhone = phone.replace(/\D/g, "");
    if (!name.trim() || cleanPhone.length < 10) {
      setErrorMessage("Por favor, informe seu Nome e um número de WhatsApp válido.");
      return;
    }

    setIsLoading(true);
    try {
      // 1. Check if client exists
      const checkRes = await fetch(`${API_BASE_URL}/cardapio/identificar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurante_id: restauranteId, telefone: cleanPhone })
      });

      if (!checkRes.ok) {
        throw new Error("Erro de comunicação com o servidor.");
      }

      const checkData = await checkRes.json();
      if (checkData.exists) {
        // Existing customer: Go to OTP step to authenticate and retrieve profile safely
        setMaskedData({
          nome_mascarado: checkData.nome_mascarado,
          endereco_mascarado: checkData.endereco_mascarado,
          telefone_mascarado: checkData.telefone_mascarado
        });

        // Trigger OTP generation and mock WhatsApp dispatch
        const otpRes = await fetch(`${API_BASE_URL}/cardapio/enviar-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restaurante_id: restauranteId, telefone: cleanPhone })
        });

        if (otpRes.ok) {
          setStep("otp");
        } else {
          setErrorMessage("Falha ao enviar código OTP. Tente novamente.");
        }
      } else {
        // New customer: Effortless transition, save locally as temp and complete registration at order checkout
        const newProfile = {
          name,
          phone: cleanPhone,
          address: "",
          is_new: true
        };
        localStorage.setItem("koma_cliente_perfil", JSON.stringify(newProfile));
        localStorage.setItem("whitelabel_menu_current_user", JSON.stringify(newProfile));
        onLoginSuccess(newProfile);
        onClose();
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Erro de conexão ao identificar cliente.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    if (otp.length < 4) {
      setErrorMessage("Insira o código de 4 dígitos.");
      return;
    }

    setIsLoading(true);
    try {
      const cleanPhone = phone.replace(/\D/g, "");
      const res = await fetch(`${API_BASE_URL}/cardapio/verificar-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurante_id: restauranteId,
          telefone: cleanPhone,
          otp: otp
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Código de verificação incorreto.");
      }

      const data = await res.json();
      if (data.success) {
        const userProfile = {
          name: data.nome,
          phone: data.telefone,
          address: data.endereco || "",
          saldo_pontos: data.saldo_pontos || 0,
          saldo_cashback: data.saldo_cashback || 0.0,
          is_new: false
        };

        localStorage.setItem("koma_cliente_perfil", JSON.stringify(userProfile));
        localStorage.setItem("whitelabel_menu_current_user", JSON.stringify(userProfile));
        onLoginSuccess(userProfile);
        onClose();
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Código inválido ou expirado.");
    } finally {
      setIsLoading(false);
    }
  };

  // Allows prying customers to bypass OTP validation but with zero access to sensitive profile data (LGPD safe)
  const handleBypassOtp = () => {
    const cleanPhone = phone.replace(/\D/g, "");
    const guestProfile = {
      name: maskedData?.nome_mascarado || name,
      phone: cleanPhone,
      address: "",
      saldo_pontos: 0,
      saldo_cashback: 0.0,
      pular_otp: true
    };
    localStorage.setItem("koma_cliente_perfil", JSON.stringify(guestProfile));
    localStorage.setItem("whitelabel_menu_current_user", JSON.stringify(guestProfile));
    onLoginSuccess(guestProfile);
    onClose();
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 animate-fade-in cursor-pointer"
      id="auth-modal-overlay"
    >
      <div className="relative w-full max-w-sm rounded-3xl bg-[#0e1017] border border-gray-800/80 p-6 shadow-2xl animate-scale-up" id="auth-modal-card">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-800 text-gray-400 transition"
          id="btn-close-auth"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Title */}
        <div className="text-center mt-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 mb-3">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h2 className="font-display text-xl font-bold text-white" id="auth-title">
            {step === "input" ? "Identificação Rápida" : "Acesso Seguro"}
          </h2>
          <p className="mt-1.5 text-xs text-gray-400 max-w-xs mx-auto leading-relaxed">
            {step === "input" 
              ? "Acesse sua conta sem senhas tradicionais. Use apenas seu WhatsApp!" 
              : `Enviamos um código de 4 dígitos via WhatsApp para o telefone ${maskedData?.telefone_mascarado}.`}
          </p>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="mt-4 rounded-xl bg-rose-500/10 p-3 border border-rose-500/20 text-xs text-rose-400 font-medium text-center">
            {errorMessage}
          </div>
        )}

        {step === "input" ? (
          <form onSubmit={handleIdentify} className="mt-5 space-y-4" id="auth-form-input">
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Como devemos te chamar?</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 pointer-events-none">
                  <User className="h-4.5 w-4.5" />
                </div>
                <input
                  type="text"
                  required
                  placeholder="Nome Completo"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-gray-800 bg-[#161824] py-3 pl-10 pr-4 text-xs text-white placeholder-gray-600 focus:bg-[#161824] focus:border-emerald-500 outline-hidden transition"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Seu WhatsApp</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 pointer-events-none">
                  <Phone className="h-4.5 w-4.5" />
                </div>
                <input
                  type="tel"
                  required
                  placeholder="(00) 00000-0000"
                  value={phone}
                  onChange={handlePhoneChange}
                  className="w-full rounded-xl border border-gray-800 bg-[#161824] py-3 pl-10 pr-4 text-xs text-white placeholder-gray-600 focus:bg-[#161824] focus:border-emerald-500 outline-hidden transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 py-3.5 text-center text-xs font-bold text-white shadow-lg shadow-emerald-500/10 hover:scale-[1.01] active:scale-[0.99] transition duration-150 mt-2 flex items-center justify-center gap-1.5 disabled:opacity-50"
              id="btn-auth-identify"
            >
              {isLoading ? "Processando..." : "Identificar-se"}
              {!isLoading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="mt-5 space-y-4" id="auth-form-otp">
            <div className="rounded-xl bg-[#161824] p-3.5 border border-gray-800/80 mb-1">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5 text-center">Cadastro Encontrado!</span>
              <div className="text-center space-y-1">
                <p className="text-xs font-semibold text-emerald-400">{maskedData?.nome_mascarado}</p>
                <p className="text-[11px] text-gray-500">{maskedData?.endereco_mascarado || "Endereço não cadastrado"}</p>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1 text-center">Insira o código de validação</label>
              <input
                type="text"
                required
                maxLength={4}
                placeholder="0000"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                className="w-full text-center tracking-[1em] text-lg font-bold rounded-xl border border-gray-800 bg-[#161824] py-3 text-white placeholder-gray-700 focus:border-emerald-500 outline-hidden transition"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 py-3.5 text-center text-xs font-bold text-white shadow-lg shadow-emerald-500/10 hover:scale-[1.01] active:scale-[0.99] transition duration-150 flex items-center justify-center gap-1.5 disabled:opacity-50"
              id="btn-auth-verify-otp"
            >
              {isLoading ? "Validando..." : "Confirmar e Resgatar Fidelidade"}
            </button>

            <div className="flex flex-col gap-2 pt-2 text-center">
              <button
                type="button"
                onClick={handleBypassOtp}
                className="text-xs font-medium text-gray-500 hover:text-gray-300 transition"
                id="btn-auth-bypass"
              >
                Fazer pedido sem resgatar fidelidade
              </button>
              <button
                type="button"
                onClick={() => setStep("input")}
                className="text-[11px] text-emerald-500 hover:underline"
              >
                Alterar Nome ou Telefone
              </button>
            </div>
          </form>
        )}

        {/* Console OTP Notice for testing convenience */}
        {step === "otp" && (
          <div className="mt-5 rounded-lg bg-amber-500/5 p-2.5 border border-amber-500/10 text-[10px] text-amber-500/80 leading-relaxed text-center">
            💡 <strong>Ambiente de Testes:</strong> Verifique o terminal/logs da API FastAPI para ver o código de verificação enviado!
          </div>
        )}
      </div>
    </div>
  );
}
