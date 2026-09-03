/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShoppingBag,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import {
  BrandConfig,
  OperatingHours,
  PaymentMethodGroup,
  Product,
  ProductOption,
  SocialNetwork,
  getProductImageUrl,
  getRestaurantAssetUrl,
} from "./CardapioTypes";
import CardapioHeader from "./components/CardapioHeader";
import CardapioCategoryNav from "./components/CardapioCategoryNav";
import CardapioProductCard from "./components/CardapioProductCard";
import CardapioProductModal from "./components/CardapioProductModal";
import CardapioCartDrawer, {
  CardapioCheckoutRequest,
  CartItem,
} from "./components/CardapioCartDrawer";
import CardapioAuthModal from "./components/CardapioAuthModal";
import CardapioUserProfileModal from "./components/CardapioUserProfileModal";
import CardapioDigital from "./components/CardapioDigital";
import CardapioStoreInfoDrawer from "./components/CardapioStoreInfoDrawer";
import { CardapioConditionsSummary } from "./components/CardapioOrderConditions";
import CardapioOrdersDrawer from "./components/CardapioOrdersDrawer";
import { API_BASE_URL, WS_BASE_URL } from "../config/api";
import { smartSearchMatch } from "../domain";
import {
  CustomerProfile,
  clearCustomerSession,
  loadCustomerSession,
  mapCustomerProfile,
  saveCustomerSession,
} from "./customerSession";
import {
  StoredOrder,
  loadStoredOrders,
  refreshAllStoredOrders,
  removeStoredOrder,
  clearAllStoredOrders,
  isTerminalStatus,
  isRejectedStatus,
  orderStatusLabel,
  orderStep,
} from "./orderTracking";

const KOMA_PRIMARY = "#00b894";
const KOMA_BACKGROUND = "#090a0f";
const ACTIVE_ORDER_REFRESH_MS = 20_000;
// O CSP ainda permite https://viacep.com.br por compatibilidade com telas legadas;
// o MVP do cardápio não executa lookup externo de CEP nem depende desse serviço.

interface PublicMenuPayload {
  restaurante: Record<string, any>;
  categorias: Array<Record<string, any>>;
  produtos: Array<Record<string, any>>;
}

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function categorySectionId(name: string) {
  const slug = name
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `sec-${slug || "categoria"}`;
}

function getRestaurantIdentifier(): string | null {
  const params = new URLSearchParams(window.location.search);
  const restaurantId = params.get("restaurant_id") || params.get("restaurante_id");
  const slug = params.get("slug");
  if (restaurantId) return restaurantId;
  if (slug) return slug;

  const hostname = window.location.hostname.toLowerCase();
  const parts = hostname.split(".");
  const ignoredSubdomains = ["www", "localhost", "sistema-gourmet-bistro"];
  const isPlatformHost = hostname.endsWith(".pages.dev")
    || hostname.endsWith(".railway.app")
    || hostname.endsWith(".up.railway.app")
    || hostname.endsWith(".vercel.app")
    || hostname.endsWith(".netlify.app")
    || hostname.endsWith(".github.io");

  if (
    parts.length > 2
    && !ignoredSubdomains.includes(parts[0])
    && !parts[0].startsWith("ais-dev")
    && !parts[0].startsWith("ais-pre")
    && !isPlatformHost
  ) {
    return parts[0];
  }
  return null;
}

