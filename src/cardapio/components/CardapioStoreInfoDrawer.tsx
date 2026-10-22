/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { BrandConfig } from "../CardapioTypes";
import { Clock3, CreditCard, ExternalLink, Info, MapPin, MessageCircle, Store, X } from "lucide-react";
import { CardapioDeliveryInfo } from "./CardapioOrderConditions";
import { buildKomaAttributionUrl } from "../komaAttribution";

interface CardapioStoreInfoDrawerProps {
  brand: BrandConfig;
  isOpen: boolean;
  onClose: () => void;
}

export default function CardapioStoreInfoDrawer({
  brand,
  isOpen,
  onClose,
}: CardapioStoreInfoDrawerProps) {
  if (!isOpen) return null;

  const statusLabel = brand.storeStatus === "open"
    ? "Aberto para pedidos"
    : brand.storeStatus === "closed"
      ? brand.availabilitySource === "schedule"
        ? brand.nextOpeningLabel
          ? `Estabelecimento fechado · abre ${brand.nextOpeningLabel}`
          : "Estabelecimento fechado"
        : brand.availabilitySource === "cash_closed"
          ? "Estabelecimento fechado · aguardando abertura do caixa"
          : "Pedidos pausados"
      : "Funcionamento por horário";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm animate-fade-in sm:items-stretch sm:justify-start"
      id="store-info-overlay"
      onClick={onClose}
    >
      <div
        className="koma-art-store-sheet relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[32px] border border-white/10 text-koma-foreground shadow-2xl sm:h-full sm:max-h-none sm:max-w-sm sm:rounded-none sm:rounded-r-[32px] sm:border-r animate-slide-right"
        id="store-info-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Informações do restaurante"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative min-h-52 shrink-0 overflow-hidden bg-[#040a07]">
          {brand.bannerImage ? (
            <img
              src={brand.bannerImage}
              alt={brand.name}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#021a12] via-[#05291d] to-[#0a4833]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#06110d] via-black/50 to-black/20" />

          <button
            type="button"
            onClick={onClose}
            className="koma-art-glass-btn absolute right-3.5 top-3.5 !w-10 !h-10"
            id="btn-close-store-info"
            aria-label="Fechar informações"
            title="Fechar informações"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="absolute inset-x-0 bottom-0 flex items-end gap-3.5 p-5">
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/20 bg-white p-1.5 shadow-xl">
              <img src={brand.logo} alt={brand.name} className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0 pb-0.5">
              <h2 className="truncate font-serif text-xl font-black tracking-tight text-white">{brand.name}</h2>
              {brand.slogan && <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-white/75">{brand.slogan}</p>}
              <span className="mt-2 koma-art-status-beacon">
                <span className={`koma-art-beacon-dot ${brand.storeStatus === "open" ? "koma-art-beacon-dot--open" : brand.storeStatus === "closed" ? "koma-art-beacon-dot--closed" : "koma-art-beacon-dot--paused"}`} />
                <span className="text-white/90">{statusLabel}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 no-scrollbar">
          <div className="space-y-5">
            <CardapioDeliveryInfo brand={brand} />
            {brand.about && (
              <section>
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-emerald-400" />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">Sobre nós</h3>
                </div>
                <p className="mt-2.5 text-xs leading-relaxed text-koma-secondary">{brand.about}</p>
              </section>
            )}

            {brand.operatingHours && brand.operatingHours.length > 0 && (
              <section className="border-t border-white/10 pt-5">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-emerald-400" />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">Horários</h3>
                </div>
                <div className="mt-3 koma-art-store-hours-table">
                  {brand.operatingHours.map((row, index) => (
                    <div key={`${row.days}-${row.hours}-${index}`} className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 last:border-b-0">
                      <span className="text-xs font-semibold text-koma-secondary">{row.days}</span>
                      <strong className="shrink-0 font-mono text-xs text-koma-foreground">{row.hours}</strong>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {brand.paymentMethods && brand.paymentMethods.length > 0 && (
              <section className="border-t border-white/10 pt-5">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-emerald-400" />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">Pagamento</h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-koma-muted">Veja as opções disponíveis ao revisar sua sacola.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {brand.paymentMethods.map((method) => (
                    <span key={method.type} className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold text-emerald-400">
                      {method.type}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {(brand.address || brand.googleMapsUrl) && (
              <section className="border-t border-white/10 pt-5">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-emerald-400" />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">Localização e retirada</h3>
                </div>
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  {brand.address && (
                    <div className="flex items-start gap-2.5">
                      <Store className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <p className="text-xs font-semibold leading-relaxed text-koma-secondary">{brand.address}</p>
                    </div>
                  )}
                  {brand.googleMapsUrl && (
                    <a
                      href={brand.googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3.5 flex h-11 w-full items-center justify-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 hover:bg-emerald-500/25 px-4 text-[10px] font-black uppercase tracking-wider text-emerald-400 transition-all cursor-pointer shadow-md shadow-emerald-950/20"
                      id="btn-google-maps-link"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Abrir no Google Maps
                    </a>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-white/10 bg-black/40 backdrop-blur-md p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <button type="button" onClick={onClose} className="mb-3.5 min-h-12 w-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-5 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-emerald-950/40 hover:from-emerald-400 hover:to-teal-400 transition-all cursor-pointer">Voltar ao cardápio</button>
          <div className="flex items-center justify-between gap-3">
            <a
              href={buildKomaAttributionUrl("store_info", brand.id)}
              target="_blank"
              rel="noopener noreferrer"
              id="store-info-koma-attribution"
              aria-label="Conhecer o KÔMA, plataforma deste cardápio digital"
              className="inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-[9px] font-semibold text-koma-muted transition hover:border-emerald-500/35 hover:text-emerald-400"
            >
              <span className="truncate">Cardápio digital por <strong className="font-black text-koma-foreground">KÔMA</strong></span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </a>
            {brand.phone && (
              <a
                href={`https://wa.me/${String(brand.phone).replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 text-[9px] font-bold text-koma-secondary transition hover:border-emerald-500/30 hover:text-emerald-400"
              >
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
