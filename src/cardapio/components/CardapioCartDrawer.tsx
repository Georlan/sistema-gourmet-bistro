/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import { 
  Product, 
  ProductOption, 
  BrandConfig, 
  getProductImageUrl, 
  LOCAL_PRODUCT_PLACEHOLDER 
} from "../CardapioTypes";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Coins,
  DollarSign,
  MapPin,
  Mail,
  Loader2,
  Minus,
  Percent,
  Phone,
  Plus,
  ShoppingBag,
  Sparkles,
  Store,
  Ticket,
  Trash2,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { formatBrazilianPhone, normalizeBrazilianPhone } from "../customerSession";
import { loadGuestCheckoutContact, saveGuestCheckoutContact } from "../guestCheckoutSession";
import {
  type CustomerRecognitionStatus,
  isCompleteBrazilianPhone,
  recognizePublicCustomer,
} from "../customerRecognition";
import { API_BASE_URL } from "../../config/api";
import {
  EMPTY_DELIVERY_ADDRESS,
  type DeliveryAddressDraft,
  type DeliveryAddressSnapshot,
  deliveryAddressDraftToSnapshot,
  formatDeliveryAddressLegacy,
  getDeliveryAddressValidationError,
  parseDeliveryAddressLegacy,
} from "../../domain/deliveryAddress";
import DeliveryAddressFields from "../../components/shared/DeliveryAddressFields";
import { getDeliveryMinimumRemaining, getDeliveryQuote } from "../deliveryPresentation";
import CardapioPaymentOptions from "./CardapioPaymentOptions";
import { getCheckoutPaymentMethods, getPaymentSelectionError, resolvePaymentSelection, type PaymentMethod } from "../paymentMethods";

export interface CartItem {
  id: string;
  product: Product;
  quantity: number;
  selectedOptions: Record<string, ProductOption[]>;
  notes: string;
}

export type CardapioFulfillment = "delivery" | "pickup" | "dine_in";

export interface CardapioCheckoutRequest {
  deliveryMethod: CardapioFulfillment;
  address: string;
  addressSnapshot?: DeliveryAddressSnapshot;
  deliveryFee: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  paymentMethodDetail?: "dinheiro" | "pix" | "cartao_credito" | "cartao_debito";
  trocoPara?: number;
  bairro?: string;
  cupomCodigo?: string;
  descontoCupom?: number;
  usarCashback?: boolean;
  descontoCashback?: number;
}

interface CardapioCartDrawerProps {
  cart: CartItem[];
  restaurantId: string | number;
  restaurantAddress?: string;
  brandConfig?: BrandConfig;
  allProducts?: Product[];
  onClose: () => void;
  onUpdateQty: (itemId: string, newQty: number) => void;
  onRemoveItem: (itemId: string) => void;
  onAddToCart?: (product: Product, quantity: number, options?: Record<string, ProductOption[]>, notes?: string) => void;
  onPlaceOrder: (orderData: CardapioCheckoutRequest) => void;
  user: any;
  onAuthClick?: () => void;
  orderingEnabled?: boolean;
  orderingMessage?: string;
}

const formatPrice = (value: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
}).format(value);

const emptyAddress = (): DeliveryAddressDraft => ({ ...EMPTY_DELIVERY_ADDRESS });