export default function CardapioPage() {
  const [activeBrand, setActiveBrand] = useState<BrandConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [checkoutRequest, setCheckoutRequest] = useState<CardapioCheckoutRequest | null>(null);
  const [isStoreInfoOpen, setIsStoreInfoOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isOrdersDrawerOpen, setIsOrdersDrawerOpen] = useState(false);
  const [isRefreshingOrders, setIsRefreshingOrders] = useState(false);
  const [storedOrders, setStoredOrders] = useState<StoredOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [user, setUser] = useState<CustomerProfile | null>(null);
  const [customerToken, setCustomerToken] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const isProgrammaticScroll = useRef(false);

  const activeOrders = useMemo(
    () => storedOrders.filter((order) => !isTerminalStatus(order.status)),
    [storedOrders],
  );

  const activeOrder = useMemo(() => {
    if (storedOrders.length === 0) return null;
    if (selectedOrderId) {
      const match = storedOrders.find((order) => order.id === selectedOrderId);
      if (match) return match;
    }
    return activeOrders[0] || storedOrders[0] || null;
  }, [storedOrders, selectedOrderId, activeOrders]);

  const checkActiveOrders = useCallback(async (restaurantId: number) => {
    try {
      setIsRefreshingOrders(true);
      const updated = await refreshAllStoredOrders(restaurantId, API_BASE_URL);
      setStoredOrders(updated);
    } catch (error) {
      console.warn("Erro ao consultar status dos pedidos:", error);
    } finally {
      setIsRefreshingOrders(false);
    }
  }, []);

  const loadRestaurantData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg("");
    const identifier = getRestaurantIdentifier();
    if (!identifier) {
      setErrorMsg("Cardápio não encontrado ou ainda não publicado.");
      setIsLoading(false);
      return;
    }

    try {
      const query = new URLSearchParams(
        /^\d+$/.test(identifier) ? { restaurante_id: identifier } : { slug: identifier },
      );
      const response = await fetch(
        `${API_BASE_URL}/api/cardapio-digital/public?${query.toString()}`,
        { cache: "no-store" },
      );
      if (response.status === 404) throw new Error("CARDAPIO_NOT_FOUND");
      if (!response.ok) throw new Error(`CARDAPIO_HTTP_${response.status}`);

      const payload = await response.json() as PublicMenuPayload;
      if (!payload?.restaurante || !Array.isArray(payload.categorias) || !Array.isArray(payload.produtos)) {
        throw new Error("CARDAPIO_INVALID_RESPONSE");
      }

      const restaurant = payload.restaurante;
      const categoryMap: Record<string, string> = {};
      payload.categorias.forEach((category) => {
        categoryMap[String(category.id)] = String(category.nome || "");
      });

      const products: Product[] = payload.produtos.map((product) => ({
        id: String(product.id),
        name: String(product.nome || ""),
        description: String(product.descricao || ""),
        price: Number(product.preco || 0),
        image: getProductImageUrl(String(product.imagem_url || "")),
        imagesGallery: Array.isArray(product.imagens_galeria) && product.imagens_galeria.length > 0
          ? product.imagens_galeria.map((url: string) => getProductImageUrl(url))
          : [getProductImageUrl(String(product.imagem_url || ""))],
        category: categoryMap[String(product.categoria_id)] || "Outros",
        modifiers: [],
        modifierGroups: Array.isArray(product.grupos_modificadores)
          ? product.grupos_modificadores.map((g: any) => ({
              id: String(g.id),
              name: String(g.nome || ""),
              minSelection: Number(g.min_selecoes || 0),
              maxSelection: Number(g.max_selecoes || 1),
              type: g.tipo || "opcional",
              options: Array.isArray(g.opcoes)
                ? g.opcoes.map((o: any) => ({
                    id: String(o.id || ""),
                    name: String(o.nome || ""),
                    extraPrice: Number(o.preco_adicional || 0),
                    active: o.ativo !== false,
                  }))
                : [],
            }))
          : [],
        isAvailable: true,
      }));

      let socials: SocialNetwork[] = [];
      let whatsappNumber = "";
      const socialsConfig = parseStructuredValue(restaurant.socials);
      if (socialsConfig && typeof socialsConfig === "object" && !Array.isArray(socialsConfig)) {
        socials = Object.entries(socialsConfig as Record<string, unknown>)
          .filter(([, value]) => Boolean(value))
          .map(([platform, value]) => {
            let url = String(value || "");
            if (platform === "instagram" && !url.startsWith("http")) url = `https://instagram.com/${url.replace("@", "")}`;
            if (platform === "whatsapp") {
              whatsappNumber = url.replace(/\D/g, "");
              url = `https://wa.me/${whatsappNumber}`;
            }
            return {
              platform: platform === "instagram" ? "Instagram" : platform === "whatsapp" ? "WhatsApp" : platform,
              url,
              active: true,
            };
          });
      }

      let operatingHours: OperatingHours[] = [];
      const hoursConfig = parseStructuredValue(restaurant.horarios_funcionamento);
      if (Array.isArray(hoursConfig)) {
        operatingHours = hoursConfig
          .filter((item) => item && typeof item === "object")
          .map((item: Record<string, unknown>) => ({ days: String(item.days || ""), hours: String(item.hours || "") }))
          .filter((item) => item.days && item.hours);
      } else if (hoursConfig && typeof hoursConfig === "object") {
        operatingHours = Object.entries(hoursConfig as Record<string, unknown>)
          .map(([days, hours]) => ({ days, hours: String(hours || "") }))
          .filter((item) => item.days && item.hours);
      }

      const paymentMethods: PaymentMethodGroup[] = [];
      const paymentConfig = parseStructuredValue(restaurant.formas_pagamento_aceitas);
      if (Array.isArray(paymentConfig)) {
        const names = paymentConfig.filter((item): item is string => typeof item === "string");
        names.forEach((name) => {
          if (name.trim()) paymentMethods.push({ type: name.trim(), accepted: [] });
        });
      }

      const statusOverride = String(restaurant.status_override || "Automático").toLocaleLowerCase("pt-BR");
      const brand: BrandConfig = {
        id: String(restaurant.id),
        name: String(restaurant.nome || "Restaurante"),
        slogan: String(restaurant.subtitulo || ""),
        logo: getRestaurantAssetUrl(restaurant.logo_url || "", true),
        bannerImage: getRestaurantAssetUrl(restaurant.banner_url || "", false),
        phone: whatsappNumber,
        address: String(restaurant.endereco || ""),
        colors: {
          primary: KOMA_PRIMARY,
          background: KOMA_BACKGROUND,
          secondary: "#121420",
          text: "#ffffff",
          card: "#121420",
          accent: KOMA_PRIMARY,
        },
        categories: payload.categorias.map((category) => String(category.nome || "")).filter(Boolean),
        products,
        socials,
        about: String(restaurant.sobre_nos || ""),
        paymentMethods,
        onlinePaymentEnabled: restaurant.pagamento_online_ativo === true,
        operatingHours,
        googleMapsUrl: String(restaurant.google_maps_url || ""),
        pedidoMinimo: Number(restaurant.pedido_minimo || 0),
        freteGratisValor: Number(restaurant.frete_gratis_valor || 0),
        tipoTaxaEntrega: String(restaurant.tipo_taxa_entrega || "fixa"),
        tabelaTaxasBairros: Array.isArray(restaurant.tabela_taxas_bairros)
          ? restaurant.tabela_taxas_bairros.map((b: any) => ({
              bairro: String(b.bairro || ""),
              taxa: Number(b.taxa || 0),
            }))
          : [],
        taxaEntregaPadrao: Number(restaurant.taxa_entrega_padrao || 7),
        storeStatus: statusOverride.includes("fech")
          ? "closed"
          : statusOverride.includes("abert")
            ? "open"
            : "automatic",
      };

      setActiveBrand(brand);
      setActiveCategory((current) => current && brand.categories.includes(current) ? current : brand.categories[0] || "");
      const rid = Number(brand.id);
      if (Number.isFinite(rid)) {
        setStoredOrders(loadStoredOrders(rid));
        void checkActiveOrders(rid);
      }
    } catch (error) {
      console.error("Falha ao carregar cardápio público:", error);
      setActiveBrand(null);
      setErrorMsg(
        error instanceof Error && error.message === "CARDAPIO_NOT_FOUND"
          ? "Cardápio não encontrado ou ainda não publicado."
          : "O cardápio está temporariamente indisponível. Tente novamente.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [checkActiveOrders]);

  useEffect(() => {
    void loadRestaurantData();
  }, [loadRestaurantData]);

  useEffect(() => {
    if (!activeBrand?.id) return;
    let cancelled = false;
    const session = loadCustomerSession(activeBrand.id);
    if (!session) {
      setUser(null);
      setCustomerToken(null);
      return;
    }

    setUser(session.profile);
    setCustomerToken(session.token);
    void fetch(`${API_BASE_URL}/cardapio/clientes/me`, {
      headers: { "X-Koma-Customer-Token": session.token },
    }).then(async (response) => {
      const data = await response.json().catch(() => null);
      if (cancelled) return;
      if (response.status === 401) {
        clearCustomerSession(activeBrand.id);
        setUser(null);
        setCustomerToken(null);
        return;
      }
      if (response.ok && data?.id) {
        const profile = mapCustomerProfile(data);
        setUser(profile);
        saveCustomerSession(activeBrand.id, { token: session.token, profile });
      }
    }).catch(() => {
      // Sessão local continua útil em quedas breves de rede.
    });

    return () => {
      cancelled = true;
    };
  }, [activeBrand?.id]);

  useEffect(() => {
    if (!activeBrand) return;
    const root = document.documentElement;
    root.style.setProperty("--color-brand-primary", KOMA_PRIMARY);
    root.style.setProperty("--color-brand-bg", KOMA_BACKGROUND);
    root.style.setProperty("--color-brand-text", "#ffffff");
    root.style.setProperty("--color-brand-secondary", "#121420");
    root.style.setProperty("--color-brand-card", "#121420");
    root.style.setProperty("--color-brand-accent", KOMA_PRIMARY);
    document.body.style.backgroundColor = KOMA_BACKGROUND;
    document.body.style.color = "#ffffff";
  }, [activeBrand]);

  useEffect(() => {
    if (!activeBrand?.id) return;
    const restaurantId = Number(activeBrand.id);
    if (!Number.isFinite(restaurantId)) return;

    let intervalId: ReturnType<typeof setInterval> | undefined;
    const refresh = () => {
      if (document.hidden) return;
      if (activeOrders.length > 0) void checkActiveOrders(restaurantId);
    };
    intervalId = setInterval(refresh, ACTIVE_ORDER_REFRESH_MS);
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activeBrand?.id, activeOrders.length, checkActiveOrders]);

  useEffect(() => {
    if (!activeBrand?.id) return;
    const wsUrl = `${WS_BASE_URL}/ws/cliente?restaurante_id=${activeBrand.id}`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let delay = 2000;

    const connect = () => {
      if (stopped || document.hidden) return;
      const socket = new WebSocket(wsUrl);
      ws = socket;
      socket.onopen = () => { delay = 2000; };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const eventName = data.event || data.type;
          if (["catalog_updated", "config_updated", "store_status_changed"].includes(eventName)) {
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => void loadRestaurantData(), 100);
          }
          if (["order_updated", "order_status_updated"].includes(eventName)) {
            void checkActiveOrders(Number(activeBrand.id));
          }
        } catch {
          // Mensagem inválida do socket não interrompe o cardápio.
        }
      };
      socket.onclose = () => {
        if (stopped || ws !== socket) return;
        ws = null;
        reconnectTimer = setTimeout(connect, delay);
        delay = Math.min(delay * 1.5, 30000);
      };
      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      ws?.close();
    };
  }, [activeBrand?.id, checkActiveOrders, loadRestaurantData]);

  const visibleCategories = useMemo(() => {
    if (!activeBrand) return [];
    return activeBrand.categories.filter((category) => (
      activeBrand.products
        .filter((product) => product.category === category)
        .some((product) => smartSearchMatch(`${product.name} ${product.description || ""}`, searchQuery))
    ));
  }, [activeBrand, searchQuery]);

  useEffect(() => {
    if (!activeBrand) return;
    const observer = new IntersectionObserver((entries) => {
      if (isProgrammaticScroll.current) return;
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const category = activeBrand.categories.find((item) => categorySectionId(item) === entry.target.id);
        if (category) setActiveCategory(category);
      });
    }, { rootMargin: "-100px 0px -62% 0px", threshold: 0 });

    visibleCategories.forEach((category) => {
      const element = document.getElementById(categorySectionId(category));
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [activeBrand, visibleCategories]);

  const orderingEnabled = activeBrand?.storeStatus !== "closed";
  const orderingMessage = "O restaurante pausou novos pedidos por enquanto.";

  const handleAddToCart = (
    product: Product,
    quantity: number,
    selectedOptions: Record<string, ProductOption[]>,
    notes: string,
  ) => {
    if (!orderingEnabled) {
      setNotice(`${orderingMessage} Você ainda pode consultar os produtos.`);
      return;
    }

    const optionIds = Object.values(selectedOptions)
      .flatMap((list) => list.map((option) => option.id))
      .sort()
      .join("-");
    const itemId = `${product.id}-${optionIds}-${notes.trim()}`;
    setCart((current) => {
      const existing = current.find((item) => item.id === itemId);
      if (existing) {
        return current.map((item) => item.id === itemId ? { ...item, quantity: item.quantity + quantity } : item);
      }
      return [...current, { id: itemId, product, quantity, selectedOptions, notes }];
    });
    setNotice(`${product.name} foi adicionado à sacola.`);
    if (window.innerWidth >= 1024) setIsCartOpen(true);
  };

  const handleFastAdd = (product: Product) => {
    if (product.modifiers?.length) setSelectedProduct(product);
    else handleAddToCart(product, 1, {}, "");
  };

  const handleRepeatOrder = (order: StoredOrder) => {
    if (!orderingEnabled) {
      setNotice(`${orderingMessage} Você ainda pode consultar os produtos.`);
      return;
    }
    if (!Array.isArray(order.itens) || order.itens.length === 0) {
      setNotice("Este pedido não possui itens disponíveis para repetir.");
      return;
    }

    const repeated: CartItem[] = [];
    let skipped = 0;

    order.itens.forEach((stored) => {
      const productId = String(stored.produto_id || stored.id || "");
      const normalizedName = stored.nome.trim().toLocaleLowerCase("pt-BR");
      const product = activeBrand.products.find((item) => (
        item.id === productId
        || item.name.trim().toLocaleLowerCase("pt-BR") === normalizedName
      ));
      if (!product || product.isAvailable === false) {
        skipped += 1;
        return;
      }

      const savedModifierIds = new Set((stored.modifier_ids || []).map(String));
      const selectedOptions: Record<string, ProductOption[]> = {};
      let invalidRequiredGroup = false;
      (product.modifierGroups || []).forEach((group) => {
        const options = group.options.filter(
          (option) => option.active !== false && savedModifierIds.has(String(option.id)),
        );
        if (options.length > 0) selectedOptions[group.id] = options;
        if (group.minSelection > options.length) invalidRequiredGroup = true;
      });
      if (invalidRequiredGroup) {
        skipped += 1;
        return;
      }

      const optionIds = Object.values(selectedOptions)
        .flatMap((list) => list.map((option) => option.id))
        .sort()
        .join("-");
      const notes = stored.observacao || "";
      repeated.push({
        id: `${product.id}-${optionIds}-${notes.trim()}`,
        product,
        quantity: Math.max(1, Number(stored.quantidade || 1)),
        selectedOptions,
        notes,
      });
    });

    if (repeated.length === 0) {
      setIsOrdersDrawerOpen(false);
      setNotice("Os itens deste pedido mudaram no cardápio. Monte um novo pedido para confirmar as opções atuais.");
      return;
    }

    setCart((current) => {
      const next = [...current];
      repeated.forEach((candidate) => {
        const existingIndex = next.findIndex((item) => item.id === candidate.id);
        if (existingIndex >= 0) {
          next[existingIndex] = {
            ...next[existingIndex],
            quantity: next[existingIndex].quantity + candidate.quantity,
          };
        } else {
          next.push(candidate);
        }
      });
      return next;
    });
    setIsOrdersDrawerOpen(false);
    setIsCartOpen(true);
    setNotice(
      skipped > 0
        ? `Pedido adicionado à sacola. ${skipped} item(ns) precisam ser escolhidos novamente porque o cardápio mudou.`
        : "Pedido adicionado à sacola para você revisar.",
    );
  };

  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const cartTotal = cart.reduce((total, item) => {
    let unit = item.product.price;
    Object.values(item.selectedOptions).forEach((options) => options.forEach((option) => { unit += option.extraPrice; }));
    return total + unit * item.quantity;
  }, 0);

  const handleLoginSuccess = (profile: CustomerProfile, token: string) => {
    setUser(profile);
    setCustomerToken(token);
    if (activeBrand?.id) saveCustomerSession(activeBrand.id, { token, profile });
  };

  const handleLogout = () => {
    if (activeBrand?.id) clearCustomerSession(activeBrand.id);
    setUser(null);
    setCustomerToken(null);
    setIsProfileOpen(false);
  };

  const handleSessionExpired = () => {
    if (activeBrand?.id) clearCustomerSession(activeBrand.id);
    setUser(null);
    setCustomerToken(null);
    setIsCheckoutOpen(false);
    setCheckoutRequest(null);
    setNotice("Sua identificação expirou. A sacola foi preservada e você pode continuar como visitante.");
  };

  const clearTrackedOrder = (orderId?: string) => {
    const targetId = orderId || activeOrder?.id;
    if (targetId) {
      removeStoredOrder(targetId);
      if (activeBrand?.id) {
        setStoredOrders(loadStoredOrders(Number(activeBrand.id)));
      }
    } else {
      if (activeBrand?.id) {
        clearAllStoredOrders(Number(activeBrand.id));
        setStoredOrders([]);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-koma-page p-6 text-koma-foreground">
        <div className="h-11 w-11 animate-spin rounded-full border-4 border-emerald-500/20 border-t-emerald-500" />
        <h2 className="mt-4 text-sm font-black">Carregando cardápio</h2>
        <p className="mt-1 text-xs text-koma-muted">Produtos e informações do restaurante em um único carregamento.</p>
      </div>
    );
  }

  if (errorMsg || !activeBrand) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-koma-page p-6 text-koma-foreground">
        <div className="max-w-md rounded-3xl border border-rose-500/20 bg-koma-panel p-8 text-center">
          <XCircle className="mx-auto h-10 w-10 text-rose-400" />
          <h2 className="mt-4 text-lg font-black">Não conseguimos abrir este cardápio</h2>
          <p className="mt-2 text-xs leading-relaxed text-koma-muted">{errorMsg}</p>
          <button type="button" onClick={() => void loadRestaurantData()} className="mt-5 rounded-xl bg-emerald-500 px-5 py-3 text-xs font-black text-white">Tentar novamente</button>
        </div>
      </div>
    );
  }

  const terminal = activeOrder ? isTerminalStatus(activeOrder.status) : false;
  const rejected = activeOrder ? isRejectedStatus(activeOrder.status) : false;
  const currentStep = activeOrder ? orderStep(activeOrder.status) : 1;
  const trackingSteps = activeOrder?.tipo?.toLocaleLowerCase("pt-BR").includes("delivery")
    ? ["Recebido", "Em preparo", "Saiu para entrega", "Concluído"]
    : ["Recebido", "Em preparo", "Pronto", "Concluído"];

  return (
    <div className="min-h-screen overflow-x-clip bg-bg-app font-sans text-text-app" id="app-root-container">
      <CardapioHeader
        activeBrand={activeBrand}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        user={user}
        onAuthClick={() => user ? setIsProfileOpen(true) : setIsAuthOpen(true)}
        onLogoClick={() => setIsStoreInfoOpen(true)}
        onCartToggle={() => setIsCartOpen(true)}
        cartCount={cartCount}
        onOrdersClick={() => setIsOrdersDrawerOpen(true)}
        ordersCount={storedOrders.length}
        activeOrdersCount={activeOrders.length}
      />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-6" id="catalog-section">
        {notice && !isCartOpen && !isCheckoutOpen && (
          <div className="fixed bottom-5 left-1/2 z-[70] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-emerald-500/25 bg-[#102019] px-4 py-3 text-center text-[10px] font-bold text-emerald-200 shadow-2xl" role="status" onClick={() => setNotice("")}>
            {notice}
          </div>
        )}

        {activeOrder && (
          <section className={clsx(
            "rounded-2xl border p-4 shadow-lg transition-all",
            rejected ? "border-rose-500/30 bg-rose-500/[0.07]" : terminal ? "border-emerald-500/30 bg-emerald-500/[0.07]" : "border-emerald-500/25 bg-koma-card",
          )} id="active-order-banner">
            {storedOrders.length > 1 && (
              <div className="mb-3 flex items-center justify-between border-b border-koma-border/60 pb-2.5">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                  {storedOrders.map((ord) => {
                    const isSelected = ord.id === activeOrder.id;
                    const isOrdActive = !isTerminalStatus(ord.status);
                    return (
                      <button
                        key={ord.id}
                        type="button"
                        onClick={() => setSelectedOrderId(ord.id)}
                        className={clsx(
                          "inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1 text-[10px] font-bold transition",
                          isSelected
                            ? "bg-emerald-500 text-white shadow"
                            : "border border-koma-border bg-koma-panel text-koma-secondary hover:text-white",
                        )}
                      >
                        <span>Pedido #{ord.numero_pedido}</span>
                        {isOrdActive && (
                          <span className={clsx(
                            "h-1.5 w-1.5 rounded-full",
                            isSelected ? "bg-white" : "bg-emerald-400 animate-pulse",
                          )} />
                        )}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setIsOrdersDrawerOpen(true)}
                  className="ml-2 shrink-0 text-[10px] font-bold text-emerald-400 hover:text-emerald-300"
                >
                  Ver todos ({storedOrders.length})
                </button>
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className={clsx("grid h-10 w-10 shrink-0 place-items-center rounded-xl", rejected ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400")}>
                  {rejected ? <XCircle className="h-5 w-5" /> : terminal ? <CheckCircle2 className="h-5 w-5" /> : <Clock3 className="h-5 w-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className={clsx("text-[9px] font-black uppercase tracking-[0.14em]", rejected ? "text-rose-400" : "text-emerald-400")}>
                      Pedido #{activeOrder.numero_pedido}
                    </span>
                    {storedOrders.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setIsOrdersDrawerOpen(true)}
                        className="text-[9px] text-koma-subtle underline hover:text-white"
                      >
                        {activeOrders.length > 1 ? `${activeOrders.length} em andamento` : "Meus pedidos"}
                      </button>
                    )}
                  </div>
                  <h2 className="mt-1 text-base font-black text-koma-foreground">{orderStatusLabel(activeOrder.status)}</h2>
                  <p className="mt-1 text-[11px] leading-relaxed text-koma-muted">
                    {rejected
                      ? "O restaurante não conseguiu aceitar este pedido. Você pode montar um novo pedido quando quiser."
                      : terminal
                        ? "Este pedido foi concluído. O resumo continua aqui até você iniciar outro acompanhamento."
                        : currentStep === 1
                          ? "O pedido está no painel do restaurante aguardando aceite."
                          : "O restaurante já atualizou o andamento do seu pedido."}
                  </p>
                  <p className="mt-1 text-[10px] text-koma-subtle">
                    {activeOrder.tipo?.toLocaleLowerCase("pt-BR").includes("delivery") ? "Delivery" : "Retirada"} · {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(activeOrder.total || 0)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 sm:shrink-0">
                {!terminal && (
                  <button
                    type="button"
                    onClick={() => void checkActiveOrders(Number(activeBrand.id))}
                    disabled={isRefreshingOrders}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-koma-border bg-koma-panel px-3 text-[10px] font-bold text-koma-secondary transition hover:text-white disabled:opacity-50"
                  >
                    <RefreshCw className={clsx("h-3.5 w-3.5", isRefreshingOrders && "animate-spin text-emerald-400")} /> Atualizar
                  </button>
                )}
                {terminal && (
                  <button type="button" onClick={() => clearTrackedOrder(activeOrder.id)} className="h-9 rounded-xl bg-emerald-500 px-3 text-[10px] font-black text-white">Fazer novo pedido</button>
                )}
              </div>
            </div>

            {!rejected && (
              <div className="mt-4 grid grid-cols-4 gap-1.5 border-t border-koma-border pt-3">
                {trackingSteps.map((label, index) => {
                  const step = index + 1;
                  const passed = currentStep >= step;
                  return (
                    <div key={label} className="text-center">
                      <div className={clsx("h-1.5 rounded-full", passed ? "bg-emerald-500" : "bg-koma-raised")} />
                      <span className={clsx("mt-1 block text-[9px] font-bold", passed ? "text-koma-secondary" : "text-koma-subtle")}>{label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <section className="relative h-48 overflow-hidden rounded-3xl border border-koma-border sm:h-60" id="brand-banner-hero">
          <img src={activeBrand.bannerImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/65 to-emerald-950/30" />
          <div className="relative flex h-full items-end justify-between gap-4 p-5 sm:p-7">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              <img src={activeBrand.logo} alt={activeBrand.name} className="h-14 w-14 shrink-0 rounded-2xl border border-white/20 bg-white object-contain p-1 sm:h-16 sm:w-16" />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-black text-white sm:text-2xl">{activeBrand.name}</h1>
                {activeBrand.slogan && <p className="mt-1 line-clamp-2 max-w-xl text-xs leading-relaxed text-white/70">{activeBrand.slogan}</p>}
              </div>
            </div>
            <button type="button" onClick={() => setIsStoreInfoOpen(true)} className={clsx("shrink-0 rounded-full border px-3 py-2 text-[10px] font-black backdrop-blur", activeBrand.storeStatus === "closed" ? "border-rose-400/30 bg-rose-500/15 text-rose-200" : activeBrand.storeStatus === "open" ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-200" : "border-amber-400/30 bg-amber-500/15 text-amber-100")}>
              {activeBrand.storeStatus === "closed" ? "Pedidos pausados" : activeBrand.storeStatus === "open" ? "Aberto para pedidos" : "Ver horários"}
            </button>
          </div>
        </section>

        <CardapioConditionsSummary brand={activeBrand} onOpen={() => setIsStoreInfoOpen(true)} />

        {activeBrand.storeStatus === "closed" && (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-100">
            <strong>Pedidos pausados.</strong> O cardápio continua disponível para consulta, mas novos pedidos não podem ser enviados agora.
          </div>
        )}

        <CardapioCategoryNav
          categories={visibleCategories}
          activeCategory={activeCategory}
          onSelectCategory={(category) => {
            setActiveCategory(category);
            isProgrammaticScroll.current = true;
            const element = document.getElementById(categorySectionId(category));
            element?.scrollIntoView({ behavior: "smooth", block: "start" });
            window.setTimeout(() => { isProgrammaticScroll.current = false; }, 700);
          }}
        />

        <div className="flex flex-col gap-9" id="catalog-feed">
          {visibleCategories.length === 0 ? (
            <div className="rounded-2xl border border-koma-border bg-koma-card p-10 text-center text-xs text-koma-muted">
              {activeBrand.products.length === 0 ? "Este restaurante ainda não publicou produtos." : "Nenhum item encontrado para sua busca."}
            </div>
          ) : visibleCategories.map((category) => {
            const products = activeBrand.products.filter((product) => (
              product.category === category
              && smartSearchMatch(`${product.name} ${product.description || ""}`, searchQuery)
            ));
            return (
              <section key={category} id={categorySectionId(category)} className="scroll-mt-28">
                <div className="mb-3 flex items-center justify-between border-b border-koma-border pb-2.5">
                  <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-tight text-koma-foreground"><span className="h-4 w-1.5 rounded-full bg-emerald-500" />{category}</h2>
                  <span className="rounded-full bg-koma-raised px-2.5 py-1 text-[9px] font-bold text-koma-muted">{products.length} {products.length === 1 ? "item" : "itens"}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {products.map((product) => (
                    <CardapioProductCard key={product.id} product={product} onSelectProduct={setSelectedProduct} onFastAdd={handleFastAdd} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <footer className="mt-4 border-t border-koma-border py-7 text-center">
          <div className="flex items-center justify-center gap-2"><img src={activeBrand.logo} alt="" className="h-7 w-7 rounded-lg bg-white object-contain p-0.5" /><strong className="text-xs text-koma-secondary">{activeBrand.name}</strong></div>
          <p className="mt-2 text-[9px] text-koma-subtle">Cardápio digital KÔMA · preços e disponibilidade atualizados pelo restaurante.</p>
        </footer>
      </main>

      {cartCount > 0 && !isCartOpen && (
        <div className="fixed bottom-4 left-1/2 z-30 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 lg:left-auto lg:right-5 lg:w-80 lg:translate-x-0">
          <button type="button" onClick={() => setIsCartOpen(true)} className="flex h-14 w-full items-center justify-between rounded-2xl bg-emerald-500 px-4 text-white shadow-2xl" id="floating-cart-trigger">
            <span className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-white/15 text-xs font-black">{cartCount}</span><span className="text-xs font-black">Ver sacola</span></span>
            <span className="text-sm font-black">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cartTotal)}</span>
          </button>
        </div>
      )}

      {selectedProduct && (
        <CardapioProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} onAddToCart={handleAddToCart} />
      )}

      {isCartOpen && (
        <CardapioCartDrawer
          key={activeBrand.id}
          cart={cart}
          restaurantId={activeBrand.id}
          restaurantAddress={activeBrand.address}
          brandConfig={activeBrand}
          allProducts={activeBrand.products}
          onAddToCart={handleAddToCart}
          onClose={() => setIsCartOpen(false)}
          onUpdateQty={(itemId, quantity) => setCart((current) => quantity <= 0 ? current.filter((item) => item.id !== itemId) : current.map((item) => item.id === itemId ? { ...item, quantity } : item))}
          onRemoveItem={(itemId) => setCart((current) => current.filter((item) => item.id !== itemId))}
          onPlaceOrder={(request) => {
            setCheckoutRequest(request);
            setIsCartOpen(false);
            setIsCheckoutOpen(true);
          }}
          user={user}
          onAuthClick={() => setIsAuthOpen(true)}
          orderingEnabled={orderingEnabled}
          orderingMessage={orderingMessage}
        />
      )}

      {isAuthOpen && (
        <CardapioAuthModal restaurantId={activeBrand.id} onClose={() => setIsAuthOpen(false)} onLoginSuccess={handleLoginSuccess} />
      )}

      {isProfileOpen && (
        <CardapioUserProfileModal
          onClose={() => setIsProfileOpen(false)}
          user={user}
          customerToken={customerToken}
          onProfileUpdate={(profile) => {
            setUser(profile);
            if (customerToken) saveCustomerSession(activeBrand.id, { token: customerToken, profile });
          }}
          onLogout={handleLogout}
        />
      )}

      {isCheckoutOpen && checkoutRequest && (
        <CardapioDigital
          activeBrand={activeBrand}
          cart={cart}
          deliveryFee={checkoutRequest.deliveryFee}
          deliveryMethod={checkoutRequest.deliveryMethod}
          address={checkoutRequest.address}
          customerName={checkoutRequest.customerName}
          customerPhone={checkoutRequest.customerPhone}
          customerEmail={checkoutRequest.customerEmail}
          customerToken={customerToken}
          paymentMethodDetail={checkoutRequest.paymentMethodDetail}
          trocoPara={checkoutRequest.trocoPara}
          bairro={checkoutRequest.bairro}
          cupomCodigo={checkoutRequest.cupomCodigo}
          descontoCupom={checkoutRequest.descontoCupom}
          usarCashback={checkoutRequest.usarCashback}
          descontoCashback={checkoutRequest.descontoCashback}
          onClose={() => {
            setIsCheckoutOpen(false);
            setCheckoutRequest(null);
          }}
          onOrderSuccess={() => {
            setCart([]);
            setIsCartOpen(false);
            setIsCheckoutOpen(false);
            setCheckoutRequest(null);
            if (activeBrand?.id) {
              const rid = Number(activeBrand.id);
              setStoredOrders(loadStoredOrders(rid));
              window.setTimeout(() => void checkActiveOrders(rid), 50);
            }
          }}
          onSessionExpired={handleSessionExpired}
        />
      )}

      <CardapioStoreInfoDrawer brand={activeBrand} isOpen={isStoreInfoOpen} onClose={() => setIsStoreInfoOpen(false)} />

      <CardapioOrdersDrawer
        isOpen={isOrdersDrawerOpen}
        onClose={() => setIsOrdersDrawerOpen(false)}
        orders={storedOrders}
        selectedOrderId={activeOrder?.id || null}
        onSelectOrder={(id) => {
          setSelectedOrderId(id);
          setIsOrdersDrawerOpen(false);
        }}
        onRefresh={() => {
          if (activeBrand?.id) void checkActiveOrders(Number(activeBrand.id));
        }}
        onRemoveOrder={(id) => {
          removeStoredOrder(id);
          if (activeBrand?.id) {
            setStoredOrders(loadStoredOrders(Number(activeBrand.id)));
          }
        }}
        onRepeatOrder={handleRepeatOrder}
        isRefreshing={isRefreshingOrders}
      />
    </div>
  );
}
