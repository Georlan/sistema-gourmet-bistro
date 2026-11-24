import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import {
  ArrowUpRight,
  Bike,
  ChevronRight,
  Clock3,
  Gift,
  Instagram,
  Minus,
  Moon,
  Phone,
  Plus,
  ReceiptText,
  Share2,
  Store,
  Sun,
  UtensilsCrossed,
  X,
} from "lucide-react";
import {
  BrandConfig,
  CatalogPromotion,
  LOCAL_BANNER_PLACEHOLDER,
  LOCAL_LOGO_PLACEHOLDER,
  Product,
} from "../CardapioTypes";
import type { CustomerProfile } from "../customerSession";
import { API_BASE_URL } from "../../config/api";
import { useActivePromotions } from "../useActivePromotions";
import { fetchPopularProducts } from "../popularProductsClient";
import {
  buildPublicCatalogSections,
  isGroupedProduct,
  type CatalogDisplayItem,
} from "../catalogGrouping";
import { resolveCatalogDisplayProduct } from "../resolvePairingDisplay";
import { getCatalogDisplayEffectivePrice } from "../cartPricing";
import { getCatalogHighlights } from "../catalogHighlights";
import { getFulfillmentAvailability } from "../fulfillment";
import { buildWhatsAppContactUrl } from "../../config/whatsappUtils";
import { buildKomaAttributionUrl } from "../komaAttribution";
import {
  customerOrderLabel,
  orderFulfillmentLabel,
  type OrderStateContract,
  type StoredOrder,
} from "../orderTracking";
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
import CatalogProductImage from "../components/CatalogProductImage";
import {
  MenuBagGlyph,
  MenuCategoriesGlyph,
  MenuSearchGlyph,
  MenuTopWaveBackdrop,
} from "./MenuSvgAssets";
import { KOMA_SPRING_BUBBLE, KOMA_SPRING_NAV } from "./motionTokens";
import MenuActiveOrderCard from "./MenuActiveOrderCard";
import MenuBottomDock from "./MenuBottomDock";
import MenuProductCard, { formatMenuPrice } from "./MenuProductCard";
import MenuPromotionsShowcase from "./MenuPromotionsShowcase";
import MenuSearchOverlay from "./MenuSearchOverlay";
import MenuKomaPlatformModal from "./MenuKomaPlatformModal";
import "./komaMenu.css";

export interface MenuV2ExperienceProps {
  activeBrand: BrandConfig;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  onSelectProduct: (product: Product | CatalogDisplayItem) => void;
  onFastAdd: (product: Product, event?: React.MouseEvent) => void;
  onFastRemove: (product: Product, event?: React.MouseEvent) => void;
  getProductCartQuantity: (productId: string) => number;
  onCartToggle: () => void;
  cartCount: number;
  cartTotal?: number;
  onStoreInfoClick: () => void;
  onOrdersClick?: () => void;
  activeOrdersCount?: number;
  hasOpenOverlay?: boolean;
  dockHidden?: boolean;
  onPromotionSelect?: (promotion: CatalogPromotion) => void;
  user?: CustomerProfile | null;
  onAuthClick?: () => void;
  onBenefitsClick?: () => void;
  activeOrder?: StoredOrder | null;
  activeState?: OrderStateContract | null;
  storedOrders?: StoredOrder[];
  storedOrdersCount?: number;
  onSelectOrderId?: (id: string) => void;
  onPayPixClick?: (order: StoredOrder) => void;
  onRefreshOrders?: () => void;
  isRefreshingOrders?: boolean;
  onClearTrackedOrder?: (orderId: string) => void;
  orderingMessage?: string;
  onNotify?: (message: string) => void;
  activeDockTab?: "home" | "orders" | "bag" | "account";
  onDockNavigate?: (tab: "home" | "orders" | "bag" | "account") => void;
}

