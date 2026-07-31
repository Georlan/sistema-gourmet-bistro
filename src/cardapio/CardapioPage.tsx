/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState, useEffect, useRef } from "react";
import { Product, BrandConfig, ProductOption, getProductImageUrl, getRestaurantAssetUrl, SocialNetwork, OperatingHours, PaymentMethodGroup } from "./CardapioTypes";
import CardapioHeader from "./components/CardapioHeader";
import CardapioCategoryNav from "./components/CardapioCategoryNav";
import CardapioProductCard from "./components/CardapioProductCard";
import CardapioProductModal from "./components/CardapioProductModal";
import CardapioCartDrawer, { CardapioCheckoutRequest, CartItem } from "./components/CardapioCartDrawer";
import CardapioAuthModal from "./components/CardapioAuthModal";
import { API_BASE_URL, WS_BASE_URL } from "../config/api";
import CardapioUserProfileModal from "./components/CardapioUserProfileModal";
import CardapioDigital from "./components/CardapioDigital";
import CardapioStoreInfoDrawer from "./components/CardapioStoreInfoDrawer";
import CardapioAiChefAssistant from "./components/CardapioAiChefAssistant";
import { ShoppingBag, Eye, X, ArrowRight, Clock, RefreshCw } from "lucide-react";
import { smartSearchMatch } from "../domain";

const getCategoryId = (name: string) =>
  'sec-' + name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');

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

function getRestaurantIdentifier(): string | null {
  // 1. Check query parameters first (high priority for testing)
  const params = new URLSearchParams(window.location.search);
  const restaurantId = params.get("restaurant_id") || params.get("restaurante_id");
  const slug = params.get("slug");
  
  if (restaurantId) return restaurantId;
  if (slug) return slug;

  // 2. Check subdomain in production
  const hostname = window.location.hostname.toLowerCase();
  const parts = hostname.split(".");
  const ignoredSubdomains = ["www", "localhost", "sistema-gourmet-bistro"];
  const isPlatformHost = hostname.endsWith(".pages.dev") || 
                         hostname.endsWith(".railway.app") || 
                         hostname.endsWith(".up.railway.app") || 
                         hostname.endsWith(".vercel.app") || 
                         hostname.endsWith(".netlify.app") || 
                         hostname.endsWith(".github.io");

  if (parts.length > 2 && !ignoredSubdomains.includes(parts[0]) && !parts[0].startsWith("ais-dev") && !parts[0].startsWith("ais-pre") && !isPlatformHost) {
    return parts[0];
  }

  // Return null if no tenant subdomain or param is present (NEVER fallback to restaurant_id=1)
  return null;
}

