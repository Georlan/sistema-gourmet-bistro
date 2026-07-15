/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { X, Lock, Mail, User, Phone, MapPin, Eye, EyeOff } from "lucide-react";

interface CardapioAuthModalProps {
  onClose: () => void;
  onLoginSuccess: (userProfile: any) => void;
}

export default function CardapioAuthModal({ onClose, onLoginSuccess }: CardapioAuthModalProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("cliente@demo.com"); // Pre-filled for effortless demo
  const [password, setPassword] = useState("123456");      // Pre-filled for effortless demo
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleDemoUser = () => {
    // Fill credentials for demo
    setEmail("cliente@demo.com");
    setPassword("123456");
    setIsLogin(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    // Simulate database with localStorage
    const usersKey = "whitelabel_menu_users";
    const existingUsers = JSON.parse(localStorage.getItem(usersKey) || "[]");

    // Add default demo user if not present
    const demoUserExists = existingUsers.some((u: any) => u.email === "cliente@demo.com");
    if (!demoUserExists) {
      existingUsers.push({
        name: "João Silva Demo",
        email: "cliente@demo.com",
        password: "123456",
        phone: "(11) 99999-8888",
        address: "Rua das Flores, 123 - Jardins, São Paulo - SP"
      });
      localStorage.setItem(usersKey, JSON.stringify(existingUsers));
    }

    if (isLogin) {
      // Find user
      const user = existingUsers.find((u: any) => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
      if (user) {
        onLoginSuccess(user);
        onClose();
      } else {
        setErrorMessage("E-mail ou senha incorretos. Dica: use o botão 'Preencher Demo' abaixo!");
      }
    } else {
      // Register
      if (!name || !email || !password || !phone || !address) {
        setErrorMessage("Por favor, preencha todos os campos obrigatórios.");
        return;
      }

      const emailExists = existingUsers.some((u: any) => u.email.toLowerCase() === email.toLowerCase());
      if (emailExists) {
        setErrorMessage("Este e-mail já está cadastrado.");
        return;
      }

      const newUser = { name, email, password, phone, address };
      existingUsers.push(newUser);
      localStorage.setItem(usersKey, JSON.stringify(existingUsers));

      alert("Cadastro realizado com sucesso! Bem-vindo!");
      onLoginSuccess(newUser);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in" id="auth-modal-overlay">
      {/* Modal Container */}
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl animate-scale-up" id="auth-modal-card">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 transition"
          id="btn-close-auth"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Title */}
        <div className="text-center">
          <h2 className="font-display text-xl font-bold text-text-app" id="auth-title">
            {isLogin ? "Seja bem-vindo de volta" : "Criar nova conta"}
          </h2>
          <p className="mt-1 text-xs text-gray-400">
            {isLogin ? "Acesse para acompanhar seus pedidos e comprar mais rápido" : "Cadastre-se para aproveitar promoções e salvar endereços"}
          </p>
        </div>

        {/* Demo filler helper badge */}
        {isLogin && (
          <button
            type="button"
            onClick={handleDemoUser}
            className="mt-4 w-full rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200/50 py-2 text-xs font-semibold text-amber-700 transition flex items-center justify-center gap-1.5"
            id="btn-fill-demo-credentials"
          >
            <span>✨ Preencher com Usuário de Demonstração</span>
          </button>
        )}

        {/* Error message */}
        {errorMessage && (
          <div className="mt-4 rounded-xl bg-red-50 p-3 border border-red-100 text-xs text-red-600 font-semibold text-center">
            {errorMessage}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-3" id="auth-form">
          {/* Name (Register only) */}
          {!isLogin && (
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Nome Completo</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 pointer-events-none">
                  <User className="h-4 w-4" />
                </div>
                <input
                  type="text"
                  required
                  placeholder="Seu nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/30 py-2.5 pl-9 pr-4 text-xs text-gray-800 focus:bg-white focus:border-primary outline-hidden transition"
                />
              </div>
            </div>
          )}

          {/* Email */}
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">E-mail</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 pointer-events-none">
                <Mail className="h-4 w-4" />
              </div>
              <input
                type="email"
                required
                placeholder="nome@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50/30 py-2.5 pl-9 pr-4 text-xs text-gray-800 focus:bg-white focus:border-primary outline-hidden transition"
              />
            </div>
          </div>

          {/* Phone (Register only) */}
          {!isLogin && (
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">WhatsApp (Celular)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 pointer-events-none">
                  <Phone className="h-4 w-4" />
                </div>
                <input
                  type="tel"
                  required
                  placeholder="Ex: (11) 99999-9999"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/30 py-2.5 pl-9 pr-4 text-xs text-gray-800 focus:bg-white focus:border-primary outline-hidden transition"
                />
              </div>
            </div>
          )}

          {/* Delivery Address (Register only) */}
          {!isLogin && (
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Endereço de Entrega Principal</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 pointer-events-none">
                  <MapPin className="h-4 w-4" />
                </div>
                <input
                  type="text"
                  required
                  placeholder="Rua, número, bairo, cidade"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/30 py-2.5 pl-9 pr-4 text-xs text-gray-800 focus:bg-white focus:border-primary outline-hidden transition"
                />
              </div>
            </div>
          )}

          {/* Password */}
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Senha</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 pointer-events-none">
                <Lock className="h-4 w-4" />
              </div>
              <input
                type={showPassword ? "text" : "password"}
                required
                placeholder="Sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50/30 py-2.5 pl-9 pr-10 text-xs text-gray-800 focus:bg-white focus:border-primary outline-hidden transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            className="w-full rounded-xl bg-primary py-3 text-center text-xs font-bold text-white shadow-lg shadow-primary/15 hover:scale-[1.01] active:scale-[0.99] transition duration-150 mt-5"
            id="btn-auth-submit"
          >
            {isLogin ? "Acessar Conta" : "Finalizar Cadastro"}
          </button>
        </form>

        {/* Register toggle link */}
        <div className="mt-4 text-center">
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setErrorMessage("");
            }}
            className="text-xs font-semibold text-primary hover:underline"
            id="btn-auth-toggle"
          >
            {isLogin ? "Não tem uma conta? Cadastre-se aqui!" : "Já possui conta? Acesse por aqui!"}
          </button>
        </div>
      </div>
    </div>
  );
}
