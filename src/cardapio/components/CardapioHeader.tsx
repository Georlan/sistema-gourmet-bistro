/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { BrandConfig, LOCAL_LOGO_PLACEHOLDER } from "../CardapioTypes";
import { Search, User, MapPin, Phone, ShoppingBag, Instagram, Facebook, Globe, Share2, Sun, Moon } from "lucide-react";

interface CardapioHeaderProps {
  activeBrand: BrandConfig;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  user: any;
  onAuthClick: () => void;
  onLogoClick: () => void; // Click to open the StoreInfoDrawer
  onCartToggle: () => void;
  cartCount: number;
}

const getSocialIcon = (platform: string) => {
  switch (platform.toLowerCase()) {
    case "instagram":
      return <Instagram className="h-3.5 w-3.5" />;
    case "facebook":
      return <Facebook className="h-3.5 w-3.5" />;
    case "tiktok":
      return (
        <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
          <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.17-2.86-.6-4.06-1.45-.01 2.42-.02 4.83-.04 7.25-.03 1.96-.53 3.93-1.65 5.51-1.12 1.58-2.82 2.73-4.7 3.18-1.88.45-3.91.31-5.71-.4-1.8-.71-3.32-2.12-4.22-3.83-1.02-1.92-1.25-4.24-.65-6.34.6-2.1 2.1-3.97 4.09-4.88 1.48-.68 3.12-.91 4.73-.67V11c-1.08-.24-2.24-.12-3.23.36-1 .48-1.78 1.37-2.11 2.44-.33 1.07-.18 2.27.41 3.2.59.93 1.59 1.58 2.69 1.77 1.1.19 2.26-.07 3.11-.79.85-.72 1.31-1.84 1.31-2.95-.02-3.19-.01-6.38-.02-9.57.02-.13.04-.26.06-.39.02-.27.05-.54.08-.81.01-.11.02-.21.03-.32z"/>
        </svg>
      );
    default:
      return <Globe className="h-3.5 w-3.5" />;
  }
};

