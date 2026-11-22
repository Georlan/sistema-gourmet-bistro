/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
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
import { getRestaurantMapsUrl } from "../getRestaurantMapsUrl";
import { KomaSocialCameraIcon } from "./KomaPublicIcons";
import { buildWhatsAppContactUrl } from "../../config/whatsappUtils";

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
  const copiedShareTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copiedShareTimerRef.current !== null) {
      window.clearTimeout(copiedShareTimerRef.current);
    }
  }, []);

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
        if (copiedShareTimerRef.current !== null) {
          window.clearTimeout(copiedShareTimerRef.current);
        }
        copiedShareTimerRef.current = window.setTimeout(() => {
          copiedShareTimerRef.current = null;
          setCopiedShare(false);
        }, 2500);
      } catch {
        // fallback
      }
    }
  };

  const deliveryMode =
    brand.tipoTaxaEntrega || ((brand.tabelaTaxasBairros?.length ?? 0) > 0 ? "bairro" : "fixa");
  const neighborhoods = brand.tabelaTaxasBairros ?? [];
  const mapsUrl = getRestaurantMapsUrl(brand.googleMapsUrl);
  const distanceConfig = brand.tabelaTaxasKm?.[0];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center animate-fade-in sm:items-stretch sm:justify-start"
      style={{ backgroundColor: "var(--km-overlay)" }}
      id="store-info-overlay"
      onClick={onClose}
    >
      <div
        className="koma-art-store-sheet relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[32px] border border-[var(--km-line)] shadow-2xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:rounded-r-[32px] sm:border-r animate-slide-right"
        style={{ backgroundColor: "var(--km-dialog)", color: "var(--km-ink)" }}
        id="store-info-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Informações do restaurante"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Banner com Identidade Atmosférica */}
        <div
          className="relative min-h-48 shrink-0 overflow-hidden"
          style={{ backgroundColor: "var(--km-header-deep)", color: "var(--km-header-ink)" }}
        >
          {brand.bannerImage ? (
            <img
              src={brand.bannerImage}
              alt={brand.name}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background: "linear-gradient(135deg, var(--km-header-deep) 0%, var(--km-art-field) 100%)",
              }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent" />

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
            <div
              id="store-info-brand-avatar"
              className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-white/20 bg-black/25 shadow-xl"
            >
              <img src={brand.logo} alt={brand.name} className="block h-full w-full object-contain object-center" />
            </div>
            <div className="min-w-0 pb-0.5">
              <h2
                className="truncate font-serif text-xl font-black tracking-tight"
                style={{ color: "var(--km-header-ink)" }}
              >
                {brand.name}
              </h2>
              {brand.slogan && (
                <p
                  className="mt-0.5 line-clamp-1 text-[11px] leading-relaxed opacity-80"
                  style={{ color: "var(--km-header-ink)" }}
                >
                  {brand.slogan}
                </p>
              )}
              <span
                className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-2.5 py-0.5 text-[11px] font-bold"
                style={{ color: "var(--km-header-ink)" }}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    brand.storeStatus === "open"
                      ? "bg-[var(--km-accent)]"
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
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 no-scrollbar divide-y divide-[var(--km-line-subtle)] space-y-4">
          {/* Seção 1: Entrega & Retirada */}
          <section className="pt-1 first:pt-0" aria-labelledby="store-info-delivery-heading">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-[var(--km-accent-text)] shrink-0" />
              <h3
                id="store-info-delivery-heading"
                className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--km-accent-text)]"
              >
                Entrega e retirada
              </h3>
            </div>
            <div className="mt-2 space-y-1.5 text-xs">
              {brand.deliveryEnabled === false ? (
                <p className="text-[var(--km-ink-2)]">
                  A entrega está pausada no momento. Pedidos disponíveis apenas para retirada.
                </p>
              ) : deliveryMode === "distancia" ? (
                <>
                  <p className="font-semibold text-[var(--km-ink)]">
                    {distanceConfig && Number.isFinite(Number(distanceConfig.taxa_minima))
                      ? `Taxa de entrega a partir de ${money(Number(distanceConfig.taxa_minima))}`
                      : "Taxa de entrega calculada conforme seu endereço na sacola."}
                  </p>
                  {(brand.pedidoMinimo ?? 0) > 0 && (
                    <p className="text-[var(--km-ink-2)]">
                      Pedido mínimo: <strong className="text-[var(--km-ink)]">{money(brand.pedidoMinimo!)}</strong>
                    </p>
                  )}
                  {(brand.freteGratisValor ?? 0) > 0 && (
                    <p className="text-[var(--km-accent-text)] font-semibold">
                      Frete grátis a partir de {money(brand.freteGratisValor!)}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="font-semibold text-[var(--km-ink)]">
                    {Number.isFinite(brand.taxaEntregaPadrao)
                      ? `Taxa padrão estimada: ${money(brand.taxaEntregaPadrao!)}`
                      : "Consulte a taxa de entrega na sacola conforme seu endereço."}
                  </p>
                  {(brand.pedidoMinimo ?? 0) > 0 && (
                    <p className="text-[var(--km-ink-2)]">
                      Pedido mínimo: <strong className="text-[var(--km-ink)]">{money(brand.pedidoMinimo!)}</strong>
                    </p>
                  )}
                  {(brand.freteGratisValor ?? 0) > 0 && (
                    <p className="text-[var(--km-accent-text)] font-semibold">
                      Frete grátis a partir de {money(brand.freteGratisValor!)}
                    </p>
                  )}
                  {deliveryMode === "bairro" && neighborhoods.length > 0 && (
                    <div className="mt-2.5 rounded-xl border border-[var(--km-line)] bg-[var(--km-card)] p-2.5">
                      <span className="text-[10px] uppercase font-bold text-[var(--km-muted)] block mb-1.5">
                        Taxas por bairro atendido
                      </span>
                      <div className="max-h-32 overflow-y-auto space-y-1 pr-1 text-[11px]">
                        {neighborhoods.map((n, i) => (
                          <div key={i} className="flex items-start justify-between gap-2 text-[var(--km-ink-2)]">
                            <span className="break-words min-w-0">{n.bairro}</span>
                            <span className="shrink-0 font-bold font-mono text-[var(--km-ink)]">
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
                <MapPin className="h-4 w-4 text-[var(--km-accent-text)] shrink-0" />
                <h3
                  id="store-info-location-heading"
                  className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--km-accent-text)]"
                >
                  Localização e retirada
                </h3>
              </div>
              <div className="mt-2 text-xs text-[var(--km-ink-2)]">
                {brand.address && (
                  <div className="flex items-start gap-2">
                    <Store className="h-4 w-4 text-[var(--km-accent-text)] shrink-0 mt-0.5" />
                    <p className="leading-relaxed">{brand.address}</p>
                  </div>
                )}
                {mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-bold text-[var(--km-accent-text)] hover:opacity-80 transition"
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
                <Clock3 className="h-4 w-4 text-[var(--km-accent-text)] shrink-0" />
                <h3
                  id="store-info-hours-heading"
                  className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--km-accent-text)]"
                >
                  Horários de atendimento
                </h3>
              </div>
              <div className="mt-2.5 divide-y divide-[var(--km-line-subtle)] text-xs">
                {brand.operatingHours.map((row, index) => (
                  <div key={index} className="flex items-center justify-between py-1.5">
                    <span className="text-[var(--km-muted)]">{row.days}</span>
                    <strong className="font-mono text-[var(--km-ink)] text-[11px]">{row.hours}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Seção 4: Formas de Pagamento */}
          {brand.paymentMethods && brand.paymentMethods.length > 0 && (
            <section className="pt-4" aria-labelledby="store-info-payment-heading">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-[var(--km-accent-text)] shrink-0" />
                <h3
                  id="store-info-payment-heading"
                  className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--km-accent-text)]"
                >
                  Formas de pagamento aceitas
                </h3>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {brand.paymentMethods.map((method) => (
                  <span
                    key={method.type}
                    className="rounded-full border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] px-3 py-1 text-[11px] font-bold text-[var(--km-accent-text)]"
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
              <MessageCircle className="h-4 w-4 text-[var(--km-accent-text)] shrink-0" />
              <h3
                id="store-info-channels-heading"
                className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--km-accent-text)]"
              >
                Canais e contato
              </h3>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {buildWhatsAppContactUrl(brand.phone) && (
                <a
                  href={buildWhatsAppContactUrl(brand.phone)}
                  target="_blank"
                  rel="noreferrer"
                  id="store-info-whatsapp-link"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] px-3.5 text-xs font-bold text-[var(--km-accent-text)] hover:opacity-90 transition cursor-pointer"
                >
                  <Phone className="h-3.5 w-3.5" /> WhatsApp
                </a>
              )}
              {brand.socials
                ?.filter((s) => s.active && !(s.platform.toLowerCase() === "whatsapp" && buildWhatsAppContactUrl(brand.phone)))
                .map((social) => (
                  <a
                    key={`${social.platform}-${social.url}`}
                    href={social.url}
                    target="_blank"
                    rel="noreferrer"
                    id={`store-info-social-${social.platform.toLowerCase()}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--km-line)] bg-[var(--km-raised)] px-3.5 text-xs font-semibold text-[var(--km-ink)] hover:border-[var(--km-line-strong)] transition cursor-pointer"
                  >
                    {social.platform.toLowerCase() === "instagram" ? (
                      <KomaSocialCameraIcon size={14} />
                    ) : (
                      <ExternalLink className="h-3 w-3 text-[var(--km-muted)]" />
                    )}
                    <span>{social.platform}</span>
                  </a>
                ))}
              <button
                type="button"
                onClick={handleShare}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--km-line)] bg-[var(--km-raised)] px-3.5 text-xs font-semibold text-[var(--km-ink)] hover:border-[var(--km-line-strong)] transition cursor-pointer"
                id="store-info-share-btn"
                title="Compartilhar cardápio"
              >
                {copiedShare ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[var(--km-accent-text)]" />
                    <span className="text-[var(--km-accent-text)]">Link copiado!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="h-3.5 w-3.5 text-[var(--km-muted)]" />
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
                <Info className="h-4 w-4 text-[var(--km-accent-text)] shrink-0" />
                <h3
                  id="store-info-about-heading"
                  className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--km-accent-text)]"
                >
                  Sobre nós
                </h3>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--km-ink-2)]">{brand.about}</p>
            </section>
          )}
        </div>

        {/* Rodapé com Fechamento e Atribuição KÔMA */}
        <div className="shrink-0 border-t border-[var(--km-line-subtle)] bg-[var(--km-panel)] p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] space-y-3">
          <button
            type="button"
            onClick={onClose}
            className="mt-4 min-h-11 w-full rounded-full bg-[var(--km-accent)] px-5 text-xs font-black uppercase tracking-wider text-[var(--km-on-accent)] transition hover:opacity-90 active:scale-[0.99] cursor-pointer"
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
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--km-line)] bg-[var(--km-raised)] px-3.5 text-[10px] font-semibold text-[var(--km-muted)] transition hover:border-[var(--km-accent-border)] hover:text-[var(--km-accent-text)]"
            >
              <span>
                Cardápio digital por <strong className="font-black text-[var(--km-ink)]">KÔMA</strong>
              </span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
