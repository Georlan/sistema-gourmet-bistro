import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { ArrowUpRight, ChevronRight, Instagram, Moon, Phone, Share2, Sun, Tag, X } from "lucide-react";
import {
  CatalogPromotion,
  LOCAL_LOGO_PLACEHOLDER,
  LOCAL_PRODUCT_PLACEHOLDER,
  Product,
} from "../CardapioTypes";
import type { CardapioArtisticExperienceProps } from "../components/CardapioArtisticExperience";
import { useActivePromotions } from "../useActivePromotions";
import { groupCategoryProductsForDisplay, type CatalogDisplayItem } from "../catalogGrouping";
import { getFulfillmentAvailability } from "../fulfillment";
import { buildWhatsAppContactUrl } from "../../config/whatsappUtils";
import { buildKomaAttributionUrl } from "../komaAttribution";
import { customerOrderLabel, orderFulfillmentLabel } from "../orderTracking";
import {
  buildMenuThemeTokens,
  KOMA_DEFAULT_BRAND_HEX,
  type MenuThemeMode,
} from "../theme/komaMenuTheme";
import { readDevBrandColorOverride } from "../devSimulation";
import { toSafeCategoryDomId } from "../categoryDomId";
import { KOMA_WORDMARK_ON_DARK_SRC } from "../../brand/komaBrand";
import { useKomaThemeTransition } from "../../components/shared/useKomaThemeTransition";
import "../../components/shared/komaThemeTransition.css";
import {
  MenuBagGlyph,
  MenuCategoriesGlyph,
  MenuPromoArcBackdrop,
  MenuSearchGlyph,
  MenuTopWaveBackdrop,
} from "./MenuSvgAssets";
import { KOMA_SPRING_BUBBLE, KOMA_SPRING_NAV } from "./motionTokens";
import MenuBottomDock from "./MenuBottomDock";
import MenuProductCard, { formatMenuPrice } from "./MenuProductCard";
import MenuSearchOverlay from "./MenuSearchOverlay";
import MenuKomaPlatformModal from "./MenuKomaPlatformModal";
import "./komaMenu.css";

