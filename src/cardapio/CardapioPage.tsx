import { clearGuestCheckoutContact } from "./guestCheckoutSession";
import { allowCustomerBrowserRestore, blockCustomerBrowserRestore, closeCustomerBrowserSession, customerSignedOutKey, restoreCustomerBrowserSession } from "./customerBrowserSession";
import PixCopyCode from "./components/PixCopyCode";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CardapioFulfillment } from "./fulfillment";
import { fetchPopularProducts, registerPopularProductsAlias } from "./popularProductsClient";
import {
  fetchPublicMenu,
  getPublicMenuIdentifier,
  getPublicMenuLoadDurationMs,
} from "./publicMenuClient";
import { buildWhatsAppContactUrl } from "../config/whatsappUtils";
import { getEffectiveProductPrice, normalizeProductBadge } from "../domain/productMerchandising";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  QrCode,
  X,
  XCircle,
} from "lucide-react";
import {
  BrandConfig,
  CatalogPromotion,
  OperatingHours,
  PaymentMethodGroup,
  Product,
  ProductOption,
  SocialNetwork,
  getProductImageUrl,
  getRestaurantAssetUrl,
} from "./CardapioTypes";
import CardapioProductModal from "./components/CardapioProductModal";
import {
  isGroupedProduct,
  type GroupedDisplayProduct,
} from "./catalogGrouping";
import type { PromotionPartSelection } from "./promotionComposition";
import CardapioCartDrawer, {
  type CardapioCheckoutRequest,
  type CartItem,
} from "./components/CardapioCartDrawer";
import type { CustomerHistoryOrder } from "./components/CardapioCustomerOrderHistory";
import { ManualPixReceiptContact } from "./components/ManualPixReceiptContact";
import { DirectPixCustomerConfirm } from "./components/DirectPixCustomerConfirm";
import MenuV2Experience from "./v2/MenuV2Experience";
import { KomaLoading } from "../components/app/KomaLoading";

import { QRCodeSVG } from "qrcode.react";
import CardapioBenefitsDrawer from "./components/CardapioBenefitsDrawer";
import CardapioPromotionWizard from "./components/CardapioPromotionWizard";
import CardapioAuthModal from "./components/CardapioAuthModal";
import CardapioUserProfileModal from "./components/CardapioUserProfileModal";
import CardapioDigital from "./components/CardapioDigital";
import CardapioStoreInfoDrawer from "./components/CardapioStoreInfoDrawer";
import CardapioOrdersDrawer from "./components/CardapioOrdersDrawer";
import { API_BASE_URL, WS_BASE_URL } from "../config/api";
import {
  CustomerProfile,
  clearCustomerSession,
  loadCustomerSession,
  mapCustomerProfile,
  saveCustomerSession,
} from "./customerSession";
import {
  isOrderStateContract,
  OrderPaymentStatus,
  OrderStateContract,
  StoredOrder,
  loadStoredOrders,
  mergeLocalOrderSnapshots,
  restoreDurableStoredOrders,
  refreshAllStoredOrders,
  removeStoredOrder,
  clearAllStoredOrders,
  fallbackOrderState,
  resolveOrderState,
  updateStoredOrderStatus,
} from "./orderTracking";
import { rebuildOrderFromCurrentCatalog } from "./repeatOrder";
import {
  clearCartDraft,
  loadCartDraft,
  restoreCartDraftFromCatalog,
  saveCartDraft,
} from "./cartDraftStorage";
import { isLocalOpenStoreSimulation, isLocalOrderSimulation } from "./devSimulation";
import { trackAnalyticsEvent } from "../analytics";

const KOMA_PRIMARY = "#00b894";
const KOMA_BACKGROUND = "#090a0f";
// A consulta pública de CEP é apenas conveniência progressiva; o checkout
// permanece totalmente utilizável com preenchimento manual.