export default function CardapioHeader({
  activeBrand,
  searchQuery,
  setSearchQuery,
  user,
  onAuthClick,
  onLogoClick,
  onCartToggle,
  cartCount
}: CardapioHeaderProps) {
  const [showToast, setShowToast] = useState(false);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof localStorage !== 'undefined') {
      return (localStorage.getItem('@koma:theme') as 'dark' | 'light') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    const handleStorageChange = () => {
      const stored = localStorage.getItem('@koma:theme') as 'dark' | 'light';
      if (stored && ['dark', 'light'].includes(stored)) {
        setTheme(stored);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('koma_theme_changed', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('koma_theme_changed', handleStorageChange);
    };
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('@koma:theme', newTheme);
    setTheme(newTheme);
    window.dispatchEvent(new Event('koma_theme_changed'));
  };

  const handleShare = async () => {
    const shareData = {
      title: activeBrand.name,
      text: `${activeBrand.name} - ${activeBrand.slogan}`,
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.warn("Compartilhamento nativo cancelado ou falhou:", err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(window.location.href);
        setShowToast(true);
        setTimeout(() => setShowToast(false), 2500);
      } catch (err) {
        console.error("Falha ao copiar link:", err);
      }
    }
  };

  return (
    <>
      <header className="w-full border-b border-slate-500/10 bg-card-app relative z-40 shadow-xs animate-fade-in" id="app-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          
          {/* Logo and Brand Info (Clickable for StoreInfoDrawer) */}
          <div 
            onClick={onLogoClick}
            className="flex items-center gap-3.5 cursor-pointer group hover:opacity-95 transition-all"
            title="Clique para ver informações completas sobre nós"
            id="header-brand-info-trigger"
          >
            <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center text-koma-foreground font-bold text-2xl shadow-xs overflow-hidden shrink-0 border border-slate-500/10 group-hover:scale-105 group-hover:border-primary transition duration-300">
              <img
                src={activeBrand.logo}
                alt={activeBrand.name}
                className="w-full h-full object-cover"
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  const target = e.currentTarget;
                  target.onerror = null;
                  target.src = LOCAL_LOGO_PLACEHOLDER;
                }}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-display font-extrabold text-base sm:text-lg tracking-tight text-text-app block leading-tight group-hover:text-primary transition-colors">
                  {activeBrand.name}
                </span>
              </div>
              <span className="text-xs text-text-app/50 font-medium block truncate mt-0.5">
                {activeBrand.slogan}
              </span>
            </div>
          </div>
          
          {/* Quick Contacts & Social Networks (Visible on larger screens) */}
          <div className="hidden md:flex flex-col text-xs text-text-app/60 gap-1 shrink-0" id="header-contacts-panel">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="truncate max-w-[240px] font-medium text-text-app/80">{activeBrand.address}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="font-bold text-text-app/95">{activeBrand.phone}</span>
            </div>

            {/* Social Networks Row */}
            {activeBrand.socials && activeBrand.socials.some((s) => s.active) && (
              <div className="flex items-center gap-1.5 mt-0.5" id="header-social-networks">
                {activeBrand.socials
                  .filter((s) => s.active)
                  .map((s, idx) => (
                    <a
                      key={idx}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-500/10 bg-slate-500/5 text-text-app/60 hover:text-white hover:border-transparent transition-all duration-200"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = activeBrand.colors.primary;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '';
                      }}
                      title={`Visitar nosso ${s.platform}`}
                    >
                      {getSocialIcon(s.platform)}
                    </a>
                  ))}
              </div>
            )}
          </div>

          {/* Action Navigation Controls */}
          <div className="flex items-center gap-2 sm:gap-3 self-end sm:self-auto">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center h-9 w-9 rounded-xl border border-slate-500/10 hover:bg-slate-500/10 text-text-app/80 hover:text-primary transition cursor-pointer shrink-0"
              title="Alternar Tema"
            >
              {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>

            {/* Share Button */}
            <button
              onClick={handleShare}
              className="flex items-center justify-center h-9 w-9 rounded-xl border border-slate-500/10 hover:bg-slate-500/10 text-text-app/80 hover:text-primary transition cursor-pointer shrink-0"
              title="Compartilhar Cardápio"
              id="btn-share-header"
            >
              <Share2 className="h-4 w-4" />
            </button>

            {/* Shopping Cart Button */}
            <button
              onClick={onCartToggle}
              className="relative flex items-center justify-center h-9 w-9 rounded-xl border border-slate-500/10 hover:bg-slate-500/10 text-text-app/80 hover:text-primary transition cursor-pointer shrink-0"
              title="Sua Sacola"
              id="btn-cart-header"
            >
              <ShoppingBag className="h-4.5 w-4.5" />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-koma-foreground shadow-xs">
                  {cartCount}
                </span>
              )}
            </button>

            {/* User Account Login/Logout Button */}
            {user ? (
              <button
                onClick={onAuthClick}
                className="flex items-center gap-2 h-9 px-3.5 rounded-xl border border-slate-500/10 hover:bg-slate-500/10 text-xs font-bold text-text-app/80 transition cursor-pointer"
                id="btn-user-profile"
                title={`Olá, ${user.name}! Clique para Sair`}
              >
                <User className="h-4 w-4 text-text-app/50" />
                <span className="truncate max-w-[80px]">{user.name.split(" ")[0]}</span>
              </button>
            ) : (
              <button
                onClick={onAuthClick}
                className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-primary text-koma-foreground hover:opacity-90 text-xs font-black transition shadow-xs cursor-pointer"
                id="btn-login-trigger"
              >
                <User className="h-4 w-4" />
                <span>Entrar</span>
              </button>
            )}
          </div>

        </div>

        {/* Search Bar & Address details row (Visible on mobile/tablet) */}
        <div className="mt-4 flex flex-col md:flex-row md:items-center gap-3" id="search-address-row">
          
          {/* Quick search input */}
          <div className="flex-1 relative" id="search-bar-wrapper">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
              <Search className="h-4 w-4 text-text-app/40" />
            </div>
            <input
              type="text"
              placeholder="O que você deseja comer hoje?"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-500/10 bg-slate-500/5 py-2.5 pl-10 pr-4 text-xs text-text-app outline-hidden focus:border-primary focus:bg-card-app focus:ring-1 focus:ring-primary/25 transition"
              id="input-search"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3.5 top-2.5 text-xs font-semibold text-text-app/40 hover:text-text-app/60 cursor-pointer"
              >
                Limpar
              </button>
            )}
          </div>

          {/* Quick address on smaller viewports with active socials */}
          <div className="flex md:hidden flex-col gap-2 p-2.5 rounded-xl border border-slate-500/10 bg-slate-500/5" id="mobile-address-socials">
            <div className="flex items-center gap-1.5 text-text-app/50 text-[11px]">
              <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="truncate">{activeBrand.address}</span>
            </div>
            {activeBrand.socials && activeBrand.socials.some(s => s.active) && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-500/10 pt-2" id="mobile-social-networks">
                <span className="text-[9px] font-extrabold text-text-app/40 uppercase tracking-wider mr-1">Social:</span>
                {activeBrand.socials
                  .filter((s) => s.active)
                  .map((s, idx) => (
                    <a
                      key={idx}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-6.5 w-6.5 items-center justify-center rounded-full border border-slate-500/10 bg-card-app text-text-app/40 hover:text-white transition duration-200"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = activeBrand.colors.primary;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '';
                      }}
                    >
                      {getSocialIcon(s.platform)}
                    </a>
                  ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </header>

    {showToast && (
      <div className="fixed bottom-4 right-4 z-50 bg-emerald-500 text-white text-xs font-bold px-4 py-3 rounded-xl shadow-lg border border-emerald-400 animate-slide-up flex items-center gap-2">
        <span>✓ Link copiado para a área de transferência!</span>
      </div>
    )}
  </>
);
}