function readInitialThemeMode(): MenuThemeMode {
  if (typeof window === "undefined") return "dark";
  const params = new URLSearchParams(window.location?.search || "");
  const urlTheme = params.get("tema");
  if (urlTheme === "light" || urlTheme === "dark") return urlTheme;
  try {
    const stored = typeof window.localStorage?.getItem === "function"
      ? window.localStorage.getItem("koma_menu_theme_mode")
      : null;
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Ignore storage access errors in restricted contexts
  }
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
  dockHidden,
  onPromotionSelect,
  user,
  onAuthClick,
  onBenefitsClick,
  activeOrder,
  activeState,
  storedOrders = [],
  onSelectOrderId,
  onPayPixClick,
  onRefreshOrders,
  isRefreshingOrders = false,
  onClearTrackedOrder,
  orderingMessage,
  onNotify,
  activeDockTab = "home",
  onDockNavigate,
}: MenuV2ExperienceProps) {
  const [themeMode, setThemeMode] = useState<MenuThemeMode>(readInitialThemeMode);
  const [popularIds, setPopularIds] = useState<string[]>(() => activeBrand.popularProductIds || []);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCategorySheetOpen, setIsCategorySheetOpen] = useState(false);
  const [isPlatformModalOpen, setIsPlatformModalOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [bannerFailed, setBannerFailed] = useState(false);
  const linkCopiedTimerRef = useRef<number | null>(null);
  const manualScrollTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (linkCopiedTimerRef.current !== null) window.clearTimeout(linkCopiedTimerRef.current);
    if (manualScrollTimerRef.current !== null) window.clearTimeout(manualScrollTimerRef.current);
  }, []);

  useEffect(() => {
    setBannerFailed(false);
  }, [activeBrand.bannerImage]);

  const themeTransition = useKomaThemeTransition(false);

  const brandColorHex =
    readDevBrandColorOverride() || activeBrand.colors?.primary || KOMA_DEFAULT_BRAND_HEX;
  const themeTokens = useMemo(
    () => buildMenuThemeTokens(brandColorHex, themeMode),
    [brandColorHex, themeMode],
  );

  useEffect(() => {
    let cancelled = false;
    if (!activeBrand.id) return;
    setPopularIds(activeBrand.popularProductIds || []);
    void fetchPopularProducts({
      apiBaseUrl: API_BASE_URL,
      slug: activeBrand.slug,
      restaurantId: activeBrand.id,
    })
      .then((ids) => {
        if (!cancelled && Array.isArray(ids) && ids.length > 0) {
          setPopularIds(ids);
        }
      })
      .catch(() => {
        // Fallback to activeBrand.popularProductIds / catalog
      });
    return () => {
      cancelled = true;
    };
  }, [activeBrand.id, activeBrand.slug, activeBrand.popularProductIds]);

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
    document.body.style.color = themeTokens.vars["--km-ink"];
    try {
      if (typeof window.localStorage?.setItem === "function") {
        window.localStorage.setItem("koma_menu_theme_mode", themeMode);
      }
    } catch {
      // Ignore storage access errors
    }
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
      onNotify?.("Link do cardápio copiado!");
      if (linkCopiedTimerRef.current !== null) window.clearTimeout(linkCopiedTimerRef.current);
      linkCopiedTimerRef.current = window.setTimeout(() => {
        linkCopiedTimerRef.current = null;
        setLinkCopied(false);
      }, 2000);
    } catch {
      // Ignore clipboard failure
    }
  }, [activeBrand.name, onNotify]);

  const activePromotions = useActivePromotions(activeBrand.promotions);
  const fulfillment = useMemo(() => getFulfillmentAvailability(activeBrand), [activeBrand]);

  const effectivePopularIds = useMemo(
    () => (popularIds.length > 0 ? popularIds : (activeBrand.popularProductIds || [])),
    [popularIds, activeBrand.popularProductIds],
  );

  const heroProduct = useMemo<CatalogDisplayItem | null>(() => {
    const catalog = activeBrand.products || [];
    if (catalog.length === 0) return null;
    const manual = activeBrand.manualHighlightProductId
      ? catalog.find((p) => String(p.id) === activeBrand.manualHighlightProductId && p.isAvailable !== false)
      : null;
    const top = effectivePopularIds.length > 0
      ? catalog.find((p) => String(p.id) === String(effectivePopularIds[0]) && p.isAvailable !== false)
      : null;
    const fallbackFirst = catalog.find((p) => p.isAvailable !== false) || null;
    const source = manual || top || fallbackFirst;
    return source ? resolveCatalogDisplayProduct(catalog, source, activeBrand.id) : null;
  }, [activeBrand.products, activeBrand.id, activeBrand.manualHighlightProductId, effectivePopularIds]);

  const isManualHero = Boolean(
    heroProduct &&
    activeBrand.manualHighlightProductId &&
    activeBrand.products.some(
      (p) => String(p.id) === activeBrand.manualHighlightProductId && p.isAvailable !== false,
    ) &&
    (isGroupedProduct(heroProduct)
      ? heroProduct.variants.some((v) => String(v.id) === activeBrand.manualHighlightProductId)
      : String(heroProduct.id) === activeBrand.manualHighlightProductId),
  );

  const isVerifiedTopRanked = Boolean(
    !isManualHero &&
    effectivePopularIds.length > 0 &&
    heroProduct &&
    (isGroupedProduct(heroProduct)
      ? heroProduct.variants.some((v) => String(v.id) === String(effectivePopularIds[0]))
      : String(effectivePopularIds[0]) === String(heroProduct.id)),
  );

  const highlightProducts = useMemo(() => {
    const available = (activeBrand.products || []).filter((p) => p.isAvailable !== false);
    const byId = new Map(available.map((p) => [String(p.id), p]));
    const ordered: Product[] = [];
    const seen = new Set<string>();
    const pushUnique = (product?: Product | null) => {
      if (!product || seen.has(product.id)) return;
      seen.add(product.id);
      ordered.push(product);
    };

    if (activeBrand.manualHighlightProductId) {
      pushUnique(byId.get(String(activeBrand.manualHighlightProductId)));
    }
    for (const id of effectivePopularIds) {
      pushUnique(byId.get(String(id)));
    }
    for (const product of getCatalogHighlights(available)) {
      pushUnique(product);
    }
    for (const product of available) {
      if (product.destaque) pushUnique(product);
    }
    return ordered;
  }, [activeBrand.products, activeBrand.manualHighlightProductId, effectivePopularIds]);

  const promotionCatalogProducts = useMemo(
    () => [...(activeBrand.products || []), ...(activeBrand.promotionProducts || [])],
    [activeBrand.products, activeBrand.promotionProducts],
  );

  const getDisplayItemCartQty = useCallback(
    (item: CatalogDisplayItem) =>
      isGroupedProduct(item)
        ? item.variants.reduce((acc, variant) => acc + getProductCartQuantity(variant.id), 0)
        : getProductCartQuantity(item.id),
    [getProductCartQuantity],
  );

  const groupedCategories = useMemo(
    () => buildPublicCatalogSections(
      activeBrand.categories, activeBrand.products, activeBrand.id, searchQuery,
    ),
    [activeBrand.categories, activeBrand.products, activeBrand.id, searchQuery],
  );

  const [visibleCategory, setVisibleCategory] = useState<string>(selectedCategory || "");
  const catTrackRef = useRef<HTMLDivElement>(null);
  const catBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const isManualScrollRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let rafId = 0;

    const updateActiveCategory = () => {
      rafId = 0;
      if (isManualScrollRef.current) return;
      if (groupedCategories.length === 0) return;

      const triggerTop = 165;
      let nextCategory = "";
      // The last matching section is authoritative; stop as soon as it is found.
      for (let index = groupedCategories.length - 1; index >= 0; index--) {
        const { category } = groupedCategories[index];
        const el = document.getElementById(`km-cat-${toSafeCategoryDomId(category)}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= triggerTop) {
          nextCategory = category;
          break;
        }
      }
      setVisibleCategory((prev) => (prev === nextCategory ? prev : nextCategory));
    };

    const handleScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(updateActiveCategory);
    };

    updateActiveCategory();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [groupedCategories]);

  useEffect(() => {
    const track = catTrackRef.current;
    const btn = catBtnRefs.current.get(visibleCategory);
    if (!track || !btn) return;
    track.scrollTo({
      left: Math.max(0, btn.offsetLeft - track.clientWidth / 2 + btn.clientWidth / 2),
      behavior: "auto",
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
      if (manualScrollTimerRef.current !== null) window.clearTimeout(manualScrollTimerRef.current);
      manualScrollTimerRef.current = window.setTimeout(() => {
        manualScrollTimerRef.current = null;
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
  const minOrderAmount = fulfillment.delivery ? Number(activeBrand.pedidoMinimo || 0) : 0;
  const storeModalities: Array<{ key: "delivery" | "pickup" | "dine_in"; label: string }> = [];
  if (fulfillment.delivery) {
    storeModalities.push({ key: "delivery", label: "Entrega" });
    if (fulfillment.pickup) storeModalities.push({ key: "pickup", label: "Retirada" });
  } else if (fulfillment.pickup) {
    storeModalities.push({ key: "pickup", label: "Somente retirada" });
  }
  if (fulfillment.dine_in) {
    storeModalities.push({ key: "dine_in", label: "Consumo local" });
  }

  const attributionUrl = useMemo(
    () => buildKomaAttributionUrl("menu_footer", activeBrand.id),
    [activeBrand.id],
  );

  const showBanner = Boolean(
    activeBrand.hasCustomBanner
    && activeBrand.bannerImage
    && activeBrand.bannerImage !== LOCAL_BANNER_PLACEHOLDER
    && !bannerFailed,
  );

  return (
    <MotionConfig reducedMotion="user">
    <div
      className={`km-root${cartCount > 0 && !hasOpenOverlay ? " km-root--with-bag" : ""}`}
      id="koma-artistic-canvas"
      data-koma-theme={themeMode}
      style={themeTokens.vars as React.CSSProperties}
    >
      {/* Full-Bleed Integrated Organic Wave Hero */}
      <header className="km-hero-header" id="km-top">
        <div className="km-hero-wave-wrap" id={activeBrand.hasCustomBanner && showBanner ? "brand-banner-hero" : undefined}>
          {showBanner ? (
            <>
              <img
                src={activeBrand.bannerImage}
                alt={`${activeBrand.name} — capa`}
                className="km-hero-banner-bg"
                decoding="async"
                onError={() => {
                  setBannerFailed(true);
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
                id="btn-share-mobile"
                className="km-wave-btn km-mobile-only-btn"
                onClick={handleShare}
                aria-label={linkCopied ? "Link copiado" : "Compartilhar cardápio"}
                title={linkCopied ? "Link copiado" : "Compartilhar"}
              >
                <Share2 size={18} aria-hidden="true" />
              </button>

              {whatsappUrl && (
                <a
                  id="btn-whatsapp-header"
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="km-wave-btn km-desktop-only-btn"
                  aria-label="Falar no WhatsApp"
                  title="WhatsApp"
                >
                  <Phone size={16} aria-hidden="true" />
                </a>
              )}

              {instagramUrl && (
                <a
                  id="btn-instagram-header"
                  href={instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="km-wave-btn km-desktop-only-btn"
                  aria-label="Instagram do restaurante"
                  title="Instagram"
                >
                  <Instagram size={16} aria-hidden="true" />
                </a>
              )}

              <button
                type="button"
                id="btn-share-header"
                className="km-wave-btn km-desktop-only-btn"
                onClick={handleShare}
                aria-label={linkCopied ? "Link copiado" : "Compartilhar cardápio"}
                title={linkCopied ? "Link copiado" : "Compartilhar"}
              >
                <Share2 size={18} aria-hidden="true" />
              </button>

              {(activeBrand.benefits?.coupons || activeBrand.benefits?.loyalty) && onBenefitsClick && (
                <button
                  type="button"
                  id="btn-benefits-header"
                  className="km-wave-btn km-desktop-only-btn"
                  onClick={onBenefitsClick}
                  aria-label="Benefícios e ofertas"
                  title="Benefícios"
                >
                  <Gift size={16} aria-hidden="true" />
                  <span className="text-xs font-bold">Benefícios</span>
                </button>
              )}

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
                id="btn-cart-header"
                className="km-wave-btn km-desktop-only-btn"
                onClick={onCartToggle}
                aria-label={`Sua sacola, ${cartCount} ${cartCount === 1 ? "item" : "itens"}`}
                title="Sacola"
              >
                <MenuBagGlyph className="w-[18px] h-[18px]" />
                {cartCount > 0 && <span className="km-wave-btn__badge">{cartCount}</span>}
              </button>

              <button
                type="button"
                id={user ? "btn-user-profile" : "btn-login-trigger"}
                className="km-wave-btn km-desktop-only-btn"
                onClick={onAuthClick}
                aria-label={user ? user.name : "Minha conta"}
                title={user ? user.name : "Conta"}
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
              id="header-brand-info-trigger"
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
              <div className="km-store-status-row">
                <span
                  className={`km-status-inline ${isOpen ? "km-status-inline--open" : "km-status-inline--closed"}`}
                >
                  <span className={`km-status-dot ${isOpen ? "" : "km-status-dot--closed"}`} aria-hidden="true" />
                  <span>{isOpen ? "Aberto" : "Fechado"}</span>
                </span>
              </div>
            </div>
          </div>

          {(storeModalities.length > 0 || minOrderAmount > 0) && (
            <div className="km-store-facts">
              {storeModalities.length > 0 && (
                <div className="km-store-modalities" role="list" aria-label="Modalidades disponíveis">
                  {storeModalities.map((mod) => (
                    <span key={mod.key} className="km-store-modality" role="listitem">
                      {mod.key === "delivery" ? (
                        <Bike size={14} className="km-store-modality__icon" aria-hidden="true" />
                      ) : mod.key === "pickup" ? (
                        <Store size={14} className="km-store-modality__icon" aria-hidden="true" />
                      ) : (
                        <UtensilsCrossed size={14} className="km-store-modality__icon" aria-hidden="true" />
                      )}
                      <span>{mod.label}</span>
                    </span>
                  ))}
                </div>
              )}

              {minOrderAmount > 0 && (
                <span className="km-store-rule km-tabular">
                  <ReceiptText size={13} className="km-store-rule__icon" aria-hidden="true" />
                  <span className="km-store-rule__label">Pedido mínimo</span>
                  <strong className="km-store-rule__value">{formatMenuPrice(minOrderAmount)}</strong>
                </span>
              )}
            </div>
          )}

          <div className="km-store-actions-row">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="km-fees-link" onClick={onStoreInfoClick}>
                <span>Taxas de entrega e horários</span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>

              {(activeBrand.benefits?.coupons || activeBrand.benefits?.loyalty) && onBenefitsClick && (
                <button
                  type="button"
                  id="mobile-nav-benefits"
                  className="km-fees-link"
                  onClick={onBenefitsClick}
                  aria-label="Abrir benefícios"
                >
                  <Gift size={13} aria-hidden="true" />
                  <span>Benefícios</span>
                </button>
              )}

              {user && onAuthClick && (
                <button
                  type="button"
                  id="btn-order-again-home"
                  className="km-fees-link"
                  onClick={onAuthClick}
                >
                  <span>Peça novamente</span>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              )}
            </div>

            {(whatsappUrl || instagramUrl) && (
              <nav className="km-store-socials km-mobile-only-flex" aria-label="Redes sociais do restaurante">
                {whatsappUrl && (
                  <a
                    id="btn-whatsapp-mobile"
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="km-soft-icon-btn"
                    aria-label="Falar no WhatsApp"
                  >
                    <Phone size={17} aria-hidden="true" />
                  </a>
                )}
                {instagramUrl && (
                  <a
                    id="btn-instagram-mobile"
                    href={instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="km-soft-icon-btn"
                    aria-label="Instagram do restaurante"
                  >
                    <Instagram size={17} aria-hidden="true" />
                  </a>
                )}
              </nav>
            )}
          </div>
        </div>
      </header>

      <main className="km-container">
        {/* Airy Inline Search Bar */}
        <div className="km-search-bar">
          <MenuSearchGlyph className="w-[18px] h-[18px] shrink-0" />
          <input
            type="search"
            role="searchbox"
            aria-label="Campo de busca de produtos"
            placeholder="Buscar prato, bebida ou ingrediente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="km-search-bar__input"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="km-search-bar__clear"
              aria-label="Limpar busca"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Store Availability Notice (real closed / schedule / cash status) */}
        {activeBrand.storeStatus === "closed" && (
          <div id="menu-availability" className="km-availability-banner" role="status">
            <Clock3 size={16} className="mt-0.5 shrink-0" style={{ color: "var(--km-alert-text)" }} aria-hidden="true" />
            <div className="min-w-0">
              <strong>
                {activeBrand.availabilitySource === "provisional_preparation"
                  ? "Estabelecimento em fase de preparação."
                  : activeBrand.availabilitySource === "schedule"
                    ? activeBrand.nextOpeningLabel
                      ? `Estabelecimento fechado. Abre ${activeBrand.nextOpeningLabel}.`
                      : "Estabelecimento fechado."
                    : activeBrand.availabilitySource === "cash_closed"
                      ? "Estabelecimento fechado. Aguardando abertura do caixa."
                      : "Pedidos pausados."}
              </strong>
              <span>
                {!["schedule", "cash_closed"].includes(activeBrand.availabilitySource || "") && orderingMessage
                  ? ` ${orderingMessage} `
                  : " "}
                O cardápio continua disponível para consulta.
              </span>
            </div>
          </div>
        )}

        {/* Active Order Banner */}
        {activeOrder && activeState && (
          <MenuActiveOrderCard
            id="active-order-banner"
            activeOrder={activeOrder}
            activeState={activeState}
            statusLabel={customerOrderLabel(activeState)}
            fulfillmentLabel={orderFulfillmentLabel(activeState.fulfillment)}
            storedOrders={storedOrders}
            isRefreshingOrders={isRefreshingOrders}
            onSelectOrderId={onSelectOrderId}
            onPayPixClick={onPayPixClick}
            onRefreshOrders={onRefreshOrders}
            onClearTrackedOrder={onClearTrackedOrder}
            onOrdersClick={onOrdersClick}
          />
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
              aria-current={visibleCategory === "" ? "true" : undefined}
              onClick={() => handleSelectCat("")}
            >
              Início
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
                  aria-current={isActive ? "true" : undefined}
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

        {/* Hero Showcase (#koma-art-hero-showcase) */}
        {!searchQuery.trim() && heroProduct && (() => {
          const heroIsConfigurable = isGroupedProduct(heroProduct) || Boolean(heroProduct.modifierGroups?.length || heroProduct.modifiers?.length);
          const heroQty = getDisplayItemCartQty(heroProduct);
          const heroPrice = getCatalogDisplayEffectivePrice(heroProduct);
          const formattedHeroEffective = formatMenuPrice(heroPrice.effectivePrice);
          const heroDisplayPrice = heroPrice.isFromPrice
            ? `A partir de ${formattedHeroEffective}`
            : formattedHeroEffective;
          const heroOriginalPrice =
            heroPrice.hasDiscount && heroPrice.originalPrice != null
              ? formatMenuPrice(heroPrice.originalPrice)
              : null;
          return (
          <section
            id="koma-art-hero-showcase"
            className="km-hero-showcase"
            aria-label={isVerifiedTopRanked ? "Mais pedido do cardápio" : "Destaque do cardápio"}
          >
            <div className="km-hero-showcase__copy">
              <span className="km-hero-showcase__tag">
                {isVerifiedTopRanked ? "Nº 1 mais pedido" : isManualHero ? "Destaque da casa" : "Em destaque"}
              </span>
              <h2 className="km-hero-showcase__title">{heroProduct.name}</h2>
              {heroProduct.description && (
                <p className="km-hero-showcase__desc">{heroProduct.description}</p>
              )}
              <div className="mt-2.5 flex items-center gap-3">
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <span className="km-price">{heroDisplayPrice}</span>
                  {heroOriginalPrice && <span className="km-price--strike">{heroOriginalPrice}</span>}
                </div>
                {!heroIsConfigurable && heroQty > 0 ? (
                  <div className="km-qty-control">
                    <button
                      type="button"
                      className="km-qty-btn"
                      onClick={(e) => onFastRemove(heroProduct as Product, e)}
                      aria-label="Diminuir quantidade"
                    >
                      <Minus size={13} aria-hidden="true" />
                    </button>
                    <span className="km-qty-value" id={`hero-qty-${heroProduct.id}`}>{heroQty}</span>
                    <button
                      type="button"
                      id={`btn-hero-fast-add-${heroProduct.id}`}
                      className="km-qty-btn km-qty-btn--add"
                      onClick={(e) => onFastAdd(heroProduct as Product, e)}
                      aria-label="Aumentar quantidade"
                    >
                      <Plus size={13} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    id={`btn-hero-fast-add-${heroProduct.id}`}
                    onClick={(e) => {
                      if (heroIsConfigurable) {
                        onSelectProduct(heroProduct);
                      } else {
                        onFastAdd(heroProduct as Product, e);
                      }
                    }}
                    className="km-add-pill cursor-pointer"
                  >
                    <span>
                      {heroIsConfigurable ? "Escolher" : "Adicionar"}
                    </span>
                    <span className="km-add-pill__circle">
                      <Plus size={14} aria-hidden="true" />
                    </span>
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onSelectProduct(heroProduct)}
              className="km-hero-showcase__media cursor-pointer border-0 p-0"
              aria-label={`Ver ${heroProduct.name}`}
            >
              <CatalogProductImage image={heroProduct.image} alt={heroProduct.name} priority width={96} height={96} />
            </button>
          </section>
          );
        })()}

        {/* Curved Variable Promo Showcase (0 / 1 / 2 / 3+) */}
        <MenuPromotionsShowcase
          id="cardapio-promotions-home"
          promotions={activePromotions}
          promotionCatalogProducts={promotionCatalogProducts}
          formatPrice={formatMenuPrice}
          onPromotionSelect={onPromotionSelect}
        />

        {/* Destaques 2-Column Editorial Grid */}
        {!searchQuery.trim() && highlightProducts.length > 0 && (
          <section
            className="km-section"
            id="popular-products-home"
          >
            <div className="km-section__head" id={activePromotions.length === 0 ? "km-highlights" : undefined}>
              <h2 className="km-section__title">Destaques</h2>
              <span className="km-section__count">{highlightProducts.length} itens</span>
            </div>

            <div className="km-highlight-grid" role="list">
              {highlightProducts.slice(0, 4).map((product) => (
                <div role="listitem" aria-label={`Abrir ${product.name}`} key={`hl-${product.id}`}>
                  <MenuProductCard
                    product={product}
                    variant="highlight"
                    priority
                    cartQuantity={getProductCartQuantity(product.id)}
                    onSelectProduct={onSelectProduct as any}
                    onFastAdd={onFastAdd as any}
                    onFastRemove={onFastRemove as any}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Category Product Sections (#catalog-feed) */}
        <div id="catalog-feed" className="flex flex-col gap-5">
          {groupedCategories.length === 0 ? (
            <div className="rounded-2xl border border-[var(--km-line)] bg-[var(--km-card)] p-8 text-center" role="status">
              {searchQuery.trim() ? (
                <>
                  <MenuSearchGlyph className="mx-auto mb-2 h-6 w-6 text-[var(--km-muted)]" />
                  <p className="text-sm font-bold text-[var(--km-ink)]">
                    Nenhum item encontrado para &ldquo;{searchQuery}&rdquo;
                  </p>
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="mt-3 rounded-full border border-[var(--km-accent-border)] bg-[var(--km-accent-soft)] px-4 py-2 text-xs font-bold text-[var(--km-accent-text)] cursor-pointer"
                  >
                    Limpar busca
                  </button>
                </>
              ) : (
                <p className="text-xs text-[var(--km-muted)]">
                  Este restaurante ainda não publicou produtos no cardápio.
                </p>
              )}
            </div>
          ) : (
            groupedCategories.map(({ category, items }, catIndex) => (
              <section
                key={category}
                className={`km-section ${catIndex >= 4 ? "km-section--deferred" : ""}`}
                id={`km-cat-${toSafeCategoryDomId(category)}`}
                data-category={category}
                data-menu-category={category}
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
                      cartQuantity={getDisplayItemCartQty(item)}
                      onSelectProduct={onSelectProduct as any}
                      onFastAdd={onFastAdd as any}
                      onFastRemove={onFastRemove as any}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        {/* Footer + Official KÔMA Attribution Card (opens Interactive Modal) */}
        <footer className="km-footer">
          <span className="km-footer-note">
            {activeBrand.name} · Preços e disponibilidade atualizados pelo restaurante.
          </span>

          <button
            type="button"
            id="koma-powered-by-footer"
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
                {typeof window !== "undefined" && typeof document !== "undefined" ? (
                  <NumberFlow
                    value={cartTotal}
                    format={{ style: "currency", currency: "BRL" }}
                    locales="pt-BR"
                  />
                ) : (
                  formatMenuPrice(cartTotal)
                )}
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
        userFullName={user?.name || null}
        hidden={Boolean(dockHidden ?? hasOpenOverlay)}
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
