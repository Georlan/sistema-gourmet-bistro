import React, { useEffect } from "react";
import { ArrowUpRight, Sparkles, X } from "lucide-react";
import { KOMA_WORDMARK_ON_DARK_SRC } from "../../brand/komaBrand";
import type { MenuThemeMode } from "../theme/komaMenuTheme";
import {
  KomaBrandPaletteAsset,
  KomaSpeedAsset,
  KomaSyncOpsAsset,
} from "./KomaVisualAssets";

interface MenuKomaPlatformModalProps {
  open: boolean;
  onClose: () => void;
  attributionUrl: string;
  themeMode: MenuThemeMode;
}

const VALUE_CHIPS = ["0% comissão por pedido", "Marca própria", "Caixa + Impressão"];

const HIGHLIGHTS = [
  {
    Asset: KomaSpeedAsset,
    title: "Cardápio feito para converter",
    desc: "Carregamento instantâneo no celular, busca direta e montagem de pedido sem atrito.",
  },
  {
    Asset: KomaBrandPaletteAsset,
    title: "Sua identidade em primeiro plano",
    desc: "Cores adaptativas, fotos em destaque, promoções da casa e link próprio para divulgar.",
  },
  {
    Asset: KomaSyncOpsAsset,
    title: "Operação completa integrada",
    desc: "Pedidos direto no Caixa, Garçom, Delivery e Impressão térmica sem retrabalho.",
  },
];

export default function MenuKomaPlatformModal({
  open,
  onClose,
  attributionUrl,
}: MenuKomaPlatformModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="km-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Conheça a plataforma KÔMA"
      onClick={onClose}
    >
      <div className="km-platform-modal" onClick={(e) => e.stopPropagation()}>
        <div className="km-platform-modal__hero">
          <div className="km-platform-modal__top">
            <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" className="km-platform-modal__wordmark" />
            <button
              type="button"
              className="km-platform-modal__close"
              onClick={onClose}
              aria-label="Fechar janela"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <span className="km-platform-modal__eyebrow">
            <Sparkles size={13} aria-hidden="true" />
            Plataforma para restaurantes
          </span>
          <h2 className="km-platform-modal__title">
            Um cardápio digital com a cara da sua marca — feito para vender mais
          </h2>
          <p className="km-platform-modal__sub">
            Receba pedidos direto do cliente, sem pagar comissão por venda, com operação integrada do balcão à entrega.
          </p>
          <div className="km-platform-modal__chips">
            {VALUE_CHIPS.map((chip) => (
              <span key={chip} className="km-platform-modal__chip">
                {chip}
              </span>
            ))}
          </div>
        </div>

        <div className="km-platform-modal__list">
          {HIGHLIGHTS.map((item) => {
            const Asset = item.Asset;
            return (
              <div key={item.title} className="km-platform-modal__item">
                <Asset className="w-10 h-10 shrink-0" />
                <div>
                  <strong className="km-platform-modal__item-title">{item.title}</strong>
                  <p className="km-platform-modal__item-desc">{item.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="km-platform-modal__actions">
          <a
            href={attributionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="km-platform-modal__cta"
          >
            <span>Quero conhecer o KÔMA</span>
            <ArrowUpRight size={17} aria-hidden="true" />
          </a>
          <p className="km-platform-modal__footnote">
            Ideal para delivery, balcão, marmitaria, pizzaria e atendimento em mesas.
          </p>
        </div>
      </div>
    </div>
  );
}