function readInitialThemeMode(): MenuThemeMode {
  if (typeof window === "undefined") return "dark";
  const params = new URLSearchParams(window.location.search);
  const urlTheme = params.get("tema");
  if (urlTheme === "light" || urlTheme === "dark") return urlTheme;
  const stored = window.localStorage.getItem("koma_menu_theme_mode");
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

export default function MenuV2Experience({
  activeBrand,
  searchQuery,
  setSearchQuery,
  selectedCategory,
  onSelectCategory,
  onSelectProduct,
  onFastAdd,
  onFastRemove,
  getProductCartQuantity,
  onCartToggle,
  cartCount,
  cartTotal = 0,
  onStoreInfoClick,
  onOrdersClick,
  activeOrdersCount = 0,
  hasOpenOverlay = false,
  onPromotionSelect,
  user,
  onAuthClick,
  activeOrder,
  activeState,
  onPayPixClick,
  activeDockTab = "home",
  onDockNavigate,
}: CardapioArtisticExperienceProps) {
  const [themeMode, setThemeMode] = useState<MenuThemeMode>(readInitialThemeMode);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCategorySheetOpen, setIsCategorySheetOpen] = useState(false);
  const [isPlatformModalOpen, setIsPlatformModalOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const themeTransition = useKomaThemeTransition(false);

  const brandColorHex =
    readDevBrandColorOverride() || activeBrand.colors?.primary || KOMA_DEFAULT_BRAND_HEX;
  const themeTokens = useMemo(
    () => buildMenuThemeTokens(brandColorHex, themeMode),
    [brandColorHex, themeMode],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.setAttribute("data-koma-theme", themeMode);
    for (const [key, value] of Object.entries(themeTokens.vars)) {
      root.style.setProperty(key, value);
    }
    root.style.setProperty("--koma-surface-page", themeTokens.vars["--km-page"]);
    root.style.setProperty("--koma-surface-canvas", themeTokens.vars["--km-canvas"]);
    root.style.setProperty("--koma-surface-shell", themeTokens.vars["--km-shell"]);
    root.style.setProperty("--koma-surface-panel", themeTokens.vars["--km-panel"]);
    root.style.setProperty("--koma-surface-card", themeTokens.vars["--km-card"]);
    root.style.setProperty("--koma-surface-raised", themeTokens.vars["--km-raised"]);
    root.style.setProperty("--koma-surface-input", themeTokens.vars["--km-input"]);
    root.style.setProperty("--koma-surface-dialog", themeTokens.vars["--km-dialog"]);
    root.style.setProperty("--koma-text-primary", themeTokens.vars["--km-ink"]);
    root.style.setProperty("--koma-text-secondary", themeTokens.vars["--km-ink-2"]);
    root.style.setProperty("--koma-text-muted", themeTokens.vars["--km-muted"]);
    root.style.setProperty("--koma-text-subtle", themeTokens.vars["--km-subtle"]);
    root.style.setProperty("--koma-border-default", themeTokens.vars["--km-line"]);
    root.style.setProperty("--koma-border-subtle", themeTokens.vars["--km-line-subtle"]);
    root.style.setProperty("--koma-border-strong", themeTokens.vars["--km-line-strong"]);
    root.style.setProperty("--koma-action-bg", themeTokens.vars["--km-accent"]);
    root.style.setProperty("--koma-action-hover", themeTokens.vars["--km-accent-hover"]);
    root.style.setProperty("--koma-action-text", themeTokens.vars["--km-on-accent"]);
    root.style.setProperty("--koma-accent", themeTokens.vars["--km-accent"]);
    root.style.setProperty("--koma-accent-text", themeTokens.vars["--km-accent-text"]);
    root.style.setProperty("--koma-accent-soft", themeTokens.vars["--km-accent-soft"]);
    root.style.setProperty("--koma-accent-border", themeTokens.vars["--km-accent-border"]);
    root.style.setProperty("--menu-surface", themeTokens.vars["--km-dialog"]);
    root.style.setProperty("--menu-surface-soft", themeTokens.vars["--km-surface-soft"]);
    root.style.setProperty("--menu-text", themeTokens.vars["--km-ink"]);
    root.style.setProperty("--menu-muted", themeTokens.vars["--km-ink-2"]);
    root.style.setProperty("--menu-border", themeTokens.vars["--km-line"]);
    root.style.setProperty("--color-brand-text", themeTokens.vars["--km-ink"]);
    root.style.setProperty("--color-brand-card", themeTokens.vars["--km-dialog"]);
    document.body.style.backgroundColor = themeTokens.vars["--km-page"];
    window.localStorage.setItem("koma_menu_theme_mode", themeMode);
  }, [themeMode, themeTokens]);

  const handleToggleTheme = (e: React.MouseEvent<HTMLButtonElement>) => {
    themeTransition.change(e.currentTarget, () => {
      setThemeMode((prev) => (prev === "dark" ? "light" : "dark"));
    });
  };

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: activeBrand.name, url });
        return;
      } catch {
        // Fallback below
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  }, [activeBrand.name]);

  const activePromotions = useActivePromotions(activeBrand.promotions);
  const fulfillment = useMemo(() => getFulfillmentAvailability(activeBrand), [activeBrand]);

  const highlightProducts = useMemo(() => {
    const popularSet = new Set(activeBrand.popularProductIds || []);
    return activeBrand.products.filter(
      (p) =>
        p.isAvailable !== false &&
        (p.destaque || p.id === activeBrand.manualHighlightProductId || popularSet.has(p.id)),
    );
  }, [activeBrand]);

  const groupedCategories = useMemo(() => {
    return activeBrand.categories
      .map((category) => {
        const rawProducts = activeBrand.products.filter((p) => p.category === category);
        const items = groupCategoryProductsForDisplay(category, rawProducts, activeBrand.id);
        return { category, items };
      })
      .filter((entry) => entry.items.length > 0);
  }, [activeBrand.categories, activeBrand.products, activeBrand.id]);

  const [visibleCategory, setVisibleCategory] = useState<string>(selectedCategory || "");
  const catTrackRef = useRef<HTMLDivElement>(null);
  const catBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const isManualScrollRef = useRef(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const sections = groupedCategories
      .map((c) => ({
        category: c.category,
        el: document.getElementById(`km-cat-${toSafeCategoryDomId(c.category)}`),
      }))
      .filter((item): item is { category: string; el: HTMLElement } => Boolean(item.el));

    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isManualScrollRef.current) return;
        const intersecting = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (intersecting.length > 0) {
          const cat = intersecting[0].target.getAttribute("data-category") || "";
          setVisibleCategory(cat);
        }
      },
      { rootMargin: "-90px 0px -65% 0px", threshold: 0 },
    );

    sections.forEach((s) => observer.observe(s.el));
    return () => observer.disconnect();
  }, [groupedCategories]);

  useEffect(() => {
    const track = catTrackRef.current;
    const btn = catBtnRefs.current.get(visibleCategory);
    if (!track || !btn) return;
    track.scrollTo({
      left: btn.offsetLeft - track.clientWidth / 2 + btn.clientWidth / 2,
      behavior: "smooth",
    });
  }, [visibleCategory]);

  const handleSelectCat = useCallback(
    (category: string) => {
      isManualScrollRef.current = true;
      setVisibleCategory(category);
      onSelectCategory(category);
      window.requestAnimationFrame(() => {
        const targetId = category ? `km-cat-${toSafeCategoryDomId(category)}` : "km-highlights";
        const el = document.getElementById(targetId) || document.getElementById("km-top");
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      window.setTimeout(() => {
        isManualScrollRef.current = false;
      }, 650);
    },
    [onSelectCategory],
  );

  const whatsappUrl = useMemo(() => {
    const socialWa = activeBrand.socials?.find(
      (s) => s.active && s.platform.toLowerCase() === "whatsapp" && s.url,
    )?.url;
    if (socialWa) return socialWa;
    return activeBrand.phone ? buildWhatsAppContactUrl(activeBrand.phone) : null;
  }, [activeBrand.socials, activeBrand.phone]);

  const instagramUrl = useMemo(() => {
    return activeBrand.socials?.find(
      (s) => s.active && s.platform.toLowerCase() === "instagram" && s.url,
    )?.url;
  }, [activeBrand.socials]);

  const isOpen = activeBrand.acceptingOrders !== false;
  const minOrderAmount = Number(activeBrand.pedidoMinimo || 0);
  const minOrderLabel = minOrderAmount > 0 ? `Mín. ${formatMenuPrice(minOrderAmount)}` : null;

  const fulfillmentParts: string[] = [isOpen ? "Aberto" : "Fechado"];
  if (fulfillment.delivery) fulfillmentParts.push("Entrega");
  if (fulfillment.pickup) fulfillmentParts.push("Retirada");
  if (minOrderLabel) fulfillmentParts.push(minOrderLabel);

  const attributionUrl = useMemo(
    () => buildKomaAttributionUrl("menu_footer", activeBrand.id),
    [activeBrand.id],
  );

  return (
    <MotionConfig reducedMotion="user">
    <div
      className="km-root"
      id="km-top"
      data-koma-theme={themeMode}
      style={themeTokens.vars as React.CSSProperties}
    >
      {/* Full-Bleed Integrated Organic Wave Hero */}
      <header className="km-hero-header">
        <div className="km-hero-wave-wrap">
          {activeBrand.bannerImage ? (
            <>
              <img
                src={activeBrand.bannerImage}
                alt={`${activeBrand.name} — capa`}
                className="km-hero-banner-bg"
                decoding="async"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <div className="km-hero-banner-scrim" aria-hidden="true" />
              <svg
                viewBox="0 0 440 44"
                preserveAspectRatio="none"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="km-hero-wave-cutout"
                aria-hidden="true"
              >
                <path
                  d="M0 18C72 44 148 36 220 20C292 4 368 -2 440 24V44H0V18Z"
                  fill="var(--km-page)"
                />
              </svg>
            </>
          ) : (
            <MenuTopWaveBackdrop className="km-hero-wave-svg" />
          )}

          <div className="km-hero-topbar">
            <button
              type="button"
              className="km-hero-koma-link"
              onClick={() => setIsPlatformModalOpen(true)}
              aria-label="Cardápio por KÔMA — conheça a plataforma"
              title="Conheça a plataforma KÔMA"
            >
              <span className="km-hero-koma-link__prefix">por</span>
              <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" />
              <ArrowUpRight size={13} className="km-hero-koma-link__arrow" aria-hidden="true" />
            </button>

            <div className="km-hero-actions">
              <button
                type="button"
                className="km-wave-btn"
                onClick={handleToggleTheme}
                aria-label={themeMode === "dark" ? "Mudar para modo claro" : "Mudar para modo escuro"}
                title={themeMode === "dark" ? "Modo claro" : "Modo escuro"}
              >
                {themeMode === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
              </button>

              <button
                type="button"
                className="km-wave-btn"
                onClick={handleShare}
                aria-label={linkCopied ? "Link copiado" : "Compartilhar cardápio"}
                title={linkCopied ? "Link copiado" : "Compartilhar"}
              >
                <Share2 size={18} aria-hidden="true" />
              </button>

              <button
                type="button"
                className="km-wave-btn km-desktop-only-btn"
                onClick={onOrdersClick}
                aria-label="Ver pedidos"
                title="Pedidos"
              >
                <span className="text-xs font-bold">Pedidos</span>
                {activeOrdersCount > 0 && <span className="km-wave-btn__badge">{activeOrdersCount}</span>}
              </button>

              <button
                type="button"
                className="km-wave-btn km-desktop-only-btn"
                onClick={onCartToggle}
                aria-label={`Abrir sacola, ${cartCount} ${cartCount === 1 ? "item" : "itens"}`}
                title="Sacola"
              >
                <MenuBagGlyph className="w-[18px] h-[18px]" />
                {cartCount > 0 && <span className="km-wave-btn__badge">{cartCount}</span>}
              </button>

              <button
                type="button"
                className="km-wave-btn km-desktop-only-btn"
                onClick={onAuthClick}
                aria-label="Minha conta"
                title="Conta"
              >
                <span className="text-xs font-bold">{user?.name ? user.name.split(" ")[0] : "Conta"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Open-Canvas Compact Store Identity */}
        <div className="km-store-identity">
          <div className="km-store-identity__row">
            <button
              type="button"
              className="km-store-avatar-btn"
              onClick={onStoreInfoClick}
              aria-label={`Abrir opções e informações de ${activeBrand.name}`}
              title="Opções da loja"
            >
              <img
                src={activeBrand.logo || LOCAL_LOGO_PLACEHOLDER}
                alt={activeBrand.name}
                className="km-store-avatar"
                onError={(e) => {
                  e.currentTarget.src = LOCAL_LOGO_PLACEHOLDER;
                }}
              />
            </button>

            <div className="km-store-identity__copy">
              <h1 className="km-store-name">{activeBrand.name}</h1>
              <div className="km-store-meta-row">
                <span className="km-status-inline km-tabular">
                  <span className={`km-status-dot ${isOpen ? "" : "km-status-dot--closed"}`} aria-hidden="true" />
                  <span>{fulfillmentParts.join(" · ")}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="km-store-actions-row">
            <button type="button" className="km-fees-link" onClick={onStoreInfoClick}>
              <span>Taxas de entrega e horários</span>
              <ChevronRight size={14} aria-hidden="true" />
            </button>

            {(whatsappUrl || instagramUrl) && (
              <div className="km-store-socials">
                {whatsappUrl && (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="km-soft-icon-btn"
                    aria-label="WhatsApp da loja"
                  >
                    <Phone size={17} aria-hidden="true" />
                  </a>
                )}
                {instagramUrl && (
                  <a
                    href={instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="km-soft-icon-btn"
                    aria-label="Instagram da loja"
                  >
                    <Instagram size={17} aria-hidden="true" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="km-container">
        {/* Airy Search Bar */}
        <button
          type="button"
          className="km-search-bar"
          onClick={() => setIsSearchOpen(true)}
          aria-label="Buscar prato, bebida ou ingrediente"
        >
          <MenuSearchGlyph className="w-[18px] h-[18px]" />
          <span>Buscar prato, bebida ou ingrediente...</span>
        </button>

        {/* Active Order Banner */}
        {activeOrder && activeState && (
          <section className="km-order-banner" aria-label="Pedido em andamento">
            <div>
              <div className="km-order-banner__eyebrow">
                {activeOrder.numero_pedido ? `Pedido #${activeOrder.numero_pedido}` : "Acompanhamento"}
              </div>
              <div className="km-order-banner__title km-tabular">
                {customerOrderLabel(activeState)} · {orderFulfillmentLabel(activeState.fulfillment)}
              </div>
              {activeOrder.total > 0 && (
                <div className="km-order-banner__desc km-tabular">
                  Total: {formatMenuPrice(activeOrder.total)}
                </div>
              )}
            </div>
            {activeOrder.pagamento?.status === "pendente" && onPayPixClick ? (
              <button type="button" className="km-pill-cta" onClick={() => onPayPixClick(activeOrder)}>
                Pagar Pix
              </button>
            ) : (
              onOrdersClick && (
                <button type="button" className="km-pill-cta" onClick={onOrdersClick}>
                  Ver pedido
                </button>
              )
            )}
          </section>
        )}

        {/* Sticky Category Underline Tabs + Quick Sheet */}
        <nav className="km-sticky-nav" aria-label="Categorias do cardápio">
          <div className="km-cat-tabs" ref={catTrackRef}>
            <button
              type="button"
              ref={(el) => {
                if (el) catBtnRefs.current.set("", el);
                else catBtnRefs.current.delete("");
              }}
              className={`km-cat-tab ${visibleCategory === "" ? "is-active" : ""}`}
              onClick={() => handleSelectCat("")}
            >
              Destaques
              {visibleCategory === "" && (
                <motion.span
                  layoutId="km-cat-active-bar"
                  className="km-cat-tab__bar"
                  transition={KOMA_SPRING_NAV}
                />
              )}
            </button>

            {groupedCategories.map(({ category }) => {
              const isActive = visibleCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  ref={(el) => {
                    if (el) catBtnRefs.current.set(category, el);
                    else catBtnRefs.current.delete(category);
                  }}
                  className={`km-cat-tab ${isActive ? "is-active" : ""}`}
                  onClick={() => handleSelectCat(category)}
                >
                  {category}
                  {isActive && (
                    <motion.span
                      layoutId="km-cat-active-bar"
                      className="km-cat-tab__bar"
                      transition={KOMA_SPRING_NAV}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="km-nav-tools">
            <button
              type="button"
              className="km-icon-btn"
              onClick={() => setIsCategorySheetOpen(true)}
              aria-label="Ver todas as categorias"
              title="Todas as categorias"
            >
              <MenuCategoriesGlyph className="w-[18px] h-[18px]" />
            </button>

            <button
              type="button"
              className="km-icon-btn"
              onClick={() => setIsSearchOpen(true)}
              aria-label="Buscar no cardápio"
            >
              <MenuSearchGlyph className="w-[18px] h-[18px]" />
            </button>
          </div>
        </nav>

        {/* Curved Promo Showcase (Tag OUTSIDE image!) */}
        {activePromotions.length > 0 && (
          <section className="km-promo-showcase" id="km-highlights">
            <MenuPromoArcBackdrop className="km-promo-arc-svg" />
            <div className="km-promo-showcase__inner">
              <div className="km-section__head">
                <h2 className="km-promo-showcase__title">Promoções da Casa</h2>
                <span className="km-promo-showcase__count">{activePromotions.length} ofertas</span>
              </div>

              <div className="km-carousel">
                {activePromotions.map((promo: CatalogPromotion) => (
                  <button
                    key={promo.id}
                    type="button"
                    className="km-promo-card"
                    onClick={() => onPromotionSelect?.(promo)}
                  >
                    <span className="km-promo-tag">
                      <Tag size={11} aria-hidden="true" />
                      {promo.tipo === "compre_ganhe" ? "Compre e ganhe" : "Oferta especial"}
                    </span>

                    <div className="km-promo-card__media">
                      <img
                        src={promo.imagem_url || LOCAL_PRODUCT_PLACEHOLDER}
                        alt={promo.nome}
                        loading="eager"
                        fetchPriority="high"
                        decoding="async"
                        onError={(e) => {
                          e.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
                        }}
                      />
                    </div>

                    <h3 className="km-promo-card__title">{promo.nome}</h3>
                    {promo.descricao && <p className="km-promo-card__desc">{promo.descricao}</p>}

                    <div className="km-promo-card__footer">
                      <span className="km-price">{formatMenuPrice(promo.preco)}</span>
                      <span className="km-cta-mini">Aproveitar</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Destaques 2-Column Editorial Grid */}
        {highlightProducts.length > 0 && (
          <section
            className="km-section"
            id={activePromotions.length === 0 ? "km-highlights" : undefined}
          >
            <div className="km-section__head">
              <h2 className="km-section__title">Destaques</h2>
              <span className="km-section__count">{highlightProducts.length} itens</span>
            </div>

            <div className="km-highlight-grid">
              {highlightProducts.slice(0, 4).map((product) => (
                <MenuProductCard
                  key={`hl-${product.id}`}
                  product={product}
                  variant="highlight"
                  cartQuantity={getProductCartQuantity(product.id)}
                  onSelectProduct={onSelectProduct as any}
                  onFastAdd={onFastAdd as any}
                  onFastRemove={onFastRemove as any}
                />
              ))}
            </div>
          </section>
        )}

        {/* Category Product Sections */}
        {groupedCategories.map(({ category, items }, catIndex) => (
          <section
            key={category}
            className={`km-section ${catIndex >= 2 ? "km-section--deferred" : ""}`}
            id={`km-cat-${toSafeCategoryDomId(category)}`}
            data-category={category}
          >
            <div className="km-section__head">
              <h2 className="km-section__title">
                <span className="km-section__accent" aria-hidden="true" />
                {category}
              </h2>
              <span className="km-section__count">
                {items.length} {items.length === 1 ? "opção" : "opções"}
              </span>
            </div>

            <div className="km-product-grid">
              {items.map((item: CatalogDisplayItem, itemIndex) => (
                <MenuProductCard
                  key={item.id}
                  product={item as any}
                  variant="row"
                  priority={catIndex === 0 && itemIndex < 6}
                  cartQuantity={getProductCartQuantity(item.id)}
                  onSelectProduct={onSelectProduct as any}
                  onFastAdd={onFastAdd as any}
                  onFastRemove={onFastRemove as any}
                />
              ))}
            </div>
          </section>
        ))}

        {/* Footer + Official KÔMA Attribution Card (opens Interactive Modal) */}
        <footer className="km-footer">
          <span className="km-footer-note">
            {activeBrand.name} · Preços e disponibilidade atualizados pelo restaurante.
          </span>

          <button
            type="button"
            className="km-koma-cta-card"
            onClick={() => setIsPlatformModalOpen(true)}
          >
            <span className="km-koma-cta-card__left">
              <span className="km-koma-cta-card__brand-row">
                <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" className="km-koma-cta-card__wordmark" />
                <span className="km-koma-cta-card__badge">Sem comissão</span>
              </span>
              <span className="km-koma-cta-card__title">Quer um cardápio assim no seu restaurante?</span>
              <span className="km-koma-cta-card__sub">
                Cardápio digital, Caixa, Garçom e Impressão integrados em um só lugar.
              </span>
            </span>
            <span className="km-koma-cta-card__pill">
              <span>Conhecer</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </span>
          </button>
        </footer>
      </main>

      {/* Redundant Floating Bag Feedback Pill above Dock when browsing Home */}
      <AnimatePresence>
        {!hasOpenOverlay && activeDockTab === "home" && cartCount > 0 && (
          <div className="km-bag-fab-wrap">
            <motion.button
              type="button"
              className="km-bag-fab"
              initial={{ opacity: 0, y: 14, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.94 }}
              whileTap={{ scale: 0.96 }}
              transition={KOMA_SPRING_BUBBLE}
              onClick={() => {
                if (onDockNavigate) {
                  onDockNavigate("bag");
                } else {
                  onCartToggle();
                }
              }}
              aria-label={`Ver sacola com ${cartCount} ${cartCount === 1 ? "item" : "itens"}`}
            >
              <span className="km-bag-fab__icon" aria-hidden="true">
                <MenuBagGlyph className="w-4 h-4" />
                <span className="km-bag-fab__badge km-tabular">
                  <NumberFlow value={cartCount} />
                </span>
              </span>
              <span className="km-bag-fab__label">Ver sacola</span>
              <span className="km-bag-fab__dot" aria-hidden="true">·</span>
              <span className="km-bag-fab__total km-tabular">
                <NumberFlow
                  value={cartTotal}
                  format={{ style: "currency", currency: "BRL" }}
                  locales="pt-BR"
                />
              </span>
            </motion.button>
          </div>
        )}
      </AnimatePresence>

      {/* Physics-Driven Floating Mobile Dock */}
      <MenuBottomDock
        activeTab={activeDockTab}
        cartCount={cartCount}
        cartTotal={cartTotal}
        activeOrdersCount={activeOrdersCount}
        userFirstName={user?.name ? user.name.split(" ")[0] : null}
        onNavigate={(tab) => {
          if (onDockNavigate) {
            onDockNavigate(tab);
          } else if (tab === "orders") {
            onOrdersClick?.();
          } else if (tab === "bag") {
            onCartToggle();
          } else if (tab === "account") {
            onAuthClick?.();
          }
          if (tab === "home") {
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        }}
      />

      {/* Category Bottom Sheet */}
      {isCategorySheetOpen && (
        <div
          className="km-sheet-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Selecionar categoria"
          onClick={() => setIsCategorySheetOpen(false)}
        >
          <div className="km-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="km-sheet__head">
              <h2 className="km-sheet__title">Categorias do cardápio</h2>
              <button
                type="button"
                className="km-icon-btn"
                onClick={() => setIsCategorySheetOpen(false)}
                aria-label="Fechar categorias"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="km-sheet__list">
              <button
                type="button"
                className={`km-sheet__item ${visibleCategory === "" ? "is-active" : ""}`}
                onClick={() => {
                  setIsCategorySheetOpen(false);
                  handleSelectCat("");
                }}
              >
                <span>Destaques e Promoções</span>
                <span className="km-sheet__count">Topo</span>
              </button>
              {groupedCategories.map(({ category, items }) => (
                <button
                  key={`sheet-${category}`}
                  type="button"
                  className={`km-sheet__item ${visibleCategory === category ? "is-active" : ""}`}
                  onClick={() => {
                    setIsCategorySheetOpen(false);
                    handleSelectCat(category);
                  }}
                >
                  <span>{category}</span>
                  <span className="km-sheet__count">
                    {items.length} {items.length === 1 ? "opção" : "opções"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Search Overlay */}
      <MenuSearchOverlay
        open={isSearchOpen}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        onClose={() => setIsSearchOpen(false)}
        products={activeBrand.products}
        getProductCartQuantity={getProductCartQuantity}
        onSelectProduct={onSelectProduct as any}
        onFastAdd={onFastAdd as any}
        onFastRemove={onFastRemove as any}
      />

      {/* Interactive KÔMA Platform Modal */}
      <MenuKomaPlatformModal
        open={isPlatformModalOpen}
        onClose={() => setIsPlatformModalOpen(false)}
        attributionUrl={attributionUrl}
        themeMode={themeMode}
      />
    </div>
    </MotionConfig>
  );
}