export default function CardapioCartDrawer({
  cart,
  restaurantId,
  restaurantAddress,
  brandConfig,
  allProducts = [],
  onClose,
  onUpdateQty,
  onRemoveItem,
  onAddToCart,
  onPlaceOrder,
  user,
  onAuthClick,
  orderingEnabled = true,
  orderingMessage = "Pedidos temporariamente pausados.",
}: CardapioCartDrawerProps) {
  const [deliveryMethod, setDeliveryMethod] = useState<CardapioFulfillment>("pickup");
  const [address, setAddress] = useState(user?.address || "");
  const [deliveryAddressDraft, setDeliveryAddressDraft] = useState<DeliveryAddressDraft>(() => (
    parseDeliveryAddressLegacy(user?.address) || emptyAddress()
  ));
  const [legacyAddressHint, setLegacyAddressHint] = useState<string | null>(() => (
    user?.address && !parseDeliveryAddressLegacy(user.address) ? user.address : null
  ));
  const [selectedBairro, setSelectedBairro] = useState(() => deliveryAddressDraft.bairro);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [customerRecognition, setCustomerRecognition] = useState<CustomerRecognitionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [invalidField, setInvalidField] = useState("");
  const [locationQuote, setLocationQuote] = useState<{
    status: "idle" | "loading" | "success" | "error";
    fee?: number;
    distanceKm?: number | null;
    usedFallback?: boolean;
    message?: string;
  }>({ status: "idle" });

  const clearValidation = (fieldId?: string) => {
    if (!fieldId || invalidField === fieldId) setInvalidField("");
    if (errorMessage) setErrorMessage("");
  };

  const reportValidationError = (message: string, fieldId?: string) => {
    setErrorMessage(message);
    setInvalidField(fieldId || "");
    if (!fieldId) return;
    window.requestAnimationFrame(() => {
      const target = document.getElementById(fieldId);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    });
  };

  // Payment detail & Change (Troco)
  const availablePayments = useMemo(() => {
    return getCheckoutPaymentMethods(
      brandConfig?.paymentMethods,
      brandConfig?.onlinePaymentEnabled,
    );
  }, [brandConfig?.onlinePaymentEnabled, brandConfig?.paymentMethods]);
  const [paymentSelection, setPaymentSelection] = useState<{ restaurantId: string; method: PaymentMethod | null }>(() => ({
    restaurantId: String(restaurantId),
    method: availablePayments[0] ?? null,
  }));
  const paymentDetail = resolvePaymentSelection(paymentSelection, restaurantId, availablePayments);
  const paymentError = getPaymentSelectionError(paymentDetail, availablePayments);
  const [trocoPara, setTrocoPara] = useState<string>("");
  const [precisaTroco, setPrecisaTroco] = useState(false);

  const selectPayment = (method: PaymentMethod) => {
    if (!availablePayments.includes(method)) return;
    setPaymentSelection({ restaurantId: String(restaurantId), method });
    clearValidation("cart-payment-methods");
    if (method !== 'dinheiro') {
      setPrecisaTroco(false);
      setTrocoPara("");
    }
  };

  useEffect(() => {
    if (paymentDetail !== null) return;
    setPaymentSelection({ restaurantId: String(restaurantId), method: null });
    setPrecisaTroco(false);
    setTrocoPara("");
  }, [paymentDetail, restaurantId]);

  // Coupon state
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{
    codigo: string;
    desconto: number;
    mensagem: string;
  } | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [couponError, setCouponError] = useState("");

  // Cashback state
  const [useCashback, setUseCashback] = useState(false);

  useEffect(() => {
    const applyStoredAddress = (storedAddress: string) => {
      setAddress(storedAddress);
      const parsedAddress = parseDeliveryAddressLegacy(storedAddress);
      if (parsedAddress) {
        setDeliveryAddressDraft(parsedAddress);
        setSelectedBairro(parsedAddress.bairro);
        setLegacyAddressHint(null);
      } else if (storedAddress.trim()) {
        setDeliveryAddressDraft(emptyAddress());
        setSelectedBairro("");
        setLegacyAddressHint(storedAddress.trim());
      }
    };

    if (user) {
      setGuestName(user.name || "");
      setGuestPhone(formatBrazilianPhone(user.phone || ""));
      applyStoredAddress(user.address || "");
      return;
    }

    const parsed = loadGuestCheckoutContact(restaurantId);
    if (!parsed) return;
    setGuestName(parsed.name);
    setGuestPhone(formatBrazilianPhone(parsed.phone));
    setGuestEmail(parsed.email);
    applyStoredAddress(parsed.address || "");
  }, [restaurantId, user]);

  useEffect(() => {
    if (user) {
      setCustomerRecognition("idle");
      return;
    }
    if (!isCompleteBrazilianPhone(guestPhone)) {
      setCustomerRecognition("idle");
      return;
    }

    const controller = new AbortController();
    setCustomerRecognition("checking");
    const timer = window.setTimeout(() => {
      recognizePublicCustomer(restaurantId, guestPhone, controller.signal)
        .then((found) => {
          setCustomerRecognition(found ? "found" : "new");
          if (found) setGuestName("");
        })
        .catch((error: unknown) => {
          if ((error as Error | undefined)?.name === "AbortError") return;
          // Reconhecimento é uma conveniência: falha de rede não bloqueia checkout.
          setCustomerRecognition("idle");
        });
    }, 220);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [guestPhone, restaurantId, user]);

  useEffect(() => {
    if (user) return;
    try {
      saveGuestCheckoutContact(restaurantId, {
        name: guestName.trim(),
        phone: normalizeBrazilianPhone(guestPhone),
        email: guestEmail.trim().toLowerCase(),
        address: address.trim(),
      });
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }
  }, [address, guestEmail, guestName, guestPhone, restaurantId, user]);

  // Subtotal calculation
  const subtotal = useMemo(() => cart.reduce((acc, item) => {
    let itemPrice = item.product.price;
    Object.values(item.selectedOptions).forEach((opts) => {
      opts.forEach((option) => {
        itemPrice += option.extraPrice;
      });
    });
    return acc + itemPrice * item.quantity;
  }, 0), [cart]);

  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const deliveryQuote = getDeliveryQuote(brandConfig, subtotal, selectedBairro);
  const explicitOrderTypes = brandConfig?.orderTypes;
  const pickupEnabled = !explicitOrderTypes || explicitOrderTypes.includes('retirada');
  const dineInEnabled = !explicitOrderTypes || explicitOrderTypes.includes('consumo_local');
  const deliveryEnabled = explicitOrderTypes
    ? explicitOrderTypes.includes('delivery')
    : brandConfig?.deliveryEnabled !== false;
  const distanceMode = brandConfig?.tipoTaxaEntrega === "distancia";
  const quotedDistanceFee = distanceMode && locationQuote.status === "success"
    ? Number(locationQuote.fee)
    : null;
  const effectiveDeliveryQuoteFee = quotedDistanceFee != null && Number.isFinite(quotedDistanceFee)
    ? quotedDistanceFee
    : deliveryQuote.fee;
  const deliveryFee = deliveryMethod === "delivery" ? effectiveDeliveryQuoteFee : 0;
  const deliveryLabel = distanceMode
    ? locationQuote.status === "success" && locationQuote.distanceKm != null
      ? `${locationQuote.distanceKm.toFixed(1)} km · ${effectiveDeliveryQuoteFee === 0 ? "sem taxa" : `taxa de ${formatPrice(effectiveDeliveryQuoteFee)}`}`
      : effectiveDeliveryQuoteFee === 0
        ? "Sem taxa de entrega"
        : `A partir de ${formatPrice(effectiveDeliveryQuoteFee)}`
    : deliveryQuote.awaitingNeighborhood
      ? "Taxa por bairro"
      : deliveryQuote.fee === 0 ? "Sem taxa de entrega" : `Taxa de ${formatPrice(deliveryQuote.fee)}`;
  const minimumOrder = brandConfig?.pedidoMinimo || 0;
  const remainingMinimum = getDeliveryMinimumRemaining(brandConfig, subtotal, deliveryMethod);
  const freeDeliveryThreshold = brandConfig?.freteGratisValor || 0;

  useEffect(() => {
    const currentEnabled =
      (deliveryMethod === "pickup" && pickupEnabled)
      || (deliveryMethod === "dine_in" && dineInEnabled)
      || (deliveryMethod === "delivery" && deliveryEnabled);
    if (currentEnabled) return;
    if (pickupEnabled) setDeliveryMethod("pickup");
    else if (dineInEnabled) setDeliveryMethod("dine_in");
    else if (deliveryEnabled) setDeliveryMethod("delivery");
    setSelectedBairro("");
  }, [deliveryEnabled, deliveryMethod, dineInEnabled, pickupEnabled]);

  useEffect(() => {
    const latitude = deliveryAddressDraft.latitude;
    const longitude = deliveryAddressDraft.longitude;
    if (!distanceMode || deliveryMethod !== "delivery" || latitude == null || longitude == null) return;

    const controller = new AbortController();
    setLocationQuote((current) => ({ ...current, status: "loading", message: undefined }));
    fetch(`${API_BASE_URL}/api/cardapio-digital/delivery/quote?restaurante_id=${encodeURIComponent(String(restaurantId))}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ latitude, longitude, subtotal }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "Não foi possível calcular a distância.");
        return data;
      })
      .then((data) => {
        setLocationQuote({
          status: "success",
          fee: Number(data.fee) || 0,
          distanceKm: data.distance_km == null ? null : Number(data.distance_km),
          usedFallback: data.used_fallback === true,
          message: data.message || undefined,
        });
      })
      .catch((error: unknown) => {
        if ((error as Error | undefined)?.name === "AbortError") return;
        setLocationQuote({
          status: "error",
          message: error instanceof Error ? error.message : "Não foi possível calcular a distância.",
        });
      });

    return () => controller.abort();
  }, [
    deliveryAddressDraft.latitude,
    deliveryAddressDraft.longitude,
    deliveryMethod,
    distanceMode,
    restaurantId,
    subtotal,
  ]);

  const requestDeliveryLocation = () => {
    const typedAddress = [
      deliveryAddressDraft.logradouro,
      deliveryAddressDraft.numero,
      deliveryAddressDraft.bairro,
      deliveryAddressDraft.cidade,
      deliveryAddressDraft.uf,
      deliveryAddressDraft.cep,
    ].some((value) => String(value || "").trim());
    if (typedAddress && deliveryAddressDraft.latitude == null && deliveryAddressDraft.longitude == null) {
      setLocationQuote({
        status: "error",
        message: "A localização não foi aplicada porque já existe um endereço digitado. Para evitar calcular outra cidade, mantenha o endereço ou limpe-o antes de usar o GPS.",
      });
      return;
    }
    if (!navigator.geolocation) {
      setLocationQuote({
        status: "error",
        message: "Seu navegador não oferece localização. A taxa mínima continuará sendo usada.",
      });
      return;
    }
    setLocationQuote({ status: "loading" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!Number.isFinite(position.coords.accuracy) || position.coords.accuracy > 200) {
          setLocationQuote({
            status: "error",
            message: "Sua localização está imprecisa. Ative a localização precisa e tente novamente.",
          });
          return;
        }
        setDeliveryAddressDraft((current) => ({
          ...current,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }));
      },
      () => {
        setLocationQuote({
          status: "error",
          message: "Localização não autorizada. Você pode continuar normalmente com a taxa mínima.",
        });
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  };

  // Cashback deduction calculation
  const userCashbackBalance = Number(user?.saldo_cashback || 0);
  const cashbackDiscount = useMemo(() => {
    if (!useCashback || userCashbackBalance <= 0) return 0;
    // Cap at subtotal - coupon discount
    const availableTotal = Math.max(0, subtotal - (appliedCoupon?.desconto || 0));
    return Math.min(userCashbackBalance, availableTotal);
  }, [useCashback, userCashbackBalance, subtotal, appliedCoupon]);

  // Total calculation
  const couponDiscount = appliedCoupon?.desconto || 0;
  const total = Math.max(0, subtotal + deliveryFee - couponDiscount - cashbackDiscount);

  // Troco calculation
  const trocoValorNum = parseFloat(trocoPara) || 0;
  const trocoCalculado = precisaTroco && trocoValorNum > total ? trocoValorNum - total : 0;

  // Upselling suggestions (items from other categories not currently in cart)
  const upsellSuggestions = useMemo(() => {
    if (!allProducts || allProducts.length === 0) return [];
    const cartProductIds = new Set(cart.map((item) => item.product.id));
    return allProducts
      .filter((p) => !cartProductIds.has(p.id) && p.isAvailable !== false && !p.modifiers?.length && !p.modifierGroups?.length && /bebida|sobremesa|suco|refrigerante|cerveja|drink|doce|sorvete/.test(p.category.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()))
      .slice(0, 4);
  }, [allProducts, cart]);

  // Handle Coupon Validation
  const handleApplyCoupon = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!couponCode.trim()) return;

    setValidatingCoupon(true);
    setCouponError("");
    try {
      const res = await fetch(`${API_BASE_URL}/cardapio/cupons/validar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurante_id: Number(restaurantId),
          codigo: couponCode.trim().toUpperCase(),
          subtotal,
          cliente_telefone: user?.phone || guestPhone,
        }),
      });

      const data = await res.json();
      if (!data.valido) {
        setCouponError(data.mensagem || "Cupom inválido.");
        setAppliedCoupon(null);
      } else {
        setAppliedCoupon({
          codigo: data.codigo,
          desconto: data.desconto_calculado || 0,
          mensagem: data.mensagem || "Cupom aplicado com sucesso!",
        });
        setCouponError("");
      }
    } catch (err) {
      setCouponError("Erro ao validar cupom. Tente novamente.");
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponCode("");
    setCouponError("");
  };

  const recognizedExistingCustomer = !user && customerRecognition === "found";
  const customerName = user?.name || (recognizedExistingCustomer ? "Cliente identificado" : guestName);
  const customerPhone = user?.phone || normalizeBrazilianPhone(guestPhone);

  const handleCheckout = () => {
    setErrorMessage("");
    setInvalidField("");

    if (!orderingEnabled) {
      reportValidationError(orderingMessage);
      return;
    }
    if (cart.length === 0) {
      reportValidationError("Sua sacola está vazia.");
      return;
    }
    if (paymentError || !paymentDetail) {
      reportValidationError(paymentError || "Escolha uma forma de pagamento.", "cart-payment-methods");
      return;
    }

    // Check minimum order
    const pedidoMin = brandConfig?.pedidoMinimo || 0;
    if (deliveryMethod === "delivery" && pedidoMin > 0 && subtotal < pedidoMin) {
      reportValidationError(`O pedido mínimo para entrega é de ${formatPrice(pedidoMin)} (faltam ${formatPrice(pedidoMin - subtotal)}).`, "cart-receive-methods");
      return;
    }

    const selectedFulfillmentEnabled =
      (deliveryMethod === "pickup" && pickupEnabled)
      || (deliveryMethod === "dine_in" && dineInEnabled)
      || (deliveryMethod === "delivery" && deliveryEnabled);
    if (!selectedFulfillmentEnabled) {
      reportValidationError("Esta modalidade de pedido não está disponível para este restaurante.", "cart-receive-methods");
      return;
    }

    if (!recognizedExistingCustomer && customerName.trim().length < 2) {
      reportValidationError("Informe seu nome para o restaurante identificar o pedido.", "input-guest-name");
      return;
    }
    if (normalizeBrazilianPhone(customerPhone).length < 10) {
      reportValidationError("Informe um celular válido com DDD.", "input-guest-phone");
      return;
    }

    if (
      deliveryMethod === "delivery"
      && distanceMode
      && deliveryAddressDraft.latitude != null
      && deliveryAddressDraft.longitude != null
      && locationQuote.status === "loading"
    ) {
      reportValidationError("Aguarde um instante enquanto calculamos a taxa pela sua localização.", "cart-receive-methods");
      return;
    }
    if (
      deliveryMethod === "delivery"
      && distanceMode
      && deliveryAddressDraft.latitude != null
      && deliveryAddressDraft.longitude != null
      && locationQuote.status === "error"
    ) {
      reportValidationError(locationQuote.message || "Não foi possível validar a distância de entrega.", "cart-receive-methods");
      return;
    }

    const addressSnapshot = deliveryMethod === "delivery"
      ? deliveryAddressDraftToSnapshot(deliveryAddressDraft)
      : null;
    if (deliveryMethod === "delivery" && !addressSnapshot) {
      reportValidationError(
        getDeliveryAddressValidationError(deliveryAddressDraft) || "Informe o endereço completo de entrega.",
        "delivery-address-logradouro",
      );
      return;
    }

    if (paymentDetail === "pix" && !/^\S+@\S+\.\S+$/.test(guestEmail.trim())) {
      reportValidationError("Informe um e-mail válido para gerar o pagamento Pix.", "input-customer-email");
      return;
    }

    if (paymentDetail === "dinheiro" && precisaTroco && trocoValorNum < total) {
      reportValidationError(`O valor para troco deve ser maior que o total do pedido (${formatPrice(total)}).`, "payment-change-for");
      return;
    }

    const canonicalAddress = addressSnapshot ? formatDeliveryAddressLegacy(addressSnapshot) : "";
    onPlaceOrder({
      deliveryFee,
      deliveryMethod,
      address: deliveryMethod === "delivery"
        ? canonicalAddress
        : deliveryMethod === "dine_in"
          ? "Consumo no local"
          : "Retirada no Balcão",
      addressSnapshot: addressSnapshot || undefined,
      customerName: customerName.trim(),
      customerPhone: normalizeBrazilianPhone(customerPhone),
      customerEmail: paymentDetail === "pix" ? guestEmail.trim().toLowerCase() : undefined,
      paymentMethodDetail: paymentDetail,
      trocoPara: paymentDetail === "dinheiro" && precisaTroco && trocoValorNum > 0 ? trocoValorNum : undefined,
      bairro: addressSnapshot?.bairro || undefined,
      cupomCodigo: appliedCoupon?.codigo,
      descontoCupom: couponDiscount > 0 ? couponDiscount : undefined,
      usarCashback: useCashback && cashbackDiscount > 0,
      descontoCashback: cashbackDiscount > 0 ? cashbackDiscount : undefined,
    });
  };

  return (
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      // Above the sticky header (45), below authentication and checkout (50).
      className="fixed inset-0 z-[46] flex items-end justify-end bg-black/65 sm:items-stretch animate-fade-in cursor-pointer"
      id="cart-overlay"
    >
      <div
        className="flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-[28px] border border-koma-border bg-koma-panel shadow-2xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:rounded-l-[28px] sm:border-y-0 sm:border-r-0 animate-slide-left"
        id="cart-drawer-container"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-koma-border px-4 py-3.5 sm:px-5">
          <div>
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-emerald-500" />
              <h2 className="font-display text-base font-black text-koma-foreground">Sua sacola</h2>
              {itemCount > 0 && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-500">{itemCount}</span>
              )}
            </div>
            <p className="mt-1 text-[10px] text-koma-muted">Itens, descontos, entrega e contato.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-koma-muted transition hover:bg-koma-raised hover:text-koma-foreground cursor-pointer"
            aria-label="Fechar sacola"
            id="btn-close-cart"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {cart.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-start p-6 text-center overflow-y-auto no-scrollbar">
            <div className="mt-4 grid h-16 w-16 place-items-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              <ShoppingBag className="h-8 w-8" />
            </div>
            <h3 className="mt-4 text-base font-black text-white">Sua sacola está vazia</h3>
            <p className="mt-1 max-w-[280px] text-xs leading-relaxed text-gray-400">
              Escolha suas delícias favoritas no cardápio para começar seu pedido.
            </p>

            {allProducts.length > 0 && (
              <div className="mt-6 w-full text-left">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-400 mb-3">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Mais Pedidos da Casa</span>
                </div>
                <div className="space-y-2.5">
                  {allProducts.slice(0, 3).map((prod) => (
                    <div
                      key={prod.id}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-white/10 bg-white/5 hover:border-emerald-500/30 transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={getProductImageUrl(prod.image)}
                          alt={prod.name}
                          className="w-11 h-11 rounded-lg object-cover bg-white/5 border border-white/10 shrink-0"
                          onError={(e) => {
                            e.currentTarget.onerror = null;
                            e.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
                          }}
                        />
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-white truncate">{prod.name}</h4>
                          <span className="text-xs font-extrabold text-emerald-400">{formatPrice(prod.price)}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (onAddToCart) {
                            onAddToCart(prod, 1);
                          }
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold shrink-0 transition cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Adicionar</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="mt-6 w-full rounded-xl bg-white/10 hover:bg-white/15 py-3 text-xs font-bold text-white transition cursor-pointer"
            >
              Explorar todo o cardápio
            </button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5 no-scrollbar">
              {/* Status Alert */}
              {!orderingEnabled && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-[10px] font-semibold leading-relaxed text-amber-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{orderingMessage}</span>
                </div>
              )}

              {/* Free Delivery Banner Progress */}
              {freeDeliveryThreshold > 0 && deliveryMethod === "delivery" && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs">
                  {subtotal >= freeDeliveryThreshold ? (
                    <div className="flex items-center gap-2 text-emerald-400 font-bold">
                      <Sparkles className="w-4 h-4 shrink-0" />
                      <span>Parabéns! Você ganhou Frete Grátis neste pedido!</span>
                    </div>
                  ) : (
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-semibold text-koma-foreground mb-1.5">
                        <span>Adicione mais <strong>{formatPrice(freeDeliveryThreshold - subtotal)}</strong></span>
                        <span className="text-emerald-400 font-bold">Frete Grátis</span>
                      </div>
                      <div className="w-full h-1.5 bg-koma-card rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, (subtotal / freeDeliveryThreshold) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Section 1: Cart Items */}
              <section>
                <div className="mb-2.5 flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-koma-muted">1. Seu pedido</h3>
                  <span className="text-xs font-bold text-koma-subtle">{itemCount} {itemCount === 1 ? "item" : "itens"}</span>
                </div>
                <div className="space-y-2.5">
                  {cart.map((item) => {
                    let unitPrice = item.product.price;
                    const optionNames: string[] = [];
                    Object.values(item.selectedOptions).forEach((opts) => {
                      opts.forEach((option) => {
                        unitPrice += option.extraPrice;
                        optionNames.push(option.name);
                      });
                    });

                    return (
                      <div key={item.id} className="flex items-start gap-3 rounded-2xl border border-koma-border bg-koma-card p-3.5" id={`cart-item-${item.id}`}>
                        <img
                          src={getProductImageUrl(item.product.image)}
                          alt={item.product.name}
                          className="h-16 w-16 shrink-0 rounded-xl object-cover bg-white/5"
                          crossOrigin="anonymous"
                          referrerPolicy="no-referrer"
                          onError={(event) => {
                            event.currentTarget.onerror = null;
                            event.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-sm font-bold text-koma-foreground">{item.product.name}</h4>
                          {optionNames.length > 0 && <p className="mt-0.5 truncate text-xs text-koma-muted">{optionNames.join(", ")}</p>}
                          {item.notes && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-amber-400">Obs.: {item.notes}</p>}
                          <strong className="mt-2 block text-sm font-black text-emerald-400">{formatPrice(unitPrice * item.quantity)}</strong>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2.5">
                          <button type="button" onClick={() => onRemoveItem(item.id)} className="grid h-8 w-8 place-items-center rounded-lg text-koma-subtle transition hover:bg-rose-500/10 hover:text-rose-400" aria-label={`Remover ${item.product.name}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <div className="flex items-center rounded-xl border border-koma-border bg-koma-panel p-0.5">
                            <button type="button" onClick={() => onUpdateQty(item.id, item.quantity - 1)} className="grid h-8 w-8 place-items-center rounded-lg text-koma-secondary transition hover:bg-koma-raised" aria-label={`Diminuir ${item.product.name}`}>
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="w-7 text-center text-xs font-black text-koma-foreground">{item.quantity}</span>
                            <button type="button" onClick={() => onUpdateQty(item.id, item.quantity + 1)} className="grid h-8 w-8 place-items-center rounded-lg text-koma-secondary transition hover:bg-koma-raised" aria-label={`Aumentar ${item.product.name}`}>
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Upselling / Cross-selling Carousel */}
              {upsellSuggestions.length > 0 && onAddToCart && (
                <section className="border-t border-koma-border pt-4">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-koma-muted">Uma bebida ou sobremesa para acompanhar?</h3>
                  </div>
                  <div className="flex gap-2.5 overflow-x-auto pb-2 no-scrollbar">
                    {upsellSuggestions.map((prod) => (
                      <div
                        key={prod.id}
                        className="min-w-[140px] max-w-[140px] bg-koma-card border border-koma-border rounded-xl p-2 flex flex-col justify-between shrink-0"
                      >
                        <img
                          src={getProductImageUrl(prod.image)}
                          alt={prod.name}
                          className="h-16 w-full rounded-lg object-cover mb-1.5"
                          onError={(e) => {
                            e.currentTarget.onerror = null;
                            e.currentTarget.src = LOCAL_PRODUCT_PLACEHOLDER;
                          }}
                        />
                        <div>
                          <h4 className="text-[11px] font-bold text-koma-foreground line-clamp-1">{prod.name}</h4>
                          <span className="text-[10px] font-mono font-bold text-emerald-400 block mt-0.5">{formatPrice(prod.price)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onAddToCart(prod, 1)}
                          className="mt-2 w-full py-1 px-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 transition"
                        >
                          <Plus className="w-3 h-3" /> Adicionar
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Section 2: Delivery Method & Address */}
              <section className="border-t border-koma-border pt-5" id="cart-receive-methods" tabIndex={-1} aria-describedby={invalidField === "cart-receive-methods" ? "cart-checkout-error" : undefined}>
                <h3 className="text-xs font-black uppercase tracking-wider text-koma-muted">2. Como quer receber?</h3>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button type="button" disabled={!pickupEnabled} aria-pressed={deliveryMethod === "pickup"} onClick={() => { if (pickupEnabled) setDeliveryMethod("pickup"); clearValidation("cart-receive-methods"); }} className={`min-w-0 rounded-2xl border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-55 ${deliveryMethod === "pickup" ? "border-emerald-500/45 bg-emerald-500/10" : "border-koma-border bg-koma-card hover:border-emerald-500/25"}`}>
                    <span className="flex items-center justify-between gap-2"><ShoppingBag className={deliveryMethod === "pickup" ? "h-5 w-5 text-emerald-500" : "h-5 w-5 text-koma-muted"} />{deliveryMethod === "pickup" && <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />}</span>
                    <strong className="mt-2 block text-sm text-koma-foreground">Retirada</strong>
                    <span className="mt-1 block text-[11px] leading-relaxed text-koma-muted">Buscar no restaurante</span>
                  </button>
                  <button type="button" disabled={!dineInEnabled} aria-pressed={deliveryMethod === "dine_in"} onClick={() => { if (dineInEnabled) setDeliveryMethod("dine_in"); clearValidation("cart-receive-methods"); }} className={`min-w-0 rounded-2xl border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-55 ${deliveryMethod === "dine_in" ? "border-emerald-500/45 bg-emerald-500/10" : "border-koma-border bg-koma-card hover:border-emerald-500/25"}`}>
                    <span className="flex items-center justify-between gap-2"><Store className={deliveryMethod === "dine_in" ? "h-5 w-5 text-emerald-500" : "h-5 w-5 text-koma-muted"} />{deliveryMethod === "dine_in" && <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />}</span>
                    <strong className="mt-2 block text-sm text-koma-foreground">Consumo local</strong>
                    <span className="mt-1 block text-[11px] leading-relaxed text-koma-muted">Comer no restaurante</span>
                  </button>
                  <button type="button" disabled={!deliveryEnabled} aria-pressed={deliveryMethod === "delivery"} onClick={() => { if (deliveryEnabled) setDeliveryMethod("delivery"); clearValidation("cart-receive-methods"); }} className={`min-w-0 rounded-2xl border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-55 ${deliveryMethod === "delivery" ? "border-emerald-500/45 bg-emerald-500/10" : "border-koma-border bg-koma-card hover:border-emerald-500/25"}`}>
                    <span className="flex items-center justify-between gap-2"><Truck className={deliveryMethod === "delivery" ? "h-5 w-5 text-emerald-500" : "h-5 w-5 text-koma-muted"} />{deliveryMethod === "delivery" && <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />}</span>
                    <strong className="mt-2 block text-sm text-koma-foreground">Entrega</strong>
                    <span className="mt-1 block text-[11px] leading-relaxed text-koma-muted">{deliveryEnabled ? deliveryLabel : "Indisponível no momento"}</span>
                  </button>
                </div>

                {deliveryMethod === "dine_in" && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
                    <Store className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <div className="min-w-0 text-xs leading-relaxed">
                      <strong className="text-koma-foreground">Para consumir no local</strong>
                      <p className="mt-1 text-koma-muted">Você pode pedir antes de chegar. O restaurante pode associar seu pedido a uma mesa depois.</p>
                      {restaurantAddress && <p className="mt-1 break-words text-koma-subtle">{restaurantAddress}</p>}
                    </div>
                  </div>
                )}

                {deliveryMethod === "pickup" && restaurantAddress && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-koma-border p-3">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <div className="min-w-0 text-xs leading-relaxed"><strong className="text-koma-foreground">Local de retirada</strong><p className="mt-1 break-words text-koma-muted">{restaurantAddress}</p></div>
                  </div>
                )}

                {deliveryMethod === "delivery" && (
                  <div className="mt-3 space-y-3">
                    <DeliveryAddressFields
                      value={deliveryAddressDraft}
                      onChange={(nextAddress) => {
                        setDeliveryAddressDraft(nextAddress);
                        setSelectedBairro(nextAddress.bairro);
                        if (distanceMode && (nextAddress.latitude == null || nextAddress.longitude == null)) {
                          setLocationQuote({ status: "idle" });
                        }
                        const snapshot = deliveryAddressDraftToSnapshot(nextAddress);
                        setAddress(snapshot ? formatDeliveryAddressLegacy(snapshot) : "");
                        setLegacyAddressHint(null);
                        clearValidation("delivery-address-logradouro");
                      }}
                      neighborhoodOptions={(brandConfig?.tabelaTaxasBairros || []).map((item) => ({
                        value: item.bairro,
                        label: `${item.bairro} (${item.taxa === 0 ? "Grátis" : formatPrice(item.taxa)})`,
                      }))}
                      legacyHint={legacyAddressHint}
                      idPrefix="delivery-address"
                    />
                    {distanceMode && (
                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <strong className="text-xs text-koma-foreground">Está no local da entrega?</strong>
                            <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">Use sua localização somente se o pedido for entregue onde você está agora. Para outro endereço, continue sem localização.</p>
                          </div>
                          <button
                            type="button"
                            onClick={requestDeliveryLocation}
                            disabled={locationQuote.status === "loading"}
                            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-black text-emerald-600 transition hover:bg-emerald-500/15 disabled:cursor-wait disabled:opacity-60 dark:text-emerald-300"
                          >
                            {locationQuote.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                            {locationQuote.status === "loading" ? "Calculando…" : "Usar minha localização"}
                          </button>
                        </div>
                        <p className="mt-2 text-[10px] leading-relaxed text-koma-muted" aria-live="polite">
                          {locationQuote.status === "success"
                            ? locationQuote.distanceKm != null
                              ? `Distância estimada: ${locationQuote.distanceKm.toFixed(1)} km. ${effectiveDeliveryQuoteFee === 0 ? "Entrega grátis neste pedido." : `Taxa calculada: ${formatPrice(effectiveDeliveryQuoteFee)}.`}`
                              : "Não foi possível medir a distância; a taxa mínima foi aplicada."
                            : locationQuote.status === "error"
                              ? locationQuote.message
                              : `Sem localização, o pedido continua usando a taxa mínima de ${formatPrice(deliveryQuote.fee)}.`}
                        </p>
                      </div>
                    )}
                    <p className="break-words text-xs leading-relaxed text-koma-muted" aria-live="polite">
                      {distanceMode
                        ? effectiveDeliveryQuoteFee === 0
                          ? "Sem taxa de entrega neste pedido."
                          : `Taxa de ${formatPrice(effectiveDeliveryQuoteFee)} incluída no resumo.`
                        : deliveryQuote.awaitingNeighborhood
                          ? "Selecione ou informe seu bairro para atualizar a taxa. Por enquanto, o total usa a taxa padrão estimada."
                          : `${selectedBairro ? `${selectedBairro}: ` : ""}${deliveryQuote.fee === 0 ? "sem taxa de entrega neste pedido." : `taxa de ${formatPrice(deliveryQuote.fee)} incluída no resumo.`}`}
                    </p>
                  </div>
                )}
              </section>

              {/* Section 3: Cupons & Descontos */}
              <section className="border-t border-koma-border pt-5">
                <h3 className="text-xs font-black uppercase tracking-wider text-koma-muted mb-2.5">3. Descontos & Benefícios</h3>
                
                {/* Coupon Box */}
                {appliedCoupon ? (
                  <div className="flex items-center justify-between p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs">
                    <div className="flex items-center gap-2">
                      <Ticket className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div>
                        <span className="font-mono font-bold text-emerald-300">{appliedCoupon.codigo}</span>
                        <p className="text-[10px] text-emerald-400/80 mt-0.5">{appliedCoupon.mensagem} (- {formatPrice(appliedCoupon.desconto)})</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveCoupon}
                      className="p-1 text-koma-muted hover:text-rose-400 rounded-lg"
                      title="Remover cupom"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleApplyCoupon} className="flex gap-2">
                    <div className="relative flex-1">
                      <Ticket className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
                      <input
                        type="text"
                        placeholder="Código do cupom..."
                        value={couponCode}
                        onChange={(e) => {
                          setCouponCode(e.target.value.toUpperCase());
                          setCouponError("");
                        }}
                        className="w-full pl-9 pr-3 py-2 bg-koma-card border border-koma-border rounded-xl text-xs font-mono font-bold uppercase text-koma-foreground placeholder:normal-case placeholder:font-normal focus:outline-none focus:border-emerald-500 tracking-wider"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={validatingCoupon || !couponCode.trim()}
                      className="px-4 py-2 bg-koma-raised hover:bg-emerald-500 hover:text-white border border-koma-border rounded-xl text-xs font-bold text-koma-foreground transition disabled:opacity-50"
                    >
                      {validatingCoupon ? "..." : "Aplicar"}
                    </button>
                  </form>
                )}
                {couponError && (
                  <p className="text-[10px] text-rose-400 font-semibold mt-1.5 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {couponError}
                  </p>
                )}

                {/* Cashback Toggle (if user has balance) */}
                {userCashbackBalance > 0 && (
                  <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Coins className="w-4 h-4 text-amber-400 shrink-0" />
                      <div>
                        <span className="text-xs font-bold text-amber-300">Saldo de Cashback</span>
                        <p className="text-[10px] text-koma-muted">Você tem {formatPrice(userCashbackBalance)} acumulados</p>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useCashback}
                        onChange={(e) => setUseCashback(e.target.checked)}
                        className="rounded border-amber-500 text-amber-500 focus:ring-0"
                      />
                      <span className="text-xs font-bold text-amber-300">Usar</span>
                    </label>
                  </div>
                )}
              </section>

              {/* Section 4: Forma de Pagamento & Troco */}
              <section className="border-t border-koma-border pt-5" id="cart-payment-methods" tabIndex={-1} aria-describedby={invalidField === "cart-payment-methods" ? "cart-checkout-error" : undefined}>
                <h3 className="text-xs font-black uppercase tracking-wider text-koma-muted">4. Como quer pagar?</h3>
                <p className="mt-2 mb-3 text-xs leading-relaxed text-koma-muted">Pix é pago agora e só libera o pedido após confirmação. Dinheiro e cartão são pagos pessoalmente {deliveryMethod === "delivery" ? "na entrega" : "na retirada"}.</p>
                
                <CardapioPaymentOptions available={availablePayments} selected={paymentDetail} onSelect={selectPayment} />

                {/* Troco Calculator for Dinheiro */}
                {paymentDetail === "dinheiro" && (
                  <div className="mt-3 p-3 bg-koma-card border border-koma-border rounded-xl space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-koma-foreground">Precisa de troco?</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          aria-pressed={!precisaTroco}
                          onClick={() => setPrecisaTroco(false)}
                          className={`min-h-11 min-w-11 px-3 py-2 rounded-lg text-xs font-bold ${!precisaTroco ? 'bg-emerald-500 text-white' : 'bg-koma-raised text-koma-muted'}`}
                        >
                          Não
                        </button>
                        <button
                          type="button"
                          aria-pressed={precisaTroco}
                          onClick={() => setPrecisaTroco(true)}
                          className={`min-h-11 min-w-11 px-3 py-2 rounded-lg text-xs font-bold ${precisaTroco ? 'bg-emerald-500 text-white' : 'bg-koma-raised text-koma-muted'}`}
                        >
                          Sim
                        </button>
                      </div>
                    </div>

                    {precisaTroco && (
                      <div className="space-y-2 pt-2 border-t border-koma-border/60">
                        <label htmlFor="payment-change-for" className="block text-xs font-semibold text-koma-foreground">Vai pagar com quanto?</label>
                        <div className="flex gap-2">
                          {[50, 100, 200].map((val) => (
                            <button
                              key={val}
                              type="button"
                              aria-pressed={trocoPara === String(val)}
                              onClick={() => setTrocoPara(String(val))}
                              className={`min-h-11 min-w-0 flex-1 py-2 rounded-lg border text-xs font-mono font-bold transition ${
                                trocoPara === String(val)
                                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                                  : "border-koma-border bg-koma-raised text-koma-muted"
                              }`}
                            >
                              R$ {val}
                            </button>
                          ))}
                        </div>
                        <div className="relative mt-2">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-koma-muted">R$</span>
                          <input
                            type="number"
                            id="payment-change-for"
                            inputMode="decimal"
                            step="0.01"
                            placeholder="Outro valor..."
                            value={trocoPara}
                            onChange={(e) => { setTrocoPara(e.target.value); clearValidation("payment-change-for"); }}
                            aria-invalid={invalidField === "payment-change-for"}
                            aria-describedby={invalidField === "payment-change-for" ? "cart-checkout-error" : undefined}
                            className={`min-h-12 w-full pl-9 pr-3 py-2 bg-koma-raised border rounded-xl text-base font-mono font-bold text-koma-foreground outline-none focus:border-emerald-500 ${invalidField === "payment-change-for" ? "border-rose-500" : "border-koma-border"}`}
                          />
                        </div>
                        {trocoCalculado > 0 && (
                          <div className="flex justify-between text-xs pt-1 text-emerald-400 font-bold">
                            <span>Troco estimado:</span>
                            <span className="font-mono">{formatPrice(trocoCalculado)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Section 5: Identification */}
              <section className="border-t border-koma-border pt-5">
                <h3 className="text-xs font-black uppercase tracking-wider text-koma-muted">5. Identificação</h3>
                {user ? (
                  <div className="mt-3 flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <div>
                      <p className="text-xs font-black text-koma-foreground">{user.name}</p>
                      <p className="mt-0.5 text-[10px] text-koma-muted">{formatBrazilianPhone(user.phone || "")} · cliente identificado</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">Celular com DDD</span>
                      <span className="relative block"><Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-koma-muted" /><input type="tel" inputMode="numeric" autoComplete="tel" placeholder="(00) 00000-0000" value={guestPhone} onChange={(event) => { setGuestPhone(formatBrazilianPhone(event.target.value)); clearValidation("input-guest-phone"); }} aria-invalid={invalidField === "input-guest-phone"} aria-describedby={invalidField === "input-guest-phone" ? "cart-checkout-error" : undefined} className={`h-12 w-full rounded-xl border bg-koma-card pl-11 pr-4 text-sm text-koma-foreground outline-none transition placeholder:text-koma-subtle focus:border-emerald-500 ${invalidField === "input-guest-phone" ? "border-rose-500" : "border-koma-border"}`} id="input-guest-phone" /></span>
                    </label>
                    {customerRecognition === "checking" && (
                      <p className="text-[10px] font-semibold text-koma-muted" role="status">Verificando se este número já está no restaurante...</p>
                    )}
                    {customerRecognition === "found" && (
                      <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2.5" role="status">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        <p className="text-[10px] font-semibold leading-relaxed text-emerald-300">Cliente identificado. Por segurança, não exibimos seus dados aqui; o pedido será vinculado à ficha já cadastrada.</p>
                      </div>
                    )}
                    {customerRecognition === "new" && (
                      <p className="text-[10px] font-semibold leading-relaxed text-koma-muted" role="status">Número novo — criaremos a ficha comercial ao enviar o pedido.</p>
                    )}
                    {customerRecognition !== "found" && (
                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">Seu nome</span>
                        <span className="relative block"><UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-koma-muted" /><input type="text" autoComplete="name" maxLength={100} placeholder="Como devemos chamar você?" value={guestName} onChange={(event) => { setGuestName(event.target.value); clearValidation("input-guest-name"); }} aria-invalid={invalidField === "input-guest-name"} aria-describedby={invalidField === "input-guest-name" ? "cart-checkout-error" : undefined} className={`h-12 w-full rounded-xl border bg-koma-card pl-11 pr-4 text-sm text-koma-foreground outline-none transition placeholder:text-koma-subtle focus:border-emerald-500 ${invalidField === "input-guest-name" ? "border-rose-500" : "border-koma-border"}`} id="input-guest-name" /></span>
                      </label>
                    )}
                    {onAuthClick && <button type="button" onClick={onAuthClick} className="text-left text-xs font-semibold leading-relaxed text-koma-muted transition hover:text-emerald-400">Quer acumular pontos de fidelidade? <strong className="text-emerald-400">Entrar na conta.</strong></button>}
                  </div>
                )}
                {paymentDetail === "pix" && (
                  <label className="mt-3 block">
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-koma-muted">E-mail para o Pix</span>
                    <span className="relative block"><Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-koma-muted" /><input type="email" autoComplete="email" maxLength={254} placeholder="voce@exemplo.com" value={guestEmail} onChange={(event) => { setGuestEmail(event.target.value); clearValidation("input-customer-email"); }} aria-invalid={invalidField === "input-customer-email"} aria-describedby={invalidField === "input-customer-email" ? "cart-checkout-error" : undefined} className={`h-12 w-full rounded-xl border bg-koma-card pl-11 pr-4 text-sm text-koma-foreground outline-none transition placeholder:text-koma-subtle focus:border-emerald-500 ${invalidField === "input-customer-email" ? "border-rose-500" : "border-koma-border"}`} id="input-customer-email" /></span>
                  </label>
                )}
              </section>

              {errorMessage && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[10px] font-semibold text-rose-400" role="alert" id="cart-checkout-error">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>

            {/* Footer Summary & Action */}
            <div className="shrink-0 border-t border-koma-border bg-koma-panel p-4 sm:p-5">
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-koma-muted"><span>Subtotal</span><span>{formatPrice(subtotal)}</span></div>
                {deliveryMethod === "delivery" && (
                  <div className="flex justify-between text-koma-muted">
                    <span>{deliveryQuote.awaitingNeighborhood ? "Entrega estimada" : "Taxa de entrega"}</span>
                    <span className={deliveryFee === 0 ? "text-emerald-400 font-bold" : ""}>
                      {deliveryFee === 0 ? "Grátis" : formatPrice(deliveryFee)}
                    </span>
                  </div>
                )}
                {couponDiscount > 0 && (
                  <div className="flex justify-between text-emerald-400 font-bold">
                    <span>Cupom ({appliedCoupon?.codigo})</span>
                    <span>- {formatPrice(couponDiscount)}</span>
                  </div>
                )}
                {cashbackDiscount > 0 && (
                  <div className="flex justify-between text-amber-400 font-bold">
                    <span>Cashback resgatado</span>
                    <span>- {formatPrice(cashbackDiscount)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-koma-border pt-2 text-sm font-black text-koma-foreground">
                  <span>Total estimado</span>
                  <span className="text-base text-emerald-500">{formatPrice(total)}</span>
                </div>
              </div>
              {remainingMinimum > 0 && (
                <p className="mt-2 text-xs leading-relaxed text-amber-400" role="status">Faltam <strong>{formatPrice(remainingMinimum)}</strong> em produtos para o pedido mínimo de {formatPrice(minimumOrder)}.</p>
              )}
              <button
                type="button"
                onClick={handleCheckout}
                disabled={!orderingEnabled || availablePayments.length === 0}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black uppercase tracking-wider text-white transition hover:bg-emerald-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-koma-raised disabled:text-koma-muted"
                id="btn-confirm-order"
              >
                <span>{!orderingEnabled ? "Pedidos pausados" : availablePayments.length === 0 ? "Pagamento indisponível" : "Revisar pedido"}</span>
                {orderingEnabled && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