export default function CardapioPage() {
  // Brand/Client State
  const [activeBrand, setActiveBrand] = useState<BrandConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  // Programmatic scroll flag to prevent ScrollSpy fighting during clicks
  const isProgrammaticScroll = useRef(false);

  // Search and Category State
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("Destaques");

  // Cart State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Modals / Overlays Toggles
  const [isCartOpen, setIsCartOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= 1024; // Inicia aberto em telas grandes (lg)
    }
    return false;
  });
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [checkoutRequest, setCheckoutRequest] = useState<CardapioCheckoutRequest | null>(null);
  const [isStoreInfoOpen, setIsStoreInfoOpen] = useState(false); // Left Sidebar Information State
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [activeOrder, setActiveOrder] = useState<{
    id: string;
    numero_pedido: string | number;
    status: string;
    tipo: string;
    total: number;
    created_at?: string;
    itens?: Array<{ id: string; nome: string; quantidade: number; observacao?: string }>;
  } | null>(null);

  const checkActiveOrder = useCallback(async (restaurantId: number) => {
    try {
      const raw = localStorage.getItem("koma_active_order");
      if (!raw) {
        setActiveOrder(null);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed?.id || Number(parsed.restaurante_id) !== restaurantId) {
        return;
      }
      // Check timeout (6 hours = 21600000 ms)
      if (Date.now() - (parsed.timestamp || 0) > 21600000) {
        localStorage.removeItem("koma_active_order");
        setActiveOrder(null);
        return;
      }

      // Ownership proof: send idempotency_key as ?key= query param
      const ownershipKey = parsed.idempotency_key || "";
      const res = await fetch(`${API_BASE_URL}/cardapio/pedidos/${parsed.id}/status?key=${encodeURIComponent(ownershipKey)}`);
      if (res.status === 404) {
        localStorage.removeItem("koma_active_order");
        setActiveOrder(null);
        return;
      }
      if (!res.ok) return;

      const data = await res.json();
      const statusLower = (data.status || "").toLowerCase();
      if (["entregue", "finalizado", "cancelado"].includes(statusLower) || data.fechada) {
        localStorage.removeItem("koma_active_order");
        setActiveOrder(null);
      } else {
        setActiveOrder({
          id: data.id,
          numero_pedido: data.numero_pedido,
          status: data.status,
          tipo: data.tipo,
          total: data.total,
          created_at: data.criado_em,
          itens: data.itens
        });
      }
    } catch (e) {
      console.warn("Erro ao consultar status do pedido ativo:", e);
    }
  }, []);

  // Quick Sidebar Checkout States
  const [deliveryMethod, setDeliveryMethod] = useState<"delivery" | "pickup">("delivery");
  const [address, setAddress] = useState("");

  // Customer contact profile saved on this device
  const [user, setUser] = useState<any | null>(null);
  const [sidebarError, setSidebarError] = useState("");

  // CEP & Complete Address States
  const [cep, setCep] = useState("");
  const [logradouro, setLogradouro] = useState("");
  const [numero, setNumero] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("");
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState("");
  const numeroInputRef = useRef<HTMLInputElement>(null);

  const formatCEP = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    const truncated = numbers.slice(0, 8);
    if (truncated.length <= 5) {
      return truncated;
    }
    return `${truncated.slice(0, 5)}-${truncated.slice(5)}`;
  };

  const handleCEPChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCEP(e.target.value);
    setCep(formatted);
    
    const rawNumbers = formatted.replace(/\D/g, "");
    if (rawNumbers.length === 8) {
      setCepLoading(true);
      setCepError("");
      try {
        const response = await fetch(`https://viacep.com.br/ws/${rawNumbers}/json/`);
        const data = await response.json();
        if (data.erro) {
          setCepError("CEP inválido.");
        } else {
          setLogradouro(data.logradouro || "");
          setBairro(data.bairro || "");
          setCidade(data.localidade || "");
          setEstado(data.uf || "");
          
          setTimeout(() => {
            numeroInputRef.current?.focus();
          }, 100);
        }
      } catch (err) {
        console.warn("Erro ao buscar CEP:", err);
        setCepError("Erro de conexão.");
      } finally {
        setCepLoading(false);
      }
    }
  };

  // Sync address fields when user changes
  useEffect(() => {
    if (user) {
      setAddress(user.address || "");
      if (user.address && !logradouro) {
        setLogradouro(user.address);
      }
    } else {
      setAddress("");
      setCep("");
      setLogradouro("");
      setNumero("");
      setBairro("");
      setCidade("");
      setEstado("");
    }
  }, [user]);

  // Compile individual fields into address string
  useEffect(() => {
    if (deliveryMethod === "delivery") {
      const parts = [];
      if (logradouro) parts.push(logradouro);
      if (numero) parts.push(`nº ${numero}`);
      if (bairro) parts.push(bairro);
      if (cidade && estado) {
        parts.push(`${cidade} - ${estado}`);
      } else if (cidade) {
        parts.push(cidade);
      }
      if (cep) parts.push(`CEP: ${cep}`);
      
      if (parts.length > 0) {
        setAddress(parts.join(", "));
      }
    }
  }, [cep, logradouro, numero, bairro, cidade, estado, deliveryMethod]);

  // O navegador público usa apenas a API tenant-aware. As tabelas
  // multi-tenant não são consultadas diretamente pelo cliente.
  const loadRestaurantData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg("");
    const identifier = getRestaurantIdentifier();

    if (!identifier) {
      const landingUrl = (import.meta as any).env?.VITE_LANDING_PAGE_URL;
      if (landingUrl && typeof landingUrl === "string" && landingUrl.trim() !== "") {
        window.location.href = landingUrl;
        return;
      }
      setErrorMsg("Cardápio não encontrado ou ainda não publicado.");
      setIsLoading(false);
      return;
    }

    try {
      const query = new URLSearchParams(
        /^\d+$/.test(identifier)
          ? { restaurante_id: identifier }
          : { slug: identifier }
      );
      const response = await fetch(
        `${API_BASE_URL}/api/cardapio-digital/public?${query.toString()}`,
        { cache: "no-store" }
      );
      if (response.status === 404) {
        throw new Error("CARDAPIO_NOT_FOUND");
      }
      if (!response.ok) {
        throw new Error(`CARDAPIO_HTTP_${response.status}`);
      }

      const payload = await response.json() as PublicMenuPayload;
      if (
        !payload?.restaurante
        || !Array.isArray(payload.categorias)
        || !Array.isArray(payload.produtos)
      ) {
        throw new Error("CARDAPIO_INVALID_RESPONSE");
      }

      const restaurant = payload.restaurante;
      const categoriesData = payload.categorias;
      const productsData = payload.produtos;

      // Category Map
      const categoryMap: Record<string, string> = {};
      categoriesData.forEach((category) => {
        categoryMap[String(category.id)] = String(category.nome || "");
      });

      // Map products
      const mappedProducts: Product[] = productsData.map((product) => {
        return {
          id: String(product.id),
          name: String(product.nome || ""),
          description: String(product.descricao || ""),
          price: Number(product.preco || 0),
          image: getProductImageUrl(String(product.imagem_url || "")),
          imagesGallery: Array.isArray(product.imagens_galeria) && product.imagens_galeria.length > 0
            ? product.imagens_galeria.map((imgUrl: string) => getProductImageUrl(imgUrl))
            : [getProductImageUrl(String(product.imagem_url || ""))],
          category: categoryMap[String(product.categoria_id)] || "Destaques",
          modifiers: [],
          isAvailable: true,
        };
      });

      // Build theme options
      const primaryColor = restaurant.cor_primaria || restaurant.primary_color || "#00b894";
      const backgroundColor = restaurant.cor_fundo || restaurant.background_color || "#090a0f";
      const isDarkBg = backgroundColor.startsWith("#09") || backgroundColor === "#121420" || backgroundColor === "#000000" || backgroundColor.startsWith("#1");
      const cardColor = isDarkBg ? "#121420" : "#ffffff";
      const textColor = isDarkBg ? "#ffffff" : "#1e293b";

      const categoryNames = categoriesData
        .map((category) => String(category.nome || ""))
        .filter(Boolean);

      // Map social networks dynamically from JSON object or Array
      let mappedSocials: SocialNetwork[] = [];
      let whatsappNumber = "";
      const socials = parseStructuredValue(restaurant.socials);
      if (socials && typeof socials === "object" && !Array.isArray(socials)) {
        const socialRecord = socials as Record<string, unknown>;
        if (socialRecord.whatsapp) {
          whatsappNumber = String(socialRecord.whatsapp).replace(/\D/g, "");
        }
        Object.entries(socialRecord).forEach(([platform, value]) => {
          if (value) {
            let url = String(value);
            if (platform === "instagram" && !url.startsWith("http")) {
              url = `https://instagram.com/${url.replace("@", "")}`;
            } else if (platform === "whatsapp") {
              url = `https://wa.me/${url.replace(/\D/g, "")}`;
            }
            mappedSocials.push({
              platform: platform === "instagram" ? "Instagram" : platform === "whatsapp" ? "WhatsApp" : platform,
              url,
              active: true
            });
          }
        });
      } else if (Array.isArray(socials)) {
        mappedSocials = socials
          .filter((item) => item && typeof item === "object")
          .map((item: Record<string, unknown>) => ({
            platform: String(item.platform || ""),
            url: String(item.url || ""),
            active: item.active !== false,
          }))
          .filter((item) => item.platform && item.url);
        const whatsapp = mappedSocials.find(
          (item) => item.platform.toLowerCase() === "whatsapp"
        );
        if (whatsapp) {
          whatsappNumber = whatsapp.url.replace(/\D/g, "");
        }
      }

      // Map operating hours dynamically from JSON object or Array
      let mappedHours: OperatingHours[] = [];
      const operatingHours = parseStructuredValue(
        restaurant.horarios_funcionamento
      );
      if (operatingHours && typeof operatingHours === "object") {
        if (!Array.isArray(operatingHours)) {
          mappedHours = Object.entries(operatingHours).map(([key, value]) => {
            let days = key;
            if (key === "segunda_a_sexta") days = "Segunda a Sexta";
            else if (key === "segunda_a_quinta") days = "Segunda a Quinta";
            else if (key === "sexta_e_sabado") days = "Sexta e Sábado";
            else if (key === "sabado") days = "Sábado";
            else if (key === "domingo") days = "Domingo";
            else if (key === "domingo_e_feriados") days = "Domingos e Feriados";
            
            return { days, hours: String(value) };
          });
        } else {
          mappedHours = operatingHours
            .filter((item) => item && typeof item === "object")
            .map((item: Record<string, unknown>) => ({
              days: String(item.days || ""),
              hours: String(item.hours || ""),
            }))
            .filter((item) => item.days && item.hours);
        }
      }

      // Map accepted payment methods dynamically from JSON array
      let mappedPayments: PaymentMethodGroup[] = [];
      const acceptedPayments = parseStructuredValue(
        restaurant.formas_pagamento_aceitas
      );
      if (Array.isArray(acceptedPayments)) {
        const paymentNames = acceptedPayments
          .filter((item) => typeof item === "string")
          .map((item) => item.toLocaleLowerCase("pt-BR"));
        const configuredGroups = acceptedPayments
          .filter((item) => item && typeof item === "object")
          .map((item: Record<string, unknown>) => ({
            type: String(item.type || ""),
            accepted: Array.isArray(item.accepted)
              ? item.accepted.map(String)
              : [],
          }))
          .filter((item) => item.type);
        mappedPayments.push(...configuredGroups);

        if (paymentNames.some((name) => name.includes("crédito") || name === "credito")) {
          mappedPayments.push({ type: "Cartão de Crédito", accepted: ["Visa", "Mastercard", "Elo"] });
        }
        if (paymentNames.some((name) => name.includes("débito") || name === "debito")) {
          mappedPayments.push({ type: "Cartão de Débito", accepted: ["Visa Electron", "Maestro"] });
        }
        if (paymentNames.includes("pix")) {
          mappedPayments.push({ type: "Pix", accepted: ["Pagamento na entrega"] });
        }
        if (paymentNames.includes("dinheiro")) {
          mappedPayments.push({ type: "Dinheiro", accepted: ["Cédulas e Moedas na entrega"] });
        }
      }

      const logoUrl = getRestaurantAssetUrl(
        restaurant.logo_url || "",
        true
      );
      const bannerUrl = getRestaurantAssetUrl(
        restaurant.banner_url || "",
        false
      );
      const statusOverride = String(
        restaurant.status_override || "Automático"
      ).toLocaleLowerCase("pt-BR");

      const newBrand: BrandConfig = {
        id: String(restaurant.id),
        name: String(restaurant.nome || "Restaurante"),
        slogan: String(restaurant.subtitulo || ""),
        logo: logoUrl,
        bannerImage: bannerUrl,
        phone: whatsappNumber,
        address: String(restaurant.endereco || ""),
        colors: {
          primary: primaryColor,
          background: backgroundColor,
          secondary: isDarkBg ? "#121420" : "#f1f5f9",
          text: textColor,
          card: cardColor,
          accent: primaryColor
        },
        categories: categoryNames,
        products: mappedProducts,
        socials: mappedSocials,
        about: String(restaurant.sobre_nos || ""),
        paymentMethods: mappedPayments,
        operatingHours: mappedHours,
        googleMapsUrl: String(restaurant.google_maps_url || ""),
        storeStatus: statusOverride.includes("fech")
          ? "closed"
          : statusOverride.includes("abert")
            ? "open"
            : "automatic",
      };

      setActiveBrand(newBrand);
      checkActiveOrder(Number(newBrand.id));
    } catch (err) {
      console.error("Falha ao carregar cardápio público:", err);
      setActiveBrand(null);
      setErrorMsg(
        err instanceof Error && err.message === "CARDAPIO_NOT_FOUND"
          ? "Cardápio não encontrado ou ainda não publicado."
          : "O cardápio está temporariamente indisponível. Tente novamente."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRestaurantData();
  }, [loadRestaurantData]);

  // Load the local contact profile on mount
  useEffect(() => {
    const savedUser = localStorage.getItem("whitelabel_menu_current_user");
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem("whitelabel_menu_current_user");
      }
    }
  }, []);

  // Update categories active state when active brand changes
  useEffect(() => {
    if (!activeBrand) return;
    setActiveCategory(activeBrand.categories[0] || "Destaques");
    
    // Sync brand colors with root element CSS variables
    const root = document.documentElement;
    root.style.setProperty("--color-brand-primary", activeBrand.colors.primary);
    root.style.setProperty("--color-brand-bg", activeBrand.colors.background);
    root.style.setProperty("--color-brand-text", activeBrand.colors.text || "#1c1917");
    root.style.setProperty("--color-brand-secondary", activeBrand.colors.secondary || "#1f2937");
    root.style.setProperty("--color-brand-card", activeBrand.colors.card || "#ffffff");
    root.style.setProperty("--color-brand-accent", activeBrand.colors.accent || "#ef4444");
    
    // Update body background color to match the selected brand
    document.body.style.backgroundColor = activeBrand.colors.background;
    document.body.style.color = activeBrand.colors.text || "#1c1917";
  }, [activeBrand]);

  // Connect to WebSocket to listen for reactive whitelabel changes
  useEffect(() => {
    if (!activeBrand) return;

    const wsUrl = `${WS_BASE_URL}/ws/cliente?restaurante_id=${activeBrand.id}`;

    let ws: WebSocket;
    let reconnectTimeout: any;
    let currentDelay = 2000;

    const connectWS = () => {
      if (document.hidden) return;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        currentDelay = 2000;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          const eventName = data.event || data.type;
          if (
            eventName === "catalog_updated"
            || eventName === "config_updated"
            || eventName === "store_status_changed"
          ) {
            loadRestaurantData();
          }
        } catch (err) {
          console.error("Erro ao processar mensagem do WebSocket:", err);
        }
      };

      ws.onerror = (err) => {
        console.warn("Erro na conexão do WebSocket:", err);
      };

      ws.onclose = () => {
        if (!document.hidden) {
          reconnectTimeout = setTimeout(connectWS, currentDelay);
          currentDelay = Math.min(currentDelay * 1.5, 30000);
        }
      };
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          currentDelay = 2000;
          connectWS();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    connectWS();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [activeBrand?.id]);

  const handleLoginSuccess = (profile: any) => {
    setUser(profile);
    localStorage.setItem("whitelabel_menu_current_user", JSON.stringify(profile));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem("whitelabel_menu_current_user");
    setIsAuthOpen(false);
  };

  const handleAddToCart = (
    product: Product,
    quantity: number,
    selectedOptions: Record<string, ProductOption[]>,
    notes: string
  ) => {
    // Generate a unique key for the cart item based on product ID and selected options
    const optionIds = Object.values(selectedOptions)
      .flatMap((list) => list.map((o) => o.id))
      .sort()
      .join("-");
    const cartItemId = `${product.id}-${optionIds}-${notes.slice(0, 10)}`;

    const existingIndex = cart.findIndex((item) => item.id === cartItemId);

    if (existingIndex > -1) {
      const updated = [...cart];
      updated[existingIndex].quantity += quantity;
      setCart(updated);
    } else {
      const newItem: CartItem = {
        id: cartItemId,
        product,
        quantity,
        selectedOptions,
        notes
      };
      setCart([...cart, newItem]);
    }
  };

  const handleFastAdd = (product: Product) => {
    // If product has modifiers, open the detailed configuration modal
    if (product.modifiers && product.modifiers.length > 0) {
      setSelectedProduct(product);
    } else {
      // Direct instant add to cart
      handleAddToCart(product, 1, {}, "");
    }
  };

  const handleFastAddById = (productId: string) => {
    if (!activeBrand) return;
    const item = activeBrand.products.find((i) => i.id === productId);
    if (item && item.isAvailable !== false) {
      handleFastAdd(item);
    }
  };

  const handleUpdateQty = (itemId: string, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveItem(itemId);
      return;
    }
    const updated = cart.map((item) => {
      if (item.id === itemId) {
        return { ...item, quantity: newQty };
      }
      return item;
    });
    setCart(updated);
  };

  const handleRemoveItem = (itemId: string) => {
    const filtered = cart.filter((item) => item.id !== itemId);
    setCart(filtered);
  };

  const handleCheckoutSuccess = () => {
    setCart([]); // Clear cart
    setIsCartOpen(false);
    setIsCheckoutOpen(false);
    setCheckoutRequest(null);
  };

  const handlePlaceOrder = (orderPayload: CardapioCheckoutRequest) => {
    setCheckoutRequest(orderPayload);
    setIsCheckoutOpen(true);
  };

  // Calculate categories that actually contain products matching the search query
  const visibleCategories = activeBrand
    ? activeBrand.categories.filter((cat) => {
        const sectionProducts = cat === "Destaques"
          ? activeBrand.products.slice(0, 3)
          : activeBrand.products.filter(item => item.category === cat);
        
        const filtered = sectionProducts.filter(item =>
          smartSearchMatch(`${item.name} ${item.description || ''}`, searchQuery)
        );

        return filtered.length > 0;
      })
    : [];

  // ScrollSpy with IntersectionObserver + Bottom of page check
  useEffect(() => {
    if (!activeBrand) return;
    const handleScroll = () => {
      if (isProgrammaticScroll.current) return;
      if (window.innerHeight + window.pageYOffset >= document.documentElement.scrollHeight - 35) {
        if (visibleCategories.length > 0) {
          const lastCat = visibleCategories[visibleCategories.length - 1];
          setActiveCategory(lastCat);
        }
      }
    };

    const observerOptions = {
      root: null,
      rootMargin: "-80px 0px -60% 0px",
      threshold: 0
    };

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      if (isProgrammaticScroll.current) return;
      if (window.innerHeight + window.pageYOffset >= document.documentElement.scrollHeight - 35) {
        return;
      }

      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const categoryId = entry.target.id;
          const foundCategory = activeBrand.categories.find(
            (cat) => getCategoryId(cat) === categoryId
          );
          if (foundCategory) {
            setActiveCategory(foundCategory);
          }
        }
      });
    };

    const observer = new IntersectionObserver(handleIntersection, observerOptions);

    activeBrand.categories.forEach((cat) => {
      const element = document.getElementById(getCategoryId(cat));
      if (element) {
        observer.observe(element);
      }
    });

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", handleScroll);
    };
  }, [activeBrand, searchQuery, visibleCategories]);

  // Calculate dynamic style properties for whitelabel branding
  const styleVariables = activeBrand ? {
    "--color-brand-primary": activeBrand.colors.primary,
    "--color-brand-bg": activeBrand.colors.background,
    "--color-brand-text": activeBrand.colors.text || "#1c1917",
    "--color-brand-secondary": activeBrand.colors.secondary || "#1f2937",
    "--color-brand-card": activeBrand.colors.card || "#ffffff",
    "--color-brand-accent": activeBrand.colors.accent || "#ef4444",
  } as React.CSSProperties : {} as React.CSSProperties;

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((acc, item) => {
    let price = item.product.price;
    Object.values(item.selectedOptions).forEach((opts) => {
      (opts as ProductOption[]).forEach((o) => {
        price += o.extraPrice;
      });
    });
    return acc + price * item.quantity;
  }, 0);

  const handleQuickSidebarCheckout = () => {
    setSidebarError("");

    if (!user) {
      setSidebarError("Clique em 'Entrar' no menu para fazer o pedido.");
      setIsAuthOpen(true);
      return;
    }

    if (deliveryMethod === "delivery" && !address.trim()) {
      setSidebarError("Preencha o seu endereço de entrega no painel direito.");
      return;
    }

    if (cart.length === 0) {
      setSidebarError("Sua sacola está vazia.");
      return;
    }

    const deliveryFee = deliveryMethod === "delivery" ? 7.00 : 0;

    const orderPayload: CardapioCheckoutRequest = {
      deliveryFee,
      deliveryMethod,
      address: deliveryMethod === "delivery" ? address : "Retirada no Balcão",
      customerName: user.name,
      customerPhone: user.phone || ""
    };

    handlePlaceOrder(orderPayload);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#090a0f] text-slate-100 flex flex-col items-center justify-center p-6 font-sans">
        <div className="flex flex-col items-center space-y-4 max-w-sm text-center animate-pulse">
          <div className="w-12 h-12 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin" />
          <h2 className="font-display font-extrabold text-sm uppercase tracking-wider text-slate-300">
            Carregando Cardápio Digital
          </h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            Carregando os produtos e a identidade do restaurante...
          </p>
        </div>
      </div>
    );
  }

  if (errorMsg || !activeBrand) {
    return (
      <div className="min-h-screen bg-[#090a0f] text-slate-100 flex flex-col items-center justify-center p-6 font-sans">
        <div className="flex flex-col items-center space-y-6 max-w-md text-center p-8 rounded-3xl border border-red-500/10 bg-red-500/[0.02]">
          <div className="w-14 h-14 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center border border-red-500/20">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="space-y-2">
            <h2 className="font-display font-black text-lg text-red-500 uppercase tracking-wide">
              Estabelecimento Não Encontrado
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {errorMsg || "Não foi possível carregar os dados deste estabelecimento no momento."}
            </p>
          </div>
          <button
            onClick={() => loadRestaurantData()}
            className="px-5 py-2.5 bg-emerald-500 text-slate-950 font-black text-[10px] uppercase tracking-wider rounded-xl hover:opacity-90 active:scale-95 transition cursor-pointer"
          >
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ ...styleVariables, overflowX: 'clip' } as React.CSSProperties}
      className="min-h-screen bg-bg-app text-text-app flex flex-col font-sans selection:bg-primary/20 selection:text-primary transition-all duration-300"
      id="app-root-container"
    >
      {/* 1. TOP HEADER NAVIGATION BAR */}
      <CardapioHeader
        activeBrand={activeBrand}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        user={user}
        onAuthClick={() => {
          if (user) {
            setIsProfileOpen(true);
          } else {
            setIsAuthOpen(true);
          }
        }}
        onLogoClick={() => setIsStoreInfoOpen(true)} // Open Left Info Drawer
        onCartToggle={() => setIsCartOpen(!isCartOpen)}
        cartCount={cartCount}
      />

      {/* 2. MAIN WEBSITE BODY CONTAINER */}
      <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col lg:flex-row gap-6 lg:gap-8 min-w-0" id="main-content-layout">
        
        {/* LEFT COLUMN: Main Restaurant Catalog */}
        <main className="flex-1 min-w-0 flex flex-col gap-6" id="catalog-section">
          
          {/* ACTIVE ORDER BANNER (PARTE 3 - STATUS EM TEMPO REAL) */}
          {activeOrder && (() => {
            const getStatusStepIndex = (statusStr: string) => {
              const s = (statusStr || "").toLowerCase();
              if (s.includes("finaliz") || s.includes("entreg")) return 4;
              if (s.includes("transito") || s.includes("pronto") || s.includes("saiu")) return 3;
              if (s.includes("produc") || s.includes("prepar") || s.includes("cozinha")) return 2;
              return 1;
            };
            const currentStep = getStatusStepIndex(activeOrder.status);
            const steps = [
              { label: "Recebido", step: 1 },
              { label: "Em Preparo", step: 2 },
              { label: activeOrder.tipo === "delivery" || activeOrder.tipo === "Delivery" ? "Em Trânsito" : "Pronto", step: 3 },
              { label: "Entregue", step: 4 },
            ];

            return (
              <div className="w-full bg-[#121214] border border-emerald-500/30 rounded-2xl p-4 shadow-xl flex flex-col gap-3 animate-fade-in" id="active-order-banner">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl shrink-0">
                      <Clock className="w-5 h-5 animate-pulse" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-400">
                          Pedido em Andamento (#{activeOrder.numero_pedido})
                        </span>
                        <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {activeOrder.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-300 mt-0.5 font-medium">
                        Modalidade: {activeOrder.tipo === "delivery" || activeOrder.tipo === "Delivery" ? "Delivery" : "Retirada/Balcão"} • Total: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(activeOrder.total)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <button
                      type="button"
                      onClick={() => checkActiveOrder(Number(activeBrand.id))}
                      className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-bold rounded-xl transition border border-emerald-500/30 flex items-center gap-1.5 cursor-pointer"
                      id="btn-refresh-active-order"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Atualizar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        localStorage.removeItem("koma_active_order");
                        setActiveOrder(null);
                      }}
                      className="px-3 py-1.5 bg-slate-500/10 hover:bg-slate-500/20 text-gray-400 hover:text-white text-xs font-bold rounded-xl transition cursor-pointer"
                      id="btn-new-order-clear"
                    >
                      Fazer Novo Pedido
                    </button>
                  </div>
                </div>

                {/* 4-Step Progress Bar Timeline */}
                <div className="pt-2 border-t border-[#27272A] grid grid-cols-4 gap-1.5 text-center">
                  {steps.map((st) => {
                    const isPassed = currentStep >= st.step;
                    const isCurrent = currentStep === st.step;
                    return (
                      <div key={st.step} className="flex flex-col items-center gap-1">
                        <div
                          className={clsx(
                            "w-full h-1.5 rounded-full transition-all duration-500",
                            isPassed ? "bg-emerald-500 shadow-xs shadow-emerald-500/50" : "bg-[#27272A]"
                          )}
                        />
                        <span
                          className={clsx(
                            "text-[10px] font-bold tracking-tight block",
                            isCurrent
                              ? "text-emerald-400 animate-pulse"
                              : isPassed
                              ? "text-gray-300"
                              : "text-gray-600"
                          )}
                        >
                          {st.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Active Brand Hero Banner (Elegant full-width banner) */}
          <div className="h-44 sm:h-56 w-full overflow-hidden relative rounded-2xl shadow-xs group" id="brand-banner-hero">
            <img 
              src={activeBrand.bannerImage} 
              alt={activeBrand.name} 
              className="w-full h-full object-cover transition duration-500 group-hover:scale-[1.01]" 
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent flex items-end p-6" />
            
            {/* Overlay Info on Banner */}
            <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 z-10">
              <div className="flex items-center gap-4">
                <img 
                  src={activeBrand.logo} 
                  alt={activeBrand.name} 
                  className="w-16 h-16 rounded-xl object-cover border-2 border-white/80 shadow-md hidden sm:block" 
                />
                <div>
                  <h1 className="font-display font-black text-xl sm:text-2xl tracking-tight leading-tight">{activeBrand.name}</h1>
                  <p className="text-xs text-slate-200/90 font-medium leading-normal mt-0.5">{activeBrand.slogan}</p>
                </div>
              </div>
              <div className="text-[11px] font-semibold bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/15 self-start sm:self-auto flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    activeBrand.storeStatus === "open"
                      ? "bg-emerald-400 animate-pulse"
                      : activeBrand.storeStatus === "closed"
                        ? "bg-red-400"
                        : "bg-amber-300"
                  }`}
                />
                <span>
                  {activeBrand.storeStatus === "open"
                    ? "Estabelecimento Aberto"
                    : activeBrand.storeStatus === "closed"
                      ? "Estabelecimento Fechado"
                      : "Consulte os horários"}
                </span>
              </div>
            </div>
          </div>

          {/* Sticky horizontal Categories navigation bar (Dynamic visibility matching the search matches) */}
          <CardapioCategoryNav
            categories={visibleCategories}
            activeCategory={activeCategory}
            onSelectCategory={(category) => {
              setActiveCategory(category);
              isProgrammaticScroll.current = true;
              const element = document.getElementById(getCategoryId(category));
              if (element) {
                const yOffset = -80; // altura aproximada da barra fixa do topo
                const scrollY = window.scrollY !== undefined ? window.scrollY : (window.pageYOffset !== undefined ? window.pageYOffset : (document.documentElement.scrollTop || 0));
                const y = element.getBoundingClientRect().top + scrollY + yOffset;
                
                try {
                  window.scrollTo({ top: y, behavior: 'smooth' });
                } catch (err) {
                  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }

                // Clear programmatic block after transition time
                setTimeout(() => {
                  isProgrammaticScroll.current = false;
                }, 1000);
              } else {
                isProgrammaticScroll.current = false;
              }
            }}
          />

          {/* Food Items Catalog Feed (Renders as Continuous Scroll categorized list) */}
          <div className="flex flex-col gap-10" id="catalog-feed">
            {visibleCategories.length === 0 ? (
              <div className="p-12 text-center bg-card-app rounded-2xl border border-slate-500/10 shadow-xs animate-fade-in">
                <p className="text-text-app/50 text-xs font-medium">
                  {activeBrand.products.length === 0
                    ? "Este restaurante ainda não publicou itens no cardápio."
                    : "Nenhum item encontrado para a sua busca."}
                </p>
              </div>
            ) : (
              visibleCategories.map((cat) => {
                const sectionProducts = cat === "Destaques"
                  ? activeBrand.products.slice(0, 3)
                  : activeBrand.products.filter(item => item.category === cat);
                
                const filteredCatProducts = sectionProducts.filter(item =>
                  smartSearchMatch(`${item.name} ${item.description || ''}`, searchQuery)
                );

                return (
                  <div 
                    key={cat} 
                    id={getCategoryId(cat)}
                    className="flex flex-col gap-4 scroll-mt-24 transition-all duration-300"
                  >
                    {/* Section Header with clear category title and count */}
                    <div className="flex items-center justify-between border-b border-slate-500/10 pb-2.5">
                      <h2 className="text-sm font-extrabold text-text-app tracking-tight uppercase flex items-center gap-2">
                        <span className="w-1.5 h-4 bg-primary rounded-full text-primary"></span>
                        {cat}
                      </h2>
                      <span className="text-[10px] font-bold text-text-app/50 uppercase bg-slate-500/10 px-2.5 py-1 rounded-full">
                        {filteredCatProducts.length} {filteredCatProducts.length === 1 ? 'item' : 'itens'}
                      </span>
                    </div>

                    {/* Products Grid for this category */}
                    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${
                      isCartOpen ? "lg:grid-cols-2" : "lg:grid-cols-3"
                    }`}>
                      {filteredCatProducts.map((item) => (
                        <CardapioProductCard
                          key={item.id}
                          product={item}
                          onSelectProduct={setSelectedProduct}
                          onFastAdd={handleFastAdd}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Minimalist Copyright Footer with Socials */}
          <footer className="mt-8 pt-8 pb-4 border-t border-slate-500/10 text-center flex flex-col items-center gap-4 shrink-0" id="catalog-footer">
            <div className="flex items-center gap-2">
              <img src={activeBrand.logo} alt={activeBrand.name} className="h-7 w-7 rounded-lg object-cover border border-slate-500/10 shadow-3xs" />
              <span className="font-display font-extrabold text-xs text-text-app/80 uppercase tracking-wider">{activeBrand.name}</span>
            </div>
            
            {/* Social Networks on Footer */}
            {activeBrand.socials && activeBrand.socials.some(s => s.active) && (
              <div className="flex items-center justify-center gap-4" id="footer-socials">
                {activeBrand.socials
                  .filter((s) => s.active)
                  .map((s, idx) => (
                    <a
                      key={idx}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold text-text-app/40 hover:text-primary hover:underline transition uppercase tracking-widest"
                    >
                      {s.platform}
                    </a>
                  ))}
              </div>
            )}

            <p className="text-[10px] text-text-app/45 font-medium">
              © {new Date().getFullYear()} {activeBrand.name}. Todos os direitos reservados.
            </p>
          </footer>

        </main>

        {/* RIGHT COLUMN: Collapsible Sidebar Shopping Cart on desktop (shown when isCartOpen = true) */}
        {isCartOpen && (
          <aside
            className="hidden lg:flex flex-col w-96 bg-card-app rounded-2xl border border-slate-500/10 p-6 shrink-0 h-[calc(100vh-140px)] sticky top-28 shadow-xs justify-between animate-slide-left"
            id="desktop-shopping-cart-sidebar"
          >
            <div className="flex-1 flex flex-col min-h-0">
              {/* Sidebar Header with Close Button */}
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-500/10 shrink-0">
                <h2 className="font-display text-sm font-extrabold text-text-app flex items-center gap-2 uppercase tracking-wide">
                  <ShoppingBag className="w-4.5 h-4.5 text-primary" />
                  Sua Sacola
                  {cartCount > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary text-[9px] font-black text-white">
                      {cartCount}
                    </span>
                  )}
                </h2>
                <button
                  onClick={() => setIsCartOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-slate-500/15 text-text-app/40 hover:text-text-app transition cursor-pointer"
                  title="Fechar sacola"
                  id="btn-close-desktop-sidebar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {cart.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                  <div className="w-14 h-14 rounded-full bg-slate-500/10 flex items-center justify-center text-text-app/30 mb-3 border border-slate-500/10">
                    <ShoppingBag className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-bold text-text-app/60">Sua sacola está vazia</p>
                  <p className="text-[10px] text-text-app/40 max-w-[200px] mt-1.5 leading-normal">
                    Selecione itens no cardápio para adicionar ao seu pedido e finalizar por aqui!
                  </p>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0 justify-between">
                  {/* Scrollable list of cart items */}
                  <div className="max-h-44 overflow-y-auto pr-1 no-scrollbar space-y-3 pb-4 border-b border-slate-800 shrink-0">
                    {cart.map((item) => {
                      let itemPrice = item.product.price;
                      const optionNames: string[] = [];
                      Object.values(item.selectedOptions).forEach((opts) => {
                        (opts as ProductOption[]).forEach((o) => {
                          itemPrice += o.extraPrice;
                          optionNames.push(o.name);
                        });
                      });

                      return (
                        <div key={item.id} className="flex items-start gap-2.5 p-2 rounded-xl border border-slate-500/10 bg-slate-500/5 hover:bg-slate-500/10 transition">
                          <img src={getProductImageUrl(item.product.image)} alt={item.product.name} className="w-10 h-10 rounded-lg object-cover shrink-0 shadow-xs" />
                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs font-bold text-text-app truncate leading-tight">{item.product.name}</h4>
                            {optionNames.length > 0 && (
                              <p className="text-[9px] text-text-app/40 truncate leading-none mt-0.5">{optionNames.join(", ")}</p>
                            )}
                            <span className="text-[10px] font-bold text-text-app/80 block mt-1">
                              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(itemPrice * item.quantity)}
                            </span>
                          </div>
                          
                          {/* Quantity controls */}
                          <div className="flex items-center gap-1 rounded-full border border-slate-500/15 bg-card-app p-0.5 shrink-0 shadow-xs">
                            <button
                              onClick={() => handleUpdateQty(item.id, item.quantity - 1)}
                              className="w-4.5 h-4.5 rounded-full bg-slate-500/15 flex items-center justify-center text-text-app/70 text-[10px] font-bold hover:bg-slate-500/25 transition cursor-pointer"
                            >
                              -
                            </button>
                            <span className="text-[10px] font-bold w-4 text-center text-text-app">{item.quantity}</span>
                            <button
                              onClick={() => handleUpdateQty(item.id, item.quantity + 1)}
                              className="w-4.5 h-4.5 rounded-full bg-slate-500/15 flex items-center justify-center text-text-app/70 text-[10px] font-bold hover:bg-slate-500/25 transition cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Quick checkout fields (Middle) */}
                  <div className="flex-1 overflow-y-auto py-3 space-y-3 min-h-0 no-scrollbar">
                    {/* Delivery vs Pickup switch */}
                    <div className="grid grid-cols-2 gap-1 bg-slate-500/5 p-1 rounded-xl border border-slate-500/10">
                      <button
                        onClick={() => setDeliveryMethod("delivery")}
                        className={`py-1.5 text-[10px] font-bold rounded-lg transition cursor-pointer ${
                          deliveryMethod === "delivery" ? "bg-primary text-white shadow-xs" : "text-text-app/50"
                        }`}
                      >
                        Delivery (Entrega)
                      </button>
                      <button
                        onClick={() => setDeliveryMethod("pickup")}
                        className={`py-1.5 text-[10px] font-bold rounded-lg transition cursor-pointer ${
                          deliveryMethod === "pickup" ? "bg-primary text-white shadow-xs" : "text-text-app/50"
                        }`}
                      >
                        Retirada Balcão
                      </button>
                    </div>

                    {deliveryMethod === "delivery" && (
                      <div className="space-y-2 border-t border-slate-500/5 pt-2">
                        <div className="flex gap-2">
                          <div className="flex-1 space-y-1">
                            <label className="text-[9px] font-extrabold text-text-app/40 uppercase tracking-wider block">CEP</label>
                            <div className="relative">
                              <input
                                type="text"
                                placeholder="00000-000"
                                value={cep}
                                onChange={handleCEPChange}
                                className="w-full rounded-xl border border-slate-500/10 bg-slate-500/5 p-2 pr-8 text-xs text-text-app focus:border-primary outline-hidden transition"
                              />
                              {cepLoading && (
                                <span className="absolute right-2.5 top-2.5 flex h-3 w-3">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                                </span>
                              )}
                            </div>
                          </div>
                          {cepError && (
                            <div className="self-end pb-2 text-[9px] font-bold text-red-500">
                              {cepError}
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div className="col-span-2 space-y-1">
                            <label className="text-[9px] font-extrabold text-text-app/40 uppercase tracking-wider block">Rua / Logradouro</label>
                            <input
                              type="text"
                              placeholder="Ex: Rua Augusta"
                              value={logradouro}
                              onChange={(e) => setLogradouro(e.target.value)}
                              className="w-full rounded-xl border border-slate-500/10 bg-slate-500/5 p-2 text-xs text-text-app focus:border-primary outline-hidden transition"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-extrabold text-text-app/40 uppercase tracking-wider block">Número</label>
                            <input
                              ref={numeroInputRef}
                              type="text"
                              placeholder="Nº"
                              value={numero}
                              onChange={(e) => setNumero(e.target.value)}
                              className="w-full rounded-xl border border-slate-500/10 bg-slate-500/5 p-2 text-xs text-text-app focus:border-primary outline-hidden transition"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] font-extrabold text-text-app/40 uppercase tracking-wider block">Bairro</label>
                          <input
                            type="text"
                            placeholder="Ex: Centro"
                            value={bairro}
                            onChange={(e) => setBairro(e.target.value)}
                            className="w-full rounded-xl border border-slate-500/10 bg-slate-500/5 p-2 text-xs text-text-app focus:border-primary outline-hidden transition"
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div className="col-span-2 space-y-1">
                            <label className="text-[9px] font-extrabold text-text-app/40 uppercase tracking-wider block">Cidade</label>
                            <input
                              type="text"
                              placeholder="Ex: São Paulo"
                              value={cidade}
                              onChange={(e) => setCidade(e.target.value)}
                              className="w-full rounded-xl border border-slate-500/10 bg-slate-500/5 p-2 text-xs text-text-app focus:border-primary outline-hidden transition"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-extrabold text-text-app/40 uppercase tracking-wider block">UF</label>
                            <input
                              type="text"
                              placeholder="SP"
                              maxLength={2}
                              value={estado}
                              onChange={(e) => setEstado(e.target.value.toUpperCase())}
                              className="w-full rounded-xl border border-slate-500/10 bg-slate-500/5 p-2 text-xs text-text-app focus:border-primary outline-hidden transition"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-blue-500/15 bg-blue-500/5 p-2.5">
                      <p className="text-[9px] font-extrabold text-text-app/60 uppercase tracking-wider">Pagamento no atendimento</p>
                      <p className="mt-1 text-[10px] text-text-app/45 leading-relaxed">
                        O restaurante confirmará as formas de pagamento disponíveis ao aceitar o pedido.
                      </p>
                    </div>
                  </div>

                  {/* Pricing Breakdown & Action Button (Bottom - Fixed at Footer) */}
                  <div className="pt-3 border-t border-slate-500/15 bg-card-app shrink-0 space-y-3">
                    {/* Pricing Breakdown */}
                    <div className="space-y-1 text-xs pt-1">
                      <div className="flex justify-between text-text-app/50 text-[11px]">
                        <span>Subtotal</span>
                        <span>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cartTotal)}</span>
                      </div>
                      {deliveryMethod === "delivery" && (
                        <div className="flex justify-between text-text-app/50 text-[11px]">
                          <span>Taxa de Entrega</span>
                          <span>R$ 7,00</span>
                        </div>
                      )}
                      <div className="flex justify-between font-extrabold text-text-app pt-1.5 border-t border-slate-500/15 text-xs">
                        <span>VALOR TOTAL</span>
                        <span className="text-primary text-sm font-black">
                          {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
                            cartTotal + (deliveryMethod === "delivery" ? 7 : 0)
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Validation notice / Error notification */}
                    {sidebarError && (
                      <div className="p-2 bg-red-500/10 border border-red-500/25 text-red-400 rounded-xl text-[10px] font-bold text-center animate-pulse">
                        {sidebarError}
                      </div>
                    )}

                    {/* Checkout button */}
                    <button
                      onClick={handleQuickSidebarCheckout}
                      className="w-full py-2.5 bg-primary text-white text-xs font-black rounded-xl shadow-xs hover:opacity-95 transition uppercase tracking-wider cursor-pointer"
                    >
                      Confirmar e Enviar Pedido
                    </button>
                    <p className="text-[9px] text-center text-text-app/40 leading-normal">Seu pedido será enviado instantaneamente ao painel da cozinha!</p>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}

      {/* 3. MOBILE STICKY BOTTOM BAR (iFood-style — only shows on mobile when cart has items) */}
      {cartCount > 0 && (
        <div className="lg:hidden fixed bottom-0 left-0 w-full z-30 px-4 pb-5 pt-2">
          <button
            onClick={() => setIsCartOpen(true)}
            className="w-full flex items-center justify-between gap-3 rounded-2xl bg-primary text-white px-5 h-14 shadow-xl hover:opacity-95 active:scale-[0.99] transition cursor-pointer"
            id="floating-cart-trigger"
          >
            {/* Left: item count badge + label */}
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-white/20 text-xs font-black shrink-0">
                {cartCount}
              </div>
              <div className="flex flex-col items-start leading-tight">
                <span className="text-[11px] font-black uppercase tracking-wide">Ver Sacola</span>
                <span className="text-[10px] font-medium text-white/80">{cartCount} {cartCount === 1 ? 'item' : 'itens'}</span>
              </div>
            </div>
            {/* Right: total + arrow */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-black">
                {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cartTotal)}
              </span>
              <ArrowRight className="h-4 w-4 text-white/80" />
            </div>
          </button>
        </div>
      )}

      </div>{/* end: #main-content-layout */}

      {/* MODALS AND DRAWERS (FULLY RESPONSIVE) */}

      {/* Product Details Modal */}
      {selectedProduct && (
        <CardapioProductModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onAddToCart={handleAddToCart}
        />
      )}

      {/* Mobile Cart Drawer (Slide up — only visible on mobile/tablet, desktop uses the sidebar) */}
      {isCartOpen && window.innerWidth < 1024 && (
        <CardapioCartDrawer
          cart={cart}
          onClose={() => setIsCartOpen(false)}
          onUpdateQty={handleUpdateQty}
          onRemoveItem={handleRemoveItem}
          onPlaceOrder={handlePlaceOrder}
          user={user}
          onAuthClick={() => setIsAuthOpen(true)}
        />
      )}

      {/* User Login/Register Modal */}
      {isAuthOpen && activeBrand?.id && (
        <CardapioAuthModal
          onClose={() => setIsAuthOpen(false)}
          onLoginSuccess={handleLoginSuccess}
        />
      )}

      {/* Customer contact profile */}
      {isProfileOpen && (
        <CardapioUserProfileModal
          onClose={() => setIsProfileOpen(false)}
          user={user}
          onProfileUpdate={handleLoginSuccess}
          onLogout={handleLogout}
        />
      )}

      {/* DIGITAL ORDER REVIEW */}
      {isCheckoutOpen && checkoutRequest && (
        <CardapioDigital
          activeBrand={activeBrand}
          cart={cart}
          deliveryFee={checkoutRequest.deliveryFee}
          deliveryMethod={checkoutRequest.deliveryMethod}
          address={checkoutRequest.address}
          customerName={checkoutRequest.customerName}
          customerPhone={checkoutRequest.customerPhone}
          onClose={() => {
            setIsCheckoutOpen(false);
            setCheckoutRequest(null);
          }}
          onOrderSuccess={handleCheckoutSuccess}
        />
      )}

      {/* STORE INFO DRAWER (LEFT SLIDE OUT) */}
      <CardapioStoreInfoDrawer
        brand={activeBrand}
        isOpen={isStoreInfoOpen}
        onClose={() => setIsStoreInfoOpen(false)}
      />

      {/* FLOATING AI ASSISTANT */}
      <CardapioAiChefAssistant activeBrand={activeBrand} hasCart={cartCount > 0} />

    </div>
  );
}