function resolveConfiguredColor(value: unknown, fallback: string): string {
  const raw = String(value || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) {
    return `#${raw.toLowerCase()}`;
  }
  return fallback;
}

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export default function CardapioPage() {
  const [activeBrand, setActiveBrand] = useState<BrandConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [fulfillmentChoice, setFulfillmentChoice] = useState<{ restaurantId: string | number; method: CardapioFulfillment } | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editingCartItem, setEditingCartItem] = useState<CartItem | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | GroupedDisplayProduct | null>(null);
  const [productModalOrigin, setProductModalOrigin] = useState<{ surface: "catalog" | "cart"; restaurantId: string | number } | null>(null);
  const [selectedPromotion, setSelectedPromotion] = useState<CatalogPromotion | null>(null);
  const [editingPromotionItem, setEditingPromotionItem] = useState<CartItem | null>(null);
  const [promotionModalOrigin, setPromotionModalOrigin] = useState<{ surface: "catalog" | "cart"; restaurantId: string | number } | null>(null);
  const previousBrandIdRef = useRef<string | number | null>(null);
  const [hydratedDraftBrandId, setHydratedDraftBrandId] = useState<string | null>(null);
  const checkoutOrderCreatedRef = useRef(false);
  const [draftRestoreIssues, setDraftRestoreIssues] = useState<string[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [checkoutRequest, setCheckoutRequest] = useState<CardapioCheckoutRequest | null>(null);
  const [isStoreInfoOpen, setIsStoreInfoOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isOrdersDrawerOpen, setIsOrdersDrawerOpen] = useState(false);
  const [isBenefitsOpen, setIsBenefitsOpen] = useState(false);
  const [couponToApply, setCouponToApply] = useState("");
  const [isRefreshingOrders, setIsRefreshingOrders] = useState(false);
  const [storedOrders, setStoredOrders] = useState<StoredOrder[]>([]);
  const storedOrdersRef = useRef(storedOrders);
  storedOrdersRef.current = storedOrders;
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [pixModalOrder, setPixModalOrder] = useState<StoredOrder | null>(null);
  const [user, setUser] = useState<CustomerProfile | null>(null);
  const [customerToken, setCustomerToken] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cartAnnouncement, setCartAnnouncement] = useState("");
  const lastReportedMenuIdRef = useRef<string | number | null>(null);

  const showNotification = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => {
      setNotice("");
    }, 1800);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  const openProductModal = useCallback((
    product: Product | GroupedDisplayProduct,
    surface: "catalog" | "cart",
    options?: { editingItem?: CartItem | null; closeCart?: boolean },
  ) => {
    setEditingCartItem(options?.editingItem ?? null);
    setProductModalOrigin(activeBrand ? { surface, restaurantId: activeBrand.id } : null);
    setSelectedProduct(product);
    if (options?.closeCart) setIsCartOpen(false);
  }, [activeBrand]);

  const closeProductModal = useCallback(() => {
    const shouldReturnToCart = Boolean(
      productModalOrigin?.surface === "cart"
      && activeBrand
      && String(productModalOrigin.restaurantId) === String(activeBrand.id),
    );
    setSelectedProduct(null);
    setEditingCartItem(null);
    setProductModalOrigin(null);
    if (shouldReturnToCart) setIsCartOpen(true);
    return shouldReturnToCart;
  }, [activeBrand, productModalOrigin]);

  const openPromotionModal = useCallback((
    offer: CatalogPromotion,
    surface: "catalog" | "cart",
    options?: { editingItem?: CartItem | null; closeCart?: boolean },
  ) => {
    setEditingPromotionItem(options?.editingItem ?? null);
    setPromotionModalOrigin(activeBrand ? { surface, restaurantId: activeBrand.id } : null);
    setSelectedPromotion(offer);
    if (options?.closeCart) setIsCartOpen(false);
  }, [activeBrand]);

  const closePromotionModal = useCallback(() => {
    const shouldReturnToCart = Boolean(
      promotionModalOrigin?.surface === "cart"
      && activeBrand
      && String(promotionModalOrigin.restaurantId) === String(activeBrand.id),
    );
    setSelectedPromotion(null);
    setEditingPromotionItem(null);
    setPromotionModalOrigin(null);
    if (shouldReturnToCart) setIsCartOpen(true);
    return shouldReturnToCart;
  }, [activeBrand, promotionModalOrigin]);

  const openCart = useCallback(() => {
    // Garante uma única superfície interativa ao abrir a sacola.
    // Em celulares reais, FABs sobrepostos podem disputar o mesmo toque.
    setSelectedProduct(null);
    setEditingCartItem(null);
    setProductModalOrigin(null);
    setSelectedPromotion(null);
    setEditingPromotionItem(null);
    setPromotionModalOrigin(null);
    setIsOrdersDrawerOpen(false);
    setIsBenefitsOpen(false);
    setIsStoreInfoOpen(false);
    setIsProfileOpen(false);
    setIsAuthOpen(false);
    setIsCartOpen(true);
  }, []);


  const activeOrders = useMemo(
    () => storedOrders.filter((order) => !resolveOrderState(order).terminal),
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

  const checkActiveOrders = useCallback(async (restaurantId: number, seedOrders?: StoredOrder[]) => {
    const currentOrders = seedOrders ?? storedOrdersRef.current;
    const simulatedOrders = currentOrders.filter((order) => String(order.id).toLowerCase().startsWith("sim-"));
    const realOrders = currentOrders.filter((order) => !String(order.id).toLowerCase().startsWith("sim-"));
    if (realOrders.length === 0) return;
    try {
      setIsRefreshingOrders(true);
      const updated = await refreshAllStoredOrders(restaurantId, API_BASE_URL, realOrders);
      setStoredOrders((current) => mergeLocalOrderSnapshots([...simulatedOrders, ...updated], current));
    } catch (error) {
      console.warn("Erro ao consultar status dos pedidos:", error);
    } finally {
      setIsRefreshingOrders(false);
    }
  }, []);

  const handleOrderPaymentUpdated = useCallback((orderId: string, nextPayment: OrderPaymentStatus) => {
    setStoredOrders((current) =>
      current.map((order) => (
        order.id === orderId
          ? { ...order, pagamento: { ...(order.pagamento || {}), ...nextPayment } }
          : order
      )),
    );
  }, []);

  const loadRestaurantData = useCallback(async (background = false) => {
    const loadStartedAt = performance.now();
    if (!background) {
      setIsLoading(true);
      setErrorMsg("");
    }
    const identifier = getPublicMenuIdentifier();
    if (!identifier) {
      if (!background) {
        setErrorMsg("Cardápio não encontrado ou ainda não publicado.");
        setIsLoading(false);
      }
      return;
    }

    try {
      const isNumericIdentifier = /^\d+$/.test(identifier);
      void fetchPopularProducts({
        apiBaseUrl: API_BASE_URL,
        slug: isNumericIdentifier ? null : identifier,
        restaurantId: isNumericIdentifier ? identifier : null,
        force: background,
      }).catch(() => []);
      const payload = await fetchPublicMenu({
        apiBaseUrl: API_BASE_URL,
        identifier,
        force: background,
      });

      const restaurant = payload.restaurante;
      if (restaurant?.id) {
        const aliasSlug = typeof restaurant.slug === "string" && restaurant.slug.trim()
          ? restaurant.slug.trim()
          : (isNumericIdentifier ? "" : identifier);
        if (aliasSlug) {
          registerPopularProductsAlias(API_BASE_URL, restaurant.id, aliasSlug);
        }
      }
      const categoryMap: Record<string, string> = {};
      payload.categorias.forEach((category) => {
        categoryMap[String(category.id)] = String(category.nome || "");
      });

      const mapPublicProduct = (product: Record<string, any>): Product => {
        const regularPrice = Number(product.preco || 0);
        const rawPromo = product.preco_promocional == null ? null : Number(product.preco_promocional);
        const validPromo = rawPromo != null && Number.isFinite(rawPromo) && rawPromo > 0 && rawPromo < regularPrice
          ? rawPromo
          : null;
        return {
        marmitaria: product.marmitaria === true,
        familia_id: product.familia_id ? String(product.familia_id) : null,
        familia_nome: product.familia_nome ? String(product.familia_nome) : null,
        familia_descricao: product.familia_descricao ? String(product.familia_descricao) : null,
        familia_eixo: product.familia_eixo || null,
        familia_imagem: product.familia_imagem ? getProductImageUrl(String(product.familia_imagem)) : null,
        variacao_rotulo: product.variacao_rotulo ? String(product.variacao_rotulo) : null,
        id: String(product.id),
        name: String(product.nome || ""),
        description: String(product.descricao || ""),
        price: regularPrice,
        promotionalPrice: validPromo,
        destaque: product.destaque === true,
        selo: normalizeProductBadge(product.selo),
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
              selectionMode: g.modo_selecao === 'porcoes' || g.modo_selecao === 'tipos' ? g.modo_selecao : undefined,
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
        ordem_exibicao: product.ordem_exibicao != null ? Number(product.ordem_exibicao) : null,
      };
      };
      const products: Product[] = payload.produtos.map(mapPublicProduct);
      const promotionProducts: Product[] = (payload.produtos_promocionais || []).map(mapPublicProduct);

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
              url = buildWhatsAppContactUrl(url);
              whatsappNumber = url ? url.slice('https://wa.me/'.length) : '';
            }
            return {
              platform: platform === "instagram" ? "Instagram" : platform === "whatsapp" ? "WhatsApp" : platform,
              url,
              active: Boolean(url),
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

      const rawAcceptingOrders = restaurant.aceitando_pedidos === true;
      const localSimulationUnlock = isLocalOpenStoreSimulation();
      const acceptingOrders = localSimulationUnlock ? true : rawAcceptingOrders;
      const primaryColor = resolveConfiguredColor(restaurant.cor_primaria, KOMA_PRIMARY);
      const backgroundColor = resolveConfiguredColor(restaurant.cor_fundo, KOMA_BACKGROUND);
      const brand: BrandConfig = {
        id: String(restaurant.id),
        slug: String(restaurant.slug || ""),
        name: String(restaurant.nome || "Restaurante"),
        slogan: String(restaurant.subtitulo || ""),
        logo: getRestaurantAssetUrl(restaurant.logo_url || "", true),
        bannerImage: getRestaurantAssetUrl(restaurant.banner_url || "", false),
        hasCustomBanner: getRestaurantAssetUrl(restaurant.banner_url || "", false) !== getRestaurantAssetUrl("", false),
        phone: whatsappNumber,
        address: String(restaurant.endereco || ""),
        colors: {
          primary: primaryColor,
          background: backgroundColor,
          secondary: "#121420",
          text: "#ffffff",
          card: "#121420",
          accent: primaryColor,
        },
        categories: payload.categorias.map((category) => String(category.nome || "")).filter(Boolean),
        products,
        manualHighlightProductId: typeof restaurant.destaque_cardapio_produto_id === 'string'
          ? restaurant.destaque_cardapio_produto_id : null,
        cartRecommendationSkuIds: Array.isArray(restaurant.recomendacoes_sacola_ids)
          ? restaurant.recomendacoes_sacola_ids.filter((value: unknown): value is string => typeof value === 'string')
          : null,
        promotionProducts,
        explicitPromotionComposition: payload.promocao_composicao_explicita === true,
        promotions: Array.isArray(payload.promocoes) ? payload.promocoes
          .filter(p => p && Array.isArray(p.componentes) && p.componentes.length >= 1 && p.componentes.length <= 4)
          .map(p => ({
            id: String(p.id),
            nome: String(p.nome),
            descricao: String(p.descricao || ''),
            tipo: p.tipo === 'compre_ganhe' || p.tipo === 'desconto_item' || p.tipo === 'combo' ? p.tipo : undefined,
            brinde_nome: typeof p.brinde_nome === 'string' && p.brinde_nome.trim() ? p.brinde_nome.trim() : null,
            inicio_em: typeof p.inicio_em === 'string' ? p.inicio_em : null,
            fim_em: typeof p.fim_em === 'string' ? p.fim_em : null,
            imagem_url: typeof p.imagem_url === 'string' && p.imagem_url.trim() ? p.imagem_url.trim() : null,
            preco: Number(p.preco),
            componentes: p.componentes.map((ids: unknown) =>
              Array.isArray(ids) ? ids.map(String) : []),
            quantidades: Array.isArray(p.quantidades) && p.quantidades.length === p.componentes.length
              ? p.quantidades.map((qty: unknown) => {
                  const parsed = Math.trunc(Number(qty));
                  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(20, parsed) : 1;
                })
              : p.componentes.map(() => 1),
          })) : [],
        socials,
        about: String(restaurant.sobre_nos || ""),
        paymentMethods,
        onlinePaymentEnabled: restaurant.pagamento_online_ativo === true,
        pixPayerDocumentRequired: restaurant.documento_pix_obrigatorio === true,
        pixDirect: restaurant.pix_proprio === true,
        benefits: {
          coupons: restaurant.beneficios?.coupons === true,
          loyalty: restaurant.beneficios?.loyalty === true,
          cashback: restaurant.beneficios?.cashback === true,
        },
        customerAccountRequired: restaurant.conta_cliente_obrigatoria === true,
        customerWhatsAppStatusEnabled: restaurant.avisos_whatsapp_disponiveis === true,
        activeOrderTypes: Array.isArray(restaurant.tipos_pedido_ativos)
          ? restaurant.tipos_pedido_ativos.filter((item: unknown): item is "consumo_local" | "retirada" | "delivery" =>
              item === "consumo_local" || item === "retirada" || item === "delivery"
            )
          : undefined,
        operatingHours,
        googleMapsUrl: String(restaurant.google_maps_url || ""),
        deliveryEnabled: restaurant.delivery_ativo !== false,
        pedidoMinimo: Number(restaurant.pedido_minimo || 0),
        pedidoMinimoRetirada: Boolean(restaurant.pedido_minimo_retirada),
        freteGratisValor: Number(restaurant.frete_gratis_valor || 0),
        tipoTaxaEntrega: String(restaurant.tipo_taxa_entrega || "fixa"),
        tabelaTaxasBairros: Array.isArray(restaurant.tabela_taxas_bairros)
          ? restaurant.tabela_taxas_bairros.map((b: any) => ({
              bairro: String(b.bairro || ""),
              taxa: Number(b.taxa || 0),
            }))
          : [],
        tabelaTaxasKm: Array.isArray(restaurant.tabela_taxas_km)
          ? restaurant.tabela_taxas_km.map((row: any) => ({
              taxa_minima: Number(row.taxa_minima || 0),
              valor_por_km: row.valor_por_km == null ? undefined : Number(row.valor_por_km),
              km_inclusos: row.km_inclusos == null ? undefined : Number(row.km_inclusos),
              incremento_valor: row.incremento_valor == null ? undefined : Number(row.incremento_valor),
              incremento_km: row.incremento_km == null ? undefined : Number(row.incremento_km),
              taxa_maxima: row.taxa_maxima == null ? null : Number(row.taxa_maxima),
              distancia_maxima_km: row.distancia_maxima_km == null ? null : Number(row.distancia_maxima_km),
              fallback_sem_localizacao: 'minima' as const,
            }))
          : [],
        taxaEntregaPadrao: Number(restaurant.taxa_entrega_fixa ?? restaurant.taxa_entrega_padrao ?? 0),
        storeStatus: acceptingOrders ? "open" : "closed",
        acceptingOrders,
        orderingMessage: localSimulationUnlock ? "" : String(restaurant.motivo_indisponibilidade || ""),
        availabilitySource: localSimulationUnlock && !rawAcceptingOrders
          ? "local_simulation"
          : String(restaurant.origem_disponibilidade || "automatic"),
        nextOpening: restaurant.proxima_abertura ? String(restaurant.proxima_abertura) : undefined,
        nextOpeningLabel: restaurant.proxima_abertura_texto ? String(restaurant.proxima_abertura_texto) : undefined,
      };

      setActiveBrand(brand);
      if (!background && lastReportedMenuIdRef.current !== brand.id) {
        lastReportedMenuIdRef.current = brand.id;
        trackAnalyticsEvent('public_menu_viewed', {
          restaurant_id: brand.id,
          restaurant_name: brand.name,
          categories_count: brand.categories.length,
          products_count: brand.products.length,
          store_status: brand.storeStatus,
          catalog_load_ms: getPublicMenuLoadDurationMs(API_BASE_URL, identifier) ?? Math.round(performance.now() - loadStartedAt),
        });
      }
      setActiveCategory((current) => current && brand.categories.includes(current) ? current : "");
      const rid = Number(brand.id);
      if (Number.isFinite(rid)) {
        const stored = loadStoredOrders(rid);
        setStoredOrders(current => mergeLocalOrderSnapshots(stored, current));
        // Pedidos modernos são reconciliados pelo SSE/summary do drawer.
        // Somente registros legados sem capability token precisam de uma
        // reconciliação HTTP inicial.
        if (stored.some((order) => (
          !order.tracking_token && !resolveOrderState(order).terminal
        ))) {
          void checkActiveOrders(rid, stored);
        }

        // sessionStorage some ao fechar a aba. Reidrata em segundo plano os
        // snapshots cifrados do navegador e devolve ao cliente o acesso ao
        // acompanhamento/chat sem aumentar o payload público do cardápio.
        if (!background) {
          void restoreDurableStoredOrders(rid)
            .then((restored) => {
              setStoredOrders((current) => {
                const merged = mergeLocalOrderSnapshots(restored, current);
                const currentByKey = new Map(
                  current.map((item) => [`${item.restaurante_id}:${item.id}`, item] as const),
                );
                const next = merged.map((order) => {
                  const existing = currentByKey.get(`${order.restaurante_id}:${order.id}`);
                  if (!existing) return order;
                  return {
                    ...order,
                    ...existing,
                    delivery_receipt_code: existing.delivery_receipt_code !== undefined
                      ? existing.delivery_receipt_code
                      : order.delivery_receipt_code,
                    tracking_token: existing.tracking_token || order.tracking_token,
                    tracking_url: existing.tracking_url || order.tracking_url,
                  };
                });
                const mergedKeys = new Set(next.map((order) => `${order.restaurante_id}:${order.id}`));
                const onlyInCurrent = current.filter(
                  (item) => !mergedKeys.has(`${item.restaurante_id}:${item.id}`),
                );
                return onlyInCurrent.length > 0 ? [...onlyInCurrent, ...next] : next;
              });
            })
            .catch((resumeError) => {
              console.warn("Falha ao retomar pedidos salvos neste navegador:", resumeError);
            });
        }
      }
    } catch (error) {
      if (background) {
        console.warn("Falha ao atualizar cardápio público em segundo plano; mantendo snapshot atual:", error);
      } else {
        console.error("Falha ao carregar cardápio público:", error);
        setActiveBrand(null);
        setErrorMsg(
          error instanceof Error && error.message === "CARDAPIO_NOT_FOUND"
            ? "Cardápio não encontrado ou ainda não publicado."
            : "O cardápio está temporariamente indisponível. Tente novamente.",
        );
      }
    } finally {
      if (!background) setIsLoading(false);
    }
  }, [checkActiveOrders]);

  useEffect(() => {
    void loadRestaurantData();
  }, [loadRestaurantData]);

  useEffect(() => {
    const nextBrandId = activeBrand?.id ?? null;
    if (nextBrandId === null) return;
    if (
      previousBrandIdRef.current !== null
      && String(previousBrandIdRef.current) !== String(nextBrandId)
    ) {
      setSelectedProduct(null);
      setEditingCartItem(null);
      setProductModalOrigin(null);
      setSelectedPromotion(null);
      setEditingPromotionItem(null);
      setPromotionModalOrigin(null);
      setIsCartOpen(false);
      setIsCheckoutOpen(false);
      setCheckoutRequest(null);
      checkoutOrderCreatedRef.current = false;
      setHydratedDraftBrandId(null);
      setFulfillmentChoice(null);
      setDraftRestoreIssues([]);
      setCart([]);
    }
    previousBrandIdRef.current = nextBrandId;
  }, [activeBrand?.id]);

  // Reidrata rascunho da sacola da aba atual com revalidação contra o catálogo vivo.
  useEffect(() => {
    if (!activeBrand?.id) return;
    const brandKey = String(activeBrand.id);
    if (hydratedDraftBrandId === brandKey) return;

    const draft = loadCartDraft(activeBrand.id);
    if (!draft) {
      setHydratedDraftBrandId(brandKey);
      return;
    }

    const restored = restoreCartDraftFromCatalog(draft, activeBrand);
    if (restored.items.length > 0) {
      setCart((current) => (current.length > 0 ? current : restored.items));
      if (restored.fulfillment) {
        setFulfillmentChoice((current) => (
          current && String(current.restaurantId) === brandKey
            ? current
            : { restaurantId: activeBrand.id, method: restored.fulfillment! }
        ));
      }
      if (restored.issues.length > 0) {
        setDraftRestoreIssues(restored.issues);
        showNotification("Sua sacola foi recuperada com ajustes do cardápio atual.");
      }
    } else {
      clearCartDraft(activeBrand.id);
      if (restored.issues.length > 0) {
        setDraftRestoreIssues(restored.issues);
        showNotification("Alguns itens da sacola anterior não estão mais disponíveis.");
      }
    }
    setHydratedDraftBrandId(brandKey);
  }, [activeBrand, hydratedDraftBrandId, showNotification]);

  useEffect(() => {
    if (!activeBrand?.id) return;
    if (hydratedDraftBrandId !== String(activeBrand.id)) return;
    const method = fulfillmentChoice?.restaurantId === activeBrand.id ? fulfillmentChoice.method : null;
    saveCartDraft(activeBrand.id, cart, method);
  }, [activeBrand?.id, hydratedDraftBrandId, cart, fulfillmentChoice]);

  useEffect(() => {
    if (!activeBrand || !selectedProduct) return;
    if (productModalOrigin && String(productModalOrigin.restaurantId) !== String(activeBrand.id)) return;
    if (isGroupedProduct(selectedProduct)) {
      const anyAvail = selectedProduct.variants.some((v) => {
        const prod = activeBrand.products.find((p) => String(p.id) === String(v.id) && p.isAvailable !== false);
        return Boolean(prod);
      });
      if (!anyAvail) {
        const returned = closeProductModal();
        if (returned) setDraftRestoreIssues((prev) => [...new Set([...prev, "Este produto não está mais disponível no cardápio."])]);
        setNotice("Este produto não está mais disponível. Consulte o cardápio atualizado.");
      }
      return;
    }
    const current = activeBrand.products.find(product => String(product.id) === String(selectedProduct.id) && product.isAvailable !== false);
    if (!current) {
      const returned = closeProductModal();
      if (returned) setDraftRestoreIssues((prev) => [...new Set([...prev, "Este produto não está mais disponível no cardápio."])]);
      setNotice("Este produto não está mais disponível. Consulte o cardápio atualizado.");
    } else if (current !== selectedProduct) {
      setSelectedProduct(current);
    }
  }, [activeBrand, selectedProduct, productModalOrigin, closeProductModal]);

  useEffect(() => {
    if (!activeBrand?.id) return;
    let cancelled = false;
    const session = loadCustomerSession(activeBrand.id);
    if (!session) {
      setUser(null);
      setCustomerToken(null);
      void restoreCustomerBrowserSession(activeBrand.id).then(restored => {
        if (cancelled || !restored || loadCustomerSession(activeBrand.id)) return;
        saveCustomerSession(activeBrand.id, restored);
        setUser(restored.profile);
        setCustomerToken(restored.token);
      }).catch(() => {
        // Cookie may be blocked by the browser; guest checkout remains available.
      });
      return () => { cancelled = true; };
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
    if (!isBenefitsOpen || !activeBrand?.id || !customerToken) return;
    const controller = new AbortController();
    void fetch(`${API_BASE_URL}/cardapio/clientes/me`, {
      headers: { "X-Koma-Customer-Token": customerToken },
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        clearCustomerSession(activeBrand.id);
        setUser(null);
        setCustomerToken(null);
        return;
      }
      if (!response.ok) return;
      const data = await response.json();
      if (controller.signal.aborted || !data?.id) return;
      const profile = mapCustomerProfile(data);
      setUser(profile);
      saveCustomerSession(activeBrand.id, { token: customerToken, profile });
    }).catch(() => {
      // O saldo exibido permanece disponível durante uma falha temporária de rede.
    });
    return () => controller.abort();
  }, [isBenefitsOpen, activeBrand?.id, customerToken]);

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

  const isTabSheetOpen = Boolean(
    isCartOpen
    || isOrdersDrawerOpen
    || isAuthOpen
    || isProfileOpen,
  );
  const isBlockingModalOpen = Boolean(
    selectedProduct
    || selectedPromotion
    || isCheckoutOpen
    || pixModalOrder
    || isStoreInfoOpen
    || isBenefitsOpen,
  );
  const hasOpenOverlay = isTabSheetOpen || isBlockingModalOpen;

  useEffect(() => {
    const handleOpenOrdersDrawer = (event: Event) => {
      const detail = (event as CustomEvent<{ orderId?: string }>).detail;
      if (detail?.orderId) setSelectedOrderId(detail.orderId);
      setIsCartOpen(false);
      setIsCheckoutOpen(false);
      setCheckoutRequest(null);
      setIsAuthOpen(false);
      setIsProfileOpen(false);
      setIsStoreInfoOpen(false);
      setIsBenefitsOpen(false);
      setPixModalOrder(null);
      setIsOrdersDrawerOpen(true);
    };
    window.addEventListener("koma:open-orders-drawer", handleOpenOrdersDrawer);
    return () => window.removeEventListener("koma:open-orders-drawer", handleOpenOrdersDrawer);
  }, []);

  // Uma entrada no histórico protege o cliente de sair do cardápio ao usar
  // Voltar no Android/Chrome enquanto uma interface sobreposta está aberta.
  // O estado de produto/sacola continua sendo canônico no React, nunca na URL.
  const overlayHistoryToken = useRef(`koma-menu-overlay-${Date.now()}-${Math.random()}`);
  const overlayHistoryArmed = useRef(false);
  const overlayBackRef = useRef<() => boolean>(() => false);

  overlayBackRef.current = () => {
    const overlayCount = [
      Boolean(selectedProduct), Boolean(selectedPromotion), Boolean(pixModalOrder),
      isCartOpen, isAuthOpen, isCheckoutOpen, isStoreInfoOpen,
      isProfileOpen, isOrdersDrawerOpen, isBenefitsOpen,
    ].filter(Boolean).length;

    if (pixModalOrder) {
      setPixModalOrder(null);
    } else if (isAuthOpen) {
      setIsAuthOpen(false);
    } else if (selectedProduct) {
      const returnedToCart = closeProductModal();
      return returnedToCart || overlayCount > 1;
    } else if (selectedPromotion) {
      const returnedToCart = closePromotionModal();
      return returnedToCart || overlayCount > 1;
    } else if (isCheckoutOpen) {
      const orderAlreadyCreated = checkoutOrderCreatedRef.current;
      checkoutOrderCreatedRef.current = false;
      setIsCheckoutOpen(false);
      setCheckoutRequest(null);
      if (orderAlreadyCreated) {
        setIsCartOpen(false);
        return false;
      }
      setIsCartOpen(true);
      return true;
    } else if (isProfileOpen) {
      setIsProfileOpen(false);
    } else if (isStoreInfoOpen) {
      setIsStoreInfoOpen(false);
    } else if (isOrdersDrawerOpen) {
      setIsOrdersDrawerOpen(false);
    } else if (isBenefitsOpen) {
      setIsBenefitsOpen(false);
    } else if (isCartOpen) {
      setIsCartOpen(false);
      setCouponToApply("");
    }
    // Ao editar um item sobre a sacola, o primeiro Voltar fecha apenas a edição.
    return overlayCount > 1;
  };

  const pushOverlayHistoryGuard = () => {
    const state = window.history.state;
    const priorState = state && typeof state === "object" && !Array.isArray(state) ? state : {};
    window.history.pushState(
      { ...priorState, __komaPublicMenuOverlay: overlayHistoryToken.current },
      "",
      window.location.href,
    );
    overlayHistoryArmed.current = true;
  };

  const pushOverlayHistoryGuardRef = useRef(pushOverlayHistoryGuard);
  pushOverlayHistoryGuardRef.current = pushOverlayHistoryGuard;

  useEffect(() => {
    const onPopState = () => {
      if (!overlayHistoryArmed.current) return;
      overlayHistoryArmed.current = false;
      const hasUnderlyingOverlay = overlayBackRef.current();
      // Reprotege a sacola quando o cliente volta da edição de um produto.
      if (hasUnderlyingOverlay) pushOverlayHistoryGuardRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (hasOpenOverlay && !overlayHistoryArmed.current) {
      pushOverlayHistoryGuardRef.current();
    } else if (!hasOpenOverlay && overlayHistoryArmed.current) {
      const ownsEntry = window.history.state?.__komaPublicMenuOverlay === overlayHistoryToken.current;
      overlayHistoryArmed.current = false;
      // Fechar pelo X ou adicionar produto também consome a entrada temporária.
      if (ownsEntry) window.history.back();
    }
  }, [hasOpenOverlay]);

  useEffect(() => {
    if (!hasOpenOverlay) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [hasOpenOverlay]);

  useEffect(() => {
    if (!isCartOpen) return;
    const hasTopperOverlay = Boolean(
      selectedProduct
      || selectedPromotion
      || pixModalOrder
      || isAuthOpen
      || isCheckoutOpen
      || isStoreInfoOpen
      || isProfileOpen
      || isOrdersDrawerOpen
      || isBenefitsOpen,
    );
    if (hasTopperOverlay) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      setIsCartOpen(false);
      setCouponToApply("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    isCartOpen,
    selectedProduct,
    selectedPromotion,
    pixModalOrder,
    isAuthOpen,
    isCheckoutOpen,
    isStoreInfoOpen,
    isProfileOpen,
    isOrdersDrawerOpen,
    isBenefitsOpen,
  ]);

  useEffect(() => {
    if (!activeBrand?.id) return;
    const wsUrl = `${WS_BASE_URL}/ws/cliente?restaurante_id=${activeBrand.id}`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let delay = 2000;
    // O snapshot inicial já foi carregado antes de abrir este socket.
    // Recarregar no primeiro onopen duplicava a consulta e o render do catálogo.
    let hasConnected = false;
    // Aba oculta por mais de 60s: fecha o socket ocioso (economia de conexões no backend).
    const HIDDEN_DISCONNECT_MS = 60_000;
    let hiddenDisconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pausedByHidden = false;

    const connect = () => {
      if (stopped || document.hidden) return;
      const socket = new WebSocket(wsUrl);
      ws = socket;
      socket.onopen = () => {
        delay = 2000;
        if (hasConnected) void loadRestaurantData(true);
        hasConnected = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = undefined;
        }
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const eventName = data.event || data.type;
          if (["catalog_updated", "config_updated", "store_status_changed"].includes(eventName)) {
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => void loadRestaurantData(true), 100);
          }
        } catch {
          // Mensagem inválida do socket não interrompe o cardápio.
        }
      };
      socket.onclose = () => {
        if (stopped || ws !== socket) return;
        ws = null;
        if (pausedByHidden || document.hidden) return;
        reconnectTimer = setTimeout(connect, delay);
        delay = Math.min(delay * 1.5, 30000);
      };
      socket.onerror = () => socket.close();
    };

    const handleVisibility = () => {
      if (stopped) return;
      if (document.hidden) {
        if (hiddenDisconnectTimer) clearTimeout(hiddenDisconnectTimer);
        hiddenDisconnectTimer = setTimeout(() => {
          hiddenDisconnectTimer = undefined;
          if (stopped || !document.hidden) return;
          pausedByHidden = true;
          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = undefined;
          }
          ws?.close();
        }, HIDDEN_DISCONNECT_MS);
        return;
      }
      if (hiddenDisconnectTimer) {
        clearTimeout(hiddenDisconnectTimer);
        hiddenDisconnectTimer = undefined;
      }
      pausedByHidden = false;
      void loadRestaurantData(true);
      if (!ws || ws.readyState === WebSocket.CLOSED) connect();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    connect();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      if (hiddenDisconnectTimer) clearTimeout(hiddenDisconnectTimer);
      ws?.close();
    };
  }, [activeBrand?.id, loadRestaurantData]);

  const orderingEnabled = activeBrand?.acceptingOrders !== false && activeBrand?.storeStatus !== "closed";
  const isPreparationSimulation = activeBrand?.availabilitySource === "provisional_preparation";
  const cartAssemblyEnabled = orderingEnabled || isPreparationSimulation;
  const orderingMessage = activeBrand?.orderingMessage || "O restaurante pausou novos pedidos por enquanto.";

  const handleAddToCart = (
    product: Product,
    quantity: number,
    selectedOptions: Record<string, ProductOption[]> = {},
    notes: string = "",
    revealCart = true,
  ) => {
    if (!cartAssemblyEnabled) {
      setNotice(`${orderingMessage} Você ainda pode consultar os produtos.`);
      return;
    }

    const optionIds = Object.values(selectedOptions)
      .flatMap((list) => list.map((option) => option.id))
      .sort()
      .join("-");
    const itemId = `${product.id}-${optionIds}-${notes.trim()}`;
    if (editingCartItem) {
      setCart(current => {
        const remaining = current.filter(item => item.id !== editingCartItem.id);
        const existing = remaining.find(item => item.id === itemId);
        return existing ? remaining.map(item => item.id === itemId ? { ...item, product, selectedOptions, notes, quantity: item.quantity + quantity } : item)
          : [...remaining, { id: itemId, product, quantity, selectedOptions, notes }];
      });
      setEditingCartItem(null);
      setCartAnnouncement("Montagem atualizada na sacola");
      return;
    }
    setCart((current) => {
      const existing = current.find((item) => item.id === itemId);
      if (existing) {
        return current.map((item) => item.id === itemId ? { ...item, quantity: item.quantity + quantity } : item);
      }
      return [...current, { id: itemId, product, quantity, selectedOptions, notes }];
    });
    setCartAnnouncement(`${quantity} ${quantity === 1 ? "unidade incluída" : "unidades incluídas"}: ${product.name}`);

    const optionsCount = Object.values(selectedOptions).reduce((acc, list) => acc + list.length, 0);
    const baseUnitPrice = getEffectiveProductPrice(product.price, product.promotionalPrice).effectivePrice;
    let unitPrice = baseUnitPrice;
    Object.values(selectedOptions).forEach((list) => {
      list.forEach((opt) => {
        unitPrice += (opt.extraPrice || 0);
      });
    });
    trackAnalyticsEvent('public_cart_item_added', {
      restaurant_id: activeBrand?.id || '',
      product_id: product.id,
      product_name: product.name,
      category: product.category,
      price: baseUnitPrice,
      quantity,
      total_price: unitPrice * quantity,
      options_count: optionsCount,
    });

    if (revealCart && window.innerWidth >= 1024) setIsCartOpen(true);
  };

  const handlePromotionConfirm = (parts: PromotionPartSelection[]) => {
    if (!selectedPromotion || !activeBrand || !cartAssemblyEnabled) return;
    const campaign = selectedPromotion;
    // Pacote único na sacola; componentes reais são serializados apenas no checkout.
    const options: Record<string, ProductOption[]> = {};
    parts.forEach((part, index) => {
      Object.entries(part.selectedOptions).forEach(([groupId, selections]) => {
        options[`${index}:${groupId}`] = selections;
      });
    });
    const virtualProduct: Product = {
      id: `promotion:${campaign.id}`, name: campaign.nome,
      description: campaign.descricao, price: campaign.preco,
      category: "Promoções", image: parts[0]?.product.image || "",
      isAvailable: true,
    };
    const itemId = editingPromotionItem?.id
      || `promotion:${campaign.id}:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nextItem: CartItem = {
      id: itemId,
      product: virtualProduct,
      quantity: editingPromotionItem?.quantity ?? 1,
      selectedOptions: options,
      notes: "",
      promotionId: campaign.id,
      promotionParts: parts,
    };
    setCart((current) => {
      if (editingPromotionItem) {
        return current.map((item) => (item.id === editingPromotionItem.id ? nextItem : item));
      }
      const compatible = current.filter((item) => !item.promotionId || item.promotionId === campaign.id);
      return [...compatible, nextItem];
    });
    setSelectedPromotion(null);
    setEditingPromotionItem(null);
    setPromotionModalOrigin(null);
    setIsCartOpen(true);
    setCartAnnouncement("Promoção incluída na sacola");
  };

  const handleFastAdd = (product: Product) => {
    const hasModifiers = Boolean(
      (product.modifiers && product.modifiers.length > 0) ||
      (product.modifierGroups && product.modifierGroups.length > 0)
    );
    if (hasModifiers) openProductModal(product, "catalog");
    else handleAddToCart(product, 1, {}, "", false);
  };

  const handleFastRemove = useCallback((product: Product) => {
    const targetItemId = `${product.id}--`;
    setCart((current) => {
      const existing = current.find((item) => item.id === targetItemId);
      if (!existing) return current;
      if (existing.quantity <= 1) {
        return current.filter((item) => item.id !== targetItemId);
      }
      return current.map((item) =>
        item.id === targetItemId ? { ...item, quantity: item.quantity - 1 } : item
      );
    });
  }, []);

  const handleSelectCatalogProduct = useCallback(
    (product: Product) => openProductModal(product, "catalog"),
    [openProductModal],
  );
  const handleOpenStoreInfo = useCallback(() => setIsStoreInfoOpen(true), []);
  const handleOpenOrdersDrawer = useCallback(() => setIsOrdersDrawerOpen(true), []);
  const handleOpenBenefits = useCallback(() => setIsBenefitsOpen(true), []);

  const cartQuantityByProductId = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const item of cart) quantities.set(item.id, item.quantity);
    return quantities;
  }, [cart]);

  const getProductCartQuantity = useCallback(
    (productId: string | number) => cartQuantityByProductId.get(`${productId}--`) ?? 0,
    [cartQuantityByProductId],
  );

  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const cartTotal = cart.reduce((total, item) => {
    let unit = getEffectiveProductPrice(item.product.price, item.product.promotionalPrice).effectivePrice;
    Object.values(item.selectedOptions).forEach((options) => options.forEach((option) => { unit += option.extraPrice; }));
    return total + unit * item.quantity;
  }, 0);

  const handleLoginSuccess = (profile: CustomerProfile, token: string) => {
    setUser(profile);
    setCustomerToken(token);
    if (activeBrand?.id) {
      allowCustomerBrowserRestore(activeBrand.id);
      saveCustomerSession(activeBrand.id, { token, profile });
    }
  };

  // Propagate account sign-out across tabs within this restaurant.
  useEffect(() => {
    if (!activeBrand?.id) return;
    const restaurantId = activeBrand.id;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== customerSignedOutKey(restaurantId) || event.newValue !== "1") return;
      clearCustomerSession(restaurantId);
      setUser(null);
      setCustomerToken(null);
      setIsProfileOpen(false);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [activeBrand?.id]);

  const handleRepeatOrder = (order: CustomerHistoryOrder) => {
    if (!activeBrand) return;
    if (!orderingEnabled) {
      showNotification(`${orderingMessage} O pedido anterior não foi colocado na sacola.`);
      return;
    }

    const rebuilt = rebuildOrderFromCurrentCatalog(order, activeBrand.products);
    if (rebuilt.items.length === 0) {
      showNotification(rebuilt.issues[0] || "Os itens desse pedido não estão disponíveis no cardápio atual.");
      return;
    }

    if (cart.length > 0 && !window.confirm("Sua sacola atual será substituída pelos itens deste pedido. Continuar?")) {
      return;
    }

    setCart(rebuilt.items);
    setIsProfileOpen(false);
    setIsCartOpen(true);

    if (rebuilt.issues.length > 0) {
      const skipped = rebuilt.skippedItems > 0
        ? ` ${rebuilt.skippedItems} item${rebuilt.skippedItems === 1 ? "" : "ns"} não foi${rebuilt.skippedItems === 1 ? "" : "ram"} incluído${rebuilt.skippedItems === 1 ? "" : "s"}.`
        : "";
      showNotification(`Pedido atualizado com ${rebuilt.issues.length} ajuste${rebuilt.issues.length === 1 ? "" : "s"}.${skipped} Confira a sacola.`);
    } else {
      showNotification("Pedido recomposto com preços e disponibilidade atuais. Confira a sacola.");
    }
  };

  const handleLogout = () => {
    if (activeBrand?.id) {
      blockCustomerBrowserRestore(activeBrand.id);
      void closeCustomerBrowserSession(activeBrand.id).catch(() => {
        // The local sign-out marker blocks silent reauthentication if offline.
      });
      clearGuestCheckoutContact(activeBrand.id);
      clearCustomerSession(activeBrand.id);
    }
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

  const handleRealtimeOrderRefresh = useCallback(() => {
    if (activeBrand?.id) void checkActiveOrders(Number(activeBrand.id));
  }, [activeBrand?.id, checkActiveOrders]);

  const handleRealtimeOrderStatus = useCallback((
    orderId: string,
    status: string,
    closedAt: string | null,
    tipo?: string,
    backendState?: OrderStateContract,
    deliveryReceiptCode?: string | null,
  ) => {
    setStoredOrders((current) => {
      let changed = false;
      const next = current.map((order) => {
        if (order.id !== orderId) return order;
        const nextTipo = String(tipo || order.tipo || "Retirada");
        const state = isOrderStateContract(backendState)
          ? backendState
          : fallbackOrderState(status, nextTipo);
        const nextClosed = state.terminal || Boolean(closedAt);
        const currentState = resolveOrderState(order);
        const stateChanged = JSON.stringify(currentState) !== JSON.stringify(state);
        if (
          order.status === status
          && order.tipo === nextTipo
          && !stateChanged
          && Boolean(order.fechado) === nextClosed
          && (deliveryReceiptCode === undefined || order.delivery_receipt_code === deliveryReceiptCode)
        ) {
          return order;
        }

        changed = true;
        const updated: StoredOrder = {
          ...order,
          delivery_receipt_code: state.terminal ? null : deliveryReceiptCode === undefined ? order.delivery_receipt_code : deliveryReceiptCode,
          status,
          tipo: nextTipo,
          state,
          fechado: nextClosed,
        };
        updateStoredOrderStatus(orderId, updated);
        return updated;
      });
      return changed ? next : current;
    });
  }, []);

  const clearTrackedOrder = (orderId?: string) => {
    const targetId = orderId || activeOrder?.id;
    if (targetId) {
      removeStoredOrder(targetId);
      if (activeBrand?.id) {
        setStoredOrders(current => mergeLocalOrderSnapshots(loadStoredOrders(Number(activeBrand.id)), current));
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
      <KomaLoading
        label="Carregando cardápio"
        detail="Produtos e informações do restaurante em um único carregamento."
      />
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

  const activeState = activeOrder ? resolveOrderState(activeOrder) : null;

  return (
    <div className="min-h-screen overflow-x-clip bg-bg-app font-sans text-text-app" id="app-root-container">
      {/* A quantidade/sacola oferecem feedback visual; leitores de tela recebem anúncio sem sobreposição. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {cartAnnouncement}
      </span>
      {notice && !isCartOpen && !isCheckoutOpen && (
        <div className="km-toast-wrap" role="status" aria-live="polite">
          <div className="km-toast" key={notice}>
            <span className="km-toast__icon" aria-hidden="true">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <span className="km-toast__text">{notice}</span>
            <button
              type="button"
              className="km-toast__close"
              aria-label="Fechar aviso"
              onClick={() => setNotice("")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {isLocalOpenStoreSimulation() && activeBrand.availabilitySource === "local_simulation" && !hasOpenOverlay && (
        <div className="km-sim-pill" aria-label="Modo simulação local ativo">
          <span className="km-sim-pill__dot" aria-hidden="true" />
          <span>Simulação local</span>
        </div>
      )}

      <MenuV2Experience
        activeBrand={activeBrand}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedCategory={activeCategory}
        onSelectCategory={setActiveCategory}
        onSelectProduct={handleSelectCatalogProduct}
        onFastAdd={handleFastAdd}
        onFastRemove={handleFastRemove}
        getProductCartQuantity={getProductCartQuantity}
        onCartToggle={openCart}
        cartCount={cartCount}
        cartTotal={cartTotal}
        onStoreInfoClick={handleOpenStoreInfo}
        onOrdersClick={handleOpenOrdersDrawer}
        activeOrdersCount={activeOrders.length}
        hasOpenOverlay={hasOpenOverlay}
        dockHidden={isBlockingModalOpen}
        onPromotionSelect={(offer) => {
          openPromotionModal(offer, "catalog");
        }}
        user={user}
        onAuthClick={() => (user ? setIsProfileOpen(true) : setIsAuthOpen(true))}
        onBenefitsClick={handleOpenBenefits}
        activeOrder={activeOrder}
        activeState={activeState}
        storedOrders={storedOrders}
        storedOrdersCount={storedOrders.length}
        onSelectOrderId={setSelectedOrderId}
        onPayPixClick={(order) => setPixModalOrder(order)}
        onRefreshOrders={() => {
          if (activeBrand?.id) void checkActiveOrders(Number(activeBrand.id));
        }}
        isRefreshingOrders={isRefreshingOrders}
        onClearTrackedOrder={(id) => clearTrackedOrder(id)}
        orderingMessage={orderingMessage}
        onNotify={showNotification}
        activeDockTab={
          isCartOpen
            ? "bag"
            : isOrdersDrawerOpen
              ? "orders"
              : isAuthOpen || isProfileOpen
                ? "account"
                : "home"
        }
        onDockNavigate={(tab) => {
          setSelectedProduct(null);
          setEditingCartItem(null);
          setProductModalOrigin(null);
          setSelectedPromotion(null);
          setEditingPromotionItem(null);
          setPromotionModalOrigin(null);
          setIsCheckoutOpen(false);
          setCheckoutRequest(null);
          setIsStoreInfoOpen(false);
          setIsBenefitsOpen(false);
          setPixModalOrder(null);
          if (tab !== "bag") {
            setCouponToApply("");
          }

          setIsCartOpen(false);
          setIsOrdersDrawerOpen(false);
          setIsAuthOpen(false);
          setIsProfileOpen(false);

          if (tab === "bag") {
            setIsCartOpen(true);
          } else if (tab === "orders") {
            setIsOrdersDrawerOpen(true);
          } else if (tab === "account") {
            if (user) {
              setIsProfileOpen(true);
            } else {
              setIsAuthOpen(true);
            }
          }
        }}
      />

      {selectedPromotion && (
        <CardapioPromotionWizard
          key={`${selectedPromotion.id}-${editingPromotionItem?.id ?? 'new'}`}
          title={selectedPromotion.nome}
          basePrice={selectedPromotion.preco}
          restaurantId={activeBrand.id}
          expectedStepCount={selectedPromotion.componentes.length}
          brindeNome={selectedPromotion.brinde_nome}
          slotQuantities={selectedPromotion.quantidades}
          steps={selectedPromotion.componentes.map(ids => {
            const product = [...activeBrand.products, ...(activeBrand.promotionProducts || [])].find(candidate => ids.includes(candidate.id));
            return product ? { product, label: product.name } : null;
          }).filter((step): step is { product: Product; label: string } => Boolean(step))}
          initialParts={editingPromotionItem?.promotionParts}
          onClose={closePromotionModal}
          onConfirm={handlePromotionConfirm}
        />
      )}

      {selectedProduct && (
        <CardapioProductModal
          product={selectedProduct}
          restaurantId={activeBrand.id}
          initialItem={editingCartItem || undefined}
          onClose={closeProductModal}
          onAddToCart={handleAddToCart}
        />
      )}

      {(isCartOpen || cart.length > 0 || productModalOrigin?.surface === "cart" || promotionModalOrigin?.surface === "cart") && (
        <div hidden={!isCartOpen}>
          <CardapioCartDrawer
            key={activeBrand.id}
            cart={cart}
            restaurantId={activeBrand.id}
            restaurantAddress={activeBrand.address}
            brandConfig={activeBrand}
            initialFulfillment={fulfillmentChoice?.restaurantId === activeBrand.id ? fulfillmentChoice.method : null}
            onFulfillmentChange={(method) => setFulfillmentChoice({ restaurantId: activeBrand.id, method })}
            allProducts={activeBrand.products}
            onAddToCart={handleAddToCart}
            onSelectProduct={(product) => {
              openProductModal(product, "cart", { closeCart: true });
            }}
            initialCouponCode={couponToApply}
            onClose={() => { setIsCartOpen(false); setCouponToApply(""); }}
            onAdjustQty={(itemId, delta) => setCart(current => current.flatMap(item => {
              if (item.id !== itemId) return [item];
              const quantity = item.quantity + delta;
              return quantity > 0 ? [{ ...item, quantity }] : [];
            }))}
            onUpdateQty={(itemId, quantity) => setCart((current) => quantity <= 0 ? current.filter((item) => item.id !== itemId) : current.map((item) => item.id === itemId ? { ...item, quantity } : item))}
            onEditItem={item => {
              if (item.promotionId) {
                const promotion = activeBrand.promotions?.find(offer => offer.id === item.promotionId);
                if (promotion) { openPromotionModal(promotion, "cart", { editingItem: item, closeCart: true }); }
                else showNotification("A promoção não está mais disponível. Remova-a da sacola.");
                return;
              }
              const product = activeBrand.products.find(candidate => candidate.id === item.product.id);
              if (!product || product.isAvailable === false) { showNotification("Este produto não está mais disponível para edição."); return; }
              openProductModal(product, "cart", { editingItem: item });
            }}
            onComposeAnother={item => {
              if (item.promotionId) {
                const promotion = activeBrand.promotions?.find(offer => offer.id === item.promotionId);
                if (promotion) { openPromotionModal(promotion, "cart", { closeCart: true }); }
                else showNotification("A promoção não está mais disponível.");
                return;
              }
              const product = activeBrand.products.find(candidate => candidate.id === item.product.id);
              if (!product || product.isAvailable === false) { showNotification("Este produto não está mais disponível para montagem."); return; }
              openProductModal(product, "cart");
            }}
            onRemoveItem={(itemId) => setCart((current) => current.filter((item) => item.id !== itemId))}
            onPlaceOrder={(request) => {
              trackAnalyticsEvent('public_checkout_initiated', {
                restaurant_id: activeBrand.id,
                delivery_method: request.deliveryMethod,
                items_count: cart.reduce((tot, item) => tot + item.quantity, 0),
                cart_total: cartTotal,
                delivery_fee: request.deliveryFee,
                has_coupon: Boolean(request.cupomCodigo),
                coupon_discount: request.descontoCupom || 0,
                has_cashback: Boolean(request.usarCashback),
                cashback_discount: request.descontoCashback || 0,
                payment_method: request.paymentMethodDetail || 'nao_definido',
              });
              checkoutOrderCreatedRef.current = false;
              setCheckoutRequest(request);
              setIsCartOpen(false);
              setIsCheckoutOpen(true);
            }}
            user={user}
            customerToken={customerToken}
            accountRequired={activeBrand.customerAccountRequired === true}
            onAuthClick={() => setIsAuthOpen(true)}
            orderingEnabled={orderingEnabled}
            orderingMessage={orderingMessage}
            draftRestoreIssues={draftRestoreIssues}
            onDismissDraftRestoreIssues={() => setDraftRestoreIssues([])}
          />
        </div>
      )}

      {isAuthOpen && (
        <CardapioAuthModal
          key={String(activeBrand.id)}
          initialMode={authMode}
          restaurantId={activeBrand.id}
          accountRequired={activeBrand.customerAccountRequired === true}
          hasBenefits={Boolean(activeBrand.benefits?.coupons || activeBrand.benefits?.loyalty)}
          restaurantName={activeBrand.name}
          onClose={() => { setIsAuthOpen(false); setAuthMode("login"); }}
          onLoginSuccess={handleLoginSuccess}
        />
      )}

      {isProfileOpen && (
        <CardapioUserProfileModal
          onClose={() => setIsProfileOpen(false)}
          user={user}
          customerToken={customerToken}
          benefits={activeBrand.benefits}
          onProfileUpdate={(profile) => {
            setUser(profile);
            if (customerToken) saveCustomerSession(activeBrand.id, { token: customerToken, profile });
          }}
          onLogout={handleLogout}
          onRepeatOrder={handleRepeatOrder}
        />
      )}

      {isBenefitsOpen && Boolean(activeBrand.benefits?.coupons || activeBrand.benefits?.loyalty) && (
        <CardapioBenefitsDrawer
          restaurantId={activeBrand.id}
          capabilities={activeBrand.benefits}
          isOpen={true}
          onClose={() => setIsBenefitsOpen(false)}
          user={user}
          onAuthClick={() => {
            setIsBenefitsOpen(false);
            setIsAuthOpen(true);
          }}
          onUseCoupon={(code) => {
            setCouponToApply(code);
            setIsBenefitsOpen(false);
            if (cart.length > 0) openCart();
            else {
              showNotification("Cupom guardado. Adicione um produto e abra a sacola para aplicar.");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
        />
      )}

      {isCheckoutOpen && checkoutRequest && (
        <CardapioDigital
          activeBrand={activeBrand}
          cart={cart}
          isLocalSimulation={isLocalOrderSimulation()}
          deliveryFee={checkoutRequest.deliveryFee}
          deliveryMethod={checkoutRequest.deliveryMethod}
          address={checkoutRequest.address}
          addressSnapshot={checkoutRequest.addressSnapshot}
          customerName={checkoutRequest.customerName}
          customerPhone={checkoutRequest.customerPhone}
          customerEmail={checkoutRequest.customerEmail}
          customerDocument={checkoutRequest.customerDocument}
          customerToken={customerToken}
          paymentMethodDetail={checkoutRequest.paymentMethodDetail}
          trocoPara={checkoutRequest.trocoPara}
          bairro={checkoutRequest.bairro}
          cupomCodigo={checkoutRequest.cupomCodigo}
          descontoCupom={checkoutRequest.descontoCupom}
          usarCashback={checkoutRequest.usarCashback}
          descontoCashback={checkoutRequest.descontoCashback}
          onClose={() => {
            checkoutOrderCreatedRef.current = false;
            setIsCheckoutOpen(false);
            setCheckoutRequest(null);
          }}
          onEditCart={() => {
            checkoutOrderCreatedRef.current = false;
            setIsCheckoutOpen(false);
            setCheckoutRequest(null);
            // Reopening the bag must use current products, not the old draft
            // snapshot that may contain a now-disabled daily-menu option.
            void loadRestaurantData(true).finally(() => setIsCartOpen(true));
          }}
          onOrderCreated={() => {
            checkoutOrderCreatedRef.current = true;
            setCart([]);
            setFulfillmentChoice(null);
            setCouponToApply("");
            setDraftRestoreIssues([]);
            if (activeBrand?.id) {
              clearCartDraft(activeBrand.id);
              const rid = Number(activeBrand.id);
              setStoredOrders(current => mergeLocalOrderSnapshots(loadStoredOrders(rid), current));
            }
          }}
          onOrderSuccess={() => {
            checkoutOrderCreatedRef.current = false;
            setCart([]);
            setFulfillmentChoice(null);
            setCouponToApply("");
            setDraftRestoreIssues([]);
            setIsCartOpen(false);
            setIsCheckoutOpen(false);
            setCheckoutRequest(null);
            if (activeBrand?.id) {
              clearCartDraft(activeBrand.id);
              const rid = Number(activeBrand.id);
              setStoredOrders(current => mergeLocalOrderSnapshots(loadStoredOrders(rid), current));
            }
          }}
          onCreateAccount={() => { setAuthMode("register"); setIsAuthOpen(true); }}
          onSessionExpired={handleSessionExpired}
        />
      )}

      {isStoreInfoOpen && (
        <CardapioStoreInfoDrawer brand={activeBrand} isOpen={true} onClose={() => setIsStoreInfoOpen(false)} />
      )}

      {(isOrdersDrawerOpen || storedOrders.length > 0 || (typeof window !== 'undefined' && window.location.hash.startsWith('#koma-order='))) && (
        <CardapioOrdersDrawer
          restaurantId={activeBrand?.id}
          restaurantPhone={activeBrand?.phone}
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
              setStoredOrders(current => mergeLocalOrderSnapshots(loadStoredOrders(Number(activeBrand.id)), current));
            }
          }}
          onOrderPaymentUpdated={handleOrderPaymentUpdated}
          onRealtimeStatus={handleRealtimeOrderStatus}
          onRealtimeRefresh={handleRealtimeOrderRefresh}
          isRefreshing={isRefreshingOrders}
          hasFloatingCart={cartCount > 0 && !hasOpenOverlay}
        />
      )}

      {pixModalOrder && pixModalOrder.pagamento?.qr_code && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm transition-opacity"
          id="page-pix-payment-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPixModalOrder(null);
            }
          }}
        >
          <div
            className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-3xl border border-koma-border bg-koma-card p-5 text-center shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={`Pagamento Pix do Pedido #${pixModalOrder.numero_pedido}`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-koma-border/60">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400">
                  <QrCode className="h-4 w-4" />
                </div>
                <div className="text-left">
                  <h3 className="text-xs font-black text-white">
                    Pagar Pedido #{pixModalOrder.numero_pedido}
                  </h3>
                  <span className="text-[10px] text-koma-muted">Pagamento via Pix</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPixModalOrder(null);
                }}
                className="grid h-8 w-8 place-items-center rounded-xl border border-koma-border text-koma-secondary hover:text-white"
                aria-label="Fechar modal Pix"
              >
                ✕
              </button>
            </div>

            <div className="my-4">
              <span className="text-xs font-bold text-koma-muted block">Valor total</span>
              <span className="text-2xl font-black text-emerald-400 block mt-0.5">
                {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(pixModalOrder.total || 0)}
              </span>
            </div>

            {!pixModalOrder.pagamento.qr_code_base64 && pixModalOrder.pagamento.qr_code && (
              <QRCodeSVG value={pixModalOrder.pagamento.qr_code} size={208} level="M" marginSize={4} className="mx-auto" />
            )}
            {pixModalOrder.pagamento.qr_code_base64 && (
              <div className="mx-auto my-3 flex justify-center">
                <img
                  className="h-48 w-48 rounded-2xl bg-white p-2.5 shadow-md"
                  src={`data:image/png;base64,${pixModalOrder.pagamento.qr_code_base64}`}
                  alt="QR Code Pix do pedido"
                />
              </div>
            )}

            {pixModalOrder.pagamento.qr_code && <PixCopyCode code={pixModalOrder.pagamento.qr_code} />}

            <DirectPixCustomerConfirm
              order={pixModalOrder}
              apiBaseUrl={API_BASE_URL}
              onReported={(nextPayment) => {
                const updatedPayment = { ...pixModalOrder.pagamento, ...nextPayment };
                setPixModalOrder((current) => (current ? { ...current, pagamento: updatedPayment } : current));
                handleOrderPaymentUpdated(pixModalOrder.id, updatedPayment);
              }}
            />

            <ManualPixReceiptContact order={pixModalOrder} phone={activeBrand?.phone} restaurantId={activeBrand?.id} />

            {pixModalOrder.pagamento.ticket_url && (
              <a
                href={pixModalOrder.pagamento.ticket_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 flex h-10 w-full items-center justify-center rounded-xl border border-koma-border text-xs font-bold text-koma-foreground hover:bg-koma-raised"
              >
                Abrir link do pagamento
              </a>
            )}

            {!pixModalOrder.pagamento.confirmacao_manual && <p className="mt-3 text-xs text-koma-muted">A confirmação do pagamento é automática.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
