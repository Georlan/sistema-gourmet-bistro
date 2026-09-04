/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import {
  Facebook,
  Globe,
  Info,
  Instagram,
  MapPin,
  Package,
  Phone,
  Search,
  Share2,
  ShoppingBag,
  UserRound,
} from "lucide-react";
import { BrandConfig, LOCAL_LOGO_PLACEHOLDER } from "../CardapioTypes";
import "../cardapioPublic.css";

interface CardapioHeaderProps {
  activeBrand: BrandConfig;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  user: any;
  onAuthClick: () => void;
  onLogoClick: () => void;
  onCartToggle: () => void;
  cartCount: number;
  onOrdersClick?: () => void;
  ordersCount?: number;
  activeOrdersCount?: number;
}

const getSocialIcon = (platform: string) => {
  switch (platform.toLocaleLowerCase("pt-BR")) {
    case "instagram":
      return <Instagram size={15} />;
    case "facebook":
      return <Facebook size={15} />;
    default:
      return <Globe size={15} />;
  }
};

const getBackgroundTone = (hexColor: string): "dark" | "light" => {
  const normalized = /^#[0-9a-f]{6}$/i.test(hexColor) ? hexColor.slice(1) : "090a0f";
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const linearize = (value: number) => value <= 0.03928
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
  const luminance = 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
  return luminance < 0.42 ? "dark" : "light";
};

export default function CardapioHeader({
  activeBrand,
  searchQuery,
  setSearchQuery,
  user,
  onAuthClick,
  onLogoClick,
  onCartToggle,
  cartCount,
  onOrdersClick,
  ordersCount = 0,
  activeOrdersCount = 0,
}: CardapioHeaderProps) {
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.cardapioTone = getBackgroundTone(activeBrand.colors.background);
    return () => {
      delete root.dataset.cardapioTone;
    };
  }, [activeBrand.colors.background]);

  const handleShare = async () => {
    const shareData = {
      title: activeBrand.name,
      text: activeBrand.slogan ? `${activeBrand.name} — ${activeBrand.slogan}` : activeBrand.name,
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2200);
    } catch {
      // O endereço continua disponível na barra do navegador.
    }
  };

  const statusLabel = activeBrand.storeStatus === "open"
    ? "Aberto para pedidos"
    : activeBrand.storeStatus === "closed"
      ? activeBrand.availabilitySource === "schedule" ? "Fora do horário" : "Pedidos pausados"
      : "Ver horários";

  return (
    <>
      <header className="cardapio-public-header" id="app-header">
        <div className="cardapio-public-header__shell">
          <div className="cardapio-public-header__topline">
            <button
              type="button"
              onClick={onLogoClick}
              className="cardapio-public-brand"
              id="header-brand-info-trigger"
              title="Ver informações do restaurante"
            >
              <img
                src={activeBrand.logo}
                alt={activeBrand.name}
                className="cardapio-public-brand__logo"
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                onError={(event) => {
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = LOCAL_LOGO_PLACEHOLDER;
                }}
              />
              <span className="cardapio-public-brand__copy">
                <strong>{activeBrand.name}</strong>
                <small>{activeBrand.slogan || "Peça direto pelo cardápio"}</small>
              </span>
            </button>

            <div className="cardapio-public-header__context" aria-label="Informações rápidas">
              {activeBrand.address && (
                <button type="button" onClick={onLogoClick} className="cardapio-public-context-chip">
                  <MapPin size={13} />
                  <span>{activeBrand.address}</span>
                </button>
              )}
              <button type="button" onClick={onLogoClick} className={`cardapio-public-status is-${activeBrand.storeStatus || "automatic"}`}>
                <i aria-hidden="true" />
                {statusLabel}
              </button>
            </div>

            <div className="cardapio-public-actions">
              <button
                type="button"
                onClick={onLogoClick}
                className="cardapio-public-icon-button"
                title="Informações do restaurante"
                aria-label="Informações do restaurante"
              >
                <Info size={16} />
              </button>
              <button
                type="button"
                onClick={handleShare}
                className="cardapio-public-icon-button"
                title="Compartilhar cardápio"
                aria-label="Compartilhar cardápio"
                id="btn-share-header"
              >
                <Share2 size={16} />
              </button>
              {ordersCount > 0 && onOrdersClick && (
                <button
                  type="button"
                  onClick={onOrdersClick}
                  className="cardapio-public-icon-button is-orders relative"
                  title="Meus Pedidos"
                  aria-label={`Meus Pedidos${activeOrdersCount > 0 ? `, ${activeOrdersCount} em andamento` : ""}`}
                  id="btn-my-orders-header"
                >
                  <Package size={17} />
                  {activeOrdersCount > 0 && <span>{activeOrdersCount > 99 ? "99+" : activeOrdersCount}</span>}
                </button>
              )}
              <button
                type="button"
                onClick={onCartToggle}
                className="cardapio-public-icon-button is-cart"
                title="Sua sacola"
                aria-label={`Sua sacola, ${cartCount} ${cartCount === 1 ? "item" : "itens"}`}
                id="btn-cart-header"
              >
                <ShoppingBag size={17} />
                {cartCount > 0 && <span>{cartCount > 99 ? "99+" : cartCount}</span>}
              </button>
              <button
                type="button"
                onClick={onAuthClick}
                className="cardapio-public-account-button"
                id={user ? "btn-user-profile" : "btn-login-trigger"}
              >
                <UserRound size={15} />
                <span>{user ? user.name?.split(" ")[0] || "Perfil" : "Identificar"}</span>
              </button>
            </div>
          </div>

          <div className="cardapio-public-header__searchrow" id="search-address-row">
            <label className="cardapio-public-search" id="search-bar-wrapper">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                placeholder="O que você quer pedir?"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                id="input-search"
                autoComplete="off"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery("")} aria-label="Limpar busca">
                  Limpar
                </button>
              )}
            </label>

            <div className="cardapio-public-contact-actions">
              {activeBrand.phone && (
                <a
                  href={`https://wa.me/${activeBrand.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="cardapio-public-contact-link"
                >
                  <Phone size={14} /> WhatsApp
                </a>
              )}
              {activeBrand.socials?.filter((social) => social.active).slice(0, 2).map((social) => (
                <a
                  key={`${social.platform}-${social.url}`}
                  href={social.url}
                  target="_blank"
                  rel="noreferrer"
                  className="cardapio-public-social-link"
                  title={social.platform}
                  aria-label={social.platform}
                >
                  {getSocialIcon(social.platform)}
                </a>
              ))}
            </div>
          </div>
        </div>
      </header>

      {linkCopied && (
        <div className="cardapio-public-toast" role="status">
          Link do cardápio copiado
        </div>
      )}
    </>
  );
}
