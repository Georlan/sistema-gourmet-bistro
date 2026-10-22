/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { BrandConfig } from "../CardapioTypes";
import {
  Check,
  Clock3,
  CreditCard,
  ExternalLink,
  Info,
  MapPin,
  MessageCircle,
  Phone,
  Share2,
  Store,
  Truck,
  X,
} from "lucide-react";
import { buildKomaAttributionUrl } from "../komaAttribution";
import { KomaSocialCameraIcon } from "./KomaPublicIcons";

interface CardapioStoreInfoDrawerProps {
  brand: BrandConfig;
  isOpen: boolean;
  onClose: () => void;
}

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export default function CardapioStoreInfoDrawer({
  brand,
  isOpen,
  onClose,
}: CardapioStoreInfoDrawerProps) {
  const [copiedShare, setCopiedShare] = useState(false);

  if (!isOpen) return null;

  const statusLabel =
    brand.storeStatus === "open"
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

  const handleShare = async () => {
    const shareData = {
      title: brand.name,
      text: brand.slogan ? `${brand.name} — ${brand.slogan}` : brand.name,
      url: typeof window !== "undefined" ? window.location.href : "",
    };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // Fallback para cópia
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(window.location.href);
        setCopiedShare(true);
        setTimeout(() => setCopiedShare(false), 2500);
      } catch {
        // fallback
      }
    }
  };

  const deliveryMode =
    brand.tipoTaxaEntrega || ((brand.tabelaTaxasBairros?.length ?? 0) > 0 ? "bairro" : "fixa");
  const neighborhoods = brand.tabelaTaxasBairros ?? [];
  const distanceConfig = brand.tabelaTaxasKm?.[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm animate-fade-in sm:items-stretch sm:justify-start"
      id="store-info-overlay"
      onClick={onClose}
    >
      <div
        className="koma-art-store-sheet relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[32px] border border-white/10 bg-[#06110d] text-koma-foreground shadow-2xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:rounded-r-[32px] sm:border-r animate-slide-right"
        id="store-info-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Informações do restaurante"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Banner com Identidade Atmosférica */}
        <div className="relative min-h-48 shrink-0 overflow-hidden bg-[#040a07]">
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
            className="koma-art-glass-btn absolute right-3.5 top-3.5 !w-10 !h-10 cursor-pointer"
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
              <h2 className="truncate font-serif text-xl font-black tracking-tight text-white">
                {brand.name}
              </h2>
              {brand.slogan && (
                <p className="mt-0.5 line-clamp-1 text-[11px] leading-relaxed text-white/75">
                  {brand.slogan}
                </p>
              )}
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-white/90 backdrop-blur-md">
                <span
                  className={`h-2 w-2 rounded-full ${
                    brand.storeStatus === "open"
                      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                      : brand.storeStatus === "closed"
                        ? "bg-rose-400"
                        : "bg-amber-400"
                  }`}
                />
                <span>{statusLabel}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Lista Editorial Limpa (Sem Caixas Aninhadas Excessivas) */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 no-scrollbar divide-y divide-white/10 space-y-4">
          {/* Seção 1: Entrega & Retirada */}
          <section className="pt-1 first:pt-0" aria-labelledby="store-info-delivery-heading">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-emerald-400 shrink-0" />
              <h3
                id="store-info-delivery-heading"
                className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-400"
              >
                Entrega e retirada
              </h3>
            </div>
            <div className="mt-2 space-y-1.5 text-xs">
              {brand.deliveryEnabled === false ? (
                <p className="text-gray-300">
                  Entrega pausada no momento. Pedidos disponíveis para retirada no balcão.
                </p>
              ) : (
                <>
                  <p className="font-semibold text-white">
                    {Number.isFinite(brand.taxaEntregaPadrao)
                      ? `Taxa padrão estimada: ${money(brand.taxaEntregaPadrao!)}`
                      : "Taxa de entrega calculada na sacola conforme seu endereço."}
                  </p>
                  {(brand.pedidoMinimo ?? 0) > 0 && (
                    <p className="text-gray-300">
                      Pedido mínimo: <strong>{money(brand.pedidoMinimo!)}</strong>
                    </p>
                  )}
                  {(brand.freteGratisValor ?? 0) > 0 && (
                    <p className="text-emerald-400 font-semibold">
                      Frete grátis a partir de {money(brand.freteGratisValor!)}
                    </p>
                  )}
                  {deliveryMode === "bairro" && neighborhoods.length > 0 && (
                    <div className="mt-2.5 rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
                      <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1.5">
                        Taxas por bairro atendido
                      </span>
                      <div className="max-h-32 overflow-y-auto space-y-1 pr-1 text-[11px]">
                        {neighborhoods.map((n, i) => (
                          <div key={i} className="flex justify-between text-gray-300">
                            <span>{n.bairro}</span>
                            <span className="font-bold font-mono text-white">
                              {n.taxa === 0 ? "Grátis" : money(n.taxa)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* Seção 2: Localização e Retirada */}
          {(brand.address || brand.googleMapsUrl) && (
            <section className="pt-4" aria-labelledby="store-info-location-heading">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-emerald-400 shrink-0" />
                <h3
                  id="store-info-location-heading"
                  className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-400"
                >
                  Localização e retirada
                </h3>
              </div>
              <div className="mt-2 text-xs text-gray-200">
                {brand.address && (
                  <div className="flex items-start gap-2">
                    <Store className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">{brand.address}</p>
                  </div>
                )}
                {brand.googleMapsUrl && (
                  <a
                    href={brand.googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
                    id="btn-google-maps-link"
                  >
                    <span>Abrir rota no Google Maps</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </section>
          )}

          {/* Seção 3: Horários de Funcionamento */}
          {brand.operatingHours && brand.operatingHours.length > 0 && (
            <section className="pt-4" aria-labelledby="store-info-hours-heading">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-emerald-400 shrink-0" />
                <h3
                  id="store-info-hours-heading"
                  className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-400"
                >
                  Horários de atendimento
                </h3>
              </div>
              <div className="mt-2.5 divide-y divide-white/5 text-xs">
                {brand.operatingHours.map((row, index) => (
                  <div key={index} className="flex items-center justify-between py-1.5">
                    <span className="text-gray-300">{row.days}</span>
                    <strong className="font-mono text-white text-[11px]">{row.hours}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Seção 4: Formas de Pagamento */}
          {brand.paymentMethods && brand.paymentMethods.length > 0 && (
            <section className="pt-4" aria-labelledby="store-info-payment-heading">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-emerald-400 shrink-0" />
                <h3
                  id="store-info-payment-heading"
                  className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-400"
                >
                  Formas de pagamento aceitas
                </h3>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {brand.paymentMethods.map((method) => (
                  <span
                    key={method.type}
                    className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-300"
                  >
                    {method.type}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Seção 5: Canais de Contato & Redes Sociais */}
          <section className="pt-4" aria-labelledby="store-info-channels-heading">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-emerald-400 shrink-0" />
              <h3
                id="store-info-channels-heading"
                className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-400"
              >
                Canais e contato
              </h3>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {brand.phone && (
                <a
                  href={`https://wa.me/${String(brand.phone).replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  id="store-info-whatsapp-link"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition cursor-pointer"
                >
                  <Phone className="h-3.5 w-3.5" /> WhatsApp
                </a>
              )}
              {brand.socials
                ?.filter((s) => s.active)
                .map((social) => (
                  <a
                    key={`${social.platform}-${social.url}`}
                    href={social.url}
                    target="_blank"
                    rel="noreferrer"
                    id={`store-info-social-${social.platform.toLowerCase()}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-white/90 hover:border-white/25 hover:text-white transition cursor-pointer"
                  >
                    {social.platform.toLowerCase() === "instagram" ? (
                      <KomaSocialCameraIcon size={14} />
                    ) : (
                      <ExternalLink className="h-3 w-3 text-white/60" />
                    )}
                    <span>{social.platform}</span>
                  </a>
                ))}
              <button
                type="button"
                onClick={handleShare}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-white/90 hover:border-white/25 hover:text-white transition cursor-pointer"
                id="store-info-share-btn"
                title="Compartilhar cardápio"
              >
                {copiedShare ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Link copiado!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="h-3.5 w-3.5 text-white/70" />
                    <span>Compartilhar</span>
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Seção 6: Sobre o Restaurante (se houver) */}
          {brand.about && (
            <section className="pt-4" aria-labelledby="store-info-about-heading">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-emerald-400 shrink-0" />
                <h3
                  id="store-info-about-heading"
                  className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-400"
                >
                  Sobre nós
                </h3>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-gray-300">{brand.about}</p>
            </section>
          )}
        </div>

        {/* Rodapé com Fechamento e Atribuição KÔMA */}
        <div className="shrink-0 border-t border-white/10 bg-black/60 backdrop-blur-md p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] space-y-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 w-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-5 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-emerald-950/40 hover:from-emerald-400 hover:to-teal-400 active:scale-[0.99] transition cursor-pointer"
          >
            Voltar ao cardápio
          </button>
          <div className="flex items-center justify-center">
            <a
              href={buildKomaAttributionUrl("store_info", brand.id)}
              target="_blank"
              rel="noopener noreferrer"
              id="store-info-koma-attribution"
              aria-label="Conhecer o KÔMA, plataforma deste cardápio digital"
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 text-[10px] font-semibold text-gray-400 transition hover:border-emerald-500/35 hover:text-emerald-400"
            >
              <span>
                Cardápio digital por <strong className="font-black text-white">KÔMA</strong>
              </span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
