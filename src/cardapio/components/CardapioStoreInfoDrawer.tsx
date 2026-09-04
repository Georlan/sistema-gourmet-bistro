/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { BrandConfig } from "../CardapioTypes";
import { Clock3, CreditCard, ExternalLink, Info, MapPin, MessageCircle, Store, X } from "lucide-react";
import { CardapioDeliveryInfo } from "./CardapioOrderConditions";

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
      ? brand.availabilitySource === "schedule" ? "Fora do horário" : "Pedidos pausados"
      : "Funcionamento por horário";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-start bg-black/70 backdrop-blur-sm animate-fade-in"
      id="store-info-overlay"
      onClick={onClose}
    >
      <div
        className="relative flex h-full w-full max-w-sm flex-col overflow-hidden border-r border-koma-border bg-koma-panel text-koma-foreground shadow-2xl animate-slide-right"
        id="store-info-drawer"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative min-h-48 shrink-0 overflow-hidden bg-[#090a0f]">
          {brand.bannerImage && (
            <img
              src={brand.bannerImage}
              alt={brand.name}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#090a0f] via-black/40 to-black/15" />

          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 grid h-11 w-11 min-h-[44px] min-w-[44px] place-items-center rounded-full border border-white/10 bg-black/45 text-white/80 backdrop-blur transition hover:bg-black/70 hover:text-white"
            id="btn-close-store-info"
            aria-label="Fechar informações"
            title="Fechar informações"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-5">
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/15 bg-white p-1 shadow-lg">
              <img src={brand.logo} alt={brand.name} className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0 pb-0.5">
              <h2 className="truncate font-display text-lg font-black tracking-tight text-white">{brand.name}</h2>
              {brand.slogan && <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-white/65">{brand.slogan}</p>}
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[8px] font-bold text-white/80 backdrop-blur">
                <i className={`h-1.5 w-1.5 rounded-full ${brand.storeStatus === "open" ? "bg-emerald-400" : brand.storeStatus === "closed" ? "bg-rose-400" : "bg-amber-300"}`} />
                {statusLabel}
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
                  <Info className="h-4 w-4 text-emerald-500" />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">Sobre</h3>
                </div>
                <p className="mt-2.5 text-[11px] leading-relaxed text-koma-secondary">{brand.about}</p>
              </section>
            )}

            {brand.operatingHours && brand.operatingHours.length > 0 && (
              <section className="border-t border-koma-border pt-5">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-emerald-500" />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">Horários</h3>
                </div>
                <div className="mt-3 overflow-hidden rounded-2xl border border-koma-border bg-koma-card">
                  {brand.operatingHours.map((row, index) => (
                    <div key={`${row.days}-${row.hours}-${index}`} className="flex items-center justify-between gap-3 border-b border-koma-border px-3.5 py-3 last:border-b-0">
                      <span className="text-[10px] font-semibold text-koma-secondary">{row.days}</span>
                      <strong className="shrink-0 text-[10px] text-koma-foreground">{row.hours}</strong>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {brand.paymentMethods && brand.paymentMethods.length > 0 && (
              <section className="border-t border-koma-border pt-5">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-emerald-500" />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">Pagamento</h3>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-koma-muted">Pagamento feito diretamente ao restaurante.</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {brand.paymentMethods.map((method) => (
                    <span key={method.type} className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] px-2.5 py-1.5 text-[9px] font-bold text-emerald-500">
                      {method.type}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {(brand.address || brand.googleMapsUrl) && (
              <section className="border-t border-koma-border pt-5">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-emerald-500" />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">Localização e retirada</h3>
                </div>
                <div className="mt-3 rounded-2xl border border-koma-border bg-koma-card p-3.5">
                  {brand.address && (
                    <div className="flex items-start gap-2.5">
                      <Store className="mt-0.5 h-4 w-4 shrink-0 text-koma-muted" />
                      <p className="text-[11px] font-semibold leading-relaxed text-koma-secondary">{brand.address}</p>
                    </div>
                  )}
                  {brand.googleMapsUrl && (
                    <a
                      href={brand.googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-[9px] font-black uppercase tracking-wider text-emerald-500 transition hover:bg-emerald-500/15"
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

        <div className="shrink-0 border-t border-koma-border bg-koma-card/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[9px] font-semibold text-koma-subtle">Cardápio e pedidos online por Kôma</span>
            {brand.phone && (
              <a
                href={`https://wa.me/${String(brand.phone).replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-panel px-3 text-[9px] font-bold text-koma-secondary transition hover:border-emerald-500/30 hover:text-emerald-500"
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
