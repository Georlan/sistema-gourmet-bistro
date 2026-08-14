/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { Coins, LogOut, MapPin, Phone, ShieldCheck, User, X } from "lucide-react";
import { API_BASE_URL } from "../../config/api";
import {
  CustomerProfile,
  formatBrazilianPhone,
  mapCustomerProfile,
} from "../customerSession";

interface CardapioUserProfileModalProps {
  onClose: () => void;
  user: CustomerProfile | null;
  customerToken: string | null;
  onProfileUpdate: (profile: CustomerProfile) => void;
  onLogout: () => void;
}

export default function CardapioUserProfileModal({
  onClose,
  user,
  customerToken,
  onProfileUpdate,
  onLogout,
}: CardapioUserProfileModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [address, setAddress] = useState(user?.address || "");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    setName(user?.name || "");
    setAddress(user?.address || "");
    setIsEditing(false);
  }, [user]);

  useEffect(() => {
    if (!customerToken) return;
    const controller = new AbortController();
    void fetch(`${API_BASE_URL}/cardapio/clientes/me`, {
      headers: { "X-Koma-Customer-Token": customerToken },
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        onLogout();
        return;
      }
      if (response.ok && data?.id) onProfileUpdate(mapCustomerProfile(data));
    }).catch((error) => {
      if ((error as Error).name !== "AbortError") {
        setErrorMessage("Não foi possível atualizar os pontos agora.");
      }
    });
    return () => controller.abort();
  }, [customerToken]);

  const saveProfile = async () => {
    const cleanName = name.trim();
    const cleanAddress = address.trim();
    if (cleanName.length < 2) {
      setErrorMessage("Informe um nome válido.");
      return;
    }
    if (!customerToken) {
      setErrorMessage("Sua sessão expirou. Confirme seu celular novamente.");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/cardapio/clientes/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Koma-Customer-Token": customerToken,
        },
        body: JSON.stringify({ nome: cleanName, endereco: cleanAddress }),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        onLogout();
        throw new Error("Sua sessão expirou. Confirme seu celular novamente.");
      }
      if (!response.ok) {
        throw new Error(
          typeof data?.detail === "string"
            ? data.detail
            : "Não foi possível atualizar o perfil.",
        );
      }
      const updatedProfile = mapCustomerProfile(data);
      onProfileUpdate(updatedProfile);
      setName(updatedProfile.name);
      setAddress(updatedProfile.address);
      setIsEditing(false);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Não foi possível atualizar o perfil.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void saveProfile();
  };

  const handleLogout = () => {
    if (!window.confirm("Sair deste cardápio neste dispositivo?")) return;
    onLogout();
    onClose();
  };

  return (
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 animate-fade-in cursor-pointer"
      id="user-profile-overlay"
    >
      <div className="relative w-full max-w-md rounded-3xl bg-koma-card border border-slate-800 p-6 shadow-2xl flex flex-col max-h-[90vh] text-slate-100 animate-scale-up">
        <div className="flex items-center justify-between border-b border-slate-800/60 pb-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-black uppercase tracking-wide text-koma-foreground">Meu Perfil</h2>
              <p className="text-[10px] text-koma-muted font-medium">Pedidos e pontos sincronizados</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800/50 hover:bg-slate-800 text-koma-subtle hover:text-koma-foreground transition"
            aria-label="Fechar perfil"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto mt-4 space-y-5 pr-1 no-scrollbar text-xs">
          {!user ? (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-center text-amber-300">
              Confirme seu celular para acessar o perfil.
            </div>
          ) : isEditing ? (
            <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
              <div className="bg-gradient-to-br from-primary/10 to-transparent p-4 rounded-2xl border border-primary/10 text-center space-y-1.5">
                <ShieldCheck className="h-6 w-6 text-primary mx-auto" />
                <h3 className="font-display font-extrabold text-sm text-koma-foreground">Atualize seus dados</h3>
                <p className="text-[11px] text-koma-subtle leading-relaxed">
                  O celular é sua identidade. Para trocá-lo, saia e confirme o novo número.
                </p>
              </div>

              <label className="block">
                <span className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block mb-1">Celular verificado</span>
                <span className="relative block">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-koma-muted" />
                  <input
                    type="tel"
                    value={formatBrazilianPhone(user.phone)}
                    readOnly
                    className="w-full rounded-xl border border-slate-800 bg-slate-950/50 py-2.5 pl-10 pr-4 text-xs text-koma-subtle cursor-not-allowed"
                  />
                </span>
              </label>

              <label className="block">
                <span className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block mb-1">Nome completo</span>
                <span className="relative block">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-koma-muted" />
                  <input
                    type="text"
                    required
                    maxLength={100}
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-900/60 py-2.5 pl-10 pr-4 text-xs text-koma-foreground focus:border-primary outline-hidden transition"
                  />
                </span>
              </label>

              <label className="block">
                <span className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block mb-1">Endereço principal</span>
                <span className="relative block">
                  <MapPin className="absolute left-3.5 top-3 h-4 w-4 text-koma-muted" />
                  <textarea
                    maxLength={300}
                    autoComplete="street-address"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    rows={2}
                    className="w-full rounded-xl border border-slate-800 bg-slate-900/60 py-2.5 pl-10 pr-4 text-xs text-koma-foreground focus:border-primary outline-hidden transition resize-none"
                  />
                </span>
              </label>

              {errorMessage && (
                <p className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-red-400 text-[11px] font-semibold">
                  {errorMessage}
                </p>
              )}
              <button
                type="submit"
                disabled={isSaving}
                className="w-full rounded-xl bg-primary py-3 text-center text-xs font-black uppercase tracking-wider text-koma-foreground disabled:opacity-60"
              >
                {isSaving ? "Salvando..." : "Salvar Perfil"}
              </button>
            </form>
          ) : (
            <div className="space-y-5 animate-fade-in">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-bold text-primary tracking-widest uppercase">Celular verificado</span>
                  <h3 className="font-display font-black text-sm text-koma-foreground">{user.name}</h3>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-[10px] text-red-400 font-extrabold uppercase border border-red-500/10 transition"
                >
                  <LogOut className="h-3 w-3" /> Sair
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-primary/15 bg-primary/5 p-3">
                  <Coins className="h-4 w-4 text-primary mb-1" />
                  <p className="text-[9px] uppercase text-koma-muted font-bold">Pontos</p>
                  <p className="text-base font-black text-koma-foreground">{user.points}</p>
                </div>
                <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-3">
                  <p className="text-[9px] uppercase text-koma-muted font-bold mt-5">Cashback</p>
                  <p className="text-base font-black text-koma-foreground">
                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(user.cashback)}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Phone className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-koma-muted font-bold">Celular</p>
                    <p className="text-xs text-koma-foreground">{formatBrazilianPhone(user.phone)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-koma-muted font-bold">Endereço</p>
                    <p className="text-xs text-koma-foreground leading-relaxed">{user.address || "Nenhum endereço salvo"}</p>
                  </div>
                </div>
              </div>

              {errorMessage && <p className="text-red-400 text-[11px]">{errorMessage}</p>}
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="w-full rounded-xl bg-slate-800 hover:bg-slate-700 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-koma-foreground transition"
              >
                Editar Dados
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800/60 text-center shrink-0">
          <p className="text-[9px] text-koma-muted leading-tight">
            Alterações são sincronizadas com o cadastro do restaurante.
          </p>
        </div>
      </div>
    </div>
  );
}
