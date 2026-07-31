/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { LogOut, MapPin, Phone, ShieldCheck, User, X } from "lucide-react";

interface CustomerProfile {
  name: string;
  phone: string;
  address: string;
}

interface CardapioUserProfileModalProps {
  onClose: () => void;
  user: Partial<CustomerProfile> | null;
  onProfileUpdate: (profile: CustomerProfile) => void;
  onLogout: () => void;
}

const getSavedProfile = (): Partial<CustomerProfile> | null => {
  const raw = localStorage.getItem("koma_cliente_perfil");
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const formatPhoneBrazilian = (value: string) => {
  const numbers = value.replace(/\D/g, "").slice(0, 11);
  if (numbers.length <= 2) return numbers ? `(${numbers}` : "";
  if (numbers.length <= 6) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  if (numbers.length <= 10) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  }
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
};

export default function CardapioUserProfileModal({
  onClose,
  user,
  onProfileUpdate,
  onLogout
}: CardapioUserProfileModalProps) {
  const initialProfile = getSavedProfile() || user;
  const [profile, setProfile] = useState<Partial<CustomerProfile> | null>(initialProfile);
  const [isEditing, setIsEditing] = useState(!initialProfile);
  const [name, setName] = useState(initialProfile?.name || "");
  const [phone, setPhone] = useState(formatPhoneBrazilian(initialProfile?.phone || ""));
  const [address, setAddress] = useState(initialProfile?.address || "");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const activeProfile = getSavedProfile() || user;
    setProfile(activeProfile);
    setName(activeProfile?.name || "");
    setPhone(formatPhoneBrazilian(activeProfile?.phone || ""));
    setAddress(activeProfile?.address || "");
    setIsEditing(!activeProfile);
  }, [user]);

  const saveProfile = () => {
    const cleanName = name.trim();
    const cleanPhone = phone.replace(/\D/g, "");
    const cleanAddress = address.trim();

    if (cleanName.length < 2) {
      setErrorMessage("Informe um nome válido.");
      return;
    }
    if (cleanPhone.length < 10 || cleanPhone.length > 11) {
      setErrorMessage("Informe um celular válido com DDD.");
      return;
    }

    const newProfile: CustomerProfile = {
      name: cleanName,
      phone: cleanPhone,
      address: cleanAddress
    };

    localStorage.setItem("koma_cliente_perfil", JSON.stringify(newProfile));
    localStorage.setItem("whitelabel_menu_current_user", JSON.stringify(newProfile));
    setProfile(newProfile);
    setName(newProfile.name);
    setPhone(formatPhoneBrazilian(newProfile.phone));
    setAddress(newProfile.address);
    setErrorMessage("");
    setIsEditing(false);
    onProfileUpdate(newProfile);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    saveProfile();
  };

  const handleClearProfile = () => {
    if (!window.confirm("Remover deste dispositivo os dados usados para agilizar seus pedidos?")) {
      return;
    }

    localStorage.removeItem("koma_cliente_perfil");
    localStorage.removeItem("whitelabel_menu_current_user");
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
      <div
        className="relative w-full max-w-md rounded-3xl bg-[#121420] border border-slate-800 p-6 shadow-2xl flex flex-col max-h-[90vh] text-slate-100 animate-scale-up"
        id="user-profile-card"
      >
        <div className="flex items-center justify-between border-b border-slate-800/60 pb-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-black uppercase tracking-wide text-white">Meu Perfil</h2>
              <p className="text-[10px] text-slate-500 font-medium">Dados usados nos seus pedidos</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-slate-800/50 hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
            id="btn-close-profile"
            aria-label="Fechar perfil"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto mt-4 space-y-5 pr-1 no-scrollbar text-xs">
          {!profile || isEditing ? (
            <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
              <div className="bg-gradient-to-br from-primary/10 to-transparent p-4 rounded-2xl border border-primary/10 text-center space-y-1.5">
                <ShieldCheck className="h-6 w-6 text-primary mx-auto" />
                <h3 className="font-display font-extrabold text-sm text-white">
                  {profile ? "Atualize seus dados" : "Agilize seu próximo pedido"}
                </h3>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Nome e telefone identificam o pedido. O endereço é opcional e pode ser alterado no checkout.
                </p>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Nome completo
                  </span>
                  <span className="relative block">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <input
                      type="text"
                      required
                      maxLength={100}
                      autoComplete="name"
                      placeholder="Ex: João Silva"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900/60 py-2.5 pl-10 pr-4 text-xs text-white focus:bg-slate-900 focus:border-primary outline-hidden transition"
                    />
                  </span>
                </label>

                <label className="block">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Celular com DDD
                  </span>
                  <span className="relative block">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <input
                      type="tel"
                      required
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="Ex: (11) 99999-9999"
                      value={phone}
                      onChange={(event) => setPhone(formatPhoneBrazilian(event.target.value))}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900/60 py-2.5 pl-10 pr-4 text-xs text-white focus:bg-slate-900 focus:border-primary outline-hidden transition"
                    />
                  </span>
                </label>

                <label className="block">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Endereço principal de entrega
                  </span>
                  <span className="relative block">
                    <MapPin className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
                    <textarea
                      maxLength={300}
                      autoComplete="street-address"
                      placeholder="Rua, número, complemento e bairro"
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      rows={2}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900/60 py-2.5 pl-10 pr-4 text-xs text-white focus:bg-slate-900 focus:border-primary outline-hidden transition resize-none"
                    />
                  </span>
                </label>
              </div>

              {errorMessage && (
                <p className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-red-400 text-[11px] font-semibold">
                  {errorMessage}
                </p>
              )}

              <button
                type="submit"
                className="w-full rounded-xl bg-primary py-3 text-center text-xs font-black uppercase tracking-wider text-white hover:opacity-95 active:scale-98 transition"
              >
                Salvar Perfil
              </button>
            </form>
          ) : (
            <div className="space-y-5 animate-fade-in">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-bold text-primary tracking-widest uppercase">Dados salvos</span>
                  <h3 className="font-display font-black text-sm text-white">{profile.name}</h3>
                </div>
                <button
                  type="button"
                  onClick={handleClearProfile}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-[10px] text-red-400 font-extrabold tracking-wider uppercase border border-red-500/10 transition"
                  title="Remover dados deste dispositivo"
                >
                  <LogOut className="h-3 w-3" />
                  <span>Limpar</span>
                </button>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Phone className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Celular</p>
                    <p className="text-xs text-white">{formatPhoneBrazilian(profile.phone || "")}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Endereço</p>
                    <p className="text-xs text-white leading-relaxed">
                      {profile.address || "Nenhum endereço salvo"}
                    </p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="w-full rounded-xl bg-slate-800 hover:bg-slate-700 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-white transition"
              >
                Editar Dados
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800/60 text-center shrink-0">
          <p className="text-[9px] text-slate-500 leading-tight">
            Estes dados ficam neste dispositivo para preencher pedidos futuros.
          </p>
        </div>
      </div>
    </div>
  );
}
