/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { Product, BrandConfig, ProductOption, getProductImageUrl } from "./CardapioTypes";
import { whitelabelBrands } from "./CardapioConfig";
import { supabase } from "./SupabaseClient";
import CardapioHeader from "./components/CardapioHeader";
import CardapioCategoryNav from "./components/CardapioCategoryNav";
import CardapioProductCard from "./components/CardapioProductCard";
import CardapioProductModal from "./components/CardapioProductModal";
import CardapioCartDrawer, { CartItem } from "./components/CardapioCartDrawer";
import CardapioAuthModal from "./components/CardapioAuthModal";
import CardapioOrderHistoryModal from "./components/CardapioOrderHistoryModal";
import CardapioUserProfileModal from "./components/CardapioUserProfileModal";
import CardapioDigital from "./components/CardapioDigital";
import CardapioStoreInfoDrawer from "./components/CardapioStoreInfoDrawer";
import CardapioAiChefAssistant from "./components/CardapioAiChefAssistant";
import { ShoppingBag, Eye } from "lucide-react";

const getCategoryId = (name: string) =>
  'sec-' + name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');

function getRestaurantIdentifier(): string {
  // 1. Check query parameters first (high priority for testing)
  const params = new URLSearchParams(window.location.search);
  const restaurantId = params.get("restaurant_id");
  const slug = params.get("slug");
  
  if (restaurantId) return restaurantId;
  if (slug) return slug;

  // 2. Check subdomain in production
  const hostname = window.location.hostname;
  const parts = hostname.split(".");
  // If we have a subdomain and it's not 'www' or local dev/preview domains
  if (parts.length > 2 && parts[0] !== "www" && !parts[0].startsWith("ais-dev") && !parts[0].startsWith("ais-pre") && parts[0] !== "localhost") {
    return parts[0];
  }

  // Fallback to default
  return "burger"; // default fallback
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
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isOrdersOpen, setIsOrdersOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isStoreInfoOpen, setIsStoreInfoOpen] = useState(false); // Left Sidebar Information State
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // Quick Sidebar Checkout States
  const [deliveryMethod, setDeliveryMethod] = useState<"delivery" | "pickup">("delivery");
  const [address, setAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cartão de Crédito");

  // User Profile State (Simulated)
  const [user, setUser] = useState<any | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
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

  // Dynamic restaurant loading from Supabase
  useEffect(() => {
    async function loadRestaurantData() {
      setIsLoading(true);
      setErrorMsg("");
      const identifier = getRestaurantIdentifier();

      // Fallback instantly if no real Supabase key is configured to avoid pending promise loops
      const hasRealKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY && 
                         (import.meta as any).env?.VITE_SUPABASE_ANON_KEY !== "dummy-anon-key-to-prevent-bootstrap-error";

      if (!hasRealKey) {
        console.warn("Chave Supabase não configurada. Carregando dados Whitelabel de demonstração instantaneamente.");
        const fallbackBrand = whitelabelBrands.burger;
        setActiveBrand(fallbackBrand);
        setIsLoading(false);
        return;
      }

      try {
        let restaurant = null;
        
        // Try as numeric ID first if applicable
        if (/^\d+$/.test(identifier)) {
          const { data } = await supabase
            .from("restaurantes")
            .select("*")
            .eq("id", Number(identifier))
            .maybeSingle();
          if (data) restaurant = data;
        }

        // Try as slug next
        if (!restaurant) {
          const { data } = await supabase
            .from("restaurantes")
            .select("*")
            .eq("slug", identifier)
            .maybeSingle();
          if (data) restaurant = data;
        }

        // If still not found and not burger, try loading burger as default
        if (!restaurant && identifier !== "burger") {
          const { data } = await supabase
            .from("restaurantes")
            .select("*")
            .eq("slug", "burger")
            .maybeSingle();
          if (data) restaurant = data;
        }

        // Fallback to static mock whitelabel configuration if DB has no such entry
        if (!restaurant) {
          console.warn("Restaurante não encontrado no Supabase. Usando dados mockados como fallback de demonstração.");
          const fallbackBrand = whitelabelBrands.burger;
          setActiveBrand(fallbackBrand);
          setIsLoading(false);
          return;
        }

        // Load categories
        const { data: categoriesData, error: categoriesError } = await supabase
          .from("categorias")
          .select("*")
          .eq("restaurante_id", restaurant.id);

        if (categoriesError) {
          console.error("Erro ao buscar categorias:", categoriesError);
        }

        // Sort categories by position/ordem/order
        const sortedCategories = [...(categoriesData || [])].sort((a, b) => {
          const orderA = a.ordem !== undefined ? a.ordem : (a.order !== undefined ? a.order : (a.posicao !== undefined ? a.posicao : 0));
          const orderB = b.ordem !== undefined ? b.ordem : (b.order !== undefined ? b.order : (b.posicao !== undefined ? b.posicao : 0));
          return orderA - orderB;
        });

        // Load active products
        const { data: productsData, error: productsError } = await supabase
          .from("produtos")
          .select("*")
          .eq("restaurante_id", restaurant.id);

        if (productsError) {
          console.error("Erro ao buscar produtos:", productsError);
        }

        // Filter active products
        const activeProducts = (productsData || []).filter((p) => {
          const isAtivo = p.ativo !== undefined ? p.ativo : (p.is_active !== undefined ? p.is_active : (p.active !== undefined ? p.active : true));
          return isAtivo;
        });

        // Category Map
        const categoryMap: Record<string, string> = {};
        sortedCategories.forEach((c) => {
          categoryMap[String(c.id)] = c.nome || c.name || "";
        });

        // Map products
        const mappedProducts: Product[] = activeProducts.map((p) => {
          const catName = categoryMap[String(p.categoria_id)] || "Destaques";
          
          let modifiersList = [];
          if (p.modifiers) {
            if (typeof p.modifiers === "string") {
              try { modifiersList = JSON.parse(p.modifiers); } catch(e) {}
            } else if (Array.isArray(p.modifiers)) {
              modifiersList = p.modifiers;
            }
          }

          return {
            id: String(p.id),
            name: p.nome || p.name || "",
            description: p.descricao || p.description || "",
            price: Number(p.preco || p.price || 0),
            image: getProductImageUrl(p.imagem_url || p.image || p.image_url || ""),
            category: catName,
            modifiers: modifiersList,
            isAvailable: p.disponivel !== undefined ? p.disponivel : (p.is_available !== undefined ? p.is_available : true)
          };
        });

        // Build theme options
        const primaryColor = restaurant.cor_primaria || restaurant.primary_color || "#00b894";
        const backgroundColor = restaurant.cor_fundo || restaurant.background_color || "#090a0f";
        const isDarkBg = backgroundColor.startsWith("#09") || backgroundColor === "#121420" || backgroundColor === "#000000" || backgroundColor.startsWith("#1");
        const cardColor = isDarkBg ? "#121420" : "#ffffff";
        const textColor = isDarkBg ? "#ffffff" : "#1e293b";

        const categoryNames = sortedCategories.map((c) => c.nome || c.name || "").filter(Boolean);

        const newBrand: BrandConfig = {
          id: String(restaurant.id),
          name: restaurant.nome || restaurant.name || "Restaurante",
          slogan: restaurant.slogan || "Sincronizado com o Sistema Kôma PDV",
          logo: getProductImageUrl(restaurant.logo_url || restaurant.logo || ""),
          bannerImage: getProductImageUrl(restaurant.banner_url || restaurant.banner_image || ""),
          phone: restaurant.telefone || restaurant.phone || "",
          address: restaurant.endereco || restaurant.address || "",
          colors: {
            primary: primaryColor,
            background: backgroundColor,
            secondary: isDarkBg ? "#121420" : "#f1f5f9",
            text: textColor,
            card: cardColor,
            accent: primaryColor
          },
          categories: categoryNames.length > 0 ? categoryNames : ["Geral"],
          products: mappedProducts,
          socials: Array.isArray(restaurant.socials) ? restaurant.socials : [],
          about: restaurant.about || restaurant.descricao || "",
          paymentMethods: restaurant.payment_methods || [
            { type: "Cartão de Crédito", accepted: ["Visa", "Mastercard", "Elo"] },
            { type: "Cartão de Débito", accepted: ["Visa Electron", "Maestro"] },
            { type: "Pix", accepted: ["Pix com QR Code ou Copia e Cola"] }
          ],
          operatingHours: restaurant.operating_hours || [
            { days: "Segunda a Domingo", hours: "18:00 às 23:00" }
          ],
          googleMapsUrl: restaurant.google_maps_url || `https://maps.google.com/?q=${encodeURIComponent(restaurant.endereco || "")}`
        };

        setActiveBrand(newBrand);
      } catch (err: any) {
        console.error("Erro catastrófico ao carregar dados do Supabase:", err);
        setErrorMsg("Não foi possível carregar as informações do cardápio digital a partir do Supabase.");
      } finally {
        setIsLoading(false);
      }
    }

    loadRestaurantData();
  }, []);

  // Load user and orders on mount
  useEffect(() => {
    const savedUser = localStorage.getItem("whitelabel_menu_current_user");
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    refreshOrders();
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

  const refreshOrders = () => {
    const savedOrders = localStorage.getItem("whitelabel_menu_orders");
    if (savedOrders) {
      setOrders(JSON.parse(savedOrders));
    } else {
      setOrders([]);
    }
  };

  const handleBrandChange = (brandId: string) => {
    window.location.search = `?restaurant_id=${brandId}`;
  };

  const handleLoginSuccess = (profile: any) => {
    setUser(profile);
    localStorage.setItem("whitelabel_menu_current_user", JSON.stringify(profile));
    refreshOrders();
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem("whitelabel_menu_current_user");
    setIsAuthOpen(false);
  };

  const handleReorder = (items: any[]) => {
    const updatedCart = [...cart];
    
    items.forEach((item) => {
      const { product, quantity, selectedOptions, notes } = item;
      const optionIds = Object.values(selectedOptions || {})
        .flatMap((list: any) => list.map((o: any) => o.id))
        .sort()
        .join("-");
      const cartItemId = `${product.id}-${optionIds}-${notes ? notes.slice(0, 10) : ""}`;
      
      const existingIndex = updatedCart.findIndex((ci) => ci.id === cartItemId);
      if (existingIndex > -1) {
        updatedCart[existingIndex].quantity += (quantity || 1);
      } else {
        updatedCart.push({
          id: cartItemId,
          product,
          quantity: quantity || 1,
          selectedOptions: selectedOptions || {},
          notes: notes || ""
        });
      }
    });

    setCart(updatedCart);
    setIsOrdersOpen(false);
    setIsCartOpen(true);
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

  const handleCheckoutSuccess = (newOrder: any) => {
    setCart([]); // Clear cart
    setIsCartOpen(false);
    setIsCheckoutOpen(false);
    refreshOrders();
    setIsOrdersOpen(true); // Open order status view immediately for feedback!
  };

  const handlePlaceOrder = (orderPayload: any) => {
    // Open the interactive digital checkout / payment modal instead of direct placement
    setIsCheckoutOpen(true);
  };

  // Calculate categories that actually contain products matching the search query
  const visibleCategories = activeBrand
    ? activeBrand.categories.filter((cat) => {
        const sectionProducts = cat === "Destaques"
          ? activeBrand.products.slice(0, 3)
          : activeBrand.products.filter(item => item.category === cat);
        
        const filtered = sectionProducts.filter(item => {
          const matchesSearch =
            item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.description.toLowerCase().includes(searchQuery.toLowerCase());
          return matchesSearch;
        });

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

  // Filter orders corresponding to active brand and customer
  const userOrders = activeBrand && orders ? orders.filter((o) => o.brandId === activeBrand.id && o.customerName === user?.name) : [];

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

    // Prepare order items
    const orderItems = cart.map((item) => {
      const optionDetails: string[] = [];
      Object.entries(item.selectedOptions).forEach(([groupName, opts]) => {
        const optionList = opts as any[];
        if (optionList.length > 0) {
          optionDetails.push(`${optionList.map((o) => o.name).join(", ")}`);
        }
      });

      return {
        id: item.product.id,
        name: item.product.name,
        quantity: item.quantity,
        price: item.product.price,
        notes: item.notes,
        optionsText: optionDetails.join(" | ")
      };
    });

    const deliveryFee = deliveryMethod === "delivery" ? 7.00 : 0;

    const orderPayload = {
      id: "PED-" + Math.floor(1000 + Math.random() * 9000),
      brandId: activeBrand.id,
      brandName: activeBrand.name,
      items: orderItems,
      subtotal: cartTotal,
      deliveryFee,
      discount: 0,
      total: cartTotal + deliveryFee,
      deliveryMethod,
      address: deliveryMethod === "delivery" ? address : "Retirada no Balcão",
      paymentMethod,
      customerName: user.name,
      customerPhone: user.phone || "Não informado",
      status: "pending",
      createdAt: new Date().toISOString()
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
            Sincronizando com o banco de dados do Supabase para moldar os produtos e identidade do restaurante...
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
          <a
            href="?restaurant_id=1"
            className="px-5 py-2.5 bg-emerald-500 text-slate-950 font-black text-[10px] uppercase tracking-wider rounded-xl hover:opacity-90 active:scale-95 transition"
          >
            Acessar Restaurante de Teste
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      style={styleVariables}
      className="min-h-screen bg-bg-app text-text-app flex flex-col font-sans selection:bg-primary/20 selection:text-primary transition-all duration-300"
      id="app-root-container"
    >
      {/* 1. TOP HEADER NAVIGATION BAR */}
      <CardapioHeader
        activeBrand={activeBrand}
        onBrandChange={handleBrandChange}
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
        onViewOrdersClick={() => setIsOrdersOpen(true)}
        onLogoClick={() => setIsStoreInfoOpen(true)} // Open Left Info Drawer
      />

      {/* 2. MAIN WEBSITE BODY CONTAINER */}
      <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col lg:flex-row gap-8" id="main-content-layout">
        
        {/* LEFT COLUMN: Main Restaurant Catalog */}
        <main className="flex-1 flex flex-col gap-6" id="catalog-section">
          
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
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Estabelecimento Aberto</span>
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
                <p className="text-text-app/50 text-xs font-medium">Nenhum item encontrado para a sua busca.</p>
              </div>
            ) : (
              visibleCategories.map((cat) => {
                const sectionProducts = cat === "Destaques"
                  ? activeBrand.products.slice(0, 3)
                  : activeBrand.products.filter(item => item.category === cat);
                
                const filteredCatProducts = sectionProducts.filter(item =>
                  item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  item.description.toLowerCase().includes(searchQuery.toLowerCase())
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

        {/* RIGHT COLUMN: Permanent Sidebar Shopping Cart on desktop */}
        <aside className="hidden lg:flex flex-col w-96 bg-card-app rounded-2xl border border-slate-500/10 p-6 shrink-0 h-[calc(100vh-140px)] sticky top-28 shadow-xs justify-between" id="desktop-shopping-cart-sidebar">
          <div className="flex-1 flex flex-col min-h-0">
            <h2 className="font-display text-sm font-extrabold text-text-app mb-4 flex items-center gap-2 pb-3 border-b border-slate-500/10 shrink-0 uppercase tracking-wide">
              <ShoppingBag className="w-4.5 h-4.5 text-primary" />
              Sua Sacola
            </h2>

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

                  {/* Payment method selection */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-extrabold text-text-app/40 uppercase tracking-wider block">Forma de Pagamento</label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className="w-full rounded-xl border border-slate-500/10 bg-slate-500/5 p-2 text-xs text-text-app focus:border-primary outline-hidden"
                    >
                      <option value="Cartão de Crédito" className="bg-card-app text-text-app">Cartão de Crédito (na entrega)</option>
                      <option value="Cartão de Débito" className="bg-card-app text-text-app">Cartão de Débito (na entrega)</option>
                      <option value="PIX" className="bg-card-app text-text-app">PIX (Chave na Entrega)</option>
                      <option value="Dinheiro" className="bg-card-app text-text-app">Dinheiro</option>
                    </select>
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

      </div>

      {/* 3. MOBILE FLOATING ACTION BUTTON BAR (Only shows on mobile viewports since sidebar is hidden) */}
      <div className="lg:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center justify-center gap-3 w-full max-w-md px-4">
        {cartCount > 0 ? (
          <button
            onClick={() => setIsCartOpen(true)}
            className="flex-1 flex items-center justify-between rounded-full bg-primary px-5 h-12 text-white font-bold shadow-lg hover:scale-[1.01] active:scale-[0.99] transition cursor-pointer"
            id="floating-cart-trigger"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
                {cartCount}
              </div>
              <span className="text-xs">Ver Sacola</span>
            </div>
            <span className="text-xs font-black">
              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cartTotal)}
            </span>
          </button>
        ) : (
          <div className="flex-1 flex items-center justify-center h-11 rounded-full bg-slate-900/95 backdrop-blur-md text-white/95 text-[10px] font-bold px-4 select-none shadow-md">
            Selecione itens no cardápio
          </div>
        )}
      </div>

      {/* MODALS AND DRAWERS (FULLY RESPONSIVE) */}

      {/* Product Details Modal */}
      {selectedProduct && (
        <CardapioProductModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onAddToCart={handleAddToCart}
        />
      )}

      {/* Mobile Cart Drawer (Slide up) */}
      {isCartOpen && (
        <CardapioCartDrawer
          activeBrand={activeBrand}
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
      {isAuthOpen && (
        <CardapioAuthModal
          onClose={() => setIsAuthOpen(false)}
          onLoginSuccess={handleLoginSuccess}
        />
      )}

      {/* User Profile, Fidelity and Cashback Modal */}
      {isProfileOpen && (
        <CardapioUserProfileModal
          onClose={() => setIsProfileOpen(false)}
          activeBrand={activeBrand}
          user={user}
          onProfileUpdate={handleLoginSuccess}
          onLogout={handleLogout}
        />
      )}

      {/* User past order history status modal */}
      {isOrdersOpen && (
        <CardapioOrderHistoryModal
          onClose={() => setIsOrdersOpen(false)}
          orders={userOrders}
          activeBrand={activeBrand}
          user={user}
          onReorder={handleReorder}
        />
      )}

      {/* DIGITAL CHECKOUT & PAYMENT MODAL */}
      {isCheckoutOpen && (
        <CardapioDigital
          activeBrand={activeBrand}
          cart={cart}
          subtotal={cartTotal}
          deliveryFee={deliveryMethod === "delivery" ? 7 : 0}
          discount={0}
          total={cartTotal + (deliveryMethod === "delivery" ? 7 : 0)}
          deliveryMethod={deliveryMethod}
          address={address}
          customerName={user?.name || "Cliente Convidado"}
          customerPhone={user?.phone || "(11) 99999-9999"}
          onClose={() => setIsCheckoutOpen(false)}
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
      <CardapioAiChefAssistant activeBrand={activeBrand} />

    </div>
  );
}
