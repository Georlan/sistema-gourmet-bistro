/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { BrandConfig } from "../CardapioTypes";
import { X, Clock, MapPin, CreditCard, ExternalLink, Info, Store } from "lucide-react";

interface CardapioStoreInfoDrawerProps {
  brand: BrandConfig;
  isOpen: boolean;
  onClose: () => void;
}

export default function CardapioStoreInfoDrawer({ brand, isOpen, onClose }: CardapioStoreInfoDrawerProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-start bg-black/60 animate-fade-in backdrop-blur-xs"
      id="store-info-overlay"
      onClick={onClose}
    >
      {/* Drawer Container */}
      <div
        className="relative flex h-full w-full max-w-sm flex-col bg-card-app border-r border-slate-500/10 shadow-2xl animate-slide-right overflow-hidden text-text-app"
        id="store-info-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header containing a nice cover banner */}
        <div className="relative h-32 w-full shrink-0">
          <img
            src={brand.bannerImage}
            alt={brand.name}
            className="h-full w-full object-cover brightness-[0.75]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 hover:scale-105 transition shadow-md"
            id="btn-close-store-info"
            title="Fechar informações"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Logo overlapping the cover */}
          <div className="absolute -bottom-6 left-6 flex items-end gap-3">
            <img
              src={brand.logo}
              alt={brand.name}
              className="h-16 w-16 rounded-xl border-2 border-slate-500/15 bg-card-app object-cover shadow-md"
            />
          </div>
        </div>

        {/* Brand Main Title and Slogan */}
        <div className="px-6 pt-8 pb-3 border-b border-slate-500/10 shrink-0">
          <h2 className="font-display text-lg font-extrabold text-text-app flex items-center gap-1.5 leading-tight">
            {brand.name}
          </h2>
          <p className="text-[10px] text-text-app/40 font-medium mt-0.5">{brand.slogan}</p>
        </div>

        {/* Scrollable contents */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">
          
          {/* Section 1: Sobre Nós */}
          {brand.about && (
            <div className="space-y-2">
              <h3 className="text-xs font-black text-text-app uppercase tracking-wider flex items-center gap-1.5">
                <Info className="h-4 w-4 text-primary shrink-0" />
                Sobre Nós
              </h3>
              <p className="text-[11px] text-text-app/75 leading-relaxed text-justify bg-slate-500/5 p-3 rounded-xl border border-slate-500/10">
                {brand.about}
              </p>
            </div>
          )}

          {/* Section 2: Funcionamento */}
          {brand.operatingHours && brand.operatingHours.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-black text-text-app uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-primary shrink-0" />
                Horários de Funcionamento
              </h3>
              <div className="rounded-xl border border-slate-500/10 overflow-hidden bg-card-app">
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-slate-500/5 border-b border-slate-500/10 text-text-app/40 font-extrabold text-left uppercase tracking-wider">
                      <th className="py-2 px-3">Dias</th>
                      <th className="py-2 px-3 text-right">Horário</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-500/10">
                    {brand.operatingHours.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-500/5">
                        <td className="py-2.5 px-3 font-semibold text-text-app/80">{row.days}</td>
                        <td className="py-2.5 px-3 text-right text-text-app/60 font-medium">{row.hours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section 3: Formas de Pagamento */}
          {brand.paymentMethods && brand.paymentMethods.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-xs font-black text-text-app uppercase tracking-wider flex items-center gap-1.5">
                <CreditCard className="h-4 w-4 text-primary shrink-0" />
                Formas de Pagamento Aceitas
              </h3>
              <div className="flex flex-col gap-2 bg-slate-500/5 p-3.5 rounded-xl border border-slate-500/10">
                {brand.paymentMethods.map((method, idx) => (
                  <div key={idx} className="flex flex-col gap-1 pb-2 last:pb-0 last:border-b-0 border-b border-slate-500/10">
                    <span className="text-[10px] font-extrabold text-text-app/50 uppercase tracking-wide">
                      {method.type}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {method.accepted.map((brandName, subIdx) => (
                        <span
                          key={subIdx}
                          className="bg-slate-500/5 border border-slate-500/10 rounded-md px-1.5 py-0.5 text-[9px] font-medium text-text-app/80 shadow-3xs"
                        >
                          {brandName}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 4: Localização e Retirada */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-black text-text-app uppercase tracking-wider flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-primary shrink-0" />
              Localização & Retiradas
            </h3>
            <div className="p-4 bg-slate-500/5 border border-slate-500/10 rounded-xl flex flex-col gap-3">
              <div className="flex items-start gap-2">
                <Store className="h-4 w-4 text-text-app/40 shrink-0 mt-0.5" />
                <p className="text-[11px] text-text-app/80 font-medium leading-relaxed">
                  {brand.address}
                </p>
              </div>

              {brand.googleMapsUrl && (
                <a
                  href={brand.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-primary hover:opacity-90 text-white font-bold text-[10px] transition uppercase tracking-wider text-center"
                  id="btn-google-maps-link"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>Ver no Google Maps</span>
                </a>
              )}
            </div>
          </div>

        </div>

        {/* Mini footer */}
        <div className="p-4 border-t border-slate-500/10 bg-slate-500/5 shrink-0 text-center text-[9px] font-semibold text-text-app/40 uppercase tracking-wider">
          © {brand.name} • Whitelabel Platform
        </div>
      </div>
    </div>
  );
}
