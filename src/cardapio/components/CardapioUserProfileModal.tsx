/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { Coins, LogOut, Mail, MapPin, Pencil, Phone, ShieldCheck, User, Wallet, X } from "lucide-react";
import type { BrandConfig } from "../CardapioTypes";
import { API_BASE_URL } from "../../config/api";
import {
  CustomerProfile,
  formatBrazilianPhone,
  mapCustomerProfile,
} from "../customerSession";
import CardapioCustomerOrderHistory, { CustomerHistoryOrder } from "./CardapioCustomerOrderHistory";

interface CardapioUserProfileModalProps {
  onClose: () => void;
  user: CustomerProfile | null;
  customerToken: string | null;
  benefits?: BrandConfig["benefits"];
  onProfileUpdate: (profile: CustomerProfile) => void;
  onLogout: () => void;
  onRepeatOrder?: (order: CustomerHistoryOrder) => void;
}

export default function CardapioUserProfileModal({
  onClose,
  user,
  customerToken,
  benefits,
  onProfileUpdate,
  onLogout,
  onRepeatOrder,
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
        setErrorMessage("Não foi possível atualizar seu cadastro agora.");
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
      className="fixed inset-0 z-50 flex items-end justify-center p-0 pb-[86px] sm:items-center sm:p-4 animate-fade-in cursor-pointer"
      style={{ backgroundColor: "var(--km-overlay)" }}
      id="user-profile-overlay"
    >
      <div
        className="relative flex max-h-[calc(100dvh-100px)] w-full max-w-md flex-col rounded-t-[28px] border border-[var(--km-line)] bg-[var(--km-dialog)] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] text-[var(--km-ink)] shadow-2xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6 animate-scale-up"
        role="dialog"
        aria-modal="true"
        aria-label="Minha conta"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--km-line-strong)] sm:hidden" />

        <div className="flex items-center justify-between border-b border-[var(--km-line-subtle)] pb-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)]">
              <User className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-display text-lg font-black tracking-tight text-[var(--km-ink)]">
                {user ? user.name : "Minha conta"}
              </h2>
              <p className="text-[11px] font-medium text-[var(--km-muted)] truncate">
                {user
                  ? user.phoneVerified
                    ? "Conta verificada"
                    : "Dados sincronizados"
                  : "Pedidos, endereços e benefícios"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--km-line)] bg-[var(--km-raised)] text-[var(--km-ink-2)] transition hover:text-[var(--km-ink)] cursor-pointer"
            aria-label="Fechar perfil"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-0.5 no-scrollbar text-xs">
          {!user ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] px-5 py-10 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-3xl border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] text-[var(--km-accent-text)]">
                <ShieldCheck className="h-8 w-8" />
              </div>
              <h3 className="mt-4 font-display text-base font-black text-[var(--km-ink)]">
                Entre com seu celular
              </h3>
              <p className="mt-1.5 max-w-[240px] text-xs leading-relaxed text-[var(--km-muted)]">
                Confirme seu número para salvar endereços, acompanhar pedidos e acumular benefícios.
              </p>
            </div>
          ) : isEditing ? (
            <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
              <div className="rounded-2xl border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] p-4 text-center space-y-1.5">
                <ShieldCheck className="h-6 w-6 text-[var(--km-accent-text)] mx-auto" />
                <h3 className="font-display font-extrabold text-sm text-[var(--km-ink)]">Atualize seus dados</h3>
                <p className="text-[11px] text-[var(--km-ink-2)] leading-relaxed">
                  O celular é sua identidade. Para trocá-lo, saia e confirme o novo número.
                </p>
              </div>

              <label className="block">
                <span className="text-[10px] font-bold text-[var(--km-muted)] uppercase tracking-wider block mb-1.5">
                  {user.phoneVerified ? "Celular verificado" : "Celular cadastrado"}
                </span>
                <span className="relative block">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--km-muted)]" />
                  <input
                    type="tel"
                    value={formatBrazilianPhone(user.phone)}
                    readOnly
                    className="w-full rounded-xl border border-[var(--km-line-subtle)] bg-[var(--km-panel)] py-3 pl-10 pr-4 text-xs text-[var(--km-muted)] cursor-not-allowed"
                  />
                </span>
              </label>

              <label className="block">
                <span className="text-[10px] font-bold text-[var(--km-muted)] uppercase tracking-wider block mb-1.5">Nome completo</span>
                <span className="relative block">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--km-muted)]" />
                  <input
                    type="text"
                    required
                    maxLength={100}
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-xl border border-[var(--km-line)] bg-[var(--km-input)] py-3 pl-10 pr-4 text-xs text-[var(--km-ink)] focus:border-[var(--km-focus)] outline-hidden transition"
                  />
                </span>
              </label>

              <label className="block">
                <span className="text-[10px] font-bold text-[var(--km-muted)] uppercase tracking-wider block mb-1.5">Endereço principal</span>
                <span className="relative block">
                  <MapPin className="absolute left-3.5 top-3 h-4 w-4 text-[var(--km-muted)]" />
                  <textarea
                    maxLength={300}
                    autoComplete="street-address"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    rows={2}
                    placeholder="Rua, número, complemento, bairro..."
                    className="w-full rounded-xl border border-[var(--km-line)] bg-[var(--km-input)] py-3 pl-10 pr-4 text-xs text-[var(--km-ink)] placeholder:text-[var(--km-subtle)] focus:border-[var(--km-focus)] outline-hidden transition resize-none"
                  />
                </span>
              </label>

              {errorMessage && (
                <p
                  className="rounded-xl border p-3 text-[11px] font-semibold"
                  style={{
                    background: "var(--koma-danger-bg)",
                    borderColor: "var(--koma-danger-border)",
                    color: "var(--koma-danger-text)",
                  }}
                >
                  {errorMessage}
                </p>
              )}

              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setErrorMessage("");
                    setName(user.name);
                    setAddress(user.address);
                  }}
                  disabled={isSaving}
                  className="min-h-11 flex-1 rounded-xl border border-[var(--km-line)] bg-[var(--km-raised)] text-center text-xs font-bold text-[var(--km-ink)] transition hover:opacity-90 disabled:opacity-60 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="min-h-11 flex-[1.5] rounded-xl bg-[var(--km-accent)] py-3 text-center text-xs font-black uppercase tracking-wider text-[var(--km-on-accent)] transition hover:bg-[var(--km-accent-hover)] disabled:opacity-60 cursor-pointer"
                >
                  {isSaving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4 animate-fade-in">
              {benefits?.loyalty && (
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-2xl border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] p-3.5">
                    <div className="flex items-center gap-1.5 text-[var(--km-accent-text)]">
                      <Coins className="h-4 w-4 shrink-0" />
                      <span className="text-[10px] uppercase tracking-wider font-extrabold">Pontos</span>
                    </div>
                    <p className="mt-1.5 text-lg font-black text-[var(--km-ink)] tabular-nums">{user.points}</p>
                  </div>
                  <div className="rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-3.5">
                    <div className="flex items-center gap-1.5 text-[var(--km-accent-text)]">
                      <Wallet className="h-4 w-4 shrink-0" />
                      <span className="text-[10px] uppercase tracking-wider font-extrabold">Cashback</span>
                    </div>
                    <p className="mt-1.5 text-lg font-black text-[var(--km-ink)] tabular-nums">
                      {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(user.cashback)}
                    </p>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 border-b border-[var(--km-line-subtle)] pb-2.5">
                  <span className="text-[10px] font-black uppercase tracking-wider text-[var(--km-accent-text)]">
                    Seus dados
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--km-line)] bg-[var(--km-raised)] px-2.5 py-1 text-[11px] font-bold text-[var(--km-ink)] transition hover:border-[var(--km-accent-border)] cursor-pointer"
                  >
                    <Pencil className="h-3 w-3" /> Editar
                  </button>
                </div>

                {user.email && (
                  <div className="flex items-start gap-3">
                    <Mail className="h-4 w-4 text-[var(--km-accent-text)] mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[9px] uppercase tracking-wider text-[var(--km-muted)] font-bold">E-mail</p>
                      <p className="text-xs text-[var(--km-ink)] truncate">{user.email}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <Phone className="h-4 w-4 text-[var(--km-accent-text)] mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-[var(--km-muted)] font-bold">
                      {user.phoneVerified ? "Celular verificado" : "Celular"}
                    </p>
                    <p className="text-xs text-[var(--km-ink)] tabular-nums">{formatBrazilianPhone(user.phone)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="h-4 w-4 text-[var(--km-accent-text)] mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-[var(--km-muted)] font-bold">Endereço principal</p>
                    <p className="text-xs text-[var(--km-ink)] leading-relaxed">
                      {user.address || "Nenhum endereço salvo — toque em Editar para adicionar"}
                    </p>
                  </div>
                </div>
              </div>

              {customerToken && (
                <div className="space-y-2">
                  <CardapioCustomerOrderHistory
                    customerToken={customerToken}
                    onRepeatOrder={onRepeatOrder}
                  />
                </div>
              )}

              {errorMessage && (
                <p
                  className="rounded-xl border p-3 text-[11px] font-semibold"
                  style={{
                    background: "var(--koma-danger-bg)",
                    borderColor: "var(--koma-danger-border)",
                    color: "var(--koma-danger-text)",
                  }}
                >
                  {errorMessage}
                </p>
              )}

              <button
                type="button"
                onClick={handleLogout}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-extrabold uppercase tracking-wider transition hover:opacity-90 cursor-pointer"
                style={{
                  background: "var(--koma-danger-bg)",
                  borderColor: "var(--koma-danger-border)",
                  color: "var(--koma-danger-text)",
                }}
              >
                <LogOut className="h-3.5 w-3.5" /> Trocar conta / Sair
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-[var(--km-line-subtle)] text-center shrink-0">
          <p className="text-[10px] text-[var(--km-muted)] leading-tight">
            Alterações são sincronizadas com o cadastro do restaurante.
          </p>
        </div>
      </div>
    </div>
  );
}
